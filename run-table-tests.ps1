# PowerShell script to run table migration tests
# This script works around the path-with-spaces issue in the test runner

Write-Host "Running Table Migration Tests" -ForegroundColor Cyan
Write-Host ("=" * 60)

# Set environment variable for test pattern
$env:TEST_PATTERN = "Table"
$env:MOCHA_GREP = "Table"

Write-Host "Test Pattern: Table" -ForegroundColor Yellow
Write-Host ""

# Run the tests
Write-Host "Starting test runner..." -ForegroundColor Green
yarn test

# Clean up environment variables
Remove-Item Env:\TEST_PATTERN -ErrorAction SilentlyContinue
Remove-Item Env:\MOCHA_GREP -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Test run complete!" -ForegroundColor Green

