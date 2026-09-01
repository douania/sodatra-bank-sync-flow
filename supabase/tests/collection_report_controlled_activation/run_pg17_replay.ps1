param(
  [string]$Image = 'postgres:17-alpine'
)

$ErrorActionPreference = 'Stop'
$container = 'sodatra-collection-activation-' + [guid]::NewGuid().ToString('N').Substring(0, 10)
$root = (Resolve-Path (
  Join-Path (Join-Path (Join-Path $PSScriptRoot '..') '..') '..'
)).Path

function Invoke-SqlFile([string]$relativePath) {
  $absolutePath = Join-Path $root $relativePath
  Get-Content -Raw -Encoding UTF8 -LiteralPath $absolutePath |
    docker exec -i $container psql -v ON_ERROR_STOP=1 -U postgres -d postgres
  if ($LASTEXITCODE -ne 0) { throw "SQL replay failed: $relativePath" }
}

function Invoke-SqlCommand([string]$sql) {
  $output = docker exec $container psql -v ON_ERROR_STOP=1 -U postgres -d postgres -At -c $sql
  if ($LASTEXITCODE -ne 0) { throw "SQL command failed: $sql" }
  return $output
}

function Wait-PostgresFinalReady {
  $initCompleteMarker = 'PostgreSQL init process complete; ready for start up.'

  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $running = docker inspect --format '{{.State.Running}}' $container 2>$null
    if ($LASTEXITCODE -ne 0 -or $running -ne 'true') {
      throw 'PostgreSQL 17 container stopped before becoming ready'
    }

    # The official image starts a temporary bootstrap server before restarting
    # PostgreSQL for normal operation. pg_isready alone can observe that first
    # server and let the replay race the restart. Wait for the bootstrap-complete
    # marker, then prove the final server accepts a real SQL query.
    $containerLogs = docker logs $container 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect PostgreSQL 17 startup logs' }
    if ([string]::Join("`n", $containerLogs) -match [regex]::Escape($initCompleteMarker)) {
      docker exec $container psql -v ON_ERROR_STOP=1 -U postgres -d postgres -At -c 'SELECT 1' *> $null
      if ($LASTEXITCODE -eq 0) { return }
    }

    Start-Sleep -Milliseconds 500
  }

  throw 'PostgreSQL 17 final server did not become ready within 30 seconds'
}

try {
  docker run --name $container -e POSTGRES_PASSWORD=postgres -d $Image | Out-Null
  Wait-PostgresFinalReady

  Invoke-SqlFile 'supabase/tests/collection_report_controlled_activation/00_schema.sql'
  Invoke-SqlFile 'supabase/migrations/20260901000000_collection_report_controlled_production_activation.sql'
  Invoke-SqlFile 'supabase/tests/collection_report_controlled_activation/10_atomic_scope.sql'

  # Concurrence réelle : assert_promotion_scope_v1 prend un verrou partagé sur
  # le singleton. Un relock concurrent doit attendre la fin de sa transaction.
  Invoke-SqlCommand @"
UPDATE collection_import_private.runtime_control
SET promotion_scope_enabled = true,
    enabled_until = statement_timestamp() + interval '30 minutes',
    change_reason = 'Open synthetic Collection concurrency qualification window'
WHERE singleton = true;
"@ | Out-Null

  $dockerExe = (Get-Command docker).Source
  $holder = Start-Job -ScriptBlock {
    param($dockerPath, $containerName)
    & $dockerPath exec $containerName psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c @"
BEGIN;
SELECT collection_import_private.assert_promotion_scope_v1();
SELECT pg_sleep(3);
COMMIT;
"@
    if ($LASTEXITCODE -ne 0) { throw 'scope lock holder failed' }
  } -ArgumentList $dockerExe, $container

  try {
    $holderActive = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      $activeCount = Invoke-SqlCommand @"
SELECT count(*)
FROM pg_stat_activity
WHERE pid <> pg_backend_pid()
  AND state = 'active'
  AND query LIKE '%pg_sleep(3)%';
"@
      if ([int]$activeCount -gt 0) { $holderActive = $true; break }
      Start-Sleep -Milliseconds 100
    }
    if (-not $holderActive) { throw 'scope lock holder did not become active' }

    Start-Sleep -Milliseconds 250
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    Invoke-SqlCommand @"
UPDATE collection_import_private.runtime_control
SET promotion_scope_enabled = false,
    enabled_until = NULL,
    change_reason = 'Relock synthetic Collection concurrency qualification window'
WHERE singleton = true;
"@ | Out-Null
    $stopwatch.Stop()

    if ($stopwatch.ElapsedMilliseconds -lt 1500) {
      throw "Concurrent relock did not wait for the import scope lock ($($stopwatch.ElapsedMilliseconds) ms)"
    }
    Wait-Job -Job $holder -Timeout 10 | Out-Null
    if ($holder.State -ne 'Completed') { throw "scope lock holder state: $($holder.State)" }
    Receive-Job -Job $holder | Out-Null
    Write-Output "COLLECTION_SCOPE_CONCURRENCY_PASS ($($stopwatch.ElapsedMilliseconds) ms)"
  }
  finally {
    Remove-Job -Job $holder -Force -ErrorAction SilentlyContinue
  }

  # Concurrence réelle d'audit : un enrichissement autorisé non commité ne doit
  # pas être dépassé par la capture de préimage. L'import attend le verrou,
  # puis row_audit doit contenir la valeur effectivement commitée par le holder.
  Invoke-SqlCommand @"
