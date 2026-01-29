/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";
import { expect } from "chai";

import {
    CLEAR_TOKEN_CACHE,
    ConnectionDialogWebviewController,
} from "../../src/connectionconfig/connectionDialogWebviewController";
import MainController from "../../src/controllers/mainController";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { ObjectExplorerProvider } from "../../src/objectExplorer/objectExplorerProvider";
import {
    AddFirewallRuleDialogProps,
    AuthenticationType,
    AzureSqlServerInfo,
    ConnectionInputMode,
    ConnectionStringDialogProps,
    IConnectionDialogProfile,
} from "../../src/sharedInterfaces/connectionDialog";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import { ConnectionStore } from "../../src/models/connectionStore";
import { ConnectionUI } from "../../src/views/connectionUI";
import {
    CredentialsQuickPickItemType,
    IConnectionGroup,
    IConnectionProfileWithSource,
} from "../../src/models/interfaces";
import { AzureAccountService } from "../../src/services/azureAccountService";
import { ConnectionDetails, IAccount } from "vscode-mssql";
import SqlToolsServerClient from "../../src/languageservice/serviceclient";
import { MssqlVSCodeAzureSubscriptionProvider } from "../../src/azure/MssqlVSCodeAzureSubscriptionProvider";
import {
    initializeIconUtils,
    stubGetCapabilitiesRequest,
    stubTelemetry,
    stubUserSurvey,
    stubVscodeWrapper,
} from "./utils";
import {
    stubVscodeAzureSignIn,
    stubFetchServersFromAzure,
    stubPromptForAzureSubscriptionFilter,
    stubVscodeAzureHelperGetAccounts,
    mockServerName,
    mockUserName,
    mockTenants,
} from "./azureHelperStubs";
import * as AzureHelpers from "../../src/connectionconfig/azureHelpers";
import { CreateSessionResponse } from "../../src/models/contracts/objectExplorer/createSessionRequest";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import { AzureController } from "../../src/azure/azureController";
import { ConnectionConfig } from "../../src/connectionconfig/connectionconfig";
import { multiple_matching_tokens_error } from "../../src/azure/constants";
import { Logger } from "../../src/models/logger";
import { MsalAzureController } from "../../src/azure/msal/msalAzureController";
import { errorPasswordExpired } from "../../src/constants/constants";
import { FirewallRuleSpec } from "../../src/sharedInterfaces/firewallRule";
import { FirewallService } from "../../src/firewall/firewallService";
import { AddFirewallRuleState } from "../../src/sharedInterfaces/addFirewallRule";
import { deepClone } from "../../src/models/utils";

chai.use(sinonChai);

