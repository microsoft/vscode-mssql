# perftest machine setup (design §28, Phase-3 12.9). Conservative: validates
# everything, installs only well-scoped dotnet global tools (and only with
# -Install), prints exact remediation otherwise, never changes global security
# settings. Writes setup-report.json and finishes with `perftest doctor`.
#
# Usage (from the perftest repo root):
#   pwsh scripts/setup-windows.ps1            # validate only
#   pwsh scripts/setup-windows.ps1 -Install   # also install missing dotnet tools

param(
    [switch]$Install
)

$ErrorActionPreference = "Continue"
$root = Split-Path $PSScriptRoot -Parent
$checks = @()

function Add-Check([string]$name, [string]$status, [string]$message, [string]$remediation = "") {
    $script:checks += [pscustomobject]@{ name = $name; status = $status; message = $message; remediation = $remediation }
    $icon = switch ($status) { "passed" { "PASS" } "warning" { "WARN" } default { "FAIL" } }
    Write-Host ("  [{0}] {1,-22} {2}" -f $icon, $name, $message)
    if ($remediation -and $status -ne "passed") { Write-Host ("         -> {0}" -f $remediation) }
}

function Test-Tool([string]$name, [string]$versionArgs, [string]$remediation) {
    try {
        $v = (& $name $versionArgs.Split(" ") 2>&1 | Select-Object -First 1)
        Add-Check $name "passed" "$v"
        return $true
    } catch {
        Add-Check $name "warning" "not found" $remediation
        return $false
    }
}

Write-Host "perftest setup — validating machine"
Write-Host ""

# Core toolchain
$node = Test-Tool "node" "--version" "install Node.js LTS >= 22 from nodejs.org"
if ($node) {
    $major = [int]((node --version) -replace "v", "" -split "\.")[0]
    if ($major -lt 22) { Add-Check "nodeVersion" "failed" "Node $major < 22" "upgrade to Node LTS >= 22" }
}
Test-Tool "npm" "--version" "ships with Node.js" | Out-Null
Test-Tool "dotnet" "--version" "install .NET SDK matching sqltoolsservice (10.x) from dot.net" | Out-Null
Test-Tool "docker" "--version" "install Docker Desktop for the dockerCompose SQL provider (external provider works without it)" | Out-Null
Test-Tool "sqlcmd" "-?" "install SQL Server command-line utilities (needed by the external provider + XEvents)" | Out-Null
Test-Tool "git" "--version" "install Git" | Out-Null

# .NET diagnostic global tools
foreach ($tool in @("dotnet-trace", "dotnet-counters", "dotnet-gcdump")) {
    $ok = Test-Tool $tool "--version" "dotnet tool install -g $tool"
    if (-not $ok -and $Install) {
        Write-Host "         installing $tool..."
        dotnet tool install -g $tool | Out-Null
        Test-Tool $tool "--version" "install failed - run: dotnet tool install -g $tool" | Out-Null
    }
}

# WPR (optional; diagnostic-only collector degrades without it)
try {
    wpr -status 2>&1 | Out-Null
    Add-Check "wpr" "passed" "Windows Performance Recorder available (elevation/policy checked at run time)"
} catch {
    Add-Check "wpr" "warning" "wpr unavailable" "install Windows Performance Toolkit (Windows ADK) for ETW diagnostics"
}

# Power profile (measurement-quality warning only; never changed silently)
try {
    $plan = (powercfg /getactivescheme) 2>&1
    if ("$plan" -match "High performance|Ultimate") {
        Add-Check "powerProfile" "passed" "$plan"
    } else {
        Add-Check "powerProfile" "warning" "$plan" "consider: powercfg /setactive SCHEME_MIN (High performance) for stable measurements"
    }
} catch {
    Add-Check "powerProfile" "warning" "could not read power scheme"
}

# AC power
try {
    $battery = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue
    if (-not $battery -or $battery.BatteryStatus -eq 2) {
        Add-Check "acPower" "passed" "on AC power / no battery"
    } else {
        Add-Check "acPower" "warning" "on battery" "plug in before measurement runs"
    }
} catch { Add-Check "acPower" "warning" "could not read battery state" }

# Directories
foreach ($dir in @("perf-runs", ".vscode-test")) {
    $p = Join-Path $root $dir
    if (-not (Test-Path $p)) { New-Item -ItemType Directory -Force $p | Out-Null }
}
Add-Check "directories" "passed" "perf-runs + .vscode-test present"

# Harness build present?
if (Test-Path (Join-Path $root "packages\perftest-cli\dist\cli.js")) {
    Add-Check "harnessBuilt" "passed" "packages/perftest-cli/dist/cli.js"
} else {
    Add-Check "harnessBuilt" "warning" "harness not built" "npm install && npm run build"
}

$failed = @($checks | Where-Object status -eq "failed").Count
$status = if ($failed -gt 0) { "failed" } elseif (@($checks | Where-Object status -eq "warning").Count -gt 0) { "warning" } else { "passed" }
$report = [pscustomobject]@{
    status = $status
    machineId = $env:COMPUTERNAME
    generatedAt = (Get-Date).ToString("o")
    checks = $checks
}
$reportPath = Join-Path $root "setup-report.json"
$report | ConvertTo-Json -Depth 4 | Set-Content $reportPath
Write-Host ""
Write-Host "Overall: $($status.ToUpper())  (report: $reportPath)"

# Finish with the harness's own preflight when available.
if (Test-Path (Join-Path $root "packages\perftest-cli\dist\cli.js")) {
    Write-Host ""
    node (Join-Path $root "packages\perftest-cli\dist\cli.js") doctor
}
exit $(if ($failed -gt 0) { 1 } else { 0 })
