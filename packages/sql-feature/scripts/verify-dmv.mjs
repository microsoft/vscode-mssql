/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from "node:child_process";
import { waitStats } from "../dist/diagnostics/dmv/index.js";

const container = process.argv[2];
if (!container) throw new Error("Supply a development SQL Server container name.");
for (const showBackground of [false, true]) {
    const query = waitStats
        .sql({ showBackground })
        .replace("sys.dm_os_wait_stats", "@waits")
        .replace("SELECT TOP", "INSERT @actual SELECT TOP");
    const sql = `SET NOCOUNT ON;
DECLARE @waits TABLE(wait_type nvarchar(120), wait_time_ms bigint, waiting_tasks_count bigint, signal_wait_time_ms bigint);
INSERT @waits VALUES ('SOS_WORK_DISPATCHER',10000,100,0), ('PAGEIOLATCH_SH',15,10,5), ('LCK_M_X',5,2,0);
DECLARE @actual TABLE(wait_type nvarchar(120), wait_time_ms bigint, waiting_tasks_count bigint, avg_wait_ms float, signal_wait_time_ms bigint, resource_wait_time_ms bigint, pct_of_total float);
${query};
IF NOT EXISTS (SELECT 1 FROM @actual WHERE wait_type='PAGEIOLATCH_SH' AND avg_wait_ms=1.5 AND resource_wait_time_ms=10) THROW 51000, 'Wait averages/resources incorrect',1;
IF (SELECT COUNT(*) FROM @actual) <> ${showBackground ? 3 : 2} THROW 51000, 'Background filter incorrect',1;
${showBackground ? "IF NOT EXISTS(SELECT 1 FROM @actual WHERE wait_type='SOS_WORK_DISPATCHER' AND pct_of_total=99.8) THROW 51000,'Unfiltered denominator incorrect',1;" : "IF NOT EXISTS(SELECT 1 FROM @actual WHERE wait_type='PAGEIOLATCH_SH' AND pct_of_total=75) THROW 51000,'Filtered denominator incorrect',1;"}`;
    const result = spawnSync(
        "docker",
        [
            "exec",
            "-i",
            container,
            "bash",
            "-lc",
            'export SQLCMDPASSWORD="${MSSQL_SA_PASSWORD:-$SA_PASSWORD}"; /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -b',
        ],
        { input: sql, encoding: "utf8" },
    );
    if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`);
    process.stdout.write(`PASS wait statistics with background=${showBackground}\n`);
}
