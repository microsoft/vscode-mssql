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

## Localization

When localization sources change, run the repository-wide extraction:

```bash
npm run localization
```

## Connection-aware telemetry

Pass operation-specific `connectionInfo` and `serverInfo` to `sendActionEvent`, `sendErrorEvent`,
and `startActivity` when available. Do not use an unrelated active editor's connection for global
events. Activities retain their initial connection/server metadata for updates and completion;
`update` can supply metadata learned after the activity started.

`serverEngineEdition` and `serverEdition` identify engine families and SQL Server editions.
`serverTypes` contains the existing endpoint-derived tags (for example, `Azure,SQL` or
`Fabric,SQL`), attached to server info when a connection succeeds. These complement the engine
edition; endpoint tags alone do not identify Managed Instance or guarantee physical on-premises
hosting.

STS also returns `databaseServiceTier` and `databaseServiceObjective`, queried using
`DATABASEPROPERTYEX(DB_NAME(), 'Edition')` and `DATABASEPROPERTYEX(DB_NAME(), 'ServiceObjective')`
in the existing server-information query. These are database-scoped, refreshed on database context
changes, and blank in telemetry when unavailable (including older STS versions).
These SQL properties identify Azure SQL tiers/objectives, but **do not distinguish the modern
Azure SQL free offer from paid serverless databases**. That requires authoritative Azure Resource
Manager [`properties.useFreeLimit`](https://learn.microsoft.com/rest/api/sql/databases/get#database)
offer metadata and Azure resource read permissions; never label all General Purpose/serverless
databases as free.
Neither these properties nor endpoint tags measure actual spending or Fabric capacity.

### Testing with local SQL Tools Service

With this repository and `sqltoolsservice` checked out as sibling directories, run from their parent
directory:

```bash
dotnet publish sqltoolsservice/src/Microsoft.SqlTools.ServiceLayer/Microsoft.SqlTools.ServiceLayer.csproj \
  --no-restore -c Debug -o sqltoolsservice/artifacts/telemetry-local
npm --prefix vscode-mssql run build -- --target mssql
```

Select **MSSQL: Local STS telemetry** in Run and Debug, then press F5. This configuration uses the
local publish folder via `MSSQL_SQLTOOLSSERVICE`, without replacing the normal extension setup.
Connect to each engine/database of interest, execute a query or use a database feature, and switch
databases to check that database-scoped metadata is refreshed.

To inspect payloads without sending telemetry, set a breakpoint in `TelemetryEventImpl.send` in
`packages/extension-toolkit/src/vscode/telemetry/telemetryReporter.ts` and inspect `this._properties`.
The bundled extension's source map includes this source. No telemetry connection string is required
for breakpoint inspection. To see actual emitted telemetry in **Developer: Show Telemetry**, supply
your existing development `MSSQL_APP_INSIGHTS_KEY` through the launch environment and enable
telemetry in the Extension Development Host. Do not commit telemetry credentials.
