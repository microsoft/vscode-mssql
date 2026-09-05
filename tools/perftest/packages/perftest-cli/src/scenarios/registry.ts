/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Scenario registry (design §7/§8). Scenario definitions are data
 * (ScenarioSpec) executed by the driver's step engine; the registry tracks
 * which are implemented so `scenarios list` never overstates coverage.
 */

import type {
    QueryStudioPerfActivateTabArgs,
    ScenarioSpec,
    ScenarioStep,
} from "@mssqlperf/contracts";

export type ScenarioMaturity =
    | "exploratory"
    | "diagnostic"
    | "measurementCandidate"
    | "ciGating"
    | "releaseGate";

export interface RegisteredScenario {
    spec: ScenarioSpec;
    /** Milestone in which the scenario becomes runnable end-to-end. */
    implemented: boolean;
    plannedMilestone: string;
    /**
     * Graduation level (peer-review scenario lifecycle). Defaults:
     * implemented scenarios are measurementCandidate until explicitly
     * promoted; unimplemented ones are exploratory. Promotion to ciGating
     * requires baseline history + variance evidence, not enthusiasm.
     */
    maturity?: ScenarioMaturity;
}

export function scenarioMaturity(entry: RegisteredScenario): ScenarioMaturity {
    return entry.maturity ?? (entry.implemented ? "measurementCandidate" : "exploratory");
}

const registry = new Map<string, RegisteredScenario>();

function register(scenario: RegisteredScenario): void {
    registry.set(scenario.spec.scenarioId, scenario);
}

// ---------------------------------------------------------------------------
// noop — the Milestone 1 seed-crystal scenario. Measures the pure harness
// loop: control round-trip + marker plumbing, no product interaction.
// ---------------------------------------------------------------------------
register({
    implemented: true, // M1: driver + noop scenario landed
    plannedMilestone: "M1",
    spec: {
        scenarioId: "noop",
        displayName: "No-op scenario (harness loop only)",
        tags: ["harness", "smoke"],
        profileMode: "fresh",
        setup: [],
        measure: {
            start: { type: "beforeFirstAction" },
            action: [{ type: "noop" }],
            end: { type: "afterLastAction" },
            timeoutMs: 30000,
        },
        success: [{ type: "noErrors", sources: ["automation"] }],
        cleanup: [],
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: true, lowerIsBetter: true },
        ],
    },
});

register({
    implemented: true, // M2: product activation markers landed in vscode-mssql
    plannedMilestone: "M2",
    spec: {
        scenarioId: "ext-normal-activation",
        displayName: "vscode-mssql normal activation (warmed profile)",
        tags: ["activation", "extension"],
        profileMode: "warmed",
        measure: {
            start: { type: "beforeFirstAction" },
            // Focusing the Object Explorer view is the deterministic user action
            // that activates the extension (its view becomes visible).
            action: [{ type: "command", command: "objectExplorer.focus", timeoutMs: 300000 }],
            end: { type: "waitForMarker", name: "mssql.activate.end" },
            // Generous: the very first run may download SQL Tools Service into the
            // product repo (cached afterwards); the warmup rep absorbs it.
            timeoutMs: 300000,
        },
        success: [
            { type: "markerSeen", name: "mssql.activate.begin" },
            { type: "markerSeen", name: "mssql.activate.end" },
            { type: "noErrors", sources: ["automation", "vscode-mssql"] },
        ],
        // Reset the sidebar to Explorer so the next rep's window restore does NOT
        // re-open the Object Explorer view (which would activate the extension at
        // startup instead of on our measured action).
        cleanup: [{ type: "command", command: "workbench.view.explorer" }],
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: true, lowerIsBetter: true },
            {
                name: "extension.activate",
                source: "marker",
                official: true,
                lowerIsBetter: true,
                beginMarker: "mssql.activate.begin",
                endMarker: "mssql.activate.end",
                component: "extension",
                processRole: "extensionHost",
            },
            {
                name: "extension.stsSpawn",
                source: "marker",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.sts.spawn.begin",
                endMarker: "mssql.sts.spawn.end",
                component: "sts",
                processRole: "extensionHost",
            },
        ],
    },
});

register({
    implemented: true, // M4': product connection markers + driver mssqlConnect step
    plannedMilestone: "M4",
    spec: {
        scenarioId: "connect-local-container",
        displayName: "Connect to local SQL Server",
        tags: ["connection", "sts", "sql"],
        profileMode: "warmed",
        sql: { connectionProfile: "default", cacheMode: "warm" },
        setup: [
            // Activate the extension outside the measured window, then give the
            // connect step a document to bind the connection to.
            { type: "command", command: "objectExplorer.focus", timeoutMs: 300000 },
            { type: "waitForMarker", name: "mssql.activate.end", timeoutMs: 300000 },
            { type: "openDocument", path: "queries/select-10000.sql" },
        ],
        measure: {
            start: { type: "beforeFirstAction" },
            action: [{ type: "mssqlConnect", profile: "default", timeoutMs: 60000 }],
            end: { type: "waitForMarker", name: "mssql.connection.ready" },
            timeoutMs: 60000,
        },
        success: [
            { type: "markerSeen", name: "mssql.connection.begin" },
            { type: "markerSeen", name: "mssql.connection.ready" },
            { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
        ],
        cleanup: [{ type: "command", command: "workbench.view.explorer" }],
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: true, lowerIsBetter: true },
            {
                name: "mssql.connection",
                source: "marker",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.connection.begin",
                endMarker: "mssql.connection.ready",
                component: "connection",
                processRole: "extensionHost",
            },
        ],
    },
});

register({
    implemented: true, // M4': query markers + webview render-complete bridge
    plannedMilestone: "M4",
    maturity: "ciGating", // the proven non-regression gate
    spec: {
        scenarioId: "query-10k-results",
        displayName: "Run query with 10000 result rows",
        tags: ["query", "results-grid", "webview", "sqlclient"],
        profileMode: "warmed",
        sql: {
            database: "PerfHarness",
            cacheMode: "warm",
            connectionProfile: "default",
        },
        setup: [
            { type: "command", command: "objectExplorer.focus", timeoutMs: 300000 },
            { type: "waitForMarker", name: "mssql.activate.end", timeoutMs: 300000 },
            { type: "openDocument", path: "queries/select-10000.sql" },
            { type: "mssqlConnect", profile: "default", timeoutMs: 60000 },
            { type: "waitForMarker", name: "mssql.connection.ready", timeoutMs: 60000 },
        ],
        measure: {
            start: { type: "beforeCommand", command: "mssql.runQuery" },
            action: [{ type: "command", command: "mssql.runQuery" }],
            end: { type: "waitForMarker", name: "mssql.resultsGrid.renderComplete" },
            timeoutMs: 120000,
        },
        success: [
            // Success proof from two independent sources (design §7): the extension
            // saw 10k rows complete AND the webview grid rendered 10k rows.
            { type: "markerSeen", name: "mssql.query.complete", attrs: { rowCount: 10000 } },
            {
                type: "markerSeen",
                name: "mssql.resultsGrid.renderComplete",
                attrs: { rowCount: 10000 },
            },
            { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
        ],
        cleanup: [{ type: "command", command: "workbench.view.explorer" }],
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: true, lowerIsBetter: true },
            {
                name: "mssql.query.toComplete",
                source: "marker",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.query.submit",
                endMarker: "mssql.query.complete",
                component: "query",
                processRole: "extensionHost",
            },
            {
                name: "mssql.query.toRender",
                source: "marker",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.query.submit",
                endMarker: "mssql.resultsGrid.renderComplete",
                component: "webview",
                processRole: "boundary",
            },
        ],
    },
});

// ---------------------------------------------------------------------------
// Harness self-test scenarios (design §32 M6 acceptance). These exist to
// prove the gate and the invalid-run rules against real behavior.
// ---------------------------------------------------------------------------
register({
    implemented: true,
    plannedMilestone: "M6'",
    spec: {
        scenarioId: "noop-synthetic-delay",
        displayName: "No-op with synthetic 250ms delay (regression-gate proof)",
        tags: ["harness", "synthetic"],
        profileMode: "fresh",
        measure: {
            start: { type: "beforeFirstAction" },
            action: [{ type: "syntheticDelay", ms: 250 }],
            end: { type: "afterLastAction" },
            timeoutMs: 30000,
        },
        success: [{ type: "noErrors", sources: ["automation"] }],
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: true, lowerIsBetter: true },
        ],
    },
});

register({
    implemented: true,
    plannedMilestone: "M6'",
    spec: {
        scenarioId: "noop-missing-marker",
        displayName: "Waits for a marker that never arrives (invalid-run proof)",
        tags: ["harness", "synthetic"],
        profileMode: "fresh",
        measure: {
            start: { type: "beforeFirstAction" },
            action: [{ type: "noop" }],
            end: { type: "waitForMarker", name: "perf.never.emitted" },
            timeoutMs: 5000,
        },
        success: [{ type: "noErrors", sources: ["automation"] }],
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: true, lowerIsBetter: true },
        ],
    },
});

// ---------------------------------------------------------------------------
// Soak / stress scenarios (Phase-2 M10)
// ---------------------------------------------------------------------------
register({
    implemented: true,
    plannedMilestone: "M10",
    spec: {
        scenarioId: "soak-connect-query-disconnect",
        displayName: "Soak: connect → 10k query → disconnect loop (default 1000 iterations)",
        tags: ["soak", "reliability", "memory", "sql"],
        profileMode: "warmed",
        sql: { database: "PerfHarness", cacheMode: "warm", connectionProfile: "default" },
        setup: [
            { type: "command", command: "objectExplorer.focus", timeoutMs: 300000 },
            { type: "waitForMarker", name: "mssql.activate.end", timeoutMs: 300000 },
            { type: "openDocument", path: "queries/select-10000.sql" },
        ],
        loop: {
            iterations: 1000, // override per-run with vscode.env.PERF_SOAK_ITERATIONS
            warmupIterations: 5,
            onFailure: "continue", // reliability runs record every failure
            steps: [
                { type: "mssqlConnect", profile: "default", timeoutMs: 30000 },
                { type: "waitForMarker", name: "mssql.connection.ready", timeoutMs: 30000 },
                { type: "command", command: "mssql.runQuery", timeoutMs: 30000 },
                { type: "waitForMarker", name: "mssql.query.complete", timeoutMs: 60000 },
                { type: "mssqlDisconnect", timeoutMs: 30000 },
            ],
            // Correctness under load: every iteration must return exactly 10k rows.
            success: [
                { type: "markerSeen", name: "mssql.query.complete", attrs: { rowCount: 10000 } },
            ],
        },
        measure: {
            start: { type: "beforeFirstAction" },
            action: [], // the loop IS the measured window
            end: { type: "afterLastAction" },
            timeoutMs: 7_200_000, // 2h ceiling for the full 1000 iterations
        },
        success: [{ type: "noErrors", sources: ["automation"] }],
        cleanup: [{ type: "command", command: "workbench.view.explorer" }],
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: true, lowerIsBetter: true },
        ],
    },
});

// ---------------------------------------------------------------------------
// Phase 3: original-scope closures + advanced realistic scenarios.
// Common setup fragments.
// ---------------------------------------------------------------------------
const ACTIVATE_STEPS: import("@mssqlperf/contracts").ScenarioStep[] = [
    { type: "command", command: "objectExplorer.focus", timeoutMs: 300000 },
    { type: "waitForMarker", name: "mssql.activate.end", timeoutMs: 300000 },
];
const CLEANUP_EXPLORER: import("@mssqlperf/contracts").ScenarioStep[] = [
    { type: "command", command: "workbench.view.explorer" },
];

function querySetup(fixture: string): import("@mssqlperf/contracts").ScenarioStep[] {
    return [
        ...ACTIVATE_STEPS,
        { type: "openDocument", path: `queries/${fixture}` },
        { type: "mssqlConnect", profile: "default", timeoutMs: 60000 },
        { type: "waitForMarker", name: "mssql.connection.ready", timeoutMs: 60000 },
    ];
}

// 12.10 — first-launch: official metric is orchestrator spawn→driver ready.
register({
    implemented: true,
    plannedMilestone: "M12",
    spec: {
        scenarioId: "ext-first-launch",
        displayName: "VS Code first launch to driver-ready (fresh profile)",
        tags: ["startup", "vscode"],
        profileMode: "fresh",
        measure: {
            start: { type: "beforeFirstAction" },
            action: [{ type: "noop" }],
            end: { type: "afterLastAction" },
            timeoutMs: 60000,
        },
        success: [{ type: "noErrors", sources: ["automation"] }],
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: false, lowerIsBetter: true },
            { name: "vscode.startup.ready", source: "manual", official: true, lowerIsBetter: true },
        ],
    },
});

// 12.2 — Object Explorer at scale: all 10,000 tables proven.
register({
    implemented: true,
    plannedMilestone: "M12",
    spec: {
        scenarioId: "expand-tables-node-10k",
        displayName: "Expand Tables node with 10,000 tables (PerfCatalog)",
        tags: ["object-explorer", "scale", "smo"],
        profileMode: "warmed",
        sql: { database: "PerfCatalog", cacheMode: "warm", connectionProfile: "default" },
        setup: ACTIVATE_STEPS,
        measure: {
            start: { type: "beforeFirstAction" },
            action: [
                {
                    type: "oeExpand",
                    oePath: ["Tables"],
                    profile: "default",
                    timeoutMs: 300000,
                },
            ],
            end: { type: "afterLastAction" },
            timeoutMs: 360000,
        },
        success: [
            // The Tables node holds the 10,000 seeded tables PLUS SMO folder nodes
            // ("System Tables" etc.), so the tree count is bounded, not exact; the
            // exactly-10000 user tables proof is the provisioner's seed verify
            // (SELECT COUNT(*) FROM PerfCatalog.sys.tables = 10000).
            { type: "markerSeen", name: "mssql.oe.expand.end" },
            { type: "objectExplorerProbe", name: "Tables", assert: "childCount >= 10000" },
            { type: "objectExplorerProbe", name: "Tables", assert: "childCount <= 10050" },
            { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
        ],
        cleanup: CLEANUP_EXPLORER,
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: true, lowerIsBetter: true },
            {
                name: "mssql.oe.expandTables",
                source: "marker",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.oe.expand.begin",
                endMarker: "mssql.oe.expand.end",
                component: "objectExplorer",
                processRole: "extensionHost",
            },
        ],
    },
});

// 12.7 — variety basics.
register({
    implemented: true,
    plannedMilestone: "M12",
    spec: {
        scenarioId: "cancel-running-query",
        displayName: "Cancel a running query mid-flight",
        tags: ["query", "cancel", "reliability"],
        profileMode: "warmed",
        sql: { database: "PerfHarness", cacheMode: "warm", connectionProfile: "default" },
        setup: querySetup("long-query.sql"),
        measure: {
            start: { type: "beforeFirstAction" },
            action: [
                { type: "command", command: "mssql.runQuery" },
                { type: "waitForMarker", name: "mssql.query.submit", timeoutMs: 30000 },
                { type: "command", command: "mssql.cancelQuery" },
            ],
            end: { type: "waitForMarker", name: "mssql.query.cancelled" },
            timeoutMs: 60000,
        },
        success: [
            { type: "markerSeen", name: "mssql.query.cancelled" },
            { type: "noErrors", sources: ["automation"] },
        ],
        cleanup: CLEANUP_EXPLORER,
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: true, lowerIsBetter: true },
        ],
    },
});

register({
    implemented: true,
    plannedMilestone: "M12",
    spec: {
        scenarioId: "query-error-path",
        displayName: "Query with a syntax error fails gracefully",
        tags: ["query", "error", "reliability"],
        profileMode: "warmed",
        sql: { database: "PerfHarness", cacheMode: "warm", connectionProfile: "default" },
        setup: querySetup("error.sql"),
        measure: {
            start: { type: "beforeCommand", command: "mssql.runQuery" },
            action: [{ type: "command", command: "mssql.runQuery" }],
            end: { type: "waitForMarker", name: "mssql.query.complete", attrs: { hasError: true } },
            timeoutMs: 60000,
        },
        success: [
            { type: "markerSeen", name: "mssql.query.complete", attrs: { hasError: true } },
            { type: "noErrors", sources: ["automation"] },
        ],
        cleanup: CLEANUP_EXPLORER,
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: true, lowerIsBetter: true },
        ],
    },
});

register({
    implemented: true,
    plannedMilestone: "M12",
    spec: {
        scenarioId: "large-result-100k",
        displayName: "Run query with 100,000 result rows",
        tags: ["query", "results-grid", "scale"],
        profileMode: "warmed",
        sql: { database: "PerfHarness", cacheMode: "warm", connectionProfile: "default" },
        setup: querySetup("select-100000.sql"),
        measure: {
            start: { type: "beforeCommand", command: "mssql.runQuery" },
            action: [{ type: "command", command: "mssql.runQuery" }],
            end: { type: "waitForMarker", name: "mssql.resultsGrid.renderComplete" },
            timeoutMs: 180000,
        },
        success: [
            { type: "markerSeen", name: "mssql.query.complete", attrs: { rowCount: 100000 } },
            {
                type: "markerSeen",
                name: "mssql.resultsGrid.renderComplete",
                attrs: { rowCount: 100000 },
            },
            { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
        ],
        cleanup: CLEANUP_EXPLORER,
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: true, lowerIsBetter: true },
            {
                name: "mssql.query.toComplete",
                source: "marker",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.query.submit",
                endMarker: "mssql.query.complete",
                component: "query",
                processRole: "extensionHost",
            },
        ],
    },
});

