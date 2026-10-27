/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const qs = require("../dist/queryStore/index.js");
const {
    capabilities,
    resultSet,
    scriptedReader,
    stateSet,
} = require("../test-fixtures/fakeReader.js");

const window = {
    start: new Date(Date.UTC(2026, 9, 1)),
    end: new Date(Date.UTC(2026, 9, 2)),
};

const waitColumns = ["category", "start_time", "end_time", "total_ms", "max_ms"];

/** The duration sums in microseconds, as the runtime stats record them. */
const executions = (count, totalMs) =>
    resultSet(
        ["executions", "duration_total", "duration_min", "duration_max", "duration_sq"],
        [[count, totalMs * 1000, 0, 0, 0]],
    );

suite("Query Store wait statistics", () => {
    test("sums each category, with its share and its average for an execution", async () => {
        const reader = scriptedReader([
            [
                stateSet(),
                resultSet(["wait_capture"], [[1]]),
                resultSet(waitColumns, [
                    ["Buffer IO", "2026-10-01T00:00:00Z", "2026-10-01T01:00:00Z", 4000, 3000],
                    ["CPU", "2026-10-01T00:00:00Z", "2026-10-01T01:00:00Z", 800, 800],
                    ["Buffer IO", "2026-10-01T01:00:00Z", "2026-10-01T02:00:00Z", 1000, 1000],
                ]),
                executions(2, 6000),
            ],
        ]);

        const result = await qs.getWaitStats(reader, capabilities(), {
            ...window,
            queryId: "2504",
        });

        assert.equal(result.status, "ready");
        const waits = result.data;
        assert.equal(waits.captureMode, "on");
        assert.equal(waits.totalWaitMs, 5800);
        assert.equal(waits.executionCount, 2);
        assert.equal(waits.durationTotalMs, 6000);
        assert.deepEqual(
            waits.categories.map((category) => [category.category, category.totalMs]),
            [
                ["Buffer IO", 5000],
                ["CPU", 800],
            ],
        );
        assert.equal(waits.categories[0].avgMsPerExecution, 2500);
        assert.equal(waits.categories[0].maxMs, 3000);
        assert.equal(waits.intervals.length, 2);
        assert.deepEqual(waits.intervals[0].waits, { "Buffer IO": 4000, CPU: 800 });
        const sql = reader.calls[0];
        assert.match(sql, /DECLARE @query_id bigint = CAST\(2504 AS bigint\);/);
        assert.match(sql, /ws\.plan_id IN \(SELECT p\.plan_id FROM sys\.query_store_plan/);
        assert.match(sql, /rs\.plan_id IN \(SELECT p\.plan_id FROM sys\.query_store_plan/);
        assert.doesNotMatch(sql, /ws\.replica_group_id/);
    });

    test("filters a plan, buckets the intervals, and reads the primary replica", async () => {
        const reader = scriptedReader([
            [
                stateSet(),
                resultSet(["wait_capture"], [[1]]),
                resultSet(waitColumns),
                executions(0, 0),
            ],
        ]);

        const result = await qs.getWaitStats(
            reader,
            capabilities({ hasWaitStatsReplicaGroups: true }),
            { ...window, planId: "105", bucketMinutes: 60 },
        );

        assert.equal(result.status, "noData");
        const sql = reader.calls[0];
        assert.match(sql, /AND ws\.plan_id = @plan_id/);
        assert.match(sql, /AND ws\.replica_group_id = 1/);
        assert.match(sql, /DECLARE @bucket_minutes int = 60;/);
    });

    test("reports that the capture is off when nothing was captured", async () => {
        const reader = scriptedReader([
            [
                stateSet(),
                resultSet(["wait_capture"], [[0]]),
                resultSet(waitColumns),
                executions(0, 0),
            ],
        ]);

        const result = await qs.getWaitStats(reader, capabilities(), window);

        assert.equal(result.status, "ready");
        assert.equal(result.data.captureMode, "off");
        assert.deepEqual(result.data.categories, []);
    });

    test("is unsupported without wait statistics in Query Store", async () => {
        const reader = scriptedReader([]);

        const result = await qs.getWaitStats(
            reader,
            capabilities({ hasWaitStatsCapture: false }),
            window,
        );

        assert.equal(result.status, "unsupported");
        assert.equal(reader.calls.length, 0);
    });
});

const showplan = `<?xml version="1.0" encoding="utf-16"?>
<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.6">
  <BatchSequence><Batch><Statements>
    <StmtSimple StatementText="SELECT * FROM dbo.Orders WHERE CustomerId = @id &amp; 1" StatementType="SELECT"
        StatementSubTreeCost="10" StatementEstRows="5" StatementOptmLevel="FULL"
        StatementOptmEarlyAbortReason="TimeOut" CardinalityEstimationModelVersion="160">
      <QueryPlan DegreeOfParallelism="1" CompileTime="12" CompileCPU="10" CompileMemory="400">
        <Warnings><PlanAffectingConvert ConvertIssue="Seek Plan" Expression="CONVERT_IMPLICIT(nvarchar(50),[o].[Code],0)" /></Warnings>
        <MemoryGrantInfo SerialDesiredMemory="1024" />
        <MissingIndexes>
          <MissingIndexGroup Impact="85.5">
            <MissingIndex Database="[Shop]" Schema="[dbo]" Table="[Orders]">
              <ColumnGroup Usage="EQUALITY"><Column Name="[CustomerId]" ColumnId="2" /></ColumnGroup>
              <ColumnGroup Usage="INCLUDE"><Column Name="[Total]" ColumnId="5" /></ColumnGroup>
            </MissingIndex>
          </MissingIndexGroup>
        </MissingIndexes>
        <RelOp NodeId="0" PhysicalOp="Nested Loops" LogicalOp="Inner Join" EstimateRows="5"
            EstimatedTotalSubtreeCost="10" Parallel="0" EstimatedExecutionMode="Row">
          <NestedLoops>
            <RelOp NodeId="1" PhysicalOp="Clustered Index Scan" LogicalOp="Clustered Index Scan"
                EstimateRows="5" EstimatedRowsRead="100000" EstimatedTotalSubtreeCost="8" Parallel="0">
              <IndexScan>
                <Object Database="[Shop]" Schema="[dbo]" Table="[Orders]" Index="[PK_Orders]" />
                <Predicate><ScalarOperator ScalarString="[o].[CustomerId]=[@id]" /></Predicate>
              </IndexScan>
            </RelOp>
            <RelOp NodeId="2" PhysicalOp="Index Seek" LogicalOp="Index Seek" EstimateRows="1"
                EstimatedTotalSubtreeCost="1.5" Parallel="0">
              <Warnings NoJoinPredicate="1" />
              <IndexScan><Object Database="[Shop]" Schema="[dbo]" Table="[Customers]" Index="[IX_Id]" /></IndexScan>
            </RelOp>
          </NestedLoops>
        </RelOp>
        <ParameterList><ColumnReference Column="@id" ParameterCompiledValue="(42)" /></ParameterList>
      </QueryPlan>
    </StmtSimple>
  </Statements></Batch></BatchSequence>
</ShowPlanXML>`;

suite("Plan summaries", () => {
    test("summarizes the statement, its warnings, indexes, parameters, and operators", () => {
        const summary = qs.summarizePlan(showplan);

        assert.equal(summary.statements.length, 1);
        assert.equal(summary.omittedStatements, 0);
        const [statement] = summary.statements;
        assert.equal(
            statement.statementText,
            "SELECT * FROM dbo.Orders WHERE CustomerId = @id & 1",
        );
        assert.equal(statement.earlyAbortReason, "TimeOut");
        assert.equal(statement.cardinalityEstimationModelVersion, 160);
        assert.equal(statement.memoryGrantKb, 1024);
        assert.equal(statement.compileTimeMs, 12);
        assert.match(statement.warnings[0], /^PlanAffectingConvert ConvertIssue=Seek Plan/);
        assert.deepEqual(statement.missingIndexes, [
            {
                impact: 85.5,
                table: "Shop.dbo.Orders",
                equality: ["CustomerId"],
                inequality: [],
                include: ["Total"],
            },
        ]);
        assert.deepEqual(statement.parameters, [{ name: "@id", compiledValue: "(42)" }]);
        assert.equal(statement.operatorCount, 3);
        const [top, second, third] = statement.topOperators;
        assert.equal(top.physicalOp, "Clustered Index Scan");
        assert.equal(top.selfCost, 8);
        assert.equal(top.costShare, 0.8);
        assert.equal(top.object, "Shop.dbo.Orders.PK_Orders");
        assert.equal(top.estimatedRowsRead, 100000);
        assert.equal(top.predicate, "[o].[CustomerId]=[@id]");
        assert.equal(second.physicalOp, "Index Seek");
        assert.deepEqual(second.warnings, ["NoJoinPredicate"]);
        // The join's own cost is its subtree cost less its inputs': 10 - 8 - 1.5.
        assert.equal(third.physicalOp, "Nested Loops");
        assert.equal(third.selfCost, 0.5);
    });

    test("skips comments, CDATA, and declarations, and reads single-quoted attributes", () => {
        const summary = qs.summarizePlan(`<?xml version="1.0"?>
<!DOCTYPE ShowPlanXML>
<!-- <StmtSimple StatementText="hidden" /> -->
<ShowPlanXML><BatchSequence><Batch><Statements>
<StmtSimple StatementText='SELECT "a" &lt; 2'><![CDATA[<QueryPlan>]]>
<QueryPlan><RelOp NodeId="0" PhysicalOp="Constant Scan" EstimatedTotalSubtreeCost="1" /></QueryPlan>
</StmtSimple>
</Statements></Batch></BatchSequence></ShowPlanXML>`);

        assert.equal(summary.statements.length, 1);
        assert.equal(summary.statements[0].statementText, 'SELECT "a" < 2');
        assert.equal(summary.statements[0].topOperators[0].physicalOp, "Constant Scan");
    });

    test("does not summarize text that is not a showplan", () => {
        assert.equal(qs.summarizePlan("<NotAPlan />"), undefined);
        assert.equal(qs.summarizePlan("<ShowPlanXML><Open></ShowPlanXML>"), undefined);
        assert.equal(qs.summarizePlan("not xml"), undefined);
    });
});

suite("System catalog queries", () => {
    test("finds queries that read only catalog views", () => {
        assert.equal(
            qs.readsOnlySystemCatalog(
                "SELECT o.name FROM [sys].[objects] [o] WITH (NOLOCK) LEFT JOIN sys.assembly_modules am ON 1 = 1",
            ),
            true,
        );
        assert.equal(qs.readsOnlySystemCatalog("SELECT * FROM INFORMATION_SCHEMA.TABLES"), true);
        assert.equal(qs.readsOnlySystemCatalog("SELECT * FROM sysobjects"), true);
        assert.equal(
            qs.readsOnlySystemCatalog(
                "WITH t AS (SELECT * FROM sys.tables) SELECT * FROM t JOIN #work w ON 1 = 1",
            ),
            true,
        );
    });

    test("skips nested comments and reads quoted names with their escapes", () => {
        assert.equal(
            qs.readsOnlySystemCatalog(
                "/* outer /* inner */ FROM dbo.Orders */ SELECT * FROM [sys].[all_objects]",
            ),
            true,
        );
        assert.equal(
            qs.readsOnlySystemCatalog('SELECT * FROM "sys"."tables" JOIN [dbo].[a]]b] ON 1 = 1'),
            false,
        );
        assert.equal(
            qs.readsOnlySystemCatalog(
                "SELECT * FROM sys.objects WHERE name = N'it''s FROM Orders'",
            ),
            true,
        );
    });

    test("does not flag queries that read user tables", () => {
        assert.equal(
            qs.readsOnlySystemCatalog("SELECT * FROM dbo.Orders o JOIN sys.objects s ON 1 = 1"),
            false,
        );
        assert.equal(qs.readsOnlySystemCatalog("SELECT 1"), false);
        assert.equal(qs.readsOnlySystemCatalog("SELECT * FROM Orders -- FROM sys.objects"), false);
        assert.equal(qs.readsOnlySystemCatalog("SELECT 'FROM sys.objects' FROM Orders"), false);
    });
});

suite("Query analysis", () => {
    test("reads the query, its plans, history, waits, and plan summaries", async () => {
        const detailsColumns = [
            "query_id",
            "query_text",
            "object_schema_name",
            "object_name",
            "last_execution_time",
            "total_plan_count",
            "forced_plan_id",
        ];
        const planRow = (planId, duration) => ({ planId, duration });
        const reader = scriptedReader([
            // Details: the query, then its stats.
            [
                stateSet(),
                resultSet(detailsColumns, [["2504", "SELECT 1", null, null, null, 2, null]]),
                resultSet(["plan_count", "executions"], [[2, 3]]),
            ],
            // Plans.
            [
                stateSet(),
                resultSet(
                    ["plan_id", "query_id", "is_forced_plan", "executions", "duration_total"],
                    [planRow("7", 100), planRow("9", 9000)].map((plan) => [
                        plan.planId,
                        "2504",
                        0,
                        1,
                        plan.duration,
                    ]),
                ),
            ],
            // History.
            [stateSet(), resultSet(["start_time", "end_time", "plan_id", "executions"])],
            // Waits.
            [
                stateSet(),
                resultSet(["wait_capture"], [[1]]),
                resultSet(waitColumns),
                executions(0, 0),
            ],
            // Plan XML of the longest running plan, then of the other.
            [stateSet(), resultSet(["query_plan"], [[showplan]])],
            [stateSet(), resultSet(["query_plan"], [["not a plan"]])],
        ]);

        const result = await qs.buildQueryAnalysis(reader, capabilities(), {
            ...window,
            queryId: "2504",
        });

        assert.equal(result.status, "ready");
        assert.equal(result.data.query.queryId, "2504");
        assert.equal(result.data.plans.length, 2);
        assert.deepEqual(result.data.history, []);
        assert.equal(result.data.waits, undefined);
        assert.deepEqual(
            result.data.planSummaries.map((plan) => plan.planId),
            ["9"],
        );
        assert.match(reader.calls[4], /DECLARE @plan_id bigint = CAST\(9 AS bigint\);/);
        assert.match(reader.calls[5], /DECLARE @plan_id bigint = CAST\(7 AS bigint\);/);
    });

    test("stops at the query when Query Store does not have it", async () => {
        const reader = scriptedReader([[stateSet(), resultSet(["query_text"]), resultSet([])]]);

        const result = await qs.buildQueryAnalysis(reader, capabilities(), {
            ...window,
            queryId: "1",
        });

        assert.equal(result.status, "noData");
        assert.equal(reader.calls.length, 1);
    });
});
