# Development

This repository contains multiple VS Code extensions and shared packages. Run commands from the
repository root unless noted otherwise.

## Prerequisites

- Node.js 24 or later
- npm
- Visual Studio Code

Install dependencies and list the available workspace targets:

```bash
npm install
npm run list:targets
```

The target list and package scripts are the source of truth for supported actions.

## Workspace Commands

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
```

The MSSQL test runner also accepts source test paths for targeted runs. Run these from
`extensions/mssql`:

```bash
cd extensions/mssql
npm test -- test/unit/utils.test.ts
```

MSSQL test commands compile the tests and collect coverage.

For MSSQL end-to-end tests, configure the environment using
`extensions/mssql/test/e2e/.env.example`, then run this command from the repository root:

```bash
npm run smoketest -- --target mssql
```

Use VS Code Insiders for test development when tests need to launch VS Code Stable.

## Localization

When user-facing MSSQL strings change, run:

```bash
npm --prefix extensions/mssql run localization
```

Do not hand-edit generated localization artifacts. Change the source localization constants and
run the localization workflow instead.

## Debugging

Start the watcher for the target you are changing, then launch the appropriate configuration from
VS Code's **Run and Debug** view. Root launch configurations are defined in `.vscode/launch.json`.

Keep this guide durable: update it when a supported workflow changes, but leave exhaustive script
and target inventories in their package and workspace configuration files.
