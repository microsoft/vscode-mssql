/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Built-in self-test scenarios. These are the orchestrated-harness scenarios
 * adapted to run in-process against the live extension host: no workspace
 * fixtures (queries are inline, untitled SQL documents), and portable SQL that
 * runs against any SQL Server (sys.all_objects), so a self-test needs only a
 * connection — not the provisioned PerfHarness/PerfCatalog databases.
 *
 * `needsSql` scenarios are offered but honestly blocked when no connection is
 * resolvable; the connection-free scenarios exercise the full activation →
 * STS → webview span chain and always run.
 */

import type { ScenarioSpec } from "./scenarioEngine";

export interface MetricDef {
    name: string;
    official: boolean;
    lowerIsBetter?: boolean;
    /** Derived duration metrics: end marker time − begin marker time. */
    beginMarker?: string;
    endMarker?: string;
}

export interface BuiltinScenario {
    id: string;
    title: string;
    description: string;
    tags: string[];
    /** Requires a live SQL connection (offered but blocked when none resolves). */
    needsSql: boolean;
    /**
     * false ⇒ this scenario cannot run honestly inside a live extension host
     * (e.g. cold activation happens once per process). Listed for visibility,
     * always skipped with `skipReason` — use the CLI harness instead.
     */
    inProcess?: boolean;
    skipReason?: string;
    /** Rough single-rep cost hint for the UI (ms). */
    estMs: number;
    /**
     * Graduation level (shared lifecycle with the CLI registry). In-product
     * runs are exploratory-environment by definition; maturity here describes
     * the SCENARIO, not the run: a ciGating scenario run in-product still
     * yields exploratory metrics.
     */
    maturity?: "exploratory" | "diagnostic" | "measurementCandidate" | "ciGating";
    spec: ScenarioSpec;
    metrics: MetricDef[];
}

const WALLCLOCK: MetricDef = {
    name: "scenario.wallclock",
    official: true,
    lowerIsBetter: true,
};

// A portable row-generating query: TOP N over sys.all_objects returns exactly
// N rows on any non-trivial SQL Server, no fixture database required.
function rowQuery(rows: number): string {
    return `SELECT TOP (${rows}) o.object_id AS Id, o.name AS Name, o.type_desc AS Kind\nFROM sys.all_objects o\nORDER BY o.object_id;`;
}

