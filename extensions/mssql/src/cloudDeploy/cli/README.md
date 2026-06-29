# Cloud Deploy CLI — `run-gates`

Runs the Cloud Deploy validation engine **headlessly** (no VS Code), producing
the same `.cdrun.zip` artifact the extension writes. This is the keystone that
lets the identical validation gates run locally and in CI (GitHub Actions).

> **Scope (D2.1):** static analysis only. DB-backed gates (connectivity, unit
> tests, workload playback) need the Node connection seam landing in D2.2; until
> then a run that enables them reports them as Skipped/Errored, not a crash.

## Synopsis

```
mssql-validate run-gates --env <env-id> --config <path> --out <path> [options]
```

Today the CLI is run from the compiled output (packaging as an npm package /
GitHub Action is decided in D2.3):

```
node out/src/cloudDeploy/cli/runGates.js run-gates \
  --env dev \
  --config .mssql/environments.json \
  --out run.cdrun.zip
```

## Flags

| Flag                    | Required | Meaning                                                      |
| ----------------------- | -------- | ------------------------------------------------------------ |
| `--env <env-id>`        | yes      | Environment id to validate (must exist in the config)        |
| `--config <path>`       | yes      | Path to `.mssql/environments.json`                           |
| `--out <path>`          | yes      | Destination for the produced `.cdrun.zip`                    |
| `--workspace <dir>`     | no       | Source-path root (default: the config file's grandparent)    |
| `--source-commit <sha>` | no       | Git commit the run validated (stamped on the record in D2.4) |
| `--source-ref <ref>`    | no       | PR number / ref the run validated (stamped in D2.4)          |
| `--baseline <path>`     | no       | Baseline `.cdrun.zip` to diff against (wired in D2.4)        |
| `-h`, `--help`          | no       | Print usage and exit                                         |

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
