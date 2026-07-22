/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import type { IConnectionInfo, ConnectionDetails } from "vscode-mssql";

chai.use(sinonChai);

import { NotebookConnectionManager } from "../../../src/notebooks/notebookConnectionManager";
import { ILogger } from "../../../src/sharedInterfaces/logger";
import ConnectionManager from "../../../src/controllers/connectionManager";
import {
    ConnectionCompleteParams,
    ConnectionRequest,
    DisconnectRequest,
} from "../../../src/models/contracts/connection";
import { ConnectionSharingService } from "../../../src/connectionSharing/connectionSharingService";
import { ConnectionStore } from "../../../src/models/connectionStore";
import { ConnectionUI } from "../../../src/views/connectionUI";
import SqlToolsServiceClient from "../../../src/languageservice/serviceclient";
import { QueryNotificationHandler } from "../../../src/controllers/queryNotificationHandler";

/**
 * Build a fully-populated IConnectionInfo with sensible defaults.
 * All required fields are provided so no `as` cast is needed.
 */
function makeConnectionInfo(overrides?: Partial<IConnectionInfo>): IConnectionInfo {
    return {
        server: "test-server",
        database: "TestDB",
        user: "sa",
        password: "password",
        email: undefined,
        accountId: undefined,
        tenantId: undefined,
        port: 1433,
        authenticationType: "SqlLogin",
        azureAccountToken: undefined,
        expiresOn: undefined,
        encrypt: "Optional",
        trustServerCertificate: undefined,
        hostNameInCertificate: undefined,
        persistSecurityInfo: undefined,
        secureEnclaves: undefined,
        columnEncryptionSetting: undefined,
        attestationProtocol: undefined,
        enclaveAttestationUrl: undefined,
        connectTimeout: undefined,
        commandTimeout: undefined,
        connectRetryCount: undefined,
        connectRetryInterval: undefined,
        applicationName: undefined,
        workstationId: undefined,
        applicationIntent: undefined,
        currentLanguage: undefined,
        pooling: undefined,
        maxPoolSize: undefined,
        minPoolSize: undefined,
        loadBalanceTimeout: undefined,
        replication: undefined,
        attachDbFilename: undefined,
        failoverPartner: undefined,
        multiSubnetFailover: undefined,
        multipleActiveResultSets: undefined,
        packetSize: undefined,
        typeSystemVersion: undefined,
        connectionString: undefined,
        containerName: undefined,
        ...overrides,
    };
}

/**
 * Build a stub ILogger with all required interface
 * members so the type checker is satisfied without `as any`.
 */
function makeLogStub(sandbox: sinon.SinonSandbox): sinon.SinonStubbedInstance<ILogger> {
    return {
        trace: sandbox.stub(),
        debug: sandbox.stub(),
        info: sandbox.stub(),
        warn: sandbox.stub(),
        error: sandbox.stub(),
        piiSanitized: sandbox.stub(),
        show: sandbox.stub(),
        withPrefix: sandbox.stub(),
        dispose: sandbox.stub(),
    } as sinon.SinonStubbedInstance<ILogger>;
}

