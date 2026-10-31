/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Search workspace (VEC-8; r01 §8, r06 §3.3, vec_search_results.png): compose
 * an exact vs approximate retrieval comparison and read what proves it.
 * Source tabs (Selected row / Paste vector), target + metric + K controls,
 * AND-only structured filter rows, then a Recall@K facts strip, the evidence
 * block, the union rank grid with the SVG rank-flow slope graph, and the
 * collapsible Generated T-SQL drawer whose text is byte-for-byte what
 * executed (the host inlines literals at the execution edge).
 *
 * Rides the lazy vector chunk (imported only by vectorTab.tsx). House rules:
 * VS Code tokens only, 11px uppercase section labels, mono right-aligned
 * numerics at 6 significant digits, ≤2px radii, no cards; inner regions
 * scroll, the page never does. The webview sends the composition only — the
 * host owns sessions, SQL, clamps, and evidence.
 */

import * as React from "react";
import { Rpc } from "./resultsGridShared";
import { formatCount, formatStat, VecSectionLabel } from "./vectorViewsShared";
import {
    QsVectorCapabilitiesParams,
    QsVectorCapabilitiesRequest,
    QsVectorCapabilitiesResult,
    type VectorModelStatementCounts,
} from "../../../sharedInterfaces/vectorCatalog";
import {
    QsVectorSearchComparison,
    QsVectorSearchCancelRequest,
    QsVectorSearchModelExecuteRequest,
    QsVectorSearchModelExecuteResult,
    QsVectorSearchModelPrepareRequest,
    QsVectorSearchModelPrepareResult,
    QsVectorSearchModelsRequest,
    QsVectorSearchModelsResult,
    QsVectorSearchParams,
    QsVectorSearchRequest,
    QsVectorSearchResult,
    QsVectorSearchResultRequest,
    QsVectorSearchTargetsParams,
    QsVectorSearchTargetsRequest,
    QsVectorSearchTargetsResult,
    VECTOR_SEARCH_DEFAULT_K,
    VECTOR_SEARCH_MAX_K,
    VECTOR_SEARCH_MIN_K,
    VECTOR_SEARCH_MODEL_PARAMETERS_MAX_UTF8_BYTES,
    VECTOR_SEARCH_MODEL_TEXT_MAX_CHARS,
    VECTOR_SEARCH_MODEL_TEXT_MAX_UTF8_BYTES,
    VectorSearchMetric,
    VectorSearchPredicateInput,
    VectorSearchPredicateOp,
    VectorSearchRankRow,
    VectorSearchTargetInfo,
} from "../../../sharedInterfaces/vectorSearch";
import type { QsVectorSearchViewState } from "../../../sharedInterfaces/queryStudioViewState";
import {
    QsShowPlanQueryRequest,
    type QsActivateTabParams,
} from "../../../sharedInterfaces/queryStudio";
import { resolveVectorPerfSearchTarget } from "./vectorPerfAction";
import { resolveAuthoritativeVectorTargetIndex } from "./vectorSearchTargetSync";
import {
    validateVectorExpressionLocally,
    VECTOR_EXPRESSION_SYMBOLS,
    VectorExpressionError,
} from "../../../queryResults/vector/vectorExpression";
import { locConstants } from "../../common/locConstants";

export interface VectorSearchViewProps {
    rpc: Rpc;
    /** Host-minted analysis-session handle (qs/vector.open). */
    handle: string;
    /** Generation stamp — a rerun resets results via this changing. */
    generation: number;
    /** Row count of the opened result set (ordinal validation hint). */
    totalRows: number;
    /** Last host-validated Compare basket; symbols map A-H in this order. */
    expressionBasketOrdinals?: readonly number[];
    /** True only while the Search workspace is visible in an active panel. */
    active: boolean;
    /** Panel visibility, independent of which Vector workspace is selected. */
    panelActive?: boolean;
    /** False after the host Workbench handle is released for result-tab suspension. */
    sessionReady?: boolean;
    /** Canonical target binding shared with the Index workspace. */
    authoritativeTargetId?: string;
    /** Transient PERF_MODE request; supports selected-row composition only. */
    perfAction?: QsActivateTabParams;
    initialViewState?: QsVectorSearchViewState;
    onViewStateChange?: (state: QsVectorSearchViewState) => void;
}

/** Integration descriptor for vectorTab.tsx (rail id + mount component). */
export const vectorSearchIntegration = {
    workspace: "search" as const,
    label: locConstants.vectorWorkbench.search,
    Component: VectorSearchView,
};

type SourceTab = "row" | "text" | "paste" | "expression";

const EMPTY_MODEL_CALL_COUNTS: VectorModelStatementCounts = {
    externalEgress: 0,
    hostLocal: 0,
    inProcess: 0,
    unknown: 0,
};

function modelCallClaim(counts: VectorModelStatementCounts): string {
    return locConstants.vectorWorkbench.searchModelStatements(
        locConstants.vectorWorkbench.modelStatementCounts(
            formatCount(counts.externalEgress),
            formatCount(counts.hostLocal),
            formatCount(counts.inProcess),
            formatCount(counts.unknown),
        ),
    );
}

function mergeModelStatementCounts(
    current: VectorModelStatementCounts,
    incoming: VectorModelStatementCounts,
): VectorModelStatementCounts {
    return {
        externalEgress: Math.max(current.externalEgress, incoming.externalEgress),
        hostLocal: Math.max(current.hostLocal, incoming.hostLocal),
        inProcess: Math.max(current.inProcess, incoming.inProcess),
        unknown: Math.max(current.unknown, incoming.unknown),
    };
}

const SOURCE_TABS: Array<[SourceTab, string]> = [
    ["row", locConstants.vectorWorkbench.selectedRowSource],
    ["text", locConstants.vectorWorkbench.textWithModelSource],
    ["paste", locConstants.vectorWorkbench.pasteVectorSource],
    ["expression", locConstants.vectorWorkbench.expression],
];

interface ExpressionComposerValidation {
    readonly error?: string;
    readonly symbols?: readonly (typeof VECTOR_EXPRESSION_SYMBOLS)[number][];
    readonly operationCount?: number;
}

export function validateExpressionComposer(
    expression: string,
    ordinals: readonly number[] | undefined,
    totalRows: number,
): ExpressionComposerValidation {
    if (!ordinals || ordinals.length < 2 || ordinals.length > VECTOR_EXPRESSION_SYMBOLS.length) {
        return { error: locConstants.vectorWorkbench.submitACompareBasketOf2To8 };
    }
    if (
        new Set(ordinals).size !== ordinals.length ||
        ordinals.some(
            (ordinal) => !Number.isInteger(ordinal) || ordinal < 0 || ordinal >= totalRows,
        )
    ) {
        return { error: locConstants.vectorWorkbench.theCompareBasketNoLongerMapsToThis };
    }
    try {
        const available = VECTOR_EXPRESSION_SYMBOLS.slice(0, ordinals.length);
        const result = validateVectorExpressionLocally(expression, available);
        return { symbols: result.symbols, operationCount: result.operationCount };
    } catch (error) {
        return {
            error:
                error instanceof VectorExpressionError
                    ? error.message
                    : "The constrained vector expression is invalid.",
        };
    }
}

const METRIC_OPTIONS: Array<{ value: VectorSearchMetric; label: string }> = [
    { value: "cosine", label: locConstants.vectorWorkbench.cosine2 },
    { value: "euclidean", label: locConstants.vectorWorkbench.euclidean2 },
    { value: "dot", label: locConstants.vectorWorkbench.negativeDotProduct },
];

const OP_OPTIONS: Array<{ value: VectorSearchPredicateOp; label: string }> = [
    { value: "eq", label: "=" },
    { value: "ne", label: "<>" },
    { value: "gt", label: ">" },
    { value: "ge", label: ">=" },
    { value: "lt", label: "<" },
    { value: "le", label: "<=" },
];

interface PredicateDraft {
    column: string;
    op: VectorSearchPredicateOp;
    value: string;
}

/** Typed value from the filter-row text: 'x' quoted → string, null/true/false
 *  keywords, numeric text → number, anything else → string verbatim. */
export function parsePredicateValue(text: string): string | number | boolean | null {
    const trimmed = text.trim();
    if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
        return trimmed.slice(1, -1);
    }
    const lower = trimmed.toLowerCase();
    if (lower === "null") {
        return null;
    }
    if (lower === "true") {
        return true;
    }
    if (lower === "false") {
        return false;
    }
    // Preserve numeric-looking text exactly. The host validates it against the
    // catalog type and quotes it as an inert literal; converting through JS
    // Number would round decimal(38) predicates before SQL sees them.
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) return trimmed;
    return text;
}

function targetLabel(target: VectorSearchTargetInfo): string {
    const dims = target.dimensions !== undefined ? ` ${formatCount(target.dimensions)}·f32` : "";
    const key = target.keyColumn ? "" : " (no single-column key)";
    return `${target.schema}.${target.table}.${target.vectorColumn}${dims}${key}`;
}

function approxAvailability(
    caps: QsVectorCapabilitiesResult | undefined,
    target: VectorSearchTargetInfo | undefined,
    metric: VectorSearchMetric,
): { available: boolean; reason?: string } {
    if (!caps) {
        return { available: false, reason: "Probing capabilities…" };
    }
    if (!caps.probe) {
        return {
            available: false,
            reason: caps.error ?? locConstants.vectorWorkbench.capabilitiesCouldNotBeProbed,
        };
    }
    const tvf = caps.probe.vectorSearchTvf;
    if (tvf.status !== "accepted") {
        return {
            available: false,
            reason: `VECTOR_SEARCH ${tvf.status}${tvf.message ? ` — ${tvf.message}` : ""}`,
        };
    }
    if (!caps.probe.indexes.available) {
        return {
            available: false,
            reason: caps.probe.indexes.error
                ? `Vector index visibility is unavailable — ${caps.probe.indexes.error}`
                : "Vector index visibility is unavailable — exact search still runs.",
        };
    }
    if (target) {
        const confirmed = caps.probe.indexes.indexes.some(
            (index) =>
                index.schemaName === target.schema &&
                index.tableName === target.table &&
                index.vectorColumn === target.vectorColumn &&
                index.distanceMetric?.toLowerCase() === metric.toLowerCase(),
        );
        if (!confirmed) {
            return {
                available: false,
                reason: `No compatible vector index on ${target.schema}.${target.table} — exact search still runs.`,
            };
        }
    }
    return { available: true };
}

// ---------------------------------------------------------------------------
// Rank flow (SVG slope graph — r06: `M 0 y1 C 55 y1 55 y2 120 y2`)
// ---------------------------------------------------------------------------

const FLOW_ROW_H = 15;
const FLOW_PAD = 6;
const FLOW_W = 120;
const RANK_ROW_HEIGHT = 24;
const RANK_WINDOW_ROWS = 32;

function flowY(rank: number): number {
    return FLOW_PAD + (rank - 0.5) * FLOW_ROW_H;
}

