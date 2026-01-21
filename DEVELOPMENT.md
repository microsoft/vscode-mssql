# Development Guide

This document provides comprehensive information about building, testing, and developing the vscode-mssql monorepo.

## Repository Structure

This is a monorepo containing multiple VS Code extensions for SQL Server:

```
vscode-mssql/
├── extensions/                     # Extensions
│   ├── mssql/                      # Main MSSQL extension
│   ├── .....                       # Other extensions
├── scripts/                        # Build and utility scripts
├── package.json                    # Root workspace configuration
```

## Initial Setup

1. **Clone the repository**:

    ```bash
    git clone https://github.com/microsoft/vscode-mssql.git
    cd vscode-mssql
    ```

2. **Install dependencies**:

    ```bash
    yarn install
    ```

    This will install dependencies for all workspace packages (extensions) in a single command.

3. **Set up Git hooks**:

    ```bash
    yarn prepare
    ```

    This installs Husky git hooks that run automatically on commits.

## Building

### Build All Extensions (from root)

To build all extensions in the monorepo:

```bash
yarn build
```

This command:

- Runs the `build` script in each extension workspace
- Compiles TypeScript to JavaScript
- Generates localization files
- Outputs compiled code to each extension's `out/` directory

### Build Individual Extensions

To build a specific extension:

```bash
yarn workspace <extension-name> build
```

### Build Components

Each extension's build process typically includes:

1. **Runtime Localization**: Generates localization bundles

    ```bash
    yarn workspace <extension-name> build:runtime-localization
    ```

2. **TypeScript Compilation**: Compiles TypeScript source
    ```bash
    yarn workspace <extension-name> build:extension
    ```

## Development Workflow

### Watch Mode (Recommended for Development)

For active development, use watch mode to automatically recompile on file changes:

```bash
# Watch all extensions
yarn watch
```

This command:

- Starts TypeScript compiler in watch mode for all extensions
- Runs in parallel using the `scripts/watch-extensions.js` script
- Prefixes output with extension names for easy identification
- Automatically recompiles when you save changes

To watch a specific extension:

```bash
yarn workspace <extension-name> watch
```

### Running in VS Code

1. Open the repository in VS Code
2. Press `F5` or use **Run > Run All Extensions**
3. Select the extension you want to debug from the launch configurations
4. A new VS Code Extension Development Host window will open with your extension loaded

## Code Quality

### Linting

Lint all code:

```bash
# Lint specific extension
yarn workspace extension-name lint
```

### Formatting

This repository uses Prettier for code formatting:

- **Root Prettier config** (`prettier.config.mjs`): Used by most files
- **Extension-specific config** (`extensions/mssql/prettier.config.mjs`): Used by mssql extension

Formatting is automatically applied on save if you have the Prettier VS Code extension installed (see `.vscode/settings.json`).

### Git Hooks and Pre-commit Checks

Git hooks are managed by Husky. When you commit code, the pre-commit hook automatically:

1. **Ensures CRLF line endings**: Runs `scripts/ensure-crlf.js`
2. **Updates localization**: Runs `yarn localization` to extract strings
3. **Runs lint-staged**: Automatically formats and lints staged files

#### Lint-staged Configuration

The `lint-staged.config.mjs` file defines rules for different file types:

- **Root files** (`*.js`, `*.json`, `*.yml`, `*.md`): Formatted with root Prettier config
- **mssql extension**: Uses its own ESLint and Prettier configs
- **data-workspace extension**: Uses ESLint with root Prettier config
- **sql-database-projects extension**: Uses ESLint with root Prettier config

Lint-staged runs only on staged files, making commits fast.

## Localization

### Extract Localization Strings

Extract localization strings from all extensions:

```bash
yarn localization
```

Or for a specific extension:

```bash
yarn workspace <extension-name>  localization
```

This extracts user-facing strings into `l10n/bundle.l10n.json` files.

### Generate Runtime Localization

Generate runtime localization bundles (automatically done during build):

```bash
yarn workspace <extension-name>  localization:generate
```

## Testing

### Run Tests

Run tests for individual extensions:

```bash
yarn workspace <extension-name>  test
```

Tests use the VS Code Extension Test framework and Mocha.

### Test Configuration

Each extension has:

- `.vscode-test.mjs`: Configures VS Code test environment
- `src/test/runTest.js` or similar: Test runner entry point
- Test files in `src/test/` directories

## Packaging Extensions

To create a `.vsix` package for distribution:

