/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import * as vscode from "vscode";
import * as Extension from "../../src/extension";
import MainController from "../../src/controllers/mainController";
import ConnectionManager from "../../src/controllers/connectionManager";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { TestExtensionContext } from "./stubs";
import { activateExtension } from "./utils";
import { SchemaCompareEndpointInfo } from "vscode-mssql";
import * as Constants from "../../src/constants/constants";

chai.use(sinonChai);

suite("MainController Tests", function () {
    let sandbox: sinon.SinonSandbox;
    let mainController: MainController;
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;

    setup(async () => {
        sandbox = sinon.createSandbox();
        // Need to activate the extension to get the mainController
        await activateExtension();

        // Using the mainController that was instantiated with the extension
        mainController = await Extension.getController();

        // Setting up a stubbed connectionManager
        connectionManager = sandbox.createStubInstance(ConnectionManager);
        mainController.connectionManager = connectionManager;
        (mainController.sqlDocumentService as any)["_connectionMgr"] = connectionManager;
    });

    teardown(() => {
        sandbox.restore();
    });

    test("validateTextDocumentHasFocus returns false if there is no active text document", () => {
        const vscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        let getterCalls = 0;
        sandbox.stub(vscodeWrapper, "activeTextEditorUri").get(() => {
            getterCalls += 1;
            return undefined;
        });
        const controller: MainController = new MainController(
            TestExtensionContext.object,
            undefined, // ConnectionManager
            vscodeWrapper,
        );

        const result = (controller as any).validateTextDocumentHasFocus();

        expect(
            result,
            "Expected validateTextDocumentHasFocus to return false when the active document URI is undefined",
        ).to.be.false;
        expect(getterCalls).to.equal(1);
    });

    test("validateTextDocumentHasFocus returns true if there is an active text document", () => {
        const vscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        sandbox.stub(vscodeWrapper, "activeTextEditorUri").get(() => "test_uri");
        const controller: MainController = new MainController(
            TestExtensionContext.object,
            undefined, // ConnectionManager
            vscodeWrapper,
        );

        const result = (controller as any).validateTextDocumentHasFocus();

        expect(
            result,
            "Expected validateTextDocumentHasFocus to return true when the active document URI is not undefined",
        ).to.be.true;
    });

    test("onManageProfiles should call the connection manager to manage profiles", async () => {
        const vscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        connectionManager.onManageProfiles.resolves();

        const controller: MainController = new MainController(
            TestExtensionContext.object,
            connectionManager,
            vscodeWrapper,
        );

        await controller.onManageProfiles();

        expect(connectionManager.onManageProfiles).to.have.been.calledOnce;
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

            expect(called, "Expected onSchemaCompare to be called").to.be.true;
            expect(gotMaybeSource, "Expected source passed through to handler").to.deep.equal(src);
            expect(gotMaybeTarget, "Expected target passed through to handler").to.deep.equal(tgt);
            expect(gotRunComparison, "Expected runComparison to be false").to.be.false;
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

            expect(called, "Expected onPublishDatabaseProject to be called").to.be.true;
            expect(
                gotProjectFilePath,
                "Expected projectFilePath passed through to handler",
            ).to.equal(testProjectPath);
        } finally {
            // restore original handler so the test doesn't leak state
            mainController.onPublishDatabaseProject = originalHandler;
        }
    });
});
