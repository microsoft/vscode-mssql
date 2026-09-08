/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from "node:child_process";
import { jobHistory } from "../dist/agent/index.js";

const container = process.argv[2];
if (!container) throw new Error("Supply a development SQL Server container name.");
const query = jobHistory
    .sql({ jobId: "01234567-89ab-cdef-0123-456789abcdef" })
    .replace("msdb.dbo.sysjobhistory", "@history")
    .replace("msdb.dbo.sysjobs", "@jobs")
    .replace("SELECT TOP", "INSERT @actual SELECT TOP");
const sql = `SET NOCOUNT ON;
DECLARE @jobs TABLE(job_id uniqueidentifier, name sysname);
DECLARE @id uniqueidentifier = '01234567-89ab-cdef-0123-456789abcdef';
INSERT @jobs VALUES(@id, N'Fixture');
DECLARE @history TABLE(job_id uniqueidentifier, instance_id int, run_date int, run_time int,
    step_id int, step_name sysname, run_status int, run_duration int, retries_attempted int, message nvarchar(4000));
INSERT @history VALUES
(@id,1,20260907,0,1,N'Midnight',1,1,0,N''),
(@id,2,20260907,123456,2,N'Long run',1,250102,0,N''),
(@id,3,0,0,3,N'No date',0,0,0,N''),
(@id,4,20260907,0,4,N'Large duration',1,10000000,0,N'');
DECLARE @actual TABLE(run_time datetime, step_id int, step_name sysname, run_status nvarchar(20),
    run_duration_ms bigint, retries_attempted int, message nvarchar(4000), instance_id int, run_status_code int);
${query};
IF NOT EXISTS(SELECT 1 FROM @actual WHERE step_id=1 AND run_time=CONVERT(datetime,'20260907',112) AND run_duration_ms=1000)
    THROW 51000,'Midnight or seconds conversion incorrect',1;
IF NOT EXISTS(SELECT 1 FROM @actual WHERE step_id=2 AND run_duration_ms=90062000)
    THROW 51000,'Duration over 24 hours incorrect',1;
IF NOT EXISTS(SELECT 1 FROM @actual WHERE step_id=3 AND run_time IS NULL)
    THROW 51000,'Missing history date incorrect',1;
IF NOT EXISTS(SELECT 1 FROM @actual WHERE step_id=4 AND run_duration_ms=CONVERT(bigint,3600000000))
    THROW 51000,'Large duration overflow',1;`;
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
process.stdout.write(
    "PASS Agent history midnight, missing dates, duration units and long durations\n",
);
