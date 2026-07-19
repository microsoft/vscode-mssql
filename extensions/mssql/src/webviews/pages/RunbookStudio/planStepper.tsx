/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Plan stepper (mockup "execution plan" grammar, first slice): vertical
 * operator cards in plan order with connectors, per-node kind icon, activity
 * identity, trusted blast-radius chip, branch-condition annotations from the
 * edges, and — when a run snapshot is supplied — live state + duration
 * overlays. Deterministic layout; the full est-vs-actual DAG canvas is the
 * follow-up, this stepper is its readable baseline.
 */

import { useId, useState } from "react";
import { locConstants } from "../../common/locConstants";
import {
    RunbookNodeSnapshot,
    RunbookPlanEdge,
    RunbookPlanNode,
    RunbookRunSnapshot,
} from "../../../sharedInterfaces/runbookStudio";
import {
    compatibleViews,
    defaultViewFor,
    expectedContractFor,
    viewCandidateTier,
    ViewKind,
} from "../../../sharedInterfaces/runbookPresentation";
import { useRbs } from "./state";

/** Mockup "Output: [view ▾]" affordance: pick from the closed catalog's
 *  contract-compatible candidates; a pin shows "Set by you", otherwise the
 *  compiler-suggested default shows "Suggested". Gates show a quiet dash. */
