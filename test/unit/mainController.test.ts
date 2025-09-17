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
    // Use the real SqlDocumentService instance from the controller

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
});