// 13.1 — virtual windowing proven from product markers + offset correctness.
register({
    implemented: true,
    plannedMilestone: "M13",
    spec: {
        scenarioId: "query-large-scroll-virtual-window",
        displayName: "100k grid: windowed fetches at scroll offsets (windowing proven)",
        tags: ["query", "results-grid", "virtualization"],
        profileMode: "warmed",
        sql: { database: "PerfHarness", cacheMode: "warm", connectionProfile: "default" },
        setup: [
            ...querySetup("select-100000.sql"),
            { type: "command", command: "mssql.runQuery" },
            { type: "waitForMarker", name: "mssql.resultsGrid.renderComplete", timeoutMs: 180000 },
        ],
        measure: {
            start: { type: "beforeFirstAction" },
            action: [
                // Ids are deterministic: first cell at rowStart N is N+1.
                {
                    type: "windowFetchCheck",
                    rowStart: 50000,
                    numberOfRows: 50,
                    expectFirstCell: "50001",
                },
                {
                    type: "windowFetchCheck",
                    rowStart: 99900,
                    numberOfRows: 50,
                    expectFirstCell: "99901",
                },
                {
                    type: "windowFetchCheck",
                    rowStart: 12345,
                    numberOfRows: 50,
                    expectFirstCell: "12346",
                },
                // The fetch markers travel exthost→HTTP→relay; await the last one so
                // the success criteria (and teardown) can't race the marker flow.
                {
                    type: "waitForMarker",
                    name: "mssql.resultsGrid.windowFetch.end",
                    attrs: { rowStart: 12345 },
                    timeoutMs: 30000,
                },
            ],
            end: { type: "afterLastAction" },
            timeoutMs: 60000,
        },
        success: [
            // Windowing proven TRIGGERED by the product marker, at a deep offset.
            {
                type: "markerSeen",
                name: "mssql.resultsGrid.windowFetch.end",
                attrs: { rowStart: 99900 },
            },
            { type: "webviewProbe", probe: "resultsGrid", assert: "rowCount == 100000" },
            { type: "noErrors", sources: ["automation", "vscode-mssql"] },
        ],
        cleanup: CLEANUP_EXPLORER,
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: true, lowerIsBetter: true },
        ],
    },
});

// 13.2 / 13.3 — heavy content shapes.
register({
    implemented: true,
    plannedMilestone: "M13",
    spec: {
        scenarioId: "query-blob-xml",
        displayName: "Query VARBINARY(MAX)/XML/NVARCHAR(MAX) cells",
        tags: ["query", "blob", "content"],
        profileMode: "warmed",
        sql: { database: "PerfHarness", cacheMode: "warm", connectionProfile: "default" },
        setup: querySetup("blob-xml.sql"),
        measure: {
            start: { type: "beforeCommand", command: "mssql.runQuery" },
            action: [{ type: "command", command: "mssql.runQuery" }],
            end: { type: "waitForMarker", name: "mssql.resultsGrid.renderComplete" },
            timeoutMs: 180000,
        },
        success: [
            { type: "markerSeen", name: "mssql.query.complete", attrs: { rowCount: 20 } },
            { type: "webviewProbe", probe: "resultsGrid", assert: "rowCount == 20" },
            { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
        ],
        cleanup: CLEANUP_EXPLORER,
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: true, lowerIsBetter: true },
        ],
    },
});

register({
    implemented: true,
    plannedMilestone: "M13",
    spec: {
        scenarioId: "query-many-result-sets",
        displayName: "One batch, 30 result sets — all grids proven",
        tags: ["query", "results-grid"],
        profileMode: "warmed",
        sql: { database: "PerfHarness", cacheMode: "warm", connectionProfile: "default" },
        setup: querySetup("many-result-sets.sql"),
        measure: {
            start: { type: "beforeCommand", command: "mssql.runQuery" },
            action: [{ type: "command", command: "mssql.runQuery" }],
            end: { type: "waitForMarker", name: "mssql.resultsGrid.renderComplete" },
            timeoutMs: 120000,
        },
        success: [
            { type: "webviewProbe", probe: "resultsGrid", assert: "resultSets == 30" },
            { type: "webviewProbe", probe: "resultsGrid", assert: "rowCount == 1500" },
            { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
        ],
        cleanup: CLEANUP_EXPLORER,
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: true, lowerIsBetter: true },
        ],
    },
});

register({
    implemented: true,
    plannedMilestone: "M13",
    spec: {
        scenarioId: "query-wide-columns",
        displayName: "300-column result — full column set proven",
        tags: ["query", "results-grid", "wide"],
        profileMode: "warmed",
        sql: { database: "PerfHarness", cacheMode: "warm", connectionProfile: "default" },
        setup: querySetup("wide-columns.sql"),
        measure: {
            start: { type: "beforeCommand", command: "mssql.runQuery" },
            action: [{ type: "command", command: "mssql.runQuery" }],
            end: { type: "waitForMarker", name: "mssql.resultsGrid.renderComplete" },
            timeoutMs: 120000,
        },
        success: [
            { type: "webviewProbe", probe: "resultsGrid", assert: "columns == 300" },
            { type: "webviewProbe", probe: "resultsGrid", assert: "rowCount == 100" },
            { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
        ],
        cleanup: CLEANUP_EXPLORER,
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: true, lowerIsBetter: true },
        ],
    },
});

// 13.4 — OE realism (assertions use >= to avoid over-claiming system folders).
register({
    implemented: true,
    plannedMilestone: "M13",
    spec: {
        scenarioId: "oe-expand-mixed-schema",
        displayName: "OE: expand Tables/Views/Procedures on a mixed schema",
        tags: ["object-explorer", "smo"],
        profileMode: "warmed",
        sql: { database: "PerfHarness", cacheMode: "warm", connectionProfile: "default" },
        setup: ACTIVATE_STEPS,
        measure: {
            start: { type: "beforeFirstAction" },
            action: [
                { type: "oeExpand", oePath: ["Tables"], profile: "default", timeoutMs: 120000 },
                { type: "oeExpand", oePath: ["Views"], profile: "default", timeoutMs: 120000 },
                {
                    type: "oeExpand",
                    oePath: ["Programmability", "Stored Procedures"],
                    profile: "default",
                    timeoutMs: 120000,
                },
            ],
            end: { type: "afterLastAction" },
            timeoutMs: 300000,
        },
        success: [
            { type: "objectExplorerProbe", name: "Tables", assert: "childCount >= 7" },
            { type: "objectExplorerProbe", name: "Views", assert: "childCount >= 1" },
            { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
        ],
        cleanup: CLEANUP_EXPLORER,
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: true, lowerIsBetter: true },
        ],
    },
});

register({
    implemented: true,
    plannedMilestone: "M13",
    spec: {
        scenarioId: "oe-expand-deep",
        displayName: "OE: deep expand to table columns",
        tags: ["object-explorer", "smo"],
        profileMode: "warmed",
        sql: { database: "PerfHarness", cacheMode: "warm", connectionProfile: "default" },
        setup: ACTIVATE_STEPS,
        measure: {
            start: { type: "beforeFirstAction" },
            action: [
                {
                    type: "oeExpand",
                    oePath: ["Tables", "sales.Orders", "Columns"],
                    profile: "default",
                    timeoutMs: 180000,
                },
            ],
            end: { type: "afterLastAction" },
            timeoutMs: 300000,
        },
        success: [
            { type: "objectExplorerProbe", name: "Columns", assert: "childCount >= 4" },
            { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
        ],
        cleanup: CLEANUP_EXPLORER,
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: true, lowerIsBetter: true },
        ],
    },
});

register({
    implemented: true,
    plannedMilestone: "M13",
    spec: {
        scenarioId: "oe-refresh",
        displayName: "OE: repeat expansion of the Tables node (refresh path)",
        tags: ["object-explorer", "smo"],
        profileMode: "warmed",
        sql: { database: "PerfHarness", cacheMode: "warm", connectionProfile: "default" },
        setup: ACTIVATE_STEPS,
        measure: {
            start: { type: "beforeFirstAction" },
            action: [
                { type: "oeExpand", oePath: ["Tables"], profile: "default", timeoutMs: 120000 },
                { type: "oeExpand", oePath: ["Tables"], profile: "default", timeoutMs: 120000 },
            ],
            end: { type: "afterLastAction" },
            timeoutMs: 300000,
        },
        success: [
            { type: "objectExplorerProbe", name: "Tables", assert: "childCount >= 7" },
            { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
        ],
        cleanup: CLEANUP_EXPLORER,
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: true, lowerIsBetter: true },
        ],
    },
});

// 13.5 — completion latency (foreshadows Phase-4 completions instrumentation).
register({
    implemented: true,
    plannedMilestone: "M13",
    spec: {
        scenarioId: "intellisense-completion-latency",
        displayName: "IntelliSense completion returns expected table",
        tags: ["intellisense", "language-service"],
        profileMode: "warmed",
        sql: { database: "PerfHarness", cacheMode: "warm", connectionProfile: "default" },
        setup: querySetup("completion.sql"),
        measure: {
            start: { type: "beforeFirstAction" },
            action: [{ type: "completionProbe", expect: "PerfRows", timeoutMs: 120000 }],
            end: { type: "afterLastAction" },
            timeoutMs: 180000,
        },
        success: [{ type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] }],
        cleanup: CLEANUP_EXPLORER,
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: true, lowerIsBetter: true },
            {
                name: "intellisense.completion",
                source: "marker",
                official: false,
                lowerIsBetter: true,
                beginMarker: "driver.completion.begin",
                endMarker: "driver.completion.end",
                component: "languageService",
                processRole: "extensionHost",
            },
        ],
    },
});

// 13.6 — reliability paths.
register({
    implemented: true,
    plannedMilestone: "M13",
    spec: {
        scenarioId: "reconnect-cycle",
        displayName: "Disconnect then reconnect (recovery latency)",
        tags: ["connection", "reliability"],
        profileMode: "warmed",
        sql: { database: "PerfHarness", cacheMode: "warm", connectionProfile: "default" },
        setup: querySetup("select-10000.sql"),
        measure: {
            start: { type: "beforeFirstAction" },
            action: [
                { type: "mssqlDisconnect", timeoutMs: 30000 },
                { type: "mssqlConnect", profile: "default", timeoutMs: 60000 },
            ],
            end: { type: "waitForMarker", name: "mssql.connection.ready" },
            timeoutMs: 120000,
        },
        success: [
            { type: "markerSeen", name: "mssql.connection.ready" },
            { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
        ],
        cleanup: CLEANUP_EXPLORER,
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: true, lowerIsBetter: true },
        ],
    },
});

register({
    implemented: true,
    plannedMilestone: "M13",
    spec: {
        scenarioId: "large-script-execution",
        displayName: "200-batch script executes end to end",
        tags: ["query", "script", "reliability"],
        profileMode: "warmed",
        sql: { database: "PerfHarness", cacheMode: "warm", connectionProfile: "default" },
        setup: querySetup("large-script.sql"),
        measure: {
            start: { type: "beforeCommand", command: "mssql.runQuery" },
            action: [{ type: "command", command: "mssql.runQuery" }],
            end: {
                type: "waitForMarker",
                name: "mssql.query.complete",
                attrs: { hasError: false },
            },
            timeoutMs: 300000,
        },
        success: [
            { type: "markerSeen", name: "mssql.query.complete", attrs: { hasError: false } },
            { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
        ],
        cleanup: CLEANUP_EXPLORER,
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: true, lowerIsBetter: true },
        ],
    },
});

// Phase-4 smoke: the Debug Console webview constructs inside a real VS Code
// without errors (activation + controller + bundle load path).
register({
    implemented: true,
    plannedMilestone: "M17",
    spec: {
        scenarioId: "debug-console-smoke",
        displayName: "MSSQL Debug Console opens without errors",
        tags: ["diagnostics", "webview"],
        profileMode: "warmed",
        setup: ACTIVATE_STEPS,
        measure: {
            start: { type: "beforeFirstAction" },
            action: [{ type: "command", command: "mssql.openDebugConsole", timeoutMs: 60000 }],
            end: { type: "afterLastAction" },
            timeoutMs: 120000,
        },
        success: [{ type: "noErrors", sources: ["automation", "vscode-mssql"] }],
        cleanup: CLEANUP_EXPLORER,
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: false, lowerIsBetter: true },
        ],
    },
});

// ---------------------------------------------------------------------------
// Query Studio (Phase 2 feature build). Exploratory until baseline history
// exists. Setup flips the preview gates through the PERF_MODE-only
// mssql.perf.setConfig command (late registration in the extension makes the
// custom editor available without a reload).
// ---------------------------------------------------------------------------

register({
    implemented: true,
    plannedMilestone: "QS-M2",
    maturity: "exploratory",
    spec: {
        scenarioId: "querystudio-open",
        displayName: "Query Studio: open new query editor",
        tags: ["querystudio", "webview"],
        profileMode: "warmed",
        setup: [
            ...ACTIVATE_STEPS,
            {
                type: "command",
                command: "mssql.perf.setConfig",
                args: ["mssql.sqlDataPlane.enabled", true],
                timeoutMs: 15000,
            },
            {
                type: "command",
                command: "mssql.perf.setConfig",
                args: ["mssql.queryStudio.enabled", true],
                timeoutMs: 15000,
            },
        ],
        measure: {
            start: { type: "beforeFirstAction" },
            action: [
                { type: "command", command: "mssql.queryStudio.new", timeoutMs: 60000 },
                {
                    type: "waitForMarker",
                    name: "mssql.queryStudio.open.end",
                    timeoutMs: 60000,
                },
            ],
            end: { type: "afterLastAction" },
            timeoutMs: 120000,
        },
        success: [{ type: "noErrors", sources: ["automation", "vscode-mssql"] }],
        cleanup: CLEANUP_EXPLORER,
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: false, lowerIsBetter: true },
            {
                // Canonical registry name (was unprefixed "queryStudio.open" — a
                // pre-QO-9a drift the family conformance test now guards against).
                name: "mssql.queryStudio.open",
                source: "marker",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.queryStudio.open.begin",
                endMarker: "mssql.queryStudio.open.end",
            },
        ],
    },
});

// Query Studio 10k-row query — the head-to-head counterpart of the classic
// query-10k-results gate: SAME fixture document (queries/select-10000.sql),
// SAME provisioned SQL server, measured through the Query Studio data plane.
// The preview gates are PRE-SEEDED into the profile's settings.json (not
// flipped via setConfig): mssql.sqlDataPlane.enabled must be true when the
// extension ACTIVATES so serviceclient spawns STS with --enable-sts2 — the
// v2 lane the QS session rides. Setup opens the fixture in the QS custom
// editor, then drives the PERF_MODE connect seam (the driver writes the
// provisioned profile as the ONLY saved connection so the product's
// exactly-one-profile auto-pick engages). scenario.wallclock stays the
// driver-plane official metric; the product metric is the registry-derived
// mssql.queryStudio.query.toRender (submit → resultsRendered, epoch plane —
// diagnostic like its classic twin).
register({
    implemented: true, // B7.7: driver queryStudioConnect/Execute steps + QS perf seams
    plannedMilestone: "QS-M2",
    maturity: "exploratory",
    spec: {
        scenarioId: "querystudio-query-10k",
        displayName: "Query Studio: run query with 10000 result rows",
        tags: ["querystudio", "query", "results-grid", "webview"],
        profileMode: "warmed",
        userSettings: {
            "mssql.sqlDataPlane.enabled": true,
            "mssql.queryStudio.enabled": true,
        },
        sql: {
            database: "PerfHarness",
            cacheMode: "warm",
            connectionProfile: "default",
        },
        setup: [
            ...ACTIVATE_STEPS,
            { type: "openDocument", path: "queries/select-10000.sql" },
            { type: "command", command: "mssql.queryStudio.openActive", timeoutMs: 60000 },
            { type: "waitForMarker", name: "mssql.queryStudio.open.end", timeoutMs: 60000 },
            { type: "queryStudioConnect", profile: "default", timeoutMs: 90000 },
        ],
        measure: {
            start: { type: "beforeFirstAction" },
            action: [{ type: "queryStudioExecute", timeoutMs: 120000 }],
            // rows-guarded: the connect step's unmeasured session preflight renders
            // its own (1-row) results — only the real 10k render ends the window.
            end: {
                type: "waitForMarker",
                name: "mssql.queryStudio.resultsRendered",
                attrs: { rows: 10000 },
            },
            timeoutMs: 120000,
        },
        success: [
            // Success proof from two independent sources (mirrors query-10k-results):
            // the extension host saw 10k rows complete AND the webview rendered 10k.
            {
                type: "markerSeen",
                name: "mssql.queryStudio.query.complete",
                attrs: { rows: 10000 },
            },
            {
                type: "markerSeen",
                name: "mssql.queryStudio.resultsRendered",
                attrs: { rows: 10000 },
            },
            { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
        ],
        cleanup: [
            { type: "command", command: "workbench.action.closeActiveEditor" },
            ...CLEANUP_EXPLORER,
        ],
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: true, lowerIsBetter: true },
            // withinMeasuredWindow: the setup preflight emits the same product
            // marker family — only the measured pair may be timed.
            {
                name: "mssql.queryStudio.query.toComplete",
                source: "marker",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.queryStudio.query.submit",
                endMarker: "mssql.queryStudio.query.complete",
                component: "queryStudio",
                processRole: "extensionHost",
                withinMeasuredWindow: true,
            },
            {
                name: "mssql.queryStudio.query.toRender",
                source: "marker",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.queryStudio.query.submit",
                endMarker: "mssql.queryStudio.resultsRendered",
                component: "queryStudio",
                processRole: "boundary",
                withinMeasuredWindow: true,
            },
        ],
    },
});

