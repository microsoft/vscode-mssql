/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { addLiveExecutionPlanStatistics } from "../../src/queryResult/liveExecutionPlanStatistics";
import { ExecutionPlanGraph, ExecutionPlanNode } from "../../src/sharedInterfaces/executionPlan";
import {
    getExecutionPlanNodeLabelLines,
    formatLiveExecutionPlanDuration,
    formatLiveExecutionPlanProgress,
    formatLiveExecutionPlanRows,
} from "../../src/webviews/pages/ExecutionPlan/executionPlanLiveStatistics";
import {
    ExecutionPlanModel,
    layoutExecutionPlan,
} from "../../src/webviews/pages/ExecutionPlan/executionPlanModel";

function node(children: ExecutionPlanNode[] = [], cost = 1): ExecutionPlanNode {
    return {
        id: "operator",
        type: "tableScan",
        name: "Scan",
        description: "",
        subtext: ["Scan", "[table]"],
        cost,
        subTreeCost: 4,
        relativeCost: 0.25,
        elapsedTimeInMs: 0,
        elapsedCpuTimeInMs: 0,
        properties: [],
        badges: [],
        costMetrics: [],
        rowCountDisplayString: "0",
        costDisplayString: "25%",
        children,
        edges: children.map(() => ({ rowCount: 0, rowSize: 1, properties: [] })),
    };
}

function graph(operator: ExecutionPlanNode, xml: string, index = 0): ExecutionPlanGraph {
    return {
        root: node([operator], 0),
        query: "select 1",
        recommendations: [],
        graphFile: { graphFileContent: xml, graphFileType: "xml", planIndexInFile: index },
    };
}

function plan(operator: string): string {
    return `<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan"><BatchSequence><Batch><Statements><StmtSimple StatementId="1" StatementText="select 1"><QueryPlan>${operator}</QueryPlan></StmtSimple></Statements></Batch></BatchSequence></ShowPlanXML>`;
}

