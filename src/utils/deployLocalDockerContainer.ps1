param (
    [string]$containerName,
    [string]$password,
    [string]$version
)

try {
    # Check if Docker is running
    $isDockerRunning = docker info *>&1
    if (-not $?) {
        Write-Host "Docker is not running. Attempting to start it..."

        $dockerPath = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
        if (Test-Path $dockerPath) {
            Start-Process -FilePath $dockerPath -PassThru | Out-Null
            Write-Host "Starting Docker Desktop..."

            # Wait for Docker to initialize
            $maxWait = 60
            $elapsed = 0
            do {
                Start-Sleep -Seconds 5
                $elapsed += 5
                $isDockerRunning = docker info *>&1
            } while (-not $? -and $elapsed -lt $maxWait)

            if (-not $?) {
                throw "Docker did not start within $maxWait seconds. Please start it manually."
            }
        } else {
            throw "Could not start Docker. Please manually start it."
        }
    }

    # Ensure Docker is now running
    if (-not $?) {
        throw "Docker is still not running. Please start it manually and try again."
    }

    # Find an available port starting from 1433
    $port = 1433
    while ((Test-NetConnection -Port $port -ComputerName localhost).TcpTestSucceeded) {
        $port++
    }

    # Run the container
    $containerId = docker run -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=$password" `
        -p "$port`:1433" --name $containerName `
        -d "mcr.microsoft.com/mssql/server:$version-latest" 2>&1

    if (-not $?) {
        throw "Failed to start container: $containerId"
    }

    Write-Output "Container '$containerName' is running on port: $port"
}
catch {
    Write-Output "Error: $($_.Exception.Message)"
    exit 1
}
