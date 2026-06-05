# Smoke harness Docker image (SQL Server 2022 + tSQLt)

This image gives the Cloud Deploy smoke a live SQL Server target with tSQLt
preinstalled and one passing + one failing test, so the **Connectivity** and
**UnitTests** validators run end-to-end against real infrastructure.

## tSQLt (vendored)

`init/10-install-tsqlt.sql` is the real tSQLt install script (`tSQLt.class.sql`),
vendored from the official distribution:

- **Version:** V1.0.8083.3529 (2022-02-16)
- **Source:** <https://tsqlt.org/download/tsqlt/>
- **License:** Apache-2.0 — see `tSQLt-LICENSE.txt` in this folder.

`PrepareServer.sql` is intentionally **not** vendored;
`init/05-create-database.sql` already enables CLR, disables CLR strict security,
and sets `SmokeDb` TRUSTWORTHY ON. To refresh tSQLt, download a newer ZIP,
extract `tSQLt.class.sql`, and overwrite `init/10-install-tsqlt.sql` (keep the
filename).

## Build and run

From this `docker/` directory:

```powershell
$env:MSSQL_SA_PASSWORD = "Your_Strong_Pass_w0rd!"
docker compose up --build
```

The container listens on `localhost,1433`. The init scripts run automatically
in order (see `init/entrypoint.sh`):

| Script                     | Runs against | Purpose                                      |
| -------------------------- | ------------ | -------------------------------------------- |
| `00-wait-for-sqlserver.sh` | —            | Poll until SQL Server accepts connections    |
| `05-create-database.sql`   | master       | Create `SmokeDb`, enable CLR, TRUSTWORTHY ON |
| `10-install-tsqlt.sql`     | SmokeDb      | Install tSQLt (vendored V1.0.8083.3529)      |
| `20-create-test-class.sql` | SmokeDb      | `tSQLt.NewTestClass 'testSampleClass'`       |
| `30-create-tests.sql`      | SmokeDb      | One passing + one failing test               |

## Verify the container by hand

```powershell
# tSQLt schema exists:
sqlcmd -S localhost,1433 -U sa -P "$env:MSSQL_SA_PASSWORD" -C -d SmokeDb -Q "SELECT 1 FROM sys.schemas WHERE name = 'tSQLt'"

# Tests run with one Failure:
sqlcmd -S localhost,1433 -U sa -P "$env:MSSQL_SA_PASSWORD" -C -d SmokeDb -Q "EXEC tSQLt.RunAll; SELECT Class, TestCase, Result FROM tSQLt.TestResult ORDER BY Id"
```

## Tear down

```powershell
docker compose down
```

## Notes

- This image is **dev/smoke only**. It disables CLR strict security and sets a
  database TRUSTWORTHY ON — never do that on anything but a throwaway local
  container.
- The image is untested at authoring time because the harness machine had no
  Docker installed. First-run issues are most likely in `init/entrypoint.sh`
  tooling paths (`mssql-tools18`) — see `planning/testing/smoke-test.md` §7.
