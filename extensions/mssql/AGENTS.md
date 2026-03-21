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

# Install dependencies - takes ~60 seconds initial, ~11 seconds subsequent. NEVER CANCEL. Set timeout to 120+ seconds.
npm install
```

#### Build Commands

```bash
# Full build - takes ~19 seconds. NEVER CANCEL. Set timeout to 60+ seconds.
npm run build -- --target mssql

# Development watch mode (for active development)
npm run watch -- --target mssql
# This runs continuous compilation and bundling. Leave running during development.
# Includes: extension TypeScript, webview React/TypeScript, and asset bundling.
```

#### Individual Build Steps (if needed)

```bash
# Prepare assets and localization (~2 seconds)
npm run build:prepare --workspace mssql

# Compile extension TypeScript (~5 seconds)
npm run build:extension --workspace mssql

# Bundle extension (~1 second)
npm run build:extension-bundle --workspace mssql

# Compile React webviews (~8 seconds)
npm run build:webviews --workspace mssql

# Bundle webviews (~2 seconds)
npm run build:webviews-bundle --workspace mssql
```

### Linting and Code Quality

```bash
# Lint source files only - takes ~1.5 seconds
npm run lint -- --target mssql

# DO NOT run the workspace-local lint command without arguments against build output
```

### Testing

#### Unit Tests

See [test/unit/AGENTS.md](test/unit/AGENTS.md) for unit testing conventions and patterns.

```bash
# Unit tests require VS Code download and cannot run in sandboxed environments
# This is expected behavior - tests work in CI with proper VS Code setup
npm run test -- --target mssql
# Expected to fail with "ENOTFOUND update.code.visualstudio.com" in sandboxed environments

# Run targeted unit tests using grep patterns
npm run test -- --target mssql --grep "ConnectionManager"          # Run tests matching "ConnectionManager"
npm run test -- --target mssql --pattern ".*service.*"             # Run tests matching service pattern
npm run test -- --target mssql --testPattern "QueryRunner"         # Alternative syntax for test filtering
```

#### E2E Tests (Smoke Tests)

```bash
# E2E tests also require VS Code and SQL Server setup
npm run smoketest -- --target mssql
# Requires: SQL Server running, connection credentials, VS Code installation
```

### Packaging

```bash
# Install vsce globally (if not already installed)
npm install -g vsce

