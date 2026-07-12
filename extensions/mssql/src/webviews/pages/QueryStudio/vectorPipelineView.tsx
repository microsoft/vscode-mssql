/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pipeline workspace (VEC-10, mocks vec_pipeline.png / vec_pipeline_regen.png):
 * PROVENANCE properties grid (DB-scoped model names, P0-4), RE-EMBED SELECTED
 * ROW with the HOST-MINTED confirmation dialog (the webview renders the
 * host's descriptor verbatim and can only hand back the host's single-use
 * token — it cannot fabricate consent), and the CHUNK DEBUGGER (local
 * character math; "fixed · characters, not tokens").
 *
 * Rides the lazy vector chunk (imported only by vectorTab.tsx). House rules:
 * VS Code tokens only, 11px uppercase section labels, mono right-aligned
 * numerics, ≤2px radii, flat regions, inner scrolling; shadows on the dialog
 * only. Layered network claim (P0-5) renders in the footer strip: webview
 * "none" is constant; the server-side line is per-egress-class copy from the
 * host plus a local count of calls confirmed from this panel.
 */

import * as React from "react";
import { Rpc } from "./resultsGridShared";
import { formatCount, formatStat, VecSectionLabel } from "./vectorViewsShared";
import {
    QsVectorChunkPreviewRequest,
    QsVectorChunkPreviewResult,
    QsVectorPipelineCancelRequest,
    QsVectorPipelineStateRequest,
    QsVectorPipelineStateResult,
    QsVectorReembedExecuteRequest,
    QsVectorReembedExecuteResult,
    QsVectorReembedPrepareRequest,
    QsVectorReembedPrepareResult,
    QsVectorReembedResultRequest,
    VECTOR_CHUNK_OVERLAP_MAX,
    VECTOR_CHUNK_OVERLAP_MIN,
    VECTOR_CHUNK_OVERLAP_STEP,
    VECTOR_CHUNK_SIZE_MAX,
    VECTOR_CHUNK_SIZE_MIN,
    VECTOR_CHUNK_SIZE_STEP,
    VECTOR_SOURCE_PREVIEW_CHARS,
    VectorPipelineModel,
} from "../../../sharedInterfaces/vectorPipeline";
import type { VectorModelStatementCounts } from "../../../sharedInterfaces/vectorCatalog";
import type { QsVectorPipelineViewState } from "../../../sharedInterfaces/queryStudioViewState";

export interface VectorPipelineColumnFacts {
    readonly columnName: string;
    readonly dimensions?: number;
}

export interface VectorPipelineSourceColumn {
    /** Column ordinal in the bound result set. */
    readonly ordinal: number;
    readonly name: string;
}

export interface VectorPipelineViewProps {
    rpc: Rpc;
    /** Host-minted analysis-session handle (qs/vector.open). */
    handle: string;
    /** Generation stamp — a rerun resets the workspace via this changing. */
    generation: number;
    /** Only the visible workspace may hold consent or issue model/catalog work. */
    active: boolean;
    /** The session's vector column (VectorColumnChoice-like facts). */
    vectorColumn: VectorPipelineColumnFacts;
    /** String-typed columns of the result — source text candidates. */
    stringColumns: readonly VectorPipelineSourceColumn[];
    /** Row count of the bound result set (ordinal input validation hint). */
    totalRows?: number;
    initialViewState?: QsVectorPipelineViewState;
    onViewStateChange?: (state: QsVectorPipelineViewState) => void;
}

/** Integration descriptor for vectorTab.tsx (rail id + mount component). */
export const vectorPipelineIntegration = {
    workspace: "pipeline" as const,
    label: "Pipeline",
    Component: VectorPipelineView,
};

const EGRESS_SHORT: Record<VectorPipelineModel["egress"], string> = {
    externalEgress: "external egress",
    hostLocal: "host-local",
    inProcess: "in-process",
    unknown: "unclassified",
};

const EMPTY_MODEL_CALL_COUNTS: VectorModelStatementCounts = {
    externalEgress: 0,
    hostLocal: 0,
    inProcess: 0,
    unknown: 0,
};

