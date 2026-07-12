/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Index workspace (VEC-9): two-column layout per the vec_index mock — left
 * PROPERTIES (label/value mono rows with a source tint) above FINDINGS
 * (severity glyph + factual title + method line); right SCRIPTS command list
 * + read-only preview with copy. The scripts caption "generated — never
 * executed by this pane" is PERMANENT chrome.
 *
 * State honesty (P0-3): the migration entry only exists when the host said
 * `legacyFormat`, and when it is selected the service-impact warning renders
 * ABOVE the script text. `permissionDegraded` leads with "Health unavailable"
 * — the word "Healthy" appears nowhere in this pane. `noIndex` explains and
 * highlights the create script for review only.
 *
 * House rules (briefs r01/r06): VS Code tokens only, 11px UPPERCASE section
 * labels, mono numerics, ≤2px radii, no cards/chips; inner regions scroll,
 * the page never does. CSS: vectorIndexView.css must ride the ENTRY
 * stylesheet (lazy-chunk CSS is not linked by the webview HTML) — wiring is
 * one import in pages/QueryStudio/index.tsx, documented for the orchestrator.
 */

import * as React from "react";
import { Rpc } from "./resultsGridShared";
import { VecSectionLabel } from "./vectorViewsShared";
import {
    QsVectorIndexStateParams,
    QsVectorIndexStateRequest,
    QsVectorIndexStateResult,
    VectorIndexFinding,
    VectorIndexProperty,
    VectorIndexScript,
    VectorIndexWorkspaceView,
} from "../../../sharedInterfaces/vectorIndex";
import type { QsVectorIndexViewState } from "../../../sharedInterfaces/queryStudioViewState";
import {
    QsVectorSearchTargetsParams,
    QsVectorSearchTargetsRequest,
    QsVectorSearchTargetsResult,
    VectorSearchTargetInfo,
} from "../../../sharedInterfaces/vectorSearch";

export interface VectorIndexViewProps {
    rpc: Rpc;
    handle: string;
    /** Generation stamp — a rerun/reconnect refetches via this changing. */
    generation: number;
    /** Only the visible workspace may issue catalog/DMV work. */
    active: boolean;
    initialViewState?: QsVectorIndexViewState;
    onViewStateChange?: (state: QsVectorIndexViewState) => void;
    targetId?: string;
    onTargetChange?: (targetId: string | undefined) => void;
    metric?: "cosine" | "euclidean" | "dot";
    filterColumns?: readonly string[];
    resultVectorColumn: string;
    resultDimensions?: number;
}

/** Integration descriptor for vectorTab.tsx (rail id + mount component). */
export const vectorIndexIntegration = {
    workspace: "index" as const,
    label: "Index",
    Component: VectorIndexView,
};

const SEVERITY_GLYPH: Record<VectorIndexFinding["severity"], string> = {
    success: "✓",
    info: "i",
    warning: "▲",
    error: "✕",
};

const STATE_CAPTION: Record<VectorIndexWorkspaceView["state"], string> = {
    healthyCurrent: "Current-format index",
    legacyFormat: "Earlier-format index — migration available",
    formatUnknown: "Index format unknown",
    noIndex: "No vector index",
    buildFailedTier: "Index build failed on this tier",
    permissionDegraded: "Health unavailable",
    noVectorColumns: "No vector columns",
};

function targetLabel(target: VectorSearchTargetInfo): string {
    return `${target.schema}.${target.table}.${target.vectorColumn}${
        target.dimensions !== undefined ? ` (${target.dimensions}D)` : ""
    }`;
}

