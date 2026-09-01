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
  Write-Output 'ALL_COLLECTION_REPORT_CONTROLLED_ACTIVATION_PG17_PASS'
}
finally {
  $exact = docker ps -a --filter "name=^/$container$" --format '{{.Names}}'
  if ($exact -eq $container) { docker rm -f $container | Out-Null }
  $remaining = docker ps -a --filter "name=^/$container$" --format '{{.Names}}'
  if ($remaining) { throw "Disposable container teardown failed: $container" }
  Write-Output 'DISPOSABLE_CONTAINER_REMOVED'
}
