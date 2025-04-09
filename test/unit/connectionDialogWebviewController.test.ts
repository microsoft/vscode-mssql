/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from "typemoq";
import * as vscode from "vscode";
import * as sinon from "sinon";
import { ConnectionDialogWebviewController } from "../../src/connectionconfig/connectionDialogWebviewController";
import MainController from "../../src/controllers/mainController";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { ObjectExplorerProvider } from "../../src/objectExplorer/objectExplorerProvider";
import { expect } from "chai";
import {
    AuthenticationType,
    AzureSqlServerInfo,
    ConnectionInputMode,
    IConnectionDialogProfile,
} from "../../src/sharedInterfaces/connectionDialog";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import ConnectionManager from "../../src/controllers/connectionManager";
import { ConnectionStore } from "../../src/models/connectionStore";
import { ConnectionUI } from "../../src/views/connectionUI";
import {
    CredentialsQuickPickItemType,
    IConnectionProfileWithSource,
} from "../../src/models/interfaces";
import { AzureAccountService } from "../../src/services/azureAccountService";
import { IAccount, ServiceOption } from "vscode-mssql";
import SqlToolsServerClient from "../../src/languageservice/serviceclient";
import {
    CapabilitiesResult,
    ConnectionCompleteParams,
    GetCapabilitiesRequest,
} from "../../src/models/contracts/connection";
import * as AzureHelpers from "../../src/connectionconfig/azureHelpers";
import {
    AzureSubscription,
    VSCodeAzureSubscriptionProvider,
} from "@microsoft/vscode-azext-azureauth";
import { stubTelemetry } from "./utils";
import { TreeNodeInfo } from "../../src/objectExplorer/treeNodeInfo";
import { Deferred } from "../../src/protocol";