// ---------------------------------------------------------------------------
// TSQ2-12 backend A/B pair: identical provider-neutral fixture, SQL, markers,
// and metrics — the ONLY runtime delta is the activation-time provider
// selection (pre-launch userSettings; `mssql.sqlDataPlane.backend` binds
// future sessions). The raw DECIMAL(18,4) fidelity-policy difference has a
// separate correctness oracle and is not allowed to invalidate this transport
// and render comparison. Compare
// with `head-to-head --baseline-scenario querystudio-query-10k-sts2
// --candidate-scenario querystudio-query-10k-tsnative`. Non-gating
// (exploratory) until baselines are reviewed. Backend is deliberately NOT in
// environmentHash (userSettings are excluded), so run-vs-run `compare` also
// pairs them. Resource-fairness note for reports: sts2-local spends CPU in
// the STS process; ts-native spends it in the extension host — compare
// TOTALS, and treat missing sts.query.pipeline.* lanes for ts-native as
// structurally inapplicable, not as zero.
// ---------------------------------------------------------------------------
function registerQueryStudio10kBackendVariant(
    suffix: string,
    backendSetting: string,
    backendProvenance: string,
): void {
    register({
        implemented: true,
        plannedMilestone: "TSQ2-12",
        maturity: "exploratory",
        spec: {
            scenarioId: `querystudio-query-10k-${suffix}`,
            displayName: `Query Studio: 10000 rows [backend=${backendSetting}]`,
            tags: ["querystudio", "query", "results-grid", "webview", "backend-ab"],
            profileMode: "warmed",
            userSettings: {
                "mssql.sqlDataPlane.enabled": true,
                "mssql.queryStudio.enabled": true,
                "mssql.sqlDataPlane.backend": backendSetting,
            },
            sql: {
                database: "PerfHarness",
                cacheMode: "warm",
                connectionProfile: "default",
            },
            setup: [
                ...ACTIVATE_STEPS,
                { type: "openDocument", path: "queries/select-10000-backend-ab.sql" },
                { type: "command", command: "mssql.queryStudio.openActive", timeoutMs: 60000 },
                { type: "waitForMarker", name: "mssql.queryStudio.open.end", timeoutMs: 60000 },
                { type: "queryStudioConnect", profile: "default", timeoutMs: 90000 },
            ],
            measure: {
                start: { type: "beforeFirstAction" },
                action: [{ type: "queryStudioExecute", timeoutMs: 120000 }],
                end: {
                    type: "waitForMarker",
                    name: "mssql.queryStudio.resultsRendered",
                    attrs: { rows: 10000, resultSets: 1, activeTab: "results" },
                },
                timeoutMs: 120000,
            },
            success: [
                {
                    type: "markerSeen",
                    name: "mssql.queryStudio.connect.ready",
                    attrs: { backend: backendProvenance },
                },
                {
                    type: "markerSeen",
                    name: "mssql.queryStudio.query.submit",
                    attrs: { backend: backendProvenance },
                },
                {
                    type: "markerSeen",
                    name: "mssql.queryStudio.query.firstPage",
                    attrs: { backend: backendProvenance },
                },
                {
                    type: "markerSeen",
                    name: "mssql.queryStudio.query.complete",
                    attrs: {
                        rows: 10000,
                        errors: 0,
                        status: "succeeded",
                        backend: backendProvenance,
                    },
                },
                {
                    type: "markerSeen",
                    name: "mssql.queryStudio.resultsRendered",
                    attrs: { rows: 10000, resultSets: 1, activeTab: "results" },
                },
                { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
            ],
            cleanup: [
                { type: "command", command: "workbench.action.closeActiveEditor" },
                ...CLEANUP_EXPLORER,
            ],
            metrics: [
                {
                    name: "scenario.wallclock",
                    source: "marker",
                    official: true,
                    lowerIsBetter: true,
                },
                {
                    name: "mssql.queryStudio.query.toFirstPage",
                    source: "marker",
                    official: false,
                    lowerIsBetter: true,
                    beginMarker: "mssql.queryStudio.query.submit",
                    endMarker: "mssql.queryStudio.query.firstPage",
                    component: "queryStudio",
                    processRole: "extensionHost",
                    withinMeasuredWindow: true,
                },
                {
                    name: "mssql.queryStudio.query.toComplete",
                    source: "marker",
                    official: false,
                    lowerIsBetter: true,
                    beginMarker: "mssql.queryStudio.query.submit",
                    endMarker: "mssql.queryStudio.query.complete",
                    component: "queryStudio",
                    processRole: "extensionHost",
                    withinMeasuredWindow: true,
                },
                {
                    name: "mssql.queryStudio.query.toRender",
                    source: "marker",
                    official: false,
                    lowerIsBetter: true,
                    beginMarker: "mssql.queryStudio.query.submit",
                    endMarker: "mssql.queryStudio.resultsRendered",
                    component: "queryStudio",
                    processRole: "boundary",
                    withinMeasuredWindow: true,
                },
            ],
        },
    });
}
// The selector and the bound adapter identity are intentionally distinct for
// local STS2: `sts2-local` chooses the provider, while SessionInfo truthfully
// reports the transport implementation as `sts2-jsonrpc`.
registerQueryStudio10kBackendVariant("sts2", "sts2-local", "sts2-jsonrpc");
registerQueryStudio10kBackendVariant("tsnative", "ts-native", "ts-native");

// QS-3 heavy content shapes — Query Studio twins of the classic
// query-wide-columns / query-blob-xml scenarios: SAME fixture documents,
// SAME provisioned server, measured through the QS data plane with the same
// rows-guarded end-marker discipline as querystudio-query-10k (the connect
// step's unmeasured session preflight renders its own 1-row results — only
// the real render ends the window). Success mirrors the classic row proofs
// from two independent sources; the QS markers carry rows/resultSets but NOT
// a column count, so the classic "columns == 300" webviewProbe has no QS
// equivalent yet (rows-based proof only). Exploratory: wallclock stays
// official:false until baseline history exists.
register({
    implemented: true,
    plannedMilestone: "QS-3",
    maturity: "exploratory",
    spec: {
        scenarioId: "querystudio-query-wide",
        displayName: "Query Studio: 300-column result (100 rows)",
        tags: ["querystudio", "query", "results-grid", "wide", "webview"],
        profileMode: "warmed",
        userSettings: {
            "mssql.sqlDataPlane.enabled": true,
            "mssql.queryStudio.enabled": true,
        },
        sql: {
            database: "PerfHarness",
            cacheMode: "warm",
            connectionProfile: "default",
        },
        setup: [
            ...ACTIVATE_STEPS,
            { type: "openDocument", path: "queries/wide-columns.sql" },
            { type: "command", command: "mssql.queryStudio.openActive", timeoutMs: 60000 },
            { type: "waitForMarker", name: "mssql.queryStudio.open.end", timeoutMs: 60000 },
            { type: "queryStudioConnect", profile: "default", timeoutMs: 90000 },
        ],
        measure: {
            start: { type: "beforeFirstAction" },
            action: [{ type: "queryStudioExecute", timeoutMs: 120000 }],
            end: {
                type: "waitForMarker",
                name: "mssql.queryStudio.resultsRendered",
                attrs: { rows: 100 },
            },
            timeoutMs: 120000,
        },
        success: [
            // Classic twin proves rowCount == 100 (wide-columns.sql TOP 100).
            { type: "markerSeen", name: "mssql.queryStudio.query.complete", attrs: { rows: 100 } },
            { type: "markerSeen", name: "mssql.queryStudio.resultsRendered", attrs: { rows: 100 } },
            { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
        ],
        cleanup: [
            { type: "command", command: "workbench.action.closeActiveEditor" },
            ...CLEANUP_EXPLORER,
        ],
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: false, lowerIsBetter: true },
            {
                name: "mssql.queryStudio.query.toComplete",
                source: "marker",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.queryStudio.query.submit",
                endMarker: "mssql.queryStudio.query.complete",
                component: "queryStudio",
                processRole: "extensionHost",
                withinMeasuredWindow: true,
            },
            {
                name: "mssql.queryStudio.query.toRender",
                source: "marker",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.queryStudio.query.submit",
                endMarker: "mssql.queryStudio.resultsRendered",
                component: "queryStudio",
                processRole: "boundary",
                withinMeasuredWindow: true,
            },
        ],
    },
});

register({
    implemented: true,
    plannedMilestone: "QS-3",
    maturity: "exploratory",
    spec: {
        scenarioId: "querystudio-query-blob",
        displayName: "Query Studio: VARBINARY(MAX)/XML/NVARCHAR(MAX) cells",
        tags: ["querystudio", "query", "blob", "content", "webview"],
        profileMode: "warmed",
        userSettings: {
            "mssql.sqlDataPlane.enabled": true,
            "mssql.queryStudio.enabled": true,
        },
        sql: {
            database: "PerfHarness",
            cacheMode: "warm",
            connectionProfile: "default",
        },
        setup: [
            ...ACTIVATE_STEPS,
            { type: "openDocument", path: "queries/blob-xml.sql" },
            { type: "command", command: "mssql.queryStudio.openActive", timeoutMs: 60000 },
            { type: "waitForMarker", name: "mssql.queryStudio.open.end", timeoutMs: 60000 },
            { type: "queryStudioConnect", profile: "default", timeoutMs: 90000 },
        ],
        measure: {
            start: { type: "beforeFirstAction" },
            // Classic twin allows 180s for the heavy-content fetch; keep parity.
            action: [{ type: "queryStudioExecute", timeoutMs: 180000 }],
            end: {
                type: "waitForMarker",
                name: "mssql.queryStudio.resultsRendered",
                attrs: { rows: 20 },
            },
            timeoutMs: 180000,
        },
        success: [
            // Classic twin proves rowCount == 20 (dbo.PerfBlobs seed rows).
            { type: "markerSeen", name: "mssql.queryStudio.query.complete", attrs: { rows: 20 } },
            { type: "markerSeen", name: "mssql.queryStudio.resultsRendered", attrs: { rows: 20 } },
            { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
        ],
        cleanup: [
            { type: "command", command: "workbench.action.closeActiveEditor" },
            ...CLEANUP_EXPLORER,
        ],
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: false, lowerIsBetter: true },
            {
                name: "mssql.queryStudio.query.toComplete",
                source: "marker",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.queryStudio.query.submit",
                endMarker: "mssql.queryStudio.query.complete",
                component: "queryStudio",
                processRole: "extensionHost",
                withinMeasuredWindow: true,
            },
            {
                name: "mssql.queryStudio.query.toRender",
                source: "marker",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.queryStudio.query.submit",
                endMarker: "mssql.queryStudio.resultsRendered",
                component: "queryStudio",
                processRole: "boundary",
                withinMeasuredWindow: true,
            },
        ],
    },
});

// ---------------------------------------------------------------------------
// QO-9a result-shape scenarios (historical query-optimization plan, not imported):
// Query Studio under the shapes DBAs actually hit — deep results, wide grids,
// huge cells, message floods, many result sets. All follow the
// querystudio-query-10k discipline: activation-time preview gates in
// userSettings, rows-guarded end markers (the connect preflight emits the
// same marker family), exploratory maturity, wallclock official:false until
// baselines mature. `tuningOverrides` (QO-9b spreads) inject per-combo knobs
// via mssql.queryStudio.tuning.overrides in userSettings.
// ---------------------------------------------------------------------------
type QueryStudioBackend = {
    suffix: "sts2" | "tsnative";
    setting: "sts2-local" | "ts-native";
    provenance: "sts2-jsonrpc" | "ts-native";
};

interface QueryStudioShapeSpec {
    scenarioId: string;
    displayName: string;
    tags: string[];
    queryPath: string;
    /** attrs guard for the measured resultsRendered (or alternate end marker). */
    end: { name: string; attrs: Record<string, string | number | boolean> };
    success: Array<{ name: string; attrs?: Record<string, string | number | boolean> }>;
    timeoutMs?: number;
    /** Include the submit→resultsRendered pair (skip for no-result-set shapes). */
    renderMetric?: boolean;
    /** Require the connect readiness SELECT 1 to paint Results, not Messages. */
    assertPreflightResultsFocus?: boolean;
    tuningOverrides?: Record<string, unknown>;
    userSettings?: Record<string, unknown>;
    database?: string;
    scenarioIdSuffix?: string;
    /** Optional activation-time provider selector plus truthful bound identity. */
    backend?: QueryStudioBackend;
}

