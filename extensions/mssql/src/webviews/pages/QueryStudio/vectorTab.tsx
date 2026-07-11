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
import { perfMark, perfMarkAfterNextPaint } from "../../common/perfMarks";
import {
    QsVectorFindingDetailRequest,
    QsVectorFindingDetailResult,
    QsVectorOpenRequest,
    QsVectorOpenResult,
    QsVectorProfileRequest,
    QsVectorProfileResult,
    VectorFindingKind,
    VectorFindingSummary,
    VectorHistogram,
    VectorProfileSummary,
} from "../../../sharedInterfaces/vectorWorkbench";

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
}

type Workspace = "profile" | "search" | "compare" | "projection" | "index" | "pipeline";

const WORKSPACES: Array<{ id: Workspace; label: string; enabled: boolean }> = [
    { id: "profile", label: "Profile", enabled: true },
    { id: "search", label: "Search", enabled: false },
    { id: "compare", label: "Compare", enabled: false },
    { id: "projection", label: "Projection", enabled: false },
    { id: "index", label: "Index", enabled: false },
    { id: "pipeline", label: "Pipeline", enabled: false },
];

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
    return (
        <div>
            <div className="qs-vec-hist" style={{ height }}>
                {data.bucketCounts.map((count, i) => (
                    <div
                        key={i}
                        className="qs-vec-hist-bar"
                        style={{ height: `${Math.max(count > 0 ? 2 : 0, (count / max) * 100)}%` }}
                        title={`${formatCount(count)}`}
                    />
                ))}
            </div>
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
    const { rpc, columns, runKey } = props;
    const [workspace, setWorkspace] = React.useState<Workspace>("profile");
    const [columnIndex, setColumnIndex] = React.useState(0);
    const [opened, setOpened] = React.useState<QsVectorOpenResult | undefined>();
    const [profile, setProfile] = React.useState<VectorProfileSummary | undefined>();
    const [error, setError] = React.useState<string | undefined>();
    const [loading, setLoading] = React.useState(false);
    const [drawer, setDrawer] = React.useState<
        | { finding: VectorFindingSummary; detail?: QsVectorFindingDetailResult["detail"] }
        | undefined
    >();
    const column = columns[Math.min(columnIndex, Math.max(0, columns.length - 1))];

    // Open + profile per (run, column). The handle lives host-side; closing
    // is the host's idle/lifecycle concern — a rerun invalidates it anyway.
    React.useEffect(() => {
        let cancelled = false;
        setOpened(undefined);
        setProfile(undefined);
        setError(undefined);
        setDrawer(undefined);
        if (!column) {
            return;
        }
        setLoading(true);
        perfMark("mssql.queryResults.vector.render.begin", {});
        void (async () => {
            try {
                const openResult = await rpc.sendRequest<
                    { resultSetId: string; columnOrdinal: number },
                    QsVectorOpenResult
                >(QsVectorOpenRequest.type, {
                    resultSetId: column.resultSetId,
                    columnOrdinal: column.columnOrdinal,
                });
                if (cancelled) {
                    return;
                }
                setOpened(openResult);
                if (openResult.error) {
                    setError(openResult.error);
                    setLoading(false);
                    return;
                }
                const profileResult = await rpc.sendRequest<
                    { handle: string },
                    QsVectorProfileResult
                >(QsVectorProfileRequest.type, { handle: openResult.handle });
                if (cancelled) {
                    return;
                }
                if (profileResult.error || !profileResult.summary) {
                    setError(profileResult.error ?? "Analysis returned no summary.");
                } else {
                    setProfile(profileResult.summary);
                    perfMarkAfterNextPaint("mssql.queryResults.vector.render.firstPaint", {});
                }
            } catch (e) {
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : String(e));
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [rpc, runKey, column?.resultSetId, column?.columnOrdinal]);

    const openDrawer = async (finding: VectorFindingSummary) => {
        setDrawer({ finding });
        if (!finding.hasDetail || !opened?.handle) {
            return;
        }
        const result = await rpc.sendRequest<
            { handle: string; kind: VectorFindingKind },
            QsVectorFindingDetailResult
        >(QsVectorFindingDetailRequest.type, { handle: opened.handle, kind: finding.kind });
        setDrawer((current) =>
            current?.finding.kind === finding.kind ? { finding, detail: result.detail } : current,
        );
    };

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
        : opened
          ? `${formatCount(opened.totalRows)} rows`
          : "";

    return (
        <div className="qs-vec-root">
            <div className="qs-vec-toolbar">
                <select
                    className="qs-vec-select"
                    value={columnIndex}
                    onChange={(e) => setColumnIndex(Number(e.currentTarget.value))}
                    aria-label="Vector column">
                    {columns.map((c, i) => (
                        <option key={`${c.resultSetId}:${c.columnOrdinal}`} value={i}>
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
                    {WORKSPACES.map((w) => (
                        <button
                            key={w.id}
                            role="tab"
                            aria-selected={workspace === w.id}
                            className={`qs-vec-rail-item${workspace === w.id ? " active" : ""}`}
                            disabled={!w.enabled}
                            title={w.enabled ? w.label : `${w.label} — coming in a later build`}
                            onClick={() => w.enabled && setWorkspace(w.id)}>
                            {w.label}
                        </button>
                    ))}
                </nav>
                <main className="qs-vec-workspace">
                    {error ? (
                        <div className="qs-vec-empty">
                            <div className="qs-vec-error">{error}</div>
                        </div>
                    ) : loading || !profile ? (
                        <div className="qs-vec-empty qs-muted">Analyzing vector column…</div>
                    ) : (
                        <ProfileView profile={profile} onFinding={(f) => void openDrawer(f)} />
                    )}
                </main>
                {drawer ? (
                    <aside className="qs-vec-drawer">
                        <div className="qs-vec-drawer-header">
                            <span>{FINDING_LABELS[drawer.finding.kind]}</span>
                            <button
                                className="qs-vec-drawer-close"
                                aria-label="Close"
                                onClick={() => setDrawer(undefined)}>
                                ✕
                            </button>
                        </div>
                        <div className="qs-vec-drawer-body">
                            <div className="qs-vec-muted">
                                {drawer.finding.subject === "dimension"
                                    ? "Affected dimensions"
                                    : "Affected rows"}{" "}
                                · {formatCount(drawer.finding.affectedCount)}
                            </div>
                            {drawer.detail ? (
                                <ul className="qs-vec-ordinal-list">
                                    {(
                                        drawer.detail.resultRowOrdinals ??
                                        drawer.detail.dimensionOrdinals ??
                                        []
                                    ).map((ordinal, i) => (
                                        <li key={i}>
                                            <span className="qs-vec-num">
                                                {drawer.detail!.resultRowOrdinals
                                                    ? `row ${formatCount(ordinal)}`
                                                    : `dim ${formatCount(ordinal + 1)}`}
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
                                <div className="qs-vec-muted">Loading…</div>
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
                <span className="qs-vec-muted">
                    Local computation · no SQL executed · no network requests
                </span>
            </div>
        </div>
    );
}

function ProfileView(props: {
    profile: VectorProfileSummary;
    onFinding: (finding: VectorFindingSummary) => void;
}): React.JSX.Element {
    const { profile, onFinding } = props;
    const [norm, setNorm] = React.useState<"l2" | "l1" | "linf">("l2");
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
                                onClick={() => setNorm(kind)}>
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
