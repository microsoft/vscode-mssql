# Cloud Deploy — smoke harness

Fixtures that let you verify **every** Cloud Deploy feature end-to-end against a
real local SQL Server container. This README is the run guide; the full coverage
matrix, architecture, and failure triage live in
[`planning/testing/smoke-test.md`](../../../../planning/testing/smoke-test.md)
and the part-by-part runbook in
[`planning/testing/steps.md`](../../../../planning/testing/steps.md) (both outside
this repo, in the planning workspace).

> Not product code — nothing here ships in the `.vsix`. It lives at the repo root
> (`samples/`), outside `extensions/mssql/`, so it can't be bundled. It only does
> something when you copy `environments.json` into a workspace's `.mssql/` and run
> the validators in the Extension Development Host (F5).

## What's here

```
samples/cloudDeploy/smoke/
├── environments.json                 ← all envs (copy to <workspace>/.mssql/environments.json)
├── connection-profile-template.json  ← shape of the saved connection profile (no secrets)
├── docker/                           ← SQL Server 2022 + tSQLt image (see docker/init/README.md)
├── sqlproj/                          ← sample sqlproj that trips SQL71558
├── dacpac/                           ← where the built dacpacs go (see dacpac/README.md) 🚧
├── sql/                              ← helper scripts (flip the failing test for the compare check)
├── workload/                           ← workload + baseline + replay tools
└── corrupt-sample.cdrun.zip          ← invalid run artifact for the reader-error check
```

## Prerequisites (one-time)

| #   | Component        | How                                                                                                 |
| --- | ---------------- | --------------------------------------------------------------------------------------------------- |
| 1   | Docker Desktop   | <https://docker.com/products/docker-desktop>; verify `docker --version`                             |
| 2   | Node 18+ / npm   | already required by vscode-mssql                                                                    |
| 3   | `sqlpackage` CLI | `dotnet tool install -g Microsoft.SqlPackage` (or the standalone zip); verify `sqlpackage /Version` |
| 4   | Vendored tSQLt   | see [`docker/init/README.md`](docker/init/README.md)                                                |

## Run

All paths in `environments.json` are repo-relative to the vscode-mssql root, so
run the EDH with the **repo root as the open workspace folder**.

1. **Start the container** (builds the image, installs tSQLt, seeds tests):
    ```powershell
    $env:MSSQL_SA_PASSWORD = "Your_Strong_Pass_w0rd!"
    cd samples/cloudDeploy/smoke/docker
    docker compose up --build
    ```
2. **Place the environments file** at the workspace root:
    ```powershell
    New-Item -ItemType Directory -Force .mssql | Out-Null
    Copy-Item samples/cloudDeploy/smoke/environments.json .mssql/environments.json
    ```
3. **Launch the EDH** — press <kbd>F5</kbd> in vscode-mssql.
4. **Save the connection profile(s)** through the vscode-mssql UI (Command Palette →
   _MS SQL: Add Connection_). Server `localhost,1433`, user `sa`, **Trust server
   certificate = yes**:
    - profile **`smoke-local-container`**, database `SmokeDb` (the main profile).
    - profile **`smoke-local-master`**, database `master` (only for the no-tSQLt
      check, env `smoke-notsqlt`).
5. **Validate environments** (Command Palette → _Cloud Deploy: Validate
   environment_), following the env → part map below.
6. **Inspect the dashboard** — open the Cloud Deploy hub and walk the runs.

When done: `docker compose down` and optionally delete `.mssql/runs/`.

## Environments

The first three are the base end-to-end checks; the rest extend coverage to every
validator outcome. Each maps to a Part in `steps.md`.

