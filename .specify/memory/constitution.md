<!--
Sync Impact Report:
- Version change: 1.1.0 → 1.2.0 (MINOR - add unit test requirement + linting scope)
- Modified principles: IV. Test-First (NON-NEGOTIABLE), V. Build Verification
- Added sections: None
- Removed sections: None
- Templates requiring updates: ✅ tasks-template.md (updated tests guidance), ✅ plan-template.md (no updates needed), ✅ spec-template.md (no updates needed)
- Follow-up TODOs: None
-->

# VS Code SQL Extensions Constitution

## Core Principles

### I. TypeScript-First

All extension and webview code MUST be written in TypeScript with strict type checking enabled.

- TypeScript MUST target ES2024 with appropriate lib settings
- Each extension uses its own `tsconfig.extension.json` for extension code and `tsconfig.react.json` for React webviews (where applicable)
- Avoid `any` types; ESLint MUST warn on `@typescript-eslint/no-explicit-any`
- Private properties MUST use leading underscore naming convention
- Unused variables MUST be prefixed with underscore to indicate intentional non-use

**Rationale**: TypeScript provides compile-time safety, better tooling support, and self-documenting code that reduces bugs and improves maintainability in complex VS Code extensions.

### II. VS Code Extension Patterns

Extensions MUST follow VS Code extension architecture best practices.

- Entry point MUST be in `src/extension.ts` with proper activation/deactivation lifecycle
- Commands, providers, and disposables MUST be properly registered and disposed
- Use VS Code API patterns for webview communication (message passing)
- Extensions MUST NOT block the extension host with synchronous operations
- Use `vscode.workspace.fs` for file operations, not Node.js `fs` module directly
- Respect VS Code's sandbox model and content security policies for webviews

**Rationale**: Following VS Code patterns ensures compatibility across VS Code versions, prevents memory leaks, and provides consistent UX matching other extensions.

### III. React Webview Standards

Webview code MUST follow React best practices with VS Code-specific optimizations.

- Use React 18+ with functional components and hooks
- **CRITICAL**: Avoid `setTimeout()` in webview code, especially during startup
  - Chrome throttles `setTimeout` to minimum 1 second when webview tab is hidden/backgrounded
  - Use `requestAnimationFrame` for UI synchronization and visual updates
  - Use `queueMicrotask` for non-visual work (RPC calls, state updates)
- Components MUST be properly memoized when performance-critical
- Use VS Code's theming CSS variables for consistent appearance
- State management SHOULD use React Context or simple hooks over external libraries

**Rationale**: Proper async patterns prevent unpredictable behavior in backgrounded webviews; following React best practices ensures maintainable, performant UI components.

### IV. Test-First (NON-NEGOTIABLE)

Tests MUST be written and verified to fail before implementation code.

- New features MUST include unit tests that cover the added behavior
- Unit tests run via `yarn test` within each extension directory (requires VS Code download, may fail in sandboxed environments)
- E2E smoke tests run via `yarn smoketest` for MSSQL extension (requires SQL Server instance)
- Use targeted test patterns: `yarn test --grep "ComponentName"`
- Tests MUST be independent and not rely on execution order
- Mock VS Code APIs and external services appropriately
- Test coverage reports generated via Istanbul/nyc

**Rationale**: TDD ensures features are testable by design, reduces regression bugs, and provides living documentation of expected behavior.

### V. Build Verification

All code changes MUST pass build verification before merge.

- **NEVER CANCEL** build or test commands; they MUST be allowed to complete
- Full build via `yarn build` within each extension MUST complete successfully
- Linting via `yarn lint src/ test/` MUST pass with zero errors for modified extensions and cover modified files
  - **DO NOT** run `yarn lint` without arguments (fails on build output)
- Packaging via `yarn package` MUST produce valid VSIX for each extension
- VSIX size increase MUST NOT exceed 5% compared to baseline per extension
- Localization: Run `yarn localization` from repository root and commit updated xliff/bundle files when strings change

**Rationale**: Build verification gates ensure code quality, prevent regressions, and maintain extension size for marketplace distribution.

### VI. Code Quality Gates

All code MUST adhere to project coding standards enforced by automated tooling.

- ESLint configuration via `eslint.config.mjs` with TypeScript, React, and Prettier plugins
- Microsoft copyright header MUST be present in all source files (enforced by `eslint-plugin-notice`)
- Prettier formatting with: 100 char print width, bracket same line, auto end-of-line
- No duplicate imports (error level)
- Floating promises MUST be handled (`@typescript-eslint/no-floating-promises`)
- Deprecated API usage MUST be flagged and remediated
- JSDoc types MUST NOT be used in TypeScript files (`jsdoc/no-types`)

**Rationale**: Consistent code style reduces cognitive load, automated enforcement prevents style debates, and quality gates catch common errors early.

### VII. Simplicity & YAGNI

Implementations MUST be the simplest solution that meets requirements.

- Avoid over-engineering; only implement what is explicitly required
- Do not add features, refactor code, or make "improvements" beyond what was asked
- Prefer direct solutions over abstractions for one-time operations
- Three similar lines of code is better than a premature abstraction
- Do not design for hypothetical future requirements
- Bug fixes SHOULD NOT include surrounding code cleanup unless directly related
- Remove unused code completely; do not add backwards-compatibility shims for removed features

**Rationale**: Simplicity reduces maintenance burden, minimizes bug surface area, and keeps the codebase navigable for new contributors.

### VIII. Extension Independence

Each extension in the monorepo MUST be independently buildable, testable, and publishable.

