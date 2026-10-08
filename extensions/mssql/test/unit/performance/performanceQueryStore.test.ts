/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import { regressedQuerySummary, topResourceConsumersSummary } from "sql-core/performance";
import { PerformanceService, PerformanceTarget } from "../../../src/performance/performanceService";
import { PerformanceSessionPool } from "../../../src/performance/performanceSessionPool";
import { PerformanceConnectionResolver } from "../../../src/performance/performanceConnections";
import { isPerformanceUnavailable } from "../../../src/sharedInterfaces/performance";
import {
    FakeConnectionService,
    FakeQuery,
    QueryScript,
    ScriptedResultSet,
    fakeHost,
    testConnection,
} from "./dataPlaneFakes";

const metricColumns = [
    "count_executions",
    "avg_duration",
    "avg_cpu_time",
    "avg_logical_io_reads",
    "avg_logical_io_writes",
    "avg_physical_io_reads",
    "avg_clr_time",
    "avg_dop",
    "avg_query_max_used_memory",
    "avg_rowcount",
    "avg_log_bytes_used",
    "avg_tempdb_space_used",
];

const planColumns = [
    "plan_id",
    "query_id",
    "query_plan_hash",
    "is_forced_plan",
    "force_failure_count",
    "last_force_failure_reason_desc",
    "plan_forcing_type_desc",
    "plan_type_desc",
    "last_execution_time",
];

const markers = {
    platform: "SERVERPROPERTY('EngineEdition')",
    probe: "sys.database_query_store_options",
    metricsProbe: "select top(1) * from sys.query_store_runtime_stats;",
    replicaProbe: "c.name = 'replica_group_id'",
    planColumnsProbe: "has_plan_forcing_type",
    regressedPlans: "AS w (time_window",
    planState: "AS server_time",
    forcePlan: "sp_query_store_force_plan",
};

/** Answers the sql-core batches of a database with Query Store in the given state. */
function queryStoreDatabase(
    state: { engineEdition?: number; actualState?: number; report?: ScriptedResultSet } = {},
) {
    return (text: string): QueryScript => {
        if (text.includes(markers.platform)) {
            return {
                resultSets: [
                    {
                        columns: ["engine_edition", "product_version", "data_lake_log_publishing"],
                        values: [[state.engineEdition ?? 5, "12.0.2000.8", "AUTO"]],
                        typeHints: ["number", "string", "string"],
                    },
                ],
            };
        }
        if (text.includes(markers.probe)) {
            const sets: ScriptedResultSet[] = [
                {
                    columns: ["actual_state", "readonly_reason"],
                    values: [[state.actualState ?? 2, 0]],
                    typeHints: ["number", "number"],
                },
            ];
            if (text.includes(markers.metricsProbe)) {
                sets.push({
                    columns: [
                        "runtime_stats_id",
                        "plan_id",
                        "first_execution_time",
                        ...metricColumns,
                    ],
                    values: [],
                });
                sets.push({ columns: ["result"], values: [[true]], typeHints: ["boolean"] });
            }
            if (text.includes(markers.replicaProbe)) {
                sets.push({
                    columns: ["ReplicaColumnExists"],
                    values: [[0]],
                    typeHints: ["number"],
                });
            }
            if (text.includes(markers.planColumnsProbe)) {
                sets.push({
                    columns: ["has_plan_forcing_type", "has_plan_type"],
                    values: [[1, 1]],
                    typeHints: ["number", "number"],
                });
            }
            return { resultSets: sets };
        }
        if (text.includes(markers.regressedPlans)) {
            return {
                resultSets: [
                    {
                        columns: ["query_id", "time_window", "plan_id", "query_plan_hash"],
                        values: [
                            ["7", "history", "10", "0xAAAA"],
                            ["7", "recent", "11", "0xBBBB"],
                        ],
                    },
                ],
            };
        }
        if (text.includes(markers.planState)) {
            return {
                resultSets: [
                    { columns: ["server_time"], values: [["2026-10-08 06:00:00.0000000 +00:00"]] },
                    {
                        columns: planColumns,
                        values: [
                            ["9", "7", "0xAAAA", false, 0, "NONE", "NONE", "Compiled", undefined],
                        ],
                        typeHints: [
                            "string",
                            "string",
                            "string",
                            "boolean",
                            "number",
                            "string",
                            "string",
                            "string",
                            "datetime",
                        ],
                    },
                    { columns: planColumns, values: [] },
                ],
            };
        }
        if (text.includes(markers.forcePlan)) {
            return {};
        }
        return { resultSets: state.report ? [state.report] : [] };
    };
}

/** A report result set with one row for query 7. */
function reportSet(columns: readonly { id: string; kind: string }[]): ScriptedResultSet {
    return {
        columns: columns.map((column) => column.id),
        values: [columns.map((column) => (column.kind === "queryId" ? "7" : 1))],
    };
}