| Env id                      | Part              | Expected outcome                                                          |
| --------------------------- | ----------------- | ------------------------------------------------------------------------- |
| `smoke-container`           | 6, 10, 11, 23, 28 | Connectivity Passed · UnitTests Failed (1/1)                              |
| `smoke-sqlproj`             | 7, 20             | Static Analysis Skipped (`SQLPROJ_REQUIRES_BUILD`)                        |
| `smoke-workload`            | 8                 | WorkloadPlayback Failed (latency, step-2)                                 |
| `smoke-workload-pass`       | 16                | WorkloadPlayback **Passed**, zero regressions                             |
| `smoke-workload-throughput` | 17                | WorkloadPlayback Failed — **throughput + error-rate** findings            |
| `smoke-bad-conn`            | 18                | Connectivity **Failed** → rest **Gated/Skipped**                          |
| `smoke-dacpac`              | 19 🚧             | Static Analysis Failed (`SQL71558`) — needs dacpac (.NET SDK)             |
| `smoke-dacpac-clean`        | 40 🚧             | Static Analysis **Passed**, zero findings — needs clean dacpac            |
| `smoke-workload-slow`       | 22 ~              | Long-running replay (~20s); timeout has no UI knob — see note in steps.md |
| `smoke-notsqlt`             | 34                | Connectivity Passed · UnitTests **Skipped** (no tSQLt)                    |
| `smoke-workload-errored`    | 35                | WorkloadPlayback **Errored** (replay binary not found)                    |
| `smoke-disabled`            | 36                | UnitTests **not run** (no result row); Connectivity runs                  |
| `smoke-workload-missing`    | 37                | WorkloadPlayback **Skipped** (artifact not found)                         |

Parts **20, 23, 24, 25, 26, 27, 28, 29, 30, 31, 38, 39** reuse the envs/runs above
plus UI actions — no extra env. Parts **32, 33** are 🚧 (multi-root / non-Windows).
Part **21** (custom `failOn`) is **out of scope** — that feature is not implemented
(deferred, TBD-7), so there is nothing to test.

## Manual prep (a few things can't be scripted)

1. **Connection profiles** — save `smoke-local-container` and `smoke-local-master`
   through the UI (step 4 above). `smoke-bad-conn` (Part 18) needs none — its
   profile id is intentionally non-existent so Connectivity fails to resolve it.
2. **Part 23** (compare status-changed) — between two `smoke-container` runs, run
   `sql/flip-failing-test-to-pass.sql` against `SmokeDb`, then
   `sql/restore-failing-test.sql` to revert.
3. **Part 25** (reader error) — copy `corrupt-sample.cdrun.zip` into
   `<workspace>/.mssql/runs/`, refresh the tree, confirm a graceful error, delete.
4. **Parts 19 & 40** (real dacpac analysis) — build `dacpac/SmokeProject.dacpac`
   and `dacpac/SmokeProjectClean.dacpac` on a machine with the **.NET SDK** (see
   `dacpac/README.md`). 🚧 Blocked without an SDK.
5. **Part 38** — temporarily rename/corrupt `environments.json` to test the loader.

## Workload replay tools (`workload/`)

- **`fake-replay.mjs` / `.cmd`** — base replay; trips one latency regression on
  `step-2-regression` (env `smoke-workload`).
- **`modal-replay.mjs`** — modal replay double selected by its `.cmd` shim:
    - `replay-pass.cmd` → within tolerance, **0 regressions** (Part 16).
    - `replay-throughput.cmd` → throughput ×0.5 + error rate 0.10, paired with
      `throughput-workload.json` / `throughput-baseline.json` (Part 17).
    - `replay-slow.cmd` → sleeps ~20s then passes (Part 22).
- The `.cmd` shims exist because the validator spawns with `shell:false` and needs
  a single directly-executable file; on macOS/Linux, `chmod +x` the `.mjs` and
  point `replayCommand` at it directly.

## D3-Part-2 viewer features

The six features added in the D3-Part-2 commit (Compare, Logs tab / event
timeline, run-detail tabs, environment stat cards, set-default environment, run
retention) are exercised by smoke-test.md §4.13–§4.15 and steps.md Parts 24–29.
