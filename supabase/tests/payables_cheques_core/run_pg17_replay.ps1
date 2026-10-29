param(
  [string]$Image = 'postgres:17-alpine'
)

# PAYABLES-CHEQUES-CORE — rejeu PostgreSQL 17 local, jetable, données synthétiques.
# Aucune connexion à une base préexistante, staging ou production : les seules
# cibles sont des conteneurs créés ici, nommés de façon unique et supprimés à la fin.
# Deux scénarios, chacun dans son conteneur :
#   - « upgrade » : recette complète sous l'ancienne gouvernance, puis migration
#     administrateur unique sur ce domaine déjà rempli ;
#   - « fresh » : les trois migrations sur une base neuve, puis les mêmes suites
#     financières sous la gouvernance de l'administrateur unique.

$ErrorActionPreference = 'Stop'
# Le SQL est transmis par tube à docker : sous Windows PowerShell 5.1 l'encodage
# par défaut de ce tube est ASCII (accents remplacés par « ? »). UTF-8 imposé ici
# et dans chaque job, qui s'exécute dans un processus distinct.
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
$containerName = $null
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$testDir = 'supabase/tests/payables_cheques_core'

# Les appels natifs écrivent sur stderr : sous Windows PowerShell 5.1 cela ne doit
# pas lever d'exception ; seul le code de sortie fait foi.
function Invoke-ReplaySqlFile {
  param([Parameter(Mandatory = $true)][string]$Path)
  $ErrorActionPreference = 'Continue'
  $fullPath = (Resolve-Path (Join-Path $repoRoot $Path)).Path
  $output = Get-Content -Raw -Encoding UTF8 -LiteralPath $fullPath |
    docker exec -e PGOPTIONS=--client-min-messages=warning -i $containerName psql -q -At -v ON_ERROR_STOP=1 -U postgres -d postgres 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "SQL replay failed for $Path`n$($output -join [Environment]::NewLine)"
  }
  $output | Where-Object { $_ -like 'PASS *' }
}

function Invoke-SqlCommand([string]$sql) {
  $ErrorActionPreference = 'Continue'
  $output = docker exec $containerName psql -v ON_ERROR_STOP=1 -U postgres -d postgres -At -c $sql
  if ($LASTEXITCODE -ne 0) { throw "SQL command failed: $sql" }
  return $output
}

function Start-SqlJob([string]$relativePath) {
  $fullPath = (Resolve-Path (Join-Path $repoRoot $relativePath)).Path
  Start-Job -ScriptBlock {
    param($name, $path)
    $OutputEncoding = New-Object System.Text.UTF8Encoding $false
    # Durée propre de la session : seule preuve qu'elle a attendu un verrou.
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    $text = Get-Content -Raw -Encoding UTF8 -LiteralPath $path |
      docker exec -e PGOPTIONS=--client-min-messages=warning -i $name psql -q -At -v ON_ERROR_STOP=1 -U postgres -d postgres 2>&1
    $code = $LASTEXITCODE
    $watch.Stop()
    [pscustomobject]@{ ExitCode = $code; Text = ($text -join [Environment]::NewLine); ElapsedMs = $watch.ElapsedMilliseconds }
  } -ArgumentList $containerName, $fullPath
}

function Wait-PostgresFinalReady {
  $ErrorActionPreference = 'Continue'
  for ($attempt = 0; $attempt -lt 80; $attempt++) {
    $logs = (docker logs $containerName 2>&1) -join "`n"
    if ($logs -match [regex]::Escape('PostgreSQL init process complete; ready for start up.')) {
      docker exec $containerName psql -v ON_ERROR_STOP=1 -U postgres -d postgres -At -c 'SELECT 1' *> $null
      if ($LASTEXITCODE -eq 0) { return }
    }
    Start-Sleep -Milliseconds 500
  }
  throw 'PostgreSQL 17 final server did not become ready'
}

