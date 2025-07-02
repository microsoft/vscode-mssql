/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from "typemoq";
import * as vscode from "vscode";
import { IConnectionInfo, IExtension, IServerInfo, ITreeNodeInfo } from "vscode-mssql";
import MainController from "../../src/extension/controllers/mainController";
import * as Extension from "../../src/extension/extension";
import { activateExtension } from "./utils";
import { expect } from "chai";
import { ConnectionStore } from "../../src/extension/models/connectionStore";
import {
    CredentialsQuickPickItemType,
    IConnectionCredentialsQuickPickItem,
} from "../../src/extension/models/interfaces";
import { ConnectionUI } from "../../src/extension/oldViews/connectionUI";
import { Deferred } from "../../src/extension/protocol";
import ConnectionManager from "../../src/extension/controllers/connectionManager";
import { ObjectExplorerUtils } from "../../src/extension/objectExplorer/objectExplorerUtils";
import { RequestType } from "vscode-languageclient";

suite("Extension API Tests", () => {
    let vscodeMssql: IExtension;
    let mainController: MainController;
    let mockContext: TypeMoq.IMock<vscode.ExtensionContext>;
    let connectionManager: TypeMoq.IMock<ConnectionManager>;
    let connectionStore: TypeMoq.IMock<ConnectionStore>;
    let connectionUi: TypeMoq.IMock<ConnectionUI>;
    let originalConnectionManager: ConnectionManager;

    setup(async () => {
        vscodeMssql = await activateExtension();
        mainController = await Extension.getController();

        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();

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

        connectionManager.setup((cm) => cm.connectionStore).returns(() => connectionStore.object);
        connectionManager.setup((cm) => cm.connectionUI).returns(() => connectionUi.object);

        // the Extension class doesn't reinitialize the controller for each test,
        // so we need to save the original properties we swap here and restore then after each test.
        originalConnectionManager = mainController.connectionManager;
        mainController.connectionManager = connectionManager.object;
    });

    teardown(() => {
        // restore mocked properties
        mainController.connectionManager = originalConnectionManager;
    });

    test("Gets sqlToolsServicePath", async () => {
        expect(vscodeMssql.sqlToolsServicePath).to.not.be.null;
    });

    test("promptForConnection", async () => {
        const testConnInfo: IConnectionInfo = {
            server: "testServer",
            database: "testDb",
        } as IConnectionInfo;

        const testQuickpickItem: IConnectionCredentialsQuickPickItem = {
            label: "test",
            connectionCreds: testConnInfo,
            quickPickItemType: CredentialsQuickPickItemType.Profile,
        } as IConnectionCredentialsQuickPickItem;

        connectionStore
            .setup((c) => c.getPickListItems())
            .returns(() => {
                return Promise.resolve([testQuickpickItem]);
            });

        connectionUi
            .setup((c) => c.promptForConnection(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => {
                return Promise.resolve(testConnInfo);
            });

        const result = await vscodeMssql.promptForConnection(true /* ignoreFocusOut */);
        expect(result.server).to.equal(testConnInfo.server);
        connectionUi.verify(
            (c) => c.promptForConnection([testQuickpickItem], true),
            TypeMoq.Times.once(),
        );
    });

    test("connect", async () => {
        const testConnInfo: IConnectionInfo = {
            server: "testServer",
            database: "testDb",
        } as IConnectionInfo;

        const mockMainController = TypeMoq.Mock.ofType(
            MainController,
            TypeMoq.MockBehavior.Loose,
            mockContext.object,
        );

        // the Extension class doesn't reinitialize the controller for each test,
        // so we need to save the original controller here and restore it after the test.
        const originalMainController = Extension.controller;

        try {
            let passedUri: string;

            mockMainController
                .setup((m) =>
                    m.connect(
                        TypeMoq.It.isAny(),
                        TypeMoq.It.isAny(),
                        TypeMoq.It.isAny(),
                        TypeMoq.It.isAny(),
                    ),
                )
                .returns(
                    (
                        uri: string,
                        connectionInfo: IConnectionInfo,
                        connectionPromise: Deferred<boolean>,
                        _saveConnection?: boolean,
                    ) => {
                        passedUri = uri;
                        connectionPromise.resolve(true);
                        return Promise.resolve(true);
                    },
                );

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (Extension as any).controller = mockMainController.object;

            const returnedUri = await vscodeMssql.connect(testConnInfo, false /* saveConnection */);

            expect(returnedUri).to.equal(passedUri);
        } finally {
            // restore the Extension's original MainController for other tests
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (Extension as any).controller = originalMainController;
        }
    });

    test("listDatabases", async () => {
        const testDatabaseList = ["AdventureWorks", "WideWorldImporters"];

        connectionManager
            .setup((c) => c.listDatabases(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(testDatabaseList));

        const result = await vscodeMssql.listDatabases("test-uri");

        connectionManager.verify((c) => c.listDatabases("test-uri"), TypeMoq.Times.once());

        expect(result).to.deep.equal(testDatabaseList);
    });

    test("getDatabaseNameFromTreeNode", () => {
        // Mock the ITreeNodeInfo object
        const mockTreeNode: ITreeNodeInfo = {
            nodeType: "Database",
            label: "TestDatabase",
        } as ITreeNodeInfo;

        const mockObjectExplorerUtils = TypeMoq.Mock.ofType<typeof ObjectExplorerUtils>();
        mockObjectExplorerUtils
            .setup((o) => o.getDatabaseName(TypeMoq.It.isValue(mockTreeNode)))
            .returns(() => "MockDatabase");

        // Replace the actual ObjectExplorerUtils with the mock
        const originalGetDatabaseName = ObjectExplorerUtils.getDatabaseName;
        ObjectExplorerUtils.getDatabaseName = mockObjectExplorerUtils.object.getDatabaseName;

        try {
            const result = vscodeMssql.getDatabaseNameFromTreeNode(mockTreeNode);

            expect(result).to.equal("MockDatabase");
        } finally {
            // Restore the original function
            ObjectExplorerUtils.getDatabaseName = originalGetDatabaseName;
        }
    });

    test("getConnectionString", async () => {
        const mockConnectionString = "testConnectionString";

        connectionManager
            .setup((c) =>
                c.getConnectionString(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            )
            .returns(() => Promise.resolve(mockConnectionString));

        const result = await vscodeMssql.getConnectionString("test-uri", true, false);

        connectionManager.verify(
            (c) => c.getConnectionString("test-uri", true, false),
            TypeMoq.Times.once(),
        );

        expect(result).to.equal(mockConnectionString);
    });

    test("createConnectionDetails", async () => {
        const testConnInfo: IConnectionInfo = {
            server: "testServer",
            database: "testDb",
        } as IConnectionInfo;

        connectionManager
            .setup((c) => c.createConnectionDetails(TypeMoq.It.isAny()))
            .returns(() => ({
                options: {
                    server: "testServer",
                    database: "testDb",
                },
            }));

        const result = vscodeMssql.createConnectionDetails(testConnInfo);

        connectionManager.verify(
            (c) => c.createConnectionDetails(testConnInfo),
            TypeMoq.Times.once(),
        );

        expect(result.options.server).to.equal("testServer");
        expect(result.options.database).to.equal("testDb");
    });

    test("sendRequest", async () => {
        type TestParams = { testParam: string };
        type TestResponse = { success: boolean };
        const mockRequestType = {} as RequestType<TestParams, TestResponse, void, void>;
        const mockParams: TestParams = { testParam: "testValue" };
        const mockResponse: TestResponse = { success: true };

        connectionManager
            .setup((c) => c.sendRequest(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(mockResponse));

        const result = await vscodeMssql.sendRequest(mockRequestType, mockParams);

        connectionManager.verify(
            (c) => c.sendRequest(mockRequestType, mockParams),
            TypeMoq.Times.once(),
        );

        expect(result).to.deep.equal(mockResponse);
    });

    test("getServerInfo", () => {
        const testConnInfo = {
            server: "testServer",
            database: "testDb",
        } as IConnectionInfo;

        const mockServerInfo = {
            serverVersion: "170",
            serverEdition: "Test Edition",
        } as IServerInfo;

        connectionManager
            .setup((c) => c.getServerInfo(TypeMoq.It.isAny()))
            .returns(() => mockServerInfo);

        const result = vscodeMssql.getServerInfo(testConnInfo);

        connectionManager.verify((c) => c.getServerInfo(testConnInfo), TypeMoq.Times.once());

        expect(result.serverVersion).to.equal(mockServerInfo.serverVersion);
        expect(result.serverEdition).to.equal(mockServerInfo.serverEdition);
    });
});
