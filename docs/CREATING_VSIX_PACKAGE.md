# Creating a VSIX Package for Distribution

This guide explains how to create a VSIX package that users can install in Visual Studio Code.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Prerequisites](#prerequisites)
3. [Packaging Options](#packaging-options)
4. [Step-by-Step Instructions](#step-by-step-instructions)
5. [Distribution](#distribution)
6. [Troubleshooting](#troubleshooting)

---

## Quick Start

**For most users (online distribution):**

```bash
# 1. Install dependencies
yarn install

# 2. Build the extension
yarn build

# 3. Package the extension
yarn package --online
```

This creates a VSIX file (e.g., `mssql-1.37.0.vsix`) that users can install.

---

## Prerequisites

### Required Software

1. **Node.js** v20.19.4 or higher

    - Check: `node --version`
    - Download: https://nodejs.org/

2. **Yarn** v1.22 or higher

    - Check: `yarn --version`
    - Install: `npm install -g yarn`

3. **VSCE** (Visual Studio Code Extension Manager)
    - Install globally: `npm install -g @vscode/vsce`
    - Check: `vsce --version`

### Build Requirements

4. **All dependencies installed**:

    ```bash
    yarn install
    ```

5. **Extension built successfully**:
    ```bash
    yarn build
    ```

---

## Packaging Options

The extension supports two packaging modes:

### 1. Online Mode (Recommended)

**What it does:**

-   Creates a single, lightweight VSIX file (~12-15 MB)
-   SQL Tools Service is downloaded automatically when users install the extension
-   Works for all platforms (Windows, macOS, Linux)

**When to use:**

-   Distributing to users with internet access
-   Publishing to VS Code Marketplace
-   Sharing with team members
-   General distribution

**Command:**

```bash
yarn package --online
```

**Output:**

-   `mssql-1.37.0.vsix` (single file)

---

### 2. Offline Mode (Advanced)

**What it does:**

-   Creates platform-specific VSIX files with embedded SQL Tools Service
-   Each package is larger (~100-200 MB per platform)
-   Users can install without internet connection
-   Separate package for each OS/architecture

**When to use:**

-   Air-gapped environments (no internet access)
-   Corporate networks with restricted internet
-   Offline installations
-   Specific platform deployments

**Command:**

```bash
yarn package --offline
```

**Output:**

-   `mssql-1.37.0-win-x64.vsix` (Windows 64-bit)
-   `mssql-1.37.0-win-x86.vsix` (Windows 32-bit)
-   `mssql-1.37.0-win-arm64.vsix` (Windows ARM64)
-   `mssql-1.37.0-osx.10.11-x64.vsix` (macOS Intel)
-   `mssql-1.37.0-osx-arm64.vsix` (macOS Apple Silicon)
-   `mssql-1.37.0-centos.7-x64.vsix` (CentOS/RHEL)
-   `mssql-1.37.0-debian.8-x64.vsix` (Debian)
-   `mssql-1.37.0-ubuntu.14.04-x64.vsix` (Ubuntu 14.04)
-   `mssql-1.37.0-ubuntu.16.04-x64.vsix` (Ubuntu 16.04)
-   `mssql-1.37.0-linux-arm64.vsix` (Linux ARM64)
-   And more...

**Note:** Offline packaging takes significantly longer (10-30 minutes) as it downloads and packages the service for each platform.

---

## Step-by-Step Instructions

### Option A: Online Packaging (Recommended)

#### Step 1: Prepare the Environment

```bash
# Navigate to the extension directory
cd vscode-mssql-git-integration

# Ensure you're on the correct branch
git status

# Pull latest changes (if working from a repository)
git pull
```

#### Step 2: Install Dependencies

```bash
# Install all required packages
yarn install
```

**Expected output:**

```
✔ Installed dependencies
Done in ~60s (first time) or ~11s (subsequent)
```

#### Step 3: Build the Extension

```bash
# Run the full build process
yarn build
```

**Expected output:**

```
✔ Preparing assets...
✔ Compiling extension...
✔ Bundling extension...
✔ Compiling webviews...
✔ Bundling webviews...
Done in ~19s
```

**Important:** Ensure the build completes without errors. If you see errors, fix them before proceeding.

#### Step 4: Lint the Code (Optional but Recommended)

```bash
# Check code quality
yarn lint src/ test/
```

**Expected output:**

```
✔ No linting errors
```

#### Step 5: Package the Extension

```bash
# Create the VSIX package
yarn package --online
```

**Expected output:**

```
Package extension (Online Mode)
Creating extension package for online distribution

✔ Cleaning service install folder...
✔ Packaging extension with vsce...

DONE  Packaged: mssql-1.37.0.vsix (12.5 MB)
✔ Online packaging completed successfully!
```

#### Step 6: Verify the Package

```bash
# Check the file was created
ls -lh mssql-*.vsix
```

**Expected output:**

```
-rw-r--r-- 1 user user 12.5M Jan 15 10:30 mssql-1.37.0.vsix
```

**Verification checklist:**

-   ✅ File exists
-   ✅ File size is reasonable (10-20 MB for online mode)
-   ✅ Filename includes correct version number

---

### Option B: Offline Packaging (Advanced)

#### Steps 1-4: Same as Online Packaging

Follow steps 1-4 from Option A above.

#### Step 5: Package for All Platforms

```bash
# Create offline packages for all platforms
yarn package --offline
```

**Expected output:**

```
Package extension (Offline Mode)
Creating offline packages for: mssql v1.37.0
Total platforms: 13

[1/13] Processing win-x64...
✔ Installing SQL Tools Service...
✔ Packaging for win-x64...
✔ win-x64 package created

[2/13] Processing win-x86...
✔ Installing SQL Tools Service...
✔ Packaging for win-x86...
✔ win-x86 package created

... (continues for all platforms)

✔ Offline packaging completed for all platforms!
```

**Note:** This process takes 10-30 minutes depending on your internet speed and system performance.

#### Step 6: Verify All Packages

```bash
# List all created packages
ls -lh mssql-*.vsix
```

**Expected output:**

```
-rw-r--r-- 1 user user 145M Jan 15 10:45 mssql-1.37.0-win-x64.vsix
-rw-r--r-- 1 user user 142M Jan 15 10:47 mssql-1.37.0-win-x86.vsix
-rw-r--r-- 1 user user 148M Jan 15 10:49 mssql-1.37.0-win-arm64.vsix
-rw-r--r-- 1 user user 151M Jan 15 10:51 mssql-1.37.0-osx.10.11-x64.vsix
-rw-r--r-- 1 user user 149M Jan 15 10:53 mssql-1.37.0-osx-arm64.vsix
... (and more)
```

---

## Distribution

### Installing the VSIX Locally (Testing)

Before distributing, test the package locally:

#### Method 1: VS Code UI

1. Open Visual Studio Code
2. Go to Extensions view (`Ctrl+Shift+X` or `Cmd+Shift+X`)
3. Click the `...` (More Actions) menu at the top
4. Select **Install from VSIX...**
5. Browse to your VSIX file and select it
6. Click **Install**
7. Reload VS Code when prompted

#### Method 2: Command Line

```bash
# Install the VSIX
code --install-extension mssql-1.37.0.vsix

# Verify installation
code --list-extensions | grep mssql
```

**Expected output:**

```
ms-mssql.mssql
```

### Distributing to Users

#### Option 1: Direct File Sharing

**For online packages:**

1. Share the single VSIX file (e.g., `mssql-1.37.0.vsix`)
2. Users install via VS Code UI or command line (see above)

**For offline packages:**

1. Share the platform-specific VSIX file
2. Users must choose the correct file for their OS/architecture:
    - Windows 64-bit: `mssql-1.37.0-win-x64.vsix`
    - macOS Intel: `mssql-1.37.0-osx.10.11-x64.vsix`
    - macOS Apple Silicon: `mssql-1.37.0-osx-arm64.vsix`
    - Linux: Choose appropriate distribution package

#### Option 2: GitHub Releases

1. Create a new release on GitHub
2. Upload the VSIX file(s) as release assets
3. Share the release URL with users

**Example:**

```bash
# Create a new tag
git tag -a v1.37.0 -m "Release version 1.37.0"
git push origin v1.37.0

# Then create a release on GitHub and upload the VSIX files
```

#### Option 3: Internal Package Repository

For enterprise environments:

1. Upload VSIX to internal file server or artifact repository
2. Provide download link to users
3. Users install from downloaded file

#### Option 4: VS Code Marketplace (Official Publishing)

**Note:** This requires a publisher account and is typically for official releases.

```bash
# Login to VS Code Marketplace
vsce login <publisher-name>

# Publish the extension
vsce publish
```

**For this fork:** You'll need to change the publisher name in `package.json` first:

```json
{
    "publisher": "your-publisher-name"
}
```

---

## Troubleshooting

### Issue 1: `vsce: command not found`

**Solution:**

```bash
# Install vsce globally
npm install -g @vscode/vsce

# Verify installation
vsce --version
```

### Issue 2: Build Errors Before Packaging

**Solution:**

```bash
# Clean and rebuild
rm -rf node_modules dist out
yarn install
yarn build
```

### Issue 3: Package Size Too Large (Online Mode)

**Expected size:** 10-20 MB for online mode

**If larger:**

-   Check if SQL Tools Service was accidentally included
-   Run: `yarn package --online` (ensure `--online` flag is used)

**Solution:**

```bash
# Clean service folder and repackage
rm -rf ~/.vscode-mssql/
yarn package --online
```

### Issue 4: Packaging Fails with "Cannot find module"

**Solution:**

```bash
# Ensure extension is built first
yarn build

# Then package
yarn package --online
```

### Issue 5: Offline Packaging Fails for Specific Platform

**Symptoms:**

```
[5/13] Processing osx-arm64...
✗ Failed to package osx-arm64: Download failed
```

**Solution:**

-   This is usually a network issue
-   The script will skip failed platforms and continue
-   You can retry packaging for specific platforms if needed

### Issue 6: VSIX Installation Fails

**Symptoms:**

```
Error: Extension is not compatible with VS Code 1.95.0
```

**Solution:**

-   Check `engines.vscode` in `package.json`
-   Ensure your VS Code version meets the requirement (^1.98.0)
-   Update VS Code or adjust the engine requirement

### Issue 7: Extension Doesn't Activate After Installation

**Solution:**

1. Check VS Code Output panel (View → Output → Select "MSSQL")
2. Look for activation errors
3. Verify all dependencies are included in the package
4. Try uninstalling and reinstalling:
    ```bash
    code --uninstall-extension ms-mssql.mssql
    code --install-extension mssql-1.37.0.vsix
    ```

---

## Advanced: Customizing the Package

### Changing the Version Number

Edit `package.json`:

```json
{
    "version": "1.37.1"
}
```

Then rebuild and repackage:

```bash
yarn build
yarn package --online
```

### Changing the Publisher

Edit `package.json`:

```json
{
    "publisher": "your-company-name"
}
```

**Note:** You'll need a publisher account to publish to the marketplace.

### Including Additional Files

Edit `.vscodeignore` to control what's included/excluded:

```
# Exclude from package
test/**
.vscode/**
.github/**

# Include in package
!dist/**
!images/**
```

### Pre-Release Versions

For testing or beta releases:

```bash
# Add pre-release flag
vsce package --pre-release
```

Or update version in `package.json`:

```json
{
    "version": "1.37.0-beta.1"
}
```

---

## Summary

### Quick Reference

| Task                 | Command                                      |
| -------------------- | -------------------------------------------- |
| Install dependencies | `yarn install`                               |
| Build extension      | `yarn build`                                 |
| Lint code            | `yarn lint src/ test/`                       |
| Package (online)     | `yarn package --online`                      |
| Package (offline)    | `yarn package --offline`                     |
| Install locally      | `code --install-extension mssql-1.37.0.vsix` |
| List installed       | `code --list-extensions`                     |

### Recommended Workflow

1. ✅ Make your changes
2. ✅ Run `yarn build` to compile
3. ✅ Run `yarn lint src/ test/` to check code quality
4. ✅ Run `yarn package --online` to create VSIX
5. ✅ Test the VSIX locally before distributing
6. ✅ Share the VSIX file with users

### File Sizes

-   **Online mode:** ~12-15 MB (single file)
-   **Offline mode:** ~140-160 MB per platform (13 files total)

### Support

For issues with packaging:

-   Check the [AGENTS.md](.augment/rules/AGENTS.md) file for build instructions
-   Review the [README.md](../README.md) for general extension information
-   Report issues: https://github.com/Microsoft/vscode-mssql/issues

---

**Last Updated:** 2025-01-XX  
**Extension Version:** 1.37.0