function modelCallClaim(counts: VectorModelStatementCounts): string {
    const parts = [
        counts.externalEgress > 0 ? `external egress ${formatCount(counts.externalEgress)}` : "",
        counts.hostLocal > 0 ? `host-local ${formatCount(counts.hostLocal)}` : "",
        counts.inProcess > 0 ? `in-process ${formatCount(counts.inProcess)}` : "",
        counts.unknown > 0 ? `unclassified ${formatCount(counts.unknown)}` : "",
    ].filter(Boolean);
    return parts.length === 0
        ? "Server-side model statements from this panel: none"
        : `Server-side model statements from this panel: ${parts.join(" · ")}`;
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

function parseRowOrdinal(text: string, totalRows?: number): { ordinal?: number; error?: string } {
    const cleaned = text.trim().replace(/^#/, "");
    if (cleaned.length === 0) {
        return { error: "Enter a result-row ordinal, e.g. 0." };
    }
    if (!/^\d+$/.test(cleaned)) {
        return { error: `"${text.trim()}" is not a result-row ordinal.` };
    }
    const ordinal = Number(cleaned);
    if (totalRows !== undefined && ordinal >= totalRows) {
        return { error: `Ordinal ${ordinal} is out of range (0–${totalRows - 1}).` };
    }
    return { ordinal };
}

function PropRow(props: { label: string; children: React.ReactNode }): React.JSX.Element {
    return (
        <div className="qs-vec6-prop-row">
            <span className="qs-vec6-prop-label">{props.label}</span>
            <span className="qs-vec-num qs-vecp-prop-value">{props.children}</span>
        </div>
    );
}

export function VectorPipelineView(props: VectorPipelineViewProps): React.JSX.Element {
    const {
        rpc,
        handle,
        generation,
        active,
        vectorColumn,
        stringColumns,
        totalRows,
        initialViewState,
        onViewStateChange,
    } = props;
    const [state, setState] = React.useState<QsVectorPipelineStateResult | undefined>();
    const [stateError, setStateError] = React.useState<string | undefined>();
    const [modelIndex, setModelIndex] = React.useState(0);
    const [sourceIndex, setSourceIndex] = React.useState(() => {
        const index = stringColumns.findIndex(
            (column) => column.ordinal === initialViewState?.sourceColumnOrdinal,
        );
        return Math.max(0, index);
    });
    const [rowText, setRowText] = React.useState(String(initialViewState?.rowOrdinal ?? 0));
    const [panelError, setPanelError] = React.useState<string | undefined>();
    const [prepare, setPrepare] = React.useState<QsVectorReembedPrepareResult | undefined>();
    const [dialogOpen, setDialogOpen] = React.useState(false);
    const [showSql, setShowSql] = React.useState(initialViewState?.showSql ?? false);
    const [busy, setBusy] = React.useState(false);
    const [modelExecutionPending, setModelExecutionPending] = React.useState(false);
    const [result, setResult] = React.useState<QsVectorReembedExecuteResult | undefined>();
    const [lastRunId, setLastRunId] = React.useState(initialViewState?.lastRunId);
    const [resultContext, setResultContext] = React.useState<{
        modelId: string;
        row: number;
        sourceColumnOrdinal: number;
    }>();
    const [modelCallCounts, setModelCallCounts] =
        React.useState<VectorModelStatementCounts>(EMPTY_MODEL_CALL_COUNTS);
    const [chunkSize, setChunkSize] = React.useState(initialViewState?.chunkSize ?? 800);
    const [overlapPct, setOverlapPct] = React.useState(initialViewState?.overlapPct ?? 15);
    const [chunks, setChunks] = React.useState<QsVectorChunkPreviewResult | undefined>();
    const [chunkBusy, setChunkBusy] = React.useState(false);
    const initialModelBindingIdRef = React.useRef(initialViewState?.modelName);
    const stateRequestSerialRef = React.useRef(0);
    const modelRequestSerialRef = React.useRef(0);
    const chunkRequestSerialRef = React.useRef(0);
    const restoredRunIdRef = React.useRef<string | undefined>(undefined);
    const reembedComposerInitializedRef = React.useRef(false);
    const chunkComposerInitializedRef = React.useRef(false);
    const reembedButtonRef = React.useRef<HTMLButtonElement | null>(null);
    const dialogRef = React.useRef<HTMLDivElement | null>(null);
    const confirmButtonRef = React.useRef<HTMLButtonElement | null>(null);
    const closeDialog = React.useCallback(() => {
        modelRequestSerialRef.current++;
        setPrepare(undefined);
        setDialogOpen(false);
        setBusy(false);
        void rpc.sendRequest(QsVectorPipelineCancelRequest.type, { handle }).catch(() => undefined);
        requestAnimationFrame(() => reembedButtonRef.current?.focus());
    }, [handle, rpc]);

    React.useEffect(() => {
        if (!dialogOpen) {
            return;
        }
        confirmButtonRef.current?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                closeDialog();
                return;
            }
            if (event.key !== "Tab") {
                return;
            }
            const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
                'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            );
            if (!focusable || focusable.length === 0) {
                event.preventDefault();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [closeDialog, dialogOpen]);

    // Pipeline state per (handle, generation): a rerun resets everything.
    React.useEffect(() => {
        if (!active) {
            stateRequestSerialRef.current++;
            modelRequestSerialRef.current++;
            chunkRequestSerialRef.current++;
            setPrepare(undefined);
            setDialogOpen(false);
            setBusy(false);
            setModelExecutionPending(false);
            setChunkBusy(false);
            void rpc
                .sendRequest(QsVectorPipelineCancelRequest.type, { handle })
                .catch(() => undefined);
            return;
        }
        const serial = ++stateRequestSerialRef.current;
        setState(undefined);
        setStateError(undefined);
        setPanelError(undefined);
        setPrepare(undefined);
        setDialogOpen(false);
        void (async () => {
            try {
                const loaded = await rpc.sendRequest<
                    { refresh?: boolean },
                    QsVectorPipelineStateResult
                >(QsVectorPipelineStateRequest.type, {});
                setModelCallCounts((current) =>
                    mergeModelStatementCounts(current, loaded.modelStatementCounts),
                );
                if (serial === stateRequestSerialRef.current) {
                    setState(loaded);
                    const restoredModel = loaded.models?.findIndex(
                        (candidate) => candidate.id === initialModelBindingIdRef.current,
                    );
                    if (restoredModel !== undefined && restoredModel >= 0) {
                        setModelIndex(restoredModel);
                    }
                }
            } catch (e) {
                if (serial === stateRequestSerialRef.current) {
                    setStateError(e instanceof Error ? e.message : String(e));
                }
            }
        })();
        return () => {
            stateRequestSerialRef.current++;
            modelRequestSerialRef.current++;
            void rpc
                .sendRequest(QsVectorPipelineCancelRequest.type, { handle })
                .catch(() => undefined);
        };
    }, [active, rpc, handle, generation]);

    const models = state?.models ?? [];
    const model = models[Math.min(modelIndex, Math.max(0, models.length - 1))];
    const sourceColumn =
        stringColumns[Math.min(sourceIndex, Math.max(0, stringColumns.length - 1))];
    const parsedRow = parseRowOrdinal(rowText, totalRows);

    React.useEffect(() => {
        if (!reembedComposerInitializedRef.current) {
            reembedComposerInitializedRef.current = true;
            return;
        }
        modelRequestSerialRef.current++;
        setPrepare(undefined);
        setDialogOpen(false);
        setPanelError(undefined);
    }, [model?.id, parsedRow.ordinal, rowText, sourceColumn?.ordinal]);

    React.useEffect(() => {
        if (!chunkComposerInitializedRef.current) {
            chunkComposerInitializedRef.current = true;
            return;
        }
        chunkRequestSerialRef.current++;
        setChunks(undefined);
    }, [chunkSize, overlapPct, parsedRow.ordinal, rowText, sourceColumn?.ordinal]);

    React.useEffect(
        () => () => {
            modelRequestSerialRef.current++;
            chunkRequestSerialRef.current++;
        },
        [],
    );

    React.useEffect(() => {
        onViewStateChange?.({
            ...(model?.id ? { modelName: model.id } : {}),
            ...(sourceColumn ? { sourceColumnOrdinal: sourceColumn.ordinal } : {}),
            rowOrdinal: parsedRow.ordinal ?? 0,
            showSql,
            chunkSize,
            overlapPct,
            ...(lastRunId ? { lastRunId } : {}),
        });
    }, [
        chunkSize,
        model?.id,
        lastRunId,
        onViewStateChange,
        overlapPct,
        parsedRow.ordinal,
        showSql,
        sourceColumn,
    ]);

    React.useEffect(() => {
        if (!active || !lastRunId || result || restoredRunIdRef.current === lastRunId) {
            return;
        }
        restoredRunIdRef.current = lastRunId;
        const serial = ++modelRequestSerialRef.current;
        void rpc
            .sendRequest<
                { readonly handle: string; readonly runId: string },
                QsVectorReembedExecuteResult
            >(QsVectorReembedResultRequest.type, { handle, runId: lastRunId })
            .then((restored) => {
                if (restored.modelStatementCounts) {
                    setModelCallCounts((current) =>
                        mergeModelStatementCounts(current, restored.modelStatementCounts!),
                    );
                }
                if (serial !== modelRequestSerialRef.current) return;
                if (restored.error || !restored.comparison) {
                    setPanelError(
                        restored.error ?? "The completed Pipeline comparison is unavailable.",
                    );
                    return;
                }
                setResult(restored);
                if (restored.context) {
                    setResultContext({
                        modelId: restored.context.modelId,
                        row: restored.context.rowOrdinal,
                        sourceColumnOrdinal: restored.context.sourceColumnOrdinal,
                    });
                }
            })
            .catch((cause) => {
                if (serial === modelRequestSerialRef.current) {
                    setPanelError(cause instanceof Error ? cause.message : String(cause));
                }
            });
    }, [active, handle, lastRunId, result, rpc]);

    const onPrepare = async (): Promise<void> => {
        if (!model || !sourceColumn || parsedRow.ordinal === undefined) {
            setPanelError(parsedRow.error ?? "Pick a model and a source text column first.");
            return;
        }
        setPanelError(undefined);
        const serial = ++modelRequestSerialRef.current;
        setBusy(true);
        try {
            const prepared = await rpc.sendRequest<
                {
                    handle: string;
                    ordinal: number;
                    sourceColumnOrdinal: number;
                    modelId: string;
                },
                QsVectorReembedPrepareResult
            >(QsVectorReembedPrepareRequest.type, {
                handle,
                ordinal: parsedRow.ordinal,
                sourceColumnOrdinal: sourceColumn.ordinal,
                modelId: model.id,
            });
            if (serial !== modelRequestSerialRef.current) {
                return;
            }
            if (prepared.error || !prepared.descriptor || !prepared.confirmationToken) {
                setPanelError(prepared.error ?? "The host refused the confirmation.");
                setPrepare(undefined);
                return;
            }
            setPrepare(prepared);
            setShowSql(false);
            setDialogOpen(true);
        } catch (e) {
            if (serial === modelRequestSerialRef.current) {
                setPanelError(e instanceof Error ? e.message : String(e));
            }
        } finally {
            if (serial === modelRequestSerialRef.current) {
                setBusy(false);
            }
        }
    };

    const onExecute = async (): Promise<void> => {
        if (!prepare?.confirmationToken) {
            return;
        }
        const serial = ++modelRequestSerialRef.current;
        setBusy(true);
        setModelExecutionPending(true);
        setDialogOpen(false);
        try {
            const executed = await rpc.sendRequest<
                { handle: string; token: string },
                QsVectorReembedExecuteResult
            >(QsVectorReembedExecuteRequest.type, { handle, token: prepare.confirmationToken });
            if (executed.modelStatementCounts) {
                setModelCallCounts((current) =>
                    mergeModelStatementCounts(current, executed.modelStatementCounts!),
                );
            }
            if (serial !== modelRequestSerialRef.current) {
                return;
            }
            if (executed.error) {
                setPanelError(executed.error);
            } else {
                setResult(executed);
                if (executed.runId) {
                    setLastRunId(executed.runId);
                    restoredRunIdRef.current = executed.runId;
                }
                if (executed.context) {
                    setResultContext({
                        modelId: executed.context.modelId,
                        row: executed.context.rowOrdinal,
                        sourceColumnOrdinal: executed.context.sourceColumnOrdinal,
                    });
                }
            }
        } catch (e) {
            if (serial === modelRequestSerialRef.current) {
                setPanelError(e instanceof Error ? e.message : String(e));
            }
        } finally {
            if (serial === modelRequestSerialRef.current) {
                setBusy(false);
                setModelExecutionPending(false);
                setPrepare(undefined);
                requestAnimationFrame(() => reembedButtonRef.current?.focus());
            }
        }
    };

    const onChunkPreview = async (): Promise<void> => {
        if (!sourceColumn || parsedRow.ordinal === undefined) {
            setPanelError(parsedRow.error ?? "Pick a source text column and a row first.");
            return;
        }
        const serial = ++chunkRequestSerialRef.current;
        setChunkBusy(true);
        try {
            const preview = await rpc.sendRequest<
                {
                    handle: string;
                    ordinal: number;
                    sourceColumnOrdinal: number;
                    chunkSize: number;
                    overlapPct: number;
                },
                QsVectorChunkPreviewResult
            >(QsVectorChunkPreviewRequest.type, {
                handle,
                ordinal: parsedRow.ordinal,
                sourceColumnOrdinal: sourceColumn.ordinal,
                chunkSize,
                overlapPct,
            });
            if (serial === chunkRequestSerialRef.current) {
                if (preview.error) {
                    setPanelError(preview.error);
                } else {
                    setChunks(preview);
                }
            }
        } catch (e) {
            if (serial === chunkRequestSerialRef.current) {
                setPanelError(e instanceof Error ? e.message : String(e));
            }
        } finally {
            if (serial === chunkRequestSerialRef.current) {
                setChunkBusy(false);
            }
        }
    };

    const step = (value: number, delta: number, min: number, max: number): number =>
        Math.min(max, Math.max(min, value + delta));
    const controlsLocked = busy || chunkBusy || dialogOpen;

    if (stateError) {
        return (
            <div className="qs-vecp-root">
                <div className="qs-vec-error" role="alert">
                    {stateError}
                </div>
            </div>
        );
    }

    const descriptor = prepare?.descriptor;
    const comparison = result?.comparison;
    const resultMatchesComposer =
        resultContext !== undefined &&
        resultContext.modelId === model?.id &&
        resultContext.row === parsedRow.ordinal &&
        resultContext.sourceColumnOrdinal === sourceColumn?.ordinal;
    const serverSideClaim = modelExecutionPending
        ? "Server-side model request in progress; statement count updates if SQL is issued"
        : modelCallClaim(modelCallCounts);

    return (
        <div className="qs-vecp-root">
            <div className="qs-vecp-columns">
                {/* --- EXPERIMENT INPUTS ----------------------------------- */}
                <section className="qs-vecp-provenance">
                    <VecSectionLabel right="current panel selection">
                        Experiment inputs
                    </VecSectionLabel>
                    <PropRow label="Vector column">{vectorColumn.columnName}</PropRow>
                    <div className="qs-vec6-prop-row">
                        <span className="qs-vec6-prop-label">Source text column</span>
                        {stringColumns.length === 0 ? (
                            <span className="qs-vec-muted">no string columns in this result</span>
                        ) : (
                            <select
                                className="qs-vecp-select"
                                value={sourceIndex}
                                disabled={controlsLocked}
                                onChange={(e) => setSourceIndex(Number(e.currentTarget.value))}
                                aria-label="Source text column">
                                {stringColumns.map((column, i) => (
                                    <option key={column.ordinal} value={i}>
                                        {column.name}
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>
                    <div className="qs-vec6-prop-row">
                        <span className="qs-vec6-prop-label">External model</span>
                        {!state ? (
                            <span className="qs-vec-muted">probing models…</span>
                        ) : models.length === 0 ? (
                            <span className="qs-vec-muted">
                                {state.error ?? "no EMBEDDINGS external model on this connection"}
                            </span>
                        ) : (
                            <select
                                className="qs-vecp-select"
                                value={modelIndex}
                                disabled={controlsLocked}
                                onChange={(e) => setModelIndex(Number(e.currentTarget.value))}
                                aria-label="External model">
                                {models.map((candidate, i) => (
                                    <option key={candidate.id} value={i}>
                                        {candidate.name}
                                        {candidate.owner ? ` · owner ${candidate.owner}` : ""}
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>
                    <PropRow label="Model type">EMBEDDINGS (only supported type)</PropRow>
                    <PropRow label="API format">
                        {model
                            ? `${model.apiFormat ?? "unknown"} · ${EGRESS_SHORT[model.egress]}`
                            : "—"}
                    </PropRow>
                    <PropRow label="Endpoint host">{model?.endpointHost ?? "—"}</PropRow>
                    <PropRow label="Provider model">{model?.providerModel ?? "—"}</PropRow>
                    <PropRow label="Dimensions">
                        {vectorColumn.dimensions !== undefined
                            ? formatCount(vectorColumn.dimensions)
                            : "unknown"}
                    </PropRow>
                    <PropRow label="Comparison outputs">
                        cosine distance · Euclidean · negative dot · norms
                    </PropRow>
                    <PropRow label="Normalization">not assumed</PropRow>
                </section>

                {/* --- RE-EMBED SELECTED ROW -------------------------------- */}
                <section className="qs-vecp-reembed">
                    <VecSectionLabel right="stored vs freshly generated">
                        Re-embed selected row
                    </VecSectionLabel>
                    <div className="qs-vecp-row-pick">
                        <label className="qs-vec-muted" htmlFor="qs-vecp-row-input">
                            Result row
                        </label>
                        <input
                            id="qs-vecp-row-input"
                            className="qs-vecp-input qs-vec-num"
                            value={rowText}
                            disabled={controlsLocked}
                            onChange={(e) => setRowText(e.currentTarget.value)}
                            spellCheck={false}
                            aria-label="Result-row ordinal"
                        />
                        <button
                            ref={reembedButtonRef}
                            className="qs-vecp-button"
                            disabled={
                                busy ||
                                Boolean(state?.error) ||
                                !model ||
                                !sourceColumn ||
                                parsedRow.ordinal === undefined
                            }
                            onClick={() => void onPrepare()}>
                            Re-embed &amp; compare…
                        </button>
                    </div>
                    {panelError ? (
                        <div className="qs-vec-error" role="alert">
                            {panelError}
                        </div>
                    ) : null}
                    {parsedRow.error && rowText.trim().length > 0 ? (
                        <div className="qs-vec-muted">{parsedRow.error}</div>
                    ) : null}
                    {prepare?.sourcePreview ? (
                        <div className="qs-vecp-source-preview qs-vec-num">
                            {prepare.sourcePreviewTruncated
                                ? `Preview (first ${formatCount(VECTOR_SOURCE_PREVIEW_CHARS)} of ${formatCount(prepare.descriptor?.textChars ?? 0)} characters): `
                                : "Full source: "}
                            “{prepare.sourcePreview}”
                        </div>
                    ) : null}
                    {result ? (
                        result.error ? (
                            <div className="qs-vec-error" role="alert">
                                {result.error}
                                {result.elapsedMs !== undefined
                                    ? ` (${formatCount(result.elapsedMs)} ms)`
                                    : ""}
                            </div>
                        ) : comparison ? (
                            <div className="qs-vecp-result">
                                {!resultMatchesComposer ? (
                                    <div className="qs-vec-warning">
                                        Last completed output · composer has changed
                                    </div>
                                ) : null}
                                <div className="qs-vecp-executed">
                                    Executed · one confirmed model call ·{" "}
                                    {result.elapsedMs !== undefined
                                        ? `${formatCount(result.elapsedMs)} ms`
                                        : "single observation"}
                                </div>
                                <PropRow label="Cosine distance (stored ↔ fresh)">
                                    {comparison.cosine === null
                                        ? "undefined (zero-norm vector)"
                                        : formatStat(comparison.cosine)}
                                </PropRow>
                                <PropRow label="Euclidean">
                                    {formatStat(comparison.euclidean)}
                                </PropRow>
                                <PropRow label="Negative dot">
                                    {formatStat(comparison.negativeDot)}
                                </PropRow>
                                <PropRow label="Norm stored / fresh">
                                    {`${formatStat(comparison.normStored)} / ${formatStat(comparison.normFresh)}`}
                                </PropRow>
                                <PropRow label="Dimensions">
                                    {formatCount(comparison.dimensions)}
                                </PropRow>
                                <div className="qs-vec-muted">
                                    kept in this panel · not written to the table
                                </div>
                            </div>
                        ) : null
                    ) : null}
                </section>
            </div>

            {/* --- CHUNK DEBUGGER ------------------------------------------- */}
            <section className="qs-vecp-chunks">
                <VecSectionLabel right="fixed · characters, not tokens">
                    Chunk debugger
                </VecSectionLabel>
                <div className="qs-vecp-chunk-controls">
                    <span className="qs-vec-muted">Size</span>
                    <span className="qs-vecp-stepper">
                        <button
                            aria-label="Decrease chunk size"
                            disabled={controlsLocked}
                            onClick={() =>
                                setChunkSize((v) =>
                                    step(
                                        v,
                                        -VECTOR_CHUNK_SIZE_STEP,
                                        VECTOR_CHUNK_SIZE_MIN,
                                        VECTOR_CHUNK_SIZE_MAX,
                                    ),
                                )
                            }>
                            −
                        </button>
                        <span className="qs-vec-num">{formatCount(chunkSize)}</span>
                        <button
                            aria-label="Increase chunk size"
                            disabled={controlsLocked}
                            onClick={() =>
                                setChunkSize((v) =>
                                    step(
                                        v,
                                        VECTOR_CHUNK_SIZE_STEP,
                                        VECTOR_CHUNK_SIZE_MIN,
                                        VECTOR_CHUNK_SIZE_MAX,
                                    ),
                                )
                            }>
                            +
                        </button>
                    </span>
                    <span className="qs-vec-muted">Overlap %</span>
                    <span className="qs-vecp-stepper">
                        <button
                            aria-label="Decrease overlap"
                            disabled={controlsLocked}
                            onClick={() =>
                                setOverlapPct((v) =>
                                    step(
                                        v,
                                        -VECTOR_CHUNK_OVERLAP_STEP,
                                        VECTOR_CHUNK_OVERLAP_MIN,
                                        VECTOR_CHUNK_OVERLAP_MAX,
                                    ),
                                )
                            }>
                            −
                        </button>
                        <span className="qs-vec-num">{overlapPct}</span>
                        <button
                            aria-label="Increase overlap"
                            disabled={controlsLocked}
                            onClick={() =>
                                setOverlapPct((v) =>
                                    step(
                                        v,
                                        VECTOR_CHUNK_OVERLAP_STEP,
                                        VECTOR_CHUNK_OVERLAP_MIN,
                                        VECTOR_CHUNK_OVERLAP_MAX,
                                    ),
                                )
                            }>
                            +
                        </button>
                    </span>
                    <button
                        className="qs-vecp-button"
                        disabled={
                            controlsLocked || !sourceColumn || parsedRow.ordinal === undefined
                        }
                        onClick={() => void onChunkPreview()}>
                        Preview chunks
                    </button>
                    <span className="qs-vecp-chunk-spacer" />
                    <button
                        className="qs-vecp-button"
                        aria-disabled="true"
                        aria-describedby="qs-vecp-batch-unavailable"
                        onClick={(event) => event.preventDefault()}
                        title="Batch chunk embedding ships in a later build — every chunk is one confirmed model call.">
                        Generate embeddings for chunks…
                    </button>
                    <span id="qs-vecp-batch-unavailable" className="qs-vec6-sr-live">
                        Batch chunk embedding is unavailable in this build. Every future chunk call
                        will require confirmation.
                    </span>
                </div>
                {state && !state.chunkingAvailable ? (
                    <div className="qs-vec-muted">
                        AI_GENERATE_CHUNKS needs compatibility level 170 on this database — the
                        preview below is local character math either way.
                    </div>
                ) : null}
                {chunks?.error ? (
                    <div className="qs-vec-error" role="alert">
                        {chunks.error}
                    </div>
                ) : null}
                {chunks?.chunks && chunks.chunks.length > 0 ? (
                    <>
                        <div className="qs-vecp-ribbon" role="list" aria-label="Chunk preview">
                            {chunks.chunks.map((chunk) => (
                                <React.Fragment key={chunk.index}>
                                    {chunk.index > 0 ? (
                                        <span
                                            className="qs-vecp-overlap"
                                            style={{ flexGrow: Math.max(1, chunk.overlapChars) }}
                                            title={`${formatCount(chunk.overlapChars)} overlap characters`}
                                        />
                                    ) : null}
                                    <span
                                        role="listitem"
                                        className="qs-vecp-chunk"
                                        style={{
                                            flexGrow: Math.max(1, chunk.chars - chunk.overlapChars),
                                        }}
                                        title={`offset ${formatCount(chunk.startOffset)} · ${formatCount(chunk.chars)} chars · preview: ${chunk.previewText}`}>
                                        chunk {chunk.index + 1} · {formatCount(chunk.chars)}
                                    </span>
                                </React.Fragment>
                            ))}
                        </div>
                        <div className="qs-vec-muted">
                            Hatched spans are overlap regions shared between adjacent chunks ·{" "}
                            {formatCount(chunks.totalChars ?? 0)} source characters
                            {chunks.chunkListTruncated
                                ? " · chunk list capped — not exhaustive"
                                : ""}
                        </div>
                    </>
                ) : null}
            </section>

            {/* --- layered network claim (P0-5) ----------------------------- */}
            <div className="qs-vecp-footer">
                <span>Webview network: none</span>
                <span className="qs-vec-muted">
                    {serverSideClaim}
                    {model && state
                        ? ` · Current selection: ${state.networkClaim.serverSide[model.egress]}`
                        : ""}
                </span>
            </div>

            {/* --- host-minted confirmation dialog -------------------------- */}
            {dialogOpen && descriptor && prepare ? (
                <div className="qs-vecp-scrim" role="presentation">
                    <div
                        ref={dialogRef}
                        className="qs-vecp-dialog"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Re-embed selected row confirmation">
                        <div className="qs-vecp-dialog-title">
                            <span>Re-embed selected row?</span>
                            <button
                                className="qs-vecp-dialog-close"
                                aria-label="Cancel"
                                onClick={closeDialog}>
                                <span className="codicon codicon-close" aria-hidden="true" />
                            </button>
                        </div>
                        <div className="qs-vecp-dialog-body">
                            <PropRow label="Model">{descriptor.model}</PropRow>
                            {descriptor.owner ? (
                                <PropRow label="Owner">{descriptor.owner}</PropRow>
                            ) : null}
                            <PropRow label="Model type">{descriptor.modelType}</PropRow>
                            <PropRow label="API format">{descriptor.apiFormat}</PropRow>
                            <PropRow label="Endpoint host">{descriptor.endpointHost}</PropRow>
                            <PropRow label="Model modified">{descriptor.modelModifyTime}</PropRow>
                            <PropRow label="Source">{descriptor.source}</PropRow>
                            <PropRow label="Rows / calls">
                                {formatCount(descriptor.rowsCalls)}
                            </PropRow>
                            <PropRow label="Text characters">
                                {formatCount(descriptor.textChars)}
                            </PropRow>
                            <PropRow label="Approx payload">
                                {descriptor.approxPayloadKiB.toFixed(1)} KiB
                            </PropRow>
                            <PropRow label="Execution">{descriptor.execution}</PropRow>
                            <PropRow label="Result handling">{descriptor.resultHandling}</PropRow>
                            {descriptor.egress === "externalEgress" ? (
                                <div className="qs-vecp-egress-warning" role="alert">
                                    ⚠ Source text leaves your environment via the database engine.
                                </div>
                            ) : null}
                            {showSql && prepare.generatedSql ? (
                                <pre className="qs-vecp-sql qs-vec-num">{prepare.generatedSql}</pre>
                            ) : null}
                        </div>
                        <div className="qs-vecp-dialog-buttons">
                            <button className="qs-vecp-button" onClick={closeDialog}>
                                Cancel
                            </button>
                            <button
                                className="qs-vecp-button"
                                onClick={() => setShowSql((visible) => !visible)}>
                                View generated T-SQL
                            </button>
                            <button
                                ref={confirmButtonRef}
                                className="qs-vecp-button qs-vecp-button-primary"
                                disabled={busy}
                                onClick={() => void onExecute()}>
                                Generate embedding
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
