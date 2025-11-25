/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";
import { expect } from "chai";
import * as mssql from "vscode-mssql";
import {
    ConnectionSharingService,
    ConnectionSharingError,
    ConnectionSharingErrorCode,
} from "../../src/connectionSharing/connectionSharingService";
import ConnectionManager from "../../src/controllers/connectionManager";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { ScriptingService } from "../../src/scripting/scriptingService";
import { IConnectionProfile } from "../../src/models/interfaces";
import * as LocalizedConstants from "../../src/constants/locConstants";
import {
    ScriptOperation,
    IScriptingParams,
} from "../../src/models/contracts/scripting/scriptingRequest";
import { ConnectionStore } from "../../src/models/connectionStore";
import { ConnectionConfig } from "../../src/connectionconfig/connectionconfig";
import { stubExtensionContext, stubVscodeWrapper } from "./utils";

chai.use(sinonChai);

suite("ConnectionSharingService Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let connectionSharingService: ConnectionSharingService;

    let mockContext: vscode.ExtensionContext;
    let mockClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let mockScriptingService: sinon.SinonStubbedInstance<ScriptingService>;
    let mockConnectionStore: sinon.SinonStubbedInstance<ConnectionStore>;
    let mockConnectionConfig: sinon.SinonStubbedInstance<ConnectionConfig>;

    const TEST_EXTENSION_ID = "test.extension";
    const TEST_CONNECTION_ID = "test-connection-id";
    const TEST_CONNECTION_URI = "test-connection-uri";
    const TEST_DATABASE = "TestDatabase";

    setup(() => {
        sandbox = sinon.createSandbox();

        mockContext = stubExtensionContext(sandbox);
        mockVscodeWrapper = stubVscodeWrapper(sandbox);
        mockClient = sandbox.createStubInstance(SqlToolsServiceClient);
        mockConnectionManager = sandbox.createStubInstance(ConnectionManager);
        mockScriptingService = sandbox.createStubInstance(ScriptingService);
        mockConnectionStore = sandbox.createStubInstance(ConnectionStore);
        mockConnectionConfig = sandbox.createStubInstance(ConnectionConfig);

        // Setup secrets storage
        const secretsMap = new Map<string, string>();
        Object.defineProperty(mockContext, "secrets", {
            value: {
                get: sandbox.stub().callsFake(async (key: string) => secretsMap.get(key)),
                store: sandbox.stub().callsFake(async (key: string, value: string) => {
                    secretsMap.set(key, value);
                }),
                delete: sandbox.stub().callsFake(async (key: string) => {
                    secretsMap.delete(key);
                }),
                onDidChange: sandbox.stub(),
            },
            writable: true,
            configurable: true,
        });

        // Setup ConnectionManager dependencies
        Object.defineProperty(mockConnectionManager, "connectionStore", {
            get: () => mockConnectionStore,
            configurable: true,
        });

        Object.defineProperty(mockConnectionStore, "connectionConfig", {
            get: () => mockConnectionConfig,
            configurable: true,
        });

        // Stub vscode.commands.registerCommand to avoid actual command registration
        sandbox.stub(vscode.commands, "registerCommand").callsFake(() => {
            return { dispose: () => {} };
        });

        connectionSharingService = new ConnectionSharingService(
            mockContext,
            mockClient,
            mockConnectionManager,
            mockVscodeWrapper,
            mockScriptingService,
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    /**
     * Helper function to pre-approve an extension for connection sharing.
     * This bypasses the user permission dialog in tests.
     */
    async function approveExtension(extensionId: string): Promise<void> {
        await connectionSharingService["updateExtensionPermission"](extensionId, "approved");
    }

    suite("Initialization", () => {
        test("Should initialize correctly and register commands", () => {
            expect(connectionSharingService).to.not.be.undefined;
            expect(vscode.commands.registerCommand).to.have.callCount(13);
        });

        test("Should register all expected commands", () => {
            const commandStub = vscode.commands.registerCommand as sinon.SinonStub;
            const registeredCommands = commandStub.getCalls().map((call) => call.args[0]);

            expect(registeredCommands).to.include(
                "mssql.connectionSharing.getActiveEditorConnectionId",
            );
            expect(registeredCommands).to.include("mssql.connectionSharing.getActiveDatabase");
            expect(registeredCommands).to.include(
                "mssql.connectionSharing.getDatabaseForConnectionId",
            );
            expect(registeredCommands).to.include("mssql.connectionSharing.connect");
            expect(registeredCommands).to.include("mssql.connectionSharing.disconnect");
            expect(registeredCommands).to.include("mssql.connectionSharing.isConnected");
            expect(registeredCommands).to.include("mssql.connectionSharing.executeSimpleQuery");
            expect(registeredCommands).to.include("mssql.connectionSharing.getServerInfo");
            expect(registeredCommands).to.include(
                "mssql.connectionSharing.editConnectionSharingPermissions",
            );
            expect(registeredCommands).to.include("mssql.connectionSharing.listDatabases");
            expect(registeredCommands).to.include("mssql.connectionSharing.scriptOperation");
            expect(registeredCommands).to.include(
                "mssql.connectionSharing.clearAllConnectionSharingPermissions",
            );
            expect(registeredCommands).to.include("mssql.connectionSharing.getConnectionString");
        });
    });

    suite("Permission Management", () => {
        test("Should request permission and approve for new extension", async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sandbox.stub(vscode.window, "showInformationMessage").resolves("Approve" as any);

            const result =
                await connectionSharingService["requestConnectionSharingPermission"](
                    TEST_EXTENSION_ID,
                );

            expect(result).to.be.true;
            const storedPermission =
                await connectionSharingService["getExtensionPermission"](TEST_EXTENSION_ID);
            expect(storedPermission).to.equal("approved");
        });

        test("Should request permission and deny for new extension", async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sandbox.stub(vscode.window, "showInformationMessage").resolves("Deny" as any);

            const result =
                await connectionSharingService["requestConnectionSharingPermission"](
                    TEST_EXTENSION_ID,
                );

            expect(result).to.be.false;
            const storedPermission =
                await connectionSharingService["getExtensionPermission"](TEST_EXTENSION_ID);
            expect(storedPermission).to.equal("denied");
        });

        test("Should return true for already approved extension", async () => {
            await connectionSharingService["updateExtensionPermission"](
                TEST_EXTENSION_ID,
                "approved",
            );

            const result =
                await connectionSharingService["requestConnectionSharingPermission"](
                    TEST_EXTENSION_ID,
                );

            expect(result).to.be.true;
        });

        test("Should return false for already denied extension", async () => {
            await connectionSharingService["updateExtensionPermission"](
                TEST_EXTENSION_ID,
                "denied",
            );

            const result =
                await connectionSharingService["requestConnectionSharingPermission"](
                    TEST_EXTENSION_ID,
                );

            expect(result).to.be.false;
        });

        test("Should return false when user cancels permission request", async () => {
            sandbox.stub(vscode.window, "showInformationMessage").resolves(undefined);

            const result =
                await connectionSharingService["requestConnectionSharingPermission"](
                    TEST_EXTENSION_ID,
                );

            expect(result).to.be.false;
        });

        test("Should throw PERMISSION_DENIED error when permission is denied", async () => {
            await connectionSharingService["updateExtensionPermission"](
                TEST_EXTENSION_ID,
                "denied",
            );

            try {
                await connectionSharingService["validateExtensionPermission"](TEST_EXTENSION_ID);
                expect.fail("Should have thrown ConnectionSharingError");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.PERMISSION_DENIED,
                );
                expect((error as ConnectionSharingError).extensionId).to.equal(TEST_EXTENSION_ID);
            }
        });

        test("Should throw PERMISSION_REQUIRED error when user cancels permission request", async () => {
            sandbox.stub(vscode.window, "showInformationMessage").resolves(undefined);

            try {
                await connectionSharingService["validateExtensionPermission"](TEST_EXTENSION_ID);
                expect.fail("Should have thrown ConnectionSharingError");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.PERMISSION_REQUIRED,
                );
            }
        });

        test("Should update extension permission", async () => {
            await connectionSharingService["updateExtensionPermission"](
                TEST_EXTENSION_ID,
                "approved",
            );
            let permission =
                await connectionSharingService["getExtensionPermission"](TEST_EXTENSION_ID);
            expect(permission).to.equal("approved");

            await connectionSharingService["updateExtensionPermission"](
                TEST_EXTENSION_ID,
                "denied",
            );
            permission =
                await connectionSharingService["getExtensionPermission"](TEST_EXTENSION_ID);
            expect(permission).to.equal("denied");
        });

        test("Should handle corrupted stored permissions gracefully", async () => {
            await mockContext.secrets.store(
                "mssql.connectionSharing.extensionPermissions",
                "invalid-json",
            );

            const permissions = await connectionSharingService["getStoredExtensionPermissions"]();

            expect(permissions).to.deep.equal({});
        });

        test("Should initialize empty permissions when none exist", async () => {
            const permissions = await connectionSharingService["getStoredExtensionPermissions"]();

            expect(permissions).to.deep.equal({});
        });
    });

    suite("getActiveEditorConnectionId", () => {
        test("Should return connection ID for active editor with connection", async () => {
            await approveExtension(TEST_EXTENSION_ID);

            const mockEditor = {
                document: {
                    uri: vscode.Uri.parse("file:///test.sql"),
                },
            } as vscode.TextEditor;

            sandbox.stub(vscode.window, "activeTextEditor").get(() => mockEditor);
            mockConnectionManager.isConnected.returns(true);
            mockConnectionManager.getConnectionInfoFromUri.returns({
                id: TEST_CONNECTION_ID,
            } as IConnectionProfile);

            const result =
                await connectionSharingService.getActiveEditorConnectionId(TEST_EXTENSION_ID);

            expect(result).to.equal(TEST_CONNECTION_ID);
        });

        test("Should return undefined when no connection exists for active editor", async () => {
            await approveExtension(TEST_EXTENSION_ID);

            const mockEditor = {
                document: {
                    uri: vscode.Uri.parse("file:///test.sql"),
                },
            } as vscode.TextEditor;

            sandbox.stub(vscode.window, "activeTextEditor").get(() => mockEditor);
            mockConnectionManager.isConnected.returns(false);

            const result =
                await connectionSharingService.getActiveEditorConnectionId(TEST_EXTENSION_ID);

            expect(result).to.be.undefined;
        });

        test("Should throw NO_ACTIVE_EDITOR error when no active editor", async () => {
            await approveExtension(TEST_EXTENSION_ID);
            sandbox.stub(vscode.window, "activeTextEditor").get(() => undefined);

            try {
                await connectionSharingService.getActiveEditorConnectionId(TEST_EXTENSION_ID);
                expect.fail("Should have thrown ConnectionSharingError");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.NO_ACTIVE_EDITOR,
                );
            }
        });

        test("Should return undefined when connection details not found", async () => {
            await approveExtension(TEST_EXTENSION_ID);

            const mockEditor = {
                document: {
                    uri: vscode.Uri.parse("file:///test.sql"),
                },
            } as vscode.TextEditor;

            sandbox.stub(vscode.window, "activeTextEditor").get(() => mockEditor);
            mockConnectionManager.isConnected.returns(true);
            mockConnectionManager.getConnectionInfoFromUri.returns(undefined);

            const result =
                await connectionSharingService.getActiveEditorConnectionId(TEST_EXTENSION_ID);

            expect(result).to.be.undefined;
        });
    });

    suite("getActiveDatabase", () => {
        test("Should return database name for active editor with connection", async () => {
            await approveExtension(TEST_EXTENSION_ID);

            const mockEditor = {
                document: {
                    uri: vscode.Uri.parse("file:///test.sql"),
                },
            } as vscode.TextEditor;

            sandbox.stub(vscode.window, "activeTextEditor").get(() => mockEditor);
            mockConnectionManager.isConnected.returns(true);
            mockConnectionManager.getConnectionInfoFromUri.returns({
                database: TEST_DATABASE,
            } as IConnectionProfile);

            const result = await connectionSharingService.getActiveDatabase(TEST_EXTENSION_ID);

            expect(result).to.equal(TEST_DATABASE);
        });

        test("Should return undefined when no connection exists", async () => {
            await approveExtension(TEST_EXTENSION_ID);

            const mockEditor = {
                document: {
                    uri: vscode.Uri.parse("file:///test.sql"),
                },
            } as vscode.TextEditor;

            sandbox.stub(vscode.window, "activeTextEditor").get(() => mockEditor);
            mockConnectionManager.isConnected.returns(false);

            const result = await connectionSharingService.getActiveDatabase(TEST_EXTENSION_ID);

            expect(result).to.be.undefined;
        });

        test("Should throw NO_ACTIVE_EDITOR error when no active editor", async () => {
            await approveExtension(TEST_EXTENSION_ID);
            sandbox.stub(vscode.window, "activeTextEditor").get(() => undefined);

            try {
                await connectionSharingService.getActiveDatabase(TEST_EXTENSION_ID);
                expect.fail("Should have thrown ConnectionSharingError");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.NO_ACTIVE_EDITOR,
                );
            }
        });
    });

    suite("getDatabaseForConnectionId", () => {
        test("Should return database for valid connection ID", async () => {
            await approveExtension(TEST_EXTENSION_ID);

            const testConnection: IConnectionProfile = {
                id: TEST_CONNECTION_ID,
                database: TEST_DATABASE,
            } as IConnectionProfile;

            mockConnectionConfig.getConnections.resolves([testConnection]);

            const result = await connectionSharingService.getDatabaseForConnectionId(
                TEST_EXTENSION_ID,
                TEST_CONNECTION_ID,
            );

            expect(result).to.equal(TEST_DATABASE);
        });

        test("Should return undefined for non-existent connection ID", async () => {
            await approveExtension(TEST_EXTENSION_ID);
            mockConnectionConfig.getConnections.resolves([]);

            const result = await connectionSharingService.getDatabaseForConnectionId(
                TEST_EXTENSION_ID,
                TEST_CONNECTION_ID,
            );

            expect(result).to.be.undefined;
        });
    });

    suite("connect", () => {
        test("Should successfully connect with valid connection ID", async () => {
            await approveExtension(TEST_EXTENSION_ID);

            const testConnection: IConnectionProfile = {
                id: TEST_CONNECTION_ID,
                database: TEST_DATABASE,
            } as IConnectionProfile;

            mockConnectionConfig.getConnections.resolves([testConnection]);
            mockConnectionManager.connect.resolves(true);

            const result = await connectionSharingService.connect(
                TEST_EXTENSION_ID,
                TEST_CONNECTION_ID,
            );

            expect(result).to.be.a("string");
            expect(mockConnectionManager.connect).to.have.been.calledOnce;
        });

        test("Should connect with custom database name", async () => {
            await approveExtension(TEST_EXTENSION_ID);

            const testConnection: IConnectionProfile = {
                id: TEST_CONNECTION_ID,
                database: "OriginalDatabase",
            } as IConnectionProfile;

            mockConnectionConfig.getConnections.resolves([testConnection]);
            mockConnectionManager.connect.resolves(true);

            const customDatabase = "CustomDatabase";
            await connectionSharingService.connect(
                TEST_EXTENSION_ID,
                TEST_CONNECTION_ID,
                customDatabase,
            );

            expect(mockConnectionManager.connect).to.have.been.calledOnce;
            const connectCall = mockConnectionManager.connect.getCall(0);
            expect(connectCall.args[1].database).to.equal(customDatabase);
        });

        test("Should throw CONNECTION_NOT_FOUND error for invalid connection ID", async () => {
            await approveExtension(TEST_EXTENSION_ID);
            mockConnectionConfig.getConnections.resolves([]);

            try {
                await connectionSharingService.connect(TEST_EXTENSION_ID, TEST_CONNECTION_ID);
                expect.fail("Should have thrown ConnectionSharingError");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.CONNECTION_NOT_FOUND,
                );
                expect((error as ConnectionSharingError).connectionId).to.equal(TEST_CONNECTION_ID);
            }
        });

        test("Should throw CONNECTION_FAILED error when connection fails", async () => {
            await approveExtension(TEST_EXTENSION_ID);

            const testConnection: IConnectionProfile = {
                id: TEST_CONNECTION_ID,
                database: TEST_DATABASE,
            } as IConnectionProfile;

            mockConnectionConfig.getConnections.resolves([testConnection]);
            mockConnectionManager.connect.resolves(false);

            try {
                await connectionSharingService.connect(TEST_EXTENSION_ID, TEST_CONNECTION_ID);
                expect.fail("Should have thrown ConnectionSharingError");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.CONNECTION_FAILED,
                );
            }
        });
    });

    suite("disconnect", () => {
        test("Should disconnect successfully with valid URI", () => {
            connectionSharingService.disconnect(TEST_CONNECTION_URI);

            expect(mockConnectionManager.disconnect).to.have.been.calledOnceWith(
                TEST_CONNECTION_URI,
            );
        });

        test("Should throw INVALID_CONNECTION_URI error when URI is empty", () => {
            try {
                connectionSharingService.disconnect("");
                expect.fail("Should have thrown ConnectionSharingError");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.INVALID_CONNECTION_URI,
                );
            }
        });

        test("Should throw INVALID_CONNECTION_URI error when URI is undefined", () => {
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                connectionSharingService.disconnect(undefined as any as string);
                expect.fail("Should have thrown ConnectionSharingError");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.INVALID_CONNECTION_URI,
                );
            }
        });
    });

    suite("isConnected", () => {
        test("Should return true for connected URI", () => {
            mockConnectionManager.isConnected.returns(true);

            const result = connectionSharingService.isConnected(TEST_CONNECTION_URI);

            expect(result).to.be.true;
            expect(mockConnectionManager.isConnected).to.have.been.calledOnceWith(
                TEST_CONNECTION_URI,
            );
        });

        test("Should return false for disconnected URI", () => {
            mockConnectionManager.isConnected.returns(false);

            const result = connectionSharingService.isConnected(TEST_CONNECTION_URI);

            expect(result).to.be.false;
        });

        test("Should return false for empty URI", () => {
            const result = connectionSharingService.isConnected("");

            expect(result).to.be.false;
        });

        test("Should return false for undefined URI", () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = connectionSharingService.isConnected(undefined as any as string);

            expect(result).to.be.false;
        });
    });

    suite("executeSimpleQuery", () => {
        test("Should execute query successfully", async () => {
            const testQuery = "SELECT * FROM TestTable";
            const testResult: mssql.SimpleExecuteResult = {
                rowCount: 5,
                columnInfo: [
                    {
                        columnName: "id",
                        baseCatalogName: "",
                        baseColumnName: "",
                        baseSchemaName: "",
                        baseServerName: "",
                        baseTableName: "",
                        dataType: "int",
                        udtAssemblyQualifiedName: "",
                        dataTypeName: "int",
                    },
                ],
                rows: [[{ displayValue: "1", isNull: false }]],
            };

            mockConnectionManager.isConnected.returns(true);
            mockClient.sendRequest.resolves(testResult);

            const result = await connectionSharingService.executeSimpleQuery(
                TEST_CONNECTION_URI,
                testQuery,
            );

            expect(result).to.deep.equal(testResult);
            expect(mockClient.sendRequest).to.have.been.calledOnce;
        });

        test("Should throw INVALID_CONNECTION_URI error when URI is empty", async () => {
            try {
                await connectionSharingService.executeSimpleQuery("", "SELECT 1");
                expect.fail("Should have thrown ConnectionSharingError");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.INVALID_CONNECTION_URI,
                );
            }
        });

        test("Should throw NO_ACTIVE_CONNECTION error when not connected", async () => {
            mockConnectionManager.isConnected.returns(false);

            try {
                await connectionSharingService.executeSimpleQuery(TEST_CONNECTION_URI, "SELECT 1");
                expect.fail("Should have thrown ConnectionSharingError");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.NO_ACTIVE_CONNECTION,
                );
            }
        });
    });

    suite("getServerInfo", () => {
        test("Should return server info for valid connection", () => {
            const testServerInfo: mssql.IServerInfo = {
                serverVersion: "15.0.0",
                serverEdition: "Developer",
                isCloud: false,
                azureVersion: 0,
                osVersion: "",
                serverMajorVersion: 15,
                serverMinorVersion: 0,
                serverReleaseVersion: 0,
                engineEditionId: 0,
                serverLevel: "RTM",
            };

            mockConnectionManager.isConnected.returns(true);
            mockConnectionManager.getConnectionInfoFromUri.returns({} as IConnectionProfile);
            mockConnectionManager.getServerInfo.returns(testServerInfo);

            const result = connectionSharingService.getServerInfo(TEST_CONNECTION_URI);

            expect(result).to.deep.equal(testServerInfo);
        });

        test("Should throw INVALID_CONNECTION_URI error when URI is empty", () => {
            try {
                connectionSharingService.getServerInfo("");
                expect.fail("Should have thrown ConnectionSharingError");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.INVALID_CONNECTION_URI,
                );
            }
        });

        test("Should throw NO_ACTIVE_CONNECTION error when not connected", () => {
            mockConnectionManager.isConnected.returns(false);

            try {
                connectionSharingService.getServerInfo(TEST_CONNECTION_URI);
                expect.fail("Should have thrown ConnectionSharingError");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.NO_ACTIVE_CONNECTION,
                );
            }
        });
    });

    suite("listDatabases", () => {
        test("Should return list of databases for valid connection", async () => {
            const testDatabases = ["Database1", "Database2", "Database3"];

            mockConnectionManager.isConnected.returns(true);
            mockConnectionManager.listDatabases.resolves(testDatabases);

            const result = await connectionSharingService.listDatabases(TEST_CONNECTION_URI);

            expect(result).to.deep.equal(testDatabases);
        });

        test("Should throw INVALID_CONNECTION_URI error when URI is empty", async () => {
            try {
                await connectionSharingService.listDatabases("");
                expect.fail("Should have thrown ConnectionSharingError");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.INVALID_CONNECTION_URI,
                );
            }
        });

        test("Should throw NO_ACTIVE_CONNECTION error when not connected", async () => {
            mockConnectionManager.isConnected.returns(false);

            try {
                await connectionSharingService.listDatabases(TEST_CONNECTION_URI);
                expect.fail("Should have thrown ConnectionSharingError");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.NO_ACTIVE_CONNECTION,
                );
            }
        });
    });

    suite("scriptObject", () => {
        test("Should execute script operation successfully", async () => {
            const testScriptingObject: mssql.IScriptingObject = {
                type: "Table",
                schema: "dbo",
                name: "TestTable",
            };
            const testOperation = ScriptOperation.Select;
            const testServerInfo: mssql.IServerInfo = {
                serverVersion: "15.0.0",
                serverEdition: "Developer",
                isCloud: false,
                azureVersion: 0,
                osVersion: "",
                serverMajorVersion: 15,
                serverMinorVersion: 0,
                serverReleaseVersion: 0,
                engineEditionId: 0,
                serverLevel: "RTM",
            };

            mockConnectionManager.isConnected.returns(true);
            mockConnectionManager.getConnectionInfoFromUri.returns({} as IConnectionProfile);
            mockConnectionManager.getServerInfo.returns(testServerInfo);
            mockScriptingService.createScriptingRequestParams.returns({} as IScriptingParams);
            mockScriptingService.script.resolves("SELECT * FROM dbo.TestTable");

            const result = await connectionSharingService.scriptObject(
                TEST_CONNECTION_URI,
                testOperation,
                testScriptingObject,
            );

            expect(result).to.equal("SELECT * FROM dbo.TestTable");
            expect(mockScriptingService.createScriptingRequestParams).to.have.been.calledOnce;
            expect(mockScriptingService.script).to.have.been.calledOnce;
        });

        test("Should throw INVALID_CONNECTION_URI error when URI is empty", async () => {
            const testScriptingObject: mssql.IScriptingObject = {
                type: "Table",
                schema: "dbo",
                name: "TestTable",
            };

            try {
                await connectionSharingService.scriptObject(
                    "",
                    ScriptOperation.Select,
                    testScriptingObject,
                );
                expect.fail("Should have thrown ConnectionSharingError");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.INVALID_CONNECTION_URI,
                );
            }
        });

        test("Should throw NO_ACTIVE_CONNECTION error when not connected", async () => {
            const testScriptingObject: mssql.IScriptingObject = {
                type: "Table",
                schema: "dbo",
                name: "TestTable",
            };

            mockConnectionManager.isConnected.returns(false);

            try {
                await connectionSharingService.scriptObject(
                    TEST_CONNECTION_URI,
                    ScriptOperation.Select,
                    testScriptingObject,
                );
                expect.fail("Should have thrown ConnectionSharingError");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.NO_ACTIVE_CONNECTION,
                );
            }
        });
    });

    suite("editConnectionSharingPermissions", () => {
        test("Should allow editing permissions for specific extension", async () => {
            await connectionSharingService["updateExtensionPermission"](
                TEST_EXTENSION_ID,
                "denied",
            );

            const quickPickStub = sandbox.stub(vscode.window, "showQuickPick").resolves({
                label: LocalizedConstants.ConnectionSharing.GrantAccess,
                detail: "approved",
            } as vscode.QuickPickItem);

            const result =
                await connectionSharingService.editConnectionSharingPermissions(TEST_EXTENSION_ID);

            expect(result).to.equal("approved");
            expect(quickPickStub).to.have.been.calledOnce;

            const permission =
                await connectionSharingService["getExtensionPermission"](TEST_EXTENSION_ID);
            expect(permission).to.equal("approved");
        });

        test("Should prompt user to select extension when no extension ID provided", async () => {
            const mockExtension = {
                id: TEST_EXTENSION_ID,
                packageJSON: {
                    displayName: "Test Extension",
                    description: "A test extension",
                    publisher: "TestPublisher",
                },
            };

            sandbox
                .stub(vscode.extensions, "all")
                .get(() => [mockExtension, { id: "ms-mssql.mssql" } as vscode.Extension<unknown>]);

            const extensionSelectStub = sandbox
                .stub(vscode.window, "showQuickPick")
                .onFirstCall()
                .resolves({
                    label: "Test Extension",
                    detail: TEST_EXTENSION_ID,
                } as vscode.QuickPickItem)
                .onSecondCall()
                .resolves({
                    detail: "approved",
                } as vscode.QuickPickItem);

            const result = await connectionSharingService.editConnectionSharingPermissions();

            expect(extensionSelectStub).to.have.been.calledTwice;
            expect(result).to.equal("approved");
        });

        test("Should return undefined when user cancels extension selection", async () => {
            sandbox.stub(vscode.window, "showQuickPick").resolves(undefined);

            const result = await connectionSharingService.editConnectionSharingPermissions();

            expect(result).to.be.undefined;
        });

        test("Should return undefined when user cancels permission selection", async () => {
            sandbox.stub(vscode.window, "showQuickPick").resolves(undefined);

            const result =
                await connectionSharingService.editConnectionSharingPermissions(TEST_EXTENSION_ID);

            expect(result).to.be.undefined;
        });
    });

    suite("getConnectionString", () => {
        test("Should return connection string for valid connection ID", async () => {
            await approveExtension(TEST_EXTENSION_ID);

            const testConnection: IConnectionProfile = {
                id: TEST_CONNECTION_ID,
                database: TEST_DATABASE,
            } as IConnectionProfile;
            const testConnectionString = "Server=localhost;Database=TestDatabase;";

            mockConnectionConfig.getConnections.resolves([testConnection]);
            mockConnectionManager.createConnectionDetails.returns({} as mssql.ConnectionDetails);
            mockConnectionManager.getConnectionString.resolves(testConnectionString);

            const result = await connectionSharingService.getConnectionString(
                TEST_EXTENSION_ID,
                TEST_CONNECTION_ID,
            );

            expect(result).to.equal(testConnectionString);
            expect(mockConnectionManager.getConnectionString).to.have.been.calledOnceWith(
                sinon.match.any,
                true,
                false,
            );
        });

        test("Should throw CONNECTION_NOT_FOUND error for invalid connection ID", async () => {
            await approveExtension(TEST_EXTENSION_ID);
            mockConnectionConfig.getConnections.resolves([]);

            try {
                await connectionSharingService.getConnectionString(
                    TEST_EXTENSION_ID,
                    TEST_CONNECTION_ID,
                );
                expect.fail("Should have thrown ConnectionSharingError");
            } catch (error) {
                expect(error).to.be.instanceOf(ConnectionSharingError);
                expect((error as ConnectionSharingError).code).to.equal(
                    ConnectionSharingErrorCode.CONNECTION_NOT_FOUND,
                );
            }
        });
    });
});