UPDATE collection_import_private.runtime_control
SET promotion_scope_enabled = true,
    enabled_until = statement_timestamp() + interval '30 minutes',
    change_reason = 'Open synthetic audit preimage qualification window'
WHERE singleton = true;
"@ | Out-Null

  $auditHolder = Start-Job -ScriptBlock {
    param($dockerPath, $containerName)
    & $dockerPath exec $containerName psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c @"
BEGIN;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
UPDATE public.collection_report
SET remarques = 'CONCURRENT-AUDIT-VALUE'
WHERE excel_filename = 'COLLECTION-SYNTH.xlsx' AND excel_source_row = 2;
SELECT pg_sleep(3) /* COLLECTION_AUDIT_HOLDER */;
COMMIT;
"@
    if ($LASTEXITCODE -ne 0) { throw 'audit preimage lock holder failed' }
  } -ArgumentList $dockerExe, $container

  try {
    $auditHolderActive = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      $activeCount = Invoke-SqlCommand @"
SELECT count(*)
FROM pg_stat_activity
WHERE pid <> pg_backend_pid()
  AND state = 'active'
  AND query LIKE '%COLLECTION_AUDIT_HOLDER%';
"@
      if ([int]$activeCount -gt 0) { $auditHolderActive = $true; break }
      Start-Sleep -Milliseconds 100
    }
    if (-not $auditHolderActive) { throw 'audit preimage lock holder did not become active' }

    Start-Sleep -Milliseconds 250
    $auditStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    Invoke-SqlCommand @"
BEGIN;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
SELECT public.import_collection_report_atomic_v1(
  '10000000-0000-4000-8000-000000000023',
  '[{
    "report_date":"2026-09-01","client_code":"CLIENT-A","collection_amount":1000,
    "bank_name":"SYNTH BANK","status":"pending","collection_type":"UNKNOWN",
    "effet_echeance_date":null,"effet_status":null,"cheque_number":null,"cheque_status":null,
    "excel_filename":"COLLECTION-SYNTH.xlsx","excel_source_row":2,"date_of_validity":null,
    "facture_no":"FA-1","no_chq_bd":null,"bank_name_display":null,"depo_ref":null,
    "nj":null,"taux":null,"interet":null,"commission":null,"tob":null,
    "frais_escompte":null,"bank_commission":null,"sg_or_fa_no":null,"d_n_amount":null,
    "income":null,"date_of_impay":null,"reglement_impaye":null,"remarques":null
  }]'::jsonb
);
COMMIT;
"@ | Out-Null
    $auditStopwatch.Stop()

    if ($auditStopwatch.ElapsedMilliseconds -lt 1500) {
      throw "Atomic import did not wait for the concurrent enrichment lock ($($auditStopwatch.ElapsedMilliseconds) ms)"
    }
    Wait-Job -Job $auditHolder -Timeout 10 | Out-Null
    if ($auditHolder.State -ne 'Completed') { throw "audit preimage lock holder state: $($auditHolder.State)" }
    Receive-Job -Job $auditHolder | Out-Null

    $auditedPreimage = Invoke-SqlCommand @"
SELECT count(*)
FROM collection_import_private.row_audit
WHERE actor_id = '00000000-0000-0000-0000-000000000002'
  AND command_key = '10000000-0000-4000-8000-000000000023'
  AND excel_filename = 'COLLECTION-SYNTH.xlsx'
  AND excel_source_row = 2
  AND before_row->>'remarques' = 'CONCURRENT-AUDIT-VALUE'
  AND after_row->>'remarques' = 'CONCURRENT-AUDIT-VALUE';
"@
    if ([int]$auditedPreimage -ne 1) { throw 'concurrent enrichment was not captured exactly in row audit' }
    Write-Output "COLLECTION_AUDIT_PREIMAGE_CONCURRENCY_PASS ($($auditStopwatch.ElapsedMilliseconds) ms)"
  }
  finally {
    Remove-Job -Job $auditHolder -Force -ErrorAction SilentlyContinue
  }

  Invoke-SqlCommand @"
UPDATE collection_import_private.runtime_control
SET promotion_scope_enabled = false,
    enabled_until = NULL,
    change_reason = 'Relock synthetic audit preimage qualification window'
WHERE singleton = true;
"@ | Out-Null

  Write-Output 'ALL_COLLECTION_REPORT_CONTROLLED_ACTIVATION_PG17_PASS'
}
finally {
  $exact = docker ps -a --filter "name=^/$container$" --format '{{.Names}}'
  if ($exact -eq $container) { docker rm -f $container | Out-Null }
  $remaining = docker ps -a --filter "name=^/$container$" --format '{{.Names}}'
  if ($remaining) { throw "Disposable container teardown failed: $container" }
  Write-Output 'DISPOSABLE_CONTAINER_REMOVED'
}
