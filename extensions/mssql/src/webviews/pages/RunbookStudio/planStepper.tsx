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
    defaultViewFor,
    expectedContractFor,
    OutputPresentationSummary,
    outputPresentationNeedsReview,
    outputSchemaFingerprint,
    OutputViewSettings,
    PresentationMode,
    ResolvedWidget,
    ViewCandidateDescriptor,
    ViewRenderSettings,
    viewCandidates,
    ViewKind,
} from "../../../sharedInterfaces/runbookPresentation";
import { useRbs } from "./state";
import { ResolvedWidgetView } from "./widgets";

function defaultSettingsFor(view: ViewKind): ViewRenderSettings | undefined {
    switch (view) {
        case "grid":
            return { pageSize: 100, density: "comfortable" };
        case "bar":
            return { orientation: "horizontal", sort: "value-desc", maxCategories: 30 };
        case "timeseries":
            return { interpolation: "linear", yAxis: "auto" };
        case "scalar-cards":
            return { columns: 3 };
        case "log-view":
            return { wrap: false };
        default:
            return undefined;
    }
}

function settingsForSelectedViews(
    views: ViewKind[],
    settings: OutputViewSettings,
): OutputViewSettings | undefined {
    const entries = views.flatMap((view) => {
        const value = settings[view] ?? defaultSettingsFor(view);
        return value ? [[view, value] as const] : [];
    });
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function ViewSettingsEditor({
    view,
    settings,
    disabled,
    onChange,
}: {
    view: ViewKind;
    settings: ViewRenderSettings;
    disabled: boolean;
    onChange: (patch: ViewRenderSettings) => void;
}) {
    const loc = locConstants.runbookStudio;
    const select = (
        label: string,
        value: string | number,
        options: Array<[string | number, string]>,
        update: (value: string) => ViewRenderSettings,
    ) => (
        <label className="rbs-output-setting">
            <span className="rbs-muted">{label}</span>
            <select
                className="rbs-select"
                value={value}
                disabled={disabled}
                onChange={(event) => onChange(update(event.target.value))}>
                {options.map(([option, text]) => (
                    <option key={option} value={option}>
                        {text}
                    </option>
                ))}
            </select>
        </label>
    );
    let controls: React.ReactNode;
    switch (view) {
        case "grid":
            controls = (
                <>
                    {select(
                        loc.outputPageSize,
                        settings.pageSize ?? 100,
                        [25, 50, 100].map((value) => [value, String(value)]),
                        (value) => ({ pageSize: Number(value) as 25 | 50 | 100 }),
                    )}
                    {select(
                        loc.outputDensity,
                        settings.density ?? "comfortable",
                        [
                            ["comfortable", loc.outputComfortable],
                            ["compact", loc.outputCompact],
                        ],
                        (value) => ({ density: value as "compact" | "comfortable" }),
                    )}
                </>
            );
            break;
        case "bar":
            controls = (
                <>
                    {select(
                        loc.outputOrientation,
                        settings.orientation ?? "horizontal",
                        [
                            ["horizontal", loc.outputHorizontal],
                            ["vertical", loc.outputVertical],
                        ],
                        (value) => ({ orientation: value as "vertical" | "horizontal" }),
                    )}
                    {select(
                        loc.outputSort,
                        settings.sort ?? "value-desc",
                        [
                            ["value-desc", loc.outputSortValueDesc],
                            ["value-asc", loc.outputSortValueAsc],
                            ["category", loc.outputSortCategory],
                            ["none", loc.outputSortNone],
                        ],
                        (value) => ({ sort: value as ViewRenderSettings["sort"] }),
                    )}
                    {select(
                        loc.outputMaxCategories,
                        settings.maxCategories ?? 30,
                        [10, 20, 30, 50].map((value) => [value, String(value)]),
                        (value) => ({ maxCategories: Number(value) }),
                    )}
                </>
            );
            break;
        case "timeseries":
            controls = (
                <>
                    {select(
                        loc.outputInterpolation,
                        settings.interpolation ?? "linear",
                        [
                            ["linear", loc.outputLinear],
                            ["step", loc.outputStep],
                        ],
                        (value) => ({ interpolation: value as "linear" | "step" }),
                    )}
                    {select(
                        loc.outputAxisBaseline,
                        settings.yAxis ?? "auto",
                        [
                            ["auto", loc.outputAxisAuto],
                            ["zero-based", loc.outputAxisZeroBased],
                        ],
                        (value) => ({ yAxis: value as "zero-based" | "auto" }),
                    )}
                </>
            );
            break;
        case "scalar-cards":
            controls = select(
                loc.outputCardColumns,
                settings.columns ?? 3,
                [1, 2, 3, 4].map((value) => [value, String(value)]),
                (value) => ({ columns: Number(value) as 1 | 2 | 3 | 4 }),
            );
            break;
        case "log-view":
            controls = (
                <label className="rbs-output-setting rbs-output-setting-check">
                    <input
                        type="checkbox"
                        checked={settings.wrap ?? false}
                        disabled={disabled}
                        onChange={(event) => onChange({ wrap: event.target.checked })}
                    />
                    <span>{loc.outputWrapLines}</span>
                </label>
            );
            break;
        default:
            return null;
    }
    return (
        <fieldset className="rbs-output-view-settings">
            <legend>
                <span className="rbs-mono">{view}</span> {loc.outputSettings}
            </legend>
            <div className="rbs-output-settings-grid">{controls}</div>
        </fieldset>
    );
}

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
    const { setOutputPresentation, state } = useRbs();
    const loc = locConstants.runbookStudio;
    const candidatePanelId = useId();
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [selectedViews, setSelectedViews] = useState<ViewKind[]>([]);
    const [defaultView, setDefaultView] = useState<ViewKind | undefined>(undefined);
    const [presentation, setPresentation] = useState<PresentationMode>({ mode: "single" });
    const [viewSettings, setViewSettings] = useState<OutputViewSettings>({});
    const [saveError, setSaveError] = useState<"invalid" | "revisionConflict" | undefined>();
    const contract = expectedContractFor(node.kind, node.activityKind);
    if (!contract) {
        return (
            <span className="rbs-muted">
                {loc.outputLabel} — {loc.noOutput}
            </span>
        );
    }
    const outputSchema = state?.artifact?.outputSchemas?.[node.id];
    const candidates = viewCandidates(contract, outputSchema);
    const candidateByView = new Map(candidates.map((candidate) => [candidate.view, candidate]));
    const selectableViews = candidates
        .filter((candidate) => candidate.compatibility !== "incompatible")
        .map((candidate) => candidate.view);
    const suggested = defaultViewFor(contract);
    const current = configured?.defaultView ?? suggested;
    const currentViews = configured?.views ?? [current];
    const unavailableViews = currentViews.filter(
        (view) =>
            candidateByView.get(view)?.compatibility === "incompatible" ||
            !candidateByView.has(view),
    );
    const reviewRequired = outputPresentationNeedsReview(
        configured,
        outputSchemaFingerprint(contract, outputSchema),
    );

    const openEditor = () => {
        if (open) {
            setOpen(false);
            return;
        }
        const compatibleConfigured = currentViews.filter((view) => selectableViews.includes(view));
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
        setViewSettings(
            Object.fromEntries(
                initial.flatMap((view) => {
                    const settings = configured?.settings?.[view] ?? defaultSettingsFor(view);
                    return settings ? [[view, settings]] : [];
                }),
            ),
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
                undefined,
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
        const defaults = defaultSettingsFor(view);
        if (defaults) {
            setViewSettings((currentSettings) => ({
                ...currentSettings,
                [view]: currentSettings[view] ?? defaults,
            }));
        }
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
                settingsForSelectedViews(selectedViews, viewSettings),
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

    const updateViewSettings = (view: ViewKind, patch: ViewRenderSettings) => {
        setSaveError(undefined);
        setViewSettings((currentSettings) => ({
            ...currentSettings,
            [view]: {
                ...defaultSettingsFor(view),
                ...currentSettings[view],
                ...patch,
            },
        }));
    };

    const candidateReason = (candidate: ViewCandidateDescriptor): string => {
        switch (candidate.reason) {
            case "runtime-shape-required":
                return loc.viewCandidateRuntimeShapeReason;
            case "category-and-measure":
                return loc.viewCandidateBarFields(
                    candidate.bindings?.categoryField ?? "—",
                    candidate.bindings?.valueFields?.join(", ") ?? "—",
                );
            case "time-and-measure":
                return loc.viewCandidateTimeFields(
                    candidate.bindings?.timeField ?? "—",
                    candidate.bindings?.valueFields?.join(", ") ?? "—",
                );
            case "numeric-field-missing":
                return loc.viewCandidateNeedsNumericField;
            case "category-field-missing":
                return loc.viewCandidateNeedsCategoryField;
            case "temporal-field-missing":
                return loc.viewCandidateNeedsTemporalField;
            default:
                return candidate.tier === "fallback"
                    ? loc.viewCandidateFallbackReason
                    : candidate.tier === "recommended"
                      ? loc.viewCandidateRecommendedReason
                      : loc.viewCandidateCompatibleReason;
        }
    };

    const sampleWidget = state?.previewScenarios
        ?.flatMap((scenario) => scenario.presentation.sections)
        .flatMap((section) => section.widgets)
        .find((widget) => widget.nodeId === node.id && widget.state === "ready");
    const previewWidget: ResolvedWidget | undefined =
        sampleWidget && defaultView && selectedViews.length > 0
            ? {
                  ...sampleWidget,
                  id: `${sampleWidget.id}:output-authoring`,
                  title: node.label,
                  view: defaultView,
                  views: selectedViews.map((view) => ({
                      id: `${sampleWidget.id}:output-authoring:${view}`,
                      kind: view,
                      ...(viewSettings[view] ? { settings: viewSettings[view] } : {}),
                  })),
                  presentation: selectedViews.length === 1 ? { mode: "single" } : presentation,
                  defaultViewId: `${sampleWidget.id}:output-authoring:${defaultView}`,
                  activeViewId: `${sampleWidget.id}:output-authoring:${defaultView}`,
                  provenance: { by: "user" },
              }
            : undefined;

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
                    className={`rbs-chip ${configured?.setByUser ? "" : "rbs-chip-suggested"} ${unavailableViews.length > 0 ? "rbs-candidate-unavailable" : reviewRequired ? "rbs-candidate-review" : ""}`}>
                    {unavailableViews.length > 0
                        ? loc.driftBadge
                        : reviewRequired
                          ? loc.reviewRequiredMarker
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
                    {reviewRequired ? (
                        <div className="rbs-drift-notice" role="status">
                            {loc.outputFieldsChangedReview}
                        </div>
                    ) : null}
                    <div
                        className="rbs-output-candidate-list"
                        role="group"
                        aria-label={loc.chooseOutputViewFor(node.label)}>
                        {unavailableViews
                            .filter((view) => !candidateByView.has(view))
                            .map((view) => (
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
                        {candidates.map((candidate) => {
                            const view = candidate.view;
                            const tier = candidate.tier;
                            const tierLabel =
                                candidate.compatibility === "incompatible"
                                    ? loc.unavailableMarker
                                    : tier === "recommended"
                                      ? loc.recommendedMarker
                                      : tier === "fallback"
                                        ? loc.fallbackMarker
                                        : loc.availableMarker;
                            const reason = candidateReason(candidate);
                            return (
                                <label
                                    key={view}
                                    className={`rbs-output-candidate ${selectedViews.includes(view) ? "selected" : ""} ${candidate.compatibility === "incompatible" ? "rbs-output-candidate-unavailable" : ""}`}>
                                    <input
                                        type="checkbox"
                                        value={view}
                                        checked={selectedViews.includes(view)}
                                        disabled={
                                            saving ||
                                            candidate.compatibility === "incompatible" ||
                                            (selectedViews.length === 1 &&
                                                selectedViews[0] === view)
                                        }
                                        onChange={() => toggleView(view)}
                                    />
                                    <span className="rbs-output-candidate-copy">
                                        <span className="rbs-output-candidate-title">
                                            <span className="rbs-mono">{view}</span>
                                            <span
                                                className={`rbs-chip ${candidate.compatibility === "incompatible" ? "rbs-candidate-unavailable" : `rbs-candidate-${tier}`}`}>
                                                {tierLabel}
                                            </span>
                                            {candidate.compatibility === "conditional" ? (
                                                <span className="rbs-muted">
                                                    {loc.checkedAtRunTime}
                                                </span>
                                            ) : null}
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
                    <div className="rbs-output-settings-list">
                        {selectedViews.map((view) => {
                            const settings = viewSettings[view] ?? defaultSettingsFor(view);
                            return settings ? (
                                <ViewSettingsEditor
                                    key={view}
                                    view={view}
                                    settings={settings}
                                    disabled={saving}
                                    onChange={(patch) => updateViewSettings(view, patch)}
                                />
                            ) : null;
                        })}
                    </div>
                    {previewWidget ? (
                        <div className="rbs-output-inline-preview">
                            <div className="rbs-output-preview-heading">
                                <strong>{loc.outputLivePreview}</strong>
                                <span className="rbs-muted">{loc.outputLivePreviewDetail}</span>
                            </div>
                            <ResolvedWidgetView widget={previewWidget} sample />
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
