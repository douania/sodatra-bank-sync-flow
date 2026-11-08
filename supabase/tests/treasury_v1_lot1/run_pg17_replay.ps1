param(
  [string]$Image = 'postgres:17-alpine',
  [switch]$Mutants,
  # Mesure C7 seule (R6) : volume synthétique 10 comptes × 10 ans dans son propre
  # conteneur, 120 lectures chronométrées, plan détaillé ; hors CI (durée).
  [switch]$Perf
)

# TREASURY V1 — LOT 1 : rejeu PostgreSQL 17 local, jetable, données synthétiques.
# Aucune connexion à une base préexistante, au staging ou à la production : les
# seules cibles sont des conteneurs créés ici, nommés de façon unique et
# supprimés à la fin. Deux scénarios, chacun dans son conteneur :
#   - « upgrade » : chaîne complète SANS la migration du lot ni celles du Lot 1
#     opérationnel, ni D1 qui en dépend, données Daily v2 et habilitations
#     existantes, relevé de la surface d'accès, migration du lot, comparaison de
#     surface, puis les deux migrations du Lot 1 opérationnel sur cette base
#     peuplée, seconde comparaison de surface, puis la migration des refus d'état
#     périmé (SQLSTATE 22023) et sa comparaison de surface, puis D1 (livraison
#     provisoire tardive) après ses dépendances, puis les suites du lot ;
#   - « fresh » : chaîne complète AVEC la migration du lot sur une base neuve,
#     puis les mêmes suites ; avec -Mutants, preuves de mordant.
# Dans les deux scénarios, les définitions effectives des cinq fonctions D1
# portent D1 avant les suites, ont la même empreinte dans les deux scénarios et
# n'ont pas changé en fin de scénario.

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -ge 7) { $PSStyle.OutputRendering = 'PlainText' }
# SQL transmis par tube à docker en UTF-8 (Windows PowerShell 5.1 : ASCII par défaut).
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$testDir = 'supabase/tests/treasury_v1_lot1'
$lotMigration = '20261102090000_treasury_v1_lot1_bank_balances.sql'
$operationalMigrations = @('20261103120000_daily_v2_operational_decisions.sql', '20261103130000_treasury_v1_lot1_operational_fix.sql')
$staleRefusalMigration = '20261106120000_treasury_v1_lot1_stale_refusal_sqlstate.sql'
# D1 redéfinit le cœur de dépôt de la migration opérationnelle : jamais avant elle.
$d1Migration = '20261108120000_daily_v2_d1_late_provisional_same_version.sql'
$expectedRaceResult = 'RESULT|AVAILABLE|1300.00|QUALIFIED|null'
$script:containerName = $null

function Get-SqlText([string]$relativePath) {
  Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $repoRoot $relativePath)
}

# Les appels natifs écrivent sur stderr : seul le code de sortie fait foi.
function Invoke-Sql([string]$sql, [string]$label) {
  $ErrorActionPreference = 'Continue'
  $output = $sql | docker exec -e PGOPTIONS=--client-min-messages=warning -i $script:containerName psql -q -At -v ON_ERROR_STOP=1 -U postgres -d postgres 2>&1
  if ($LASTEXITCODE -ne 0) { throw "SQL replay failed for $label`n$($output -join [Environment]::NewLine)" }
  $output | Where-Object { $_ -like 'PASS *' }
}

function Invoke-File([string]$relativePath) { Invoke-Sql (Get-SqlText $relativePath) $relativePath }

# Mesure : toute la sortie est rendue (lignes PERF et plan détaillé d'auto_explain).
function Invoke-FileVerbose([string]$relativePath) {
  $ErrorActionPreference = 'Continue'
  $output = (Get-SqlText $relativePath) | docker exec -e PGOPTIONS=--client-min-messages=warning -i $script:containerName psql -q -At -v ON_ERROR_STOP=1 -U postgres -d postgres 2>&1
  if ($LASTEXITCODE -ne 0) { throw "SQL replay failed for $relativePath`n$($output -join [Environment]::NewLine)" }
  $output | ForEach-Object { "$_" }
}

