/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as tdTab from "../../src/tableDesigner/tableDesignerTabDefinition";
import { TableDesignerWebviewController } from "../../src/tableDesigner/tableDesignerWebviewController";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import * as td from "../../src/sharedInterfaces/tableDesigner";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import { TableDesignerService } from "../../src/services/tableDesignerService";
import SqlDocumentService, { ConnectionStrategy } from "../../src/controllers/sqlDocumentService";
import ConnectionManager from "../../src/controllers/connectionManager";
import { getMockContext } from "./utils";

suite("TableDesignerWebviewController tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockVscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let controller: TableDesignerWebviewController;
    let treeNode: sinon.SinonStubbedInstance<TreeNodeInfo>;
    let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let mockTableDesignerService: sinon.SinonStubbedInstance<TableDesignerService>;
    let mockSqlDocumentService: sinon.SinonStubbedInstance<SqlDocumentService>;
    let newQueryStub: sinon.SinonStub;
    const tableName = "TestTable";
    let mockResult: any;
    let mockTableChangeInfo: any;
    let mockPayload: any;

    setup(async () => {
        sandbox = sinon.createSandbox();
        mockContext = getMockContext();

        mockVscodeWrapper = sandbox.createStubInstance(VscodeWrapper);
        mockTableDesignerService = sandbox.createStubInstance(TableDesignerService);
        mockSqlDocumentService = sandbox.createStubInstance(SqlDocumentService);
        mockConnectionManager = sandbox.createStubInstance(ConnectionManager);

        const mockConnectionDetails = {
            server: "localhost",
            database: "master",
            connectionString: "Server=localhost;Database=master;",
            authenticationType: "SqlLogin",
        };

        mockConnectionManager.createConnectionDetails.returns(mockConnectionDetails as any);
        mockConnectionManager.getConnectionString.resolves(mockConnectionDetails.connectionString);
        mockConnectionManager.getUriForConnection.returns("localhost,1433_undefined_sa_undefined");
        mockConnectionManager.confirmEntraTokenValidity.resolves();

        treeNode = sandbox.createStubInstance(TreeNodeInfo);
        sandbox.stub(treeNode, "nodeType").get(() => "Table");
        sandbox.stub(treeNode, "nodePath").get(() => "localhost,1433/Databases");
        treeNode.label = tableName as any;
        sandbox.stub(treeNode, "context").get(
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

        sandbox.stub(treeNode, "connectionProfile").get(() => mockConnectionProfile as any);
        sandbox.stub(treeNode, "metadata").get(() => mockMetadata as any);

        assert.deepStrictEqual(
            treeNode.connectionProfile,
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
            type: treeNode.nodeType,
            source: treeNode.nodePath,
        };

        mockPayload = {
            table: mockResult.tableInfo,
            tableChangeInfo: mockTableChangeInfo,
        };

        newQueryStub = mockSqlDocumentService.newQuery.resolves();

        mockTableDesignerService.initializeTableDesigner.resolves(mockResult);

        sandbox.stub(tdTab, "getDesignerView").returns({ tabs: [] });

        controller = new TableDesignerWebviewController(
            mockContext,
            mockVscodeWrapper,
            mockTableDesignerService,
            mockConnectionManager,
            mockSqlDocumentService,
            treeNode,
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
        } as td.DesignerEditResult<td.TableDesignerView>;

        // First scenario: no issues, view is defined
        let processTableEditStub = mockTableDesignerService.processTableEdit.resolves(editResponse);

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
            issues: [
                { description: "issue1", severity: "warning" },
                { description: "issue2", severity: "error" },
            ],
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
            view: { useAdvancedSaveMode: false },
            viewModel: {},
            newTableInfo: { ...mockResult.tableInfo, title: "NewTable" },
        } as td.PublishChangesResult;

        // First scenario: no issues, view is defined
        let publishChangesStub = mockTableDesignerService.publishChanges.resolves(publishResponse);

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
        let scriptStub = mockTableDesignerService.generateScript.resolves(scriptResponse);

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
            [
                {
                    content: scriptResponse,
                    connectionStrategy: ConnectionStrategy.CopyConnectionFromInfo,
                    connectionInfo: undefined,
                },
            ],
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

        const generatePreviewStub =
            mockTableDesignerService.generatePreviewReport.resolves(previewResponse);

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

    test("should set publishState and send telemetry in continueEditing reducer", async () => {
        const state = (controller as any)._state;

        await controller["_reducerHandlers"].get("continueEditing")(state, mockPayload);

        assert.strictEqual(
            controller.state.apiState.publishState,
            td.LoadState.NotStarted,
            "publishState should be set to NotStarted",
        );
    });
});
