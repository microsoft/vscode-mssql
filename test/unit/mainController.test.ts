/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as TypeMoq from "typemoq";
import * as vscode from "vscode";
import * as Extension from "../../src/extension";
import MainController from "../../src/controllers/mainController";
import ConnectionManager from "../../src/controllers/connectionManager";
import SqlDocumentService from "../../src/controllers/sqlDocumentService";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { TestExtensionContext } from "./stubs";
import { activateExtension } from "./utils";

suite("MainController Tests", function () {
    let mainController: MainController;
    let connectionManager: TypeMoq.IMock<ConnectionManager>;
    let untitledSqlDocumentService: TypeMoq.IMock<SqlDocumentService>;

    setup(async () => {
        // Need to activate the extension to get the mainController
        await activateExtension();

        // Using the mainController that was instantiated with the extension
        mainController = await Extension.getController();

        // Setting up a mocked connectionManager
        let mockContext: TypeMoq.IMock<vscode.ExtensionContext> =
            TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        connectionManager = TypeMoq.Mock.ofType(
            ConnectionManager,
            TypeMoq.MockBehavior.Loose,
            mockContext.object,
        );
        mainController.connectionManager = connectionManager.object;

        let mockVscodeWrapper: TypeMoq.IMock<VscodeWrapper> = TypeMoq.Mock.ofType(VscodeWrapper);
        untitledSqlDocumentService = TypeMoq.Mock.ofType(
            SqlDocumentService,
            TypeMoq.MockBehavior.Loose,
            mockVscodeWrapper.object,
            mainController,
        );
        mainController.sqlDocumentService = untitledSqlDocumentService.object;
    });

    test("validateTextDocumentHasFocus returns false if there is no active text document", () => {
        let vscodeWrapperMock: TypeMoq.IMock<VscodeWrapper> = TypeMoq.Mock.ofType(VscodeWrapper);
        vscodeWrapperMock.setup((x) => x.activeTextEditorUri).returns(() => undefined);
        let controller: MainController = new MainController(
            TestExtensionContext.object,
            undefined, // ConnectionManager
            vscodeWrapperMock.object,
        );

        let result = (controller as any).validateTextDocumentHasFocus();
        assert.equal(
            result,
            false,
            "Expected validateTextDocumentHasFocus to return false when the active document URI is undefined",
        );
        vscodeWrapperMock.verify((x) => x.activeTextEditorUri, TypeMoq.Times.once());
    });

    test("validateTextDocumentHasFocus returns true if there is an active text document", () => {
        let vscodeWrapperMock: TypeMoq.IMock<VscodeWrapper> = TypeMoq.Mock.ofType(VscodeWrapper);
        vscodeWrapperMock.setup((x) => x.activeTextEditorUri).returns(() => "test_uri");
        let controller: MainController = new MainController(
            TestExtensionContext.object,
            undefined, // ConnectionManager
            vscodeWrapperMock.object,
        );

        let result = (controller as any).validateTextDocumentHasFocus();
        assert.equal(
            result,
            true,
            "Expected validateTextDocumentHasFocus to return true when the active document URI is not undefined",
        );
    });

    test("onNewQuery should call the new query and new connection", async () => {
        let editor: vscode.TextEditor = {
            document: {
                uri: "test_uri",
            },
            viewColumn: vscode.ViewColumn.One,
            selection: undefined,
        } as any;
        untitledSqlDocumentService
            .setup((x) => x.newQuery(undefined, true))
            .returns(() => {
                return Promise.resolve(editor);
            });
        connectionManager
            .setup((x) => x.onNewConnection())
            .returns(() => {
                return Promise.resolve(undefined);
            });

        await mainController.onNewQuery(undefined, undefined);
        untitledSqlDocumentService.verify((x) => x.newQuery(undefined, true), TypeMoq.Times.once());
        connectionManager.verify((x) => x.onNewConnection(), TypeMoq.Times.atLeastOnce());
    });

    test("onNewQuery should not call the new connection if new query fails", async () => {
        // Ensure the command is allowed to run (otherwise early return and nothing is called)
        (mainController as any).canRunCommand = () => true;

        // Make newQuery reject
        untitledSqlDocumentService
            .setup((x) => x.newQuery(TypeMoq.It.isAny(), TypeMoq.It.isValue(true)))
            .returns(() => Promise.reject(new Error("boom")));

        connectionManager.setup((x) => x.onNewConnection()).returns(() => Promise.resolve() as any);

        // Act + assert reject
        await assert.rejects(() => mainController.onNewQuery(undefined, undefined), /boom/);

        // Verify exactly how prod calls it (2 args, second is true)
        untitledSqlDocumentService.verify(
            (x) => x.newQuery(TypeMoq.It.isAny(), TypeMoq.It.isValue(true)),
            TypeMoq.Times.once(),
        );

        // Should NOT try to create a new connection when newQuery failed
        connectionManager.verify((x) => x.onNewConnection(), TypeMoq.Times.never());
    });

    test("onManageProfiles should call the connection manager to manage profiles", async () => {
        let vscodeWrapperMock: TypeMoq.IMock<VscodeWrapper> = TypeMoq.Mock.ofType(VscodeWrapper);
        connectionManager.setup((c) => c.onManageProfiles());
        let controller: MainController = new MainController(
            TestExtensionContext.object,
            connectionManager.object,
            vscodeWrapperMock.object,
        );
        await controller.onManageProfiles();
        connectionManager.verify((c) => c.onManageProfiles(), TypeMoq.Times.once());
    });
});
