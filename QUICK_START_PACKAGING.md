# Quick Start: Creating a VSIX Package

## TL;DR - Just Give Me the Commands

```bash
# 1. Install dependencies (first time only, ~60 seconds)
yarn install

# 2. Build the extension (~19 seconds)
yarn build

# 3. Create the VSIX package (~4.5 seconds)
yarn package --online

# Result: mssql-1.37.0.vsix file created
```

## What You Get

-   **File**: `mssql-1.37.0.vsix` (approximately 12-15 MB)
-   **Distribution**: Share this file with users
-   **Installation**: Users can install via VS Code Extensions view → "Install from VSIX..."

## Prerequisites

Before running the commands above, ensure you have:

1. **Node.js** v20+ installed (`node --version`)
2. **Yarn** v1.22+ installed (`yarn --version`)
3. **VSCE** installed globally: `npm install -g @vscode/vsce`

## Installation Instructions for Users

Once you have the VSIX file, users can install it in two ways:

### Method 1: VS Code UI

1. Open VS Code
2. Go to Extensions (`Ctrl+Shift+X`)
3. Click `...` menu → **Install from VSIX...**
4. Select the `mssql-1.37.0.vsix` file
5. Reload VS Code

### Method 2: Command Line

```bash
code --install-extension mssql-1.37.0.vsix
```

## Troubleshooting

### "vsce: command not found"

```bash
npm install -g @vscode/vsce
```

### Build fails

```bash
# Clean and rebuild
rm -rf node_modules dist out
yarn install
yarn build
```

### Package too large

Ensure you're using `--online` flag:

```bash
yarn package --online
```

## Advanced: Offline Packaging

For users without internet access, create platform-specific packages:

```bash
yarn package --offline
```

This creates separate VSIX files for each platform (~140-160 MB each):

-   `mssql-1.37.0-win-x64.vsix` (Windows 64-bit)
-   `mssql-1.37.0-osx-arm64.vsix` (macOS Apple Silicon)
-   And more...

**Note**: Offline packaging takes 10-30 minutes.

## Full Documentation

For detailed instructions, see:

-   [Creating VSIX Package Guide](docs/CREATING_VSIX_PACKAGE.md)
-   [Local Cache and Git Integration User Guide](docs/LOCAL_CACHE_AND_GIT_INTEGRATION_USER_GUIDE.md)

## Summary

| Command                 | Purpose              | Time              |
| ----------------------- | -------------------- | ----------------- |
| `yarn install`          | Install dependencies | ~60s (first time) |
| `yarn build`            | Build extension      | ~19s              |
| `yarn package --online` | Create VSIX          | ~4.5s             |

**Total time**: ~90 seconds (first time), ~25 seconds (subsequent builds)