- Extensions MUST NOT have implicit dependencies on each other's build artifacts
- Shared code (typings, helpers) MUST live in designated shared locations (`typings/`)
- Each extension manages its own `package.json`, dependencies, and build configuration
- Run `yarn install` inside each extension folder, not at repository root for extension-specific work
- Cross-extension imports are prohibited; use shared packages or duplicate minimal code
- Before opening PRs, document which extension(s) you changed and how you validated them

**Rationale**: Independence ensures each extension can be developed, tested, and released on its own schedule without blocking other extensions.

## Additional Constraints

### Technology Stack Requirements

- **Node.js**: >= 20.19.4
- **Yarn**: >= 1.22
- **VS Code**: >= 1.98.0
- **TypeScript**: Compile to ES2024, use CommonJS modules for extension
- **React**: 18+ with JSX transform (react-jsx) for extensions with webviews
- **Build Tool**: esbuild for bundling

### Multi-Extension Monorepo Structure

This repository contains multiple VS Code extensions that MUST be treated as independent packages:

```
/
├── extensions/
│   ├── mssql/                    # Primary MSSQL extension
│   │   ├── src/
│   │   │   ├── copilot/          # GitHub Copilot integration
│   │   │   ├── controllers/      # Extension controllers
│   │   │   ├── reactviews/       # React webview components
│   │   │   └── services/         # Core business logic
│   │   ├── test/
│   │   ├── package.json
│   │   ├── tsconfig.extension.json
│   │   ├── tsconfig.react.json
│   │   └── agents.md             # Extension-specific development guidance
│   │
│   ├── sql-database-projects/    # SQL Database Projects extension
│   │   ├── src/
│   │   ├── test/
│   │   └── package.json
│   │
│   └── data-workspace/           # Data Workspace extension
│       ├── src/
│       ├── test/
│       └── package.json
│
├── typings/                      # Shared .d.ts shims for first-party dependencies
├── localization/                 # Centralized localization (xliff files)
├── .github/
│   └── workflows/                # CI/CD pipelines for all extensions
└── package.json                  # Root package for shared scripts (localization, etc.)
```

### Extension-Specific Commands

Each extension has its own build lifecycle. Run commands from within the extension directory:

| Extension | Directory | Build | Test | Package |
|-----------|-----------|-------|------|---------|
| MSSQL | `extensions/mssql/` | `yarn build` | `yarn test` | `yarn package` |
| SQL Database Projects | `extensions/sql-database-projects/` | `yarn build` | `yarn test` | `yarn package` |
| Data Workspace | `extensions/data-workspace/` | `yarn build` | `yarn test` | `yarn package` |

### CI/CD Expectations

- GitHub Actions workflow runs on PRs to main and release branches
- **All extensions** are built, linted, and tested in CI
- Build MUST complete in under 60 seconds per extension
- Linting MUST pass with zero errors for all extensions
- Unit tests MUST pass (MSSQL: required; others: warning-only until stabilized)
- Smoke tests MUST pass for MSSQL extension
- VSIX package size SHOULD be under 25MB per extension
- Localization files MUST be up-to-date across all extensions

### Security Requirements

- No secrets or credentials in source code
- Use VS Code's SecretStorage API for sensitive data
- Validate all user inputs, especially SQL queries
- Follow OWASP guidelines for web security in webviews
- Content Security Policy MUST be set for all webviews

## Development Workflow

### Pre-Commit Validation

All changes MUST pass these checks before committing. Run from within the affected extension directory:

```bash
# For each modified extension (e.g., extensions/mssql/):
cd extensions/<extension-name>
yarn build               # Ensure code compiles
yarn lint src/ test/     # Lint modified files in src/ and test/
yarn package             # Ensure extension can be packaged
```

### PR Review Checklist

When reviewing PRs, verify:

- [ ] PR description states which extension(s) were modified
- [ ] No `setTimeout(..., 0)` or short timeout patterns in webview code
- [ ] `requestAnimationFrame` used for visual/rendering synchronization
- [ ] `queueMicrotask` used for non-visual immediate execution
- [ ] No `setTimeout` during webview initialization/startup
- [ ] TypeScript strict mode compliance
- [ ] Copyright headers present
- [ ] No new ESLint warnings introduced
- [ ] Test coverage maintained or improved
- [ ] No cross-extension dependencies introduced

### Build Commands Reference (per extension)

| Command                 | Expected Time | Description                             |
|-------------------------|---------------|-----------------------------------------|
| `yarn install`          | ~60s initial  | Install extension dependencies          |
| `yarn build`            | ~19s (mssql)  | Complete build process                  |
| `yarn build:extension`  | ~5s           | Compile extension TypeScript            |
| `yarn build:webviews`   | ~8s           | Compile React webviews (if applicable)  |
| `yarn lint src/ test/`  | ~1.5s         | Lint source files only                  |
| `yarn package`          | ~4.5s         | Create VSIX package                     |
| `yarn watch`            | Continuous    | Development watch mode                  |

### Root-Level Commands

Run from repository root for cross-extension operations:

| Command | Description |
|---------|-------------|
| `yarn localization` | Generate/update localization files for all extensions |

## Governance

This constitution supersedes all other development practices for all extensions in this repository.

- All PRs and code reviews MUST verify compliance with these principles
- Amendments require: documentation of change, team approval, migration plan for affected code
- Complexity MUST be justified in PR descriptions when deviating from Simplicity principle
- Use extension-specific guidance files (e.g., `extensions/mssql/agents.md`) for detailed runtime development guidance

**Version**: 1.2.0 | **Ratified**: 2026-01-28 | **Last Amended**: 2026-01-29
