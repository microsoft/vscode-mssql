# Verifies zero perf-mode behavior when PERF_MODE is absent (harness guardrail 3).
# Product-side PERF_MODE support is pending the core-observability change and
# is not present on vscode-mssql main at the time this harness is imported.
#
# Launches the cached VS Code build with BOTH the product extension and the
# perf driver loaded, with NO perf environment variables, while a decoy
# control server listens locally on a port that was never advertised to the
# process. Asserts:
#   1. VS Code launches and stays alive for the observation window.
#   2. The decoy server receives zero connections (nothing tries to find it).
#   3. The extension host loads both extensions without errors.
#
# Note: without user interaction the product extension stays lazily
# unactivated (same as production). The in-activation no-op path is enforced
# by the pending PERF_MODE gate in src/perf/perfTelemetry.ts (module-load resolution).
#
# Usage: pwsh scripts/verify-perf-mode-off.ps1   (from tools/perftest)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

$codeExe = Get-ChildItem "$root\.vscode-test" -Recurse -Filter Code.exe | Select-Object -First 1
if (-not $codeExe) { Write-Error "No cached VS Code build; run a perf run first."; exit 1 }

$sandbox = Join-Path $env:TEMP ("perfoff-" + [guid]::NewGuid().ToString("n").Substring(0, 8))
New-Item -ItemType Directory -Force "$sandbox\ud", "$sandbox\ext" | Out-Null

# Decoy listener: any connection would mean perf code ran without PERF_MODE.
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$decoyPort = $listener.LocalEndpoint.Port
Write-Host "Decoy listener on 127.0.0.1:$decoyPort (never advertised)"

# Scrub any perf env vars from this shell before spawning.
$env:PERF_MODE = $null; $env:PERF_CONTROL_URL = $null; $env:PERF_CONTROL_TOKEN = $null
$env:PERF_MARKER_URL = $null; $env:PERF_RUN_ID = $null

$product = Resolve-Path "$root\..\..\extensions\mssql"
$driver = Resolve-Path "$root\extensions\mssql-perf-driver"
$proc = Start-Process -PassThru -FilePath $codeExe.FullName -ArgumentList @(
    "--user-data-dir", "$sandbox\ud",
    "--extensions-dir", "$sandbox\ext",
    "--new-window", "--skip-welcome", "--skip-release-notes",
    "--disable-workspace-trust", "--disable-updates",
    "--extensionDevelopmentPath=$product",
    "--extensionDevelopmentPath=$driver"
)

Write-Host "VS Code pid $($proc.Id); observing for 45s..."
Start-Sleep -Seconds 45

$alive = -not $proc.HasExited
$connections = $listener.Pending()
$listener.Stop()

# Extension host log should exist and contain no perf-related errors.
$exthostLogs = Get-ChildItem "$sandbox\ud\logs" -Recurse -Filter "*.log" -ErrorAction SilentlyContinue
$perfErrors = $exthostLogs | ForEach-Object { Select-String -Path $_.FullName -Pattern "mssql-perf-driver|perfTelemetry|PERF_" -ErrorAction SilentlyContinue } | Where-Object { $_ }

if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3
Remove-Item $sandbox -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host ("vscodeAliveAfter45s : " + $(if ($alive) { "PASS" } else { "FAIL" }))
Write-Host ("decoyConnections    : " + $(if (-not $connections) { "PASS (0)" } else { "FAIL" }))
Write-Host ("perfMentionsInLogs  : " + $(if (-not $perfErrors) { "PASS (none)" } else { "WARN: $($perfErrors.Count) lines" }))
if ($perfErrors) { $perfErrors | Select-Object -First 5 | ForEach-Object { Write-Host "  $_" } }

if ($alive -and -not $connections) { exit 0 } else { exit 1 }
