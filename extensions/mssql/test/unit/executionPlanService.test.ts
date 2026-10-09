/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { GetExecutionPlanRequest } from "../../src/models/contracts/executionPlan";
import { ExecutionPlanService } from "../../src/services/executionPlanService";
import { ExecutionPlanGraph } from "../../src/sharedInterfaces/executionPlan";
import { getExecutionPlanNodeLabelLines } from "../../src/webviews/pages/ExecutionPlan/executionPlanLiveStatistics";

chai.use(sinonChai);
const { expect } = chai;

suite("ExecutionPlanService statistics", () => {
    let sandbox: sinon.SinonSandbox;
    let client: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let service: ExecutionPlanService;

    setup(() => {
        sandbox = sinon.createSandbox();
        client = sandbox.createStubInstance(SqlToolsServiceClient);
        service = new ExecutionPlanService(client);
    });

    teardown(() => sandbox.restore());

    function graph(): ExecutionPlanGraph {
        return {
            query: "select 1",
            root: {
                cost: 0,
                subtext: ["SELECT"],
                children: [{ cost: 1, subtext: ["Scan"], children: [] }],
            },
        } as ExecutionPlanGraph;
    }

    function statement(id: number, rows: number): string {
        return `<StmtSimple StatementId="${id}" StatementText="select 1"><QueryPlan><QueryTimeStats ElapsedTime="67011" />
            <RelOp EstimateRows="100"><RunTimeInformation><RunTimeCountersPerThread ActualRows="${rows}" ActualElapsedms="66000" /></RunTimeInformation></RelOp>
            </QueryPlan></StmtSimple>`;
    }

    test("adds final row and elapsed-time labels to query results and opened actual plans", async () => {
        const source = graph();
        const before = JSON.stringify(source);
        const xml = `<ShowPlanXML>${statement(1, 80)}</ShowPlanXML>`;
        client.sendRequest.resolves({ graphs: [source], success: true });

        const result = await service.getExecutionPlan({
            graphFileContent: xml,
            graphFileType: "xml",
        });
        const actual = result.graphs[0];
        expect(actual.isLive).to.be.undefined;
        expect(actual.liveQueryStatistics?.estimatedProgress).to.be.undefined;
        expect(getExecutionPlanNodeLabelLines(actual.root.children[0], "en-US")).to.deep.equal([
            "Scan",
            "Elapsed: 0:01:06",
            "Rows: 80 of 100 (80%)",
        ]);
        expect(getExecutionPlanNodeLabelLines(actual.root, "en-US")).to.deep.equal([
            "SELECT",
            "Elapsed: 0:01:07",
        ]);
        expect(JSON.stringify(source)).to.equal(before);
        expect(client.sendRequest).to.have.been.calledWith(GetExecutionPlanRequest.type, {
            graphInfo: { graphFileContent: xml, graphFileType: "xml" },
        });
    });

    test("matches duplicate statements by graph index when the service omits graph XML", async () => {
        const xml = `<ShowPlanXML>${statement(1, 10)}${statement(2, 80)}</ShowPlanXML>`;
        client.sendRequest.resolves({ graphs: [graph(), graph()], success: true });
        const result = await service.getExecutionPlan({
            graphFileContent: xml,
            graphFileType: ".sqlplan",
        });
        expect(
            result.graphs.map((plan) => plan.root.children[0].liveQueryStatistics?.actualRows),
        ).to.deep.equal(["10", "80"]);
    });

    test("keeps estimated plans free of execution statistics", async () => {
        const source = graph();
        const xml =
            '<ShowPlanXML><StmtSimple StatementId="1" StatementText="select 1"><QueryPlan><RelOp EstimateRows="100" /></QueryPlan></StmtSimple></ShowPlanXML>';
        client.sendRequest.resolves({ graphs: [source], success: true });
        const result = await service.getExecutionPlan({
            graphFileContent: xml,
            graphFileType: "xml",
        });
        expect(result.graphs[0]).to.equal(source);
        expect(
            getExecutionPlanNodeLabelLines(result.graphs[0].root.children[0], "en-US"),
        ).to.deep.equal(["Scan"]);
    });
});
