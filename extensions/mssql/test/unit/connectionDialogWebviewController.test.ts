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
import {
    ConnectionDialog as Loc,
    Connection as ConnectionLoc,
    refreshTokenLabel,
} from "../../src/constants/locConstants";
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
import ConnectionManager, {
    ConnectionInfo,
    SqlConnectionErrorType,
} from "../../src/controllers/connectionManager";
import * as ConnectionManagerModule from "../../src/controllers/connectionManager";
import { ConnectionStore } from "../../src/models/connectionStore";
import { ConnectionUI } from "../../src/views/connectionUI";
import {
    CredentialsQuickPickItemType,
    IConnectionGroup,
    IConnectionProfileWithSource,
} from "../../src/models/interfaces";
import { AzureAccountService } from "../../src/services/azureAccountService";
import { ConnectionDetails, IAccount, IToken } from "vscode-mssql";
import SqlToolsServerClient from "../../src/languageservice/serviceclient";
import { MssqlVSCodeAzureSubscriptionProvider } from "../../src/azure/MssqlVSCodeAzureSubscriptionProvider";
import {
    createStubLogger,
    initializeIconUtils,
    stubGetCapabilitiesRequest,
    stubPreviewService,
    stubTelemetry,
    stubUserSurvey,
    stubVscodeWrapper,
} from "./utils";
import {
    stubVscodeAzureSignIn,
    stubFetchServersFromAzure,
    stubPromptForAzureSubscriptionFilter,
    mockAccounts,
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
import { MsalAzureController } from "../../src/azure/msal/msalAzureController";
import { errorPasswordExpired } from "../../src/constants/constants";
import { FirewallRuleSpec } from "../../src/sharedInterfaces/firewallRule";
import { FirewallService } from "../../src/firewall/firewallService";
import { AddFirewallRuleState } from "../../src/sharedInterfaces/addFirewallRule";
import { deepClone } from "../../src/models/utils";
import { PreviewFeature } from "../../src/previews/previewService";

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

        connectionStore.getMaxRecentConnectionsCount.returns(5);
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
            expect(controller.state.isEditingConnection).to.be.false;
            expect(controller.state.editingConnectionDisplayName).to.be.undefined;
            expect(controller.state.savedConnections).to.have.lengthOf(1);
            expect(controller.state.savedConnections[0]).to.deep.include(testSavedConnection);

            expect(controller.state.recentConnections).to.have.lengthOf(1);
            expect(controller.state.recentConnections).to.deep.include(testMruConnection);
            expect(connectionStore.readAllConnections).to.have.been.calledWith(true, 5);
            expect(
                controller.state.readyToConnect,
                "Incomplete connection dialog should not be ready to connect",
            ).to.be.false;
        });

        test("should hide the recent profile name when the saved profile database differs", async () => {
            const sharedSavedConnection = {
                id: "shared-profile-id",
                profileName: "Shared Profile",
                profileSource: CredentialsQuickPickItemType.Profile,
                server: "SharedServer",
                database: "SavedDatabase",
                groupId: ConnectionConfig.ROOT_GROUP_ID,
            } as IConnectionProfileWithSource;
            const sharedRecentConnection = {
                id: "shared-profile-id",
                profileName: "Shared Profile",
                profileSource: CredentialsQuickPickItemType.Mru,
                server: "SharedServer",
                database: "RecentDatabase",
            } as IConnectionProfileWithSource;

            connectionStore.readAllConnections.resolves([
                sharedRecentConnection,
                sharedSavedConnection,
            ]);

            controller = new ConnectionDialogWebviewController(
                mockContext,
                mockVscodeWrapper,
                mainController,
                mockObjectExplorerProvider,
                undefined,
            );
            await controller.initialized;

            expect(controller.state.recentConnections).to.have.lengthOf(1);
            expect(controller.state.recentConnections[0].profileName).to.be.undefined;
            expect(controller.state.savedConnections[0].profileName).to.equal("Shared Profile");
        });

        test("should keep the recent profile name when one database is empty and the other is master", async () => {
            const sharedSavedConnection = {
                id: "shared-profile-id",
                profileName: "Shared Profile",
                profileSource: CredentialsQuickPickItemType.Profile,
                server: "SharedServer",
                database: "master",
                groupId: ConnectionConfig.ROOT_GROUP_ID,
            } as IConnectionProfileWithSource;
            const sharedRecentConnection = {
                id: "shared-profile-id",
                profileName: "Shared Profile",
                profileSource: CredentialsQuickPickItemType.Mru,
                server: "SharedServer",
                database: "",
            } as IConnectionProfileWithSource;

            connectionStore.readAllConnections.resolves([
                sharedRecentConnection,
                sharedSavedConnection,
            ]);

            controller = new ConnectionDialogWebviewController(
                mockContext,
                mockVscodeWrapper,
                mainController,
                mockObjectExplorerProvider,
                undefined,
            );
            await controller.initialized;

            expect(controller.state.recentConnections).to.have.lengthOf(1);
            expect(controller.state.recentConnections[0].profileName).to.equal("Shared Profile");
        });

        test("should keep the recent profile name when ids are missing and only the profile name matches", async () => {
            const sharedSavedConnection = {
                profileName: "Shared Profile",
                profileSource: CredentialsQuickPickItemType.Profile,
                server: "SavedServer",
                database: "SavedDatabase",
                authenticationType: AuthenticationType.AzureMFA,
                accountId: "saved-account-id",
                groupId: ConnectionConfig.ROOT_GROUP_ID,
            } as IConnectionProfileWithSource;
            const sharedRecentConnection = {
                profileName: "Shared Profile",
                profileSource: CredentialsQuickPickItemType.Mru,
                server: "RecentServer",
                database: "RecentDatabase",
                authenticationType: AuthenticationType.AzureMFA,
                accountId: "recent-account-id",
            } as IConnectionProfileWithSource;

            connectionStore.readAllConnections.resolves([
                sharedRecentConnection,
                sharedSavedConnection,
            ]);

            controller = new ConnectionDialogWebviewController(
                mockContext,
                mockVscodeWrapper,
                mainController,
                mockObjectExplorerProvider,
                undefined,
            );
            await controller.initialized;

            expect(controller.state.recentConnections).to.have.lengthOf(1);
            expect(controller.state.recentConnections[0].profileName).to.equal("Shared Profile");
        });

        test("should hide the recent profile name when ids are missing and the core identity matches", async () => {
            const sharedSavedConnection = {
                profileName: "Shared Profile",
                profileSource: CredentialsQuickPickItemType.Profile,
                server: "SharedServer",
                database: "SavedDatabase",
                authenticationType: AuthenticationType.AzureMFA,
                accountId: "user@example.com",
                groupId: ConnectionConfig.ROOT_GROUP_ID,
            } as IConnectionProfileWithSource;
            const sharedRecentConnection = {
                profileName: "Shared Profile",
                profileSource: CredentialsQuickPickItemType.Mru,
                server: "SharedServer",
                database: "RecentDatabase",
                authenticationType: AuthenticationType.AzureMFA,
                accountId: "user@example.com.tenant-id",
            } as IConnectionProfileWithSource;

            connectionStore.readAllConnections.resolves([
                sharedRecentConnection,
                sharedSavedConnection,
            ]);

            controller = new ConnectionDialogWebviewController(
                mockContext,
                mockVscodeWrapper,
                mainController,
                mockObjectExplorerProvider,
                undefined,
            );
            await controller.initialized;

            expect(controller.state.recentConnections).to.have.lengthOf(1);
            expect(controller.state.recentConnections[0].profileName).to.be.undefined;
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
            expect(controller.state.isEditingConnection).to.be.true;
            expect(controller.state.editingConnectionDisplayName).to.not.be.undefined;
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
            expect(controller.state.isEditingConnection).to.be.true;
            expect(controller.state.editingConnectionDisplayName).to.not.be.undefined;
        });

        test("should show optional user and hide password fields for ActiveDirectoryDefault", async () => {
            controller.state.connectionProfile.authenticationType =
                AuthenticationType.ActiveDirectoryDefault;

            await controller.updateItemVisibility();

            expect(controller.state.formComponents.user.hidden).to.not.be.true;
            expect(controller.state.formComponents.password.hidden).to.be.true;
            expect(controller.state.formComponents.savePassword.hidden).to.be.true;
            expect(controller.state.formComponents.accountId.hidden).to.be.true;
            expect(controller.state.formComponents.tenantId.hidden).to.be.true;
        });
    });

    suite("Reducers", () => {
        test("refreshConnectionsList reloads connections using the configured MRU limit", async () => {
            const refreshedMruConnection = {
                ...testMruConnection,
                server: "RefreshedMruServer",
            };
            const refreshedSavedConnection = {
                ...testSavedConnection,
                server: "RefreshedSavedServer",
            };

            connectionStore.readAllConnections.resetHistory();
            connectionStore.readAllConnections.resolves([
                refreshedMruConnection,
                refreshedSavedConnection,
            ]);

            await controller["_reducerHandlers"].get("refreshConnectionsList")(
                controller.state,
                {},
            );

            expect(connectionStore.readAllConnections).to.have.been.calledWith(true, 5);
            expect(controller.state.recentConnections).to.deep.include(refreshedMruConnection);
            expect(controller.state.savedConnections).to.deep.include(refreshedSavedConnection);
        });

        test("removeRecentConnection clears only the MRU entry and reloads with the configured limit", async () => {
            const sharedSavedConnection = {
                ...testSavedConnection,
                id: "shared-profile-id",
                server: "SharedServer",
                database: "SharedDatabase",
            };
            const sharedRecentConnection = {
                ...testMruConnection,
                id: "shared-profile-id",
                server: "SharedServer",
                database: "SharedDatabase",
            };
            let currentConnections = [sharedSavedConnection, sharedRecentConnection];

            connectionStore.readAllConnections.resetHistory();
            connectionStore.readAllConnections.callsFake(async () => currentConnections);
            connectionStore.removeRecentlyUsed.callsFake(async () => {
                currentConnections = [sharedSavedConnection];
            });

            await controller["_reducerHandlers"].get("removeRecentConnection")(controller.state, {
                connection: sharedRecentConnection,
            });

            expect(connectionStore.removeRecentlyUsed).to.have.been.calledWith(
                sharedRecentConnection,
            );
            expect(connectionStore.readAllConnections).to.have.been.calledWith(true, 5);
            expect(controller.state.savedConnections).to.deep.include(sharedSavedConnection);
            expect(controller.state.recentConnections).to.be.empty;
        });

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

        test("loadConnectionForEdit", async () => {
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

            await controller["_reducerHandlers"].get("loadConnectionForEdit")(controller.state, {
                connection: testConnection,
            });

            expect(
                controller["_connectionBeingEdited"],
                "connection being edited should have the same properties as the one passed to the reducer",
            ).to.deep.include(testConnection);
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
            expect(controller.state.isEditingConnection).to.be.true;
            expect(controller.state.editingConnectionDisplayName).to.not.be.undefined;
        });

        test("loadConnectionAsNewDraft", async () => {
            controller.state.formMessage = { message: "Sample error" };

            const testConnection = {
                id: "existing-profile-id",
                profileName: "Test Profile",
                server: "SavedServer",
                database: "SavedDatabase",
                authenticationType: AuthenticationType.Integrated,
                configSource: vscode.ConfigurationTarget.Workspace,
            } as IConnectionProfileWithSource;

            await controller["_reducerHandlers"].get("loadConnectionAsNewDraft")(controller.state, {
                connection: testConnection,
            });

            expect(
                controller["_connectionBeingEdited"],
                "new draft mode should not track a profile as being edited",
            ).to.be.undefined;
            expect(controller.state.connectionProfile.id).to.be.undefined;
            expect(controller.state.connectionProfile.profileName).to.be.undefined;
            expect(
                (controller.state.connectionProfile as IConnectionProfileWithSource).configSource,
            ).to.be.undefined;
            expect(controller.state.isEditingConnection).to.be.false;
            expect(controller.state.editingConnectionDisplayName).to.be.undefined;
            expect(controller.state.formMessage).to.be.undefined;
            expect(controller.state.readyToConnect).to.be.true;

            // Ensure source object wasn't mutated
            expect(testConnection.id).to.equal("existing-profile-id");
            expect(testConnection.profileName).to.equal("Test Profile");
            expect(testConnection.configSource).to.equal(vscode.ConfigurationTarget.Workspace);
        });

        test("loadConnection normalizes legacy Entra account ids when VS Code account mode is enabled", async () => {
            stubPreviewService(sandbox, { [PreviewFeature.UseVscodeAccountsForEntraMFA]: true });
            sandbox
                .stub(AzureHelpers.VsCodeAzureHelper, "getAccounts")
                .resolves([mockAccounts.signedInAccount]);
            sandbox
                .stub(AzureHelpers.VsCodeAzureHelper, "getTenantsForAccount")
                .resolves([mockTenants[0], mockTenants[1]]);

            // Pre-populate the Entra account and tenant caches
            await controller["loadVscodeEntraDataAsync"]();

            const testConnection = {
                profileName: "Test Entra Connection",
                server: "SavedServer",
                database: "SavedDatabase",
                authenticationType: AuthenticationType.AzureMFA,
                accountId: mockAccounts.signedInAccount.id.split(".")[0],
                tenantId: mockTenants[0].tenantId,
            } as IConnectionDialogProfile;

            await controller["_reducerHandlers"].get("loadConnectionForEdit")(controller.state, {
                connection: testConnection,
            });

            expect(controller.state.connectionProfile.accountId).to.equal(
                mockAccounts.signedInAccount.id,
            );
            expect(controller.state.connectionProfile.tenantId).to.equal(mockTenants[0].tenantId);
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

                expect(connectionManager.connect.calledOnce).to.be.true;
                expect(connectionStore.saveProfile.calledOnce).to.be.true;
                expect(mockObjectExplorerProvider.createSession.calledOnce).to.be.true;
            });

            test("testConnection only validates connectivity without saving or creating session", async () => {
                connectionManager.connect.resolves(true);
                controller.state.formState = testFormState;

                await controller["_reducerHandlers"].get("testConnection")(controller.state, {});

                expect(connectionManager.connect.calledOnce).to.be.true;
                expect(connectionStore.saveProfile.notCalled).to.be.true;
                expect(mockObjectExplorerProvider.createSession.notCalled).to.be.true;
                expect(controller.state.connectionStatus).to.equal(ApiStatus.Loaded);
                expect(controller.state.testConnectionSucceeded).to.be.true;
            });

            test("saveWithoutConnecting only saves connection profile", async () => {
                controller.state.formState = testFormState;

                await controller["_reducerHandlers"].get("saveWithoutConnecting")(
                    controller.state,
                    {},
                );

                expect(connectionManager.connect.notCalled).to.be.true;
                expect(connectionStore.saveProfile.calledOnce).to.be.true;
                expect(mockObjectExplorerProvider.createSession.notCalled).to.be.true;
                expect(controller.state.testConnectionSucceeded).to.be.false;
            });

            test("retryLastSubmitAction replays test connection action for trust cert flow", async () => {
                const trustCertErrorMessage = "Trust server certificate required";
                connectionManager.connect.onFirstCall().resolves(false);
                connectionManager.connect.onSecondCall().resolves(true);
                connectionManager.getConnectionInfo.returns({
                    errorNumber: 18456,
                    errorMessage: trustCertErrorMessage,
                    messages: trustCertErrorMessage,
                    credentials: {
                        server: mockServerName,
                        user: mockUserName,
                    },
                } as ConnectionInfo);

                sandbox
                    .stub(ConnectionManagerModule, "getSqlConnectionErrorType")
                    .resolves(SqlConnectionErrorType.TrustServerCertificateNotEnabled);

                controller.state.formState = testFormState;
                await controller["_reducerHandlers"].get("testConnection")(controller.state, {});

                expect(controller.state.dialog?.type).to.equal("trustServerCert");
                expect(connectionManager.connect.calledOnce).to.be.true;

                await controller["_reducerHandlers"].get("retryLastSubmitAction")(
                    controller.state,
                    {},
                );

                expect(connectionManager.connect.calledTwice).to.be.true;
                expect(connectionStore.saveProfile.notCalled).to.be.true;
                expect(mockObjectExplorerProvider.createSession.notCalled).to.be.true;
            });

            test("afterSetFormProperty clears test connection success indicator", async () => {
                controller.state.formState = testFormState;
                connectionManager.connect.resolves(true);

                await controller["_reducerHandlers"].get("testConnection")(controller.state, {});
                expect(controller.state.testConnectionSucceeded).to.be.true;

                await controller["_reducerHandlers"].get("formAction")(controller.state, {
                    event: {
                        propertyName: "server",
                        value: "localhost2",
                        isAction: false,
                    },
                });

                expect(controller.state.testConnectionSucceeded).to.be.false;
            });

            test("afterSetFormProperty keeps success indicator for profileName and groupId", async () => {
                controller.state.formState = testFormState;
                connectionManager.connect.resolves(true);

                await controller["_reducerHandlers"].get("testConnection")(controller.state, {});
                expect(controller.state.testConnectionSucceeded).to.be.true;

                await controller["_reducerHandlers"].get("formAction")(controller.state, {
                    event: {
                        propertyName: "profileName",
                        value: "My profile",
                        isAction: false,
                    },
                });
                expect(controller.state.testConnectionSucceeded).to.be.true;

                await controller["_reducerHandlers"].get("formAction")(controller.state, {
                    event: {
                        propertyName: "groupId",
                        value: ConnectionConfig.ROOT_GROUP_ID,
                        isAction: false,
                    },
                });
                expect(controller.state.testConnectionSucceeded).to.be.true;
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

                const loggerStub = createStubLogger(sandbox);
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

            test("should load connection details from connection string with ActiveDirectoryDefault", async () => {
                const parsedDetails = {
                    options: {
                        server: "myServer",
                        database: "myDB",
                        authenticationType: AuthenticationType.ActiveDirectoryDefault,
                    },
                } as ConnectionDetails;

                await runConnectionStringScenario(parsedDetails);

                expect(controller.state.connectionProfile.server).to.equal("myServer");
                expect(controller.state.connectionProfile.database).to.equal("myDB");
                expect(controller.state.connectionProfile.authenticationType).to.equal(
                    AuthenticationType.ActiveDirectoryDefault,
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

        azureAccountService.getAccountSecurityToken.resolves({
            token: "testToken",
            expiresOn: Date.now() / 1000,
        } as IToken);

        const isTokenValidStub = sandbox.stub(AzureController, "isTokenValid").returns(false);

        // When there's no error, we should have refreshToken button
        let buttons = await controller["getAzureActionButtons"]();
        expect(buttons.length).to.equal(2);
        expect(buttons[1].id).to.equal("refreshToken");

        // Test error handling when getAccountSecurityToken throws
        isTokenValidStub.restore();
        mockVscodeWrapper.showErrorMessage.resolves(undefined);
        azureAccountService.getAccountSecurityToken.throws(new Error("Test error"));

        buttons = await controller["getAzureActionButtons"]();
        expect(buttons.length).to.equal(2);
        expect(buttons[1].id).to.equal("refreshToken");
    });

    test("getAzureActionButtons shows error prompt with refreshTokenLabel when token validation fails", async () => {
        controller.state.connectionProfile.authenticationType = AuthenticationType.AzureMFA;
        controller.state.connectionProfile.accountId = "TestUserId";

        azureAccountService.getAccountSecurityToken.rejects(new Error("Token error"));
        mockVscodeWrapper.showErrorMessage.resolves(undefined);

        await controller["getAzureActionButtons"]();

        expect(mockVscodeWrapper.showErrorMessage).to.have.been.calledWith(
            sinon.match.string,
            refreshTokenLabel,
        );
    });

    test("getAzureActionButtons error prompt: selecting refresh triggers a refresh attempt", async () => {
        const clock = sinon.useFakeTimers();
        try {
            controller.state.connectionProfile.authenticationType = AuthenticationType.AzureMFA;
            controller.state.connectionProfile.accountId = "TestUserId";

            azureAccountService.getAccountSecurityToken.rejects(new Error("Token error"));
            mockVscodeWrapper.showErrorMessage.resolves(refreshTokenLabel);

            await controller["getAzureActionButtons"]();

            // Advance the stubbed clock so the fire-and-forget prompt to refresh and
            // the async refreshToken() function have a chance to run.
            await clock.tickAsync(0);

            // Called once for initial validation and once inside refreshToken()
            expect(azureAccountService.getAccountSecurityToken.callCount).to.equal(2);
        } finally {
            clock.restore();
        }
    });

    test("getAzureActionButtons error prompt: dismissing does not trigger a refresh attempt", async () => {
        const clock = sinon.useFakeTimers();
        try {
            controller.state.connectionProfile.authenticationType = AuthenticationType.AzureMFA;
            controller.state.connectionProfile.accountId = "TestUserId";

            azureAccountService.getAccountSecurityToken.rejects(new Error("Token error"));
            mockVscodeWrapper.showErrorMessage.resolves(undefined);

            await controller["getAzureActionButtons"]();

            await clock.tickAsync(0);

            // Only called once for validation; no refresh attempt was made
            expect(azureAccountService.getAccountSecurityToken.callCount).to.equal(1);
        } finally {
            clock.restore();
        }
    });

    suite("database loading", () => {
        const sqlLoginProfile: IConnectionDialogProfile = {
            server: "localhost",
            authenticationType: AuthenticationType.SqlLogin,
            user: "sa",
            password: "Password1!",
            groupId: ConnectionConfig.ROOT_GROUP_ID,
        } as IConnectionDialogProfile;

        setup(() => {
            connectionManager.connect.resolves(true);
            connectionManager.listDatabases.resolves(["master", "tempdb", "mydb"]);
            connectionManager.disconnect.resolves();
        });

        test("isConnectionReadyForDatabaseFetch", () => {
            const check = (profile: IConnectionDialogProfile) =>
                controller["isConnectionReadyForDatabaseFetch"](profile);

            // Missing server — always false
            expect(check({ ...sqlLoginProfile, server: "" })).to.be.false;

            // SqlLogin — requires user + password
            expect(check({ ...sqlLoginProfile, user: "" })).to.be.false;
            expect(check({ ...sqlLoginProfile, password: "" })).to.be.false;
            expect(check({ ...sqlLoginProfile })).to.be.true;

            // AzureMFA — requires accountId
            expect(
                check({
                    server: "localhost",
                    authenticationType: AuthenticationType.AzureMFA,
                } as IConnectionDialogProfile),
            ).to.be.false;
            expect(
                check({
                    server: "localhost",
                    authenticationType: AuthenticationType.AzureMFA,
                    accountId: "user@example.com",
                } as IConnectionDialogProfile),
            ).to.be.true;

            // Integrated and ActiveDirectoryDefault — server only
            expect(
                check({
                    server: "localhost",
                    authenticationType: AuthenticationType.Integrated,
                } as IConnectionDialogProfile),
            ).to.be.true;
            expect(
                check({
                    server: "localhost",
                    authenticationType: AuthenticationType.ActiveDirectoryDefault,
                } as IConnectionDialogProfile),
            ).to.be.true;
        });

        test("buildDatabaseFetchKey includes connection fields but excludes password", () => {
            const base = {
                server: "myServer",
                authenticationType: AuthenticationType.SqlLogin,
                user: "sa",
                accountId: "acc1",
                tenantId: "ten1",
            } as IConnectionDialogProfile;

            controller.state.connectionProfile = { ...base, password: "pw1" };
            const key1 = controller["buildDatabaseFetchKey"]();
            controller.state.connectionProfile = { ...base, password: "pw2" };
            const key2 = controller["buildDatabaseFetchKey"]();

            expect(key1)
                .to.include("myServer")
                .and.include("sa")
                .and.include("acc1")
                .and.include("ten1");
            expect(key1).to.not.include("pw1");
            expect(key1).to.equal(key2, "password changes should not bust the cache key");
        });

        suite("loadDatabaseList", () => {
            test("success: populates options and clears loadStatus", async () => {
                controller.state.connectionProfile = { ...sqlLoginProfile };
                await controller["loadDatabaseList"]();

                const dbComponent = controller.state.formComponents["database"];
                expect(dbComponent.options).to.have.lengthOf(3);
                // user DBs first, then system DBs, each group sorted alphabetically
                expect(dbComponent.options.map((o) => o.value)).to.deep.equal([
                    "mydb",
                    "master",
                    "tempdb",
                ]);
                expect(dbComponent.options.map((o) => o.groupName)).to.deep.equal([
                    Loc.userDatabasesGroup,
                    Loc.systemDatabasesGroup,
                    Loc.systemDatabasesGroup,
                ]);
                expect(dbComponent.loadStatus).to.be.undefined;
                expect(connectionManager.disconnect.calledOnce).to.be.true;
            });

            test("success: caches result so second call skips connect", async () => {
                controller.state.connectionProfile = { ...sqlLoginProfile };
                await controller["loadDatabaseList"]();
                expect(connectionManager.connect.calledOnce).to.be.true;

                await controller["loadDatabaseList"]();
                expect(
                    connectionManager.connect.calledOnce,
                    "second call should be served from cache without connecting",
                ).to.be.true;

                const dbComponent = controller.state.formComponents["database"];
                expect(dbComponent.options).to.have.lengthOf(3);
                expect(dbComponent.loadStatus).to.be.undefined;
            });

            test("failed connection: sets error loadStatus with connection error message", async () => {
                const errorMessage = "Login failed for user 'sa'";
                connectionManager.connect.resolves(false);
                connectionManager.getConnectionInfo.returns({
                    errorMessage,
                    errorNumber: 18456,
                    messages: errorMessage,
                    credentials: { server: "localhost", user: "sa" },
                } as ConnectionInfo);
                sandbox
                    .stub(ConnectionManagerModule, "getSqlConnectionErrorType")
                    .resolves(SqlConnectionErrorType.Generic);

                controller.state.connectionProfile = { ...sqlLoginProfile };
                await controller["loadDatabaseList"]();

                const dbComponent = controller.state.formComponents["database"];
                expect(dbComponent.loadStatus?.status).to.equal(ApiStatus.Error);
                expect(dbComponent.loadStatus?.message).to.equal(
                    Loc.unableToLoadDatabaseList(errorMessage),
                );
                expect(connectionManager.disconnect.calledOnce).to.be.true;
            });

            test("TrustServerCertificate error: message contains trust cert guidance", async () => {
                connectionManager.connect.resolves(false);
                connectionManager.getConnectionInfo.returns({
                    errorMessage: "connection failed",
                    errorNumber: 0,
                    messages: "",
                    credentials: { server: "localhost", user: "sa" },
                } as ConnectionInfo);
                sandbox
                    .stub(ConnectionManagerModule, "getSqlConnectionErrorType")
                    .resolves(SqlConnectionErrorType.TrustServerCertificateNotEnabled);

                controller.state.connectionProfile = { ...sqlLoginProfile };
                await controller["loadDatabaseList"]();

                const dbComponent = controller.state.formComponents["database"];
                expect(dbComponent.loadStatus?.status).to.equal(ApiStatus.Error);
                expect(dbComponent.loadStatus?.message).to.equal(
                    Loc.unableToLoadDatabaseList(
                        ConnectionLoc.trustServerCertificateMustBeEnabledMessage,
                    ),
                );
            });

            test("exception during fetch: sets error loadStatus", async () => {
                const errorMessage = "network timeout";
                connectionManager.connect.rejects(new Error(errorMessage));

                controller.state.connectionProfile = { ...sqlLoginProfile };
                await controller["loadDatabaseList"]();

                const dbComponent = controller.state.formComponents["database"];
                expect(dbComponent.loadStatus?.status).to.equal(ApiStatus.Error);
                expect(dbComponent.loadStatus?.message).to.include(errorMessage);
                expect(connectionManager.disconnect.calledOnce).to.be.true;
            });

            test("superseded request does not update state", async () => {
                let resolveConnect: (val: boolean) => void;
                connectionManager.connect.returns(
                    new Promise((res) => {
                        resolveConnect = res;
                    }),
                );

                controller.state.connectionProfile = { ...sqlLoginProfile };

                // Start first fetch (will hang on connect)
                const firstFetch = controller["loadDatabaseList"]();

                // Increment token to supersede it
                controller["_dbFetchCounter"]++;

                // Resolve the connect so the first fetch can continue to completion
                resolveConnect(true);
                await firstFetch;

                // State should not have been updated by the superseded first fetch
                const dbComponent = controller.state.formComponents["database"];
                expect(dbComponent.options).to.deep.equal(
                    [],
                    "superseded fetch should not populate options",
                );
            });
        });

        suite("afterSetFormProperty integration", () => {
            async function setFormProperty(
                propertyName: keyof IConnectionDialogProfile,
                value: string,
            ) {
                await controller["_reducerHandlers"].get("formAction")(controller.state, {
                    event: { propertyName, value, isAction: false },
                });
            }

            async function flushMicrotasks() {
                // Allow fire-and-forget loadDatabaseList to complete
                await new Promise<void>((resolve) => setImmediate(resolve));
            }

            test("triggers fetch when sufficient SqlLogin credentials are set", async () => {
                // Set up profile to be almost complete, then set the last field
                controller.state.connectionProfile = { ...sqlLoginProfile };

                await setFormProperty("server", "localhost");
                await flushMicrotasks();

                expect(
                    connectionManager.connect.calledOnce,
                    "should connect when all SqlLogin fields are present",
                ).to.be.true;
            });

            test("clears database options when auth info becomes insufficient", async () => {
                controller.state.connectionProfile = { ...sqlLoginProfile };

                // First load databases successfully
                await controller["loadDatabaseList"]();
                expect(controller.state.formComponents["database"].options).to.have.lengthOf(3);

                // Now remove the user, making info insufficient
                await setFormProperty("user", "");

                const dbComponent = controller.state.formComponents["database"];
                expect(dbComponent.options).to.deep.equal(
                    [],
                    "options should be cleared when auth is incomplete",
                );
                expect(dbComponent.loadStatus).to.be.undefined;
            });

            test("does not re-fetch when fetchKey is unchanged", async () => {
                controller.state.connectionProfile = { ...sqlLoginProfile };

                await controller["loadDatabaseList"]();
                expect(connectionManager.connect.calledOnce).to.be.true;

                // Trigger afterSetFormProperty with a non-cache-busting property (password doesn't change key)
                await setFormProperty("server", sqlLoginProfile.server);
                await flushMicrotasks();

                expect(
                    connectionManager.connect.calledOnce,
                    "should not re-fetch when fetchKey is unchanged",
                ).to.be.true;
            });
        });
    });

    test("getAzureActionButtons uses VS Code sign-in when VS Code account mode is enabled", async () => {
        stubPreviewService(sandbox, { [PreviewFeature.UseVscodeAccountsForEntraMFA]: true });

        sandbox
            .stub(AzureHelpers.VsCodeAzureHelper, "getAccounts")
            .resolves([mockAccounts.signedInAccount]);
        sandbox
            .stub(AzureHelpers.VsCodeAzureHelper, "getTenantsForAccount")
            .resolves([mockTenants[0], mockTenants[1]]);

        const signInStub = sandbox.stub().callsFake(() => {
            return true;
        });

        sandbox.stub(MssqlVSCodeAzureSubscriptionProvider, "getInstance").returns({
            signIn: signInStub,
        } as unknown as MssqlVSCodeAzureSubscriptionProvider);

        controller.state.connectionProfile.authenticationType = AuthenticationType.AzureMFA;
        controller.state.connectionProfile.accountId = mockAccounts.signedInAccount.id;

        const buttons = await controller["getAzureActionButtons"]();
        expect(buttons).to.have.lengthOf(1);
        expect(buttons[0].id).to.equal("azureSignIn");

        await buttons[0].callback();

        expect(signInStub).to.have.been.calledOnce;
    });
});