# Fichiers d'assertions : exécutés dans une transaction annulée, sans effet durable.
function Invoke-FileInTransaction([string]$relativePath) {
  Invoke-Sql ("BEGIN;`n" + (Get-SqlText $relativePath) + "`nROLLBACK;`n") $relativePath
}

function Wait-PostgresFinalReady {
  $ErrorActionPreference = 'Continue'
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    $logs = (docker logs $script:containerName 2>&1) -join "`n"
    if ($logs -match [regex]::Escape('PostgreSQL init process complete; ready for start up.')) {
      docker exec $script:containerName psql -v ON_ERROR_STOP=1 -U postgres -d postgres -At -c 'SELECT 1' *> $null
      if ($LASTEXITCODE -eq 0) { return }
    }
    Start-Sleep -Milliseconds 500
  }
  throw 'PostgreSQL 17 final server did not become ready'
}

function Start-Container([string]$scenario) {
  $script:containerName = "sbsf-treasury-$scenario-" + [guid]::NewGuid().ToString('N').Substring(0, 10)
  $ErrorActionPreference = 'Continue'
  docker run -d --rm --name $script:containerName -e POSTGRES_PASSWORD=postgres $Image *> $null
  if ($LASTEXITCODE -ne 0) { throw "Cannot start $Image" }
  $ErrorActionPreference = 'Stop'
  Wait-PostgresFinalReady
}

function Stop-Container {
  if ($script:containerName) {
    $ErrorActionPreference = 'Continue'
    docker rm -f $script:containerName *> $null
    $script:containerName = $null
  }
}

function Invoke-Chain([switch]$WithoutLot) {
  Invoke-File 'supabase/tests/full_chain_replay/00_platform_shim_minimal.sql' | Out-Null
  $files = Get-ChildItem -LiteralPath (Join-Path $repoRoot 'supabase/migrations') -Filter '*.sql' | Sort-Object Name
  $excluded = if ($WithoutLot) { @($lotMigration) + $operationalMigrations + @($staleRefusalMigration) + @($d1Migration) } else { @() }
  $applied = 0
  foreach ($file in $files) {
    if ($excluded -contains $file.Name) { continue }
    Invoke-File ('supabase/migrations/' + $file.Name) | Out-Null
    $applied++
  }
  Write-Output ("CHAIN applied ({0} migrations{1})" -f $applied, $(if ($WithoutLot) { ', lot, operational fix and D1 excluded' } else { '' }))
}

# D1 effective : le cœur de dépôt et le cœur de promotion installés portent les
# appels D1 ; empreinte des cinq définitions D1, comparée à l'attendue si fournie.
function Assert-D1Effective([string]$label, [string]$expected) {
  $sql = @'
DO $$
DECLARE
  v_f1 text := pg_get_functiondef('public.daily_stmt_pre_ingest_legacy_core_0u(jsonb,jsonb,jsonb,jsonb)'::regprocedure);
  v_f2 text := pg_get_functiondef('public.daily_stmt_promote_unit_core(uuid,uuid,uuid)'::regprocedure);
BEGIN
  IF position('v_d1_retire := coalesce(v_d1_same AND v_d1_coherent AND v_d1_conform, false);' IN v_f1) = 0
     OR position('PERFORM public.daily_stmt_retire_same_version_provisionals(v_day_unit_ids[v_i], v_active_id, v_actor, v_attempt_id, v_rth, v_staging_unit_id);' IN v_f1) = 0 THEN
    RAISE EXCEPTION 'D1_NOT_EFFECTIVE: installed deposit core does not carry D1';
  END IF;
  IF position('PERFORM public.daily_stmt_retire_same_version_provisionals(v_unit.day_unit_id, p_new_canonical_id, p_actor, v_unit.attempt_id, NULL, NULL);' IN v_f2) = 0 THEN
    RAISE EXCEPTION 'D1_NOT_EFFECTIVE: installed promotion core does not carry D1';
  END IF;
END $$;
SELECT 'D1SIG|' || md5(string_agg(pg_get_functiondef(f::regprocedure), E'\n' ORDER BY f))
FROM unnest(ARRAY['public.daily_stmt_pre_ingest_legacy_core_0u(jsonb,jsonb,jsonb,jsonb)',
                  'public.daily_stmt_promote_unit_core(uuid,uuid,uuid)',
                  'public.daily_stmt_payload_lines_conform(jsonb,text,integer,numeric,numeric,text,numeric,numeric)',
                  'public.daily_stmt_provisional_same_version(uuid,uuid)',
                  'public.daily_stmt_retire_same_version_provisionals(text,uuid,uuid,uuid,text,uuid)']) f;
'@
  $ErrorActionPreference = 'Continue'
  $output = $sql | docker exec -e PGOPTIONS=--client-min-messages=warning -i $script:containerName psql -q -At -v ON_ERROR_STOP=1 -U postgres -d postgres 2>&1
  if ($LASTEXITCODE -ne 0) { throw "D1 effective check failed ($label)`n$($output -join [Environment]::NewLine)" }
  $ErrorActionPreference = 'Stop'
  $signature = @($output | Where-Object { "$_" -like 'D1SIG|*' })[0]
  if (-not $signature) { throw "D1 effective check returned no signature ($label)" }
  $signature = "$signature".Substring(6)
  if ($expected -and $signature -ne $expected) { throw "D1 definitions differ ($label): $signature, expected $expected" }
  Write-Output "PASS D1 effective ($label) : deposit and promotion cores carry D1, signature $signature$(if ($expected) { ' (unchanged)' } else { '' })"
  $script:d1Signature = $signature
}

