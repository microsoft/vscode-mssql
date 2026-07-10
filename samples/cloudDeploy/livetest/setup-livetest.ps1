# ---------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See License.txt in the project root for license information.
# ---------------------------------------------------------------------------------------------

<#
.SYNOPSIS
    Stands up a local SQL Server container for live-testing the Cloud Deploy
    "connection runtime host" and "live-database source of truth" paths, and
    deploys the slack-demo schema into a persistent database that the live-DB
    source cases extract from.

.DESCRIPTION
    Creates a throwaway SQL Server 2022 container named 'cloud-deploy-livetest'
    on a host port (default 14333, chosen to avoid colliding with the Docker
    ephemeral host's 11433 or a local 1433), waits for it to accept
    connections, then publishes the pre-built slack dacpac into a database
    named 'SlackSourceDb'. That database is the *live database* the
    live-DB-source environments point at via a saved connection profile.

    This server doubles as the "connection runtime host" target: the connection
    runtime host creates and drops its own throwaway 'CloudDeployValidation_*'
    databases on it, never touching SlackSourceDb.

    Prerequisites: Docker Desktop running, and 'sqlpackage' on PATH.

.PARAMETER Password
    SA password for the test container. Local throwaway only — not a secret.

.PARAMETER Port
    Host port mapped to the container's 1433.

.EXAMPLE
    ./setup-livetest.ps1
#>

[CmdletBinding()]
param(
    [string]$ContainerName = "cloud-deploy-livetest",
    [int]$Port = 14333,
    [string]$Password = "CloudDeploy!LiveTest123",
    [string]$SourceDatabase = "SlackSourceDb",
    [string]$Image = "mcr.microsoft.com/mssql/server:2022-latest"
)

$ErrorActionPreference = "Stop"

function Test-CommandExists {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

Write-Host "=== Cloud Deploy live-test setup ===" -ForegroundColor Cyan

# --- Prerequisite checks -----------------------------------------------------
if (-not (Test-CommandExists "docker")) {
    throw "Docker is not on PATH. Install/start Docker Desktop and retry."
}
docker info *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Docker is installed but not running. Start Docker Desktop and retry."
}
if (-not (Test-CommandExists "sqlpackage")) {
    throw "sqlpackage is not on PATH. Install with: dotnet tool install -g Microsoft.SqlPackage"
}

$dacpac = Join-Path $PSScriptRoot "..\slack-demo\dacpac\SlackBeforeProject.dacpac"
$dacpac = [System.IO.Path]::GetFullPath($dacpac)
if (-not (Test-Path $dacpac)) {
    throw "Slack dacpac not found at $dacpac. Build it first (dotnet build the sqlproj-before project) or check the path."
}

# --- (Re)create the container ------------------------------------------------
$existing = docker ps -a --filter "name=^/$ContainerName$" --format "{{.Names}}"
if ($existing -eq $ContainerName) {
    Write-Host "Removing existing container '$ContainerName'..." -ForegroundColor Yellow
    docker rm -f $ContainerName *> $null
}

Write-Host "Starting SQL Server container '$ContainerName' on port $Port..." -ForegroundColor Cyan
docker run -d `
    --name $ContainerName `
    -e "ACCEPT_EULA=Y" `
    -e "MSSQL_SA_PASSWORD=$Password" `
    -p "$($Port):1433" `
    $Image *> $null
if ($LASTEXITCODE -ne 0) {
    throw "docker run failed. Is port $Port already in use? Pick another with -Port."
}

# --- Wait for readiness ------------------------------------------------------
$inContainerSqlcmd = "/opt/mssql-tools18/bin/sqlcmd"
Write-Host "Waiting for SQL Server to accept connections..." -NoNewline
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    # The probe is expected to fail (and write to stderr) while SQL Server is
    # still initializing the SA login. Swallow that so the retry loop is not
    # aborted by $ErrorActionPreference = "Stop".
    $probeOk = $false
    try {
        $null = docker exec $ContainerName $inContainerSqlcmd -S localhost -U sa -P $Password -C -Q "SELECT 1" 2>&1
        $probeOk = ($LASTEXITCODE -eq 0)
    } catch {
        $probeOk = $false
    }
    if ($probeOk) { $ready = $true; break }
    Start-Sleep -Seconds 2
    Write-Host "." -NoNewline
}
Write-Host ""
if (-not $ready) {
    throw "SQL Server did not become ready in time. Check 'docker logs $ContainerName'."
}
Write-Host "SQL Server is ready." -ForegroundColor Green

# --- Publish the slack schema into the persistent source database ------------
Write-Host "Publishing slack schema into database '$SourceDatabase'..." -ForegroundColor Cyan
sqlpackage /Action:Publish `
    /SourceFile:"$dacpac" `
    /TargetServerName:"localhost,$Port" `
    /TargetDatabaseName:"$SourceDatabase" `
    /TargetUser:"sa" `
    /TargetPassword:"$Password" `
    /TargetTrustServerCertificate:True
if ($LASTEXITCODE -ne 0) {
    throw "sqlpackage publish failed."
}

# --- Done: print next steps --------------------------------------------------
Write-Host ""
Write-Host "=== Live-test server is ready ===" -ForegroundColor Green
Write-Host ""
Write-Host "Server:    localhost,$Port" -ForegroundColor White
Write-Host "User:      sa" -ForegroundColor White
Write-Host "Password:  $Password" -ForegroundColor White
Write-Host "Source DB: $SourceDatabase  (the live-database source of truth)" -ForegroundColor White
Write-Host ""
Write-Host "Next, in VS Code (MSSQL: Add Connection), create TWO saved profiles" -ForegroundColor Cyan
Write-Host "pointing at this server, and set each profile's name exactly to:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1. Profile name: livetest-server   ->  Server localhost,$Port  Database <leave default/master>" -ForegroundColor White
Write-Host "     (the connection RUNTIME HOST: throwaway CloudDeployValidation_* DBs are created/dropped here)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  2. Profile name: livetest-source   ->  Server localhost,$Port  Database $SourceDatabase" -ForegroundColor White
Write-Host "     (the live-DATABASE SOURCE: its schema is extracted read-only)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Use SQL Login auth with the sa credentials above, and trust the server certificate." -ForegroundColor Cyan
Write-Host "Then F5 the extension, open Cloud Deploy, and run the livetest-* environments." -ForegroundColor Cyan
Write-Host ""
Write-Host "When finished:  ./teardown-livetest.ps1" -ForegroundColor DarkGray