suite("ConnectionDialogWebviewController Tests", () => {
    let sandbox: sinon.SinonSandbox;

    let controller: ConnectionDialogWebviewController;
    let mockContext: vscode.ExtensionContext;
    let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let mainController: MainController;
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let connectionStore: sinon.SinonStubbedInstance<ConnectionStore>;
    let connectionConfig: sinon.SinonStubbedInstance<ConnectionConfig>;
    let connectionUi: sinon.SinonStubbedInstance<ConnectionUI>;
    let mockObjectExplorerProvider: sinon.SinonStubbedInstance<ObjectExplorerProvider>;
    let azureAccountService: sinon.SinonStubbedInstance<AzureAccountService>;
    let serviceClientMock: sinon.SinonStubbedInstance<SqlToolsServerClient>;

    const testMruConnection = {
        profileSource: CredentialsQuickPickItemType.Mru,
        server: "MruServer",
        database: "MruDatabase",
    } as IConnectionProfileWithSource;

    const testSavedConnection = {
        profileSource: CredentialsQuickPickItemType.Profile,
        server: "SavedServer",
        database: "SavedDatabase",
        groupId: ConnectionConfig.ROOT_GROUP_ID,
    } as IConnectionProfileWithSource;

    setup(async () => {
        sandbox = sinon.createSandbox();
        initializeIconUtils();

        const globalState = {
            get: sandbox.stub().callsFake((_key, defaultValue) => defaultValue),
        } as unknown as vscode.Memento;

        mockContext = {
            extensionUri: vscode.Uri.parse("file://fakePath"),
            extensionPath: "fakePath",
            subscriptions: [],
            globalState,
        } as unknown as vscode.ExtensionContext;

        mockVscodeWrapper = stubVscodeWrapper(sandbox);
        mockObjectExplorerProvider = sandbox.createStubInstance(ObjectExplorerProvider);

        connectionManager = sandbox.createStubInstance(ConnectionManager);
        connectionStore = sandbox.createStubInstance(ConnectionStore);
        connectionConfig = sandbox.createStubInstance(ConnectionConfig);
        connectionUi = sandbox.createStubInstance(ConnectionUI);
        azureAccountService = sandbox.createStubInstance(AzureAccountService);
        serviceClientMock = stubGetCapabilitiesRequest(sandbox);

        sandbox.stub(connectionStore, "connectionConfig").get(() => connectionConfig);
        sandbox.stub(connectionManager, "connectionStore").get(() => connectionStore);
        sandbox.stub(connectionManager, "connectionUI").get(() => connectionUi);
        sandbox.stub(connectionManager, "client").get(() => serviceClientMock);

        connectionConfig.getGroupById.resolves({
            id: ConnectionConfig.ROOT_GROUP_ID,
            name: ConnectionConfig.ROOT_GROUP_ID,
            configSource: vscode.ConfigurationTarget.Global,
        } as IConnectionGroup);

        connectionStore.readAllConnections.resolves([testMruConnection, testSavedConnection]);
        connectionStore.readAllConnectionGroups.resolves([
            {
                id: ConnectionConfig.ROOT_GROUP_ID,
                name: ConnectionConfig.ROOT_GROUP_ID,
                configSource: vscode.ConfigurationTarget.Global,
            },
        ]);

        azureAccountService.getAccounts.resolves([
            {
                displayInfo: {
                    displayName: "Test Display Name",
                    userId: "TestUserId",
                },
                key: {
                    id: "TestUserId",
                },
            } as IAccount,
        ]);

        mainController = new MainController(mockContext, connectionManager, mockVscodeWrapper);

        sandbox.stub(vscode.commands, "registerCommand");
        sandbox.stub(vscode.window, "registerWebviewViewProvider");

        mainController.azureAccountService = azureAccountService;
        await mainController["initializeObjectExplorer"](mockObjectExplorerProvider);

        controller = new ConnectionDialogWebviewController(
            mockContext,
            mockVscodeWrapper,
            mainController,
            mockObjectExplorerProvider,
            undefined /* connection to edit */,
        );

        await controller.initialized;
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("Initialization", () => {
        test("should initialize correctly for new connection", async () => {
            const expectedInitialFormState = {
                authenticationType: "SqlLogin",
                connectTimeout: 30,
                commandTimeout: 30,
                applicationName: "vscode-mssql",
                applicationIntent: "ReadWrite",
                database: "",
                encrypt: "Mandatory",
                server: "",
                password: "",
                user: "",
                groupId: ConnectionConfig.ROOT_GROUP_ID,
            };

            expect(controller.state.formState).to.deep.equal(
                expectedInitialFormState,
                "Initial form state is incorrect",
            );

            expect(controller.state.formMessage).to.deep.equal(
                undefined,
                "Should be no error in the initial state",
            );

            expect(controller.state.connectionStatus).to.equal(
                ApiStatus.NotStarted,
                "Connection status should be NotStarted",
            );

            expect(controller.state.azureAccounts).to.be.empty;

            expect(controller.state.loadingAzureAccountsStatus).to.equal(
                ApiStatus.NotStarted,
                "Azure account load status should be NotStarted",
            );

            expect(controller.state.loadingAzureSubscriptionsStatus).to.equal(
                ApiStatus.NotStarted,
                "Azure subscription load status should be NotStarted",
            );

            expect(controller.state.loadingAzureServersStatus).to.equal(
                ApiStatus.NotStarted,
                "Azure server load status should be NotStarted",
            );

            expect(controller.state.formComponents).to.contains.all.keys(["server", "user"]);

            expect(controller.state.formComponents).to.contains.all.keys([
                "profileName",
                "savePassword",
                "accountId",
                "tenantId",
                "connectionString",
            ]);

            expect(controller.state.connectionComponents.mainOptions).to.deep.equal([
                "server",
                "trustServerCertificate",
                "authenticationType",
                "user",
                "password",
                "savePassword",
                "accountId",
                "tenantId",
                "database",
                "encrypt",
            ]);

            expect(controller.state.selectedInputMode).to.equal(ConnectionInputMode.Parameters);
            expect(controller.state.savedConnections).to.have.lengthOf(1);
            expect(controller.state.savedConnections[0]).to.deep.include(testSavedConnection);

            expect(controller.state.recentConnections).to.have.lengthOf(1);
            expect(controller.state.recentConnections).to.deep.include(testMruConnection);
            expect(
                controller.state.readyToConnect,
                "Incomplete connection dialog should not be ready to connect",
            ).to.be.false;
        });

        test("should initialize correctly when editing connection", async () => {
            const editedConnection = {
                profileName: "Test Server to Edit",
                server: "SavedServer",
                database: "SavedDatabase",
                authenticationType: AuthenticationType.Integrated,
                groupId: "test-group-id",
            } as IConnectionDialogProfile;

            controller = new ConnectionDialogWebviewController(
                mockContext,
                mockVscodeWrapper,
                mainController,
                mockObjectExplorerProvider,
                editedConnection,
            );
            await controller.initialized;

            expect(controller["_connectionBeingEdited"]).to.deep.equal(
                { ...editedConnection, password: undefined },
                "Form state should be the same as the connection being edited",
            );

            expect(
                controller.state.readyToConnect,
                "should be ready to connect when launched with a profile to edit",
            ).to.be.true;
        });

        test("should initialize correctly when editing connection with password", async () => {
            const editedConnection = {
                profileName: "Test Server to Edit",
                server: "SavedServer",
                database: "SavedDatabase",
                authenticationType: AuthenticationType.SqlLogin,
                user: "testUser",
                password: "testPassword",
                groupId: ConnectionConfig.ROOT_GROUP_ID,
            } as IConnectionDialogProfile;

            controller = new ConnectionDialogWebviewController(
                mockContext,
                mockVscodeWrapper,
                mainController,
                mockObjectExplorerProvider,
                editedConnection,
            );
            await controller.initialized;

            expect(controller["_connectionBeingEdited"]).to.deep.equal(
                editedConnection,
                "Form state should be the same as the connection being edited",
            );

            expect(
                controller.state.readyToConnect,
                "should be ready to connect when launched with a profile to edit",
            ).to.be.true;
        });
    });

    suite("Database options", () => {
        test("should reset database options when a dependent field changes", async () => {
            controller.state.databaseOptions = ["<default>", "userdb"];
            controller.state.databaseOptionsStatus = ApiStatus.Loaded;
            controller.state.databaseOptionsKey = "server|user";

            await (controller as unknown as any).afterSetFormProperty("server");

            expect(controller.state.databaseOptions).to.deep.equal(["<default>"]);
            expect(controller.state.databaseOptionsStatus).to.equal(ApiStatus.NotStarted);
            expect(controller.state.databaseOptionsKey).to.equal(undefined);
        });

        test("should load database options and include <default>", async () => {
            connectionManager.connect.resolves(true);
            connectionManager.listDatabases.resolves(["db1", "db2"]);
            connectionManager.disconnect.resolves(true);

            const response = await (controller as unknown as any).loadDatabaseOptions({
                authenticationType: AuthenticationType.SqlLogin,
                server: "server",
                user: "user",
                password: "password",
            } as IConnectionDialogProfile);

            expect(response.databases[0]).to.equal("<default>");
            expect(controller.state.databaseOptions).to.deep.equal(response.databases);
            expect(controller.state.databaseOptionsStatus).to.equal(ApiStatus.Loaded);
        });

        test("should use cached database options for the same credentials", async () => {
            controller.state.databaseOptionsCache = {
                "SqlLogin|server|user|password||": ["<default>", "cachedDb"],
            };

            const response = await (controller as unknown as any).loadDatabaseOptions({
                authenticationType: AuthenticationType.SqlLogin,
                server: "server",
                user: "user",
                password: "password",
            } as IConnectionDialogProfile);

            expect(response.databases).to.deep.equal(["<default>", "cachedDb"]);
            expect(controller.state.databaseOptionsStatus).to.equal(ApiStatus.Loaded);
            expect(connectionManager.connect).to.not.have.been.called;
        });

        test("should dedupe in-flight database option requests for the same key", async () => {
            let resolveConnect: (value: boolean) => void = () => {};
            const connectPromise = new Promise<boolean>((resolve) => {
                resolveConnect = resolve;
            });

            connectionManager.connect.returns(connectPromise as unknown as Promise<boolean>);
            connectionManager.listDatabases.resolves(["db1"]);
            connectionManager.disconnect.resolves(true);

            const profile = {
                authenticationType: AuthenticationType.SqlLogin,
                server: "server",
                user: "user",
                password: "password",
            } as IConnectionDialogProfile;

            const firstPromise = (controller as unknown as any).loadDatabaseOptions(profile);
            const secondPromise = (controller as unknown as any).loadDatabaseOptions(profile);

            expect(connectionManager.connect).to.have.been.calledOnce;

            resolveConnect(true);
            const [first, second] = await Promise.all([firstPromise, secondPromise]);

            expect(first.databases).to.deep.equal(second.databases);
            expect(connectionManager.connect).to.have.been.calledOnce;
        });
    });

    suite("Reducers", () => {
        suite("setConnectionInputType", () => {
            test("Should set connection input type correctly for Parameters", async () => {
                stubVscodeAzureHelperGetAccounts(sandbox);
                stubVscodeAzureSignIn(sandbox);

                expect(controller.state.selectedInputMode).to.equal(
                    ConnectionInputMode.Parameters,
                    "Default input mode should be Parameters",
                );

                await controller["_reducerHandlers"].get("setConnectionInputType")(
                    controller.state,
                    {
                        inputMode: ConnectionInputMode.AzureBrowse,
                    },
                );

                expect(controller.state.selectedInputMode).to.equal(
                    ConnectionInputMode.AzureBrowse,
                    "Should set connection input type to AzureBrowse",
                );

                await controller["_reducerHandlers"].get("setConnectionInputType")(
                    controller.state,
                    {
                        inputMode: ConnectionInputMode.Parameters,
                    },
                );

                expect(controller.state.selectedInputMode).to.equal(
                    ConnectionInputMode.Parameters,
                    "Should set connection input type to Parameters",
                );
            });

            test("should set connection input mode correctly and load server info for AzureBrowse", async () => {
                const { sendErrorEvent } = stubTelemetry(sandbox);

                stubVscodeAzureSignIn(sandbox);
                stubVscodeAzureHelperGetAccounts(sandbox);
                stubFetchServersFromAzure(sandbox);

                await controller["_reducerHandlers"].get("setConnectionInputType")(
                    controller.state,
                    {
                        inputMode: ConnectionInputMode.AzureBrowse,
                    },
                );

                // validate that subscriptions and servers are loaded correctly

                expect(sendErrorEvent.notCalled, "sendErrorEvent should not be called").to.be.true;

                expect(controller.state.azureSubscriptions).to.have.lengthOf(2);
                expect(controller.state.azureSubscriptions).to.satisfy(
                    (subs) => subs.some((s) => s.name === "Ten0Sub1"),
                    "Subscription list should contain expected subscription",
                );

                expect(controller.state.azureServers).to.have.lengthOf(
                    4,
                    "Should have 4 servers; 2 for each subscription",
                );
                expect(controller.state.azureServers).to.satisfy(
                    (servers: AzureSqlServerInfo[]) =>
                        servers.some((server) => server.server === "testServer-Ten1Sub1-2"),
                    "Server list should contain expected server",
                );
            });
        });

        test("loadConnection", async () => {
            controller.state.formMessage = { message: "Sample error" };

            expect(
                controller["_connectionBeingEdited"],
                "should not be a connection being edited at first",
            ).to.be.undefined;

            expect(
                controller.state.readyToConnect,
                "should not be ready to connect before profile has been loaded",
            ).to.be.false;

            const testConnection = {
                profileName: "Test Server to Edit",
                server: "SavedServer",
                database: "SavedDatabase",
                authenticationType: AuthenticationType.Integrated,
            } as IConnectionDialogProfile;

            await controller["_reducerHandlers"].get("loadConnection")(controller.state, {
                connection: testConnection,
            });

            expect(
                controller["_connectionBeingEdited"],
                "connection being edited should have the same properties as the one passed to the reducer",
            ).to.deep.equal(testConnection);
            expect(
                controller["_connectionBeingEdited"],
                "connection being edited should be a clone of the one passed to the reducer, not the original",
            ).to.not.equal(testConnection);

            expect(
                controller.state.formMessage,
                "Error should be cleared after loading the connection",
            ).to.be.undefined;

            expect(
                controller.state.readyToConnect,
                "should be ready to connect after profile has been loaded",
            ).to.be.true;
        });

        suite("connect", () => {
            let mockConnectionNode: TreeNodeInfo;
            let testFormState: IConnectionDialogProfile;

            setup(() => {
                stubTelemetry(sandbox);
                stubUserSurvey(sandbox);

                mockConnectionNode = new TreeNodeInfo(
                    "testNode",
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    "Database",
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                );

                testFormState = {
                    server: "localhost",
                    user: "testUser",
                    password: "testPassword",
                    authenticationType: AuthenticationType.SqlLogin,
                    groupId: ConnectionConfig.ROOT_GROUP_ID,
                } as IConnectionDialogProfile;
            });

            test("connect happy path", async () => {
                mockObjectExplorerProvider.createSession.resolves({
                    sessionId: "testSessionId",
                    rootNode: mockConnectionNode,
                    success: true,
                } as CreateSessionResponse);

                connectionManager.connect.resolves(true);

                const mockObjectExplorerTree = {
                    reveal: sandbox.stub().resolves(),
                } as unknown as vscode.TreeView<TreeNodeInfo>;

                mainController.objectExplorerTree = mockObjectExplorerTree;

                // Run test
                controller.state.formState = testFormState;

                await controller["_reducerHandlers"].get("connect")(controller.state, {});
            });

            test("displays actionable error message for multiple_matching_tokens_error", async () => {
                mockObjectExplorerProvider.createSession.resolves({
                    sessionId: "testSessionId",
                    rootNode: mockConnectionNode,
                    success: true,
                } as CreateSessionResponse);

                const errorMessage = `Error: Connection failed due to ${multiple_matching_tokens_error}`;

                connectionManager.connect.rejects(new Error(errorMessage));

                // Run test
                controller.state.formState = testFormState;

                await controller["_reducerHandlers"].get("connect")(controller.state, {});

                expect(controller.state.formMessage).to.not.be.undefined;
                expect(controller.state.formMessage.message).to.equal(errorMessage);
                expect(controller.state.formMessage.buttons).to.deep.equal([
                    { id: CLEAR_TOKEN_CACHE, label: "Clear token cache" },
                ]);
            });

            test("displays error when attempting to create OE session fails", async () => {
                const errorMessage = "Test createSession error";
                mockObjectExplorerProvider.createSession.rejects(new Error(errorMessage));

                connectionManager.connect.resolves(true);

                // Run test
                controller.state.formState = testFormState;

                await controller["_reducerHandlers"].get("connect")(controller.state, {});

                expect(controller.state.formMessage).to.not.be.undefined;
                expect(controller.state.connectionStatus).to.equal(ApiStatus.Error);
                expect(controller.state.formMessage.message).to.equal(errorMessage);
            });

            test("displays password changed dialog upon password expired error", async () => {
                mockObjectExplorerProvider.createSession.resolves({
                    sessionId: "testSessionId",
                    rootNode: mockConnectionNode,
                    success: true,
                } as CreateSessionResponse);

                const errorMessage = "Your password has expired and needs to be changed.";

                connectionManager.connect.resolves(false);

                connectionManager.getConnectionInfo.returns({
                    errorNumber: errorPasswordExpired,
                    errorMessage,
                    messages: errorMessage,
                    credentials: {
                        server: mockServerName,
                        user: mockUserName,
                    },
                } as ConnectionInfo);

                // Run test
                controller.state.formState = testFormState;

                await controller["_reducerHandlers"].get("connect")(controller.state, {});

                expect(controller.state.formMessage).to.not.be.undefined;
                expect(controller.state.formMessage.message)
                    .to.contain(errorMessage)
                    .and.to.contain(errorPasswordExpired);
            });
        });

        suite("filterAzureSubscriptions", () => {
            test("Filter change cancelled", async () => {
                stubPromptForAzureSubscriptionFilter(sandbox, false);

                await controller["_reducerHandlers"].get("filterAzureSubscriptions")(
                    controller.state,
                    {},
                );

                const stub = (controller["loadAllAzureServers"] = sandbox.stub().resolves());

                expect(stub.notCalled, "loadAllAzureServers should not be called").to.be.true;
            });

            test("Filter updated", async () => {
                const { sendErrorEvent } = stubTelemetry(sandbox);

                stubPromptForAzureSubscriptionFilter(sandbox, true);
                stubVscodeAzureHelperGetAccounts(sandbox);
                stubVscodeAzureSignIn(sandbox);
                stubFetchServersFromAzure(sandbox);

                expect(
                    controller.state.azureSubscriptions,
                    "No subscriptions should be loaded initially",
                ).to.have.lengthOf(0);

                await controller["_reducerHandlers"].get("filterAzureSubscriptions")(
                    controller.state,
                    {},
                );

                expect(sendErrorEvent.notCalled, "sendErrorEvent should not be called").to.be.true;
                expect(
                    controller.state.azureSubscriptions,
                    "changing Azure subscription filter settings should trigger reloading subscriptions",
                ).to.have.lengthOf(2);
            });
        });

        suite("messageButtonClicked", () => {
            test("clearTokenCache", async () => {
                controller.state.formMessage = {
                    message: "You need to clear your token cache",
                    buttons: [{ id: CLEAR_TOKEN_CACHE, label: "Clear token cache" }],
                };

                const azureControllerStub = sandbox.createStubInstance(MsalAzureController);

                connectionManager.azureController = azureControllerStub;

                await controller["_reducerHandlers"].get("messageButtonClicked")(controller.state, {
                    buttonId: CLEAR_TOKEN_CACHE,
                });

                expect(controller.state.formMessage).to.be.undefined;
                expect(azureControllerStub.clearTokenCache).to.have.been.calledOnce;
            });

            test("unknown button", async () => {
                const unknownButtonId = "unknownButtonId";

                const loggerStub = sandbox.createStubInstance(Logger);
                controller["logger"] = loggerStub;

                await controller["_reducerHandlers"].get("messageButtonClicked")(controller.state, {
                    buttonId: unknownButtonId,
                });

                expect(loggerStub.error).to.have.been.calledOnceWith(
                    `Unknown message button clicked: ${unknownButtonId}`,
                );
            });
        });

        suite("addFirewallRule", () => {
            test("displays error upon failure to create firewall rule", async () => {
                const testFirewallSpec: FirewallRuleSpec = {} as FirewallRuleSpec;
                const errorMessage = "Test create firewall rule error";

                const mockFirewallService = sandbox.createStubInstance(FirewallService);
                mockFirewallService.createFirewallRuleWithVscodeAccount.throws(
                    new Error(errorMessage),
                );

                sandbox.stub(connectionManager, "firewallService").get(() => mockFirewallService);

                controller.state.dialog = {
                    type: "addFirewallRule",
                    props: {
                        addFirewallRuleStatus: { status: ApiStatus.NotStarted },
                    } as unknown as AddFirewallRuleState,
                } as AddFirewallRuleDialogProps;

                await controller["_reducerHandlers"].get("addFirewallRule")(controller.state, {
                    firewallRuleSpec: testFirewallSpec,
                });

                expect(controller.state.formMessage).to.not.be.undefined;
                expect(controller.state.formMessage.message).to.equal(errorMessage);
                expect(controller.state.dialog).to.be.undefined;
            });
        });

        suite("loadFromConnectionString", () => {
            async function runConnectionStringScenario(
                mockOutput: ConnectionDetails,
                errorMessage?: string,
            ) {
                const connectionString = "doesn't actually matter for this test";

                if (errorMessage) {
                    connectionManager.parseConnectionString.throws(new Error(errorMessage));
                } else {
                    connectionManager.parseConnectionString.resolves(mockOutput);
                }

                controller.state.dialog = {
                    type: "loadFromConnectionString",
                    connectionString: connectionString,
                } as ConnectionStringDialogProps;

                await controller["_reducerHandlers"].get("loadFromConnectionString")(
                    controller.state,
                    {
                        connectionString: connectionString,
                    },
                );
            }

            test("should load connection details from connection string with SQL Auth", async () => {
                const parsedDetails = {
                    options: {
                        server: "myServer",
                        database: "myDB",
                        user: "myUser",
                        password: "myPassword",
                        authenticationType: AuthenticationType.SqlLogin,
                    },
                } as ConnectionDetails;

                await runConnectionStringScenario(parsedDetails);

                expect(controller.state.connectionProfile.server).to.equal("myServer");
                expect(controller.state.connectionProfile.database).to.equal("myDB");
                expect(controller.state.connectionProfile.user).to.equal("myUser");
                expect(controller.state.connectionProfile.authenticationType).to.equal(
                    AuthenticationType.SqlLogin,
                );
                expect(controller.state.dialog, "dialog should be closed").to.be.undefined;
            });

            test("should load connection details from connection string with Azure MFA", async () => {
                const parsedDetails = {
                    options: {
                        server: "myServer",
                        database: "myDB",
                        authenticationType: AuthenticationType.AzureMFA,
                    },
                } as ConnectionDetails;

                await runConnectionStringScenario(parsedDetails);

                expect(controller.state.connectionProfile.server).to.equal("myServer");
                expect(controller.state.connectionProfile.database).to.equal("myDB");
                expect(controller.state.connectionProfile.authenticationType).to.equal(
                    AuthenticationType.AzureMFA,
                );
                expect(controller.state.dialog, "dialog should be closed").to.be.undefined;
            });

            test("should display error message if connection string has unsupported authentication type", async () => {
                const parsedDetails = {
                    options: {
                        server: "myServer",
                        database: "myDB",
                        authenticationType: "ActiveDirectoryServicePrincipal", // unsupported
                    },
                } as ConnectionDetails;

                const blankConnectionProfile = deepClone(controller.state.connectionProfile);

                await runConnectionStringScenario(parsedDetails);

                expect(controller.state.connectionProfile).to.deep.equal(
                    blankConnectionProfile,
                    "Connection profile should not be updated",
                );
                expect(
                    (controller.state.dialog as ConnectionStringDialogProps).connectionStringError,
                ).to.contain("ActiveDirectoryServicePrincipal");
            });

            test("should display error message if parsing connection string throws", async () => {
                const errorMessage = "Parse error";
                await runConnectionStringScenario(undefined, errorMessage);

                expect(
                    (controller.state.dialog as ConnectionStringDialogProps).connectionStringError,
                ).to.contain(errorMessage);
            });
        });

        test("signIntoAzureTenantForBrowse", async () => {
            const fakeAuth = {} as unknown as MssqlVSCodeAzureSubscriptionProvider;

            const signInStub = sandbox
                .stub(AzureHelpers.VsCodeAzureHelper, "signIn")
                .resolves(fakeAuth);
            const signInToTenantStub = sandbox
                .stub(AzureHelpers.VsCodeAzureAuth, "signInToTenant")
                .resolves();
            const loadAllAzureServersStub = sandbox
                .stub(controller as any, "loadAllAzureServers")
                .resolves();

            await controller["_reducerHandlers"].get("signIntoAzureTenantForBrowse")(
                controller.state,
                {},
            );

            expect(signInStub).to.have.been.calledOnce;
            expect(signInToTenantStub).to.have.been.calledOnceWithExactly(fakeAuth);
            expect(loadAllAzureServersStub).to.have.been.calledOnceWithExactly(controller.state);
        });

        test("refreshUnauthenticatedTenants", async () => {
            const unauthenticated = mockTenants[1];

            const fakeAuth = {
                getTenants: sandbox.stub().resolves([mockTenants[0], mockTenants[1]]),
            } as unknown as MssqlVSCodeAzureSubscriptionProvider;

            sandbox
                .stub(AzureHelpers.VsCodeAzureAuth, "getUnauthenticatedTenants")
                .resolves([unauthenticated]);

            await controller["refreshUnauthenticatedTenants"](controller.state, fakeAuth);

            expect(controller.state.unauthenticatedAzureTenants).to.have.lengthOf(1);
            expect(controller.state.unauthenticatedAzureTenants[0]).to.include({
                tenantId: unauthenticated.tenantId,
                accountId: unauthenticated.account.id,
            });

            expect(controller.state.azureTenantStatus).to.deep.equal([
                {
                    accountId: mockTenants[0].account.id,
                    accountName: mockTenants[0].account.label,
                    signedInTenants: [mockTenants[0].displayName],
                },
            ]);

            expect(controller.state.azureTenantSignInCounts).to.deep.equal({
                totalTenants: 2,
                signedInTenants: 1,
            });
        });
    });

    test("getAzureActionButtons", async () => {
        controller.state.connectionProfile.authenticationType = AuthenticationType.AzureMFA;
        controller.state.connectionProfile.accountId = "TestEntraAccountId";

        const actionButtons = await controller["getAzureActionButtons"]();
        expect(actionButtons.length).to.equal(1, "Should always have the Sign In button");
        expect(actionButtons[0].id).to.equal("azureSignIn");

        controller.state.connectionProfile.authenticationType = AuthenticationType.AzureMFA;
        controller.state.connectionProfile.accountId = "TestUserId";

        const isTokenValidStub = sandbox.stub(AzureController, "isTokenValid").returns(false);

        // When there's no error, we should have refreshToken button
        let buttons = await controller["getAzureActionButtons"]();
        expect(buttons.length).to.equal(2);
        expect(buttons[1].id).to.equal("refreshToken");

        // Test error handling when getAccountSecurityToken throws
        isTokenValidStub.restore();
        azureAccountService.getAccountSecurityToken.throws(new Error("Test error"));

        buttons = await controller["getAzureActionButtons"]();
        expect(buttons.length).to.equal(2);
        expect(buttons[1].id).to.equal("refreshToken");
    });
});