function RankFlow(props: { rows: readonly VectorSearchRankRow[] }): React.JSX.Element {
    const matched = props.rows
        .filter((row) => row.exactRank !== undefined && row.approxRank !== undefined)
        .filter((row) => (row.exactRank ?? 0) <= 50 && (row.approxRank ?? 0) <= 50);
    const maxRank = Math.max(
        1,
        ...matched.map((row) => Math.max(row.exactRank ?? 0, row.approxRank ?? 0)),
    );
    const height = FLOW_PAD * 2 + maxRank * FLOW_ROW_H;
    const stroke = (delta: number | undefined): string =>
        delta === undefined || delta === 0
            ? "var(--vscode-descriptionForeground)"
            : delta > 0
              ? "var(--vscode-charts-orange)"
              : "var(--vscode-charts-green)";
    return (
        <div className="qs-vec8-flow" aria-hidden="true">
            <div className="qs-vec8-flow-header">
                <span>{locConstants.vectorWorkbench.exact}</span>
                <span>{locConstants.vectorWorkbench.approx}</span>
            </div>
            <svg width={FLOW_W} height={height}>
                {matched.map((row) => {
                    const y1 = flowY(row.exactRank!);
                    const y2 = flowY(row.approxRank!);
                    return (
                        <g key={String(row.key)}>
                            <path
                                d={`M 0 ${y1} C 55 ${y1} 55 ${y2} ${FLOW_W} ${y2}`}
                                fill="none"
                                stroke={stroke(row.delta)}
                                strokeWidth={1}
                                opacity={row.delta === 0 ? 0.55 : 0.9}
                            />
                            <circle cx={0} cy={y1} r={2} fill={stroke(row.delta)} />
                            <circle cx={FLOW_W} cy={y2} r={2} fill={stroke(row.delta)} />
                        </g>
                    );
                })}
            </svg>
        </div>
    );
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export function VectorSearchView(props: VectorSearchViewProps): React.JSX.Element {
    const {
        rpc,
        handle,
        generation,
        totalRows,
        expressionBasketOrdinals,
        active,
        panelActive = active,
        sessionReady = active,
        authoritativeTargetId,
        perfAction,
        initialViewState,
        onViewStateChange,
    } = props;
    const [targetsResult, setTargetsResult] = React.useState<
        QsVectorSearchTargetsResult | undefined
    >();
    const [targetsRefreshSerial, setTargetsRefreshSerial] = React.useState(0);
    const [targetsRefreshing, setTargetsRefreshing] = React.useState(false);
    const [caps, setCaps] = React.useState<QsVectorCapabilitiesResult | undefined>();
    const [targetIndex, setTargetIndex] = React.useState(0);
    const [sourceTab, setSourceTab] = React.useState<SourceTab>(
        initialViewState?.source === "pastedVector"
            ? "paste"
            : initialViewState?.source === "generatedVector"
              ? "text"
              : initialViewState?.source === "expression"
                ? "expression"
                : "row",
    );
    const [ordinalText, setOrdinalText] = React.useState(
        String(initialViewState?.selectedRowOrdinal ?? 0),
    );
    const [pasteText, setPasteText] = React.useState("");
    const [modelText, setModelText] = React.useState(initialViewState?.modelText ?? "");
    const [modelParameters, setModelParameters] = React.useState(
        initialViewState?.modelParameters ?? "",
    );
    const [modelsResult, setModelsResult] = React.useState<QsVectorSearchModelsResult>();
    const [selectedModelId, setSelectedModelId] = React.useState<string | undefined>(
        initialViewState?.modelId,
    );
    const [modelBusy, setModelBusy] = React.useState(false);
    const [modelExecutionPending, setModelExecutionPending] = React.useState(false);
    const [modelPrepare, setModelPrepare] = React.useState<QsVectorSearchModelPrepareResult>();
    const [modelSqlOpen, setModelSqlOpen] = React.useState(false);
    const [generatedVectorId, setGeneratedVectorId] = React.useState<string | undefined>();
    const [generatedDimensions, setGeneratedDimensions] = React.useState<number>();
    const [modelCallCounts, setModelCallCounts] =
        React.useState<VectorModelStatementCounts>(EMPTY_MODEL_CALL_COUNTS);
    const [expressionText, setExpressionText] = React.useState(
        initialViewState?.expression ?? locConstants.vectorWorkbench.normalizeAB,
    );
    const [metric, setMetric] = React.useState<VectorSearchMetric>(
        initialViewState?.metric ?? "cosine",
    );
    const [k, setK] = React.useState(initialViewState?.k ?? VECTOR_SEARCH_DEFAULT_K);
    const [includeApprox, setIncludeApprox] = React.useState(
        initialViewState?.includeApprox ?? true,
    );
    const [predicates, setPredicates] = React.useState<PredicateDraft[]>(
        initialViewState?.filters ?? [],
    );
    const [busy, setBusy] = React.useState(false);
    const [cancelling, setCancelling] = React.useState(false);
    const [error, setError] = React.useState<string | undefined>();
    const [comparison, setComparison] = React.useState<QsVectorSearchComparison | undefined>();
    const [lastRunId, setLastRunId] = React.useState<string | undefined>(
        initialViewState?.lastRunId,
    );
    const [sqlOpen, setSqlOpen] = React.useState(initialViewState?.sqlOpen ?? false);
    const [sqlTab, setSqlTab] = React.useState<"exact" | "approx">(
        initialViewState?.sqlTab ?? "exact",
    );
    const [sqlScrollPositions, setSqlScrollPositions] = React.useState(
        initialViewState?.sqlScrollPositions ?? {
            exact: { scrollTop: 0, scrollLeft: 0 },
            approx: { scrollTop: 0, scrollLeft: 0 },
        },
    );
    const [selectedRankIndex, setSelectedRankIndex] = React.useState<number | undefined>(
        initialViewState?.selectedRankIndex,
    );
    const [rankScrollTop, setRankScrollTop] = React.useState(initialViewState?.rankScrollTop ?? 0);
    const [sqlCopied, setSqlCopied] = React.useState(false);
    const rankScrollRef = React.useRef<HTMLDivElement | null>(null);
    const sqlScrollRef = React.useRef<HTMLPreElement | null>(null);
    const rankScrollRafRef = React.useRef(0);
    const rankPendingScrollTopRef = React.useRef(rankScrollTop);
    const requestSerial = React.useRef(0);
    const handleRef = React.useRef(handle);
    handleRef.current = handle;
    const modelRequestSerial = React.useRef(0);
    const searchInFlightRef = React.useRef(false);
    const latestViewStateRef = React.useRef<QsVectorSearchViewState | undefined>(undefined);
    const selectedTargetIdRef = React.useRef(initialViewState?.targetId);
    /**
     * Last targetId this view EMITTED through onViewStateChange. The
     * authoritative prop echoes emissions back one commit later, so a local
     * dropdown pick briefly renders against a stale prop; treating that echo
     * as an external (Index-initiated) change reverts the pick, the persist
     * effect re-emits the reverted value, and the two effects leapfrog
     * forever — the whole pane flickers as dependent controls reset each
     * cycle. Only a prop that differs from our own last emission is real.
     */
    const lastEmittedTargetIdRef = React.useRef(initialViewState?.targetId);
    const initialRestoreTargetIdRef = React.useRef(initialViewState?.targetId);
    const initialRunIdRef = React.useRef(initialViewState?.lastRunId);
    const restoreAttemptedRef = React.useRef(false);
    const composerInitializedRef = React.useRef(false);
    const suppressComposerInvalidationRef = React.useRef(false);
    const restoringTargetRef = React.useRef(false);
    const applyingPerfActionRef = React.useRef(false);
    const processedPerfActionRef = React.useRef(0);
    const modelTriggerRef = React.useRef<HTMLButtonElement | null>(null);
    const modelDialogRef = React.useRef<HTMLDivElement | null>(null);

    const targets = targetsResult?.targets ?? [];
    const target = targets[Math.min(targetIndex, Math.max(0, targets.length - 1))];
    const approx = approxAvailability(caps, target, metric);
    const expressionBasket = React.useMemo(
        () => expressionBasketOrdinals?.slice(0, VECTOR_EXPRESSION_SYMBOLS.length),
        [expressionBasketOrdinals],
    );
    const expressionBasketKey = expressionBasket?.join(",") ?? "";
    const expressionValidation = React.useMemo(
        () => validateExpressionComposer(expressionText, expressionBasket, totalRows),
        [expressionBasket, expressionText, totalRows],
    );

    const loadModels = React.useCallback(
        async (refresh = false) => {
            const serial = ++modelRequestSerial.current;
            setModelBusy(true);
            try {
                const result = await rpc.sendRequest<
                    { readonly handle: string; readonly refresh?: boolean },
                    QsVectorSearchModelsResult
                >(QsVectorSearchModelsRequest.type, { handle, ...(refresh ? { refresh } : {}) });
                setModelCallCounts((current) =>
                    mergeModelStatementCounts(current, result.modelStatementCounts),
                );
                if (serial !== modelRequestSerial.current) return;
                setModelsResult(result);
                setSelectedModelId((current) =>
                    result.models.some((model) => model.id === current)
                        ? current
                        : result.models[0]?.id,
                );
            } catch (cause) {
                if (serial === modelRequestSerial.current) {
                    setModelsResult({
                        models: [],
                        modelStatementCounts: EMPTY_MODEL_CALL_COUNTS,
                        error: cause instanceof Error ? cause.message : String(cause),
                    });
                }
            } finally {
                if (serial === modelRequestSerial.current) setModelBusy(false);
            }
        },
        [handle, rpc],
    );

    React.useEffect(() => {
        if (!active || sourceTab !== "text" || modelsResult) return;
        void loadModels();
    }, [active, loadModels, modelsResult, sourceTab]);

    React.useEffect(() => {
        const dialog = modelDialogRef.current;
        if (!modelPrepare?.confirmationToken || !dialog) return;
        const focusable = () =>
            Array.from(
                dialog.querySelectorAll<HTMLElement>(
                    'button:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
                ),
            );
        focusable()[0]?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                modelRequestSerial.current++;
                setModelPrepare(undefined);
                setModelSqlOpen(false);
                setModelBusy(false);
                setModelExecutionPending(false);
                void rpc
                    .sendRequest(QsVectorSearchCancelRequest.type, { handle })
                    .catch(() => undefined);
                modelTriggerRef.current?.focus();
                return;
            }
            if (event.key !== "Tab") return;
            const items = focusable();
            if (items.length === 0) return;
            const first = items[0];
            const last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        dialog.addEventListener("keydown", onKeyDown);
        return () => dialog.removeEventListener("keydown", onKeyDown);
    }, [handle, modelBusy, modelPrepare?.confirmationToken, rpc]);

    const catalogContext = JSON.stringify([handle, generation]);
    const [activatedCatalogContext, setActivatedCatalogContext] = React.useState<string>();
    React.useEffect(() => {
        if (active) setActivatedCatalogContext(catalogContext);
    }, [active, catalogContext]);

    // Keep completed catalog work across workspace switches. A new handle,
    // generation, or explicit refresh still invalidates the load.
    React.useEffect(() => {
        if (activatedCatalogContext !== catalogContext) {
            return;
        }
        let cancelled = false;
        requestSerial.current++;
        setTargetsRefreshing(true);
        setError(undefined);
        setTargetsResult(undefined);
        setCaps(undefined);
        void (async () => {
            try {
                const [targetsRes, capsRes] = await Promise.all([
                    rpc.sendRequest<QsVectorSearchTargetsParams, QsVectorSearchTargetsResult>(
                        QsVectorSearchTargetsRequest.type,
                        { handle },
                    ),
                    rpc.sendRequest<QsVectorCapabilitiesParams, QsVectorCapabilitiesResult>(
                        QsVectorCapabilitiesRequest.type,
                        {},
                    ),
                ]);
                if (!cancelled) {
                    setTargetsResult(targetsRes);
                    setCaps(capsRes);
                    const previousTargetId = selectedTargetIdRef.current;
                    const restoredIndex = targetsRes.targets?.findIndex(
                        (candidate) => candidate.id === previousTargetId,
                    );
                    const nextIndex =
                        restoredIndex !== undefined && restoredIndex >= 0 ? restoredIndex : 0;
                    setTargetIndex((current) => {
                        if (current === nextIndex) {
                            return current;
                        }
                        restoringTargetRef.current = true;
                        return nextIndex;
                    });
                    if (previousTargetId && targetsRes.targets && restoredIndex === -1) {
                        setComparison(undefined);
                        setLastRunId(undefined);
                        setSelectedRankIndex(undefined);
                        setRankScrollTop(0);
                    }
                    selectedTargetIdRef.current = targetsRes.targets?.[nextIndex]?.id;
                }
            } catch (e) {
                if (!cancelled) {
                    setTargetsResult({ error: e instanceof Error ? e.message : String(e) });
                }
            } finally {
                if (!cancelled) {
                    setTargetsRefreshing(false);
                }
            }
        })();
        return () => {
            cancelled = true;
            requestSerial.current++;
        };
    }, [activatedCatalogContext, catalogContext, generation, handle, rpc, targetsRefreshSerial]);

    React.useEffect(() => {
        if (target?.id) {
            selectedTargetIdRef.current = target.id;
        } else if (targetsResult?.targets) {
            selectedTargetIdRef.current = undefined;
        }
    }, [target?.id, targetsResult]);

    // Index and Search share one host-verified target binding. Apply an Index
    // selection in place so transient composer input (notably pasted vectors)
    // survives; only facts/results that belong to the old table are cleared.
    React.useEffect(() => {
        if (!active) {
            return;
        }
        const nextIndex = resolveAuthoritativeVectorTargetIndex({
            authoritativeTargetId,
            lastEmittedTargetId: lastEmittedTargetIdRef.current,
            currentTargetId: target?.id,
            targets: targetsResult?.targets,
        });
        if (nextIndex === undefined) {
            return;
        }
        selectedTargetIdRef.current = authoritativeTargetId;
        setTargetIndex(nextIndex);
        setPredicates([]);
        setGeneratedVectorId(undefined);
        setGeneratedDimensions(undefined);
        requestSerial.current++;
        setComparison(undefined);
        setLastRunId(undefined);
        setSelectedRankIndex(undefined);
        setRankScrollTop(0);
        setError(undefined);
    }, [active, authoritativeTargetId, target?.id, targetsResult?.targets]);

    React.useEffect(() => {
        const runId = initialRunIdRef.current;
        const targetId = initialRestoreTargetIdRef.current;
        if (
            !active ||
            !runId ||
            !targetId ||
            !targetsResult ||
            targetsRefreshSerial > 0 ||
            restoreAttemptedRef.current
        ) {
            return;
        }
        restoreAttemptedRef.current = true;
        if (
            target?.id !== targetId ||
            !targetsResult.targets?.some((candidate) => candidate.id === targetId)
        ) {
            setLastRunId(undefined);
            return;
        }
        const serial = ++requestSerial.current;
        let cancelled = false;
        void rpc
            .sendRequest<
                { readonly handle: string; readonly runId: string; readonly targetId: string },
                QsVectorSearchResult
            >(QsVectorSearchResultRequest.type, { handle, runId, targetId })
            .then((result) => {
                if (
                    !cancelled &&
                    serial === requestSerial.current &&
                    handle === handleRef.current &&
                    result.runId === runId &&
                    result.comparison
                ) {
                    setComparison(result.comparison);
                    setLastRunId(runId);
                }
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [active, generation, handle, rpc, target?.id, targetsRefreshSerial, targetsResult]);

    React.useEffect(() => {
        const ordinal = Number(ordinalText.trim().replace(/^#/, ""));
        const persistedTargetId =
            target?.id ?? (targetsResult?.targets ? undefined : selectedTargetIdRef.current);
        lastEmittedTargetIdRef.current = persistedTargetId;
        const viewState: QsVectorSearchViewState = {
            source:
                sourceTab === "row"
                    ? "selectedRow"
                    : sourceTab === "text"
                      ? "generatedVector"
                      : sourceTab === "paste"
                        ? "pastedVector"
                        : "expression",
            selectedRowOrdinal: Number.isInteger(ordinal) && ordinal >= 0 ? ordinal : 0,
            expression: expressionText,
            ...(persistedTargetId ? { targetId: persistedTargetId } : {}),
            ...(modelText.length > 0 ? { modelText } : {}),
            ...(selectedModelId ? { modelId: selectedModelId } : {}),
            ...(modelParameters.length > 0 ? { modelParameters } : {}),
            ...(lastRunId ? { lastRunId } : {}),
            metric,
            k: clampKLocal(k),
            includeApprox,
            // Preserve filter structure across webview recreation without
            // retaining values that may contain result keys or secrets.
            filters: predicates.slice(0, 8).map((predicate) => ({
                ...predicate,
                value: "",
            })),
            sqlOpen,
            sqlTab,
            sqlScrollPositions,
            ...(selectedRankIndex !== undefined ? { selectedRankIndex } : {}),
            rankScrollTop,
        };
        latestViewStateRef.current = viewState;
        onViewStateChange?.(viewState);
    }, [
        includeApprox,
        expressionText,
        k,
        lastRunId,
        metric,
        modelParameters,
        modelText,
        onViewStateChange,
        ordinalText,
        predicates,
        rankScrollTop,
        selectedModelId,
        selectedRankIndex,
        sourceTab,
        sqlOpen,
        sqlScrollPositions,
        sqlTab,
        target?.id,
        targetsResult?.targets,
    ]);

    // A comparison is an immutable snapshot of the composer that produced it.
    // Changing any input removes the old answer instead of presenting it as
    // evidence for the new composition.
    React.useEffect(() => {
        if (!composerInitializedRef.current) {
            composerInitializedRef.current = true;
            return;
        }
        if (restoringTargetRef.current) {
            restoringTargetRef.current = false;
            return;
        }
        if (applyingPerfActionRef.current) {
            applyingPerfActionRef.current = false;
            return;
        }
        if (suppressComposerInvalidationRef.current) {
            suppressComposerInvalidationRef.current = false;
            return;
        }
        requestSerial.current++;
        setComparison(undefined);
        setLastRunId(undefined);
        setSelectedRankIndex(undefined);
        setRankScrollTop(0);
    }, [
        sourceTab,
        ordinalText,
        pasteText,
        expressionText,
        expressionBasketKey,
        generatedVectorId,
        targetIndex,
        metric,
        k,
        includeApprox,
        predicates,
    ]);

    React.useLayoutEffect(() => {
        if (comparison && rankScrollRef.current) {
            rankScrollRef.current.scrollTop = rankScrollTop;
        }
    }, [comparison, rankScrollTop]);

    React.useLayoutEffect(() => {
        if (!sqlOpen || !sqlScrollRef.current) {
            return;
        }
        const position = sqlScrollPositions[sqlTab];
        sqlScrollRef.current.scrollTop = position.scrollTop;
        sqlScrollRef.current.scrollLeft = position.scrollLeft;
    }, [comparison, sqlOpen, sqlScrollPositions, sqlTab]);

    React.useEffect(
        () => () => {
            if (rankScrollRafRef.current !== 0) {
                cancelAnimationFrame(rankScrollRafRef.current);
            }
            const latest = latestViewStateRef.current;
            if (latest) {
                onViewStateChange?.({
                    ...latest,
                    rankScrollTop: rankPendingScrollTopRef.current,
                });
            }
        },
        [onViewStateChange],
    );

    React.useEffect(
        () => () => {
            requestSerial.current++;
            modelRequestSerial.current++;
            if (searchInFlightRef.current) {
                searchInFlightRef.current = false;
            }
            void rpc
                .sendRequest(QsVectorSearchCancelRequest.type, { handle, sensitive: true })
                .catch(() => undefined);
        },
        [generation, handle, rpc],
    );

    React.useEffect(() => {
        if (
            active ||
            (!searchInFlightRef.current &&
                !targetsRefreshing &&
                !modelBusy &&
                !modelPrepare?.confirmationToken)
        ) {
            return;
        }
        requestSerial.current++;
        modelRequestSerial.current++;
        searchInFlightRef.current = false;
        setBusy(false);
        setCancelling(false);
        setTargetsRefreshing(false);
        setModelBusy(false);
        setModelExecutionPending(false);
        setModelPrepare(undefined);
        setModelSqlOpen(false);
        void rpc.sendRequest(QsVectorSearchCancelRequest.type, { handle }).catch(() => undefined);
    }, [active, handle, modelBusy, modelPrepare?.confirmationToken, rpc, targetsRefreshing]);

    React.useEffect(() => {
        if (panelActive) return;
        modelRequestSerial.current++;
        void rpc
            .sendRequest(QsVectorSearchCancelRequest.type, { handle, sensitive: true })
            .catch(() => undefined);
        // In-flight/derived model state dies with panel visibility; the
        // user's DRAFT text and parameters survive (restore contract —
        // hiding a panel must not eat unsent typing).
        setModelPrepare(undefined);
        setModelSqlOpen(false);
        setModelBusy(false);
        setModelExecutionPending(false);
        if (generatedVectorId !== undefined) {
            suppressComposerInvalidationRef.current = true;
            setGeneratedVectorId(undefined);
        }
        setGeneratedDimensions(undefined);
    }, [generatedVectorId, handle, panelActive, rpc]);

    React.useEffect(() => {
        if (sessionReady) return;
        modelRequestSerial.current++;
        void rpc
            .sendRequest(QsVectorSearchCancelRequest.type, { handle, sensitive: true })
            .catch(() => undefined);
        setModelPrepare(undefined);
        setModelSqlOpen(false);
        setModelBusy(false);
        setModelExecutionPending(false);
        if (generatedVectorId !== undefined) {
            suppressComposerInvalidationRef.current = true;
            setGeneratedVectorId(undefined);
        }
        setGeneratedDimensions(undefined);
    }, [generatedVectorId, handle, rpc, sessionReady]);

    const clampKLocal = (value: number): number =>
        Math.min(
            VECTOR_SEARCH_MAX_K,
            Math.max(VECTOR_SEARCH_MIN_K, Math.floor(value) || VECTOR_SEARCH_MIN_K),
        );

    const composedError = (): string | undefined => {
        if (targetsResult?.error) {
            return `Search targets are using a last-verified snapshot because refresh failed: ${targetsResult.error}`;
        }
        if (!target) {
            return locConstants.vectorWorkbench.noSearchTargetsTheConnectedDatabaseHasNo;
        }
        if (!target.keyColumn) {
            return `${target.schema}.${target.table} has no single-column unique key; it cannot be searched.`;
        }
        if (sourceTab === "row") {
            const ordinal = Number(ordinalText.trim().replace(/^#/, ""));
            if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= totalRows) {
                return `Enter a result-row ordinal between 0 and ${totalRows - 1}.`;
            }
        } else if (sourceTab === "text") {
            if (!generatedVectorId) {
                return locConstants.vectorWorkbench.generateAndConfirmAnEmbeddingForTheCurrent;
            }
        } else if (sourceTab === "paste" && pasteText.trim().length === 0) {
            return locConstants.vectorWorkbench.pasteAFlatJSONArrayOfFiniteNumbers;
        } else if (sourceTab === "expression") {
            return expressionValidation.error;
        }
        return undefined;
    };

    const executeSearch = React.useCallback(
        async (params: QsVectorSearchParams) => {
            const serial = ++requestSerial.current;
            searchInFlightRef.current = true;
            setCancelling(false);
            setBusy(true);
            setError(undefined);
            try {
                const result = await rpc.sendRequest<QsVectorSearchParams, QsVectorSearchResult>(
                    QsVectorSearchRequest.type,
                    params,
                );
                if (serial !== requestSerial.current || params.handle !== handleRef.current) {
                    return; // stale — a newer run superseded it
                }
                // Analysis cancellation advances the host generation without
                // changing this source. Search has its own request lifetime.
                if (result.error || !result.comparison) {
                    setError(
                        result.error ?? locConstants.vectorWorkbench.theSearchReturnedNoComparison,
                    );
                } else {
                    setComparison(result.comparison);
                    setLastRunId(result.runId);
                    setSelectedRankIndex(undefined);
                    setRankScrollTop(0);
                    setSqlTab("exact");
                    setSqlScrollPositions({
                        exact: { scrollTop: 0, scrollLeft: 0 },
                        approx: { scrollTop: 0, scrollLeft: 0 },
                    });
                }
            } catch (e) {
                if (serial === requestSerial.current) {
                    setError(e instanceof Error ? e.message : String(e));
                }
            } finally {
                if (serial === requestSerial.current) {
                    searchInFlightRef.current = false;
                    setBusy(false);
                }
            }
        },
        [rpc],
    );

    const invalidateGeneratedVector = React.useCallback(() => {
        setGeneratedVectorId(undefined);
        setGeneratedDimensions(undefined);
    }, []);

    const prepareModelCall = async () => {
        if (!target) {
            setError(locConstants.vectorWorkbench.feedback3);
            return;
        }
        if (!selectedModelId) {
            setError(locConstants.vectorWorkbench.feedback4);
            return;
        }
        if (modelsResult?.error) {
            setError(locConstants.vectorWorkbench.feedback5(String(modelsResult.error)));
            return;
        }
        if (modelText.trim().length === 0) {
            setError(locConstants.vectorWorkbench.feedback6);
            return;
        }
        if (
            modelText.length > VECTOR_SEARCH_MODEL_TEXT_MAX_CHARS ||
            new TextEncoder().encode(modelText).byteLength > VECTOR_SEARCH_MODEL_TEXT_MAX_UTF8_BYTES
        ) {
            setError(locConstants.vectorWorkbench.feedback7);
            return;
        }
        if (
            modelParameters.trim().length > 0 &&
            new TextEncoder().encode(modelParameters).byteLength >
                VECTOR_SEARCH_MODEL_PARAMETERS_MAX_UTF8_BYTES
        ) {
            setError(locConstants.vectorWorkbench.feedback8);
            return;
        }
        const serial = ++modelRequestSerial.current;
        setModelBusy(true);
        setError(undefined);
        setModelPrepare(undefined);
        setModelSqlOpen(false);
        try {
            const prepared = await rpc.sendRequest<
                {
                    readonly handle: string;
                    readonly targetId: string;
                    readonly modelId: string;
                    readonly text: string;
                    readonly parametersJson?: string;
                },
                QsVectorSearchModelPrepareResult
            >(QsVectorSearchModelPrepareRequest.type, {
                handle,
                targetId: target.id,
                modelId: selectedModelId,
                text: modelText,
                ...(modelParameters.trim().length > 0 ? { parametersJson: modelParameters } : {}),
            });
            if (serial !== modelRequestSerial.current) return;
            if (
                prepared.error ||
                !prepared.confirmationToken ||
                !prepared.descriptor ||
                !prepared.generatedSql
            ) {
                setError(
                    prepared.error ??
                        locConstants.vectorWorkbench.theHostRefusedTheModelCallConfirmation,
                );
                return;
            }
            setModelPrepare(prepared);
        } catch (cause) {
            if (serial === modelRequestSerial.current) {
                setError(cause instanceof Error ? cause.message : String(cause));
            }
        } finally {
            if (serial === modelRequestSerial.current) setModelBusy(false);
        }
    };

    const closeModelDialog = () => {
        modelRequestSerial.current++;
        setModelPrepare(undefined);
        setModelSqlOpen(false);
        setModelBusy(false);
        setModelExecutionPending(false);
        void rpc.sendRequest(QsVectorSearchCancelRequest.type, { handle }).catch(() => undefined);
        modelTriggerRef.current?.focus();
    };

    const executeModelCall = async () => {
        const token = modelPrepare?.confirmationToken;
        if (!token) return;
        const serial = ++modelRequestSerial.current;
        setModelBusy(true);
        setModelExecutionPending(true);
        setError(undefined);
        try {
            const result = await rpc.sendRequest<
                { readonly handle: string; readonly token: string },
                QsVectorSearchModelExecuteResult
            >(QsVectorSearchModelExecuteRequest.type, { handle, token });
            if (result.modelStatementCounts) {
                setModelCallCounts((current) =>
                    mergeModelStatementCounts(current, result.modelStatementCounts!),
                );
            }
            if (serial !== modelRequestSerial.current) return;
            if (result.error || !result.generatedVectorId || result.dimensions === undefined) {
                setError(
                    result.error ?? locConstants.vectorWorkbench.theModelReturnedNoUsableEmbedding,
                );
                setModelPrepare(undefined);
                return;
            }
            setGeneratedVectorId(result.generatedVectorId);
            setGeneratedDimensions(result.dimensions);
            setModelPrepare(undefined);
            setModelSqlOpen(false);
        } catch (cause) {
            if (serial === modelRequestSerial.current) {
                setError(cause instanceof Error ? cause.message : String(cause));
                setModelPrepare(undefined);
            }
        } finally {
            if (serial === modelRequestSerial.current) {
                setModelBusy(false);
                setModelExecutionPending(false);
                modelTriggerRef.current?.focus();
            }
        }
    };

    const run = async () => {
        const invalid = composedError();
        if (invalid) {
            setError(invalid);
            return;
        }
        const predicateInputs: VectorSearchPredicateInput[] = predicates
            .filter((draft) => draft.column.trim().length > 0)
            .map((draft) => ({
                column: draft.column.trim(),
                op: draft.op,
                value: parsePredicateValue(draft.value),
            }));
        await executeSearch({
            handle,
            source:
                sourceTab === "row"
                    ? {
                          kind: "selectedRow",
                          ordinal: Number(ordinalText.trim().replace(/^#/, "")),
                      }
                    : sourceTab === "text"
                      ? { kind: "generatedVector", id: generatedVectorId! }
                      : sourceTab === "paste"
                        ? { kind: "pastedVector", json: pasteText }
                        : {
                              kind: "expression",
                              expression: expressionText,
                              basket: expressionBasket!.map((ordinal, index) => ({
                                  symbol: VECTOR_EXPRESSION_SYMBOLS[index],
                                  ordinal,
                              })),
                          },
            targetId: target!.id,
            metric,
            k: clampKLocal(k),
            ...(predicateInputs.length > 0 ? { predicates: predicateInputs } : {}),
            includeApprox: includeApprox && approx.available,
        });
    };

    React.useEffect(() => {
        const vector = perfAction?.vector;
        const requestId = perfAction?.requestId;
        if (
            !active ||
            vector?.workspace !== "search" ||
            requestId === undefined ||
            processedPerfActionRef.current === requestId ||
            !targetsResult ||
            !caps
        ) {
            return;
        }
        processedPerfActionRef.current = requestId;
        if (targetsResult.error || !targetsResult.targets) {
            setError(
                targetsResult.error ??
                    locConstants.vectorWorkbench.vectorSearchTargetDiscoveryReturnedNoResult,
            );
            return;
        }
        const action = vector.search;
        if (action.source.ordinal >= totalRows) {
            setError(locConstants.vectorWorkbench.feedback9);
            return;
        }
        const resolved = resolveVectorPerfSearchTarget(action, targetsResult.targets);
        if ("error" in resolved) {
            setError(resolved.error);
            return;
        }
        const requestedApprox = approxAvailability(caps, resolved.target, action.metric);
        applyingPerfActionRef.current = true;
        selectedTargetIdRef.current = resolved.target.id;
        setTargetIndex(resolved.targetIndex);
        setSourceTab("row");
        setOrdinalText(String(action.source.ordinal));
        setPasteText("");
        setMetric(action.metric);
        setK(action.k);
        setIncludeApprox(action.includeApprox);
        setPredicates([]);
        void executeSearch({
            handle,
            source: action.source,
            targetId: resolved.target.id,
            metric: action.metric,
            k: action.k,
            includeApprox: action.includeApprox && requestedApprox.available,
        });
    }, [active, caps, executeSearch, handle, perfAction, targetsResult, totalRows]);

    const cancel = async () => {
        requestSerial.current++;
        setCancelling(true);
        setError(locConstants.vectorWorkbench.feedback10);
        setComparison(undefined);
        setLastRunId(undefined);
        setSelectedRankIndex(undefined);
        await rpc.sendRequest(QsVectorSearchCancelRequest.type, { handle }).catch(() => undefined);
        searchInFlightRef.current = false;
        setCancelling(false);
        setBusy(false);
    };

    const recall = comparison?.recall;
    const recallDenominator = recall ? Math.min(comparison!.k, recall.exactCount) : undefined;
    const showApproxColumns = comparison?.approx !== undefined;
    const rankWindowStart = comparison
        ? Math.max(0, Math.floor(rankScrollTop / RANK_ROW_HEIGHT) - 5)
        : 0;
    const rankWindowEnd = comparison
        ? Math.min(comparison.rankRows.length, rankWindowStart + RANK_WINDOW_ROWS)
        : 0;
    const rankRenderIndexes = Array.from(
        new Set([
            ...Array.from(
                { length: Math.max(0, rankWindowEnd - rankWindowStart) },
                (_, offset) => rankWindowStart + offset,
            ),
            ...(selectedRankIndex !== undefined ? [selectedRankIndex] : []),
        ]),
    ).sort((a, b) => a - b);
    const rankColumnCount = showApproxColumns ? 7 : 3;
    const selectedRank =
        selectedRankIndex !== undefined ? comparison?.rankRows[selectedRankIndex] : undefined;
    const visibleSql = comparison
        ? sqlTab === "approx"
            ? comparison.executedSql.approx
            : comparison.executedSql.exact
        : undefined;

    const focusRankRow = React.useCallback(
        (requestedIndex: number) => {
            if (!comparison || comparison.rankRows.length === 0) {
                return;
            }
            const index = Math.min(comparison.rankRows.length - 1, Math.max(0, requestedIndex));
            setSelectedRankIndex(index);
            const scroll = rankScrollRef.current;
            if (scroll) {
                const rowTop = index * RANK_ROW_HEIGHT;
                const rowBottom = rowTop + RANK_ROW_HEIGHT;
                if (rowTop < scroll.scrollTop) {
                    scroll.scrollTop = rowTop;
                } else if (rowBottom > scroll.scrollTop + scroll.clientHeight) {
                    scroll.scrollTop = rowBottom - scroll.clientHeight;
                }
                rankPendingScrollTopRef.current = scroll.scrollTop;
                setRankScrollTop(scroll.scrollTop);
                requestAnimationFrame(() => {
                    scroll.querySelector<HTMLElement>(`[data-rank-index="${index}"]`)?.focus();
                });
            }
        },
        [comparison],
    );

    const onRankKeyDown = (event: React.KeyboardEvent, index: number) => {
        let next = index;
        if (event.key === "ArrowDown") next = index + 1;
        else if (event.key === "ArrowUp") next = index - 1;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = (comparison?.rankRows.length ?? 1) - 1;
        else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setSelectedRankIndex(index);
            return;
        } else {
            return;
        }
        event.preventDefault();
        focusRankRow(next);
    };

    const onSqlTabKeyDown = (
        event: React.KeyboardEvent<HTMLButtonElement>,
        current: "exact" | "approx",
    ) => {
        const tabs: Array<"exact" | "approx"> = comparison?.executedSql.approx
            ? ["exact", "approx"]
            : ["exact"];
        const index = tabs.indexOf(current);
        let next = index;
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabs.length - 1;
        else return;
        event.preventDefault();
        const nextTab = tabs[next];
        setSqlTab(nextTab);
        event.currentTarget.parentElement
            ?.querySelector<HTMLButtonElement>(`#qs-vec8-sql-tab-${nextTab}`)
            ?.focus();
    };

    const copySql = async () => {
        if (!visibleSql) {
            return;
        }
        try {
            await navigator.clipboard.writeText(visibleSql);
            setSqlCopied(true);
            window.setTimeout(() => setSqlCopied(false), 1_500);
        } catch {
            setError(locConstants.vectorWorkbench.feedback11);
        }
    };

    const onSourceTabKeyDown = (event: React.KeyboardEvent, id: SourceTab) => {
        const index = SOURCE_TABS.findIndex(([candidate]) => candidate === id);
        let next = index;
        if (event.key === "ArrowRight") next = (index + 1) % SOURCE_TABS.length;
        else if (event.key === "ArrowLeft")
            next = (index - 1 + SOURCE_TABS.length) % SOURCE_TABS.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = SOURCE_TABS.length - 1;
        else return;
        event.preventDefault();
        setSourceTab(SOURCE_TABS[next][0]);
        const tabs =
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        tabs?.[next]?.focus();
    };

    return (
        <div className="qs-vec8-search" aria-busy={busy || modelBusy}>
            {/* -- composer ---------------------------------------------------- */}
            <div
                className="qs-vec8-tabs"
                role="tablist"
                aria-label={locConstants.vectorWorkbench.queryVectorSource}>
                {SOURCE_TABS.map(([id, label]) => (
                    <button
                        key={id}
                        id={`qs-vec8-source-tab-${id}`}
                        role="tab"
                        aria-selected={sourceTab === id}
                        aria-controls={`qs-vec8-source-panel-${id}`}
                        tabIndex={sourceTab === id ? 0 : -1}
                        disabled={busy || modelBusy}
                        className={`qs-vec8-tab${sourceTab === id ? " active" : ""}`}
                        onKeyDown={(event) => onSourceTabKeyDown(event, id)}
                        onClick={() => setSourceTab(id)}>
                        {label}
                    </button>
                ))}
            </div>
            {sourceTab === "row" ? (
                <div
                    id="qs-vec8-source-panel-row"
                    role="tabpanel"
                    aria-labelledby="qs-vec8-source-tab-row"
                    className="qs-vec8-source-row">
                    <label className="qs-vec8-inline-label" htmlFor="qs-vec8-ordinal">
                        {" "}
                        {locConstants.vectorWorkbench.resultRowOrdinal}{" "}
                    </label>
                    <input
                        id="qs-vec8-ordinal"
                        className="qs-vec8-input qs-vec-num"
                        value={ordinalText}
                        disabled={busy || modelBusy}
                        onChange={(e) => setOrdinalText(e.currentTarget.value)}
                        aria-label={locConstants.vectorWorkbench.resultRowOrdinal}
                    />
                    <span className="qs-vec-muted">
                        0–{formatCount(Math.max(0, totalRows - 1))}{" "}
                        {locConstants.vectorWorkbench.usesThisAnalysisSession39SVectorColumn}{" "}
                    </span>
                </div>
            ) : sourceTab === "text" ? (
                <div
                    id="qs-vec8-source-panel-text"
                    role="tabpanel"
                    aria-labelledby="qs-vec8-source-tab-text"
                    className="qs-vec8-model-panel">
                    <div className="qs-vec8-source-row">
                        <label className="qs-vec8-inline-label" htmlFor="qs-vec8-model">
                            {" "}
                            {locConstants.vectorWorkbench.embeddingsModel}{" "}
                        </label>
                        <select
                            id="qs-vec8-model"
                            className="qs-vec-select qs-vec8-model-select"
                            value={selectedModelId ?? ""}
                            disabled={busy || modelBusy || (modelsResult?.models.length ?? 0) === 0}
                            onChange={(event) => {
                                setSelectedModelId(event.currentTarget.value || undefined);
                                invalidateGeneratedVector();
                            }}>
                            {(modelsResult?.models.length ?? 0) === 0 ? (
                                <option value="">
                                    {modelsResult
                                        ? (modelsResult.error ??
                                          locConstants.vectorWorkbench.noVerifiedEMBEDDINGSModels)
                                        : locConstants.vectorWorkbench.loadingVerifiedModels}
                                </option>
                            ) : (
                                modelsResult!.models.map((model) => (
                                    <option key={model.id} value={model.id}>
                                        {model.name}
                                        {model.apiFormat ? ` · ${model.apiFormat}` : ""}
                                    </option>
                                ))
                            )}
                        </select>
                        <button
                            type="button"
                            className="qs-vec8-icon-btn"
                            title={locConstants.vectorWorkbench.refreshVerifiedEmbeddingModels}
                            aria-label={locConstants.vectorWorkbench.refreshVerifiedEmbeddingModels}
                            disabled={busy || modelBusy}
                            onClick={() => void loadModels(true)}>
                            <span
                                className={`codicon ${modelBusy ? "codicon-loading qs-spin" : "codicon-refresh"}`}
                                aria-hidden="true"
                            />
                        </button>
                    </div>
                    <label className="qs-vec8-model-text-label" htmlFor="qs-vec8-model-text">
                        {" "}
                        {locConstants.vectorWorkbench.textToEmbed}{" "}
                    </label>
                    <textarea
                        id="qs-vec8-model-text"
                        className="qs-vec8-model-text"
                        value={modelText}
                        rows={4}
                        maxLength={VECTOR_SEARCH_MODEL_TEXT_MAX_CHARS}
                        disabled={busy || modelBusy}
                        aria-describedby="qs-vec8-model-disclosure"
                        onChange={(event) => {
                            setModelText(event.currentTarget.value);
                            invalidateGeneratedVector();
                        }}
                    />
                    <details className="qs-vec8-model-advanced">
                        <summary>{locConstants.vectorWorkbench.advancedModelParameters}</summary>
                        <label htmlFor="qs-vec8-model-parameters">
                            {locConstants.vectorWorkbench.optionalJSONOverrides}
                        </label>
                        <textarea
                            id="qs-vec8-model-parameters"
                            className="qs-vec8-model-parameters qs-vec-num"
                            value={modelParameters}
                            rows={2}
                            disabled={busy || modelBusy}
                            placeholder={
                                locConstants.vectorWorkbench.dimensions1536SqlRestOptionsRetryCount2
                            }
                            onChange={(event) => {
                                setModelParameters(event.currentTarget.value);
                                invalidateGeneratedVector();
                            }}
                        />
                        <span className="qs-vec-muted">
                            {" "}
                            {
                                locConstants.vectorWorkbench
                                    .allowlistedOnlyDimensionsAndSqlRestOptionsRetry
                            }{" "}
                        </span>
                    </details>
                    <div id="qs-vec8-model-disclosure" className="qs-vec8-model-actions">
                        <span className="qs-vec-warning">
                            {" "}
                            {
                                locConstants.vectorWorkbench
                                    .modelCallConfirmationRequiredEgressDisclosedBeforeExecution
                            }{" "}
                        </span>
                        <span className="qs-vec-muted" role="status">
                            {modelExecutionPending
                                ? locConstants.vectorWorkbench
                                      .webviewNetworkNoneServerSideModelRequestIn
                                : modelCallClaim(modelCallCounts)}
                        </span>
                        {generatedVectorId ? (
                            <span className="qs-vec8-generated-chip" role="status">
                                <span className="codicon codicon-check" aria-hidden="true" />{" "}
                                {locConstants.vectorWorkbench.queryVectorReady}{" "}
                                {generatedDimensions !== undefined
                                    ? locConstants.vectorWorkbench.valueD(
                                          String(formatCount(generatedDimensions)),
                                      )
                                    : ""}{" "}
                                {locConstants.vectorWorkbench.panelMemoryOnly}{" "}
                            </span>
                        ) : null}
                        <button
                            ref={modelTriggerRef}
                            type="button"
                            className="qs-vec-primary"
                            disabled={
                                busy ||
                                modelBusy ||
                                !target ||
                                !selectedModelId ||
                                modelText.trim().length === 0 ||
                                Boolean(modelsResult?.error)
                            }
                            onClick={() => void prepareModelCall()}>
                            <span className="codicon codicon-sparkle" aria-hidden="true" />
                            {modelBusy
                                ? locConstants.vectorWorkbench.preparing
                                : locConstants.vectorWorkbench.generateEmbedding2}
                        </button>
                    </div>
                    {modelsResult?.error ? (
                        <div className="qs-vec-warning" role="status">
                            {" "}
                            {locConstants.vectorWorkbench.modelInventoryUnavailableOrStale}{" "}
                            {modelsResult.error}
                        </div>
                    ) : null}
                </div>
            ) : sourceTab === "paste" ? (
                <div
                    id="qs-vec8-source-panel-paste"
                    role="tabpanel"
                    aria-labelledby="qs-vec8-source-tab-paste"
                    className="qs-vec8-source-row">
                    <textarea
                        className="qs-vec8-paste qs-vec-num"
                        value={pasteText}
                        disabled={busy || modelBusy}
                        rows={3}
                        placeholder={
                            target?.dimensions !== undefined
                                ? locConstants.vectorWorkbench.value001230044FlatJSONArrayOf(
                                      String(formatCount(target.dimensions)),
                                  )
                                : locConstants.vectorWorkbench.value001230044FlatJSONArrayOf2
                        }
                        onChange={(e) => setPasteText(e.currentTarget.value)}
                        aria-label={locConstants.vectorWorkbench.pastedQueryVectorJSON}
                    />
                </div>
            ) : (
                <div
                    id="qs-vec8-source-panel-expression"
                    role="tabpanel"
                    aria-labelledby="qs-vec8-source-tab-expression"
                    className="qs-vec8-expression-panel">
                    <div className="qs-vec8-source-row">
                        <label className="qs-vec8-inline-label" htmlFor="qs-vec8-expression">
                            {" "}
                            {locConstants.vectorWorkbench.expression}{" "}
                        </label>
                        <input
                            id="qs-vec8-expression"
                            className="qs-vec8-input qs-vec8-expression-input qs-vec-num"
                            value={expressionText}
                            maxLength={2_048}
                            disabled={busy || modelBusy}
                            aria-describedby="qs-vec8-expression-status"
                            spellCheck={false}
                            onChange={(event) => setExpressionText(event.currentTarget.value)}
                        />
                    </div>
                    <div
                        className="qs-vec8-expression-basket"
                        role="list"
                        aria-label={locConstants.vectorWorkbench.compareBasket}>
                        {(expressionBasket ?? []).map((ordinal, index) => (
                            <span key={VECTOR_EXPRESSION_SYMBOLS[index]} role="listitem">
                                <strong className="qs-vec-num">
                                    {VECTOR_EXPRESSION_SYMBOLS[index]}
                                </strong>{" "}
                                = #{formatCount(ordinal)}
                            </span>
                        ))}
                    </div>
                    <div className="qs-vec8-expression-note">
                        <span className="codicon codicon-beaker" aria-hidden="true" />
                        <span>
                            {" "}
                            {
                                locConstants.vectorWorkbench
                                    .experimentalVectorArithmeticCompareBasketParsedLocallyNever
                            }{" "}
                        </span>
                    </div>
                    <div
                        id="qs-vec8-expression-status"
                        className={expressionValidation.error ? "qs-vec-error" : "qs-vec-muted"}
                        role="status">
                        {expressionValidation.error ??
                            `Valid constrained expression · ${expressionValidation.symbols?.join(", ")} · ${formatCount(expressionValidation.operationCount ?? 0)} operations · host revalidates at run`}
                    </div>
                </div>
            )}
            <div className="qs-vec8-controls">
                <label className="qs-vec8-inline-label" htmlFor="qs-vec8-target">
                    {" "}
                    {locConstants.vectorWorkbench.target}{" "}
                </label>
                <select
                    id="qs-vec8-target"
                    className="qs-vec-select"
                    value={targetIndex}
                    onChange={(e) => {
                        setTargetIndex(Number(e.currentTarget.value));
                        setPredicates([]);
                        invalidateGeneratedVector();
                    }}
                    aria-label={locConstants.vectorWorkbench.searchTarget}
                    title={locConstants.vectorWorkbench.float32SearchTargets}
                    disabled={busy || modelBusy || targets.length === 0}>
                    {targets.length === 0 ? (
                        <option value={0}>
                            {targetsResult
                                ? (targetsResult.error ??
                                  locConstants.vectorWorkbench.noVectorColumnsInThisDatabase)
                                : locConstants.vectorWorkbench.loadingTargets}
                        </option>
                    ) : (
                        targets.map((candidate, i) => (
                            <option key={candidate.id} value={i} disabled={!candidate.keyColumn}>
                                {targetLabel(candidate)}
                            </option>
                        ))
                    )}
                </select>
                <button
                    type="button"
                    className="qs-vec8-icon-btn"
                    title={locConstants.vectorWorkbench.refreshVerifiedSearchTargets}
                    aria-label={locConstants.vectorWorkbench.refreshVerifiedSearchTargets}
                    disabled={busy || modelBusy || targetsRefreshing}
                    onClick={() => setTargetsRefreshSerial((serial) => serial + 1)}>
                    <span className="codicon codicon-refresh" aria-hidden="true" />
                </button>
                {targetsResult?.error && targets.length > 0 ? (
                    <span className="qs-vec-warning" role="status">
                        {" "}
                        {
                            locConstants.vectorWorkbench
                                .lastVerifiedTargetsShownNewSearchesStayLocked
                        }{" "}
                    </span>
                ) : null}
                <label className="qs-vec8-inline-label" htmlFor="qs-vec8-metric">
                    {" "}
                    {locConstants.vectorWorkbench.metric}{" "}
                </label>
                <select
                    id="qs-vec8-metric"
                    className="qs-vec-select"
                    value={metric}
                    disabled={busy || modelBusy}
                    onChange={(e) => setMetric(e.currentTarget.value as VectorSearchMetric)}
                    aria-label={locConstants.vectorWorkbench.distanceMetric}>
                    {METRIC_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
                <span className="qs-vec8-inline-label">{locConstants.vectorWorkbench.k}</span>
                <span className="qs-vec8-stepper">
                    <button
                        aria-label={locConstants.vectorWorkbench.decreaseK}
                        disabled={busy || modelBusy}
                        onClick={() => setK((current) => clampKLocal(current - 1))}>
                        <span className="codicon codicon-remove" aria-hidden="true" />
                    </button>
                    <input
                        className="qs-vec-num"
                        value={k}
                        disabled={busy || modelBusy}
                        onChange={(e) => {
                            const value = Number(e.currentTarget.value);
                            setK(Number.isFinite(value) ? value : VECTOR_SEARCH_DEFAULT_K);
                        }}
                        onBlur={() => setK((current) => clampKLocal(current))}
                        aria-label={locConstants.vectorWorkbench.kNearestNeighbors}
                    />
                    <button
                        aria-label={locConstants.vectorWorkbench.increaseK}
                        disabled={busy || modelBusy}
                        onClick={() => setK((current) => clampKLocal(current + 1))}>
                        <span className="codicon codicon-add" aria-hidden="true" />
                    </button>
                </span>
                <label className="qs-vec8-check">
                    <input type="checkbox" checked readOnly disabled />{" "}
                    {locConstants.vectorWorkbench.exact2}{" "}
                    <span className="qs-vec-muted">
                        {" "}
                        {locConstants.vectorWorkbench.alwaysTheRecallDenominator}
                    </span>
                </label>
                <label
                    className="qs-vec8-check"
                    title={approx.available ? undefined : approx.reason}>
                    <input
                        type="checkbox"
                        checked={includeApprox && approx.available}
                        disabled={busy || modelBusy || !approx.available}
                        onChange={(e) => setIncludeApprox(e.currentTarget.checked)}
                    />{" "}
                    {locConstants.vectorWorkbench.approx2}{" "}
                    {!approx.available ? (
                        <span className="qs-vec-muted qs-vec8-approx-reason"> {approx.reason}</span>
                    ) : null}
                </label>
            </div>
            <VecSectionLabel
                right={locConstants.vectorWorkbench.aNDCombinedValidatedLiteralsInlinedHostSide}>
                {" "}
                {locConstants.vectorWorkbench.filters}{" "}
            </VecSectionLabel>
            {predicates.map((draft, i) => (
                <div key={i} className="qs-vec8-filter-row">
                    <select
                        className="qs-vec-select"
                        value={draft.column}
                        disabled={busy || modelBusy}
                        aria-label={locConstants.vectorWorkbench.filterValueColumn(String(i + 1))}
                        onChange={(e) => {
                            // Read BEFORE the updater: React nulls
                            // currentTarget after dispatch, and a deferred
                            // updater runs during render — reading the event
                            // there crashes the pane to its error boundary.
                            const column = e.currentTarget.value;
                            setPredicates((rows) =>
                                rows.map((row, j) => (j === i ? { ...row, column } : row)),
                            );
                        }}>
                        <option value="">{locConstants.vectorWorkbench.chooseColumn}</option>
                        {(target?.filterColumns ?? []).map((column) => (
                            <option key={column.name} value={column.name}>
                                {column.name} ({column.sqlType})
                            </option>
                        ))}
                    </select>
                    <select
                        className="qs-vec-select"
                        value={draft.op}
                        disabled={busy || modelBusy}
                        aria-label={locConstants.vectorWorkbench.filterValueOperator(String(i + 1))}
                        onChange={(e) => {
                            const op = e.currentTarget.value as VectorSearchPredicateOp;
                            setPredicates((rows) =>
                                rows.map((row, j) => (j === i ? { ...row, op } : row)),
                            );
                        }}>
                        {OP_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                    <input
                        className="qs-vec8-input qs-vec-num"
                        placeholder={locConstants.vectorWorkbench.valueText123TrueNull}
                        value={draft.value}
                        disabled={busy || modelBusy}
                        aria-label={locConstants.vectorWorkbench.filterValueValue(String(i + 1))}
                        onChange={(e) => {
                            const value = e.currentTarget.value;
                            setPredicates((rows) =>
                                rows.map((row, j) => (j === i ? { ...row, value } : row)),
                            );
                        }}
                    />
                    <button
                        className="qs-vec8-icon-btn"
                        aria-label={locConstants.vectorWorkbench.removeFilterValue(String(i + 1))}
                        disabled={busy || modelBusy}
                        onClick={() => setPredicates((rows) => rows.filter((_, j) => j !== i))}>
                        <span className="codicon codicon-close" aria-hidden="true" />
                    </button>
                </div>
            ))}
            <div className="qs-vec8-run-row">
                <button
                    className="qs-vec8-add-filter"
                    disabled={
                        busy ||
                        modelBusy ||
                        predicates.length >= 8 ||
                        !target?.filterColumns?.length
                    }
                    onClick={() =>
                        setPredicates((rows) => [...rows, { column: "", op: "eq", value: "" }])
                    }>
                    <span className="codicon codicon-add" aria-hidden="true" />{" "}
                    {locConstants.vectorWorkbench.addFilter}{" "}
                </button>
                <span className="qs-vec-muted qs-vec8-disclosure">
                    {" "}
                    {locConstants.vectorWorkbench.isolatedDiagnosticSessionTarget}{" "}
                    {target ? `${target.schema}.${target.table}` : "—"}{" "}
                    {locConstants.vectorWorkbench.upTo5SequentialStatementsOnOneAuxiliary}{" "}
                </span>
                {busy ? (
                    <button
                        className="qs-vec6-primary-btn"
                        disabled={cancelling}
                        onClick={() => void cancel()}>
                        <span className="codicon codicon-debug-stop" aria-hidden="true" />{" "}
                        {cancelling
                            ? locConstants.vectorWorkbench.cancelling
                            : locConstants.vectorWorkbench.cancel}
                    </button>
                ) : (
                    <button
                        className="qs-vec6-primary-btn"
                        disabled={
                            modelBusy || targets.length === 0 || Boolean(targetsResult?.error)
                        }
                        onClick={() => void run()}>
                        {" "}
                        {locConstants.vectorWorkbench.runComparison}{" "}
                    </button>
                )}
            </div>
            {error ? (
                <div className="qs-vec-error qs-vec6-inline-error" role="alert">
                    {error}
                </div>
            ) : null}

            {/* -- results ----------------------------------------------------- */}
            {!comparison && !error && !busy ? (
                <div className="qs-vec8-idle qs-muted">
                    <div className="qs-vec8-idle-head">
                        {" "}
                        {
                            locConstants.vectorWorkbench
                                .whatChangesBetweenExactAndApproximateRetrievalAnd
                        }{" "}
                    </div>
                    <div> {locConstants.vectorWorkbench.exactRunsAFullVECTORDISTANCEScanThe} </div>
                </div>
            ) : null}
            {comparison ? (
                <div>
                    <div className="qs-vec6-sr-live" aria-live="polite">
                        {" "}
                        {locConstants.vectorWorkbench.vectorComparisonComplete}{" "}
                        {formatCount(comparison.rankRows.length)}{" "}
                        {locConstants.vectorWorkbench.rankRows}{" "}
                        {recall?.recallAtK !== undefined
                            ? locConstants.vectorWorkbench.recallAtValueValuePercent(
                                  String(comparison.k),
                                  String(Math.round(recall.recallAtK * 100)),
                              )
                            : locConstants.vectorWorkbench.exactOnlyResultRecallIsUnavailable}
                    </div>
                    <div className="qs-vec-facts" role="list">
                        {recall && recallDenominator !== undefined ? (
                            <span role="listitem">
                                <label>
                                    {locConstants.vectorWorkbench.recall}
                                    {comparison.k}
                                </label>
                                <span className="qs-vec-num">
                                    {recall.recallAtK !== undefined
                                        ? `${Math.round(recall.recallAtK * 100)}% (${recall.overlap}/${recallDenominator})`
                                        : locConstants.vectorWorkbench.undefined}
                                </span>
                            </span>
                        ) : null}
                        {recall ? (
                            <span role="listitem">
                                <label>{locConstants.vectorWorkbench.overlap2}</label>
                                <span className="qs-vec-num">
                                    {recall.overlap} {locConstants.vectorWorkbench.of}{" "}
                                    {comparison.k}
                                </span>
                            </span>
                        ) : null}
                        <span role="listitem">
                            <label>{locConstants.vectorWorkbench.exact2}</label>
                            <span className="qs-vec-num">
                                {comparison.timings.exactMs} {locConstants.vectorWorkbench.ms}
                            </span>
                        </span>
                        {comparison.timings.approxMs !== undefined ? (
                            <span role="listitem">
                                <label>{locConstants.vectorWorkbench.approx2}</label>
                                <span className="qs-vec-num">
                                    {comparison.timings.approxMs} {locConstants.vectorWorkbench.ms}
                                </span>
                            </span>
                        ) : null}
                        <span role="listitem" className="qs-vec-muted">
                            {comparison.timings.disclosure}
                        </span>
                    </div>
                    {comparison.approxError ? (
                        <div className="qs-vec-error qs-vec6-inline-error" role="alert">
                            {comparison.approxError}
                        </div>
                    ) : null}
                    <VecSectionLabel
                        right={locConstants.vectorWorkbench.everyRowNamesItsEvidenceSource}>
                        {" "}
                        {locConstants.vectorWorkbench.evidence}{" "}
                    </VecSectionLabel>
                    <div className="qs-vec8-evidence">
                        {comparison.evidence.map((row, i) => (
                            <div key={`${row.label}-${i}`} className="qs-vec8-evidence-row">
                                <span className="qs-vec8-evidence-label">{row.label}</span>
                                <span>{row.value}</span>
                                <span className="qs-vec-muted qs-vec-num">{row.source}</span>
                            </div>
                        ))}
                    </div>
                    <VecSectionLabel
                        right={`${formatCount(comparison.rankRows.length)} rows · union of both variants`}>
                        {" "}
                        {locConstants.vectorWorkbench.rankComparison}{" "}
                    </VecSectionLabel>
                    <div className="qs-vec8-rank-wrap">
                        <div
                            className="qs-vec8-rank-scroll"
                            ref={rankScrollRef}
                            role="region"
                            aria-label={locConstants.vectorWorkbench.scrollableRankComparison}
                            tabIndex={0}
                            onKeyDown={(event) => {
                                if (event.target !== event.currentTarget) {
                                    return;
                                }
                                if (
                                    event.key === "ArrowDown" ||
                                    event.key === "ArrowUp" ||
                                    event.key === "Home" ||
                                    event.key === "End"
                                ) {
                                    onRankKeyDown(event, selectedRankIndex ?? 0);
                                }
                            }}
                            onScroll={(event) => {
                                const top = event.currentTarget.scrollTop;
                                rankPendingScrollTopRef.current = top;
                                if (latestViewStateRef.current) {
                                    latestViewStateRef.current = {
                                        ...latestViewStateRef.current,
                                        rankScrollTop: top,
                                    };
                                }
                                if (rankScrollRafRef.current !== 0) {
                                    return;
                                }
                                rankScrollRafRef.current = requestAnimationFrame(() => {
                                    rankScrollRafRef.current = 0;
                                    setRankScrollTop(rankPendingScrollTopRef.current);
                                });
                            }}>
                            <table
                                className="qs-vec8-rank"
                                aria-label={locConstants.vectorWorkbench.rankComparison}
                                aria-rowcount={comparison.rankRows.length + 1}>
                                <thead>
                                    <tr>
                                        <th className="qs-vec-num">
                                            {locConstants.vectorWorkbench.exact2}
                                        </th>
                                        {showApproxColumns ? (
                                            <>
                                                <th className="qs-vec-num">
                                                    {locConstants.vectorWorkbench.approx2}
                                                </th>
                                                <th className="qs-vec-num">Δ</th>
                                            </>
                                        ) : null}
                                        <th className="qs-vec8-th-left">
                                            {locConstants.vectorWorkbench.neighbor}
                                        </th>
                                        <th className="qs-vec-num">
                                            {locConstants.vectorWorkbench.exactD}
                                        </th>
                                        {showApproxColumns ? (
                                            <>
                                                <th className="qs-vec-num">
                                                    {locConstants.vectorWorkbench.approxD}
                                                </th>
                                                <th className="qs-vec8-th-left">
                                                    {locConstants.vectorWorkbench.status}
                                                </th>
                                            </>
                                        ) : null}
                                    </tr>
                                </thead>
                                <tbody>
                                    {rankRenderIndexes.map((index, visibleIndex) => {
                                        const row = comparison.rankRows[index];
                                        const previousIndex =
                                            visibleIndex === 0
                                                ? -1
                                                : rankRenderIndexes[visibleIndex - 1];
                                        const gapRows = index - previousIndex - 1;
                                        return (
                                            <React.Fragment key={`${index}:${String(row.key)}`}>
                                                {gapRows > 0 ? (
                                                    <tr
                                                        className="qs-vec8-rank-spacer"
                                                        aria-hidden="true">
                                                        <td
                                                            colSpan={rankColumnCount}
                                                            style={{
                                                                height: gapRows * RANK_ROW_HEIGHT,
                                                            }}
                                                        />
                                                    </tr>
                                                ) : null}
                                                <tr
                                                    data-rank-index={index}
                                                    aria-rowindex={index + 2}
                                                    tabIndex={
                                                        selectedRankIndex === index ||
                                                        (selectedRankIndex === undefined &&
                                                            index === 0)
                                                            ? 0
                                                            : -1
                                                    }
                                                    aria-selected={selectedRankIndex === index}
                                                    className={
                                                        selectedRankIndex === index ? "active" : ""
                                                    }
                                                    onClick={() => setSelectedRankIndex(index)}
                                                    onKeyDown={(event) =>
                                                        onRankKeyDown(event, index)
                                                    }>
                                                    <td className="qs-vec-num">
                                                        {row.exactRank !== undefined
                                                            ? `#${row.exactRank}`
                                                            : "—"}
                                                    </td>
                                                    {showApproxColumns ? (
                                                        <>
                                                            <td className="qs-vec-num">
                                                                {row.approxRank !== undefined
                                                                    ? `#${row.approxRank}`
                                                                    : "—"}
                                                            </td>
                                                            <td
                                                                className="qs-vec-num"
                                                                data-delta={
                                                                    row.delta === undefined
                                                                        ? undefined
                                                                        : row.delta === 0
                                                                          ? "same"
                                                                          : row.delta > 0
                                                                            ? "worse"
                                                                            : "better"
                                                                }>
                                                                {row.delta === undefined
                                                                    ? "—"
                                                                    : row.delta === 0
                                                                      ? "0"
                                                                      : row.delta > 0
                                                                        ? `↓ +${row.delta}`
                                                                        : `↑ ${row.delta}`}
                                                            </td>
                                                        </>
                                                    ) : null}
                                                    <td className="qs-vec8-neighbor">
                                                        {row.label !== undefined ? (
                                                            <span>{row.label} </span>
                                                        ) : null}
                                                        <span className="qs-vec-num qs-vec-muted">
                                                            #{String(row.key)}
                                                        </span>
                                                    </td>
                                                    <td className="qs-vec-num">
                                                        {row.exactDistance !== undefined
                                                            ? formatStat(row.exactDistance)
                                                            : "—"}
                                                    </td>
                                                    {showApproxColumns ? (
                                                        <>
                                                            <td className="qs-vec-num">
                                                                {row.approxDistance !== undefined
                                                                    ? formatStat(row.approxDistance)
                                                                    : "—"}
                                                            </td>
                                                            <td
                                                                className="qs-vec8-status"
                                                                data-status={row.status}>
                                                                {row.status === "matched"
                                                                    ? locConstants.vectorWorkbench
                                                                          .matched
                                                                    : row.status === "exactOnly"
                                                                      ? locConstants.vectorWorkbench
                                                                            .exactOnly
                                                                      : locConstants.vectorWorkbench
                                                                            .approxOnly}
                                                                {row.distanceTie
                                                                    ? locConstants.vectorWorkbench
                                                                          .distanceTie
                                                                    : ""}
                                                            </td>
                                                        </>
                                                    ) : null}
                                                </tr>
                                            </React.Fragment>
                                        );
                                    })}
                                    {(rankRenderIndexes.at(-1) ?? -1) + 1 <
                                    comparison.rankRows.length ? (
                                        <tr className="qs-vec8-rank-spacer" aria-hidden="true">
                                            <td
                                                colSpan={rankColumnCount}
                                                style={{
                                                    height:
                                                        (comparison.rankRows.length -
                                                            ((rankRenderIndexes.at(-1) ?? -1) +
                                                                1)) *
                                                        RANK_ROW_HEIGHT,
                                                }}
                                            />
                                        </tr>
                                    ) : null}
                                </tbody>
                            </table>
                        </div>
                        {showApproxColumns ? <RankFlow rows={comparison.rankRows} /> : null}
                    </div>
                    {selectedRank ? (
                        <div
                            className="qs-vec8-result-detail"
                            role="region"
                            aria-label={locConstants.vectorWorkbench.selectedNeighborDetails}>
                            <VecSectionLabel>
                                {locConstants.vectorWorkbench.selectedNeighbor}
                            </VecSectionLabel>
                            <div className="qs-vec8-evidence">
                                <div className="qs-vec8-evidence-row">
                                    <span className="qs-vec8-evidence-label">
                                        {locConstants.vectorWorkbench.key}
                                    </span>
                                    <span className="qs-vec-num">{String(selectedRank.key)}</span>
                                    <span />
                                </div>
                                <div className="qs-vec8-evidence-row">
                                    <span className="qs-vec8-evidence-label">
                                        {locConstants.vectorWorkbench.ranks}
                                    </span>
                                    <span className="qs-vec-num">
                                        {" "}
                                        {locConstants.vectorWorkbench.exact}{" "}
                                        {selectedRank.exactRank ?? "—"}{" "}
                                        {locConstants.vectorWorkbench.approximate}{" "}
                                        {selectedRank.approxRank ?? "—"}
                                    </span>
                                    <span>{selectedRank.status}</span>
                                </div>
                            </div>
                        </div>
                    ) : null}

                    {/* -- generated T-SQL drawer ------------------------------ */}
                    <div className="qs-vec8-drawer">
                        <button
                            className="qs-vec8-drawer-header"
                            aria-expanded={sqlOpen}
                            onClick={() => setSqlOpen((open) => !open)}>
                            <span
                                className={`codicon ${sqlOpen ? "codicon-chevron-down" : "codicon-chevron-right"} qs-vec8-chevron`}
                                aria-hidden="true"
                            />
                            <span className="qs-vec8-drawer-title">
                                {locConstants.vectorWorkbench.gENERATEDTSQL}
                            </span>
                            <span className="qs-vec8-executed">
                                {locConstants.vectorWorkbench.executed}
                            </span>
                            <span className="qs-vec-muted">
                                {" "}
                                {
                                    locConstants.vectorWorkbench
                                        .exactlyWhatExecutedLiteralsInlinedHostSide
                                }{" "}
                            </span>
                        </button>
                        {sqlOpen ? (
                            <div className="qs-vec8-drawer-body">
                                <div className="qs-vec8-sql-toolbar">
                                    <div className="qs-vec8-sql-tabs" role="tablist">
                                        <button
                                            id="qs-vec8-sql-tab-exact"
                                            role="tab"
                                            aria-selected={sqlTab === "exact"}
                                            aria-controls="qs-vec8-sql-panel-exact"
                                            tabIndex={sqlTab === "exact" ? 0 : -1}
                                            className={sqlTab === "exact" ? "active" : ""}
                                            onKeyDown={(event) => onSqlTabKeyDown(event, "exact")}
                                            onClick={() => setSqlTab("exact")}>
                                            {" "}
                                            {locConstants.vectorWorkbench.exact2}{" "}
                                        </button>
                                        {comparison.executedSql.approx !== undefined ? (
                                            <button
                                                id="qs-vec8-sql-tab-approx"
                                                role="tab"
                                                aria-selected={sqlTab === "approx"}
                                                aria-controls="qs-vec8-sql-panel-approx"
                                                tabIndex={sqlTab === "approx" ? 0 : -1}
                                                className={sqlTab === "approx" ? "active" : ""}
                                                onKeyDown={(event) =>
                                                    onSqlTabKeyDown(event, "approx")
                                                }
                                                onClick={() => setSqlTab("approx")}>
                                                {" "}
                                                {locConstants.vectorWorkbench.approximate2}{" "}
                                            </button>
                                        ) : null}
                                    </div>
                                    <span className="qs-vec8-sql-actions">
                                        <button
                                            type="button"
                                            title={locConstants.vectorWorkbench.copyGeneratedSQL}
                                            aria-label={
                                                locConstants.vectorWorkbench.copyGeneratedSQL
                                            }
                                            onClick={() => void copySql()}>
                                            <span
                                                className={`codicon ${sqlCopied ? "codicon-check" : "codicon-copy"}`}
                                                aria-hidden="true"
                                            />
                                        </button>
                                        <button
                                            type="button"
                                            title={
                                                locConstants.vectorWorkbench
                                                    .openGeneratedSQLInEditor
                                            }
                                            aria-label={
                                                locConstants.vectorWorkbench
                                                    .openGeneratedSQLInEditor
                                            }
                                            disabled={!visibleSql}
                                            onClick={() =>
                                                visibleSql &&
                                                void rpc.sendRequest(QsShowPlanQueryRequest.type, {
                                                    query: visibleSql,
                                                })
                                            }>
                                            <span
                                                className="codicon codicon-go-to-file"
                                                aria-hidden="true"
                                            />
                                        </button>
                                    </span>
                                </div>
                                <pre
                                    ref={sqlScrollRef}
                                    id={`qs-vec8-sql-panel-${sqlTab}`}
                                    role="tabpanel"
                                    aria-labelledby={`qs-vec8-sql-tab-${sqlTab}`}
                                    className="qs-vec8-sql qs-vec-num"
                                    onScroll={(event) => {
                                        const next = {
                                            scrollTop: event.currentTarget.scrollTop,
                                            scrollLeft: event.currentTarget.scrollLeft,
                                        };
                                        setSqlScrollPositions((current) => {
                                            const previous = current[sqlTab];
                                            return previous.scrollTop === next.scrollTop &&
                                                previous.scrollLeft === next.scrollLeft
                                                ? current
                                                : { ...current, [sqlTab]: next };
                                        });
                                    }}>
                                    {visibleSql}
                                </pre>
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}
            {modelPrepare?.confirmationToken && modelPrepare.descriptor ? (
                <div className="qs-vec8-model-scrim" role="presentation">
                    <div
                        ref={modelDialogRef}
                        className="qs-vec8-model-dialog"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="qs-vec8-model-dialog-title"
                        aria-describedby="qs-vec8-model-dialog-warning">
                        <h2 id="qs-vec8-model-dialog-title">
                            {" "}
                            {locConstants.vectorWorkbench.generateEmbeddingWith}{" "}
                            {modelPrepare.descriptor.model}?
                        </h2>
                        <div className="qs-vec8-model-descriptor">
                            {[
                                [locConstants.vectorWorkbench.model, modelPrepare.descriptor.model],
                                [
                                    locConstants.vectorWorkbench.owner,
                                    modelPrepare.descriptor.owner ??
                                        locConstants.vectorWorkbench.notReported,
                                ],
                                [
                                    locConstants.vectorWorkbench.modelType,
                                    modelPrepare.descriptor.modelType,
                                ],
                                [
                                    locConstants.vectorWorkbench.aPIFormat,
                                    modelPrepare.descriptor.apiFormat,
                                ],
                                [
                                    locConstants.vectorWorkbench.endpointHost,
                                    modelPrepare.descriptor.endpointHost,
                                ],
                                [
                                    locConstants.vectorWorkbench.modelModified,
                                    modelPrepare.descriptor.modelModifyTime,
                                ],
                                [
                                    locConstants.vectorWorkbench.source,
                                    modelPrepare.descriptor.source,
                                ],
                                [
                                    locConstants.vectorWorkbench.rowsCalls,
                                    String(modelPrepare.descriptor.rowsCalls),
                                ],
                                [
                                    locConstants.vectorWorkbench.textCharacters,
                                    formatCount(modelPrepare.descriptor.textChars),
                                ],
                                [
                                    locConstants.vectorWorkbench.approximatePayload,
                                    `${modelPrepare.descriptor.approxPayloadKiB.toFixed(1)} KiB`,
                                ],
                                [
                                    locConstants.vectorWorkbench.expectedOutput,
                                    locConstants.vectorWorkbench.outputDimensions(
                                        formatCount(modelPrepare.descriptor.expectedDimensions),
                                    ),
                                ],
                                [
                                    locConstants.vectorWorkbench.parameters,
                                    modelPrepare.descriptor.parameters,
                                ],
                                [
                                    locConstants.vectorWorkbench.retryPolicy,
                                    modelPrepare.descriptor.retryPolicy,
                                ],
                                [
                                    locConstants.vectorWorkbench.execution,
                                    modelPrepare.descriptor.execution,
                                ],
                                [
                                    locConstants.vectorWorkbench.resultHandling,
                                    modelPrepare.descriptor.resultHandling,
                                ],
                            ].map(([label, value]) => (
                                <div key={label} className="qs-vec8-model-descriptor-row">
                                    <span>{label}</span>
                                    <strong>{value}</strong>
                                </div>
                            ))}
                        </div>
                        <div
                            id="qs-vec8-model-dialog-warning"
                            className={
                                modelPrepare.descriptor.egress === "inProcess"
                                    ? "qs-vec8-model-local"
                                    : "qs-vec8-model-egress"
                            }
                            role={
                                modelPrepare.descriptor.egress === "externalEgress"
                                    ? "alert"
                                    : "status"
                            }>
                            <span
                                className={`codicon ${
                                    modelPrepare.descriptor.egress === "inProcess"
                                        ? "codicon-lock"
                                        : "codicon-warning"
                                }`}
                                aria-hidden="true"
                            />
                            {modelPrepare.descriptor.egress === "externalEgress"
                                ? locConstants.vectorWorkbench
                                      .externalEgressTheEnteredTextLeavesYourEnvironment
                                : modelPrepare.descriptor.egress === "hostLocal"
                                  ? locConstants.vectorWorkbench
                                        .theEnteredTextLeavesTheDatabaseEngineFor
                                  : modelPrepare.descriptor.egress === "inProcess"
                                    ? locConstants.vectorWorkbench
                                          .theConfiguredONNXRuntimeExecutesInProcessWithout
                                    : locConstants.vectorWorkbench
                                          .theModelAPIFormatIsUnclassifiedTreatThis}
                        </div>
                        <div className="qs-vec8-model-cancel-note">
                            {" "}
                            {
                                locConstants.vectorWorkbench
                                    .cancellationIsRequestedThroughSQLServerARemote
                            }{" "}
                        </div>
                        {modelSqlOpen ? (
                            <pre className="qs-vec8-model-sql qs-vec-num">
                                {modelPrepare.generatedSql}
                            </pre>
                        ) : null}
                        <div className="qs-vec8-model-dialog-actions">
                            <button type="button" onClick={closeModelDialog}>
                                {" "}
                                {locConstants.vectorWorkbench.cancel}{" "}
                            </button>
                            <button
                                type="button"
                                aria-expanded={modelSqlOpen}
                                onClick={() => setModelSqlOpen((open) => !open)}>
                                {modelSqlOpen
                                    ? locConstants.vectorWorkbench.hideGeneratedTSQL
                                    : locConstants.vectorWorkbench.viewGeneratedTSQL}
                            </button>
                            <button
                                type="button"
                                className="qs-vec-primary"
                                disabled={modelBusy}
                                onClick={() => void executeModelCall()}>
                                {modelBusy ? (
                                    <span
                                        className="codicon codicon-loading qs-spin"
                                        aria-hidden="true"
                                    />
                                ) : (
                                    <span className="codicon codicon-sparkle" aria-hidden="true" />
                                )}
                                {modelBusy
                                    ? locConstants.vectorWorkbench.generating
                                    : locConstants.vectorWorkbench.generateEmbedding}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
