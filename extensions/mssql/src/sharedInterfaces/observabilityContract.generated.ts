/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * GENERATED — do not edit. Source of truth:
 * perftest/packages/observability-contracts (npm run generate, then vendor).
 * Registry obs-contract/1.
 */

/* eslint-disable */

export type TimingClass = "sameProcessMonotonic" | "epochAligned" | "derived";
export type EventKind = "marker" | "webviewMark" | "event" | "metric" | "richMetric" | "spanFamily";
export type MarkerPhase = "begin" | "end" | "instant";
export interface EventTypeEntry {
    name?: string;
    prefix?: string;
    kind: EventKind;
    phase?: MarkerPhase;
    pairsWith?: string;
    feature: string;
    processRoles: string[];
    timingClass: TimingClass;
    measurementEligible: boolean;
    attrs: Record<string, string>;
    attrsComplete: boolean;
    notes?: string;
    deprecated?: boolean;
}
export interface MetricNameEntry {
    name: string;
    feature: string;
    derivedFrom: string[];
}
export interface Registry {
    schemaVersion: string;
    events: EventTypeEntry[];
    metrics: MetricNameEntry[];
    classifications: Record<string, { examples: string[]; defaultBehavior: string }>;
    timingClasses: Record<string, { meaning: string; rendering: string; eligibility: string }>;
}

