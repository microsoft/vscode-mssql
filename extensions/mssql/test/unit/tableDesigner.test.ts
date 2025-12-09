/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import * as tdTab from "../../src/tableDesigner/tableDesignerTabDefinition";
import { TableDesignerWebviewController } from "../../src/tableDesigner/tableDesignerWebviewController";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import * as td from "../../src/sharedInterfaces/tableDesigner";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import { TableDesignerService } from "../../src/services/tableDesignerService";
import SqlDocumentService, { ConnectionStrategy } from "../../src/controllers/sqlDocumentService";
import ConnectionManager from "../../src/controllers/connectionManager";
import { stubExtensionContext, stubUserSurvey } from "./utils";

chai.use(sinonChai);

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
        mockContext = stubExtensionContext(sandbox);
        stubUserSurvey(sandbox);

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
        mockConnectionManager.prepareConnectionInfo.callsFake((connInfo) =>
            Promise.resolve(connInfo),
        );

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

        expect(treeNode.connectionProfile, "Connection profile should be defined").to.deep.equal(
            mockConnectionProfile,
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

        expect(controller.panel.title, "Panel title should be table name").to.equal(
            "Table Designer",
        );
        await (controller as any).initialize();
        await (controller as any).registerRpcHandlers();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("should initialize correctly for table edit", async () => {
        expect(
            (controller as any)._state.apiState.initializeState,
            "Initialize state should be loaded",
        ).to.equal(td.LoadState.Loaded);
        expect(
            (controller as any)._state.tableInfo.database,
            "Table Info should be loaded",
        ).to.equal("master");
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

        expect(
            processTableEditStub,
            "processTableEdit should be called once with correct arguments",
        ).to.have.been.calledOnceWithExactly(mockPayload.table, mockPayload.tableChangeInfo);
        expect(result.tabStates.resultPaneTab, "State tab should be set to Script").to.equal(
            td.DesignerResultPaneTabs.Script,
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

        expect(
            secondStub,
            "processTableEdit should be called again with correct arguments",
        ).to.have.been.calledOnceWithExactly(mockPayload.table, mockPayload.tableChangeInfo);
        expect(
            result.tabStates.resultPaneTab,
            "Tab should be set to Issues when there are issues",
        ).to.equal(td.DesignerResultPaneTabs.Issues);
        expect(
            result.view,
            "Should retain previous view when editResponse.view is undefined",
        ).to.deep.equal(callState.view);

        secondStub.restore(); // Cleanup
        const errorMessage = "error message";
        sinon.stub(mockTableDesignerService, "processTableEdit").rejects(new Error(errorMessage));
        const errorStub = sinon.stub(vscode.window, "showErrorMessage");

        result = await controller["_reducerHandlers"].get("processTableEdit")(
            callState,
            mockPayload,
        );

        expect(
            errorStub,
            "Error message call should use correct arguments",
        ).to.have.been.calledOnceWithExactly(errorMessage);
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

        expect(
            publishChangesStub,
            "publishChanges should be called once with correct arguments",
        ).to.have.been.calledOnceWithExactly(mockPublishPayload.table);
        expect(result.apiState.publishState, "Publish State should be loaded").to.equal(
            td.LoadState.Loaded,
        );

        expect(result.apiState.previewState, "Preview State should be not started").to.equal(
            td.LoadState.NotStarted,
        );

        expect(controller.panel.title, "Panel title should be table name").to.equal(
            publishResponse.newTableInfo.title,
        );

        publishChangesStub.restore();

        const errorMessage = "error message";
        sinon.stub(mockTableDesignerService, "publishChanges").rejects(new Error(errorMessage));

        result = await controller["_reducerHandlers"].get("publishChanges")(
            callState,
            mockPublishPayload,
        );

        expect(result.publishingError, "State should contain error message").to.equal(
            `Error: ${errorMessage}`,
        );

        expect(result.apiState.publishState, "State should contain correct status").to.equal(
            td.LoadState.Error,
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

        expect(
            scriptStub,
            "generateScript should be called once with correct arguments",
        ).to.have.been.calledOnceWithExactly(mockScriptPayload.table);
        expect(
            newQueryStub,
            "newQuery should be called once with the generated script",
        ).to.have.been.calledOnceWithExactly({
            content: scriptResponse,
            connectionStrategy: ConnectionStrategy.CopyConnectionFromInfo,
            connectionInfo: undefined,
        });

        expect(result.apiState.generateScriptState, "Script State should be loaded").to.equal(
            td.LoadState.Loaded,
        );

        expect(result.apiState.previewState, "Preview State should be not started").to.equal(
            td.LoadState.NotStarted,
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

        expect(
            generatePreviewStub,
            "generatePreviewReport should be called once with correct arguments",
        ).to.have.been.calledOnceWithExactly(mockPreviewPayload.table);

        expect(
            result.apiState.previewState,
            "Preview state should be Loaded when no validation error",
        ).to.equal(td.LoadState.Loaded);
        expect(result.apiState.publishState, "Publish state should remain NotStarted").to.equal(
            td.LoadState.NotStarted,
        );
        expect(
            result.generatePreviewReportResult,
            "Should store the preview report result",
        ).to.deep.equal(previewResponse);

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

        expect(result.apiState.previewState, "Preview state should be Error on failure").to.equal(
            td.LoadState.Error,
        );
        expect(
            result.apiState.publishState,
            "Publish state should remain NotStarted on failure",
        ).to.equal(td.LoadState.NotStarted);
        expect(
            result.generatePreviewReportResult.schemaValidationError,
            "Should include error message in result",
        ).to.equal(errorMessage);
    });

    test("should set mainPaneTab in setTab reducer", async () => {
        const state = { tabStates: { mainPaneTab: "" } };
        const tabId = "properties";

        const result = await controller["_reducerHandlers"].get("setTab")(state as any, { tabId });

        expect(result.tabStates.mainPaneTab, "mainPaneTab should be set correctly").to.equal(tabId);
    });

    test("should set propertiesPaneData in setPropertiesComponents reducer", async () => {
        const mockComponents = [{ type: "input", id: "name" }];
        const state = {};

        const result = await controller["_reducerHandlers"].get("setPropertiesComponents")(state, {
            components: mockComponents,
        });

        expect(
            result.propertiesPaneData,
            "propertiesPaneData should be set correctly",
        ).to.deep.equal(mockComponents);
    });

    test("should set resultPaneTab in setResultTab reducer", async () => {
        const state = { tabStates: { resultPaneTab: "" } };
        const tabId = "preview";

        const result = await controller["_reducerHandlers"].get("setResultTab")(state as any, {
            tabId,
        });

        expect(result.tabStates.resultPaneTab, "resultPaneTab should be set correctly").to.equal(
            tabId,
        );
    });

    test("should set publishState and send telemetry in continueEditing reducer", async () => {
        const state = (controller as any)._state;

        await controller["_reducerHandlers"].get("continueEditing")(state, mockPayload);

        expect(
            controller.state.apiState.publishState,
            "publishState should be set to NotStarted",
        ).to.equal(td.LoadState.NotStarted);
    });
});
