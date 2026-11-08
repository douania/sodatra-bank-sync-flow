param([string]$Image = 'postgres:17-alpine')

# LOT 1 OPÉRATIONNEL — décisions Daily v2 : rejeu PostgreSQL 17 local, jetable,
# données synthétiques. Chaîne complète des migrations (l'administrateur unique
# vient du module chèques), outils et identités de la suite trésorerie, charges
# produites par le VRAI pipeline (opfix_generate_payloads.ts), puis les suites
# 34 à 41 et deux courses à sessions réelles ; enfin D1 (livraison provisoire
# tardive de version identique) : suites 45a à 45c, mordants compris, et cinq
# courses à sessions réelles en trois paires de sessions (46a à 46h). Aucune
# connexion à une base
# préexistante, au staging ou à la production.

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -ge 7) { $PSStyle.OutputRendering = 'PlainText' }
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$testDir = 'supabase/tests/daily_statement_units_v2'
$script:containerName = $null
$workDir = Join-Path ([System.IO.Path]::GetTempPath()) ('sbsf-opfix-' + [guid]::NewGuid().ToString('N').Substring(0, 8))

function Get-SqlText([string]$path) { Get-Content -Raw -Encoding UTF8 -LiteralPath $path }

function Invoke-Sql([string]$sql, [string]$label) {
  $ErrorActionPreference = 'Continue'
  $output = $sql | docker exec -e PGOPTIONS=--client-min-messages=warning -i $script:containerName psql -q -At -v ON_ERROR_STOP=1 -U postgres -d postgres 2>&1
  if ($LASTEXITCODE -ne 0) { throw "SQL replay failed for $label`n$($output -join [Environment]::NewLine)" }
  $output | Where-Object { $_ -like 'PASS *' }
}

function Invoke-File([string]$relativePath) { Invoke-Sql (Get-SqlText (Join-Path $repoRoot $relativePath)) $relativePath }

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

# Course réelle : A tient un verrou ou une clé ; B, lancée pendant, doit attendre
# A (preuve chronométrée) puis rendre l'issue définie.
function Invoke-Race([string]$sessionA, [string]$sessionB, [string]$markerA, [string]$markerB, [string]$label) {
  $jobA = Start-SqlJob "$testDir/$sessionA"
  Start-Sleep -Milliseconds 1000
  $jobB = Start-SqlJob "$testDir/$sessionB"
  $null = Wait-Job -Job $jobA, $jobB -Timeout 60
  $resultA = Receive-Job -Job $jobA
  $resultB = Receive-Job -Job $jobB
  Remove-Job -Job $jobA, $jobB -Force
  if ($resultA.ExitCode -ne 0 -or $resultA.Text -notmatch $markerA) { throw "$label session A failed`n$($resultA.Text)" }
  if ($resultB.ExitCode -ne 0 -or $resultB.Text -notmatch $markerB) { throw "$label session B failed`n$($resultB.Text)" }
  if ($resultB.ElapsedMs -lt 1500) { throw "$label session B did not wait for A ($($resultB.ElapsedMs) ms)" }
  Write-Output "PASS $label (B waited $($resultB.ElapsedMs) ms for A, then $markerB)"
}

