/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import * as vscode from "vscode";
import * as mssql from "vscode-mssql";
import { AuthenticatedConnectionSharingService } from "../../src/connectionSharing/authenticatedConnectionSharingService";
import { ConnectionSharingAuthenticationProvider } from "../../src/connectionSharing/connectionSharingAuthenticationProvider";
import {
    ConnectionSharingError,
    ConnectionSharingErrorCode,
} from "../../src/connectionSharing/connectionSharingService";
import ConnectionManager from "../../src/controllers/connectionManager";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { ScriptingService } from "../../src/scripting/scriptingService";
import { IConnectionProfile } from "../../src/models/interfaces";
import { ConnectionStore } from "../../src/models/connectionStore";
import * as Constants from "../../src/constants/constants";
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";
import * as telemetry from "extension-toolkit/vscode/telemetry";

chai.use(sinonChai);

suite("AuthenticatedConnectionSharingService Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let client: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let scriptingService: sinon.SinonStubbedInstance<ScriptingService>;
    let authenticationProvider: sinon.SinonStubbedInstance<ConnectionSharingAuthenticationProvider>;
    let sessionChangeEmitter: vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>;
    let sessionIdsByToken: Map<string, string>;
    let sendActionEventStub: sinon.SinonStub;
    let service: AuthenticatedConnectionSharingService;

    const validToken = "valid-token";
    const sessionId = "session-1";
    const testConnectionId = "test-connection-id";
    const testDatabase = "TestDatabase";

    const mockConnectionProfile: IConnectionProfile = {
        id: testConnectionId,
        server: "test-server",
        database: testDatabase,
        user: "test-user",
        authenticationType: "SqlLogin",
        password: "",
        savePassword: false,
        profileName: "Test Profile",
    } as IConnectionProfile;

    const mockServerInfo = { serverMajorVersion: 16 } as mssql.IServerInfo;

    async function expectConnectionSharingError(
        action: Promise<unknown>,
        code: ConnectionSharingErrorCode,
    ): Promise<void> {
        try {
            await action;
        } catch (error) {
            expect(error).to.be.instanceOf(ConnectionSharingError);
            expect((error as ConnectionSharingError).code).to.equal(code);
            return;
        }
        expect.fail(`Expected a ${code} error`);
    }

    function removedSession(id: string): vscode.AuthenticationSession {
        return { id, accessToken: "", account: { id: "account", label: "account" }, scopes: [] };
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        client = sandbox.createStubInstance(SqlToolsServiceClient);
        connectionManager = sandbox.createStubInstance(ConnectionManager);
        scriptingService = sandbox.createStubInstance(ScriptingService);

        sessionIdsByToken = new Map([[validToken, sessionId]]);
        sessionChangeEmitter =
            new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
        authenticationProvider = sandbox.createStubInstance(
            ConnectionSharingAuthenticationProvider,
        );
        authenticationProvider.getSessionIdForAccessToken.callsFake(async (token: string) =>
            sessionIdsByToken.get(token),
        );
        (
            authenticationProvider as unknown as {
                onDidChangeSessions: vscode.Event<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>;
            }
        ).onDidChangeSessions = sessionChangeEmitter.event;

        const connectionStoreStub = {
            connectionConfig: {
                getConnections: sandbox.stub().resolves([mockConnectionProfile]),
            },
        } as unknown as ConnectionStore;
        sandbox.stub(connectionManager, "connectionStore").get(() => connectionStoreStub);
        connectionManager.isConnected.returns(true);
        connectionManager.getConnectionInfoFromUri.returns(mockConnectionProfile);
        connectionManager.getServerInfo.returns(mockServerInfo);
        connectionManager.listDatabases.resolves(["master", testDatabase]);
        connectionManager.connect.resolves(true);
        connectionManager.disconnect.resolves(true);
        connectionManager.createConnectionDetails.returns({} as mssql.ConnectionDetails);
        connectionManager.getConnectionString.resolves("Server=test;");

        sendActionEventStub = sandbox.stub(telemetry, "sendActionEvent");

        service = new AuthenticatedConnectionSharingService(
            authenticationProvider,
            client,
            connectionManager,
            scriptingService,
        );
    });

    teardown(() => {
        service.dispose();
        sessionChangeEmitter.dispose();
        sandbox.restore();
    });

    test("exposes the authentication provider ID", () => {
        expect(service.authenticationProviderId).to.equal(
            Constants.connectionSharingAuthenticationProviderId,
        );
    });

    test("rejects calls with an invalid access token", async () => {
        await expectConnectionSharingError(
            service.connect("wrong-token", testConnectionId),
            ConnectionSharingErrorCode.INVALID_ACCESS_TOKEN,
        );
        await expectConnectionSharingError(
            service.getConnectionString("wrong-token", testConnectionId),
            ConnectionSharingErrorCode.INVALID_ACCESS_TOKEN,
        );
        expect(connectionManager.connect).not.to.have.been.called;
        expect(connectionManager.getConnectionString).not.to.have.been.called;
    });

    test("connects to a saved connection and records the call", async () => {
        const connectionUri = await service.connect(validToken, testConnectionId, "OtherDatabase");

        expect(connectionManager.connect).to.have.been.calledWithMatch(
            connectionUri,
            sinon.match({ id: testConnectionId, database: "OtherDatabase" }),
        );
        expect(mockConnectionProfile.database).to.equal(testDatabase);
        expect(await service.isConnected(validToken, connectionUri)).to.be.true;
        expect(sendActionEventStub).to.have.been.calledWith(
            TelemetryViews.Connection,
            TelemetryActions.AuthenticatedConnectionSharingApiCalled,
            { additionalProps: { method: "connect", authenticationType: "SqlLogin" } },
        );
    });

    test("throws when the saved connection doesn't exist", async () => {
        await expectConnectionSharingError(
            service.connect(validToken, "missing-connection"),
            ConnectionSharingErrorCode.CONNECTION_NOT_FOUND,
        );
    });

    test("throws when the connection can't be established", async () => {
        connectionManager.connect.resolves(false);

        await expectConnectionSharingError(
            service.connect(validToken, testConnectionId),
            ConnectionSharingErrorCode.CONNECTION_FAILED,
        );
    });

    test("runs queries, scripts, and lookups on a connection it opened", async () => {
        const queryResult = { rowCount: 1 } as mssql.SimpleExecuteResult;
        client.sendRequest.resolves(queryResult);
        scriptingService.script.resolves("CREATE TABLE t");
        const connectionUri = await service.connect(validToken, testConnectionId);

        expect(await service.executeSimpleQuery(validToken, connectionUri, "SELECT 1")).to.equal(
            queryResult,
        );
        expect(client.sendRequest).to.have.been.calledWithMatch(sinon.match.any, {
            ownerUri: connectionUri,
            queryString: "SELECT 1",
        });
        expect(await service.getServerInfo(validToken, connectionUri)).to.equal(mockServerInfo);
        expect(await service.listDatabases(validToken, connectionUri)).to.deep.equal([
            "master",
            testDatabase,
        ]);
        expect(
            await service.scriptObject(validToken, connectionUri, 0, {
                name: "t",
                schema: "dbo",
                type: "Table",
            }),
        ).to.equal("CREATE TABLE t");
    });

    test("rejects a connection URI it didn't open, such as a query editor's", async () => {
        const editorUri = "file:///query.sql";

        await expectConnectionSharingError(
            service.executeSimpleQuery(validToken, editorUri, "SELECT 1"),
            ConnectionSharingErrorCode.INVALID_CONNECTION_URI,
        );
        await expectConnectionSharingError(
            service.disconnect(validToken, editorUri),
            ConnectionSharingErrorCode.INVALID_CONNECTION_URI,
        );
        expect(await service.isConnected(validToken, editorUri)).to.be.false;
        expect(client.sendRequest).not.to.have.been.called;
        expect(connectionManager.disconnect).not.to.have.been.called;
    });

    test("rejects a connection URI that another session opened", async () => {
        const connectionUri = await service.connect(validToken, testConnectionId);
        sessionIdsByToken.set("other-token", "session-2");

        await expectConnectionSharingError(
            service.executeSimpleQuery("other-token", connectionUri, "SELECT 1"),
            ConnectionSharingErrorCode.INVALID_CONNECTION_URI,
        );
    });

    test("reports a closed connection as not active", async () => {
        const connectionUri = await service.connect(validToken, testConnectionId);
        connectionManager.isConnected.returns(false);

        await expectConnectionSharingError(
            service.executeSimpleQuery(validToken, connectionUri, "SELECT 1"),
            ConnectionSharingErrorCode.NO_ACTIVE_CONNECTION,
        );
    });

    test("disconnects a connection it opened", async () => {
        const connectionUri = await service.connect(validToken, testConnectionId);

        await service.disconnect(validToken, connectionUri);

        expect(connectionManager.disconnect).to.have.been.calledWith(connectionUri);
        expect(await service.isConnected(validToken, connectionUri)).to.be.false;
    });

    test("closes a session's connections when the session ends", async () => {
        const connectionUri = await service.connect(validToken, testConnectionId);

        sessionChangeEmitter.fire({ added: [], removed: [removedSession(sessionId)], changed: [] });

        expect(connectionManager.disconnect).to.have.been.calledWith(connectionUri);
        expect(await service.isConnected(validToken, connectionUri)).to.be.false;
    });

    test("closes a connection whose session ended while it was opening", async () => {
        connectionManager.connect.callsFake(async () => {
            sessionIdsByToken.delete(validToken);
            return true;
        });

        await expectConnectionSharingError(
            service.connect(validToken, testConnectionId),
            ConnectionSharingErrorCode.INVALID_ACCESS_TOKEN,
        );
        expect(connectionManager.disconnect).to.have.been.called;
    });

    test("returns the connection string for a saved connection", async () => {
        expect(await service.getConnectionString(validToken, testConnectionId)).to.equal(
            "Server=test;",
        );
        expect(connectionManager.getConnectionString).to.have.been.calledWith(
            sinon.match.any,
            true,
            false,
        );
    });

    test("returns the active editor's connection and database", async () => {
        sandbox.stub(vscode.window, "activeTextEditor").get(() => ({
            document: { uri: vscode.Uri.parse("file:///test.sql") },
        }));

        expect(await service.getActiveEditorConnectionId(validToken)).to.equal(testConnectionId);
        expect(await service.getActiveDatabase(validToken)).to.equal(testDatabase);
        expect(await service.getDatabaseForConnectionId(validToken, testConnectionId)).to.equal(
            testDatabase,
        );
    });

    test("throws when there is no active editor", async () => {
        sandbox.stub(vscode.window, "activeTextEditor").get(() => undefined);

        await expectConnectionSharingError(
            service.getActiveEditorConnectionId(validToken),
            ConnectionSharingErrorCode.NO_ACTIVE_EDITOR,
        );
    });
});
