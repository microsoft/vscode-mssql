/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { spawnSync } from "node:child_process";
import { startJobSql, stopJobSql, deleteJobSql, setJobEnabledSql } from "../dist/agent/index.js";
const container = process.argv[2];
if (!container) throw Error("Supply a development SQL Server container name.");
const id = "01234567-89ab-cdef-0123-456789abcdef";
const commands = [
    startJobSql(id),
    stopJobSql(id),
    deleteJobSql(id),
    setJobEnabledSql(id, true),
    setJobEnabledSql(id, false),
];
const setup = `SET NOCOUNT ON;
CREATE TABLE #outcome(value int);
GO
CREATE PROCEDURE #operation @job_id uniqueidentifier, @delete_unused_schedule bit=0, @delete_history bit=0, @enabled bit=0 AS
BEGIN
 DECLARE @code int=(SELECT value FROM #outcome);
 RETURN @code;
END;
GO
`;
for (const code of [0, 1]) {
    const batches = commands
        .map(
            (command, index) => `DELETE #outcome; INSERT #outcome VALUES(${code});
DECLARE @caught${index} bit=0;
BEGIN TRY
${command.replace(/msdb\.dbo\.sp_\w+/g, "#operation").replaceAll("@returnCode", `@returnCode${index}`)}
END TRY BEGIN CATCH SET @caught${index}=1; END CATCH;
IF @caught${index}<>${code} THROW 51000,'Incorrect job action result',1;`,
        )
        .join("\n");
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
        { input: setup + batches, encoding: "utf8" },
    );
    if (result.status !== 0) throw Error(result.stdout + result.stderr);
    console.log(`PASS all job actions with return code ${code}`);
}
