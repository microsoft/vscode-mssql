# Cloud Deploy CLI — `run-gates`

Runs the Cloud Deploy validation engine **headlessly** (no VS Code), producing
the same `.cdrun.zip` artifact the extension writes. This is the keystone that
lets the identical validation gates run locally and in CI (GitHub Actions).

> **Current scope:** all four gates run headlessly. Static analysis needs only
> .NET; the DB-backed gates (connectivity, unit tests, workload playback) stand
> up a throwaway SQL container, so they need **Docker** and `sqlpackage`
> available — the same prerequisites as a local F5 run. A run with only static
> analysis enabled needs no Docker.

## Synopsis

```
mssql-validate run-gates --env <env-id> --config <path> --out <path> [options]
```

Today the CLI runs from the compiled output (distribution packaging is not yet
finalized):

```
node out/src/cloudDeploy/cli/runGates.js run-gates \
  --env dev \
  --config .mssql/environments.json \
  --out run.cdrun.zip
```

## Flags

| Flag                    | Required | Meaning                                                        |
| ----------------------- | -------- | -------------------------------------------------------------- |
| `--env <env-id>`        | yes      | Environment id to validate (must exist in the config)          |
| `--config <path>`       | yes      | Path to `.mssql/environments.json`                             |
| `--out <path>`          | yes      | Destination for the produced `.cdrun.zip`                      |
| `--workspace <dir>`     | no       | Source-path root (default: the config file's grandparent)      |
| `--source-commit <sha>` | no       | Git commit the run validated (reserved; not yet used)          |
| `--source-ref <ref>`    | no       | PR number / ref the run validated (reserved; not yet used)     |
| `--baseline <path>`     | no       | Baseline `.cdrun.zip` to diff against (reserved; not yet used) |
| `-h`, `--help`          | no       | Print usage and exit                                           |

## Exit codes

| Code  | Meaning                                                     |
| ----- | ----------------------------------------------------------- |
| `0`   | Run completed; worst status was Passed, Skipped, or Warning |
| `1`   | A gate Failed or Errored                                    |
| `2`   | Usage error (bad flag, config not found, env id not found)  |
| `130` | Cancelled                                                   |

## Output

- **stdout:** a one-line-per-validation summary plus the artifact path.
- **stderr:** live progress (one line per diagnostic event).
- **The artifact:** a standard `.cdrun.zip` (`manifest.json` = the run record,
  `events.jsonl` = the diagnostic stream). It opens in the VS Code Cloud Deploy
  dashboard with no special-casing — local and CI runs are interchangeable.