function registerQueryStudioShape(shape: QueryStudioShapeSpec): void {
    const timeoutMs = shape.timeoutMs ?? 180000;
    const backendCriteria: NonNullable<ScenarioSpec["success"]> = shape.backend
        ? [
              {
                  type: "markerSeen",
                  name: "mssql.queryStudio.connect.ready",
                  attrs: { backend: shape.backend.provenance },
              },
              {
                  type: "markerSeen",
                  name: "mssql.queryStudio.query.submit",
                  attrs: { backend: shape.backend.provenance },
              },
              ...(shape.renderMetric !== false
                  ? [
                        {
                            type: "markerSeen" as const,
                            name: "mssql.queryStudio.query.firstPage",
                            attrs: { backend: shape.backend.provenance },
                        },
                    ]
                  : []),
              {
                  type: "markerSeen",
                  name: "mssql.queryStudio.query.complete",
                  attrs: { backend: shape.backend.provenance, status: "succeeded", errors: 0 },
              },
          ]
        : [];
    register({
        implemented: true,
        plannedMilestone: "QO-9a",
        maturity: "exploratory",
        spec: {
            scenarioId: shape.scenarioId + (shape.scenarioIdSuffix ?? ""),
            displayName: shape.displayName,
            tags: shape.tags,
            profileMode: "warmed",
            userSettings: {
                "mssql.sqlDataPlane.enabled": true,
                "mssql.queryStudio.enabled": true,
                ...(shape.backend ? { "mssql.sqlDataPlane.backend": shape.backend.setting } : {}),
                ...(shape.userSettings ?? {}),
                ...(shape.tuningOverrides
                    ? { "mssql.queryStudio.tuning.overrides": shape.tuningOverrides }
                    : {}),
            },
            sql: {
                database: shape.database ?? "PerfHarness",
                cacheMode: "warm",
                connectionProfile: "default",
            },
            setup: [
                ...ACTIVATE_STEPS,
                { type: "openDocument", path: shape.queryPath },
                { type: "command", command: "mssql.queryStudio.openActive", timeoutMs: 60000 },
                { type: "waitForMarker", name: "mssql.queryStudio.open.end", timeoutMs: 60000 },
                { type: "queryStudioConnect", profile: "default", timeoutMs: 90000 },
                ...(shape.assertPreflightResultsFocus
                    ? [
                          {
                              type: "waitForMarker" as const,
                              name: "mssql.queryStudio.resultsRendered",
                              attrs: { rows: 1, resultSets: 1, activeTab: "results" },
                              timeoutMs: 30000,
                          },
                      ]
                    : []),
            ],
            measure: {
                start: { type: "beforeFirstAction" },
                action: [{ type: "queryStudioExecute", timeoutMs }],
                end: { type: "waitForMarker", name: shape.end.name, attrs: shape.end.attrs },
                timeoutMs,
            },
            success: [
                ...backendCriteria,
                ...shape.success.map((proof) => ({
                    type: "markerSeen" as const,
                    name: proof.name,
                    ...(proof.attrs ? { attrs: proof.attrs } : {}),
                })),
                { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
            ],
            cleanup: [
                { type: "command", command: "workbench.action.closeActiveEditor" },
                ...CLEANUP_EXPLORER,
            ],
            metrics: [
                {
                    name: "scenario.wallclock",
                    source: "marker",
                    // Maturity controls gating; official here only says the sample owns
                    // a trustworthy driver-plane clock. Backend pairs need that one
                    // anchor so the non-gating head-to-head report can select them.
                    official: shape.backend !== undefined,
                    lowerIsBetter: true,
                },
                ...(shape.backend && shape.renderMetric !== false
                    ? [
                          {
                              name: "mssql.queryStudio.query.toFirstPage",
                              source: "marker" as const,
                              official: false,
                              lowerIsBetter: true,
                              beginMarker: "mssql.queryStudio.query.submit",
                              endMarker: "mssql.queryStudio.query.firstPage",
                              component: "queryStudio",
                              processRole: "extensionHost" as const,
                              withinMeasuredWindow: true,
                          },
                      ]
                    : []),
                {
                    name: "mssql.queryStudio.query.toComplete",
                    source: "marker",
                    official: false,
                    lowerIsBetter: true,
                    beginMarker: "mssql.queryStudio.query.submit",
                    endMarker: "mssql.queryStudio.query.complete",
                    component: "queryStudio",
                    processRole: "extensionHost",
                    withinMeasuredWindow: true,
                },
                ...(shape.renderMetric !== false
                    ? [
                          {
                              name: "mssql.queryStudio.query.toRender",
                              source: "marker" as const,
                              official: false,
                              lowerIsBetter: true,
                              beginMarker: "mssql.queryStudio.query.submit",
                              endMarker: "mssql.queryStudio.resultsRendered",
                              component: "queryStudio",
                              processRole: "boundary" as const,
                              withinMeasuredWindow: true,
                          },
                      ]
                    : []),
            ],
        },
    });
}

const QUERY_STUDIO_BACKEND_VARIANTS: readonly QueryStudioBackend[] = [
    {
        suffix: "sts2",
        setting: "sts2-local",
        provenance: "sts2-jsonrpc",
    },
    {
        suffix: "tsnative",
        setting: "ts-native",
        provenance: "ts-native",
    },
] as const;

/** Register an identical-oracle provider pair from one shape definition. */
function registerQueryStudioBackendShapePair(
    shape: Omit<
        QueryStudioShapeSpec,
        "assertPreflightResultsFocus" | "backend" | "scenarioIdSuffix"
    >,
): void {
    for (const backend of QUERY_STUDIO_BACKEND_VARIANTS) {
        registerQueryStudioShape({
            ...shape,
            scenarioIdSuffix: `-${backend.suffix}`,
            displayName: `${shape.displayName} [backend=${backend.setting}]`,
            tags: [...shape.tags, "backend-ab"],
            assertPreflightResultsFocus: true,
            backend,
        });
    }
}

// Correctness sentinel for the fast-terminal tab race: the Messages snapshot
// can arrive before result metadata, but both the first readiness query and a
// successful SELECT 100 must visibly focus Results at the post-paint boundary.
registerQueryStudioShape({
    scenarioId: "querystudio-query-scalar-results-focus",
    displayName: "Query Studio: SELECT 100 focuses Results",
    tags: ["querystudio", "query", "results-grid", "focus", "correctness"],
    queryPath: "queries/select-scalar-100.sql",
    end: {
        name: "mssql.queryStudio.resultsRendered",
        attrs: { rows: 1, resultSets: 1, activeTab: "results" },
    },
    success: [
        { name: "mssql.queryStudio.query.complete", attrs: { rows: 1, resultSets: 1 } },
        {
            name: "mssql.queryStudio.resultsRendered",
            attrs: { rows: 1, resultSets: 1, activeTab: "results" },
        },
    ],
    assertPreflightResultsFocus: true,
});

// Deep narrow results: 100k rows x 4 columns — spill, windowing, and
// streaming-notification pressure. The pre-optimization baseline anchor.
registerQueryStudioShape({
    scenarioId: "querystudio-query-100k-narrow",
    displayName: "Query Studio: 100k narrow rows",
    tags: ["querystudio", "query", "results-grid", "large-results", "webview"],
    queryPath: "queries/select-100000.sql",
    end: { name: "mssql.queryStudio.resultsRendered", attrs: { rows: 100000 } },
    success: [
        { name: "mssql.queryStudio.query.complete", attrs: { rows: 100000 } },
        { name: "mssql.queryStudio.resultsRendered", attrs: { rows: 100000 } },
    ],
    timeoutMs: 300000,
});

// Wide grid at depth: 1000 rows x 300 columns — column-projection and
// window-transfer pressure (the QO-6/QO-7 target shape).
registerQueryStudioShape({
    scenarioId: "querystudio-query-wide-1000x300",
    displayName: "Query Studio: 1000 rows x 300 columns",
    tags: ["querystudio", "query", "results-grid", "wide", "webview"],
    queryPath: "queries/wide-columns-1000.sql",
    end: { name: "mssql.queryStudio.resultsRendered", attrs: { rows: 1000 } },
    success: [
        { name: "mssql.queryStudio.query.complete", attrs: { rows: 1000 } },
        { name: "mssql.queryStudio.resultsRendered", attrs: { rows: 1000 } },
    ],
    timeoutMs: 300000,
});

// Huge cells: 20 rows x two ~1 MiB-char MAX cells computed server-side —
// exercises maxCellBytes truncation honesty and bounded payloads (QO-3/QO-4).
registerQueryStudioShape({
    scenarioId: "querystudio-query-large-cells",
    displayName: "Query Studio: 20 rows with ~1 MiB JSON/XML cells",
    tags: ["querystudio", "query", "blob", "content", "webview"],
    queryPath: "queries/large-cells-1mb.sql",
    end: { name: "mssql.queryStudio.resultsRendered", attrs: { rows: 20 } },
    success: [
        { name: "mssql.queryStudio.query.complete", attrs: { rows: 20 } },
        { name: "mssql.queryStudio.resultsRendered", attrs: { rows: 20 } },
    ],
    timeoutMs: 300000,
});

// Message flood: exactly 10000 PRINTs, zero result sets. Ends on the
// messages pane paint. Host message rows measured deterministic at 10003
// across reps (10000 PRINTs + synthesized Started/Total-time + one server
// info row) — resultsRendered may not fire without result sets, so no
// render metric.
registerQueryStudioShape({
    scenarioId: "querystudio-query-10k-messages",
    displayName: "Query Studio: 10000 PRINT messages",
    tags: ["querystudio", "query", "messages", "webview"],
    queryPath: "queries/many-messages.sql",
    end: { name: "mssql.queryStudio.messagesRendered", attrs: { messages: 10003 } },
    success: [
        { name: "mssql.queryStudio.query.complete", attrs: { rows: 0 } },
        { name: "mssql.queryStudio.messagesRendered", attrs: { messages: 10003 } },
    ],
    timeoutMs: 300000,
    renderMetric: false,
});

// Many result sets: 100 sets x 5 rows — lazy grid mounting and tab/state
// stability under set-count pressure.
registerQueryStudioShape({
    scenarioId: "querystudio-query-100-resultsets",
    displayName: "Query Studio: 100 result sets",
    tags: ["querystudio", "query", "results-grid", "resultsets", "webview"],
    queryPath: "queries/hundred-result-sets.sql",
    end: { name: "mssql.queryStudio.resultsRendered", attrs: { rows: 500, resultSets: 100 } },
    success: [
        { name: "mssql.queryStudio.query.complete", attrs: { rows: 500, resultSets: 100 } },
        { name: "mssql.queryStudio.resultsRendered", attrs: { rows: 500, resultSets: 100 } },
    ],
    timeoutMs: 300000,
});

// TSQ2-12 expanded provider matrix. These retain one SQL fixture and one
// semantic oracle per pair; the only launch/runtime difference is provider
// selection and its expected truthful provenance. Raw DECIMAL(18,4) and
// vector type identity remain separate capability-policy tests.
registerQueryStudioBackendShapePair({
    scenarioId: "querystudio-query-100k-narrow",
    displayName: "Query Studio: 100k provider-neutral narrow rows",
    tags: ["querystudio", "query", "results-grid", "large-results", "webview"],
    queryPath: "queries/select-100000-backend-ab.sql",
    end: {
        name: "mssql.queryStudio.resultsRendered",
        attrs: { rows: 100000, resultSets: 1, activeTab: "results" },
    },
    success: [
        {
            name: "mssql.queryStudio.query.complete",
            attrs: { rows: 100000, resultSets: 1 },
        },
        {
            name: "mssql.queryStudio.resultsRendered",
            attrs: { rows: 100000, resultSets: 1, activeTab: "results" },
        },
    ],
    timeoutMs: 300000,
});

registerQueryStudioBackendShapePair({
    scenarioId: "querystudio-query-wide-1000x300",
    displayName: "Query Studio: 1000 rows x 300 columns",
    tags: ["querystudio", "query", "results-grid", "wide", "webview"],
    queryPath: "queries/wide-columns-1000.sql",
    end: {
        // The wide-grid render completes on the webview paint boundary after the
        // model-level resultsRendered marker. Waiting here keeps success
        // evaluation from racing marker delivery and makes wallclock measure the
        // user-visible result rather than the earlier model update.
        name: "mssql.queryStudio.grid.firstVisibleRowsPainted",
        attrs: { columns: 300, projected: true },
    },
    success: [
        { name: "mssql.queryStudio.query.complete", attrs: { rows: 1000, resultSets: 1 } },
        {
            name: "mssql.queryStudio.resultsRendered",
            attrs: { rows: 1000, resultSets: 1, activeTab: "results" },
        },
        {
            name: "mssql.queryStudio.grid.firstVisibleRowsPainted",
            attrs: { columns: 300, projected: true },
        },
    ],
    timeoutMs: 300000,
});

registerQueryStudioBackendShapePair({
    scenarioId: "querystudio-query-large-cells",
    displayName: "Query Studio: 20 rows with ~1 MiB JSON/XML cells",
    tags: ["querystudio", "query", "blob", "content", "webview"],
    queryPath: "queries/large-cells-1mb.sql",
    end: {
        name: "mssql.queryStudio.resultsRendered",
        attrs: { rows: 20, resultSets: 1, activeTab: "results" },
    },
    success: [
        { name: "mssql.queryStudio.query.complete", attrs: { rows: 20, resultSets: 1 } },
        {
            name: "mssql.queryStudio.resultsRendered",
            attrs: { rows: 20, resultSets: 1, activeTab: "results" },
        },
    ],
    timeoutMs: 300000,
});

registerQueryStudioBackendShapePair({
    scenarioId: "querystudio-query-100-resultsets",
    displayName: "Query Studio: 100 result sets",
    tags: ["querystudio", "query", "results-grid", "resultsets", "webview"],
    queryPath: "queries/hundred-result-sets.sql",
    end: {
        name: "mssql.queryStudio.resultsRendered",
        attrs: { rows: 500, resultSets: 100, activeTab: "results" },
    },
    success: [
        { name: "mssql.queryStudio.query.complete", attrs: { rows: 500, resultSets: 100 } },
        {
            name: "mssql.queryStudio.resultsRendered",
            attrs: { rows: 500, resultSets: 100, activeTab: "results" },
        },
    ],
    timeoutMs: 300000,
});

registerQueryStudioBackendShapePair({
    scenarioId: "querystudio-query-blob-xml",
    displayName: "Query Studio: VARBINARY/XML/NVARCHAR(MAX) provider matrix",
    tags: ["querystudio", "query", "blob", "xml", "content", "webview"],
    queryPath: "queries/blob-xml.sql",
    end: {
        name: "mssql.queryStudio.resultsRendered",
        attrs: { rows: 20, resultSets: 1, activeTab: "results" },
    },
    success: [
        { name: "mssql.queryStudio.query.complete", attrs: { rows: 20, resultSets: 1 } },
        {
            name: "mssql.queryStudio.resultsRendered",
            attrs: { rows: 20, resultSets: 1, activeTab: "results" },
        },
    ],
    timeoutMs: 300000,
});

registerQueryStudioBackendShapePair({
    scenarioId: "querystudio-query-spatial-10k",
    displayName: "Query Studio: 10k typed spatial points provider matrix",
    tags: ["querystudio", "query", "spatial", "typed-cell", "webview"],
    queryPath: "queries/spatial-points-10k.sql",
    userSettings: { "mssql.queryStudio.spatial.enabled": true },
    end: {
        name: "mssql.queryStudio.resultsRendered",
        attrs: { rows: 10000, resultSets: 1, activeTab: "results" },
    },
    success: [
        { name: "mssql.queryStudio.query.complete", attrs: { rows: 10000, resultSets: 1 } },
        { name: "mssql.queryStudio.tabs.eligibility", attrs: { spatialColumns: 1 } },
        {
            name: "mssql.queryStudio.resultsRendered",
            attrs: { rows: 10000, resultSets: 1, activeTab: "results" },
        },
    ],
    timeoutMs: 300000,
});

const vectorBackendShape = {
    scenarioId: "querystudio-query-vector-5k",
    displayName: "Query Studio: 5k 64-D vectors provider matrix",
    tags: ["querystudio", "query", "vector", "typed-cell", "webview"],
    queryPath: "queries/vectorlab-chunks.sql",
    database: "VectorLab",
    userSettings: { "mssql.queryStudio.vectorWorkbench.enabled": true },
    end: {
        name: "mssql.queryStudio.resultsRendered",
        attrs: { rows: 5000, resultSets: 1, activeTab: "results" },
    },
    timeoutMs: 300000,
} satisfies Omit<
    QueryStudioShapeSpec,
    "assertPreflightResultsFocus" | "backend" | "scenarioIdSuffix" | "success"
>;

// Current tedious/TDS metadata down-converts VECTOR to identity-less varchar,
// so ts-native must not advertise typed vector support. Keep the provider pair,
// but make its capability oracle intentionally asymmetric and explicit.
for (const backend of QUERY_STUDIO_BACKEND_VARIANTS) {
    registerQueryStudioShape({
        ...vectorBackendShape,
        scenarioIdSuffix: `-${backend.suffix}`,
        displayName: `${vectorBackendShape.displayName} [backend=${backend.setting}]`,
        tags: [...vectorBackendShape.tags, "backend-ab"],
        assertPreflightResultsFocus: true,
        backend,
        success: [
            { name: "mssql.queryStudio.query.complete", attrs: { rows: 5000, resultSets: 1 } },
            {
                name: "mssql.queryStudio.tabs.eligibility",
                attrs: {
                    resultSets: 1,
                    columns: 3,
                    vectorColumns: backend.suffix === "sts2" ? 1 : 0,
                },
            },
            {
                name: "mssql.queryStudio.resultsRendered",
                attrs: { rows: 5000, resultSets: 1, activeTab: "results" },
            },
        ],
    });
}

for (const backend of QUERY_STUDIO_BACKEND_VARIANTS) {
    register({
        implemented: true,
        plannedMilestone: "TSQ2-12",
        maturity: "exploratory",
        spec: {
            scenarioId: `querystudio-cancel-long-query-${backend.suffix}`,
            displayName: `Query Studio: cancel long query [backend=${backend.setting}]`,
            tags: ["querystudio", "query", "cancel", "reliability", "backend-ab"],
            profileMode: "warmed",
            userSettings: {
                "mssql.sqlDataPlane.enabled": true,
                "mssql.queryStudio.enabled": true,
                "mssql.sqlDataPlane.backend": backend.setting,
            },
            sql: { database: "PerfHarness", cacheMode: "warm", connectionProfile: "default" },
            setup: [
                ...ACTIVATE_STEPS,
                { type: "openDocument", path: "queries/long-query.sql" },
                { type: "command", command: "mssql.queryStudio.openActive", timeoutMs: 60000 },
                { type: "waitForMarker", name: "mssql.queryStudio.open.end", timeoutMs: 60000 },
                { type: "queryStudioConnect", profile: "default", timeoutMs: 90000 },
            ],
            measure: {
                start: { type: "beforeFirstAction" },
                action: [
                    { type: "queryStudioExecute", timeoutMs: 30000 },
                    {
                        type: "waitForMarker",
                        name: "mssql.queryStudio.query.submit",
                        attrs: { backend: backend.provenance },
                        timeoutMs: 30000,
                    },
                    { type: "command", command: "mssql.perf.queryStudioCancel", timeoutMs: 30000 },
                ],
                end: {
                    type: "waitForMarker",
                    name: "mssql.queryStudio.cancel",
                    attrs: { status: "canceled" },
                },
                timeoutMs: 60000,
            },
            success: [
                {
                    type: "markerSeen",
                    name: "mssql.queryStudio.query.complete",
                    attrs: { backend: backend.provenance, status: "canceled", canceled: true },
                },
                {
                    type: "markerSeen",
                    name: "mssql.queryStudio.cancel",
                    attrs: { status: "canceled" },
                },
                { type: "noErrors", sources: ["automation"] },
            ],
            cleanup: [
                { type: "command", command: "workbench.action.closeActiveEditor" },
                ...CLEANUP_EXPLORER,
            ],
            metrics: [
                {
                    name: "scenario.wallclock",
                    source: "marker",
                    official: true,
                    lowerIsBetter: true,
                },
            ],
        },
    });
}

for (const backend of QUERY_STUDIO_BACKEND_VARIANTS) {
    register({
        implemented: true,
        plannedMilestone: "QO-lifecycle",
        maturity: "exploratory",
        spec: {
            scenarioId: `querystudio-dispose-forced-spill-${backend.suffix}`,
            displayName: `Query Studio: close and reclaim forced spill [backend=${backend.setting}]`,
            tags: ["querystudio", "query", "spill", "dispose", "reclamation", "backend-ab"],
            profileMode: "warmed",
            userSettings: {
                "mssql.sqlDataPlane.enabled": true,
                "mssql.queryStudio.enabled": true,
                "mssql.sqlDataPlane.backend": backend.setting,
                "mssql.queryStudio.tuning.overrides": {
                    storeMemoryBytes: 1048576,
                    maxPendingSpillBytes: 1048576,
                    diagnosticsLevel: "verbose",
                },
            },
            sql: { database: "PerfHarness", cacheMode: "warm", connectionProfile: "default" },
            setup: [
                ...ACTIVATE_STEPS,
                { type: "openDocument", path: "queries/large-cells-1mb.sql" },
                { type: "command", command: "mssql.queryStudio.openActive", timeoutMs: 60000 },
                { type: "waitForMarker", name: "mssql.queryStudio.open.end", timeoutMs: 60000 },
                { type: "queryStudioConnect", profile: "default", timeoutMs: 90000 },
                { type: "queryStudioExecute", timeoutMs: 300000 },
                {
                    type: "waitForMarker",
                    name: "mssql.queryStudio.resultsRendered",
                    attrs: { rows: 20, resultSets: 1, activeTab: "results" },
                    timeoutMs: 300000,
                },
            ],
            measure: {
                start: { type: "beforeFirstAction" },
                action: [{ type: "command", command: "workbench.action.closeActiveEditor" }],
                end: {
                    type: "waitForMarker",
                    name: "mssql.queryStudio.rows.dispose.end",
                    attrs: { outcome: "ok", spillFileRemoved: true },
                },
                timeoutMs: 60000,
            },
            success: [
                {
                    type: "markerSeen",
                    name: "mssql.queryStudio.query.complete",
                    attrs: { backend: backend.provenance, status: "succeeded", rows: 20 },
                },
                {
                    type: "markerSeen",
                    name: "mssql.queryStudio.rows.spill.write",
                    attrs: { encoding: "v8-v1" },
                },
                { type: "markerSeen", name: "mssql.queryStudio.rows.dispose.begin" },
                {
                    type: "markerSeen",
                    name: "mssql.queryStudio.rows.dispose.end",
                    attrs: { outcome: "ok", spillFileRemoved: true },
                },
                { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
            ],
            cleanup: CLEANUP_EXPLORER,
            metrics: [
                {
                    name: "scenario.wallclock",
                    source: "marker",
                    official: true,
                    lowerIsBetter: true,
                },
                {
                    name: "mssql.queryStudio.rows.dispose",
                    source: "marker",
                    official: false,
                    lowerIsBetter: true,
                    beginMarker: "mssql.queryStudio.rows.dispose.begin",
                    endMarker: "mssql.queryStudio.rows.dispose.end",
                    component: "queryStudio",
                    processRole: "extensionHost",
                    withinMeasuredWindow: true,
                },
            ],
        },
    });
}

// Long-running lifecycle proof for the host RowStore rather than only the
// query provider. Every iteration creates a fresh Query Studio editor and
// result store, forces complete MAX values through spill, drives both grid
// viewport directions, performs an exact host-side copy, and closes the
// editor. The loop freshness boundary makes every spill read and cleanup an
// iteration-local correctness oracle; the process sampler supplies the
// diagnostic RSS plateau/slope without turning a new workload into a gate.
register({
    implemented: true,
    plannedMilestone: "QO-lifecycle",
    maturity: "exploratory",
    spec: {
        scenarioId: "querystudio-soak-forced-spill-lifecycle",
        displayName: "Query Studio soak: reopen, scroll, exact-copy, reclaim forced spill",
        tags: [
            "querystudio",
            "query",
            "soak",
            "reliability",
            "memory",
            "spill",
            "dispose",
            "clipboard",
        ],
        profileMode: "warmed",
        userSettings: {
            "mssql.sqlDataPlane.enabled": true,
            "mssql.queryStudio.enabled": true,
            "mssql.sqlDataPlane.backend": "sts2-local",
            "mssql.queryStudio.tuning.overrides": {
                storeMemoryBytes: 1048576,
                maxPendingSpillBytes: 1048576,
                diagnosticsLevel: "verbose",
            },
        },
        sql: { database: "PerfHarness", cacheMode: "warm", connectionProfile: "default" },
        setup: [...ACTIVATE_STEPS, { type: "openDocument", path: "queries/large-cells-1mb.sql" }],
        loop: {
            iterations: 100,
            warmupIterations: 5,
            onFailure: "continue",
            steps: [
                // Closing the custom editor can close the shared SQL resource rather than
                // revealing a text editor underneath it. Reopen explicitly so every
                // iteration starts from the same document/focus state.
                { type: "openDocument", path: "queries/large-cells-1mb.sql" },
                { type: "command", command: "mssql.queryStudio.openActive", timeoutMs: 60000 },
                { type: "waitForMarker", name: "mssql.queryStudio.open.end", timeoutMs: 60000 },
                { type: "queryStudioConnect", profile: "default", timeoutMs: 90000 },
                { type: "queryStudioExecute", timeoutMs: 300000 },
                {
                    type: "waitForMarker",
                    name: "mssql.queryStudio.resultsRendered",
                    attrs: { rows: 20, resultSets: 1, activeTab: "results" },
                    timeoutMs: 300000,
                },
                { type: "queryStudioInteract", action: { kind: "activateTab", tab: "results" } },
                {
                    type: "queryStudioInteract",
                    action: {
                        kind: "scrollGrid",
                        resultSetIndex: 0,
                        axis: "vertical",
                        target: "end",
                    },
                },
                {
                    type: "queryStudioInteract",
                    action: {
                        kind: "scrollGrid",
                        resultSetIndex: 0,
                        axis: "vertical",
                        target: "start",
                    },
                },
                {
                    type: "queryStudioInteract",
                    action: {
                        kind: "copyGrid",
                        resultSetIndex: 0,
                        selection: "all",
                        includeHeaders: true,
                    },
                    timeoutMs: 300000,
                },
                {
                    type: "command",
                    command: "workbench.action.closeActiveEditor",
                    timeoutMs: 60000,
                },
                {
                    type: "waitForMarker",
                    name: "mssql.queryStudio.rows.dispose.end",
                    attrs: { outcome: "ok", spillFileRemoved: true },
                    timeoutMs: 60000,
                },
            ],
            success: [
                {
                    type: "markerSeen",
                    name: "mssql.queryStudio.query.complete",
                    attrs: { backend: "sts2-jsonrpc", status: "succeeded", rows: 20 },
                },
                {
                    type: "markerSeen",
                    name: "mssql.queryStudio.rows.spill.write",
                    attrs: { encoding: "v8-v1" },
                },
                {
                    type: "markerSeen",
                    name: "mssql.queryStudio.rows.spill.read",
                    attrs: { encoding: "v8-v1" },
                },
                {
                    type: "markerSeen",
                    name: "mssql.queryStudio.grid.copy.end",
                    attrs: {
                        outcome: "copied",
                        rows: 20,
                        columns: 3,
                        characters: 2621556,
                        copyRoute: "hostDirect",
                        clipboardMode: "hostDirect",
                        hostRowFetches: 1,
                    },
                },
                { type: "markerSeen", name: "mssql.queryStudio.rows.dispose.begin" },
                {
                    type: "markerSeen",
                    name: "mssql.queryStudio.rows.dispose.end",
                    attrs: { outcome: "ok", spillFileRemoved: true },
                },
                { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
            ],
        },
        measure: {
            start: { type: "beforeFirstAction" },
            action: [],
            end: { type: "afterLastAction" },
            timeoutMs: 14400000,
        },
        success: [{ type: "noErrors", sources: ["automation"] }],
        cleanup: CLEANUP_EXPLORER,
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: false, lowerIsBetter: true },
        ],
    },
});

interface QueryStudioInteractionSpec {
    scenarioId: string;
    displayName: string;
    tags: string[];
    queryPath: string;
    ready: { name: string; attrs: Record<string, number> };
    actions: NonNullable<ScenarioSpec["measure"]>["action"];
    success: ScenarioSpec["success"];
    tuningOverrides?: Record<string, unknown>;
    /** Additional registered metrics whose boundaries occur inside the interaction action. */
    additionalMetrics?: NonNullable<ScenarioSpec["metrics"]>;
    /** Optional activation-time provider selector plus truthful bound identity. */
    backend?: QueryStudioBackend;
    /** Require the connection readiness SELECT 1 to paint Results, not Messages. */
    assertPreflightResultsFocus?: boolean;
}

function registerQueryStudioInteractionScenario(spec: QueryStudioInteractionSpec): void {
    const backendCriteria: NonNullable<ScenarioSpec["success"]> = spec.backend
        ? [
              {
                  type: "markerSeen",
                  name: "mssql.queryStudio.connect.ready",
                  attrs: { backend: spec.backend.provenance },
              },
              {
                  type: "markerSeen",
                  name: "mssql.queryStudio.query.submit",
                  attrs: { backend: spec.backend.provenance },
              },
              {
                  type: "markerSeen",
                  name: "mssql.queryStudio.query.firstPage",
                  attrs: { backend: spec.backend.provenance },
              },
              {
                  type: "markerSeen",
                  name: "mssql.queryStudio.query.complete",
                  attrs: { backend: spec.backend.provenance, status: "succeeded", errors: 0 },
              },
          ]
        : [];
    register({
        implemented: true,
        plannedMilestone: "QP-2",
        maturity: "exploratory",
        spec: {
            scenarioId: spec.scenarioId,
            displayName: spec.displayName,
            tags: [...spec.tags, "querystudio", "interaction", "webview"],
            profileMode: "warmed",
            userSettings: {
                "mssql.sqlDataPlane.enabled": true,
                "mssql.queryStudio.enabled": true,
                ...(spec.backend ? { "mssql.sqlDataPlane.backend": spec.backend.setting } : {}),
                ...(spec.tuningOverrides
                    ? { "mssql.queryStudio.tuning.overrides": spec.tuningOverrides }
                    : {}),
            },
            sql: {
                database: "PerfHarness",
                cacheMode: "warm",
                connectionProfile: "default",
            },
            setup: [
                ...ACTIVATE_STEPS,
                { type: "openDocument", path: spec.queryPath },
                { type: "command", command: "mssql.queryStudio.openActive", timeoutMs: 60000 },
                { type: "waitForMarker", name: "mssql.queryStudio.open.end", timeoutMs: 60000 },
                { type: "queryStudioConnect", profile: "default", timeoutMs: 90000 },
                ...(spec.assertPreflightResultsFocus
                    ? [
                          {
                              type: "waitForMarker" as const,
                              name: "mssql.queryStudio.resultsRendered",
                              attrs: { rows: 1, resultSets: 1, activeTab: "results" },
                              timeoutMs: 30000,
                          },
                      ]
                    : []),
                { type: "queryStudioExecute", timeoutMs: 300000 },
                {
                    type: "waitForMarker",
                    name: spec.ready.name,
                    attrs: spec.ready.attrs,
                    timeoutMs: 300000,
                },
            ],
            measure: {
                start: { type: "beforeFirstAction" },
                action: spec.actions,
                end: { type: "afterLastAction" },
                timeoutMs: 300000,
            },
            success: [
                ...backendCriteria,
                ...(spec.success ?? []),
                { type: "markerSeen", name: "mssql.queryStudio.interaction.end" },
                { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
            ],
            cleanup: [
                { type: "command", command: "workbench.action.closeActiveEditor" },
                ...CLEANUP_EXPLORER,
            ],
            metrics: [
                {
                    name: "scenario.wallclock",
                    source: "marker",
                    official: spec.backend !== undefined,
                    lowerIsBetter: true,
                },
                ...(spec.additionalMetrics ?? []),
            ],
        },
    });
}

/** Register an identical-oracle provider pair for a measured result interaction. */
function registerQueryStudioBackendInteractionPair(
    spec: Omit<QueryStudioInteractionSpec, "backend" | "assertPreflightResultsFocus">,
): void {
    for (const backend of QUERY_STUDIO_BACKEND_VARIANTS) {
        registerQueryStudioInteractionScenario({
            ...spec,
            scenarioId: `${spec.scenarioId}-${backend.suffix}`,
            displayName: `${spec.displayName} [backend=${backend.setting}]`,
            tags: [...spec.tags, "backend-ab"],
            assertPreflightResultsFocus: true,
            backend,
        });
    }
}

registerQueryStudioInteractionScenario({
    scenarioId: "querystudio-interaction-scroll-100k",
    displayName: "Query Studio interaction: 100k-row vertical sweep",
    tags: ["results-grid", "large-results", "vertical-scroll"],
    queryPath: "queries/select-100000.sql",
    ready: { name: "mssql.queryStudio.resultsRendered", attrs: { rows: 100000 } },
    actions: [
        { type: "queryStudioInteract", action: { kind: "activateTab", tab: "results" } },
        {
            type: "queryStudioInteract",
            action: { kind: "scrollGrid", resultSetIndex: 0, axis: "vertical", target: "middle" },
        },
        {
            type: "queryStudioInteract",
            action: { kind: "scrollGrid", resultSetIndex: 0, axis: "vertical", target: "end" },
        },
    ],
    success: [{ type: "markerSeen", name: "mssql.queryStudio.grid.render.complete" }],
});

registerQueryStudioInteractionScenario({
    scenarioId: "querystudio-interaction-selectall-100k",
    displayName: "Query Studio interaction: select all 100k rows",
    tags: ["results-grid", "large-results", "selection"],
    queryPath: "queries/select-100000.sql",
    ready: { name: "mssql.queryStudio.resultsRendered", attrs: { rows: 100000 } },
    actions: [
        { type: "queryStudioInteract", action: { kind: "activateTab", tab: "results" } },
        {
            type: "queryStudioInteract",
            action: { kind: "selectGrid", resultSetIndex: 0, selection: "all" },
        },
    ],
    success: [],
});

registerQueryStudioInteractionScenario({
    scenarioId: "querystudio-interaction-copyall-10k-messages",
    displayName: "Query Studio interaction: copy all 10000 messages",
    tags: ["messages", "clipboard", "copy", "large-results"],
    queryPath: "queries/many-messages.sql",
    ready: { name: "mssql.queryStudio.messagesRendered", attrs: { messages: 10003 } },
    actions: [
        { type: "queryStudioInteract", action: { kind: "activateTab", tab: "messages" } },
        { type: "queryStudioInteract", action: { kind: "copyMessages" }, timeoutMs: 300000 },
    ],
    success: [
        {
            type: "markerSeen",
            name: "mssql.queryStudio.messages.copy.end",
            attrs: { outcome: "copied", messages: 10003, copyRoute: "hostDirect" },
        },
    ],
    additionalMetrics: [
        {
            name: "mssql.queryStudio.messages.copy",
            source: "marker",
            official: false,
            lowerIsBetter: true,
            beginMarker: "mssql.queryStudio.messages.copy.begin",
            endMarker: "mssql.queryStudio.messages.copy.end",
            component: "queryStudio",
            processRole: "webview",
            withinMeasuredWindow: true,
        },
    ],
});

registerQueryStudioInteractionScenario({
    scenarioId: "querystudio-interaction-copyall-100k",
    displayName: "Query Studio interaction: copy all 100k rows",
    tags: ["results-grid", "large-results", "clipboard", "copy"],
    queryPath: "queries/select-100000.sql",
    ready: { name: "mssql.queryStudio.resultsRendered", attrs: { rows: 100000 } },
    actions: [
        { type: "queryStudioInteract", action: { kind: "activateTab", tab: "results" } },
        {
            type: "queryStudioInteract",
            action: {
                kind: "copyGrid",
                resultSetIndex: 0,
                selection: "all",
                includeHeaders: true,
            },
            timeoutMs: 300000,
        },
    ],
    success: [
        {
            type: "markerSeen",
            name: "mssql.queryStudio.grid.copy.end",
            attrs: { outcome: "copied", rows: 100000, columns: 4 },
        },
    ],
});

registerQueryStudioInteractionScenario({
    scenarioId: "querystudio-interaction-wide-1000x300",
    displayName: "Query Studio interaction: 300-column horizontal sweep",
    tags: ["results-grid", "wide", "horizontal-scroll"],
    queryPath: "queries/wide-columns-1000.sql",
    // Start the sweep only after the terminal row count has reached the grid.
    // First-visible-row paint is intentionally an earlier latency diagnostic,
    // but it can occur while the streaming data source is still being refreshed.
    ready: { name: "mssql.queryStudio.resultsRendered", attrs: { rows: 1000 } },
    actions: [
        { type: "queryStudioInteract", action: { kind: "activateTab", tab: "results" } },
        {
            type: "queryStudioInteract",
            action: { kind: "scrollGrid", resultSetIndex: 0, axis: "horizontal", target: "end" },
        },
        {
            type: "queryStudioInteract",
            action: { kind: "scrollGrid", resultSetIndex: 0, axis: "horizontal", target: "start" },
        },
    ],
    success: [
        {
            type: "markerSeen",
            name: "mssql.queryStudio.grid.window.received",
            attrs: { projected: true, totalColumns: 300 },
        },
    ],
});

registerQueryStudioInteractionScenario({
    scenarioId: "querystudio-interaction-large-cells-20x1mb",
    displayName: "Query Studio interaction: 20 rows with two 1 MiB MAX cells",
    tags: ["results-grid", "large-cells", "blob", "json", "xml"],
    queryPath: "queries/large-cells-1mb.sql",
    ready: { name: "mssql.queryStudio.resultsRendered", attrs: { rows: 20 } },
    actions: [
        { type: "queryStudioInteract", action: { kind: "activateTab", tab: "results" } },
        {
            type: "queryStudioInteract",
            action: { kind: "scrollGrid", resultSetIndex: 0, axis: "vertical", target: "end" },
        },
    ],
    success: [
        {
            type: "markerSeen",
            name: "mssql.queryStudio.rows.windowFetch.end",
            attrs: { gridPreview: true },
        },
        {
            type: "markerSeen",
            name: "mssql.queryStudio.grid.window.received",
            attrs: { valueMode: "gridPreview" },
        },
    ],
});

registerQueryStudioInteractionScenario({
    scenarioId: "querystudio-interaction-copyall-large-cells",
    displayName: "Query Studio interaction: copy 20 rows with two 1 MiB MAX cells",
    tags: ["results-grid", "large-cells", "blob", "json", "xml", "clipboard", "copy"],
    queryPath: "queries/large-cells-1mb.sql",
    ready: { name: "mssql.queryStudio.resultsRendered", attrs: { rows: 20 } },
    actions: [
        { type: "queryStudioInteract", action: { kind: "activateTab", tab: "results" } },
        {
            type: "queryStudioInteract",
            action: {
                kind: "copyGrid",
                resultSetIndex: 0,
                selection: "all",
                includeHeaders: true,
            },
            timeoutMs: 300000,
        },
    ],
    success: [
        {
            type: "markerSeen",
            name: "mssql.queryStudio.grid.copy.end",
            attrs: {
                outcome: "copied",
                rows: 20,
                columns: 3,
                characters: 2621556,
                copyRoute: "hostDirect",
                clipboardMode: "hostDirect",
                hostRowFetches: 1,
            },
        },
    ],
});

registerQueryStudioInteractionScenario({
    scenarioId: "querystudio-interaction-copyall-large-cells-forced-spill",
    displayName: "Query Studio interaction: copy large cells through forced spill",
    tags: ["results-grid", "large-cells", "json", "xml", "clipboard", "copy", "spill"],
    queryPath: "queries/large-cells-1mb.sql",
    ready: { name: "mssql.queryStudio.resultsRendered", attrs: { rows: 20 } },
    tuningOverrides: {
        storeMemoryBytes: 1048576,
        maxPendingSpillBytes: 1048576,
        diagnosticsLevel: "verbose",
    },
    actions: [
        { type: "queryStudioInteract", action: { kind: "activateTab", tab: "results" } },
        {
            type: "queryStudioInteract",
            action: {
                kind: "copyGrid",
                resultSetIndex: 0,
                selection: "all",
                includeHeaders: true,
            },
            timeoutMs: 300000,
        },
    ],
    success: [
        {
            type: "markerSeen",
            name: "mssql.queryStudio.rows.spill.write",
            attrs: { encoding: "v8-v1" },
        },
        {
            type: "markerSeen",
            name: "mssql.queryStudio.rows.spill.read",
            attrs: { encoding: "v8-v1" },
        },
        {
            type: "markerSeen",
            name: "mssql.queryStudio.grid.copy.end",
            attrs: {
                outcome: "copied",
                rows: 20,
                columns: 3,
                characters: 2621556,
                copyRoute: "hostDirect",
                clipboardMode: "hostDirect",
                hostRowFetches: 1,
            },
        },
    ],
});

// The result-shape backend pairs prove transport and first paint. This pair
// adds the equally important host-side reclamation path: both providers must
// evict the same complete values, re-materialize them from the RowStore, and
// produce the exact same user-visible copy without selecting Messages.
registerQueryStudioBackendInteractionPair({
    scenarioId: "querystudio-interaction-copyall-large-cells-forced-spill",
    displayName: "Query Studio interaction: exact large-cell copy through forced spill",
    tags: ["results-grid", "large-cells", "json", "xml", "clipboard", "copy", "spill"],
    queryPath: "queries/large-cells-1mb.sql",
    ready: { name: "mssql.queryStudio.resultsRendered", attrs: { rows: 20 } },
    tuningOverrides: {
        storeMemoryBytes: 1048576,
        maxPendingSpillBytes: 1048576,
        diagnosticsLevel: "verbose",
    },
    actions: [
        { type: "queryStudioInteract", action: { kind: "activateTab", tab: "results" } },
        {
            type: "queryStudioInteract",
            action: {
                kind: "copyGrid",
                resultSetIndex: 0,
                selection: "all",
                includeHeaders: true,
            },
            timeoutMs: 300000,
        },
    ],
    success: [
        {
            type: "markerSeen",
            name: "mssql.queryStudio.resultsRendered",
            attrs: { rows: 20, resultSets: 1, activeTab: "results" },
        },
        {
            type: "markerSeen",
            name: "mssql.queryStudio.rows.spill.write",
            attrs: { encoding: "v8-v1" },
        },
        {
            type: "markerSeen",
            name: "mssql.queryStudio.rows.spill.read",
            attrs: { encoding: "v8-v1" },
        },
        {
            type: "markerSeen",
            name: "mssql.queryStudio.grid.copy.end",
            attrs: {
                outcome: "copied",
                rows: 20,
                columns: 3,
                characters: 2621556,
                copyRoute: "hostDirect",
                clipboardMode: "hostDirect",
                hostRowFetches: 1,
            },
        },
    ],
    additionalMetrics: [
        {
            name: "mssql.queryStudio.grid.copy",
            source: "marker",
            official: false,
            lowerIsBetter: true,
            beginMarker: "mssql.queryStudio.grid.copy.begin",
            endMarker: "mssql.queryStudio.grid.copy.end",
            component: "queryStudio",
            processRole: "webview",
            withinMeasuredWindow: true,
        },
    ],
});

registerQueryStudioInteractionScenario({
    scenarioId: "querystudio-interaction-100-resultsets",
    displayName: "Query Studio interaction: sweep 100 result sets",
    tags: ["results-grid", "resultsets", "lifecycle", "vertical-scroll"],
    queryPath: "queries/hundred-result-sets.sql",
    ready: {
        name: "mssql.queryStudio.resultsRendered",
        attrs: { rows: 500, resultSets: 100 },
    },
    actions: [
        { type: "queryStudioInteract", action: { kind: "activateTab", tab: "results" } },
        {
            type: "queryStudioInteract",
            action: { kind: "selectGrid", resultSetIndex: 0, selection: "all" },
        },
        {
            type: "queryStudioInteract",
            action: { kind: "sweepResultStack", steps: 32 },
        },
        {
            type: "queryStudioInteract",
            action: { kind: "scrollResultStack", target: "start" },
        },
        {
            type: "queryStudioInteract",
            action: { kind: "selectGrid", resultSetIndex: 0, selection: "all" },
        },
    ],
    success: [
        { type: "markerSeen", name: "mssql.queryStudio.grid.instance.created" },
        {
            type: "markerSeen",
            name: "mssql.queryStudio.results.block.visibility",
            attrs: { mounted: false, reason: "viewport" },
        },
        {
            type: "markerSeen",
            name: "mssql.queryStudio.interaction.end",
            attrs: { action: "selectGrid", outcome: "alreadySelected" },
        },
    ],
});

// ---------------------------------------------------------------------------
// QO-9b tuning spread: each axis point is a distinct scenarioId (the whole
// pipeline/store/reports work unchanged) whose knobs ride
// mssql.queryStudio.tuning.overrides in userSettings — the QueryTuning
// snapshot stamps them on run records and the submit marker, so runs are
// correlated by parameter set (tuningDigest), not by folklore. The base
// (unsuffixed) scenario IS the defaults point of the spread.
// ---------------------------------------------------------------------------
interface QueryStudioSpreadAxis {
    suffix: string;
    tuningOverrides: Record<string, unknown>;
}

function registerQueryStudioSpread(
    base: QueryStudioShapeSpec,
    axes: QueryStudioSpreadAxis[],
): void {
    for (const axis of axes) {
        registerQueryStudioShape({
            ...base,
            scenarioIdSuffix: `-${axis.suffix}`,
            displayName: `${base.displayName} [${axis.suffix}]`,
            tags: [...base.tags, "tuning-spread"],
            tuningOverrides: { ...(base.tuningOverrides ?? {}), ...axis.tuningOverrides },
        });
    }
}

// Deep-results shape: wire page sizing (pageRows is service-honored since
// QO-3; the service clamps above its pinned 1000 maximum — larger axis
// points would silently clamp, so the spread stays within the honest range).
registerQueryStudioSpread(
    {
        scenarioId: "querystudio-query-100k-narrow",
        displayName: "Query Studio: 100k narrow rows",
        tags: ["querystudio", "query", "results-grid", "large-results", "webview"],
        queryPath: "queries/select-100000.sql",
        end: { name: "mssql.queryStudio.resultsRendered", attrs: { rows: 100000 } },
        success: [
            { name: "mssql.queryStudio.query.complete", attrs: { rows: 100000 } },
            { name: "mssql.queryStudio.resultsRendered", attrs: { rows: 100000 } },
        ],
        timeoutMs: 300000,
    },
    [
        { suffix: "p128", tuningOverrides: { pageRows: 128 } },
        { suffix: "p512", tuningOverrides: { pageRows: 512 } },
        { suffix: "b64k", tuningOverrides: { pageBytes: 65536 } },
    ],
);

// Wide shape: page sizing vs grid window sizing (QO-7 knob).
registerQueryStudioSpread(
    {
        scenarioId: "querystudio-query-wide-1000x300",
        displayName: "Query Studio: 1000 rows x 300 columns",
        tags: ["querystudio", "query", "results-grid", "wide", "webview"],
        queryPath: "queries/wide-columns-1000.sql",
        end: { name: "mssql.queryStudio.resultsRendered", attrs: { rows: 1000 } },
        success: [
            { name: "mssql.queryStudio.query.complete", attrs: { rows: 1000 } },
            { name: "mssql.queryStudio.resultsRendered", attrs: { rows: 1000 } },
        ],
        timeoutMs: 300000,
    },
    [
        { suffix: "p128", tuningOverrides: { pageRows: 128 } },
        { suffix: "w200", tuningOverrides: { gridWindowRows: 200 } },
        { suffix: "adaptive", tuningOverrides: { gridWindowMode: "adaptive" } },
    ],
);

// Huge-cell shape: display bound sweep (cells stream since QO-4; a lower
// maxCellBytes bounds both wire payload and prefix retention).
registerQueryStudioSpread(
    {
        scenarioId: "querystudio-query-large-cells",
        displayName: "Query Studio: 20 rows with ~1 MiB JSON/XML cells",
        tags: ["querystudio", "query", "blob", "content", "webview"],
        queryPath: "queries/large-cells-1mb.sql",
        end: { name: "mssql.queryStudio.resultsRendered", attrs: { rows: 20 } },
        success: [
            { name: "mssql.queryStudio.query.complete", attrs: { rows: 20 } },
            { name: "mssql.queryStudio.resultsRendered", attrs: { rows: 20 } },
        ],
        timeoutMs: 300000,
    },
    [{ suffix: "cell64k", tuningOverrides: { maxCellBytes: 65536 } }],
);

// Object Explorer v2 browse (OE v2 B21, exploratory): activate with the
// v2 preview view + data plane on, then drive the PERF_MODE seam that
// connects the provisioned profile through the data plane and expands the
// server catalog to a rendered Databases list. The seam THROWS on every
// honesty failure (no profile / connect failed / zero databases), so
// noErrors is a real proof. No new markers: wallclock covers
// connect + server-catalog hydration + expand (the OE v2 host-work targets
// are covered separately by the unit-lane scale suite).
register({
    implemented: true, // OE v2 B21: mssql.perf.objectExplorerV2Browse seam
    plannedMilestone: "OE2-7",
    maturity: "exploratory",
    spec: {
        scenarioId: "objectexplorerv2-browse",
        displayName: "Object Explorer v2: connect and expand Databases",
        tags: ["objectexplorer", "oev2", "metadata"],
        profileMode: "warmed",
        userSettings: {
            "mssql.enableExperimentalFeatures": true,
            "mssql.sqlDataPlane.enabled": true,
            "mssql.objectExplorer.v2.enabled": true,
        },
        sql: {
            database: "PerfHarness",
            cacheMode: "warm",
            connectionProfile: "default",
        },
        setup: [
            ...ACTIVATE_STEPS,
            // Saved profile only — OE v2 performs its own (measured) connect.
            { type: "provisionConnectionProfile", profile: "default", timeoutMs: 30000 },
        ],
        measure: {
            start: { type: "beforeFirstAction" },
            action: [
                {
                    type: "command",
                    command: "mssql.perf.objectExplorerV2Browse",
                    timeoutMs: 90000,
                },
            ],
            end: { type: "afterLastAction" },
            timeoutMs: 120000,
        },
        success: [{ type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] }],
        cleanup: CLEANUP_EXPLORER,
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: false, lowerIsBetter: true },
        ],
    },
});

