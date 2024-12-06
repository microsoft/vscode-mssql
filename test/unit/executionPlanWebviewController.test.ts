/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { ExecutionPlanWebviewController } from "../../src/controllers/executionPlanWebviewController";
import UntitledSqlDocumentService from "../../src/controllers/untitledSqlDocumentService";
import { ExecutionPlanService } from "../../src/services/executionPlanService";
import * as ep from "../../src/reactviews/pages/ExecutionPlan/executionPlanInterfaces";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import * as epUtils from "../../src/controllers/sharedExecutionPlanUtils";
import { contents } from "../resources/testsqlplan";

suite("ExecutionPlanWebviewController", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockExecutionPlanService: ExecutionPlanService;
    let mockUntitledSqlDocumentService: UntitledSqlDocumentService;
    let controller: ExecutionPlanWebviewController;

    const executionPlanContents = contents;
    const xmlPlanFileName = "testPlan.sqlplan";

    setup(() => {
        sandbox = sinon.createSandbox();
        mockContext = {
            extensionUri: vscode.Uri.parse("https://localhost"),
            extensionPath: "path",
        } as unknown as vscode.ExtensionContext;

        mockExecutionPlanService =
            sandbox.createStubInstance(ExecutionPlanService);
        mockUntitledSqlDocumentService = sandbox.createStubInstance(
            UntitledSqlDocumentService,
        );

        controller = new ExecutionPlanWebviewController(
            mockContext,
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
        const initialState: ep.ExecutionPlanWebviewState = {
            executionPlanState: {
                loadState: ApiStatus.Loading,
                executionPlanGraphs: [],
                totalCost: 0,
            },
        };

        assert.deepStrictEqual(
            controller.state,
            initialState,
            "Initial state should match",
        );
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
            .resolves({
                executionPlanState: {
                    executionPlanGraphs: [],
                    loadState: ApiStatus.Loaded,
                    totalCost: 100,
                },
            });

        // Mock state and payload for the reducer
        const mockState = {
            executionPlanState: {
                loadState: ApiStatus.Loading,
                executionPlanGraphs: [],
                totalCost: 0,
            },
        };

        await controller["_reducers"]["getExecutionPlan"](mockState, {});

        assert.ok(
            createExecutionPlanGraphsStub.calledOnce,
            "createExecutionPlanGraphs should be called once",
        );

        assert.deepStrictEqual(
            createExecutionPlanGraphsStub.firstCall.args,
            [
                mockState,
                controller.executionPlanService,
                [controller.executionPlanContents],
            ],
            "createExecutionPlanGraphs should be called with correct arguments",
        );

        createExecutionPlanGraphsStub.restore();
    });

    test("should call saveExecutionPlan in saveExecutionPlan reducer", async () => {
        const saveExecutionPlanStub = sandbox
            .stub(epUtils, "saveExecutionPlan")
            .resolves({
                executionPlanState: {
                    executionPlanGraphs: [],
                    loadState: ApiStatus.Loaded,
                    totalCost: 100,
                },
            });

        const mockPayload = {
            sqlPlanContent: executionPlanContents,
        };

        // Mock state and payload for the reducer
        const mockState = {
            executionPlanState: {
                loadState: ApiStatus.Loading,
                executionPlanGraphs: [],
                totalCost: 0,
            },
        };

        await controller["_reducers"]["saveExecutionPlan"](
            mockState,
            mockPayload,
        );

        assert.ok(
            saveExecutionPlanStub.calledOnce,
            "saveExecutionPlan should be called once",
        );

        assert.deepStrictEqual(
            saveExecutionPlanStub.firstCall.args,
            [mockState, mockPayload],
            "saveExecutionPlan should be called with correct arguments",
        );

        saveExecutionPlanStub.restore();
    });

    test("should call showPlanXml in showPlanXml reducer", async () => {
        const showPlanXmlStub = sandbox.stub(epUtils, "showPlanXml").resolves({
            executionPlanState: {
                executionPlanGraphs: [],
                loadState: ApiStatus.Loaded,
                totalCost: 100,
            },
        });

        const mockPayload = {
            sqlPlanContent: executionPlanContents,
        };

        // Mock state and payload for the reducer
        const mockState = {
            executionPlanState: {
                loadState: ApiStatus.Loading,
                executionPlanGraphs: [],
                totalCost: 0,
            },
        };

        await controller["_reducers"]["showPlanXml"](mockState, mockPayload);

        assert.ok(
            showPlanXmlStub.calledOnce,
            "showPlanXml should be called once",
        );

        assert.deepStrictEqual(
            showPlanXmlStub.firstCall.args,
            [mockState, mockPayload],
            "showPlanXml should be called with correct arguments",
        );

        showPlanXmlStub.restore();
    });

    test("should call showQuery in showQuery reducer", async () => {
        const showQueryStub = sandbox.stub(epUtils, "showQuery").resolves({
            executionPlanState: {
                executionPlanGraphs: [],
                loadState: ApiStatus.Loaded,
                totalCost: 100,
            },
        });

        const mockPayload = {
            query: "select * from sys.objects;",
        };

        // Mock state and payload for the reducer
        const mockState = {
            executionPlanState: {
                loadState: ApiStatus.Loading,
                executionPlanGraphs: [],
                totalCost: 0,
            },
        };

        await controller["_reducers"]["showQuery"](mockState, mockPayload);

        assert.ok(showQueryStub.calledOnce, "showQuery should be called once");

        assert.deepStrictEqual(
            showQueryStub.firstCall.args,
            [mockState, mockPayload, controller.untitledSqlDocumentService],
            "showQuery should be called with correct arguments",
        );

        showQueryStub.restore();
    });

    test("should call updateTotalCost in updateTotalCost reducer", async () => {
        const updateTotalCostStub = sandbox
            .stub(epUtils, "updateTotalCost")
            .resolves({
                executionPlanState: {
                    executionPlanGraphs: [],
                    loadState: ApiStatus.Loaded,
                    totalCost: 100,
                },
            });

        const mockPayload = {
            addedCost: 1,
        };

        // Mock state and payload for the reducer
        const mockState = {
            executionPlanState: {
                loadState: ApiStatus.Loading,
                executionPlanGraphs: [],
                totalCost: 0,
            },
        };

        await controller["_reducers"]["updateTotalCost"](
            mockState,
            mockPayload,
        );

        assert.ok(
            updateTotalCostStub.calledOnce,
            "updateTotalCost should be called once",
        );

        assert.deepStrictEqual(
            updateTotalCostStub.firstCall.args,
            [mockState, mockPayload],
            "showQuery should be called with correct arguments",
        );

        updateTotalCostStub.restore();
    });
});

