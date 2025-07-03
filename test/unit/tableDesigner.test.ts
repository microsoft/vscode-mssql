/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as TypeMoq from "typemoq";
import * as tdTab from "../../src/tableDesigner/tableDesignerTabDefinition";
import { TableDesignerWebviewController } from "../../src/tableDesigner/tableDesignerWebviewController";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import * as td from "../../src/sharedInterfaces/tableDesigner";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import { TableDesignerService } from "../../src/services/tableDesignerService";
import UntitledSqlDocumentService from "../../src/controllers/untitledSqlDocumentService";
import ConnectionManager from "../../src/controllers/connectionManager";

suite("TableDesignerWebviewController tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockVscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    let controller: TableDesignerWebviewController;
    let treeNode: TypeMoq.IMock<TreeNodeInfo>;
    let mockConnectionManager: TypeMoq.IMock<ConnectionManager>;
    let mockTableDesignerService: TableDesignerService;
    let mockUntitledSqlDocumentService: UntitledSqlDocumentService;
    let newQueryStub: sinon.SinonStub;
    const tableName = "TestTable";
    let mockResult: any;
    let mockTableChangeInfo: any;
    let mockPayload: any;

    setup(async () => {
        sandbox = sinon.createSandbox();
        mockContext = {
            extensionUri: vscode.Uri.parse("file://test"),
            extensionPath: "path",
        } as unknown as vscode.ExtensionContext;

        mockVscodeWrapper = TypeMoq.Mock.ofType<VscodeWrapper>();
        mockTableDesignerService = sandbox.createStubInstance(TableDesignerService);
        mockUntitledSqlDocumentService = sandbox.createStubInstance(UntitledSqlDocumentService);
        mockConnectionManager = TypeMoq.Mock.ofType<ConnectionManager>();

        const mockConnectionDetails = {
            server: "localhost",
            database: "master",
            connectionString: "Server=localhost;Database=master;",
            authenticationType: "SqlLogin",
        };

        mockConnectionManager
            .setup((m) => m.createConnectionDetails(TypeMoq.It.isAny()))
            .returns(() => mockConnectionDetails as any);
        mockConnectionManager
            .setup((m) =>
                m.getConnectionString(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            )
            .returns(() => Promise.resolve(mockConnectionDetails.connectionString));
        mockConnectionManager
            .setup((mgr) => mgr.getUriForConnection(TypeMoq.It.isAny()))
            .returns(() => "localhost,1433_undefined_sa_undefined");

        treeNode = TypeMoq.Mock.ofType(TreeNodeInfo, TypeMoq.MockBehavior.Loose);
        treeNode.setup((t) => t.nodeType).returns(() => "Table");
        treeNode.setup((t) => t.nodePath).returns(() => "localhost,1433/Databases");
        treeNode.setup((t) => t.label).returns(() => tableName);
        treeNode
            .setup((t) => t.context)
            .returns(
                () =>
                    ({
                        subType: "Table",
                    }) as any,
            );

        // Arrange
        const mockConnectionProfile = {
            server: "localhost",
            database: undefined,
            authenticationType: "SqlLogin",
        };

        const mockMetadata = {
            schema: "dbo",
            name: tableName,
        };

        treeNode.setup((t) => t.connectionProfile).returns(() => mockConnectionProfile as any);
        treeNode.setup((t) => t.metadata).returns(() => mockMetadata as any);

        assert.deepStrictEqual(
            treeNode.object.connectionProfile,
            mockConnectionProfile,
            "Connection profile should be defined",
        );

        mockResult = {
            tableInfo: {
                title: "TestTable",
                columns: [],
                primaryKey: null,
                foreignKeys: [],
                indexes: [],
            },
            issues: [],
            viewModel: {},
            uiSchema: {},
        };

        mockTableChangeInfo = {
            type: treeNode.object.nodeType,
            source: treeNode.object.nodePath,
        };

        mockPayload = {
            table: mockResult.tableInfo,
            tableChangeInfo: mockTableChangeInfo,
        };

        newQueryStub = (mockUntitledSqlDocumentService.newQuery as sinon.SinonStub).resolves();

        (mockTableDesignerService.initializeTableDesigner as sinon.SinonStub).resolves(mockResult);

        sandbox.stub(tdTab, "getDesignerView").returns({ tabs: [] });

        controller = new TableDesignerWebviewController(
            mockContext,
            mockVscodeWrapper.object,
            mockTableDesignerService,
            mockConnectionManager.object,
            mockUntitledSqlDocumentService,
            treeNode.object,
        );
        controller.revealToForeground();

        assert.strictEqual(
            controller.panel.title,
            "Table Designer",
            "Panel title should be table name",
        );
        await (controller as any).initialize();
        await (controller as any).registerRpcHandlers();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("should initialize correctly for table edit", async () => {
        assert.strictEqual(
            (controller as any)._state.apiState.initializeState,
            td.LoadState.Loaded,
            "Initialize state should be loaded",
        );
        assert.deepStrictEqual(
            (controller as any)._state.tableInfo.database,
            "master",
            "Table Info should be loaded",
        );
    });

    test("should call processTableEdit in processTableEdit reducer", async () => {
        let editResponse = {
            issues: [],
            view: {},
            viewModel: {},
            isValid: true,
        };

        // First scenario: no issues, view is defined
        let processTableEditStub = (
            mockTableDesignerService.processTableEdit as sinon.SinonStub
        ).resolves(editResponse);

        const callState = (controller as any)._state;

        let result = await controller["_reducerHandlers"].get("processTableEdit")(
            callState,
            mockPayload,
        );

        assert.ok(processTableEditStub.calledOnce, "processTableEdit should be called once");
        assert.deepStrictEqual(
            processTableEditStub.firstCall.args,
            [mockPayload.table, mockPayload.tableChangeInfo],
            "processTableEdit should be called with correct arguments",
        );
        assert.deepStrictEqual(
            result.tabStates.resultPaneTab,
            td.DesignerResultPaneTabs.Script,
            "State tab should be set to Script",
        );

        processTableEditStub.restore();

        editResponse = {
            issues: ["issue1", "issue2"],
            view: undefined,
            viewModel: {},
            isValid: false,
        };

        const secondStub = sinon
            .stub(mockTableDesignerService, "processTableEdit")
            .resolves(editResponse as any);

        result = await controller["_reducerHandlers"].get("processTableEdit")(
            callState,
            mockPayload,
        );

        assert.ok(secondStub.calledOnce, "processTableEdit should be called again");
        assert.deepStrictEqual(
            secondStub.firstCall.args,
            [mockPayload.table, mockPayload.tableChangeInfo],
            "Second call should use correct arguments",
        );
        assert.deepStrictEqual(
            result.tabStates.resultPaneTab,
            td.DesignerResultPaneTabs.Issues,
            "Tab should be set to Issues when there are issues",
        );
        assert.deepStrictEqual(
            result.view,
            callState.view,
            "Should retain previous view when editResponse.view is undefined",
        );

        secondStub.restore(); // Cleanup
        const errorMessage = "error message";
        sinon.stub(mockTableDesignerService, "processTableEdit").rejects(new Error(errorMessage));
        const errorStub = sinon.stub(vscode.window, "showErrorMessage");

        result = await controller["_reducerHandlers"].get("processTableEdit")(
            callState,
            mockPayload,
        );

        assert.deepStrictEqual(
            errorStub.firstCall.args,
            [errorMessage],
            "Error message call should use correct arguments",
        );
    });

    test("should call publishTable in publishTable reducer", async () => {
        let publishResponse = {
            issues: [],
            view: {},
            viewModel: {},
            newTableInfo: { ...mockResult.tableInfo, title: "NewTable" },
        };

        // First scenario: no issues, view is defined
        let publishChangesStub = (
            mockTableDesignerService.publishChanges as sinon.SinonStub
        ).resolves(publishResponse);

        const mockPublishPayload = {
            table: mockResult.tableInfo,
        };

        const callState = (controller as any)._state;

        let result = await controller["_reducerHandlers"].get("publishChanges")(
            callState,
            mockPublishPayload,
        );

        assert.ok(publishChangesStub.calledOnce, "publishChanges should be called once");
        assert.deepStrictEqual(
            publishChangesStub.firstCall.args,
            [mockPublishPayload.table],
            "publishChanges should be called with correct arguments",
        );
        assert.deepStrictEqual(
            result.apiState.publishState,
            td.LoadState.Loaded,
            "Publish State should be loaded",
        );

        assert.deepStrictEqual(
            result.apiState.previewState,
            td.LoadState.NotStarted,
            "Preview State should be not started",
        );

        assert.strictEqual(
            controller.panel.title,
            publishResponse.newTableInfo.title,
            "Panel title should be table name",
        );

        publishChangesStub.restore();

        const errorMessage = "error message";
        sinon.stub(mockTableDesignerService, "publishChanges").rejects(new Error(errorMessage));

        result = await controller["_reducerHandlers"].get("publishChanges")(
            callState,
            mockPublishPayload,
        );

        assert.deepStrictEqual(
            result.publishingError,
            `Error: ${errorMessage}`,
            "State should contain error message",
        );

        assert.deepStrictEqual(
            result.apiState.publishState,
            td.LoadState.Error,
            "State should contain correct status",
        );
    });

    test("should call generateScript in generateScript reducer", async () => {
        let scriptResponse = "CREATE TABLE Test (Id INT);";

        // First scenario: no issues, view is defined
        let scriptStub = (mockTableDesignerService.generateScript as sinon.SinonStub).resolves(
            scriptResponse,
        );

        const mockScriptPayload = {
            table: mockResult.tableInfo,
        };

        const callState = (controller as any)._state;

        let result = await controller["_reducerHandlers"].get("generateScript")(
            callState,
            mockScriptPayload,
        );

        assert.ok(scriptStub.calledOnce, "generateScript should be called once");
        assert.deepStrictEqual(
            scriptStub.firstCall.args,
            [mockScriptPayload.table],
            "generateScript should be called with correct arguments",
        );
        assert.ok(newQueryStub.calledOnce, "newQuery should be called once");
        assert.deepStrictEqual(
            newQueryStub.firstCall.args,
            [scriptResponse],
            "newQuery should be called with the generated script",
        );

        assert.deepStrictEqual(
            result.apiState.generateScriptState,
            td.LoadState.Loaded,
            "Script State should be loaded",
        );

        assert.deepStrictEqual(
            result.apiState.previewState,
            td.LoadState.NotStarted,
            "Preview State should be not started",
        );
        scriptStub.restore();
        newQueryStub.restore();
    });

    test("should call generatePreviewReport in generatePreviewReport reducer", async () => {
        const previewResponse = {
            schemaValidationError: undefined,
            report: "Mock preview report content",
            mimeType: "text/html",
        };

        const generatePreviewStub = (
            mockTableDesignerService.generatePreviewReport as sinon.SinonStub
        ).resolves(previewResponse);

        const mockPreviewPayload = {
            table: mockResult.tableInfo,
        };

        const callState = (controller as any)._state;

        // Success scenario
        let result = await controller["_reducerHandlers"].get("generatePreviewReport")(
            callState,
            mockPreviewPayload,
        );

        assert.ok(generatePreviewStub.calledOnce, "generatePreviewReport should be called once");
        assert.deepStrictEqual(
            generatePreviewStub.firstCall.args,
            [mockPreviewPayload.table],
            "generatePreviewReport should be called with correct arguments",
        );

        assert.deepStrictEqual(
            result.apiState.previewState,
            td.LoadState.Loaded,
            "Preview state should be Loaded when no validation error",
        );
        assert.deepStrictEqual(
            result.apiState.publishState,
            td.LoadState.NotStarted,
            "Publish state should remain NotStarted",
        );
        assert.deepStrictEqual(
            result.generatePreviewReportResult,
            previewResponse,
            "Should store the preview report result",
        );

        generatePreviewStub.restore();

        // Error scenario
        const errorMessage = "Preview generation failed";
        sinon
            .stub(mockTableDesignerService, "generatePreviewReport")
            .rejects(new Error(errorMessage));

        result = await controller["_reducerHandlers"].get("generatePreviewReport")(
            callState,
            mockPreviewPayload,
        );

        assert.deepStrictEqual(
            result.apiState.previewState,
            td.LoadState.Error,
            "Preview state should be Error on failure",
        );
        assert.deepStrictEqual(
            result.apiState.publishState,
            td.LoadState.NotStarted,
            "Publish state should remain NotStarted on failure",
        );
        assert.strictEqual(
            result.generatePreviewReportResult.schemaValidationError,
            errorMessage,
            "Should include error message in result",
        );
    });

    test("should call initialize in initializeTableDesigner reducer", async () => {
        const initializeSpy = sinon.spy(controller as any, "initialize");

        const callState = (controller as any)._state;

        await controller["_reducerHandlers"].get("initializeTableDesigner")(
            callState,
            mockTableChangeInfo,
        );

        assert.ok(initializeSpy.calledOnce, "private initialize should be called once");

        (initializeSpy as sinon.SinonSpy).restore();
    });

    test("should call newQuery with script content in scriptAsCreate reducer", async () => {
        const mockScript = "CREATE TABLE example (...);";

        const state = {
            model: {
                script: {
                    value: mockScript,
                },
            },
        };

        await controller["_reducerHandlers"].get("scriptAsCreate")(state, mockPayload);

        assert.ok(
            newQueryStub.calledWith(mockScript),
            "newQuery should be called with script content",
        );

        newQueryStub.restore();
    });

    test("should set mainPaneTab in setTab reducer", async () => {
        const state = { tabStates: { mainPaneTab: "" } };
        const tabId = "properties";

        const result = await controller["_reducerHandlers"].get("setTab")(state as any, { tabId });

        assert.strictEqual(
            result.tabStates.mainPaneTab,
            tabId,
            "mainPaneTab should be set correctly",
        );
    });

    test("should set propertiesPaneData in setPropertiesComponents reducer", async () => {
        const mockComponents = [{ type: "input", id: "name" }];
        const state = {};

        const result = await controller["_reducerHandlers"].get("setPropertiesComponents")(state, {
            components: mockComponents,
        });

        assert.deepStrictEqual(
            result.propertiesPaneData,
            mockComponents,
            "propertiesPaneData should be set correctly",
        );
    });

    test("should set resultPaneTab in setResultTab reducer", async () => {
        const state = { tabStates: { resultPaneTab: "" } };
        const tabId = "preview";

        const result = await controller["_reducerHandlers"].get("setResultTab")(state as any, {
            tabId,
        });

        assert.strictEqual(
            result.tabStates.resultPaneTab,
            tabId,
            "resultPaneTab should be set correctly",
        );
    });

    test("should copy script to clipboard in copyScriptAsCreateToClipboard reducer", async () => {
        const infoStub = sinon.stub(vscode.window, "showInformationMessage").resolves();
        const writeTextStub = sinon.stub().resolves();
        const mockEnvClipboard = {
            ...vscode.env.clipboard,
            writeText: writeTextStub,
        };

        sandbox.replaceGetter(vscode.env, "clipboard", () => mockEnvClipboard);

        // Setup state
        const state = {
            model: {
                script: {
                    value: "Test value",
                },
            },
        };

        await controller["_reducerHandlers"].get("copyScriptAsCreateToClipboard")(
            state,
            mockPayload,
        );

        assert.ok(writeTextStub.calledOnce, "Clipboard writeText should be called once");

        assert.deepStrictEqual(
            writeTextStub.firstCall.args,
            ["Test value"],
            "writeStub should be called with correct arguments",
        );

        infoStub.restore();
    });

    test("should dispose panel and send telemetry in closeDesigner reducer", async () => {
        const disposeStub = sinon.stub(controller.panel, "dispose");

        const state = (controller as any)._state;

        await controller["_reducerHandlers"].get("closeDesigner")(state, mockPayload);

        assert.ok(disposeStub.calledOnce, "panel.dispose should be called");

        disposeStub.restore();
    });

    test("should set publishState and send telemetry in continueEditing reducer", async () => {
        const state = (controller as any)._state;

        await controller["_reducerHandlers"].get("continueEditing")(state, mockPayload);

        assert.strictEqual(
            controller.state.apiState.publishState,
            td.LoadState.NotStarted,
            "publishState should be set to NotStarted",
        );
    });

    test("should copy publishing error to clipboard in copyPublishErrorToClipboard reducer", async () => {
        const writeTextStub = sinon.stub().resolves();
        const showInfoStub = sinon.stub().resolves();

        const mockEnvClipboard = {
            ...vscode.env.clipboard,
            writeText: writeTextStub,
        };

        // Replace clipboard and window with stubs
        sandbox.replaceGetter(vscode.env, "clipboard", () => mockEnvClipboard);
        sandbox.replace(vscode.window, "showInformationMessage", showInfoStub);

        // Setup state
        const state = {
            publishingError: "Something went wrong",
        };

        await controller["_reducerHandlers"].get("copyPublishErrorToClipboard")(state, mockPayload);

        assert.ok(writeTextStub.calledOnce, "Clipboard writeText should be called once");
        assert.strictEqual(
            writeTextStub.firstCall.args[0],
            "Something went wrong",
            "writeText should be called with the publishing error",
        );

        assert.ok(showInfoStub.calledOnce, "showInformationMessage should be called once");
    });
});