// Object Explorer v2 server-level aux browse (OE parity B27, exploratory):
// connect through the data plane, expand Security → Logins, and wait for
// REAL items from the LAZY aux section (metadataStore.auxCatalog.hydrate is
// expand-triggered — never at connect). The seam THROWS on every honesty
// failure (missing folders, failed/empty section, 15s hydration timeout),
// so noErrors proves the whole K1 path live.
register({
    implemented: true, // OE parity B27: mssql.perf.objectExplorerV2SecurityExpand seam
    plannedMilestone: "OE2-PARITY",
    maturity: "exploratory",
    spec: {
        scenarioId: "objectexplorerv2-security-expand",
        displayName: "Object Explorer v2: expand Security → Logins (lazy aux section)",
        tags: ["objectexplorer", "oev2", "metadata"],
        profileMode: "warmed",
        userSettings: {
            "mssql.enableExperimentalFeatures": true,
            "mssql.sqlDataPlane.enabled": true,
            "mssql.objectExplorer.v2.enabled": true,
        },
        sql: {
            database: "PerfHarness",
            cacheMode: "warm",
            connectionProfile: "default",
        },
        setup: [
            ...ACTIVATE_STEPS,
            // Server-scoped on purpose: a DB-scoped profile hides Security (K1).
            {
                type: "provisionConnectionProfile",
                profile: "default",
                serverScoped: true,
                timeoutMs: 30000,
            },
        ],
        measure: {
            start: { type: "beforeFirstAction" },
            action: [
                {
                    type: "command",
                    command: "mssql.perf.objectExplorerV2SecurityExpand",
                    timeoutMs: 90000,
                },
            ],
            end: { type: "afterLastAction" },
            timeoutMs: 120000,
        },
        success: [{ type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] }],
        cleanup: CLEANUP_EXPLORER,
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: false, lowerIsBetter: true },
        ],
    },
});