# Package extension - takes ~4.5 seconds. NEVER CANCEL. Set timeout to 60+ seconds.
npm run package -- --target mssql --online   # Creates ~12MB VSIX file for online distribution
npm run package -- --target mssql --offline  # Creates platform-specific packages with embedded services
```

## Validation Scenarios

**Always test the following scenarios after making changes:**

### Complete Build Validation

1. Clean install: `rm -rf node_modules && npm install`
2. Full build: `npm run build -- --target mssql`
3. Lint check: `npm run lint -- --target mssql`
4. Package creation: `npm run package -- --target mssql --online`
5. Verify VSIX file is created (~12-15MB is normal)

### Development Workflow Validation

1. Start watch mode: `npm run watch -- --target mssql`
2. Make a small change to a TypeScript file in `src/`
3. Verify automatic recompilation occurs
4. Stop watch mode with Ctrl+C

### Pre-Commit Validation Workflow

```bash
# Always run these commands before committing changes:
npm run build -- --target mssql                 # Ensure code compiles
npm run lint -- --target mssql                  # Ensure code meets style standards
npm run package -- --target mssql --online      # Ensure extension can be packaged
```

### Code Quality Validation

- Always run `npm run lint -- --target mssql` before committing
- Check for TypeScript compilation errors: `npm run build:extension --workspace mssql` and `npm run build:webviews --workspace mssql`
- Verify no new warnings are introduced during build

## Project Structure

### Key Directories

- `src/` - Main extension source code (TypeScript)
    - `copilot/` - GitHub Copilot integration features
    - `controllers/` - Extension controllers and logic
    - `reactviews/` - React components for webviews
    - `services/` - Core business logic services
- `test/` - Unit and E2E tests
- `scripts/` - Build and utility scripts
- `dist/` - Build output (not in repository)
- `localization/` - Multi-language support files

### Important Files

- `package.json` - Extension manifest and build scripts
- `tsconfig.extension.json` - TypeScript config for extension code
- `tsconfig.react.json` - TypeScript config for React webviews
- `eslint.config.mjs` - Linting configuration
- `prettier.config.mjs` - Code formatting rules

## Common Commands and Expected Times

| Command                                      | Expected Time                 | Timeout Setting | Description                             |
| -------------------------------------------- | ----------------------------- | --------------- | --------------------------------------- |
| `npm install`                                | ~60s initial, ~11s subsequent | 120+ seconds    | NEVER CANCEL: Installs all dependencies |
| `npm run build -- --target mssql`            | ~19 seconds                   | 60+ seconds     | NEVER CANCEL: Complete build process    |
| `npm run build:extension --workspace mssql`  | ~5 seconds                    | 30+ seconds     | Compile extension TypeScript            |
| `npm run build:webviews --workspace mssql`   | ~8 seconds                    | 30+ seconds     | Compile React webviews                  |
| `npm run lint -- --target mssql`             | ~1.5 seconds                  | 30+ seconds     | Lint source files only                  |
| `npm run package -- --target mssql --online` | ~4.5 seconds                  | 60+ seconds     | NEVER CANCEL: Create VSIX package       |
| `npm run watch -- --target mssql`            | Continuous                    | N/A             | Development watch mode                  |

## Build Troubleshooting

### Common Issues and Solutions

#### Lint Failures

- **Issue**: lint fails with "Definition for rule not found"
- **Solution**: Use `npm run lint -- --target mssql` to lint the extension sources through the root runner

#### VS Code Tests Failing

- **Issue**: Tests fail with "ENOTFOUND update.code.visualstudio.com"
- **Solution**: Expected in sandboxed environments. Tests require internet access to download VS Code.

#### Build Warnings

- **Issue**: Engine warnings: "The engine 'vscode' appears to be invalid"
- **Solution**: These are harmless warnings and can be ignored.

#### Watch Mode Issues

- **Issue**: Watch mode not detecting changes
- **Solution**: Stop watch mode (Ctrl+C) and restart: `npm run watch -- --target mssql`

### CI/CD Expectations

- The GitHub Actions workflow expects all these commands to work
- Build must complete in under 60 seconds
- Linting must pass with zero errors
- VSIX package size should be under 25MB
- No localization updates should be required unless strings changed

## Architecture Notes

### Extension Components

- **Main Extension**: Entry point in `src/extension.ts`
- **Webview Controllers**: React-based UI components for database management
- **Services**: SQL Tools Service integration, connection management, query execution
- **AI Integration**: GitHub Copilot features for SQL assistance and agent mode

### Build Pipeline

1. **Asset Preparation**: Copies test resources and generates localized strings
2. **TypeScript Compilation**: Compiles both extension and webview code separately
3. **Bundling**: Uses esbuild to create optimized bundles for production
4. **Packaging**: Creates VSIX file with all assets and dependencies

### Development Patterns

- Use `npm run watch -- --target mssql` during development for live compilation
- Always run linting before committing changes
- Build and package extension to test full integration
- Extension can be debugged by installing VSIX in VS Code

**Remember**: NEVER CANCEL long-running build or test commands. Always set appropriate timeouts and wait for completion.

## PR Review Guidelines

### Webview Code Review Checklist

When reviewing PRs that touch webview code (especially in `src/reactviews/`), pay close attention to the following patterns:

#### Avoid `setTimeout()` in Webviews

**Critical**: Avoid using `setTimeout(...)` in webview code, especially during webview startup.

- **Why**: Chrome throttles `setTimeout` to a minimum of 1 second when the webview tab is hidden or backgrounded
- **Impact**: This causes significant delays and unpredictable behavior during webview initialization
- **Review Action**: Flag any `setTimeout` usage in webview code and suggest alternatives below

#### Replace `setTimeout` with Better Alternatives

##### For UI Synchronization (React Components)

Use `requestAnimationFrame` instead of `setTimeout(cb, 0)` or short delays:

```typescript
// ❌ BAD: Throttled when webview is hidden
setTimeout(() => {
    updateUIState();
}, 0);

// ✅ GOOD: Syncs with browser paint loop (~60 FPS / ~16ms)
requestAnimationFrame(() => {
    updateUIState();
});
```

**Benefits of `requestAnimationFrame`**:

- Syncs with the browser's paint loop (~60 FPS / ~16ms intervals)
- Smoother and more predictable rendering
- Batches visual updates efficiently

##### For Non-Visual or RPC Work

Use `queueMicrotask` for immediate execution after the current call stack:

```typescript
// ❌ BAD: Unnecessary Promise allocation and potential throttling
setTimeout(() => {
    sendRpcMessage();
}, 0);

// ✅ GOOD: Runs immediately after current call stack
queueMicrotask(() => {
    sendRpcMessage();
});
```

**Benefits of `queueMicrotask`**:

- Runs immediately after the current call stack completes
- No extra Promise allocation overhead
- **Not throttled** when the webview is hidden/backgrounded
- Ideal for "run ASAP" scenarios like RPC calls, state updates, or event dispatching

#### Quick Reference Table

| Use Case                  | Recommended API         | Why                                     |
| ------------------------- | ----------------------- | --------------------------------------- |
| UI updates / animations   | `requestAnimationFrame` | Syncs with paint loop, smooth rendering |
| RPC calls / state updates | `queueMicrotask`        | Immediate, not throttled, no overhead   |
| Actual intentional delays | `setTimeout`            | Only when you truly need a timed delay  |

#### PR Review Checklist

When reviewing webview-related PRs, verify:

- [ ] No `setTimeout(..., 0)` or short timeout patterns in UI code
- [ ] `requestAnimationFrame` used for visual/rendering synchronization
- [ ] `queueMicrotask` used for non-visual immediate execution
- [ ] No `setTimeout` during webview initialization/startup
- [ ] Consider hidden/backgrounded webview behavior for any timing-sensitive code
