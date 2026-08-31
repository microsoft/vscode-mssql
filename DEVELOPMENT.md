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
4. Make changes, then press `Ctrl+R` on Windows or Linux, or `Cmd+R` on macOS, in the Extension
   Development Host.
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
