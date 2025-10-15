/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { ExecutionPlanWebviewController } from "../../src/controllers/executionPlanWebviewController";
import SqlDocumentService, { ConnectionStrategy } from "../../src/controllers/sqlDocumentService";
import { ExecutionPlanService } from "../../src/services/executionPlanService";
import * as ep from "../../src/sharedInterfaces/executionPlan";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import * as epUtils from "../../src/controllers/sharedExecutionPlanUtils";
import { contents } from "../resources/testsqlplan";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { GetExecutionPlanRequest } from "../../src/models/contracts/executionPlan";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { stubVscodeWrapper } from "./utils";

chai.use(sinonChai);

suite("ExecutionPlanWebviewController", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockExecutionPlanService: ExecutionPlanService;
    let mockSqlDocumentService: SqlDocumentService;
    let controller: ExecutionPlanWebviewController;
    let mockInitialState: ep.ExecutionPlanWebviewState;
    let mockResultState: ep.ExecutionPlanWebviewState;
    let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;

    const executionPlanContents = contents;
    const xmlPlanFileName = "testPlan.sqlplan";

    setup(() => {
        sandbox = sinon.createSandbox();
        mockContext = {
            extensionUri: vscode.Uri.parse("https://localhost"),
            extensionPath: "path",
        } as unknown as vscode.ExtensionContext;

        mockExecutionPlanService = sandbox.createStubInstance(ExecutionPlanService);
        mockSqlDocumentService = sandbox.createStubInstance(SqlDocumentService);

        vscodeWrapper = stubVscodeWrapper(sandbox);

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
            vscodeWrapper,
            mockExecutionPlanService,
            mockSqlDocumentService,
            executionPlanContents,
            xmlPlanFileName,
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    test("should initialize with correct state and webview title", () => {
        expect(controller.state, "Initial state should match").to.deep.equal(mockInitialState);
        expect(controller.panel.title, "Webview Title should match").to.equal(xmlPlanFileName);
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

        expect(createExecutionPlanGraphsStub).to.have.been.calledOnce;

        expect(createExecutionPlanGraphsStub).to.have.been.calledWithExactly(
            mockInitialState,
            controller.executionPlanService,
            [controller.executionPlanContents],
            "SqlplanFile",
        );

        expect(
            result,
            "State should have an updated total cost, api status, and graphs",
        ).to.deep.equal(mockResultState);

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

        expect(saveExecutionPlanStub).to.have.been.calledOnce;

        expect(saveExecutionPlanStub).to.have.been.calledWithExactly(mockInitialState, mockPayload);

        expect(result, "State should not be changed").to.deep.equal(mockInitialState);

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

        expect(showPlanXmlStub).to.have.been.calledOnce;

        expect(showPlanXmlStub).to.have.been.calledWithExactly(mockInitialState, mockPayload);

        expect(result, "State should not be changed").to.deep.equal(mockInitialState);

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

        expect(showQueryStub).to.have.been.calledOnce;

        expect(showQueryStub).to.have.been.calledWithExactly(
            mockInitialState,
            mockPayload,
            controller.sqlDocumentService,
        );

        expect(result, "State should not be changed").to.deep.equal(mockInitialState);

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

        expect(updateTotalCostStub).to.have.been.calledOnce;

        expect(updateTotalCostStub).to.have.been.calledWithExactly(mockInitialState, mockPayload);

        expect(result, "State should have an updated total cost").to.deep.equal(mockResultState);

        updateTotalCostStub.restore();
    });
});

suite("Execution Plan Utilities", () => {
    let sandbox: sinon.SinonSandbox;
    let mockExecutionPlanService: ExecutionPlanService;
    let mockSqlDocumentService: SqlDocumentService;
    let executionPlanContents: string;
    let client: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let mockResult: ep.GetExecutionPlanResult;
    let mockInitialState: ep.ExecutionPlanWebviewState;

    setup(() => {
        sandbox = sinon.createSandbox();

        executionPlanContents = contents;

        mockResult = {
            graphs: [],
            success: true,
            errorMessage: "",
        };

        mockInitialState = {
            executionPlanState: {
                loadState: ApiStatus.Loading,
                executionPlanGraphs: [],
                totalCost: 0,
            },
        };

        client = sandbox.createStubInstance(SqlToolsServiceClient);
        client.sendRequest
            .withArgs(GetExecutionPlanRequest.type, sinon.match.any)
            .resolves(mockResult);

        mockExecutionPlanService = new ExecutionPlanService(client);
        mockSqlDocumentService = sandbox.createStubInstance(SqlDocumentService);
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

        expect(result, "State should not change").to.deep.equal(mockInitialState);

        expect(writeFileStub).to.have.been.calledOnce;

        showSaveDialogStub.restore();
    });

    test("showXml: should call showXml and return the state", async () => {
        const openDocumentStub = sandbox.stub(vscode.workspace, "openTextDocument");

        const mockPayload = { sqlPlanContent: executionPlanContents };

        const result = await epUtils.showPlanXml(mockInitialState, mockPayload);
        expect(openDocumentStub).to.have.been.calledOnce;
        expect(result, "The state should be returned unchanged.").to.equal(mockInitialState);
    });

    test("showQuery: should call newQuery with copyConnectionFromUri when URI is provided", async () => {
        (mockSqlDocumentService.newQuery as sinon.SinonStub).resolves();

        const mockPayload = { query: "SELECT * FROM TestTable" };
        const mockUri = "file:///test.sql";

        const result = await epUtils.showQuery(
            mockInitialState,
            mockPayload,
            mockSqlDocumentService,
            mockUri,
        );

        expect(result, "The state should be returned unchanged.").to.equal(mockInitialState);
        expect(
            mockSqlDocumentService.newQuery as sinon.SinonStub,
        ).to.have.been.calledOnceWithExactly({
            content: mockPayload.query,
            connectionStrategy: ConnectionStrategy.CopyFromUri,
            sourceUri: mockUri,
        });
    });

    test("showQuery: should fallback to copyLastActiveConnection when no URI is provided", async () => {
        (mockSqlDocumentService.newQuery as sinon.SinonStub).resolves();

        const mockPayload = { query: "SELECT * FROM TestTable" };

        const result = await epUtils.showQuery(
            mockInitialState,
            mockPayload,
            mockSqlDocumentService,
        );

        expect(result, "The state should be returned unchanged.").to.equal(mockInitialState);
        expect(
            mockSqlDocumentService.newQuery as sinon.SinonStub,
        ).to.have.been.calledOnceWithExactly({
            content: mockPayload.query,
            connectionStrategy: ConnectionStrategy.DoNotConnect,
            sourceUri: undefined,
        });
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

        expect(getExecutionPlanStub).to.have.been.calledOnceWithExactly(planFile);

        expect(result).to.not.equal(undefined);
        expect(
            result.executionPlanState.loadState,
            "The api status of the state should be properly updated",
        ).to.equal(ApiStatus.Loaded);
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

        expect(getExecutionPlanStub).to.have.been.calledOnceWithExactly(planFile);

        expect(result, "The resulting state should be defined").to.not.deep.equal(undefined);
        expect(result.executionPlanState.loadState, "The load state should be updated").to.equal(
            ApiStatus.Error,
        );
        expect(
            result.executionPlanState.errorMessage,
            "The correct error message should be updated in state",
        ).to.equal("Mock Error");
    });

    test("updateTotalCost: should call updateTotalCost with the added cost and return the updated state", async () => {
        const mockPayload = { addedCost: 100 };

        const result = await epUtils.updateTotalCost(mockInitialState, mockPayload);

        expect(
            result.executionPlanState.totalCost,
            "The state should be returned with new cost.",
        ).to.equal(100);
    });

    test("calculateTotalCost: should return 0 and set loadState to Error if executionPlanGraphs is undefined", () => {
        let mockState: ep.ExecutionPlanWebviewState = {
            executionPlanState: {
                executionPlanGraphs: undefined,
                loadState: ApiStatus.Loading,
            },
        };

        const result = epUtils.calculateTotalCost(mockState);

        expect(result, "Total cost should be 0 when executionPlanGraphs is undefined").to.equal(0);
        expect(mockState.executionPlanState.loadState, "loadState should be set to Error").to.equal(
            ApiStatus.Error,
        );
    });

    test("calculateTotalCost: should correctly calculate the total cost for a valid state", () => {
        const mockInitialState: ep.ExecutionPlanWebviewState = {
            executionPlanState: {
                executionPlanGraphs: [
                    { root: { cost: 10, subTreeCost: 20 } } as ep.ExecutionPlanGraph,
                    { root: { cost: 5, subTreeCost: 15 } } as ep.ExecutionPlanGraph,
                ],
                loadState: ApiStatus.Loaded,
            },
        };

        const result = epUtils.calculateTotalCost(mockInitialState);

        expect(result, "Total cost should correctly sum up the costs and subtree costs").to.equal(
            50,
        );
    });

    test("calculateTotalCost: should return 0 if executionPlanGraphs is empty", () => {
        const result = epUtils.calculateTotalCost(mockInitialState);

        expect(result, "Total cost should be 0 for an empty executionPlanGraphs array").to.equal(0);
    });

    test("formatXml: should return original xml contents if it is not a valid xml file", () => {
        const invalidXml = "</";
        const result = epUtils.formatXml(invalidXml);
        expect(result, "Xml input should not be changed if invalid format").to.equal(invalidXml);
    });
});