# Course réelle : la session A garde un verrou ; la session B doit attendre puis
# échouer avec l'un des codes attendus.
function Invoke-Race([string]$sessionA, [string]$sessionB, [string[]]$expectedCodes, [string]$marker) {
  $jobA = Start-SqlJob "$testDir/$sessionA"
  Start-Sleep -Milliseconds 1500
  $jobB = Start-SqlJob "$testDir/$sessionB"
  $null = Wait-Job -Job $jobA, $jobB -Timeout 60
  $resultA = Receive-Job -Job $jobA
  $resultB = Receive-Job -Job $jobB
  Remove-Job -Job $jobA, $jobB -Force
  if ($resultA.ExitCode -ne 0) { throw "$marker winner failed`n$($resultA.Text)" }
  $matched = $expectedCodes | Where-Object { $resultB.Text -like "*$_*" }
  if ($resultB.ExitCode -eq 0 -or -not $matched) { throw "$marker loser did not fail closed`n$($resultB.Text)" }
  if ($resultB.ElapsedMs -lt 2000) { throw "$marker loser did not wait for the lock ($($resultB.ElapsedMs) ms)" }
  Write-Output "$marker ($($matched -join ',') after $($resultB.ElapsedMs) ms)"
}

# Course sérialisée : les deux sessions réussissent ; la seconde attend le
# verrou de la première, et l'assertion suivante vérifie qu'elle a vu son effet.
function Invoke-SerializedRace([string]$sessionA, [string]$sessionB, [string]$marker) {
  $jobA = Start-SqlJob "$testDir/$sessionA"
  Start-Sleep -Milliseconds 1500
  $jobB = Start-SqlJob "$testDir/$sessionB"
  $null = Wait-Job -Job $jobA, $jobB -Timeout 60
  $resultA = Receive-Job -Job $jobA
  $resultB = Receive-Job -Job $jobB
  Remove-Job -Job $jobA, $jobB -Force
  if ($resultA.ExitCode -ne 0) { throw "$marker first session failed`n$($resultA.Text)" }
  if ($resultB.ExitCode -ne 0) { throw "$marker second session failed`n$($resultB.Text)" }
  if ($resultB.ElapsedMs -lt 2000) { throw "$marker second session did not wait for the lock ($($resultB.ElapsedMs) ms)" }
  Write-Output "$marker (outcome $($resultB.Text.Trim()) after $($resultB.ElapsedMs) ms)"
}

# Lecture concurrente : la session A lit pendant que la session B modifie puis
# valide ; B ne doit pas être bloquée et doit se terminer pendant la lecture de A.
function Invoke-ConcurrentRead([string]$sessionA, [string]$sessionB, [string]$marker) {
  $jobA = Start-SqlJob "$testDir/$sessionA"
  Start-Sleep -Milliseconds 1000
  $jobB = Start-SqlJob "$testDir/$sessionB"
  $null = Wait-Job -Job $jobA, $jobB -Timeout 60
  $resultA = Receive-Job -Job $jobA
  $resultB = Receive-Job -Job $jobB
  Remove-Job -Job $jobA, $jobB -Force
  if ($resultA.ExitCode -ne 0) { throw "$marker reader failed`n$($resultA.Text)" }
  if ($resultB.ExitCode -ne 0) { throw "$marker writer failed`n$($resultB.Text)" }
  if ($resultA.ElapsedMs -lt 2500) { throw "$marker reader did not overlap the write ($($resultA.ElapsedMs) ms)" }
  if ($resultB.ElapsedMs -ge 2000) { throw "$marker writer was blocked by the reader ($($resultB.ElapsedMs) ms)" }
  Write-Output "$marker (writer committed in $($resultB.ElapsedMs) ms during a $($resultA.ElapsedMs) ms read)"
}