export const OBS_CONTRACT: Registry = {
    schemaVersion: "obs-contract/1",
    events: [
        {
            name: "mssql.activate.begin",
            kind: "marker",
            phase: "begin",
            pairsWith: "mssql.activate.end",
            feature: "activation",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {},
            attrsComplete: false,
        },
        {
            name: "mssql.activate.end",
            kind: "marker",
            phase: "end",
            pairsWith: "mssql.activate.begin",
            feature: "activation",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {},
            attrsComplete: false,
        },
        {
            name: "mssql.command.invoked",
            kind: "marker",
            phase: "instant",
            feature: "shell",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {
                commandId: "structuralMetadata",
            },
            attrsComplete: false,
            notes: "Root-action anchor for traces; not a timing endpoint by itself.",
        },
        {
            name: "mssql.connection.begin",
            kind: "marker",
            phase: "begin",
            pairsWith: "mssql.connection.ready",
            feature: "connection",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {},
            attrsComplete: false,
        },
        {
            name: "mssql.connection.ready",
            kind: "marker",
            phase: "end",
            pairsWith: "mssql.connection.begin",
            feature: "connection",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {},
            attrsComplete: false,
        },
        {
            name: "mssql.connection.failed",
            kind: "marker",
            phase: "instant",
            feature: "connection",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {
                reason: "safeEnum",
            },
            attrsComplete: false,
            notes: "Failure instant — invalidates the connection pair, never a fabricated duration.",
        },
        {
            name: "mssql.query.submit",
            kind: "marker",
            phase: "begin",
            pairsWith: "mssql.query.complete",
            feature: "query",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {},
            attrsComplete: false,
        },
        {
            name: "mssql.query.complete",
            kind: "marker",
            phase: "end",
            pairsWith: "mssql.query.submit",
            feature: "query",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {
                rowCount: "structuralMetadata",
                hasError: "structuralMetadata",
            },
            attrsComplete: false,
        },
        {
            name: "mssql.query.cancelRequested",
            kind: "marker",
            phase: "instant",
            feature: "query",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {},
            attrsComplete: false,
        },
        {
            name: "mssql.query.cancelled",
            kind: "marker",
            phase: "instant",
            feature: "query",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {},
            attrsComplete: false,
        },
        {
            name: "mssql.query.cancelFailed",
            kind: "marker",
            phase: "instant",
            feature: "query",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {
                reason: "safeEnum",
            },
            attrsComplete: false,
        },
        {
            name: "mssql.resultsGrid.windowFetch.begin",
            kind: "marker",
            phase: "begin",
            pairsWith: "mssql.resultsGrid.windowFetch.end",
            feature: "resultsGrid",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {},
            attrsComplete: false,
        },
        {
            name: "mssql.resultsGrid.windowFetch.end",
            kind: "marker",
            phase: "end",
            pairsWith: "mssql.resultsGrid.windowFetch.begin",
            feature: "resultsGrid",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {
                rowStart: "structuralMetadata",
                rowCount: "structuralMetadata",
            },
            attrsComplete: false,
        },
        {
            name: "mssql.resultsGrid.dataReceived",
            kind: "marker",
            phase: "instant",
            feature: "resultsGrid",
            processRoles: ["webview"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {},
            attrsComplete: false,
        },
        {
            name: "mssql.resultsGrid.renderComplete",
            kind: "webviewMark",
            phase: "instant",
            feature: "resultsGrid",
            processRoles: ["webview"],
            timingClass: "epochAligned",
            measurementEligible: true,
            attrs: {
                rowCount: "structuralMetadata",
            },
            attrsComplete: false,
            notes: "Cross-process endpoint (webview paint after extension-host submit). Measurement-eligible via the harness's calibrated clock model ONLY (perftest calibrates webview clocks per run); epoch-aligned/diagnostic everywhere else.",
        },
        {
            name: "mssql.sts.spawn.begin",
            kind: "marker",
            phase: "begin",
            pairsWith: "mssql.sts.spawn.end",
            feature: "stsLifecycle",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {},
            attrsComplete: false,
        },
        {
            name: "mssql.sts.spawn.end",
            kind: "marker",
            phase: "end",
            pairsWith: "mssql.sts.spawn.begin",
            feature: "stsLifecycle",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {},
            attrsComplete: false,
        },
        {
            name: "mssql.sts.ready",
            kind: "marker",
            phase: "instant",
            feature: "stsLifecycle",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {},
            attrsComplete: false,
        },
        {
            name: "mssql.sts.pid",
            kind: "event",
            phase: "instant",
            feature: "stsLifecycle",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {
                pid: "structuralMetadata",
            },
            attrsComplete: false,
        },
        {
            name: "mssql.oe.expand.begin",
            kind: "marker",
            phase: "begin",
            pairsWith: "mssql.oe.expand.end",
            feature: "objectExplorer",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {},
            attrsComplete: false,
        },
        {
            name: "mssql.oe.expand.end",
            kind: "marker",
            phase: "end",
            pairsWith: "mssql.oe.expand.begin",
            feature: "objectExplorer",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {
                childCount: "structuralMetadata",
                nodeType: "structuralMetadata",
            },
            attrsComplete: false,
        },
        {
            name: "mssql.tableDesigner.init.begin",
            kind: "marker",
            phase: "begin",
            pairsWith: "mssql.tableDesigner.init.end",
            feature: "tableDesigner",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {
                isEdit: "structuralMetadata",
            },
            attrsComplete: false,
        },
        {
            name: "mssql.tableDesigner.init.end",
            kind: "marker",
            phase: "end",
            pairsWith: "mssql.tableDesigner.init.begin",
            feature: "tableDesigner",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {
                error: "structuralMetadata",
                reason: "safeEnum",
            },
            attrsComplete: false,
        },
        {
            name: "mssql.tableDesigner.publish.begin",
            kind: "marker",
            phase: "begin",
            pairsWith: "mssql.tableDesigner.publish.end",
            feature: "tableDesigner",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {},
            attrsComplete: false,
        },
        {
            name: "mssql.tableDesigner.publish.end",
            kind: "marker",
            phase: "end",
            pairsWith: "mssql.tableDesigner.publish.begin",
            feature: "tableDesigner",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {
                error: "structuralMetadata",
                reason: "safeEnum",
            },
            attrsComplete: false,
        },
        {
            name: "mssql.schemaDesigner.init.begin",
            kind: "marker",
            phase: "begin",
            pairsWith: "mssql.schemaDesigner.init.end",
            feature: "schemaDesigner",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {},
            attrsComplete: false,
        },
        {
            name: "mssql.schemaDesigner.init.end",
            kind: "marker",
            phase: "end",
            pairsWith: "mssql.schemaDesigner.init.begin",
            feature: "schemaDesigner",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {
                tableCount: "structuralMetadata",
                error: "structuralMetadata",
                reason: "safeEnum",
            },
            attrsComplete: false,
        },
        {
            name: "mssql.schemaCompare.compare.begin",
            kind: "marker",
            phase: "begin",
            pairsWith: "mssql.schemaCompare.compare.end",
            feature: "schemaCompare",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {},
            attrsComplete: false,
        },
        {
            name: "mssql.schemaCompare.compare.end",
            kind: "marker",
            phase: "end",
            pairsWith: "mssql.schemaCompare.compare.begin",
            feature: "schemaCompare",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {
                differences: "structuralMetadata",
                error: "structuralMetadata",
            },
            attrsComplete: false,
        },
        {
            name: "scenario.start",
            kind: "marker",
            phase: "begin",
            pairsWith: "scenario.end",
            feature: "harness",
            processRoles: ["harness", "extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {
                scenarioId: "structuralMetadata",
            },
            attrsComplete: false,
        },
        {
            name: "scenario.end",
            kind: "marker",
            phase: "end",
            pairsWith: "scenario.start",
            feature: "harness",
            processRoles: ["harness", "extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {
                status: "safeEnum",
            },
            attrsComplete: false,
        },
        {
            name: "system.rich.snapshot",
            kind: "richMetric",
            phase: "instant",
            feature: "diagnostics",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {
                heapUsedMB: "diagnosticMetric",
                rssMB: "diagnosticMetric",
                eventLoopP95Ms: "diagnosticMetric",
                cpuUserMs: "diagnosticMetric",
                cpuSystemMs: "diagnosticMetric",
            },
            attrsComplete: false,
            notes: "Rich collection output. Its PRESENCE marks the rep diagnostic-only.",
        },
        {
            name: "sessionDiag.enabled",
            kind: "event",
            phase: "instant",
            feature: "diagnostics",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {
                captureMode: "safeEnum",
            },
            attrsComplete: false,
        },
        {
            name: "sessionDiag.disabled",
            kind: "event",
            phase: "instant",
            feature: "diagnostics",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {},
            attrsComplete: false,
        },
        {
            name: "sessionDiag.elevated",
            kind: "event",
            phase: "instant",
            feature: "diagnostics",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {
                durationMinutes: "structuralMetadata",
            },
            attrsComplete: false,
            notes: "Elevation reason is user free text — classified identifierSensitive and stored only in the local audit record, never forwarded.",
        },
        {
            name: "sessionDiag.elevation.expired",
            kind: "event",
            phase: "instant",
            feature: "diagnostics",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {},
            attrsComplete: false,
        },
        {
            name: "selfTest.run.end",
            kind: "event",
            phase: "instant",
            feature: "selfTest",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {
                runStatus: "safeEnum",
                passed: "structuralMetadata",
                failed: "structuralMetadata",
            },
            attrsComplete: false,
        },
        {
            prefix: "rpc.",
            kind: "spanFamily",
            feature: "rpc",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {},
            attrsComplete: false,
            notes: "Client-observed JSON-RPC round-trips (rpc.<method>[.begin|.end]). Same-process timing but diagnostic by policy — they explain, they do not gate.",
        },
        {
            prefix: "webview.",
            kind: "spanFamily",
            feature: "webviewRpc",
            processRoles: ["extensionHost", "webview"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {},
            attrsComplete: false,
            notes: "Webview controller RPC spans (webview.<controller>.<op>). Console-viewer spans additionally carry the viewerInternal tag and are excluded from product analysis.",
        },
        {
            prefix: "sts.dispatch.",
            kind: "spanFamily",
            feature: "stsDispatcher",
            processRoles: ["sqlToolsService"],
            timingClass: "epochAligned",
            measurementEligible: false,
            attrs: {},
            attrsComplete: false,
            notes: "Every STS JSON-RPC handler execution (sts.dispatch.<method>). Protocol metadata only.",
        },
        {
            prefix: "sts.sql.",
            kind: "spanFamily",
            feature: "sqlDriver",
            processRoles: ["sqlToolsService"],
            timingClass: "epochAligned",
            measurementEligible: false,
            attrs: {},
            attrsComplete: false,
            notes: "Known members: sts.sql.executeReader, sts.sql.connectionOpen.",
        },
        {
            prefix: "sts.smo.",
            kind: "spanFamily",
            feature: "objectExplorer",
            processRoles: ["sqlToolsService"],
            timingClass: "epochAligned",
            measurementEligible: false,
            attrs: {},
            attrsComplete: false,
            notes: "Known members: sts.smo.expand, sts.smo.refresh.",
        },
        {
            prefix: "sts.dacfx.",
            kind: "spanFamily",
            feature: "dacfx",
            processRoles: ["sqlToolsService"],
            timingClass: "epochAligned",
            measurementEligible: false,
            attrs: {},
            attrsComplete: false,
            notes: "DacFxService operations (sts.dacfx.<OperationType>) AND designer DesignServices work (sts.dacfx.tableDesigner.*, sts.dacfx.schemaDesigner.*).",
        },
        {
            name: "import.linesSkipped",
            kind: "event",
            phase: "instant",
            feature: "harness",
            processRoles: ["system"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {
                skipped: "structuralMetadata",
                reason: "safeEnum",
            },
            attrsComplete: true,
            notes: "Synthetic import-loss record: how many markers.jsonl lines were refused (malformed/oversized) so imported traces never silently under-report.",
        },
        {
            name: "mssql.queryStudio.open.begin",
            kind: "marker",
            phase: "begin",
            pairsWith: "mssql.queryStudio.open.end",
            feature: "queryStudio",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {},
            attrsComplete: false,
        },
        {
            name: "mssql.queryStudio.open.end",
            kind: "marker",
            phase: "end",
            pairsWith: "mssql.queryStudio.open.begin",
            feature: "queryStudio",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {
                fromCache: "structuralMetadata",
                monacoMs: "structuralMetadata",
            },
            attrsComplete: false,
        },
        {
            name: "mssql.queryStudio.connect.begin",
            kind: "marker",
            phase: "begin",
            pairsWith: "mssql.queryStudio.connect.ready",
            feature: "queryStudio",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {},
            attrsComplete: false,
        },
        {
            name: "mssql.queryStudio.connect.ready",
            kind: "marker",
            phase: "end",
            pairsWith: "mssql.queryStudio.connect.begin",
            feature: "queryStudio",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {
                backend: "structuralMetadata",
                authKind: "safeEnum",
                encrypted: "structuralMetadata",
                metadataSession: "structuralMetadata",
                error: "structuralMetadata",
                reason: "safeEnum",
            },
            attrsComplete: false,
            notes: "Failure emits connect.ready with error+reason (addendum 3.5); no third phase.",
        },
        {
            name: "mssql.queryStudio.query.submit",
            kind: "marker",
            phase: "begin",
            pairsWith: "mssql.queryStudio.query.complete",
            feature: "queryStudio",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {
                scope: "safeEnum",
                batchCount: "structuralMetadata",
                selection: "structuralMetadata",
            },
            attrsComplete: false,
        },
        {
            name: "mssql.queryStudio.query.complete",
            kind: "marker",
            phase: "end",
            pairsWith: "mssql.queryStudio.query.submit",
            feature: "queryStudio",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {
                batches: "structuralMetadata",
                resultSets: "structuralMetadata",
                rows: "structuralMetadata",
                errors: "structuralMetadata",
                canceled: "structuralMetadata",
                partial: "structuralMetadata",
                bytes: "structuralMetadata",
            },
            attrsComplete: false,
            notes: "Design 17.1 named this query.execute begin/end; frozen as submit/complete to mirror the classic query pair convention.",
        },
        {
            name: "mssql.queryStudio.query.firstResult",
            kind: "marker",
            phase: "instant",
            feature: "queryStudio",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {
                msFromSubmit: "structuralMetadata",
            },
            attrsComplete: false,
        },
        {
            name: "mssql.queryStudio.resultsRendered",
            kind: "webviewMark",
            phase: "instant",
            feature: "queryStudio",
            processRoles: ["webview"],
            timingClass: "epochAligned",
            measurementEligible: true,
            attrs: {
                rows: "structuralMetadata",
                resultSets: "structuralMetadata",
                partial: "structuralMetadata",
                fromSpill: "structuralMetadata",
            },
            attrsComplete: false,
            notes: "Semantic end of the user-perceived query; measurement-eligible via the harness calibrated plane only (same rule as classic renderComplete).",
        },
        {
            name: "mssql.queryStudio.rows.windowFetch.begin",
            kind: "marker",
            phase: "begin",
            pairsWith: "mssql.queryStudio.rows.windowFetch.end",
            feature: "queryStudio",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {},
            attrsComplete: false,
        },
        {
            name: "mssql.queryStudio.rows.windowFetch.end",
            kind: "marker",
            phase: "end",
            pairsWith: "mssql.queryStudio.rows.windowFetch.begin",
            feature: "queryStudio",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {
                resultSetId: "structuralMetadata",
                start: "structuralMetadata",
                count: "structuralMetadata",
                fromSpill: "structuralMetadata",
            },
            attrsComplete: false,
        },
        {
            name: "mssql.queryStudio.cancel",
            kind: "marker",
            phase: "instant",
            feature: "queryStudio",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {
                msToAck: "structuralMetadata",
                msToTerminal: "structuralMetadata",
            },
            attrsComplete: false,
        },
        {
            prefix: "queryStudio.sync.",
            kind: "spanFamily",
            feature: "queryStudio",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {},
            attrsComplete: false,
            notes: "Text-sync spans (applyEdit, resync) — diagnostic; resync count must be zero in dogfood.",
        },
        {
            prefix: "queryStudio.lsp.",
            kind: "spanFamily",
            feature: "queryStudio",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {},
            attrsComplete: false,
        },
        {
            prefix: "sqlDataPlane.",
            kind: "spanFamily",
            feature: "sqlDataPlane",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {},
            attrsComplete: false,
            notes: "Adapter spans/metrics (openSession, execute, page, queueWait, creditStallMs, protocolViolation, deadline) — doc 03 §15.1; metadata only.",
        },
        {
            prefix: "rpc.v2.",
            kind: "spanFamily",
            feature: "sqlDataPlane",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {},
            attrsComplete: false,
            notes: "STS2 wire request spans from the client binding.",
        },
        {
            prefix: "metadata.",
            kind: "spanFamily",
            feature: "metadata",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {},
            attrsComplete: false,
            notes: "MetadataService spans/events (metadata.hydrate, metadata.contextBuild, metadata.drift; cache/drift design adds metadata.ensureFresh + metadata.validate — attrs mode/reason/freshness/tier/result as safe enums, waitedMs/durationMs as diagnostic.metric). Database/object names are metadata — classified (source.path), never plaintext under redacted capture. No SQL text beyond the fixed hydration scripts' identifiers.",
        },
        {
            prefix: "completions.",
            kind: "spanFamily",
            feature: "completions",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {},
            attrsComplete: false,
            notes: "Inline-completion pipeline spans/events (completions.request span; completions.stage instants). Covers BOTH surfaces (classic editor + Query Studio) via a surface attr. Prompt text, document text, and schema-context text NEVER ride these events — rich capture lives in the gated feature trace store, not the diag substrate.",
        },
        {
            prefix: "queryStudio.inlineCompletion.",
            kind: "spanFamily",
            feature: "queryStudio",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {},
            attrsComplete: false,
            notes: "Query Studio Monaco bridge spans (queryStudio.inlineCompletion.bridge = webview RPC round-trip + provider call). Design 04 §17.1 span; bridge overhead target <=10ms over the bare provider call.",
        },
        {
            prefix: "replay.",
            kind: "spanFamily",
            feature: "replay",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {},
            attrsComplete: false,
            notes: "Generic replay-engine lifecycle (replay.run span, replay.item span) emitted by the core feature-capture framework for ANY feature's replay (completions, Query Studio runs). Items carry replayTraceId/replayRunId/replaySourceEventId (+matrix cell) as fields; replayed work re-emits its ordinary feature events tagged the same way.",
        },
        {
            prefix: "sqlLanguage.",
            kind: "spanFamily",
            feature: "sqlLanguage",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {},
            attrsComplete: false,
            notes: "Native T-SQL language service spans/events (sqlLanguage.lex/segment/parse/overlay/bind/completion/hover/signature/diagnostics/semanticTokens/definition). PRIVACY: no document text, no user-written identifiers, no literal values EVER — counts, kinds, durations, context kinds, readiness states, suppression-reason counts, provider generation, cache hit/miss, size buckets only (language-service design 05 §18.1).",
        },
        {
            prefix: "sqlScripting.",
            kind: "spanFamily",
            feature: "sqlLanguage",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {},
            attrsComplete: false,
            notes: "TypeScript scripting engine spans (sqlScripting.script). Object kind, operation, fidelity level, anchor count, duration — never generated script text or object names (design 05 §18.1).",
        },
        {
            prefix: "queryStudio.languageService.",
            kind: "spanFamily",
            feature: "queryStudio",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {},
            attrsComplete: false,
            notes: "Query Studio language-feature routing spans (queryStudio.languageService.route = per-request engine selection + result; queryStudio.languageService.bridge = STS v1 provider-command bridge call). Attrs: feature name, engine (nativeTypeScript|sqlToolsServiceBridge), maturity, circuit-break state — no text.",
        },
        {
            name: "settings.snapshot",
            kind: "event",
            phase: "instant",
            feature: "diagnostics",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {
                settingsFeature: "safeEnum",
                keyCount: "structuralMetadata",
            },
            attrsComplete: false,
            notes: "Effective-settings snapshot (kind:state) for a feature's config surface, emitted on capture arm and on demand. Values pass classify(); secret-bearing settings are never plaintext regardless of capture mode.",
        },
        {
            name: "settings.changed",
            kind: "event",
            phase: "instant",
            feature: "diagnostics",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {
                settingsFeature: "safeEnum",
                keyCount: "structuralMetadata",
            },
            attrsComplete: false,
            notes: "Delta re-snapshot when a watched feature's configuration changes while capture is active. Same classification rules as settings.snapshot.",
        },
        {
            name: "queryStudio.runRecord.captured",
            kind: "event",
            phase: "instant",
            feature: "queryStudio",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {
                batches: "structuralMetadata",
                resultSets: "structuralMetadata",
                elevated: "structuralMetadata",
                replay: "structuralMetadata",
            },
            attrsComplete: false,
            notes: "A QsRunRecord was captured for a Query Studio execution (design 04 §17.2). The record itself lives in the feature trace store; SQL text is digest-only unless elevated capture was active at record time.",
        },
        {
            prefix: "metadataStore.",
            kind: "spanFamily",
            feature: "metadata",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {},
            attrsComplete: false,
            notes: "Shared MetadataStore spans/events (oe-docs metadata_service_oe_v2_design §13): metadataStore.prepareProfile, .acquireServer, .acquireDatabase, .acquireObjectDetails, .refresh, .disposeLease, .session.open/.close, .hydrate.server/.database/.objectDetails, .drift.detected, .cache.hit/.miss, .keyCorrectness.violation. Attrs: key kind, SHORT profile fingerprint, section names, readiness state, generation, counts, duration, backend kind, error class. PRIVACY: no SQL text, rows, connection strings, secrets, raw endpoints, or unclassified object/database names — database rides as source.path classification like metadata.* today.",
        },
        {
            prefix: "metadataCache.",
            kind: "spanFamily",
            feature: "metadata",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {},
            attrsComplete: false,
            notes: "Persistent metadata snapshot cache + freshness policy (metadata-docs cache/drift design §18, review addendum §8/App C): metadataCache.load/.save/.hit/.miss/.validate/.policyDecision/.backgroundRefresh/.evict/.corrupt/.clear/.offlineMode/.raceLost. Attr allowlist: serverFpPrefix + dbHashPrefix (diagnostic.metadata — non-reversible HASH prefixes, never names), generation, readinessSummary, staleAgeBucket (fixed buckets <1m,<10m,<1h,<1d,<7d,<30d,>=30d), payloadBytes/durationMs/waitedMs (diagnostic.metric), mode/reason/source/freshness/tier/result/errorClass/skipped/policyIntersected/raceLost (safe enums/bools). FORBIDDEN: object names, raw database names, SQL text, result rows, endpoints, connection strings, secrets/tokens, prompt text, module definitions, description values. contentHash prefix stays OUT of events pending review (addendum §12 Q2) — snapshot status/feature-capture only.",
        },
        {
            name: "mssql.metadata.cache.warmAcquire.begin",
            kind: "marker",
            phase: "begin",
            pairsWith: "mssql.metadata.cache.warmAcquire.end",
            feature: "metadata",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {},
            attrsComplete: false,
            notes: "PERF_MODE probe (mssql.perf.metadataCacheWarmAcquire): wraps a fresh-store acquire that MUST be served from the persistent disk cache (store.status().source === 'disk' asserted; throws on honesty failure). Measures disk load + publish + freshness decision — the executable form of the cache-load budget (metadata-docs cache design §20).",
        },
        {
            name: "mssql.metadata.cache.warmAcquire.end",
            kind: "marker",
            phase: "end",
            pairsWith: "mssql.metadata.cache.warmAcquire.begin",
            feature: "metadata",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: true,
            attrs: {
                objects: "structuralMetadata",
                waitedMs: "structuralMetadata",
            },
            attrsComplete: false,
        },
        {
            prefix: "objectExplorerV2.",
            kind: "spanFamily",
            feature: "objectExplorer",
            processRoles: ["extensionHost"],
            timingClass: "sameProcessMonotonic",
            measurementEligible: false,
            attrs: {},
            attrsComplete: false,
            notes: "Object Explorer v2 spans/events (oe-docs oe_view_design §14.1): objectExplorerV2.view.activate, .connection.open/.close/.lost, .serverCatalog.acquire/.refresh, .databaseCatalog.acquire/.refresh, .tree.expand/.filter/.search, .command.route/.native/.handoff, .legacyConnection.created, .unsupported, .noV1Browse.violation. Attrs: view mode, data-plane backend kind, node kind, folder kind, readiness state, generation, object/filter counts, duration, result status, command route (native|handoff|hidden|unavailable), handoff level (h1|h2|h3), unsupported reason, short profile fingerprint. PRIVACY: never full node paths (path KIND only), never object names, never SQL text or endpoints. The noV1Browse.violation event is the architecture tripwire — any emission is a test failure.",
        },
    ],
    metrics: [
        {
            name: "scenario.wallclock",
            feature: "harness",
            derivedFrom: ["scenario.start", "scenario.end"],
        },
        {
            name: "mssql.connection",
            feature: "connection",
            derivedFrom: ["mssql.connection.begin", "mssql.connection.ready"],
        },
        {
            name: "mssql.query.toComplete",
            feature: "query",
            derivedFrom: ["mssql.query.submit", "mssql.query.complete"],
        },
        {
            name: "mssql.query.toRender",
            feature: "resultsGrid",
            derivedFrom: ["mssql.query.submit", "mssql.resultsGrid.renderComplete"],
        },
        {
            name: "mssql.oe.expand",
            feature: "objectExplorer",
            derivedFrom: ["mssql.oe.expand.begin", "mssql.oe.expand.end"],
        },
        {
            name: "mssql.tableDesigner.init",
            feature: "tableDesigner",
            derivedFrom: ["mssql.tableDesigner.init.begin", "mssql.tableDesigner.init.end"],
        },
        {
            name: "mssql.schemaDesigner.init",
            feature: "schemaDesigner",
            derivedFrom: ["mssql.schemaDesigner.init.begin", "mssql.schemaDesigner.init.end"],
        },
        {
            name: "mssql.queryStudio.open",
            feature: "queryStudio",
            derivedFrom: ["mssql.queryStudio.open.begin", "mssql.queryStudio.open.end"],
        },
        {
            name: "mssql.queryStudio.connect",
            feature: "queryStudio",
            derivedFrom: ["mssql.queryStudio.connect.begin", "mssql.queryStudio.connect.ready"],
        },
        {
            name: "mssql.queryStudio.query.toComplete",
            feature: "queryStudio",
            derivedFrom: ["mssql.queryStudio.query.submit", "mssql.queryStudio.query.complete"],
        },
        {
            name: "mssql.queryStudio.query.toRender",
            feature: "queryStudio",
            derivedFrom: ["mssql.queryStudio.query.submit", "mssql.queryStudio.resultsRendered"],
        },
    ],
    classifications: {
        secret: {
            examples: ["passwords", "tokens", "connection strings"],
            defaultBehavior:
                "never stored, never displayed, never exported — regardless of capture mode",
        },
        userSql: {
            examples: ["SQL text", "batch fragments"],
            defaultBehavior:
                "digest by default; plaintext only under governed elevated capture, local-only",
        },
        resultData: {
            examples: ["row cells", "grid contents"],
            defaultBehavior: "never captured by default; digest/governed only",
        },
        providerText: {
            examples: ["SQL Server messages", "exception text"],
            defaultBehavior:
                "sanitized safe code/enum by default — provider messages can embed SQL text and values and get NO error-string loophole",
        },
        identifierSensitive: {
            examples: ["server/database/object names", "file paths"],
            defaultBehavior: "digest or redact unless explicitly safe",
        },
        structuralMetadata: {
            examples: ["row counts", "durations", "method names", "statuses"],
            defaultBehavior: "stored normally",
        },
        diagnosticMetric: {
            examples: ["heap bytes", "CPU deltas", "queue depth"],
            defaultBehavior: "stored normally, bounded labels",
        },
        safeEnum: {
            examples: ["failure reason codes", "phase names", "verdicts"],
            defaultBehavior: "stored normally — MUST be a closed enum, never free text",
        },
    },
    timingClasses: {
        sameProcessMonotonic: {
            meaning: "Both endpoints from one process's monotonic clock.",
            rendering: "solid bar",
            eligibility: "may feed measurement-eligible metrics",
        },
        epochAligned: {
            meaning:
                "Endpoints aligned by wall clock across processes (e.g. STS spans in an extension-anchored waterfall).",
            rendering: "hatched bar, labeled 'aligned diagnostic'",
            eligibility: "diagnostic-only, always",
        },
        derived: {
            meaning: "Computed from other metrics via a declared derivation formula.",
            rendering: "table value with derivation provenance",
            eligibility: "inherits the weakest input plane; requires a derivation block",
        },
    },
};

export function loadRegistry(): Registry {
    return OBS_CONTRACT;
}

// Name validation

export interface NameMatch {
    known: boolean;
    matchedBy?: "exact" | "prefix";
    entry?: EventTypeEntry;
}

/**
 * Resolve an emitted event/marker name against the registry. Span-family
 * members may carry `.begin`/`.end` phase suffixes (rpc.x/y.begin) — the
 * family prefix match covers them.
 */
export function explainEventName(name: string, registry?: Registry): NameMatch {
    const reg = registry ?? OBS_CONTRACT;
    const exact = reg.events.find((e) => e.name === name);
    if (exact) {
        return { known: true, matchedBy: "exact", entry: exact };
    }
    let best: EventTypeEntry | undefined;
    for (const entry of reg.events) {
        if (entry.prefix && name.startsWith(entry.prefix)) {
            if (!best || entry.prefix.length > (best.prefix?.length ?? 0)) {
                best = entry;
            }
        }
    }
    if (best) {
        return { known: true, matchedBy: "prefix", entry: best };
    }
    return { known: false };
}

export function isKnownMetricName(name: string, registry?: Registry): boolean {
    const reg = registry ?? OBS_CONTRACT;
    return reg.metrics.some((m) => m.name === name);
}

// Metric eligibility — the decision object that replaces overloaded
// `official`. Carried with every metric; rendered wherever the number is.

export type MetricEnvironment = "controlledHarness" | "interactiveHost" | "unknown";
export type TimePlane = "monotonic" | "epoch" | "calibrated" | "derived";
export type EligibilityPassType = "measurement" | "diagnostic" | "calibration";

export interface MetricEligibility {
    /** Derived from approved marker/product-timer sources under timing rules. */
    measurementEligible: boolean;
    /** Measurement-eligible AND produced in a controlled harness environment. */
    ciGatingEligible: boolean;
    /** Measurement-eligible but from an interactive host (self-test): useful, never a gate. */
    exploratory: boolean;
    /** Not measurement-eligible: collectors, epoch alignment, rich collection, diagnostic pass. */
    diagnosticOnly: boolean;
    timePlane: TimePlane;
    source: string;
    passType: EligibilityPassType;
    environment: MetricEnvironment;
    /** Machine-assembled explanation of the deciding factors. */
    reason: string;
}

export interface EligibilityInput {
    /** Metric source id (perftest MetricSource or equivalent). */
    source: string;
    passType: EligibilityPassType;
    environment: MetricEnvironment;
    timePlane: TimePlane;
    repStatus: "passed" | "failed" | "invalid" | "aborted";
    /** Rich collection active during the rep ⇒ diagnostic-only, always. */
    richCollection: boolean;
    /** Produced by a diagnostic collector ⇒ diagnostic-only, always. */
    fromCollector?: boolean;
    /**
     * Derived metrics (source "derived") are measurement-capable ONLY when a
     * derivation block declares formula + inputs (peer-review rule: derived
     * inherits the weakest input plane and requires provenance).
     */
    hasDerivation?: boolean;
}

const MEASUREMENT_SOURCES = new Set(["marker", "productTimer", "manual"]);

/**
 * The single shared eligibility decision. perftest's normalizer and the
 * in-proc self-test both call this so the rules cannot drift.
 *
 * Honesty rules (design §12.2 + peer-review terminology split):
 *  - only marker/product-timer sources can be measurement-eligible;
 *  - epoch-aligned durations are diagnostic-only ("calibrated" is reserved
 *    for the harness's clock-calibrated cross-process plane);
 *  - diagnostic/calibration passes never produce measurement metrics;
 *  - rich collection or collector provenance forces diagnostic-only;
 *  - only passed reps measure anything;
 *  - CI gating additionally requires the controlled harness environment;
 *  - an interactive host yields exploratory, never gating.
 */
export function deriveEligibility(input: EligibilityInput): MetricEligibility {
    const reasons: string[] = [];
    let measurement = true;

    const derivedWithProvenance = input.source === "derived" && input.hasDerivation === true;
    if (!MEASUREMENT_SOURCES.has(input.source) && !derivedWithProvenance) {
        measurement = false;
        reasons.push(
            input.source === "derived"
                ? "derived metric without a derivation block"
                : `source '${input.source}' is diagnostic`,
        );
    }
    if (input.timePlane === "epoch") {
        measurement = false;
        reasons.push("epoch-aligned timing is diagnostic-only");
    }
    if (input.passType !== "measurement") {
        measurement = false;
        reasons.push(`${input.passType} pass`);
    }
    if (input.repStatus !== "passed") {
        measurement = false;
        reasons.push(`rep ${input.repStatus}`);
    }
    if (input.richCollection) {
        measurement = false;
        reasons.push("rich collection was active");
    }
    if (input.fromCollector) {
        measurement = false;
        reasons.push("collector-produced");
    }

    if (measurement) {
        reasons.push(
            input.timePlane === "monotonic"
                ? `same-process monotonic from source '${input.source}'`
                : `${input.timePlane} plane from source '${input.source}'`,
        );
    }

    const ciGating = measurement && input.environment === "controlledHarness";
    const exploratory = measurement && input.environment === "interactiveHost";
    if (measurement && !ciGating) {
        reasons.push(
            input.environment === "interactiveHost"
                ? "interactive host — exploratory, never a gate"
                : "environment unknown — not gate-eligible",
        );
    }

    return {
        measurementEligible: measurement,
        ciGatingEligible: ciGating,
        exploratory,
        diagnosticOnly: !measurement,
        timePlane: input.timePlane,
        source: input.source,
        passType: input.passType,
        environment: input.environment,
        reason: reasons.join("; "),
    };
}

// Trace Identity V1 — the cross-repo correlation contract. Identities can be
// partial, but partial must be VISIBLE: the linter below reports fog instead
// of letting views draw invented roads.

/**
 * The identity fields a fully-stitched event may carry. Every field is
 * optional — the contract is about MEANING and propagation, not presence.
 */
export interface TraceIdentityV1 {
    /** perftest / self-test run id (absent for plain product sessions). */
    runId?: string;
    repId?: number;
    scenarioId?: string;
    /** Root user action / scenario action. Closes on TTL or explicit end. */
    rootActionId?: string;
    /** Cross-process trace id (the console's trace grouping key). */
    traceId?: string;
    spanId?: string;
    /** JSON-RPC id crossing extension → STS. A correlation HINT, reused per connection — never globally unique. */
    jsonRpcId?: string;
    /** Request id crossing the webview boundary. */
    webviewRpcId?: string;
    /** Stable safe grouping digests — never raw identifiers. */
    ownerUriDigest?: string;
    connectionIdDigest?: string;
    /** STS2 envelope identities (imported): corr maps here, cause is an EDGE in the cause graph, never a fake span parent. */
    sts2Corr?: string;
    sts2CauseSeq?: number;
}

/** Root actions that stay open longer than this are leaks, not traces. */
export const ROOT_ACTION_TTL_MS = 120_000;

/** Structural event shape the linter needs (DiagEvent satisfies it). */
export interface CorrelationEvent {
    seq: number;
    type: string;
    kind: string;
    epochMs: number;
    process: string;
    traceId?: string;
    durationMs?: number;
    tags?: string[];
}

export interface UnmatchedPair {
    /** Pair or family label, e.g. "mssql.connection.begin↔ready" or "rpc.<method>". */
    name: string;
    begins: number;
    ends: number;
}

export interface CorrelationLintReport {
    totalEvents: number;
    /** mssql.* markers with no trace correlation (excluding lifecycle noise). */
    orphanCount: number;
    orphanRatio: number;
    /** Registry pairs and .begin/.end span families with unequal sides. */
    unmatchedPairs: UnmatchedPair[];
    /** Traces spanning longer than ROOT_ACTION_TTL_MS (leaked roots). */
    longLivedRoots: Array<{ traceId: string; durationMs: number; eventCount: number }>;
    /** Epoch-aligned (cross-process diagnostic) events — rendered hatched, never official. */
    epochAlignedCount: number;
    /** Events before scenario.start or after scenario.end when both exist. */
    outsideScenarioWindow: number;
    /** good = stitched; fair = usable with fog; poor = correlation unreliable. */
    score: "good" | "fair" | "poor";
    /** Human-readable explanations — the "why this looks like this" text. */
    notes: string[];
}

/** Event types that legitimately carry no trace correlation. */
const CORRELATION_EXEMPT =
    /^(sessionDiag\.|system\.|selfTest\.|scenario\.|import\.|mssql\.sts\.pid|mssql\.activate)/;

/**
 * Registry-driven correlation lint. Marker pairing comes from the REGISTRY's
 * explicit pairsWith (begin/ready, submit/complete — never suffix guessing);
 * dynamic span families pair on .begin/.end name suffixes.
 */
export function lintCorrelation(
    events: CorrelationEvent[],
    registry?: Registry,
): CorrelationLintReport {
    const reg = registry ?? OBS_CONTRACT;
    const notes: string[] = [];

    // --- orphans ---------------------------------------------------------
    let correlatable = 0;
    let orphans = 0;
    for (const event of events) {
        if (!event.type.startsWith("mssql.") || CORRELATION_EXEMPT.test(event.type)) {
            continue;
        }
        correlatable++;
        if (!event.traceId) {
            orphans++;
        }
    }
    const orphanRatio = correlatable > 0 ? orphans / correlatable : 0;
    if (orphans > 0) {
        notes.push(
            `${orphans} product marker(s) have no trace correlation — they appear in the Consolidated Trace but join no waterfall`,
        );
    }

    // --- pairs (registry-explicit) ----------------------------------------
    const counts = new Map<string, number>();
    for (const event of events) {
        counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
    }
    const unmatchedPairs: UnmatchedPair[] = [];
    const seenPairs = new Set<string>();
    for (const entry of reg.events) {
        if (!entry.name || !entry.pairsWith || entry.phase !== "begin") {
            continue;
        }
        const pairKey = `${entry.name}|${entry.pairsWith}`;
        if (seenPairs.has(pairKey)) {
            continue;
        }
        seenPairs.add(pairKey);
        const begins = counts.get(entry.name) ?? 0;
        const ends = counts.get(entry.pairsWith) ?? 0;
        if (begins !== ends && (begins > 0 || ends > 0)) {
            unmatchedPairs.push({
                name: `${entry.name} ↔ ${entry.pairsWith}`,
                begins,
                ends,
            });
        }
    }
    // Dynamic span families: rpc./webview./sts. pair on .begin/.end suffix.
    const familyBase = new Map<string, { begins: number; ends: number }>();
    for (const [type, count] of counts) {
        if (!/^(rpc\.|webview\.|sts\.)/.test(type)) {
            continue;
        }
        if (type.endsWith(".begin")) {
            const base = type.slice(0, -".begin".length);
            const row = familyBase.get(base) ?? { begins: 0, ends: 0 };
            row.begins += count;
            familyBase.set(base, row);
        } else if (type.endsWith(".end")) {
            const base = type.slice(0, -".end".length);
            const row = familyBase.get(base) ?? { begins: 0, ends: 0 };
            row.ends += count;
            familyBase.set(base, row);
        }
    }
    for (const [base, row] of familyBase) {
        if (row.begins !== row.ends) {
            unmatchedPairs.push({ name: base, begins: row.begins, ends: row.ends });
        }
    }
    if (unmatchedPairs.length > 0) {
        notes.push(
            `${unmatchedPairs.length} begin/end pair(s) are unbalanced — durations for those operations are absent or partial, never fabricated`,
        );
    }

    // --- long-lived roots --------------------------------------------------
    const traceExtent = new Map<string, { min: number; max: number; count: number }>();
    for (const event of events) {
        if (!event.traceId) {
            continue;
        }
        const extent = traceExtent.get(event.traceId) ?? {
            min: event.epochMs,
            max: event.epochMs,
            count: 0,
        };
        extent.min = Math.min(extent.min, event.epochMs);
        extent.max = Math.max(extent.max, event.epochMs + (event.durationMs ?? 0));
        extent.count++;
        traceExtent.set(event.traceId, extent);
    }
    const longLivedRoots = [...traceExtent.entries()]
        .filter(([, extent]) => extent.max - extent.min > ROOT_ACTION_TTL_MS)
        .map(([traceId, extent]) => ({
            traceId,
            durationMs: extent.max - extent.min,
            eventCount: extent.count,
        }))
        .sort((a, b) => b.durationMs - a.durationMs)
        .slice(0, 10);
    if (longLivedRoots.length > 0) {
        notes.push(
            `${longLivedRoots.length} trace(s) exceed the ${ROOT_ACTION_TTL_MS / 1000}s root-action TTL — later events may be joining a leaked root, widening waterfalls`,
        );
    }

    // --- epoch-aligned + scenario window ------------------------------------
    let epochAlignedCount = 0;
    for (const event of events) {
        if (event.type.startsWith("sts.") || event.tags?.includes("stsDiag")) {
            epochAlignedCount++;
        }
    }
    if (epochAlignedCount > 0) {
        notes.push(
            `${epochAlignedCount} event(s) are epoch-aligned cross-process diagnostics — hatched bars, never official timing`,
        );
    }
    let outsideScenarioWindow = 0;
    const start = events.find((e) => e.type === "scenario.start");
    const end = events.find((e) => e.type === "scenario.end");
    if (start && end) {
        for (const event of events) {
            if (event.epochMs < start.epochMs || event.epochMs > end.epochMs) {
                outsideScenarioWindow++;
            }
        }
        if (outsideScenarioWindow > 0) {
            notes.push(
                `${outsideScenarioWindow} event(s) fall outside the scenario window — setup/teardown noise, excluded from scenario metrics`,
            );
        }
    }

    // --- score --------------------------------------------------------------
    const poor = orphanRatio > 0.5 || unmatchedPairs.length > 5;
    const fair =
        !poor && (orphanRatio > 0.1 || unmatchedPairs.length > 0 || longLivedRoots.length > 0);
    return {
        totalEvents: events.length,
        orphanCount: orphans,
        orphanRatio: Number(orphanRatio.toFixed(3)),
        unmatchedPairs,
        longLivedRoots,
        epochAlignedCount,
        outsideScenarioWindow,
        score: poor ? "poor" : fair ? "fair" : "good",
        notes,
    };
}
