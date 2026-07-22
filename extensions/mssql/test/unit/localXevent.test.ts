/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    LOCAL_XEVENT_TEMPLATE,
    LocalXeventPolicyError,
    buildReadLocalXeventFilePathSql,
    buildAnalyzeLocalXeventSql,
    buildStartLocalXeventSql,
    buildStopLocalXeventSql,
    extractLocalXelFromDockerArchive,
    localXeventSessionName,
    validateLocalXelServerPath,
    workloadApplicationName,
} from "../../src/runbookStudio/runtime/localXevent";

suite("Runbook Studio local XEvent policy", () => {
    test("derives a safe session and bounded developer template", () => {
        const session = localXeventSessionName(`effect-${"1".repeat(64)}`);
        const start = buildStartLocalXeventSql(session, LOCAL_XEVENT_TEMPLATE, 16);
        expect(session).to.match(/^rbs_xe_[a-f0-9]{24}$/);
        expect(start).to.contain(`CREATE EVENT SESSION [${session}] ON SERVER`);
        expect(start).to.contain("sqlserver.error_reported");
        expect(start).to.contain("sqlserver.rpc_completed");
        expect(start).to.contain("sqlserver.sql_batch_completed");
        expect(start).to.contain("max_rollover_files=(1)");
        expect(buildReadLocalXeventFilePathSql(session)).to.contain("XelFilePath");
        const stop = buildStopLocalXeventSql(session);
        expect(stop).to.contain(`DROP EVENT SESSION [${session}]`);
        expect(stop).to.contain("sys.fn_xe_file_target_read_file");
        expect(stop).to.contain("EventCount");
    });

    test("refuses invented templates, oversized targets, and foreign paths", () => {
        const session = localXeventSessionName("owned-effect");
        expect(() => buildStartLocalXeventSql(session, "arbitrary-events", 16)).to.throw(
            LocalXeventPolicyError,
        );
        expect(() => buildStartLocalXeventSql(session, LOCAL_XEVENT_TEMPLATE, 65)).to.throw(
            LocalXeventPolicyError,
        );
        expect(() =>
            validateLocalXelServerPath(session, "/var/opt/mssql/data/foreign.xel"),
        ).to.throw(LocalXeventPolicyError);
        expect(
            validateLocalXelServerPath(session, `/var/opt/mssql/log/${session}_0_123456789.xel`),
        ).to.contain(session);
    });

    test("extracts only the exact bounded XEL member from a Docker archive", () => {
        const content = Buffer.from("XEL-BINARY-CONTENT", "utf8");
        const archive = tarFile("rbs_xe_capture.xel", content);
        expect(extractLocalXelFromDockerArchive(archive, "rbs_xe_capture.xel")).to.deep.equal(
            content,
        );
        expect(() => extractLocalXelFromDockerArchive(archive, "other.xel")).to.throw(
            LocalXeventPolicyError,
        );
    });

    test("builds bounded application-correlated XEL analysis without SQL text output", () => {
        const session = localXeventSessionName("owned-effect");
        const app = workloadApplicationName("run-123");
        const sql = buildAnalyzeLocalXeventSql(
            session,
            `/var/opt/mssql/log/${session}_0_123.xel`,
            "CitiesWorkload",
            app,
        );
        expect(app).to.match(/^vscode-mssql-runbook\/[a-f0-9]{24}$/);
        expect(sql).to.contain("SELECT TOP (1000)");
        expect(sql).to.contain(`[client_app_name] = N'${app}'`);
        expect(sql).to.contain("[database_name] = N'CitiesWorkload'");
        expect(sql).not.to.contain("AS [sql_text]");
        expect(() =>
            buildAnalyzeLocalXeventSql(
                session,
                "/var/opt/mssql/data/foreign.xel",
                "CitiesWorkload",
                app,
            ),
        ).to.throw(LocalXeventPolicyError);
    });
});

function tarFile(fileName: string, content: Buffer): Buffer {
    const header = Buffer.alloc(512);
    header.write(fileName, 0, 100, "utf8");
    header.write("0000644\0", 100, 8, "ascii");
    header.write("0000000\0", 108, 8, "ascii");
    header.write("0000000\0", 116, 8, "ascii");
    header.write(`${content.length.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
    header.write("00000000000\0", 136, 12, "ascii");
    header.fill(32, 148, 156);
    header[156] = 48;
    header.write("ustar\0", 257, 6, "ascii");
    const checksum = header.reduce((sum, value) => sum + value, 0);
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
    const padding = Buffer.alloc(Math.ceil(content.length / 512) * 512 - content.length);
    return Buffer.concat([header, content, padding, Buffer.alloc(1024)]);
}
