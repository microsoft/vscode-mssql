/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Derived views over diagnostic events: user-action roots, KPIs, anomalies,
 * cause trees, and the cross-process waterfall model. All computation happens
 * extension-side so the webview stays a renderer.
 */

import {
    AnomalySummary,
    CauseTreeNode,
    DiagEvent,
    DiagStatus,
    GapRecord,
    SourceKpis,
    SqlActivityRow,
    UserActionSummary,
    WaterfallActivity,
    WaterfallModel,
} from "../sharedInterfaces/debugConsole";

/** Root-action event types → human labels (correlation roots for Overview). */
const ROOT_LABELS: Array<{ match: RegExp; label: (e: DiagEvent) => string; feature: string }> = [
    { match: /^command\.mssql\.runQuery\.begin$/, label: () => "Run query", feature: "query" },
    { match: /^mssql\.query\.submit$/, label: () => "Run query", feature: "query" },
    {
        match: /^mssql\.connection\.begin$/,
        label: () => "Connect",
        feature: "connection",
    },
    {
        match: /^mssql\.oe\.expand\.begin$/,
        label: () => "Object Explorer expand",
        feature: "objectExplorer",
    },
    {
        match: /^mssql\.oe\.session\.create\.begin$/,
        label: () => "Object Explorer session",
        feature: "objectExplorer",
    },
    {
        match: /^command\.(mssql\.[a-zA-Z.]+)\.begin$/,
        label: (e) => commandLabel(e.type),
        feature: "command",
    },
    { match: /^mssql\.query\.cancel/, label: () => "Cancel query", feature: "query" },
    {
        match: /^mssql\.command\.invoked$/,
        label: (e) => {
            const command = e.payload?.["command"]?.v;
            return typeof command === "string" ? command.replace(/^mssql\./, "") : "Command";
        },
        feature: "command",
    },
];

function commandLabel(type: string): string {
    const match = /^command\.(.+)\.begin$/.exec(type);
    return match ? match[1] : type;
}

function statusRank(status: DiagStatus): number {
    switch (status) {
        case "error":
            return 3;
        case "warning":
            return 2;
        case "blocked":
        case "partial":
            return 2;
        default:
            return 0;
    }
}

/** Group events by traceId and summarize root user actions, newest first. */
export function userActions(events: DiagEvent[]): UserActionSummary[] {
    const byTrace = new Map<string, DiagEvent[]>();
    for (const event of events) {
        if (!event.traceId) {
            continue;
        }
        const list = byTrace.get(event.traceId) ?? [];
        list.push(event);
        byTrace.set(event.traceId, list);
    }
    const actions: UserActionSummary[] = [];
    for (const [traceId, traceEvents] of byTrace) {
        let label: string | undefined;
        let feature = "system";
        for (const event of traceEvents) {
            for (const root of ROOT_LABELS) {
                if (root.match.test(event.type)) {
                    label = root.label(event);
                    feature = root.feature === "command" ? event.feature : root.feature;
                    break;
                }
            }
            if (label) {
                break;
            }
        }
        if (!label) {
            continue;
        }
        const first = traceEvents[0];
        const last = traceEvents[traceEvents.length - 1];
        const worst = traceEvents.reduce<DiagStatus>(
            (acc, e) => (statusRank(e.status) > statusRank(acc) ? e.status : acc),
            "ok",
        );
        const sql = traceEvents.filter((e) => e.kind === "sqlActivity").length;
        const render = traceEvents.find((e) => e.type === "mssql.resultsGrid.renderComplete");
        actions.push({
            traceId,
            label,
            feature,
            startEpochMs: first.epochMs,
            durationMs: Number((last.epochMs - first.epochMs).toFixed(1)),
            status: worst,
            sqlCommands: sql,
            ...(render?.durationMs !== undefined ? { renderMs: render.durationMs } : {}),
            gaps: 0,
            eventCount: traceEvents.length,
        });
    }
    return actions.sort((a, b) => b.startEpochMs - a.startEpochMs).slice(0, 50);
}

export function computeKpis(
    events: DiagEvent[],
    gaps: GapRecord[],
    captureMode: SourceKpis["captureMode"],
): SourceKpis {
    let errors = 0;
    let warnings = 0;
    let sql = 0;
    let redacted = 0;
    for (const event of events) {
        if (event.status === "error") errors++;
        else if (event.status === "warning") warnings++;
        if (event.kind === "sqlActivity") sql++;
        redacted += event.cls.redactedFields;
    }
    const actions = userActions(events);
    const slowest = actions.reduce<UserActionSummary | undefined>(
        (acc, action) =>
            acc === undefined || (action.durationMs ?? 0) > (acc.durationMs ?? 0) ? action : acc,
        undefined,
    );
    return {
        events: events.length,
        errors,
        warnings,
        gaps: gaps.filter((g) => g.backfillStatus !== "succeeded").length,
        ...(slowest?.durationMs !== undefined ? { slowestActionMs: slowest.durationMs } : {}),
        ...(slowest ? { slowestActionLabel: slowest.label } : {}),
        sqlCommands: sql,
        captureMode,
        redactedFields: redacted,
    };
}

