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
import { SchemaCompareEndpointInfo } from "vscode-mssql";
import * as Constants from "../../src/constants/constants";

suite("MainController Tests", function () {
    let mainController: MainController;
    let connectionManager: TypeMoq.IMock<ConnectionManager>;
    let mockSqlDocumentService: TypeMoq.IMock<SqlDocumentService>;

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
        mockSqlDocumentService = TypeMoq.Mock.ofType(
            SqlDocumentService,
            TypeMoq.MockBehavior.Loose,
            mockVscodeWrapper.object,
            mainController,
        );
        mainController.sqlDocumentService = mockSqlDocumentService.object;
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

    test("onNewQuery should call the new query", async () => {
        let editor: vscode.TextEditor = {
            document: {
                uri: "test_uri",
            },
            viewColumn: vscode.ViewColumn.One,
            selection: undefined,
        } as any;
        mockSqlDocumentService
            .setup((x) => x.newQuery(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(editor));
        connectionManager
            .setup((x) => x.onNewConnection())
            .returns(() => {
                return Promise.resolve(undefined);
            });

        // Mock connectionStore.removeRecentlyUsed to avoid the undefined error
        const mockConnectionStore = TypeMoq.Mock.ofType<any>();
        mockConnectionStore
            .setup((x) => x.removeRecentlyUsed(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve());
        connectionManager.setup((x) => x.connectionStore).returns(() => mockConnectionStore.object);

        // Mock getServerInfo method that is called at the end of onNewQuery
        connectionManager
            .setup((x) => x.getServerInfo(TypeMoq.It.isAny()))
            .returns(() => undefined);

        await mainController.onNewQuery(undefined, undefined);
        mockSqlDocumentService.verify((x) => x.newQuery(TypeMoq.It.isAny()), TypeMoq.Times.once());
    });

    test("onNewQuery should not call the new connection if new query fails", async () => {
        // Ensure the command is allowed to run (otherwise early return and nothing is called)
        (mainController as any).canRunCommand = () => true;

        // Make newQuery reject
        mockSqlDocumentService
            .setup((x) => x.newQuery(TypeMoq.It.isAny()))
            .returns(() => Promise.reject(new Error("boom")));

        connectionManager.setup((x) => x.onNewConnection()).returns(() => Promise.resolve() as any);

        // Act + assert reject
        await assert.rejects(() => mainController.onNewQuery(undefined, undefined), /boom/);

        // Verify prod calls newQuery once
        mockSqlDocumentService.verify((x) => x.newQuery(TypeMoq.It.isAny()), TypeMoq.Times.once());

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

    test("runComparison command should call onSchemaCompare on the controller", async () => {
        let called = false;
        let gotMaybeSource: any = undefined;
        let gotMaybeTarget: any = undefined;
        let gotRunComparison: boolean | undefined;

        const originalHandler = (mainController as any).onSchemaCompare;
        (mainController as any).onSchemaCompare = async (
            maybeSource?: SchemaCompareEndpointInfo,
            maybeTarget?: SchemaCompareEndpointInfo,
            runComparison?: boolean,
        ) => {
            called = true;
            gotMaybeSource = maybeSource;
            gotMaybeTarget = maybeTarget;
            gotRunComparison = runComparison ?? false;
        };

        const src = { endpointType: 1, serverName: "srcServer", databaseName: "srcDb" };
        const tgt = { endpointType: 1, serverName: "tgtServer", databaseName: "tgtDb" };

        try {
            await vscode.commands.executeCommand(Constants.cmdSchemaCompare, src, tgt);

            // Normalize in-case the command forwarded a single object { source, target }
            if (
                gotMaybeSource &&
                typeof gotMaybeSource === "object" &&
                ("source" in gotMaybeSource || "target" in gotMaybeSource)
            ) {
                const wrapped = gotMaybeSource as any;
                gotMaybeSource = wrapped.source;
                gotMaybeTarget = wrapped.target;
                gotRunComparison = wrapped.runComparison ?? false;
            }

            assert.equal(called, true, "Expected onSchemaCompare to be called");
            assert.deepStrictEqual(
                gotMaybeSource,
                src,
                "Expected source passed through to handler",
            );
            assert.deepStrictEqual(
                gotMaybeTarget,
                tgt,
                "Expected target passed through to handler",
            );
            assert.equal(gotRunComparison, false, "Expected runComparison to be false");
        } finally {
            // restore original handler so the test doesn't leak state
            (mainController as any).onSchemaCompare = originalHandler;
        }
    });
});
