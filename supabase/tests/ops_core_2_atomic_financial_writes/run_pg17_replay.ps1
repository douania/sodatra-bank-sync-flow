param()

$ErrorActionPreference = 'Stop'
$containerName = 'bsflow-ops-core-2-pg17-replay'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker is required for the disposable PostgreSQL 17 replay.'
}

function Invoke-SqlFile {
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
if ($existing) { throw "Disposable container already exists: $containerName" }

try {
  docker run --name $containerName -e POSTGRES_HOST_AUTH_METHOD=trust -d postgres:17-alpine | Out-Null
  for ($i=0; $i -lt 40; $i++) {
    docker exec $containerName pg_isready -U postgres *> $null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Milliseconds 250
  }
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL 17 did not become ready' }

  Invoke-SqlFile 'supabase/tests/ops_core_2_atomic_financial_writes/00_schema.sql'
  Invoke-SqlFile 'supabase/migrations/20260811000000_ops_core_2_atomic_financial_writes.sql'
  Invoke-SqlFile 'supabase/tests/ops_core_2_atomic_financial_writes/10_atomic_security.sql'
  Write-Output 'ALL_OPS_CORE_2_PG17_PASS'
}
finally {
  $exact = docker ps -a --filter "name=^/$containerName$" --format '{{.Names}}'
  if ($exact -eq $containerName) { docker rm -f $containerName | Out-Null }
  $remaining = docker ps -a --filter "name=^/$containerName$" --format '{{.Names}}'
  if ($remaining) { throw "Disposable container teardown failed: $containerName" }
  Write-Output 'DISPOSABLE_CONTAINER_REMOVED'
}