export const BUILTIN_SCENARIOS: BuiltinScenario[] = [
    {
        id: "selftest-noop",
        title: "Harness loop (no-op)",
        description:
            "Pure self-test loop: marker plumbing and the measured-interval mechanics, no product interaction. Proves the runner end to end in well under a second.",
        tags: ["harness", "smoke"],
        needsSql: false,
        estMs: 50,
        metrics: [WALLCLOCK],
        spec: {
            scenarioId: "selftest-noop",
            displayName: "Harness loop (no-op)",
            measure: {
                start: { type: "beforeFirstAction" },
                action: [{ type: "noop" }],
                end: { type: "afterLastAction" },
                timeoutMs: 30000,
            },
            success: [{ type: "noErrors", sources: ["automation"] }],
        },
    },
    {
        id: "selftest-synthetic-delay",
        title: "Synthetic 250ms delay",
        description:
            "Injects a real, transparent 250ms cost inside the measured window — a known-good reference for the timing path and the History trend line.",
        tags: ["harness", "synthetic"],
        needsSql: false,
        estMs: 300,
        metrics: [WALLCLOCK],
        spec: {
            scenarioId: "selftest-synthetic-delay",
            displayName: "Synthetic 250ms delay",
            measure: {
                start: { type: "beforeFirstAction" },
                action: [{ type: "syntheticDelay", ms: 250 }],
                end: { type: "afterLastAction" },
                timeoutMs: 30000,
            },
            success: [{ type: "noErrors", sources: ["automation"] }],
        },
    },
    {
        id: "selftest-activation",
        title: "Extension activation (CLI only)",
        description:
            "Cold activation happens exactly once per VS Code process — and the extension is already active when the Debug Console is open, so mssql.activate.end can never re-fire here. Run `perftest run --scenario ext-normal-activation` for honest activation timing on a fresh instance.",
        tags: ["activation", "extension", "cli-only"],
        needsSql: false,
        inProcess: false,
        skipReason:
            "activation is once-per-process and this instance is already activated — use the perftest CLI (ext-normal-activation) for cold activation timing",
        estMs: 0,
        metrics: [],
        spec: {
            scenarioId: "selftest-activation",
            displayName: "Extension activation (CLI only)",
            measure: {
                start: { type: "beforeFirstAction" },
                action: [],
                end: { type: "afterLastAction" },
                timeoutMs: 1000,
            },
        },
    },
    {
        id: "selftest-intellisense-keywords",
        title: "IntelliSense keyword completion",
        description:
            "Requests SQL completions on a fresh untitled document (no connection needed) and waits for the language service to answer with keyword suggestions — an honest STS language-service round-trip measured in-process.",
        tags: ["intellisense", "language-service", "sts"],
        needsSql: false,
        estMs: 1500,
        metrics: [
            WALLCLOCK,
            {
                name: "intellisense.completion",
                official: false,
                lowerIsBetter: true,
                beginMarker: "driver.completion.begin",
                endMarker: "driver.completion.end",
            },
        ],
        spec: {
            scenarioId: "selftest-intellisense-keywords",
            displayName: "IntelliSense keyword completion",
            setup: [{ type: "openUntitledSql", content: "SEL" }],
            measure: {
                start: { type: "beforeFirstAction" },
                action: [{ type: "completionProbe", expect: "SELECT", timeoutMs: 30000 }],
                end: { type: "afterLastAction" },
                timeoutMs: 60000,
            },
            success: [{ type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] }],
        },
    },
    {
        id: "selftest-debug-console",
        title: "Open Debug Console",
        description:
            "Opens the MSSQL Debug Console webview. Exercises the webview controller span seam — the same one that covers every dialog and designer — so the waterfall shows a webview lane.",
        tags: ["diagnostics", "webview"],
        needsSql: false,
        estMs: 800,
        metrics: [WALLCLOCK],
        spec: {
            scenarioId: "selftest-debug-console",
            displayName: "Open Debug Console",
            measure: {
                start: { type: "beforeFirstAction" },
                action: [{ type: "command", command: "mssql.openDebugConsole", timeoutMs: 60000 }],
                end: { type: "afterLastAction" },
                timeoutMs: 120000,
            },
            success: [{ type: "noErrors", sources: ["automation", "vscode-mssql"] }],
        },
    },
    {
        id: "selftest-connect",
        title: "Connect to SQL Server",
        description:
            "Opens an untitled SQL document and connects it to the resolved server. The waterfall shows connection.begin → STS → connection.ready.",
        tags: ["connection", "sts", "sql"],
        needsSql: true,
        estMs: 3000,
        metrics: [
            WALLCLOCK,
            {
                name: "mssql.connection",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.connection.begin",
                endMarker: "mssql.connection.ready",
            },
        ],
        spec: {
            scenarioId: "selftest-connect",
            displayName: "Connect to SQL Server",
            setup: [{ type: "openUntitledSql", content: "SELECT 1 AS ok;" }],
            measure: {
                start: { type: "beforeFirstAction" },
                action: [{ type: "mssqlConnect", profile: "default", timeoutMs: 60000 }],
                end: { type: "waitForMarker", name: "mssql.connection.ready" },
                timeoutMs: 60000,
            },
            success: [
                { type: "markerSeen", name: "mssql.connection.ready" },
                { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
            ],
        },
    },
    {
        id: "selftest-query-1k",
        title: "Query 1,000 rows",
        description:
            "Connects, runs a portable 1,000-row query in an untitled document, and waits for the results grid to finish rendering. The flagship waterfall: query.submit → RPC → STS dispatcher → SqlCommand (driver lane) → results-grid render.",
        tags: ["query", "results-grid", "webview", "driver"],
        needsSql: true,
        estMs: 4000,
        metrics: [
            WALLCLOCK,
            {
                name: "mssql.query.toComplete",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.query.submit",
                endMarker: "mssql.query.complete",
            },
            {
                name: "mssql.query.toRender",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.query.submit",
                endMarker: "mssql.resultsGrid.renderComplete",
            },
        ],
        spec: {
            scenarioId: "selftest-query-1k",
            displayName: "Query 1,000 rows",
            setup: [
                { type: "openUntitledSql", content: rowQuery(1000) },
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
                { type: "markerSeen", name: "mssql.query.complete" },
                { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
            ],
        },
    },
    {
        id: "selftest-oe-expand-databases",
        title: "Object Explorer: expand Databases",
        description:
            "Creates an Object Explorer session and expands the Databases node through the real tree provider. Exercises SMO on the STS side — the driver lane shows sts.smo.expand.",
        tags: ["object-explorer", "smo", "driver"],
        needsSql: true,
        estMs: 5000,
        metrics: [
            WALLCLOCK,
            {
                name: "mssql.oe.expand",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.oe.expand.begin",
                endMarker: "mssql.oe.expand.end",
            },
        ],
        spec: {
            scenarioId: "selftest-oe-expand-databases",
            displayName: "Object Explorer: expand Databases",
            // Surface the OE view once so the tree is initialized; the expand
            // itself uses the awaited expandNode API (view-independent).
            setup: [{ type: "command", command: "objectExplorer.focus", timeoutMs: 30000 }],
            measure: {
                start: { type: "beforeFirstAction" },
                action: [
                    {
                        type: "oeExpand",
                        oePath: ["Databases"],
                        profile: "default",
                        // Server-level session: a database-scoped connection
                        // roots at Tables/Views/… and has no Databases folder.
                        oeServerLevel: true,
                        timeoutMs: 60000,
                    },
                ],
                end: { type: "afterLastAction" },
                timeoutMs: 90000,
            },
            success: [{ type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] }],
        },
    },
];