export function deriveAnomalies(events: DiagEvent[], gaps: GapRecord[]): AnomalySummary[] {
    const anomalies: AnomalySummary[] = [];
    for (const gap of gaps.filter((g) => g.backfillStatus !== "succeeded")) {
        anomalies.push({
            id: gap.gapId,
            severity: "warning",
            title: `Live-tail gap: ${gap.droppedCount} events dropped`,
            detail: `seq ${gap.fromSeq}–${gap.throughSeq} · ${gap.reason} · backfillable`,
            page: "trace",
        });
    }
    const errors = events.filter((e) => e.status === "error");
    for (const error of errors.slice(-3)) {
        anomalies.push({
            id: `err_${error.eventId}`,
            severity: "error",
            title: error.type,
            detail: `${error.feature} · ${error.process}${error.durationMs !== undefined ? ` · ${error.durationMs}ms` : ""}`,
            ...(error.traceId ? { traceId: error.traceId } : {}),
            page: "trace",
        });
    }
    // Slow actions (over 5s) are worth a look.
    for (const action of userActions(events)
        .filter((a) => (a.durationMs ?? 0) > 5000)
        .slice(0, 3)) {
        anomalies.push({
            id: `slow_${action.traceId}`,
            severity: "warning",
            title: `Slow: ${action.label} ${(action.durationMs! / 1000).toFixed(2)}s`,
            detail: `${action.feature} · ${action.sqlCommands} SQL · ${action.eventCount} events`,
            traceId: action.traceId,
            page: "waterfall",
        });
    }
    return anomalies.slice(0, 8);
}

export function causeTree(events: DiagEvent[], eventId: string): CauseTreeNode | undefined {
    const target = events.find((e) => e.eventId === eventId);
    if (!target) {
        return undefined;
    }
    const scope = target.traceId ? events.filter((e) => e.traceId === target.traceId) : [target];
    // Ancestors: walk causeEventId chain to the root, then build the subtree.
    const byId = new Map(scope.map((e) => [e.eventId, e]));
    let root = target;
    const seen = new Set<string>([root.eventId]);
    while (root.causeEventId && byId.has(root.causeEventId)) {
        const parent = byId.get(root.causeEventId)!;
        if (seen.has(parent.eventId)) {
            break;
        }
        seen.add(parent.eventId);
        root = parent;
    }
    // If no explicit cause chain, use the first event of the trace as root.
    if (root === target && scope.length > 1 && !target.causeEventId) {
        root = scope[0];
    }
    const childrenOf = (parentId: string): DiagEvent[] =>
        scope.filter((e) => e.causeEventId === parentId);
    const build = (event: DiagEvent, depth: number): CauseTreeNode => ({
        event,
        children:
            depth > 8 ? [] : childrenOf(event.eventId).map((child) => build(child, depth + 1)),
    });
    const tree = build(root, 0);
    // Flat traces (no cause links): show chronological children under the root.
    if (tree.children.length === 0 && scope.length > 1) {
        tree.children = scope
            .filter((e) => e.eventId !== root.eventId)
            .slice(0, 30)
            .map((event) => ({ event, children: [] }));
    }
    return tree;
}

// ---------------------------------------------------------------------------
// Waterfall
// ---------------------------------------------------------------------------

