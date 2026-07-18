/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Runtime-planner plan IR -> lock mapping (R1.2, D-0010). Node fixtures
 * mirror the LIVE planner session capture (strategy
 * "primitive:mcp:sql-copilot:mssql_execute_read_query" with the statement
 * under primitiveArgs.sql; Aggregation/Recommendation nodes with empty
 * strategies). The mapped lock must reference the library asset and pass
 * the same structural validation the editor applies.
 */

import { expect } from "chai";
import {
    buildArtifactFromLibraryAsset,
    buildPlannedArtifact,
    humanizeNodeId,
    isPlannedArtifactFailure,
    mapPlannerNodeToLockNode,
    PlannedRunbook,
} from "../../src/runbookStudio/models/plannerMapping";
import { createNewRunbookArtifact } from "../../src/runbookStudio/runbookArtifact";
import { RunbookArtifactFile } from "../../src/sharedInterfaces/runbookStudio";

function planned(): PlannedRunbook {
    return {
        assetId: "blocking-queries",
        title: "Blocking Queries",
        plan: {
            entryNodeId: "probe-current-request-health",
            nodes: [
                {
                    id: "probe-current-request-health",
                    type: "Observation",
                    role: "observation",
                    strategy: "primitive:mcp:sql-copilot:mssql_execute_read_query",
                    primitiveArgs: {
                        queryDescription: "Probe live request health.",
                        sql: "SELECT r.session_id FROM sys.dm_exec_requests r",
                    },
                },
                {
                    id: "summarize-current-activity",
                    type: "Aggregation",
                    role: "aggregation",
                },
                {
                    id: "final-report",
                    type: "Report",
                    role: "report",
                },
            ],
            edges: [
                { from: "probe-current-request-health", to: "summarize-current-activity" },
                { from: "summarize-current-activity", to: "final-report" },
            ],
        },
        inputSchema: [{ name: "database", kind: "connection" }],
    };
}

