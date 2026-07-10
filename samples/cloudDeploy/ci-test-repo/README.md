# Cloud Deploy — CI test repository

A tiny, self-contained repository for exercising the Cloud Deploy schema-validation
workflow on **real GitHub Actions**, without touching `vscode-mssql`'s own CI
(which runs on Azure Pipelines).

## What's in here

| Path                                          | What it is                                                                                                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/cloud-deploy-validate.yml` | The pull-request workflow: validates the merge candidate, diffs it against the base branch, uploads the run artifacts, and posts a sticky summary comment. |
| `.mssql/environments.json`                    | One environment, `ci` — static-analysis-only, pointing at `db/SampleDb.sqlproj`.                                                                           |
| `db/`                                         | A minimal SQL project (one table) so static analysis has something real to build.                                                                          |
| `tools/mssql-validate.cjs`                    | The bundled, self-contained CLI (the validation engine). Generated — see below.                                                                            |

## How it runs (the flow)

1. A pull request opens against `main`.
2. GitHub spins up a throwaway runner and checks out the **merge candidate**
   (`refs/pull/<n>/merge`) plus the **base branch** (into `base/`).
3. The runner executes the bundled CLI on the base branch (the diff baseline)
   and then on the candidate, producing `main.cdrun.zip` and `candidate.cdrun.zip`.
4. The candidate run is diffed against the baseline and a Markdown report is
   written to `pr-comment.md`.
5. The `.cdrun.zip` artifacts upload (download and open them in the VS Code
   dashboard), and the report is posted/updated as a sticky PR comment.

The CLI exits non-zero if a gate fails, which fails the job and turns the PR
check red — so the job status **is** the gate.

## Refreshing the bundled CLI

The CLI is one self-contained file produced by esbuild. To rebuild it from the
`vscode-mssql` repo:

```bash
cd extensions/mssql
npm run build:cloud-deploy-cli
# then copy the output here:
cp dist/cloud-deploy-cli/mssql-validate.cjs <this-repo>/tools/mssql-validate.cjs
```

## Pushing this to your own test repo

1. Create a new (private) GitHub repository.
2. Copy the contents of this folder into it and commit.
3. Open a pull request that edits `db/Tables/Messages.sql` (for example, drop the
   primary key) and watch the workflow run on the PR.

## Adding the database-backed validators

The `ci` environment is static-analysis-only so it needs no database. To exercise
connectivity / unit tests / workload in CI, enable those validators in
`.mssql/environments.json`. The engine then starts its own throwaway SQL Server
with `docker run` on the runner (GitHub-hosted runners ship Docker), exactly as it
does locally — no workflow changes required.
