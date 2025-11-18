# VS Code SQL Extensions

This repository hosts Microsoft's SQL-related VS Code extensions that deliver end-to-end SQL development workflows. The original MSSQL extension now lives side-by-side with the SQL Database Projects extension.

## Repository Layout

- `mssql/` – Primary MSSQL extension that provides connection management, editors, Copilot integration, notebooks, dashboards, and packaging tooling.
- `sql-database-projects/` – SQL Database Projects extension focused on SQL project authoring, build, publish, and schema comparison experiences.
- `typings/` – Shared `.d.ts` shims for first-party dependencies (azdata, dataworkspace, mssql, vscode-mssql).

## Prerequisites

- Node.js `>= 20.19.4`
- Yarn `>= 1.22`
- VS Code `>= 1.98.0`

All commands below should be executed from the extension’s folder unless noted otherwise.

## Development

### MSSQL Extension (`mssql/`)

```bash
cd mssql

# Development
yarn                                # install extension dependencies
yarn watch                          # continuous build (extension + webviews + bundles)
yarn build                          # one-off full build
yarn package [--online|--offline]   # produces VSIX

# Testing
yarn test                           # run unit tests
yarn smoketest                      # run end-to-end tests (requires SQL instance)
```

### SQL Database Projects Extension (`sql-database-projects/`)

```bash
cd sql-database-projects

# Development
yarn                      # install extension dependencies
yarn watch                # continuous build (extension + webviews + bundles)
yarn build                # one-off full build
yarn package              # produces VSIX

# Testing
yarn test                 # run unit tests; NOT CURRENTLY WORKING
```

## Debugging From The Root Workspace

1. Open the repository root in VS Code.
2. Run `yarn watch` from either or both extension subfolders
3. Execute a VS Code launch configuration:
   - `Run MSSQL Extension`
   - `Run SQL Database Projects Extension`
   - `Run Both Extensions` (launches two Extension Host windows, one per extension)

## Contributing Tips

- Keep the extensions independent—run `yarn install` inside each folder instead of the repo root.
- Shared code (e.g., telemetry helpers, typings) should live under `typings/` or a new sibling package to avoid implicit cross-imports.
- When editing build or launch configuration, ensure both extensions continue to debug cleanly from the new root-level `.vscode/launch.json`.
- Before opening a PR, document which extension you changed and how you validated it (commands above or manual scenarios).
