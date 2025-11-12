# VS Code SQL Extensions

This repository now hosts Microsoft's SQL-related VS Code extensions that deliver end-to-end SQL development workflows. The original MSSQL extension lives side-by-side with the SQL Database Projects extension so that both can share CI infrastructure, documentation, and engineering tooling.

## Repository Layout

- `mssql/` – Primary MSSQL extension that provides connection management, editors, Copilot integration, notebooks, dashboards, and packaging tooling.
- `sql-database-projects/` – SQL Database Projects extension focused on SQL project authoring, build, publish, and schema comparison experiences.
- `typings/` – Shared `.d.ts` shims for first-party dependencies (azdata, dataworkspace, mssql, vscode-mssql).

## Prerequisites

- Node.js `>= 20.19.4`
- Yarn `>= 1.22`
- VS Code 1.90+ (stable or insiders) with Extension Development Host support
- Local SQL Server/Azure SQL resources (only required for smoketests or manual validation)

All commands below should be executed from the extension’s folder unless noted otherwise.

## Debugging From The Root Workspace

1. Open `C:\Users\benjind\Source\Codex\vscode-mssql` in VS Code.
2. Choose a configuration in **Run and Debug**:
   - `Run MSSQL Extension`
   - `Run SQL Database Projects Extension`
   - `Run Both Extensions` (launches two Extension Host windows, one per extension)
3. Start the matching watch/build task in a terminal (see sections below) before attaching so source maps stay fresh.

## MSSQL Extension (`mssql/`)

```bash
cd mssql
yarn
yarn watch                      # continuous build (extension + webviews + bundles)
yarn build                      # one-off full build
yarn package [--online|--offline]           # produces VSIX (~12–15 MB)
```

Targeted builds (when you do not need everything):

```bash
yarn build:prepare              # assets + localization (~2s)
yarn build:extension            # extension TypeScript only (~5s)
yarn build:webviews             # React/webview bundle (~8s)
```

Testing:

- `yarn test` – runs unit tests (downloads VS Code; expect ENOTFOUND in sandboxed environments without network access).
- `yarn smoketest` – E2E scenario that needs VS Code + SQL Server instance.

Pre-commit checklist:

1. `yarn build`
2. `yarn lint src/ test/`
3. `yarn package --online`

## SQL Database Projects Extension (`sql-database-projects/`)

This extension compiles via `tsc` and currently relies on watch mode for most workflows.

```bash
cd sql-database-projects
yarn install                    # install extension dependencies
yarn watch:extension            # tsc -w over tsconfig.extension.json
```

For a single build without watch mode:

```bash
npx tsc -p tsconfig.extension.json
```

## Contributing Tips

- Keep the extensions independent—run `yarn install` inside each folder instead of the repo root.
- Shared code (e.g., telemetry helpers, typings) should live under `typings/` or a new sibling package to avoid implicit cross-imports.
- When editing build or launch configuration, ensure both extensions continue to debug cleanly from the new root-level `.vscode/launch.json`.
- Before opening a PR, document which extension you changed and how you validated it (commands above or manual scenarios).
