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
import {
    ConnectionSharingError,
    ConnectionSharingErrorCode,
    ConnectionSharingService,
} from "../../src/connectionSharing/connectionSharingService";
import ConnectionManager from "../../src/controllers/connectionManager";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { ScriptingService } from "../../src/scripting/scriptingService";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { stubVscodeWrapper } from "./utils";
import { IConnectionProfile } from "../../src/models/interfaces";
import { ScriptOperation } from "../../src/models/contracts/scripting/scriptingRequest";
import { ConnectionStore } from "../../src/models/connectionStore";
import * as LocalizedConstants from "../../src/constants/locConstants";

chai.use(sinonChai);

suite("ConnectionSharingService Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let client: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let scriptingService: sinon.SinonStubbedInstance<ScriptingService>;
    let secretStorage: sinon.SinonStubbedInstance<vscode.SecretStorage>;
    let vscodeWrapper: VscodeWrapper;
    let showInformationMessageStub: sinon.SinonStub;
    let showQuickPickStub: sinon.SinonStub;
    let registerCommandStub: sinon.SinonStub;
    let registeredCommands: Map<string, Function>;
    let getExtensionStub: sinon.SinonStub;

    const testExtensionId = "test.extension";
    const testConnectionId = "test-connection-id";
    const testConnectionUri = "test-connection-uri";
    const testDatabase = "TestDatabase";
    const testQuery = "SELECT * FROM sys.databases";

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

    const mockServerInfo: mssql.IServerInfo = {
        serverMajorVersion: 15,
        serverMinorVersion: 0,
        serverReleaseVersion: 0,
        engineEditionId: 3,
        serverVersion: "15.0.0",
        serverLevel: "",
        serverEdition: "",
        isCloud: false,
        azureVersion: 0,
        osVersion: "",
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        registeredCommands = new Map<string, Function>();

        // Create stub instances
        client = sandbox.createStubInstance(SqlToolsServiceClient);
        connectionManager = sandbox.createStubInstance(ConnectionManager);
        vscodeWrapper = stubVscodeWrapper(sandbox);
        scriptingService = sandbox.createStubInstance(ScriptingService);
        secretStorage = {
            get: sandbox.stub(),
            store: sandbox.stub(),
            delete: sandbox.stub(),
            onDidChange: sandbox.stub(),
        } as unknown as sinon.SinonStubbedInstance<vscode.SecretStorage>;

        // Setup extension context
        const context = {
            subscriptions: [],
            extensionUri: vscode.Uri.file("/test"),
            extensionPath: "/test",
            secrets: secretStorage,
        } as unknown as vscode.ExtensionContext;

        // Setup connection manager stubs
        connectionManager.connectionStore = {
            connectionConfig: {
                getConnections: sandbox.stub().resolves([mockConnectionProfile]),
            },
        } as unknown as ConnectionStore;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        connectionManager.isConnected = sandbox.stub().returns(true) as any;
        connectionManager.getConnectionInfoFromUri = sandbox
            .stub()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .returns(mockConnectionProfile) as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        connectionManager.getServerInfo = sandbox.stub().returns(mockServerInfo) as any;
        connectionManager.listDatabases = sandbox
            .stub()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .resolves(["master", "TestDatabase"]) as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        connectionManager.connect = sandbox.stub().resolves(true) as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        connectionManager.disconnect = sandbox.stub().resolves() as any;
        connectionManager.createConnectionDetails = sandbox
            .stub()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .returns({} as mssql.ConnectionDetails) as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        connectionManager.getConnectionString = sandbox.stub().resolves("Server=test;") as any;

        // Setup vscode stubs
        showInformationMessageStub = sandbox.stub(vscode.window, "showInformationMessage");
        showQuickPickStub = sandbox.stub(vscode.window, "showQuickPick");
        registerCommandStub = sandbox.stub(vscode.commands, "registerCommand");
        getExtensionStub = sandbox.stub(vscode.extensions, "getExtension");

        // Capture registered commands
        registerCommandStub.callsFake((name: string, callback: Function) => {
            registeredCommands.set(name, callback);
            return { dispose: sandbox.stub() };
        });

        // Initialize service (this registers the commands)
        new ConnectionSharingService(
            context,
            client,
            connectionManager,
            vscodeWrapper,
            scriptingService,
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("Command Registration", () => {
        test("registers all expected commands", () => {
            const expectedCommands = [
                "mssql.connectionSharing.getActiveEditorConnectionId",
                "mssql.connectionSharing.getActiveDatabase",
                "mssql.connectionSharing.getDatabaseForConnectionId",
                "mssql.connectionSharing.connect",
                "mssql.connectionSharing.disconnect",
                "mssql.connectionSharing.isConnected",
                "mssql.connectionSharing.executeSimpleQuery",
                "mssql.connectionSharing.getServerInfo",
                "mssql.connectionSharing.editConnectionSharingPermissions",
                "mssql.connectionSharing.listDatabases",
                "mssql.connectionSharing.scriptOperation",
                "mssql.connectionSharing.clearAllConnectionSharingPermissions",
                "mssql.connectionSharing.getConnectionString",
            ];

            expectedCommands.forEach((command) => {
                expect(registeredCommands.has(command)).to.be.true;
            });
        });
    });

    suite("Permission Management", () => {
        test("should initialize with empty permissions when none exist", async () => {
            secretStorage.get.resolves(undefined);
            showInformationMessageStub.resolves(LocalizedConstants.ConnectionSharing.Approve);

            sandbox.stub(vscode.window, "activeTextEditor").get(() => ({
                document: { uri: vscode.Uri.parse("file:///test.sql") },
            }));

            const command = registeredCommands.get(
                "mssql.connectionSharing.getActiveEditorConnectionId",
            );

            await command!(testExtensionId);

            expect(showInformationMessageStub).to.have.been.calledOnce;
            expect(secretStorage.store).to.have.been.called;
        });

        test("should approve extension when user clicks Approve", async () => {
            secretStorage.get.resolves(JSON.stringify({}));
            showInformationMessageStub.resolves(LocalizedConstants.ConnectionSharing.Approve);

            sandbox.stub(vscode.window, "activeTextEditor").get(() => ({
                document: { uri: vscode.Uri.parse("file:///test.sql") },
            }));

            const command = registeredCommands.get(
                "mssql.connectionSharing.getActiveEditorConnectionId",
            );
            await command!(testExtensionId);

            const storeCall = secretStorage.store.getCall(secretStorage.store.callCount - 1).args;
            const storedPermissions = JSON.parse(storeCall[1]);
            expect(showInformationMessageStub).to.have.been.calledOnce;
            expect(secretStorage.store).to.have.been.called;
            expect(storedPermissions[testExtensionId]).to.equal("approved");
        });

        test("should deny extension when user clicks Deny", async () => {
            secretStorage.get.resolves(JSON.stringify({}));
            showInformationMessageStub.resolves(LocalizedConstants.ConnectionSharing.Deny);

            sandbox.stub(vscode.window, "activeTextEditor").get(() => ({
                document: { uri: vscode.Uri.parse("file:///test.sql") },
            }));

            const command = registeredCommands.get(
                "mssql.connectionSharing.getActiveEditorConnectionId",
            );

            try {
                await command!(testExtensionId);
                expect.fail("Should have thrown error");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                // First call with Deny should throw PERMISSION_REQUIRED and save "denied" status
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.PERMISSION_REQUIRED,
                );
            }

            // Verify the permission was saved as denied
            const storeCall = secretStorage.store.getCall(secretStorage.store.callCount - 1).args;
            const storedPermissions = JSON.parse(storeCall[1]);
            expect(storedPermissions[testExtensionId]).to.equal("denied");
        });

        test("should reject extension when user cancels permission dialog", async () => {
            secretStorage.get.resolves(JSON.stringify({}));
            showInformationMessageStub.resolves(undefined); // User canceled

            sandbox.stub(vscode.window, "activeTextEditor").get(() => ({
                document: { uri: vscode.Uri.parse("file:///test.sql") },
            }));

            const command = registeredCommands.get(
                "mssql.connectionSharing.getActiveEditorConnectionId",
            );

            try {
                await command!(testExtensionId);
                expect.fail("Should have thrown error");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.PERMISSION_REQUIRED,
                );
            }

            // Verify no permission was stored when user cancels
            expect(secretStorage.store).to.not.have.been.called;
        });

        test("should use cached permission for approved extension", async () => {
            secretStorage.get.resolves(JSON.stringify({ [testExtensionId]: "approved" }));

            sandbox.stub(vscode.window, "activeTextEditor").get(() => ({
                document: { uri: vscode.Uri.parse("file:///test.sql") },
            }));

            const command = registeredCommands.get(
                "mssql.connectionSharing.getActiveEditorConnectionId",
            );
            await command!(testExtensionId);

            expect(showInformationMessageStub).to.not.have.been.called;
        });

        test("should reject denied extension without prompting", async () => {
            secretStorage.get.resolves(JSON.stringify({ [testExtensionId]: "denied" }));

            sandbox.stub(vscode.window, "activeTextEditor").get(() => ({
                document: { uri: vscode.Uri.parse("file:///test.sql") },
            }));

            const command = registeredCommands.get(
                "mssql.connectionSharing.getActiveEditorConnectionId",
            );

            try {
                await command!(testExtensionId);
                expect.fail("Should have thrown error");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.PERMISSION_DENIED,
                );
            }

            expect(showInformationMessageStub).to.not.have.been.called;
        });

        test("should handle corrupted permission data gracefully", async () => {
            secretStorage.get.resolves("invalid-json-{]");
            showInformationMessageStub.resolves(LocalizedConstants.ConnectionSharing.Approve);

            sandbox.stub(vscode.window, "activeTextEditor").get(() => ({
                document: { uri: vscode.Uri.parse("file:///test.sql") },
            }));

            const command = registeredCommands.get(
                "mssql.connectionSharing.getActiveEditorConnectionId",
            );
            await command!(testExtensionId);

            // Should reinitialize with empty permissions
            expect(secretStorage.store).to.have.been.calledWith(
                "mssql.connectionSharing.extensionPermissions",
                JSON.stringify({}),
            );
        });
    });

    suite("getActiveEditorConnectionId", () => {
        test("should return connection id for active editor with connection", async () => {
            secretStorage.get.resolves(JSON.stringify({ [testExtensionId]: "approved" }));

            sandbox.stub(vscode.window, "activeTextEditor").get(() => ({
                document: { uri: vscode.Uri.parse("file:///test.sql") },
            }));

            const command = registeredCommands.get(
                "mssql.connectionSharing.getActiveEditorConnectionId",
            );
            const result = await command!(testExtensionId);

            expect(result).to.equal(testConnectionId);
        });

        test("should return undefined when no active editor", async () => {
            secretStorage.get.resolves(JSON.stringify({ [testExtensionId]: "approved" }));

            sandbox.stub(vscode.window, "activeTextEditor").get(() => undefined);

            const command = registeredCommands.get(
                "mssql.connectionSharing.getActiveEditorConnectionId",
            );

            try {
                await command!(testExtensionId);
                expect.fail("Should have thrown error");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.NO_ACTIVE_EDITOR,
                );
            }
        });

        test("should return undefined when active editor has no connection", async () => {
            secretStorage.get.resolves(JSON.stringify({ [testExtensionId]: "approved" }));

            sandbox.stub(vscode.window, "activeTextEditor").get(() => ({
                document: { uri: vscode.Uri.parse("file:///test.sql") },
            }));

            connectionManager.isConnected.returns(false);

            const command = registeredCommands.get(
                "mssql.connectionSharing.getActiveEditorConnectionId",
            );
            const result = await command!(testExtensionId);

            expect(result).to.be.undefined;
        });

        test("should return undefined when connection details not found", async () => {
            secretStorage.get.resolves(JSON.stringify({ [testExtensionId]: "approved" }));

            sandbox.stub(vscode.window, "activeTextEditor").get(() => ({
                document: { uri: vscode.Uri.parse("file:///test.sql") },
            }));

            connectionManager.isConnected.returns(true);
            connectionManager.getConnectionInfoFromUri.returns(undefined);

            const command = registeredCommands.get(
                "mssql.connectionSharing.getActiveEditorConnectionId",
            );
            const result = await command!(testExtensionId);

            expect(result).to.be.undefined;
        });
    });

    suite("getActiveDatabase", () => {
        test("should return database name for active editor with connection", async () => {
            secretStorage.get.resolves(JSON.stringify({ [testExtensionId]: "approved" }));

            sandbox.stub(vscode.window, "activeTextEditor").get(() => ({
                document: { uri: vscode.Uri.parse("file:///test.sql") },
            }));

            const command = registeredCommands.get("mssql.connectionSharing.getActiveDatabase");
            const result = await command!(testExtensionId);

            expect(result).to.equal(testDatabase);
        });

        test("should return undefined when no connection exists", async () => {
            secretStorage.get.resolves(JSON.stringify({ [testExtensionId]: "approved" }));

            sandbox.stub(vscode.window, "activeTextEditor").get(() => ({
                document: { uri: vscode.Uri.parse("file:///test.sql") },
            }));

            connectionManager.isConnected.returns(false);

            const command = registeredCommands.get("mssql.connectionSharing.getActiveDatabase");
            const result = await command!(testExtensionId);

            expect(result).to.be.undefined;
        });

        test("should throw error when no active editor", async () => {
            secretStorage.get.resolves(JSON.stringify({ [testExtensionId]: "approved" }));

            sandbox.stub(vscode.window, "activeTextEditor").get(() => undefined);

            const command = registeredCommands.get("mssql.connectionSharing.getActiveDatabase");

            try {
                await command!(testExtensionId);
                expect.fail("Should have thrown error");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.NO_ACTIVE_EDITOR,
                );
            }
        });

        test("should return undefined when connection details not found", async () => {
            secretStorage.get.resolves(JSON.stringify({ [testExtensionId]: "approved" }));

            sandbox.stub(vscode.window, "activeTextEditor").get(() => ({
                document: { uri: vscode.Uri.parse("file:///test.sql") },
            }));

            connectionManager.isConnected.returns(true);
            connectionManager.getConnectionInfoFromUri.returns(undefined);

            const command = registeredCommands.get("mssql.connectionSharing.getActiveDatabase");
            const result = await command!(testExtensionId);

            expect(result).to.be.undefined;
        });
    });

    suite("getDatabaseForConnectionId", () => {
        test("should return database for valid connection id", async () => {
            secretStorage.get.resolves(JSON.stringify({ [testExtensionId]: "approved" }));

            const command = registeredCommands.get(
                "mssql.connectionSharing.getDatabaseForConnectionId",
            );
            const result = await command!(testExtensionId, testConnectionId);

            expect(result).to.equal(testDatabase);
        });

        test("should return undefined for non-existent connection id", async () => {
            secretStorage.get.resolves(JSON.stringify({ [testExtensionId]: "approved" }));

            connectionManager.connectionStore.connectionConfig.getConnections = sandbox
                .stub()
                .resolves([]);

            const command = registeredCommands.get(
                "mssql.connectionSharing.getDatabaseForConnectionId",
            );
            const result = await command!(testExtensionId, "non-existent-id");

            expect(result).to.be.undefined;
        });
    });

    suite("connect", () => {
        test("should establish connection successfully", async () => {
            secretStorage.get.resolves(JSON.stringify({ [testExtensionId]: "approved" }));

            const command = registeredCommands.get("mssql.connectionSharing.connect");
            const result = await command!(testExtensionId, testConnectionId);

            expect(result).to.be.a("string");
            expect(connectionManager.connect).to.have.been.calledOnce;

            const connectCall = connectionManager.connect.getCall(0);
            expect(connectCall.args[0]).to.be.a("string"); // connectionUri (generated GUID)
            expect(connectCall.args[1]).to.deep.equal(mockConnectionProfile); // connection profile
            expect(connectCall.args[2]).to.deep.equal({
                connectionSource: "connectionSharingService",
            }); // options
        });

        test("should establish connection with specific database", async () => {
            secretStorage.get.resolves(JSON.stringify({ [testExtensionId]: "approved" }));

            const command = registeredCommands.get("mssql.connectionSharing.connect");
            const result = await command!(testExtensionId, testConnectionId, "CustomDB");

            expect(result).to.be.a("string");
            expect(connectionManager.connect).to.have.been.calledOnce;

            const connectCall = connectionManager.connect.getCall(0);
            expect(connectCall.args[0]).to.be.a("string"); // connectionUri (generated GUID)
            expect(connectCall.args[1].database).to.equal("CustomDB"); // database was updated
            expect(connectCall.args[2]).to.deep.equal({
                connectionSource: "connectionSharingService",
            }); // options
        });

        test("should throw error when connection not found", async () => {
            secretStorage.get.resolves(JSON.stringify({ [testExtensionId]: "approved" }));

            connectionManager.connectionStore.connectionConfig.getConnections = sandbox
                .stub()
                .resolves([]);

            const command = registeredCommands.get("mssql.connectionSharing.connect");

            try {
                await command!(testExtensionId, "non-existent-id");
                expect.fail("Should have thrown error");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.CONNECTION_NOT_FOUND,
                );
            }
        });

        test("should throw error when connection fails", async () => {
            secretStorage.get.resolves(JSON.stringify({ [testExtensionId]: "approved" }));

            connectionManager.connect.resolves(false);

            const command = registeredCommands.get("mssql.connectionSharing.connect");

            try {
                await command!(testExtensionId, testConnectionId);
                expect.fail("Should have thrown error");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.CONNECTION_FAILED,
                );
            }
        });
    });

    suite("disconnect", () => {
        test("should disconnect successfully", () => {
            const command = registeredCommands.get("mssql.connectionSharing.disconnect");
            command!(testConnectionUri);

            expect(connectionManager.disconnect).to.have.been.calledOnceWith(testConnectionUri);
        });

        test("should throw error for invalid connection uri", () => {
            const command = registeredCommands.get("mssql.connectionSharing.disconnect");

            try {
                command!("");
                expect.fail("Should have thrown error");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.INVALID_CONNECTION_URI,
                );
            }
        });
    });

    suite("isConnected", () => {
        test("should return true for connected uri", () => {
            connectionManager.isConnected.returns(true);

            const command = registeredCommands.get("mssql.connectionSharing.isConnected");
            const result = command!(testConnectionUri);

            expect(result).to.be.true;
        });

        test("should return false for disconnected uri", () => {
            connectionManager.isConnected.returns(false);

            const command = registeredCommands.get("mssql.connectionSharing.isConnected");
            const result = command!(testConnectionUri);

            expect(result).to.be.false;
        });

        test("should return false for empty uri", () => {
            const command = registeredCommands.get("mssql.connectionSharing.isConnected");
            const result = command!("");

            expect(result).to.be.false;
        });
    });

    suite("executeSimpleQuery", () => {
        test("should execute query successfully", async () => {
            const mockResult = {
                rowCount: 2,
                columnInfo: [],
                rows: [],
            };
            client.sendRequest.resolves(mockResult);

            const command = registeredCommands.get("mssql.connectionSharing.executeSimpleQuery");
            const result = await command!(testConnectionUri, testQuery);

            expect(result).to.deep.equal(mockResult);
            expect(client.sendRequest).to.have.been.calledOnce;
        });

        test("should throw error for invalid connection uri", async () => {
            const command = registeredCommands.get("mssql.connectionSharing.executeSimpleQuery");

            try {
                await command!("", testQuery);
                expect.fail("Should have thrown error");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.INVALID_CONNECTION_URI,
                );
            }
        });

        test("should throw error when not connected", async () => {
            connectionManager.isConnected.returns(false);

            const command = registeredCommands.get("mssql.connectionSharing.executeSimpleQuery");

            try {
                await command!(testConnectionUri, testQuery);
                expect.fail("Should have thrown error");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.NO_ACTIVE_CONNECTION,
                );
            }
        });
    });

    suite("getServerInfo", () => {
        test("should return server info successfully", () => {
            const command = registeredCommands.get("mssql.connectionSharing.getServerInfo");
            const result = command!(testConnectionUri);

            expect(result).to.deep.equal(mockServerInfo);
            expect(connectionManager.getServerInfo).to.have.been.calledOnce;
        });

        test("should throw error for invalid connection uri", () => {
            const command = registeredCommands.get("mssql.connectionSharing.getServerInfo");

            try {
                command!("");
                expect.fail("Should have thrown error");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.INVALID_CONNECTION_URI,
                );
            }
        });

        test("should throw error when not connected", () => {
            connectionManager.isConnected.returns(false);

            const command = registeredCommands.get("mssql.connectionSharing.getServerInfo");

            try {
                command!(testConnectionUri);
                expect.fail("Should have thrown error");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.NO_ACTIVE_CONNECTION,
                );
            }
        });
    });

    suite("listDatabases", () => {
        test("should list databases successfully", async () => {
            const command = registeredCommands.get("mssql.connectionSharing.listDatabases");
            const result = await command!(testConnectionUri);

            expect(result).to.deep.equal(["master", "TestDatabase"]);
            expect(connectionManager.listDatabases).to.have.been.calledOnceWith(testConnectionUri);
        });

        test("should throw error when not connected", async () => {
            connectionManager.isConnected.returns(false);

            const command = registeredCommands.get("mssql.connectionSharing.listDatabases");

            try {
                await command!(testConnectionUri);
                expect.fail("Should have thrown error");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.NO_ACTIVE_CONNECTION,
                );
            }
        });
    });

    suite("scriptObject", () => {
        test("should script object successfully", async () => {
            const scriptingObject: mssql.IScriptingObject = {
                type: "Table",
                schema: "dbo",
                name: "TestTable",
            };

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            scriptingService.createScriptingRequestParams.returns({} as any);
            scriptingService.script.resolves("CREATE TABLE TestTable...");

            const command = registeredCommands.get("mssql.connectionSharing.scriptOperation");
            await command!(testConnectionUri, ScriptOperation.Select, scriptingObject);

            expect(scriptingService.createScriptingRequestParams).to.have.been.calledOnce;
            expect(scriptingService.script).to.have.been.calledOnce;
        });

        test("should throw error when not connected", async () => {
            connectionManager.isConnected.returns(false);

            const scriptingObject: mssql.IScriptingObject = {
                type: "Table",
                schema: "dbo",
                name: "TestTable",
            };

            const command = registeredCommands.get("mssql.connectionSharing.scriptOperation");

            try {
                await command!(testConnectionUri, ScriptOperation.Select, scriptingObject);
                expect.fail("Should have thrown error");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.NO_ACTIVE_CONNECTION,
                );
            }
        });
    });

    suite("editConnectionSharingPermissions", () => {
        test("should edit permissions for specified extension", async () => {
            secretStorage.get.resolves(JSON.stringify({}));
            getExtensionStub.returns({
                id: testExtensionId,
                packageJSON: {
                    displayName: "Test Extension",
                    publisher: "TestPublisher",
                    description: "Test description",
                },
            });

            showQuickPickStub.resolves({
                label: LocalizedConstants.ConnectionSharing.GrantAccess,
                detail: "approved",
            });

            const command = registeredCommands.get(
                "mssql.connectionSharing.editConnectionSharingPermissions",
            );
            const result = await command!(testExtensionId);

            expect(result).to.equal("approved");
            expect(secretStorage.store).to.have.been.called;
        });

        test("should prompt for extension selection when no extension id provided", async () => {
            secretStorage.get.resolves(JSON.stringify({}));
            getExtensionStub.returns({
                id: testExtensionId,
                packageJSON: {
                    displayName: "Test Extension",
                    publisher: "TestPublisher",
                    description: "Test description",
                },
            });

            showQuickPickStub
                .onFirstCall()
                .resolves({ label: "Test Extension", detail: testExtensionId })
                .onSecondCall()
                .resolves({
                    label: LocalizedConstants.ConnectionSharing.GrantAccess,
                    detail: "approved",
                });

            const command = registeredCommands.get(
                "mssql.connectionSharing.editConnectionSharingPermissions",
            );
            const result = await command!();

            expect(showQuickPickStub).to.have.been.calledTwice;
            expect(result).to.equal("approved");
        });

        test("should return undefined when user cancels extension selection", async () => {
            secretStorage.get.resolves(JSON.stringify({}));
            showQuickPickStub.resolves(undefined);

            const command = registeredCommands.get(
                "mssql.connectionSharing.editConnectionSharingPermissions",
            );
            const result = await command!();

            expect(result).to.be.undefined;
        });

        test("should return undefined when user cancels permission selection", async () => {
            secretStorage.get.resolves(JSON.stringify({}));
            getExtensionStub.returns({
                id: testExtensionId,
                packageJSON: {
                    displayName: "Test Extension",
                    publisher: "TestPublisher",
                },
            });

            showQuickPickStub.resolves(undefined);

            const command = registeredCommands.get(
                "mssql.connectionSharing.editConnectionSharingPermissions",
            );
            const result = await command!(testExtensionId);

            expect(result).to.be.undefined;
        });
    });

    suite("clearAllConnectionSharingPermissions", () => {
        test("should clear all permissions when user confirms", async () => {
            showInformationMessageStub.resolves(LocalizedConstants.ConnectionSharing.Clear);

            const command = registeredCommands.get(
                "mssql.connectionSharing.clearAllConnectionSharingPermissions",
            );
            await command!();

            expect(secretStorage.store).to.have.been.calledWith(
                "mssql.connectionSharing.extensionPermissions",
                JSON.stringify({}),
            );
        });

        test("should not clear permissions when user cancels", async () => {
            showInformationMessageStub.resolves(LocalizedConstants.ConnectionSharing.Cancel);

            const command = registeredCommands.get(
                "mssql.connectionSharing.clearAllConnectionSharingPermissions",
            );
            await command!();

            // Store should only be called for getting, not setting
            const setCalls = secretStorage.store
                .getCalls()
                .filter((call) => call.args[1] === JSON.stringify({}));
            expect(setCalls).to.have.lengthOf(0);
        });
    });

    suite("getConnectionString", () => {
        test("should return connection string for valid connection", async () => {
            secretStorage.get.resolves(JSON.stringify({ [testExtensionId]: "approved" }));

            const command = registeredCommands.get("mssql.connectionSharing.getConnectionString");
            const result = await command!(testExtensionId, testConnectionId);

            expect(result).to.equal("Server=test;");
            expect(connectionManager.getConnectionString).to.have.been.calledOnce;
        });

        test("should throw error when connection not found", async () => {
            secretStorage.get.resolves(JSON.stringify({ [testExtensionId]: "approved" }));

            connectionManager.connectionStore.connectionConfig.getConnections = sandbox
                .stub()
                .resolves([]);

            const command = registeredCommands.get("mssql.connectionSharing.getConnectionString");

            try {
                await command!(testExtensionId, "non-existent-id");
                expect.fail("Should have thrown error");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.CONNECTION_NOT_FOUND,
                );
            }
        });
    });

    suite("Extension Display Name", () => {
        test("should format display name with extension info when extension exists", async () => {
            secretStorage.get.resolves(JSON.stringify({}));
            getExtensionStub.returns({
                id: testExtensionId,
                packageJSON: {
                    displayName: "Test Extension",
                    publisher: "TestPublisher",
                    description: "Test description",
                },
            });

            showQuickPickStub
                .onFirstCall()
                .resolves({ label: "Test Extension", detail: testExtensionId })
                .onSecondCall()
                .resolves({
                    label: LocalizedConstants.ConnectionSharing.GrantAccess,
                    detail: "approved",
                });

            const command = registeredCommands.get(
                "mssql.connectionSharing.editConnectionSharingPermissions",
            );
            await command!();

            // Verify the extension was queried
            expect(getExtensionStub).to.have.been.called;
        });

        test("should use extension id when extension not found", async () => {
            secretStorage.get.resolves(JSON.stringify({}));
            getExtensionStub.returns(undefined);

            showQuickPickStub.resolves({
                label: LocalizedConstants.ConnectionSharing.GrantAccess,
                detail: "approved",
            });

            const command = registeredCommands.get(
                "mssql.connectionSharing.editConnectionSharingPermissions",
            );
            await command!(testExtensionId);

            // Should still work even if extension not found
            expect(secretStorage.store).to.have.been.called;
        });
    });
});
