/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Vector Workbench tab (VEC-5): the lazy P2 pane behind the `Vector` results
 * tab. This module is its own chunk — nothing here may be imported by the
 * shell statically (bundle-budget discipline).
 *
 * House rules (UX spec + revisions, briefs r01/r06): VS Code tokens only,
 * 11px UPPERCASE section labels, ≤2px radii, monospace right-aligned
 * numerics, no cards/chips/tinted headers; the pane fills, inner regions
 * scroll, the page never does. Scope is stated in the facts strip and the
 * status bar (exactly twice). Every displayed fact is honest about its
 * evidence: this v1 renders local-computation Profile facts only.
 *
 * Data flow: qs/vector.open → handle; qs/vector.profile → summary (derived
 * data only — components never enter the webview); findings drill in via
 * qs/vector.findingDetail. The webview sends selections only.
 */

import * as React from "react";
import { Rpc } from "./resultsGridShared";
import { VectorCompareView } from "./vectorCompareView";
import { VectorIndexView } from "./vectorIndexView";
import { VectorPipelineView } from "./vectorPipelineView";
import { VectorProjectionView } from "./vectorProjectionView";
import { perfMark, perfMarkAfterNextPaint } from "../../common/perfMarks";
import {
    QsVectorFindingDetailRequest,
    QsVectorFindingDetailResult,
    QsVectorCancelRequest,
    QsVectorCloseRequest,
    QsVectorOpenRequest,
    QsVectorOpenResult,
    QsVectorProfileRequest,
    QsVectorProfileResult,
    VectorFindingKind,
    VectorFindingSummary,
    VectorHistogram,
    VectorProfileSummary,
} from "../../../sharedInterfaces/vectorWorkbench";
import type {
    QsVectorPanelViewState,
    QsVectorSearchViewState,
    QsVectorCompareViewState,
    QsVectorProjectionViewState,
    QsVectorIndexViewState,
    QsVectorPipelineViewState,
    QsVectorWorkspaceId,
} from "../../../sharedInterfaces/queryStudioViewState";
import type { QsActivateTabParams } from "../../../sharedInterfaces/queryStudio";

export interface VectorColumnChoice {
    readonly resultSetId: string;
    readonly columnOrdinal: number;
    readonly columnName: string;
    readonly dimensions?: number;
    readonly transport: "binary-v1" | "textFallback";
}

export interface VectorWorkbenchTabProps {
    rpc: Rpc;
    /** Vector columns detected in the run's result sets (appliesTo facts). */
    columns: readonly VectorColumnChoice[];
    /** Bumps per run — resets session state without remounting the tab. */
    runKey: string;
    /**
     * False on frozen surfaces (pinned snapshots): live-session workspaces
     * (Pipeline; Search when it lands) lock with an honest tooltip.
     */
    live?: boolean;
    /** String-typed columns per result set (Pipeline source-text picker). */
    stringColumnsByResult?: Record<string, readonly { ordinal: number; name: string }[]>;
    /** False while Vector is not the selected result tab or its panel is hidden. */
    active?: boolean;
    /** Owning VS Code panel visibility, independent of the selected result tab. */
    panelVisible?: boolean;
    /** Transient PERF_MODE request; never persisted with panel view state. */
    perfAction?: QsActivateTabParams;
    initialViewState?: QsVectorPanelViewState;
    onViewStateChange?: (state: QsVectorPanelViewState) => void;
}

type Workspace = QsVectorWorkspaceId;

const LazyVectorSearchView = React.lazy(async () => ({
    default: (await import("./vectorSearchView")).VectorSearchView,
}));

const WORKSPACES: Array<{ id: Workspace; label: string; enabled: boolean }> = [
    { id: "profile", label: "Profile", enabled: true },
    { id: "search", label: "Search", enabled: true },
    { id: "compare", label: "Compare", enabled: true },
    { id: "projection", label: "Projection", enabled: true },
    { id: "index", label: "Index", enabled: true },
    { id: "pipeline", label: "Pipeline", enabled: true },
];

/** Workspaces that need a LIVE connection (locked on frozen surfaces). */
const LIVE_ONLY_WORKSPACES: ReadonlySet<Workspace> = new Set(["search", "index", "pipeline"]);

const FINDING_LABELS: Record<VectorFindingKind, string> = {
    nonFiniteComponents: "Vectors contain non-finite components",
    zeroVectors: "Exact zero vectors",
    nearZeroVectors: "Near-zero vectors",
    normOutliers: "Norm outliers",
    duplicateVectors: "Exact duplicate groups",
    nearConstantDimensions: "Near-constant dimensions",
    centroidDistanceOutliers: "Centroid-distance outliers",
    groupGeometryDiffers: "Group geometry differs",
    staleSourceText: "Source text modified after embedding",
    provenanceMismatch: "Mixed embedding provenance",
};

const FINDING_HINTS: Partial<Record<VectorFindingKind, string>> = {
    nonFiniteComponents: "NaN / ±Inf scan",
    zeroVectors: "all components = 0",
    nearZeroVectors: "‖v‖₂ ≤ 1e-6",
    duplicateVectors: "SHA-256 of float32 bytes",
    centroidDistanceOutliers: "cosine distance from sample centroid · p99",
    nearConstantDimensions: "per-dimension variance < 1e-5",
};

