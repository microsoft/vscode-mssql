/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from "typemoq";
import * as vscode from "vscode";
import * as sinon from "sinon";
import { ConnectionDialogWebviewController } from "../../src/extension/connectionconfig/connectionDialogWebviewController";
import MainController from "../../src/extension/controllers/mainController";
import VscodeWrapper from "../../src/extension/controllers/vscodeWrapper";
import { ObjectExplorerProvider } from "../../src/extension/objectExplorer/objectExplorerProvider";
import { expect } from "chai";
import {
    AuthenticationType,
    AzureSqlServerInfo,
    ConnectionInputMode,
    IConnectionDialogProfile,
} from "../../src/shared/connectionDialog";
import { ApiStatus } from "../../src/shared/webview";
import ConnectionManager from "../../src/extension/controllers/connectionManager";
import { ConnectionStore } from "../../src/extension/models/connectionStore";
import { ConnectionUI } from "../../src/oldViews/connectionUI";
import {
    CredentialsQuickPickItemType,
    IConnectionProfileWithSource,
} from "../../src/extension/models/interfaces";
import { AzureAccountService } from "../../src/extension/services/azureAccountService";
import { IAccount } from "vscode-mssql";
import SqlToolsServerClient from "../../src/extension/languageservice/serviceclient";
import { ConnectionCompleteParams } from "../../src/extension/models/contracts/connection";
import { stubTelemetry } from "./utils";
import {
    stubConfirmVscodeAzureSignin,
    stubFetchServersFromAzure,
    stubPromptForAzureSubscriptionFilter,
} from "./azureHelperStubs";
import { CreateSessionResponse } from "../../src/extension/models/contracts/objectExplorer/createSessionRequest";
import { TreeNodeInfo } from "../../src/extension/objectExplorer/nodes/treeNodeInfo";
import { mockGetCapabilitiesRequest } from "./mocks";
import { AzureController } from "../../src/extension/azure/azureController";
import { ConnectionConfig } from "../../src/extension/connectionconfig/connectionconfig";

