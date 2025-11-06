# Rename dacFxApplication to dacpacDialog
# This script will be used to systematically rename all occurrences

$ErrorActionPreference = "Stop"

# Define file paths relative to vscode-mssql root
$rootPath = "c:\vscode-mssql"

# Step 1: Rename files
Write-Host "Step 1: Renaming files..." -ForegroundColor Cyan

$fileRenames = @(
    @{Old = "src\sharedInterfaces\dacFxApplication.ts"; New = "src\sharedInterfaces\dacpacDialog.ts"},
    @{Old = "src\controllers\dacFxApplicationWebviewController.ts"; New = "src\controllers\dacpacDialogWebviewController.ts"},
    @{Old = "src\reactviews\pages\DacFxApplication\dacFxApplicationForm.tsx"; New = "src\reactviews\pages\DacpacDialog\dacpacDialogForm.tsx"},
    @{Old = "src\reactviews\pages\DacFxApplication\dacFxApplicationPage.tsx"; New = "src\reactviews\pages\DacpacDialog\dacpacDialogPage.tsx"},
    @{Old = "src\reactviews\pages\DacFxApplication\dacFxApplicationStateProvider.tsx"; New = "src\reactviews\pages\DacpacDialog\dacpacDialogStateProvider.tsx"},
    @{Old = "src\reactviews\pages\DacFxApplication\dacFxApplicationSelector.ts"; New = "src\reactviews\pages\DacpacDialog\dacpacDialogSelector.ts"},
    @{Old = "src\reactviews\pages\DacFxApplication\dacFxApplication.css"; New = "src\reactviews\pages\DacpacDialog\dacpacDialog.css"},
    @{Old = "test\unit\dacFxApplicationWebviewController.test.ts"; New = "test\unit\dacpacDialogWebviewController.test.ts"}
)

# Also need to rename the directory
Write-Host "Renaming directory DacFxApplication to DacpacDialog..."

Write-Host "`nTotal files to rename: $($fileRenames.Count + 1)"
Write-Host "This script is ready. Should I proceed with the renames?"
