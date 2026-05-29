/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import * as chai from "chai";
import { expect } from "chai";
import sinonChai from "sinon-chai";
import { IConnectionInfo, IServerInfo } from "vscode-mssql";
import {
    HeadlessBatchResult,
    HeadlessQueryExecutor,
    HeadlessQueryResult,
    HeadlessResultSetData,
} from "../../../src/queryExecution/headlessQueryExecutor";
import {
    PlatformContextDetector,
    toFallbackPlatformContext,
} from "../../../src/sqlToolsMcp/platformContextDetector";
import { BridgeErrorCode, BridgeRequestError } from "../../../src/sqlToolsMcp/contracts";
import { DbCellValue } from "../../../src/models/contracts/queryExecute";
import { IDbColumn, IResultMessage } from "../../../src/models/interfaces";

chai.use(sinonChai);

suite("SQL Tools MCP platform context detector", () => {
    let sandbox: sinon.SinonSandbox;
    let executor: sinon.SinonStubbedInstance<HeadlessQueryExecutor>;

    setup(() => {
        sandbox = sinon.createSandbox();
        executor = sandbox.createStubInstance(HeadlessQueryExecutor);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("maps detection query output to platform context", async () => {
        executor.execute.resolves(
            queryResult([
                batch([
                    resultSet(
                        [
                            "DatabaseName",
                            "ServerName",
                            "EngineEdition",
                            "ProductVersion",
                            "Version",
                        ],
                        [
                            [
                                cell("Shop"),
                                cell("localhost"),
                                cell("SQL Server Enterprise"),
                                cell("17.0.1000"),
                                cell("SQL2025"),
                            ],
                        ],
                    ),
                ]),
            ]),
        );

        const detector = new PlatformContextDetector(executor);
        const context = await detector.detect(
            "owner",
            connectionInfo("FallbackDb", "fallback-server"),
            serverInfo("Fallback edition", "16.0"),
        );

        expect(executor.execute).to.have.been.calledWith("owner", sinon.match.string);
        expect(context).to.deep.equal({
            databaseName: "Shop",
            serverName: "localhost",
            engineEdition: "SQL Server Enterprise",
            version: "SQL2025",
            contextSettings: {
                DatabaseName: "Shop",
                ServerName: "localhost",
                EngineEdition: "SQL Server Enterprise",
                ProductVersion: "17.0.1000",
                Version: "SQL2025",
            },
        });
    });

    test("uses connection and server fallbacks for missing detection fields", async () => {
        executor.execute.resolves(
            queryResult([batch([resultSet(["DatabaseName"], [[cell("")]])])]),
        );

        const detector = new PlatformContextDetector(executor);
        const context = await detector.detect(
            "owner",
            connectionInfo("FallbackDb", "fallback-server"),
            serverInfo("Fallback edition", "16.0"),
        );

        expect(context.databaseName).to.equal("FallbackDb");
        expect(context.serverName).to.equal("fallback-server");
        expect(context.engineEdition).to.equal("Fallback edition");
        expect(context.version).to.equal("16.0");
    });

    test("skips nameless columns and maps null values to empty strings", async () => {
        executor.execute.resolves(
            queryResult([
                batch([
                    {
                        columnInfo: [{} as IDbColumn, { columnName: "DatabaseName" } as IDbColumn],
                        rows: [[cell("ignored"), cell("", true)]],
                        rowCount: 1,
                    },
                ]),
            ]),
        );

        const detector = new PlatformContextDetector(executor);
        const context = await detector.detect(
            "owner",
            connectionInfo("FallbackDb", "fallback-server"),
            undefined,
        );

        expect(context.databaseName).to.equal("FallbackDb");
        expect(context.contextSettings).to.deep.equal({
            DatabaseName: "",
        });
    });

    test("maps undefined display values to empty strings", async () => {
        executor.execute.resolves(
            queryResult([
                batch([
                    {
                        columnInfo: [{ columnName: "DatabaseName" } as IDbColumn],
                        rows: [[{ isNull: false } as DbCellValue]],
                        rowCount: 1,
                    },
                ]),
            ]),
        );

        const detector = new PlatformContextDetector(executor);
        const context = await detector.detect("owner", undefined, undefined);

        expect(context.contextSettings).to.deep.equal({
            DatabaseName: "",
        });
    });

    test("throws retryable execution error when detection query fails", async () => {
        executor.execute.resolves(queryResult([batch([], true)]));

        const detector = new PlatformContextDetector(executor);

        try {
            await detector.detect("owner", undefined, undefined);
        } catch (error) {
            expect(error).to.be.instanceOf(BridgeRequestError);
            expect((error as BridgeRequestError).bridgeErrorCode).to.equal(
                BridgeErrorCode.ExecutionFailed,
            );
            expect((error as BridgeRequestError).retryable).to.equal(true);
            return;
        }

        throw new Error("Expected BridgeRequestError.");
    });

    test("throws retryable execution error when detection emits error messages", async () => {
        executor.execute.resolves(
            queryResult([
                batch([], false, [
                    { message: "detection failed", isError: true } as IResultMessage,
                ]),
            ]),
        );

        const detector = new PlatformContextDetector(executor);

        try {
            await detector.detect("owner", undefined, undefined);
        } catch (error) {
            expect(error).to.be.instanceOf(BridgeRequestError);
            expect((error as BridgeRequestError).bridgeErrorCode).to.equal(
                BridgeErrorCode.ExecutionFailed,
            );
            return;
        }

        throw new Error("Expected BridgeRequestError.");
    });

    test("throws retryable execution error when detection is canceled", async () => {
        executor.execute.resolves({
            batches: [],
            canceled: true,
        });

        const detector = new PlatformContextDetector(executor);

        try {
            await detector.detect("owner", undefined, undefined);
        } catch (error) {
            expect(error).to.be.instanceOf(BridgeRequestError);
            expect((error as BridgeRequestError).bridgeErrorCode).to.equal(
                BridgeErrorCode.ExecutionFailed,
            );
            return;
        }

        throw new Error("Expected BridgeRequestError.");
    });

    test("builds fallback platform context from available connection metadata", () => {
        const context = toFallbackPlatformContext(
            connectionInfo("Shop", "localhost"),
            serverInfo("Azure SQL DB", "12.0"),
        );

        expect(context).to.deep.equal({
            databaseName: "Shop",
            serverName: "localhost",
            engineEdition: "Azure SQL DB",
            version: "12.0",
            contextSettings: {
                DatabaseName: "Shop",
                ServerName: "localhost",
                Edition: "Azure SQL DB",
                EngineEdition: "Azure SQL DB",
                ProductVersion: "12.0",
                Version: "12.0",
            },
        });
    });
});

function queryResult(batches: HeadlessBatchResult[]): HeadlessQueryResult {
    return {
        batches,
        canceled: false,
    };
}

function batch(
    resultSets: HeadlessResultSetData[],
    hasError = false,
    messages: IResultMessage[] = [],
): HeadlessBatchResult {
    return {
        batchSummary: { id: 0, hasError } as HeadlessBatchResult["batchSummary"],
        messages,
        resultSets,
        hasError,
    };
}

function resultSet(columnNames: string[], rows: DbCellValue[][]): HeadlessResultSetData {
    return {
        columnInfo: columnNames.map((columnName) => ({ columnName }) as IDbColumn),
        rows,
        rowCount: rows.length,
    };
}

function cell(displayValue: string, isNull = false): DbCellValue {
    return { displayValue, isNull } as DbCellValue;
}

function connectionInfo(database: string, server: string): IConnectionInfo {
    return {
        database,
        server,
    } as IConnectionInfo;
}

function serverInfo(serverEdition: string, serverVersion: string): IServerInfo {
    return {
        serverEdition,
        serverVersion,
    } as IServerInfo;
}
