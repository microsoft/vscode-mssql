/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as TypeMoq from "typemoq";
import * as vscode from "vscode";
import MainController from "../../src/controllers/mainController";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import ConnectionManager from "../../src/controllers/connectionManager";

suite("Hot Exit Tests", () => {
    let mockVscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    let mockConnectionManager: TypeMoq.IMock<ConnectionManager>;
    let mockOutputContentProvider: TypeMoq.IMock<any>;
    let mockQueryResultWebviewController: TypeMoq.IMock<any>;
    let mainController: MainController;
    let mockContext: TypeMoq.IMock<vscode.ExtensionContext>;

    function createMockTextDocument(
        uri: string,
        languageId: string,
        isDirty: boolean,
        isUntitled: boolean = false,
        scheme: string = "file",
    ): vscode.TextDocument {
        const mockUri = vscode.Uri.parse(uri);
        return {
            uri: mockUri,
            languageId: languageId,
            isDirty: isDirty,
            isUntitled: isUntitled,
            fileName: mockUri.fsPath,
            eol: vscode.EndOfLine.LF,
            getText: () => "",
            getWordRangeAtPosition: () => undefined,
            isClosed: false,
            lineAt: () => undefined as any,
            lineCount: 0,
            offsetAt: () => 0,
            positionAt: () => new vscode.Position(0, 0),
            save: () => Promise.resolve(true),
            validatePosition: () => new vscode.Position(0, 0),
            validateRange: () => new vscode.Range(0, 0, 0, 0),
            version: 1,
        };
    }

    setup(() => {
        mockVscodeWrapper = TypeMoq.Mock.ofType<VscodeWrapper>();
        mockConnectionManager = TypeMoq.Mock.ofType<ConnectionManager>();
        mockOutputContentProvider = TypeMoq.Mock.ofType<any>();
        mockQueryResultWebviewController = TypeMoq.Mock.ofType<any>();
        mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();

        // Setup mock context
        mockContext.setup((x) => x.subscriptions).returns(() => []);
        mockContext.setup((x) => x.extensionUri).returns(() => vscode.Uri.parse("file:///test"));
        mockContext
            .setup((x) => x.globalState)
            .returns(() => ({
                keys: () => [],
                get: () => undefined,
                update: () => Promise.resolve(),
                setKeysForSync: () => undefined,
            }));
        mockContext
            .setup((x) => x.workspaceState)
            .returns(() => ({
                keys: () => [],
                get: () => undefined,
                update: () => Promise.resolve(),
                setKeysForSync: () => undefined,
            }));

        // Setup mock query result webview controller
        mockQueryResultWebviewController.setup((x) => x.actualPlanStatuses).returns(() => []);

        // Setup mock connection manager
        mockConnectionManager
            .setup((x) => x.onDidCloseTextDocument(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve());

        // Setup mock output content provider
        mockOutputContentProvider
            .setup((x) => x.onDidCloseTextDocument(TypeMoq.It.isAny()))
            .returns(() => undefined);

        // Create main controller instance
        mainController = new MainController(
            mockContext.object,
            undefined,
            mockVscodeWrapper.object,
        );
        (mainController as any)._connectionMgr = mockConnectionManager.object;
        (mainController as any)._outputContentProvider = mockOutputContentProvider.object;
        (mainController as any)._queryResultWebviewController =
            mockQueryResultWebviewController.object;
    });

    test("onDidCloseTextDocument should not interfere with hot exit for dirty untitled SQL documents", async () => {
        // Arrange
        const untitledSqlDoc = createMockTextDocument(
            "untitled:Untitled-1",
            "sql",
            true, // isDirty
            true, // isUntitled
            "untitled",
        );

        // Act
        await mainController.onDidCloseTextDocument(untitledSqlDoc);

        // Assert
        // For dirty untitled SQL documents, connection manager should NOT be called
        // as it interferes with hot exit
        mockConnectionManager.verify(
            (x) => x.onDidCloseTextDocument(TypeMoq.It.isAny()),
            TypeMoq.Times.never(),
        );

        // But output content provider should still be called for cleanup
        mockOutputContentProvider.verify(
            (x) => x.onDidCloseTextDocument(TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );
    });

    test("onDidCloseTextDocument should work normally for clean untitled SQL documents", async () => {
        // Arrange
        const untitledSqlDoc = createMockTextDocument(
            "untitled:Untitled-1",
            "sql",
            false, // isDirty
            true, // isUntitled
            "untitled",
        );

        // Act
        await mainController.onDidCloseTextDocument(untitledSqlDoc);

        // Assert
        // For clean untitled SQL documents, normal processing should occur
        mockConnectionManager.verify(
            (x) => x.onDidCloseTextDocument(TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );

        mockOutputContentProvider.verify(
            (x) => x.onDidCloseTextDocument(TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );
    });

    test("onDidCloseTextDocument should work normally for dirty non-SQL documents", async () => {
        // Arrange
        const untitledDoc = createMockTextDocument(
            "untitled:Untitled-1",
            "javascript",
            true, // isDirty
            true, // isUntitled
            "untitled",
        );

        // Act
        await mainController.onDidCloseTextDocument(untitledDoc);

        // Assert
        // For non-SQL documents, normal processing should occur
        mockConnectionManager.verify(
            (x) => x.onDidCloseTextDocument(TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );

        mockOutputContentProvider.verify(
            (x) => x.onDidCloseTextDocument(TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );
    });

    test("onDidCloseTextDocument should work normally for saved files", async () => {
        // Arrange
        const savedSqlDoc = createMockTextDocument(
            "file:///test/test.sql",
            "sql",
            false, // isDirty
            false, // isUntitled
            "file",
        );

        // Act
        await mainController.onDidCloseTextDocument(savedSqlDoc);

        // Assert
        // For saved files, normal processing should occur
        mockConnectionManager.verify(
            (x) => x.onDidCloseTextDocument(TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );

        mockOutputContentProvider.verify(
            (x) => x.onDidCloseTextDocument(TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );
    });
});