export function buildWaterfall(events: DiagEvent[], traceId: string): WaterfallModel | undefined {
    const scope = events.filter((e) => e.traceId === traceId);
    if (scope.length === 0) {
        return undefined;
    }
    const activities: WaterfallActivity[] = [];
    const beginStack = new Map<string, DiagEvent>();
    let activityCounter = 0;

    for (const event of scope) {
        if (event.type.endsWith(".begin")) {
            beginStack.set(event.type.slice(0, -".begin".length) + `@${event.process}`, event);
            continue;
        }
        if (event.type.endsWith(".end")) {
            const stem = event.type.slice(0, -".end".length);
            const begin = beginStack.get(`${stem}@${event.process}`);
            if (begin) {
                beginStack.delete(`${stem}@${event.process}`);
                const sameProcess =
                    begin.process === event.process &&
                    begin.monotonicNs !== undefined &&
                    event.monotonicNs !== undefined;
                const durationMs = sameProcess
                    ? Number(BigInt(event.monotonicNs!) - BigInt(begin.monotonicNs!)) / 1e6
                    : event.epochMs - begin.epochMs;
                // JSON-RPC round-trips are measured from the extension host but
                // represent time spent in STS + wire — lane them under STS with
                // an honest label.
                const isRpc = stem.startsWith("rpc.");
                activities.push({
                    id: `act_${++activityCounter}`,
                    lane: isRpc ? "sqlToolsService" : begin.process,
                    label: isRpc ? `${shortLabel(stem)} (round-trip)` : shortLabel(stem),
                    startEpochMs: begin.epochMs,
                    endEpochMs: begin.epochMs + Math.max(0.1, durationMs),
                    durationMs: Number(durationMs.toFixed(2)),
                    timingClass: sameProcess ? "officialSameProcess" : "epochAlignedDiagnostic",
                    status: event.status,
                    sourceEventIds: [begin.eventId, event.eventId],
                    ...(begin.causeEventId ? { causeEventId: begin.causeEventId } : {}),
                    traceId,
                });
                continue;
            }
        }
        // Irregular pairs from the marker vocabulary.
        const pair = IRREGULAR_END[event.type];
        if (pair) {
            const begin = scope.find((e) => e.type === pair && e.epochMs <= event.epochMs);
            if (begin) {
                activities.push({
                    id: `act_${++activityCounter}`,
                    lane: begin.process,
                    label: shortLabel(event.type.replace(/^mssql\./, "")),
                    startEpochMs: begin.epochMs,
                    endEpochMs: Math.max(event.epochMs, begin.epochMs + 0.1),
                    durationMs: Number((event.epochMs - begin.epochMs).toFixed(2)),
                    timingClass:
                        begin.process === event.process
                            ? "officialSameProcess"
                            : "epochAlignedDiagnostic",
                    status: event.status,
                    sourceEventIds: [begin.eventId, event.eventId],
                    traceId,
                });
                continue;
            }
        }
        // Events with their own duration (spans emitted as single events).
        if (
            event.durationMs !== undefined &&
            event.durationMs > 0 &&
            !event.type.endsWith(".end")
        ) {
            activities.push({
                id: `act_${++activityCounter}`,
                lane: event.process,
                label: shortLabel(event.type),
                startEpochMs: event.epochMs - event.durationMs,
                endEpochMs: event.epochMs,
                durationMs: event.durationMs,
                timingClass: event.timingClass ?? "epochAlignedDiagnostic",
                status: event.status,
                sourceEventIds: [event.eventId],
                traceId,
            });
        }
    }
    if (activities.length === 0) {
        // Nothing pairable: represent the trace as instants on one lane.
        for (const event of scope.slice(0, 40)) {
            activities.push({
                id: `act_${++activityCounter}`,
                lane: event.process,
                label: shortLabel(event.type),
                startEpochMs: event.epochMs,
                endEpochMs: event.epochMs + 0.5,
                durationMs: 0,
                timingClass: "inferred",
                status: event.status,
                sourceEventIds: [event.eventId],
                traceId,
            });
        }
    }
    const start = Math.min(...activities.map((a) => a.startEpochMs));
    const end = Math.max(...activities.map((a) => a.endEpochMs));
    const label =
        userActions(scope).find((a) => a.traceId === traceId)?.label ?? shortLabel(scope[0].type);

    // Critical path: longest chain by end time within the trace (simple v1 —
    // honest about being a duration-ordered summary when cause links are thin).
    const ordered = [...activities].sort((a, b) => a.startEpochMs - b.startEpochMs);
    const criticalPath = ordered
        .filter((a) => a.durationMs > 0)
        .sort((a, b) => b.durationMs - a.durationMs)
        .slice(0, 6)
        .sort((a, b) => a.startEpochMs - b.startEpochMs)
        .map((a) => ({
            label: a.label,
            durationMs: a.durationMs,
            ...(a.timingClass !== "officialSameProcess" ? { note: "aligned diagnostic" } : {}),
        }));

    return {
        traceId,
        label,
        startEpochMs: start,
        endEpochMs: end,
        activities,
        criticalPath,
        calibrationNote:
            "Solid bars: same-process monotonic. Hatched: epoch-aligned across processes (extension-host clock domain).",
    };
}

const IRREGULAR_END: Record<string, string> = {
    "mssql.connection.ready": "mssql.connection.begin",
    "mssql.query.complete": "mssql.query.submit",
};

function shortLabel(type: string): string {
    return type
        .replace(/^mssql\./, "")
        .replace(/^command\./, "")
        .slice(0, 48);
}

// ---------------------------------------------------------------------------
// SQL activity extraction
// ---------------------------------------------------------------------------

export function sqlActivityRows(events: DiagEvent[]): SqlActivityRow[] {
    return events
        .filter((e) => e.kind === "sqlActivity")
        .map((e) => {
            const payload = e.payload ?? {};
            return {
                epochMs: e.epochMs,
                eventName: e.type,
                ...(numberField(payload["durationMs"]) !== undefined
                    ? { durationMs: numberField(payload["durationMs"]) }
                    : {}),
                ...(numberField(payload["cpuMs"]) !== undefined
                    ? { cpuMs: numberField(payload["cpuMs"]) }
                    : {}),
                ...(numberField(payload["logicalReads"]) !== undefined
                    ? { logicalReads: numberField(payload["logicalReads"]) }
                    : {}),
                ...(numberField(payload["rowCount"]) !== undefined
                    ? { rowCount: numberField(payload["rowCount"]) }
                    : {}),
                text: payload["text"] ?? { cls: "sql.text", handling: "omitted" },
                ...(e.traceId ? { correlation: e.traceId } : {}),
                sourceEventId: e.eventId,
            } as SqlActivityRow;
        });
}

function numberField(value: { v?: unknown } | undefined): number | undefined {
    return typeof value?.v === "number" ? value.v : undefined;
}
