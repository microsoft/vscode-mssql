/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as chai from "chai";
import { expect } from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import {
    AnalyzeQueryTool,
    OpenPerformanceDashboardTool,
    PlanForcingTool,
    PlanForcingToolParams,
    PlanSummaryTool,
    QueryStoreStatusTool,
    TopQueriesTool,
    TopQueriesToolParams,
    WaitStatsTool,
    dashboardLocation,
    resolveQueryStoreTarget,
    resolveToolWindow,
} from "../../src/copilot/tools/queryStoreTools";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import * as LocConstants from "../../src/constants/locConstants";
import { IConnectionProfile } from "../../src/models/interfaces";
import { QueryStoreService } from "../../src/performance/queryStoreService";

chai.use(sinonChai);

const token = {} as vscode.CancellationToken;

function invocation<T>(input: T): vscode.LanguageModelToolInvocationOptions<T> {
    return { input } as vscode.LanguageModelToolInvocationOptions<T>;
}

function prepareOptions<T>(input: T): vscode.LanguageModelToolInvocationPrepareOptions<T> {
    return { input } as vscode.LanguageModelToolInvocationPrepareOptions<T>;
}

const showplan = `<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan">
<BatchSequence><Batch><Statements>
<StmtSimple StatementText="SELECT 1" StatementSubTreeCost="2.5">
<QueryPlan><RelOp NodeId="0" PhysicalOp="Table Scan" EstimateRows="1" EstimatedTotalSubtreeCost="2.5" /></QueryPlan>
</StmtSimple>
</Statements></Batch></BatchSequence>
</ShowPlanXML>`;

