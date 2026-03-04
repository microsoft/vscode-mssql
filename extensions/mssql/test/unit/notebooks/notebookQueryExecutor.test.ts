/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as vscode from "vscode";

chai.use(sinonChai);
import { NotebookQueryExecutor } from "../../../src/notebooks/notebookQueryExecutor";
import {
    QueryNotificationHandler,
    type IQueryEventHandler,
} from "../../../src/controllers/queryNotificationHandler";
import SqlToolsServiceClient from "../../../src/languageservice/serviceclient";
import { IDbColumn } from "../../../src/models/interfaces";

/** Creates a minimal but fully-typed IDbColumn for test data. */
function makeColumn(columnName: string, dataTypeName: string): IDbColumn {
    return {
        columnName,
        dataTypeName,
        dataType: dataTypeName,
        baseCatalogName: "",
        baseColumnName: columnName,
        baseSchemaName: "",
        baseServerName: "",
        baseTableName: "",
        udtAssemblyQualifiedName: "",
    };
}

suite("NotebookQueryExecutor", () => {
    let sandbox: sinon.SinonSandbox;
    let mockClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let mockNotificationHandler: sinon.SinonStubbedInstance<QueryNotificationHandler>;
    let executor: NotebookQueryExecutor;
    let capturedHandler: IQueryEventHandler;

    setup(() => {
        sandbox = sinon.createSandbox();

        mockClient = sandbox.createStubInstance(SqlToolsServiceClient);
        mockClient.sendRequest.resolves({});

        mockNotificationHandler = sandbox.createStubInstance(QueryNotificationHandler);
        mockNotificationHandler.registerRunner.callsFake(
            (handler: IQueryEventHandler, _uri: string) => {
                capturedHandler = handler;
            },
        );

        executor = new NotebookQueryExecutor(mockClient, mockNotificationHandler);
    });

    teardown(() => {
        sandbox.restore();
    });

    function simulateSimpleExecution(): void {
        // Simulate a simple batch with no result sets
        capturedHandler.handleBatchStart({
            batchSummary: {
                id: 0,
                hasError: false,
                selection: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
                resultSetSummaries: [],
                executionElapsed: "00:00:00.001",
                executionEnd: "",
                executionStart: "",
            },
            ownerUri: "test-uri",
        });
        capturedHandler.handleMessage({
            message: {
                batchId: 0,
                isError: false,
                time: new Date().toISOString(),
                message: "(1 row(s) affected)",
            },
            ownerUri: "test-uri",
        });
        capturedHandler.handleBatchComplete({
            batchSummary: {
                id: 0,
                hasError: false,
                selection: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
                resultSetSummaries: [],
                executionElapsed: "00:00:00.001",
                executionEnd: "",
                executionStart: "",
            },
            ownerUri: "test-uri",
        });
        capturedHandler.handleQueryComplete({
            ownerUri: "test-uri",
            batchSummaries: [],
        });
    }

    function simulateSelectExecution(): void {
        // Simulate a batch with one result set
        capturedHandler.handleBatchStart({
            batchSummary: {
                id: 0,
                hasError: false,
                selection: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
                resultSetSummaries: [],
                executionElapsed: "00:00:00.001",
                executionEnd: "",
                executionStart: "",
            },
            ownerUri: "test-uri",
        });
        capturedHandler.handleResultSetAvailable({
            resultSetSummary: {
                id: 0,
                batchId: 0,
                rowCount: 1,
                columnInfo: [makeColumn("col1", "int")],
            },
            ownerUri: "test-uri",
        });
        capturedHandler.handleResultSetComplete({
            resultSetSummary: {
                id: 0,
                batchId: 0,
                rowCount: 1,
                columnInfo: [makeColumn("col1", "int")],
            },
            ownerUri: "test-uri",
        });
        capturedHandler.handleBatchComplete({
            batchSummary: {
                id: 0,
                hasError: false,
                selection: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
                resultSetSummaries: [
                    {
                        id: 0,
                        batchId: 0,
                        rowCount: 1,
                        columnInfo: [makeColumn("col1", "int")],
                    },
                ],
                executionElapsed: "00:00:00.001",
                executionEnd: "",
                executionStart: "",
            },
            ownerUri: "test-uri",
        });
        capturedHandler.handleQueryComplete({
            ownerUri: "test-uri",
            batchSummaries: [
                {
                    id: 0,
                    hasError: false,
                    selection: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
                    resultSetSummaries: [
                        {
                            id: 0,
                            batchId: 0,
                            rowCount: 1,
                            columnInfo: [makeColumn("col1", "int")],
                        },
                    ],
                    executionElapsed: "00:00:00.001",
                    executionEnd: "",
                    executionStart: "",
                },
            ],
        });
    }

    test("registers and unregisters handler", async () => {
        // Set up immediate completion
        mockClient.sendRequest.callsFake(() => {
            simulateSimpleExecution();
            return Promise.resolve({});
        });

        await executor.execute("test-uri", "INSERT INTO t VALUES (1)");

        expect(mockNotificationHandler.registerRunner).to.have.been.calledOnce;
        expect(mockNotificationHandler.unregisterRunner).to.have.been.calledOnce;
        expect(mockNotificationHandler.unregisterRunner).to.have.been.calledWith("test-uri");
    });

    test("returns batch results with messages", async () => {
        mockClient.sendRequest.callsFake(() => {
            simulateSimpleExecution();
            return Promise.resolve({});
        });

        const result = await executor.execute("test-uri", "INSERT INTO t VALUES (1)");

        expect(result.canceled).to.be.false;
        expect(result.batches).to.have.length(1);
        expect(result.batches[0].messages).to.have.length(1);
        expect(result.batches[0].messages[0].message).to.equal("(1 row(s) affected)");
    });

    test("fetches row data for result sets", async () => {
        // First call is executeString, subsequent calls are subset + dispose
        let callCount = 0;
        mockClient.sendRequest.callsFake(
            (_type: unknown, params: Record<string, unknown> | undefined) => {
                callCount++;
                if (callCount === 1) {
                    // executeString
                    simulateSelectExecution();
                    return Promise.resolve({});
                } else if (params?.rowsStartIndex !== undefined) {
                    // subset request
                    return Promise.resolve({
                        resultSubset: {
                            rows: [[{ displayValue: "42", isNull: false }]],
                            rowCount: 1,
                        },
                    });
                }
                // dispose
                return Promise.resolve({});
            },
        );

        const result = await executor.execute("test-uri", "SELECT 1 AS col1");

        expect(result.batches).to.have.length(1);
        expect(result.batches[0].resultSets).to.have.length(1);
        expect(result.batches[0].resultSets[0].rows).to.have.length(1);
        expect(result.batches[0].resultSets[0].rows[0][0].displayValue).to.equal("42");
    });

    test("disposes query in finally block", async () => {
        mockClient.sendRequest.callsFake(() => {
            simulateSimpleExecution();
            return Promise.resolve({});
        });

        await executor.execute("test-uri", "SELECT 1");

        // Should have called sendRequest at least twice: executeString + dispose
        expect(mockClient.sendRequest.callCount).to.be.at.least(2);
    });

    test("handles error batch", async () => {
        mockClient.sendRequest.callsFake(() => {
            capturedHandler.handleBatchStart({
                batchSummary: {
                    id: 0,
                    hasError: false,
                    selection: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
                    resultSetSummaries: [],
                    executionElapsed: "00:00:00.001",
                    executionEnd: "",
                    executionStart: "",
                },
                ownerUri: "test-uri",
            });
            capturedHandler.handleMessage({
                message: {
                    batchId: 0,
                    isError: true,
                    time: new Date().toISOString(),
                    message: "Invalid object name 'nonexistent'",
                },
                ownerUri: "test-uri",
            });
            capturedHandler.handleBatchComplete({
                batchSummary: {
                    id: 0,
                    hasError: true,
                    selection: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
                    resultSetSummaries: [],
                    executionElapsed: "00:00:00.001",
                    executionEnd: "",
                    executionStart: "",
                },
                ownerUri: "test-uri",
            });
            capturedHandler.handleQueryComplete({
                ownerUri: "test-uri",
                batchSummaries: [
                    {
                        id: 0,
                        hasError: true,
                        selection: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
                        resultSetSummaries: [],
                        executionElapsed: "00:00:00.001",
                        executionEnd: "",
                        executionStart: "",
                    },
                ],
            });
            return Promise.resolve({});
        });

        const result = await executor.execute("test-uri", "SELECT * FROM nonexistent");

        expect(result.batches).to.have.length(1);
        expect(result.batches[0].hasError).to.be.true;
        expect(result.batches[0].messages[0].isError).to.be.true;
    });

    test("handles multiple batches", async () => {
        mockClient.sendRequest.callsFake(() => {
            // First batch
            capturedHandler.handleBatchStart({
                batchSummary: {
                    id: 0,
                    hasError: false,
                    selection: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
                    resultSetSummaries: [],
                    executionElapsed: "00:00:00.001",
                    executionEnd: "",
                    executionStart: "",
                },
                ownerUri: "test-uri",
            });
            capturedHandler.handleBatchComplete({
                batchSummary: {
                    id: 0,
                    hasError: false,
                    selection: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
                    resultSetSummaries: [],
                    executionElapsed: "00:00:00.001",
                    executionEnd: "",
                    executionStart: "",
                },
                ownerUri: "test-uri",
            });
            // Second batch
            capturedHandler.handleBatchStart({
                batchSummary: {
                    id: 1,
                    hasError: false,
                    selection: { startLine: 2, startColumn: 0, endLine: 2, endColumn: 0 },
                    resultSetSummaries: [],
                    executionElapsed: "00:00:00.001",
                    executionEnd: "",
                    executionStart: "",
                },
                ownerUri: "test-uri",
            });
            capturedHandler.handleBatchComplete({
                batchSummary: {
                    id: 1,
                    hasError: false,
                    selection: { startLine: 2, startColumn: 0, endLine: 2, endColumn: 0 },
                    resultSetSummaries: [],
                    executionElapsed: "00:00:00.001",
                    executionEnd: "",
                    executionStart: "",
                },
                ownerUri: "test-uri",
            });
            capturedHandler.handleQueryComplete({
                ownerUri: "test-uri",
                batchSummaries: [],
            });
            return Promise.resolve({});
        });

        const result = await executor.execute("test-uri", "SELECT 1\nGO\nSELECT 2");

        expect(result.batches).to.have.length(2);
    });

    test("sends cancel request on cancellation", async () => {
        const tokenSource = new vscode.CancellationTokenSource();

        mockClient.sendRequest.callsFake(
            (_type: unknown, params: Record<string, unknown> | undefined) => {
                if (params?.query !== undefined) {
                    // executeString — delay to allow cancellation
                    tokenSource.cancel();
                    // After cancel, simulate completion
                    capturedHandler.handleQueryComplete({
                        ownerUri: "test-uri",
                        batchSummaries: [],
                    });
                    return Promise.resolve({});
                }
                // cancel or dispose request
                return Promise.resolve({});
            },
        );

        const result = await executor.execute(
            "test-uri",
            "WAITFOR DELAY '00:01:00'",
            tokenSource.token,
        );

        expect(result.canceled).to.be.true;
        tokenSource.dispose();
    });

    test("unregisters handler even when execute request fails", async () => {
        mockClient.sendRequest.rejects(new Error("STS connection lost"));

        try {
            await executor.execute("test-uri", "SELECT 1");
        } catch {
            // Expected
        }

        expect(mockNotificationHandler.unregisterRunner).to.have.been.calledOnce;
    });
});
