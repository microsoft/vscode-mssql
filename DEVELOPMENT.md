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

## Python notebook tests

Notebook onboarding tests cover actionable Connect/Reconnect notifications, association of
ordinary Python notebooks with saved connection IDs, toolbar state, safe kernel startup,
dependency-installation consent, and cancellation. The connected Electron smoke also verifies
the notification-driven flow and that connecting a generic notebook does not execute its SQL.

Use a dedicated Python 3.10+ virtual environment; do not upgrade a shared interpreter.
Install `extensions/mssql/test/python/requirements.txt`, then run:

```powershell
python -m unittest discover -s extensions\mssql\test\python -p test_mssql_notebook.py
python -m unittest discover -s extensions\mssql\test\python -p test_mssql_notebook_dependencies.py
npm test -- --target mssql --grep Notebook
```

Real-driver integration tests use only temporary SQL objects. Configure
`MSSQL_NOTEBOOK_TEST_SERVER` and `MSSQL_NOTEBOOK_TEST_DATABASE` in the process environment.
SQL authentication is the default and additionally requires `MSSQL_NOTEBOOK_TEST_USER`
and `MSSQL_NOTEBOOK_TEST_PASSWORD`. Set `MSSQL_NOTEBOOK_TEST_AUTHENTICATION=integrated`
for Windows authentication from a Windows interpreter instead; it needs no SQL password.
For a local database with a self-signed certificate, explicitly set
`MSSQL_NOTEBOOK_TEST_TRUST_CERTIFICATE=1`. Never commit credentials.
CI reuses its existing test database service.

Run SQL Express first, selecting an existing test database explicitly:

```powershell
$env:MSSQL_NOTEBOOK_TEST_SERVER = '.\SQLEXPRESS'
$env:MSSQL_NOTEBOOK_TEST_DATABASE = '<existing-test-database>'
$env:MSSQL_NOTEBOOK_TEST_AUTHENTICATION = 'integrated'
$env:MSSQL_NOTEBOOK_TEST_TRUST_CERTIFICATE = '1'
$env:MSSQL_NOTEBOOK_TEST_ENGINE_EDITION = '4'
python -m unittest discover -s extensions\mssql\test\python -p test_mssql_notebook_integration.py -v
```

Then rerun the same command against an existing Azure SQL Database container by setting
its published server/port, an existing **user database** (not `master`),
`MSSQL_NOTEBOOK_TEST_AUTHENTICATION=sql`, and its test user/password in the process
environment. Set `MSSQL_NOTEBOOK_TEST_ENGINE_EDITION=5` to assert the PaaS engine identity.
This mode never starts, stops, or replaces the existing container.

The suite executes [mixed_sql_python.ipynb](extensions/mssql/test/python/mixed_sql_python.ipynb)
in a real, isolated IPython kernel using the test runner's interpreter. Its ten cells
verify SQL-to-DataFrame binding, Python calculations, `%%tsql --params` round trips
(including Unicode and SQL-looking text), shared temporary tables, multiple result sets,
cross-cell rollback, and disconnect. One tagged cell intentionally raises `queryProgrammingFailed`;
the runner requires exactly that error and verifies that subsequent cells recover without
overwriting the previous binding. All other errors fail the run. The executed notebook
is saved/reopened in a temporary directory and checked for credential leakage.
The fixture's initialization environment is supplied by the integration runner; for
interactive notebooks, use **MS SQL: Connect Python Notebook (Preview)** instead.

For an isolated local Azure SQL Database engine instead, install
`extensions/mssql/test/python/requirements.txt`, sign Docker in to the private preview
registry, and set `MSSQL_NOTEBOOK_TEST_CONTAINER=1`. This option creates and disposes its
own container, provisions `appdb`, and never alters existing containers or databases.

```powershell
python -m unittest discover -s extensions\mssql\test\python -p test_mssql_notebook_integration.py
```

Without explicit database configuration the integration suite is skipped, not verified.

### Python notebook pre-PR gates

Use a separate worktree based on current official `main` for integration and native
packaging. Do not package all platforms from an installation used by another running
extension host: offline packaging replaces the worktree's SQL Tools Service payload.
Exclude personal IDE settings and unrelated fork commits, and regenerate localization
using the normal extraction command.