suite("Execution Plan Utilities", () => {
    let sandbox: sinon.SinonSandbox;
    let mockExecutionPlanService: ExecutionPlanService;
    let mockUntitledSqlDocumentService: UntitledSqlDocumentService;
    let executionPlanContents: string;

    setup(() => {
        sandbox = sinon.createSandbox();

        executionPlanContents = contents;
        mockExecutionPlanService =
            sandbox.createStubInstance(ExecutionPlanService);
        mockUntitledSqlDocumentService = sandbox.createStubInstance(
            UntitledSqlDocumentService,
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    /*
    this needs cleaning up; i still need to implement mocking user input
    test("saveExecutionPlan: should call saveExecutionPlan and return the state", async () => {
        const mockState = {
            executionPlanState: {
                loadState: ApiStatus.Loading,
                executionPlanGraphs: [],
                totalCost: 0,
            },
        };

        const mockPayload = { sqlPlanContent: executionPlanContents };

        const result = await epUtils.saveExecutionPlan(
            mockState,
            mockPayload,
        );

    });
    */

    test("showXml: should call showXml and return the state", async () => {
        const openDocumentStub = sinon.stub(
            vscode.workspace,
            "openTextDocument",
        );

        const mockState = {
            executionPlanState: {
                loadState: ApiStatus.Loading,
                executionPlanGraphs: [],
                totalCost: 0,
            },
        };

        const mockPayload = { sqlPlanContent: executionPlanContents };

        const result = await epUtils.showPlanXml(mockState, mockPayload);
        sinon.assert.calledOnce(openDocumentStub);
        assert.strictEqual(
            result,
            mockState,
            "The state should be returned unchanged.",
        );
    });

    test("showQuery: should call newQuery with the correct query and return the state", async () => {
        (mockUntitledSqlDocumentService.newQuery as sinon.SinonStub).resolves();

        const mockState = {
            executionPlanState: {
                loadState: ApiStatus.Loading,
                executionPlanGraphs: [],
                totalCost: 0,
            },
        };

        const mockPayload = { query: "SELECT * FROM TestTable" };

        const result = await epUtils.showQuery(
            mockState,
            mockPayload,
            mockUntitledSqlDocumentService,
        );

        assert.strictEqual(
            result,
            mockState,
            "The state should be returned unchanged.",
        );
        sinon.assert.calledOnceWithExactly(
            mockUntitledSqlDocumentService.newQuery as sinon.SinonStub,
            mockPayload.query,
        );
    });

    test("createExecutionPlanGraphs: should create executionPlanGraphs correctly and return the state", async () => {
        (
            mockExecutionPlanService.getExecutionPlan as sinon.SinonStub
        ).resolves();

        const mockState = {
            executionPlanState: {
                loadState: ApiStatus.Loading,
                executionPlanGraphs: [],
                totalCost: 0,
            },
        };

        const result = await epUtils.createExecutionPlanGraphs(
            mockState,
            mockExecutionPlanService,
            [executionPlanContents],
        );

        console.log(result);

        const planFile: ep.ExecutionPlanGraphInfo = {
            graphFileContent: executionPlanContents,
            graphFileType: `.sqlplan`,
        };

        sinon.assert.calledOnceWithExactly(
            mockExecutionPlanService.getExecutionPlan as sinon.SinonStub,
            planFile,
        );
    });

    test("updateTotalCost: should call updateTotalCost with the added cost and return the updated state", async () => {
        const mockState = {
            executionPlanState: {
                loadState: ApiStatus.Loading,
                executionPlanGraphs: [],
                totalCost: 0,
            },
        };

        const mockPayload = { addedCost: 100 };

        const result = await epUtils.updateTotalCost(mockState, mockPayload);

        assert.strictEqual(
            result.executionPlanState.totalCost,
            100,
            "The state should be returned with new cost.",
        );
    });

    test("calculateTotalCost: should return 0 and set loadState to Error if executionPlanGraphs is undefined", () => {
        const mockState: any = {
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
        const mockState: any = {
            executionPlanState: {
                executionPlanGraphs: [
                    { root: { cost: 10, subTreeCost: 20 } },
                    { root: { cost: 5, subTreeCost: 15 } },
                ],
                loadState: ApiStatus.Loaded,
            },
        };

        const result = epUtils.calculateTotalCost(mockState);

        assert.strictEqual(
            result,
            50,
            "Total cost should correctly sum up the costs and subtree costs",
        );
    });

    test("calculateTotalCost: should return 0 if executionPlanGraphs is empty", () => {
        const mockState: any = {
            executionPlanState: {
                executionPlanGraphs: [],
                loadState: ApiStatus.Loaded,
            },
        };

        const result = epUtils.calculateTotalCost(mockState);

        assert.strictEqual(
            result,
            0,
            "Total cost should be 0 for an empty executionPlanGraphs array",
        );
    });

    test("formatXml: should return original xml contents if it is not a valid xml file", () => {
        const invalidXml = "</";
        const result = epUtils.formatXml(invalidXml);
        assert.strictEqual(result, invalidXml);
    });
});
