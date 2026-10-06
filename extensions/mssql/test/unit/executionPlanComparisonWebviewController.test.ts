/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import { expect } from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as jsonRpc from "vscode-jsonrpc/node";
import { RequestType, ResponseError } from "vscode-jsonrpc/node";

import {
    ExecutionPlanComparisonWebviewController,
    getComparisonExecutionPlanGraphs,
    getExecutionPlanComparisonMatches,
    toComparisonGraph,
} from "../../src/controllers/executionPlanComparisonWebviewController";
import { executionPlanSourceRegistry } from "../../src/controllers/executionPlanSourceRegistry";
import { openExecutionPlanComparisonWebview } from "../../src/controllers/sharedExecutionPlanUtils";
import SqlDocumentService, { ConnectionStrategy } from "../../src/controllers/sqlDocumentService";
import { ExecutionPlanService } from "../../src/services/executionPlanService";
import * as ep from "../../src/sharedInterfaces/executionPlan";
import * as epc from "../../src/sharedInterfaces/executionPlanComparison";
import * as utils from "../../src/utils/utils";
import { stubLogger, stubTelemetry, stubWebviewConnectionRpc, stubWebviewPanel } from "./utils";

chai.use(sinonChai);

function graph(name: string, planIndexInFile = 0): ep.ExecutionPlanGraph {
    return {
        root: { id: "0", name, cost: 1, subTreeCost: 1 } as ep.ExecutionPlanNode,
        query: `select '${name}'`,
        graphFile: {
            graphFileContent: `<ShowPlanXML name="${name}" />`,
            graphFileType: "xml",
            planIndexInFile,
        },
        recommendations: [],
    };
}

function comparisonNode(
    id: number,
    groupIndex: number,
    matchingNodesId: number[],
    children: ep.ExecutionGraphComparisonResult[] = [],
    hasMatch = true,
): ep.ExecutionGraphComparisonResult {
    return {
        baseNode: { id: String(id) } as ep.ExecutionPlanNode,
        children,
        groupIndex,
        hasMatch,
        matchingNodesId,
        parentNode: undefined!,
    };
}