export function VectorIndexView(props: VectorIndexViewProps): React.JSX.Element {
    const {
        rpc,
        handle,
        generation,
        active,
        initialViewState,
        onViewStateChange,
        targetId,
        onTargetChange,
        metric,
        filterColumns,
        resultVectorColumn,
        resultDimensions,
    } = props;
    const [view, setView] = React.useState<VectorIndexWorkspaceView | undefined>();
    const [error, setError] = React.useState<string | undefined>();
    const [loading, setLoading] = React.useState(true);
    const [selectedScriptId, setSelectedScriptId] = React.useState<string | undefined>(
        initialViewState?.selectedScriptId,
    );
    const [scriptScrollTop, setScriptScrollTop] = React.useState(
        initialViewState?.scriptScrollTop ?? 0,
    );
    const scriptRef = React.useRef<HTMLPreElement | null>(null);
    const [copied, setCopied] = React.useState(false);
    const requestSerialRef = React.useRef(0);
    const targetsRequestSerialRef = React.useRef(0);
    const [targetsResult, setTargetsResult] = React.useState<
        QsVectorSearchTargetsResult | undefined
    >();
    const [targetsLoading, setTargetsLoading] = React.useState(false);
    const [selectedTargetId, setSelectedTargetId] = React.useState(targetId);
    const selectedTargetIdRef = React.useRef(targetId);

    React.useEffect(() => {
        selectedTargetIdRef.current = targetId;
        setSelectedTargetId(targetId);
    }, [targetId]);

    const loadTargets = React.useCallback(async () => {
        const serial = ++targetsRequestSerialRef.current;
        setTargetsLoading(true);
        try {
            const result = await rpc.sendRequest<
                QsVectorSearchTargetsParams,
                QsVectorSearchTargetsResult
            >(QsVectorSearchTargetsRequest.type, { handle });
            if (serial !== targetsRequestSerialRef.current) {
                return;
            }
            setTargetsResult(result);
            const current = selectedTargetIdRef.current;
            if (current && !result.targets?.some((target) => target.id === current)) {
                selectedTargetIdRef.current = undefined;
                setSelectedTargetId(undefined);
                onTargetChange?.(undefined);
            }
        } catch (cause) {
            if (serial === targetsRequestSerialRef.current) {
                setTargetsResult((current) => ({
                    ...(current?.targets ? { targets: current.targets } : {}),
                    error: cause instanceof Error ? cause.message : String(cause),
                }));
            }
        } finally {
            if (serial === targetsRequestSerialRef.current) {
                setTargetsLoading(false);
            }
        }
    }, [handle, onTargetChange, rpc]);

    React.useEffect(() => {
        if (active) {
            void loadTargets();
        } else {
            targetsRequestSerialRef.current++;
            setTargetsLoading(false);
        }
        return () => {
            targetsRequestSerialRef.current++;
        };
    }, [active, generation, loadTargets]);

    const fetchState = React.useCallback(
        async (refresh: boolean) => {
            const serial = ++requestSerialRef.current;
            setLoading(true);
            setError(undefined);
            try {
                const result = await rpc.sendRequest<
                    QsVectorIndexStateParams,
                    QsVectorIndexStateResult
                >(QsVectorIndexStateRequest.type, {
                    handle,
                    ...(refresh ? { refresh: true } : {}),
                    ...(selectedTargetId ? { targetId: selectedTargetId } : {}),
                    ...(metric ? { metric } : {}),
                    ...(filterColumns?.length ? { filterColumns } : {}),
                    resultVectorColumn,
                    ...(resultDimensions !== undefined ? { resultDimensions } : {}),
                });
                if (serial !== requestSerialRef.current) {
                    return;
                }
                if (result.error || !result.view) {
                    setView(undefined);
                    setError(result.error ?? "Index state returned no view.");
                } else {
                    setView(result.view);
                    setSelectedScriptId((current) =>
                        current && result.view!.scripts.some((script) => script.id === current)
                            ? current
                            : defaultScriptId(result.view!),
                    );
                }
            } catch (e) {
                if (serial === requestSerialRef.current) {
                    setView(undefined);
                    setError(e instanceof Error ? e.message : String(e));
                }
            } finally {
                if (serial === requestSerialRef.current) {
                    setLoading(false);
                    setCopied(false);
                }
            }
        },
        [
            filterColumns,
            handle,
            metric,
            resultDimensions,
            resultVectorColumn,
            rpc,
            selectedTargetId,
        ],
    );

    React.useEffect(() => {
        if (!active) {
            requestSerialRef.current++;
            setLoading(false);
        } else if (targetsResult && selectedTargetId && !targetsResult.error) {
            void fetchState(false);
        } else if (targetsResult?.error) {
            requestSerialRef.current++;
            setLoading(false);
            setError(undefined);
        } else {
            requestSerialRef.current++;
            setView(undefined);
            setError(undefined);
            setLoading(false);
        }
        return () => {
            requestSerialRef.current++;
        };
    }, [active, fetchState, generation, selectedTargetId, targetsResult]);

    React.useEffect(() => {
        onViewStateChange?.({
            ...(selectedScriptId ? { selectedScriptId } : {}),
            scriptScrollTop,
        });
    }, [onViewStateChange, scriptScrollTop, selectedScriptId]);

    const selectedScript = view?.scripts.find((script) => script.id === selectedScriptId);
    React.useLayoutEffect(() => {
        if (selectedScript && scriptRef.current) {
            scriptRef.current.scrollTop = scriptScrollTop;
        }
    }, [scriptScrollTop, selectedScript]);
    const targetSnapshotStale = Boolean(targetsResult?.error);

    const targetPicker = (
        <div className="qs-vec9-binding">
            <label htmlFor="qs-vec9-target">Verified target</label>
            <select
                id="qs-vec9-target"
                className="qs-vec-select"
                value={selectedTargetId ?? ""}
                disabled={
                    !targetsResult?.targets?.length ||
                    loading ||
                    targetsLoading ||
                    Boolean(targetsResult?.error)
                }
                onChange={(event) => {
                    const next = event.currentTarget.value || undefined;
                    selectedTargetIdRef.current = next;
                    setSelectedTargetId(next);
                    onTargetChange?.(next);
                }}>
                <option value="">
                    {targetsResult
                        ? (targetsResult.error ?? "Choose a database vector target")
                        : "Loading verified targets…"}
                </option>
                {(targetsResult?.targets ?? []).map((target) => (
                    <option key={target.id} value={target.id}>
                        {targetLabel(target)}
                    </option>
                ))}
            </select>
            <button
                type="button"
                className="qs-vec9-btn"
                disabled={targetsLoading || loading}
                onClick={() => void loadTargets()}>
                {targetsLoading ? "Refreshing…" : "Refresh targets"}
            </button>
            <span
                className={targetsResult?.error ? "qs-vec-warning" : "qs-vec-muted"}
                role={targetsResult?.error ? "status" : undefined}>
                {targetsResult?.error
                    ? "Last verified targets shown · index facts and scripts are locked until refresh succeeds"
                    : "Index facts and scripts stay locked until a catalog-verified target is selected."}
            </span>
        </div>
    );
    const withTargetPicker = (content: React.ReactNode): React.JSX.Element => (
        <div className="qs-vec9-shell">
            {targetPicker}
            {content}
        </div>
    );

    const copyScript = async () => {
        if (!selectedScript || targetSnapshotStale) {
            return;
        }
        try {
            await navigator.clipboard.writeText(selectedScript.sql);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
        } catch {
            // Clipboard refusal (permissions) is non-fatal; the text stays
            // selectable in the <pre>.
        }
    };

    if (loading && !view) {
        return withTargetPicker(<div className="qs-vec-empty qs-muted">Probing index state…</div>);
    }
    if (error) {
        return withTargetPicker(
            <div className="qs-vec-empty">
                <div className="qs-vec-error" role="alert">
                    {error}
                </div>
                <button className="qs-vec9-btn" onClick={() => void fetchState(true)}>
                    Retry probe
                </button>
            </div>,
        );
    }
    if (!view) {
        return withTargetPicker(
            <div className="qs-vec-empty qs-muted">
                Choose a verified target to inspect its vector index.
            </div>,
        );
    }

    // noVectorColumns: nothing to lay out — one explanatory empty state.
    if (view.state === "noVectorColumns") {
        return withTargetPicker(
            <div className="qs-vec-empty qs-muted">
                <div>No vector columns were discovered in this database.</div>
                <div className="qs-vec9-empty-detail">{view.findings[0]?.detail ?? ""}</div>
                <button className="qs-vec9-btn" onClick={() => void fetchState(true)}>
                    Refresh
                </button>
            </div>,
        );
    }

    const propertiesSource = view.properties.some((p) => p.source === "healthDmv")
        ? "catalog + sys.dm_db_vector_indexes"
        : "catalog";

    return withTargetPicker(
        <div className="qs-vec9-root" data-state={view.state}>
            <section className="qs-vec9-left">
                <div className="qs-vec9-state-row">
                    <span
                        className={`qs-vec9-state${view.state === "permissionDegraded" ? " degraded" : ""}`}>
                        {STATE_CAPTION[view.state]}
                    </span>
                    <button
                        className="qs-vec9-btn"
                        onClick={() =>
                            void (targetSnapshotStale ? loadTargets() : fetchState(true))
                        }
                        disabled={loading}
                        title="Re-run the capability probe (bypasses the cache)">
                        {loading ? "Probing…" : "Refresh"}
                    </button>
                </div>
                {view.state === "permissionDegraded" ? (
                    <div className="qs-vec9-degraded-note">
                        Health unavailable — catalog/DMV visibility is degraded on this connection.
                        Facts below are partial; nothing here is a health claim.
                    </div>
                ) : null}
                {view.state === "noIndex" || view.state === "buildFailedTier" ? (
                    <div className="qs-vec9-empty-note">
                        {view.state === "buildFailedTier"
                            ? "A recent index build failed on this service tier. Exact search still works; the create script is generated for review only."
                            : "No confirmed vector index on this target. Exact VECTOR_DISTANCE search still works; a create script is generated for review only."}
                    </div>
                ) : null}
                <VecSectionLabel right={propertiesSource}>Properties</VecSectionLabel>
                <div className="qs-vec9-props">
                    {view.properties.map((property, i) => (
                        <PropRow key={`${property.label}:${i}`} property={property} />
                    ))}
                </div>
                <VecSectionLabel right={`${view.findings.length}`}>Findings</VecSectionLabel>
                <ul className="qs-vec9-findings">
                    {view.findings.map((finding, i) => (
                        <li key={i} className="qs-vec9-finding" data-severity={finding.severity}>
                            <span className="qs-vec9-glyph" aria-hidden="true">
                                {SEVERITY_GLYPH[finding.severity]}
                            </span>
                            <span className="qs-vec9-finding-main">
                                <span className="qs-vec9-finding-title">{finding.title}</span>
                                <span className="qs-vec9-finding-detail">{finding.detail}</span>
                            </span>
                        </li>
                    ))}
                </ul>
            </section>
            <section className="qs-vec9-right">
                <VecSectionLabel right="generated — never executed by this pane">
                    Scripts
                </VecSectionLabel>
                {view.scripts.length === 0 ? (
                    <div className="qs-vec-muted">No scripts apply to this state.</div>
                ) : (
                    <>
                        <ul className="qs-vec9-script-list" aria-label="Generated scripts">
                            {view.scripts.map((script) => (
                                <li key={script.id}>
                                    <button
                                        disabled={targetSnapshotStale}
                                        aria-current={
                                            script.id === selectedScriptId ? "true" : undefined
                                        }
                                        className={`qs-vec9-script-item${script.id === selectedScriptId ? " active" : ""}${
                                            highlightScript(view, script) ? " highlight" : ""
                                        }`}
                                        onClick={() => setSelectedScriptId(script.id)}>
                                        {script.title}
                                    </button>
                                </li>
                            ))}
                        </ul>
                        {selectedScript ? (
                            <div className="qs-vec9-preview">
                                <div className="qs-vec9-preview-bar">
                                    <span className="qs-vec-muted">{selectedScript.title}</span>
                                    <button
                                        className="qs-vec9-btn"
                                        disabled={targetSnapshotStale}
                                        onClick={() => void copyScript()}>
                                        {copied ? "Copied" : "Copy script"}
                                    </button>
                                </div>
                                {selectedScript.id === "migration" ? (
                                    <div className="qs-vec9-impact" role="alert">
                                        Service impact: dropping this index immediately disables
                                        approximate search on this table until the replacement
                                        finishes building. Plan a maintenance window.
                                    </div>
                                ) : null}
                                <pre
                                    ref={scriptRef}
                                    className="qs-vec9-pre"
                                    tabIndex={0}
                                    onScroll={(event) =>
                                        setScriptScrollTop(event.currentTarget.scrollTop)
                                    }>
                                    {selectedScript.sql}
                                </pre>
                            </div>
                        ) : null}
                    </>
                )}
            </section>
        </div>,
    );
}

