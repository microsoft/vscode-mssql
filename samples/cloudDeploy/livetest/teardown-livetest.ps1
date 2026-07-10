# ---------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See License.txt in the project root for license information.
# ---------------------------------------------------------------------------------------------

<#
.SYNOPSIS
    Tears down the Cloud Deploy live-test SQL Server container.

.DESCRIPTION
    Force-removes the 'cloud-deploy-livetest' container created by
    setup-livetest.ps1 (along with its SlackSourceDb and any leftover
    CloudDeployValidation_* throwaway databases, since they live inside the
    container). Safe to run even if the container is already gone.

.EXAMPLE
    ./teardown-livetest.ps1
#>

[CmdletBinding()]
param(
    [string]$ContainerName = "cloud-deploy-livetest"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command "docker" -ErrorAction SilentlyContinue)) {
    throw "Docker is not on PATH."
}

$existing = docker ps -a --filter "name=^/$ContainerName$" --format "{{.Names}}"
if ($existing -eq $ContainerName) {
    docker rm -f $ContainerName *> $null
    Write-Host "Removed container '$ContainerName'." -ForegroundColor Green
} else {
    Write-Host "No container named '$ContainerName' found; nothing to do." -ForegroundColor DarkGray
}
