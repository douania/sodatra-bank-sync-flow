param(
  [string]$Image = 'postgres:17-alpine'
)

$ErrorActionPreference = 'Stop'
$container = 'sodatra-ops-core-4-' + [guid]::NewGuid().ToString('N').Substring(0, 12)
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path

function Invoke-SqlFile([string]$relativePath) {
  $absolutePath = Join-Path $root $relativePath
  Get-Content -Raw -Encoding UTF8 -LiteralPath $absolutePath |
    docker exec -i $container psql -v ON_ERROR_STOP=1 -U postgres -d postgres
  if ($LASTEXITCODE -ne 0) {
    throw "SQL replay failed: $relativePath"
  }
}

try {
  docker run --name $container -e POSTGRES_PASSWORD=postgres -d $Image | Out-Null
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    docker exec $container pg_isready -U postgres -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Milliseconds 500
  }
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL 17 did not become ready' }

  Invoke-SqlFile 'supabase/tests/ops_core_2_atomic_financial_writes/00_schema.sql'
  Invoke-SqlFile 'supabase/tests/ops_core_4_financial_write_path_lockdown/05_current_access.sql'
  Invoke-SqlFile 'supabase/migrations/20260811000000_ops_core_2_atomic_financial_writes.sql'
  Invoke-SqlFile 'supabase/migrations/20260813000000_ops_core_4_financial_write_path_lockdown.sql'
  Invoke-SqlFile 'supabase/migrations/20260813000000_ops_core_4_financial_write_path_lockdown.sql'
  Invoke-SqlFile 'supabase/tests/ops_core_4_financial_write_path_lockdown/10_lockdown.sql'

  Write-Host 'OPS-CORE-4 PostgreSQL 17 replay: PASS'
}
finally {
  docker rm -f $container *> $null
}