function Start-SqlJob([string]$relativePath) {
  $fullPath = (Resolve-Path (Join-Path $repoRoot $relativePath)).Path
  Start-Job -ScriptBlock {
    param($name, $path)
    $OutputEncoding = New-Object System.Text.UTF8Encoding $false
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $path |
      docker exec -e PGOPTIONS=--client-min-messages=warning -i $name psql -q -At -v ON_ERROR_STOP=1 -U postgres -d postgres 2>&1
    $code = $LASTEXITCODE
    $watch.Stop()
    [pscustomobject]@{ ExitCode = $code; Text = ($text -join [Environment]::NewLine); ElapsedMs = $watch.ElapsedMilliseconds }
  } -ArgumentList $script:containerName, $fullPath
}

# Course réelle : A lit (instantané pris avant son sommeil), B valide pendant le
# sommeil sans être bloquée. Le résultat de A doit être l'état ANTÉRIEUR exact.
function Invoke-SnapshotRace([switch]$ExpectMismatch, [string]$marker) {
  # B attend elle-même que la lecture de A soit active, puis prouve qu'elle
  # l'est encore après sa validation (WRITER_COMMITTED).
  $jobA = Start-SqlJob "$testDir/50_race_reader.sql"
  Start-Sleep -Milliseconds 200
  $jobB = Start-SqlJob "$testDir/51_race_writer.sql"
  $null = Wait-Job -Job $jobA, $jobB -Timeout 60
  $resultA = Receive-Job -Job $jobA
  $resultB = Receive-Job -Job $jobB
  Remove-Job -Job $jobA, $jobB -Force
  if ($resultA.ExitCode -ne 0) { throw "$marker reader failed`n$($resultA.Text)" }
  if ($resultB.ExitCode -ne 0 -or $resultB.Text -notmatch 'WRITER_COMMITTED') { throw "$marker writer failed`n$($resultB.Text)" }
  if ($resultA.ElapsedMs -lt 2500) { throw "$marker reader did not overlap the write ($($resultA.ElapsedMs) ms)" }
  if ($resultB.ElapsedMs -ge 2500) { throw "$marker writer was blocked by the reader ($($resultB.ElapsedMs) ms)" }
  $observed = @($resultA.Text -split "`r?`n" | Where-Object { $_ -like 'RESULT|*' })[0]
  if ($ExpectMismatch) {
    if ($observed -eq $expectedRaceResult) { throw "MUTANT_SURVIVED $marker ($observed)" }
    Write-Output "KILLED $marker -> race : the read saw the concurrent commit ($observed)"
  } else {
    if ($observed -ne $expectedRaceResult) { throw "$marker read a state other than the one before the commit: $observed" }
    Write-Output "PASS $marker (writer committed in $($resultB.ElapsedMs) ms during a $($resultA.ElapsedMs) ms read; read = state before commit)"
  }
}

