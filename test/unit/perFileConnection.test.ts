/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";

import * as vscode from "vscode";

import { IPrompter } from "../../src/prompts/question";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";

import { IConnectionInfo, IServerInfo } from "vscode-mssql";
import * as LocalizedConstants from "../../src/constants/locConstants";
import ConnectionManager from "../../src/controllers/connectionManager";
import MainController from "../../src/controllers/mainController";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { ConnectionStore } from "../../src/models/connectionStore";
import * as ConnectionContracts from "../../src/models/contracts/connection";
import * as LanguageServiceContracts from "../../src/models/contracts/languageService";
import * as Interfaces from "../../src/models/interfaces";
import { AuthenticationTypes } from "../../src/models/interfaces";
import * as Utils from "../../src/models/utils";
import { ConnectionUI } from "../../src/views/connectionUI";
import StatusView from "../../src/views/statusView";
import { stubExtensionContext, stubVscodeWrapper } from "./utils";

const expect = chai.expect;

chai.use(sinonChai);

let sandbox: sinon.SinonSandbox;
let extensionContext: vscode.ExtensionContext;

suite("Per File Connection Tests", () => {
    setup(() => {
        sandbox = sinon.createSandbox();
        extensionContext = stubExtensionContext(sandbox);
        (extensionContext as unknown as { subscriptions: vscode.Disposable[] }).subscriptions = [];
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Can create two separate connections for two files", async () => {
        const testFile1 = "file:///my/test/file.sql";
        const testFile2 = "file:///my/test/file2.sql";

        let manager: ConnectionManager = createTestConnectionManager();

        const serviceClientStub = sandbox.createStubInstance(SqlToolsServiceClient);
        serviceClientStub.sendRequest.callsFake(
            (_type: unknown, params: ConnectionContracts.ConnectParams) => {
                manager
                    .handleConnectionCompleteNotification()
                    .call(manager, createTestConnectionResult(params.ownerUri));
                return Promise.resolve(true);
            },
        );

        manager.client = serviceClientStub as unknown as SqlToolsServiceClient;

        // Create two different connections using the connection manager
        let connectionCreds = createTestCredentials();
        let connectionCreds2 = createTestCredentials();
        connectionCreds2.database = "my_other_db";

        const result1 = await manager.connect(testFile1, connectionCreds);
        assert.equal(result1, true);
        const result2 = await manager.connect(testFile2, connectionCreds);
        assert.equal(result2, true);

        // Check that two connections were established
        assert.equal(manager.connectionCount, 2);
        assert.equal(manager.isConnected(testFile1), true);
        assert.equal(manager.isConnected(testFile2), true);
    });

    test("Can disconnect one file while another file stays connected", async () => {
        const testFile1 = "file:///my/test/file.sql";
        const testFile2 = "file:///my/test/file2.sql";

        let manager: ConnectionManager = createTestConnectionManager();

        const serviceClientStub = sandbox.createStubInstance(SqlToolsServiceClient);
        serviceClientStub.sendRequest
            .withArgs(ConnectionContracts.ConnectionRequest.type, sinon.match.any)
            .callsFake((_, params: ConnectionContracts.ConnectParams) => {
                manager
                    .handleConnectionCompleteNotification()
                    .call(manager, createTestConnectionResult(params.ownerUri));
                return Promise.resolve(true);
            });
        serviceClientStub.sendRequest
            .withArgs(ConnectionContracts.DisconnectRequest.type, sinon.match.any)
            .resolves(true);

        manager.client = serviceClientStub as unknown as SqlToolsServiceClient;

        const connectionCreds = createTestCredentials();
        const connectionCreds2 = createTestCredentials();
        connectionCreds2.database = "my_other_db";

        const result1 = await manager.connect(testFile1, connectionCreds);
        assert.equal(result1, true);
        const result2 = await manager.connect(testFile2, connectionCreds);
        assert.equal(result2, true);

        assert.equal(manager.connectionCount, 2);
        assert.equal(manager.isConnected(testFile1), true);
        assert.equal(manager.isConnected(testFile2), true);

        const disconnectResult = await manager.disconnect(testFile2);
        assert.equal(disconnectResult, true);

        assert.equal(manager.connectionCount, 1);
        assert.equal(manager.isConnected(testFile1), true);
        assert.equal(manager.isConnected(testFile2), false);
    });

    test("Can disconnect and reconnect one file while another file stays connected", async () => {
        const testFile1 = "file:///my/test/file.sql";
        const testFile2 = "file:///my/test/file2.sql";

        let manager: ConnectionManager = createTestConnectionManager();

        const serviceClientStub = sandbox.createStubInstance(SqlToolsServiceClient);
        serviceClientStub.sendRequest
            .withArgs(ConnectionContracts.ConnectionRequest.type, sinon.match.any)
            .callsFake((_, params: ConnectionContracts.ConnectParams) => {
                manager
                    .handleConnectionCompleteNotification()
                    .call(manager, createTestConnectionResult(params.ownerUri));
                return Promise.resolve(true);
            });
        serviceClientStub.sendRequest
            .withArgs(ConnectionContracts.DisconnectRequest.type, sinon.match.any)
            .resolves(true);

        manager.client = serviceClientStub as unknown as SqlToolsServiceClient;

        const connectionCreds = createTestCredentials();
        const connectionCreds2 = createTestCredentials();
        connectionCreds2.database = "my_other_db";

        const result1 = await manager.connect(testFile1, connectionCreds);
        assert.equal(result1, true);
        const result2 = await manager.connect(testFile2, connectionCreds);
        assert.equal(result2, true);

        assert.equal(manager.connectionCount, 2);
        assert.equal(manager.isConnected(testFile1), true);
        assert.equal(manager.isConnected(testFile2), true);

        const disconnectResult = await manager.disconnect(testFile2);
        assert.equal(disconnectResult, true);

        assert.equal(manager.connectionCount, 1);
        assert.equal(manager.isConnected(testFile1), true);
        assert.equal(manager.isConnected(testFile2), false);

        const reconnectResult = await manager.connect(testFile2, connectionCreds2);
        assert.equal(reconnectResult, true);

        assert.equal(manager.connectionCount, 2);
        assert.equal(manager.isConnected(testFile1), true);
        assert.equal(manager.isConnected(testFile2), true);
    });

    test("Can list databases on server used by current connection and switch databases", async () => {
        const testFile = "file:///my/test/file.sql";

        let manager: ConnectionManager = createTestConnectionManager();

        const serviceClientStub = sandbox.createStubInstance(SqlToolsServiceClient);
        serviceClientStub.sendRequest
            .withArgs(ConnectionContracts.ConnectionRequest.type, sinon.match.any)
            .callsFake((_, params: ConnectionContracts.ConnectParams) => {
                manager
                    .handleConnectionCompleteNotification()
                    .call(manager, createTestConnectionResult(params.ownerUri));
                return Promise.resolve(true);
            });
        serviceClientStub.sendRequest
            .withArgs(ConnectionContracts.DisconnectRequest.type, sinon.match.any)
            .resolves(true);
        serviceClientStub.sendRequest
            .withArgs(ConnectionContracts.ListDatabasesRequest.type, sinon.match.any)
            .resolves(createTestListDatabasesResult());

        const newDatabaseCredentials = createTestCredentials();
        newDatabaseCredentials.database = "master";

        const newDatabaseChoice = <Interfaces.IConnectionCredentialsQuickPickItem>{
            label: "master",
            description: "",
            detail: "",
            connectionCreds: newDatabaseCredentials,
            quickPickItemType: Interfaces.CredentialsQuickPickItemType.Mru,
        };

        const vscodeWrapperStub = stubVscodeWrapper(sandbox);
        vscodeWrapperStub.showQuickPick.resolves(newDatabaseChoice as vscode.QuickPickItem);
        sandbox.stub(vscodeWrapperStub, "activeTextEditorUri").get(() => testFile);

        manager.client = serviceClientStub as unknown as SqlToolsServiceClient;
        manager.vscodeWrapper = vscodeWrapperStub as unknown as VscodeWrapper;
        manager.connectionUI.vscodeWrapper = vscodeWrapperStub as unknown as VscodeWrapper;

        const connectionCreds = createTestCredentials();

        const connectResult = await manager.connect(testFile, connectionCreds);
        assert.equal(connectResult, true);

        assert.equal(manager.isConnected(testFile), true);
        assert.equal(
            manager.getConnectionInfo(testFile).credentials.database,
            connectionCreds.database,
        );

        const chooseResult = await manager.onChooseDatabase();
        assert.equal(chooseResult, true);

        const listDbCalls = serviceClientStub.sendRequest
            .getCalls()
            .filter((call) => call.args[0] === ConnectionContracts.ListDatabasesRequest.type);
        expect(listDbCalls).to.have.lengthOf(1);
        expect(vscodeWrapperStub.showQuickPick).to.have.been.calledOnce;

        assert.equal(manager.isConnected(testFile), true);
        assert.equal(manager.getConnectionInfo(testFile).credentials.database, "master");
    });

    test("Can disconnect instead of switching databases", async () => {
        const testFile = "file:///my/test/file.sql";

        let manager: ConnectionManager = createTestConnectionManager();

        const serviceClientStub = sandbox.createStubInstance(SqlToolsServiceClient);
        serviceClientStub.sendRequest
            .withArgs(ConnectionContracts.ConnectionRequest.type, sinon.match.any)
            .callsFake((_, params: ConnectionContracts.ConnectParams) => {
                manager
                    .handleConnectionCompleteNotification()
                    .call(manager, createTestConnectionResult(params.ownerUri));
                return Promise.resolve(true);
            });
        serviceClientStub.sendRequest
            .withArgs(ConnectionContracts.DisconnectRequest.type, sinon.match.any)
            .resolves(true);
        serviceClientStub.sendRequest
            .withArgs(ConnectionContracts.ListDatabasesRequest.type, sinon.match.any)
            .resolves(createTestListDatabasesResult());

        const vscodeWrapperStub = stubVscodeWrapper(sandbox);
        sandbox.stub(vscodeWrapperStub, "activeTextEditorUri").get(() => testFile);
        vscodeWrapperStub.showQuickPick.callsFake(
            async (options: Interfaces.IConnectionCredentialsQuickPickItem[]) => {
                return options.find(
                    (option) => option.label === LocalizedConstants.disconnectOptionLabel,
                );
            },
        );

        manager.client = serviceClientStub as unknown as SqlToolsServiceClient;
        manager.vscodeWrapper = vscodeWrapperStub as unknown as VscodeWrapper;
        manager.connectionUI.vscodeWrapper = vscodeWrapperStub as unknown as VscodeWrapper;

        const prompterStub = (
            manager.connectionUI as unknown as {
                _prompter: { promptSingle: sinon.SinonStub };
            }
        )._prompter.promptSingle;
        prompterStub.resolves(true);

        const connectionCreds = createTestCredentials();

        const connectResult = await manager.connect(testFile, connectionCreds);
        assert.equal(connectResult, true);
        assert.equal(manager.isConnected(testFile), true);
        assert.equal(
            manager.getConnectionInfo(testFile).credentials.database,
            connectionCreds.database,
        );

        const chooseResult = await manager.onChooseDatabase();
        assert.equal(chooseResult, false);

        const listDbCalls = serviceClientStub.sendRequest
            .getCalls()
            .filter((call) => call.args[0] === ConnectionContracts.ListDatabasesRequest.type);
        expect(listDbCalls).to.have.lengthOf(1);

        assert.equal(manager.isConnected(testFile), false);
    });

    test("Prompts for new connection before running query if disconnected", async () => {
        const vscodeWrapperStub = stubVscodeWrapper(sandbox);
        sandbox.stub(vscodeWrapperStub, "isEditingSqlFile").get(() => true);
        sandbox.stub(vscodeWrapperStub, "activeTextEditorUri").get(() => "file://my/test/file.sql");

        const connectionManagerStub = sandbox.createStubInstance(ConnectionManager);
        connectionManagerStub.isConnected.returns(false);
        connectionManagerStub.onNewConnection.resolves();

        const controller = new MainController(
            extensionContext,
            connectionManagerStub as unknown as ConnectionManager,
            vscodeWrapperStub as unknown as VscodeWrapper,
        );

        await controller.onRunQuery();

        expect(connectionManagerStub.onNewConnection).to.have.been.calledOnce;
    });

    test("Change connection notification changes database context", async () => {
        const testFile = "file:///my/test/file.sql";

        let connectionManager: ConnectionManager = createTestConnectionManager();

        const serviceClientStub = sandbox.createStubInstance(SqlToolsServiceClient);
        serviceClientStub.sendRequest
            .withArgs(ConnectionContracts.ConnectionRequest.type, sinon.match.any)
            .callsFake((_, params: ConnectionContracts.ConnectParams) => {
                connectionManager
                    .handleConnectionCompleteNotification()
                    .call(connectionManager, createTestConnectionResult(params.ownerUri));
                return Promise.resolve(true);
            });

        connectionManager.client = serviceClientStub as unknown as SqlToolsServiceClient;

        const connectionCreds = createTestCredentials();

        const connectResult = await connectionManager.connect(testFile, connectionCreds);
        assert.equal(connectResult, true);
        assert.equal(connectionManager.isConnected(testFile), true);
        assert.equal(
            connectionManager.getConnectionInfo(testFile).credentials.database,
            connectionCreds.database,
        );

        const parameters = new ConnectionContracts.ConnectionChangedParams();
        parameters.ownerUri = testFile;
        parameters.connection = new ConnectionContracts.ConnectionSummary();
        parameters.connection.serverName = connectionCreds.server;
        parameters.connection.databaseName = "myOtherDatabase";
        parameters.connection.userName = connectionCreds.user;

        const notificationObject = connectionManager.handleConnectionChangedNotification();
        notificationObject.call(connectionManager, parameters);

        assert.equal(
            connectionManager.getConnectionInfo(testFile).credentials.database,
            "myOtherDatabase",
        );
    });

    test("Should use actual database name instead of <default>", async () => {
        const testFile = "file:///my/test/file.sql";
        const expectedDbName = "master";

        let manager: ConnectionManager = createTestConnectionManager();

        // Given a connection to default database
        let connectionCreds = createTestCredentials();
        connectionCreds.database = "";

        // When the result will return 'master' as the database connected to
        let myResult = createConnectionResultForCreds(connectionCreds, expectedDbName);
        myResult.ownerUri = testFile;

        const serviceClientStub = sandbox.createStubInstance(SqlToolsServiceClient);
        serviceClientStub.sendRequest.callsFake(
            (_type: unknown, _params: ConnectionContracts.ConnectParams) => {
                manager.handleConnectionCompleteNotification().call(manager, myResult);
                return Promise.resolve(true);
            },
        );

        const statusViewStub = sandbox.createStubInstance(StatusView);
        let actualDbName: string | undefined;
        statusViewStub.connectSuccess.callsFake(
            (_fileUri: string, creds: IConnectionInfo, _server: IServerInfo) => {
                actualDbName = creds.database;
                return undefined;
            },
        );

        manager.client = serviceClientStub as unknown as SqlToolsServiceClient;
        manager.statusView = statusViewStub as unknown as StatusView;

        const result = await manager.connect(testFile, connectionCreds);
        assert.equal(result, true);
        assert.equal(manager.getConnectionInfo(testFile).credentials.database, expectedDbName);
        assert.equal(actualDbName, expectedDbName);
    });

    function createConnectionResultForCreds(
        connectionCreds: IConnectionInfo,
        dbName?: string,
    ): ConnectionContracts.ConnectionCompleteParams {
        let myResult = new ConnectionContracts.ConnectionCompleteParams();
        if (!dbName) {
            dbName = connectionCreds.database;
        }
        myResult.connectionId = Utils.generateGuid();
        myResult.messages = "";
        myResult.connectionSummary = {
            serverName: connectionCreds.server,
            databaseName: dbName,
            userName: connectionCreds.user,
        };
        const serverInfo: IServerInfo = {
            engineEditionId: 0,
            serverMajorVersion: 0,
            isCloud: false,
            serverMinorVersion: 0,
            serverReleaseVersion: 0,
            serverVersion: "",
            serverLevel: "",
            serverEdition: "",
            azureVersion: 0,
            osVersion: "",
        };
        myResult.serverInfo = serverInfo;
        return myResult;
    }

    test("Should save new connections to recently used list", async () => {
        const testFile = "file:///my/test/file.sql";
        const expectedDbName = "master";

        let manager: ConnectionManager = createTestConnectionManager();

        // Given a connection to default database
        let connectionCreds = createTestCredentials();
        connectionCreds.database = "";

        // When the result will return 'master' as the database connected to
        let myResult = createConnectionResultForCreds(connectionCreds, expectedDbName);
        myResult.ownerUri = testFile;

        const serviceClientStub = sandbox.createStubInstance(SqlToolsServiceClient);
        serviceClientStub.sendRequest.callsFake(
            (_type: unknown, _params: ConnectionContracts.ConnectParams) => {
                manager.handleConnectionCompleteNotification().call(manager, myResult);
                return Promise.resolve(true);
            },
        );

        const statusViewStub = sandbox.createStubInstance(StatusView);
        statusViewStub.connectSuccess.callsFake(() => undefined);

        let savedConnection: IConnectionInfo | undefined;
        const connectionStoreStub = sandbox.createStubInstance(ConnectionStore);
        (connectionStoreStub.addRecentlyUsed as sinon.SinonStub).callsFake(
            async (conn: IConnectionInfo) => {
                savedConnection = conn;
                return;
            },
        );

        manager.client = serviceClientStub as unknown as SqlToolsServiceClient;
        manager.statusView = statusViewStub as unknown as StatusView;
        manager.connectionStore = connectionStoreStub as unknown as ConnectionStore;

        const result = await manager.connect(testFile, connectionCreds);
        assert.equal(result, true);
        expect(connectionStoreStub.addRecentlyUsed).to.have.been.calledOnce;
        assert.equal(
            savedConnection?.database,
            expectedDbName,
            "Expect actual DB name returned from connection to be saved",
        );
        assert.equal(
            savedConnection?.password,
            connectionCreds.password,
            "Expect password to be saved",
        );
    });

    test("Status view shows updating intellisense after connecting and disappears after intellisense is updated", async () => {
        const testFile = "file:///my/test/file.sql";

        let manager: ConnectionManager = createTestConnectionManager();
        const statusViewStub = sandbox.createStubInstance(StatusView);
        const languageStatusStub =
            statusViewStub.languageServiceStatusChanged as unknown as sinon.SinonStub;
        const serviceClientStub = sandbox.createStubInstance(SqlToolsServiceClient);
        serviceClientStub.sendRequest.callsFake(
            (_type: unknown, params: ConnectionContracts.ConnectParams) => {
                manager
                    .handleConnectionCompleteNotification()
                    .call(manager, createTestConnectionResult(params.ownerUri));
                return Promise.resolve(true);
            },
        );

        manager.statusView = statusViewStub as unknown as StatusView;
        manager.client = serviceClientStub as unknown as SqlToolsServiceClient;

        const result = await manager.connect(testFile, createTestCredentials());
        assert.equal(result, true);
        expect(languageStatusStub).to.have.been.calledWith(
            sinon.match.any,
            LocalizedConstants.updatingIntelliSenseStatus,
        );
        const updatedCalls = languageStatusStub
            .getCalls()
            .filter((call) => call.args[1] === LocalizedConstants.intelliSenseUpdatedStatus);
        expect(updatedCalls).to.have.lengthOf(0);

        const langResult = new LanguageServiceContracts.IntelliSenseReadyParams();
        langResult.ownerUri = testFile;
        manager.handleLanguageServiceUpdateNotification().call(manager, langResult);

        const updatedAfterNotification = languageStatusStub
            .getCalls()
            .filter((call) => call.args[1] === LocalizedConstants.intelliSenseUpdatedStatus);
        expect(updatedAfterNotification).to.have.lengthOf(1);
    });
});