function Invoke-SwitchRace {
  # Refermeture concurrente : une écriture en cours garde le verrou partagé de
  # l'interrupteur ; la refermeture doit attendre la fin de sa transaction.
  $dockerExe = (Get-Command docker).Source
  $holder = Start-Job -ScriptBlock {
    param($dockerPath, $name)
    & $dockerPath exec $name psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c @"
SELECT pc_test.as_user('acc1');
BEGIN;
SELECT public.payables_acquire_lock_v1('INVOICE', pc_test.id('inv_a2'));
SELECT pg_sleep(3);
COMMIT;
"@
    if ($LASTEXITCODE -ne 0) { throw 'switch holder failed' }
  } -ArgumentList $dockerExe, $containerName
  try {
    $active = $false
    for ($i = 0; $i -lt 40; $i++) {
      $count = Invoke-SqlCommand "SELECT count(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND state = 'active' AND query LIKE '%pg_sleep(3)%';"
      if ([int]$count -gt 0) { $active = $true; break }
      Start-Sleep -Milliseconds 100
    }
    if (-not $active) { throw 'switch holder did not become active' }
    Start-Sleep -Milliseconds 250
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    Invoke-SqlCommand "UPDATE payables_private.runtime_control SET lock_minutes = 31, change_reason = 'Concurrent relock synthetic qualification';" | Out-Null
    $watch.Stop()
    if ($watch.ElapsedMilliseconds -lt 1500) { throw "Switch change did not wait for the in-flight write ($($watch.ElapsedMilliseconds) ms)" }
    Wait-Job -Job $holder -Timeout 15 | Out-Null
    if ($holder.State -ne 'Completed') { throw "switch holder state: $($holder.State)" }
    Write-Output "SWITCH_CHANGE_WAITS_FOR_WRITES ($($watch.ElapsedMilliseconds) ms)"
  }
  finally {
    Remove-Job -Job $holder -Force -ErrorAction SilentlyContinue
  }
}

# Suites financières et courses à deux sessions, identiques dans les deux scénarios.
function Invoke-FinancialSuites([string]$governanceFile) {
  foreach ($file in @('15_amount_words_corpus.sql', $governanceFile, '30_invoices_payments.sql',
      '40_cheque_print_issue.sql', '41_cheque_issuance.sql', '50_exits_takeover_exceptions.sql',
      '60_bank_followup_position.sql', '70_concurrency_setup.sql')) {
    Invoke-ReplaySqlFile "$testDir/$file"
  }
  Invoke-Race '71_reserve_session_a.sql' '72_reserve_session_b.sql' @('PAYABLES_INVOICE_FULLY_ENGAGED') 'CONCURRENT_RESERVATION_BLOCKED'
  Invoke-Race '73_confirm_session_a.sql' '74_confirm_session_b.sql' @('PAYABLES_STALE_VERSION', 'PAYABLES_ISSUE_ALREADY_RECORDED') 'CONCURRENT_CONFIRMATION_BLOCKED'
  Invoke-ReplaySqlFile "$testDir/75_concurrency_assert.sql"
  Invoke-SerializedRace '76_merge_request_session_a.sql' '77_merge_session_b.sql' 'CONCURRENT_MERGE_SEES_RESERVATION'
  Invoke-ReplaySqlFile "$testDir/78_merge_assert.sql"
  Invoke-Race '79a_rebind_unit_session_a.sql' '79b_rebind_session_b.sql' @('PAYABLES_REBIND_EVIDENCE_INVALID:UNIT_NOT_VALID') 'CONCURRENT_REBIND_SEES_UNIT_REVIEW'
  Invoke-ReplaySqlFile "$testDir/79c_rebind_assert.sql"
  Invoke-ConcurrentRead '79d_read_session_a.sql' '79e_read_session_b.sql' 'READ_SNAPSHOT_STABLE_DURING_WRITE'
  Invoke-ReplaySqlFile "$testDir/79f_read_assert.sql"
  Invoke-SwitchRace
  Invoke-ReplaySqlFile "$testDir/80_immutability_hygiene.sql"
}

