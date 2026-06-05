#!/bin/bash
# ---------------------------------------------------------------------------
#  Cloud Deploy smoke harness — container entrypoint.
#  Starts SQL Server in the background, waits for it to accept connections,
#  then runs the numbered init scripts in order: create SmokeDb (against
#  master), then install tSQLt + create the test class + tests (against
#  SmokeDb). Finally hands the foreground back to the SQL Server process so
#  the container stays alive. The provisioning step is idempotent, so the
#  container can be safely restarted by the compose restart policy.
# ---------------------------------------------------------------------------
set -euo pipefail

/opt/mssql/bin/sqlservr &
SQLSERVR_PID=$!

/opt/init/00-wait-for-sqlserver.sh

# Idempotency guard: when the container is restarted (e.g. by the compose
# restart policy) its writable layer still holds SmokeDb + tSQLt, so re-running
# the init scripts would fail on "database already exists". Detect a prior
# provisioning and skip init in that case.
provisioned="no"
db_id=$(sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -h -1 -W \
    -Q "SET NOCOUNT ON; SELECT CASE WHEN DB_ID('SmokeDb') IS NULL THEN 'no' ELSE 'yes' END" \
    2>/dev/null | tr -d '[:space:]') || db_id="no"
if [ "$db_id" = "yes" ]; then
    provisioned=$(sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -d SmokeDb -h -1 -W \
        -Q "SET NOCOUNT ON; SELECT CASE WHEN EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'tSQLt') THEN 'yes' ELSE 'no' END" \
        2>/dev/null | tr -d '[:space:]') || provisioned="no"
fi

if [ "$provisioned" = "yes" ]; then
    echo "[smoke-init] SmokeDb already provisioned; skipping init."
else
    echo "[smoke-init] Creating SmokeDb..."
    sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -b -i /opt/init/05-create-database.sql

    for script in 10-install-tsqlt 20-create-test-class 30-create-tests; do
        echo "[smoke-init] Running ${script}.sql against SmokeDb..."
        sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -b -d SmokeDb -i "/opt/init/${script}.sql"
    done

    echo "[smoke-init] SmokeDb ready (tSQLt installed, testSampleClass created)."
fi

wait "$SQLSERVR_PID"
