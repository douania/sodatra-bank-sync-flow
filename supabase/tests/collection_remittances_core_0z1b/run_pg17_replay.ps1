param()

$ErrorActionPreference = 'Stop'
$containerName = 'bsflow-0z1b-core-pg17-replay'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path

function Invoke-ReplaySqlFile {
  param([Parameter(Mandatory=$true)][string]$Path)
  $fullPath = (Resolve-Path (Join-Path $repoRoot $Path)).Path
  $output = Get-Content -Raw -LiteralPath $fullPath |
    docker exec -e PGOPTIONS=--client-min-messages=warning -i $containerName psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "SQL replay failed for $Path`n$($output -join [Environment]::NewLine)"
  }
  $output
}

$existing = docker ps -a --filter "name=^/$containerName$" --format '{{.Names}}'
if ($existing) {
  throw "Disposable container already exists: $containerName"
}

try {
  docker run --name $containerName -e POSTGRES_HOST_AUTH_METHOD=trust -d postgres:17-alpine | Out-Null
  for ($i=0; $i -lt 40; $i++) {
    docker exec $containerName pg_isready -U postgres *> $null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Milliseconds 250
  }
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL 17 did not become ready' }
  Start-Sleep -Milliseconds 500

  $version = docker exec $containerName psql -At -U postgres -d postgres -c 'show server_version'
  if (-not $version) { throw 'PostgreSQL version could not be read' }
  Write-Output "POSTGRES_VERSION=$version"

  Invoke-ReplaySqlFile 'supabase/tests/collection_remittances_core_0z1b/00_platform_daily_v2_shim.sql'
  Invoke-ReplaySqlFile 'supabase/migrations/20260803000000_collection_remittances_core_0z1b.sql'
  Invoke-ReplaySqlFile 'supabase/tests/collection_remittances_core_0z1b/05_service_role_execute_pre_fix.sql'
  Invoke-ReplaySqlFile 'supabase/migrations/20260804000000_collection_remittances_core_service_role_execute_fix.sql'
  Invoke-ReplaySqlFile 'supabase/tests/collection_remittances_core_0z1b/10_structure_security.sql'
  Invoke-ReplaySqlFile 'supabase/tests/collection_remittances_core_0z1b/20_core_scenarios.sql'
  Invoke-ReplaySqlFile 'supabase/tests/collection_remittances_core_0z1b/25_counter_review_regressions.sql'
  Invoke-ReplaySqlFile 'supabase/tests/collection_remittances_core_0z1b/30_concurrency_setup.sql'

  $concurrencyA = (Resolve-Path (Join-Path $repoRoot 'supabase/tests/collection_remittances_core_0z1b/31_concurrency_a.sql')).Path
  $concurrencyB = (Resolve-Path (Join-Path $repoRoot 'supabase/tests/collection_remittances_core_0z1b/32_concurrency_b.sql')).Path
  $jobA = Start-Job -ScriptBlock {
    param($name,$path)
    $text = Get-Content -Raw -LiteralPath $path |
      docker exec -e PGOPTIONS=--client-min-messages=warning -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres 2>&1
    [pscustomobject]@{ ExitCode=$LASTEXITCODE; Text=($text -join [Environment]::NewLine) }
  } -ArgumentList $containerName,$concurrencyA

  # The winner holds the target row lock for five seconds. Two seconds gives
  # the background PowerShell job enough time to start while retaining a
  # deterministic overlap window for the losing session.
  Start-Sleep -Seconds 2

  $jobB = Start-Job -ScriptBlock {
    param($name,$path)
    $text = Get-Content -Raw -LiteralPath $path |
      docker exec -e PGOPTIONS=--client-min-messages=warning -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres 2>&1
    [pscustomobject]@{ ExitCode=$LASTEXITCODE; Text=($text -join [Environment]::NewLine) }
  } -ArgumentList $containerName,$concurrencyB

  $null = Wait-Job -Job $jobA,$jobB -Timeout 30
  $resultA = Receive-Job -Job $jobA
  $resultB = Receive-Job -Job $jobB
  Remove-Job -Job $jobA,$jobB -Force
  if ($resultA.ExitCode -ne 0) { throw "Concurrency winner failed`n$($resultA.Text)" }
  if ($resultB.ExitCode -eq 0 -or $resultB.Text -notlike '*COLLECTION_CREDIT_LINE_OVERRESERVED*') {
    throw "Concurrency loser did not fail closed as expected`n$($resultB.Text)"
  }
  Write-Output 'CONCURRENT_OVERRESERVATION_BLOCKED'

  Invoke-ReplaySqlFile 'supabase/tests/collection_remittances_core_0z1b/33_concurrency_assert.sql'
  Invoke-ReplaySqlFile 'supabase/tests/collection_remittances_core_0z1b/40_post_and_negative.sql'

  $summary = docker exec $containerName psql -At -U postgres -d postgres -c @"
select concat_ws('|',
  'tables='||(select count(*) from information_schema.tables where table_schema='public' and table_name like 'collection_%'),
  'events='||(select count(*) from public.collection_events),
  'allocations='||(select count(*) from public.collection_bank_line_allocations),
  'cutovers='||(select count(*) from public.collection_events where event_type='SYSTEM_OF_RECORD_CUTOVER'));
"@
  Write-Output "REPLAY_SUMMARY=$summary"
  Write-Output 'ALL_COLLECTION_REMITTANCES_CORE_0Z1B_PG17_PASS'
}
finally {
  $exact = docker ps -a --filter "name=^/$containerName$" --format '{{.Names}}'
  if ($exact -eq $containerName) {
    docker rm -f $containerName | Out-Null
  }
  $remaining = docker ps -a --filter "name=^/$containerName$" --format '{{.Names}}'
  if ($remaining) { throw "Disposable container teardown failed: $containerName" }
  Write-Output 'DISPOSABLE_CONTAINER_REMOVED'
}