suite("plannerMapping", () => {
    test("humanizeNodeId spaces kebab ids and capitalizes the first letter", () => {
        expect(humanizeNodeId("collect-live-head-blockers")).to.equal("Collect live head blockers");
        expect(humanizeNodeId("probe")).to.equal("Probe");
        expect(humanizeNodeId("")).to.equal("");
    });

    test("SQL read strategies map to sql.query.read with the connection bind", () => {
        const node = mapPlannerNodeToLockNode(planned().plan.nodes[0], "database");
        expect(node).to.deep.equal({
            id: "probe-current-request-health",
            label: "Probe live request health.",
            kind: "activity",
            activityKind: "sql.query.read",
            activityVersion: 1,
            inputs: {
                connection: "$params.database",
                sql: "SELECT r.session_id FROM sys.dm_exec_requests r",
            },
        });
    });

    test("the runtime's own sql.execute-query primitive maps too (query arg)", () => {
        const node = mapPlannerNodeToLockNode(
            {
                id: "count-orders",
                strategy: "primitive:sql.execute-query",
                primitiveArgs: { query: "SELECT COUNT(*) FROM dbo.Orders" },
            },
            "target",
        );
        expect(node.activityKind).to.equal("sql.query.read");
        expect(node.inputs).to.deep.equal({
            connection: "$params.target",
            sql: "SELECT COUNT(*) FROM dbo.Orders",
        });
        // No queryDescription: the node id is the honest label.
        expect(node.label).to.equal("count-orders");
    });

    test("Report nodes map to report", () => {
        const node = mapPlannerNodeToLockNode(planned().plan.nodes[2], "database");
        expect(node).to.deep.equal({ id: "final-report", label: "final-report", kind: "report" });
    });

    test("everything else maps to hobbes.native carrying the strategy or type", () => {
        const aggregation = mapPlannerNodeToLockNode(planned().plan.nodes[1], "database");
        expect(aggregation).to.deep.equal({
            id: "summarize-current-activity",
            label: "Summarize current activity",
            kind: "activity",
            activityKind: "hobbes.native",
            activityVersion: 1,
            inputs: { strategy: "Aggregation" },
        });
        const waiter = mapPlannerNodeToLockNode(
            { id: "pause-for-approval", strategy: "primitive:wait.signal" },
            "database",
        );
        expect(waiter.activityKind).to.equal("hobbes.native");
        expect(waiter.inputs).to.deep.equal({ strategy: "primitive:wait.signal" });
        const bare = mapPlannerNodeToLockNode({ id: "mystery-step" }, "database");
        expect(bare.inputs).to.deep.equal({ strategy: "unknown" });
    });

    test("buildPlannedArtifact stamps the library asset ref and connection parameter", () => {
        const result = buildPlannedArtifact(
            createNewRunbookArtifact("New runbook", "rb-test"),
            "are there blocking queries?",
            planned(),
        );
        if (isPlannedArtifactFailure(result)) {
            throw new Error(result.detail);
        }
        const artifact = result.artifact;
        expect(artifact.lock?.libraryAssetRef).to.deep.equal({ assetId: "blocking-queries" });
        expect(artifact.lock?.planRevision).to.equal("1");
        expect(artifact.lock?.entryNodeId).to.equal("probe-current-request-health");
        expect(artifact.lock?.planHash).to.match(/^sha256:[0-9a-f]{64}$/);
        expect(artifact.source.intent).to.equal("are there blocking queries?");
        expect(artifact.source.parameters).to.deep.equal([
            { id: "database", label: "Target connection", type: "connection", required: true },
        ]);
        // Unnamed runbooks adopt the planner's title.
        expect(artifact.name).to.equal("Blocking Queries");
        expect(artifact.lock?.edges).to.deep.equal(planned().plan.edges);
    });

    test("buildPlannedArtifact keeps an existing parameter that matches by id and bumps the revision", () => {
        const base = createNewRunbookArtifact("Blocking check", "rb-test");
        base.source.parameters = [
            { id: "database", label: "Prod connection", type: "connection", required: true },
        ];
        base.lock = {
            schemaVersion: 1,
            planRevision: "3",
            planHash: "sha256:old",
            entryNodeId: "n1",
            nodes: [{ id: "n1", label: "n1", kind: "report" }],
            edges: [],
        };
        const result = buildPlannedArtifact(base, "intent", planned());
        if (isPlannedArtifactFailure(result)) {
            throw new Error(result.detail);
        }
        expect(result.artifact.lock?.planRevision).to.equal("4");
        expect(result.artifact.source.parameters[0].label).to.equal("Prod connection");
        // Named runbooks keep their name.
        expect(result.artifact.name).to.equal("Blocking check");
    });

    test("buildPlannedArtifact refuses an empty plan with the exact detail", () => {
        const empty = planned();
        empty.plan.nodes = [];
        empty.plan.edges = [];
        const result = buildPlannedArtifact(
            createNewRunbookArtifact("New runbook", "rb-test"),
            "intent",
            empty,
        );
        expect(isPlannedArtifactFailure(result)).to.equal(true);
        if (isPlannedArtifactFailure(result)) {
            expect(result.detail).to.contain("no plan nodes");
        }
    });

    // -- library interop (D-0012): outside-authored runtime assets ----------

    /** Raw `GET /api/runbooks/{id}` payload for an OUTSIDE-authored asset
     *  (no publish-time stash) — same plan-IR fixtures as planned(). */
    function libraryAsset(): Record<string, unknown> {
        return {
            id: "blocking-queries",
            title: "Blocking Queries",
            description: "Find live head blockers.",
            category: "investigate",
            state: "approved",
            versionLabel: "1.02",
            sourcePromptText: "are there blocking queries?",
            plan: {
                entryNodeId: "probe-current-request-health",
                nodes: planned().plan.nodes,
                edges: planned().plan.edges,
            },
            inputSchema: [{ name: "database", kind: "connection" }],
        };
    }

    function buildOk(asset: Record<string, unknown>): RunbookArtifactFile {
        const result = buildArtifactFromLibraryAsset(asset);
        if (isPlannedArtifactFailure(result)) {
            throw new Error(result.detail);
        }
        return result.artifact;
    }

    test("buildArtifactFromLibraryAsset maps a raw outside-authored asset completely", () => {
        const artifact = buildOk(libraryAsset());
        expect(artifact.id).to.equal("blocking-queries");
        expect(artifact.name).to.equal("Blocking Queries");
        expect(artifact.description).to.equal("Find live head blockers.");
        expect(artifact.family).to.equal("investigate");
        // Intent prefers the authored prompt over description/title.
        expect(artifact.source.intent).to.equal("are there blocking queries?");
        expect(artifact.source.parameters).to.deep.equal([
            { id: "database", label: "Target connection", type: "connection", required: true },
        ]);
        expect(artifact.lock?.planRevision).to.equal("1");
        expect(artifact.lock?.planHash).to.match(/^sha256:[0-9a-f]{64}$/);
        expect(artifact.lock?.entryNodeId).to.equal("probe-current-request-health");
        // The lock references the asset AND its version label, so the
        // hobbes lane launches the library asset directly.
        expect(artifact.lock?.libraryAssetRef).to.deep.equal({
            assetId: "blocking-queries",
            versionLabel: "1.02",
        });
        // Same node mapping as the planner path: SQL visible, report kept.
        const sqlNode = artifact.lock?.nodes.find(
            (node) => node.id === "probe-current-request-health",
        );
        expect(sqlNode?.activityKind).to.equal("sql.query.read");
        expect(sqlNode?.inputs?.sql).to.contain("sys.dm_exec_requests");
        const report = artifact.lock?.nodes.find((node) => node.id === "final-report");
        expect(report?.kind).to.equal("report");
    });

    test("buildArtifactFromLibraryAsset preserves the hobbes.native fallback", () => {
        const artifact = buildOk(libraryAsset());
        const aggregation = artifact.lock?.nodes.find(
            (node) => node.id === "summarize-current-activity",
        );
        expect(aggregation).to.deep.equal({
            id: "summarize-current-activity",
            label: "Summarize current activity",
            kind: "activity",
            activityKind: "hobbes.native",
            activityVersion: 1,
            inputs: { strategy: "Aggregation" },
        });
    });

    test("intent falls back sourcePromptText -> description -> title", () => {
        const noPrompt = libraryAsset();
        delete noPrompt.sourcePromptText;
        expect(buildOk(noPrompt).source.intent).to.equal("Find live head blockers.");
        const bare = libraryAsset();
        delete bare.sourcePromptText;
        delete bare.description;
        const artifact = buildOk(bare);
        expect(artifact.source.intent).to.equal("Blocking Queries");
        expect(artifact.description).to.equal(undefined);
    });

    test("family maps only the closed values; other categories are omitted", () => {
        const other = libraryAsset();
        other.category = "diagnostics";
        expect(buildOk(other).family).to.equal(undefined);
        const cased = libraryAsset();
        cased.category = "Validate";
        expect(buildOk(cased).family).to.equal("validate");
        const missing = libraryAsset();
        delete missing.category;
        expect(buildOk(missing).family).to.equal(undefined);
    });

    test("a missing version label leaves the asset ref without one", () => {
        const unversioned = libraryAsset();
        delete unversioned.versionLabel;
        expect(buildOk(unversioned).lock?.libraryAssetRef).to.deep.equal({
            assetId: "blocking-queries",
        });
    });

    test("buildArtifactFromLibraryAsset refuses an empty plan with the exact detail", () => {
        const empty = libraryAsset();
        empty.plan = { nodes: [], edges: [] };
        const result = buildArtifactFromLibraryAsset(empty);
        expect(isPlannedArtifactFailure(result)).to.equal(true);
        if (isPlannedArtifactFailure(result)) {
            expect(result.detail).to.contain("no plan nodes");
        }
        const planless = libraryAsset();
        delete planless.plan;
        const withoutPlan = buildArtifactFromLibraryAsset(planless);
        expect(isPlannedArtifactFailure(withoutPlan)).to.equal(true);
    });

    test("buildArtifactFromLibraryAsset refuses an asset without an id", () => {
        const anonymous = libraryAsset();
        delete anonymous.id;
        const result = buildArtifactFromLibraryAsset(anonymous);
        expect(isPlannedArtifactFailure(result)).to.equal(true);
        if (isPlannedArtifactFailure(result)) {
            expect(result.detail).to.contain("no id");
        }
    });
});
