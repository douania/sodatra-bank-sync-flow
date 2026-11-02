param(
  [string]$Image = 'postgres:17-alpine',
  [switch]$Mutants
)

# TREASURY V1 — LOT 1 : rejeu PostgreSQL 17 local, jetable, données synthétiques.
# Aucune connexion à une base préexistante, au staging ou à la production : les
# seules cibles sont des conteneurs créés ici, nommés de façon unique et
# supprimés à la fin. Deux scénarios, chacun dans son conteneur :
#   - « upgrade » : chaîne complète SANS la migration du lot, données Daily v2 et
#     habilitations existantes, relevé de la surface d'accès, migration du lot,
#     comparaison de surface, puis les suites du lot ;
#   - « fresh » : chaîne complète AVEC la migration du lot sur une base neuve,
#     puis les mêmes suites ; avec -Mutants, preuves de mordant.

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -ge 7) { $PSStyle.OutputRendering = 'PlainText' }
# SQL transmis par tube à docker en UTF-8 (Windows PowerShell 5.1 : ASCII par défaut).
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$testDir = 'supabase/tests/treasury_v1_lot1'
$lotMigration = '20261102090000_treasury_v1_lot1_bank_balances.sql'
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
  foreach ($file in $files) {
    if ($WithoutLot -and $file.Name -eq $lotMigration) { continue }
    Invoke-File ('supabase/migrations/' + $file.Name) | Out-Null
  }
  Write-Output ("CHAIN applied ({0} migrations{1})" -f ($files.Count - [int][bool]$WithoutLot), $(if ($WithoutLot) { ', lot excluded' } else { '' }))
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

function Invoke-Mutants {
  $count = 0
  $mutantFiles = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'mutants') -Filter 'm*.sql' | Sort-Object Name
  foreach ($file in $mutantFiles) {
    $mutantText = Get-Content -Raw -Encoding UTF8 -LiteralPath $file.FullName
    $target = ([regex]::Match($mutantText, '-- target: (\S+)')).Groups[1].Value
    if (-not $target) { throw "Mutant without target: $($file.Name)" }
    $sql = "BEGIN;`n" + $mutantText + "`n" + (Get-SqlText "$testDir/$target") + "`nROLLBACK;`n"
    $ErrorActionPreference = 'Continue'
    $output = $sql | docker exec -e PGOPTIONS=--client-min-messages=warning -i $script:containerName psql -q -At -v ON_ERROR_STOP=1 -U postgres -d postgres 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    $text = $output -join "`n"
    if ($text -match 'MUTANT_TARGET_NOT_FOUND') { throw "Mutant target not found: $($file.Name)" }
    if ($code -eq 0 -or $text -notmatch 'TEST_FAILED') { throw "MUTANT_SURVIVED $($file.BaseName)" }
    $reason = ([regex]::Match($text, 'TEST_FAILED: [^\r\n]*')).Value
    Write-Output "KILLED $($file.BaseName) -> $target : $reason"
    $count++
  }
  Write-Output "MUTANTS killed: $count / $($mutantFiles.Count)"
}

function Invoke-LotSuites {
  Invoke-File "$testDir/20_inventory_setup.sql"
  Invoke-File "$testDir/30_qualification_setup.sql"
  Invoke-FileInTransaction "$testDir/12_access.sql"
  Invoke-FileInTransaction "$testDir/25_inventory_rules.sql"
  Invoke-FileInTransaction "$testDir/40_balances.sql"
  Invoke-FileInTransaction "$testDir/45_consolidation.sql"
  Invoke-File "$testDir/70_isolation.sql"
  Invoke-SnapshotRace -marker '50_race snapshot'
  Invoke-File "$testDir/52_race_restore.sql"
}

try {
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
  Invoke-File "$testDir/10_structure_security.sql"
  Invoke-LotSuites
  Stop-Container

  Write-Output '== scenario fresh'
  Start-Container 'fresh'
  Invoke-Chain
  Invoke-File "$testDir/00_tools.sql"
  Invoke-File "$testDir/10_structure_security.sql"
  Invoke-File "$testDir/05_users_governance.sql"
  Invoke-File "$testDir/35_seed_daily_v2.sql"
  Invoke-LotSuites
  if ($Mutants) {
    Invoke-Mutants
    Invoke-Sql "ALTER FUNCTION public.treasury_balances_at_v1(date) VOLATILE; ALTER FUNCTION treasury_private.balances_snapshot(date, date) VOLATILE;" 'm04 apply' | Out-Null
    Invoke-SnapshotRace -ExpectMismatch -marker 'm04_volatile_read'
    Invoke-Sql "ALTER FUNCTION public.treasury_balances_at_v1(date) STABLE; ALTER FUNCTION treasury_private.balances_snapshot(date, date) STABLE;" 'm04 revert' | Out-Null
    Invoke-File "$testDir/52_race_restore.sql"
  }
  Write-Output 'TREASURY_V1_LOT1_PG17_REPLAY_PASS'
} finally {
  Stop-Container
}