suite("Performance service Query Store", () => {
    let sandbox: sinon.SinonSandbox;
    let dataPlane: FakeConnectionService;
    let performance: PerformanceService;

    setup(() => {
        sandbox = sinon.createSandbox();
        dataPlane = new FakeConnectionService(queryStoreDatabase());
        performance = new PerformanceService(
            {
                resolve: async () => ({ connection: testConnection(), database: "AppDb" }),
            } as PerformanceConnectionResolver,
            new PerformanceSessionPool(fakeHost(dataPlane)),
        );
    });

    teardown(() => {
        performance.dispose();
        sandbox.restore();
    });

    async function resolveTarget(): Promise<PerformanceTarget> {
        const target = await performance.resolveTarget({ ownerUri: "query://1" });
        expect(isPerformanceUnavailable(target), JSON.stringify(target)).to.equal(false);
        return target as PerformanceTarget;
    }

    function queries(): FakeQuery[] {
        return dataPlane.sessions.flatMap((session) => session.queries);
    }

    function probes(): FakeQuery[] {
        return queries().filter((query) => query.text.includes(markers.probe));
    }

    test("caches the Query Store capabilities until the session reopens", async () => {
        const target = await resolveTarget();

        const capabilities = await target.queryStoreCapabilities();
        expect(capabilities.status).to.equal("ready");
        expect(capabilities.data?.operationalStatus).to.equal("readWrite");
        expect(capabilities.data?.availableMetrics).to.include.members(["cpuTime", "waitTime"]);
        expect(capabilities.data?.isQdsRoAvailable).to.equal(false);

        await target.topConsumers({});
        const cachedProbe = probes()[1].text;
        expect(cachedProbe).to.not.contain(markers.metricsProbe);
        expect(cachedProbe).to.not.contain(markers.replicaProbe);

        dataPlane.lastSession.setState("lost");
        await target.topConsumers({});
        const reopenedProbe = probes()[2].text;
        expect(dataPlane.sessions).to.have.length(2);
        expect(reopenedProbe).to.contain(markers.metricsProbe);
        expect(reopenedProbe).to.contain(markers.replicaProbe);
    });

    test("returns a report from sql-core unchanged and forwards the timeout", async () => {
        const { columns } = topResourceConsumersSummary({});
        dataPlane.respond = queryStoreDatabase({ report: reportSet(columns) });
        const target = await resolveTarget();

        const result = await target.topConsumers({}, { timeoutMs: 7_000 });

        expect(result.status).to.equal("ready");
        expect(result.source).to.equal("queryStore");
        expect(result.platform).to.equal("azureSqlDatabase");
        expect(result.data?.columns.map((column) => column.id)).to.deep.equal(
            columns.map((column) => column.id),
        );
        expect(result.data?.rows).to.have.length(1);
        const queryIdColumn = columns.find((column) => column.kind === "queryId");
        expect(result.data?.rows[0][queryIdColumn!.id]).to.equal("7");
        for (const query of queries().filter((q) => !q.text.includes(markers.platform))) {
            expect(query.options.timeoutMs).to.be.at.most(7_000);
        }
    });

    test("returns regressed queries with their plan changes", async () => {
        const { columns } = regressedQuerySummary({});
        dataPlane.respond = queryStoreDatabase({ report: reportSet(columns) });
        const target = await resolveTarget();

        const result = await target.regressedQueries({});

        expect(result.status).to.equal("ready");
        expect(result.missing).to.deep.equal([]);
        expect(result.data?.planChanges).to.have.length(1);
        expect(result.data?.planChanges?.[0]).to.deep.include({
            queryId: "7",
            newPlan: true,
            newPlanHashes: ["0xBBBB"],
        });
    });

    test("prepares a plan change on the read session and applies it on the change session", async () => {
        const target = await resolveTarget();

        const prepared = await target.prepareForcePlan({ queryId: 7, planId: 9 });
        expect(prepared.status).to.equal("ready");
        expect(prepared.data?.blockers).to.deep.equal([]);
        expect(queries().some((query) => query.text.includes(markers.forcePlan))).to.equal(false);

        const applied = await target.applyChange(prepared.data!);

        expect(applied.status).to.equal("ready");
        expect(applied.data).to.deep.include({ applied: true, blockers: [] });
        expect(applied.data?.appliedAtUtc).to.equal("2026-10-08T06:00:00.000Z");
        expect(dataPlane.sessions).to.have.length(2);
        const [readSession, changeSession] = dataPlane.sessions;
        expect(readSession.queries.some((query) => query.text.includes(markers.forcePlan))).to.be
            .false;
        const changeBatches = changeSession.queries.map((query) => query.text);
        expect(changeBatches.filter((text) => text.includes(markers.forcePlan))).to.have.length(1);
        expect(changeBatches[changeBatches.length - 1]).to.contain(markers.forcePlan);
    });

    test("reports Query Store that is off as not configured", async () => {
        dataPlane.respond = queryStoreDatabase({ actualState: 0 });
        const target = await resolveTarget();

        expect((await target.queryStoreCapabilities()).status).to.equal("notConfigured");
        expect((await target.topConsumers({})).status).to.equal("notConfigured");
    });

    test("reports a platform without Query Store as unsupported without reading it", async () => {
        dataPlane.respond = queryStoreDatabase({ engineEdition: 11 });
        const target = await resolveTarget();

        const result = await target.topConsumers({});

        expect(result.status).to.equal("unsupported");
        expect(result.platform).to.equal("fabricWarehouse");
        expect(probes()).to.have.length(0);
    });

    test("reports a disabled data plane before any Query Store read", async () => {
        const disabled = new PerformanceService(
            { resolve: sandbox.stub() } as PerformanceConnectionResolver,
            new PerformanceSessionPool(
                fakeHost(dataPlane, { wasEnabledAtActivation: () => false }),
            ),
        );

        const result = await disabled.resolveTarget({ ownerUri: "query://1" });

        expect(result).to.deep.include({ status: "unavailable", reason: "reloadRequired" });
        expect(dataPlane.openParams).to.have.length(0);
    });
});
