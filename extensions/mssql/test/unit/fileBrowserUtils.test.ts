/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { FileBrowserService } from "../../src/services/fileBrowserService";
import * as vscode from "vscode";
import { stubVscodeWrapper } from "./utils";
import { registerFileBrowserReducers } from "../../src/controllers/fileBrowserUtils";
import { ReactWebviewPanelController } from "../../src/controllers/reactWebviewPanelController";
import {
    FileBrowserCloseResponse,
    FileBrowserExpandResponse,
    FileBrowserOpenResponse,
    FileBrowserReducers,
    FileBrowserState,
    FileBrowserWebviewState,
} from "../../src/sharedInterfaces/fileBrowser";
import * as utils from "../../src/utils/utils";
import { MssqlWebviewPanelOptions } from "../../src/sharedInterfaces/webview";

chai.use(sinonChai);

suite("File Browser Utilities", () => {
    let sandbox: sinon.SinonSandbox;
    let mockFileBrowserService: FileBrowserService;
    let client: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;

    let mockContext: vscode.ExtensionContext;
    let mockFileBrowserController: ReactWebviewPanelController<
        FileBrowserWebviewState,
        FileBrowserReducers,
        void
    >;

    setup(() => {
        sandbox = sinon.createSandbox();

        vscodeWrapper = stubVscodeWrapper(sandbox);
        client = sandbox.createStubInstance(SqlToolsServiceClient);

        mockFileBrowserService = new FileBrowserService(vscodeWrapper, client);

        mockContext = {
            extensionUri: vscode.Uri.parse("https://localhost"),
            extensionPath: "path",
        } as unknown as vscode.ExtensionContext;
        sandbox.stub(utils, "getNonce").returns("test-nonce");

        mockFileBrowserController = createController();
    });

    teardown(() => {
        sandbox.restore();
    });

    function createController<TResult = void>(options: Partial<MssqlWebviewPanelOptions> = {}) {
        const defaultOptions: MssqlWebviewPanelOptions = {
            title: "Test Panel",
            viewColumn: vscode.ViewColumn.One,
            preserveFocus: true,
            iconPath: vscode.Uri.file("path"),
            showRestorePromptAfterClose: true,
        };

        const controller = new TestFileBrowserWebviewController<TResult>(mockContext, {
            ...defaultOptions,
            ...options,
        });
        return controller;
    }

    test("openFileBrowser Reducer: ", async () => {
        let openFileBrowserStub = sinon.stub(mockFileBrowserService, "openFileBrowser").resolves({
            succeeded: true,
        } as FileBrowserOpenResponse);
        registerFileBrowserReducers(mockFileBrowserController, mockFileBrowserService, []);

        const mockInitialState: FileBrowserWebviewState = {
            fileBrowserState: {
                ownerUri: "testUri",
            } as FileBrowserState,
            dialog: undefined,
            ownerUri: "testUri",
            defaultFileBrowserExpandPath: "/",
        };

        const mockPayload = {
            ownerUri: "testUri",
            expandPath: "/",
            fileFilters: [],
            changeFilter: false,
            showFoldersOnly: false,
        };

        const result = await mockFileBrowserController["_reducerHandlers"].get("openFileBrowser")(
            mockInitialState,
            mockPayload,
        );

        expect(result, "State should not change").to.deep.equal(mockInitialState);

        expect(openFileBrowserStub).to.have.been.calledOnce;

        openFileBrowserStub.restore();

        openFileBrowserStub = sinon.stub(mockFileBrowserService, "openFileBrowser").resolves({
            succeeded: false,
            message: "Failed to open file browser",
        } as FileBrowserOpenResponse);

        const errorResult = await mockFileBrowserController["_reducerHandlers"].get(
            "openFileBrowser",
        )(mockInitialState, mockPayload);
        expect(errorResult, "State should not change on error").to.deep.equal(mockInitialState);

        expect(openFileBrowserStub).to.have.been.calledOnce;
    });

    test("expandNode Reducer", async () => {
        let expandStub = sinon.stub(mockFileBrowserService, "expandFilePath").resolves({
            succeeded: true,
        } as FileBrowserExpandResponse);

        registerFileBrowserReducers(mockFileBrowserController, mockFileBrowserService, []);

        const mockState: FileBrowserWebviewState = {
            fileBrowserState: { ownerUri: "testUri" } as FileBrowserState,
            dialog: undefined,
            ownerUri: "testUri",
            defaultFileBrowserExpandPath: "/",
        };

        const mockPayload = { ownerUri: "testUri", nodePath: "/" };

        const result = await mockFileBrowserController["_reducerHandlers"].get("expandNode")(
            mockState,
            mockPayload,
        );

        expect(expandStub).to.have.been.calledOnceWithExactly("testUri", "/");
        expect(result).to.deep.equal(mockState);
        expandStub.restore();

        expandStub = sinon.stub(mockFileBrowserService, "expandFilePath").resolves({
            succeeded: false,
            message: "Failed to expand node",
        } as FileBrowserExpandResponse);

        const errorResult = await mockFileBrowserController["_reducerHandlers"].get("expandNode")(
            mockState,
            mockPayload,
        );

        expect(expandStub).to.have.been.calledOnceWithExactly("testUri", "/");
        expect(errorResult).to.deep.equal(mockState);
        expandStub.restore();
    });

    test("submitFilePath Reducer", async () => {
        registerFileBrowserReducers(mockFileBrowserController, mockFileBrowserService);

        const mockState: FileBrowserWebviewState = {
            fileBrowserState: { selectedPath: "/" } as FileBrowserState,
            dialog: undefined,
            ownerUri: "testUri",
            defaultFileBrowserExpandPath: "/",
        };

        const mockPayload = { selectedPath: "/newPath" };

        const result = await mockFileBrowserController["_reducerHandlers"].get("submitFilePath")(
            mockState,
            mockPayload,
        );

        expect(result.fileBrowserState.selectedPath).to.equal("/newPath");
    });

    test("closeFileBrowser Reducer", async () => {
        let closeStub = sinon.stub(mockFileBrowserService, "closeFileBrowser").resolves({
            succeeded: true,
        } as FileBrowserCloseResponse);

        registerFileBrowserReducers(mockFileBrowserController, mockFileBrowserService);

        const mockState: FileBrowserWebviewState = {
            fileBrowserState: { ownerUri: "testUri" } as FileBrowserState,
            dialog: undefined,
            ownerUri: "testUri",
            defaultFileBrowserExpandPath: "/",
        };

        const mockPayload = { ownerUri: "testUri" };

        const result = await mockFileBrowserController["_reducerHandlers"].get("closeFileBrowser")(
            mockState,
            mockPayload,
        );

        expect(closeStub).to.have.been.calledOnceWithExactly("testUri");
        expect(result).to.deep.equal(mockState);

        closeStub.restore();

        closeStub = sinon.stub(mockFileBrowserService, "closeFileBrowser").resolves({
            succeeded: false,
            message: "Failed to close file browser",
        } as FileBrowserCloseResponse);

        const errorResult = await mockFileBrowserController["_reducerHandlers"].get(
            "closeFileBrowser",
        )(mockState, mockPayload);

        expect(closeStub).to.have.been.calledOnceWithExactly("testUri");
        expect(errorResult).to.deep.equal(mockState);
        closeStub.restore();
    });

    test("toggleFileBrowserDialog Reducer: open and close", async () => {
        let openStub = sinon.stub(mockFileBrowserService, "openFileBrowser").resolves({
            succeeded: true,
        } as FileBrowserOpenResponse);

        mockFileBrowserService.fileBrowserState = {
            ownerUri: "testUri",
            showFoldersOnly: false,
            fileFilters: [],
            fileTree: undefined,
            selectedPath: "",
        } as FileBrowserState;

        registerFileBrowserReducers(mockFileBrowserController, mockFileBrowserService, []);

        const mockState: FileBrowserWebviewState = {
            fileBrowserState: undefined,
            dialog: undefined,
            ownerUri: "testUri",
            defaultFileBrowserExpandPath: "/",
        };

        // Open dialog
        const openResult = await mockFileBrowserController["_reducerHandlers"].get(
            "toggleFileBrowserDialog",
        )(mockState, { foldersOnly: false, shouldOpen: true });

        expect(openStub).to.have.been.calledOnce;
        expect(openResult.dialog).to.deep.equal({ type: "fileBrowser" });
        expect(mockState.fileBrowserState.showFoldersOnly).to.be.false;

        openStub.restore();

        openStub = sinon.stub(mockFileBrowserService, "openFileBrowser").resolves({
            succeeded: false,
            message: "Failed to open file browser",
        } as FileBrowserOpenResponse);

        mockState.fileBrowserState = undefined;

        await mockFileBrowserController["_reducerHandlers"].get("toggleFileBrowserDialog")(
            mockState,
            { foldersOnly: true, shouldOpen: true },
        );

        expect(openStub).to.have.been.calledOnce;
        expect(mockState.fileBrowserState.showFoldersOnly).to.be.true;

        // Close dialog
        const closeResult = await mockFileBrowserController["_reducerHandlers"].get(
            "toggleFileBrowserDialog",
        )(mockState, { foldersOnly: false, shouldOpen: false });

        expect(closeResult.dialog).to.be.undefined;

        openStub.restore();
    });
});

let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;

class TestFileBrowserWebviewController<TResult> extends ReactWebviewPanelController<
    FileBrowserWebviewState,
    FileBrowserReducers,
    TResult
> {
    constructor(context: vscode.ExtensionContext, options: MssqlWebviewPanelOptions) {
        super(
            context,
            vscodeWrapper!,
            "testSource",
            "testSource",
            {
                fileBrowserState: {
                    fileTree: undefined,
                    selectedPath: "",
                    ownerUri: "testId",
                    fileFilters: [],
                    showFoldersOnly: false,
                } as FileBrowserState,
                dialog: undefined,
                ownerUri: "testUri",
                defaultFileBrowserExpandPath: "/",
            },
            options,
        );
    }
}