# Administrateur unique : contrat, révocation pendant une écriture, décisions
# concurrentes, retrait et remplacement de l'autorité pendant son usage.
function Invoke-SingleAdminSuites {
  Invoke-ReplaySqlFile "$testDir/90_single_admin.sql"
  Invoke-SerializedRace '91_admin_revoke_write_session_a.sql' '92_admin_revoke_session_b.sql' 'REVOCATION_WAITS_FOR_INFLIGHT_WRITE'
  Invoke-ReplaySqlFile "$testDir/93_admin_revoke_assert.sql"
  Invoke-Race '93a_admin_revoke_holder_session_a.sql' '93b_revoked_write_session_b.sql' @('PAYABLES_CAPABILITY_REQUIRED:INVOICE_MANAGE') 'WRITE_WAITS_FOR_INFLIGHT_REVOCATION'
  Invoke-Race '94_admin_grant_session_a.sql' '95_admin_grant_session_b.sql' @('PAYABLES_CAPABILITY_UNCHANGED') 'CONCURRENT_ADMIN_DECISION_SERIALIZED'
  Invoke-Race '95a_link_prep_session_a.sql' '95b_link_change_session_b.sql' @('PAYABLES_LINK_IN_USE_BY_PENDING_CHEQUE') 'LINK_CHANGE_WAITS_FOR_INFLIGHT_PREPARATION'
  Invoke-Race '95c_admin_prep_session_a.sql' '95d_operator_identity_session_b.sql' @('PAYABLES_LINK_IN_USE_BY_PENDING_CHEQUE') 'IDENTITY_CHANGE_WAITS_FOR_INFLIGHT_PREPARATION'
  Invoke-SerializedRace '96_admin_write_session_a.sql' '97_operator_withdraw_session_b.sql' 'AUTHORITY_WITHDRAWAL_WAITS_FOR_ADMIN_WRITE'
  Invoke-ReplaySqlFile "$testDir/98_authority_withdraw_assert.sql"
  Invoke-SerializedRace '99a_admin_decision_session_a.sql' '99b_operator_replace_session_b.sql' 'AUTHORITY_REPLACEMENT_WAITS_FOR_ADMIN_DECISION'
  Invoke-ReplaySqlFile "$testDir/99c_single_admin_final.sql"
}

function Invoke-Scenario([ValidateSet('upgrade', 'fresh')][string]$scenario) {
  $script:containerName = "sbsf-payables-cheques-pg17-$scenario-" + [guid]::NewGuid().ToString('N').Substring(0, 10)
  $existing = docker ps -a --filter "name=^/$containerName$" --format '{{.Names}}'
  if ($existing) { throw "Disposable container already exists: $containerName" }
  try {
    docker run --name $containerName -e POSTGRES_HOST_AUTH_METHOD=trust -d $Image | Out-Null
    Wait-PostgresFinalReady
    $version = Invoke-SqlCommand 'show server_version'
    Write-Output "POSTGRES_VERSION=$version TARGET=$containerName SCENARIO=$scenario"

    Invoke-ReplaySqlFile "$testDir/00_platform_daily_v2_shim.sql"
    Invoke-ReplaySqlFile 'supabase/migrations/20261026090000_payables_cheques_core.sql'
    Invoke-ReplaySqlFile 'supabase/migrations/20261026090100_payables_cheques_bank_followup.sql'
    if ($scenario -eq 'upgrade') {
      Invoke-ReplaySqlFile "$testDir/10_structure_security.sql"
      Invoke-FinancialSuites '20_governance.sql'
      Invoke-ReplaySqlFile "$testDir/05_single_admin_users.sql"
      Invoke-ReplaySqlFile "$testDir/84_single_admin_upgrade_snapshot.sql"
      Invoke-ReplaySqlFile 'supabase/migrations/20261028090000_payables_cheques_single_admin.sql'
      Invoke-ReplaySqlFile "$testDir/85_single_admin_upgrade.sql"
    }
    else {
      Invoke-ReplaySqlFile 'supabase/migrations/20261028090000_payables_cheques_single_admin.sql'
      Invoke-ReplaySqlFile "$testDir/05_single_admin_users.sql"
      Invoke-ReplaySqlFile "$testDir/11_single_admin_fresh.sql"
      Invoke-FinancialSuites '21_single_admin_governance_setup.sql'
    }
    Invoke-SingleAdminSuites
    Write-Output "PAYABLES_CHEQUES_SCENARIO_PASS $scenario"
  }
  finally {
    docker rm -f $containerName *> $null
  }
}

Invoke-Scenario 'upgrade'
Invoke-Scenario 'fresh'
Write-Output 'PAYABLES_CHEQUES_CORE_PG17_REPLAY_PASS'
