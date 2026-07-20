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
    OutputPresentationSummary,
    PresentationMode,
    viewCandidateTier,
    ViewKind,
} from "../../../sharedInterfaces/runbookPresentation";
import { useRbs } from "./state";

/** V2 output-slot editor: choose one or more contract-compatible renderers,
 * their runtime presentation mode, and a default. The draft stays local until
 * Save; the host validates it against the plan and a base revision. */
function OutputPicker({
    node,
    configured,
    presentationRevision,
}: {
    node: RunbookPlanNode;
    configured: OutputPresentationSummary | undefined;
    presentationRevision: number;
}) {
    const { setOutputPresentation } = useRbs();
    const loc = locConstants.runbookStudio;
    const candidatePanelId = useId();
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [selectedViews, setSelectedViews] = useState<ViewKind[]>([]);
    const [defaultView, setDefaultView] = useState<ViewKind | undefined>(undefined);
    const [presentation, setPresentation] = useState<PresentationMode>({ mode: "single" });
    const [saveError, setSaveError] = useState<"invalid" | "revisionConflict" | undefined>();
    const contract = expectedContractFor(node.kind, node.activityKind);
    if (!contract) {
        return (
            <span className="rbs-muted">
                {loc.outputLabel} — {loc.noOutput}
            </span>
        );
    }
    const candidates = compatibleViews(contract);
    const suggested = defaultViewFor(contract);
    const current = configured?.defaultView ?? suggested;
    const currentViews = configured?.views ?? [current];
    const unavailableViews = currentViews.filter((view) => !candidates.includes(view));

    const openEditor = () => {
        if (open) {
            setOpen(false);
            return;
        }
        const compatibleConfigured = currentViews.filter((view) => candidates.includes(view));
        const initial = compatibleConfigured.length > 0 ? compatibleConfigured : [suggested];
        setSelectedViews(initial);
        setDefaultView(initial.includes(current) ? current : initial[0]);
        setPresentation(
            initial.length === 1
                ? { mode: "single" }
                : configured?.presentation.mode === "single"
                  ? { mode: "split", axis: "row" }
                  : (configured?.presentation ?? { mode: "split", axis: "row" }),
        );
        setSaveError(undefined);
        setOpen(true);
    };

    const resetToSuggested = async () => {
        setSaving(true);
        setSaveError(undefined);
        try {
            const result = await setOutputPresentation(
                node.id,
                [suggested],
                { mode: "single" },
                suggested,
                presentationRevision,
                true,
            );
            if (result.applied) {
                setOpen(false);
            } else {
                setSaveError(result.reason ?? "invalid");
            }
        } catch {
            setSaveError("invalid");
        } finally {
            setSaving(false);
        }
    };

    const toggleView = (view: ViewKind) => {
        setSaveError(undefined);
        if (selectedViews.includes(view)) {
            if (selectedViews.length === 1) {
                return;
            }
            const next = selectedViews.filter((candidate) => candidate !== view);
            setSelectedViews(next);
            if (defaultView === view) {
                setDefaultView(next[0]);
            }
            if (next.length === 1) {
                setPresentation({ mode: "single" });
            }
            return;
        }
        const next = [...selectedViews, view];
        setSelectedViews(next);
        if (next.length === 2 && presentation.mode === "single") {
            setPresentation({ mode: "split", axis: "row" });
        }
    };

    const save = async () => {
        if (!defaultView || selectedViews.length === 0) {
            return;
        }
        setSaving(true);
        setSaveError(undefined);
        try {
            const result = await setOutputPresentation(
                node.id,
                selectedViews,
                presentation,
                defaultView,
                presentationRevision,
            );
            if (result.applied) {
                setOpen(false);
            } else {
                setSaveError(result.reason ?? "invalid");
            }
        } catch {
            setSaveError("invalid");
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
                    onClick={openEditor}>
                    <span className="rbs-mono">
                        {current}
                        {currentViews.length > 1 ? ` +${currentViews.length - 1}` : ""}
                    </span>
                    <span aria-hidden>⌄</span>
                </button>
                <span
                    className={`rbs-chip ${configured?.setByUser ? "" : "rbs-chip-suggested"} ${unavailableViews.length > 0 ? "rbs-candidate-unavailable" : ""}`}>
                    {unavailableViews.length > 0
                        ? loc.driftBadge
                        : configured?.setByUser
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
                        role="group"
                        aria-label={loc.chooseOutputViewFor(node.label)}>
                        {unavailableViews.map((view) => (
                            <label
                                key={view}
                                className="rbs-output-candidate rbs-output-candidate-unavailable">
                                <input type="checkbox" value={view} checked disabled readOnly />
                                <span className="rbs-output-candidate-copy">
                                    <span className="rbs-output-candidate-title">
                                        <span className="rbs-mono">{view}</span>
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
                        ))}
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
                                    className={`rbs-output-candidate ${selectedViews.includes(view) ? "selected" : ""}`}>
                                    <input
                                        type="checkbox"
                                        value={view}
                                        checked={selectedViews.includes(view)}
                                        disabled={
                                            saving ||
                                            (selectedViews.length === 1 &&
                                                selectedViews[0] === view)
                                        }
                                        onChange={() => toggleView(view)}
                                    />
                                    <span className="rbs-output-candidate-copy">
                                        <span className="rbs-output-candidate-title">
                                            <span className="rbs-mono">{view}</span>
                                            <span className={`rbs-chip rbs-candidate-${tier}`}>
                                                {tierLabel}
                                            </span>
                                            {configured?.setByUser &&
                                            currentViews.includes(view) ? (
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
                    {selectedViews.length > 1 ? (
                        <div className="rbs-output-mode-editor">
                            <span className="rbs-muted">{loc.showAsLabel}</span>
                            <div
                                className="rbs-output-mode-group"
                                role="group"
                                aria-label={loc.showAsLabel}>
                                {(
                                    [
                                        ["tabs", loc.showAsTabs],
                                        ["toggle", loc.showAsToggle],
                                        ["split", loc.showAsSideBySide],
                                    ] as const
                                ).map(([mode, label]) => (
                                    <button
                                        key={mode}
                                        type="button"
                                        className={`rbs-graph-toggle ${presentation.mode === mode ? "active" : ""}`}
                                        aria-pressed={presentation.mode === mode}
                                        disabled={saving}
                                        onClick={() =>
                                            setPresentation(
                                                mode === "split" ? { mode, axis: "row" } : { mode },
                                            )
                                        }>
                                        {label}
                                    </button>
                                ))}
                            </div>
                            <fieldset className="rbs-output-default-group">
                                <legend className="rbs-muted">{loc.defaultViewLabel}</legend>
                                {selectedViews.map((view) => (
                                    <label key={view}>
                                        <input
                                            type="radio"
                                            name={`${candidatePanelId}-default`}
                                            checked={defaultView === view}
                                            disabled={saving}
                                            onChange={() => setDefaultView(view)}
                                        />
                                        <span className="rbs-mono">{view}</span>
                                    </label>
                                ))}
                            </fieldset>
                        </div>
                    ) : null}
                    {saveError ? (
                        <div className="rbs-drift-notice" role="alert">
                            {saveError === "revisionConflict"
                                ? loc.outputPresentationRevisionConflict
                                : loc.outputPresentationSaveFailed}
                        </div>
                    ) : null}
                    <div className="rbs-output-candidate-footer">
                        <button
                            type="button"
                            className="rbs-btn"
                            disabled={saving}
                            onClick={() => void save()}>
                            {saving ? loc.savingOutputPresentation : loc.saveOutputPresentation}
                        </button>
                        {configured?.setByUser ? (
                            <button
                                type="button"
                                className="rbs-link-button"
                                disabled={saving}
                                onClick={() => void resetToSuggested()}>
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

function targetBindingLabel(node: RunbookPlanNode): string | undefined {
    const target = node.target;
    if (!target) {
        return undefined;
    }
    const binding = target.binding;
    const source =
        binding.source === "parameter"
            ? `$params.${binding.parameterId}`
            : binding.source === "nodeOutput"
              ? `$nodes.${binding.nodeId}.${binding.output}`
              : binding.workspaceFolder
                ? `workspace:${binding.workspaceFolder}`
                : "workspace";
    return `${target.kind} ← ${source}`;
}

export function PlanStepper({
    entryNodeId,
    nodes,
    edges,
    run,
    outputPresentations,
    presentationRevision = 0,
    enableQueryExecution = false,
}: {
    entryNodeId: string;
    nodes: RunbookPlanNode[];
    edges: RunbookPlanEdge[];
    run?: RunbookRunSnapshot;
    outputPresentations?: Record<string, OutputPresentationSummary>;
    presentationRevision?: number;
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
                                {targetBindingLabel(node) ? (
                                    <span className="rbs-muted">
                                        {loc.targetLabel}{" "}
                                        <span className="rbs-mono">{targetBindingLabel(node)}</span>
                                    </span>
                                ) : null}
                                {node.previewOnly ? (
                                    <span className="rbs-chip rbs-chip-warn">
                                        {loc.previewOnly}
                                    </span>
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
                                <OutputPicker
                                    node={node}
                                    configured={outputPresentations?.[node.id]}
                                    presentationRevision={presentationRevision}
                                />
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