suite("ExecutionPlanComparisonWebviewController", () => {
    let sandbox: sinon.SinonSandbox;
    let requestHandlers: Map<string, (params?: unknown) => Promise<unknown>>;
    let notificationHandlers: Map<string, (params: unknown) => void>;
    let executionPlanService: sinon.SinonStubbedInstance<ExecutionPlanService>;
    let sqlDocumentService: sinon.SinonStubbedInstance<SqlDocumentService>;
    let context: vscode.ExtensionContext;
    let controller: ExecutionPlanComparisonWebviewController | undefined;

    setup(() => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);
        stubLogger(sandbox);
        sandbox.stub(utils, "getNonce").returns("test-nonce");
        const connection = stubWebviewConnectionRpc(sandbox);
        requestHandlers = connection.requestHandlers as Map<
            string,
            (params?: unknown) => Promise<unknown>
        >;
        notificationHandlers = connection.notificationHandlers as Map<
            string,
            (params: unknown) => void
        >;
        sandbox
            .stub(jsonRpc, "createMessageConnection")
            .returns(connection.connection as unknown as jsonRpc.MessageConnection);
        sandbox
            .stub(vscode.window, "createWebviewPanel")
            .callsFake(() => stubWebviewPanel(sandbox));

        executionPlanService = sandbox.createStubInstance(ExecutionPlanService);
        sqlDocumentService = sandbox.createStubInstance(SqlDocumentService);
        context = {
            extensionUri: vscode.Uri.file("/tmp/ext"),
            extensionPath: "/tmp/ext",
            subscriptions: [],
        } as unknown as vscode.ExtensionContext;
    });

    teardown(() => {
        controller?.dispose();
        controller = undefined;
        sandbox.restore();
    });

    function createController(graphs = [graph("first"), graph("second", 1)], graphIndex = 1) {
        controller = new ExecutionPlanComparisonWebviewController(
            context,
            executionPlanService,
            sqlDocumentService,
            { name: "primary.sqlplan", graphs, graphIndex },
        );
        return controller;
    }

    function request<P, R>(type: RequestType<P, R, void>, params?: P): Promise<R> {
        return requestHandlers.get(type.method)!(params) as Promise<R>;
    }

    async function requestError<P, R>(type: RequestType<P, R, void>, params?: P) {
        try {
            await request(type, params);
        } catch (error) {
            return error;
        }
        return undefined;
    }

    function pickRegisteredPlan(name: string) {
        sandbox.stub(vscode.window, "showQuickPick").callsFake(async (items) => {
            const resolved = (await items) as vscode.QuickPickItem[];
            return resolved.find((item) => item.label.endsWith(name));
        });
    }

    test("hands over the plan it was opened from, without the live markers of a running query", async () => {
        const live: ep.ExecutionPlanGraph = {
            ...graph("live"),
            isLive: true,
            liveRefreshId: 4,
            liveQueryStatistics: { estimatedProgress: 0.5 },
        };
        createController([graph("first"), live], 5);

        const source = await request(epc.GetInitialComparisonSourceRequest.type);

        expect(source).to.deep.equal({
            name: "primary.sqlplan",
            graphs: [graph("first"), graph("live")],
            graphIndex: 1,
        });
        expect(toComparisonGraph(source.graphs[0])).to.equal(source.graphs[0]);
    });

    test("opens a recommended query without connecting or running it", () => {
        sqlDocumentService.newQuery.resolves();
        createController();
        const query = "-- Missing index recommendation\nCREATE INDEX ix ON dbo.t (id);";

        notificationHandlers.get(epc.ShowComparisonQueryNotification.type.method)!({ query });

        expect(sqlDocumentService.newQuery).to.have.been.calledOnceWithExactly({
            content: query,
            connectionStrategy: ConnectionStrategy.DoNotConnect,
        });
    });

    test("loads the plan the user picks", async () => {
        const registration = executionPlanSourceRegistry.register("other.sqlplan", "<other />");
        try {
            pickRegisteredPlan("other.sqlplan");
            executionPlanService.getExecutionPlan.resolves({
                graphs: [graph("other")],
                success: true,
                errorMessage: "",
            });
            createController();

            const source = await request(epc.PickComparisonSourceRequest.type);

            expect(executionPlanService.getExecutionPlan).to.have.been.calledOnceWithExactly({
                graphFileContent: "<other />",
                graphFileType: ".sqlplan",
            });
            expect(source).to.deep.equal({ name: "other.sqlplan", graphs: [graph("other")] });
        } finally {
            registration.dispose();
        }
    });

    test("resolves to nothing when the user cancels the pick", async () => {
        sandbox.stub(vscode.window, "showQuickPick").resolves(undefined);
        createController();

        const source = await request(epc.PickComparisonSourceRequest.type);

        expect(source).to.equal(undefined);
        expect(executionPlanService.getExecutionPlan).not.to.have.been.called;
    });

    test("explains why a picked plan cannot be loaded", async () => {
        const registration = executionPlanSourceRegistry.register("bad.sqlplan", "<bad />");
        try {
            pickRegisteredPlan("bad.sqlplan");
            executionPlanService.getExecutionPlan.resolves({
                graphs: [],
                success: true,
                errorMessage: "",
            });
            createController();

            const error = await requestError(epc.PickComparisonSourceRequest.type);

            // A ResponseError keeps its message, instead of being wrapped in the request name.
            expect(error).to.be.instanceOf(ResponseError);
            expect((error as ResponseError<unknown>).message).to.equal(
                "The selected file does not contain an execution plan.",
            );
        } finally {
            registration.dispose();
        }
    });

    test("compares the graphs it is sent and returns only their matches", async () => {
        executionPlanService.compareExecutionPlanGraph.resolves({
            firstComparisonResult: comparisonNode(1, 0, [11]),
            secondComparisonResult: comparisonNode(11, 0, [1]),
            success: true,
            errorMessage: "",
        });
        createController();
        const params = { primary: graph("a").graphFile, secondary: graph("b", 1).graphFile };

        const result = await request(epc.CompareExecutionPlanGraphsRequest.type, params);

        expect(executionPlanService.compareExecutionPlanGraph).to.have.been.calledOnceWithExactly(
            params.primary,
            params.secondary,
        );
        expect(result).to.deep.equal({
            primary: [{ nodeId: "1", groupIndex: 0, matchingNodeIds: ["11"] }],
            secondary: [{ nodeId: "11", groupIndex: 0, matchingNodeIds: ["1"] }],
        });
    });

    test("reports the service's reason when a comparison fails", async () => {
        executionPlanService.compareExecutionPlanGraph.rejects(new Error("Plan XML is invalid"));
        createController();

        const error = await requestError(epc.CompareExecutionPlanGraphsRequest.type, {
            primary: graph("a").graphFile,
            secondary: graph("b").graphFile,
        });

        expect(error).to.be.instanceOf(ResponseError);
        expect((error as ResponseError<unknown>).message).to.equal("Plan XML is invalid");
    });

    test("does not open a comparison without a plan", () => {
        openExecutionPlanComparisonWebview(context, executionPlanService, sqlDocumentService, {
            name: "empty",
            graphs: [],
            graphIndex: 0,
        });

        expect(vscode.window.createWebviewPanel).not.to.have.been.called;
    });
});