// OE v2 container deploy (DOCK-4, exploratory): the wizard-core path
// headless — create the SQL container, wait for readiness, save the profile
// and connect through the OE v2 data plane (the DOCK-1 terminal step).
// REQUIRES docker + a locally cached SQL Server image (the seam never
// pulls); every honesty failure throws. Cleans up container + profile.
register({
    implemented: true, // DOCK-4: mssql.perf.oeV2ContainerDeploy seam
    plannedMilestone: "DOCK-4",
    maturity: "exploratory",
    spec: {
        scenarioId: "oev2-container-deploy",
        displayName: "OE v2 containers: deploy → ready → data-plane connect",
        tags: ["objectexplorer", "oev2", "docker", "deployment"],
        profileMode: "warmed",
        userSettings: {
            "mssql.enableExperimentalFeatures": true,
            "mssql.sqlDataPlane.enabled": true,
            "mssql.objectExplorer.v2.enabled": true,
        },
        setup: [...ACTIVATE_STEPS],
        measure: {
            start: { type: "beforeFirstAction" },
            action: [
                {
                    type: "command",
                    command: "mssql.perf.oeV2ContainerDeploy",
                    timeoutMs: 600000,
                },
            ],
            end: { type: "afterLastAction" },
            timeoutMs: 660000,
        },
        success: [{ type: "noErrors", sources: ["automation", "vscode-mssql"] }],
        cleanup: [
            { type: "command", command: "mssql.perf.oeV2ContainerCleanup", timeoutMs: 120000 },
            ...CLEANUP_EXPLORER,
        ],
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: false, lowerIsBetter: true },
        ],
    },
});

// OE v2 container reconnect (DOCK-4, exploratory): a STOPPED container
// profile connects through the DOCK-3 pre-flight (docker start → readiness
// → data-plane open) — exactly the expand-a-stopped-container wait a user
// sees. Setup provisions container + profile OUTSIDE the measured window.
register({
    implemented: true, // DOCK-4: mssql.perf.oeV2ContainerReconnect seam
    plannedMilestone: "DOCK-4",
    maturity: "exploratory",
    spec: {
        scenarioId: "oev2-container-reconnect",
        displayName: "OE v2 containers: stopped container → pre-flight → connected",
        tags: ["objectexplorer", "oev2", "docker", "deployment"],
        profileMode: "warmed",
        userSettings: {
            "mssql.enableExperimentalFeatures": true,
            "mssql.sqlDataPlane.enabled": true,
            "mssql.objectExplorer.v2.enabled": true,
        },
        setup: [
            ...ACTIVATE_STEPS,
            {
                type: "command",
                command: "mssql.perf.oeV2ContainerReconnectSetup",
                timeoutMs: 600000,
            },
        ],
        measure: {
            start: { type: "beforeFirstAction" },
            action: [
                {
                    type: "command",
                    command: "mssql.perf.oeV2ContainerReconnect",
                    timeoutMs: 600000,
                },
            ],
            end: { type: "afterLastAction" },
            timeoutMs: 660000,
        },
        success: [{ type: "noErrors", sources: ["automation", "vscode-mssql"] }],
        cleanup: [
            { type: "command", command: "mssql.perf.oeV2ContainerCleanup", timeoutMs: 120000 },
            ...CLEANUP_EXPLORER,
        ],
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: false, lowerIsBetter: true },
        ],
    },
});

// QS bootstrap (BOOT-4, Karl P0): open a Query Studio window WITH initial
// SQL + autoRun and measure to rendered results — the full bootstrap
// (webview HTML → chunks → Monaco → editor interactive → grid chunk →
// autorun → grid paint). Execution is ~0 (SELECT 100). The boot.* phase
// marks land in the session journal for every rep.
register({
    implemented: true, // BOOT-4: newQueryFromContext(initialSql, autoRun) seam
    plannedMilestone: "BOOT-4",
    maturity: "exploratory",
    spec: {
        scenarioId: "querystudio-open-autorun",
        displayName: "Query Studio: open with SQL, autorun, results visible (bootstrap)",
        tags: ["querystudio", "bootstrap", "webview"],
        profileMode: "warmed",
        userSettings: {
            "mssql.sqlDataPlane.enabled": true,
            "mssql.queryStudio.enabled": true,
        },
        sql: {
            database: "PerfHarness",
            cacheMode: "warm",
            connectionProfile: "default",
        },
        setup: [
            ...ACTIVATE_STEPS,
            { type: "provisionConnectionProfile", profile: "default", timeoutMs: 30000 },
        ],
        measure: {
            start: { type: "beforeFirstAction" },
            action: [
                {
                    type: "command",
                    command: "mssql.queryStudio.newQueryFromContext",
                    args: [
                        {
                            profileId: "perf-querystudio-default",
                            initialSql: "SELECT 100 AS bootstrap_probe;",
                            autoRun: true,
                            source: "perftest",
                        },
                    ],
                    timeoutMs: 60000,
                },
                {
                    type: "waitForMarker",
                    name: "mssql.queryStudio.resultsRendered",
                    timeoutMs: 90000,
                },
            ],
            end: { type: "afterLastAction" },
            timeoutMs: 120000,
        },
        success: [
            { type: "markerSeen", name: "mssql.queryStudio.boot.editorInteractive" },
            { type: "markerSeen", name: "mssql.queryStudio.boot.gridChunkLoaded" },
            { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
        ],
        cleanup: CLEANUP_EXPLORER,
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: false, lowerIsBetter: true },
            {
                name: "mssql.queryStudio.open.toEditorInteractive",
                source: "marker",
                official: false,
                lowerIsBetter: true,
            },
            {
                name: "mssql.queryStudio.open.toResultsRendered",
                source: "marker",
                official: false,
                lowerIsBetter: true,
            },
        ],
    },
});

register({
    implemented: true, // SC-5: sqlcmd mode end-to-end (SQLCMD_MODE_PLAN.md)
    plannedMilestone: "SC-5",
    maturity: "exploratory",
    spec: {
        scenarioId: "querystudio-sqlcmd-run",
        displayName: "Query Studio: SQLCMD script (setvar/$(var)/GO n) to results visible",
        tags: ["querystudio", "sqlcmd", "webview"],
        profileMode: "warmed",
        userSettings: {
            "mssql.sqlDataPlane.enabled": true,
            "mssql.queryStudio.enabled": true,
        },
        sql: {
            database: "PerfHarness",
            cacheMode: "warm",
            connectionProfile: "default",
        },
        setup: [
            ...ACTIVATE_STEPS,
            { type: "provisionConnectionProfile", profile: "default", timeoutMs: 30000 },
        ],
        measure: {
            start: { type: "beforeFirstAction" },
            action: [
                {
                    type: "command",
                    command: "mssql.queryStudio.newQueryFromContext",
                    args: [
                        {
                            profileId: "perf-querystudio-default",
                            initialSql:
                                ":setvar probe 41\nSELECT $(probe) + 1 AS sqlcmd_probe;\nGO 2\n",
                            autoRun: true,
                            sqlcmd: true,
                            source: "perftest",
                        },
                    ],
                    timeoutMs: 60000,
                },
                {
                    type: "waitForMarker",
                    name: "mssql.queryStudio.resultsRendered",
                    timeoutMs: 90000,
                },
            ],
            end: { type: "afterLastAction" },
            timeoutMs: 120000,
        },
        success: [
            // The run went through the SQLCMD preprocessor (not the classic path)…
            { type: "markerSeen", name: "mssql.queryStudio.sqlcmd.run" },
            // …and actually completed against the server.
            { type: "markerSeen", name: "mssql.queryStudio.query.complete" },
            { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
        ],
        cleanup: CLEANUP_EXPLORER,
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: false, lowerIsBetter: true },
            {
                name: "mssql.queryStudio.query.toComplete",
                source: "marker",
                official: false,
                lowerIsBetter: true,
            },
        ],
    },
});

// ---------------------------------------------------------------------------
// VEC-12 — Vector Workbench scenarios. Two claims, proven separately:
//  (a) unopened cost ≈ 0: running a query with a native vector column while
//      NEVER activating the Vector tab must not load the lazy vector chunk
//      or ingest vector data (markerAbsent negative proofs);
//  (b) activation → first paint: host-driven tab activation through the
//      mssql.perf.queryStudioActivateTab seam, timed to the pane's honest
//      double-rAF firstPaint, with chunk-load and analysis pairs derived.
// Both run against the pre-provisioned VectorLab database (5000 rows of
// 64-dim f32 vectors); the SQL fully-qualifies the table so the profile
// database is not load-bearing. Exploratory: wallclock stays official:false
// until baseline history exists (same discipline as the QS-3 shapes).
// ---------------------------------------------------------------------------

const VECTOR_USER_SETTINGS = {
    "mssql.sqlDataPlane.enabled": true,
    "mssql.queryStudio.enabled": true,
    "mssql.queryStudio.vectorWorkbench.enabled": true,
};

const VECTOR_SETUP: ScenarioStep[] = [
    ...ACTIVATE_STEPS,
    { type: "openDocument", path: "queries/vectorlab-chunks.sql" },
    { type: "command", command: "mssql.queryStudio.openActive", timeoutMs: 60000 },
    { type: "waitForMarker", name: "mssql.queryStudio.open.end", timeoutMs: 60000 },
    { type: "queryStudioConnect", profile: "default", timeoutMs: 90000 },
];

const VECTOR_ACTIVATE_COMMAND = "mssql.perf.queryStudioActivateTab";

function vectorActivateStep(args: QueryStudioPerfActivateTabArgs, timeoutMs = 30000): ScenarioStep {
    return {
        type: "command",
        command: VECTOR_ACTIVATE_COMMAND,
        args: [args],
        timeoutMs,
    };
}

