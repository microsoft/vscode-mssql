/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as TypeMoq from "typemoq";
import * as vscode from "vscode";
import { expect } from "chai";
import * as Extension from "../../src/extension";
import * as Constants from "../../src/constants/constants";
import * as LocalizedConstants from "../../src/constants/locConstants";
import MainController from "../../src/controllers/mainController";
import ConnectionManager from "../../src/controllers/connectionManager";
import UntitledSqlDocumentService from "../../src/controllers/untitledSqlDocumentService";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { TestExtensionContext } from "./stubs";
import { activateExtension } from "./utils";
import StatusView from "../../src/views/statusView";
import * as sinon from "sinon";

suite("MainController Tests", function () {
    let document: vscode.TextDocument;
    let newDocument: vscode.TextDocument;
    let mainController: MainController;
    let connectionManager: TypeMoq.IMock<ConnectionManager>;
    let untitledSqlDocumentService: TypeMoq.IMock<UntitledSqlDocumentService>;
    let docUri: string;
    let newDocUri: string;
    let docUriCallback: string;
    let newDocUriCallback: string;
    let sandbox: sinon.SinonSandbox;

    setup(async () => {
        sandbox = sinon.createSandbox();
        // Need to activate the extension to get the mainController
        await activateExtension();

        // Setup a standard document and a new document
        docUri = "docURI.sql";
        newDocUri = "newDocURI.sql";

        document = mockTextDocument(docUri);
        newDocument = mockTextDocument(newDocUri);

        // Resetting call back variables
        docUriCallback = "";
        newDocUriCallback = "";
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

        untitledSqlDocumentService = TypeMoq.Mock.ofType(UntitledSqlDocumentService);
        mainController.untitledSqlDocumentService = untitledSqlDocumentService.object;

        setupConnectionManagerMocks(connectionManager);
    });

    teardown(() => {
        sandbox.restore();
        docUriCallback = "";
        newDocUriCallback = "";
    });

    // Standard closed document event test
    test("onDidCloseTextDocument should propogate onDidCloseTextDocument to connectionManager", () => {
        void mainController.onDidCloseTextDocument(document);
        try {
            connectionManager.verify(
                (x) => x.onDidCloseTextDocument(TypeMoq.It.isAny()),
                TypeMoq.Times.once(),
            );
            assert.equal(docUriCallback, document.uri.toString());
            docUriCallback = "";
        } catch (err) {
            throw err;
        }
    });

    // Saved Untitled file event test
    test("onDidCloseTextDocument should call untitledDoc function when an untitled file is saved", (done) => {
        // Scheme of older doc must be untitled
        let document2 = <vscode.TextDocument>{
            uri: vscode.Uri.parse(`${LocalizedConstants.untitledScheme}:${docUri}`),
            languageId: "sql",
        };

        // A save untitled doc constitutes an saveDoc event directly followed by a closeDoc event
        mainController.onDidSaveTextDocument(newDocument);
        void mainController.onDidCloseTextDocument(document2);
        try {
            connectionManager.verify(
                (x) => x.copyConnectionToFile(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
                TypeMoq.Times.once(),
            );
            assert.equal(docUriCallback, document2.uri.toString());
            assert.equal(newDocUriCallback, newDocument.uri.toString());
            done();
        } catch (err) {
            done(new Error(err));
        }
    });

    // Renamed file event test
    test("onDidCloseTextDocument should call renamedDoc function when rename occurs", async () => {
        mainController["_previousActiveDocument"] = document;
        // Use the existing untitledSqlDocumentService mock instead of creating a new one
        untitledSqlDocumentService
            .setup((x) => x.waitForOngoingCreates())
            .returns(() => Promise.resolve(undefined));
        untitledSqlDocumentService
            .setup((x) => x.shouldSkipCopyConnection(TypeMoq.It.isAny()))
            .returns(() => false);

        // Reset the callback variables before the test
        docUriCallback = "";
        newDocUriCallback = "";

        // A renamed doc = open followed immediately by close
        await mainController.onDidOpenTextDocument(newDocument);
        void mainController.onDidCloseTextDocument(document);

        // Verify copyConnectionToFile was called
        connectionManager.verify(
            (x) =>
                x.copyConnectionToFile(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.atLeastOnce(),
        );

        // Now these assertions should work because the callbacks will have been triggered
        assert.strictEqual(docUriCallback, document.uri.toString());
        assert.strictEqual(newDocUriCallback, newDocument.uri.toString());
    });

    // Closed document event called to test rename and untitled save file event timeouts
    test("onDidCloseTextDocument should propogate to the connectionManager even if a special event occured before it", async () => {
        const untitleDocumentServiceStub = sandbox.createStubInstance(UntitledSqlDocumentService);
        mainController.untitledSqlDocumentService = untitleDocumentServiceStub;

        untitleDocumentServiceStub.waitForOngoingCreates.resolves(undefined);
        untitleDocumentServiceStub.shouldSkipCopyConnection.returns(false);

        // Call both special cases
        await mainController.onDidSaveTextDocument(newDocument);
        await mainController.onDidOpenTextDocument(newDocument);

        // Cause event time out (above 10 ms should work)
        setTimeout(() => {
            void mainController.onDidCloseTextDocument(document);

            connectionManager.verify(
                (x) =>
                    x.copyConnectionToFile(
                        // ignore changes to settings.json because MainController setup adds missing mssql connection settings
                        TypeMoq.It.is((x) => !x.endsWith("settings.json")),
                        TypeMoq.It.is((x) => !x.endsWith("settings.json")),
                    ),
                TypeMoq.Times.never(),
            );
            connectionManager.verify(
                (x) => x.onDidCloseTextDocument(TypeMoq.It.isAny()),
                TypeMoq.Times.once(),
            );
            assert.equal(docUriCallback, document.uri.toString());

            // Timeout set to the max threshold + 1
        }, Constants.untitledSaveTimeThreshold + 1);
    });

    // Open document event test
    test("onDidOpenTextDocument should propogate the function to the connectionManager", async () => {
        const untitleDocumentServiceStub = sandbox.createStubInstance(UntitledSqlDocumentService);

        mainController.untitledSqlDocumentService = untitleDocumentServiceStub;

        untitleDocumentServiceStub.waitForOngoingCreates.resolves(undefined);
        untitleDocumentServiceStub.shouldSkipCopyConnection.returns(false);

        // Call onDidOpenTextDocument to test it side effects
        await mainController.onDidOpenTextDocument(document);

        connectionManager.verify(
            (x) => x.onDidOpenTextDocument(TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );
        assert.equal(docUriCallback, document.uri.toString());
    });

    // Save document event test
    test("onDidSaveTextDocument should propogate the function to the connectionManager", () => {
        const untitleDocumentServiceStub = sandbox.createStubInstance(UntitledSqlDocumentService);

        mainController.untitledSqlDocumentService = untitleDocumentServiceStub;

        untitleDocumentServiceStub.waitForOngoingCreates.resolves(undefined);
        untitleDocumentServiceStub.shouldSkipCopyConnection.returns(false);

        // Call onDidOpenTextDocument to test it side effects
        mainController.onDidSaveTextDocument(newDocument);

        // Ensure no extraneous function is called
        connectionManager.verify(
            (x) => x.onDidOpenTextDocument(TypeMoq.It.isAny()),
            TypeMoq.Times.never(),
        );
        connectionManager.verify(
            (x) => x.copyConnectionToFile(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.never(),
        );
    });

    test("TextDocument Events should handle non-initialized connection manager", async () => {
        const untitleDocumentServiceStub = sandbox.createStubInstance(UntitledSqlDocumentService);

        mainController.untitledSqlDocumentService = untitleDocumentServiceStub;

        untitleDocumentServiceStub.waitForOngoingCreates.resolves(undefined);
        untitleDocumentServiceStub.shouldSkipCopyConnection.returns(false);

        let vscodeWrapperMock: TypeMoq.IMock<VscodeWrapper> = TypeMoq.Mock.ofType(VscodeWrapper);
        let controller: MainController = new MainController(
            TestExtensionContext.object,
            undefined, // ConnectionManager
            vscodeWrapperMock.object,
        );

        // None of the TextDocument events should throw exceptions, they should cleanly exit instead.
        await controller.onDidOpenTextDocument(document);
        controller.onDidSaveTextDocument(document);
        void controller.onDidCloseTextDocument(document);
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
            .setup((x) => x.newQuery(undefined, false))
            .returns(() => {
                return Promise.resolve(editor);
            });
        connectionManager
            .setup((x) => x.onNewConnection())
            .returns(() => {
                return Promise.resolve(undefined);
            });

        await mainController.onNewQuery(undefined, undefined);
        untitledSqlDocumentService.verify(
            (x) => x.newQuery(undefined, false),
            TypeMoq.Times.once(),
        );
        connectionManager.verify((x) => x.onNewConnection(), TypeMoq.Times.atLeastOnce());
    });

    test("onNewQuery should not call the new connection if new query fails", (done) => {
        untitledSqlDocumentService
            .setup((x) => x.newQuery())
            .returns(() => {
                return Promise.reject<vscode.TextEditor>("error");
            });
        connectionManager
            .setup((x) => x.onNewConnection())
            .returns(() => {
                return Promise.resolve(TypeMoq.It.isAny());
            });

        mainController.onNewQuery(undefined, undefined).catch((error) => {
            untitledSqlDocumentService.verify(
                (x) => x.newQuery(undefined, false),
                TypeMoq.Times.once(),
            );
            connectionManager.verify((x) => x.onNewConnection(), TypeMoq.Times.never());
            done();
        });
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

    test("onManageProfiles should call the connetion manager to manage profiles", async () => {
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

    test("connection is transferred when opening a new file and the previous active file is connected", async () => {
        let vscodeWrapperMock: TypeMoq.IMock<VscodeWrapper> = TypeMoq.Mock.ofType(VscodeWrapper);

        const script1 = mockTextDocument("script_1.sql");
        const script2 = mockTextDocument("script_2.sql");
        const textFile = mockTextDocument("text_file.txt", "plaintext");

        const editor: vscode.TextEditor = {
            document: script1,
        } as unknown as vscode.TextEditor;

        const controller: MainController = new MainController(
            TestExtensionContext.object,
            connectionManager.object,
            vscodeWrapperMock.object,
        );

        const mockStatusView = TypeMoq.Mock.ofType(StatusView);
        mockStatusView.setup((x) =>
            x.languageFlavorChanged(TypeMoq.It.isAny(), TypeMoq.It.isAny()),
        );

        controller["_statusview"] = mockStatusView.object;
        setupConnectionManagerMocks(connectionManager);

        // verify initial state

        expect(
            controller["_previousActiveDocument"],
            "previous active document should be initially unset",
        ).to.equal(undefined);

        // simulate opening a SQL file
        controller.onDidChangeActiveTextEditor(editor);

        expect(
            controller["_previousActiveDocument"],
            "previous active document should be set after opening a SQL file",
        ).to.deep.equal(editor.document);
        connectionManager.verify(
            (x) =>
                x.copyConnectionToFile(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.never(),
        );

        // verify that the connection manager transfers the connection from SQL file to SQL file
        await controller.onDidOpenTextDocument(script2);

        expect(
            controller["_previousActiveDocument"],
            "previous active document should be changed to new script when opening a SQL file",
        ).to.deep.equal(script2);
        connectionManager.verify(
            (x) => x.copyConnectionToFile(script1.uri.toString(), script2.uri.toString(), true),
            TypeMoq.Times.once(),
        );

        connectionManager.reset();
        setupConnectionManagerMocks(connectionManager);

        // verify that the connection manager does not transfer the connection from SQL file to non-SQL file
        await controller.onDidOpenTextDocument(textFile);

        expect(
            controller["_previousActiveDocument"],
            "previous active document should be undefined after opening a non-SQL file",
        ).to.deep.equal(undefined);
        connectionManager.verify(
            (x) =>
                x.copyConnectionToFile(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.never(),
        );

        // verify that the connection manager does not transfer the connection from SQL file to non-SQL file
        await controller.onDidOpenTextDocument(script1);

        expect(
            controller["_previousActiveDocument"],
            "previous active document should be set after opening a SQL file",
        ).to.deep.equal(script1);
        connectionManager.verify(
            (x) =>
                x.copyConnectionToFile(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.never(),
        );
    });

    function setupConnectionManagerMocks(
        connectionManager: TypeMoq.IMock<ConnectionManager>,
    ): void {
        connectionManager
            .setup((x) => x.onDidOpenTextDocument(TypeMoq.It.isAny()))
            .callback((doc) => {
                docUriCallback = doc.uri.toString();
            });

        connectionManager
            .setup((x) => x.onDidCloseTextDocument(TypeMoq.It.isAny()))
            .callback((doc) => {
                docUriCallback = doc.uri.toString();
            });

        connectionManager
            .setup((x) =>
                x.copyConnectionToFile(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            )
            .callback((doc, newDoc) => {
                docUriCallback = doc;
                newDocUriCallback = newDoc;
            });
    }
});

function mockTextDocument(
    docUri: string,
    languageId: string = Constants.languageId,
): vscode.TextDocument {
    const document = <vscode.TextDocument>{
        uri: {
            toString(_skipEncoding?: boolean): string {
                return docUri;
            },
        },
        languageId: languageId,
    };

    return document;
}