suite("ConnectionDialogWebviewController Tests", () => {
    let sandbox: sinon.SinonSandbox;

    let controller: ConnectionDialogWebviewController;
    let mockContext: TypeMoq.IMock<vscode.ExtensionContext>;
    let mockVscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    let outputChannel: TypeMoq.IMock<vscode.OutputChannel>;
    let mainController: MainController;
    let connectionManager: TypeMoq.IMock<ConnectionManager>;
    let connectionStore: TypeMoq.IMock<ConnectionStore>;
    let connectionUi: TypeMoq.IMock<ConnectionUI>;
    let mockObjectExplorerProvider: TypeMoq.IMock<ObjectExplorerProvider>;
    let azureAccountService: TypeMoq.IMock<AzureAccountService>;
    let serviceClientMock: TypeMoq.IMock<SqlToolsServerClient>;

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

        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        mockVscodeWrapper = TypeMoq.Mock.ofType<VscodeWrapper>();
        mockObjectExplorerProvider = TypeMoq.Mock.ofType<ObjectExplorerProvider>();

        outputChannel = TypeMoq.Mock.ofType<vscode.OutputChannel>();
        outputChannel.setup((c) => c.clear());
        outputChannel.setup((c) => c.append(TypeMoq.It.isAny()));
        outputChannel.setup((c) => c.show(TypeMoq.It.isAny()));

        mockVscodeWrapper.setup((v) => v.outputChannel).returns(() => outputChannel.object);

        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        mockContext.setup((c) => c.extensionUri).returns(() => vscode.Uri.parse("file://fakePath"));
        mockContext.setup((c) => c.extensionPath).returns(() => "fakePath");
        mockContext.setup((c) => c.subscriptions).returns(() => []);
        mockContext
            .setup((c) => c.globalState)
            .returns(() => {
                return {
                    get: (key: string, defaultValue: any) => defaultValue,
                } as any;
            });

        connectionManager = TypeMoq.Mock.ofType(
            ConnectionManager,
            TypeMoq.MockBehavior.Loose,
            mockContext.object,
        );

        connectionStore = TypeMoq.Mock.ofType(
            ConnectionStore,
            TypeMoq.MockBehavior.Loose,
            mockContext.object,
        );

        connectionUi = TypeMoq.Mock.ofType(
            ConnectionUI,
            TypeMoq.MockBehavior.Loose,
            connectionManager.object,
            mockContext.object,
        );

        azureAccountService = TypeMoq.Mock.ofType(AzureAccountService, TypeMoq.MockBehavior.Loose);

        serviceClientMock = TypeMoq.Mock.ofType(SqlToolsServerClient, TypeMoq.MockBehavior.Loose);

        connectionManager.setup((cm) => cm.connectionStore).returns(() => connectionStore.object);
        connectionManager.setup((cm) => cm.connectionUI).returns(() => connectionUi.object);
        connectionManager.setup((cm) => cm.client).returns(() => serviceClientMock.object);

        connectionStore
            .setup((cs) => cs.readAllConnections(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve([testMruConnection, testSavedConnection]));

        connectionStore
            .setup((cs) => cs.readAllConnectionGroups())
            .returns(() =>
                Promise.resolve([{ id: TEST_ROOT_GROUP_ID, name: ConnectionConfig.RootGroupName }]),
            );

        azureAccountService
            .setup((a) => a.getAccounts())
            .returns(() =>
                Promise.resolve([
                    {
                        displayInfo: {
                            displayName: "Test Display Name",
                            userId: "TestUserId",
                        },
                    } as IAccount,
                ]),
            );

        mockGetCapabilitiesRequest(serviceClientMock);

        mainController = new MainController(
            mockContext.object,
            connectionManager.object,
            mockVscodeWrapper.object,
        );

        sandbox.stub(vscode.commands, "registerCommand");
        sandbox.stub(vscode.window, "registerWebviewViewProvider");

        mainController.azureAccountService = azureAccountService.object;
        (mainController as any).initializeObjectExplorer(mockObjectExplorerProvider.object);

        controller = new ConnectionDialogWebviewController(
            mockContext.object,
            mockVscodeWrapper.object,
            mainController,
            mockObjectExplorerProvider.object,
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
                applicationName: "vscode-mssql",
                applicationIntent: "ReadWrite",
            };

            expect(controller.state.formState).to.deep.equal(
                expectedInitialFormState,
                "Initial form state is incorrect",
            );

            expect(controller.state.formError).to.deep.equal(
                "",
                "Should be no error in the initial state",
            );

            expect(controller.state.connectionStatus).to.equal(
                ApiStatus.NotStarted,
                "Connection status should be NotStarted",
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
                mockContext.object,
                mockVscodeWrapper.object,
                mainController,
                mockObjectExplorerProvider.object,
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
                mockContext.object,
                mockVscodeWrapper.object,
                mainController,
                mockObjectExplorerProvider.object,
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

                stubConfirmVscodeAzureSignin(sandbox);
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
            controller.state.formError = "Sample error";

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
                controller.state.formError,
                "Error should be cleared after loading the connection",
            ).to.equal("");

            expect(
                controller.state.readyToConnect,
                "should be ready to connect after profile has been loaded",
            ).to.be.true;
        });

        suite("connect", () => {
            test("connect happy path", async () => {
                // Set up mocks
                const { sendErrorEvent } = stubTelemetry(sandbox);

                mockObjectExplorerProvider
                    .setup((oep) => oep.createSession(TypeMoq.It.isAny()))
                    .returns(() => {
                        return Promise.resolve({
                            sessionId: "testSessionId",
                            rootNode: new TreeNodeInfo(
                                "testNode",
                                undefined,
                                undefined,
                                undefined,
                                undefined,
                                undefined,
                                undefined,
                                undefined,
                                undefined,
                                undefined,
                                undefined,
                            ),
                            success: true,
                        } as CreateSessionResponse);
                    });

                connectionManager
                    .setup((cm) => cm.connectDialog(TypeMoq.It.isAny()))
                    .returns(() => Promise.resolve({} as ConnectionCompleteParams));

                let mockObjectExplorerTree = TypeMoq.Mock.ofType<vscode.TreeView<TreeNodeInfo>>(
                    undefined,
                    TypeMoq.MockBehavior.Loose,
                );

                mockObjectExplorerTree
                    .setup((oet) => oet.reveal(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
                    .returns(() => {
                        return Promise.resolve();
                    });

                mainController.objectExplorerTree = mockObjectExplorerTree.object;

                // Run test

                controller.state.formState = {
                    server: "localhost",
                    user: "testUser",
                    password: "testPassword",
                    authenticationType: AuthenticationType.SqlLogin,
                } as IConnectionDialogProfile;

                await controller["_reducerHandlers"].get("connect")(controller.state, {});

                expect(sendErrorEvent.notCalled, "sendErrorEvent should not be called").to.be.true;
                expect(
                    controller.isDisposed,
                    "controller should be disposed after a successful connection",
                ).to.be.true;

                // ObjectExplorerTree should have revealed to the new node
                mockObjectExplorerTree.verify(
                    (oet) => oet.reveal(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                    TypeMoq.Times.once(),
                );

                // ConnectionStore should have saved the profile
                connectionStore.verify(
                    (cs) => cs.saveProfile(TypeMoq.It.isAny()),
                    TypeMoq.Times.once(),
                );
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
                stubConfirmVscodeAzureSignin(sandbox);
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
        sandbox
            .stub(mainController.azureAccountService, "getAccountSecurityToken")
            .throws(new Error("Test error"));

        buttons = await controller["getAzureActionButtons"]();
        expect(buttons.length).to.equal(2);
        expect(buttons[1].id).to.equal("refreshToken");
    });
});
