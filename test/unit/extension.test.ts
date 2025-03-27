/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from "typemoq";
import * as vscode from "vscode";
import { IConnectionInfo, IExtension, ITreeNodeInfo } from "vscode-mssql";
import MainController from "../../src/controllers/mainController";
import * as Extension from "../../src/extension";
import { activateExtension } from "./utils";
import { expect } from "chai";
import { ConnectionStore } from "../../src/models/connectionStore";
import {
    CredentialsQuickPickItemType,
    IConnectionCredentialsQuickPickItem,
} from "../../src/models/interfaces";
import { ConnectionUI } from "../../src/views/connectionUI";
import { Deferred } from "../../src/protocol";
import ConnectionManager from "../../src/controllers/connectionManager";
import { ObjectExplorerUtils } from "../../src/objectExplorer/objectExplorerUtils";

suite("Extension API Tests", () => {
    let vscodeMssql: IExtension;
    let mainController: MainController;
    let mockContext: TypeMoq.IMock<vscode.ExtensionContext>;
    let connectionManager: TypeMoq.IMock<ConnectionManager>;
    let connectionStore: TypeMoq.IMock<ConnectionStore>;
    let connectionUi: TypeMoq.IMock<ConnectionUI>;

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

        connectionManager
            .setup((cm) => cm.connectionStore)
            .returns(() => connectionStore.object);
        connectionManager
            .setup((cm) => cm.connectionUI)
            .returns(() => connectionUi.object);

        mainController.connectionManager = connectionManager.object;
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
            .setup((c) =>
                c.promptForConnection(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            )
            .returns(() => {
                return Promise.resolve(testConnInfo);
            });

        const result = await vscodeMssql.promptForConnection(
            true /* ignoreFocusOut */,
        );
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

        let originalMainController = Extension.controller;

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

            (Extension as any).controller = mockMainController.object;

            const returnedUri = await vscodeMssql.connect(
                testConnInfo,
                false /* saveConnection */,
            );

            expect(returnedUri).to.equal(passedUri);
        } finally {
            (Extension as any).controller = originalMainController;
        }
    });

    test("listDatabases", async () => {
        const testDatabaseList = ["AdventureWorks", "WideWorldImporters"];

        connectionManager
            .setup((c) => c.listDatabases(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(testDatabaseList));

        const result = await vscodeMssql.listDatabases("test-uri");

        connectionManager.verify(
            (c) => c.listDatabases("test-uri"),
            TypeMoq.Times.once(),
        );

        expect(result).to.deep.equal(testDatabaseList);
    });

    test("getDatabaseNameFromTreeNode", () => {
        // Mock the ITreeNodeInfo object
        const mockTreeNode: ITreeNodeInfo = {
            nodePath: "testNodePath",
            nodeType: "Database",
            label: "TestDatabase",
        } as any as ITreeNodeInfo;

        const mockObjectExplorerUtils =
            TypeMoq.Mock.ofType<typeof ObjectExplorerUtils>();
        mockObjectExplorerUtils
            .setup((o) => o.getDatabaseName(TypeMoq.It.isValue(mockTreeNode)))
            .returns(() => "MockDatabase");

        // Replace the actual ObjectExplorerUtils with the mock
        const originalGetDatabaseName = ObjectExplorerUtils.getDatabaseName;
        ObjectExplorerUtils.getDatabaseName =
            mockObjectExplorerUtils.object.getDatabaseName;

        try {
            const result =
                vscodeMssql.getDatabaseNameFromTreeNode(mockTreeNode);

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
                c.getConnectionString(
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny(),
                    TypeMoq.It.isAny(),
                ),
            )
            .returns(() => Promise.resolve(mockConnectionString));

        const result = await vscodeMssql.getConnectionString(
            "test-uri",
            true,
            false,
        );

        connectionManager.verify(
            (c) => c.getConnectionString("test-uri", true, false),
            TypeMoq.Times.once(),
        );

        expect(result).to.equal(mockConnectionString);
    });
});
