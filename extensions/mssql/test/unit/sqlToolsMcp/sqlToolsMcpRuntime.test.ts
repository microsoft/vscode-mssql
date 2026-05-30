/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import * as chai from "chai";
import { expect } from "chai";
import sinonChai from "sinon-chai";
import ConnectionManager from "../../../src/controllers/connectionManager";
import { ConnectionStore } from "../../../src/models/connectionStore";
import { IDbColumn, IConnectionProfileWithSource } from "../../../src/models/interfaces";
import { Logger } from "../../../src/models/logger";
import {
    HeadlessBatchResult,
    HeadlessQueryExecutor,
    HeadlessQueryResult,
    HeadlessResultSetData,
} from "../../../src/queryExecution/headlessQueryExecutor";
import { BridgeErrorCode, BridgeRequestError } from "../../../src/sqlToolsMcp/contracts";
import { SqlToolsMcpRuntime } from "../../../src/sqlToolsMcp/sqlToolsMcpRuntime";
import { DbCellValue } from "../../../src/models/contracts/queryExecute";
import { stubTelemetry } from "../utils";

chai.use(sinonChai);

suite("SQL Tools MCP runtime", () => {
    let sandbox: sinon.SinonSandbox;
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let connectionStore: sinon.SinonStubbedInstance<ConnectionStore>;
    let executor: sinon.SinonStubbedInstance<HeadlessQueryExecutor>;
    let logger: sinon.SinonStubbedInstance<Logger>;

    setup(() => {
        sandbox = sinon.createSandbox();
        connectionManager = sandbox.createStubInstance(ConnectionManager);
        connectionStore = sandbox.createStubInstance(ConnectionStore);
        executor = sandbox.createStubInstance(HeadlessQueryExecutor);
        logger = sandbox.createStubInstance(Logger);
        stubTelemetry(sandbox);

        connectionManager.initialized = {
            promise: Promise.resolve(),
        } as ConnectionManager["initialized"];
        sandbox.stub(connectionManager, "connectionStore").get(() => connectionStore);
        connectionManager.connect.resolves(true);
        connectionManager.disconnect.resolves(true);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("reports availability after connection manager initialization", async () => {
        const runtime = createRuntime(
            [profile("profile-1", "Shop", "localhost", "Sales")],
            connectionManager,
            connectionStore,
            executor,
            logger,
        );

        const result = await runtime.isAvailable();

        expect(result).to.deep.equal({ isAvailable: true });
    });

    test("lists saved profiles as bridge connection handles", async () => {
        const runtime = createRuntime(
            [profile("profile-1", "Shop", "localhost", "Sales")],
            connectionManager,
            connectionStore,
            executor,
            logger,
        );

        const result = await runtime.getAvailableConnections();

        expect(result.connections).to.deep.equal([
            {
                name: "Shop",
                description: "[localhost : $(database) Sales]",
                serverName: "localhost",
                databaseName: "Sales",
                providerName: "vscode",
                connectionHandle: "profile-1",
            },
        ]);
    });

    test("uses simple connection display name when profile name is missing", async () => {
        const runtime = createRuntime(
            [profile("profile-1", "", "localhost", "Sales")],
            connectionManager,
            connectionStore,
            executor,
            logger,
        );

        const result = await runtime.getAvailableConnections();

        expect(result.connections[0].name).to.equal("localhost");
    });

    test("connect resolves a profile name to a connection handle", async () => {
        const runtime = createRuntime(
            [profile("profile-1", "Shop", "localhost", "Sales")],
            connectionManager,
            connectionStore,
            executor,
            logger,
        );

        const result = await runtime.connect({ connectionName: "Shop" });

        expect(result.connection.connectionHandle).to.equal("profile-1");
        expect(result.connection.providerName).to.equal("vscode");
    });

    test("connect rejects missing or unknown profile names", async () => {
        const runtime = createRuntime(
            [profile("profile-1", "Shop", "localhost", "Sales")],
            connectionManager,
            connectionStore,
            executor,
            logger,
        );

        await expectBridgeFailure(
            () => runtime.connect({}),
            BridgeErrorCode.InvalidRequest,
            "Connection name is required.",
        );
        await expectBridgeFailure(
            () => runtime.connect({ connectionName: "Missing" }),
            BridgeErrorCode.NotFound,
            "Connection was not found.",
        );
    });

    test("connect rejects profiles without usable handles", async () => {
        const runtime = createRuntime(
            [profile(undefined, "Shop", "localhost", "Sales")],
            connectionManager,
            connectionStore,
            executor,
            logger,
        );

        await expectBridgeFailure(
            () => runtime.connect({ connectionName: "Shop" }),
            BridgeErrorCode.Unavailable,
            "Connection does not have a usable handle.",
        );
    });

    test("registers execution context, detects platform context, and executes through STS", async () => {
        const savedProfile = profile("profile-1", "Shop", "localhost", "Sales");
        const runtime = createRuntime(
            [savedProfile],
            connectionManager,
            connectionStore,
            executor,
            logger,
        );
        connectionManager.getConnectionInfo.returns({
            credentials: savedProfile,
        } as unknown as ReturnType<ConnectionManager["getConnectionInfo"]>);
        connectionManager.getServerInfo.returns({
            serverEdition: "SQL Server Enterprise",
            serverVersion: "17.0",
        } as ReturnType<ConnectionManager["getServerInfo"]>);
        executor.execute
            .onFirstCall()
            .resolves(
                queryResult([
                    batch([
                        resultSet(
                            ["DatabaseName", "ServerName", "EngineEdition", "Version"],
                            [
                                [
                                    cell("Sales"),
                                    cell("localhost"),
                                    cell("SQL Server Enterprise"),
                                    cell("SQL2025"),
                                ],
                            ],
                        ),
                    ]),
                ]),
            );
        executor.execute
            .onSecondCall()
            .resolves(queryResult([batch([resultSet(["value"], [[cell("42")]])])]));

        const registration = await runtime.registerConnection({
            connectionName: "registered-shop",
            connectionHandle: "profile-1",
        });
        const ownerUri = connectionManager.connect.firstCall.args[0];
        const execution = await runtime.executeQuery({
            connectionName: "registered-shop",
            queryContentDescriptor: {
                query: "SELECT @returnAsMarkdown AS value;",
            },
        });

        expect(connectionManager.connect).to.have.been.calledWith(
            ownerUri,
            sinon.match(savedProfile),
            {
                shouldHandleErrors: false,
                connectionSource: "sqlToolsMcp",
            },
        );
        expect(registration.platformContext.databaseName).to.equal("Sales");
        expect(registration.platformContext.version).to.equal("SQL2025");
        expect(executor.execute.secondCall.args[0]).to.equal(ownerUri);
        expect(executor.execute.secondCall.args[1]).to.equal(
            "DECLARE @returnAsMarkdown bit = 1;\nSELECT @returnAsMarkdown AS value;",
        );
        expect(execution.queryResult).to.deep.equal({
            result: "value: \n42\n\n",
            errorMessage: "",
            isError: false,
        });
    });

    test("registerConnection validates required inputs and profile handles", async () => {
        const runtime = createRuntime(
            [profile("profile-1", "Shop", "localhost", "Sales")],
            connectionManager,
            connectionStore,
            executor,
            logger,
        );

        await expectBridgeFailure(
            () =>
                runtime.registerConnection({
                    connectionName: "",
                    connectionHandle: "profile-1",
                }),
            BridgeErrorCode.InvalidRequest,
            "Registered connection name is required.",
        );
        await expectBridgeFailure(
            () =>
                runtime.registerConnection({
                    connectionName: "registered-shop",
                    connectionHandle: "",
                }),
            BridgeErrorCode.InvalidRequest,
            "Connection handle is required.",
        );
        await expectBridgeFailure(
            () =>
                runtime.registerConnection({
                    connectionName: "registered-shop",
                    connectionHandle: "missing",
                }),
            BridgeErrorCode.NotFound,
            "Connection was not found.",
        );
    });

    test("registerConnection returns retryable authentication failure when connect fails", async () => {
        const runtime = createRuntime(
            [profile("profile-1", "Shop", "localhost", "Sales")],
            connectionManager,
            connectionStore,
            executor,
            logger,
        );
        connectionManager.connect.resolves(false);

        try {
            await runtime.registerConnection({
                connectionName: "registered-shop",
                connectionHandle: "profile-1",
            });
        } catch (error) {
            expect(error).to.be.instanceOf(BridgeRequestError);
            expect((error as BridgeRequestError).bridgeErrorCode).to.equal(
                BridgeErrorCode.AuthenticationFailed,
            );
            expect((error as BridgeRequestError).retryable).to.equal(true);
            return;
        }

        throw new Error("Expected BridgeRequestError.");
    });

    test("registerConnection replaces an existing registration and disconnects the prior context", async () => {
        const savedProfile = profile("profile-1", "Shop", "localhost", "Sales");
        const runtime = createRuntime(
            [savedProfile],
            connectionManager,
            connectionStore,
            executor,
            logger,
        );
        connectionManager.getConnectionInfo.returns({
            credentials: savedProfile,
        } as unknown as ReturnType<ConnectionManager["getConnectionInfo"]>);
        executor.execute.resolves(
            queryResult([batch([resultSet(["DatabaseName"], [[cell("Sales")]])])]),
        );

        await runtime.registerConnection({
            connectionName: "registered-shop",
            connectionHandle: "profile-1",
        });
        const firstOwnerUri = connectionManager.connect.firstCall.args[0];
        await runtime.registerConnection({
            connectionName: "registered-shop",
            connectionHandle: "profile-1",
        });

        expect(connectionManager.disconnect).to.have.been.calledWith(firstOwnerUri);
        expect(connectionManager.connect).to.have.been.calledTwice;
    });

    test("registerConnection falls back when platform detection fails", async () => {
        const savedProfile = profile("profile-1", "Shop", "localhost", "Sales");
        const runtime = createRuntime(
            [savedProfile],
            connectionManager,
            connectionStore,
            executor,
            logger,
        );
        connectionManager.getConnectionInfo.returns({
            credentials: savedProfile,
        } as unknown as ReturnType<ConnectionManager["getConnectionInfo"]>);
        connectionManager.getServerInfo.returns({
            serverEdition: "SQL Server Enterprise",
            serverVersion: "17.0",
        } as ReturnType<ConnectionManager["getServerInfo"]>);
        executor.execute.rejects(new Error("detection failed"));

        const registration = await runtime.registerConnection({
            connectionName: "registered-shop",
            connectionHandle: "profile-1",
        });

        expect(registration.platformContext).to.deep.equal({
            databaseName: "Sales",
            serverName: "localhost",
            engineEdition: "SQL Server Enterprise",
            version: "17.0",
            contextSettings: {
                DatabaseName: "Sales",
                ServerName: "localhost",
                Edition: "SQL Server Enterprise",
                EngineEdition: "SQL Server Enterprise",
                ProductVersion: "17.0",
                Version: "17.0",
            },
        });
        expect(logger.warn).to.have.been.calledWith(
            "SQL Tools MCP platform detection failed; using minimal context.",
        );
    });

    test("registerConnection tolerates missing connected credentials during platform detection", async () => {
        const savedProfile = profile("profile-1", "Shop", "localhost", "Sales");
        const runtime = createRuntime(
            [savedProfile],
            connectionManager,
            connectionStore,
            executor,
            logger,
        );
        connectionManager.getConnectionInfo.returns(undefined);
        executor.execute.resolves(queryResult([batch([])]));

        const registration = await runtime.registerConnection({
            connectionName: "registered-shop",
            connectionHandle: "profile-1",
        });

        expect(registration.platformContext).to.deep.equal({
            databaseName: undefined,
            serverName: undefined,
            engineEdition: undefined,
            version: undefined,
            contextSettings: {},
        });
    });

    test("executeQuery rejects missing and unknown registered connection names", async () => {
        const runtime = createRuntime([], connectionManager, connectionStore, executor, logger);

        await expectBridgeFailure(
            () =>
                runtime.executeQuery({
                    connectionName: "",
                    queryContentDescriptor: { query: "SELECT 1;" },
                }),
            BridgeErrorCode.InvalidRequest,
            "Registered connection name is required.",
        );
        await expectBridgeFailure(
            () =>
                runtime.executeQuery({
                    connectionName: "missing",
                    queryContentDescriptor: { query: "SELECT 1;" },
                }),
            BridgeErrorCode.NotFound,
            "Registered connection was not found.",
        );
    });

    test("executeQuery rejects cancellation before starting execution", async () => {
        const savedProfile = profile("profile-1", "Shop", "localhost", "Sales");
        const runtime = createRuntime(
            [savedProfile],
            connectionManager,
            connectionStore,
            executor,
            logger,
        );
        connectionManager.getConnectionInfo.returns({
            credentials: savedProfile,
        } as unknown as ReturnType<ConnectionManager["getConnectionInfo"]>);
        executor.execute.resolves(
            queryResult([batch([resultSet(["DatabaseName"], [[cell("Sales")]])])]),
        );

        await runtime.registerConnection({
            connectionName: "registered-shop",
            connectionHandle: "profile-1",
        });

        await expectBridgeFailure(
            () =>
                runtime.executeQuery(
                    {
                        connectionName: "registered-shop",
                        queryContentDescriptor: { query: "SELECT 1;" },
                    },
                    {
                        isCancellationRequested: true,
                        onCancellationRequested: () => ({ dispose: () => undefined }),
                    },
                ),
            BridgeErrorCode.Cancelled,
            "Query request was cancelled.",
        );
    });

    test("executeQuery rejects queued work when connection is removed before it starts", async () => {
        const savedProfile = profile("profile-1", "Shop", "localhost", "Sales");
        const runtime = createRuntime(
            [savedProfile],
            connectionManager,
            connectionStore,
            executor,
            logger,
        );
        connectionManager.getConnectionInfo.returns({
            credentials: savedProfile,
        } as unknown as ReturnType<ConnectionManager["getConnectionInfo"]>);
        executor.execute
            .onFirstCall()
            .resolves(queryResult([batch([resultSet(["DatabaseName"], [[cell("Sales")]])])]));

        await runtime.registerConnection({
            connectionName: "registered-shop",
            connectionHandle: "profile-1",
        });

        let releaseFirstQuery: () => void = () => undefined;
        let markFirstQueryStarted: () => void = () => undefined;
        const firstQueryStarted = new Promise<void>((resolve) => {
            markFirstQueryStarted = resolve;
        });
        executor.execute.onSecondCall().returns(
            new Promise((resolve) => {
                markFirstQueryStarted();
                releaseFirstQuery = () =>
                    resolve(queryResult([batch([resultSet(["value"], [[cell("1")]])])]));
            }),
        );
        executor.execute
            .onThirdCall()
            .resolves(queryResult([batch([resultSet(["value"], [[cell("2")]])])]));

        const firstQuery = runtime.executeQuery({
            connectionName: "registered-shop",
            queryContentDescriptor: { query: "SELECT 1;" },
        });
        await firstQueryStarted;
        const queuedError = runtime
            .executeQuery({
                connectionName: "registered-shop",
                queryContentDescriptor: { query: "SELECT 2;" },
            })
            .then(
                () => undefined,
                (error) => error,
            );
        const remove = runtime.removeConnection({ connectionName: "registered-shop" });

        releaseFirstQuery();
        await firstQuery;
        const error = await queuedError;
        expect(error).to.be.instanceOf(BridgeRequestError);
        expect((error as BridgeRequestError).bridgeErrorCode).to.equal(BridgeErrorCode.NotFound);
        expect((error as BridgeRequestError).message).to.equal(
            "Registered connection was removed.",
        );
        expect(await remove).to.deep.equal({ removed: true });
    });

    test("removeConnection is idempotent and disconnects registered context", async () => {
        const savedProfile = profile("profile-1", "Shop", "localhost", "Sales");
        const runtime = createRuntime(
            [savedProfile],
            connectionManager,
            connectionStore,
            executor,
            logger,
        );
        connectionManager.getConnectionInfo.returns({
            credentials: savedProfile,
        } as unknown as ReturnType<ConnectionManager["getConnectionInfo"]>);
        executor.execute.resolves(
            queryResult([batch([resultSet(["DatabaseName"], [[cell("Sales")]])])]),
        );

        await runtime.registerConnection({
            connectionName: "registered-shop",
            connectionHandle: "profile-1",
        });
        const ownerUri = connectionManager.connect.firstCall.args[0];

        expect(await runtime.removeConnection({ connectionName: "registered-shop" })).to.deep.equal(
            {
                removed: true,
            },
        );
        expect(connectionManager.disconnect).to.have.been.calledWith(ownerUri);
        expect(await runtime.removeConnection({ connectionName: "registered-shop" })).to.deep.equal(
            {
                removed: false,
            },
        );
    });

    test("removeConnection validates required name and logs cleanup failures", async () => {
        const savedProfile = profile("profile-1", "Shop", "localhost", "Sales");
        const runtime = createRuntime(
            [savedProfile],
            connectionManager,
            connectionStore,
            executor,
            logger,
        );
        connectionManager.getConnectionInfo.returns({
            credentials: savedProfile,
        } as unknown as ReturnType<ConnectionManager["getConnectionInfo"]>);
        executor.execute.resolves(
            queryResult([batch([resultSet(["DatabaseName"], [[cell("Sales")]])])]),
        );
        connectionManager.disconnect.rejects(new Error("disconnect failed"));

        await runtime.registerConnection({
            connectionName: "registered-shop",
            connectionHandle: "profile-1",
        });
        await expectBridgeFailure(
            () => runtime.removeConnection({ connectionName: "" }),
            BridgeErrorCode.InvalidRequest,
            "Registered connection name is required.",
        );
        expect(await runtime.removeConnection({ connectionName: "registered-shop" })).to.deep.equal(
            {
                removed: true,
            },
        );
        expect(logger.warn).to.have.been.calledWith("SQL Tools MCP connection cleanup failed.");
    });

    test("dispose disconnects all registered contexts", async () => {
        const profiles = [
            profile("profile-1", "Shop", "localhost", "Sales"),
            profile("profile-2", "Warehouse", "localhost", "Warehouse"),
        ];
        const runtime = createRuntime(
            profiles,
            connectionManager,
            connectionStore,
            executor,
            logger,
        );
        connectionManager.getConnectionInfo.callsFake(
            () =>
                ({
                    credentials: profiles[0],
                }) as unknown as ReturnType<ConnectionManager["getConnectionInfo"]>,
        );
        executor.execute.resolves(
            queryResult([batch([resultSet(["DatabaseName"], [[cell("Sales")]])])]),
        );

        await runtime.registerConnection({
            connectionName: "registered-shop",
            connectionHandle: "profile-1",
        });
        await runtime.registerConnection({
            connectionName: "registered-warehouse",
            connectionHandle: "profile-2",
        });
        await runtime.dispose();

        expect(connectionManager.disconnect).to.have.been.calledTwice;
    });
});

function createRuntime(
    profiles: IConnectionProfileWithSource[],
    connectionManager: sinon.SinonStubbedInstance<ConnectionManager>,
    connectionStore: sinon.SinonStubbedInstance<ConnectionStore>,
    executor: sinon.SinonStubbedInstance<HeadlessQueryExecutor>,
    logger: sinon.SinonStubbedInstance<Logger>,
): SqlToolsMcpRuntime {
    connectionStore.readAllConnections.resolves(profiles);
    return new SqlToolsMcpRuntime(connectionManager, executor, logger);
}

async function expectBridgeFailure(
    callback: () => Promise<unknown>,
    errorCode: BridgeErrorCode,
    message: string,
): Promise<void> {
    try {
        await callback();
    } catch (error) {
        expect(error).to.be.instanceOf(BridgeRequestError);
        expect((error as BridgeRequestError).bridgeErrorCode).to.equal(errorCode);
        expect((error as BridgeRequestError).message).to.equal(message);
        return;
    }

    throw new Error("Expected BridgeRequestError.");
}

function profile(
    id: string | undefined,
    profileName: string,
    server: string,
    database: string,
): IConnectionProfileWithSource {
    return {
        id,
        profileName,
        server,
        database,
    } as IConnectionProfileWithSource;
}

function queryResult(batches: HeadlessBatchResult[]): HeadlessQueryResult {
    return {
        batches,
        canceled: false,
    };
}

function batch(resultSets: HeadlessResultSetData[], hasError = false): HeadlessBatchResult {
    return {
        batchSummary: { id: 0, hasError } as HeadlessBatchResult["batchSummary"],
        messages: [],
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

function cell(displayValue: string): DbCellValue {
    return { displayValue, isNull: false } as DbCellValue;
}