- Run `npm run build -- --target mssql`, `npm run lint -- --target mssql`, the Python
  suites above, and `npm test -- --target mssql` on the integrated tree.
- If a failure appears unrelated, reproduce it on untouched official `main` before
  classifying it as baseline debt. Record both results; do not check "all tests pass"
  or disable failing tests to make the feature appear green.
- Run `npm run package -- --target mssql --offline` in that isolated worktree and require
  exactly one package for each of the six platforms. The packaging script can continue
  after individual failures, so its exit code alone is insufficient evidence.
- The **MSSQL VSIX Launch Verification** workflow checks packaged Python assets,
  native Python runtime/readiness tests, and installed-VSIX launch on all six runners.
  The **CodeQL Advanced** workflow supports manual dispatch for pre-PR validation.
  Run these on an explicitly authorized fork branch and record run URLs and results;
  configured workflows are not completed hosted checks.
- The build workflow runs a strict `pip-audit` of the Python runtime requirements.
  Keep live authentication and remote-workspace evidence separate from package/import
  checks; use the README's validation matrix rather than inferring support from wheels.
- Follow the [Contributor Guide](https://github.com/microsoft/vscode-mssql/wiki/Contributing)
  and repository reviewer guidelines. The guide requires a Microsoft CLA, whose status is
  established by the PR's CLA check and the contributor, not by local tests. Obtain actual
  maintainer decisions on ownership and Preview policy; never infer internal release,
  security, privacy, or legal approval from public documentation.

Set `MSSQL_PYTHON_NOTEBOOK_SMOKE=1` when preparing the Electron extensions template to
include Python and Jupyter; existing SQL-only smoke preparation remains unchanged.
The notebook smoke always checks Object Explorer creation and secret-free save/reopen.
With the database environment variables above and `MSSQL_NOTEBOOK_PYTHON` pointing to a
dedicated interpreter containing the runtime requirements and `ipykernel`, it also
selects that kernel, explicitly authorizes access, and verifies SQL-to-Python result
binding and parameterized Python-to-SQL values through `%%tsql` in the same notebook.
The connected smoke also creates a uniquely named catalog table, requests table-alias
column completion in an unexecuted `%%tsql` cell, accepts the edit without changing its
magic header, checks SQL hover/type information and `SUBSTRING`'s active parameter,
then drops and verifies removal of that exact table in teardown. The test identity
therefore needs permission to create/drop its own table in the selected test database.
It never replaces existing tables. Private projections must not be opened as VS Code
SQL documents or inherit a SQL editor's connection; unit tests cover authorization,
credential-refresh routing, stale requests, and projection lifecycle.
To additionally verify two-target isolation in the same VS Code window, set
`MSSQL_NOTEBOOK_ISOLATION_SERVER`, `MSSQL_NOTEBOOK_ISOLATION_DATABASE`,
`MSSQL_NOTEBOOK_ISOLATION_AUTHENTICATION`, and, for SQL authentication,
`MSSQL_NOTEBOOK_ISOLATION_USER` and `MSSQL_NOTEBOOK_ISOLATION_PASSWORD` in the process
environment. Set `MSSQL_NOTEBOOK_ISOLATION_TRUST_CERTIFICATE=1` only for a trusted local
self-signed certificate. The second target must be a different test database. This flow
creates the same uniquely owned table name with different columns in each database,
authorizes a second notebook, and verifies identical SQL text returns only its own
database's columns before switching back. Both fixtures are dropped and checked in teardown.
SQL authentication prompts for the test password without writing it to settings;
Windows authentication skips that prompt. CI enables this connected flow against its
existing test database service. To run just this connected smoke from the repository root
(after building MSSQL and preparing the extensions template with the smoke flag set):

```powershell
$env:MSSQL_PYTHON_NOTEBOOK_SMOKE = '1'
$env:MSSQL_NOTEBOOK_PYTHON = '<venv>\Scripts\python.exe'
node extensions\mssql\scripts\prepare-e2e-env.js
node extensions\mssql\node_modules\@playwright\test\cli.js test --config extensions\mssql\playwright.config.ts pythonNotebook.spec.ts --project=e2e --workers=1
```

## Localization

When localization sources change, run the repository-wide extraction:

```bash
npm run localization
```