suite("Query Store tools", () => {
    let sandbox: sinon.SinonSandbox;
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let getConnectionById: sinon.SinonStub;
    let run: sinon.SinonStub;
    let service: QueryStoreService;
    let credentials: Partial<IConnectionProfile>;

    setup(() => {
        sandbox = sinon.createSandbox();
        credentials = { id: "profile-1", server: "server-1", database: "Sales" };
        connectionManager = sandbox.createStubInstance(ConnectionManager);
        connectionManager.getConnectionInfo.callsFake(
            () => ({ credentials }) as unknown as ConnectionInfo,
        );
        getConnectionById = sandbox.stub().resolves(undefined);
        sandbox.stub(connectionManager, "connectionStore").get(
            () =>
                ({
                    connectionConfig: { getConnectionById },
                }) as unknown as ConnectionManager["connectionStore"],
        );
        run = sandbox.stub();
        service = { run } as unknown as QueryStoreService;
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("targets and windows", () => {
        test("reads the saved profile and database of the connection", async () => {
            const target = await resolveQueryStoreTarget(
                { connectionId: "uri" },
                connectionManager,
            );
            expect(target).to.include({
                profileId: "profile-1",
                serverName: "server-1",
                databaseName: "Sales",
            });
        });

        test("reads another database when one is given", async () => {
            const target = await resolveQueryStoreTarget(
                { connectionId: "uri", database: " Orders " },
                connectionManager,
            );
            expect(target).to.include({ databaseName: "Orders" });
        });

        test("reads a saved profile without a connection", async () => {
            getConnectionById.resolves({
                id: "profile-2",
                server: "server-2",
                database: "lowdtu",
            });

            const target = await resolveQueryStoreTarget(
                { profileId: "profile-2" },
                connectionManager,
            );

            expect(target).to.include({
                profileId: "profile-2",
                serverName: "server-2",
                databaseName: "lowdtu",
            });
            expect(connectionManager.getConnectionInfo).to.not.have.been.called;
        });

        test("reports a profile that does not exist", async () => {
            const target = await resolveQueryStoreTarget({ profileId: "gone" }, connectionManager);
            expect(target).to.deep.equal({
                message: LocConstants.QueryStoreTools.profileNotFound("gone"),
            });
        });

        test("needs a connection or a profile", async () => {
            const target = await resolveQueryStoreTarget({}, connectionManager);
            expect(target).to.deep.equal({
                message: LocConstants.QueryStoreTools.connectionOrProfileRequired,
            });
        });

        test("needs a connection from a saved profile", async () => {
            credentials = { server: "server-1" };
            const target = await resolveQueryStoreTarget(
                { connectionId: "uri" },
                connectionManager,
            );
            expect(target).to.deep.equal({
                message: LocConstants.QueryStoreTools.savedProfileRequired,
            });
        });

        test("resolves the last hours, or a start and an end", () => {
            const now = new Date("2026-10-27T12:00:00Z");
            expect(resolveToolWindow({}, now)?.start.toISOString()).to.equal(
                "2026-10-26T12:00:00.000Z",
            );
            expect(resolveToolWindow({ hours: 2 }, now)?.start.toISOString()).to.equal(
                "2026-10-27T10:00:00.000Z",
            );
            const window = resolveToolWindow(
                { startUtc: "2026-10-01T00:00:00Z", endUtc: "2026-10-02T00:00:00Z" },
                now,
            );
            expect(window?.end.toISOString()).to.equal("2026-10-02T00:00:00.000Z");
        });

        test("rejects a window that is not valid", () => {
            expect(resolveToolWindow({ hours: 0 })).to.be.undefined;
            expect(resolveToolWindow({ hours: 9000 })).to.be.undefined;
            expect(resolveToolWindow({ startUtc: "2026-10-02T00:00:00Z" })).to.be.undefined;
            expect(
                resolveToolWindow({
                    startUtc: "2026-10-02T00:00:00Z",
                    endUtc: "2026-10-01T00:00:00Z",
                }),
            ).to.be.undefined;
        });
    });

    suite("reads", () => {
        test("returns the status, and why the database could not be read", async () => {
            run.resolves({ status: "unavailable", reason: "dataPlaneDisabled" });
            const tool = new QueryStoreStatusTool(connectionManager, service);

            const result = JSON.parse(await tool.call(invocation({ connectionId: "uri" }), token));

            expect(result).to.deep.include({
                success: false,
                status: "unavailable",
                reason: "dataPlaneDisabled",
            });
            expect(run).to.have.been.calledWith("profile-1", "Sales");
        });

        test("returns the top queries with rounded stats, cut text, and the catalog flag", async () => {
            run.resolves({
                status: "ready",
                queryStore: { actualState: "readWrite" },
                data: {
                    queries: [
                        {
                            queryId: "7",
                            queryText: "x".repeat(1500),
                            readsOnlySystemCatalog: true,
                            planCount: 2,
                            executionCount: 3,
                            metrics: {
                                cpuTime: { total: 10.123, avg: 3.3743, min: 1, max: 5, stdev: 1.5 },
                            },
                        },
                    ],
                    workload: { executionCount: 30, metrics: {} },
                },
            });
            const tool = new TopQueriesTool(connectionManager, service);

            const result = JSON.parse(
                await tool.call(
                    invocation<TopQueriesToolParams>({ connectionId: "uri", rankBy: "cpuTime" }),
                    token,
                ),
            );

            expect(result.success).to.be.true;
            const [query] = result.data.queries;
            expect(query.queryText).to.have.length(1000);
            expect(query.queryTextTruncated).to.be.true;
            expect(query.readsOnlySystemCatalog).to.be.true;
            expect(query.metrics.cpuTime).to.deep.equal({
                total: 10.12,
                avg: 3.37,
                min: 1,
                max: 5,
                stdev: 1.5,
            });
            expect(result.data.workload.executionCount).to.equal(30);
        });

        test("does not read with a window that is not valid", async () => {
            const tool = new TopQueriesTool(connectionManager, service);

            const result = JSON.parse(
                await tool.call(
                    invocation<TopQueriesToolParams>({
                        connectionId: "uri",
                        rankBy: "cpuTime",
                        hours: 0,
                    }),
                    token,
                ),
            );

            expect(result).to.deep.equal({
                success: false,
                message: LocConstants.QueryStoreTools.invalidTimeWindow,
            });
            expect(run).to.not.have.been.called;
        });

        test("reads without a confirmation", async () => {
            const tool = new QueryStoreStatusTool(connectionManager, service);

            const prepared = await tool.prepareInvocation(
                prepareOptions({ connectionId: "uri" }),
                token,
            );

            expect(prepared).to.not.have.property("confirmationMessages");
            expect(prepared.invocationMessage).to.include("'Sales'");
            expect(run).to.not.have.been.called;
        });

        test("returns the waits with rounded numbers", async () => {
            run.resolves({
                status: "ready",
                data: {
                    captureMode: "on",
                    executionCount: 1,
                    durationTotalMs: 6016.104,
                    totalWaitMs: 5843.333,
                    categories: [
                        {
                            category: "Buffer IO",
                            totalMs: 4960.111,
                            avgMsPerExecution: 4960.111,
                            maxMs: 4960,
                            share: 0.84889,
                        },
                    ],
                    intervals: [],
                },
            });
            const tool = new WaitStatsTool(connectionManager, service);

            const result = JSON.parse(
                await tool.call(invocation({ connectionId: "uri", queryId: "2504" }), token),
            );

            expect(result.data).to.include({ totalWaitMs: 5843.33, durationTotalMs: 6016.1 });
            expect(result.data.categories[0]).to.include({ category: "Buffer IO", share: 0.85 });
            expect(result.data).to.not.have.property("intervals");
        });

        test("summarizes a plan instead of returning its XML", async () => {
            run.resolves({ status: "ready", data: showplan });
            const tool = new PlanSummaryTool(connectionManager, service);

            const result = JSON.parse(
                await tool.call(invocation({ connectionId: "uri", planId: "105" }), token),
            );

            expect(result.data.planId).to.equal("105");
            expect(result.data.statements[0].topOperators[0]).to.include({
                physicalOp: "Table Scan",
                costShare: 1,
            });
            expect(JSON.stringify(result)).to.not.include("ShowPlanXML");
        });

        test("analyzes a query through a saved profile", async () => {
            getConnectionById.resolves({ id: "profile-2", server: "server-2", database: "lowdtu" });
            run.resolves({
                status: "ready",
                data: {
                    startUtc: "2026-10-26T00:00:00.000Z",
                    endUtc: "2026-10-27T00:00:00.000Z",
                    query: {
                        queryId: "2504",
                        queryText: "SELECT 1",
                        readsOnlySystemCatalog: false,
                        planCount: 1,
                        totalPlanCount: 1,
                        executionCount: 1,
                        metrics: {},
                    },
                    plans: [],
                    history: [],
                    planSummaries: [],
                },
            });
            const tool = new AnalyzeQueryTool(connectionManager, service);

            const result = JSON.parse(
                await tool.call(invocation({ profileId: "profile-2", queryId: "2504" }), token),
            );

            expect(result.success).to.be.true;
            expect(result.data.query.queryId).to.equal("2504");
            expect(run).to.have.been.calledWith("profile-2", "lowdtu");
        });
    });

    suite("plan forcing", () => {
        const input: PlanForcingToolParams = {
            connectionId: "uri",
            action: "force",
            queryId: "7",
            planId: "9",
        };
        const sql =
            "EXEC sys.sp_query_store_force_plan @query_id = @query_id, @plan_id = @plan_id;";

        test("shows the T-SQL to confirm, then runs the reviewed change", async () => {
            const prepared = {
                target: { kind: "forcePlan", queryId: "7", planId: "9" },
                sql,
                prior: {},
                blockers: [],
                warnings: ["replacesForcedPlan"],
            };
            run.onFirstCall().resolves({ status: "ready", data: prepared });
            run.onSecondCall().resolves({
                status: "ready",
                data: { applied: true, blockers: [], appliedAtUtc: "2026-10-27T12:00:00.000Z" },
            });
            const tool = new PlanForcingTool(connectionManager, service);

            const confirmation = await tool.prepareInvocation(prepareOptions(input), token);
            const message = confirmation.confirmationMessages?.message as vscode.MarkdownString;
            expect(message.value).to.include(sql);
            expect(message.value).to.include(
                LocConstants.QueryStoreTools.warningReplacesForcedPlan,
            );

            const result = JSON.parse(await tool.call(invocation(input), token));

            expect(result.data).to.include({ applied: true });
            const [, , operation, purpose] = run.secondCall.args;
            expect(operation).to.be.a("function");
            expect(purpose).to.equal("change");
        });

        test("does not ask or run when the change is blocked", async () => {
            run.resolves({
                status: "ready",
                data: {
                    target: { kind: "forcePlan", queryId: "7", planId: "9" },
                    sql,
                    prior: {},
                    blockers: ["planAlreadyForced"],
                    warnings: [],
                },
            });
            const tool = new PlanForcingTool(connectionManager, service);

            const confirmation = await tool.prepareInvocation(prepareOptions(input), token);
            const result = JSON.parse(await tool.call(invocation(input), token));

            expect(confirmation.confirmationMessages).to.be.undefined;
            expect(result.data).to.deep.include({
                applied: false,
                blockers: ["planAlreadyForced"],
            });
            expect(run).to.have.been.calledOnce;
        });

        test("refuses a change that was not reviewed", async () => {
            const tool = new PlanForcingTool(connectionManager, service);

            const result = JSON.parse(await tool.call(invocation(input), token));

            expect(result).to.deep.equal({
                success: false,
                message: LocConstants.QueryStoreTools.planChangeNotReviewed,
            });
            expect(run).to.not.have.been.called;
        });
    });

    suite("dashboard", () => {
        test("builds the location of a query and tab", () => {
            expect(dashboardLocation({ connectionId: "uri" })).to.equal("queries");
            expect(dashboardLocation({ connectionId: "uri", queryId: "913" })).to.equal(
                "queries/913",
            );
            expect(
                dashboardLocation({ connectionId: "uri", queryId: "913", tab: "waits" }),
            ).to.equal("queries/913?tab=waits");
            expect(dashboardLocation({ connectionId: "uri", queryId: "1; DROP" })).to.equal(
                "queries",
            );
        });

        test("opens the dashboard of the connection's database", async () => {
            const open = sandbox.stub();
            const tool = new OpenPerformanceDashboardTool(connectionManager, open);

            await tool.call(
                invocation({ connectionId: "uri", queryId: "913", tab: "plans" as const }),
                token,
            );

            expect(open).to.have.been.calledWith(
                { profileId: "profile-1", serverName: "server-1", databaseName: "Sales" },
                "queries/913?tab=plans",
            );
        });
    });
});