function Get-ReferenceSnapshotAsLive {
  # C7 : la référence figée, installée à la place de la lecture optimisée.
  (Get-SqlText "$testDir/perf/reference_balances_snapshot.sql").Replace(
    'CREATE OR REPLACE FUNCTION tr_ref.balances_snapshot(', 'CREATE OR REPLACE FUNCTION treasury_private.balances_snapshot(')
}

# C7 : réponse identique à la référence figée, sur les scénarios et sur des
# historiques aléatoires à graine fixe, chacun dans une transaction annulée.
function Invoke-Differential {
  $reference = Get-SqlText "$testDir/perf/reference_balances_snapshot.sql"
  $compare = Get-SqlText "$testDir/perf/82_differential.sql"
  foreach ($base in "$testDir/40_balances.sql", "$testDir/46_operational.sql", "$testDir/perf/83_random_histories.sql") {
    Invoke-Sql ("BEGIN;`n" + $reference + "`n" + (Get-SqlText $base) + "`n" + $compare + "`nROLLBACK;`n") "differential on $base" |
      Where-Object { $_ -like 'PASS 82_*' -or $_ -like 'PASS 83_*' } | ForEach-Object { "$_ <- $base" }
  }
}

function Invoke-Mutants([switch]$Reference) {
  $count = 0
  $prefix = if ($Reference) { (Get-ReferenceSnapshotAsLive) + "`n" } else { '' }
  $mutantFiles = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'mutants') -Filter 'm*.sql' | Sort-Object Name
  foreach ($file in $mutantFiles) {
    $mutantText = Get-Content -Raw -Encoding UTF8 -LiteralPath $file.FullName
    $target = ([regex]::Match($mutantText, '-- target: (\S+)')).Groups[1].Value
    if (-not $target) { throw "Mutant without target: $($file.Name)" }
    $sql = "BEGIN;`n" + $prefix + $mutantText + "`n" + (Get-SqlText "$testDir/$target") + "`nROLLBACK;`n"
    $ErrorActionPreference = 'Continue'
    $output = $sql | docker exec -e PGOPTIONS=--client-min-messages=warning -i $script:containerName psql -q -At -v ON_ERROR_STOP=1 -U postgres -d postgres 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    $text = $output -join "`n"
    if ($text -match 'MUTANT_TARGET_NOT_FOUND') { throw "Mutant target not found: $($file.Name)" }
    if ($code -eq 0 -or $text -notmatch 'TEST_FAILED') { throw "MUTANT_SURVIVED $($file.BaseName)" }
    $reason = ([regex]::Match($text, 'TEST_FAILED: [^\r\n]*')).Value
    Write-Output "KILLED $($file.BaseName) -> $target : $reason$(if ($Reference) { ' [reference]' } else { '' })"
    $count++
  }
  Write-Output "MUTANTS killed$(if ($Reference) { ' on the frozen reference' } else { '' }): $count / $($mutantFiles.Count)"
}

function Invoke-LotSuites {
  Invoke-File "$testDir/20_inventory_setup.sql"
  Invoke-File "$testDir/30_qualification_setup.sql"
  Invoke-FileInTransaction "$testDir/12_access.sql"
  Invoke-FileInTransaction "$testDir/25_inventory_rules.sql"
  Invoke-FileInTransaction "$testDir/40_balances.sql"
  Invoke-FileInTransaction "$testDir/45_consolidation.sql"
  Invoke-FileInTransaction "$testDir/46_operational.sql"
  Invoke-File "$testDir/70_isolation.sql"
  Invoke-SnapshotRace -marker '50_race snapshot'
  Invoke-File "$testDir/52_race_restore.sql"
}

