# Development

This repository contains multiple VS Code extensions and shared packages. Run commands from the
repository root unless noted otherwise.

## Prerequisites

- Node.js 24 or later
- npm
- Visual Studio Code

List the available workspace targets:

```bash
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

Test-runner arguments are passed through to the selected target.

Extension-toolkit uses the
[Node.js test runner](https://nodejs.org/api/test.html). Refer to its documentation for current
file-selection and command-line options.

MSSQL uses
[`@vscode/test-cli`](https://github.com/microsoft/vscode-test-cli). Refer to its documentation for
current filtering and command-line options. MSSQL test commands compile the tests and collect
coverage.

For MSSQL end-to-end tests, configure the environment using
`extensions/mssql/test/e2e/.env.example`, then run this command from the repository root:

```bash
npm run smoketest -- --target mssql
```

## Localization

When user-facing MSSQL strings change, run:

```bash
npm --prefix extensions/mssql run localization
```

## Common Workflow

1. Run `npm install` after a fresh clone or when dependencies change.
2. Run `npm run watch` in a terminal.
3. Select **Run All Extensions** from VS Code's **Run and Debug** view.
4. Make changes, then press `Ctrl+R` in the Extension Development Host to reload them.
5. Run the relevant tests and lint checks.
6. Commit after the checks pass.
