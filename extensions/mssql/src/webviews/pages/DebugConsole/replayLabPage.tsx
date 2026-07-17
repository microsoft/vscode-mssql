/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Replay Lab page (final plan WI-3.5/WI-3.6, addendum §6.4): the
 * cross-feature run surface — Completions and Query Studio (safe adapter,
 * §7.8). Inline Debug idiom throughout: a dense runs table over a splitter
 * with a per-run detail pane (items, config groups, deep links), a packed
 * one-row toolbar, and the EXISTING ReplayTraceBuilder drawer as the
 * completions "New replay…" entry point — same cart, same services, same
 * engine as the Completions page. The Query Studio "New replay…" entry opens
 * the standalone QS Replay panel (decision documented on
 * DcOpenQueryStudioReplayRequest): its cart/capture UX stays there, while
 * its durable runs list HERE through the shared repository/catalog, with a
 * per-item target column (fingerprint label + database, §7.8.2).
 *
 * Data: durable rows ride dc/replayRunList (manifest-only catalog); live rows
 * come from the SAME completions debug provider the Completions page uses and
 * are merged client-side (live state wins, no double listing). Detail is
 * lazy per selected run (dc/replayRunDetail).
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
    CompletionsStatusInfo,
    DcCompletionsStatusRequest,
} from "../../../sharedInterfaces/debugConsole";
import {
    DcOpenQueryStudioReplayRequest,
    DcReplayRunDetailRequest,
    DcReplayRunDetailResult,
    DcReplayRunListRequest,
    ReplayLabRunRowV1,
    mergeReplayLabRunRows,
    projectLiveReplayRunRow,
} from "../../../sharedInterfaces/replayLabRpc";
import { EmptyState, PageHeader, formatDuration, formatTime } from "./common";
import { ConsoleCompletionsDebugStateProvider } from "./completionsDebug/consoleStateProvider";
import { useInlineCompletionDebugSelector } from "../InlineCompletionDebug/inlineCompletionDebugSelector";
import { useInlineCompletionDebugContext } from "../InlineCompletionDebug/inlineCompletionDebugStateProvider";
import { useDc } from "./state";

const ReplayTraceBuilderDrawer = lazy(() =>
    import("../InlineCompletionDebug/components/ReplayTraceBuilder").then((module) => ({
        default: module.ReplayTraceBuilder,
    })),
);

/** Fixed semantics label (§6.4 / honesty invariant: never "official"). */
const SEMANTICS_LABEL = "interactive experiment · results are exploratory, never official";

const ACTIVE_STATUSES = new Set(["queued", "running", "cancelling"]);

type LabFeatureId = "completions" | "queryStudio";

const FEATURE_GLYPHS: Record<string, string> = {
    completions: "✦",
    queryStudio: "▤",
};

function featureGlyph(featureId: string): string {
    return FEATURE_GLYPHS[featureId] ?? "•";
}

function statusPillClass(status: string): string {
    switch (status) {
        case "completed":
            return "ok";
        case "running":
            return "replay";
        case "cancelling":
        case "partial":
            return "warning";
        case "failed":
            return "error";
        case "cancelled":
            return "blocked";
        default:
            return "diag"; // queued
    }
}

function itemStatusPillClass(status: string): string {
    switch (status) {
        case "completed":
            return "ok";
        case "failed":
            return "error";
        case "blocked":
        case "cancelling":
            return "warning";
        case "running":
            return "replay";
        default:
            return "diag"; // queued / cancelled
    }
}

function runLabel(row: ReplayLabRunRowV1): string {
    const cells = row.cellCount > 0 ? `${row.cellCount} cells` : "1 config";
    return `${row.sourceCount} src × ${cells}`;
}

function runCounts(row: ReplayLabRunRowV1): string {
    const base = `${row.completedItems}/${row.failedItems}/${row.cancelledItems}`;
    const blocked = row.blockedItems > 0 ? `/${row.blockedItems}b` : "";
    return `${base}${blocked} of ${row.expectedItems}`;
}

function runDuration(row: ReplayLabRunRowV1): string {
    const start = row.startedAt ?? row.createdAt;
    const end = row.endedAt;
    if (end === undefined) {
        return ACTIVE_STATUSES.has(row.status) ? "…" : "";
    }
    return formatDuration(Math.max(0, end - start));
}

