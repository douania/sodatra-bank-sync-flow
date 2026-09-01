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

try {
  docker run --name $container -e POSTGRES_PASSWORD=postgres -d $Image | Out-Null
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    docker exec $container pg_isready -U postgres -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Milliseconds 500
  }
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL 17 did not become ready' }

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

  Write-Output 'ALL_COLLECTION_REPORT_CONTROLLED_ACTIVATION_PG17_PASS'
}
finally {
  $exact = docker ps -a --filter "name=^/$container$" --format '{{.Names}}'
  if ($exact -eq $container) { docker rm -f $container | Out-Null }
  $remaining = docker ps -a --filter "name=^/$container$" --format '{{.Names}}'
  if ($remaining) { throw "Disposable container teardown failed: $container" }
  Write-Output 'DISPOSABLE_CONTAINER_REMOVED'
}