suite("Execution plan comparison results", () => {
    test("lists matched nodes in pre-order with string IDs", () => {
        const result: ep.ExecutionPlanComparisonResult = {
            firstComparisonResult: comparisonNode(
                1,
                3,
                [11],
                [
                    comparisonNode(2, 3, [12], [comparisonNode(4, 5, [14])]),
                    comparisonNode(3, -1, [], [], false),
                ],
            ),
            secondComparisonResult: comparisonNode(11, 3, [1]),
            success: true,
            errorMessage: "",
        };

        const matches = getExecutionPlanComparisonMatches(result);

        expect(matches.primary).to.deep.equal([
            { nodeId: "1", groupIndex: 3, matchingNodeIds: ["11"] },
            { nodeId: "2", groupIndex: 3, matchingNodeIds: ["12"] },
            { nodeId: "4", groupIndex: 5, matchingNodeIds: ["14"] },
        ]);
        expect(matches.secondary).to.deep.equal([
            { nodeId: "11", groupIndex: 3, matchingNodeIds: ["1"] },
        ]);
    });

    test("accepts comparison trees when an older service response omits success", () => {
        const result: ep.ExecutionPlanComparisonResult = {
            firstComparisonResult: comparisonNode(1, 0, [], [], false),
            secondComparisonResult: comparisonNode(2, 0, [], [], false),
            success: undefined!,
            errorMessage: "",
        };

        expect(getExecutionPlanComparisonMatches(result)).to.deep.equal({
            primary: [],
            secondary: [],
        });
    });

    test("rejects an explicit comparison failure", () => {
        const result: ep.ExecutionPlanComparisonResult = {
            firstComparisonResult: undefined!,
            secondComparisonResult: undefined!,
            success: false,
            errorMessage: "Plan is not valid",
        };

        expect(() => getExecutionPlanComparisonMatches(result)).to.throw("Plan is not valid");
    });

    test("accepts graphs when an older service response omits success", () => {
        const graphs = [{} as ep.ExecutionPlanGraph];
        const result: ep.GetExecutionPlanResult = {
            graphs,
            success: undefined!,
            errorMessage: "",
        };

        expect(getComparisonExecutionPlanGraphs(result)).to.equal(graphs);
    });

    test("rejects an explicit service failure with a useful fallback message", () => {
        const result: ep.GetExecutionPlanResult = {
            graphs: [],
            success: false,
            errorMessage: "",
        };

        expect(() => getComparisonExecutionPlanGraphs(result)).to.throw(
            "Failed to load the selected execution plan.",
        );
    });
});