/** Label/value mono row with the source tint (VecPropRow register). */
function PropRow(props: { property: VectorIndexProperty }): React.JSX.Element {
    const { property } = props;
    return (
        <div
            className="qs-vec9-prop-row"
            data-source={property.source}
            title={`Source: ${sourceTitle(property.source)}`}>
            <span className="qs-vec9-prop-label">{property.label}</span>
            <span className="qs-vec-num qs-vec9-prop-value">{property.value}</span>
        </div>
    );
}

function sourceTitle(source: VectorIndexProperty["source"]): string {
    switch (source) {
        case "catalog":
            return "index catalog (sys.vector_indexes + sys.indexes join)";
        case "healthDmv":
            return "sys.dm_db_vector_indexes (column names resolved live)";
        case "config":
            return "database-scoped configuration probe";
        case "engine":
            return "SERVERPROPERTY probe";
        case "derived":
            return "derived from probe facts";
    }
}

/** noIndex highlights the create script (state-specific empty-state rule). */
function highlightScript(view: VectorIndexWorkspaceView, script: VectorIndexScript): boolean {
    return (
        (view.state === "noIndex" || view.state === "buildFailedTier") &&
        script.id === "createIndex"
    );
}

/** Default selection: legacy → migration (mock); noIndex → create; else first. */
function defaultScriptId(view: VectorIndexWorkspaceView): string | undefined {
    if (view.state === "legacyFormat") {
        return view.scripts.find((script) => script.id === "migration")?.id ?? view.scripts[0]?.id;
    }
    if (view.state === "noIndex" || view.state === "buildFailedTier") {
        return (
            view.scripts.find((script) => script.id === "createIndex")?.id ?? view.scripts[0]?.id
        );
    }
    return view.scripts[0]?.id;
}