```bash
yarn workspace <extension-name>  package
```

This creates a `.vsix` file in the extension's root directory that can be installed in VS Code.

## Adding a New Extension

To add a new extension to the monorepo, follow these steps:

### 1. Create Extension Directory

```bash
mkdir -p extensions/my-new-extension
cd extensions/my-new-extension
```

### 2. Initialize Extension

Create a `package.json` with the minimum required fields.

### 3. Create TypeScript Configuration

Create `tsconfig.json`:

```json
{
    "compilerOptions": {
        "module": "Node16",
        "target": "ES2022",
        "outDir": "out",
        "lib": ["ES2022"],
        "sourceMap": true,
        "rootDir": ".",
        "strict": true,
        "esModuleInterop": true,
        "skipLibCheck": true,
        "forceConsistentCasingInFileNames": true,
        "resolveJsonModule": true
    },
    "exclude": ["node_modules", ".vscode-test"]
}
```

### 5. Set Up ESLint Configuration

Create `eslint.config.mjs`:

```javascript
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
    {
        ignores: ["**/node_modules/**", "**/out/**", "**/.vscode-test/**"],
    },
    ...tseslint.configs.recommended,
    eslintConfigPrettier,
    {
        files: ["**/*.ts", "**/*.tsx"],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                project: "./tsconfig.json",
            },
        },
        rules: {
            "@typescript-eslint/naming-convention": "warn",
            "no-throw-literal": "warn",
            semi: "warn",
        },
    },
];
```

### 6. Create Test Configuration

Create `.vscode-test.mjs`:

```javascript
import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
    files: "out/test/**/*.test.js",
    version: "stable",
    workspaceFolder: ".",
});
```

### 7. Update Root Workspace

The extension is automatically picked up by the root workspace because of the `"workspaces": ["extensions/*"]` configuration in the root `package.json`.

### 8. Update Lint-staged Configuration

Add your extension to `/lint-staged.config.mjs`:

```javascript
// Add this to the export default object
"extensions/my-new-extension/**/*.{ts,tsx}": (files) => [
    eslintInWorkspace("extensions/my-new-extension", "--fix", files),
    prettierFromRoot("--write", files),
],
```

### 9. Install Dependencies and Build

```bash
# From repository root
yarn install
yarn workspace my-new-extension build
```

### 10. Test the Extension

```bash
yarn workspace my-new-extension test
```

### 11. Add Launch Configuration

Add to `.vscode/launch.json`:

```json
{
    "name": "Launch My New Extension",
    "type": "extensionHost",
    "request": "launch",
    "args": ["--extensionDevelopmentPath=${workspaceFolder}/extensions/my-new-extension"],
    "outFiles": ["${workspaceFolder}/extensions/my-new-extension/out/**/*.js"],
    "preLaunchTask": "npm: watch - extensions/my-new-extension"
}
```

## VS Code Configuration

### Workspace Settings

The `.vscode/settings.json` file configures:

- **ESLint**: Flat config support, working directories per extension
- **Prettier**: Format on save enabled for all file types
- **Search/File exclusions**: Hides build artifacts and dependencies

### Recommended Extensions

See `.vscode/extensions.json` for recommended VS Code extensions:

- ESLint
- Prettier
- TypeScript and JavaScript Language Features

## Common Commands Reference

| Command                         | Description                      |
| ------------------------------- | -------------------------------- |
| `yarn install`                  | Install all dependencies         |
| `yarn build`                    | Build all extensions             |
| `yarn watch`                    | Watch all extensions for changes |
| `yarn localization`             | Extract localization strings     |
| `yarn lint-staged`              | Run lint-staged manually         |
| `yarn workspace <name> build`   | Build specific extension         |
| `yarn workspace <name> watch`   | Watch specific extension         |
| `yarn workspace <name> test`    | Test specific extension          |
| `yarn workspace <name> package` | Package specific extension       |
| `yarn workspace <name> lint`    | Lint specific extension          |

## Troubleshooting

### Build Issues

- **Clean generated files and rerun build commands**:

    ```bash
    git clean -fxd
    yarn
    yarn build
    ```

### Git Hook Issues

- If pre-commit hooks fail, check:
    - Line endings are correct (CRLF expected)
    - Localization strings are up to date
    - All staged files pass linting

- Bypass hooks temporarily (not recommended):
    ```bash
    git commit --no-verify
    ```

### Test Failures

- Ensure VS Code test instance isn't already running
- Check test output for specific errors
- Verify extension dependencies are installed