suite("Live execution plan statistics", () => {
    test("sums parallel rows, accounts for repeated executions, and uses full maximum elapsed time", () => {
        const source = graph(
            node(),
            plan(`<RelOp EstimateRows="10" EstimateRebinds="1" EstimateRewinds="1"><RunTimeInformation>
            <RunTimeCountersPerThread Thread="0" ActualRows="10" ActualElapsedms="67011" />
            <RunTimeCountersPerThread Thread="1" ActualRows="20" ActualElapsedms="66000" />
            </RunTimeInformation></RelOp>`),
        );
        const before = JSON.stringify(source);
        const result = addLiveExecutionPlanStatistics(source);

        expect(result.root.children[0].liveQueryStatistics).to.deep.equal({
            actualRows: "30",
            estimatedRows: 30,
            elapsedTimeInMs: 67011,
        });
        expect(result.liveQueryStatistics).to.deep.equal({
            estimatedProgress: 99,
            elapsedTimeInMs: 67011,
        });
        expect(JSON.stringify(source)).to.equal(before);
    });

    test("uses pipeline input progress instead of intermediate output row estimates", () => {
        const result = addLiveExecutionPlanStatistics(
            graph(
                node([node([], 3)]),
                plan(`<RelOp PhysicalOp="Nested Loops" EstimateRows="1000000000000"><RunTimeInformation><RunTimeCountersPerThread ActualRows="0" /></RunTimeInformation><NestedLoops>
            <RelOp EstimateRows="100"><RunTimeInformation><RunTimeCountersPerThread ActualRows="75" /></RunTimeInformation></RelOp>
            </NestedLoops></RelOp>`),
            ),
        );
        expect(result.liveQueryStatistics?.estimatedProgress).to.equal(75);
    });

    test("advances a cross join from input rows even when intermediate estimates are trillions", () => {
        const sample = (rows: number): ExecutionPlanGraph =>
            graph(
                node([node(), node([node()])], 1000000000),
                plan(`<RelOp PhysicalOp="Nested Loops" EstimateRows="1000000000000">
                    <RunTimeInformation><RunTimeCountersPerThread ActualRows="${rows * 10}" ActualExecutions="1" ActualEndOfScans="0" /></RunTimeInformation>
                    <NestedLoops>
                        <RelOp PhysicalOp="Clustered Index Scan" EstimateRows="100">
                            <RunTimeInformation><RunTimeCountersPerThread ActualRows="${rows}" ActualExecutions="1" ActualEndOfScans="0" /></RunTimeInformation>
                        </RelOp>
                        <RelOp PhysicalOp="Table Spool" EstimateRows="10">
                            <RunTimeInformation><RunTimeCountersPerThread ActualRows="${rows * 10}" ActualExecutions="${rows + 1}" ActualEndOfScans="${rows}" /></RunTimeInformation>
                            <Spool><RelOp PhysicalOp="Clustered Index Scan" EstimateRows="1000">
                                <RunTimeInformation><RunTimeCountersPerThread ActualRows="10" ActualExecutions="1" ActualEndOfScans="1" /></RunTimeInformation>
                            </RelOp></Spool>
                        </RelOp>
                    </NestedLoops>
                </RelOp>`),
            );
        const earlier = addLiveExecutionPlanStatistics(sample(25));
        const later = addLiveExecutionPlanStatistics(sample(75));
        expect(earlier.liveQueryStatistics?.estimatedProgress).to.be.within(25, 99);
        expect(later.liveQueryStatistics?.estimatedProgress).to.be.within(75, 99);
        expect(later.liveQueryStatistics!.estimatedProgress!).to.be.greaterThan(
            earlier.liveQueryStatistics!.estimatedProgress!,
        );
        // Keep the optimizer estimate visible on each operator even when overall costs adapt.
        expect(later.root.children[0].liveQueryStatistics?.estimatedRows).to.equal(1000000000000);
    });

    test("does not treat one completed inner scan as a finished nested-loop input", () => {
        const result = addLiveExecutionPlanStatistics(
            graph(
                node([node(), node()]),
                plan(`<RelOp PhysicalOp="Nested Loops" EstimateRows="1000">
                    <RunTimeInformation><RunTimeCountersPerThread ActualRows="100" ActualExecutions="1" ActualEndOfScans="0" /></RunTimeInformation>
                    <NestedLoops>
                        <RelOp PhysicalOp="Table Scan" EstimateRows="100">
                            <RunTimeInformation><RunTimeCountersPerThread ActualRows="10" ActualExecutions="1" ActualEndOfScans="0" /></RunTimeInformation>
                        </RelOp>
                        <RelOp PhysicalOp="Table Scan" EstimateRows="10" EstimateRebinds="9">
                            <RunTimeInformation><RunTimeCountersPerThread ActualRows="10" ActualExecutions="1" ActualEndOfScans="1" /></RunTimeInformation>
                        </RelOp>
                    </NestedLoops>
                </RelOp>`),
            ),
        );
        expect(result.liveQueryStatistics?.estimatedProgress).to.be.closeTo(10, 0.000001);
    });

    test("counts hash build work before the probe pipeline starts", () => {
        const result = addLiveExecutionPlanStatistics(
            graph(
                node([node([], 8), node()], 1),
                plan(`<RelOp PhysicalOp="Hash Match" EstimateRows="100">
                    <RunTimeInformation><RunTimeCountersPerThread ActualRows="0" /></RunTimeInformation>
                    <Hash>
                        <RelOp PhysicalOp="Table Scan" EstimateRows="100">
                            <RunTimeInformation><RunTimeCountersPerThread ActualRows="50" ActualExecutions="1" ActualEndOfScans="0" /></RunTimeInformation>
                        </RelOp>
                        <RelOp PhysicalOp="Table Scan" EstimateRows="100">
                            <RunTimeInformation><RunTimeCountersPerThread ActualRows="0" ActualExecutions="0" ActualEndOfScans="0" /></RunTimeInformation>
                        </RelOp>
                    </Hash>
                </RelOp>`),
            ),
        );
        expect(result.liveQueryStatistics?.estimatedProgress).to.equal(40);
    });

    test("refines completed parallel scans without treating an active worker as finished", () => {
        const sample = (endOfScans: number): ExecutionPlanGraph =>
            graph(
                node(),
                plan(`<RelOp PhysicalOp="Table Scan" EstimateRows="1000">
                    <RunTimeInformation>
                        <RunTimeCountersPerThread Thread="0" ActualRows="0" ActualExecutions="0" ActualEndOfScans="0" />
                        <RunTimeCountersPerThread Thread="1" ActualRows="20" ActualExecutions="1" ActualEndOfScans="1" />
                        <RunTimeCountersPerThread Thread="2" ActualRows="30" ActualExecutions="1" ActualEndOfScans="${endOfScans}" />
                    </RunTimeInformation>
                </RelOp>`),
            );
        expect(
            addLiveExecutionPlanStatistics(sample(0)).liveQueryStatistics?.estimatedProgress,
        ).to.equal(5);
        expect(
            addLiveExecutionPlanStatistics(sample(1)).liveQueryStatistics?.estimatedProgress,
        ).to.equal(99);
    });

    test("keeps exact row counts past Number.MAX_SAFE_INTEGER without translated properties", () => {
        const result = addLiveExecutionPlanStatistics(
            graph(
                node(),
                plan(`<RelOp EstimateRows="1"><RunTimeInformation>
            <RunTimeCountersPerThread ActualRows="9007199254740993" /><RunTimeCountersPerThread ActualRows="2" />
            </RunTimeInformation></RelOp>`),
            ),
        );
        expect(result.root.children[0].liveQueryStatistics?.actualRows).to.equal(
            "9007199254740995",
        );
    });

    test("uses the statement index when identical statements have different counters", () => {
        const xml = plan(
            '<RelOp EstimateRows="100"><RunTimeInformation><RunTimeCountersPerThread ActualRows="10" /></RunTimeInformation></RelOp>',
        );
        const secondStatement =
            '<StmtSimple StatementId="2" StatementText="select 1"><QueryPlan><RelOp EstimateRows="100"><RunTimeInformation><RunTimeCountersPerThread ActualRows="80" /></RunTimeInformation></RelOp></QueryPlan></StmtSimple>';
        const result = addLiveExecutionPlanStatistics(
            graph(node(), xml.replace("</Statements>", `${secondStatement}</Statements>`), 1),
        );
        expect(result.root.children[0].liveQueryStatistics?.actualRows).to.equal("80");
    });

    test("reads counters from lightweight live plans that omit StatementText", () => {
        const source = graph(
            node(),
            plan(
                '<RelOp EstimateRows="100"><RunTimeInformation><RunTimeCountersPerThread ActualRows="50" ActualElapsedms="67011" /></RunTimeInformation></RelOp>',
            ).replace(' StatementText="select 1"', ""),
        );
        source.query = "";
        const result = addLiveExecutionPlanStatistics(source);
        expect(result.root.children[0].liveQueryStatistics).to.deep.equal({
            actualRows: "50",
            estimatedRows: 100,
            elapsedTimeInMs: 67011,
        });
        expect(result.liveQueryStatistics).to.deep.equal({
            estimatedProgress: 50,
            elapsedTimeInMs: 67011,
        });
    });

    test("does not invent progress when estimates are zero or runtime counters are missing", () => {
        for (const relOp of [
            '<RelOp EstimateRows="0"><RunTimeInformation><RunTimeCountersPerThread ActualRows="5" /></RunTimeInformation></RelOp>',
            '<RelOp EstimateRows="10" />',
        ]) {
            const result = addLiveExecutionPlanStatistics(graph(node(), plan(relOp)));
            expect(result.liveQueryStatistics?.estimatedProgress).to.be.undefined;
        }
    });

    test("does not annotate malformed XML or mismatched operator topology", () => {
        for (const xml of [
            "<invalid",
            plan(
                '<RelOp EstimateRows="10"><NestedLoops><RelOp EstimateRows="1" /></NestedLoops></RelOp>',
            ),
        ]) {
            const source = graph(node(), xml);
            expect(addLiveExecutionPlanStatistics(source)).to.equal(source);
        }
    });
});