suite("ConnectionDialogWebviewController Tests", () => {
    let sandbox: sinon.SinonSandbox;

    let mockContext: TypeMoq.IMock<vscode.ExtensionContext>;
    let mockVscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    let mainController: MainController;
    let connectionManager: TypeMoq.IMock<ConnectionManager>;
    let connectionStore: TypeMoq.IMock<ConnectionStore>;
    let connectionUi: TypeMoq.IMock<ConnectionUI>;
    let mockObjectExplorerProvider: TypeMoq.IMock<ObjectExplorerProvider>;
    let controller: ConnectionDialogWebviewController;
    let azureAccountService: TypeMoq.IMock<AzureAccountService>;
    let serviceClientMock: TypeMoq.IMock<SqlToolsServerClient>;

    const testMruConnection = {
        profileSource: CredentialsQuickPickItemType.Mru,
        server: "MruServer",
        database: "MruDatabase",
    } as IConnectionProfileWithSource;

    const testSavedConnection = {
        profileSource: CredentialsQuickPickItemType.Profile,
        server: "SavedServer",
        database: "SavedDatabase",
    } as IConnectionProfileWithSource;

    setup(async () => {
        sandbox = sinon.createSandbox();

        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        mockVscodeWrapper = TypeMoq.Mock.ofType<VscodeWrapper>();
        mockObjectExplorerProvider = TypeMoq.Mock.ofType<ObjectExplorerProvider>();

        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        mockContext.setup((c) => c.extensionUri).returns(() => vscode.Uri.parse("file://fakePath"));
        mockContext.setup((c) => c.extensionPath).returns(() => "fakePath");
        mockContext.setup((c) => c.subscriptions).returns(() => []);

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

        serviceClientMock
            .setup((s) =>
                s.sendRequest(TypeMoq.It.isValue(GetCapabilitiesRequest.type), TypeMoq.It.isAny()),
            )
            .returns(() =>
                Promise.resolve({
                    capabilities: {
                        connectionProvider: {
                            groupDisplayNames: {
                                group1: "Group 1",
                                group2: "Group 2",
                            },
                            options: [
                                {
                                    name: "server",
                                    displayName: "Server",
                                    isRequired: true,
                                    valueType: "string",
                                },
                                {
                                    name: "user",
                                    displayName: "User",
                                    isRequired: false,
                                    valueType: "string",
                                },
                                {
                                    name: "password",
                                    displayName: "Password",
                                    isRequired: false,
                                    valueType: "password",
                                },
                                {
                                    name: "trustServerCertificate",
                                    displayName: "Trust Server Certificate",
                                    isRequired: false,
                                    valueType: "boolean",
                                },
                                {
                                    name: "authenticationType",
                                    displayName: "Authentication Type",
                                    isRequired: false,
                                    valueType: "category",
                                    categoryValues: [
                                        AuthenticationType.SqlLogin,
                                        AuthenticationType.Integrated,
                                        AuthenticationType.AzureMFA,
                                    ],
                                },
                                {
                                    name: "savePassword",
                                    displayName: "Save Password",
                                    isRequired: false,
                                    valueType: "boolean",
                                },
                                {
                                    name: "accountId",
                                    displayName: "Account Id",
                                    isRequired: false,
                                    valueType: "string",
                                },
                                {
                                    name: "tenantId",
                                    displayName: "Tenant Id",
                                    isRequired: false,
                                    valueType: "string",
                                },
                                {
                                    name: "database",
                                    displayName: "Database",
                                    isRequired: false,
                                    valueType: "string",
                                },
                                {
                                    name: "encrypt",
                                    displayName: "Encrypt",
                                    isRequired: false,
                                    valueType: "boolean",
                                },
                            ] as ServiceOption[],
                        },
                    },
                } as unknown as CapabilitiesResult),
            );

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

    test("should initialize correctly", async () => {
        const expectedInitialFormState = {
            authenticationType: "SqlLogin",
            connectTimeout: 30,
            applicationName: "vscode-mssql",
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

        expect(controller.state.connectionComponents.topAdvancedOptions).to.deep.equal([
            "port",
            "applicationName",
            "connectTimeout",
            "multiSubnetFailover",
        ]);

        expect(controller.state.selectedInputMode).to.equal(ConnectionInputMode.Parameters);
        expect(controller.state.savedConnections).to.have.lengthOf(1);
        expect(controller.state.savedConnections[0]).to.deep.include(testSavedConnection);

        expect(controller.state.recentConnections).to.have.lengthOf(1);
        expect(controller.state.recentConnections).to.deep.include(testMruConnection);
    });

    suite("Reducers", () => {
        suite("setConnectionInputType", () => {
            test("Should set connection input type correctly for Parameters and ConnectionString", async () => {
                expect(controller.state.selectedInputMode).to.equal(ConnectionInputMode.Parameters);

                await controller["_reducers"].setConnectionInputType(controller.state, {
                    inputMode: ConnectionInputMode.ConnectionString,
                });

                expect(controller.state.selectedInputMode).to.equal(
                    ConnectionInputMode.ConnectionString,
                    "Should set connection input type to ConnectionString",
                );

                await controller["_reducers"].setConnectionInputType(controller.state, {
                    inputMode: ConnectionInputMode.Parameters,
                });

                expect(controller.state.selectedInputMode).to.equal(
                    ConnectionInputMode.Parameters,
                    "Should set connection input type to Parameters",
                );
            });

            test("should set connection input mode correctly and load server info for AzureBrowse", async () => {
                const { sendErrorEvent } = stubTelemetry(sandbox);

                const mockSubscriptions = [
                    {
                        name: "Ten0Sub1",
                        subscriptionId: "00000000-0000-0000-0000-111111111111",
                        tenantId: "00000000-0000-0000-0000-000000000000",
                    },
                    {
                        name: "Ten1Sub1",
                        subscriptionId: "11111111-0000-0000-0000-111111111111",
                        tenantId: "11111111-1111-1111-1111-111111111111",
                    },
                ];

                sandbox.stub(AzureHelpers, "confirmVscodeAzureSignin").resolves({
                    getSubscriptions: () => Promise.resolve(mockSubscriptions),
                } as unknown as VSCodeAzureSubscriptionProvider);

                sandbox
                    .stub(AzureHelpers, "fetchServersFromAzure")
                    .callsFake(async (sub: AzureSubscription) => {
                        return [
                            {
                                location: "TestRegion",
                                resourceGroup: `testResourceGroup-${sub.name}`,
                                server: `testServer-${sub.name}-1`,
                                databases: ["testDatabase1", "testDatabase2"],
                                subscription: `${sub.name} (${sub.subscriptionId})`,
                            },
                            {
                                location: "TestRegion",
                                resourceGroup: `testResourceGroup-${sub.name}`,
                                server: `testServer-${sub.name}-2`,
                                databases: ["testDatabase1", "testDatabase2"],
                                subscription: `${sub.name} (${sub.subscriptionId})`,
                            },
                        ] as AzureSqlServerInfo[];
                    });

                await controller["_reducers"].setConnectionInputType(controller.state, {
                    inputMode: ConnectionInputMode.AzureBrowse,
                });

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
    });

    test("loadConnection", async () => {
        controller.state.formError = "Sample error";

        expect(
            controller["_connectionBeingEdited"],
            "should not be a connection being edited at first",
        ).to.be.undefined;

        const testConnection = {
            profileName: "Test Server to Edit",
            server: "SavedServer",
            database: "SavedDatabase",
            authenticationType: AuthenticationType.SqlLogin,
        } as IConnectionDialogProfile;

        await controller["_reducers"].loadConnection(controller.state, {
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
    });

    suite("connect", () => {
        test("connect happy path", async () => {
            // Set up mocks
            const { sendErrorEvent } = stubTelemetry(sandbox);

            mockObjectExplorerProvider
                .setup((oep) =>
                    oep.createSession(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                )
                .returns((createSessionPromise: Deferred<TreeNodeInfo>) => {
                    createSessionPromise.resolve(
                        new TreeNodeInfo(
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
                        ),
                    );
                    return Promise.resolve("testSessionId");
                });

            connectionManager
                .setup((cm) => cm.connectDialog(TypeMoq.It.isAny()))
                .returns(() => Promise.resolve({} as ConnectionCompleteParams));

            let mockObjectExplorerTree = TypeMoq.Mock.ofType<vscode.TreeView<TreeNodeInfo>>(
                undefined,
                TypeMoq.MockBehavior.Loose,
            );

            mockObjectExplorerTree
                .setup((oep) => oep.reveal(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
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

            await controller["_reducers"].connect(controller.state, {});

            expect(sendErrorEvent.notCalled, "sendErrorEvent should not be called").to.be.true;
        });
    });
});