try {
  if ($Perf) {
    Write-Output '== scenario perf (C7)'
    Start-Container 'perf'
    Invoke-Chain
    Invoke-File "$testDir/00_tools.sql"
    Invoke-File "$testDir/05_users_governance.sql"
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    Invoke-FileVerbose "$testDir/perf/80_perf_seed.sql" | Where-Object { $_ -like 'PERF*' -or $_ -like 'PASS *' }
    Write-Output "PERF seed_seconds=$([math]::Round($watch.Elapsed.TotalSeconds, 1))"
    $ErrorActionPreference = 'Continue'
    $limits = docker inspect --format 'nano_cpus={{.HostConfig.NanoCpus}} memory_bytes={{.HostConfig.Memory}}' $script:containerName 2>&1
    $engine = docker info --format 'engine_cpus={{.NCPU}} engine_memory_bytes={{.MemTotal}} os={{.OperatingSystem}}' 2>&1
    $ErrorActionPreference = 'Stop'
    Write-Output "PERF container_limits $limits (0 = no limit) ; $engine"
    if ($IsWindows -or $env:OS -eq 'Windows_NT') {
      $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
      $mem = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
      Write-Output "PERF host cpu=$($cpu.Name.Trim()) cores=$($cpu.NumberOfCores) logical=$($cpu.NumberOfLogicalProcessors) memory_gb=$mem"
    }
    Invoke-FileVerbose "$testDir/perf/81_perf_measure.sql"
    Write-Output 'TREASURY_V1_LOT1_PERF_MEASURED'
    return
  }

  Write-Output '== scenario upgrade'
  Start-Container 'upgrade'
  Invoke-Chain -WithoutLot
  Invoke-File "$testDir/00_tools.sql"
  Invoke-File "$testDir/05_users_governance.sql"
  Invoke-File "$testDir/35_seed_daily_v2.sql"
  Invoke-File "$testDir/60_surface_before.sql"
  Invoke-File "supabase/migrations/$lotMigration" | Out-Null
  Write-Output 'LOT migration applied on the populated database'
  Invoke-File "$testDir/61_surface_compare.sql"
  foreach ($migration in $operationalMigrations) { Invoke-File "supabase/migrations/$migration" | Out-Null }
  Write-Output 'OPERATIONAL FIX migrations applied on the populated database'
  Invoke-File "$testDir/62_surface_compare_operational.sql"
  Invoke-File "$testDir/63_stale_sqlstate_before.sql"
  Invoke-File "supabase/migrations/$staleRefusalMigration" | Out-Null
  Write-Output 'STALE REFUSAL SQLSTATE migration applied on the populated database'
  Invoke-File "$testDir/64_surface_compare_stale_sqlstate.sql"
  Invoke-File "supabase/migrations/$d1Migration" | Out-Null
  Write-Output 'D1 migration applied on the populated database, after its dependencies'
  Assert-D1Effective 'upgrade, after D1'
  $upgradeD1Signature = $script:d1Signature
  Invoke-File "$testDir/10_structure_security.sql"
  Invoke-LotSuites
  Assert-D1Effective 'upgrade, end of scenario' $upgradeD1Signature
  Stop-Container

  Write-Output '== scenario fresh'
  Start-Container 'fresh'
  Invoke-Chain
  Assert-D1Effective 'fresh, after the ordered chain (same definitions as upgrade)' $upgradeD1Signature
  Invoke-File "$testDir/00_tools.sql"
  Invoke-File "$testDir/10_structure_security.sql"
  Invoke-File "$testDir/05_users_governance.sql"
  Invoke-File "$testDir/35_seed_daily_v2.sql"
  Invoke-LotSuites
  Invoke-Differential
  if ($Mutants) {
    Invoke-Mutants
    Invoke-Mutants -Reference
    Invoke-Sql "ALTER FUNCTION public.treasury_balances_at_v1(date) VOLATILE; ALTER FUNCTION treasury_private.balances_snapshot(date, date) VOLATILE;" 'm04 apply' | Out-Null
    Invoke-SnapshotRace -ExpectMismatch -marker 'm04_volatile_read'
    Invoke-Sql "ALTER FUNCTION public.treasury_balances_at_v1(date) STABLE; ALTER FUNCTION treasury_private.balances_snapshot(date, date) STABLE;" 'm04 revert' | Out-Null
    Invoke-File "$testDir/52_race_restore.sql"
  }
  Assert-D1Effective 'fresh, end of scenario' $upgradeD1Signature
  Write-Output 'TREASURY_V1_LOT1_PG17_REPLAY_PASS'
} finally {
  Stop-Container
}
