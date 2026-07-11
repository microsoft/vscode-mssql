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
    QsVectorPipelineStateRequest,
    QsVectorPipelineStateResult,
    QsVectorReembedExecuteRequest,
    QsVectorReembedExecuteResult,
    QsVectorReembedPrepareRequest,
    QsVectorReembedPrepareResult,
    VECTOR_CHUNK_OVERLAP_MAX,
    VECTOR_CHUNK_OVERLAP_MIN,
    VECTOR_CHUNK_OVERLAP_STEP,
    VECTOR_CHUNK_SIZE_MAX,
    VECTOR_CHUNK_SIZE_MIN,
    VECTOR_CHUNK_SIZE_STEP,
    VectorPipelineModel,
} from "../../../sharedInterfaces/vectorPipeline";

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
    /** The session's vector column (VectorColumnChoice-like facts). */
    vectorColumn: VectorPipelineColumnFacts;
    /** String-typed columns of the result — source text candidates. */
    stringColumns: readonly VectorPipelineSourceColumn[];
    /** Row count of the bound result set (ordinal input validation hint). */
    totalRows?: number;
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
    const { rpc, handle, generation, vectorColumn, stringColumns, totalRows } = props;
    const [state, setState] = React.useState<QsVectorPipelineStateResult | undefined>();
    const [stateError, setStateError] = React.useState<string | undefined>();
    const [modelIndex, setModelIndex] = React.useState(0);
    const [sourceIndex, setSourceIndex] = React.useState(0);
    const [rowText, setRowText] = React.useState("0");
    const [panelError, setPanelError] = React.useState<string | undefined>();
    const [prepare, setPrepare] = React.useState<QsVectorReembedPrepareResult | undefined>();
    const [dialogOpen, setDialogOpen] = React.useState(false);
    const [showSql, setShowSql] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [result, setResult] = React.useState<QsVectorReembedExecuteResult | undefined>();
    const [callCount, setCallCount] = React.useState(0);
    const [chunkSize, setChunkSize] = React.useState(800);
    const [overlapPct, setOverlapPct] = React.useState(15);
    const [chunks, setChunks] = React.useState<QsVectorChunkPreviewResult | undefined>();
    const [chunkBusy, setChunkBusy] = React.useState(false);

    // Pipeline state per (handle, generation): a rerun resets everything.
    React.useEffect(() => {
        let cancelled = false;
        setState(undefined);
        setStateError(undefined);
        setPanelError(undefined);
        setPrepare(undefined);
        setDialogOpen(false);
        setResult(undefined);
        setChunks(undefined);
        setCallCount(0);
        void (async () => {
            try {
                const loaded = await rpc.sendRequest<
                    { refresh?: boolean },
                    QsVectorPipelineStateResult
                >(QsVectorPipelineStateRequest.type, {});
                if (!cancelled) {
                    setState(loaded);
                }
            } catch (e) {
                if (!cancelled) {
                    setStateError(e instanceof Error ? e.message : String(e));
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [rpc, handle, generation]);

    const models = state?.models ?? [];
    const model = models[Math.min(modelIndex, Math.max(0, models.length - 1))];
    const sourceColumn =
        stringColumns[Math.min(sourceIndex, Math.max(0, stringColumns.length - 1))];
    const parsedRow = parseRowOrdinal(rowText, totalRows);

    const onPrepare = async (): Promise<void> => {
        if (!model || !sourceColumn || parsedRow.ordinal === undefined) {
            setPanelError(parsedRow.error ?? "Pick a model and a source text column first.");
            return;
        }
        setPanelError(undefined);
        setResult(undefined);
        setBusy(true);
        try {
            const prepared = await rpc.sendRequest<
                {
                    handle: string;
                    ordinal: number;
                    sourceColumnOrdinal: number;
                    modelName: string;
                },
                QsVectorReembedPrepareResult
            >(QsVectorReembedPrepareRequest.type, {
                handle,
                ordinal: parsedRow.ordinal,
                sourceColumnOrdinal: sourceColumn.ordinal,
                modelName: model.name,
            });
            if (prepared.error || !prepared.descriptor || !prepared.confirmationToken) {
                setPanelError(prepared.error ?? "The host refused the confirmation.");
                setPrepare(undefined);
                return;
            }
            setPrepare(prepared);
            setShowSql(false);
            setDialogOpen(true);
        } catch (e) {
            setPanelError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    const onExecute = async (): Promise<void> => {
        if (!prepare?.confirmationToken) {
            return;
        }
        setBusy(true);
        setDialogOpen(false);
        try {
            const executed = await rpc.sendRequest<{ token: string }, QsVectorReembedExecuteResult>(
                QsVectorReembedExecuteRequest.type,
                { token: prepare.confirmationToken },
            );
            setResult(executed);
            if (executed.elapsedMs !== undefined) {
                // A statement reached the server (success or failure) — the
                // layered network claim must count it either way.
                setCallCount((count) => count + 1);
            }
        } catch (e) {
            setResult({ error: e instanceof Error ? e.message : String(e) });
        } finally {
            setBusy(false);
        }
    };

    const onChunkPreview = async (): Promise<void> => {
        if (!sourceColumn || parsedRow.ordinal === undefined) {
            setPanelError(parsedRow.error ?? "Pick a source text column and a row first.");
            return;
        }
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
            setChunks(preview);
        } catch (e) {
            setChunks({ error: e instanceof Error ? e.message : String(e) });
        } finally {
            setChunkBusy(false);
        }
    };

    const step = (value: number, delta: number, min: number, max: number): number =>
        Math.min(max, Math.max(min, value + delta));

    if (stateError) {
        return (
            <div className="qs-vecp-root">
                <div className="qs-vec-error">{stateError}</div>
            </div>
        );
    }

    const descriptor = prepare?.descriptor;
    const comparison = result?.comparison;
    const serverSideClaim =
        callCount === 0
            ? "Server-side model calls: none from this panel"
            : model?.egress === "externalEgress"
              ? `Server-side external calls: ${formatCount(callCount)}`
              : `Server-side model calls: ${formatCount(callCount)}`;

    return (
        <div className="qs-vecp-root">
            <div className="qs-vecp-columns">
                {/* --- PROVENANCE ------------------------------------------ */}
                <section className="qs-vecp-provenance">
                    <VecSectionLabel right="declared · stored locally">Provenance</VecSectionLabel>
                    <PropRow label="Vector column">{vectorColumn.columnName}</PropRow>
                    <div className="qs-vec6-prop-row">
                        <span className="qs-vec6-prop-label">Source text column</span>
                        {stringColumns.length === 0 ? (
                            <span className="qs-vec-muted">no string columns in this result</span>
                        ) : (
                            <select
                                className="qs-vecp-select"
                                value={sourceIndex}
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
                                onChange={(e) => setModelIndex(Number(e.currentTarget.value))}
                                aria-label="External model">
                                {models.map((candidate, i) => (
                                    <option key={candidate.name} value={i}>
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
                    <PropRow label="Expected metric">cosine</PropRow>
                    <PropRow label="Expected normalization">unit norm</PropRow>
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
                            onChange={(e) => setRowText(e.currentTarget.value)}
                            spellCheck={false}
                            aria-label="Result-row ordinal"
                        />
                        <button
                            className="qs-vecp-button"
                            disabled={
                                busy || !model || !sourceColumn || parsedRow.ordinal === undefined
                            }
                            onClick={() => void onPrepare()}>
                            Re-embed &amp; compare…
                        </button>
                    </div>
                    {panelError ? <div className="qs-vec-error">{panelError}</div> : null}
                    {parsedRow.error && rowText.trim().length > 0 ? (
                        <div className="qs-vec-muted">{parsedRow.error}</div>
                    ) : null}
                    {prepare?.sourcePreview ? (
                        <div className="qs-vecp-source-preview qs-vec-num">
                            “{prepare.sourcePreview}”
                        </div>
                    ) : null}
                    {result ? (
                        result.error ? (
                            <div className="qs-vec-error">
                                {result.error}
                                {result.elapsedMs !== undefined
                                    ? ` (${formatCount(result.elapsedMs)} ms)`
                                    : ""}
                            </div>
                        ) : comparison ? (
                            <div className="qs-vecp-result">
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
                        disabled={chunkBusy || !sourceColumn || parsedRow.ordinal === undefined}
                        onClick={() => void onChunkPreview()}>
                        Preview chunks
                    </button>
                    <span className="qs-vecp-chunk-spacer" />
                    <button
                        className="qs-vecp-button"
                        disabled
                        title="Batch chunk embedding ships in a later build — every chunk is one confirmed model call.">
                        Generate embeddings for chunks…
                    </button>
                </div>
                {state && !state.chunkingAvailable ? (
                    <div className="qs-vec-muted">
                        AI_GENERATE_CHUNKS needs compatibility level 170 on this database — the
                        preview below is local character math either way.
                    </div>
                ) : null}
                {chunks?.error ? <div className="qs-vec-error">{chunks.error}</div> : null}
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
                    {model && state ? ` · ${state.networkClaim.serverSide[model.egress]}` : ""}
                </span>
            </div>

            {/* --- host-minted confirmation dialog -------------------------- */}
            {dialogOpen && descriptor && prepare ? (
                <div className="qs-vecp-scrim" role="presentation">
                    <div
                        className="qs-vecp-dialog"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Re-embed selected row confirmation">
                        <div className="qs-vecp-dialog-title">
                            <span>Re-embed selected row?</span>
                            <button
                                className="qs-vecp-dialog-close"
                                aria-label="Cancel"
                                onClick={() => setDialogOpen(false)}>
                                ✕
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
                            <button className="qs-vecp-button" onClick={() => setDialogOpen(false)}>
                                Cancel
                            </button>
                            <button
                                className="qs-vecp-button"
                                onClick={() => setShowSql((visible) => !visible)}>
                                View generated T-SQL
                            </button>
                            <button
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
