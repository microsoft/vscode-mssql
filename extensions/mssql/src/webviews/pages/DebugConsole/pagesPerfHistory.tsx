/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Perf Test History — the durable harness/self-test run history cockpit.
 *
 * Two tabs (spec: MSSQL_Debug_Console_Perf_Test_History_View_Spec.md):
 *   Runs Summary — snappy all-up triage: KPIs, latest-slower callout, cross-run
 *     trend, suite health, needs-attention, sources.
 *   Run Analysis — workbench: source command bar, virtualized runs table,
 *     filter rail, scenario aggregate table, linked charts, lazy bottom tabs.
 *
 * Everything renders from the metadata-first index; artifacts load only when
 * their tab opens. Missing data shows as missing — never invented.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { WaterfallModel, SqlActivityRow } from "../../../sharedInterfaces/debugConsole";
import {
    PerfHistorySource,
    PerfIndexProgress,
    PerfMetricSeriesPoint,
    PerfRichDiagnostics,
    PerfRunRow,
    PerfRunsSummary,
    PerfScenarioDetails,
    PerfScenarioRow,
    PerfSourceKind,
    PhAddSourceRequest,
    PhDeleteRunRequest,
    PhGetDumpRequest,
    PhGetRichDiagnosticsRequest,
    PhGetSqlActivityRequest,
    PhGetSummaryRequest,
    PhGetWaterfallRequest,
    PhIndexProgressNotification,
    PhListSourcesRequest,
    PhMetricSeriesRequest,
    PhQueryRunsRequest,
    PhQueryScenariosRequest,
    PhRescanRequest,
    PhScenarioDetailsRequest,
    RunVerdict,
    ScenarioGroupBy,
} from "../../../sharedInterfaces/perfHistory";
import { DeltaBars, Histogram, TrendChart } from "./charts";
import { EmptyState, formatDuration, Kpi, PageHeader, RedactedField } from "./common";
import { SelfTestDialog } from "./selftestDialog";
import { useDc } from "./state";
import { WaterfallView } from "./waterfallView";

// ---------------------------------------------------------------------------
// Small shared bits
// ---------------------------------------------------------------------------

function VerdictPill({ verdict }: { verdict: RunVerdict | string }) {
    const cls =
        verdict === "ok"
            ? "ok"
            : verdict === "failed"
              ? "error"
              : verdict === "warning" || verdict === "invalid"
                ? "warning"
                : "info";
    return <span className={`dc-pill ${cls}`}>{verdict}</span>;
}

/** One-line badge strip: rows stay fixed-height; overflow collapses to +N. */
function ArtifactBadges({ kinds, max = 3 }: { kinds: string[]; max?: number }) {
    const shown = kinds.slice(0, max);
    const hidden = kinds.length - shown.length;
    return (
        <span
            style={{ display: "inline-flex", gap: 3, whiteSpace: "nowrap", overflow: "hidden" }}
            title={kinds.join(" · ")}>
            {shown.map((kind) => (
                <span className="dc-badge" key={kind}>
                    {kind}
                </span>
            ))}
            {hidden > 0 ? <span className="dc-badge">+{hidden}</span> : null}
        </span>
    );
}

/** Simple fixed-row-height virtualization for large tables. */
function useVirtualRows(count: number, rowHeight: number) {
    const ref = useRef<HTMLDivElement>(null);
    const [range, setRange] = useState({ start: 0, end: 60 });
    const recompute = useCallback(() => {
        const el = ref.current;
        if (!el) {
            return;
        }
        const start = Math.max(0, Math.floor(el.scrollTop / rowHeight) - 10);
        const end = Math.min(count, Math.ceil((el.scrollTop + el.clientHeight) / rowHeight) + 10);
        setRange((current) =>
            current.start === start && current.end === end ? current : { start, end },
        );
    }, [count, rowHeight]);
    useEffect(recompute, [recompute]);
    return {
        ref,
        onScroll: recompute,
        start: range.start,
        end: range.end,
        topPad: range.start * rowHeight,
        bottomPad: Math.max(0, (count - range.end) * rowHeight),
    };
}

