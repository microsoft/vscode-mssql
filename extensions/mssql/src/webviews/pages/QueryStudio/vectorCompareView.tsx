/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Compare workspace (VEC-6): basket of 2..8 result-row ordinals → named
 * pairwise metrics (never a "% similar"), a pairwise heat matrix
 * (color-mix over --vscode-charts-blue with an accessible table structure),
 * top-|Δ| and contribution bar lists for the first pair, and a selection
 * summary. All numbers arrive computed from the host — the webview holds no
 * vector components, only derived values.
 *
 * Rides the lazy vector chunk (imported only by vectorTab.tsx). House rules:
 * VS Code tokens only, 11px uppercase section labels, mono right-aligned
 * numerics, ≤2px radii, flat regions, inner scrolling.
 */

import * as React from "react";
import { Rpc } from "./resultsGridShared";
import {
    QsVectorCompareRequest,
    QsVectorCompareResult,
    QsVectorCancelRequest,
    VECTOR_COMPARE_MAX_ROWS,
    VECTOR_COMPARE_MIN_ROWS,
    VectorCompareBody,
    VectorCompareDimensionEntry,
} from "../../../sharedInterfaces/vectorWorkbench";
import {
    BASKET_LETTERS,
    formatCount,
    formatSigned,
    formatStat,
    VecPropRow,
    VecSectionLabel,
} from "./vectorViewsShared";
import type { QsVectorCompareViewState } from "../../../sharedInterfaces/queryStudioViewState";

export interface VectorCompareViewProps {
    rpc: Rpc;
    /** Host-minted analysis-session handle (qs/vector.open). */
    handle: string;
    /** Generation stamp — a rerun remounts/reset via this changing. */
    generation: number;
    /** Only the visible workspace may issue or retain an active analysis. */
    active: boolean;
    /** Row count of the bound result set (input validation hint). */
    totalRows?: number;
    /** Optional seed selection (e.g. grid multi-select) — compared on mount. */
    initialOrdinals?: readonly number[];
    initialViewState?: QsVectorCompareViewState;
    onViewStateChange?: (state: QsVectorCompareViewState) => void;
}

/** Integration descriptor for vectorTab.tsx (rail id + mount component). */
export const vectorCompareIntegration = {
    workspace: "compare" as const,
    label: "Compare",
    Component: VectorCompareView,
};

type PairMetric = "cosine" | "euclidean" | "negativeDot";

const METRIC_LABELS: Record<PairMetric, string> = {
    cosine: "cosine",
    euclidean: "euclidean",
    negativeDot: "negative dot",
};