function SafetyPill({ sideEffectClass }: { sideEffectClass?: string }) {
    if (sideEffectClass === "none") {
        return <span className="dc-pill ok">no side effects</span>;
    }
    if (sideEffectClass === undefined) {
        return <span className="dc-pill diag">unclassified</span>;
    }
    return <span className="dc-pill warning">{sideEffectClass}</span>;
}

export function ReplayLabPage() {
    // The provider brings up the SAME console-hosted completions debug host
    // the Completions page uses: shared cart, shared engine, shared drawer.
    return (
        <ConsoleCompletionsDebugStateProvider>
            <ReplayLabContent />
        </ConsoleCompletionsDebugStateProvider>
    );
}

function ReplayLabContent() {
    const { rpc, navigate } = useDc();
    const { openReplayBuilder, cancelReplayRun, selectEvent } = useInlineCompletionDebugContext();
    const liveRuns = useInlineCompletionDebugSelector((state) => state.replay.runs);

    const [feature, setFeature] = useState<LabFeatureId>("completions");
    const [durableRows, setDurableRows] = useState<ReplayLabRunRowV1[]>([]);
    const [listLoaded, setListLoaded] = useState(false);
    const [listError, setListError] = useState<string | undefined>(undefined);
    const [issueCount, setIssueCount] = useState(0);
    const [status, setStatus] = useState<CompletionsStatusInfo | undefined>(undefined);
    const [selectedRunId, setSelectedRunId] = useState<string | undefined>(undefined);
    const [detail, setDetail] = useState<DcReplayRunDetailResult | undefined>(undefined);
    const [detailLoading, setDetailLoading] = useState(false);
    const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const mountedRef = useRef(true);

    const fetchList = useCallback(async () => {
        try {
            // The catalog is small (manifest-only rows); walk every page so
            // the merge sees the complete durable set.
            const rows: ReplayLabRunRowV1[] = [];
            let cursor: string | undefined;
            let issues = 0;
            for (let page = 0; page < 20; page++) {
                const result = await rpc.sendRequest(
                    DcReplayRunListRequest.type,
                    cursor !== undefined ? { cursor } : {},
                );
                rows.push(...result.rows);
                issues = result.issueCount;
                cursor = result.nextCursor;
                if (cursor === undefined) {
                    break;
                }
            }
            if (!mountedRef.current) {
                return;
            }
            setDurableRows(rows);
            setIssueCount(issues);
            setListError(undefined);
        } catch (error) {
            if (mountedRef.current) {
                setListError(error instanceof Error ? error.message : String(error));
            }
        } finally {
            if (mountedRef.current) {
                setListLoaded(true);
            }
        }
    }, [rpc]);

    const fetchDetail = useCallback(
        async (runId: string, hostSessionId: string | undefined) => {
            setDetailLoading(true);
            try {
                const result = await rpc.sendRequest(DcReplayRunDetailRequest.type, {
                    replayRunId: runId,
                    ...(hostSessionId !== undefined ? { hostSessionId } : {}),
                });
                if (mountedRef.current) {
                    setDetail(result);
                }
            } catch {
                if (mountedRef.current) {
                    setDetail(undefined);
                }
            } finally {
                if (mountedRef.current) {
                    setDetailLoading(false);
                }
            }
        },
        [rpc],
    );

    useEffect(() => {
        mountedRef.current = true;
        void fetchList();
        void rpc.sendRequest(DcCompletionsStatusRequest.type, undefined).then((result) => {
            if (mountedRef.current) {
                setStatus(result);
            }
        });
        return () => {
            mountedRef.current = false;
            if (refreshTimer.current) {
                clearTimeout(refreshTimer.current);
            }
        };
    }, [fetchList, rpc]);

    // Live run transitions (progress/settle) refresh the durable list and the
    // open detail after the repository's debounced flush (~500ms) lands.
    const liveSignature = useMemo(
        () =>
            liveRuns
                .map((run) => `${run.id}:${run.status}:${run.completedEvents}:${run.durable}`)
                .join("|"),
        [liveRuns],
    );
    const selectedRow = useMemo(() => {
        const liveRows = liveRuns.map((run) => projectLiveReplayRunRow(run));
        return mergeReplayLabRunRows(liveRows, durableRows).find(
            (row) => row.replayRunId === selectedRunId,
        );
    }, [durableRows, liveRuns, selectedRunId]);
    useEffect(() => {
        if (refreshTimer.current) {
            clearTimeout(refreshTimer.current);
        }
        refreshTimer.current = setTimeout(() => {
            refreshTimer.current = undefined;
            void fetchList();
            if (selectedRunId) {
                void fetchDetail(selectedRunId, selectedRow?.hostSessionId);
            }
        }, 600);
        // liveSignature is the real trigger (run state changed in the
        // engine); selection deps keep a pending timer from refreshing a
        // previously selected run's detail over the current one.
    }, [liveSignature, selectedRunId, selectedRow?.hostSessionId, fetchList, fetchDetail]);

    const rows = useMemo(
        () =>
            mergeReplayLabRunRows(
                liveRuns.map((run) => projectLiveReplayRunRow(run)),
                durableRows,
            ).filter((row) => row.featureId === feature),
        [durableRows, feature, liveRuns],
    );

    const selectRun = useCallback(
        (row: ReplayLabRunRowV1) => {
            setSelectedRunId(row.replayRunId);
            void fetchDetail(row.replayRunId, row.hostSessionId);
        },
        [fetchDetail],
    );

    const openInCompletions = useCallback(
        (eventId: string) => {
            // Phase-1 selection mechanics: select host-side (ring id or
            // durable capture id — the handler resolves both), then route.
            selectEvent(eventId);
            navigate({ page: "completions" });
        },
        [navigate, selectEvent],
    );

    const openQsReplayPanel = useCallback(() => {
        void rpc.sendRequest(DcOpenQueryStudioReplayRequest.type, undefined);
    }, [rpc]);

    const selectFeature = useCallback((next: LabFeatureId) => {
        setFeature(next);
        // Selection belongs to the previous feature's table.
        setSelectedRunId(undefined);
        setDetail(undefined);
    }, []);

    const featureEnabled = status?.featureEnabled === true;
    // Per-feature "New replay…" routing: completions opens the shared
    // ReplayTraceBuilder drawer; Query Studio opens the standalone QS Replay
    // panel (WI-3.6 decision — cart/capture UX lives there, runs list here).
    const newReplayEnabled = feature === "queryStudio" || featureEnabled;
    const newReplayTitle =
        feature === "queryStudio"
            ? "Opens the Query Studio Replay panel (capture, cart, and queueing live there; runs list here)"
            : featureEnabled
              ? "Open the replay builder (shared cart with the Completions page)"
              : "Enable AI completions on the Completions page first";
    const onNewReplay = feature === "queryStudio" ? openQsReplayPanel : openReplayBuilder;

    return (
        <>
            <PageHeader
                title="Replay Lab"
                sub="Re-run captured feature events against live models under explicit replay modes."
            />
            <div
                className="dc-card"
                style={{
                    flexGrow: 1,
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 420,
                    padding: 0,
                    overflow: "hidden",
                }}>
                <div className="dc-lab-toolbar">
                    <label className="dc-muted" style={{ fontSize: 11 }}>
                        Feature
                    </label>
                    <select
                        className="dc-session-select"
                        value={feature}
                        onChange={(event) => selectFeature(event.target.value as LabFeatureId)}>
                        <option value="completions">✦ Completions</option>
                        <option value="queryStudio">▤ Query Studio</option>
                    </select>
                    <span className="dc-muted dc-lab-semantics">{SEMANTICS_LABEL}</span>
                    <div style={{ flex: 1 }} />
                    {issueCount > 0 ? (
                        <span
                            className="dc-pill warning"
                            title="Run manifests that could not be read (torn writes, unknown schema)">
                            {issueCount} unreadable
                        </span>
                    ) : null}
                    <button className="dc-btn" onClick={() => void fetchList()}>
                        ↻ Refresh
                    </button>
                    <button
                        className="dc-btn primary"
                        disabled={!newReplayEnabled}
                        title={newReplayTitle}
                        onClick={onNewReplay}>
                        ▶ New replay…
                    </button>
                </div>
                {!listLoaded ? (
                    <SkeletonRows />
                ) : listError ? (
                    <EmptyState title="Could not read the run catalog" body={listError}>
                        <button className="dc-btn" onClick={() => void fetchList()}>
                            Retry
                        </button>
                    </EmptyState>
                ) : rows.length === 0 ? (
                    <EmptyState
                        title="No replay runs yet"
                        body={
                            feature === "queryStudio"
                                ? "Queue captured Query Studio runs from the Query Studio Replay panel — durable runs land here."
                                : "Queue captured completion events from the cart — runs land here with durable manifests."
                        }>
                        <button
                            className="dc-btn primary"
                            disabled={!newReplayEnabled}
                            title={newReplayTitle}
                            onClick={onNewReplay}>
                            ▶ New replay…
                        </button>
                    </EmptyState>
                ) : (
                    <PanelGroup direction="vertical" style={{ flex: 1, minHeight: 0 }}>
                        <Panel defaultSize={55} minSize={25}>
                            <div
                                className="dc-table-wrap"
                                style={{ height: "100%", border: "none", borderRadius: 0 }}>
                                <table className="dc-table">
                                    <thead>
                                        <tr>
                                            <th>status</th>
                                            <th>feature</th>
                                            <th>label</th>
                                            <th title="completed/failed/cancelled(/blocked) of expected">
                                                items c/f/x
                                            </th>
                                            <th title="estimated model calls → actual executions">
                                                est→act
                                            </th>
                                            <th>safety</th>
                                            <th>started</th>
                                            <th>duration</th>
                                            <th title="durable manifest on disk">⛁</th>
                                            <th></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((row) => (
                                            <RunRow
                                                key={row.replayRunId}
                                                row={row}
                                                selected={row.replayRunId === selectedRunId}
                                                onSelect={() => selectRun(row)}
                                                onCancel={() => cancelReplayRun(row.replayRunId)}
                                            />
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Panel>
                        <PanelResizeHandle className="dc-lab-resize" />
                        <Panel defaultSize={45} minSize={20}>
                            <RunDetailPane
                                row={selectedRow}
                                detail={detail}
                                loading={detailLoading}
                                onCancel={cancelReplayRun}
                                onOpenEvent={openInCompletions}
                            />
                        </Panel>
                    </PanelGroup>
                )}
            </div>
            <Suspense fallback={null}>
                <ReplayTraceBuilderDrawer />
            </Suspense>
        </>
    );
}

function RunRow({
    row,
    selected,
    onSelect,
    onCancel,
}: {
    row: ReplayLabRunRowV1;
    selected: boolean;
    onSelect: () => void;
    onCancel: () => void;
}) {
    const active = row.live && ACTIVE_STATUSES.has(row.status);
    const cancelling = row.status === "cancelling";
    const reason = row.errorMessage;
    return (
        <tr className={selected ? "selected" : ""} onClick={onSelect}>
            <td>
                <span
                    className={`dc-pill ${statusPillClass(row.status)}`}
                    title={reason ?? row.status}>
                    {cancelling ? <span className="dc-lab-spin" aria-hidden /> : null}
                    {row.status}
                </span>
                {(row.status === "failed" || row.status === "partial") && reason ? (
                    <span className="dc-muted" title={reason} style={{ marginLeft: 5 }}>
                        ⓘ
                    </span>
                ) : null}
            </td>
            <td>
                {featureGlyph(row.featureId)} {row.featureId}
            </td>
            <td className="dc-mono">
                {runLabel(row)}
                {row.activeCellLabel ? (
                    <span className="dc-muted"> · {row.activeCellLabel}</span>
                ) : null}
            </td>
            <td className="dc-mono" title="completed/failed/cancelled(/blocked) of expected">
                {runCounts(row)}
            </td>
            <td className="dc-mono">
                {row.estimate
                    ? `${row.estimate.totalExecutions}${
                          row.actualExecutions !== undefined ? ` → ${row.actualExecutions}` : ""
                      }`
                    : ""}
            </td>
            <td>
                <SafetyPill sideEffectClass={row.safetySideEffectClass} />
            </td>
            <td className="dc-mono">{formatTime(row.createdAt)}</td>
            <td className="dc-mono">{runDuration(row)}</td>
            <td title={row.durable ? "durable manifest on disk" : "in-memory only (not persisted)"}>
                {row.durable ? "●" : "○"}
            </td>
            <td>
                {active ? (
                    <button
                        className="dc-btn"
                        disabled={cancelling}
                        title={
                            cancelling
                                ? "Cancel requested — waiting for the active item to settle"
                                : "Cancel this run (queued items drop; the active item is signalled)"
                        }
                        onClick={(event) => {
                            event.stopPropagation();
                            onCancel();
                        }}>
                        {cancelling ? "cancelling…" : "✕ cancel"}
                    </button>
                ) : null}
            </td>
        </tr>
    );
}

function RunDetailPane({
    row,
    detail,
    loading,
    onCancel,
    onOpenEvent,
}: {
    row: ReplayLabRunRowV1 | undefined;
    detail: DcReplayRunDetailResult | undefined;
    loading: boolean;
    onCancel: (runId: string) => void;
    onOpenEvent: (eventId: string) => void;
}) {
    if (!row) {
        return (
            <div className="dc-lab-detail-empty dc-muted">
                Select a run to see its items, config groups, and deep links.
            </div>
        );
    }
    const active = row.live && ACTIVE_STATUSES.has(row.status);
    const cancelling = row.status === "cancelling";
    // Deep links route to the Completions page; Query Studio results live in
    // the Query Studio panel and have no console page yet.
    const canDeepLink = row.currentHostSession && row.featureId === "completions";
    // WI-3.6: compact target column (fingerprint label + database) — shown
    // when any item carries a target (Query Studio runs).
    const showTargetColumn = (detail?.items ?? []).some(
        (item) => item.targetLabel !== undefined || item.targetDatabase !== undefined,
    );
    return (
        <div className="dc-lab-detail">
            <div className="dc-lab-detail-head">
                <span className={`dc-pill ${statusPillClass(row.status)}`}>{row.status}</span>
                <span className="dc-mono" title={row.replayRunId}>
                    {row.replayRunId.slice(0, 11)}…
                </span>
                <span className="dc-muted">{row.semantics}</span>
                <SafetyPill sideEffectClass={row.safetySideEffectClass} />
                {!row.durable ? (
                    <span
                        className="dc-pill blocked"
                        title="No durable manifest — the run repository was unavailable when this run queued">
                        not persisted
                    </span>
                ) : null}
                {row.errorMessage ? (
                    <span className="dc-muted dc-lab-reason" title={row.errorMessage}>
                        {row.errorMessage}
                    </span>
                ) : null}
                <div style={{ flex: 1 }} />
                {active ? (
                    <button
                        className="dc-btn"
                        disabled={cancelling}
                        onClick={() => onCancel(row.replayRunId)}>
                        {cancelling ? "cancelling…" : "✕ cancel run"}
                    </button>
                ) : null}
            </div>
            {loading && !detail ? (
                <SkeletonRows />
            ) : (
                <div className="dc-lab-detail-body">
                    <div className="dc-table-wrap dc-lab-items">
                        <table className="dc-table">
                            <thead>
                                <tr>
                                    <th>source</th>
                                    <th>cell</th>
                                    <th>status</th>
                                    <th>mode</th>
                                    {showTargetColumn ? <th>target</th> : <th>schema</th>}
                                    <th>duration</th>
                                    <th>outcome</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {(detail?.items ?? []).map((item) => (
                                    <tr key={item.replayItemId} style={{ cursor: "default" }}>
                                        <td className="dc-mono" title={item.sourceCaptureEventId}>
                                            {item.sourceLabel ??
                                                `${item.sourceCaptureEventId.slice(0, 11)}…`}
                                        </td>
                                        <td className="dc-mono">{item.cellLabel ?? ""}</td>
                                        <td>
                                            <span
                                                className={`dc-pill ${itemStatusPillClass(item.status)}`}
                                                title={item.errorMessage ?? item.status}>
                                                {item.status}
                                            </span>
                                        </td>
                                        <td className="dc-mono">{item.replayMode ?? ""}</td>
                                        {showTargetColumn ? (
                                            <td
                                                className="dc-mono"
                                                title={item.targetFingerprint ?? ""}>
                                                {item.targetLabel ?? ""}
                                                {item.targetDatabase
                                                    ? `${item.targetLabel ? " · " : ""}${item.targetDatabase}`
                                                    : ""}
                                            </td>
                                        ) : (
                                            <td className="dc-mono">
                                                {item.schemaContextSource ?? ""}
                                            </td>
                                        )}
                                        <td className="dc-mono">
                                            {item.durationMs !== undefined
                                                ? formatDuration(item.durationMs)
                                                : ""}
                                        </td>
                                        <td
                                            className="dc-mono dc-muted"
                                            title={item.errorMessage ?? ""}>
                                            {item.cancellationOutcome ??
                                                (item.errorMessage
                                                    ? truncateText(item.errorMessage, 40)
                                                    : "")}
                                        </td>
                                        <td>
                                            <button
                                                className="dc-btn"
                                                disabled={
                                                    !canDeepLink ||
                                                    (!item.resultEventId &&
                                                        !item.resultCaptureEventId)
                                                }
                                                title={
                                                    canDeepLink
                                                        ? "Select the replayed result event on the Completions page"
                                                        : row.featureId === "queryStudio"
                                                          ? "Query Studio replay results live in the Query Studio panel"
                                                          : "Result events from other host sessions are not in the live ring"
                                                }
                                                onClick={() =>
                                                    onOpenEvent(
                                                        item.resultEventId ??
                                                            item.resultCaptureEventId ??
                                                            "",
                                                    )
                                                }>
                                                → result
                                            </button>
                                            <button
                                                className="dc-btn"
                                                style={{ marginLeft: 4 }}
                                                disabled={!canDeepLink}
                                                title={
                                                    canDeepLink
                                                        ? "Select the source event on the Completions page"
                                                        : row.featureId === "queryStudio"
                                                          ? "Query Studio source records live in the Query Studio Replay panel"
                                                          : "Source events from other host sessions are not in the live ring"
                                                }
                                                onClick={() =>
                                                    onOpenEvent(item.sourceCaptureEventId)
                                                }>
                                                → source
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {(detail?.items?.length ?? 0) === 0 ? (
                                    <tr style={{ cursor: "default" }}>
                                        <td colSpan={8} className="dc-muted">
                                            {row.durable
                                                ? "No item records yet."
                                                : "No durable item records — this run was never persisted."}
                                        </td>
                                    </tr>
                                ) : null}
                            </tbody>
                        </table>
                        {detail && detail.itemsTotal > detail.items.length ? (
                            <div className="dc-muted" style={{ padding: "4px 10px", fontSize: 11 }}>
                                showing {detail.items.length} of {detail.itemsTotal} items
                            </div>
                        ) : null}
                    </div>
                    <div className="dc-lab-groups">
                        <div className="dc-lab-groups-title">
                            config groups {detail?.configGroups?.length ?? 0}
                        </div>
                        {(detail?.configGroups ?? []).map((group) => (
                            <div key={group.configGroupId} className="dc-lab-group">
                                <div className="dc-mono dc-lab-group-label" title={group.label}>
                                    {group.label}
                                </div>
                                <div className="dc-muted dc-mono" style={{ fontSize: 10.5 }}>
                                    {group.effectiveConfigDigest.slice(0, 12) || "no digest"}
                                    {group.replayMode ? ` · ${group.replayMode}` : ""}
                                    {group.baseProfileId
                                        ? ` · ${group.baseProfileId} v${group.baseProfileVersion ?? "?"}`
                                        : ""}
                                    {group.customSystemPromptUsed ? " · custom prompt" : ""}
                                </div>
                            </div>
                        ))}
                        {detail?.sources ? (
                            <div className="dc-muted" style={{ fontSize: 11, marginTop: 6 }}>
                                {detail.sources.length} source event
                                {detail.sources.length === 1 ? "" : "s"}
                            </div>
                        ) : null}
                    </div>
                </div>
            )}
        </div>
    );
}

function SkeletonRows() {
    return (
        <div style={{ padding: 10 }}>
            {[0, 1, 2, 3].map((index) => (
                <div key={index} className="dc-lab-skel" />
            ))}
        </div>
    );
}

function truncateText(value: string, maxLength: number): string {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
