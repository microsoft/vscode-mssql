# MSSQL VS Code Performance Harness (`perftest`)

A local-first, deterministic, end-to-end performance harness for the
[MSSQL for VS Code](../..) extension and
[SQL Tools Service](https://github.com/microsoft/sqltoolsservice). It launches the real, unforked VS Code,
drives real product scenarios through an automation extension, measures them with
semantic markers, proves success semantically, stores history in SQLite, and gates
regressions — with heavy diagnostics available on demand without ever contaminating
the official numbers.

This project now lives inside `vscode-mssql` at `tools/perftest`. See
[`UPSTREAM.md`](UPSTREAM.md) for import provenance and migration policy.

**Historical design source:** `perftest-docs/mssql-vscode-perf-system-v2/MSSQL_VSCODE_PERF_SYSTEM_DESIGN.md`
(not imported; the implementation documentation below is self-contained).
**Docs for this implementation:** [`docs/`](docs/README.md)
**Historical build log:** [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) · [`PROGRESS.md`](PROGRESS.md)

## Layout

```text
packages/perf-contracts    Shared contracts: JSON schemas (verbatim from the design),
                           TS types, runtime validators, SQLite store schema, fixtures.
packages/perftest-cli      The perftest orchestrator CLI: doctor, run, report, compare,
                           baselines, store, collectors, scenario registry.
extensions/mssql-perf-driver  Automation (driver) extension loaded into VS Code (M1).
sql/                       SQL Server provisioning: compose file, seed, XEvents (M4).
docs/                      Implementation documentation.
perf-runs/                 Run output (gitignored): one folder per runId.
```

## Quick start

```powershell
cd tools/perftest
npm install
npm run build
npm test

node packages/perftest-cli/dist/cli.js doctor
node packages/perftest-cli/dist/cli.js scenarios list
node packages/perftest-cli/dist/cli.js schema validate packages/perf-contracts/fixtures/result.example.json
```

From the repository root, the equivalent convenience commands are
`npm run perftest:install`, `npm run perftest:build`, `npm run perftest:test`,
and `npm run perftest -- <arguments>`.

The registry is intentionally imported intact. Unit tests validate the harness
itself and run in this first tooling change; end-to-end product scenarios are
always opt-in and should only be selected once their corresponding product
feature has landed on the branch being measured.

## Non-negotiable rules (short form)

1. VS Code is never forked; we measure the product as it ships.
2. Official metrics come only from markers/explicit product timers in a measurement pass.
3. Every product change is gated on `PERF_MODE=1`; flag off ⇒ zero behavior change.
4. Every run is reproducible from its config snapshot + environment hash.
5. A scenario that cannot prove success is `invalid` — never fast, never slow.
6. No metric is ever fabricated. Missing data ⇒ no metric.
7. No `sleep` in official action paths; semantic waits only. SQL image pinned by digest.
8. No sensitive data by default (no SQL text, result data, connection strings, tokens).

See [`docs/README.md`](docs/README.md) for the full documentation set.