try {
  Write-Output '== payloads (real Daily v2 pipeline)'
  New-Item -ItemType Directory -Force $workDir | Out-Null
  Push-Location $repoRoot
  $ErrorActionPreference = 'Continue'
  $generated = npx tsx "$testDir/opfix_generate_payloads.ts" $workDir 2>&1
  $generatorExit = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  Pop-Location
  if ($generatorExit -ne 0) { throw "payload generator failed`n$($generated -join [Environment]::NewLine)" }
  Write-Output ($generated | Where-Object { $_ -like 'OPFIX_*' })

  $script:containerName = 'sbsf-dv2-operational-' + [guid]::NewGuid().ToString('N').Substring(0, 10)
  $ErrorActionPreference = 'Continue'
  docker run -d --rm --name $script:containerName -e POSTGRES_PASSWORD=postgres $Image *> $null
  if ($LASTEXITCODE -ne 0) { throw "Cannot start $Image" }
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    $logs = (docker logs $script:containerName 2>&1) -join "`n"
    if ($logs -match [regex]::Escape('PostgreSQL init process complete; ready for start up.')) {
      docker exec $script:containerName psql -U postgres -At -c 'SELECT 1' *> $null
      if ($LASTEXITCODE -eq 0) { break }
    }
    Start-Sleep -Milliseconds 500
  }
  $ErrorActionPreference = 'Stop'

  Invoke-File 'supabase/tests/full_chain_replay/00_platform_shim_minimal.sql' | Out-Null
  $files = Get-ChildItem -LiteralPath (Join-Path $repoRoot 'supabase/migrations') -Filter '*.sql' | Sort-Object Name
  foreach ($file in $files) { Invoke-File ('supabase/migrations/' + $file.Name) | Out-Null }
  Write-Output "CHAIN applied ($($files.Count) migrations)"
  Invoke-File 'supabase/tests/treasury_v1_lot1/00_tools.sql'
  Invoke-File 'supabase/tests/treasury_v1_lot1/05_users_governance.sql'
  Invoke-Sql (Get-SqlText (Join-Path $workDir 'opfix_payloads.sql')) 'opfix_payloads.sql' | Out-Null
  Invoke-Sql (Get-SqlText (Join-Path $workDir 'opfix_version_parity.sql')) 'opfix_version_parity.sql' | Out-Null
  Invoke-File "$testDir/43_version_parity.sql"
  foreach ($suite in '33a_operational_setup', '44_lines_conformity', '40_duplicate_financial_version_lines', '41_version_comparison',
                     '39_balance_only_correction', '36_version_refutation', '35_unit_rejection',
                     '34_attempt_attestations', '37_batch_approval', '38a_decision_concurrency_setup') {
    Invoke-File "$testDir/$suite.sql"
  }
  Invoke-Race '38b_race_promote_session_a.sql' '38c_race_reject_session_b.sql' 'RACE_A_COMMITTED' 'RACE_B_REFUSED' '38 reject versus promote'
  Invoke-Race '38d_race_replay_session_a.sql' '38e_race_replay_session_b.sql' 'REPLAY_A_COMMITTED' 'REPLAY_B_DONE' '38 lost-response replay'
  Invoke-File "$testDir/38f_decision_concurrency_asserts.sql"
  # D1 : règles du dépôt, lecture « Soldes à date » par le vrai dépôt, courses.
  foreach ($suite in '45a_d1_setup', '45b_d1_deposit_rules', '45c_d1_treasury_reading', '46a_d1_race_setup') {
    Invoke-File "$testDir/$suite.sql"
  }
  Invoke-Race '46b_d1_race_late_deposit_holds_a.sql' '46c_d1_race_promotion_waits_b.sql' 'D1_RACE_A_COMMITTED' 'D1_RACE_B_DONE' '46 C4+C1 late redeposits hold the day lock, promotion waits'
  Invoke-Race '46d_d1_race_promotion_holds_a.sql' '46e_d1_race_late_deposit_waits_b.sql' 'D1_RACE_A_COMMITTED' 'D1_RACE_B_DONE' '46 C5+C2 promotion holds the day lock, late redeposit waits'
  Invoke-Race '46f_d1_race_twin_deposit_holds_a.sql' '46g_d1_race_twin_deposit_waits_b.sql' 'D1_RACE_A_COMMITTED' 'D1_RACE_B_DONE' '46 C3 twin late deposits beside a divergent live provisional'
  Invoke-File "$testDir/46h_d1_race_asserts.sql"
  Write-Output 'DAILY_V2_OPERATIONAL_DECISIONS_PG17_PASS'
} finally {
  if ($script:containerName) {
    $ErrorActionPreference = 'Continue'
    docker rm -f $script:containerName *> $null
  }
  if (Test-Path -LiteralPath $workDir) { Remove-Item -Recurse -Force -LiteralPath $workDir }
}