suite("NotebookConnectionManager", () => {
    let sandbox: sinon.SinonSandbox;
    let connectionMgr: sinon.SinonStubbedInstance<ConnectionManager>;
    let sharingService: sinon.SinonStubbedInstance<ConnectionSharingService>;
    let mockClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let mockNotificationHandler: sinon.SinonStubbedInstance<QueryNotificationHandler>;
    let log: sinon.SinonStubbedInstance<ILogger>;
    let stubStore: sinon.SinonStubbedInstance<ConnectionStore>;
    let stubUI: sinon.SinonStubbedInstance<ConnectionUI>;
    let mgr: NotebookConnectionManager;

    setup(() => {
        sandbox = sinon.createSandbox();

        // --- ConnectionManager ---
        connectionMgr = sandbox.createStubInstance(ConnectionManager);
        connectionMgr.connect.resolves(true);
        connectionMgr.listDatabases.resolves(["master", "TestDB"]);

        const stubDetails: ConnectionDetails = { options: { serverName: "test-server" } };
        connectionMgr.createConnectionDetails.returns(stubDetails);
        connectionMgr.sendRequest.resolves(true);
        connectionMgr.getConnectionInfoFromUri.returns(makeConnectionInfo({ database: "TestDB" }));
        // Cell registration awaits the async connection/complete notification;
        // default to a successful completion so registrations succeed.
        connectionMgr.expectConnectionComplete.resolves({
            connectionId: "test-connection-id",
        } as ConnectionCompleteParams);

        // --- ConnectionStore (getter stub) ---
        stubStore = sandbox.createStubInstance(ConnectionStore);
        stubStore.getPickListItems.resolves([]);
        sandbox.stub(connectionMgr, "connectionStore").get(() => stubStore);

        // --- ConnectionUI (getter stub) ---
        stubUI = sandbox.createStubInstance(ConnectionUI);
        stubUI.promptForConnection.resolves(makeConnectionInfo());
        sandbox.stub(connectionMgr, "connectionUI").get(() => stubUI);

        // --- ConnectionSharingService ---
        sharingService = sandbox.createStubInstance(ConnectionSharingService);
        sharingService.isConnected.returns(false);

        // --- STS client & notification handler (for HeadlessQueryExecutor) ---
        mockClient = sandbox.createStubInstance(SqlToolsServiceClient);
        mockClient.sendRequest.resolves({});
        mockNotificationHandler = sandbox.createStubInstance(QueryNotificationHandler);

        // --- Logger ---
        log = makeLogStub(sandbox);

        // --- Subject-under-test ---
        mgr = new NotebookConnectionManager(
            connectionMgr,
            sharingService,
            log,
            mockClient,
            mockNotificationHandler,
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    // ----------------------------------------------------------------
    // ensureConnection
    // ----------------------------------------------------------------
    suite("ensureConnection", () => {
        test("returns existing URI when connection is alive", async () => {
            const uri = await mgr.promptAndConnect();
            sharingService.isConnected.returns(true);

            const result = await mgr.ensureConnection();
            expect(result).to.equal(uri);
        });

        test("prompts when no connection exists", async () => {
            await mgr.ensureConnection();
            expect(stubUI.promptForConnection).to.have.been.calledOnce;
        });

        test("reconnects silently when stale but connectionInfo is available", async () => {
            await mgr.promptAndConnect();
            sharingService.isConnected.returns(false);

            stubUI.promptForConnection.resetHistory();
            connectionMgr.connect.resetHistory();
            await mgr.ensureConnection();

            // Should reconnect without prompting
            expect(stubUI.promptForConnection).to.not.have.been.called;
            expect(connectionMgr.connect).to.have.been.calledOnce;
        });

        test("falls back to prompt when reconnection fails", async () => {
            await mgr.promptAndConnect();
            sharingService.isConnected.returns(false);

            // Make the reconnection attempt fail
            connectionMgr.connect.onSecondCall().resolves(false);

            stubUI.promptForConnection.resetHistory();
            await mgr.ensureConnection();
            expect(stubUI.promptForConnection).to.have.been.calledOnce;
        });

        test("updates label after stale reconnection", async () => {
            await mgr.promptAndConnect();
            const labelBefore = mgr.getConnectionLabel();
            expect(labelBefore).to.include("test-server");

            // Mark stale — reconnection will succeed with stored connectionInfo
            sharingService.isConnected.returns(false);
            connectionMgr.getConnectionInfoFromUri.returns(
                makeConnectionInfo({ database: "TestDB" }),
            );

            await mgr.ensureConnection();
            expect(mgr.getConnectionLabel()).to.include("test-server");
            expect(mgr.getConnectionLabel()).to.include("TestDB");
        });
    });

    // ----------------------------------------------------------------
    // promptAndConnect
    // ----------------------------------------------------------------
    suite("promptAndConnect", () => {
        test("connects with user-selected profile and returns a URI", async () => {
            const uri = await mgr.promptAndConnect();
            expect(uri).to.be.a("string").and.not.empty;
            expect(connectionMgr.connect).to.have.been.calledOnce;
        });

        test("throws when user cancels connection dialog", async () => {
            stubUI.promptForConnection.resolves(undefined);
            try {
                await mgr.promptAndConnect();
                expect.fail("should have thrown");
            } catch (err: unknown) {
                expect((err as Error).message).to.include("No connection selected");
            }
        });

        test("throws when ConnectionManager.connect returns false", async () => {
            connectionMgr.connect.resolves(false);
            try {
                await mgr.promptAndConnect();
                expect.fail("should have thrown");
            } catch (err: unknown) {
                expect((err as Error).message).to.include("Connection failed");
            }
        });

        test("sets connection label with server and database", async () => {
            await mgr.promptAndConnect();
            const label = mgr.getConnectionLabel();
            expect(label).to.include("test-server");
            expect(label).to.include("TestDB");
        });

        test("stores connectionInfo after successful connect", async () => {
            await mgr.promptAndConnect();
            const info = mgr.getConnectionInfo();
            expect(info).to.not.be.undefined;
            expect(info!.server).to.equal("test-server");
        });

        test("stores connectionUri after successful connect", async () => {
            const uri = await mgr.promptAndConnect();
            expect(mgr.getConnectionUri()).to.equal(uri);
        });
    });

    // ----------------------------------------------------------------
    // setReconnectionContext + promptAndConnect database restoration
    // ----------------------------------------------------------------
    suite("reconnection context", () => {
        test("restores saved database when server matches and profile has no database", async () => {
            mgr.setReconnectionContext("test-server", "SavedDB");

            // Simulate a server-level profile with no explicit database
            stubUI.promptForConnection.resolves(
                makeConnectionInfo({ server: "test-server", database: "" }),
            );
            connectionMgr.getConnectionInfoFromUri.returns(
                makeConnectionInfo({ database: "SavedDB" }),
            );

            await mgr.promptAndConnect();

            // The connect call should have received the restored database
            const connectCall = connectionMgr.connect.getCall(0);
            const connInfo = connectCall.args[1] as IConnectionInfo;
            expect(connInfo.database).to.equal("SavedDB");
        });

        test("does not override when profile has explicit database", async () => {
            mgr.setReconnectionContext("test-server", "SavedDB");

            // Profile with an explicit database set
            stubUI.promptForConnection.resolves(
                makeConnectionInfo({ server: "test-server", database: "ExplicitDB" }),
            );
            connectionMgr.getConnectionInfoFromUri.returns(
                makeConnectionInfo({ database: "ExplicitDB" }),
            );

            await mgr.promptAndConnect();

            const connectCall = connectionMgr.connect.getCall(0);
            const connInfo = connectCall.args[1] as IConnectionInfo;
            expect(connInfo.database).to.equal("ExplicitDB");
        });

        test("does not override when server does not match", async () => {
            mgr.setReconnectionContext("original-server", "SavedDB");

            stubUI.promptForConnection.resolves(
                makeConnectionInfo({ server: "different-server", database: "" }),
            );

            await mgr.promptAndConnect();

            const connectCall = connectionMgr.connect.getCall(0);
            const connInfo = connectCall.args[1] as IConnectionInfo;
            expect(connInfo.database).to.equal("");
        });

        test("uses connectionInfo database over saved context for within-session reconnection", async () => {
            mgr.setReconnectionContext("test-server", "MetadataDB");

            // Configure stub to return SessionDB BEFORE connecting
            connectionMgr.getConnectionInfoFromUri.returns(
                makeConnectionInfo({ database: "SessionDB" }),
            );

            // First connect with a specific database
            await mgr.connectWith(makeConnectionInfo({ database: "SessionDB" }));

            // Now simulate stale connection and reconnection failure
            sharingService.isConnected.returns(false);
            connectionMgr.connect.onSecondCall().resolves(false);

            // Prompt should use SessionDB (from connectionInfo) not MetadataDB
            stubUI.promptForConnection.resolves(
                makeConnectionInfo({ server: "test-server", database: "" }),
            );

            await mgr.ensureConnection();

            // The prompt-triggered connect should use SessionDB
            const lastConnectCall = connectionMgr.connect.lastCall;
            const connInfo = lastConnectCall.args[1] as IConnectionInfo;
            expect(connInfo.database).to.equal("SessionDB");
        });
    });

    // ----------------------------------------------------------------
    // connectWith
    // ----------------------------------------------------------------
    suite("connectWith", () => {
        test("connects and sets label", async () => {
            const info = makeConnectionInfo();
            const uri = await mgr.connectWith(info);
            expect(uri).to.be.a("string").and.not.empty;
            expect(mgr.getConnectionLabel()).to.include("test-server");
        });

        test("uses actual database from STS in connectionInfo", async () => {
            connectionMgr.getConnectionInfoFromUri.returns(
                makeConnectionInfo({ database: "ActualDB" }),
            );

            const info = makeConnectionInfo({ database: "RequestedDB" });
            await mgr.connectWith(info);

            expect(connectionMgr.connect).to.have.been.calledOnce;
            expect(mgr.getConnectionInfo()!.database).to.equal("ActualDB");
        });

        test("falls back to requested database when STS returns undefined", async () => {
            connectionMgr.getConnectionInfoFromUri.returns(undefined);

            const info = makeConnectionInfo({ database: "FallbackDB" });
            await mgr.connectWith(info);

            expect(mgr.getConnectionInfo()!.database).to.equal("FallbackDB");
        });

        test("updates connection label with actual database", async () => {
            connectionMgr.getConnectionInfoFromUri.returns(
                makeConnectionInfo({ database: "RealDB" }),
            );

            await mgr.connectWith(makeConnectionInfo({ database: "WrongDB" }));
            expect(mgr.getConnectionLabel()).to.include("RealDB");
        });
    });

    // ----------------------------------------------------------------
    // changeDatabase
    // ----------------------------------------------------------------
    suite("changeDatabase", () => {
        test("disconnects old connection and reconnects with new database", async () => {
            await mgr.connectWith(makeConnectionInfo());
            sharingService.disconnect.resetHistory();
            connectionMgr.connect.resetHistory();

            await mgr.changeDatabase("NewDB");

            expect(sharingService.disconnect).to.have.been.calledOnce;
            expect(connectionMgr.connect).to.have.been.calledOnce;
        });

        test("throws when not connected", async () => {
            try {
                await mgr.changeDatabase("NewDB");
                expect.fail("should have thrown");
            } catch (err: unknown) {
                expect((err as Error).message).to.include("No active connection");
            }
        });

        test("updates label after database change", async () => {
            connectionMgr.getConnectionInfoFromUri.returns(
                makeConnectionInfo({ database: "NewDB" }),
            );

            await mgr.connectWith(makeConnectionInfo());
            await mgr.changeDatabase("NewDB");

            expect(mgr.getConnectionLabel()).to.include("NewDB");
        });

        test("getCurrentDatabase returns new database after change", async () => {
            await mgr.connectWith(makeConnectionInfo());
            await mgr.changeDatabase("SwitchedDB");
            expect(mgr.getCurrentDatabase()).to.equal("SwitchedDB");
        });
    });

    // ----------------------------------------------------------------
    // disconnect
    // ----------------------------------------------------------------
    suite("disconnect", () => {
        test("disconnects and clears all state", async () => {
            await mgr.connectWith(makeConnectionInfo());
            mgr.disconnect();

            expect(mgr.isConnected()).to.be.false;
            expect(mgr.getConnectionUri()).to.be.undefined;
            expect(mgr.getConnectionInfo()).to.be.undefined;
        });

        test("resets label to 'Not connected'", async () => {
            await mgr.connectWith(makeConnectionInfo());
            mgr.disconnect();
            expect(mgr.getConnectionLabel()).to.include("Not connected");
        });

        test("calls connectionSharingService.disconnect with the URI", async () => {
            const uri = await mgr.connectWith(makeConnectionInfo());
            sharingService.disconnect.resetHistory();

            mgr.disconnect();
            expect(sharingService.disconnect).to.have.been.calledOnce;
            expect(sharingService.disconnect).to.have.been.calledWith(uri);
        });

        test("is safe to call when already disconnected", () => {
            expect(() => mgr.disconnect()).to.not.throw();
        });

        test("does not call sharingService.disconnect when no URI", () => {
            mgr.disconnect();
            expect(sharingService.disconnect).to.not.have.been.called;
        });
    });

    // ----------------------------------------------------------------
    // isConnected
    // ----------------------------------------------------------------
    suite("isConnected", () => {
        test("returns false when no connection has been established", () => {
            expect(mgr.isConnected()).to.be.false;
        });

        test("delegates to connectionSharingService.isConnected", async () => {
            await mgr.connectWith(makeConnectionInfo());
            sharingService.isConnected.returns(true);
            expect(mgr.isConnected()).to.be.true;

            sharingService.isConnected.returns(false);
            expect(mgr.isConnected()).to.be.false;
        });
    });

    // ----------------------------------------------------------------
    // executeQueryString
    // ----------------------------------------------------------------
    suite("executeQueryString", () => {
        test("throws when not connected", async () => {
            try {
                await mgr.executeQueryString("SELECT 1");
                expect.fail("should have thrown");
            } catch (err: unknown) {
                expect((err as Error).message).to.include("No active connection");
            }
        });

        test("delegates to query executor when connected", async () => {
            await mgr.connectWith(makeConnectionInfo());

            // The HeadlessQueryExecutor registers a handler via notificationHandler,
            // sends an executeString request via the STS client, and waits for completion.
            // Simulate the full batch lifecycle so the promise resolves.
            mockClient.sendRequest.callsFake(() => {
                const handler = mockNotificationHandler.registerRunner.lastCall?.args[0];
                if (handler?.handleQueryComplete) {
                    const batchSummary = {
                        id: 0,
                        hasError: false,
                        selection: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
                        resultSetSummaries: [],
                        executionElapsed: "00:00:00",
                        executionEnd: "",
                        executionStart: "",
                    };
                    handler.handleBatchStart({ batchSummary, ownerUri: "test" });
                    handler.handleBatchComplete({ batchSummary, ownerUri: "test" });
                    handler.handleQueryComplete({ ownerUri: "test", batchSummaries: [] });
                }
                return Promise.resolve({});
            });

            const result = await mgr.executeQueryString("SELECT 1");
            expect(result).to.have.property("batches");
            expect(result).to.have.property("canceled", false);
        });
    });

    // ----------------------------------------------------------------
    // listDatabases
    // ----------------------------------------------------------------
    suite("listDatabases", () => {
        test("returns databases from connection manager", async () => {
            await mgr.connectWith(makeConnectionInfo());
            const databases = await mgr.listDatabases();
            expect(databases).to.deep.equal(["master", "TestDB"]);
        });

        test("throws when not connected", async () => {
            try {
                await mgr.listDatabases();
                expect.fail("should have thrown");
            } catch (err: unknown) {
                expect((err as Error).message).to.include("No active connection");
            }
        });
    });

    // ----------------------------------------------------------------
    // getCurrentDatabase
    // ----------------------------------------------------------------
    suite("getCurrentDatabase", () => {
        test("returns database from stored connectionInfo", async () => {
            await mgr.connectWith(makeConnectionInfo());
            expect(mgr.getCurrentDatabase()).to.equal("TestDB");
        });

        test("returns empty string when not connected", () => {
            expect(mgr.getCurrentDatabase()).to.equal("");
        });
    });

    // ----------------------------------------------------------------
    // getConnectionLabel
    // ----------------------------------------------------------------
    suite("getConnectionLabel", () => {
        test("returns 'Not connected' when no connection exists", () => {
            expect(mgr.getConnectionLabel()).to.include("Not connected");
        });

        test("returns server / database after connecting", async () => {
            await mgr.connectWith(makeConnectionInfo());
            const label = mgr.getConnectionLabel();
            expect(label).to.equal("test-server / TestDB");
        });
    });

    // ----------------------------------------------------------------
    // connectCellForIntellisense
    // ----------------------------------------------------------------
    suite("connectCellForIntellisense", () => {
        test("sends connect request for cell URI", async () => {
            await mgr.connectWith(makeConnectionInfo());
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            expect(connectionMgr.sendRequest).to.have.been.called;
        });

        test("does nothing when not connected", async () => {
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            expect(connectionMgr.sendRequest).to.not.have.been.called;
        });

        test("handles createConnectionDetails failure gracefully", async () => {
            await mgr.connectWith(makeConnectionInfo());
            connectionMgr.createConnectionDetails.throws(new Error("bad details"));

            // Should not throw
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            expect(log.warn).to.have.been.called;
        });

        test("handles sendRequest failure gracefully", async () => {
            await mgr.connectWith(makeConnectionInfo());
            connectionMgr.sendRequest.rejects(new Error("request failed"));

            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            expect(log.warn).to.have.been.called;
        });

        test("memoizes per cell URI — repeat calls do not re-send", async () => {
            await mgr.connectWith(makeConnectionInfo());
            connectionMgr.sendRequest.resetHistory();

            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            expect(connectionMgr.sendRequest).to.have.been.calledWith(
                sinon.match.any,
                sinon.match({ ownerUri: "vscode-notebook-cell://cell1" }),
            );

            connectionMgr.sendRequest.resetHistory();
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            expect(connectionMgr.sendRequest).to.not.have.been.called;
        });

        test("sends one request per distinct cell URI", async () => {
            await mgr.connectWith(makeConnectionInfo());
            connectionMgr.sendRequest.resetHistory();

            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            expect(connectionMgr.sendRequest).to.have.been.calledWith(
                sinon.match.any,
                sinon.match({ ownerUri: "vscode-notebook-cell://cell1" }),
            );

            connectionMgr.sendRequest.resetHistory();
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell2");
            expect(connectionMgr.sendRequest).to.have.been.calledWith(
                sinon.match.any,
                sinon.match({ ownerUri: "vscode-notebook-cell://cell2" }),
            );

            connectionMgr.sendRequest.resetHistory();
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            expect(connectionMgr.sendRequest).to.not.have.been.called;
        });

        test("re-sends after sendRequest failure (no false memoization)", async () => {
            await mgr.connectWith(makeConnectionInfo());
            connectionMgr.sendRequest.rejects(new Error("transient failure"));

            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            expect(connectionMgr.sendRequest).to.have.been.calledWith(
                sinon.match.any,
                sinon.match({ ownerUri: "vscode-notebook-cell://cell1" }),
            );

            // Recover and retry — should fire again, not be silently memoized
            connectionMgr.sendRequest.resetHistory();
            connectionMgr.sendRequest.resolves(true);
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            expect(connectionMgr.sendRequest).to.have.been.calledWith(
                sinon.match.any,
                sinon.match({ ownerUri: "vscode-notebook-cell://cell1" }),
            );
        });

        test("re-sends when STS resolves false (no false memoization)", async () => {
            // STS signals "failed to initiate" by resolving false instead of
            // rejecting. The cell must not stay memoized or retries break.
            await mgr.connectWith(makeConnectionInfo());
            connectionMgr.sendRequest.resolves(false);

            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            expect(connectionMgr.sendRequest).to.have.been.calledWith(
                sinon.match.any,
                sinon.match({ ownerUri: "vscode-notebook-cell://cell1" }),
            );

            connectionMgr.sendRequest.resetHistory();
            connectionMgr.sendRequest.resolves(true);
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            expect(connectionMgr.sendRequest).to.have.been.calledWith(
                sinon.match.any,
                sinon.match({ ownerUri: "vscode-notebook-cell://cell1" }),
            );
        });

        test("concurrent fire-and-forget calls for same URI dedupe to one request", async () => {
            await mgr.connectWith(makeConnectionInfo());
            connectionMgr.sendRequest.resetHistory();

            // Make sendRequest pend so all three calls launch before any resolve.
            // Without marking the URI registered before the await, all three would
            // pass the has() check and queue duplicate connect RPCs.
            let resolveSend: (value: unknown) => void = () => {};
            const pending = new Promise((resolve) => {
                resolveSend = resolve;
            });
            connectionMgr.sendRequest.returns(pending);

            const p1 = mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            const p2 = mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            const p3 = mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");

            resolveSend(true);
            await Promise.all([p1, p2, p3]);

            // Exactly one connect RPC must have been sent — three would mean the
            // dedup race was not closed.
            expect(connectionMgr.sendRequest).to.have.been.calledOnce;
            expect(connectionMgr.sendRequest).to.have.been.calledWith(
                sinon.match.any,
                sinon.match({ ownerUri: "vscode-notebook-cell://cell1" }),
            );

            // Verify subsequent call is memoized (no new request)
            connectionMgr.sendRequest.resetHistory();
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            expect(connectionMgr.sendRequest).to.not.have.been.called;
        });

        test("disconnect clears memoization", async () => {
            await mgr.connectWith(makeConnectionInfo());
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");

            mgr.disconnect();

            await mgr.connectWith(makeConnectionInfo());
            connectionMgr.sendRequest.resetHistory();
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");

            expect(connectionMgr.sendRequest).to.have.been.calledWith(
                sinon.match.any,
                sinon.match({ ownerUri: "vscode-notebook-cell://cell1" }),
            );
        });

        test("connectWith clears memoization (re-establishing connection)", async () => {
            await mgr.connectWith(makeConnectionInfo());
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");

            // Switching connection profile must force cells to be re-registered
            // because the underlying STS connection is new.
            await mgr.connectWith(makeConnectionInfo({ database: "OtherDB" }));
            connectionMgr.sendRequest.resetHistory();
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");

            expect(connectionMgr.sendRequest).to.have.been.calledWith(
                sinon.match.any,
                sinon.match({ ownerUri: "vscode-notebook-cell://cell1" }),
            );
        });

        test("changeDatabase clears memoization", async () => {
            await mgr.connectWith(makeConnectionInfo());
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");

            await mgr.changeDatabase("OtherDB");
            connectionMgr.sendRequest.resetHistory();
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");

            expect(connectionMgr.sendRequest).to.have.been.calledWith(
                sinon.match.any,
                sinon.match({ ownerUri: "vscode-notebook-cell://cell1" }),
            );
        });

        test("stale in-flight failure does not delete new-generation registration", async () => {
            await mgr.connectWith(makeConnectionInfo());

            // First sendRequest pends so we can swap the connection mid-flight.
            // Second call (after changeDatabase) resolves immediately.
            let rejectSend1: (err: Error) => void = () => {};
            const pending1 = new Promise((_resolve, reject) => {
                rejectSend1 = reject;
            });
            connectionMgr.sendRequest.onFirstCall().returns(pending1);
            connectionMgr.sendRequest.onSecondCall().resolves(true);

            // Stale-generation registration starts but hangs in await.
            const stalePromise = mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");

            // Bump generation. The in-flight stale request is now from a prior gen.
            await mgr.changeDatabase("OtherDB");

            // Register under new generation — succeeds, cell1 is now memoized.
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");

            // Stale request fails. Pre-guard, this would delete cell1 from the set
            // even though it belongs to the new generation.
            rejectSend1(new Error("stale connection error"));
            await stalePromise;

            // Subsequent call under current gen must remain memoized.
            connectionMgr.sendRequest.resetHistory();
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            expect(connectionMgr.sendRequest).to.not.have.been.called;
        });

        test("builds cell connection details from live adhoc connection credentials", async () => {
            // The adhoc (execution) connection's credentials are the ones STS
            // validated — including refreshed tokens and the actual database —
            // so cell registration must prefer them over the stored profile.
            await mgr.connectWith(makeConnectionInfo({ database: "RequestedDB" }));
            connectionMgr.getConnectionInfoFromUri.returns(
                makeConnectionInfo({ database: "LiveDB" }),
            );
            connectionMgr.createConnectionDetails.resetHistory();

            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");

            expect(connectionMgr.createConnectionDetails).to.have.been.calledWithMatch(
                sinon.match({ database: "LiveDB" }),
            );
        });

        test("re-sends after connection/complete reports failure (no false memoization)", async () => {
            // The connect REQUEST resolving true only means the attempt started.
            // A failed completion (no connectionId) must deregister the cell so
            // the next IntelliSense trigger retries instead of leaving the cell
            // with keyword-only completions.
            await mgr.connectWith(makeConnectionInfo());
            connectionMgr.expectConnectionComplete.resolves({
                errorMessage: "Login failed",
            } as ConnectionCompleteParams);

            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            expect(log.warn).to.have.been.called;

            // Recover and retry — must fire a new connect request.
            connectionMgr.sendRequest.resetHistory();
            connectionMgr.expectConnectionComplete.resolves({
                connectionId: "recovered-connection-id",
            } as ConnectionCompleteParams);
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            expect(connectionMgr.sendRequest).to.have.been.calledWith(
                ConnectionRequest.type,
                sinon.match({ ownerUri: "vscode-notebook-cell://cell1" }),
            );
        });

        test("re-sends after connection/complete times out (no false memoization)", async () => {
            await mgr.connectWith(makeConnectionInfo());

            const clock = sandbox.useFakeTimers();
            // Completion never arrives.
            connectionMgr.expectConnectionComplete.returns(
                new Promise<ConnectionCompleteParams>(() => {}),
            );

            const pendingRegistration = mgr.connectCellForIntellisense(
                "vscode-notebook-cell://cell1",
            );
            await clock.tickAsync(31000);
            await pendingRegistration;

            // The pending expectation must be cleaned up on timeout.
            expect(connectionMgr.cancelConnectionCompleteExpectation).to.have.been.calledWith(
                "vscode-notebook-cell://cell1",
            );

            clock.restore();

            // Retry — must fire a new connect request.
            connectionMgr.sendRequest.resetHistory();
            connectionMgr.expectConnectionComplete.resolves({
                connectionId: "recovered-connection-id",
            } as ConnectionCompleteParams);
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            expect(connectionMgr.sendRequest).to.have.been.calledWith(
                ConnectionRequest.type,
                sinon.match({ ownerUri: "vscode-notebook-cell://cell1" }),
            );
        });
    });

    // ----------------------------------------------------------------
    // releaseCellRegistrations
    // ----------------------------------------------------------------
    suite("releaseCellRegistrations", () => {
        test("disconnects registered cell URIs and clears memoization", async () => {
            await mgr.connectWith(makeConnectionInfo());
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell2");
            connectionMgr.sendRequest.resetHistory();

            mgr.releaseCellRegistrations();

            expect(connectionMgr.sendRequest).to.have.been.calledWith(
                DisconnectRequest.type,
                sinon.match({ ownerUri: "vscode-notebook-cell://cell1" }),
            );
            expect(connectionMgr.sendRequest).to.have.been.calledWith(
                DisconnectRequest.type,
                sinon.match({ ownerUri: "vscode-notebook-cell://cell2" }),
            );

            // Memoization cleared — cells can be re-registered under new URIs
            // (or the same URI) with a fresh connect request.
            connectionMgr.sendRequest.resetHistory();
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            expect(connectionMgr.sendRequest).to.have.been.calledWith(
                ConnectionRequest.type,
                sinon.match({ ownerUri: "vscode-notebook-cell://cell1" }),
            );
        });

        test("is a no-op when no cells are registered", () => {
            mgr.releaseCellRegistrations();
            expect(connectionMgr.sendRequest).to.not.have.been.called;
        });

        test("survives disconnect request failures", async () => {
            await mgr.connectWith(makeConnectionInfo());
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            connectionMgr.sendRequest.rejects(new Error("STS unavailable"));

            expect(() => mgr.releaseCellRegistrations()).to.not.throw();

            // Let the rejected fire-and-forget promise settle so the warn logs.
            await new Promise((resolve) => setImmediate(resolve));
            expect(log.warn).to.have.been.called;
        });

        test("disconnect releases registered cell connections from STS", async () => {
            // Each registered cell holds its own STS-side connection; notebook
            // disconnect (including notebook close → dispose) must close them,
            // not just forget them.
            await mgr.connectWith(makeConnectionInfo());
            await mgr.connectCellForIntellisense("vscode-notebook-cell://cell1");
            connectionMgr.sendRequest.resetHistory();

            mgr.disconnect();

            expect(connectionMgr.sendRequest).to.have.been.calledWith(
                DisconnectRequest.type,
                sinon.match({ ownerUri: "vscode-notebook-cell://cell1" }),
            );
        });

        test("stale registration whose connect completed after a connection change is disconnected", async () => {
            await mgr.connectWith(makeConnectionInfo());

            // The cell's connect request is accepted, but before the
            // connection/complete arrives the notebook connection changes.
            let resolveComplete: (params: ConnectionCompleteParams) => void = () => {};
            connectionMgr.expectConnectionComplete.returns(
                new Promise<ConnectionCompleteParams>((resolve) => {
                    resolveComplete = resolve;
                }),
            );
            const staleRegistration = mgr.connectCellForIntellisense(
                "vscode-notebook-cell://cell1",
            );

            await mgr.changeDatabase("OtherDB");
            connectionMgr.sendRequest.resetHistory();

            // The stale connect then completes successfully — its now-unwanted
            // STS connection must be explicitly disconnected.
            resolveComplete({ connectionId: "stale-conn-id" } as ConnectionCompleteParams);
            await staleRegistration;

            expect(connectionMgr.sendRequest).to.have.been.calledWith(
                DisconnectRequest.type,
                sinon.match({ ownerUri: "vscode-notebook-cell://cell1" }),
            );
        });
    });

    // ----------------------------------------------------------------
    // dispose
    // ----------------------------------------------------------------
    suite("dispose", () => {
        test("disconnects on dispose", async () => {
            await mgr.connectWith(makeConnectionInfo());
            mgr.dispose();
            expect(mgr.isConnected()).to.be.false;
            expect(mgr.getConnectionUri()).to.be.undefined;
        });

        test("is idempotent", () => {
            mgr.dispose();
            mgr.dispose();
            expect(mgr.isConnected()).to.be.false;
        });
    });
});