/**
 * Projection and Search measurements start from an already-open workbench.
 * The current product opens/profile-analyzes the selected vector column before
 * mounting nested workspaces, so keeping that work in setup prevents a
 * Projection/Search number from silently including Profile or chunk loading.
 */
const VECTOR_PROFILE_READY_SETUP: ScenarioStep[] = [
    ...VECTOR_SETUP,
    { type: "queryStudioExecute", timeoutMs: 120000 },
    {
        type: "waitForMarker",
        name: "mssql.queryStudio.resultsRendered",
        attrs: { rows: 5000 },
        timeoutMs: 120000,
    },
    vectorActivateStep({ tab: "vector" }),
    {
        type: "waitForMarker",
        name: "mssql.queryResults.vector.render.firstPaint",
        timeoutMs: 90000,
    },
];

register({
    implemented: true, // VEC-12: markerAbsent criterion + VectorLab fixture
    plannedMilestone: "VEC-12",
    maturity: "exploratory",
    spec: {
        scenarioId: "querystudio-vector-unopened-f32",
        displayName: "Query Studio: 5000-row f32 vector query — Vector tab unopened costs nothing",
        tags: ["querystudio", "vector", "webview"],
        profileMode: "warmed",
        userSettings: VECTOR_USER_SETTINGS,
        sql: {
            database: "VectorLab",
            cacheMode: "warm",
            connectionProfile: "default",
        },
        setup: VECTOR_SETUP,
        measure: {
            start: { type: "beforeFirstAction" },
            action: [{ type: "queryStudioExecute", timeoutMs: 120000 }],
            // rows-guarded: the connect step's unmeasured session preflight renders
            // its own (1-row) results — only the real 5000-row render ends the window.
            end: {
                type: "waitForMarker",
                name: "mssql.queryStudio.resultsRendered",
                attrs: { rows: 5000 },
            },
            timeoutMs: 120000,
        },
        success: [
            { type: "markerSeen", name: "mssql.queryStudio.query.complete", attrs: { rows: 5000 } },
            {
                type: "markerSeen",
                name: "mssql.queryStudio.resultsRendered",
                attrs: { rows: 5000 },
            },
            // The unopened-cost proof: the lazy Vector chunk was never requested and
            // the host never ingested vector data anywhere in the rep.
            { type: "markerAbsent", name: "mssql.queryStudio.boot.vectorChunkRequested" },
            { type: "markerAbsent", name: "mssql.queryResults.vector.ingest" },
            { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
        ],
        cleanup: [
            { type: "command", command: "workbench.action.closeActiveEditor" },
            ...CLEANUP_EXPLORER,
        ],
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: false, lowerIsBetter: true },
            // withinMeasuredWindow: the setup preflight emits the same product
            // marker family — only the measured pair may be timed.
            {
                name: "mssql.queryStudio.query.toComplete",
                source: "marker",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.queryStudio.query.submit",
                endMarker: "mssql.queryStudio.query.complete",
                component: "queryStudio",
                processRole: "extensionHost",
                withinMeasuredWindow: true,
            },
            {
                name: "mssql.queryStudio.query.toRender",
                source: "marker",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.queryStudio.query.submit",
                endMarker: "mssql.queryStudio.resultsRendered",
                component: "queryStudio",
                processRole: "boundary",
                withinMeasuredWindow: true,
            },
        ],
    },
});

register({
    implemented: true, // VEC-12: mssql.perf.queryStudioActivateTab seam (product-side)
    plannedMilestone: "VEC-12",
    maturity: "exploratory",
    spec: {
        scenarioId: "querystudio-vector-profile-f32",
        displayName: "Query Studio: Vector tab activation → profile first paint (5000 f32 rows)",
        tags: ["querystudio", "vector", "webview"],
        profileMode: "warmed",
        userSettings: VECTOR_USER_SETTINGS,
        sql: {
            database: "VectorLab",
            cacheMode: "warm",
            connectionProfile: "default",
        },
        // The measured window starts AFTER the 5000-row results are rendered:
        // the query execute lives in setup so only activation → first paint is
        // timed (chunk load + ingest + analysis + summary render).
        setup: [
            ...VECTOR_SETUP,
            { type: "queryStudioExecute", timeoutMs: 120000 },
            {
                type: "waitForMarker",
                name: "mssql.queryStudio.resultsRendered",
                attrs: { rows: 5000 },
                timeoutMs: 120000,
            },
        ],
        measure: {
            start: { type: "beforeFirstAction" },
            action: [
                vectorActivateStep({ tab: "vector" }),
                // firstPaint carries no attrs (like the open-autorun boot marks), so
                // the wait is the last ACTION and the window ends afterLastAction —
                // no stale-match risk: the mark can only ever fire after activation.
                {
                    type: "waitForMarker",
                    name: "mssql.queryResults.vector.render.firstPaint",
                    timeoutMs: 90000,
                },
            ],
            end: { type: "afterLastAction" },
            timeoutMs: 120000,
        },
        success: [
            { type: "markerSeen", name: "mssql.queryStudio.boot.vectorChunkRequested" },
            { type: "markerSeen", name: "mssql.queryStudio.boot.vectorChunkLoaded" },
            {
                type: "markerSeen",
                name: "mssql.queryResults.vector.analysis.end",
                attrs: { outcome: "ok" },
            },
            { type: "markerSeen", name: "mssql.queryResults.vector.render.firstPaint" },
            { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
        ],
        cleanup: [
            { type: "command", command: "workbench.action.closeActiveEditor" },
            ...CLEANUP_EXPLORER,
        ],
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: false, lowerIsBetter: true },
            {
                name: "mssql.queryStudio.boot.vectorChunkLoad",
                source: "marker",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.queryStudio.boot.vectorChunkRequested",
                endMarker: "mssql.queryStudio.boot.vectorChunkLoaded",
                component: "queryStudio",
                processRole: "webview",
                withinMeasuredWindow: true,
            },
            {
                name: "mssql.queryResults.vector.analysis",
                source: "marker",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.queryResults.vector.analysis.begin",
                endMarker: "mssql.queryResults.vector.analysis.end",
                component: "queryResults",
                processRole: "extensionHost",
                withinMeasuredWindow: true,
            },
        ],
    },
});

// The nested-workspace action is a small PERF_MODE-only extension of the
// existing activation command. vscode-mssql normalizes it and drives the real
// workspace/UI paths; no arbitrary SQL or vector payload crosses this seam.
const VECTOR_SEARCH_TARGET = {
    schema: "dbo",
    table: "VectorLabSearchCorpus",
    vectorColumn: "embedding",
} as const;

const vectorSearchArgs = (includeApprox: boolean): QueryStudioPerfActivateTabArgs => ({
    tab: "vector",
    vector: {
        workspace: "search",
        search: {
            // vectorlab-chunks.sql is ordered by chunk_id; ordinal 1000 is the
            // deterministic, non-null 64-D fixture row with chunk_id 1001.
            source: { kind: "selectedRow", ordinal: 1000 },
            target: VECTOR_SEARCH_TARGET,
            metric: "cosine",
            k: 20,
            includeApprox,
        },
    },
});

register({
    implemented: true,
    plannedMilestone: "VEC-12",
    maturity: "exploratory",
    spec: {
        scenarioId: "querystudio-vector-projection-f32",
        displayName:
            "Query Studio: Vector Projection workspace → first Canvas paint (5000 f32 rows)",
        tags: ["querystudio", "vector", "projection", "webview"],
        profileMode: "warmed",
        userSettings: VECTOR_USER_SETTINGS,
        sql: {
            database: "VectorLab",
            cacheMode: "warm",
            connectionProfile: "default",
        },
        setup: VECTOR_PROFILE_READY_SETUP,
        measure: {
            start: { type: "beforeFirstAction" },
            action: [
                vectorActivateStep({
                    tab: "vector",
                    vector: { workspace: "projection" },
                }),
            ],
            end: {
                type: "waitForMarker",
                name: "mssql.queryResults.vector.render.firstPaint",
                attrs: { workspace: "projection" },
            },
            timeoutMs: 120000,
        },
        success: [
            {
                type: "markerSeen",
                name: "mssql.queryResults.vector.render.firstPaint",
                attrs: { workspace: "projection" },
            },
            {
                type: "markerSeen",
                name: "mssql.queryResults.vector.analysis.end",
                // VectorLabChunks has 5,000 source rows and 12 intentional NULL vectors.
                attrs: { outcome: "ok", rows: 4988, dimensions: 64 },
            },
            {
                type: "markerSeen",
                name: "mssql.queryResults.vector.worker.end",
                attrs: { operation: "projection", outcome: "ok", rows: 4988, dimensions: 64 },
            },
            {
                type: "markerAbsent",
                name: "mssql.queryResults.vector.worker.end",
                attrs: { operation: "projection", outcome: "error" },
            },
            {
                type: "markerAbsent",
                name: "mssql.queryResults.vector.worker.end",
                attrs: { operation: "projection", outcome: "cancelled" },
            },
            { type: "markerAbsent", name: "mssql.queryResults.vector.analysis.cancel" },
            { type: "markerAbsent", name: "mssql.queryResults.vector.search.end" },
            { type: "markerAbsent", name: "mssql.queryResults.vector.model.end" },
            { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
        ],
        cleanup: [
            { type: "command", command: "workbench.action.closeActiveEditor" },
            ...CLEANUP_EXPLORER,
        ],
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: false, lowerIsBetter: true },
            {
                name: "mssql.queryResults.vector.analysis",
                source: "marker",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.queryResults.vector.analysis.begin",
                endMarker: "mssql.queryResults.vector.analysis.end",
                component: "queryResults",
                processRole: "extensionHost",
                withinMeasuredWindow: true,
            },
        ],
    },
});

register({
    implemented: true,
    plannedMilestone: "VEC-12",
    maturity: "exploratory",
    spec: {
        scenarioId: "querystudio-vector-search-exact-f32",
        displayName: "Query Studio: Vector Search exact-only result (K=20, 64-D f32)",
        tags: ["querystudio", "vector", "search", "exact"],
        profileMode: "warmed",
        userSettings: VECTOR_USER_SETTINGS,
        sql: {
            database: "VectorLab",
            cacheMode: "warm",
            connectionProfile: "default",
        },
        setup: VECTOR_PROFILE_READY_SETUP,
        measure: {
            start: { type: "beforeFirstAction" },
            action: [vectorActivateStep(vectorSearchArgs(false))],
            end: {
                type: "waitForMarker",
                name: "mssql.queryResults.vector.search.end",
                attrs: { outcome: "ok", k: 20, approxIncluded: false },
            },
            timeoutMs: 120000,
        },
        success: [
            {
                type: "markerSeen",
                name: "mssql.queryResults.vector.search.end",
                attrs: { outcome: "ok", k: 20, approxIncluded: false },
            },
            {
                type: "markerAbsent",
                name: "mssql.queryResults.vector.search.end",
                attrs: { approxIncluded: true },
            },
            { type: "markerAbsent", name: "mssql.queryResults.vector.analysis.cancel" },
            { type: "markerAbsent", name: "mssql.queryResults.vector.model.end" },
            { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
        ],
        cleanup: [
            { type: "command", command: "workbench.action.closeActiveEditor" },
            ...CLEANUP_EXPLORER,
        ],
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: false, lowerIsBetter: true },
        ],
    },
});

register({
    implemented: true, // Runtime success intentionally requires the fixture's compatible cosine index.
    plannedMilestone: "VEC-12",
    maturity: "exploratory",
    spec: {
        scenarioId: "querystudio-vector-search-ann-f32",
        displayName: "Query Studio: Vector Search exact + ANN result (K=20, 64-D f32)",
        tags: ["querystudio", "vector", "search", "ann"],
        profileMode: "warmed",
        userSettings: VECTOR_USER_SETTINGS,
        sql: {
            database: "VectorLab",
            cacheMode: "warm",
            connectionProfile: "default",
        },
        setup: VECTOR_PROFILE_READY_SETUP,
        measure: {
            start: { type: "beforeFirstAction" },
            action: [vectorActivateStep(vectorSearchArgs(true))],
            end: {
                type: "waitForMarker",
                name: "mssql.queryResults.vector.search.end",
                attrs: { outcome: "ok", k: 20, approxIncluded: true },
            },
            timeoutMs: 120000,
        },
        success: [
            {
                type: "markerSeen",
                name: "mssql.queryResults.vector.search.end",
                attrs: { outcome: "ok", k: 20, approxIncluded: true },
            },
            {
                type: "markerAbsent",
                name: "mssql.queryResults.vector.search.end",
                attrs: { approxIncluded: false },
            },
            { type: "markerAbsent", name: "mssql.queryResults.vector.analysis.cancel" },
            { type: "markerAbsent", name: "mssql.queryResults.vector.model.end" },
            { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
        ],
        cleanup: [
            { type: "command", command: "workbench.action.closeActiveEditor" },
            ...CLEANUP_EXPLORER,
        ],
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: false, lowerIsBetter: true },
        ],
    },
});

register({
    implemented: true, // CACHE wrap: PERF_MODE warm-acquire probe + persistent cache
    plannedMilestone: "CACHE",
    maturity: "exploratory",
    spec: {
        scenarioId: "metadatacache-warm-acquire",
        displayName: "Metadata cache: warm acquire served from disk",
        tags: ["metadata", "cache"],
        profileMode: "warmed",
        userSettings: {
            "mssql.enableExperimentalFeatures": true,
            "mssql.sqlDataPlane.enabled": true,
            "mssql.metadataCache.enabled": true,
        },
        sql: {
            database: "PerfHarness",
            cacheMode: "warm",
            connectionProfile: "default",
        },
        setup: [
            ...ACTIVATE_STEPS,
            { type: "provisionConnectionProfile", profile: "default", timeoutMs: 30000 },
        ],
        measure: {
            start: { type: "beforeFirstAction" },
            // The probe hydrates live (cold pass), flushes the save-back, then
            // proves a SECOND fresh store is served from DISK (throws on any
            // honesty failure: loadedFromDisk!=1, source!=disk, no snapshot).
            action: [
                {
                    type: "command",
                    command: "mssql.perf.metadataCacheWarmAcquire",
                    timeoutMs: 90000,
                },
            ],
            // Markers travel via the perf sink — the rep must WAIT for the end
            // marker to arrive (afterLastAction closed the rep before flush).
            end: { type: "waitForMarker", name: "mssql.metadata.cache.warmAcquire.end" },
            timeoutMs: 120000,
        },
        success: [
            { type: "markerSeen", name: "mssql.metadata.cache.warmAcquire.begin" },
            { type: "markerSeen", name: "mssql.metadata.cache.warmAcquire.end" },
            { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
        ],
        cleanup: CLEANUP_EXPLORER,
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: false, lowerIsBetter: true },
            {
                // Disk load + publish + freshness decision — the executable form
                // of the cache-load budget (metadata-docs cache design §20).
                name: "metadata.cache.warmAcquire",
                source: "marker",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.metadata.cache.warmAcquire.begin",
                endMarker: "mssql.metadata.cache.warmAcquire.end",
                component: "metadata",
                processRole: "extensionHost",
            },
        ],
    },
});

// ---------------------------------------------------------------------------
// Designers (Chunk 4: CLI port of the in-proc designerOpen semantics).
// Metric names + marker pairs are IDENTICAL to the self-test catalog so a
// designer scenario graduates from local reproduction to CLI without a
// semantic rewrite. Diagnostic maturity until baseline history exists.
// ---------------------------------------------------------------------------

register({
    implemented: true, // C4: driver designerOpen step + STS DacFx designer spans
    plannedMilestone: "C4",
    maturity: "diagnostic",
    spec: {
        scenarioId: "table-designer-open",
        displayName: "Table Designer: open (new table)",
        tags: ["designer", "dacfx", "webview"],
        profileMode: "warmed",
        sql: { database: "PerfHarness", cacheMode: "warm", connectionProfile: "default" },
        setup: ACTIVATE_STEPS,
        measure: {
            start: { type: "beforeFirstAction" },
            action: [
                {
                    type: "designerOpen",
                    designer: "tableDesigner",
                    profile: "default",
                    timeoutMs: 120000,
                },
                { type: "waitForMarker", name: "mssql.tableDesigner.init.end", timeoutMs: 120000 },
            ],
            end: { type: "afterLastAction" },
            timeoutMs: 300000,
        },
        success: [
            { type: "markerSeen", name: "mssql.tableDesigner.init.end" },
            { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
        ],
        cleanup: [{ type: "command", command: "workbench.action.closeActiveEditor" }],
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: true, lowerIsBetter: true },
            {
                name: "mssql.tableDesigner.init",
                source: "marker",
                official: true,
                lowerIsBetter: true,
                beginMarker: "mssql.tableDesigner.init.begin",
                endMarker: "mssql.tableDesigner.init.end",
                component: "tableDesigner",
            },
        ],
    },
});

register({
    implemented: true, // C4
    plannedMilestone: "C4",
    maturity: "diagnostic",
    spec: {
        scenarioId: "schema-designer-open",
        displayName: "Schema Designer: open",
        tags: ["designer", "dacfx", "webview"],
        profileMode: "warmed",
        sql: { database: "PerfHarness", cacheMode: "warm", connectionProfile: "default" },
        setup: ACTIVATE_STEPS,
        measure: {
            start: { type: "beforeFirstAction" },
            action: [
                {
                    type: "designerOpen",
                    designer: "schemaDesigner",
                    profile: "default",
                    timeoutMs: 180000,
                },
                { type: "waitForMarker", name: "mssql.schemaDesigner.init.end", timeoutMs: 180000 },
                // SV-R10 (§14.2): the window now extends to the webview's first
                // meaningful paint so the rendered phase is measurable — the
                // host/model metric below is unaffected (same marker pair).
                { type: "waitForMarker", name: "mssql.schemaDesigner.ready", timeoutMs: 180000 },
            ],
            end: { type: "afterLastAction" },
            timeoutMs: 300000,
        },
        success: [
            { type: "markerSeen", name: "mssql.schemaDesigner.init.end" },
            { type: "markerSeen", name: "mssql.schemaDesigner.ready" },
            { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
        ],
        cleanup: [{ type: "command", command: "workbench.action.closeActiveEditor" }],
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: true, lowerIsBetter: true },
            {
                name: "mssql.schemaDesigner.init",
                source: "marker",
                official: true,
                lowerIsBetter: true,
                beginMarker: "mssql.schemaDesigner.init.begin",
                endMarker: "mssql.schemaDesigner.init.end",
                component: "schemaDesigner",
            },
            {
                // Rendered phase (§14.2): crosses into the webview mark plane —
                // calibrated/boundary semantics, unofficial until baselines accrue.
                name: "mssql.schemaDesigner.init.toReady",
                source: "marker",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.schemaDesigner.init.begin",
                endMarker: "mssql.schemaDesigner.ready",
                component: "schemaDesigner",
                processRole: "boundary",
                withinMeasuredWindow: true,
            },
        ],
    },
});

