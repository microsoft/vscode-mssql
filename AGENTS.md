# MSSQL Extension for Visual Studio Code

The MSSQL Extension for Visual Studio Code is a TypeScript-based VS Code extension that provides database management capabilities for SQL Server, Azure SQL, and SQL Database in Fabric. The extension includes React-based webview components, AI-powered features with GitHub Copilot integration, and comprehensive SQL development tools.

**Always reference these instructions first** and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## Working Effectively

### Bootstrap, Build, and Test the Repository

**NEVER CANCEL** any build or test commands. These operations can take significant time and should be allowed to complete.

#### Initial Setup (Required once)

```bash
# Ensure correct Node.js version (v20+)
node --version  # Should be v20.19.4 or higher
yarn --version  # Should be v1.22+

# Install dependencies - takes ~60 seconds initial, ~11 seconds subsequent. NEVER CANCEL. Set timeout to 120+ seconds.
yarn install
```

#### Build Commands

```bash
# Full build - takes ~19 seconds. NEVER CANCEL. Set timeout to 60+ seconds.
yarn build

# Development watch mode (for active development)
yarn watch
# This runs continuous compilation and bundling. Leave running during development.
# Includes: extension TypeScript, webview React/TypeScript, and asset bundling.
```

#### Individual Build Steps (if needed)

```bash
# Prepare assets and localization (~2 seconds)
yarn build:prepare

# Compile extension TypeScript (~5 seconds)
yarn build:extension

# Bundle extension (~1 second)
yarn build:extension-bundle

# Compile React webviews (~8 seconds)
yarn build:webviews

# Bundle webviews (~2 seconds)
yarn build:webviews-bundle
```

### Linting and Code Quality

```bash
# Lint source files only - takes ~1.5 seconds
yarn lint src/ test/

# DO NOT run 'yarn lint' without arguments - it will fail trying to lint build output
```

### Testing

#### Unit Tests

```bash
# Unit tests require VS Code download and cannot run in sandboxed environments
# This is expected behavior - tests work in CI with proper VS Code setup
yarn test
# Expected to fail with "ENOTFOUND update.code.visualstudio.com" in sandboxed environments

# Run targeted unit tests using grep patterns
yarn test --grep "ConnectionManager"          # Run tests matching "ConnectionManager"
yarn test --pattern ".*service.*"             # Run tests matching service pattern
yarn test --testPattern "QueryRunner"         # Alternative syntax for test filtering
```

#### E2E Tests (Smoke Tests)

```bash
# E2E tests also require VS Code and SQL Server setup
yarn smoketest
# Requires: SQL Server running, connection credentials, VS Code installation
```

### Packaging

```bash
# Install vsce globally (if not already installed)
npm install -g vsce

# Package extension - takes ~4.5 seconds. NEVER CANCEL. Set timeout to 60+ seconds.
yarn package --online   # Creates ~12MB VSIX file for online distribution
yarn package --offline  # Creates platform-specific packages with embedded services
```

## Validation Scenarios

**Always test the following scenarios after making changes:**

### Complete Build Validation

1. Clean install: `rm -rf node_modules && yarn install`
2. Full build: `yarn build`
3. Lint check: `yarn lint src/ test/`
4. Package creation: `yarn package --online`
5. Verify VSIX file is created (~12-15MB is normal)

### Development Workflow Validation

1. Start watch mode: `yarn watch`
2. Make a small change to a TypeScript file in `src/`
3. Verify automatic recompilation occurs
4. Stop watch mode with Ctrl+C

### Pre-Commit Validation Workflow

```bash
# Always run these commands before committing changes:
yarn build                 # Ensure code compiles
yarn lint src/ test/        # Ensure code meets style standards
yarn package --online      # Ensure extension can be packaged
```

### Code Quality Validation

-   Always run `yarn lint src/ test/` before committing
-   Check for TypeScript compilation errors: `yarn build:extension` and `yarn build:webviews`
-   Verify no new warnings are introduced during build

## Project Structure

### Key Directories

-   `src/` - Main extension source code (TypeScript)
    -   `copilot/` - GitHub Copilot integration features
    -   `controllers/` - Extension controllers and logic
    -   `reactviews/` - React components for webviews
    -   `services/` - Core business logic services
-   `test/` - Unit and E2E tests
-   `scripts/` - Build and utility scripts
-   `dist/` - Build output (not in repository)
-   `localization/` - Multi-language support files

### Important Files

-   `package.json` - Extension manifest and build scripts
-   `tsconfig.extension.json` - TypeScript config for extension code
-   `tsconfig.react.json` - TypeScript config for React webviews
-   `eslint.config.mjs` - Linting configuration
-   `prettier.config.mjs` - Code formatting rules

## Common Commands and Expected Times

| Command                 | Expected Time                 | Timeout Setting | Description                             |
| ----------------------- | ----------------------------- | --------------- | --------------------------------------- |
| `yarn install`          | ~60s initial, ~11s subsequent | 120+ seconds    | NEVER CANCEL: Installs all dependencies |
| `yarn build`            | ~19 seconds                   | 60+ seconds     | NEVER CANCEL: Complete build process    |
| `yarn build:extension`  | ~5 seconds                    | 30+ seconds     | Compile extension TypeScript            |
| `yarn build:webviews`   | ~8 seconds                    | 30+ seconds     | Compile React webviews                  |
| `yarn lint src/ test/`  | ~1.5 seconds                  | 30+ seconds     | Lint source files only                  |
| `yarn package --online` | ~4.5 seconds                  | 60+ seconds     | NEVER CANCEL: Create VSIX package       |
| `yarn watch`            | Continuous                    | N/A             | Development watch mode                  |

## Build Troubleshooting

### Common Issues and Solutions

#### Lint Failures

-   **Issue**: `yarn lint` fails with "Definition for rule not found"
-   **Solution**: Use `yarn lint src/ test/` to lint source files only, not build output

#### VS Code Tests Failing

-   **Issue**: Tests fail with "ENOTFOUND update.code.visualstudio.com"
-   **Solution**: Expected in sandboxed environments. Tests require internet access to download VS Code.

#### Build Warnings

-   **Issue**: Engine warnings: "The engine 'vscode' appears to be invalid"
-   **Solution**: These are harmless warnings and can be ignored.

#### Watch Mode Issues

-   **Issue**: Watch mode not detecting changes
-   **Solution**: Stop watch mode (Ctrl+C) and restart: `yarn watch`

### CI/CD Expectations

-   The GitHub Actions workflow expects all these commands to work
-   Build must complete in under 60 seconds
-   Linting must pass with zero errors
-   VSIX package size should be under 25MB
-   No localization updates should be required unless strings changed

## Architecture Notes

### Extension Components

-   **Main Extension**: Entry point in `src/extension.ts`
-   **Webview Controllers**: React-based UI components for database management
-   **Services**: SQL Tools Service integration, connection management, query execution
-   **AI Integration**: GitHub Copilot features for SQL assistance and agent mode

### Build Pipeline

1. **Asset Preparation**: Copies test resources and generates localized strings
2. **TypeScript Compilation**: Compiles both extension and webview code separately
3. **Bundling**: Uses esbuild to create optimized bundles for production
4. **Packaging**: Creates VSIX file with all assets and dependencies

### Development Patterns

-   Use `yarn watch` during development for live compilation
-   Always run linting before committing changes
-   Build and package extension to test full integration
-   Extension can be debugged by installing VSIX in VS Code

**Remember**: NEVER CANCEL long-running build or test commands. Always set appropriate timeouts and wait for completion.