function OutputPicker({ node, pinned }: { node: RunbookPlanNode; pinned: ViewKind | undefined }) {
    const { setOutputView } = useRbs();
    const loc = locConstants.runbookStudio;
    const candidatePanelId = useId();
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const contract = expectedContractFor(node.kind, node.activityKind);
    if (!contract) {
        return (
            <span className="rbs-muted">
                {loc.outputLabel} — {loc.noOutput}
            </span>
        );
    }
    const candidates = compatibleViews(contract);
    const current = pinned ?? defaultViewFor(contract);
    const unavailablePin = pinned && !candidates.includes(pinned) ? pinned : undefined;

    const chooseView = async (view: ViewKind | undefined) => {
        setSaving(true);
        try {
            if (await setOutputView(node.id, view)) {
                setOpen(false);
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="rbs-output-authoring">
            <div className="rbs-output-picker">
                <span className="rbs-muted">{loc.outputLabel}</span>
                <button
                    type="button"
                    className="rbs-output-trigger"
                    aria-label={loc.chooseOutputViewFor(node.label)}
                    aria-expanded={open}
                    aria-controls={candidatePanelId}
                    onClick={() => setOpen((value) => !value)}>
                    <span className="rbs-mono">{current}</span>
                    <span aria-hidden>⌄</span>
                </button>
                <span
                    className={`rbs-chip ${pinned ? "" : "rbs-chip-suggested"} ${unavailablePin ? "rbs-candidate-unavailable" : ""}`}>
                    {unavailablePin
                        ? loc.driftBadge
                        : pinned
                          ? loc.setByYouMarker
                          : loc.suggestedMarker}
                </span>
            </div>
            {open ? (
                <div
                    id={candidatePanelId}
                    className="rbs-output-candidate-panel"
                    onKeyDown={(event) => {
                        if (event.key === "Escape") {
                            setOpen(false);
                        }
                    }}>
                    <div className="rbs-output-candidate-heading">
                        <strong>{loc.chooseOutputView}</strong>
                        <span className="rbs-chip rbs-mono">{contract}</span>
                    </div>
                    <div
                        className="rbs-output-candidate-list"
                        role="radiogroup"
                        aria-label={loc.chooseOutputViewFor(node.label)}>
                        {unavailablePin ? (
                            <label className="rbs-output-candidate rbs-output-candidate-unavailable">
                                <input
                                    type="radio"
                                    name={candidatePanelId}
                                    value={unavailablePin}
                                    checked
                                    disabled
                                    readOnly
                                />
                                <span className="rbs-output-candidate-copy">
                                    <span className="rbs-output-candidate-title">
                                        <span className="rbs-mono">{unavailablePin}</span>
                                        <span className="rbs-chip rbs-candidate-unavailable">
                                            {loc.unavailableMarker}
                                        </span>
                                        <span className="rbs-muted">{loc.setByYouMarker}</span>
                                    </span>
                                    <span className="rbs-muted">
                                        {loc.pinnedViewUnavailableReason}
                                    </span>
                                </span>
                            </label>
                        ) : null}
                        {candidates.map((view) => {
                            const tier = viewCandidateTier(contract, view);
                            const tierLabel =
                                tier === "recommended"
                                    ? loc.recommendedMarker
                                    : tier === "fallback"
                                      ? loc.fallbackMarker
                                      : loc.availableMarker;
                            const reason =
                                tier === "fallback"
                                    ? loc.viewCandidateFallbackReason
                                    : contract === "rowset/1" &&
                                        (view === "bar" || view === "timeseries")
                                      ? loc.viewCandidateShapeReason
                                      : tier === "recommended"
                                        ? loc.viewCandidateRecommendedReason
                                        : loc.viewCandidateCompatibleReason;
                            return (
                                <label
                                    key={view}
                                    className={`rbs-output-candidate ${current === view ? "selected" : ""}`}>
                                    <input
                                        type="radio"
                                        name={candidatePanelId}
                                        value={view}
                                        checked={current === view}
                                        disabled={saving}
                                        onChange={() => void chooseView(view)}
                                    />
                                    <span className="rbs-output-candidate-copy">
                                        <span className="rbs-output-candidate-title">
                                            <span className="rbs-mono">{view}</span>
                                            <span className={`rbs-chip rbs-candidate-${tier}`}>
                                                {tierLabel}
                                            </span>
                                            {pinned === view ? (
                                                <span className="rbs-muted">
                                                    {loc.setByYouMarker}
                                                </span>
                                            ) : null}
                                        </span>
                                        <span className="rbs-muted">{reason}</span>
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                    <div className="rbs-output-candidate-footer">
                        {pinned ? (
                            <button
                                type="button"
                                className="rbs-link-button"
                                disabled={saving}
                                onClick={() => void chooseView(undefined)}>
                                {loc.useSuggestedView}
                            </button>
                        ) : (
                            <span className="rbs-muted">{loc.usingSuggestedView}</span>
                        )}
                        <details className="rbs-output-candidate-why">
                            <summary>{loc.whyTheseOptions}</summary>
                            <p>{loc.whyTheseOptionsDetail}</p>
                        </details>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function kindIcon(kind: RunbookPlanNode["kind"]): string {
    switch (kind) {
        case "gate":
            return "⏸";
        case "report":
            return "▤";
        default:
            return "▶";
    }
}

/** Order nodes for display: entry first, then walk the default-path edges;
 *  anything unreachable renders afterward in lock order (total display). */
export function displayOrder(
    entryNodeId: string,
    nodes: RunbookPlanNode[],
    edges: RunbookPlanEdge[],
): RunbookPlanNode[] {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const ordered: RunbookPlanNode[] = [];
    const seen = new Set<string>();
    let currentId: string | undefined = entryNodeId;
    while (currentId && byId.has(currentId) && !seen.has(currentId)) {
        seen.add(currentId);
        ordered.push(byId.get(currentId)!);
        const next =
            edges.find(
                (e) =>
                    e.from === currentId &&
                    (e.when === undefined || e.when === "success" || e.when === "approved"),
            ) ?? undefined;
        currentId = next?.to;
    }
    for (const node of nodes) {
        if (!seen.has(node.id)) {
            ordered.push(node);
        }
    }
    return ordered;
}

/** SQL renders as a code block; everything else as key → value rows. */
function StepDetails({
    node,
    enableQueryExecution,
}: {
    node: RunbookPlanNode;
    enableQueryExecution: boolean;
}) {
    const { executePlanQuery, state } = useRbs();
    const loc = locConstants.runbookStudio;
    const [openingQuery, setOpeningQuery] = useState(false);
    const inputs = Object.entries(node.inputs ?? {});
    const sql = typeof node.inputs?.sql === "string" ? node.inputs.sql : undefined;
    const canExecuteQuery =
        enableQueryExecution && sql !== undefined && node.activityKind === "sql.query.read";
    const rest = inputs.filter(([key]) => key !== "sql");
    if (!sql && rest.length === 0) {
        return null;
    }
    return (
        <div className="rbs-step-details">
            {sql ? <pre className="rbs-code rbs-mono">{sql}</pre> : null}
            {canExecuteQuery ? (
                <div className="rbs-step-query-actions">
                    <button
                        type="button"
                        className="rbs-btn"
                        disabled={openingQuery || !state?.workspaceTrusted}
                        title={!state?.workspaceTrusted ? loc.untrustedDetail : undefined}
                        onClick={async () => {
                            setOpeningQuery(true);
                            try {
                                await executePlanQuery(node.id);
                            } finally {
                                setOpeningQuery(false);
                            }
                        }}>
                        {openingQuery ? loc.openingQueryStudio : loc.executeQuery}
                    </button>
                </div>
            ) : null}
            {rest.length > 0 ? (
                <dl className="rbs-kv" aria-label={loc.stepInputs}>
                    {rest.map(([key, value]) => (
                        <div className="rbs-kv-row" key={key}>
                            <dt className="rbs-kv-key rbs-mono">{key}</dt>
                            <dd className="rbs-kv-value rbs-mono">
                                {typeof value === "string" ? value : JSON.stringify(value)}
                            </dd>
                        </div>
                    ))}
                </dl>
            ) : null}
        </div>
    );
}

function hasDetails(node: RunbookPlanNode): boolean {
    return Object.keys(node.inputs ?? {}).length > 0;
}

function blastRadiusLabel(node: RunbookPlanNode): string | undefined {
    const radius = node.blastRadius;
    if (!radius) {
        return undefined;
    }
    return `${radius.operation}:${radius.resource}@${radius.targetEnvironment}`;
}

export function PlanStepper({
    entryNodeId,
    nodes,
    edges,
    run,
    pinnedViews,
    enableQueryExecution = false,
}: {
    entryNodeId: string;
    nodes: RunbookPlanNode[];
    edges: RunbookPlanEdge[];
    run?: RunbookRunSnapshot;
    pinnedViews?: Record<string, ViewKind>;
    /** Plan-page-only action; compact Author previews remain observational. */
    enableQueryExecution?: boolean;
}) {
    const loc = locConstants.runbookStudio;
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const stateByNode = new Map<string, RunbookNodeSnapshot>(
        (run?.nodes ?? []).map((n) => [n.nodeId, n]),
    );
    const labelById = new Map(nodes.map((n) => [n.id, n.label]));
    const ordered = displayOrder(entryNodeId, nodes, edges);
    return (
        <ol className="rbs-stepper" aria-label={loc.compiledPlan}>
            {ordered.map((node, index) => {
                const snapshot = stateByNode.get(node.id);
                const branchNotes = edges
                    .filter((e) => e.from === node.id && e.when && e.when !== "success")
                    .map((e) =>
                        e.when === "failure"
                            ? loc.onFailure(labelById.get(e.to) ?? e.to)
                            : e.when === "rejected"
                              ? loc.onRejected(labelById.get(e.to) ?? e.to)
                              : `${e.when} → ${labelById.get(e.to) ?? e.to}`,
                    );
                return (
                    <li className="rbs-step" key={node.id}>
                        {index > 0 ? <div className="rbs-step-connector" aria-hidden /> : null}
                        <div
                            className={`rbs-step-card ${snapshot ? `rbs-step-${snapshot.state}` : ""}`}>
                            <div className="rbs-step-head">
                                <span aria-hidden className="rbs-step-icon">
                                    {kindIcon(node.kind)}
                                </span>
                                <span className="rbs-step-label">{node.label}</span>
                                {snapshot ? (
                                    <span className={`rbs-chip rbs-state-${snapshot.state}`}>
                                        {snapshot.state}
                                    </span>
                                ) : null}
                                {snapshot?.durationMs !== undefined ? (
                                    <span className="rbs-muted rbs-mono">
                                        {snapshot.durationMs} ms
                                    </span>
                                ) : null}
                            </div>
                            <div className="rbs-step-meta">
                                {node.activityKind ? (
                                    <span className="rbs-mono">
                                        {node.activityKind}@{node.activityVersion ?? 1}
                                    </span>
                                ) : (
                                    <span className="rbs-mono">{node.kind}</span>
                                )}
                                {blastRadiusLabel(node) ? (
                                    <span className="rbs-chip">{blastRadiusLabel(node)}</span>
                                ) : null}
                                {branchNotes.map((note) => (
                                    <span className="rbs-muted" key={note}>
                                        {note}
                                    </span>
                                ))}
                            </div>
                            {snapshot?.message ? (
                                <div className="rbs-muted rbs-step-message">{snapshot.message}</div>
                            ) : null}
                            <div className="rbs-step-output">
                                <OutputPicker node={node} pinned={pinnedViews?.[node.id]} />
                            </div>
                            {hasDetails(node) ? (
                                <>
                                    <button
                                        type="button"
                                        className="rbs-link-button"
                                        aria-expanded={expanded[node.id] === true}
                                        onClick={() =>
                                            setExpanded((current) => ({
                                                ...current,
                                                [node.id]: !current[node.id],
                                            }))
                                        }>
                                        {expanded[node.id] ? loc.hideStepDetails : loc.stepDetails}
                                    </button>
                                    {expanded[node.id] ? (
                                        <StepDetails
                                            node={node}
                                            enableQueryExecution={enableQueryExecution}
                                        />
                                    ) : null}
                                </>
                            ) : null}
                        </div>
                    </li>
                );
            })}
        </ol>
    );
}