function shortRunId(runId: string): string {
    return runId.length > 26 ? `${runId.slice(0, 26)}…` : runId;
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

type PhTab = "summary" | "analysis";

export function PerfHistoryPage() {
    const { rpc, dataVersion } = useDc();
    const [tab, setTab] = useState<PhTab>("summary");
    const [sources, setSources] = useState<PerfHistorySource[]>([]);
    const [sourceId, setSourceId] = useState("default");
    const [indexProgress, setIndexProgress] = useState<PerfIndexProgress | undefined>(undefined);
    const [runDialogOpen, setRunDialogOpen] = useState(false);

    // Selection state shared between tabs.
    const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
    const [baselineRunId, setBaselineRunId] = useState<string | undefined>(undefined);
    const [focusScenarioId, setFocusScenarioId] = useState<string | undefined>(undefined);

    const refreshSources = useCallback(() => {
        void rpc.sendRequest(PhListSourcesRequest.type).then(setSources);
    }, [rpc]);

    useEffect(() => {
        refreshSources();
        rpc.onNotification(PhIndexProgressNotification.type, (progress) => {
            setIndexProgress(progress);
            if (progress.state === "done") {
                refreshSources();
            }
        });
    }, [rpc, refreshSources]);

    const activeSource = sources.find((s) => s.id === sourceId);

    const addSource = useCallback(
        (kind: PerfSourceKind) => {
            void rpc.sendRequest(PhAddSourceRequest.type, { kind }).then((outcome) => {
                setSources(outcome.sources);
                if (outcome.addedId) {
                    setSourceId(outcome.addedId);
                    setSelectedRunIds([]);
                    setBaselineRunId(undefined);
                }
            });
        },
        [rpc],
    );

    const rescan = useCallback(() => {
        void rpc.sendRequest(PhRescanRequest.type, { sourceId }).then(() => refreshSources());
    }, [rpc, sourceId, refreshSources]);

    const drillIn = useCallback((runId: string, scenarioId?: string) => {
        setSelectedRunIds([runId]);
        setFocusScenarioId(scenarioId);
        setTab("analysis");
    }, []);

    return (
        <>
            <div className="ph-header">
                <PageHeader title="Perf Test History" />
                <div className="ph-tabs">
                    <button
                        className={`ph-tab ${tab === "summary" ? "active" : ""}`}
                        onClick={() => setTab("summary")}>
                        Runs Summary
                    </button>
                    <button
                        className={`ph-tab ${tab === "analysis" ? "active" : ""}`}
                        onClick={() => setTab("analysis")}>
                        Run Analysis
                    </button>
                </div>
                <span className="dc-muted dc-mono" style={{ fontSize: 11 }}>
                    {activeSource
                        ? `${activeSource.label} · ${activeSource.runCount} runs${
                              indexProgress?.state === "scanning" &&
                              indexProgress.sourceId === sourceId
                                  ? ` · scanning ${indexProgress.scanned}/${indexProgress.total}`
                                  : activeSource.indexMs !== undefined
                                    ? ` · indexed in ${activeSource.indexMs}ms`
                                    : ""
                          }`
                        : ""}
                </span>
                <span style={{ flex: 1 }} />
                <button className="dc-btn primary" onClick={() => setRunDialogOpen(true)}>
                    ▶ Run self-test
                </button>
            </div>
            {runDialogOpen ? <SelfTestDialog onClose={() => setRunDialogOpen(false)} /> : null}
            {tab === "summary" ? (
                <SummaryTab
                    sourceId={sourceId}
                    sources={sources}
                    dataVersion={dataVersion}
                    onPickSource={setSourceId}
                    onAddSource={addSource}
                    onRescan={rescan}
                    onDrill={drillIn}
                    onRunSelfTest={() => setRunDialogOpen(true)}
                />
            ) : (
                <AnalysisTab
                    sourceId={sourceId}
                    sources={sources}
                    dataVersion={dataVersion}
                    onPickSource={(id) => {
                        setSourceId(id);
                        setSelectedRunIds([]);
                        setBaselineRunId(undefined);
                    }}
                    onAddSource={addSource}
                    onRescan={rescan}
                    selectedRunIds={selectedRunIds}
                    setSelectedRunIds={setSelectedRunIds}
                    baselineRunId={baselineRunId}
                    setBaselineRunId={setBaselineRunId}
                    focusScenarioId={focusScenarioId}
                    setFocusScenarioId={setFocusScenarioId}
                />
            )}
        </>
    );
}

// ---------------------------------------------------------------------------
// Runs Summary tab
// ---------------------------------------------------------------------------

function SummaryTab(props: {
    sourceId: string;
    sources: PerfHistorySource[];
    dataVersion: number;
    onPickSource: (id: string) => void;
    onAddSource: (kind: PerfSourceKind) => void;
    onRescan: () => void;
    onDrill: (runId: string, scenarioId?: string) => void;
    onRunSelfTest: () => void;
}) {
    const { rpc } = useDc();
    const [summary, setSummary] = useState<PerfRunsSummary | undefined>(undefined);

    useEffect(() => {
        void rpc
            .sendRequest(PhGetSummaryRequest.type, { sourceId: props.sourceId })
            .then(setSummary);
    }, [rpc, props.sourceId, props.dataVersion]);

    if (!summary) {
        return <PageHeader title="" sub="Loading history…" />;
    }
    const { kpis } = summary;
    if (kpis.runs === 0) {
        return (
            <>
                <EmptyState
                    title="No runs in this source yet"
                    body={`${summary.source.path || "(no path)"} — run a self-test right here, run the perftest CLI, or open a directory of existing runs.`}>
                    <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                        <button className="dc-btn primary" onClick={props.onRunSelfTest}>
                            ▶ Run self-test
                        </button>
                        <button className="dc-btn" onClick={() => props.onAddSource("directory")}>
                            Open directory…
                        </button>
                    </div>
                </EmptyState>
                <SourcesPanel {...props} />
            </>
        );
    }
    return (
        <div className="ph-scroll">
            <div className="dc-kpis">
                <Kpi label="Runs" value={kpis.runs} note={`${kpis.scenarios} scenarios`} />
                <Kpi
                    label="Latest verdict"
                    value={kpis.latestVerdict}
                    tone={
                        kpis.latestVerdict === "ok"
                            ? "ok"
                            : kpis.latestVerdict === "failed"
                              ? "error"
                              : undefined
                    }
                    note={kpis.latestRunId ? shortRunId(kpis.latestRunId) : undefined}
                />
                <Kpi
                    label="Median wall (latest)"
                    value={
                        kpis.medianWallMs !== undefined ? formatDuration(kpis.medianWallMs) : "—"
                    }
                    note={
                        kpis.deltaVsPrevPct !== undefined
                            ? `${kpis.deltaVsPrevPct > 0 ? "+" : ""}${kpis.deltaVsPrevPct}% vs prev run`
                            : undefined
                    }
                    tone={
                        kpis.deltaVsPrevPct !== undefined && kpis.deltaVsPrevPct > 10
                            ? "error"
                            : undefined
                    }
                />
                <Kpi
                    label="P95 wall (latest)"
                    value={kpis.p95WallMs !== undefined ? formatDuration(kpis.p95WallMs) : "—"}
                />
                <Kpi
                    label="Failed reps (all)"
                    value={kpis.failedReps}
                    tone={kpis.failedReps > 0 ? "error" : undefined}
                />
                <Kpi
                    label="Invalid reps (all)"
                    value={kpis.invalidReps}
                    tone={kpis.invalidReps > 0 ? "warn" : undefined}
                />
                <Kpi label="Sources" value={kpis.sourceCount} />
            </div>

            {summary.latestSlower ? (
                <div className="ph-callout">
                    <span className="ph-callout-icon">⚠</span>
                    <div style={{ flex: 1 }}>
                        <b>
                            Latest run slower — {shortRunId(summary.latestSlower.runId)} ·{" "}
                            {summary.latestSlower.scenarioId}
                        </b>
                        <div className="dc-muted" style={{ fontSize: 11.5 }}>
                            wall-clock +{summary.latestSlower.deltaPct}% vs baseline · official
                            samples only
                        </div>
                    </div>
                    <button
                        className="dc-btn"
                        onClick={() =>
                            props.onDrill(
                                summary.latestSlower!.runId,
                                summary.latestSlower!.scenarioId,
                            )
                        }>
                        Open in Run Analysis →
                    </button>
                </div>
            ) : null}

            <div className="dc-two-col">
                <div className="dc-card">
                    <div className="dc-card-title">
                        Cross-run trend · run-wide median wall-clock
                        <span className="right">{summary.trend.length} runs</span>
                    </div>
                    <TrendChart
                        points={summary.trend.map((point, index) => ({
                            x: index,
                            y: point.p50,
                            label: `${point.runId}\np50 ${formatDuration(point.p50)} · p95 ${formatDuration(point.p95)} · ${point.n} reps`,
                        }))}
                        onPick={(index) => {
                            const point = summary.trend[index];
                            if (point) {
                                props.onDrill(point.runId);
                            }
                        }}
                    />
                    <div className="dc-muted" style={{ fontSize: 11 }}>
                        Click a point to open the run in Run Analysis.
                    </div>
                </div>
                <div>
                    <div className="dc-card">
                        <div className="dc-card-title">Suite health · latest run</div>
                        {summary.suiteHealth.length === 0 ? (
                            <span className="dc-muted">no scenarios in the latest run</span>
                        ) : (
                            summary.suiteHealth.map((suite) => (
                                <div className="ph-suite-row" key={suite.suite}>
                                    <span className="name">{suite.suite}</span>
                                    <div className="bar">
                                        <div
                                            className="fill"
                                            style={{
                                                width: `${(suite.ok / Math.max(1, suite.total)) * 100}%`,
                                                background:
                                                    suite.ok === suite.total
                                                        ? "var(--dc-ok)"
                                                        : "var(--dc-warn)",
                                            }}
                                        />
                                    </div>
                                    <span className="dc-mono count">
                                        {suite.ok}/{suite.total} ok
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                    <div className="dc-card">
                        <div className="dc-card-title">Needs attention</div>
                        {summary.needsAttention.length === 0 ? (
                            <span className="dc-muted">nothing flagged in the latest run</span>
                        ) : (
                            summary.needsAttention.map((row, index) => (
                                <div
                                    key={index}
                                    className="ph-attn-row"
                                    onClick={() => props.onDrill(row.runId, row.scenarioId)}>
                                    <VerdictPill
                                        verdict={
                                            row.kind === "slower"
                                                ? "warning"
                                                : row.kind === "failed"
                                                  ? "failed"
                                                  : row.kind === "invalid"
                                                    ? "invalid"
                                                    : "warning"
                                        }
                                    />
                                    <span className="dc-mono" style={{ flex: 1 }}>
                                        {row.scenarioId}
                                    </span>
                                    <span className="dc-muted">{row.detail}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            <SourcesPanel {...props} />
        </div>
    );
}

function SourcesPanel(props: {
    sources: PerfHistorySource[];
    sourceId: string;
    onPickSource: (id: string) => void;
    onAddSource: (kind: PerfSourceKind) => void;
    onRescan: () => void;
}) {
    return (
        <div className="dc-card">
            <div className="dc-card-title">
                History sources
                <span className="right">
                    <button className="dc-btn" onClick={() => props.onAddSource("directory")}>
                        Open directory…
                    </button>{" "}
                    <button className="dc-btn" onClick={() => props.onAddSource("sqlite")}>
                        Connect SQLite DB…
                    </button>{" "}
                    <button className="dc-btn" onClick={() => props.onAddSource("bundle")}>
                        Import bundle…
                    </button>
                </span>
            </div>
            <div className="dc-table-wrap" style={{ border: "none" }}>
                <table className="dc-table">
                    <thead>
                        <tr>
                            <th>Source</th>
                            <th>Kind</th>
                            <th>Status</th>
                            <th className="num">Runs</th>
                            <th className="num">Scenarios</th>
                            <th>Path</th>
                        </tr>
                    </thead>
                    <tbody>
                        {props.sources.map((source) => (
                            <tr
                                key={source.id}
                                className={source.id === props.sourceId ? "selected" : ""}
                                onClick={() => props.onPickSource(source.id)}
                                title={source.statusMessage ?? source.path}>
                                <td>
                                    {source.label}
                                    {source.isDefault ? (
                                        <span className="dc-badge" style={{ marginLeft: 6 }}>
                                            default
                                        </span>
                                    ) : null}
                                    {source.readOnly ? (
                                        <span className="dc-badge" style={{ marginLeft: 6 }}>
                                            read-only
                                        </span>
                                    ) : null}
                                </td>
                                <td className="dc-muted">{source.kind}</td>
                                <td>
                                    <VerdictPill
                                        verdict={
                                            source.status === "indexed"
                                                ? "ok"
                                                : source.status === "error" ||
                                                    source.status === "unsupported"
                                                  ? "failed"
                                                  : "warning"
                                        }
                                    />
                                    <span className="dc-muted" style={{ marginLeft: 6 }}>
                                        {source.status}
                                    </span>
                                </td>
                                <td className="num dc-mono">{source.runCount}</td>
                                <td className="num dc-mono">{source.scenarioCount}</td>
                                <td className="dc-mono dc-muted" style={{ fontSize: 10.5 }}>
                                    {source.path}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Run Analysis tab
// ---------------------------------------------------------------------------

const TIME_PRESETS: Array<{ id: string; label: string; hours?: number }> = [
    { id: "all", label: "All time" },
    { id: "24h", label: "Last 24h", hours: 24 },
    { id: "7d", label: "Last 7 days", hours: 24 * 7 },
    { id: "30d", label: "Last 30 days", hours: 24 * 30 },
];

const VERDICTS: RunVerdict[] = ["ok", "warning", "failed", "invalid", "unknown"];

function AnalysisTab(props: {
    sourceId: string;
    sources: PerfHistorySource[];
    dataVersion: number;
    onPickSource: (id: string) => void;
    onAddSource: (kind: PerfSourceKind) => void;
    onRescan: () => void;
    selectedRunIds: string[];
    setSelectedRunIds: (ids: string[]) => void;
    baselineRunId: string | undefined;
    setBaselineRunId: (id: string | undefined) => void;
    focusScenarioId: string | undefined;
    setFocusScenarioId: (id: string | undefined) => void;
}) {
    const { rpc } = useDc();
    const {
        sourceId,
        selectedRunIds,
        setSelectedRunIds,
        baselineRunId,
        setBaselineRunId,
        focusScenarioId,
        setFocusScenarioId,
    } = props;

    // --- runs table state ---
    const [runs, setRuns] = useState<PerfRunRow[]>([]);
    const [runTotals, setRunTotals] = useState({ total: 0, totalInSource: 0 });
    const [runText, setRunText] = useState("");
    const [timePreset, setTimePreset] = useState("all");
    const [runVerdicts, setRunVerdicts] = useState<RunVerdict[]>([]);

    // --- filter rail state (scenario scope) ---
    const [railCollapsed, setRailCollapsed] = useState(false);
    const [scenarioText, setScenarioText] = useState("");
    const [scenarioVerdicts, setScenarioVerdicts] = useState<RunVerdict[]>([]);
    const [suite, setSuite] = useState("");
    const [artifactKind, setArtifactKind] = useState("");
    const [groupBy, setGroupBy] = useState<ScenarioGroupBy>("scenario");
    const [metric, setMetric] = useState("scenario.wallclock");

    // --- scenario + details state ---
    const [scenarios, setScenarios] = useState<PerfScenarioRow[]>([]);
    const [details, setDetails] = useState<PerfScenarioDetails | undefined>(undefined);
    const [series, setSeries] = useState<PerfMetricSeriesPoint[]>([]);

    const sinceUtc = useMemo(() => {
        const preset = TIME_PRESETS.find((p) => p.id === timePreset);
        return preset?.hours
            ? new Date(Date.now() - preset.hours * 3_600_000).toISOString()
            : undefined;
    }, [timePreset]);

    // Collapsible top (source bar + runs table) and bottom (detail tabs)
    // regions — collapse to a single row to focus the middle workbench.
    const [topCollapsed, setTopCollapsed] = useState(false);
    const [bottomCollapsed, setBottomCollapsed] = useState(false);

    // Group drill-down (group-by modes): selecting a group row browses its
    // member scenarios in the bottom pane; drilling a member switches to the
    // normal per-scenario tabs.
    const [focusGroup, setFocusGroup] = useState<PerfScenarioRow | undefined>(undefined);
    const [memberRows, setMemberRows] = useState<PerfScenarioRow[]>([]);
    useEffect(() => {
        setFocusGroup(undefined);
    }, [groupBy, sourceId]);
    useEffect(() => {
        const members = focusGroup?.memberScenarioIds;
        if (!members || members.length === 0 || selectedRunIds.length === 0) {
            setMemberRows([]);
            return;
        }
        void rpc
            .sendRequest(PhQueryScenariosRequest.type, {
                sourceId,
                runIds: selectedRunIds,
                ...(baselineRunId ? { baselineRunId } : {}),
                metric,
                groupBy: "scenario",
            })
            .then((rows) =>
                setMemberRows(rows.filter((r) => r.scenarioId && members.includes(r.scenarioId))),
            );
    }, [rpc, sourceId, selectedRunIds, baselineRunId, metric, focusGroup]);

    // Load runs.
    useEffect(() => {
        void rpc
            .sendRequest(PhQueryRunsRequest.type, {
                sourceId,
                limit: 500,
                ...(runText ? { text: runText } : {}),
                ...(runVerdicts.length > 0 ? { verdicts: runVerdicts } : {}),
                ...(sinceUtc ? { sinceUtc } : {}),
            })
            .then((paged) => {
                setRuns(paged.rows);
                setRunTotals({ total: paged.total, totalInSource: paged.totalInSource });
                // Default selection: newest run.
                if (selectedRunIds.length === 0 && paged.rows.length > 0) {
                    setSelectedRunIds([paged.rows[0].runId]);
                }
            });
    }, [rpc, sourceId, runText, runVerdicts, sinceUtc, props.dataVersion]);

    // Load scenario aggregates for the selection.
    useEffect(() => {
        if (selectedRunIds.length === 0) {
            setScenarios([]);
            return;
        }
        void rpc
            .sendRequest(PhQueryScenariosRequest.type, {
                sourceId,
                runIds: selectedRunIds,
                ...(baselineRunId ? { baselineRunId } : {}),
                metric,
                groupBy,
                ...(scenarioText ? { text: scenarioText } : {}),
                ...(scenarioVerdicts.length > 0 ? { verdicts: scenarioVerdicts } : {}),
                ...(suite ? { suite } : {}),
                ...(artifactKind ? { artifactKind } : {}),
            })
            .then((rows) => {
                setScenarios(rows);
                if (
                    focusScenarioId &&
                    !rows.some((r) => r.scenarioId === focusScenarioId) &&
                    rows.length > 0
                ) {
                    setFocusScenarioId(rows[0].scenarioId);
                }
                if (!focusScenarioId && rows.length > 0) {
                    setFocusScenarioId(rows[0].scenarioId);
                }
            });
    }, [
        rpc,
        sourceId,
        selectedRunIds,
        baselineRunId,
        metric,
        groupBy,
        scenarioText,
        scenarioVerdicts,
        suite,
        artifactKind,
        props.dataVersion,
    ]);

    // Load details + series for the focused scenario.
    const primaryRunId = selectedRunIds[0];
    useEffect(() => {
        if (!focusScenarioId || !primaryRunId) {
            setDetails(undefined);
            setSeries([]);
            return;
        }
        void rpc
            .sendRequest(PhScenarioDetailsRequest.type, {
                sourceId,
                runId: primaryRunId,
                scenarioId: focusScenarioId,
                ...(baselineRunId ? { baselineRunId } : {}),
            })
            .then(setDetails);
        void rpc
            .sendRequest(PhMetricSeriesRequest.type, {
                sourceId,
                scenarioId: focusScenarioId,
                metric,
            })
            .then(setSeries);
    }, [rpc, sourceId, primaryRunId, focusScenarioId, metric, baselineRunId, props.dataVersion]);

    const suites = useMemo(
        () => [...new Set(scenarios.map((s) => s.suite).filter(Boolean))].sort() as string[],
        [scenarios],
    );
    const availableMetrics = useMemo(() => {
        const names = new Set<string>(["scenario.wallclock"]);
        for (const sub of details?.submetrics ?? []) {
            names.add(sub.name);
        }
        return [...names].sort();
    }, [details]);

    // Selection anchor for shift-click contiguous ranges.
    const anchorRunRef = useRef<string | undefined>(undefined);
    const toggleRun = (runId: string, multi: boolean, range: boolean) => {
        if (range && anchorRunRef.current) {
            const a = runs.findIndex((r) => r.runId === anchorRunRef.current);
            const b = runs.findIndex((r) => r.runId === runId);
            if (a >= 0 && b >= 0) {
                const [from, to] = a <= b ? [a, b] : [b, a];
                setSelectedRunIds(runs.slice(from, to + 1).map((r) => r.runId));
                return;
            }
        }
        if (multi) {
            setSelectedRunIds(
                selectedRunIds.includes(runId)
                    ? selectedRunIds.filter((id) => id !== runId)
                    : [...selectedRunIds, runId],
            );
        } else {
            setSelectedRunIds([runId]);
        }
        anchorRunRef.current = runId;
    };

    const deleteRun = (runId: string) => {
        void rpc.sendRequest(PhDeleteRunRequest.type, { sourceId, runId }).then((outcome) => {
            if (outcome.ok) {
                setSelectedRunIds(selectedRunIds.filter((id) => id !== runId));
                setRuns((current) => current.filter((r) => r.runId !== runId));
            }
        });
    };

    const activeChips: Array<{ label: string; clear: () => void }> = [
        ...(scenarioText ? [{ label: `"${scenarioText}"`, clear: () => setScenarioText("") }] : []),
        ...scenarioVerdicts.map((v) => ({
            label: v,
            clear: () => setScenarioVerdicts(scenarioVerdicts.filter((x) => x !== v)),
        })),
        ...(suite ? [{ label: suite, clear: () => setSuite("") }] : []),
        ...(artifactKind
            ? [{ label: `has:${artifactKind}`, clear: () => setArtifactKind("") }]
            : []),
        ...(timePreset !== "all"
            ? [
                  {
                      label: TIME_PRESETS.find((p) => p.id === timePreset)?.label ?? timePreset,
                      clear: () => setTimePreset("all"),
                  },
              ]
            : []),
    ];

    return (
        <div className="ph-analysis">
            {/* Source + runs region: collapses to a single toolbar row so the
                middle workbench gets the space (completions-style). */}
            {topCollapsed ? (
                <div className="dc-toolbar ph-cmdbar">
                    <button
                        className="dc-btn"
                        title="Expand the source bar and runs table"
                        onClick={() => setTopCollapsed(false)}>
                        ▸ Runs
                    </button>
                    <select value={sourceId} onChange={(e) => props.onPickSource(e.target.value)}>
                        {props.sources.map((source) => (
                            <option key={source.id} value={source.id}>
                                {source.label} · {source.runCount} runs
                            </option>
                        ))}
                    </select>
                    <span className="dc-mono dc-muted" style={{ fontSize: 11 }}>
                        {runTotals.total} of {runTotals.totalInSource}
                    </span>
                    {baselineRunId ? (
                        <span className="dc-badge" title={baselineRunId}>
                            baseline: {shortRunId(baselineRunId)}
                        </span>
                    ) : null}
                    <span className="dc-muted" style={{ marginLeft: "auto", fontSize: 11 }}>
                        {selectedRunIds.length > 0
                            ? `Selected: ${selectedRunIds.map(shortRunId).join(", ")}`
                            : ""}
                    </span>
                </div>
            ) : (
                <div className="dc-toolbar ph-cmdbar">
                    <button
                        className="dc-btn"
                        title="Collapse the source bar and runs table to one row"
                        onClick={() => setTopCollapsed(true)}>
                        ⌄ Runs
                    </button>
                    <select value={sourceId} onChange={(e) => props.onPickSource(e.target.value)}>
                        {props.sources.map((source) => (
                            <option key={source.id} value={source.id}>
                                {source.label} · {source.runCount} runs ({source.status})
                            </option>
                        ))}
                    </select>
                    <button className="dc-btn" onClick={() => props.onAddSource("directory")}>
                        Open directory…
                    </button>
                    <button className="dc-btn" onClick={() => props.onAddSource("sqlite")}>
                        Connect SQLite DB…
                    </button>
                    <button className="dc-btn" onClick={() => props.onAddSource("bundle")}>
                        Import bundle…
                    </button>
                    <button className="dc-btn" title="Rescan this source" onClick={props.onRescan}>
                        ⟳
                    </button>
                    <span style={{ flex: 1 }} />
                    <button
                        className="dc-btn"
                        disabled={!primaryRunId}
                        title="Pin the selected run as the baseline for deltas"
                        onClick={() =>
                            setBaselineRunId(
                                baselineRunId === primaryRunId ? undefined : primaryRunId,
                            )
                        }>
                        {baselineRunId === primaryRunId && baselineRunId !== undefined
                            ? "Unpin baseline"
                            : "Pin baseline"}
                    </button>
                    {baselineRunId ? (
                        <span className="dc-badge" title={baselineRunId}>
                            baseline: {shortRunId(baselineRunId)}
                        </span>
                    ) : null}
                </div>
            )}

            <PanelGroup
                key={`pg-${topCollapsed}-${bottomCollapsed}`}
                direction="vertical"
                className="ph-split-root">
                {/* Runs table (hidden entirely while collapsed) */}
                {!topCollapsed ? (
                    <>
                        <Panel defaultSize={30} minSize={15} className="dc-panel-min0">
                            <div className="ph-pane">
                                <div className="dc-toolbar ph-subbar">
                                    <b>Runs</b>
                                    <span className="dc-mono dc-muted">
                                        {runTotals.total} of {runTotals.totalInSource}
                                    </span>
                                    <input
                                        className="ph-search"
                                        placeholder="Search runs, labels, commit…"
                                        value={runText}
                                        onChange={(e) => setRunText(e.target.value)}
                                    />
                                    <select
                                        value={timePreset}
                                        onChange={(e) => setTimePreset(e.target.value)}>
                                        {TIME_PRESETS.map((preset) => (
                                            <option key={preset.id} value={preset.id}>
                                                {preset.label}
                                            </option>
                                        ))}
                                    </select>
                                    <select
                                        value={runVerdicts[0] ?? ""}
                                        onChange={(e) =>
                                            setRunVerdicts(
                                                e.target.value
                                                    ? [e.target.value as RunVerdict]
                                                    : [],
                                            )
                                        }>
                                        <option value="">Verdict: any</option>
                                        {VERDICTS.map((verdict) => (
                                            <option key={verdict} value={verdict}>
                                                {verdict}
                                            </option>
                                        ))}
                                    </select>
                                    <span
                                        className="dc-muted"
                                        style={{ marginLeft: "auto", fontSize: 11 }}>
                                        {selectedRunIds.length > 0
                                            ? `Selected: ${selectedRunIds.map(shortRunId).join(", ")}`
                                            : "click = select · ctrl+click = compare"}
                                    </span>
                                </div>
                                <RunsTable
                                    runs={runs}
                                    selectedRunIds={selectedRunIds}
                                    baselineRunId={baselineRunId}
                                    focusRunId={primaryRunId}
                                    onToggle={toggleRun}
                                    onDelete={deleteRun}
                                />
                            </div>
                        </Panel>
                        <PanelResizeHandle className="dc-resize-handle horizontal" />
                    </>
                ) : null}

                {/* Middle: filter rail | scenario table | charts */}
                <Panel defaultSize={40} minSize={20} className="dc-panel-min0">
                    <PanelGroup direction="horizontal" className="ph-split-inner">
                        {railCollapsed ? (
                            <div className="ph-rail-collapsed">
                                <button
                                    className="dc-btn"
                                    title="Expand filters"
                                    onClick={() => setRailCollapsed(false)}>
                                    ⧉
                                </button>
                            </div>
                        ) : (
                            <>
                                <Panel defaultSize={16} minSize={10} className="dc-panel-min0">
                                    <div className="ph-pane ph-rail">
                                        <div className="ph-rail-head">
                                            <b>FILTERS</b>
                                            <span style={{ flex: 1 }} />
                                            <button
                                                className="dc-modal-close"
                                                title="Collapse filters"
                                                onClick={() => setRailCollapsed(true)}>
                                                «
                                            </button>
                                        </div>
                                        <input
                                            className="ph-search"
                                            placeholder="scenario, suite…"
                                            value={scenarioText}
                                            onChange={(e) => setScenarioText(e.target.value)}
                                        />
                                        <div className="ph-rail-group">
                                            <label>Verdict</label>
                                            {VERDICTS.map((verdict) => (
                                                <label className="ph-check" key={verdict}>
                                                    <input
                                                        type="checkbox"
                                                        checked={scenarioVerdicts.includes(verdict)}
                                                        onChange={(e) =>
                                                            setScenarioVerdicts(
                                                                e.target.checked
                                                                    ? [...scenarioVerdicts, verdict]
                                                                    : scenarioVerdicts.filter(
                                                                          (x) => x !== verdict,
                                                                      ),
                                                            )
                                                        }
                                                    />
                                                    {verdict}
                                                </label>
                                            ))}
                                        </div>
                                        <div className="ph-rail-group">
                                            <label>Suite</label>
                                            <select
                                                value={suite}
                                                onChange={(e) => setSuite(e.target.value)}>
                                                <option value="">all</option>
                                                {suites.map((name) => (
                                                    <option key={name} value={name}>
                                                        {name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="ph-rail-group">
                                            <label>Artifacts</label>
                                            <select
                                                value={artifactKind}
                                                onChange={(e) => setArtifactKind(e.target.value)}>
                                                <option value="">any</option>
                                                {[
                                                    "markers",
                                                    "sqlActivity",
                                                    "rendererTrace",
                                                    "soak",
                                                    "heapSnapshot",
                                                    "gcDump",
                                                ].map((kind) => (
                                                    <option key={kind} value={kind}>
                                                        {kind}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                </Panel>
                                <PanelResizeHandle className="dc-resize-handle" />
                            </>
                        )}
                        <Panel defaultSize={52} minSize={30} className="dc-panel-min0">
                            <div className="ph-pane">
                                <div className="dc-toolbar ph-subbar">
                                    <select
                                        value={groupBy}
                                        onChange={(e) =>
                                            setGroupBy(e.target.value as ScenarioGroupBy)
                                        }>
                                        <option value="scenario">View: Scenario summary</option>
                                        <option value="suite">Group by suite</option>
                                        <option value="verdict">Group by verdict</option>
                                        <option value="run">Group by run</option>
                                    </select>
                                    <select
                                        value={metric}
                                        onChange={(e) => setMetric(e.target.value)}>
                                        {availableMetrics.map((name) => (
                                            <option key={name} value={name}>
                                                {name}
                                            </option>
                                        ))}
                                    </select>
                                    <span className="dc-muted" style={{ fontSize: 11 }}>
                                        {scenarios.length} row(s)
                                        {baselineRunId
                                            ? ` · vs ${shortRunId(baselineRunId)}`
                                            : " · vs previous run"}
                                    </span>
                                </div>
                                {activeChips.length > 0 ? (
                                    <div className="ph-chips">
                                        {activeChips.map((chip, index) => (
                                            <span
                                                className="dc-chip"
                                                key={index}
                                                onClick={chip.clear}>
                                                {chip.label} ×
                                            </span>
                                        ))}
                                        <span
                                            className="dc-muted"
                                            style={{ cursor: "pointer", fontSize: 11 }}
                                            onClick={() => {
                                                setScenarioText("");
                                                setScenarioVerdicts([]);
                                                setSuite("");
                                                setArtifactKind("");
                                                setTimePreset("all");
                                            }}>
                                            Clear all
                                        </span>
                                    </div>
                                ) : null}
                                <ScenarioTable
                                    rows={scenarios}
                                    focusScenarioId={focusScenarioId}
                                    focusGroupKey={focusGroup?.key}
                                    onFocus={(row) => {
                                        if (row.scenarioId) {
                                            setFocusScenarioId(row.scenarioId);
                                            setFocusGroup(undefined);
                                        } else if (row.memberScenarioIds?.length) {
                                            setFocusGroup(row);
                                        }
                                    }}
                                />
                            </div>
                        </Panel>
                        <PanelResizeHandle className="dc-resize-handle" />
                        <Panel defaultSize={32} minSize={18} className="dc-panel-min0">
                            <ChartsRail
                                focus={
                                    focusGroup ??
                                    scenarios.find((s) => s.scenarioId === focusScenarioId)
                                }
                                details={focusGroup ? undefined : details}
                                series={focusGroup ? [] : series}
                                metric={metric}
                            />
                        </Panel>
                    </PanelGroup>
                </Panel>
                {!bottomCollapsed ? (
                    <PanelResizeHandle className="dc-resize-handle horizontal" />
                ) : null}

                {/* Bottom detail tabs / group member browser */}
                {!bottomCollapsed ? (
                    <Panel defaultSize={30} minSize={15} className="dc-panel-min0">
                        {focusGroup ? (
                            <div className="ph-pane">
                                <div className="ph-bottom-tabs">
                                    <b style={{ fontSize: 12, padding: "4px 6px" }}>
                                        Group: {focusGroup.key}
                                    </b>
                                    <span className="dc-muted" style={{ fontSize: 11 }}>
                                        {memberRows.length} member scenario(s) — select one to drill
                                        into its reps, waterfall, and artifacts
                                    </span>
                                    <span style={{ flex: 1 }} />
                                    <button
                                        className="dc-modal-close"
                                        title="Close group"
                                        onClick={() => setFocusGroup(undefined)}>
                                        ×
                                    </button>
                                </div>
                                <ScenarioTable
                                    rows={memberRows}
                                    focusScenarioId={focusScenarioId}
                                    onFocus={(row) => {
                                        if (row.scenarioId) {
                                            setFocusScenarioId(row.scenarioId);
                                            setFocusGroup(undefined);
                                        }
                                    }}
                                />
                            </div>
                        ) : (
                            <BottomTabs
                                sourceId={sourceId}
                                runId={primaryRunId}
                                scenarioId={focusScenarioId}
                                details={details}
                                onCollapse={() => setBottomCollapsed(true)}
                            />
                        )}
                    </Panel>
                ) : null}
            </PanelGroup>

            {/* Collapsed bottom: just the tab strip — clicking a tab expands. */}
            {bottomCollapsed ? (
                <div className="ph-bottom-tabs" style={{ borderTop: "1px solid var(--dc-border)" }}>
                    <button
                        className="ph-tab"
                        title="Expand the detail tabs"
                        onClick={() => setBottomCollapsed(false)}>
                        ▴
                    </button>
                    {[
                        "Submetrics",
                        "Waterfall",
                        "SQL Activity",
                        "Diagnostics",
                        "Artifacts",
                        "Validation",
                        "All Data Dump",
                    ].map((label) => (
                        <button
                            key={label}
                            className="ph-tab"
                            onClick={() => setBottomCollapsed(false)}>
                            {label}
                        </button>
                    ))}
                    <span className="dc-muted dc-mono" style={{ marginLeft: "auto", fontSize: 11 }}>
                        {focusScenarioId ?? ""}
                    </span>
                </div>
            ) : null}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Runs table (virtualized)
// ---------------------------------------------------------------------------

const RUN_ROW_HEIGHT = 28;

function RunsTable(props: {
    runs: PerfRunRow[];
    selectedRunIds: string[];
    baselineRunId?: string;
    /** Primary selection — scrolled into view when it changes (trend drill-in). */
    focusRunId?: string;
    onToggle: (runId: string, multi: boolean, range: boolean) => void;
    onDelete: (runId: string) => void;
}) {
    const virtual = useVirtualRows(props.runs.length, RUN_ROW_HEIGHT);
    const visible = props.runs.slice(virtual.start, virtual.end);

    // Keep the focused run visible (e.g. after clicking a trend point on the
    // Runs Summary tab and landing here).
    useEffect(() => {
        const el = virtual.ref.current;
        if (!el || !props.focusRunId) {
            return;
        }
        const index = props.runs.findIndex((r) => r.runId === props.focusRunId);
        if (index < 0) {
            return;
        }
        const top = index * RUN_ROW_HEIGHT;
        if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - RUN_ROW_HEIGHT * 2) {
            el.scrollTop = Math.max(0, top - el.clientHeight / 3);
        }
    }, [props.focusRunId, props.runs]);

    return (
        <div
            className="dc-table-wrap ph-fill-scroll ph-noselect"
            ref={virtual.ref}
            onScroll={virtual.onScroll}>
            {/* Fixed layout: column widths never shift as virtualized rows
                scroll in/out, and rows keep a single fixed height. */}
            <table className="dc-table ph-dense ph-table-fixed">
                <colgroup>
                    <col style={{ width: 112 }} />
                    <col style={{ width: 132 }} />
                    <col style={{ width: 200 }} />
                    <col style={{ width: 90 }} />
                    <col style={{ width: 92 }} />
                    <col style={{ width: 72 }} />
                    <col style={{ width: 58 }} />
                    <col style={{ width: 50 }} />
                    <col style={{ width: 46 }} />
                    <col style={{ width: 52 }} />
                    <col style={{ width: 72 }} />
                    <col style={{ width: 72 }} />
                    <col style={{ width: 64 }} />
                    <col />
                    <col style={{ width: 54 }} />
                </colgroup>
                <thead>
                    <tr>
                        <th>Status</th>
                        <th>Created (UTC)</th>
                        <th>Run</th>
                        <th>Label</th>
                        <th>Commit</th>
                        <th>Env</th>
                        <th className="num">Scen</th>
                        <th className="num">Reps</th>
                        <th className="num">Fail</th>
                        <th className="num">Inval</th>
                        <th className="num">p50</th>
                        <th className="num">p95</th>
                        <th>Conn</th>
                        <th>Artifacts</th>
                        <th />
                    </tr>
                </thead>
                <tbody>
                    {virtual.topPad > 0 ? (
                        <tr style={{ height: virtual.topPad }}>
                            <td colSpan={15} />
                        </tr>
                    ) : null}
                    {visible.map((run) => (
                        <tr
                            key={run.runId}
                            style={{ height: RUN_ROW_HEIGHT }}
                            className={props.selectedRunIds.includes(run.runId) ? "selected" : ""}
                            onClick={(e) =>
                                props.onToggle(run.runId, e.ctrlKey || e.metaKey, e.shiftKey)
                            }>
                            <td>
                                <VerdictPill verdict={run.verdict} />
                                {props.baselineRunId === run.runId ? (
                                    <span className="dc-badge" style={{ marginLeft: 4 }}>
                                        baseline
                                    </span>
                                ) : null}
                            </td>
                            <td className="dc-mono dc-muted">
                                {run.createdUtc.replace("T", " ").replace("Z", "")}
                            </td>
                            <td className="dc-mono" title={run.runId}>
                                {shortRunId(run.runId)}
                            </td>
                            <td className="dc-muted">{run.label ?? "—"}</td>
                            <td className="dc-mono">
                                {run.commit ?? "—"}
                                {run.dirty ? <span className="dc-badge">dirty</span> : null}
                            </td>
                            <td className="dc-mono dc-muted">
                                {(run.environmentHash ?? "—").slice(0, 8)}
                            </td>
                            <td className="num dc-mono">
                                {run.scenarioPassed}/{run.scenarioTotal}
                            </td>
                            <td className="num dc-mono">{run.repTotal}</td>
                            <td className="num dc-mono">
                                {run.failedReps > 0 ? (
                                    <span style={{ color: "var(--dc-error)" }}>
                                        {run.failedReps}
                                    </span>
                                ) : (
                                    0
                                )}
                            </td>
                            <td className="num dc-mono">{run.invalidReps}</td>
                            <td className="num dc-mono">
                                {run.wallP50Ms !== undefined ? formatDuration(run.wallP50Ms) : "—"}
                            </td>
                            <td className="num dc-mono">
                                {run.wallP95Ms !== undefined ? formatDuration(run.wallP95Ms) : "—"}
                            </td>
                            <td className="dc-muted">{run.connectionMode ?? "—"}</td>
                            <td>
                                <ArtifactBadges kinds={run.artifactKinds} />
                            </td>
                            <td className="num">
                                <button
                                    className="dc-btn ph-row-action"
                                    title="Delete this run (removes the run directory from disk)"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        props.onDelete(run.runId);
                                    }}>
                                    🗑
                                </button>
                            </td>
                        </tr>
                    ))}
                    {virtual.bottomPad > 0 ? (
                        <tr style={{ height: virtual.bottomPad }}>
                            <td colSpan={15} />
                        </tr>
                    ) : null}
                </tbody>
            </table>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Scenario table
// ---------------------------------------------------------------------------

function ScenarioTable(props: {
    rows: PerfScenarioRow[];
    focusScenarioId?: string;
    focusGroupKey?: string;
    onFocus: (row: PerfScenarioRow) => void;
}) {
    if (props.rows.length === 0) {
        return (
            <div className="dc-muted" style={{ padding: 16 }}>
                No scenarios match the current selection/filters.
            </div>
        );
    }
    return (
        <div className="dc-table-wrap ph-fill-scroll">
            <table className="dc-table ph-dense ph-table-fixed">
                <colgroup>
                    <col style={{ width: 250 }} />
                    <col style={{ width: 110 }} />
                    <col style={{ width: 84 }} />
                    <col style={{ width: 62 }} />
                    <col style={{ width: 72 }} />
                    <col style={{ width: 72 }} />
                    <col style={{ width: 80 }} />
                    <col style={{ width: 64 }} />
                    <col />
                </colgroup>
                <thead>
                    <tr>
                        <th>Scenario / group</th>
                        <th>Suite</th>
                        <th>Status</th>
                        <th className="num">Reps</th>
                        <th className="num">p50</th>
                        <th className="num">p95</th>
                        <th className="num">Base p50</th>
                        <th className="num">Δ%</th>
                        <th>Artifacts</th>
                    </tr>
                </thead>
                <tbody>
                    {props.rows.map((row) => (
                        <tr
                            key={row.key}
                            className={
                                (row.scenarioId !== undefined &&
                                    row.scenarioId === props.focusScenarioId) ||
                                (row.scenarioId === undefined && row.key === props.focusGroupKey)
                                    ? "selected"
                                    : ""
                            }
                            onClick={() => props.onFocus(row)}>
                            <td className="dc-mono">
                                {row.key}
                                {row.lowConfidence ? (
                                    <span
                                        className="dc-badge"
                                        title="Fewer than 3 valid reps — aggregates are advisory"
                                        style={{
                                            marginLeft: 6,
                                            color: "var(--dc-warn)",
                                        }}>
                                        low-n
                                    </span>
                                ) : null}
                                {row.skippedReason ? (
                                    <span
                                        className="dc-badge"
                                        title={row.skippedReason}
                                        style={{ marginLeft: 6 }}>
                                        skipped
                                    </span>
                                ) : null}
                            </td>
                            <td className="dc-muted">{row.suite ?? "—"}</td>
                            <td>
                                <VerdictPill verdict={row.verdict} />
                            </td>
                            <td className="num dc-mono">
                                {row.validReps}/{row.totalReps}
                            </td>
                            <td className="num dc-mono">
                                {row.p50Ms !== undefined ? formatDuration(row.p50Ms) : "—"}
                            </td>
                            <td className="num dc-mono">
                                {row.p95Ms !== undefined ? formatDuration(row.p95Ms) : "—"}
                            </td>
                            <td className="num dc-mono dc-muted">
                                {row.baselineP50Ms !== undefined
                                    ? formatDuration(row.baselineP50Ms)
                                    : "—"}
                            </td>
                            <td className="num dc-mono">
                                {row.deltaPct !== undefined ? (
                                    <span
                                        style={{
                                            color:
                                                row.deltaPct > 10
                                                    ? "var(--dc-error)"
                                                    : row.deltaPct < -10
                                                      ? "var(--dc-ok)"
                                                      : undefined,
                                        }}>
                                        {row.deltaPct > 0 ? "+" : ""}
                                        {row.deltaPct}%
                                    </span>
                                ) : (
                                    "—"
                                )}
                            </td>
                            <td>
                                <ArtifactBadges kinds={row.artifactKinds} />
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Charts rail
// ---------------------------------------------------------------------------

function ChartsRail(props: {
    focus: PerfScenarioRow | undefined;
    details: PerfScenarioDetails | undefined;
    series: PerfMetricSeriesPoint[];
    metric: string;
}) {
    const { focus, details, series, metric } = props;
    if (!focus) {
        return (
            <div className="ph-pane" style={{ padding: 16 }}>
                <span className="dc-muted">Select a scenario to see charts.</span>
            </div>
        );
    }
    const repValues = (details?.reps ?? [])
        .filter((rep) => !rep.warmup && rep.status === "passed")
        .map((rep) => rep.metrics.find((m) => m.name === metric)?.value)
        .filter((value): value is number => typeof value === "number");
    const band =
        focus.baselineP50Ms !== undefined
            ? {
                  center: focus.baselineP50Ms,
                  halfWidth: focus.baselineP50Ms * 0.1,
                  label: "baseline ±10%",
              }
            : undefined;
    const deltaEntries = (details?.submetrics ?? [])
        .filter((sub) => sub.deltaPct !== undefined)
        .slice(0, 8)
        .map((sub) => ({
            label: `${sub.name}${sub.official ? "" : " (diag)"}`,
            deltaPct: sub.deltaPct!,
            detail: `${sub.baselineP50 ?? "—"} → ${sub.p50 ?? "—"} ${sub.unit}`,
        }));
    return (
        <div className="ph-pane ph-fill-scroll" style={{ padding: "0 8px" }}>
            <div className="dc-kpis" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
                <Kpi
                    label={`${metric} p50`}
                    value={focus.p50Ms !== undefined ? formatDuration(focus.p50Ms) : "—"}
                    note={
                        focus.deltaPct !== undefined
                            ? `${focus.deltaPct > 0 ? "+" : ""}${focus.deltaPct}%`
                            : undefined
                    }
                    tone={focus.deltaPct !== undefined && focus.deltaPct > 10 ? "error" : undefined}
                />
                <Kpi
                    label="Valid reps"
                    value={`${focus.validReps}/${focus.totalReps}`}
                    tone={focus.lowConfidence ? "warn" : undefined}
                    note={focus.lowConfidence ? "low confidence" : "official"}
                />
            </div>
            <div className="dc-card" style={{ margin: "8px 0" }}>
                <div className="dc-card-title">
                    Trend over runs
                    <span className="right">{series.length} runs</span>
                </div>
                {series.length === 0 ? (
                    <span className="dc-muted">
                        No official samples for {metric} across runs yet.
                    </span>
                ) : (
                    <TrendChart
                        height={150}
                        points={series.map((point, index) => ({
                            x: index,
                            y: point.p50,
                            label: `${point.runId}\np50 ${formatDuration(point.p50)} · ${point.n} reps`,
                        }))}
                        {...(band ? { band } : {})}
                    />
                )}
            </div>
            <div className="dc-card" style={{ margin: "8px 0" }}>
                <div className="dc-card-title">
                    Distribution · selected run
                    <span className="right">{repValues.length} valid reps</span>
                </div>
                {repValues.length === 0 ? (
                    <span className="dc-muted">No valid rep samples in the selected run.</span>
                ) : (
                    <Histogram values={repValues} />
                )}
            </div>
            {deltaEntries.length > 0 ? (
                <div className="dc-card" style={{ margin: "8px 0" }}>
                    <div className="dc-card-title">
                        Metric deltas vs baseline
                        <span className="right">red = higher</span>
                    </div>
                    <DeltaBars entries={deltaEntries} />
                </div>
            ) : null}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Bottom tabs (lazy)
// ---------------------------------------------------------------------------

type PhBottomTab =
    | "submetrics"
    | "waterfall"
    | "sql"
    | "diag"
    | "artifacts"
    | "validation"
    | "dump";

function BottomTabs(props: {
    sourceId: string;
    runId: string | undefined;
    scenarioId: string | undefined;
    details: PerfScenarioDetails | undefined;
    onCollapse?: () => void;
}) {
    const [tab, setTab] = useState<PhBottomTab>("submetrics");
    const { details } = props;
    const hasMarkers = (details?.reps ?? []).some((rep) => rep.hasMarkers);
    const hasSql = (details?.artifacts ?? []).some((a) => a.kind === "sqlActivity");
    const tabs: Array<{ id: PhBottomTab; label: string; enabled: boolean; hint?: string }> = [
        { id: "submetrics", label: "Submetrics", enabled: true },
        {
            id: "waterfall",
            label: "Waterfall",
            enabled: hasMarkers,
            hint: hasMarkers ? undefined : "no markers.jsonl captured for these reps",
        },
        {
            id: "sql",
            label: "SQL Activity",
            enabled: hasSql,
            hint: hasSql ? undefined : "no sql-activity.jsonl captured (CLI XEvents runs only)",
        },
        {
            id: "diag",
            label: "Diagnostics",
            enabled: hasMarkers,
            hint: hasMarkers
                ? "rich diagnostics collected with 'Collect rich diagnostics' runs"
                : "no markers captured for these reps",
        },
        {
            id: "artifacts",
            label: `Artifacts${details ? ` ${details.artifacts.length}` : ""}`,
            enabled: true,
        },
        {
            id: "validation",
            label: `Validation${details && details.validations.length > 0 ? ` ${details.validations.length}` : ""}`,
            enabled: true,
        },
        { id: "dump", label: "All Data Dump", enabled: true },
    ];
    const active = tabs.find((t) => t.id === tab && t.enabled) ? tab : "submetrics";
    return (
        <div className="ph-pane">
            <div className="ph-bottom-tabs">
                {tabs.map((entry) => (
                    <button
                        key={entry.id}
                        className={`ph-tab ${active === entry.id ? "active" : ""}`}
                        disabled={!entry.enabled}
                        title={entry.hint}
                        onClick={() => setTab(entry.id)}>
                        {entry.label}
                    </button>
                ))}
                <span className="dc-muted dc-mono" style={{ marginLeft: "auto", fontSize: 11 }}>
                    {props.scenarioId ?? ""}
                </span>
                {props.onCollapse ? (
                    <button
                        className="ph-tab"
                        title="Collapse the detail tabs to a single row"
                        onClick={props.onCollapse}>
                        ▾
                    </button>
                ) : null}
            </div>
            <div className="ph-fill-scroll" style={{ padding: "6px 8px" }}>
                {!props.runId || !props.scenarioId ? (
                    <span className="dc-muted">Select a run and scenario above.</span>
                ) : active === "submetrics" ? (
                    <SubmetricsTab details={details} />
                ) : active === "waterfall" ? (
                    <WaterfallTab
                        sourceId={props.sourceId}
                        runId={props.runId}
                        scenarioId={props.scenarioId}
                        details={details}
                    />
                ) : active === "sql" ? (
                    <SqlTab
                        sourceId={props.sourceId}
                        runId={props.runId}
                        scenarioId={props.scenarioId}
                        details={details}
                    />
                ) : active === "diag" ? (
                    <DiagnosticsTab
                        sourceId={props.sourceId}
                        runId={props.runId}
                        scenarioId={props.scenarioId}
                        details={details}
                    />
                ) : active === "artifacts" ? (
                    <ArtifactsTab details={details} />
                ) : active === "validation" ? (
                    <ValidationTab details={details} />
                ) : (
                    <DumpTab
                        sourceId={props.sourceId}
                        runId={props.runId}
                        scenarioId={props.scenarioId}
                        details={details}
                    />
                )}
            </div>
        </div>
    );
}

function SubmetricsTab({ details }: { details: PerfScenarioDetails | undefined }) {
    if (!details || details.submetrics.length === 0) {
        return (
            <span className="dc-muted">
                {details?.skippedReason
                    ? `Scenario skipped: ${details.skippedReason}`
                    : "No metric samples recorded for this scenario in the selected run."}
            </span>
        );
    }
    return (
        <table className="dc-table ph-dense">
            <thead>
                <tr>
                    <th>Metric</th>
                    <th className="num">p50</th>
                    <th className="num">Baseline p50</th>
                    <th className="num">Δ%</th>
                    <th>Official</th>
                    <th className="num">n</th>
                    <th>Unit</th>
                </tr>
            </thead>
            <tbody>
                {details.submetrics.map((sub) => (
                    <tr key={sub.name}>
                        <td className="dc-mono">{sub.name}</td>
                        <td className="num dc-mono">{sub.p50 ?? "—"}</td>
                        <td className="num dc-mono dc-muted">{sub.baselineP50 ?? "—"}</td>
                        <td className="num dc-mono">
                            {sub.deltaPct !== undefined ? (
                                <span
                                    style={{
                                        color:
                                            sub.deltaPct > 10
                                                ? "var(--dc-error)"
                                                : sub.deltaPct < -10
                                                  ? "var(--dc-ok)"
                                                  : undefined,
                                    }}>
                                    {sub.deltaPct > 0 ? "+" : ""}
                                    {sub.deltaPct}%
                                </span>
                            ) : (
                                "—"
                            )}
                        </td>
                        <td>
                            <span className={`dc-pill ${sub.official ? "ok" : "info"}`}>
                                {sub.official ? "official" : "diag"}
                            </span>
                        </td>
                        <td className="num dc-mono">{sub.n}</td>
                        <td className="dc-muted">{sub.unit}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function WaterfallTab(props: {
    sourceId: string;
    runId: string;
    scenarioId: string;
    details: PerfScenarioDetails | undefined;
}) {
    const { rpc } = useDc();
    const reps = (props.details?.reps ?? []).filter((rep) => rep.hasMarkers);
    const [repId, setRepId] = useState<number | undefined>(undefined);
    const [model, setModel] = useState<WaterfallModel | undefined>(undefined);
    const effectiveRep = repId ?? reps[reps.length - 1]?.repId;

    useEffect(() => {
        if (effectiveRep === undefined) {
            setModel(undefined);
            return;
        }
        void rpc
            .sendRequest(PhGetWaterfallRequest.type, {
                sourceId: props.sourceId,
                runId: props.runId,
                scenarioId: props.scenarioId,
                repId: effectiveRep,
            })
            .then(setModel);
    }, [rpc, props.sourceId, props.runId, props.scenarioId, effectiveRep]);

    if (reps.length === 0) {
        return <span className="dc-muted">No reps with captured markers.</span>;
    }
    return (
        <>
            <div className="dc-toolbar">
                <span className="dc-muted">Rep</span>
                <select value={effectiveRep} onChange={(e) => setRepId(Number(e.target.value))}>
                    {reps.map((rep) => (
                        <option key={rep.repId} value={rep.repId}>
                            #{rep.repId} · {rep.status}
                            {rep.warmup ? " · warmup" : ""}
                        </option>
                    ))}
                </select>
            </div>
            {model ? (
                <WaterfallView model={model} />
            ) : (
                <span className="dc-muted">Loading waterfall…</span>
            )}
        </>
    );
}

function SqlTab(props: {
    sourceId: string;
    runId: string;
    scenarioId: string;
    details: PerfScenarioDetails | undefined;
}) {
    const { rpc } = useDc();
    const [rows, setRows] = useState<SqlActivityRow[] | undefined>(undefined);
    const repWithSql = (props.details?.artifacts ?? []).find((a) => a.kind === "sqlActivity");

    useEffect(() => {
        if (!repWithSql) {
            setRows([]);
            return;
        }
        void rpc
            .sendRequest(PhGetSqlActivityRequest.type, {
                sourceId: props.sourceId,
                runId: props.runId,
                scenarioId: props.scenarioId,
                repId: repWithSql.repId ?? 0,
            })
            .then(setRows);
    }, [rpc, props.sourceId, props.runId, props.scenarioId, repWithSql?.path]);

    if (!rows) {
        return <span className="dc-muted">Loading SQL activity…</span>;
    }
    if (rows.length === 0) {
        return <span className="dc-muted">No SQL activity captured for this scenario.</span>;
    }
    return (
        <table className="dc-table ph-dense">
            <thead>
                <tr>
                    <th>Event</th>
                    <th className="num">Duration</th>
                    <th className="num">CPU</th>
                    <th className="num">Reads</th>
                    <th className="num">Rows</th>
                    <th>Text</th>
                </tr>
            </thead>
            <tbody>
                {rows.slice(0, 200).map((row, index) => (
                    <tr key={index}>
                        <td className="dc-mono">{row.eventName}</td>
                        <td className="num dc-mono">{formatDuration(row.durationMs)}</td>
                        <td className="num dc-mono">{formatDuration(row.cpuMs)}</td>
                        <td className="num dc-mono">{row.logicalReads ?? "—"}</td>
                        <td className="num dc-mono">{row.rowCount ?? "—"}</td>
                        <td>
                            <RedactedField value={row.text} />
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

/**
 * Rich diagnostics for a rep (COLLECT_ALL_THE_DATA runs): memory/CPU/event-loop
 * counter series plus the spans with the largest heap deltas. Honest empty
 * state when the run wasn't collected with rich diagnostics.
 */
function DiagnosticsTab(props: {
    sourceId: string;
    runId: string;
    scenarioId: string;
    details: PerfScenarioDetails | undefined;
}) {
    const { rpc } = useDc();
    const reps = (props.details?.reps ?? []).filter((rep) => rep.hasMarkers);
    const [repId, setRepId] = useState<number | undefined>(undefined);
    const [rich, setRich] = useState<PerfRichDiagnostics | undefined>(undefined);
    const effectiveRep = repId ?? reps[reps.length - 1]?.repId;

    useEffect(() => {
        if (effectiveRep === undefined) {
            setRich(undefined);
            return;
        }
        void rpc
            .sendRequest(PhGetRichDiagnosticsRequest.type, {
                sourceId: props.sourceId,
                runId: props.runId,
                scenarioId: props.scenarioId,
                repId: effectiveRep,
            })
            .then(setRich);
    }, [rpc, props.sourceId, props.runId, props.scenarioId, effectiveRep]);

    if (reps.length === 0) {
        return <span className="dc-muted">No reps with captured markers.</span>;
    }
    if (!rich) {
        return <span className="dc-muted">Loading diagnostics…</span>;
    }
    if (!rich.found) {
        return (
            <span className="dc-muted">
                No rich diagnostics in this rep — run the self-test with{" "}
                <b>Collect rich diagnostics</b> checked (or set mssql.debugConsole.richCollection)
                and the memory/CPU/event-loop counters land here.
            </span>
        );
    }
    const heapSeries = rich.snapshots
        .map((s) => s.metrics["heapUsedMB"])
        .filter((v): v is number => typeof v === "number");
    const loopSeries = rich.snapshots
        .map((s) => s.metrics["eventLoopP95Ms"])
        .filter((v): v is number => typeof v === "number");
    const latest = rich.snapshots[rich.snapshots.length - 1]?.metrics ?? {};
    return (
        <div>
            <div className="dc-toolbar">
                <span className="dc-muted">Rep</span>
                <select value={effectiveRep} onChange={(e) => setRepId(Number(e.target.value))}>
                    {reps.map((rep) => (
                        <option key={rep.repId} value={rep.repId}>
                            #{rep.repId} · {rep.status}
                            {rep.warmup ? " · warmup" : ""}
                        </option>
                    ))}
                </select>
                <span className="dc-muted" style={{ fontSize: 11 }}>
                    {rich.snapshots.length} snapshot(s) · 2s cadence · diagnostic-only, never
                    official
                </span>
            </div>
            <div className="dc-kpis" style={{ gridTemplateColumns: "repeat(4, minmax(0,1fr))" }}>
                {["heapUsedMB", "rssMB", "eventLoopP95Ms", "cpuUserMs"].map((key) => (
                    <Kpi
                        key={key}
                        label={key}
                        value={latest[key] !== undefined ? latest[key] : "—"}
                    />
                ))}
            </div>
            <div className="dc-two-col">
                <div className="dc-card">
                    <div className="dc-card-title">
                        Heap used (MB) over the rep
                        <span className="right">{heapSeries.length} samples</span>
                    </div>
                    {heapSeries.length >= 2 ? (
                        <TrendChart
                            height={130}
                            unitFormat={(v) => `${v.toFixed(1)} MB`}
                            points={heapSeries.map((v, i) => ({
                                x: i,
                                y: v,
                                label: `sample ${i}\n${v.toFixed(1)} MB`,
                            }))}
                        />
                    ) : (
                        <span className="dc-muted">not enough samples for a trend</span>
                    )}
                </div>
                <div className="dc-card">
                    <div className="dc-card-title">
                        Event-loop p95 (ms)
                        <span className="right">{loopSeries.length} samples</span>
                    </div>
                    {loopSeries.length >= 2 ? (
                        <TrendChart
                            height={130}
                            unitFormat={(v) => `${v.toFixed(1)} ms`}
                            points={loopSeries.map((v, i) => ({
                                x: i,
                                y: v,
                                label: `sample ${i}\n${v.toFixed(2)} ms`,
                            }))}
                        />
                    ) : (
                        <span className="dc-muted">not enough samples for a trend</span>
                    )}
                </div>
            </div>
            {rich.spanDeltas.length > 0 ? (
                <div className="dc-card">
                    <div className="dc-card-title">
                        Spans by heap delta
                        <span className="right">top {rich.spanDeltas.length}</span>
                    </div>
                    <table className="dc-table ph-dense">
                        <thead>
                            <tr>
                                <th>Span</th>
                                <th className="num">Duration</th>
                                <th className="num">Heap Δ (KB)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rich.spanDeltas.slice(0, 20).map((span, index) => (
                                <tr key={index}>
                                    <td className="dc-mono">{span.type}</td>
                                    <td className="num dc-mono">
                                        {formatDuration(span.durationMs)}
                                    </td>
                                    <td className="num dc-mono">{span.heapDeltaKB ?? "—"}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : null}
        </div>
    );
}

function ArtifactsTab({ details }: { details: PerfScenarioDetails | undefined }) {
    const artifacts = details?.artifacts ?? [];
    if (artifacts.length === 0) {
        return <span className="dc-muted">No artifacts recorded for this scenario.</span>;
    }
    return (
        <table className="dc-table ph-dense">
            <thead>
                <tr>
                    <th>Kind</th>
                    <th className="num">Rep</th>
                    <th className="num">Size</th>
                    <th>Path</th>
                </tr>
            </thead>
            <tbody>
                {artifacts.map((artifact, index) => (
                    <tr key={index}>
                        <td>
                            <span className="dc-badge">{artifact.kind}</span>
                        </td>
                        <td className="num dc-mono">{artifact.repId ?? "—"}</td>
                        <td className="num dc-mono">
                            {artifact.sizeBytes !== undefined
                                ? `${(artifact.sizeBytes / 1024).toFixed(1)} KB`
                                : "—"}
                        </td>
                        <td className="dc-mono dc-muted" style={{ fontSize: 10.5 }}>
                            {artifact.path}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function ValidationTab({ details }: { details: PerfScenarioDetails | undefined }) {
    const validations = details?.validations ?? [];
    const failures = (details?.reps ?? []).filter((rep) => rep.failureReason);
    if (validations.length === 0 && failures.length === 0 && !details?.skippedReason) {
        return <span className="dc-muted">No validation records for this scenario.</span>;
    }
    return (
        <div>
            {details?.skippedReason ? (
                <div className="ph-callout" style={{ marginBottom: 8 }}>
                    <span className="ph-callout-icon">⊘</span>
                    <span>Scenario skipped: {details.skippedReason}</span>
                </div>
            ) : null}
            {failures.map((rep) => (
                <div key={rep.repId} className="dc-run-line" style={{ padding: "2px 0" }}>
                    <span className="rl-fail dc-mono">rep {rep.repId}</span>
                    <span style={{ whiteSpace: "normal" }}>{rep.failureReason}</span>
                </div>
            ))}
            {validations.length > 0 ? (
                <table className="dc-table ph-dense" style={{ marginTop: 6 }}>
                    <thead>
                        <tr>
                            <th>Check</th>
                            <th>Status</th>
                            <th>Message</th>
                        </tr>
                    </thead>
                    <tbody>
                        {validations.map((validation, index) => (
                            <tr key={index}>
                                <td className="dc-mono">{validation.name}</td>
                                <td>
                                    <VerdictPill
                                        verdict={validation.status === "passed" ? "ok" : "failed"}
                                    />
                                </td>
                                <td className="dc-muted">{validation.message ?? ""}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            ) : null}
        </div>
    );
}

function DumpTab(props: {
    sourceId: string;
    runId: string;
    scenarioId: string;
    details: PerfScenarioDetails | undefined;
}) {
    const { rpc } = useDc();
    const [file, setFile] = useState<"summary" | "result" | "markersHead">("result");
    const [repId, setRepId] = useState(0);
    const [dump, setDump] = useState<{ text: string; truncated: boolean; path: string }>();

    useEffect(() => {
        void rpc
            .sendRequest(PhGetDumpRequest.type, {
                sourceId: props.sourceId,
                runId: props.runId,
                scenarioId: props.scenarioId,
                repId,
                file,
            })
            .then(setDump);
    }, [rpc, props.sourceId, props.runId, props.scenarioId, repId, file]);

    return (
        <div>
            <div className="dc-toolbar">
                <select value={file} onChange={(e) => setFile(e.target.value as typeof file)}>
                    <option value="result">result.json (rep)</option>
                    <option value="summary">summary.json (run)</option>
                    <option value="markersHead">markers.jsonl (head)</option>
                </select>
                {file !== "summary" ? (
                    <select value={repId} onChange={(e) => setRepId(Number(e.target.value))}>
                        {(props.details?.reps ?? [{ repId: 0 }]).map((rep) => (
                            <option key={rep.repId} value={rep.repId}>
                                rep {rep.repId}
                            </option>
                        ))}
                    </select>
                ) : null}
                <span className="dc-muted dc-mono" style={{ fontSize: 10.5 }}>
                    {dump?.path ?? ""}
                    {dump?.truncated ? " · truncated at 512 KB" : ""}
                </span>
            </div>
            <pre className="ph-dump">{dump?.text ?? "…"}</pre>
        </div>
    );
}