function createTestConnectionResult(
    ownerUri?: string,
): ConnectionContracts.ConnectionCompleteParams {
    let result = new ConnectionContracts.ConnectionCompleteParams();
    result.connectionId = Utils.generateGuid();
    result.messages = "";
    result.ownerUri = ownerUri;
    return result;
}

function createTestCredentials(): IConnectionInfo {
    const creds: IConnectionInfo = {
        server: "my-server",
        database: "my_db",
        user: "sa",
        password: "12345678",
        email: "test-email",
        accountId: "test-account-id",
        tenantId: "test-tenant-id",
        port: 1234,
        authenticationType: AuthenticationTypes[AuthenticationTypes.SqlLogin],
        azureAccountToken: "",
        expiresOn: 0,
        encrypt: "Optional",
        trustServerCertificate: false,
        hostNameInCertificate: "",
        persistSecurityInfo: false,
        columnEncryptionSetting: "enabled",
        secureEnclaves: "Enabled",
        attestationProtocol: "HGS",
        enclaveAttestationUrl: "https://attestationurl",
        connectTimeout: 15,
        commandTimeout: 30,
        connectRetryCount: 0,
        connectRetryInterval: 0,
        applicationName: "vscode-mssql",
        workstationId: "test",
        applicationIntent: "",
        currentLanguage: "",
        pooling: true,
        maxPoolSize: 15,
        minPoolSize: 0,
        loadBalanceTimeout: 0,
        replication: false,
        attachDbFilename: "",
        failoverPartner: "",
        multiSubnetFailover: false,
        multipleActiveResultSets: false,
        packetSize: 8192,
        typeSystemVersion: "Latest",
        connectionString: "",
        containerName: "",
    };
    return creds;
}

