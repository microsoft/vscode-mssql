#!/bin/bash
# ---------------------------------------------------------------------------
#  Polls SQL Server until it accepts a trivial query, or times out at 60s.
# ---------------------------------------------------------------------------
set -uo pipefail

echo "[smoke-init] Waiting for SQL Server to accept connections..."
for i in $(seq 1 60); do
    if sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -Q "SELECT 1" >/dev/null 2>&1; then
        echo "[smoke-init] SQL Server is up (after ${i}s)."
        exit 0
    fi
    sleep 1
done

echo "[smoke-init] ERROR: SQL Server did not become ready within 60s." >&2
exit 1
