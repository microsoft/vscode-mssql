# Data-tier Application - Bundle Configuration Fix

## Issue

When attempting to load the Data-tier Application webview, the page was empty with 404 errors in the console:

-   `dataTierApplication.css` - 404 Not Found
-   `dataTierApplication.js` - 404 Not Found

## Root Cause

The Data-tier Application entry point was not included in the webview bundling configuration (`scripts/bundle-reactviews.js`).

When esbuild runs, it only bundles the pages listed in the `entryPoints` configuration. Since `dataTierApplication` was missing, the JavaScript and CSS files were never generated in the `dist/views/` directory.

## Solution

Added the Data-tier Application entry point to the bundle configuration.

### File Modified: `scripts/bundle-reactviews.js`

**Before:**

```javascript
const config = {
    entryPoints: {
        addFirewallRule: "src/reactviews/pages/AddFirewallRule/index.tsx",
        connectionDialog: "src/reactviews/pages/ConnectionDialog/index.tsx",
        connectionGroup: "src/reactviews/pages/ConnectionGroup/index.tsx",
        deployment: "src/reactviews/pages/Deployment/index.tsx",
        // ... other entries
        changePassword: "src/reactviews/pages/ChangePassword/index.tsx",
        publishProject: "src/reactviews/pages/PublishProject/index.tsx",
    },
```

**After:**

```javascript
const config = {
    entryPoints: {
        addFirewallRule: "src/reactviews/pages/AddFirewallRule/index.tsx",
        connectionDialog: "src/reactviews/pages/ConnectionDialog/index.tsx",
        connectionGroup: "src/reactviews/pages/ConnectionGroup/index.tsx",
        dataTierApplication: "src/reactviews/pages/DataTierApplication/index.tsx", // ← ADDED
        deployment: "src/reactviews/pages/Deployment/index.tsx",
        // ... other entries
        changePassword: "src/reactviews/pages/ChangePassword/index.tsx",
        publishProject: "src/reactviews/pages/PublishProject/index.tsx",
    },
```

## Build Steps Required

To generate the missing files, run:

```bash
# Option 1: Build webviews only
yarn build:webviews-bundle

# Option 2: Full build (includes webviews)
yarn build

# Option 3: Watch mode for development
yarn watch
```

### Expected Output Files

After building, the following files will be generated in `dist/views/`:

1. **dataTierApplication.js** - Main JavaScript bundle with React components
2. **dataTierApplication.css** - Styles for the webview
3. **chunk-\*.js** - Shared code chunks (React, Fluent UI, etc.)

## Bundle Configuration Details

### Entry Point Path

```
src/reactviews/pages/DataTierApplication/index.tsx
```

This file:

-   Imports React and ReactDOM
-   Imports the DataTierApplicationStateProvider
-   Imports the DataTierApplicationPage component
-   Renders the app with VscodeWebviewProvider2 wrapper

### Bundle Options (from config)

-   **Format**: ESM (ES Modules)
-   **Platform**: Browser
-   **Bundle**: Yes (includes all dependencies)
-   **Splitting**: Yes (creates shared chunks)
-   **Minify**: Production builds only
-   **Sourcemap**: Development builds only

## Why This Happens

When adding a new webview page to the extension, three steps are required:

1. ✅ Create React components (Done)
2. ✅ Create controller (Done)
3. ❌ **Add to bundle config** (Was missing)

Without step 3, the TypeScript/React code compiles successfully but never gets bundled into the distribution files that VS Code loads.

## Verification

After rebuilding, verify the files exist:

```bash
# Check if files were generated
ls dist/views/dataTierApplication.*

# Expected output:
# dataTierApplication.css
# dataTierApplication.js
```

## Additional Notes

### File Size Expectations

-   **dataTierApplication.js**: ~50-100 KB (minified in production)
-   **dataTierApplication.css**: ~5-10 KB
-   **Shared chunks**: Varies (React, Fluent UI, common utilities)

### Bundle Performance

-   The `splitting: true` option creates shared chunks for common dependencies
-   This reduces redundancy across multiple webviews
-   First-time load downloads all needed chunks
-   Subsequent webviews reuse cached chunks

## Status

✅ **Bundle configuration updated**
✅ **Entry point added for dataTierApplication**
✅ **Ready to build**

⏳ **Next Step**: Run `yarn build:webviews-bundle` to generate the files

## Related Files

-   **Bundle config**: `scripts/bundle-reactviews.js`
-   **Build script**: `scripts/build.js`
-   **TypeScript config**: `tsconfig.react.json`
-   **Entry point**: `src/reactviews/pages/DataTierApplication/index.tsx`
-   **Output directory**: `dist/views/`

The webview will work correctly after running the build command!
