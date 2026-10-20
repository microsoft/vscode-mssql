# Development

This repository contains multiple VS Code extensions and shared packages. Run commands from the
repository root unless noted otherwise.

VS Code extensions live in `extensions/`; shared packages such as extension-toolkit live in
`packages/`.

## Prerequisites

- Node.js 24 or later
- npm
- Visual Studio Code

## Common Workflow

1. Run `npm install` after a fresh clone or when dependencies change.
2. Run `npm run watch` to watch all targets used by **Run All Extensions**.
3. Select **Run All Extensions** from VS Code's **Run and Debug** view.
4. Make changes, then reload the Extension Development Host (`Ctrl+R`, or `Cmd+R` on macOS).
5. Run `npm run lint -- --target <target>` and `npm test -- --target <target>`.
6. Commit after the checks pass.

## Workspace Commands

List the available workspace targets:

```bash
npm run list:targets
```

The target list and package scripts are the source of truth for supported actions.

Use `--target` to limit an action to the extension or package you are changing:

```bash
npm run build -- --target mssql
npm run watch -- --target mssql
npm run lint -- --target mssql
npm run package -- --target mssql
```

Omit `--target` only when you intend to run an action for every target that supports it.

## Tests

Run every configured test target or select one target from the repository root:

```bash
npm test
npm test -- --target extension-toolkit
npm test -- --target mssql
npm test -- --target mssql --grep "Connection"
```

Extension-toolkit uses the
[Node.js test runner](https://nodejs.org/api/test.html). Refer to its documentation for current
file-selection and command-line options.

MSSQL uses
[`@vscode/test-cli`](https://github.com/microsoft/vscode-test-cli). Refer to its documentation for
current filtering and command-line options. MSSQL test commands compile the tests and collect
coverage.

For root-level automation scripts, run `npm run lint:repo` and `npm run test:repo`.

For MSSQL end-to-end smoke tests, copy `extensions/mssql/test/e2e/.env.example` to `.env` in the
same directory and configure a reachable SQL Server. Then run:

```bash
npm run smoketest -- --target mssql
```

### Azure SQL Database container CI

The **Build and Test (Unit + E2E)** workflow has an opt-in **Azure SQL container E2E**
job in addition to the existing SQL Server tests. To enable it, obtain private-preview
registry access using the [container setup guide](https://microsoft.github.io/azure-sql-database-container/getting-started.html),
then configure these GitHub Actions repository secrets:

- `AZURE_SQL_CONTAINER_REGISTRY_USERNAME` and `AZURE_SQL_CONTAINER_REGISTRY_PASSWORD`:
  the preview registry's pull credentials.

Enable the job per run: select **Run workflow**, choose the branch, and check
`AZURE_SQL_CONTAINER_E2E_ENABLED`. The checkbox defaults to unchecked; no repository
variable is required. Alternatively, dispatch it from the CLI:

```bash
gh workflow run build-and-test.yml --repo microsoft/vscode-mssql --ref your-branch -f AZURE_SQL_CONTAINER_E2E_ENABLED=true
```

The job skips automatic PR, push, and scheduled runs, as well as Dependabot events.
When enabled, missing credentials fail the job explicitly. It downloads the same MSSQL
VSIX produced by the build job, provisions `mssql_e2e` in a disposable Azure SQL
Database container, and runs both Playwright projects on VS Code Stable. Reports,
traces, screenshots, and container diagnostics are uploaded separately from the SQL
Server run; Azure SQL E2E failures fail their job.

To run the same tests locally against an already-provisioned container, set the
connection values in `extensions/mssql/test/e2e/.env`, including `DATABASE_NAME` for
the user database. Set `E2E_USE_VSIX=true` and `BUILT_VSIX_PATH` to an absolute VSIX path,
then run `node scripts/prepare-e2e-env.js` followed by `npx playwright test` from
`extensions/mssql`. This packaged-extension run does not collect source coverage.
The existing query test creates/drops `TestDB` only when `DATABASE_NAME` is empty;
with a database specified it creates and removes a uniquely named test table there.

The preview container has [known compatibility gaps](https://microsoft.github.io/azure-sql-database-container/known-limitations.html),
including graphical tooling limitations. This job adds container coverage, not
validation of Azure-hosted authentication, networking, or managed-service behavior.

## Localization

When localization sources change, run the repository-wide extraction:

```bash
npm run localization
```
