/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { ExecutionPlanWebviewController } from "../../src/extension/controllers/executionPlanWebviewController";
import UntitledSqlDocumentService from "../../src/extension/controllers/untitledSqlDocumentService";
import { ExecutionPlanService } from "../../src/extension/services/executionPlanService";
import * as ep from "../../src/shared/executionPlanInterfaces";
import { ApiStatus } from "../../src/shared/webview";
import * as epUtils from "../../src/extension/controllers/sharedExecutionPlanUtils";
import { contents } from "../resources/testsqlplan";
import * as TypeMoq from "typemoq";
import SqlToolsServiceClient from "../../src/extension/languageservice/serviceclient";
import { GetExecutionPlanRequest } from "../../src/extension/models/contracts/executionPlan";
import VscodeWrapper from "../../src/extension/controllers/vscodeWrapper";

suite("ExecutionPlanWebviewController", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockExecutionPlanService: ExecutionPlanService;
    let mockUntitledSqlDocumentService: UntitledSqlDocumentService;
    let controller: ExecutionPlanWebviewController;
    let mockInitialState: ep.ExecutionPlanWebviewState;
    let mockResultState: ep.ExecutionPlanWebviewState;
    let vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;

    const executionPlanContents = contents;
    const xmlPlanFileName = "testPlan.sqlplan";

    setup(() => {
        sandbox = sinon.createSandbox();
        mockContext = {
            extensionUri: vscode.Uri.parse("https://localhost"),
            extensionPath: "path",
        } as unknown as vscode.ExtensionContext;

        mockExecutionPlanService = sandbox.createStubInstance(ExecutionPlanService);
        mockUntitledSqlDocumentService = sandbox.createStubInstance(UntitledSqlDocumentService);

        vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);

        mockInitialState = {
            executionPlanState: {
                loadState: ApiStatus.Loading,
                executionPlanGraphs: [],
                totalCost: 0,
            },
        };

        mockResultState = {
            executionPlanState: {
                executionPlanGraphs: [],
                loadState: ApiStatus.Loaded,
                totalCost: 100,
            },
        };

        controller = new ExecutionPlanWebviewController(
            mockContext,
            vscodeWrapper.object,
            mockExecutionPlanService,
            mockUntitledSqlDocumentService,
            executionPlanContents,
            xmlPlanFileName,
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    test("should initialize with correct state and webview title", () => {
        assert.deepStrictEqual(controller.state, mockInitialState, "Initial state should match");
        assert.deepStrictEqual(
            controller.panel.title,
            xmlPlanFileName,
            "Webview Title should match",
        );
    });

    test("should call createExecutionPlanGraphs in getExecutionPlan reducer", async () => {
        // Stub createExecutionPlanGraphs to mock its behavior
        const createExecutionPlanGraphsStub = sandbox
            .stub(epUtils, "createExecutionPlanGraphs")
            .resolves(mockResultState);

        const result = await controller["_reducerHandlers"].get("getExecutionPlan")(
            mockInitialState,
            {},
        );

        assert.ok(
            createExecutionPlanGraphsStub.calledOnce,
            "createExecutionPlanGraphs should be called once",
        );

        assert.deepStrictEqual(
            createExecutionPlanGraphsStub.firstCall.args,
            [
                mockInitialState,
                controller.executionPlanService,
                [controller.executionPlanContents],
                "SqlplanFile",
            ],
            "createExecutionPlanGraphs should be called with correct arguments",
        );

        assert.deepStrictEqual(
            result,
            mockResultState,
            "State should have an updated total cost, api status, and graphs",
        );

        createExecutionPlanGraphsStub.restore();
    });

    test("should call saveExecutionPlan in saveExecutionPlan reducer", async () => {
        const saveExecutionPlanStub = sandbox
            .stub(epUtils, "saveExecutionPlan")
            .resolves(mockInitialState);

        const mockPayload = {
            sqlPlanContent: executionPlanContents,
        };

        const result = await controller["_reducerHandlers"].get("saveExecutionPlan")(
            mockInitialState,
            mockPayload,
        );

        assert.ok(saveExecutionPlanStub.calledOnce, "saveExecutionPlan should be called once");

        assert.deepStrictEqual(
            saveExecutionPlanStub.firstCall.args,
            [mockInitialState, mockPayload],
            "saveExecutionPlan should be called with correct arguments",
        );

        assert.deepStrictEqual(result, mockInitialState, "State should not be changed");

        saveExecutionPlanStub.restore();
    });

    test("should call showPlanXml in showPlanXml reducer", async () => {
        const showPlanXmlStub = sandbox.stub(epUtils, "showPlanXml").resolves(mockInitialState);

        const mockPayload = {
            sqlPlanContent: executionPlanContents,
        };

        const result = await controller["_reducerHandlers"].get("showPlanXml")(
            mockInitialState,
            mockPayload,
        );

        assert.ok(showPlanXmlStub.calledOnce, "showPlanXml should be called once");

        assert.deepStrictEqual(
            showPlanXmlStub.firstCall.args,
            [mockInitialState, mockPayload],
            "showPlanXml should be called with correct arguments",
        );

        assert.deepStrictEqual(result, mockInitialState, "State should not be changed");

        showPlanXmlStub.restore();
    });

    test("should call showQuery in showQuery reducer", async () => {
        const showQueryStub = sandbox.stub(epUtils, "showQuery").resolves(mockInitialState);

        const mockPayload = {
            query: "select * from sys.objects;",
        };

        const result = await controller["_reducerHandlers"].get("showQuery")(
            mockInitialState,
            mockPayload,
        );

        assert.ok(showQueryStub.calledOnce, "showQuery should be called once");

        assert.deepStrictEqual(
            showQueryStub.firstCall.args,
            [mockInitialState, mockPayload, controller.untitledSqlDocumentService],
            "showQuery should be called with correct arguments",
        );

        assert.deepStrictEqual(result, mockInitialState, "State should not be changed");

        showQueryStub.restore();
    });

    test("should call updateTotalCost in updateTotalCost reducer", async () => {
        const updateTotalCostStub = sandbox.stub(epUtils, "updateTotalCost").resolves({
            executionPlanState: {
                executionPlanGraphs: [],
                loadState: ApiStatus.Loaded,
                totalCost: 100,
            },
        });

        const mockPayload = {
            addedCost: 100,
        };

        const result = await controller["_reducerHandlers"].get("updateTotalCost")(
            mockInitialState,
            mockPayload,
        );

        assert.ok(updateTotalCostStub.calledOnce, "updateTotalCost should be called once");

        assert.deepStrictEqual(
            updateTotalCostStub.firstCall.args,
            [mockInitialState, mockPayload],
            "showQuery should be called with correct arguments",
        );

        assert.deepStrictEqual(result, mockResultState, "State should have an updated total cost");

        updateTotalCostStub.restore();
    });
});

suite("Execution Plan Utilities", () => {
    let sandbox: sinon.SinonSandbox;
    let mockExecutionPlanService: ExecutionPlanService;
    let mockUntitledSqlDocumentService: UntitledSqlDocumentService;
    let executionPlanContents: string;
    let client: TypeMoq.IMock<SqlToolsServiceClient>;
    let mockResult: ep.GetExecutionPlanResult;
    let mockInitialState: ep.ExecutionPlanWebviewState;

    setup(() => {
        sandbox = sinon.createSandbox();

        executionPlanContents = contents;

        mockResult = {
            graphs: TypeMoq.It.isAny(),
            success: TypeMoq.It.isAny(),
            errorMessage: TypeMoq.It.isAny(),
        };

        mockInitialState = {
            executionPlanState: {
                loadState: ApiStatus.Loading,
                executionPlanGraphs: [],
                totalCost: 0,
            },
        };

        client = TypeMoq.Mock.ofType(SqlToolsServiceClient, TypeMoq.MockBehavior.Loose);
        client
            .setup((c) => c.sendRequest(GetExecutionPlanRequest.type, TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(mockResult));

        mockExecutionPlanService = new ExecutionPlanService(client.object);
        mockUntitledSqlDocumentService = sandbox.createStubInstance(UntitledSqlDocumentService);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("saveExecutionPlan: should call saveExecutionPlan and return the state", async () => {
        const mockPayload = { sqlPlanContent: executionPlanContents };

        const mockUri = vscode.Uri.file("/plan.sqlplan");

        const showSaveDialogStub = sinon.stub(vscode.window, "showSaveDialog").resolves(mockUri);

        const writeFileStub = sinon.stub().resolves();
        const mockFs = {
            ...vscode.workspace.fs,
            writeFile: writeFileStub,
        };

        // replace vscode.workspace.fs with mockfs
        sandbox.replaceGetter(vscode.workspace, "fs", () => mockFs);

        const result = await epUtils.saveExecutionPlan(mockInitialState, mockPayload);

        assert.deepEqual(result, mockInitialState, "State should not change");

        // Checks the file was saved
        sinon.assert.calledOnce(writeFileStub);

        showSaveDialogStub.restore();
    });

    test("showXml: should call showXml and return the state", async () => {
        const openDocumentStub = sinon.stub(vscode.workspace, "openTextDocument");

        const mockPayload = { sqlPlanContent: executionPlanContents };

        const result = await epUtils.showPlanXml(mockInitialState, mockPayload);
        sinon.assert.calledOnce(openDocumentStub);
        assert.strictEqual(result, mockInitialState, "The state should be returned unchanged.");
    });

    test("showQuery: should call newQuery with the correct query and return the state", async () => {
        (mockUntitledSqlDocumentService.newQuery as sinon.SinonStub).resolves();

        const mockPayload = { query: "SELECT * FROM TestTable" };

        const result = await epUtils.showQuery(
            mockInitialState,
            mockPayload,
            mockUntitledSqlDocumentService,
        );

        assert.strictEqual(result, mockInitialState, "The state should be returned unchanged.");
        sinon.assert.calledOnceWithExactly(
            mockUntitledSqlDocumentService.newQuery as sinon.SinonStub,
            mockPayload.query,
        );
    });

    test("createExecutionPlanGraphs: should create executionPlanGraphs correctly and return the state", async () => {
        const getExecutionPlanStub = sandbox
            .stub(mockExecutionPlanService, "getExecutionPlan")
            .resolves({
                graphs: [],
                success: true,
                errorMessage: "",
            });

        const result = await epUtils.createExecutionPlanGraphs(
            mockInitialState,
            mockExecutionPlanService,
            [executionPlanContents],
            "Tests" as never,
        );

        const planFile: ep.ExecutionPlanGraphInfo = {
            graphFileContent: executionPlanContents,
            graphFileType: `.sqlplan`,
        };

        sinon.assert.calledOnceWithExactly(getExecutionPlanStub, planFile);

        assert.notEqual(result, undefined);
        assert.deepStrictEqual(
            result.executionPlanState.loadState,
            ApiStatus.Loaded,
            "The api status of the state should be properly updated",
        );
    });

    test("createExecutionPlanGraphs: should register error and update the state", async () => {
        const getExecutionPlanStub = sandbox
            .stub(mockExecutionPlanService, "getExecutionPlan")
            .rejects(new Error("Mock Error"));

        const result = await epUtils.createExecutionPlanGraphs(
            mockInitialState,
            mockExecutionPlanService,
            [executionPlanContents],
            "Tests" as never,
        );

        const planFile: ep.ExecutionPlanGraphInfo = {
            graphFileContent: executionPlanContents,
            graphFileType: `.sqlplan`,
        };

        sinon.assert.calledOnceWithExactly(getExecutionPlanStub, planFile);

        assert.notDeepEqual(result, undefined, "The resulting state should be defined");
        assert.deepStrictEqual(
            result.executionPlanState.loadState,
            ApiStatus.Error,
            "The load state should be updated",
        );
        assert.deepStrictEqual(
            result.executionPlanState.errorMessage,
            "Mock Error",
            "The correct error message should be updated in state",
        );
    });

    test("updateTotalCost: should call updateTotalCost with the added cost and return the updated state", async () => {
        const mockPayload = { addedCost: 100 };

        const result = await epUtils.updateTotalCost(mockInitialState, mockPayload);

        assert.strictEqual(
            result.executionPlanState.totalCost,
            100,
            "The state should be returned with new cost.",
        );
    });

    test("calculateTotalCost: should return 0 and set loadState to Error if executionPlanGraphs is undefined", () => {
        let mockState: any = {
            executionPlanState: {
                executionPlanGraphs: undefined,
                loadState: ApiStatus.Loading,
            },
        };

        const result = epUtils.calculateTotalCost(mockState);

        assert.strictEqual(
            result,
            0,
            "Total cost should be 0 when executionPlanGraphs is undefined",
        );
        assert.strictEqual(
            mockState.executionPlanState.loadState,
            ApiStatus.Error,
            "loadState should be set to Error",
        );
    });

    test("calculateTotalCost: should correctly calculate the total cost for a valid state", () => {
        const mockInitialState: any = {
            executionPlanState: {
                executionPlanGraphs: [
                    { root: { cost: 10, subTreeCost: 20 } },
                    { root: { cost: 5, subTreeCost: 15 } },
                ],
                loadState: ApiStatus.Loaded,
            },
        };

        const result = epUtils.calculateTotalCost(mockInitialState);

        assert.strictEqual(
            result,
            50,
            "Total cost should correctly sum up the costs and subtree costs",
        );
    });

    test("calculateTotalCost: should return 0 if executionPlanGraphs is empty", () => {
        const result = epUtils.calculateTotalCost(mockInitialState);

        assert.strictEqual(
            result,
            0,
            "Total cost should be 0 for an empty executionPlanGraphs array",
        );
    });

    test("formatXml: should return original xml contents if it is not a valid xml file", () => {
        const invalidXml = "</";
        const result = epUtils.formatXml(invalidXml);
        assert.strictEqual(result, invalidXml, "Xml input should not be changed if invalid format");
    });
});