BUILTIN_SCENARIOS.push(
    {
        id: "selftest-table-designer",
        maturity: "diagnostic",
        title: "Table Designer: open (new table)",
        description:
            "Opens the Table Designer for a new table on the connected database via the real OE node path and waits for designer initialization (STS initializeTableDesigner round-trip). The waterfall shows webview + RPC + STS lanes for the designer.",
        tags: ["table-designer", "designer", "webview", "sts"],
        needsSql: true,
        estMs: 5000,
        metrics: [
            WALLCLOCK,
            {
                name: "mssql.tableDesigner.init",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.tableDesigner.init.begin",
                endMarker: "mssql.tableDesigner.init.end",
            },
        ],
        spec: {
            scenarioId: "selftest-table-designer",
            displayName: "Table Designer: open (new table)",
            measure: {
                start: { type: "beforeFirstAction" },
                action: [{ type: "designerOpen", designer: "tableDesigner", timeoutMs: 60000 }],
                end: { type: "waitForMarker", name: "mssql.tableDesigner.init.end" },
                timeoutMs: 90000,
            },
            success: [
                { type: "markerSeen", name: "mssql.tableDesigner.init.end" },
                { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
            ],
            cleanup: [{ type: "command", command: "workbench.action.closeActiveEditor" }],
        },
    },
    {
        id: "selftest-schema-designer",
        maturity: "diagnostic",
        title: "Schema Designer: open",
        description:
            "Opens the Schema Designer (schema visualizer) for the connected database via the real OE node path and waits for the schema session to initialize (model load). Exercises the DacFx-backed schema model path end to end.",
        tags: ["schema-designer", "designer", "webview", "sts", "dacfx"],
        needsSql: true,
        estMs: 8000,
        metrics: [
            WALLCLOCK,
            {
                name: "mssql.schemaDesigner.init",
                official: false,
                lowerIsBetter: true,
                beginMarker: "mssql.schemaDesigner.init.begin",
                endMarker: "mssql.schemaDesigner.init.end",
            },
        ],
        spec: {
            scenarioId: "selftest-schema-designer",
            displayName: "Schema Designer: open",
            measure: {
                start: { type: "beforeFirstAction" },
                action: [{ type: "designerOpen", designer: "schemaDesigner", timeoutMs: 60000 }],
                end: { type: "waitForMarker", name: "mssql.schemaDesigner.init.end" },
                timeoutMs: 120000,
            },
            success: [
                { type: "markerSeen", name: "mssql.schemaDesigner.init.end" },
                { type: "noErrors", sources: ["automation", "vscode-mssql", "sts"] },
            ],
            cleanup: [{ type: "command", command: "workbench.action.closeActiveEditor" }],
        },
    },
);

export function builtinScenario(id: string): BuiltinScenario | undefined {
    return BUILTIN_SCENARIOS.find((s) => s.id === id);
}
