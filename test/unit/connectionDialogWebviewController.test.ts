/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as TypeMoq from "typemoq";
import * as vscode from "vscode";
import { ConnectionDialogWebviewController } from "../../src/connectionconfig/connectionDialogWebviewController";
import MainController from "../../src/controllers/mainController";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { ObjectExplorerProvider } from "../../src/objectExplorer/objectExplorerProvider";
import { expect } from "chai";
import {
    ConnectionDialogWebviewState,
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
import { CapabilitiesResult, GetCapabilitiesRequest } from "../../src/models/contracts/connection";

suite("ConnectionDialogWebviewController Tests", () => {
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

    setup(async () => {
        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        mockVscodeWrapper = TypeMoq.Mock.ofType<VscodeWrapper>();
        // mockMainController = TypeMoq.Mock.ofType<MainController>();
        mockObjectExplorerProvider = TypeMoq.Mock.ofType<ObjectExplorerProvider>();

        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        mockContext.setup((c) => c.extensionUri).returns(() => vscode.Uri.parse("file://fakePath"));
        mockContext.setup((c) => c.extensionPath).returns(() => "fakePath");

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
            .returns(() =>
                Promise.resolve([
                    {
                        profileSource: CredentialsQuickPickItemType.Mru,
                    } as IConnectionProfileWithSource,
                ]),
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

        mainController.azureAccountService = azureAccountService.object;

        controller = new ConnectionDialogWebviewController(
            mockContext.object,
            mockVscodeWrapper.object,
            mainController,
            mockObjectExplorerProvider.object,
            undefined /* connection to edit */,
        );

        await controller.initialized;
    });

    test("should initialize correctly", async () => {
        const expectedInitialState: ConnectionDialogWebviewState = {
            selectedInputMode: ConnectionInputMode.Parameters,
            connectionProfile: undefined,
            formState: {} as IConnectionDialogProfile,
            formComponents: {},
            connectionComponents: {
                mainOptions: [],
                topAdvancedOptions: [],
                groupedAdvancedOptions: [],
            },
            azureSubscriptions: [],
            azureServers: [],
            savedConnections: [],
            recentConnections: [],
            connectionStatus: ApiStatus.NotStarted,
            formError: "",
            loadingAzureSubscriptionsStatus: ApiStatus.NotStarted,
            loadingAzureServersStatus: ApiStatus.NotStarted,
            dialog: undefined,
        };

        expect(controller.state).to.deep.equal(expectedInitialState);
    });

    test("should handle setConnectionInputType reducer", async () => {
        const state = { selectedInputMode: undefined };
        const payload = { inputMode: "Parameters" };

        const newState = await controller["registerRpcHandlers"]()["setConnectionInputType"](
            state,
            payload,
        );

        assert.strictEqual(newState.selectedInputMode, "Parameters");
    });

    test("should clean connection profile correctly", () => {
        const connectionProfile = {
            server: "testServer",
            user: "testUser",
            password: "testPassword",
            connectionString: "testConnectionString",
        } as IConnectionDialogProfile;

        const cleanedProfile = controller["cleanConnection"](connectionProfile);

        assert.strictEqual(cleanedProfile.connectionString, undefined);
        assert.strictEqual(cleanedProfile.server, "testServer");
    });
});
