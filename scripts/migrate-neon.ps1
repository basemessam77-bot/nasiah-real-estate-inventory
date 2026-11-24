$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$secureUrl = Read-Host "Neon pooled PostgreSQL connection string" -AsSecureString
$plainUrl = [System.Net.NetworkCredential]::new("", $secureUrl).Password

try {
    Set-Location $projectRoot
    $env:DATABASE_URL = $plainUrl
    npm run migrate:neon
    if ($LASTEXITCODE -ne 0) {
        throw "Neon migration failed with exit code $LASTEXITCODE."
    }
}
finally {
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    $plainUrl = $null
    $secureUrl.Dispose()
    Set-Location $projectRoot
}