const FINDING_SUBJECT_COUNT_LABELS: Record<VectorFindingSummary["subject"], string> = {
    row: "Affected rows",
    dimension: "Affected dimensions",
    duplicateGroup: "Affected duplicate groups",
    pair: "Affected pairs",
    category: "Affected categories",
    document: "Affected documents",
    index: "Affected indexes",
    model: "Affected models",
    chunk: "Affected chunks",
};

function formatCount(value: number): string {
    return value.toLocaleString("en-US");
}

function formatStat(value: number): string {
    if (!Number.isFinite(value)) {
        return String(value);
    }
    return Math.abs(value) >= 1000 ? value.toLocaleString("en-US") : value.toPrecision(6);
}

function Histogram(props: { data: VectorHistogram; height?: number }): React.JSX.Element {
    const { data } = props;
    const height = props.height ?? 84;
    const max = Math.max(1, ...data.bucketCounts);
    const total = data.bucketCounts.reduce((sum, count) => sum + count, 0);
    const bucketWidth =
        data.bucketCounts.length > 0 ? (data.max - data.min) / data.bucketCounts.length : 0;
    return (
        <div>
            <div className="qs-vec-hist" style={{ height }} aria-hidden="true">
                {data.bucketCounts.map((count, i) => (
                    <div
                        key={i}
                        className="qs-vec-hist-bar"
                        style={{ height: `${Math.max(count > 0 ? 2 : 0, (count / max) * 100)}%` }}
                        title={`${formatCount(count)}`}
                    />
                ))}
            </div>
            <p className="qs-vec-sr-only">
                Histogram of {formatCount(total)} analyzed values in {data.bucketCounts.length}{" "}
                buckets from {formatStat(data.min)} to {formatStat(data.max)}. Median{" "}
                {formatStat(data.median)}, fifth percentile {formatStat(data.p5)}, ninety-fifth
                percentile {formatStat(data.p95)}.
            </p>
            <table className="qs-vec-sr-only">
                <caption>Histogram bucket values</caption>
                <thead>
                    <tr>
                        <th scope="col">Bucket</th>
                        <th scope="col">Range</th>
                        <th scope="col">Count</th>
                    </tr>
                </thead>
                <tbody>
                    {data.bucketCounts.map((count, index) => {
                        const lower = data.min + bucketWidth * index;
                        const upper =
                            index === data.bucketCounts.length - 1 ? data.max : lower + bucketWidth;
                        return (
                            <tr key={index}>
                                <th scope="row">{index + 1}</th>
                                <td>
                                    {formatStat(lower)} to {formatStat(upper)}
                                </td>
                                <td>{formatCount(count)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <div className="qs-vec-hist-range">
                <span>{formatStat(data.min)}</span>
                <span>{formatStat(data.max)}</span>
            </div>
            <div className="qs-vec-stats-row">
                <span>
                    <label>median</label>
                    {formatStat(data.median)}
                </span>
                <span>
                    <label>p5</label>
                    {formatStat(data.p5)}
                </span>
                <span>
                    <label>p95</label>
                    {formatStat(data.p95)}
                </span>
            </div>
        </div>
    );
}

function SectionLabel(props: { children: React.ReactNode; right?: React.ReactNode }) {
    return (
        <div className="qs-vec-section-label">
            <span>{props.children}</span>
            {props.right !== undefined ? <span className="qs-vec-muted">{props.right}</span> : null}
        </div>
    );
}

export function VectorWorkbenchTab(props: VectorWorkbenchTabProps): React.JSX.Element {
    const {
        rpc,
        columns,
        runKey,
        live = true,
        stringColumnsByResult,
        active = true,
        panelVisible = true,
        perfAction,
        initialViewState,
        onViewStateChange,
    } = props;
    const initialWorkspace =
        !live && LIVE_ONLY_WORKSPACES.has(initialViewState?.workspace ?? "profile")
            ? "profile"
            : (initialViewState?.workspace ?? "profile");
    const [workspace, setWorkspace] = React.useState<Workspace>(initialWorkspace);
    const [selectedColumn, setSelectedColumn] = React.useState<
        { resultSetId: string; columnOrdinal: number } | undefined
    >(initialViewState?.selectedColumn);
    const [profileNorm, setProfileNorm] = React.useState<"l2" | "l1" | "linf">(
        initialViewState?.profileNorm ?? "l2",
    );
    const [searchViewState, setSearchViewState] = React.useState<QsVectorSearchViewState>(
        initialViewState?.search ?? {
            source: "selectedRow",
            selectedRowOrdinal: 0,
            expression: "normalize(A + B)",
            metric: "cosine",
            k: 20,
            includeApprox: true,
            filters: [],
            sqlOpen: false,
            sqlTab: "exact",
            sqlScrollPositions: {
                exact: { scrollTop: 0, scrollLeft: 0 },
                approx: { scrollTop: 0, scrollLeft: 0 },
            },
            rankScrollTop: 0,
        },
    );
    const [compareViewState, setCompareViewState] = React.useState<QsVectorCompareViewState>(
        initialViewState?.compare ?? { ordinalInput: "", metric: "cosine" },
    );
    const [projectionViewState, setProjectionViewState] =
        React.useState<QsVectorProjectionViewState>(
            initialViewState?.projection ?? {
                fitted: false,
                centerX: 0,
                centerY: 0,
                scale: 60,
                listScrollTop: 0,
            },
        );
    const [indexViewState, setIndexViewState] = React.useState<QsVectorIndexViewState>(
        initialViewState?.index ?? {},
    );
    const [pipelineViewState, setPipelineViewState] = React.useState<QsVectorPipelineViewState>(
        initialViewState?.pipeline ?? {
            rowOrdinal: 0,
            showSql: false,
            chunkSize: 800,
            overlapPct: 15,
        },
    );
    const searchFilterColumns = React.useMemo(
        () =>
            searchViewState.filters
                .map((filter) => filter.column)
                .filter((column) => column.length > 0),
        [searchViewState.filters],
    );
    const onIndexTargetChange = React.useCallback((targetId: string | undefined) => {
        setSearchViewState((current) => ({
            source: current.source,
            selectedRowOrdinal: current.selectedRowOrdinal,
            ...(current.expression !== undefined ? { expression: current.expression } : {}),
            ...(targetId ? { targetId } : {}),
            metric: current.metric,
            k: current.k,
            includeApprox: current.includeApprox,
            filters: [],
            sqlOpen: false,
            sqlTab: "exact",
            sqlScrollPositions: {
                exact: { scrollTop: 0, scrollLeft: 0 },
                approx: { scrollTop: 0, scrollLeft: 0 },
            },
            rankScrollTop: 0,
        }));
    }, []);
    const [opened, setOpened] = React.useState<QsVectorOpenResult | undefined>();
    const [openedIdentity, setOpenedIdentity] = React.useState<string | undefined>();
    const [profile, setProfile] = React.useState<VectorProfileSummary | undefined>();
    const [openError, setOpenError] = React.useState<string | undefined>();
    const [openErrorIdentity, setOpenErrorIdentity] = React.useState<string | undefined>();
    const [profileError, setProfileError] = React.useState<string | undefined>();
    const [loading, setLoading] = React.useState(false);
    const [sessionReady, setSessionReady] = React.useState(false);
    const activeRef = React.useRef(active);
    activeRef.current = active;
    const [openEnabled, setOpenEnabled] = React.useState(active);
    const [drawer, setDrawer] = React.useState<
        | {
              finding: VectorFindingSummary;
              detail?: QsVectorFindingDetailResult["detail"];
              error?: string;
          }
        | undefined
    >();
    const [profileFinding, setProfileFinding] = React.useState<string | undefined>(
        initialViewState?.profileFinding,
    );
    const [profileDrawerScrollTop, setProfileDrawerScrollTop] = React.useState(
        initialViewState?.profileDrawerScrollTop ?? 0,
    );
    const profileDrawerScrollTopRef = React.useRef(profileDrawerScrollTop);
    profileDrawerScrollTopRef.current = profileDrawerScrollTop;
    const columnIndex = Math.max(
        0,
        columns.findIndex(
            (candidate) =>
                candidate.resultSetId === selectedColumn?.resultSetId &&
                candidate.columnOrdinal === selectedColumn?.columnOrdinal,
        ),
    );
    const column = columns[columnIndex];
    const currentIdentity = column
        ? `${runKey}:${column.resultSetId}:${column.columnOrdinal}`
        : undefined;
    const visibleOpened = openedIdentity === currentIdentity ? opened : undefined;
    const visibleOpenError = openErrorIdentity === currentIdentity ? openError : undefined;
    const visibleHandleRef = React.useRef<string | undefined>(visibleOpened?.handle);
    visibleHandleRef.current = visibleOpened?.handle;
    const drawerRef = React.useRef<HTMLElement | null>(null);
    const drawerBodyRef = React.useRef<HTMLDivElement | null>(null);
    const drawerReturnFocusRef = React.useRef<HTMLElement | null>(null);
    const workspaceRef = React.useRef<HTMLElement | null>(null);
    const workspaceScrollTopRef = React.useRef<Partial<Record<Workspace, number>>>({
        ...initialViewState?.workspaceScrollTop,
    });
    const [mountedWorkspaces, setMountedWorkspaces] = React.useState<ReadonlySet<Workspace>>(
        () => new Set([initialWorkspace]),
    );
    const lastIdentityRef = React.useRef<string | undefined>(undefined);
    React.useEffect(() => {
        setOpenEnabled(active);
        if (!active) {
            setSessionReady(false);
        }
    }, [active]);
    React.useEffect(() => {
        if (!activeRef.current) {
            setOpenEnabled(false);
            lastIdentityRef.current = undefined;
            setOpened(undefined);
            setOpenedIdentity(undefined);
            setProfile(undefined);
            setDrawer(undefined);
        }
    }, [runKey]);

    React.useEffect(() => {
        setMountedWorkspaces((current) => {
            if (current.has(workspace)) {
                return current;
            }
            return new Set([...current, workspace]);
        });
    }, [workspace]);

    React.useEffect(() => {
        if (!selectedColumn && column) {
            setSelectedColumn({
                resultSetId: column.resultSetId,
                columnOrdinal: column.columnOrdinal,
            });
        }
    }, [column, selectedColumn]);

    const emitViewState = React.useCallback(() => {
        onViewStateChange?.({
            workspace,
            ...(column
                ? {
                      selectedColumn: {
                          resultSetId: column.resultSetId,
                          columnOrdinal: column.columnOrdinal,
                      },
                  }
                : {}),
            profileNorm,
            workspaceScrollTop: { ...workspaceScrollTopRef.current },
            ...(profileFinding ? { profileFinding } : {}),
            profileDrawerScrollTop,
            search: searchViewState,
            compare: compareViewState,
            projection: projectionViewState,
            index: indexViewState,
            pipeline: pipelineViewState,
        });
    }, [
        column,
        compareViewState,
        indexViewState,
        onViewStateChange,
        pipelineViewState,
        profileFinding,
        profileDrawerScrollTop,
        profileNorm,
        projectionViewState,
        searchViewState,
        workspace,
    ]);

    React.useEffect(() => {
        emitViewState();
    }, [emitViewState]);

    const persistScroll = React.useCallback(() => {
        workspaceScrollTopRef.current[workspace] = workspaceRef.current?.scrollTop ?? 0;
        emitViewState();
    }, [emitViewState, workspace]);

    React.useLayoutEffect(() => {
        if (workspaceRef.current) {
            workspaceRef.current.scrollTop = workspaceScrollTopRef.current[workspace] ?? 0;
        }
    }, [workspace, visibleOpened?.handle]);

    const selectWorkspace = React.useCallback(
        (next: Workspace) => {
            if (next === workspace) {
                return;
            }
            workspaceScrollTopRef.current[workspace] = workspaceRef.current?.scrollTop ?? 0;
            setWorkspace(next);
        },
        [workspace],
    );

    const processedPerfActionRef = React.useRef(0);
    React.useEffect(() => {
        const action = perfAction?.vector;
        if (!action || processedPerfActionRef.current === perfAction.requestId) {
            return;
        }
        if (action.workspace === "search" && !live) {
            return;
        }
        processedPerfActionRef.current = perfAction.requestId;
        selectWorkspace(action.workspace);
    }, [live, perfAction, selectWorkspace]);

    const onWorkspaceKeyDown = React.useCallback(
        (event: React.KeyboardEvent<HTMLButtonElement>, current: Workspace) => {
            const index = WORKSPACES.findIndex((candidate) => candidate.id === current);
            if (index < 0) {
                return;
            }
            let next = index;
            if (event.key === "ArrowDown" || event.key === "ArrowRight") {
                next = (index + 1) % WORKSPACES.length;
            } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
                next = (index - 1 + WORKSPACES.length) % WORKSPACES.length;
            } else if (event.key === "Home") {
                next = 0;
            } else if (event.key === "End") {
                next = WORKSPACES.length - 1;
            } else {
                return;
            }
            event.preventDefault();
            const nextItem = WORKSPACES[next];
            const nextWorkspace = nextItem.id;
            if (nextItem.enabled && (live || !LIVE_ONLY_WORKSPACES.has(nextWorkspace))) {
                selectWorkspace(nextWorkspace);
            }
            event.currentTarget.parentElement
                ?.querySelector<HTMLButtonElement>(`[data-workspace="${nextWorkspace}"]`)
                ?.focus();
        },
        [live, selectWorkspace],
    );

    // Open + profile per (run, column). The handle lives host-side; closing
    // on cleanup releases the result-store lease and any active worker.
    React.useEffect(() => {
        let cancelled = false;
        let handle: string | undefined;
        const close = () => {
            if (!handle) {
                return;
            }
            const closing = handle;
            handle = undefined;
            void rpc
                .sendRequest(QsVectorCloseRequest.type, { handle: closing })
                .catch(() => undefined);
        };
        if (!openEnabled || !active) {
            return;
        }
        if (!column) {
            return;
        }
        const identity = currentIdentity!;
        if (lastIdentityRef.current !== identity) {
            lastIdentityRef.current = identity;
            setOpened(undefined);
            setOpenedIdentity(undefined);
            setProfile(undefined);
            setDrawer(undefined);
        }
        setOpenError(undefined);
        setOpenErrorIdentity(identity);
        setProfileError(undefined);
        setLoading(true);
        setSessionReady(false);
        void (async () => {
            try {
                const openResult = await rpc.sendRequest<
                    { resultSetId: string; columnOrdinal: number },
                    QsVectorOpenResult
                >(QsVectorOpenRequest.type, {
                    resultSetId: column.resultSetId,
                    columnOrdinal: column.columnOrdinal,
                });
                handle = openResult.handle || undefined;
                if (cancelled) {
                    close();
                    return;
                }
                if (openResult.error) {
                    setOpenError(openResult.error);
                    setSessionReady(false);
                    setLoading(false);
                    return;
                }
                setOpened(openResult);
                setOpenedIdentity(identity);
                setSessionReady(true);
            } catch (e) {
                if (!cancelled) {
                    setOpenError(e instanceof Error ? e.message : String(e));
                    setSessionReady(false);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        })();
        return () => {
            cancelled = true;
            close();
        };
    }, [active, openEnabled, rpc, runKey, column?.resultSetId, column?.columnOrdinal]);

    React.useEffect(() => {
        if (
            !active ||
            !sessionReady ||
            workspace !== "profile" ||
            !visibleOpened?.handle ||
            profile ||
            profileError
        ) {
            return;
        }
        let cancelled = false;
        let settled = false;
        const handle = visibleOpened.handle;
        setLoading(true);
        perfMark("mssql.queryResults.vector.render.begin", { workspace: "profile" });
        void rpc
            .sendRequest<{ handle: string }, QsVectorProfileResult>(QsVectorProfileRequest.type, {
                handle,
            })
            .then((profileResult) => {
                if (cancelled || visibleHandleRef.current !== handle) {
                    return;
                }
                if (profileResult.error || !profileResult.summary) {
                    setProfileError(profileResult.error ?? "Analysis returned no summary.");
                } else {
                    setProfile(profileResult.summary);
                    perfMarkAfterNextPaint("mssql.queryResults.vector.render.firstPaint", {
                        workspace: "profile",
                    });
                }
            })
            .catch((cause) => {
                if (!cancelled && visibleHandleRef.current === handle) {
                    setProfileError(cause instanceof Error ? cause.message : String(cause));
                }
            })
            .finally(() => {
                settled = true;
                if (!cancelled && visibleHandleRef.current === handle) {
                    setLoading(false);
                }
            });
        return () => {
            cancelled = true;
            if (!settled) {
                void rpc.sendRequest(QsVectorCancelRequest.type, { handle }).catch(() => undefined);
            }
        };
    }, [active, profile, profileError, rpc, sessionReady, visibleOpened?.handle, workspace]);

    const openDrawer = React.useCallback(
        async (finding: VectorFindingSummary) => {
            const activeElement = document.activeElement;
            if (activeElement instanceof HTMLElement && activeElement !== document.body) {
                drawerReturnFocusRef.current = activeElement;
            }
            setProfileFinding(finding.kind);
            setDrawer({ finding });
            if (!finding.hasDetail || !visibleOpened?.handle) {
                return;
            }
            if (!sessionReady) {
                setDrawer({
                    finding,
                    error: "Reconnect the analysis session before loading finding details.",
                });
                return;
            }
            const requestedHandle = visibleOpened.handle;
            try {
                const result = await rpc.sendRequest<
                    { handle: string; kind: VectorFindingKind },
                    QsVectorFindingDetailResult
                >(QsVectorFindingDetailRequest.type, {
                    handle: requestedHandle,
                    kind: finding.kind,
                });
                if (visibleHandleRef.current !== requestedHandle) {
                    return;
                }
                setDrawer((current) =>
                    current?.finding.kind === finding.kind
                        ? {
                              finding,
                              detail: result.detail,
                              ...(result.error ? { error: result.error } : {}),
                          }
                        : current,
                );
            } catch (cause) {
                if (visibleHandleRef.current !== requestedHandle) {
                    return;
                }
                setDrawer((current) =>
                    current?.finding.kind === finding.kind
                        ? {
                              finding,
                              error: cause instanceof Error ? cause.message : String(cause),
                          }
                        : current,
                );
            }
        },
        [rpc, sessionReady, visibleOpened?.handle],
    );

    const closeDrawer = React.useCallback(() => {
        setDrawer(undefined);
        setProfileFinding(undefined);
        requestAnimationFrame(() => drawerReturnFocusRef.current?.focus());
    }, []);

    React.useEffect(() => {
        if (!drawer) {
            return;
        }
        drawerRef.current?.focus();
        if (drawerBodyRef.current) {
            drawerBodyRef.current.scrollTop = profileDrawerScrollTopRef.current;
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                closeDrawer();
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [closeDrawer, drawer?.finding.kind]);

    React.useEffect(() => {
        if (!profile || !profileFinding || drawer) {
            return;
        }
        const finding = profile.findings.find((candidate) => candidate.kind === profileFinding);
        if (finding) {
            void openDrawer(finding);
        } else {
            setProfileFinding(undefined);
        }
    }, [drawer, openDrawer, profile, profileFinding]);

    if (columns.length === 0) {
        return (
            <div className="qs-vec-empty qs-muted">
                No native vector columns in this run's results.
            </div>
        );
    }

    const sample = profile?.sample;
    const scopeText = sample
        ? sample.method === "full"
            ? `Full · ${formatCount(sample.sampleRows)} rows`
            : `Sample ${formatCount(sample.sampleRows)} of ${formatCount(sample.totalRows)}`
        : visibleOpened
          ? `${formatCount(visibleOpened.totalRows)} rows`
          : "";

    return (
        <div className="qs-vec-root">
            <div className="qs-vec-toolbar">
                <select
                    className="qs-vec-select"
                    value={`${column?.resultSetId ?? ""}:${column?.columnOrdinal ?? 0}`}
                    onChange={(e) => {
                        const selected = columns.find(
                            (candidate) =>
                                `${candidate.resultSetId}:${candidate.columnOrdinal}` ===
                                e.currentTarget.value,
                        );
                        if (selected) {
                            setSelectedColumn({
                                resultSetId: selected.resultSetId,
                                columnOrdinal: selected.columnOrdinal,
                            });
                        }
                    }}
                    aria-label="Vector column">
                    {columns.map((c) => (
                        <option
                            key={`${c.resultSetId}:${c.columnOrdinal}`}
                            value={`${c.resultSetId}:${c.columnOrdinal}`}>
                            {c.columnName}
                            {c.dimensions !== undefined ? ` ${c.dimensions}·f32` : ""}
                        </option>
                    ))}
                </select>
                <span className="qs-vec-scope" title="Analysis scope">
                    {scopeText}
                </span>
            </div>
            <div className="qs-vec-body">
                <nav className="qs-vec-rail" role="tablist" aria-label="Vector workspaces">
                    {WORKSPACES.map((w) => {
                        const lockedFrozen = !live && LIVE_ONLY_WORKSPACES.has(w.id);
                        const enabled = w.enabled && !lockedFrozen;
                        return (
                            <button
                                key={w.id}
                                id={`qs-vec-workspace-tab-${w.id}`}
                                role="tab"
                                aria-selected={workspace === w.id}
                                aria-controls={enabled ? `qs-vec-workspace-${w.id}` : undefined}
                                aria-disabled={!enabled}
                                aria-label={
                                    enabled
                                        ? w.label
                                        : lockedFrozen
                                          ? `${w.label}. Needs a live connection; pinned results are frozen.`
                                          : `${w.label}. Coming in a later build.`
                                }
                                tabIndex={workspace === w.id ? 0 : -1}
                                data-workspace={w.id}
                                className={`qs-vec-rail-item${workspace === w.id ? " active" : ""}`}
                                title={
                                    enabled
                                        ? w.label
                                        : lockedFrozen
                                          ? `${w.label} — needs a live connection (pinned results are frozen)`
                                          : `${w.label} — coming in a later build`
                                }
                                onKeyDown={(event) => onWorkspaceKeyDown(event, w.id)}
                                onClick={() => enabled && selectWorkspace(w.id)}>
                                {w.label}
                            </button>
                        );
                    })}
                </nav>
                <main className="qs-vec-workspace" ref={workspaceRef} onScroll={persistScroll}>
                    {visibleOpenError && !visibleOpened ? (
                        <div className="qs-vec-empty">
                            <div className="qs-vec-error" role="alert">
                                {visibleOpenError}
                            </div>
                        </div>
                    ) : !visibleOpened || visibleOpened.error ? (
                        <div className="qs-vec-empty qs-muted">Analyzing vector column…</div>
                    ) : (
                        <>
                            {visibleOpenError ? (
                                <div className="qs-vec-warning" role="status">
                                    Analysis session reconnect failed; completed workspace state is
                                    retained. {visibleOpenError}
                                </div>
                            ) : null}
                            {mountedWorkspaces.has("profile") ? (
                                <div
                                    id="qs-vec-workspace-profile"
                                    role="tabpanel"
                                    aria-labelledby="qs-vec-workspace-tab-profile"
                                    hidden={workspace !== "profile"}>
                                    {profileError ? (
                                        <div className="qs-vec-empty">
                                            <div className="qs-vec-error" role="alert">
                                                {profileError}
                                            </div>
                                        </div>
                                    ) : loading || !profile ? (
                                        <div className="qs-vec-empty qs-muted">
                                            Analyzing vector column…
                                        </div>
                                    ) : (
                                        <ProfileView
                                            profile={profile}
                                            norm={profileNorm}
                                            onNormChange={setProfileNorm}
                                            onFinding={(f) => void openDrawer(f)}
                                        />
                                    )}
                                </div>
                            ) : null}
                            {mountedWorkspaces.has("compare") ? (
                                <div
                                    id="qs-vec-workspace-compare"
                                    role="tabpanel"
                                    aria-labelledby="qs-vec-workspace-tab-compare"
                                    hidden={workspace !== "compare"}>
                                    <VectorCompareView
                                        key={currentIdentity}
                                        rpc={rpc}
                                        handle={visibleOpened.handle}
                                        generation={visibleOpened.generation}
                                        active={sessionReady && active && workspace === "compare"}
                                        totalRows={visibleOpened.totalRows}
                                        initialViewState={compareViewState}
                                        onViewStateChange={setCompareViewState}
                                    />
                                </div>
                            ) : null}
                            {live && mountedWorkspaces.has("search") ? (
                                <div
                                    id="qs-vec-workspace-search"
                                    role="tabpanel"
                                    aria-labelledby="qs-vec-workspace-tab-search"
                                    hidden={workspace !== "search"}>
                                    <React.Suspense
                                        fallback={
                                            <div className="qs-vec-empty qs-muted">
                                                Loading Search…
                                            </div>
                                        }>
                                        <LazyVectorSearchView
                                            key={currentIdentity}
                                            rpc={rpc}
                                            handle={visibleOpened.handle}
                                            generation={visibleOpened.generation}
                                            totalRows={visibleOpened.totalRows}
                                            expressionBasketOrdinals={
                                                compareViewState.lastSubmittedOrdinals
                                            }
                                            active={
                                                sessionReady && active && workspace === "search"
                                            }
                                            panelActive={panelVisible}
                                            sessionReady={sessionReady}
                                            authoritativeTargetId={searchViewState.targetId}
                                            perfAction={perfAction}
                                            initialViewState={searchViewState}
                                            onViewStateChange={setSearchViewState}
                                        />
                                    </React.Suspense>
                                </div>
                            ) : null}
                            {mountedWorkspaces.has("projection") ? (
                                <div
                                    id="qs-vec-workspace-projection"
                                    role="tabpanel"
                                    aria-labelledby="qs-vec-workspace-tab-projection"
                                    hidden={workspace !== "projection"}>
                                    <VectorProjectionView
                                        key={currentIdentity}
                                        rpc={rpc}
                                        handle={visibleOpened.handle}
                                        generation={visibleOpened.generation}
                                        active={
                                            sessionReady && active && workspace === "projection"
                                        }
                                        initialViewState={projectionViewState}
                                        onViewStateChange={setProjectionViewState}
                                    />
                                </div>
                            ) : null}
                            {live && mountedWorkspaces.has("index") ? (
                                <div
                                    id="qs-vec-workspace-index"
                                    role="tabpanel"
                                    aria-labelledby="qs-vec-workspace-tab-index"
                                    hidden={workspace !== "index"}>
                                    <VectorIndexView
                                        key={currentIdentity}
                                        rpc={rpc}
                                        handle={visibleOpened.handle}
                                        generation={visibleOpened.generation}
                                        active={sessionReady && active && workspace === "index"}
                                        initialViewState={indexViewState}
                                        onViewStateChange={setIndexViewState}
                                        targetId={searchViewState.targetId}
                                        onTargetChange={onIndexTargetChange}
                                        metric={searchViewState.metric}
                                        filterColumns={searchFilterColumns}
                                        resultVectorColumn={column.columnName}
                                        {...(column.dimensions !== undefined
                                            ? { resultDimensions: column.dimensions }
                                            : {})}
                                    />
                                </div>
                            ) : null}
                            {live && mountedWorkspaces.has("pipeline") ? (
                                <div
                                    id="qs-vec-workspace-pipeline"
                                    role="tabpanel"
                                    aria-labelledby="qs-vec-workspace-tab-pipeline"
                                    hidden={workspace !== "pipeline"}>
                                    <VectorPipelineView
                                        key={currentIdentity}
                                        rpc={rpc}
                                        handle={visibleOpened.handle}
                                        generation={visibleOpened.generation}
                                        active={sessionReady && active && workspace === "pipeline"}
                                        vectorColumn={{
                                            columnName: column.columnName,
                                            ...(column.dimensions !== undefined
                                                ? { dimensions: column.dimensions }
                                                : {}),
                                        }}
                                        stringColumns={
                                            stringColumnsByResult?.[column.resultSetId] ?? []
                                        }
                                        totalRows={visibleOpened.totalRows}
                                        initialViewState={pipelineViewState}
                                        onViewStateChange={setPipelineViewState}
                                    />
                                </div>
                            ) : null}
                        </>
                    )}
                </main>
                {drawer && visibleOpened ? (
                    <aside
                        ref={drawerRef}
                        className="qs-vec-drawer"
                        role="region"
                        aria-labelledby="qs-vec-drawer-title"
                        tabIndex={-1}>
                        <div className="qs-vec-drawer-header">
                            <span id="qs-vec-drawer-title">
                                {FINDING_LABELS[drawer.finding.kind]}
                            </span>
                            <button
                                className="qs-vec-drawer-close"
                                aria-label="Close"
                                onClick={closeDrawer}>
                                <span className="codicon codicon-close" aria-hidden="true" />
                            </button>
                        </div>
                        <div
                            ref={drawerBodyRef}
                            className="qs-vec-drawer-body"
                            onScroll={(event) =>
                                setProfileDrawerScrollTop(event.currentTarget.scrollTop)
                            }>
                            <div className="qs-vec-muted">
                                {FINDING_SUBJECT_COUNT_LABELS[drawer.finding.subject]} ·{" "}
                                {formatCount(drawer.finding.affectedCount)}
                            </div>
                            {drawer.error ? (
                                <div className="qs-vec-error" role="alert">
                                    {drawer.error}
                                </div>
                            ) : drawer.detail ? (
                                <ul className="qs-vec-ordinal-list">
                                    {(
                                        drawer.detail.resultRowOrdinals ??
                                        drawer.detail.dimensionOrdinals ??
                                        []
                                    ).map((ordinal, i) => (
                                        <li key={i}>
                                            <span className="qs-vec-num">
                                                {drawer.detail!.dimensionOrdinals
                                                    ? `dim ${formatCount(ordinal + 1)}`
                                                    : drawer.finding.subject === "duplicateGroup"
                                                      ? `member row ${formatCount(ordinal)}`
                                                      : `result row ${formatCount(ordinal)}`}
                                            </span>
                                            {drawer.detail!.values?.[i] !== undefined ? (
                                                <span className="qs-vec-num qs-vec-muted">
                                                    {formatStat(drawer.detail!.values[i])}
                                                </span>
                                            ) : null}
                                        </li>
                                    ))}
                                </ul>
                            ) : drawer.finding.hasDetail ? (
                                <div className="qs-vec-muted" role="status">
                                    Loading…
                                </div>
                            ) : null}
                            {drawer.detail?.truncated ? (
                                <div className="qs-vec-muted">List capped — not exhaustive.</div>
                            ) : null}
                        </div>
                    </aside>
                ) : null}
            </div>
            <div className="qs-vec-status">
                <span>
                    {scopeText}
                    {profile ? ` · ${formatCount(profile.dimensions)}-D ${profile.baseType}` : ""}
                </span>
                <span className="qs-vec-muted">{workspaceActivityText(workspace)}</span>
            </div>
        </div>
    );
}

function workspaceActivityText(workspace: Workspace): string {
    switch (workspace) {
        case "search":
            return "Search runs SQL on a separate database session · the webview makes no network requests";
        case "index":
            return "Catalog and non-scanning capability probes · generated scripts are never executed";
        case "pipeline":
            return "Model calls require confirmation · external egress is disclosed before execution";
        default:
            return "Local analysis only · no database SQL or external model calls";
    }
}

function ProfileView(props: {
    profile: VectorProfileSummary;
    norm: "l2" | "l1" | "linf";
    onNormChange: (norm: "l2" | "l1" | "linf") => void;
    onFinding: (finding: VectorFindingSummary) => void;
}): React.JSX.Element {
    const { profile, norm, onNormChange, onFinding } = props;
    const facts: Array<[string, string]> = [
        [
            "Rows",
            profile.sample.method === "full"
                ? formatCount(profile.sample.sampleRows)
                : `${formatCount(profile.sample.sampleRows)} sampled of ${formatCount(profile.sample.totalRows)}`,
        ],
        ["Dimensions", formatCount(profile.dimensions)],
        ["Base type", `${profile.baseType} native`],
        [
            "Null / unavailable",
            `${formatCount(profile.nullCount)} / ${formatCount(profile.unavailableCount)}`,
        ],
        ["Near-zero", formatCount(profile.norms.nearZeroCount)],
    ];
    if (profile.sample.partialReason) {
        facts.push(["Partial", profile.sample.partialReason]);
    }
    return (
        <div className="qs-vec-profile">
            <div className="qs-vec-facts" role="list">
                {facts.map(([label, value]) => (
                    <span key={label} role="listitem">
                        <label>{label}</label>
                        <span className="qs-vec-num">{value}</span>
                    </span>
                ))}
            </div>
            <div className="qs-vec-columns">
                <section>
                    <SectionLabel right={`local · ${formatCount(profile.sample.sampleRows)} rows`}>
                        Norms
                    </SectionLabel>
                    <div className="qs-vec-norm-toggle" role="radiogroup" aria-label="Norm">
                        {(["l2", "l1", "linf"] as const).map((kind) => (
                            <button
                                key={kind}
                                role="radio"
                                aria-checked={norm === kind}
                                className={norm === kind ? "active" : ""}
                                onClick={() => onNormChange(kind)}>
                                {kind === "l2" ? "L2" : kind === "l1" ? "L1" : "L∞"}
                            </button>
                        ))}
                        <span className="qs-vec-muted qs-vec-norm-note">
                            near-0 ≤ {profile.norms.nearZeroEpsilon}
                        </span>
                    </div>
                    <Histogram data={profile.norms[norm]} />
                    <SectionLabel right="per-dimension · sampled">Component variance</SectionLabel>
                    <div className="qs-vec-variance">
                        <div>
                            <div className="qs-vec-muted">Highest</div>
                            {profile.varianceTop.map((entry) => (
                                <VarianceRow
                                    key={entry.dimension}
                                    entry={entry}
                                    max={profile.varianceTop[0]?.variance ?? 1}
                                />
                            ))}
                        </div>
                        <div>
                            <div className="qs-vec-muted">Lowest</div>
                            {profile.varianceBottom.map((entry) => (
                                <VarianceRow
                                    key={entry.dimension}
                                    entry={entry}
                                    max={profile.varianceTop[0]?.variance ?? 1}
                                />
                            ))}
                        </div>
                    </div>
                </section>
                <section>
                    <SectionLabel right={`${profile.findings.length} · local`}>
                        Findings
                    </SectionLabel>
                    {profile.findings.length === 0 ? (
                        <div className="qs-vec-muted">No findings in the analyzed sample.</div>
                    ) : (
                        <ul className="qs-vec-findings">
                            {profile.findings.map((finding) => (
                                <li key={finding.kind}>
                                    <button
                                        className="qs-vec-finding"
                                        data-severity={finding.severity}
                                        onClick={() => onFinding(finding)}>
                                        <span className="qs-vec-finding-main">
                                            <span>{FINDING_LABELS[finding.kind]}</span>
                                            <span className="qs-vec-muted">
                                                {FINDING_HINTS[finding.kind] ?? ""}
                                            </span>
                                        </span>
                                        <span className="qs-vec-num">
                                            {formatCount(finding.affectedCount)}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    {profile.pairDistances ? (
                        <>
                            <SectionLabel
                                right={`${profile.pairDistances.metric} · ${formatCount(profile.pairDistances.pairCount)} pairs · local`}>
                                Sampled pair distances
                            </SectionLabel>
                            <Histogram data={profile.pairDistances} />
                        </>
                    ) : null}
                </section>
            </div>
        </div>
    );
}

function VarianceRow(props: {
    entry: { dimension: number; variance: number };
    max: number;
}): React.JSX.Element {
    const width = props.max > 0 ? Math.max(1, (props.entry.variance / props.max) * 100) : 1;
    return (
        <div className="qs-vec-variance-row">
            <span className="qs-vec-num qs-vec-dim">dim {props.entry.dimension + 1}</span>
            <span className="qs-vec-variance-bar">
                <span style={{ width: `${width}%` }} />
            </span>
            <span className="qs-vec-num">{formatStat(props.entry.variance)}</span>
        </div>
    );
}