function createTestConnectionManager(
    serviceClient?: SqlToolsServiceClient,
    wrapper?: VscodeWrapper,
    statusView?: StatusView,
    connectionStore?: ConnectionStore,
    connectionUI?: ConnectionUI,
): ConnectionManager {
    const prompterStub: IPrompter = {
        prompt: sandbox.stub().resolves(undefined),
        promptSingle: sandbox.stub().resolves(undefined),
        promptCallback: sandbox.stub(),
    };
    const statusViewInstance = statusView ?? sandbox.createStubInstance(StatusView);

    let connectionStoreInstance: ConnectionStore = connectionStore;

    if (!connectionStoreInstance) {
        const stubbedConnectionStore = sandbox.createStubInstance(ConnectionStore);
        stubbedConnectionStore.addRecentlyUsed.resolves();
        connectionStoreInstance = stubbedConnectionStore;
    }

    if (!connectionStore) {
        (connectionStoreInstance.addRecentlyUsed as unknown as sinon.SinonStub).resolves();
    }

    return new ConnectionManager(
        extensionContext,
        statusViewInstance,
        prompterStub,
        undefined, // logger
        serviceClient,
        wrapper,
        connectionStoreInstance,
        undefined, // credentialStore
        connectionUI,
    );
}

function createTestListDatabasesResult(): ConnectionContracts.ListDatabasesResult {
    let result = new ConnectionContracts.ListDatabasesResult();
    result.databaseNames = ["master", "model", "msdb", "tempdb", "mydatabase"];
    return result;
}
