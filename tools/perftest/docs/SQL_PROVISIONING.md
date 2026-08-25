# SQL provisioning

How the harness puts SQL Server into a known, deterministic state before
measurement (design §13.4). Implementation:
`packages/perftest-cli/src/sql/sqlProvisioner.ts`; assets under `sql/`.

## Providers

### `dockerCompose` (primary)

`sql/docker-compose.sqlserver.yml` — SQL Server 2022, **pinned by image
digest** (never a floating tag), port `14333`, SA password from
`PERF_SQL_SA_PASSWORD` (synthetic default supplied), seed directory mounted
read-only at `/perf-seed`, container healthcheck via in-container sqlcmd.

Provisioning: `docker compose up -d --wait` → seed scripts applied via
sqlcmd **inside** the container → verify query must return the expected value
or provisioning fails the run (exit 5). The container is reused across runs
(warm-cache default); set `sql.recycleContainer: true` to tear down after.

### `external` (fallback / dev)

Any reachable SQL Server. The ADO.NET connection string comes from the env
var named by `sql.connectionStringEnv` (default `STS2_SQLSERVER_CONNSTRING`).
Supports SQL logins and Windows Integrated auth. Seeding runs through host
`sqlcmd` (works with both classic ODBC sqlcmd and go-sqlcmd; the password
travels in `SQLCMDPASSWORD`, never on a command line).

Self-contained scenarios can set `sql.provisionSeed: false`. In that mode the
harness performs no seed or verification mutation and hands the driver a
profile for the database already named by the external connection string. The
config should use a truthful snapshot label such as `external-existing`; this
mode is intended for read-only fixtures and does not claim seed determinism.

## Seed (`sql/seed/create-perf-db.sql`, snapshot `seed-v1`)

Fully deterministic, non-sensitive, idempotent (drop + recreate `PerfHarness`):

- `dbo.PerfRows` — exactly 10,000 rows, fixed content (no NEWID/GETDATE),
  fixed-width payload. The query fixture (`sql/seed/query-10k.sql`, also at
  `workspaces/perf/queries/select-10000.sql`) returns exactly these rows.
- OE shape: schemas `sales`/`reporting`, 4 tables, a view, a proc, a
  function, small deterministic data — for Object Explorer expand scenarios.

Every provisioning pass re-applies the seed and then **verifies**
`SELECT COUNT(*) FROM PerfHarness.dbo.PerfRows` returns 10000. No
verification, no run.

## Connection profiles

The provisioner emits a `ConnectionProfileSpec` (server, database, auth type,
credentials) which the orchestrator ships to the driver inside the
`startScenario` payload — profile _names_ are logged, contents never. The
driver's `mssqlConnect` step uses it through the product's own test seam
(`mssql.getControllerForTests` → `connectionManager.connect`), so the
measured connection flow is the product's real one.

## Redaction rules (design §29)

- Connection strings and passwords never reach logs, markers, results, or
  SQLite — provisioner log lines carry server host + flags only, and sqlcmd
  error text is regex-redacted before surfacing.
- Perf databases contain synthetic data only. SQL text capture stays off.

## Cache modes

`warm` (default): seed + verify acts as the warmup; buffers stay warm across
reps. `coldDb`/`coldOs` are defined by the design but not implemented yet —
configs asking for them fail honestly rather than mislabeling a warm run.

## Phase-3 fixtures

| Fixture                | Shape                                                                                                                                | Used by                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `dbo.PerfRows100k`     | 100,000 deterministic rows (Id = correctness key)                                                                                    | large-result-100k, query-large-scroll-virtual-window |
| `dbo.PerfBlobs`        | 20 rows: 256KB VARBINARY + XML + NVARCHAR(MAX)                                                                                       | query-blob-xml                                       |
| `PerfCatalog` database | exactly 10,000 tables t00000..t09999 (skip-guarded rebuild; verified `COUNT(*) FROM PerfCatalog.sys.tables = 10000` at provisioning) | expand-tables-node-10k                               |

The catalog seed only runs when a selected scenario declares
`sql.database: "PerfCatalog"`, and skips itself when the catalog is already
intact. Scenario-level `sql.database` overrides the connection profile the
driver uses (the OE tree is then database-scoped).

## coldDb cache mode

`sql.cacheMode: "coldDb"` issues `DBCC DROPCLEANBUFFERS; DBCC FREEPROCCACHE`
before each rep (requires sysadmin on the target instance) so SQL starts with
cold buffer/plan caches; the reset is recorded in the harness log. Container
restart per rep ("cold" for the whole instance) remains a docker-provider
concern.

## Seed determinism note

Two truncation traps found by the seed verify (kept here so they aren't
re-learned): `REPLICATE` truncates at 4000/8000 unless its FIRST argument is
cast to `(N)VARCHAR(MAX)`, and `CAST(n AS CHAR(1))` overflows for n >= 10.
