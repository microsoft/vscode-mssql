/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { expect } from "chai";
import { SqlExecutionError } from "sql-feature/core";
import { DataPlaneRunner } from "../../src/sqlDiagnostics/dataPlaneRunner";
import {
    ISqlSession,
    QueryHandle,
    QueryCompleteSummary,
    IQueryEventSink,
} from "../../src/services/sqlDataPlane/api";

suite("SQL feature execution outcomes", () => {
    let sandbox: sinon.SinonSandbox;
    let dispose: sinon.SinonStub;
    let runner: DataPlaneRunner;
    let summary: QueryCompleteSummary;
    let message: string | undefined;
    let rejected: Error | undefined;

    setup(() => {
        sandbox = sinon.createSandbox();
        dispose = sandbox.stub().resolves();
        summary = {
            clientQueryId: "query",
            status: "succeeded",
            resultSetCount: 0,
            totalRows: 0,
            errorCount: 0,
        };
        message = undefined;
        rejected = undefined;
        const execute = (_sql: string, _options: unknown, sink: IQueryEventSink): QueryHandle => {
            if (message) void sink.onMessage({ kind: "error", text: message });
            return {
                completion: rejected ? Promise.reject(rejected) : Promise.resolve(summary),
                dispose,
            } as unknown as QueryHandle;
        };
        runner = new DataPlaneRunner({ execute } as unknown as ISqlSession);
    });
    teardown(() => sandbox.restore());

    async function failure(): Promise<SqlExecutionError> {
        try {
            await runner.query("SELECT 1");
            expect.fail("Expected execution to fail");
        } catch (error) {
            expect(error).to.be.instanceOf(SqlExecutionError);
            expect(dispose).to.have.been.called;
            return error as SqlExecutionError;
        }
    }

    test("completed-with-errors is a failure and retains the server message", async () => {
        summary.status = "completedWithErrors";
        summary.errorCount = 1;
        message = "Constraint violation";
        const error = await failure();
        expect(error.message).to.equal(message);
        expect(error.outcomeCertainty).to.equal("known");
    });
    test("an error message cannot be hidden by a successful summary", async () => {
        message = "Write rejected";
        expect((await failure()).message).to.equal(message);
    });
    test("error count alone cannot report a successful action", async () => {
        summary.errorCount = 1;
        await failure();
    });
    test("transport loss preserves uncertainty", async () => {
        summary.status = "connectionLost";
        expect((await failure()).outcomeCertainty).to.equal("unknown");
    });
    test("rejected completion preserves uncertainty and disposes its handle", async () => {
        rejected = new Error("Transport rejected");
        expect((await failure()).outcomeCertainty).to.equal("unknown");
    });
    test("cleanup failure cannot reverse an acknowledged success", async () => {
        dispose.rejects(new Error("Cleanup failed"));
        expect((await runner.query("SELECT 1")).rows).to.deep.equal([]);
    });
    test("query preserves truncated cells and requests retention", async () => {
        let executeOptions: Record<string, unknown> | undefined;
        const session = {
            execute: (_sql: string, options: Record<string, unknown>, sink: IQueryEventSink) => {
                executeOptions = options;
                void sink.onResultSetStarted({
                    resultSetId: "result",
                    batchOrdinal: 0,
                    columns: [
                        {
                            ordinal: 0,
                            name: "Body",
                            displayName: "Body",
                            sqlType: "nvarchar",
                        },
                    ],
                });
                void sink.onRowsPage({
                    resultSetId: "result",
                    pageSeq: 0,
                    rowOffset: 0,
                    compact: {
                        values: [[{ $t: "truncated", of: "string", bytes: 4096, v: "prefix" }]],
                    },
                    rowCount: 1,
                    approxBytes: 6,
                    complete: true,
                });
                return {
                    completion: Promise.resolve(summary),
                    dispose,
                } as unknown as QueryHandle;
            },
        } as unknown as ISqlSession;

        const result = await new DataPlaneRunner(session).query("SELECT Body", {
            maxCellBytes: 64,
            retainOversizedCells: true,
        });

        expect(executeOptions).to.include({ maxCellBytes: 64, retainOversizedCells: true });
        expect(result.truncated).to.equal(true);
        expect(result.rows[0].Body).to.deep.equal({
            $t: "truncated",
            of: "string",
            bytes: 4096,
            v: "prefix",
        });
    });
    test("stream completion with errors cannot report success", async () => {
        summary.status = "completedWithErrors";
        const stream = runner.stream("SELECT 1", () => undefined);
        expect((await stream.completed).status).to.equal("failed");
        await stream.dispose();
    });
    test("stream errors cannot be hidden by a successful terminal", async () => {
        summary.errorCount = 1;
        const stream = runner.stream("SELECT 1", () => undefined);
        expect((await stream.completed).status).to.equal("failed");
        await stream.dispose();
    });
});
