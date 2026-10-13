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
import { SharedConnectionsService } from "../../src/connectionSharing/sharedConnectionsService";
import {
    AccessTokenRejection,
    SharedConnectionsAuthenticationProvider,
} from "../../src/connectionSharing/sharedConnectionsAuthenticationProvider";
import {
    ConnectionSharingError,
    ConnectionSharingErrorCode,
} from "../../src/connectionSharing/connectionSharingService";
import ConnectionManager from "../../src/controllers/connectionManager";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { ScriptingService } from "../../src/scripting/scriptingService";
import { QueryCancelRequest } from "../../src/models/contracts/queryCancel";
import { IConnectionProfile } from "../../src/models/interfaces";
import { ConnectionStore } from "../../src/models/connectionStore";
import * as Constants from "../../src/constants/constants";
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";
import * as telemetry from "extension-toolkit/vscode/telemetry";

chai.use(sinonChai);

suite("SharedConnectionsService Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let client: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let scriptingService: sinon.SinonStubbedInstance<ScriptingService>;
    let authenticationProvider: sinon.SinonStubbedInstance<SharedConnectionsAuthenticationProvider>;
    let sessionChangeEmitter: vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>;
    let sessionIdsByToken: Map<string, string>;
    let tokenRejections: Map<string, AccessTokenRejection>;
    let activeSessionIds: Set<string>;
    let sendActionEventStub: sinon.SinonStub;
    let registeredCommands: Map<string, (...args: unknown[]) => Promise<unknown>>;
    let connectionsChangedEmitter: vscode.EventEmitter<void>;
    let databaseContextEmitter: vscode.EventEmitter<string>;
    let activeEditorChangeEmitter: vscode.EventEmitter<vscode.TextEditor | undefined>;
    let service: SharedConnectionsService;

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
            SharedConnectionsAuthenticationProvider,
        );
        tokenRejections = new Map();
        authenticationProvider.checkAccessToken.callsFake(async (token: string) => {
            const id = sessionIdsByToken.get(token);
            return id ? { sessionId: id } : { rejection: tokenRejections.get(token) ?? "unknown" };
        });
        activeSessionIds = new Set([sessionId]);
        authenticationProvider.isSessionActive.callsFake(async (id: string) =>
            activeSessionIds.has(id),
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
        registeredCommands = new Map();
        connectionsChangedEmitter = new vscode.EventEmitter<void>();
        databaseContextEmitter = new vscode.EventEmitter<string>();
        activeEditorChangeEmitter = new vscode.EventEmitter<vscode.TextEditor | undefined>();
        Object.assign(connectionManager, {
            onConnectionsChanged: connectionsChangedEmitter.event,
            onDidChangeDatabaseContext: databaseContextEmitter.event,
        });
        sandbox
            .stub(vscode.window, "onDidChangeActiveTextEditor")
            .callsFake(activeEditorChangeEmitter.event);
        sandbox
            .stub(vscode.commands, "registerCommand")
            .callsFake((command: string, callback: (...args: unknown[]) => Promise<unknown>) => {
                registeredCommands.set(command, callback);
                return { dispose: sandbox.stub() };
            });

        service = new SharedConnectionsService(
            authenticationProvider,
            client,
            connectionManager,
            scriptingService,
        );
    });

    teardown(() => {
        service.dispose();
        sessionChangeEmitter.dispose();
        connectionsChangedEmitter.dispose();
        databaseContextEmitter.dispose();
        activeEditorChangeEmitter.dispose();
        sandbox.restore();
    });

    test("exposes the authentication provider ID", () => {
        expect(service.authenticationProviderId).to.equal(
            Constants.sharedConnectionsAuthenticationProviderId,
        );
    });

    test("registers a command for each method", () => {
        expect([...registeredCommands.keys()]).to.have.members(
            [
                "getActiveEditorConnectionId",
                "getActiveDatabase",
                "getDatabaseForConnectionId",
                "connect",
                "disconnect",
                "isConnected",
                "executeSimpleQuery",
                "cancelQuery",
                "getServerInfo",
                "listDatabases",
                "scriptObject",
                "getConnectionString",
            ].map((method) => `mssql.sharedConnections.${method}`),
        );
    });

    test("checks the access token passed to a command like the method does", async () => {
        const connect = registeredCommands.get("mssql.sharedConnections.connect")!;
        const disconnect = registeredCommands.get("mssql.sharedConnections.disconnect")!;

        const connectionUri = (await connect(validToken, testConnectionId)) as string;
        await disconnect(validToken, connectionUri);

        expect(connectionManager.disconnect).to.have.been.calledWith(connectionUri);
        await expectConnectionSharingError(
            connect("not-a-token", testConnectionId),
            ConnectionSharingErrorCode.INVALID_ACCESS_TOKEN,
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
        expect(sendActionEventStub).to.have.been.calledWithMatch(
            TelemetryViews.Connection,
            TelemetryActions.SharedConnectionsApiCalled,
            {
                additionalProps: { method: "connect", surface: "api", outcome: "succeeded" },
                additionalMeasurements: { durationMs: sinon.match.number },
                connectionInfo: { authenticationType: "SqlLogin" },
                serverInfo: mockServerInfo,
            },
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

    test("cancels the query on a connection it opened", async () => {
        const connectionUri = await service.connect(validToken, testConnectionId);

        await service.cancelQuery(validToken, connectionUri);

        expect(client.sendRequest).to.have.been.calledWith(QueryCancelRequest.type, {
            ownerUri: connectionUri,
        });
    });

    test("doesn't cancel the query on a connection it didn't open", async () => {
        await expectConnectionSharingError(
            service.cancelQuery(validToken, "file:///query-editor.sql"),
            ConnectionSharingErrorCode.INVALID_CONNECTION_URI,
        );
        expect(client.sendRequest).not.to.have.been.called;
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
            activeSessionIds.delete(sessionId);
            sessionIdsByToken.delete(validToken);
            return true;
        });

        await expectConnectionSharingError(
            service.connect(validToken, testConnectionId),
            ConnectionSharingErrorCode.INVALID_ACCESS_TOKEN,
        );
        expect(connectionManager.disconnect).to.have.been.called;
    });

    test("keeps a connection whose access token expired while it was opening", async () => {
        connectionManager.connect.callsFake(async () => {
            sessionIdsByToken.delete(validToken);
            return true;
        });

        const connectionUri = await service.connect(validToken, testConnectionId);

        expect(connectionUri).to.be.a("string");
        expect(connectionManager.disconnect).not.to.have.been.called;
    });

    test("logs a failed cleanup of a connection whose session ended while it was opening", async () => {
        const loggerErrorStub = sandbox.stub(
            (
                service as unknown as {
                    _logger: { error(message: string, ...args: unknown[]): void };
                }
            )._logger,
            "error",
        );
        connectionManager.connect.callsFake(async () => {
            activeSessionIds.delete(sessionId);
            return true;
        });
        connectionManager.disconnect.rejects(new Error("disconnect failed"));

        await expectConnectionSharingError(
            service.connect(validToken, testConnectionId),
            ConnectionSharingErrorCode.INVALID_ACCESS_TOKEN,
        );
        await new Promise((resolve) => setImmediate(resolve));

        expect(loggerErrorStub).to.have.been.calledOnce;
    });

    test("keeps a connection it opened when disconnecting it fails", async () => {
        const connectionUri = await service.connect(validToken, testConnectionId);
        connectionManager.disconnect.rejects(new Error("disconnect failed"));

        try {
            await service.disconnect(validToken, connectionUri);
            expect.fail("Expected the disconnect to fail");
        } catch (error) {
            expect((error as Error).message).to.equal("disconnect failed");
        }

        expect(await service.isConnected(validToken, connectionUri)).to.be.true;
        connectionManager.disconnect.resolves(true);
        await service.disconnect(validToken, connectionUri);
        expect(await service.isConnected(validToken, connectionUri)).to.be.false;
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
    suite("telemetry", () => {
        function apiCallEvents(): Record<string, unknown>[] {
            return sendActionEventStub
                .getCalls()
                .filter((call) => call.args[1] === TelemetryActions.SharedConnectionsApiCalled)
                .map((call) => call.args[2] as Record<string, unknown>);
        }

        test("reports a call made through a command", async () => {
            const connect = registeredCommands.get("mssql.sharedConnections.connect")!;

            await connect(validToken, testConnectionId);

            expect(apiCallEvents()[0]).to.deep.include({
                additionalProps: { method: "connect", surface: "command", outcome: "succeeded" },
            });
        });

        test("reports why an access token was rejected", async () => {
            tokenRejections.set("expired-token", "expired");

            await expectConnectionSharingError(
                service.listDatabases("expired-token", "some-uri"),
                ConnectionSharingErrorCode.INVALID_ACCESS_TOKEN,
            );

            expect(apiCallEvents()[0]).to.deep.include({
                additionalProps: {
                    method: "listDatabases",
                    surface: "api",
                    outcome: "failed",
                    errorCode: "INVALID_ACCESS_TOKEN",
                    tokenRejection: "expired",
                },
            });
        });

        test("reports an unexpected failure by its error type, not its message", async () => {
            const connectionUri = await service.connect(validToken, testConnectionId);
            client.sendRequest.rejects(new TypeError("Invalid object name 'Customers'"));

            try {
                await service.executeSimpleQuery(validToken, connectionUri, "SELECT 1");
                expect.fail("Expected the query to fail");
            } catch (error) {
                expect((error as Error).name).to.equal("TypeError");
            }

            expect(apiCallEvents()[1]).to.deep.include({
                additionalProps: {
                    method: "executeSimpleQuery",
                    surface: "api",
                    outcome: "failed",
                    errorCode: "unexpected",
                    errorName: "TypeError",
                },
            });
        });

        test("sends nothing that identifies the user, and nothing VS Code would redact", async () => {
            connectionManager.getServerInfo.returns({
                isCloud: false,
                serverVersion: "16.0.4135.4",
                serverEdition: "Enterprise Edition: Core-based Licensing (64-bit)",
                engineEditionId: 3,
            } as mssql.IServerInfo);
            const query = "SELECT secret_column FROM dbo.Customers";
            tokenRejections.set("expired-token", "expired");

            const connectionUri = await service.connect(validToken, testConnectionId);
            await service.executeSimpleQuery(validToken, connectionUri, query);
            await service.getConnectionString(validToken, testConnectionId);
            await service.disconnect(validToken, connectionUri);
            await service.getServerInfo("expired-token", connectionUri).catch(() => undefined);

            const identifying = [
                mockConnectionProfile.server,
                testDatabase,
                testConnectionId,
                connectionUri,
                query,
                validToken,
            ];
            const events = apiCallEvents();
            expect(events).to.have.length(5);
            for (const event of events) {
                const values = [
                    ...Object.values(event.additionalProps as Record<string, string>),
                    ...Object.values((event.connectionInfo ?? {}) as Record<string, unknown>),
                    ...Object.values((event.serverInfo ?? {}) as Record<string, unknown>),
                ].map(String);
                for (const value of values) {
                    for (const text of identifying) {
                        expect(value).not.to.include(text);
                    }
                    // VS Code's telemetry cleaning redacts paths, URLs, emails, and values where a
                    // word such as "token" or "key" is followed by punctuation.
                    expect(value).not.to.match(/[\\/@]/);
                    expect(value).not.to.match(
                        /(key|token|sig|secret|signature|password|passwd|pwd)[^a-zA-Z0-9]/i,
                    );
                }
            }
        });
    });
    suite("active editor connection changes", () => {
        let activeEditorUri: string | undefined;
        let editorConnections: Map<string, IConnectionProfile>;
        let changes: number;

        function connection(id: string, database: string): IConnectionProfile {
            return { ...mockConnectionProfile, id, database } as IConnectionProfile;
        }

        function switchEditor(uri: string | undefined): void {
            activeEditorUri = uri;
            activeEditorChangeEmitter.fire(undefined);
        }

        setup(() => {
            activeEditorUri = undefined;
            editorConnections = new Map();
            sandbox.stub(vscode.window, "activeTextEditor").get(() =>
                activeEditorUri
                    ? ({
                          document: { uri: vscode.Uri.parse(activeEditorUri) },
                      } as vscode.TextEditor)
                    : undefined,
            );
            connectionManager.isConnected.callsFake((uri: string) => editorConnections.has(uri));
            connectionManager.getConnectionInfoFromUri.callsFake((uri: string) =>
                editorConnections.get(uri),
            );
            switchEditor(undefined);
            changes = 0;
            service.onDidChangeActiveEditorConnection(() => changes++);
        });

        test("fires when the active editor switches to another connection or database", () => {
            editorConnections.set("file:///a.sql", connection("server-1", "Sales"));
            editorConnections.set("file:///b.sql", connection("server-1", "Sales"));
            editorConnections.set("file:///c.sql", connection("server-2", "Sales"));
            editorConnections.set("file:///d.sql", connection("server-2", "Billing"));

            switchEditor("file:///a.sql");
            expect(changes, "connected editor").to.equal(1);
            switchEditor("file:///b.sql");
            expect(changes, "same connection and database").to.equal(1);
            switchEditor("file:///c.sql");
            expect(changes, "another connection, same database name").to.equal(2);
            switchEditor("file:///d.sql");
            expect(changes, "another database").to.equal(3);
            switchEditor("file:///notes.md");
            expect(changes, "editor without a connection").to.equal(4);
        });

        test("fires when the active editor connects, changes database, or disconnects", () => {
            switchEditor("file:///a.sql");
            expect(changes).to.equal(0);

            editorConnections.set("file:///a.sql", connection("server-1", "Sales"));
            connectionsChangedEmitter.fire();
            expect(changes, "connected").to.equal(1);

            editorConnections.set("file:///a.sql", connection("server-1", "Billing"));
            databaseContextEmitter.fire("file:///a.sql");
            expect(changes, "USE Billing").to.equal(2);

            connectionsChangedEmitter.fire();
            expect(changes, "another editor's connection changed").to.equal(2);

            editorConnections.delete("file:///a.sql");
            connectionsChangedEmitter.fire();
            expect(changes, "disconnected").to.equal(3);
        });

        test("reports each subscription in telemetry", () => {
            expect(sendActionEventStub).to.have.been.calledWith(
                TelemetryViews.Connection,
                TelemetryActions.SharedConnectionsApiCalled,
                {
                    additionalProps: {
                        method: "onDidChangeActiveEditorConnection",
                        surface: "api",
                        outcome: "succeeded",
                    },
                },
            );
        });
    });
});