suite("Live execution plan labels", () => {
    test("distinguishes tiny nonzero progress from zero and preserves fractional percentages", () => {
        expect(formatLiveExecutionPlanProgress(0, "en-US")).to.equal(
            "Estimated query progress: 0%",
        );
        expect(formatLiveExecutionPlanProgress(0.001, "en-US")).to.equal(
            "Estimated query progress: <0.1%",
        );
        expect(formatLiveExecutionPlanProgress(0.1, "en-US")).to.equal(
            "Estimated query progress: 0.1%",
        );
        expect(formatLiveExecutionPlanProgress(94.94, "en-US")).to.equal(
            "Estimated query progress: 94.9%",
        );
        expect(formatLiveExecutionPlanProgress(99, "en-US")).to.equal(
            "Estimated query progress: 99%",
        );
    });

    test("formats subsecond, minute, and multiday durations without losing whole seconds", () => {
        expect(formatLiveExecutionPlanDuration(11, "en-US")).to.equal("0.011 s");
        expect(formatLiveExecutionPlanDuration(67011, "en-US")).to.equal("0:01:07");
        expect(formatLiveExecutionPlanDuration(25 * 3600_000, "en-US")).to.equal("25:00:00");
    });

    test("shows underestimated row counts above 100% and keeps exact counts in the tooltip", () => {
        const operator = node();
        operator.liveQueryStatistics = { actualRows: "9007199254740993", estimatedRows: 1 };
        expect(formatLiveExecutionPlanRows(operator, false, "en-US")).to.contain(
            "9,007,199,254,740,993",
        );
        operator.liveQueryStatistics = { actualRows: "200", estimatedRows: 100 };
        expect(formatLiveExecutionPlanRows(operator, true, "en-US")).to.equal(
            "Rows: 200 of 100 (200%)",
        );
        operator.liveQueryStatistics.estimatedRows = 0;
        expect(formatLiveExecutionPlanRows(operator, true, "en-US")).to.equal("Rows: 200 of 0");
    });

    test("includes live counters in labels and leaves enough space between sibling operators", () => {
        const root = node([node(), node()]);
        for (const child of root.children) {
            child.liveQueryStatistics = {
                actualRows: "50",
                estimatedRows: 100,
                elapsedTimeInMs: 67000,
            };
        }
        const model = new ExecutionPlanModel(root);
        const positions = layoutExecutionPlan(model, (text) => text.length * 6);
        const [first, second] = model.root.children;
        expect(getExecutionPlanNodeLabelLines(first, "en-US")).to.deep.equal([
            "Scan",
            "[table]",
            "Elapsed: 0:01:07",
            "Rows: 50 of 100 (50%)",
        ]);
        expect(positions.get(second.id)!.y - positions.get(first.id)!.y).to.be.at.least(116);
        expect(positions.get(first.id)!.x - positions.get(model.root.id)!.x).to.be.at.most(240);
    });
});
