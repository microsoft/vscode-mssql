/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { spawnSync } from "node:child_process";
import { createJobSql } from "../dist/agent/index.js";
const container = process.argv[2];
if (!container) throw new Error("Supply a development SQL Server container name.");
// Temporary procedures simulate Agent return-code and raised-error failures. No jobs are created.
const setup = `SET NOCOUNT ON;
CREATE TABLE #effects(kind nvarchar(20));
CREATE TABLE #scenario(failure int);
GO
CREATE PROCEDURE #add_job @job_name sysname, @description nvarchar(512), @enabled bit, @job_id uniqueidentifier OUTPUT AS
BEGIN
 INSERT #effects VALUES('job');
 SET @job_id=NEWID();
 RETURN 0;
END;
GO
CREATE PROCEDURE #add_step @job_id uniqueidentifier, @step_id int, @step_name sysname, @subsystem sysname,
 @database_name sysname, @command nvarchar(max), @on_success_action int, @on_fail_action int, @retry_attempts int, @retry_interval int AS
BEGIN
 INSERT #effects VALUES('step');
 IF @step_id=2 AND EXISTS(SELECT 1 FROM #scenario WHERE failure=1) RETURN 1;
 IF @step_id=2 AND EXISTS(SELECT 1 FROM #scenario WHERE failure=2) THROW 51001,'Fixture step error',1;
 RETURN 0;
END;
GO
CREATE PROCEDURE #add_schedule @job_id uniqueidentifier, @name sysname, @enabled bit, @freq_type int,
 @freq_interval int, @freq_recurrence_factor int, @freq_subday_type int, @freq_subday_interval int, @active_start_date int,
 @active_end_date int, @active_start_time int, @active_end_time int AS
BEGIN
 INSERT #effects VALUES('schedule');
 IF EXISTS(SELECT 1 FROM #scenario WHERE failure=4) RETURN 1;
 RETURN 0;
END;
GO
CREATE PROCEDURE #add_server @job_id uniqueidentifier, @server_name sysname AS
BEGIN
 INSERT #effects VALUES('server');
 IF EXISTS(SELECT 1 FROM #scenario WHERE failure=3) RETURN 1;
 RETURN 0;
END;
GO
`;
const batch = createJobSql({
    name: "Fixture",
    enabled: false,
    schedule: {
        name: "Fixture schedule",
        kind: "weekly",
        startDate: "2028-02-29",
        startTime: "00:00",
        weekdays: [1, 3],
        every: 2,
    },
    steps: [
        { name: "First", command: "SELECT 1", database: "master" },
        { name: "Second", command: "SELECT 2", database: "master" },
    ],
})
    .replaceAll("msdb.dbo.sp_add_jobschedule", "#add_schedule")
    .replaceAll("msdb.dbo.sp_add_jobserver", "#add_server")
    .replaceAll("msdb.dbo.sp_add_jobstep", "#add_step")
    .replaceAll("msdb.dbo.sp_add_job", "#add_job");
for (const failure of [0, 1, 2, 3, 4]) {
    const sql = `${setup}
INSERT #scenario VALUES(${failure});
DECLARE @caught bit=0;
BEGIN TRY
${batch}
END TRY
BEGIN CATCH
 SET @caught=1;
END CATCH;
IF @caught <> ${failure ? 1 : 0} THROW 51000,'Incorrect creation outcome',1;
IF @@TRANCOUNT <> 0 THROW 51000,'Creation leaked a transaction',1;
IF (SELECT COUNT(*) FROM #effects) <> ${failure ? 0 : 5} THROW 51000,'Partial creation was not rolled back',1;`;
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
    process.stdout.write(`PASS Agent creation atomicity scenario ${failure}\n`);
}
