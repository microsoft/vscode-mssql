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
    IConnectionDialogProfile,
} from "../../src/sharedInterfaces/connectionDialog";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import { ConnectionStore } from "../../src/models/connectionStore";
import { ConnectionUI } from "../../src/views/connectionUI";
import {
    CredentialsQuickPickItemType,
    IConnectionProfileWithSource,
} from "../../src/models/interfaces";
import { AzureAccountService } from "../../src/services/azureAccountService";
import { IAccount } from "vscode-mssql";
import SqlToolsServerClient from "../../src/languageservice/serviceclient";
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
} from "./azureHelperStubs";
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

chai.use(sinonChai);

suite("ConnectionDialogWebviewController Tests", () => {
    let sandbox: sinon.SinonSandbox;

    let controller: ConnectionDialogWebviewController;
    let mockContext: vscode.ExtensionContext;
    let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let mainController: MainController;
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let connectionStore: sinon.SinonStubbedInstance<ConnectionStore>;
    let connectionUi: sinon.SinonStubbedInstance<ConnectionUI>;
    let mockObjectExplorerProvider: sinon.SinonStubbedInstance<ObjectExplorerProvider>;
    let azureAccountService: sinon.SinonStubbedInstance<AzureAccountService>;
    let serviceClientMock: sinon.SinonStubbedInstance<SqlToolsServerClient>;

    const TEST_ROOT_GROUP_ID = "test-root-group-id";

    const testMruConnection = {
        profileSource: CredentialsQuickPickItemType.Mru,
        server: "MruServer",
        database: "MruDatabase",
    } as IConnectionProfileWithSource;

    const testSavedConnection = {
        profileSource: CredentialsQuickPickItemType.Profile,
        server: "SavedServer",
        database: "SavedDatabase",
        groupId: TEST_ROOT_GROUP_ID,
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
        connectionUi = sandbox.createStubInstance(ConnectionUI);
        azureAccountService = sandbox.createStubInstance(AzureAccountService);
        serviceClientMock = stubGetCapabilitiesRequest(sandbox);

        sandbox.stub(connectionManager, "connectionStore").get(() => connectionStore);
        sandbox.stub(connectionManager, "connectionUI").get(() => connectionUi);
        sandbox.stub(connectionManager, "client").get(() => serviceClientMock);

        connectionStore.readAllConnections.resolves([testMruConnection, testSavedConnection]);
        connectionStore.readAllConnectionGroups.resolves([
            { id: TEST_ROOT_GROUP_ID, name: ConnectionConfig.RootGroupName },
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

    suite("Reducers", () => {
        suite("setConnectionInputType", () => {
            test("Should set connection input type correctly for Parameters", async () => {
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
