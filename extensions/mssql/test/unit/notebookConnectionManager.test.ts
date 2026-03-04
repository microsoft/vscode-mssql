/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import type { IConnectionInfo, ConnectionDetails } from "vscode-mssql";

chai.use(sinonChai);

import { NotebookConnectionManager } from "../../src/notebooks/notebookConnectionManager";
import ConnectionManager from "../../src/controllers/connectionManager";
import { ConnectionSharingService } from "../../src/connectionSharing/connectionSharingService";
import { ConnectionStore } from "../../src/models/connectionStore";
import { ConnectionUI } from "../../src/views/connectionUI";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { QueryNotificationHandler } from "../../src/controllers/queryNotificationHandler";

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
 * Build a stub vscode.LogOutputChannel with all required interface
 * members so the type checker is satisfied without `as any`.
 */
function makeLogStub(
    sandbox: sinon.SinonSandbox,
): sinon.SinonStubbedInstance<vscode.LogOutputChannel> {
    return {
        logLevel: vscode.LogLevel.Info,
        onDidChangeLogLevel: sandbox.stub(),
        trace: sandbox.stub(),
        debug: sandbox.stub(),
        info: sandbox.stub(),
        warn: sandbox.stub(),
        error: sandbox.stub(),
        name: "test-log",
        append: sandbox.stub(),
        appendLine: sandbox.stub(),
        clear: sandbox.stub(),
        show: sandbox.stub(),
        hide: sandbox.stub(),
        replace: sandbox.stub(),
        dispose: sandbox.stub(),
    } as sinon.SinonStubbedInstance<vscode.LogOutputChannel>;
}

suite("NotebookConnectionManager", () => {
    let sandbox: sinon.SinonSandbox;
    let connectionMgr: sinon.SinonStubbedInstance<ConnectionManager>;
    let sharingService: sinon.SinonStubbedInstance<ConnectionSharingService>;
    let mockClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let mockNotificationHandler: sinon.SinonStubbedInstance<QueryNotificationHandler>;
    let log: sinon.SinonStubbedInstance<vscode.LogOutputChannel>;
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

        // --- STS client & notification handler (for NotebookQueryExecutor) ---
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

        test("re-prompts when existing connection is stale", async () => {
            await mgr.promptAndConnect();
            sharingService.isConnected.returns(false);

            stubUI.promptForConnection.resetHistory();
            await mgr.ensureConnection();
            expect(stubUI.promptForConnection).to.have.been.calledOnce;
        });

        test("clears connection label when stale", async () => {
            await mgr.promptAndConnect();
            const labelBefore = mgr.getConnectionLabel();
            expect(labelBefore).to.include("test-server");

            // Mark stale, then re-prompt
            sharingService.isConnected.returns(false);
            stubUI.promptForConnection.resolves(
                makeConnectionInfo({ server: "new-server", database: "OtherDB" }),
            );
            connectionMgr.getConnectionInfoFromUri.returns(
                makeConnectionInfo({ server: "new-server", database: "OtherDB" }),
            );

            await mgr.ensureConnection();
            expect(mgr.getConnectionLabel()).to.include("new-server");
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

            // The NotebookQueryExecutor registers a handler via notificationHandler,
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
