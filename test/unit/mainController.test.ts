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
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { TestExtensionContext } from "./stubs";
import { activateExtension } from "./utils";
import { SchemaCompareEndpointInfo } from "vscode-mssql";
import * as Constants from "../../src/constants/constants";

suite("MainController Tests", function () {
    let mainController: MainController;
    let connectionManager: TypeMoq.IMock<ConnectionManager>;

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
        mainController.sqlDocumentService["_connectionMgr"] = connectionManager.object;
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

    test("publishDatabaseProject command should call onPublishDatabaseProject on the controller", async () => {
        let called = false;
        let gotProjectFilePath: string | undefined;

        const originalHandler: (projectFilePath: string) => Promise<void> =
            mainController.onPublishDatabaseProject.bind(mainController);
        mainController.onPublishDatabaseProject = async (
            projectFilePath: string,
        ): Promise<void> => {
            called = true;
            gotProjectFilePath = projectFilePath;
        };

        const testProjectPath = "C:\\test\\project\\database.sqlproj";

        try {
            await vscode.commands.executeCommand(
                Constants.cmdPublishDatabaseProject,
                testProjectPath,
            );

            assert.equal(called, true, "Expected onPublishDatabaseProject to be called");
            assert.deepStrictEqual(
                gotProjectFilePath,
                testProjectPath,
                "Expected projectFilePath passed through to handler",
            );
        } finally {
            // restore original handler so the test doesn't leak state
            mainController.onPublishDatabaseProject = originalHandler;
        }
    });

    suite("onNewQueryWithConnection Tests", () => {
        test("does nothing when already connected to SQL editor without force flags", async () => {
            // Open a SQL document
            const doc = await vscode.workspace.openTextDocument({
                language: "sql",
                content: "",
            });
            const editor = await vscode.window.showTextDocument(doc);

            // Mock connection
            const uri = editor.document.uri.toString();
            connectionManager.setup((x) => x.isConnected(uri)).returns(() => true);

            // Call method
            const result = await mainController.onNewQueryWithConnection();

            // Should return true without opening new editor
            assert.equal(result, true);

            // Close the document
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
        });

        test("opens new editor when no active editor exists", async () => {
            // Close all editors first
            await vscode.commands.executeCommand("workbench.action.closeAllEditors");

            // Mock onNewConnection to track if it's called
            let onNewConnectionCalled = false;
            const originalOnNewConnection = mainController.onNewConnection.bind(mainController);
            mainController.onNewConnection = async () => {
                onNewConnectionCalled = true;
                return true;
            };

            try {
                const result = await mainController.onNewQueryWithConnection();

                assert.equal(result, true);
                assert.equal(onNewConnectionCalled, true, "Expected onNewConnection to be called");

                // Verify a SQL editor was opened
                const activeEditor = vscode.window.activeTextEditor;
                assert.ok(activeEditor, "Expected an active editor");
                assert.equal(
                    activeEditor.document.languageId,
                    "sql",
                    "Expected SQL language editor",
                );

                // Clean up
                await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            } finally {
                mainController.onNewConnection = originalOnNewConnection;
            }
        });

        test("forces new editor when forceNewEditor is true", async () => {
            // Open a SQL document
            const doc = await vscode.workspace.openTextDocument({
                language: "sql",
                content: "-- existing editor",
            });
            await vscode.window.showTextDocument(doc);
            const initialDocumentCount = vscode.workspace.textDocuments.length;

            // Mock connection - existing editor is connected
            connectionManager.setup((x) => x.isConnected(TypeMoq.It.isAny())).returns(() => true);

            try {
                const result = await mainController.onNewQueryWithConnection(true, false);

                assert.equal(result, true);

                // Verify a new editor was created - document count should increase
                const finalDocumentCount = vscode.workspace.textDocuments.length;
                assert.ok(
                    finalDocumentCount > initialDocumentCount,
                    "Expected a new document to be created",
                );

                // Verify the active editor is SQL
                const activeEditor = vscode.window.activeTextEditor;
                assert.ok(activeEditor, "Expected an active editor");
                assert.equal(activeEditor.document.languageId, "sql");

                // Clean up
                await vscode.commands.executeCommand("workbench.action.closeAllEditors");
            } finally {
                // No cleanup needed
            }
        });

        test("forces connection when forceConnect is true even when connected", async () => {
            // Open a SQL document
            const doc = await vscode.workspace.openTextDocument({
                language: "sql",
                content: "",
            });
            const editor = await vscode.window.showTextDocument(doc);
            const uri = editor.document.uri.toString();

            // Mock already connected
            connectionManager.setup((x) => x.isConnected(uri)).returns(() => true);

            // Mock onNewConnection to verify it's called
            let onNewConnectionCalled = false;
            const originalOnNewConnection = mainController.onNewConnection.bind(mainController);
            mainController.onNewConnection = async () => {
                onNewConnectionCalled = true;
                return true;
            };

            try {
                const result = await mainController.onNewQueryWithConnection(false, true);

                assert.equal(result, true);
                assert.equal(
                    onNewConnectionCalled,
                    true,
                    "Expected onNewConnection to be called despite already being connected",
                );

                // Clean up
                await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            } finally {
                mainController.onNewConnection = originalOnNewConnection;
            }
        });

        test("connects to existing SQL editor when not connected", async () => {
            // Open a SQL document
            const doc = await vscode.workspace.openTextDocument({
                language: "sql",
                content: "",
            });
            const editor = await vscode.window.showTextDocument(doc);
            const uri = editor.document.uri.toString();

            // Mock NOT connected
            connectionManager.setup((x) => x.isConnected(uri)).returns(() => false);

            // Mock onNewConnection
            let onNewConnectionCalled = false;
            const originalOnNewConnection = mainController.onNewConnection.bind(mainController);
            mainController.onNewConnection = async () => {
                onNewConnectionCalled = true;
                return true;
            };

            try {
                const result = await mainController.onNewQueryWithConnection();

                assert.equal(result, true);
                assert.equal(
                    onNewConnectionCalled,
                    true,
                    "Expected onNewConnection to be called for disconnected editor",
                );

                // Clean up
                await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            } finally {
                mainController.onNewConnection = originalOnNewConnection;
            }
        });
    });
});