// ---------------------------------------------------------------------------
// SV-R10: Schema Visualizer (metadata-substrate designer read path). The
// candidate side of the §14.2 designer A/B: `perftest head-to-head
// --baseline-scenario schema-designer-open --candidate-scenario
// schema-visualizer-open` (the designer phase map pairs host/model and
// rendered semantics). Scope equality: same PerfHarness database, full
// catalog (below the search-first threshold), warm profile. Exploratory —
// metrics unofficial until baseline history exists (§14.5).
// ---------------------------------------------------------------------------

register({
    implemented: true, // SV-R4: PERF_MODE probe mssql.perf.schemaVisualizerOpen
    plannedMilestone: "SV-R10",
    maturity: "exploratory",
    spec: {
        scenarioId: "schema-visualizer-open",
        displayName: "Schema Visualizer: open (metadata substrate)",
        tags: ["designer", "schemaVisualizer", "metadata", "webview"],
        profileMode: "warmed",
        userSettings: {
            "mssql.sqlDataPlane.enabled": true,
            "mssql.schemaVisualizer.enabled": true,
            // Diagnostic aid while the scenario matures (metrics here are
            // unofficial anyway): the session-diag journal in the captured
            // profile carries metadata.hydrate failure classes.
            "mssql.sessionDiag.enabled": true,
        },
        sql: { database: "PerfHarness", cacheMode: "warm", connectionProfile: "default" },
        setup: [
            ...ACTIVATE_STEPS,
            // The open probe resolves the FIRST saved profile — provision it
            // (the OE v2 browse scenario pattern).
            { type: "provisionConnectionProfile", profile: "default", timeoutMs: 30000 },
        ],
        measure: {
            start: { type: "beforeFirstAction" },
            action: [
                { type: "command", command: "mssql.perf.schemaVisualizerOpen", timeoutMs: 120000 },
                { type: "waitForMarker", name: "mssql.schemaVisualizer.ready", timeoutMs: 120000 },
            ],
            end: { type: "afterLastAction" },
            timeoutMs: 300000,
        },
        success: [
            { type: "markerSeen", name: "mssql.schemaVisualizer.open.end" },
            { type: "markerSeen", name: "mssql.schemaVisualizer.ready" },
            { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
        ],
        cleanup: [{ type: "command", command: "workbench.action.closeActiveEditor" }],
        metrics: [
            // wallclock official like the backend-A/B twins (run selection needs
            // it); the PHASE metrics below stay unofficial until baselines (§14.5).
            { name: "scenario.wallclock", source: "marker", official: true, lowerIsBetter: true },
            {
                // Host/model phase: metadata acquire + canonical model + projection.
                name: "mssql.schemaVisualizer.open",
                source: "marker",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.schemaVisualizer.open.begin",
                endMarker: "mssql.schemaVisualizer.open.end",
                component: "schemaVisualizer",
                processRole: "extensionHost",
                withinMeasuredWindow: true,
            },
            {
                // Rendered phase: first meaningful graph paint (§11.5 semantics).
                name: "mssql.schemaVisualizer.open.toReady",
                source: "marker",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.schemaVisualizer.open.begin",
                endMarker: "mssql.schemaVisualizer.ready",
                component: "schemaVisualizer",
                processRole: "boundary",
                withinMeasuredWindow: true,
            },
        ],
    },
});

// ---------------------------------------------------------------------------
// C2D-8 queryresults-* scenarios (historical chat-to-data plan, not imported): the
// snapshot/pin/transform platform under the QO-9a fixtures. Exploratory,
// wallclock unofficial — like the querystudio shapes, these accrue baselines
// before any budget hardens. Pinning rides the mssql.queryStudio.pinAllResults
// command; transforms ride the hidden benchmarkTransform probe. All markers
// are registry-first (queryResults family).
// ---------------------------------------------------------------------------
interface QueryResultsShapeSpec {
    scenarioId: string;
    displayName: string;
    tags: string[];
    queryPath: string;
    /** Rendered-rows guard for the seeding run. */
    renderedAttrs: Record<string, number>;
    /** Steps of the measured window (after the seeded+rendered run). */
    action: Array<Record<string, unknown>>;
    end: { name: string; attrs?: Record<string, number> };
    success: Array<{ name: string; attrs?: Record<string, number> }>;
    metrics: Array<Record<string, unknown>>;
    /** Extra setup after the seeding run completes (e.g. first pin). */
    postRunSetup?: Array<Record<string, unknown>>;
    timeoutMs?: number;
}

function registerQueryResultsShape(shape: QueryResultsShapeSpec): void {
    const timeoutMs = shape.timeoutMs ?? 300000;
    register({
        implemented: true,
        plannedMilestone: "C2D-8",
        maturity: "exploratory",
        spec: {
            scenarioId: shape.scenarioId,
            displayName: shape.displayName,
            tags: shape.tags,
            profileMode: "warmed",
            userSettings: {
                "mssql.sqlDataPlane.enabled": true,
                "mssql.queryStudio.enabled": true,
            },
            sql: {
                database: "PerfHarness",
                cacheMode: "warm",
                connectionProfile: "default",
            },
            setup: [
                ...ACTIVATE_STEPS,
                { type: "openDocument", path: shape.queryPath },
                { type: "command", command: "mssql.queryStudio.openActive", timeoutMs: 60000 },
                { type: "waitForMarker", name: "mssql.queryStudio.open.end", timeoutMs: 60000 },
                { type: "queryStudioConnect", profile: "default", timeoutMs: 90000 },
                { type: "queryStudioExecute", timeoutMs },
                {
                    type: "waitForMarker",
                    name: "mssql.queryStudio.resultsRendered",
                    attrs: shape.renderedAttrs,
                    timeoutMs,
                },
                ...((shape.postRunSetup ?? []) as never[]),
            ],
            measure: {
                start: { type: "beforeFirstAction" },
                action: shape.action as never,
                end: {
                    type: "waitForMarker",
                    name: shape.end.name,
                    ...(shape.end.attrs ? { attrs: shape.end.attrs } : {}),
                },
                timeoutMs,
            },
            success: [
                ...shape.success.map((proof) => ({
                    type: "markerSeen" as const,
                    name: proof.name,
                    ...(proof.attrs ? { attrs: proof.attrs } : {}),
                })),
                { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
            ],
            cleanup: [
                { type: "command", command: "workbench.action.closeAllEditors" },
                ...CLEANUP_EXPLORER,
            ],
            metrics: [
                {
                    name: "scenario.wallclock",
                    source: "marker",
                    official: false,
                    lowerIsBetter: true,
                },
                ...(shape.metrics as never[]),
            ],
        },
    });
}

// Pin 100k rows: measured window = the pin command → first pinned paint.
// snapshot.create must stay scan-free regardless of result size.
registerQueryResultsShape({
    scenarioId: "queryresults-pin-after-100k",
    displayName: "Query Results: pin 100k rows to a snapshot document",
    tags: ["queryresults", "querystudio", "pin", "snapshot", "webview"],
    queryPath: "queries/select-100000.sql",
    renderedAttrs: { rows: 100000 },
    action: [{ type: "command", command: "mssql.queryStudio.pinAllResults", timeoutMs: 60000 }],
    end: { name: "mssql.queryResults.pin.rendered", attrs: { rows: 100000 } },
    success: [
        { name: "mssql.queryResults.snapshot.create.end" },
        { name: "mssql.queryResults.pin.open.end" },
    ],
    metrics: [
        {
            name: "mssql.queryResults.pin.open",
            source: "marker",
            official: false,
            lowerIsBetter: true,
            beginMarker: "mssql.queryResults.pin.open.begin",
            endMarker: "mssql.queryResults.pin.open.end",
            component: "queryResults",
            processRole: "extensionHost",
            withinMeasuredWindow: true,
        },
        {
            name: "mssql.queryResults.pin.toRender",
            source: "marker",
            official: false,
            lowerIsBetter: true,
            beginMarker: "mssql.queryResults.pin.open.begin",
            endMarker: "mssql.queryResults.pin.rendered",
            component: "queryResults",
            processRole: "boundary",
            withinMeasuredWindow: true,
        },
    ],
});

// ---------------------------------------------------------------------------
// SPA-9 — offline Spatial result-pane scenarios. The query itself runs in
// setup for activation cases, so the measured window is pane activation to
// a real OpenLayers render completion. All remain exploratory until multiple
// machines establish stable baselines.
// ---------------------------------------------------------------------------

const SPATIAL_USER_SETTINGS = {
    "mssql.sqlDataPlane.enabled": true,
    "mssql.queryStudio.enabled": true,
    "mssql.queryStudio.spatial.enabled": true,
};

function spatialSetup(queryPath: string): ScenarioStep[] {
    return [
        ...ACTIVATE_STEPS,
        { type: "openDocument", path: queryPath },
        { type: "command", command: "mssql.queryStudio.openActive", timeoutMs: 60000 },
        { type: "waitForMarker", name: "mssql.queryStudio.open.end", timeoutMs: 60000 },
        { type: "queryStudioConnect", profile: "default", timeoutMs: 90000 },
    ];
}

function registerSpatialActivation(args: {
    scenarioId: string;
    displayName: string;
    queryPath: string;
    rows: number;
    settledTier: "canvas" | "clusters" | "gpuPoints";
    partial?: boolean;
}): void {
    register({
        implemented: true,
        plannedMilestone: "SPA-9",
        maturity: "exploratory",
        spec: {
            scenarioId: args.scenarioId,
            displayName: args.displayName,
            tags: ["querystudio", "spatial", "webview", "offline"],
            profileMode: "warmed",
            sql: { connectionProfile: "default", cacheMode: "warm" },
            userSettings: SPATIAL_USER_SETTINGS,
            setup: [
                ...spatialSetup(args.queryPath),
                { type: "queryStudioExecute", timeoutMs: 180000 },
                {
                    type: "waitForMarker",
                    name: "mssql.queryStudio.resultsRendered",
                    attrs: { rows: args.rows },
                    timeoutMs: 180000,
                },
            ],
            measure: {
                start: { type: "beforeFirstAction" },
                action: [
                    {
                        type: "command",
                        command: "mssql.perf.queryStudioActivateTab",
                        args: [{ tab: "spatial" }],
                        timeoutMs: 30000,
                    },
                ],
                end: {
                    type: "waitForMarker",
                    // End only after the complete source has been prepared. Ending on
                    // first paint races the chunk pump and turns the required
                    // prepare.end marker into a cancellation during cleanup.
                    name: "mssql.queryResults.spatial.render.settled",
                    attrs: { tier: args.settledTier },
                },
                timeoutMs: 180000,
            },
            success: [
                { type: "markerSeen", name: "mssql.queryStudio.boot.spatialChunkRequested" },
                { type: "markerSeen", name: "mssql.queryStudio.boot.spatialChunkLoaded" },
                {
                    type: "markerSeen",
                    name: "mssql.queryResults.spatial.prepare.end",
                    attrs: { outcome: "ok", partial: args.partial ? "true" : "false" },
                },
                { type: "markerSeen", name: "mssql.queryResults.spatial.render.firstPaint" },
                {
                    type: "markerSeen",
                    name: "mssql.queryResults.spatial.render.settled",
                    attrs: { tier: args.settledTier, partial: args.partial ? "true" : "false" },
                },
                { type: "markerAbsent", name: "mssql.queryResults.spatial.prepare.cancel" },
                { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
            ],
            cleanup: [
                { type: "command", command: "workbench.action.closeActiveEditor" },
                ...CLEANUP_EXPLORER,
            ],
            metrics: [
                {
                    name: "scenario.wallclock",
                    source: "marker",
                    official: false,
                    lowerIsBetter: true,
                },
                {
                    name: "mssql.queryStudio.boot.spatialChunkLoad",
                    source: "marker",
                    official: false,
                    lowerIsBetter: true,
                    beginMarker: "mssql.queryStudio.boot.spatialChunkRequested",
                    endMarker: "mssql.queryStudio.boot.spatialChunkLoaded",
                    component: "queryStudio",
                    processRole: "webview",
                    withinMeasuredWindow: true,
                },
                {
                    name: "mssql.queryResults.spatial.render.toFirstPaint",
                    source: "marker",
                    official: false,
                    lowerIsBetter: true,
                    beginMarker: "mssql.queryResults.spatial.render.begin",
                    endMarker: "mssql.queryResults.spatial.render.firstPaint",
                    component: "queryResults",
                    processRole: "webview",
                    withinMeasuredWindow: true,
                },
            ],
        },
    });
}

register({
    implemented: true,
    plannedMilestone: "SPA-9",
    maturity: "exploratory",
    spec: {
        scenarioId: "querystudio-spatial-unopened-points",
        displayName: "Query Studio: 10k spatial points — Spatial tab unopened costs nothing",
        tags: ["querystudio", "spatial", "webview", "negative-proof"],
        profileMode: "warmed",
        sql: { connectionProfile: "default", cacheMode: "warm" },
        userSettings: SPATIAL_USER_SETTINGS,
        setup: spatialSetup("queries/spatial-points-10k.sql"),
        measure: {
            start: { type: "beforeFirstAction" },
            action: [{ type: "queryStudioExecute", timeoutMs: 180000 }],
            end: {
                type: "waitForMarker",
                name: "mssql.queryStudio.resultsRendered",
                attrs: { rows: 10000 },
            },
            timeoutMs: 180000,
        },
        success: [
            { type: "markerAbsent", name: "mssql.queryStudio.boot.spatialChunkRequested" },
            { type: "markerAbsent", name: "mssql.queryResults.spatial.prepare.begin" },
            { type: "markerAbsent", name: "mssql.queryResults.spatial.decode.begin" },
            { type: "markerAbsent", name: "mssql.queryResults.spatial.render.begin" },
            { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
        ],
        cleanup: [
            { type: "command", command: "workbench.action.closeActiveEditor" },
            ...CLEANUP_EXPLORER,
        ],
        metrics: [
            { name: "scenario.wallclock", source: "marker", official: false, lowerIsBetter: true },
        ],
    },
});

registerSpatialActivation({
    scenarioId: "querystudio-spatial-points-10k-offline",
    displayName: "Query Studio: Spatial activation and first paint (10k points, offline)",
    queryPath: "queries/spatial-points-10k.sql",
    rows: 10000,
    settledTier: "clusters",
});

registerSpatialActivation({
    scenarioId: "querystudio-spatial-points-100k",
    displayName: "Query Studio: Spatial activation and first paint (100k points)",
    queryPath: "queries/spatial-points-100k.sql",
    rows: 100000,
    settledTier: "clusters",
    partial: true,
});

// Pin then rerun: the measured window is the RERUN with a pinned snapshot
// holding a lease — the previous store must demote (not dispose) and the
// rerun must not regress. store.demote seen = the lease path exercised.
registerQueryResultsShape({
    scenarioId: "queryresults-pin-survives-rerun",
    displayName: "Query Results: rerun with a pinned snapshot alive",
    tags: ["queryresults", "querystudio", "pin", "lease", "rerun"],
    queryPath: "queries/select-100000.sql",
    renderedAttrs: { rows: 100000 },
    postRunSetup: [
        { type: "command", command: "mssql.queryStudio.pinAllResults", timeoutMs: 60000 },
        { type: "waitForMarker", name: "mssql.queryResults.pin.rendered", timeoutMs: 60000 },
    ],
    action: [{ type: "queryStudioExecute", timeoutMs: 300000 }],
    end: { name: "mssql.queryStudio.resultsRendered", attrs: { rows: 100000 } },
    success: [
        { name: "mssql.queryResults.store.demote" },
        { name: "mssql.queryStudio.query.complete", attrs: { rows: 100000 } },
    ],
    metrics: [
        {
            name: "mssql.queryStudio.query.toRender",
            source: "marker",
            official: false,
            lowerIsBetter: true,
            beginMarker: "mssql.queryStudio.query.submit",
            endMarker: "mssql.queryStudio.resultsRendered",
            component: "queryStudio",
            processRole: "boundary",
            withinMeasuredWindow: true,
        },
    ],
});

// Transform throughput: groupBy(count) over the pinned 100k snapshot via the
// hidden benchmark probe. EvalStats ride the evaluate.end marker; the
// addendum §8.6 target (≥200k rows/s on 100k-narrow) is validated from
// baseline data before any budget hardens.
registerQueryResultsShape({
    scenarioId: "queryresults-transform-groupby-100k",
    displayName: "Query Results: groupBy transform over a 100k snapshot",
    tags: ["queryresults", "transform", "engine", "snapshot"],
    queryPath: "queries/select-100000.sql",
    renderedAttrs: { rows: 100000 },
    postRunSetup: [
        { type: "command", command: "mssql.queryStudio.pinAllResults", timeoutMs: 60000 },
        { type: "waitForMarker", name: "mssql.queryResults.pin.rendered", timeoutMs: 60000 },
    ],
    action: [
        { type: "command", command: "mssql.queryResults.benchmarkTransform", timeoutMs: 120000 },
    ],
    end: { name: "mssql.queryResults.transform.evaluate.end" },
    success: [{ name: "mssql.queryResults.transform.evaluate.end" }],
    metrics: [
        {
            name: "mssql.queryResults.transform.evaluate",
            source: "marker",
            official: false,
            lowerIsBetter: true,
            beginMarker: "mssql.queryResults.transform.evaluate.begin",
            endMarker: "mssql.queryResults.transform.evaluate.end",
            component: "queryResults",
            processRole: "extensionHost",
            withinMeasuredWindow: true,
        },
    ],
});

export function listScenarios(): RegisteredScenario[] {
    return [...registry.values()];
}

export function getScenario(scenarioId: string): RegisteredScenario | undefined {
    return registry.get(scenarioId);
}

/** Flip a scenario to implemented (called by milestone wiring as it lands). */
export function markImplemented(scenarioId: string): void {
    const s = registry.get(scenarioId);
    if (s) {
        s.implemented = true;
    }
}