function parseOrdinals(text: string): { ordinals?: number[]; error?: string } {
    const parts = text
        .split(/[\s,;]+/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    if (parts.length === 0) {
        return { error: "Enter result-row ordinals, e.g. 0, 4, 17." };
    }
    const ordinals: number[] = [];
    for (const part of parts) {
        const cleaned = part.startsWith("#") ? part.slice(1) : part;
        if (!/^\d+$/.test(cleaned)) {
            return { error: `"${part}" is not a result-row ordinal.` };
        }
        ordinals.push(Number(cleaned));
    }
    if (ordinals.length < VECTOR_COMPARE_MIN_ROWS || ordinals.length > VECTOR_COMPARE_MAX_ROWS) {
        return {
            error: `Select between ${VECTOR_COMPARE_MIN_ROWS} and ${VECTOR_COMPARE_MAX_ROWS} rows to compare.`,
        };
    }
    if (new Set(ordinals).size !== ordinals.length) {
        return { error: "Each result-row ordinal may appear only once." };
    }
    return { ordinals };
}

function heatStyle(value: number | null, max: number): React.CSSProperties {
    if (value === null || !Number.isFinite(value) || max <= 0) {
        return {};
    }
    // Heat by magnitude (negative-dot matrices are all-negative off-diagonal).
    const pct = Math.max(0, Math.min(60, (Math.abs(value) / max) * 60));
    return {
        backgroundColor: `color-mix(in srgb, var(--vscode-charts-blue) ${pct.toFixed(1)}%, transparent)`,
    };
}

function BarList(props: {
    entries: readonly VectorCompareDimensionEntry[];
    positiveVar: string;
    negativeVar: string;
}): React.JSX.Element {
    const max = Math.max(1e-12, ...props.entries.map((entry) => Math.abs(entry.value)));
    return (
        <div>
            {props.entries.map((entry) => (
                <div key={entry.dimension} className="qs-vec-variance-row">
                    <span className="qs-vec-num qs-vec-dim">dim {entry.dimension + 1}</span>
                    <span className="qs-vec-variance-bar">
                        <span
                            style={{
                                width: `${Math.max(1, (Math.abs(entry.value) / max) * 100)}%`,
                                background: `var(${entry.value >= 0 ? props.positiveVar : props.negativeVar})`,
                            }}
                        />
                    </span>
                    <span className="qs-vec-num qs-vec6-signed">{formatSigned(entry.value)}</span>
                </div>
            ))}
        </div>
    );
}

export function VectorCompareView(props: VectorCompareViewProps): React.JSX.Element {
    const {
        rpc,
        handle,
        generation,
        active,
        totalRows,
        initialOrdinals,
        initialViewState,
        onViewStateChange,
    } = props;
    const [input, setInput] = React.useState(
        initialViewState?.ordinalInput ?? initialOrdinals?.join(", ") ?? "",
    );
    const [inputError, setInputError] = React.useState<string | undefined>();
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | undefined>();
    const [body, setBody] = React.useState<VectorCompareBody | undefined>();
    const [metric, setMetric] = React.useState<PairMetric>(initialViewState?.metric ?? "cosine");
    const [lastSubmittedOrdinals, setLastSubmittedOrdinals] = React.useState<
        readonly number[] | undefined
    >(initialViewState?.lastSubmittedOrdinals);
    const requestSerial = React.useRef(0);

    const run = React.useCallback(
        async (ordinals: readonly number[]) => {
            const serial = ++requestSerial.current;
            setBusy(true);
            setError(undefined);
            try {
                const result = await rpc.sendRequest<
                    { handle: string; ordinals: readonly number[] },
                    QsVectorCompareResult
                >(QsVectorCompareRequest.type, { handle, ordinals });
                if (serial !== requestSerial.current) {
                    return; // stale response — a newer compare superseded it
                }
                if (result.error || !result.compare) {
                    setError(result.error ?? "The comparison returned no data.");
                } else {
                    setBody(result.compare);
                    setLastSubmittedOrdinals([...ordinals]);
                }
            } catch (e) {
                if (serial === requestSerial.current) {
                    setError(e instanceof Error ? e.message : String(e));
                }
            } finally {
                if (serial === requestSerial.current) {
                    setBusy(false);
                }
            }
        },
        [rpc, handle],
    );

    // Seed selection (when provided) runs once per handle/generation; a
    // mid-session change to initialOrdinals intentionally does NOT re-run —
    // the basket belongs to the user once mounted.
    const initialRef = React.useRef(initialOrdinals ?? initialViewState?.lastSubmittedOrdinals);
    const initialRunStartedRef = React.useRef(false);
    React.useEffect(() => {
        if (!active || initialRunStartedRef.current) {
            return;
        }
        initialRunStartedRef.current = true;
        setBody(undefined);
        setError(undefined);
        const seed = initialRef.current;
        if (seed && seed.length >= VECTOR_COMPARE_MIN_ROWS) {
            void run(seed.slice(0, VECTOR_COMPARE_MAX_ROWS));
        }
    }, [active, handle, generation, run]);

    React.useEffect(() => {
        if (active || !busy) {
            return;
        }
        requestSerial.current++;
        setBusy(false);
        void rpc.sendRequest(QsVectorCancelRequest.type, { handle }).catch(() => undefined);
    }, [active, busy, handle, rpc]);

    React.useEffect(() => {
        onViewStateChange?.({
            ordinalInput: input,
            ...(lastSubmittedOrdinals ? { lastSubmittedOrdinals: [...lastSubmittedOrdinals] } : {}),
            metric,
        });
    }, [input, lastSubmittedOrdinals, metric, onViewStateChange]);

    const submit = () => {
        const parsed = parseOrdinals(input);
        if (parsed.error || !parsed.ordinals) {
            setInputError(parsed.error);
            return;
        }
        if (totalRows !== undefined) {
            const outOfRange = parsed.ordinals.find((ordinal) => ordinal >= totalRows);
            if (outOfRange !== undefined) {
                setInputError(
                    `Result-row ordinal ${outOfRange} is out of range (0–${totalRows - 1}).`,
                );
                return;
            }
        }
        setInputError(undefined);
        void run(parsed.ordinals);
    };

    const letters = (index: number) => BASKET_LETTERS[index] ?? `#${index}`;
    const matrix = body?.pairwise[metric];
    const parsedInput = parseOrdinals(input).ordinals;
    const inputDirty =
        body !== undefined &&
        (parsedInput?.join(",") ?? "") !== (lastSubmittedOrdinals?.join(",") ?? "");

    const onMetricKeyDown = (event: React.KeyboardEvent, current: PairMetric) => {
        const metrics = Object.keys(METRIC_LABELS) as PairMetric[];
        const index = metrics.indexOf(current);
        let next = index;
        if (event.key === "ArrowRight" || event.key === "ArrowDown")
            next = (index + 1) % metrics.length;
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
            next = (index - 1 + metrics.length) % metrics.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = metrics.length - 1;
        else return;
        event.preventDefault();
        const metric = metrics[next];
        setMetric(metric);
        event.currentTarget.parentElement
            ?.querySelector<HTMLButtonElement>(`[data-metric="${metric}"]`)
            ?.focus();
    };
    const matrixMax = matrix
        ? Math.max(
              1e-12,
              ...matrix.flatMap((row, i) =>
                  row
                      .map((value, j) => (i === j || value === null ? 0 : Math.abs(value)))
                      .filter((value) => Number.isFinite(value)),
              ),
          )
        : 1;

    return (
        <div className="qs-vec6-compare">
            <div className="qs-vec6-input-row">
                <input
                    className="qs-vec6-ordinal-input qs-vec-num"
                    value={input}
                    placeholder={`Result-row ordinals, e.g. 0, 4, 17 (${VECTOR_COMPARE_MIN_ROWS}–${VECTOR_COMPARE_MAX_ROWS} rows)`}
                    aria-label="Result-row ordinals to compare"
                    disabled={busy}
                    onChange={(e) => setInput(e.currentTarget.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            submit();
                        }
                    }}
                />
                <button className="qs-vec6-primary-btn" onClick={submit} disabled={busy}>
                    {busy ? "Comparing…" : "Compare"}
                </button>
            </div>
            {inputError ? (
                <div className="qs-vec-error qs-vec6-inline-error" role="alert">
                    {inputError}
                </div>
            ) : null}
            {inputDirty ? (
                <div className="qs-vec-muted" role="status">
                    Input changed; the comparison below is the last submitted basket.
                </div>
            ) : null}
            {error ? (
                <div className="qs-vec-error qs-vec6-inline-error" role="alert">
                    {error}
                </div>
            ) : null}
            {!body && !error && !busy ? (
                <div className="qs-vec-empty qs-muted">
                    Pick 2–8 result rows by ordinal to compare their vectors — every metric is
                    named; there is no single “% similar”.
                </div>
            ) : null}
            {body ? (
                <div className="qs-vec-columns">
                    <section>
                        <VecSectionLabel
                            right={`${letters(0)} · ${letters(1)}${body.items.length > 2 ? " · …" : ""} from result rows`}>
                            Compare basket
                        </VecSectionLabel>
                        <div role="list">
                            {body.items.map((item, i) => (
                                <div
                                    key={item.ordinal}
                                    role="listitem"
                                    className="qs-vec6-basket-row">
                                    <span className="qs-vec-num qs-vec6-letter">{letters(i)}</span>
                                    <span className="qs-vec-num qs-vec6-basket-key">
                                        #{formatCount(item.ordinal)}
                                    </span>
                                    <span className="qs-vec-muted qs-vec6-basket-dims qs-vec-num">
                                        {formatCount(item.dimensions)}·f32
                                    </span>
                                    <span className="qs-vec-num qs-vec6-basket-norm">
                                        {formatStat(item.l2)}
                                    </span>
                                </div>
                            ))}
                        </div>

                        <VecSectionLabel right="each metric named — no single “% similar”">
                            {letters(0)} ↔ {letters(1)}
                        </VecSectionLabel>
                        <VecPropRow label="Cosine distance">
                            {body.pairwise.cosine[0]?.[1] === null ||
                            body.pairwise.cosine[0]?.[1] === undefined
                                ? "undefined (zero-norm vector)"
                                : formatStat(body.pairwise.cosine[0][1])}
                        </VecPropRow>
                        <VecPropRow label="Euclidean distance">
                            {formatStat(body.pairwise.euclidean[0]?.[1] ?? 0)}
                        </VecPropRow>
                        <VecPropRow label="Negative dot product">
                            {formatStat(body.pairwise.negativeDot[0]?.[1] ?? 0)}
                        </VecPropRow>
                        <VecPropRow label={`L1 norm (${letters(0)})`}>
                            {formatStat(body.items[0]?.l1 ?? 0)}
                        </VecPropRow>
                        <VecPropRow label={`L2 norm (${letters(0)})`}>
                            {formatStat(body.items[0]?.l2 ?? 0)}
                        </VecPropRow>
                        <VecPropRow label={`L∞ norm (${letters(0)})`}>
                            {formatStat(body.items[0]?.linf ?? 0)}
                        </VecPropRow>

                        <VecSectionLabel
                            right={
                                <>
                                    <span
                                        className="qs-vec6-metric-toggle"
                                        role="radiogroup"
                                        aria-label="Matrix metric">
                                        {(Object.keys(METRIC_LABELS) as PairMetric[]).map((m) => (
                                            <button
                                                key={m}
                                                role="radio"
                                                aria-checked={metric === m}
                                                tabIndex={metric === m ? 0 : -1}
                                                data-metric={m}
                                                className={metric === m ? "active" : ""}
                                                onKeyDown={(event) => onMetricKeyDown(event, m)}
                                                onClick={() => setMetric(m)}>
                                                {METRIC_LABELS[m]}
                                            </button>
                                        ))}
                                    </span>
                                    {" · values shown in cells"}
                                </>
                            }>
                            Pairwise distances
                        </VecSectionLabel>
                        <table
                            className="qs-vec6-matrix"
                            aria-label={`Pairwise ${METRIC_LABELS[metric]} matrix`}>
                            <thead>
                                <tr>
                                    <th aria-hidden="true" />
                                    {body.items.map((_, j) => (
                                        <th key={j} scope="col" className="qs-vec-num">
                                            {letters(j)}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {matrix?.map((row, i) => (
                                    <tr key={i}>
                                        <th scope="row" className="qs-vec-num">
                                            {letters(i)}
                                        </th>
                                        {row.map((value, j) => (
                                            <td
                                                key={j}
                                                className="qs-vec-num"
                                                style={i === j ? {} : heatStyle(value, matrixMax)}>
                                                {value === null
                                                    ? "—"
                                                    : Number(value.toPrecision(4)).toString()}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        <VecSectionLabel right={`${body.summary.metric} · local`}>
                            Selection summary
                        </VecSectionLabel>
                        <VecPropRow label="Centroid">
                            mean of {body.items.map((_, i) => letters(i)).join(" · ")}
                        </VecPropRow>
                        <VecPropRow label="Medoid">
                            {body.summary.medoidIndex !== null
                                ? `${letters(body.summary.medoidIndex)} · #${formatCount(body.items[body.summary.medoidIndex].ordinal)}`
                                : "undefined"}
                        </VecPropRow>
                        <VecPropRow label="Most isolated">
                            {body.summary.mostIsolatedIndex !== null &&
                            body.summary.mostIsolatedAvgDistance !== null
                                ? `${letters(body.summary.mostIsolatedIndex)} · ${formatStat(body.summary.mostIsolatedAvgDistance)}`
                                : "undefined"}
                        </VecPropRow>
                        <VecPropRow label="Closest pair">
                            {body.summary.closestPair !== null
                                ? `${letters(body.summary.closestPair.a)} ↔ ${letters(body.summary.closestPair.b)} · ${formatStat(body.summary.closestPair.distance)}`
                                : "undefined"}
                        </VecPropRow>
                        <VecPropRow label="Avg pair distance">
                            {body.summary.avgPairDistance !== null
                                ? formatStat(body.summary.avgPairDistance)
                                : "undefined"}
                        </VecPropRow>
                        <VecPropRow label="Compatible">
                            {`${body.summary.compatibleCount} of ${body.items.length} · ${formatCount(body.items[0]?.dimensions ?? 0)}-D`}
                        </VecPropRow>
                    </section>
                    <section>
                        <VecSectionLabel right={`${letters(0)} − ${letters(1)} · local`}>
                            Top |Δ| dimensions
                        </VecSectionLabel>
                        <BarList
                            entries={body.topDeltaDimensions}
                            positiveVar="--vscode-charts-blue"
                            negativeVar="--vscode-charts-orange"
                        />
                        <VecSectionLabel right="why this pair ranks close · cosine/dot">
                            Top contributions ({letters(0)}ᵢ·{letters(1)}ᵢ)
                        </VecSectionLabel>
                        <BarList
                            entries={body.topContributions}
                            positiveVar="--vscode-charts-green"
                            negativeVar="--vscode-charts-red"
                        />
                    </section>
                </div>
            ) : null}
        </div>
    );
}
