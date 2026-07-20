/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Runbook Studio document shell (A2 §5.2): compact top bar + product route
 * rail (Author | Run | Plan | Results | History). The Run page merges the
 * former Parameters page as a collapsible section; "parameters" and
 * "debug" routes alias to it (deep links stay valid). Every route renders
 * an explicit state — empty, invalid, untrusted, or populated — never a
 * blank panel (rendering-spec total-layout rule).
 */

import debounce from "lodash/debounce";
import { CSSProperties, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { locConstants } from "../../common/locConstants";
import { perfMarkAfterNextPaint } from "../../common/perfMarks";
import {
    RbsArtifactSummary,
    RbsEvidenceExportFormat,
    RbsFetchOutputPageRequest,
    RbsRoute,
    RunbookNodeSnapshot,
    RunbookParameterDefinition,
    RunbookPlanNode,
    RunbookRunSnapshot,
    RunbookRunStateKind,
} from "../../../sharedInterfaces/runbookStudio";
import {
    AggregateFunction,
    defaultViewFor,
    DerivedSourceAuthoringEdit,
    expectedContractFor,
    JsonScalar,
    PresentationLayoutEdit,
    PresentationLayoutPolicyEdit,
    PresentationPredicate,
    PresentationLayoutStrategy,
    PresentationSourceRef,
    PresentationWidgetSummary,
    ResolvedPresentation,
    ResolvedWidget,
    SortSpec,
    TransformOp,
} from "../../../sharedInterfaces/runbookPresentation";
import { PlannerConsoleTurn, PlannerFeedEntry, useRbs } from "./state";
import { displayOrder, PlanStepper } from "./planStepper";
import { PlanGraphView } from "./graphView";
import { ResolvedWidgetView } from "./widgets";
import { compareRunSnapshots, RunComparisonValue } from "./runComparison";
import { buildRunOutcomeSummary, RunEvidenceState } from "./runOutcomeSummary";
import { presentRunHistoryEntry } from "./runHistoryPresentation";
import {
    buildDerivedSource,
    mergePresentationLayoutEdits,
    PRESENTATION_SPAN_PRESETS,
    PRESENTATION_SPAN_PRESET_ORDER,
    pointerMovePresentationLayoutEdits,
    presentationLayoutSnapshot,
    presentationLayoutStrategy,
    presentationSpanPresetAt,
    presentationSpanPresetOf,
    PresentationLayoutConflict,
    rebasePresentationLayoutEdits,
    rebasePresentationLayoutPolicy,
} from "./presentationDraft";

const ROUTES: Array<{ id: RbsRoute; label: () => string; icon: string }> = [
    { id: "author", label: () => locConstants.runbookStudio.author, icon: "✎" },
    { id: "run", label: () => locConstants.runbookStudio.run, icon: "▶" },
    { id: "plan", label: () => locConstants.runbookStudio.plan, icon: "⬡" },
    { id: "preview", label: () => locConstants.runbookStudio.preview, icon: "▦" },
    { id: "results", label: () => locConstants.runbookStudio.results, icon: "▤" },
    { id: "history", label: () => locConstants.runbookStudio.history, icon: "◷" },
];

function TopBar() {
    const { state, lastError, dismissError } = useRbs();
    const loc = locConstants.runbookStudio;
    return (
        <div className="rbs-topbar">
            <span className="rbs-doc-name" title={state?.fileName}>
                {state?.artifact?.name ?? state?.fileName ?? ""}
            </span>
            {state?.artifact?.family ? (
                <span className="rbs-chip">{state.artifact.family}</span>
            ) : null}
            {state?.artifact?.readiness?.status === "designOnly" ? (
                <span className="rbs-chip rbs-chip-warn">{loc.designOnly}</span>
            ) : state?.artifact?.readiness?.status === "policyBlocked" ? (
                <span className="rbs-chip rbs-chip-warn">{loc.policyBlocked}</span>
            ) : state?.artifact?.readiness?.status === "incompatible" ? (
                <span className="rbs-chip rbs-chip-warn">{loc.incompatible}</span>
            ) : state?.artifact?.readiness?.status === "readyAfterBinding" ? (
                <span className="rbs-chip">{loc.bindingRequired}</span>
            ) : null}
            {state?.artifact?.hasLock ? (
                <span
                    className="rbs-chip rbs-chip-ok"
                    title={loc.compiledPlanRevisionTitle(state.artifact.planRevision ?? "")}>
                    {loc.compiledV(state.artifact.planRevision ?? "?")}
                </span>
            ) : state?.artifact?.readiness?.status !== "designOnly" && state?.artifact ? (
                <span className="rbs-chip rbs-chip-warn">{loc.notCompiled}</span>
            ) : null}
            {!state?.workspaceTrusted ? (
                <span className="rbs-chip rbs-chip-warn" title={loc.untrustedDetail}>
                    {loc.restrictedMode}
                </span>
            ) : null}
            <div className="rbs-spacer" />
            {lastError ? (
                <span className="rbs-error-banner" role="alert">
                    {lastError.message}
                    <button
                        className="rbs-btn rbs-btn-quiet"
                        aria-label={loc.dismiss}
                        onClick={dismissError}>
                        ✕
                    </button>
                </span>
            ) : null}
        </div>
    );
}

function NavRail() {
    const { route, navigate } = useRbs();
    // "parameters" and "debug" are aliases of the merged Run page (their
    // rail items are gone) — highlight Run for them.
    const effectiveRoute: RbsRoute = route === "parameters" || route === "debug" ? "run" : route;
    return (
        <nav className="rbs-rail" aria-label={locConstants.runbookStudio.sectionsAriaLabel}>
            {ROUTES.map((item) => (
                <button
                    key={item.id}
                    className={`rbs-rail-item ${effectiveRoute === item.id ? "active" : ""}`}
                    aria-current={effectiveRoute === item.id ? "page" : undefined}
                    onClick={() => navigate(item.id)}>
                    <span aria-hidden className="rbs-rail-icon">
                        {item.icon}
                    </span>
                    {item.label()}
                </button>
            ))}
        </nav>
    );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
    return (
        <div className="rbs-empty">
            <div className="rbs-empty-title">{title}</div>
            <div className="rbs-empty-detail">{detail}</div>
        </div>
    );
}

function InvalidArtifact() {
    const { state } = useRbs();
    return (
        <EmptyState
            title={locConstants.runbookStudio.invalidRunbookTitle}
            detail={state?.artifactError?.message ?? ""}
        />
    );
}

function CapabilityBlockers() {
    const { state } = useRbs();
    const loc = locConstants.runbookStudio;
    const missing = state?.artifact?.readiness?.missingActivityKinds ?? [];
    if (missing.length === 0) {
        return null;
    }
    return (
        <section className="rbs-capability-notice" role="status">
            <strong>{loc.designOnlyHeading}</strong>
            <div>{loc.designOnlyDetail}</div>
            <div className="rbs-author-actions">
                {missing.map((kind) => (
                    <span key={kind} className="rbs-chip rbs-chip-warn rbs-mono">
                        {kind}
                    </span>
                ))}
            </div>
        </section>
    );
}

function CompatibilityNotice() {
    const { state } = useRbs();
    const loc = locConstants.runbookStudio;
    const readiness = state?.artifact?.readiness;
    if (
        !readiness ||
        !["readyAfterBinding", "policyBlocked", "incompatible"].includes(readiness.status)
    ) {
        return null;
    }
    const copy =
        readiness.status === "readyAfterBinding"
            ? { heading: loc.bindingRequiredHeading, detail: loc.bindingRequiredDetail }
            : readiness.status === "policyBlocked"
              ? { heading: loc.policyBlockedHeading, detail: loc.policyBlockedDetail }
              : { heading: loc.incompatibleHeading, detail: loc.incompatibleDetail };
    return (
        <section className="rbs-capability-notice" role="status">
            <strong>{copy.heading}</strong>
            <div>{copy.detail}</div>
            {(readiness.issues ?? []).length > 0 ? (
                <div className="rbs-author-actions">
                    {(readiness.issues ?? []).map((issue, index) => (
                        <span
                            key={`${issue.code}-${issue.activityKind ?? index}`}
                            className="rbs-chip rbs-chip-warn rbs-mono"
                            title={issue.message}>
                            {issue.activityKind ?? issue.code}
                        </span>
                    ))}
                </div>
            ) : null}
        </section>
    );
}

function DesignPlanOutline() {
    const { state } = useRbs();
    const loc = locConstants.runbookStudio;
    const design = state?.artifact?.design;
    if (!design) {
        return null;
    }
    const missing = new Set(state?.artifact?.readiness?.missingActivityKinds ?? []);
    return (
        <section className="rbs-section rbs-design-outline" aria-labelledby="rbs-design-heading">
            <h2 id="rbs-design-heading" className="rbs-section-title">
                {loc.proposedWorkflow}
            </h2>
            <p className="rbs-muted">{loc.designOutlineDetail}</p>
            <ol className="rbs-design-steps">
                {design.steps.map((step) => {
                    const activityIdentity = `${step.activityKind}@${step.activityVersion}`;
                    const unavailable = missing.has(activityIdentity);
                    return (
                        <li className="rbs-design-step" key={step.id}>
                            <div className="rbs-design-step-heading">
                                <strong>{step.label}</strong>
                                <span
                                    className={`rbs-chip ${unavailable ? "rbs-chip-warn" : "rbs-chip-ok"}`}>
                                    {unavailable ? loc.missingCapability : loc.installedCapability}
                                </span>
                            </div>
                            <div>{step.description}</div>
                            <div className="rbs-step-meta">
                                <span className="rbs-mono">{activityIdentity}</span>
                                <span className="rbs-muted">
                                    {loc.targetLabel}{" "}
                                    <span className="rbs-mono">{step.targetKind}</span>
                                </span>
                            </div>
                        </li>
                    );
                })}
            </ol>
        </section>
    );
}

function StepsBanner({ stage }: { stage: 1 | 2 | 3 }) {
    const loc = locConstants.runbookStudio;
    const steps = [loc.stepDescribe, loc.stepGenerate, loc.stepBindRun];
    return (
        <div className="rbs-steps" aria-hidden>
            {steps.map((label, index) => (
                <span
                    key={label}
                    className={`rbs-step-pill ${index + 1 === stage ? "active" : index + 1 < stage ? "done" : ""}`}>
                    {index + 1}. {label}
                </span>
            ))}
        </div>
    );
}

/** "1m 43s" / "59s" elapsed formatting for the generation console. */
function formatElapsed(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/** Decorative glyph per planner turn kind (mirrors the standalone rail). */
function turnKindGlyph(turnKind: string | undefined): string {
    switch (turnKind) {
        case "workflow-shape":
            return "◇";
        case "gather-detail":
            return "✚";
        case "decide-detail":
            return "◈";
        case "summarize-detail":
            return "≡";
        case "recommend-detail":
            return "✦";
        case "report-outline":
            return "▤";
        default:
            return "•";
    }
}

/** One WORKFLOW STEPS row: number badge -> spinner while working -> ✓ +
 *  duration (seconds, 1 decimal) once the turn completes. */
function ConsoleStepRow({ turn }: { turn: PlannerConsoleTurn }) {
    const loc = locConstants.runbookStudio;
    return (
        <li className={`rbs-console-step ${turn.done ? "rbs-console-step-done" : ""}`}>
            <span
                aria-hidden
                className={`rbs-console-step-badge ${turn.done ? "done" : "working"}`}>
                {turn.done ? "✓" : turn.seq}
            </span>
            <div className="rbs-console-step-body">
                <div className="rbs-console-step-label">
                    <span aria-hidden className="rbs-console-step-glyph">
                        {turnKindGlyph(turn.turnKind)}
                    </span>
                    {turn.label || String(turn.seq)}
                </div>
                <div className="rbs-console-step-meta rbs-muted rbs-mono">
                    {turn.done ? (
                        turn.durationMs !== undefined ? (
                            `${(turn.durationMs / 1000).toFixed(1)}s`
                        ) : null
                    ) : (
                        <>
                            <span className="rbs-spinner rbs-spinner-sm" aria-hidden />
                            <span>{loc.consoleWorking}…</span>
                        </>
                    )}
                </div>
            </div>
        </li>
    );
}

/** One LIVE THINKING feed entry: a coalesced reasoning run, a tool-call
 *  chip, or a turn summary (slightly emphasized). */
function ConsoleFeedEntry({ entry }: { entry: PlannerFeedEntry }) {
    const event = entry.event;
    if (event.kind === "tool-call") {
        return (
            <div className="rbs-console-entry rbs-console-toolcall">
                <span className="rbs-console-tool-chip rbs-mono">
                    <span aria-hidden className="rbs-console-tool-glyph">
                        ⚒
                    </span>
                    {event.toolName ?? ""}
                </span>
                {event.text ? <span className="rbs-muted">{event.text}</span> : null}
            </div>
        );
    }
    if (event.kind === "turn-completed") {
        return <div className="rbs-console-entry rbs-console-turn-summary">{event.text}</div>;
    }
    return <div className="rbs-console-entry rbs-console-reasoning">{event.text}</div>;
}

/**
 * Generation console (mirrors the standalone planner experience): header
 * with elapsed ticker + tool-call count + latest phase, a LIVE THINKING
 * feed of coalesced reasoning / tool calls / turn summaries, and a
 * WORKFLOW STEPS rail that fills in as planner turns start and complete.
 * Stays visible after completion/failure, collapsed to a summary line,
 * until the next compile resets it.
 */
function GenerationConsole() {
    const { compiling, plannerConsole } = useRbs();
    const loc = locConstants.runbookStudio;
    const [expanded, setExpanded] = useState(false);
    const [now, setNow] = useState(() => Date.now());
    const feedRef = useRef<HTMLDivElement | null>(null);
    const atBottomRef = useRef(true);

    // 1s elapsed ticker while compiling only.
    useEffect(() => {
        if (!compiling) {
            return;
        }
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [compiling]);

    // Autoscroll the feed — only when the user is already at the bottom
    // (scrolling up pins the view; returning to the bottom re-arms it).
    useEffect(() => {
        const el = feedRef.current;
        if (el && atBottomRef.current) {
            el.scrollTop = el.scrollHeight;
        }
    }, [plannerConsole.feed.length, compiling, expanded]);

    if (plannerConsole.startedAt === undefined) {
        return null;
    }
    const endMs = compiling ? now : (plannerConsole.endedAt ?? now);
    const elapsed = formatElapsed(endMs - plannerConsole.startedAt);
    const open = compiling || expanded;
    const succeeded = plannerConsole.outcome === "ok";

    if (!open) {
        return (
            <button
                className="rbs-console-summary-line"
                aria-expanded={false}
                onClick={() => setExpanded(true)}>
                <span
                    aria-hidden
                    className={succeeded ? "rbs-console-mark-ok" : "rbs-console-mark-fail"}>
                    {succeeded ? "✓" : "✕"}
                </span>
                <span>{succeeded ? loc.planGeneratedIn(elapsed) : loc.planGenerationFailed}</span>
                <span className="rbs-muted">· {loc.toolCallCount(plannerConsole.toolCalls)}</span>
                <span aria-hidden className="rbs-muted rbs-console-chevron">
                    ▸
                </span>
            </button>
        );
    }

    const inputNames = (plannerConsole.inputs ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name.length > 0);

    const onFeedScroll = () => {
        const el = feedRef.current;
        if (el) {
            atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
        }
    };

    return (
        <section className="rbs-console" aria-label={loc.generationConsoleAria}>
            <div className="rbs-console-header">
                {compiling ? <span aria-hidden className="rbs-console-live-dot" /> : null}
                <span className="rbs-mono">{elapsed}</span>
                <span aria-hidden className="rbs-muted">
                    ·
                </span>
                <span className="rbs-muted">{loc.toolCallCount(plannerConsole.toolCalls)}</span>
                {plannerConsole.phase ? (
                    <>
                        <span aria-hidden className="rbs-muted">
                            ·
                        </span>
                        <span className="rbs-muted" role="status">
                            {plannerConsole.phase}
                        </span>
                    </>
                ) : null}
                {plannerConsole.model ? (
                    <span className="rbs-chip rbs-mono" title={plannerConsole.model.providerLabel}>
                        {loc.modelChip(plannerConsole.model.id)}
                    </span>
                ) : null}
                <div className="rbs-spacer" />
                {!compiling ? (
                    <button
                        className="rbs-btn rbs-btn-quiet"
                        aria-expanded={true}
                        onClick={() => setExpanded(false)}>
                        ▾
                    </button>
                ) : null}
            </div>
            {inputNames.length > 0 ? (
                <div className="rbs-console-inputs">
                    <span className="rbs-muted">{loc.inputsChipLabel}</span>
                    {inputNames.map((name) => (
                        <span key={name} className="rbs-chip rbs-mono">
                            {name}
                        </span>
                    ))}
                </div>
            ) : null}
            <div className="rbs-console-grid">
                <div className="rbs-console-pane">
                    <div className="rbs-console-pane-title">{loc.liveThinking}</div>
                    <div
                        className="rbs-console-feed"
                        ref={feedRef}
                        onScroll={onFeedScroll}
                        role="log"
                        aria-label={loc.liveThinking}>
                        {plannerConsole.feed.map((entry) => (
                            <ConsoleFeedEntry key={entry.id} entry={entry} />
                        ))}
                    </div>
                </div>
                <div className="rbs-console-pane">
                    <div className="rbs-console-pane-title">{loc.workflowSteps}</div>
                    <ol className="rbs-console-steps">
                        {plannerConsole.turns.map((turn) => (
                            <ConsoleStepRow key={turn.seq} turn={turn} />
                        ))}
                    </ol>
                </div>
            </div>
        </section>
    );
}

function AuthorPage() {
    const { state, compile, cancelCompile, compiling, navigate, updateIntent } = useRbs();
    const loc = locConstants.runbookStudio;
    const [intentDraft, setIntentDraft] = useState<string | undefined>(undefined);
    // Cancel disables itself once clicked; re-arms for the next compile.
    const [cancelPending, setCancelPending] = useState(false);
    useEffect(() => {
        if (!compiling) {
            setCancelPending(false);
        }
    }, [compiling]);
    // Persist the typed intent into the library-backed DOCUMENT as the user
    // pauses. Flush on blur/route change so a draft does not live only in
    // webview memory when the panel is closed.
    const persistIntent = useMemo(
        () =>
            debounce((intent: string) => {
                void updateIntent(intent);
            }, 750),
        [updateIntent],
    );
    useEffect(() => {
        return () => {
            persistIntent.flush();
            persistIntent.cancel();
        };
    }, [persistIntent]);
    if (state?.artifactError) {
        return <InvalidArtifact />;
    }
    if (!state?.artifact) {
        return <EmptyState title={loc.loading} detail="" />;
    }
    const artifact = state.artifact;
    const intent = intentDraft ?? artifact.intent;
    const stage: 1 | 2 | 3 = artifact.hasLock ? 3 : intent.trim() ? 2 : 1;
    const examples: Array<{ label: string; intent: string }> = [
        { label: loc.exampleRowCount, intent: loc.exampleRowCountIntent },
        { label: loc.exampleOrphans, intent: loc.exampleOrphansIntent },
        { label: loc.exampleFreshness, intent: loc.exampleFreshnessIntent },
    ];
    const onGenerate = async () => {
        const nextIntent = intent.trim();
        persistIntent.cancel();
        if (nextIntent !== artifact.intent && !(await updateIntent(nextIntent))) {
            return;
        }
        const compiled = await compile(nextIntent);
        if (compiled) {
            setIntentDraft(undefined);
        }
    };
    return (
        <div className="rbs-page-body">
            <StepsBanner stage={stage} />
            <section className="rbs-section">
                <h2 className="rbs-section-title">{loc.describeHeading}</h2>
                <textarea
                    className="rbs-input rbs-intent-input"
                    aria-label={loc.describeHeading}
                    placeholder={loc.describePlaceholder}
                    value={intent}
                    rows={4}
                    onChange={(e) => {
                        const next = e.target.value;
                        setIntentDraft(next);
                        persistIntent(next);
                    }}
                    onBlur={() => persistIntent.flush()}
                    disabled={compiling}
                />
                <div className="rbs-capability-notice" role="note">
                    <strong>{loc.currentCapabilitiesLabel}</strong> {loc.currentCapabilitiesDetail}
                </div>
                <CapabilityBlockers />
                <CompatibilityNotice />
                {!intent.trim() ? (
                    <div className="rbs-examples">
                        <span className="rbs-muted">{loc.tryExample}</span>
                        {examples.map((example) => (
                            <button
                                key={example.label}
                                className="rbs-btn"
                                onClick={() => setIntentDraft(example.intent)}>
                                {example.label}
                            </button>
                        ))}
                    </div>
                ) : null}
                <div className="rbs-author-actions">
                    <button
                        className="rbs-btn rbs-btn-primary"
                        disabled={compiling || !intent.trim() || !state.workspaceTrusted}
                        title={!state.workspaceTrusted ? loc.untrustedDetail : undefined}
                        onClick={() => void onGenerate()}>
                        {compiling
                            ? loc.generating
                            : artifact.hasLock
                              ? loc.regeneratePlan
                              : loc.generatePlan}
                    </button>
                    {compiling ? (
                        <button
                            className="rbs-btn"
                            disabled={cancelPending}
                            onClick={() => {
                                setCancelPending(true);
                                void cancelCompile();
                            }}>
                            {loc.cancelGeneration}
                        </button>
                    ) : null}
                </div>
                <GenerationConsole />
            </section>
            {!artifact.hasLock ? <DesignPlanOutline /> : null}
            {artifact.hasLock ? (
                <section className="rbs-section">
                    <h2 className="rbs-section-title">{loc.compiledPlan}</h2>
                    <PlanStepper
                        entryNodeId={artifact.entryNodeId ?? artifact.nodes[0]?.id ?? ""}
                        nodes={artifact.nodes}
                        edges={artifact.edges}
                    />
                    <div className="rbs-author-actions">
                        <span className="rbs-muted">{loc.planReady}</span>
                        <button
                            className="rbs-btn rbs-btn-primary"
                            onClick={() => navigate("parameters")}>
                            {loc.continueToParameters} →
                        </button>
                    </div>
                </section>
            ) : null}
        </div>
    );
}

function defaultDisplay(parameter: RunbookParameterDefinition): string {
    if (parameter.type === "secret") {
        return locConstants.runbookStudio.rebindAtRunTime;
    }
    return parameter.default === undefined ? "—" : String(parameter.default);
}

function ParameterValueEditor({
    parameter,
    value,
    onChange,
}: {
    parameter: RunbookParameterDefinition;
    value: string;
    onChange: (next: string) => void;
}) {
    const { connections } = useRbs();
    const loc = locConstants.runbookStudio;
    if (parameter.type === "connection") {
        if (connections.length === 0) {
            return <span className="rbs-muted">{loc.noSavedConnections}</span>;
        }
        return (
            <select
                className="rbs-input"
                aria-label={parameter.label}
                value={value}
                onChange={(e) => onChange(e.target.value)}>
                <option value="">{loc.selectConnection}</option>
                {connections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                        {connection.label}
                    </option>
                ))}
            </select>
        );
    }
    if (parameter.type === "boolean") {
        return (
            <input
                type="checkbox"
                aria-label={parameter.label}
                checked={value === "true"}
                onChange={(e) => onChange(e.target.checked ? "true" : "false")}
            />
        );
    }
    if (parameter.type === "enum") {
        return (
            <select
                className="rbs-input"
                aria-label={parameter.label}
                value={value}
                onChange={(e) => onChange(e.target.value)}>
                <option value="" />
                {(parameter.enumValues ?? []).map((enumValue) => (
                    <option key={enumValue} value={enumValue}>
                        {enumValue}
                    </option>
                ))}
            </select>
        );
    }
    return (
        <input
            className="rbs-input"
            aria-label={parameter.label}
            type={parameter.type === "secret" ? "password" : "text"}
            placeholder={defaultDisplay(parameter)}
            value={value}
            onChange={(e) => onChange(e.target.value)}
        />
    );
}

/** Parameter bind form (connection dropdown + parameter inputs + Run
 *  button) — the body of the merged Run page's collapsible Parameters
 *  section. */
function ParametersSection({ starting, onRun }: { starting: boolean; onRun: () => Promise<void> }) {
    const { state, parameterDraft, setParameterDraft } = useRbs();
    const loc = locConstants.runbookStudio;
    // Draft lives in the provider so navigating away (or starting a run)
    // never wipes what the user configured.
    const values = parameterDraft;
    const parameters = state?.artifact?.parameters ?? [];
    const runActive =
        state?.run !== undefined && !["succeeded", "failed", "cancelled"].includes(state.run.state);
    const canRun =
        (state?.workspaceTrusted ?? false) &&
        (state?.artifact?.hasLock ?? false) &&
        !["designOnly", "policyBlocked", "incompatible"].includes(
            state?.artifact?.readiness?.status ?? "ready",
        ) &&
        !runActive;
    return (
        <>
            {parameters.length === 0 ? (
                <p className="rbs-muted">{loc.noParametersDetail}</p>
            ) : (
                <table className="rbs-table">
                    <thead>
                        <tr>
                            <th>{loc.parameter}</th>
                            <th>{loc.type}</th>
                            <th>{loc.required}</th>
                            <th>{loc.value}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {parameters.map((parameter) => (
                            <tr key={parameter.id}>
                                <td>
                                    <div>{parameter.label}</div>
                                    {parameter.description ? (
                                        <div className="rbs-muted">{parameter.description}</div>
                                    ) : null}
                                </td>
                                <td className="rbs-mono">{parameter.type}</td>
                                <td>{parameter.required ? loc.yes : loc.no}</td>
                                <td>
                                    <ParameterValueEditor
                                        parameter={parameter}
                                        value={values[parameter.id] ?? ""}
                                        onChange={(next) => setParameterDraft(parameter.id, next)}
                                    />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            <div>
                <button
                    className="rbs-btn rbs-btn-primary"
                    disabled={!canRun || starting}
                    title={
                        !state?.workspaceTrusted
                            ? loc.untrustedDetail
                            : state?.artifact?.readiness?.status === "designOnly"
                              ? loc.designOnlyDetail
                              : state?.artifact?.readiness?.status === "policyBlocked"
                                ? loc.policyBlockedDetail
                                : state?.artifact?.readiness?.status === "incompatible"
                                  ? loc.incompatibleDetail
                                  : !state?.artifact?.hasLock
                                    ? loc.notCompiledDetail
                                    : undefined
                    }
                    onClick={() => void onRun()}>
                    {runActive ? loc.runActiveLabel : loc.runButton}
                </button>
            </div>
        </>
    );
}

/** Collapsible page section: chevron + title header (rbs-event-log-style
 *  affordance) with optional header extras that stay visible while the
 *  body is collapsed. Controlled — the merged Run page auto-collapses
 *  Parameters when a run starts. */
function CollapsibleSection({
    title,
    expanded,
    onToggle,
    headerExtras,
    children,
}: {
    title: string;
    expanded: boolean;
    onToggle: () => void;
    headerExtras?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <section className={`rbs-collapse ${expanded ? "rbs-collapse-open" : ""}`}>
            <div className="rbs-collapse-header">
                <button
                    type="button"
                    className="rbs-collapse-toggle"
                    aria-expanded={expanded}
                    onClick={onToggle}>
                    <span aria-hidden className="rbs-collapse-chevron">
                        {expanded ? "▾" : "▸"}
                    </span>
                    <span className="rbs-collapse-title">{title}</span>
                </button>
                {headerExtras}
            </div>
            {expanded ? <div className="rbs-collapse-body">{children}</div> : null}
        </section>
    );
}

/**
 * Merged Run page: a collapsible Parameters section (the bind form) on top
 * — auto-collapsed once a run starts, expandable any time — and a
 * collapsible Run status section (state chips + cancel/diagnostics in its
 * header; gate banner, tiles, timeline, event log in its body) that
 * appears once a run exists. Routes "parameters" and "debug" alias here.
 */
function RunPage() {
    const {
        state,
        route,
        navigate,
        startRun,
        parameterDraft,
        openDiagnostics,
        cancelRun,
        respondToGate,
    } = useRbs();
    const loc = locConstants.runbookStudio;
    const run = state?.run;
    const [paramsExpanded, setParamsExpanded] = useState(true);
    const [statusExpanded, setStatusExpanded] = useState(true);
    const [starting, setStarting] = useState(false);
    const lastRunIdRef = useRef<string | undefined>(undefined);
    const routeRef = useRef(route);
    routeRef.current = route;

    // Auto-collapse Parameters when a run starts (a new runId appears; a
    // restored run arriving in a fresh webview counts too) — unless a
    // "parameters" deep link is active, which explicitly asks for the form.
    useEffect(() => {
        const runId = run?.runId;
        if (runId !== undefined && runId !== lastRunIdRef.current) {
            lastRunIdRef.current = runId;
            if (routeRef.current !== "parameters") {
                setParamsExpanded(false);
            }
        }
    }, [run?.runId]);

    // "parameters" deep links land on the merged page with the form open.
    useEffect(() => {
        if (route === "parameters") {
            setParamsExpanded(true);
        }
    }, [route]);

    if (state?.artifactError) {
        return <InvalidArtifact />;
    }
    const runActive =
        run !== undefined && !["succeeded", "failed", "cancelled"].includes(run.state);
    const completed =
        run?.nodes.filter((n) => ["succeeded", "failed", "skipped", "cancelled"].includes(n.state))
            .length ?? 0;
    const runWithCurrentParameters = async () => {
        setStarting(true);
        try {
            const parameterValues: Record<string, string | number | boolean | null> = {};
            for (const parameter of state?.artifact?.parameters ?? []) {
                const raw = parameterDraft[parameter.id];
                if (raw === undefined || raw === "") {
                    continue;
                }
                parameterValues[parameter.id] = parameter.type === "boolean" ? raw === "true" : raw;
            }
            await startRun(parameterValues);
        } finally {
            setStarting(false);
        }
    };
    return (
        <div className="rbs-page-body">
            <CompatibilityNotice />
            <CollapsibleSection
                title={loc.parameters}
                expanded={paramsExpanded}
                onToggle={() => setParamsExpanded((current) => !current)}>
                <ParametersSection starting={starting} onRun={runWithCurrentParameters} />
            </CollapsibleSection>
            {run ? (
                <CollapsibleSection
                    title={loc.runStatus}
                    expanded={statusExpanded}
                    onToggle={() => setStatusExpanded((current) => !current)}
                    headerExtras={
                        <>
                            <span className={`rbs-chip rbs-state-${run.state}`}>{run.state}</span>
                            {run.verdict ? (
                                <span className={`rbs-chip rbs-verdict-${run.verdict}`}>
                                    {run.verdict}
                                </span>
                            ) : null}
                            <span className="rbs-muted">
                                {loc.stepsComplete(completed, run.nodes.length)}
                            </span>
                            <div className="rbs-spacer" />
                            {runActive ? (
                                <button
                                    className="rbs-btn"
                                    onClick={() => void cancelRun(run.runId)}>
                                    {loc.cancelRun}
                                </button>
                            ) : (
                                <>
                                    <button
                                        className="rbs-btn rbs-btn-primary"
                                        disabled={starting}
                                        onClick={() => void runWithCurrentParameters()}>
                                        {loc.rerun}
                                    </button>
                                    <button className="rbs-btn" onClick={() => navigate("results")}>
                                        {loc.viewResults}
                                    </button>
                                </>
                            )}
                            <button className="rbs-btn" onClick={() => openDiagnostics(run.runId)}>
                                {loc.openDiagnostics}
                            </button>
                        </>
                    }>
                    {run.pendingGate ? (
                        <div className="rbs-gate-banner" role="alert">
                            <span className="rbs-gate-title">⏸ {loc.approvalRequired}</span>
                            <span>{run.pendingGate.impactSummary}</span>
                            <button
                                className="rbs-btn rbs-btn-primary"
                                onClick={() =>
                                    void respondToGate(run.runId, run.pendingGate!.nodeId, true)
                                }>
                                {loc.approve}
                            </button>
                            <button
                                className="rbs-btn"
                                onClick={() =>
                                    void respondToGate(run.runId, run.pendingGate!.nodeId, false)
                                }>
                                {loc.reject}
                            </button>
                        </div>
                    ) : null}
                    <RunMetricTiles run={run} />
                    <RunTimeline run={run} artifact={state?.artifact} />
                    <RunEventLog />
                </CollapsibleSection>
            ) : (
                <p className="rbs-muted">
                    {state?.workspaceTrusted ? loc.noRunDetail : loc.untrustedDetail}
                </p>
            )}
        </div>
    );
}

/** Mockup metric-tile strip: honest aggregates from the run snapshot only
 *  (handle metadata — no payload pulls). Blank dash until data exists. */
function RunMetricTiles({ run }: { run: RunbookRunSnapshot }) {
    const loc = locConstants.runbookStudio;
    const runActive = !["succeeded", "failed", "cancelled"].includes(run.state);
    // Smooth the Elapsed tile: state pushes arrive irregularly, so tick a
    // local 1s re-render while the run is active; the interval stops at a
    // terminal state and elapsed freezes on its final value.
    const [, setElapsedTick] = useState(0);
    useEffect(() => {
        if (!runActive) {
            return;
        }
        const timer = setInterval(() => setElapsedTick((tick) => tick + 1), 1000);
        return () => clearInterval(timer);
    }, [runActive]);
    const completed = run.nodes.filter((n) =>
        ["succeeded", "failed", "skipped", "cancelled"].includes(n.state),
    ).length;
    const rows = run.nodes
        .flatMap((n) => n.outputs ?? [])
        .filter((o) => o.contract === "rowset/1" && o.rows !== undefined)
        .reduce((sum, o) => sum + (o.rows ?? 0), 0);
    const failures = run.nodes.filter((n) => n.state === "failed").length;
    const elapsedMs =
        run.startedEpochMs !== undefined
            ? (run.endedEpochMs ?? Date.now()) - run.startedEpochMs
            : undefined;
    const tiles: Array<{ label: string; value: string; warn?: boolean }> = [
        { label: loc.tileSteps, value: `${completed}/${run.nodes.length}` },
        { label: loc.tileRows, value: rows > 0 ? rows.toLocaleString() : "—" },
        {
            label: loc.tileFailures,
            value: failures > 0 ? String(failures) : "—",
            warn: failures > 0,
        },
        {
            label: loc.tileElapsed,
            value:
                elapsedMs !== undefined
                    ? elapsedMs < 10_000
                        ? `${(elapsedMs / 1000).toFixed(1)}s`
                        : `${Math.round(elapsedMs / 1000)}s`
                    : "—",
        },
    ];
    return (
        <div className="rbs-cards" role="group" aria-label={loc.statusTimeline}>
            {tiles.map((tile) => (
                <div className="rbs-card" key={tile.label}>
                    <div className="rbs-card-label">{tile.label}</div>
                    <div
                        className="rbs-card-value"
                        style={tile.warn ? { color: "var(--vscode-errorForeground)" } : undefined}>
                        {tile.value}
                    </div>
                </div>
            ))}
        </div>
    );
}

function timelineIcon(state: string): string {
    switch (state) {
        case "succeeded":
            return "✓";
        case "failed":
            return "✕";
        case "running":
            return "⟳";
        case "cancelled":
        case "skipped":
            return "⊘";
        case "awaitingApproval":
            return "⏸";
        default:
            return "○";
    }
}

/** Mockup chip: gates say approval; activities say read-only vs mutating
 *  from the CATALOG-stamped blast radius (never model-claimed). */
function stepImpactChip(node: RunbookPlanNode | undefined): string | undefined {
    const loc = locConstants.runbookStudio;
    if (!node) {
        return undefined;
    }
    if (node.kind === "gate") {
        return loc.approvalChip;
    }
    if (node.previewOnly) {
        return loc.previewOnly;
    }
    if (!node.blastRadius) {
        return undefined;
    }
    return node.blastRadius.operation === "read" ? loc.readOnlyChip : loc.mutatingChip;
}

/** Minimal duplicate of the Plan page's StepDetails (planStepper.tsx does
 *  not export it): the SAME authored data the Plan page shows — SQL inputs
 *  as a code block, every other input as key → value rows. */
function TimelineStepDetails({ node }: { node: RunbookPlanNode }) {
    const loc = locConstants.runbookStudio;
    const inputs = Object.entries(node.inputs ?? {});
    const sql = typeof node.inputs?.sql === "string" ? node.inputs.sql : undefined;
    const rest = inputs.filter(([key]) => key !== "sql");
    if (!sql && rest.length === 0) {
        return null;
    }
    return (
        <div className="rbs-step-details">
            {sql ? (
                <div>
                    <div className="rbs-query-detail-label">{loc.authoredSql}</div>
                    <pre className="rbs-code rbs-mono">{sql}</pre>
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

function TimelineExecutedQuery({ snapshot }: { snapshot: RunbookNodeSnapshot | undefined }) {
    const { rpc } = useRbs();
    const loc = locConstants.runbookStudio;
    const handle = snapshot?.executedQuery;
    const handleId = handle?.handleId;
    const expired = handle?.expired === true;
    const retainedTruncated = handle?.truncated === true;
    const [detail, setDetail] = useState<
        | { state: "loading" }
        | { state: "ready"; query: string; truncated: boolean }
        | { state: "unavailable" }
        | undefined
    >(undefined);

    useEffect(() => {
        let cancelled = false;
        setDetail(handleId ? { state: "loading" } : undefined);
        if (!handleId || expired) {
            if (expired) {
                setDetail({ state: "unavailable" });
            }
            return;
        }
        void rpc
            .sendRequest(RbsFetchOutputPageRequest.type, {
                handleId,
                startRow: 0,
                rowCount: 1,
            })
            .then((page) => {
                if (cancelled) {
                    return;
                }
                const query = page.rows?.[0]?.[0];
                setDetail(
                    !page.error && typeof query === "string"
                        ? {
                              state: "ready",
                              query,
                              truncated: retainedTruncated || page.truncated === true,
                          }
                        : { state: "unavailable" },
                );
            })
            .catch(() => {
                if (!cancelled) {
                    setDetail({ state: "unavailable" });
                }
            });
        return () => {
            cancelled = true;
        };
    }, [expired, handleId, retainedTruncated, rpc]);

    if (!handle || !detail) {
        return null;
    }
    return (
        <div className="rbs-executed-query">
            <div className="rbs-query-detail-label">{loc.runtimeExecutedSql}</div>
            {detail.state === "loading" ? (
                <div className="rbs-muted">{loc.loading}</div>
            ) : detail.state === "unavailable" ? (
                <div className="rbs-muted">{loc.executedSqlUnavailable}</div>
            ) : (
                <>
                    <pre className="rbs-code rbs-mono">{detail.query}</pre>
                    {detail.truncated ? (
                        <div className="rbs-muted">{loc.executedSqlTruncated}</div>
                    ) : null}
                </>
            )}
        </div>
    );
}

/** Live "Working — Ns elapsed" line for an expanded RUNNING step. Mounted
 *  only while the step is expanded AND running, so the 1s ticker exists
 *  exactly then and never outside that window. */
function TimelineRunningLine({ sinceMs }: { sinceMs: number | undefined }) {
    const loc = locConstants.runbookStudio;
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);
    const seconds = sinceMs !== undefined ? Math.max(0, Math.floor((now - sinceMs) / 1000)) : 0;
    return (
        <div className="rbs-tl-working" role="status">
            <span className="rbs-spinner rbs-spinner-sm" aria-hidden />
            <span>{loc.workingElapsed(seconds)}</span>
        </div>
    );
}

/** Expanded timeline step panel: the authored step detail, a live elapsed
 *  line while the step runs, and the resolved result widgets that have
 *  streamed in for this node so far (completed steps show their tables and
 *  charts inline; running steps show whatever has arrived). */
function TimelineStepPanel({
    nodeId,
    plan,
    snapshot,
    runningSinceMs,
}: {
    nodeId: string;
    plan: RunbookPlanNode | undefined;
    snapshot: RunbookNodeSnapshot | undefined;
    runningSinceMs: number | undefined;
}) {
    const { state } = useRbs();
    const loc = locConstants.runbookStudio;
    const widgets = (state?.presentation?.sections ?? [])
        .flatMap((section) => section.widgets)
        .filter((widget) => widget.nodeId === nodeId);
    return (
        <div className="rbs-tl-panel">
            {plan ? <TimelineStepDetails node={plan} /> : null}
            <TimelineExecutedQuery snapshot={snapshot} />
            {snapshot?.state === "running" ? (
                <TimelineRunningLine sinceMs={runningSinceMs} />
            ) : null}
            {widgets.length > 0 ? (
                widgets.map((widget) => <ResolvedWidgetView key={widget.id} widget={widget} />)
            ) : (
                <div className="rbs-muted">{loc.widgetPending}</div>
            )}
        </div>
    );
}

/** The mockup's "status timeline — what happened": plan-ordered step rows
 *  with state icon, impact chip, outcome one-liner, and duration. Every row
 *  expands (chevron affordance) to the authored step detail, live progress
 *  while running, and the results streamed in so far. */
function RunTimeline({
    run,
    artifact,
}: {
    run: RunbookRunSnapshot;
    artifact: RbsArtifactSummary | undefined;
}) {
    const loc = locConstants.runbookStudio;
    const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});
    // The run snapshot carries no reliable node start epoch, so track when
    // each node is FIRST SEEN running client-side; the entry drops once the
    // node leaves that state (terminal states show durationMs instead).
    // Synced during render — idempotent set-if-absent — so the very render
    // that observes the running transition already has the epoch to hand
    // even if no further snapshot pushes arrive while the node runs.
    const runningSinceRef = useRef<Map<string, number>>(new Map());
    const runningSince = runningSinceRef.current;
    const runningNow = new Set(run.nodes.filter((n) => n.state === "running").map((n) => n.nodeId));
    for (const id of runningNow) {
        if (!runningSince.has(id)) {
            runningSince.set(id, Date.now());
        }
    }
    for (const id of Array.from(runningSince.keys())) {
        if (!runningNow.has(id)) {
            runningSince.delete(id);
        }
    }
    const planNodes = new Map((artifact?.nodes ?? []).map((n) => [n.id, n]));
    const ordered =
        artifact && artifact.nodes.length > 0
            ? displayOrder(
                  artifact.entryNodeId ?? artifact.nodes[0].id,
                  artifact.nodes,
                  artifact.edges,
              ).map((n) => n.id)
            : run.nodes.map((n) => n.nodeId);
    const snapshots = new Map(run.nodes.map((n) => [n.nodeId, n]));
    // The runtime executes independent steps in PARALLEL waves, so a later-
    // listed step can run while earlier-listed ones wait on dependencies —
    // which reads as "skipped" (owner report). Name what each pending step
    // is actually waiting for.
    const waitingOn = (nodeId: string): string | undefined => {
        const pending = (artifact?.edges ?? [])
            .filter((e) => e.to === nodeId)
            .map((e) => e.from)
            .filter((from) => {
                const s = snapshots.get(from)?.state;
                return s !== "succeeded" && s !== "skipped";
            })
            .map((from) => planNodes.get(from)?.label ?? from);
        return pending.length > 0 ? loc.waitingOn(pending.join(", ")) : undefined;
    };
    return (
        <section aria-label={loc.statusTimeline}>
            <div className="rbs-timeline-title">{loc.statusTimeline}</div>
            <ol className="rbs-timeline">
                {ordered.map((nodeId) => {
                    const snapshot = snapshots.get(nodeId);
                    const plan = planNodes.get(nodeId);
                    const nodeState = snapshot?.state ?? "pending";
                    const chip = stepImpactChip(plan);
                    const isExpanded = expandedSteps[nodeId] === true;
                    return (
                        <li className={`rbs-timeline-row rbs-tl-${nodeState}`} key={nodeId}>
                            <span aria-hidden className={`rbs-tl-icon rbs-tl-icon-${nodeState}`}>
                                {timelineIcon(nodeState)}
                            </span>
                            <div className="rbs-tl-body">
                                <button
                                    type="button"
                                    className="rbs-tl-head rbs-tl-toggle"
                                    aria-expanded={isExpanded}
                                    onClick={() =>
                                        setExpandedSteps((current) => ({
                                            ...current,
                                            [nodeId]: !current[nodeId],
                                        }))
                                    }>
                                    <span aria-hidden className="rbs-tl-chevron">
                                        {isExpanded ? "▾" : "▸"}
                                    </span>
                                    <span className="rbs-tl-label">{plan?.label ?? nodeId}</span>
                                    {chip ? <span className="rbs-chip">{chip}</span> : null}
                                    <span className="rbs-tl-duration rbs-mono">
                                        {snapshot?.durationMs !== undefined
                                            ? `${snapshot.durationMs} ms`
                                            : nodeState === "pending"
                                              ? ""
                                              : "—"}
                                    </span>
                                </button>
                                <div
                                    className={
                                        nodeState === "failed" && snapshot?.message
                                            ? "rbs-tl-error"
                                            : "rbs-muted"
                                    }>
                                    {snapshot?.message ??
                                        (nodeState === "pending"
                                            ? (waitingOn(nodeId) ?? loc.queuedLabel)
                                            : nodeState)}
                                </div>
                                {isExpanded ? (
                                    <TimelineStepPanel
                                        nodeId={nodeId}
                                        plan={plan}
                                        snapshot={snapshot}
                                        runningSinceMs={
                                            snapshot?.startedEpochMs ?? runningSince.get(nodeId)
                                        }
                                    />
                                ) : null}
                            </div>
                        </li>
                    );
                })}
            </ol>
        </section>
    );
}

/** Raw boundary-event log (collapsed by default) — the "what did the
 *  runtime actually say" view for debugging a run in progress. */
function RunEventLog() {
    const { runEvents } = useRbs();
    const loc = locConstants.runbookStudio;
    if (runEvents.length === 0) {
        return null;
    }
    return (
        <details className="rbs-event-log">
            <summary>
                {loc.eventLog} ({runEvents.length})
            </summary>
            <div className="rbs-widget-scroll">
                <table className="rbs-table">
                    <tbody>
                        {runEvents.map((event) => (
                            <tr key={event.seq}>
                                <td className="rbs-mono rbs-muted">{event.seq}</td>
                                <td className="rbs-mono rbs-muted">
                                    {new Date(event.epochMs).toLocaleTimeString()}
                                </td>
                                <td className="rbs-mono">{event.type}</td>
                                <td className="rbs-mono">{event.nodeId ?? ""}</td>
                                <td>{event.nodeState ?? event.runState ?? event.outcome ?? ""}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </details>
    );
}

function PlanPage() {
    const { state } = useRbs();
    const loc = locConstants.runbookStudio;
    const [planView, setPlanView] = useState<"stepper" | "graph">("stepper");
    if (state?.artifactError) {
        return <InvalidArtifact />;
    }
    const artifact = state?.artifact;
    if (!artifact?.hasLock) {
        if (artifact?.design) {
            return (
                <div className="rbs-page-body">
                    {artifact.readiness?.status === "designOnly" ? (
                        <CapabilityBlockers />
                    ) : (
                        <CompatibilityNotice />
                    )}
                    <DesignPlanOutline />
                </div>
            );
        }
        return <EmptyState title={loc.noCompiledPlanTitle} detail={loc.notCompiledDetail} />;
    }
    return (
        <div className="rbs-page-body">
            <CompatibilityNotice />
            <div className="rbs-graph-toggle-group" role="group" aria-label={loc.planViewLabel}>
                <button
                    className={`rbs-graph-toggle ${planView === "stepper" ? "active" : ""}`}
                    aria-pressed={planView === "stepper"}
                    onClick={() => setPlanView("stepper")}>
                    {loc.viewList}
                </button>
                <button
                    className={`rbs-graph-toggle ${planView === "graph" ? "active" : ""}`}
                    aria-pressed={planView === "graph"}
                    onClick={() => setPlanView("graph")}>
                    {loc.viewGraph}
                </button>
            </div>
            {planView === "graph" ? (
                <PlanGraphView
                    entryNodeId={artifact.entryNodeId ?? artifact.nodes[0]?.id ?? ""}
                    nodes={artifact.nodes}
                    edges={artifact.edges}
                    run={state?.run}
                />
            ) : (
                <PlanStepper
                    entryNodeId={artifact.entryNodeId ?? artifact.nodes[0]?.id ?? ""}
                    nodes={artifact.nodes}
                    edges={artifact.edges}
                    run={state?.run}
                    outputPresentations={artifact.outputPresentations}
                    presentationRevision={artifact.presentationRevision}
                    enableQueryExecution
                />
            )}
        </div>
    );
}

/** Run picker for the Results page: current run by default, any persisted
 *  prior run selectable (owner ask #7 — history-backed results). */
function ResultsRunPicker() {
    const { state, selectRun } = useRbs();
    const loc = locConstants.runbookStudio;
    const runs = state?.availableRuns ?? [];
    if (runs.length < 2) {
        return null;
    }
    const current = state?.selectedRunId ?? state?.run?.runId ?? "";
    return (
        <label className="rbs-output-picker">
            <span className="rbs-muted">{loc.resultsRunPicker}</span>
            <select
                className="rbs-select"
                value={current}
                onChange={(e) => void selectRun(e.target.value)}>
                {runs.map((run) => (
                    <option key={run.runId} value={run.runId}>
                        {run.startedEpochMs !== undefined
                            ? new Date(run.startedEpochMs).toLocaleString()
                            : run.runId}
                        {" · "}
                        {run.verdict ?? run.state}
                    </option>
                ))}
            </select>
        </label>
    );
}

function formatRunDuration(value: number | undefined): string {
    if (value === undefined) {
        return "—";
    }
    return Math.abs(value) < 1_000 ? `${value} ms` : `${(value / 1_000).toFixed(1)} s`;
}

function formatComparisonScalar(value: string | number | boolean | undefined): string {
    return value === undefined ? "—" : String(value);
}

function comparisonDelta(
    value: RunComparisonValue<number>,
    formatter: (value: number | undefined) => string,
): string {
    if (value.delta === undefined) {
        return "—";
    }
    return `${value.delta > 0 ? "+" : ""}${formatter(value.delta)}`;
}

function RunComparisonPanel({ current }: { current: RunbookRunSnapshot }) {
    const { state, getRun } = useRbs();
    const loc = locConstants.runbookStudio;
    const candidates = (state?.availableRuns ?? []).filter(
        (run) =>
            run.runId !== current.runId &&
            (run.state === "succeeded" || run.state === "failed" || run.state === "cancelled"),
    );
    const [baselineRunId, setBaselineRunId] = useState(candidates[0]?.runId ?? "");
    const [baseline, setBaseline] = useState<RunbookRunSnapshot>();
    const [loading, setLoading] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);
    const candidateIds = candidates.map((candidate) => candidate.runId).join("|");
    useEffect(() => {
        if (!candidates.some((candidate) => candidate.runId === baselineRunId)) {
            setBaselineRunId(candidates[0]?.runId ?? "");
        }
    }, [candidateIds, current.runId]);
    useEffect(() => {
        let active = true;
        setBaseline(undefined);
        setLoadFailed(false);
        if (!baselineRunId) {
            return () => {
                active = false;
            };
        }
        setLoading(true);
        void getRun(baselineRunId)
            .then((snapshot) => {
                if (!active) {
                    return;
                }
                setBaseline(snapshot);
                setLoadFailed(snapshot === undefined);
            })
            .catch(() => {
                if (active) {
                    setLoadFailed(true);
                }
            })
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });
        return () => {
            active = false;
        };
    }, [baselineRunId, getRun]);
    if (candidates.length === 0) {
        return <div className="rbs-inline-notice">{loc.noComparisonRun}</div>;
    }
    const comparison = baseline ? compareRunSnapshots(baseline, current) : undefined;
    const nodeLabels = new Map((state?.artifact?.nodes ?? []).map((node) => [node.id, node.label]));
    const changedNodes = comparison?.nodes.filter((node) => node.changed) ?? [];
    const changedMetrics = comparison?.metrics.filter((metric) => metric.changed) ?? [];
    const facts = comparison
        ? [
              {
                  label: loc.elapsed,
                  value: comparison.elapsedMs,
                  formatter: formatRunDuration,
              },
              {
                  label: loc.completedSteps,
                  value: comparison.completedNodes,
                  formatter: (value: number | undefined) =>
                      value === undefined ? "—" : String(value),
              },
              ...(comparison.warningCount
                  ? [
                        {
                            label: loc.warnings,
                            value: comparison.warningCount,
                            formatter: (value: number | undefined) =>
                                value === undefined ? "—" : String(value),
                        },
                    ]
                  : []),
              ...(comparison.errorCount
                  ? [
                        {
                            label: loc.errors,
                            value: comparison.errorCount,
                            formatter: (value: number | undefined) =>
                                value === undefined ? "—" : String(value),
                        },
                    ]
                  : []),
          ]
        : [];
    return (
        <section className="rbs-run-comparison" aria-label={loc.runComparison}>
            <div className="rbs-run-comparison-header">
                <div>
                    <strong>{loc.runComparison}</strong>
                    <div className="rbs-muted">{loc.runComparisonDetail}</div>
                </div>
                <label className="rbs-output-picker">
                    <span className="rbs-muted">{loc.compareWith}</span>
                    <select
                        className="rbs-select"
                        value={baselineRunId}
                        disabled={loading}
                        onChange={(event) => setBaselineRunId(event.target.value)}>
                        {candidates.map((run) => (
                            <option key={run.runId} value={run.runId}>
                                {run.startedEpochMs !== undefined
                                    ? new Date(run.startedEpochMs).toLocaleString()
                                    : run.runId}
                                {" · "}
                                {run.verdict ?? run.state}
                            </option>
                        ))}
                    </select>
                </label>
            </div>
            {loading ? <div className="rbs-muted">{loc.loadingComparison}</div> : null}
            {loadFailed ? <div className="rbs-error-text">{loc.comparisonLoadFailed}</div> : null}
            {comparison && baseline ? (
                <>
                    <div className="rbs-comparison-identities">
                        <span>
                            {loc.baseline}: {baseline.verdict ?? baseline.state}
                        </span>
                        <span>
                            {loc.current}: {current.verdict ?? current.state}
                        </span>
                        <span
                            className={`rbs-chip ${comparison.samePlan ? "" : "rbs-chip-warning"}`}>
                            {comparison.samePlan ? loc.samePlan : loc.differentPlan}
                        </span>
                    </div>
                    <div className="rbs-comparison-facts">
                        {facts.map((fact) => (
                            <div className="rbs-comparison-fact" key={fact.label}>
                                <span className="rbs-muted">{fact.label}</span>
                                <strong>{fact.formatter(fact.value.current)}</strong>
                                <span className="rbs-muted">
                                    {loc.baseline}: {fact.formatter(fact.value.baseline)} ·{" "}
                                    {loc.change}: {comparisonDelta(fact.value, fact.formatter)}
                                </span>
                            </div>
                        ))}
                    </div>
                    <div className="rbs-muted">{loc.comparisonNoRegressionClaim}</div>
                    <h3>{loc.changedSteps}</h3>
                    {changedNodes.length > 0 ? (
                        <div className="rbs-table-wrap">
                            <table className="rbs-table">
                                <thead>
                                    <tr>
                                        <th>{loc.step}</th>
                                        <th>{loc.baseline}</th>
                                        <th>{loc.current}</th>
                                        <th>{loc.durationChange}</th>
                                        <th>{loc.rowChange}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {changedNodes.map((node) => (
                                        <tr key={node.nodeId}>
                                            <td>{nodeLabels.get(node.nodeId) ?? node.nodeId}</td>
                                            <td>
                                                {node.baselineOutcome ?? node.baselineState ?? "—"}
                                            </td>
                                            <td>
                                                {node.currentOutcome ?? node.currentState ?? "—"}
                                            </td>
                                            <td>
                                                {comparisonDelta(
                                                    node.durationMs,
                                                    formatRunDuration,
                                                )}
                                            </td>
                                            <td>
                                                {node.rows.delta === undefined
                                                    ? "—"
                                                    : `${node.rows.delta > 0 ? "+" : ""}${node.rows.delta}`}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="rbs-muted">{loc.noChangedSteps}</div>
                    )}
                    <h3>{loc.changedMetrics}</h3>
                    {changedMetrics.length > 0 ? (
                        <div className="rbs-table-wrap">
                            <table className="rbs-table">
                                <thead>
                                    <tr>
                                        <th>{loc.metric}</th>
                                        <th>{loc.baseline}</th>
                                        <th>{loc.current}</th>
                                        <th>{loc.change}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {changedMetrics.map((metric) => (
                                        <tr key={metric.key}>
                                            <td className="rbs-mono">{metric.key}</td>
                                            <td>{formatComparisonScalar(metric.baseline)}</td>
                                            <td>{formatComparisonScalar(metric.current)}</td>
                                            <td>
                                                {metric.delta === undefined
                                                    ? "—"
                                                    : `${metric.delta > 0 ? "+" : ""}${metric.delta}`}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="rbs-muted">{loc.noChangedMetrics}</div>
                    )}
                </>
            ) : null}
        </section>
    );
}

function EvidenceExportControl() {
    const { state, exportEvidence } = useRbs();
    const loc = locConstants.runbookStudio;
    const [format, setFormat] = useState<RbsEvidenceExportFormat>("junit");
    const [exporting, setExporting] = useState(false);
    const runId = state?.run?.runId;
    const evidenceReady = state?.run?.nodes.some((node) =>
        node.outputs?.some(
            (output) =>
                output.contract === "evidenceBundle/1" &&
                output.expired !== true &&
                output.truncated !== true,
        ),
    );
    if (!runId || !evidenceReady) {
        return null;
    }
    const startExport = async () => {
        setExporting(true);
        try {
            await exportEvidence(runId, format);
        } finally {
            setExporting(false);
        }
    };
    return (
        <div className="rbs-output-picker">
            <label className="rbs-output-picker">
                <span className="rbs-muted">{loc.evidenceFormat}</span>
                <select
                    className="rbs-select"
                    value={format}
                    disabled={exporting}
                    onChange={(event) => setFormat(event.target.value as RbsEvidenceExportFormat)}>
                    <option value="junit">{loc.evidenceFormatJunit}</option>
                    <option value="sarif">{loc.evidenceFormatSarif}</option>
                    <option value="markdown">{loc.evidenceFormatMarkdown}</option>
                    <option value="json">{loc.evidenceFormatJson}</option>
                </select>
            </label>
            <button className="rbs-btn" disabled={exporting} onClick={() => void startExport()}>
                {exporting ? loc.exportingEvidence : loc.exportEvidence}
            </button>
        </div>
    );
}

function runStateLabel(state: RunbookRunStateKind): string {
    const loc = locConstants.runbookStudio;
    switch (state) {
        case "accepted":
            return loc.runAccepted;
        case "running":
            return loc.runRunning;
        case "awaitingApproval":
            return loc.runAwaitingApproval;
        case "cancelling":
            return loc.runCancelling;
        case "succeeded":
            return loc.runSucceeded;
        case "failed":
            return loc.runFailed;
        case "cancelled":
            return loc.runCancelled;
    }
}

function runOutcomeLabel(run: Pick<RunbookRunSnapshot, "verdict" | "state">): string {
    const loc = locConstants.runbookStudio;
    if (run.verdict === "pass") {
        return loc.runPassed;
    }
    if (run.verdict === "fail") {
        return loc.runFailed;
    }
    if (run.verdict === "indeterminate") {
        return loc.runIndeterminate;
    }
    return runStateLabel(run.state);
}

function evidenceStateLabel(state: RunEvidenceState): string {
    const loc = locConstants.runbookStudio;
    switch (state) {
        case "ready":
            return loc.evidenceReady;
        case "pending":
            return loc.evidencePending;
        case "missing":
            return loc.evidenceMissing;
        case "truncated":
            return loc.evidenceTruncated;
        case "expired":
            return loc.evidenceExpired;
    }
}

function RunOutcomeSummaryPanel({ run }: { run: RunbookRunSnapshot }) {
    const loc = locConstants.runbookStudio;
    const summary = buildRunOutcomeSummary(run);
    const outcomeStyle =
        run.verdict ??
        (run.state === "succeeded"
            ? "pass"
            : run.state === "failed"
              ? "fail"
              : run.state === "cancelled"
                ? "indeterminate"
                : undefined);
    const stepDetails = [
        ...(summary.failedSteps > 0 ? [loc.failedSteps(summary.failedSteps)] : []),
        ...(summary.cancelledSteps > 0 ? [loc.cancelledSteps(summary.cancelledSteps)] : []),
        ...(summary.skippedSteps > 0 ? [loc.skippedSteps(summary.skippedSteps)] : []),
        ...(summary.branchNotTakenSteps > 0
            ? [loc.branchNotTakenSteps(summary.branchNotTakenSteps)]
            : []),
    ];
    return (
        <section className="rbs-outcome-summary" aria-label={loc.runOutcome}>
            <div className="rbs-outcome-summary-head">
                <span className="rbs-muted">{loc.runOutcome}</span>
                <span className={`rbs-chip ${outcomeStyle ? `rbs-verdict-${outcomeStyle}` : ""}`}>
                    {runOutcomeLabel(run)}
                </span>
            </div>
            <div className="rbs-outcome-summary-cards">
                <div className="rbs-outcome-summary-card">
                    <span className="rbs-muted">{loc.steps}</span>
                    <strong>{loc.stepsComplete(summary.terminalSteps, summary.totalSteps)}</strong>
                    {stepDetails.length > 0 ? (
                        <span className="rbs-muted">{stepDetails.join(" · ")}</span>
                    ) : null}
                </div>
                <div className="rbs-outcome-summary-card">
                    <span className="rbs-muted">{loc.elapsed}</span>
                    <strong>{formatRunDuration(summary.elapsedMs)}</strong>
                    <span className="rbs-muted">
                        {summary.elapsedMs === undefined
                            ? loc.elapsedNotMeasured
                            : loc.durableRunTiming}
                    </span>
                </div>
                <div className="rbs-outcome-summary-card">
                    <span className="rbs-muted">{loc.diagnostics}</span>
                    <strong>
                        {summary.diagnosticCounts
                            ? loc.diagnosticTotals(
                                  summary.diagnosticCounts.warningCount,
                                  summary.diagnosticCounts.errorCount,
                              )
                            : loc.notMeasured}
                    </strong>
                    <span className="rbs-muted">
                        {summary.diagnosticCounts
                            ? loc.runtimeMeasured
                            : loc.diagnosticsNotReported}
                    </span>
                </div>
                <div className="rbs-outcome-summary-card">
                    <span className="rbs-muted">{loc.ciEvidence}</span>
                    <strong>{evidenceStateLabel(summary.evidenceState)}</strong>
                    <span className="rbs-muted">
                        {loc.evidenceStateDetail[summary.evidenceState]}
                    </span>
                </div>
            </div>
        </section>
    );
}

type PresentationDraftTarget =
    | { kind: "run"; runId: string }
    | {
          kind: "sample";
          scenario: "clean" | "blockingErrors" | "approvalRejected";
      };

type PresentationDraftConflict =
    | { kind: "stale" }
    | { kind: "overlap"; conflicts: PresentationLayoutConflict[] };

function usePresentationDraft(
    basePresentation: ResolvedPresentation | undefined,
    target: PresentationDraftTarget | undefined,
    resetKey: string | undefined,
) {
    const {
        state,
        applyPresentationLayout,
        previewPresentationLayout,
        applyPresentationOverlay,
        clearPresentationOverlay,
    } = useRbs();
    const currentRevision = state?.artifact?.presentationRevision ?? 0;
    const [draftEdits, setDraftEdits] = useState<PresentationLayoutEdit[]>([]);
    const [draftPolicy, setDraftPolicy] = useState<PresentationLayoutPolicyEdit>();
    const [draftBaseRevision, setDraftBaseRevision] = useState<number | undefined>();
    const [draftBaseline, setDraftBaseline] = useState<PresentationLayoutEdit[]>();
    const [draftBaselineStrategy, setDraftBaselineStrategy] =
        useState<PresentationLayoutStrategy>();
    const [draftPresentation, setDraftPresentation] = useState<ResolvedPresentation | undefined>();
    const [runOnlyEdits, setRunOnlyEdits] = useState<PresentationLayoutEdit[]>([]);
    const [runOnlyPolicy, setRunOnlyPolicy] = useState<PresentationLayoutPolicyEdit>();
    const [runOnlyPresentation, setRunOnlyPresentation] = useState<
        ResolvedPresentation | undefined
    >();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<"invalid" | "targetMissing" | undefined>();
    const [conflict, setConflict] = useState<PresentationDraftConflict>();
    const requestSequence = useRef(0);
    const targetKey = target ? JSON.stringify(target) : undefined;
    const hostRunOnlyEdits =
        target?.kind === "run" && state?.presentationOverlay?.runId === target.runId
            ? state.presentationOverlay.edits
            : [];
    const hostRunOnlyPolicy =
        target?.kind === "run" && state?.presentationOverlay?.runId === target.runId
            ? state.presentationOverlay.policy
            : undefined;
    const currentLayoutSnapshot = useMemo(
        () =>
            presentationLayoutSnapshot(
                basePresentation,
                state?.artifact?.outputPresentations,
                state?.artifact?.presentationWidgets,
            ),
        [
            basePresentation,
            state?.artifact?.outputPresentations,
            state?.artifact?.presentationWidgets,
        ],
    );
    const currentPersistedStrategy =
        state?.artifact?.presentationLayoutStrategy ?? presentationLayoutStrategy(basePresentation);

    const resolveEdits = useCallback(
        async (
            edits: PresentationLayoutEdit[],
            policy: PresentationLayoutPolicyEdit | undefined,
            baseRevision: number,
            destination: "draft" | "runOnly",
        ) => {
            if (!target || (edits.length === 0 && !policy)) {
                return false;
            }
            const sequence = ++requestSequence.current;
            const result = await previewPresentationLayout(edits, policy, baseRevision, target);
            if (sequence !== requestSequence.current) {
                return false;
            }
            if (result.presentation) {
                if (destination === "draft") {
                    setDraftPresentation(result.presentation);
                } else {
                    setRunOnlyPresentation(result.presentation);
                }
                setError(undefined);
                return true;
            }
            if (result.reason === "revisionConflict") {
                setConflict({ kind: "stale" });
            } else {
                setError(result.reason === "targetMissing" ? "targetMissing" : "invalid");
            }
            return false;
        },
        [previewPresentationLayout, targetKey],
    );

    useEffect(() => {
        requestSequence.current++;
        setDraftEdits([]);
        setDraftPolicy(undefined);
        setDraftBaseRevision(undefined);
        setDraftBaseline(undefined);
        setDraftBaselineStrategy(undefined);
        setDraftPresentation(undefined);
        setRunOnlyEdits([]);
        setRunOnlyPolicy(undefined);
        setRunOnlyPresentation(undefined);
        setError(undefined);
        setConflict(undefined);
    }, [resetKey]);

    useEffect(() => {
        if ((draftEdits.length > 0 || draftPolicy) && draftBaseRevision !== undefined) {
            setDraftPresentation(undefined);
            if (draftBaseRevision !== currentRevision) {
                setConflict({ kind: "stale" });
            } else {
                void resolveEdits(draftEdits, draftPolicy, draftBaseRevision, "draft");
            }
        } else if (runOnlyEdits.length > 0 || runOnlyPolicy) {
            setRunOnlyPresentation(undefined);
            void resolveEdits(runOnlyEdits, runOnlyPolicy, currentRevision, "runOnly");
        }
    }, [currentRevision, targetKey]);

    const stageEdits = useCallback(
        (changes: PresentationLayoutEdit[]) => {
            if (!target || changes.length === 0 || conflict) {
                return;
            }
            if (runOnlyEdits.length > 0 || runOnlyPolicy) {
                setRunOnlyEdits([]);
                setRunOnlyPolicy(undefined);
                setRunOnlyPresentation(undefined);
            }
            setDraftEdits((current) => {
                const next = mergePresentationLayoutEdits(
                    current.length > 0
                        ? current
                        : hostRunOnlyEdits.length > 0
                          ? hostRunOnlyEdits
                          : runOnlyEdits,
                    changes,
                );
                const revision = draftBaseRevision ?? currentRevision;
                if (draftBaseline === undefined) {
                    setDraftBaseline(currentLayoutSnapshot);
                    setDraftBaselineStrategy(currentPersistedStrategy);
                }
                const policy = draftPolicy ?? hostRunOnlyPolicy ?? runOnlyPolicy;
                setDraftPolicy(policy);
                setDraftBaseRevision(revision);
                void resolveEdits(next, policy, revision, "draft");
                return next;
            });
        },
        [
            conflict,
            currentRevision,
            currentLayoutSnapshot,
            currentPersistedStrategy,
            draftBaseline,
            draftBaseRevision,
            draftPolicy,
            hostRunOnlyEdits,
            hostRunOnlyPolicy,
            resolveEdits,
            runOnlyEdits,
            runOnlyPolicy,
            targetKey,
        ],
    );

    const stagePolicy = useCallback(
        (strategy: PresentationLayoutStrategy) => {
            if (
                !target ||
                conflict ||
                strategy === presentationLayoutStrategy(draftPresentation ?? basePresentation)
            ) {
                return;
            }
            if (runOnlyEdits.length > 0 || runOnlyPolicy) {
                setRunOnlyEdits([]);
                setRunOnlyPolicy(undefined);
                setRunOnlyPresentation(undefined);
            }
            const policy = { strategy } satisfies PresentationLayoutPolicyEdit;
            const edits =
                draftEdits.length > 0
                    ? draftEdits
                    : hostRunOnlyEdits.length > 0
                      ? hostRunOnlyEdits
                      : runOnlyEdits;
            const revision = draftBaseRevision ?? currentRevision;
            if (draftBaseline === undefined) {
                setDraftBaseline(currentLayoutSnapshot);
                setDraftBaselineStrategy(currentPersistedStrategy);
            }
            setDraftPolicy(policy);
            setDraftBaseRevision(revision);
            void resolveEdits(edits, policy, revision, "draft");
        },
        [
            basePresentation,
            conflict,
            currentLayoutSnapshot,
            currentRevision,
            currentPersistedStrategy,
            draftBaseline,
            draftBaseRevision,
            draftEdits,
            draftPresentation,
            hostRunOnlyEdits,
            resolveEdits,
            runOnlyEdits,
            runOnlyPolicy,
            targetKey,
        ],
    );

    const resetDraft = useCallback(() => {
        requestSequence.current++;
        setDraftEdits([]);
        setDraftPolicy(undefined);
        setDraftBaseRevision(undefined);
        setDraftBaseline(undefined);
        setDraftBaselineStrategy(undefined);
        setDraftPresentation(undefined);
        setError(undefined);
        setConflict(undefined);
    }, []);

    const applyToRun = useCallback(async () => {
        if (
            !draftPresentation ||
            (draftEdits.length === 0 && !draftPolicy) ||
            draftBaseRevision === undefined
        ) {
            return false;
        }
        if (target?.kind === "run") {
            setSaving(true);
            try {
                const result = await applyPresentationOverlay(
                    target.runId,
                    draftEdits,
                    draftPolicy,
                    draftBaseRevision,
                );
                if (result.applied) {
                    resetDraft();
                    return true;
                }
                if (result.reason === "revisionConflict") {
                    setConflict({ kind: "stale" });
                } else {
                    setError(result.reason === "targetMissing" ? "targetMissing" : "invalid");
                }
                return false;
            } finally {
                setSaving(false);
            }
        }
        setRunOnlyEdits(draftEdits);
        setRunOnlyPolicy(draftPolicy);
        setRunOnlyPresentation(draftPresentation);
        resetDraft();
        return true;
    }, [
        applyPresentationOverlay,
        draftBaseRevision,
        draftEdits,
        draftPolicy,
        draftPresentation,
        resetDraft,
        targetKey,
    ]);

    const resetRunOnly = useCallback(async () => {
        if (target?.kind === "run" && state?.presentationOverlay?.runId === target.runId) {
            await clearPresentationOverlay(target.runId);
        }
        setRunOnlyEdits([]);
        setRunOnlyPolicy(undefined);
        setRunOnlyPresentation(undefined);
    }, [clearPresentationOverlay, state?.presentationOverlay?.runId, targetKey]);

    const saveToRunbook = useCallback(async () => {
        if ((draftEdits.length === 0 && !draftPolicy) || draftBaseRevision === undefined) {
            return false;
        }
        setSaving(true);
        setError(undefined);
        try {
            const result = await applyPresentationLayout(
                draftEdits,
                draftPolicy,
                draftBaseRevision,
            );
            if (result.applied) {
                await resetRunOnly();
                resetDraft();
                return true;
            }
            if (result.reason === "revisionConflict") {
                setConflict({ kind: "stale" });
            } else if (result.reason !== "cancelled") {
                setError("invalid");
            }
            return false;
        } finally {
            setSaving(false);
        }
    }, [
        applyPresentationLayout,
        draftBaseRevision,
        draftEdits,
        draftPolicy,
        resetDraft,
        resetRunOnly,
    ]);

    const rebase = useCallback(async () => {
        if (
            (draftEdits.length === 0 && !draftPolicy) ||
            draftBaseline === undefined ||
            draftBaselineStrategy === undefined
        ) {
            return;
        }
        setSaving(true);
        try {
            const rebased = rebasePresentationLayoutEdits(
                draftBaseline,
                currentLayoutSnapshot,
                draftEdits,
            );
            const rebasedPolicy = rebasePresentationLayoutPolicy(
                draftBaselineStrategy,
                currentPersistedStrategy,
                draftPolicy,
            );
            if (rebasedPolicy.conflict) {
                rebased.conflicts.push({ nodeId: "$layout", fields: ["layout.strategy"] });
            }
            if (rebased.conflicts.length > 0) {
                setConflict({ kind: "overlap", conflicts: rebased.conflicts });
                return;
            }
            const resolved = await resolveEdits(
                rebased.edits,
                rebasedPolicy.policy,
                currentRevision,
                "draft",
            );
            if (resolved) {
                setDraftEdits(rebased.edits);
                setDraftPolicy(rebasedPolicy.policy);
                setDraftBaseRevision(currentRevision);
                setDraftBaseline(currentLayoutSnapshot);
                setDraftBaselineStrategy(currentPersistedStrategy);
                setConflict(undefined);
            }
        } finally {
            setSaving(false);
        }
    }, [
        basePresentation,
        currentLayoutSnapshot,
        currentRevision,
        currentPersistedStrategy,
        draftBaseline,
        draftBaselineStrategy,
        draftEdits,
        draftPolicy,
        resolveEdits,
    ]);

    const overwriteConflicts = useCallback(async () => {
        if (
            conflict?.kind !== "overlap" ||
            conflict.conflicts.some((entry) => entry.fields.includes("node")) ||
            draftBaseline === undefined
        ) {
            return;
        }
        setSaving(true);
        try {
            const rebased = rebasePresentationLayoutEdits(
                draftBaseline,
                currentLayoutSnapshot,
                draftEdits,
            );
            const rebasedPolicy = rebasePresentationLayoutPolicy(
                draftBaselineStrategy ?? currentPersistedStrategy,
                currentPersistedStrategy,
                draftPolicy,
            );
            const resolved = await resolveEdits(
                rebased.edits,
                rebasedPolicy.policy,
                currentRevision,
                "draft",
            );
            if (resolved) {
                setDraftEdits(rebased.edits);
                setDraftPolicy(rebasedPolicy.policy);
                setDraftBaseRevision(currentRevision);
                setDraftBaseline(currentLayoutSnapshot);
                setDraftBaselineStrategy(currentPersistedStrategy);
                setConflict(undefined);
            }
        } finally {
            setSaving(false);
        }
    }, [
        basePresentation,
        conflict,
        currentLayoutSnapshot,
        currentRevision,
        currentPersistedStrategy,
        draftBaseline,
        draftBaselineStrategy,
        draftEdits,
        draftPolicy,
        resolveEdits,
    ]);

    const effectiveEdits =
        draftEdits.length > 0
            ? draftEdits
            : runOnlyEdits.length > 0
              ? runOnlyEdits
              : hostRunOnlyEdits;
    return {
        presentation: draftPresentation ?? runOnlyPresentation ?? basePresentation,
        edits: effectiveEdits,
        pending: draftEdits.length > 0 || draftPolicy !== undefined,
        runOnly:
            runOnlyEdits.length > 0 ||
            runOnlyPolicy !== undefined ||
            hostRunOnlyEdits.length > 0 ||
            hostRunOnlyPolicy !== undefined,
        saving,
        error,
        conflict: conflict !== undefined,
        conflictDetail: conflict,
        canOverwriteConflicts:
            conflict?.kind === "overlap" &&
            !conflict.conflicts.some((entry) => entry.fields.includes("node")),
        stageEdits,
        stagePolicy,
        resetDraft,
        resetRunOnly,
        applyToRun,
        saveToRunbook,
        rebase,
        overwriteConflicts,
    };
}

function PresentationDraftBanner({
    draft,
    previewOnly = false,
}: {
    draft: ReturnType<typeof usePresentationDraft>;
    previewOnly?: boolean;
}) {
    const loc = locConstants.runbookStudio;
    const conflictFieldLabel = (field: PresentationLayoutConflict["fields"][number]): string => {
        switch (field) {
            case "node":
                return loc.layoutConflictWidgetRemoved;
            case "widgetId":
                return loc.layoutConflictWidgetIdentity;
            case "defaultView":
                return loc.layoutConflictDefaultView;
            case "sectionId":
                return loc.layoutConflictSection;
            case "hidden":
                return loc.layoutConflictVisibility;
            case "derivedSource":
                return loc.layoutConflictDerivedSource;
            case "placement.order":
                return loc.layoutConflictOrder;
            case "placement.span.compact":
                return loc.layoutConflictCompactWidth;
            case "placement.span.medium":
                return loc.layoutConflictMediumWidth;
            case "placement.span.wide":
                return loc.layoutConflictWideWidth;
            case "placement.minHeight":
                return loc.layoutConflictMinimumHeight;
            case "placement.priority":
                return loc.layoutConflictPriority;
            case "layout.strategy":
                return loc.layoutConflictStrategy;
        }
    };
    if (!draft.pending && !draft.runOnly) {
        return null;
    }
    return (
        <div className="rbs-layout-draft-banner" role="status">
            <div>
                <strong>
                    {draft.pending ? loc.layoutChangesPending : loc.layoutRunOnlyApplied}
                </strong>
                {draft.conflict ? (
                    <div className="rbs-error-text">
                        {draft.conflictDetail?.kind === "overlap"
                            ? loc.layoutOverlapConflict(
                                  draft.conflictDetail.conflicts.reduce(
                                      (count, entry) => count + entry.fields.length,
                                      0,
                                  ),
                              )
                            : loc.layoutRevisionConflict}
                        {draft.conflictDetail?.kind === "overlap" ? (
                            <ul className="rbs-layout-conflict-list">
                                {draft.conflictDetail.conflicts.map((entry) => (
                                    <li key={entry.nodeId}>
                                        {loc.layoutConflictItem(
                                            entry.nodeId === "$layout"
                                                ? loc.layoutPolicy
                                                : entry.nodeId,
                                            entry.fields.map(conflictFieldLabel).join(", "),
                                        )}
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                    </div>
                ) : null}
                {draft.error ? (
                    <div className="rbs-error-text">{loc.layoutPreviewFailed}</div>
                ) : null}
            </div>
            <div className="rbs-spacer" />
            {draft.conflictDetail?.kind === "stale" ? (
                <button
                    type="button"
                    className="rbs-btn"
                    disabled={draft.saving}
                    onClick={() => void draft.rebase()}>
                    {loc.rebaseLayout}
                </button>
            ) : null}
            {draft.conflictDetail?.kind === "overlap" && draft.canOverwriteConflicts ? (
                <button
                    type="button"
                    className="rbs-btn rbs-btn-danger"
                    disabled={draft.saving}
                    onClick={() => void draft.overwriteConflicts()}>
                    {loc.overwriteLayoutConflicts}
                </button>
            ) : null}
            {draft.pending && !draft.conflict ? (
                <>
                    <button
                        type="button"
                        className="rbs-btn rbs-btn-quiet"
                        disabled={draft.saving}
                        onClick={draft.applyToRun}>
                        {previewOnly ? loc.applyToPreviewOnly : loc.applyToRunOnly}
                    </button>
                    <button
                        type="button"
                        className="rbs-btn"
                        disabled={draft.saving}
                        onClick={() => void draft.saveToRunbook()}>
                        {draft.saving ? loc.savingLayout : loc.saveLayoutToRunbook}
                    </button>
                </>
            ) : null}
            <button
                type="button"
                className="rbs-link-button"
                disabled={draft.saving}
                onClick={draft.pending ? draft.resetDraft : draft.resetRunOnly}>
                {loc.resetLayoutChanges}
            </button>
        </div>
    );
}

function LayoutStrategyControl({
    presentation,
    onChange,
    disabled = false,
}: {
    presentation: ResolvedPresentation;
    onChange: (strategy: PresentationLayoutStrategy) => void;
    disabled?: boolean;
}) {
    const loc = locConstants.runbookStudio;
    const strategy = presentationLayoutStrategy(presentation);
    return (
        <div className="rbs-graph-toggle-group" role="group" aria-label={loc.layoutStrategy}>
            {(["flow", "stacked", "grid"] as const).map((candidate) => (
                <button
                    key={candidate}
                    type="button"
                    className={`rbs-graph-toggle ${strategy === candidate ? "active" : ""}`}
                    aria-pressed={strategy === candidate}
                    disabled={disabled}
                    onClick={() => onChange(candidate)}>
                    {candidate === "flow"
                        ? loc.layoutFlow
                        : candidate === "stacked"
                          ? loc.layoutStacked
                          : loc.layoutGrid}
                </button>
            ))}
        </div>
    );
}

function ResultsPage() {
    const { state } = useRbs();
    const loc = locConstants.runbookStudio;
    const paintedResults = useRef<Map<string, string>>(new Map());
    const [editingLayout, setEditingLayout] = useState(false);
    const [outputsOpen, setOutputsOpen] = useState(false);
    const [comparisonOpen, setComparisonOpen] = useState(false);
    const widgets = (state?.presentation?.sections ?? []).flatMap((section) => section.widgets);
    const readyWidgets = widgets.filter((widget) => widget.state === "ready");
    const runId = state?.run?.runId;
    const comparisonAvailable = (state?.availableRuns ?? []).some(
        (run) =>
            run.runId !== runId &&
            (run.state === "succeeded" || run.state === "failed" || run.state === "cancelled"),
    );
    const draftTarget = useMemo<PresentationDraftTarget | undefined>(
        () => (runId ? { kind: "run", runId } : undefined),
        [runId],
    );
    const layoutDraft = usePresentationDraft(state?.presentation, draftTarget, runId);
    const resultSignature = readyWidgets
        .map(
            (widget) =>
                `${widget.id}:${widget.handleId ?? ""}:${widget.view}:${widget.rows ?? ""}:${widget.drift?.requestedView ?? ""}`,
        )
        .join("|");
    useEffect(() => {
        if (!runId || readyWidgets.length === 0) {
            return;
        }
        const previous = paintedResults.current.get(runId);
        paintedResults.current.set(runId, resultSignature);
        if (previous === undefined) {
            perfMarkAfterNextPaint("mssql.runbookStudio.results.firstUsefulRender", {
                widgetCount: readyWidgets.length,
            });
        } else if (previous !== resultSignature) {
            perfMarkAfterNextPaint("mssql.runbookStudio.results.updateApplied", {
                updateKind: "snapshot",
            });
        }
    }, [readyWidgets.length, resultSignature, runId]);
    if (state?.artifactError) {
        return <InvalidArtifact />;
    }
    if (!state?.run) {
        return <EmptyState title={loc.noResultsTitle} detail={loc.noResultsDetail} />;
    }
    const presentation = layoutDraft.presentation;
    if (!presentation || presentation.sections.length === 0) {
        return (
            <div className="rbs-page-body">
                <div className="rbs-run-header">
                    <ResultsRunPicker />
                    <div className="rbs-spacer" />
                    <button
                        type="button"
                        className="rbs-btn rbs-btn-quiet"
                        aria-pressed={comparisonOpen}
                        disabled={!comparisonAvailable}
                        onClick={() => setComparisonOpen((value) => !value)}>
                        {loc.compareRuns}
                    </button>
                    <EvidenceExportControl />
                </div>
                <RunOutcomeSummaryPanel run={state.run} />
                {comparisonOpen ? <RunComparisonPanel current={state.run} /> : null}
                <EmptyState title={loc.noOutputsTitle} detail={loc.noOutputsDetail} />
            </div>
        );
    }
    return (
        <div className="rbs-page-body">
            <div className="rbs-run-header">
                <ResultsRunPicker />
                <div className="rbs-spacer" />
                <button
                    type="button"
                    className="rbs-btn rbs-btn-quiet"
                    aria-pressed={comparisonOpen}
                    disabled={!comparisonAvailable}
                    onClick={() => setComparisonOpen((value) => !value)}>
                    {loc.compareRuns}
                </button>
                <button
                    type="button"
                    className="rbs-btn"
                    aria-pressed={editingLayout}
                    onClick={() => setEditingLayout((value) => !value)}>
                    {editingLayout ? loc.finishCustomizing : loc.customizeLayout}
                </button>
                <button
                    type="button"
                    className="rbs-btn rbs-btn-quiet"
                    aria-pressed={outputsOpen}
                    onClick={() => setOutputsOpen((value) => !value)}>
                    {loc.outputsDrawer}
                </button>
                {editingLayout ? (
                    <LayoutStrategyControl
                        presentation={presentation}
                        onChange={layoutDraft.stagePolicy}
                        disabled={layoutDraft.saving || layoutDraft.conflict}
                    />
                ) : null}
                <EvidenceExportControl />
            </div>
            <RunOutcomeSummaryPanel run={state.run} />
            {comparisonOpen ? <RunComparisonPanel current={state.run} /> : null}
            <PresentationDraftBanner draft={layoutDraft} />
            <div className={`rbs-results-compose ${outputsOpen ? "with-drawer" : ""}`}>
                <div>
                    <PresentationSections
                        presentation={presentation}
                        editing={editingLayout}
                        onLayoutEdits={layoutDraft.stageEdits}
                        editingDisabled={layoutDraft.saving || layoutDraft.conflict}
                    />
                </div>
                {outputsOpen ? (
                    <OutputsDrawer
                        presentation={presentation}
                        layoutEdits={layoutDraft.edits}
                        onLayoutEdits={layoutDraft.stageEdits}
                        editingDisabled={layoutDraft.saving || layoutDraft.conflict}
                    />
                ) : null}
            </div>
        </div>
    );
}

type LayoutStyle = CSSProperties & {
    "--rbs-span-compact": number;
    "--rbs-span-medium": number;
    "--rbs-span-wide": number;
};

function layoutStyle(widget: ResolvedWidget, presentation: ResolvedPresentation): LayoutStyle {
    const span = widget.placement?.span ?? presentation.layout.defaultSpan;
    return {
        "--rbs-span-compact": span.compact ?? presentation.layout.defaultSpan.compact ?? 1,
        "--rbs-span-medium": span.medium ?? presentation.layout.defaultSpan.medium ?? 6,
        "--rbs-span-wide": span.wide ?? presentation.layout.defaultSpan.wide ?? 12,
    };
}

function PresentationSections({
    presentation,
    sample = false,
    editing = false,
    onLayoutEdits,
    editingDisabled = false,
}: {
    presentation: ResolvedPresentation;
    sample?: boolean;
    editing?: boolean;
    onLayoutEdits?: (edits: PresentationLayoutEdit[]) => void;
    editingDisabled?: boolean;
}) {
    const loc = locConstants.runbookStudio;
    const sectionWidgets = presentation.sections.map((section) => section.widgets);
    return (
        <>
            {presentation.sections.map((section) => (
                <section className="rbs-section" key={section.id}>
                    <h2 className="rbs-section-title">{section.title}</h2>
                    <div
                        className={`rbs-layout-grid rbs-layout-${presentation.layout.sectionFlow} rbs-layout-strategy-${presentationLayoutStrategy(presentation)}`}>
                        {section.widgets.map((widget, index) => (
                            <div
                                className="rbs-layout-widget"
                                style={layoutStyle(widget, presentation)}
                                key={widget.id}>
                                {editing && widget.source ? (
                                    <LayoutEditorControls
                                        widget={widget}
                                        siblings={section.widgets}
                                        sectionWidgets={sectionWidgets}
                                        index={index}
                                        onLayoutEdits={onLayoutEdits}
                                        disabled={editingDisabled}
                                    />
                                ) : null}
                                <ResolvedWidgetView widget={widget} sample={sample} />
                            </div>
                        ))}
                        {section.widgets.length === 0 &&
                        section.whenEmpty === "show-empty-state" ? (
                            <div className="rbs-presentation-empty" role="status">
                                <strong>
                                    {presentation.emptyState?.title ?? loc.emptySectionTitle}
                                </strong>
                                <span className="rbs-muted">
                                    {presentation.emptyState?.body ?? loc.emptySectionDetail}
                                </span>
                                {presentation.emptyState?.suggestedAction ? (
                                    <span className="rbs-presentation-empty-action">
                                        {presentation.emptyState.suggestedAction}
                                    </span>
                                ) : null}
                            </div>
                        ) : section.widgets.length === 0 && section.whenEmpty === "reserve" ? (
                            <div className="rbs-presentation-reserved rbs-muted" role="status">
                                {loc.reservedSectionDetail}
                            </div>
                        ) : null}
                    </div>
                </section>
            ))}
        </>
    );
}

const LAYOUT_DRAG_MIME = "application/vnd.microsoft.runbook-studio-layout-node";

function presentationSourcesMatch(
    left: PresentationSourceRef | undefined,
    right: PresentationSourceRef | undefined,
) {
    if (!left || !right || left.kind !== right.kind) {
        return false;
    }
    switch (left.kind) {
        case "activity-output":
            return (
                right.kind === "activity-output" &&
                left.nodeId === right.nodeId &&
                left.slot === right.slot
            );
        case "run-field":
            return right.kind === "run-field" && left.field === right.field;
        case "run-metric":
            return right.kind === "run-metric" && left.key === right.key;
        case "derived":
            return right.kind === "derived" && left.sourceId === right.sourceId;
    }
}

function widgetSummaryFor(
    widget: ResolvedWidget,
    summaries: PresentationWidgetSummary[] | undefined,
) {
    return summaries?.find(
        (summary) =>
            summary.widgetId === widget.id ||
            summary.layoutId === widget.nodeId ||
            presentationSourcesMatch(summary.source, widget.source),
    );
}

function LayoutEditorControls({
    widget,
    siblings,
    sectionWidgets,
    index,
    onLayoutEdits,
    disabled,
}: {
    widget: ResolvedWidget;
    siblings: ResolvedWidget[];
    sectionWidgets: ResolvedWidget[][];
    index: number;
    onLayoutEdits?: (edits: PresentationLayoutEdit[]) => void;
    disabled: boolean;
}) {
    const { state } = useRbs();
    const loc = locConstants.runbookStudio;
    const summary = widgetSummaryFor(widget, state?.artifact?.presentationWidgets);
    const configured = state?.artifact?.outputPresentations?.[widget.nodeId];
    const sections = state?.artifact?.presentationSections ?? [];
    const placement = widget.placement ??
        summary?.placement ??
        configured?.placement ?? { order: 0 };
    const currentSpanPreset = presentationSpanPresetOf(placement.span);
    const [resizePreset, setResizePreset] = useState(currentSpanPreset);
    const lastCommittedResizePreset = useRef(currentSpanPreset);
    useEffect(() => {
        setResizePreset(currentSpanPreset);
        lastCommittedResizePreset.current = currentSpanPreset;
    }, [currentSpanPreset]);
    const currentSectionId =
        (sections.some((section) => section.id === widget.sectionId)
            ? widget.sectionId
            : undefined) ??
        summary?.sectionId ??
        configured?.sectionId ??
        "primary";
    const editFor = (
        target: ResolvedWidget,
        edit: Partial<PresentationLayoutEdit> = {},
    ): PresentationLayoutEdit => {
        const targetSummary = widgetSummaryFor(target, state?.artifact?.presentationWidgets);
        const targetConfigured = state?.artifact?.outputPresentations?.[target.nodeId];
        const targetSectionId =
            (sections.some((section) => section.id === target.sectionId)
                ? target.sectionId
                : undefined) ??
            targetSummary?.sectionId ??
            targetConfigured?.sectionId ??
            "primary";
        return {
            nodeId: target.nodeId,
            widgetId: targetSummary?.widgetId ?? targetConfigured?.widgetId ?? target.id,
            ...(target.source || targetSummary?.source
                ? { source: target.source ?? targetSummary?.source }
                : {}),
            ...(targetSummary?.derivedSource ? { derivedSource: targetSummary.derivedSource } : {}),
            defaultView: targetSummary?.defaultView ?? targetConfigured?.defaultView ?? target.view,
            sectionId: targetSectionId,
            placement: target.placement ??
                targetSummary?.placement ??
                targetConfigured?.placement ?? { order: 0 },
            hidden: false,
            ...edit,
        };
    };
    const commitEdits = (edits: PresentationLayoutEdit[]) => onLayoutEdits?.(edits);
    const commit = (edit: Partial<PresentationLayoutEdit>) => commitEdits([editFor(widget, edit)]);
    const commitSpanPreset = (preset: keyof typeof PRESENTATION_SPAN_PRESETS) => {
        setResizePreset(preset);
        if (lastCommittedResizePreset.current === preset) {
            return;
        }
        lastCommittedResizePreset.current = preset;
        commit({
            placement: {
                ...placement,
                span: PRESENTATION_SPAN_PRESETS[preset],
            },
        });
    };
    const move = (delta: -1 | 1) => {
        const sibling = siblings[index + delta];
        if (!sibling) {
            return;
        }
        const currentOrder = placement.order;
        const siblingSummary = widgetSummaryFor(sibling, state?.artifact?.presentationWidgets);
        const siblingConfigured = state?.artifact?.outputPresentations?.[sibling.nodeId];
        const siblingPlacement = sibling.placement ??
            siblingSummary?.placement ??
            siblingConfigured?.placement ?? {
                order: index + delta,
            };
        commitEdits([
            editFor(widget, { placement: { ...placement, order: siblingPlacement.order } }),
            editFor(sibling, {
                placement: { ...siblingPlacement, order: currentOrder },
            }),
        ]);
    };
    const dragStart = (event: DragEvent<HTMLButtonElement>) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(LAYOUT_DRAG_MIME, widget.nodeId);
    };
    const dragOver = (event: DragEvent<HTMLDivElement>) => {
        if (event.dataTransfer.types.includes(LAYOUT_DRAG_MIME)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
        }
    };
    const drop = (event: DragEvent<HTMLDivElement>) => {
        const sourceNodeId = event.dataTransfer.getData(LAYOUT_DRAG_MIME);
        const edits = pointerMovePresentationLayoutEdits(
            sectionWidgets.map((section) => section.map((candidate) => editFor(candidate))),
            sourceNodeId,
            widget.nodeId,
        );
        if (edits.length > 0) {
            event.preventDefault();
            commitEdits(edits);
        }
    };
    return (
        <div className="rbs-layout-controls" onDragOver={dragOver} onDrop={drop}>
            <button
                type="button"
                className="rbs-layout-drag-handle"
                draggable={!disabled}
                disabled={disabled}
                aria-label={loc.dragOutputToReorder(widget.title)}
                title={loc.dragOutputToReorder(widget.title)}
                onDragStart={dragStart}>
                ⠿
            </button>
            <label>
                <span className="rbs-muted">{loc.layoutSection}</span>
                <select
                    className="rbs-select"
                    value={currentSectionId}
                    disabled={disabled}
                    onChange={(event) => commit({ sectionId: event.target.value })}>
                    {sections.map((section) => (
                        <option key={section.id} value={section.id}>
                            {section.label ?? section.role}
                        </option>
                    ))}
                </select>
            </label>
            <label>
                <span className="rbs-muted">{loc.layoutWidth}</span>
                <select
                    className="rbs-select"
                    value={resizePreset}
                    disabled={disabled}
                    onChange={(event) =>
                        commitSpanPreset(
                            event.target.value as keyof typeof PRESENTATION_SPAN_PRESETS,
                        )
                    }>
                    <option value="full">{loc.layoutFull}</option>
                    <option value="twoThirds">{loc.layoutTwoThirds}</option>
                    <option value="half">{loc.layoutHalf}</option>
                    <option value="third">{loc.layoutThird}</option>
                </select>
            </label>
            <input
                className="rbs-layout-resize-slider"
                type="range"
                min={0}
                max={PRESENTATION_SPAN_PRESET_ORDER.length - 1}
                step={1}
                value={PRESENTATION_SPAN_PRESET_ORDER.indexOf(resizePreset)}
                disabled={disabled}
                aria-label={loc.resizeOutput(widget.title)}
                title={loc.resizeOutput(widget.title)}
                onChange={(event) =>
                    setResizePreset(presentationSpanPresetAt(Number(event.target.value)))
                }
                onPointerUp={(event) =>
                    commitSpanPreset(presentationSpanPresetAt(Number(event.currentTarget.value)))
                }
                onKeyUp={(event) =>
                    commitSpanPreset(presentationSpanPresetAt(Number(event.currentTarget.value)))
                }
                onBlur={(event) =>
                    commitSpanPreset(presentationSpanPresetAt(Number(event.currentTarget.value)))
                }
            />
            <button
                type="button"
                className="rbs-btn rbs-btn-quiet rbs-layout-move"
                aria-label={loc.moveOutputUp}
                title={loc.moveOutputUp}
                disabled={disabled || index === 0}
                onClick={() => move(-1)}>
                ↑
            </button>
            <button
                type="button"
                className="rbs-btn rbs-btn-quiet rbs-layout-move"
                aria-label={loc.moveOutputDown}
                title={loc.moveOutputDown}
                disabled={disabled || index === siblings.length - 1}
                onClick={() => move(1)}>
                ↓
            </button>
            <button
                type="button"
                className="rbs-link-button"
                disabled={disabled}
                onClick={() => commit({ hidden: true })}>
                {loc.hideOutput}
            </button>
        </div>
    );
}

type DerivedTransformKind =
    | "top-rows"
    | "select"
    | "rename"
    | "filter"
    | "aggregate"
    | "pivot"
    | "to-timeseries";
type FilterOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "is-null" | "not-null";
type ScalarKind = "string" | "number" | "boolean" | "null";

interface DerivedDraftRow {
    key: string;
}

interface DerivedSortDraft extends DerivedDraftRow {
    field: string;
    direction: "asc" | "desc";
}

interface DerivedRenameDraft extends DerivedDraftRow {
    from: string;
    to: string;
}

interface DerivedFilterDraft extends DerivedDraftRow {
    field: string;
    operator: FilterOperator;
    value: string;
    valueKind: ScalarKind;
}

interface DerivedMeasureDraft extends DerivedDraftRow {
    field: string;
    fn: AggregateFunction;
    as: string;
}

interface DerivedSourceDraft {
    editingId?: string;
    renamingFrom?: string;
    id: string;
    sourceKey: string;
    transform: DerivedTransformKind;
    selectedColumns: string;
    renames: DerivedRenameDraft[];
    filterMatch: "and" | "or";
    filterNegated: boolean;
    filters: DerivedFilterDraft[];
    sorts: DerivedSortDraft[];
    limit: number;
    groupBy: string;
    measures: DerivedMeasureDraft[];
    pivotIndex: string;
    pivotColumn: string;
    pivotValue: string;
    pivotReducer: AggregateFunction;
    timeField: string;
    measureFields: string;
}

let derivedDraftRowSequence = 0;

function draftRowKey(): string {
    derivedDraftRowSequence++;
    return `derived-draft-row-${derivedDraftRowSequence}`;
}

function defaultDerivedSourceDraft(
    id = "",
    sourceKey = "",
    editingId?: string,
    renamingFrom?: string,
): DerivedSourceDraft {
    return {
        ...(editingId ? { editingId } : {}),
        ...(renamingFrom ? { renamingFrom } : {}),
        id,
        sourceKey,
        transform: "top-rows",
        selectedColumns: "",
        renames: [{ key: draftRowKey(), from: "", to: "" }],
        filterMatch: "and",
        filterNegated: false,
        filters: [
            {
                key: draftRowKey(),
                field: "",
                operator: "eq",
                value: "",
                valueKind: "string",
            },
        ],
        sorts: [{ key: draftRowKey(), field: "", direction: "desc" }],
        limit: 100,
        groupBy: "",
        measures: [{ key: draftRowKey(), field: "", fn: "count", as: "count" }],
        pivotIndex: "",
        pivotColumn: "",
        pivotValue: "",
        pivotReducer: "sum",
        timeField: "",
        measureFields: "",
    };
}

function fieldList(value: string): string[] {
    return value
        .split(",")
        .map((field) => field.trim())
        .filter(Boolean);
}

function scalarKind(value: JsonScalar): ScalarKind {
    if (value === null) {
        return "null";
    }
    if (typeof value === "number") {
        return "number";
    }
    return typeof value === "boolean" ? "boolean" : "string";
}

function scalarText(value: JsonScalar): string {
    return value === null ? "" : String(value);
}

function parseScalar(value: string, kind: ScalarKind): JsonScalar | undefined {
    if (kind === "null") {
        return null;
    }
    if (kind === "string") {
        return value.length <= 4096 ? value : undefined;
    }
    if (kind === "boolean") {
        return value === "true" ? true : value === "false" ? false : undefined;
    }
    const number = Number(value);
    return value.trim().length > 0 && Number.isFinite(number) ? number : undefined;
}

function predicateLeafDraft(predicate: PresentationPredicate): DerivedFilterDraft | undefined {
    if (predicate.op === "and" || predicate.op === "or" || predicate.op === "not") {
        return undefined;
    }
    if (predicate.op === "is-null" || predicate.op === "not-null") {
        return {
            key: draftRowKey(),
            field: predicate.field,
            operator: predicate.op,
            value: "",
            valueKind: "null",
        };
    }
    if (predicate.op === "in") {
        if (predicate.values.length === 0) {
            return undefined;
        }
        const kind = scalarKind(predicate.values[0]);
        if (
            predicate.values.some(
                (value) =>
                    scalarKind(value) !== kind ||
                    (typeof value === "string" && value.includes(",")),
            )
        ) {
            return undefined;
        }
        return {
            key: draftRowKey(),
            field: predicate.field,
            operator: "in",
            value: predicate.values.map(scalarText).join(", "),
            valueKind: kind,
        };
    }
    if (!("field" in predicate) || !("value" in predicate)) {
        return undefined;
    }
    return {
        key: draftRowKey(),
        field: predicate.field,
        operator: predicate.op,
        value: scalarText(predicate.value),
        valueKind: scalarKind(predicate.value),
    };
}

function filterDraft(
    predicate: PresentationPredicate,
): Pick<DerivedSourceDraft, "filterMatch" | "filterNegated" | "filters"> | undefined {
    let current = predicate;
    let filterNegated = false;
    if (current.op === "not") {
        filterNegated = true;
        current = current.child;
    }
    const filterMatch = current.op === "or" ? "or" : "and";
    const predicates = current.op === "and" || current.op === "or" ? current.children : [current];
    const filters = predicates.map(predicateLeafDraft);
    return filters.some((filter) => filter === undefined)
        ? undefined
        : {
              filterMatch,
              filterNegated,
              filters: filters as DerivedFilterDraft[],
          };
}

function editableDerivedSourceDraft(
    source: DerivedSourceAuthoringEdit,
    sourceKey: string,
    renamingFrom?: string,
): DerivedSourceDraft | undefined {
    const base = defaultDerivedSourceDraft(source.id, sourceKey, source.id, renamingFrom);
    const [only] = source.pipeline.steps;
    const sorts = source.pipeline.steps.filter((step) => step.op === "sort");
    const limits = source.pipeline.steps.filter((step) => step.op === "limit");
    if (
        source.pipeline.steps.length > 0 &&
        source.pipeline.steps.length <= 2 &&
        source.pipeline.steps.every((step) => step.op === "sort" || step.op === "limit") &&
        sorts.length <= 1 &&
        limits.length === 1
    ) {
        return {
            ...base,
            transform: "top-rows",
            sorts: sorts[0]?.by.map((sort) => ({ key: draftRowKey(), ...sort })) ?? [
                { key: draftRowKey(), field: "", direction: "desc" },
            ],
            limit: limits[0].count,
        };
    }
    if (source.pipeline.steps.length !== 1 || !only) {
        return undefined;
    }
    switch (only.op) {
        case "select":
            return { ...base, transform: "select", selectedColumns: only.columns.join(", ") };
        case "rename":
            return {
                ...base,
                transform: "rename",
                renames: Object.entries(only.columns).map(([from, to]) => ({
                    key: draftRowKey(),
                    from,
                    to,
                })),
            };
        case "filter": {
            const filter = filterDraft(only.predicate);
            return filter ? { ...base, transform: "filter", ...filter } : undefined;
        }
        case "aggregate":
            return {
                ...base,
                transform: "aggregate",
                groupBy: only.by.join(", "),
                measures: only.measures.map((measure) => ({
                    key: draftRowKey(),
                    field: measure.field ?? "",
                    fn: measure.fn,
                    as: measure.as,
                })),
            };
        case "pivot":
            return {
                ...base,
                transform: "pivot",
                pivotIndex: only.index.join(", "),
                pivotColumn: only.column,
                pivotValue: only.value,
                pivotReducer: only.reducer,
            };
        case "to-timeseries":
            return {
                ...base,
                transform: "to-timeseries",
                timeField: only.timeField,
                measureFields: only.measureFields.join(", "),
            };
        case "sort":
        case "limit":
            return undefined;
    }
}

function filterPredicate(draft: DerivedSourceDraft): PresentationPredicate | undefined {
    const predicates = draft.filters.map((filter): PresentationPredicate | undefined => {
        const field = filter.field.trim();
        if (!field) {
            return undefined;
        }
        if (filter.operator === "is-null" || filter.operator === "not-null") {
            return { op: filter.operator, field };
        }
        if (filter.operator === "in") {
            const values = filter.value
                .split(",")
                .map((value) =>
                    parseScalar(
                        filter.valueKind === "string" ? value.trim() : value.trim(),
                        filter.valueKind,
                    ),
                );
            return values.length > 0 && values.every((value) => value !== undefined)
                ? { op: "in", field, values: values as JsonScalar[] }
                : undefined;
        }
        const value = parseScalar(filter.value, filter.valueKind);
        return value === undefined ? undefined : { op: filter.operator, field, value };
    });
    if (predicates.length === 0 || predicates.some((predicate) => predicate === undefined)) {
        return undefined;
    }
    const children = predicates as PresentationPredicate[];
    const combined: PresentationPredicate =
        children.length === 1 ? children[0] : { op: draft.filterMatch, children };
    return draft.filterNegated ? { op: "not", child: combined } : combined;
}

function derivedTransformSteps(draft: DerivedSourceDraft): TransformOp[] | undefined {
    switch (draft.transform) {
        case "top-rows": {
            if (!Number.isInteger(draft.limit) || draft.limit < 1 || draft.limit > 10_000) {
                return undefined;
            }
            const by: SortSpec[] = draft.sorts
                .filter((sort) => sort.field.trim())
                .map((sort) => ({ field: sort.field.trim(), direction: sort.direction }));
            return [
                ...(by.length > 0 ? [{ op: "sort" as const, by }] : []),
                { op: "limit", count: draft.limit },
            ];
        }
        case "select":
            return [{ op: "select", columns: fieldList(draft.selectedColumns) }];
        case "rename": {
            const renames = draft.renames.map((rename) => [rename.from.trim(), rename.to.trim()]);
            if (new Set(renames.map(([from]) => from)).size !== renames.length) {
                return undefined;
            }
            return [
                {
                    op: "rename",
                    columns: Object.fromEntries(renames),
                },
            ];
        }
        case "filter": {
            const predicate = filterPredicate(draft);
            return predicate ? [{ op: "filter", predicate }] : undefined;
        }
        case "aggregate":
            return [
                {
                    op: "aggregate",
                    by: fieldList(draft.groupBy),
                    measures: draft.measures.map((measure) => ({
                        ...(measure.field.trim() ? { field: measure.field.trim() } : {}),
                        fn: measure.fn,
                        as: measure.as.trim(),
                    })),
                },
            ];
        case "pivot":
            return [
                {
                    op: "pivot",
                    index: fieldList(draft.pivotIndex),
                    column: draft.pivotColumn.trim(),
                    value: draft.pivotValue.trim(),
                    reducer: draft.pivotReducer,
                },
            ];
        case "to-timeseries":
            return [
                {
                    op: "to-timeseries",
                    timeField: draft.timeField.trim(),
                    measureFields: fieldList(draft.measureFields),
                },
            ];
    }
}

function OutputsDrawer({
    presentation,
    layoutEdits = [],
    branchNotTakenNodeIds = [],
    onLayoutEdits,
    editingDisabled = false,
}: {
    presentation: ResolvedPresentation;
    layoutEdits?: PresentationLayoutEdit[];
    branchNotTakenNodeIds?: string[];
    onLayoutEdits?: (edits: PresentationLayoutEdit[]) => void;
    editingDisabled?: boolean;
}) {
    const { state } = useRbs();
    const loc = locConstants.runbookStudio;
    const sections = state?.artifact?.presentationSections ?? [];
    const [derivedDraft, setDerivedDraft] = useState<DerivedSourceDraft>();
    const resolvedWidgets = presentation.sections.flatMap((section) => section.widgets);
    const branchNotTakenNodes = new Set(branchNotTakenNodeIds);
    const activityOutputs = (state?.artifact?.nodes ?? [])
        .map((node) => ({
            layoutId: node.id,
            label: node.label,
            contract: expectedContractFor(node.kind, node.activityKind),
            source: {
                kind: "activity-output",
                nodeId: node.id,
                slot: "primary",
            } satisfies PresentationSourceRef,
            branchNotTaken: branchNotTakenNodes.has(node.id),
        }))
        .filter(
            (entry): entry is typeof entry & { contract: string } => entry.contract !== undefined,
        );
    const persistedWidgets = state?.artifact?.presentationWidgets ?? [];
    const effectiveDerivedSourcesById = new Map(
        (state?.artifact?.derivedSources ?? []).map((source) => [source.id, source]),
    );
    const renamedDerivedSourceIds = new Map<string, string>();
    for (const edit of layoutEdits) {
        if (edit.removeDerivedSourceId) {
            effectiveDerivedSourcesById.delete(edit.removeDerivedSourceId);
        } else if (edit.derivedSource) {
            if (edit.renameDerivedSourceFrom) {
                effectiveDerivedSourcesById.delete(edit.renameDerivedSourceFrom);
                renamedDerivedSourceIds.set(edit.renameDerivedSourceFrom, edit.derivedSource.id);
            }
            effectiveDerivedSourcesById.set(edit.derivedSource.id, edit.derivedSource);
        }
    }
    const effectiveDerivedSources = [...effectiveDerivedSourcesById.values()].map((source) => {
        const renamedParent =
            source.from.kind === "derived"
                ? renamedDerivedSourceIds.get(source.from.sourceId)
                : undefined;
        return renamedParent
            ? {
                  ...source,
                  from: { kind: "derived" as const, sourceId: renamedParent },
              }
            : source;
    });
    const renameOriginFor = (sourceId: string) =>
        layoutEdits.find((edit) => edit.derivedSource?.id === sourceId)?.renameDerivedSourceFrom;
    const sourceSummary = (
        source: PresentationSourceRef,
    ): PresentationWidgetSummary | undefined => {
        const persisted = persistedWidgets.find((summary) =>
            presentationSourcesMatch(summary.source, source),
        );
        if (persisted) {
            return persisted;
        }
        const edit = layoutEdits.find(
            (candidate) =>
                !candidate.removeDerivedSourceId &&
                candidate.source !== undefined &&
                presentationSourcesMatch(candidate.source, source),
        );
        if (!edit) {
            return undefined;
        }
        const resolved = resolvedWidgets.find((widget) =>
            presentationSourcesMatch(widget.source, source),
        );
        const widgetId = edit.widgetId ?? resolved?.id ?? `layout-${edit.nodeId}`;
        return {
            layoutId: resolved?.id ?? edit.nodeId,
            widgetId,
            source,
            defaultView: edit.defaultView,
            sectionId: edit.sectionId,
            placement: edit.placement,
            hidden: edit.hidden,
            ...(edit.derivedSource ? { derivedSource: edit.derivedSource } : {}),
        };
    };
    const runFields = [
        { field: "status" as const, label: loc.runStatusSource },
        { field: "verdict" as const, label: loc.runVerdictSource },
        { field: "elapsedMs" as const, label: loc.runElapsedSource },
        { field: "completedNodeCount" as const, label: loc.completedStepsSource },
        { field: "totalNodeCount" as const, label: loc.totalStepsSource },
    ].map(({ field, label }) => {
        const source = { kind: "run-field", field } satisfies PresentationSourceRef;
        return {
            layoutId: sourceSummary(source)?.layoutId ?? `run-field:${field}`,
            label,
            contract: "scalarSet/1",
            source,
            branchNotTaken: false,
        };
    });
    const metricKeys = new Set([
        ...Object.keys(state?.run?.runMetrics ?? {}),
        ...persistedWidgets.flatMap((summary) =>
            summary.source.kind === "run-metric" ? [summary.source.key] : [],
        ),
    ]);
    const runMetrics = [...metricKeys].sort().map((key) => {
        const source = { kind: "run-metric", key } satisfies PresentationSourceRef;
        return {
            layoutId: sourceSummary(source)?.layoutId ?? `run-metric:${key}`,
            label: loc.runtimeMetricSource(key),
            contract: "scalarSet/1",
            source,
            branchNotTaken: false,
        };
    });
    const derivedSources = effectiveDerivedSources.map((derived) => {
        const source = {
            kind: "derived",
            sourceId: derived.id,
        } satisfies PresentationSourceRef;
        return {
            layoutId: sourceSummary(source)?.layoutId ?? `derived:${derived.id}`,
            label: loc.derivedSource(derived.id),
            contract: derived.authoredContract,
            source,
            branchNotTaken: false,
            derived,
        };
    });
    const outputs = [...activityOutputs, ...runFields, ...runMetrics, ...derivedSources];
    const derivedSourceOptions = [
        ...activityOutputs
            .filter((output) => output.contract === "rowset/1")
            .map((output) => ({
                key: `activity:${output.source.nodeId}`,
                label: output.label,
                source: output.source,
                contract: output.contract,
            })),
        ...effectiveDerivedSources
            .filter(
                (derived) =>
                    derived.authoredContract === "rowset/1" &&
                    derived.id !== derivedDraft?.editingId,
            )
            .map((derived) => ({
                key: `derived:${derived.id}`,
                label: loc.derivedSource(derived.id),
                source: {
                    kind: "derived",
                    sourceId: derived.id,
                } satisfies PresentationSourceRef,
                contract: derived.authoredContract,
            })),
    ];

    const beginDerivedSource = (derived?: DerivedSourceAuthoringEdit) => {
        if (derived) {
            const sourceKey =
                derived.from.kind === "activity-output"
                    ? `activity:${derived.from.nodeId}`
                    : derived.from.kind === "derived"
                      ? `derived:${derived.from.sourceId}`
                      : "";
            const draft = editableDerivedSourceDraft(
                derived,
                sourceKey,
                renameOriginFor(derived.id),
            );
            if (draft) {
                setDerivedDraft(draft);
            }
            return;
        }
        setDerivedDraft(defaultDerivedSourceDraft("", derivedSourceOptions[0]?.key ?? ""));
    };

    const stageDerivedSource = () => {
        if (!derivedDraft) {
            return;
        }
        const id = derivedDraft.id.trim();
        const from = derivedSourceOptions.find((option) => option.key === derivedDraft.sourceKey);
        if (
            !id ||
            id.length > 256 ||
            !from ||
            (!derivedDraft.editingId && effectiveDerivedSources.some((source) => source.id === id))
        ) {
            return;
        }
        const source = { kind: "derived", sourceId: id } satisfies PresentationSourceRef;
        const priorSource = {
            kind: "derived",
            sourceId: derivedDraft.renamingFrom ?? derivedDraft.editingId ?? id,
        } satisfies PresentationSourceRef;
        const summary = sourceSummary(priorSource);
        const resolved = resolvedWidgets.find((widget) =>
            presentationSourcesMatch(widget.source, priorSource),
        );
        const steps = derivedTransformSteps(derivedDraft);
        const definition = steps
            ? buildDerivedSource(id, from.source, from.contract, steps)
            : undefined;
        if (!definition) {
            return;
        }
        onLayoutEdits?.([
            {
                nodeId: summary?.layoutId ?? `derived:${id}`,
                ...(summary?.widgetId ? { widgetId: summary.widgetId } : {}),
                source,
                derivedSource: definition,
                ...((derivedDraft.renamingFrom ?? derivedDraft.editingId) &&
                (derivedDraft.renamingFrom ?? derivedDraft.editingId) !== id
                    ? {
                          renameDerivedSourceFrom:
                              derivedDraft.renamingFrom ?? derivedDraft.editingId,
                      }
                    : {}),
                defaultView:
                    summary?.defaultView ?? resolved?.view ?? defaultViewFor(from.contract),
                sectionId: resolved?.sectionId ?? summary?.sectionId ?? "primary",
                placement: resolved?.placement ??
                    summary?.placement ?? {
                        order: outputs.length,
                        span: PRESENTATION_SPAN_PRESETS.full,
                    },
                hidden: false,
            },
        ]);
        setDerivedDraft(undefined);
    };
    const selectedDerivedSource = derivedDraft
        ? derivedSourceOptions.find((option) => option.key === derivedDraft.sourceKey)
        : undefined;
    const duplicateDerivedId =
        derivedDraft !== undefined &&
        effectiveDerivedSources.some(
            (source) =>
                source.id === derivedDraft.id.trim() && source.id !== derivedDraft.editingId,
        );
    const candidateDerivedSource =
        derivedDraft && selectedDerivedSource
            ? (() => {
                  const steps = derivedTransformSteps(derivedDraft);
                  return steps
                      ? buildDerivedSource(
                            derivedDraft.id,
                            selectedDerivedSource.source,
                            selectedDerivedSource.contract,
                            steps,
                        )
                      : undefined;
              })()
            : undefined;
    const canStageDerived = candidateDerivedSource !== undefined && !duplicateDerivedId;

    const removeDerivedSource = (derived: DerivedSourceAuthoringEdit) => {
        const persistedId = renameOriginFor(derived.id) ?? derived.id;
        const source = {
            kind: "derived",
            sourceId: persistedId,
        } satisfies PresentationSourceRef;
        const summary = sourceSummary(source);
        const resolved = resolvedWidgets.find((widget) =>
            presentationSourcesMatch(widget.source, source),
        );
        onLayoutEdits?.([
            {
                nodeId: summary?.layoutId ?? `derived:${persistedId}`,
                ...(summary?.widgetId ? { widgetId: summary.widgetId } : {}),
                source,
                removeDerivedSourceId: persistedId,
                defaultView: summary?.defaultView ?? resolved?.view ?? defaultViewFor("rowset/1"),
                sectionId: resolved?.sectionId ?? summary?.sectionId ?? "primary",
                placement: resolved?.placement ??
                    summary?.placement ?? {
                        order: outputs.length,
                        span: PRESENTATION_SPAN_PRESETS.full,
                    },
                hidden: true,
            },
        ]);
        if (derivedDraft?.editingId === derived.id) {
            setDerivedDraft(undefined);
        }
    };

    const update = (output: (typeof outputs)[number], hidden: boolean, sectionId?: string) => {
        const outputDerived = "derived" in output ? output.derived : undefined;
        const summary = sourceSummary(output.source);
        const configured =
            output.source.kind === "activity-output"
                ? state?.artifact?.outputPresentations?.[output.source.nodeId]
                : undefined;
        const resolved = resolvedWidgets.find(
            (widget) =>
                presentationSourcesMatch(widget.source, output.source) ||
                (output.source.kind === "activity-output" &&
                    widget.nodeId === output.source.nodeId),
        );
        onLayoutEdits?.([
            {
                nodeId: summary?.layoutId ?? output.layoutId,
                ...(summary?.widgetId || configured?.widgetId
                    ? { widgetId: summary?.widgetId ?? configured?.widgetId }
                    : {}),
                source: output.source,
                ...(summary?.derivedSource || outputDerived
                    ? { derivedSource: summary?.derivedSource ?? outputDerived }
                    : {}),
                defaultView:
                    summary?.defaultView ??
                    configured?.defaultView ??
                    resolved?.view ??
                    defaultViewFor(output.contract),
                sectionId:
                    sectionId ??
                    resolved?.sectionId ??
                    summary?.sectionId ??
                    configured?.sectionId ??
                    "primary",
                placement: resolved?.placement ??
                    summary?.placement ??
                    configured?.placement ?? {
                        order: outputs.findIndex((entry) => entry.layoutId === output.layoutId),
                        span: PRESENTATION_SPAN_PRESETS.full,
                    },
                hidden,
            },
        ]);
    };

    return (
        <aside className="rbs-outputs-drawer" aria-label={loc.outputsDrawer}>
            <h2>{loc.outputsDrawer}</h2>
            <p className="rbs-muted">{loc.outputsDrawerDetail}</p>
            <div className="rbs-outputs-list">
                {outputs.map((output) => {
                    const outputDerived = "derived" in output ? output.derived : undefined;
                    const summary = sourceSummary(output.source);
                    const configured =
                        output.source.kind === "activity-output"
                            ? state?.artifact?.outputPresentations?.[output.source.nodeId]
                            : undefined;
                    const resolved = resolvedWidgets.find(
                        (widget) =>
                            presentationSourcesMatch(widget.source, output.source) ||
                            (output.source.kind === "activity-output" &&
                                widget.nodeId === output.source.nodeId),
                    );
                    const hidden = !resolved && !output.branchNotTaken;
                    const editableDerived = outputDerived
                        ? editableDerivedSourceDraft(
                              outputDerived,
                              outputDerived.from.kind === "activity-output"
                                  ? `activity:${outputDerived.from.nodeId}`
                                  : outputDerived.from.kind === "derived"
                                    ? `derived:${outputDerived.from.sourceId}`
                                    : "",
                              renameOriginFor(outputDerived.id),
                          )
                        : undefined;
                    const hasDerivedDependents = outputDerived
                        ? effectiveDerivedSources.some(
                              (candidate) =>
                                  candidate.from.kind === "derived" &&
                                  candidate.from.sourceId === outputDerived.id,
                          )
                        : false;
                    return (
                        <div className="rbs-output-row" key={output.layoutId}>
                            <div>
                                <strong>{output.label}</strong>
                                <div className="rbs-chip rbs-mono">{output.contract}</div>
                            </div>
                            <select
                                className="rbs-select"
                                aria-label={loc.layoutSectionFor(output.label)}
                                value={
                                    resolved?.sectionId ??
                                    summary?.sectionId ??
                                    configured?.sectionId ??
                                    "primary"
                                }
                                disabled={editingDisabled || hidden || output.branchNotTaken}
                                onChange={(event) => update(output, false, event.target.value)}>
                                {sections.map((section) => (
                                    <option key={section.id} value={section.id}>
                                        {section.label ?? section.role}
                                    </option>
                                ))}
                            </select>
                            <button
                                type="button"
                                className="rbs-btn rbs-btn-quiet"
                                disabled={editingDisabled || output.branchNotTaken}
                                onClick={() => update(output, !hidden)}>
                                {output.branchNotTaken
                                    ? loc.branchNotTaken
                                    : hidden
                                      ? loc.showOutput
                                      : loc.hideOutput}
                            </button>
                            {editableDerived ? (
                                <button
                                    type="button"
                                    className="rbs-link-button"
                                    disabled={editingDisabled}
                                    onClick={() => beginDerivedSource(outputDerived)}>
                                    {loc.editDerivedSource}
                                </button>
                            ) : outputDerived ? (
                                <span className="rbs-muted">{loc.advancedDerivedSource}</span>
                            ) : null}
                            {outputDerived ? (
                                <button
                                    type="button"
                                    className="rbs-link-button"
                                    disabled={editingDisabled || hasDerivedDependents}
                                    title={
                                        hasDerivedDependents
                                            ? loc.removeDerivedSourceBlocked
                                            : loc.removeDerivedSource
                                    }
                                    onClick={() => removeDerivedSource(outputDerived)}>
                                    {loc.removeDerivedSource}
                                </button>
                            ) : null}
                        </div>
                    );
                })}
            </div>
            <div className="rbs-derived-builder">
                <h3>{loc.derivedView}</h3>
                {!derivedDraft ? (
                    <button
                        type="button"
                        className="rbs-btn rbs-btn-quiet"
                        disabled={editingDisabled || derivedSourceOptions.length === 0}
                        onClick={() => beginDerivedSource()}>
                        {loc.createDerivedView}
                    </button>
                ) : (
                    <>
                        <label>
                            <span>{loc.derivedSourceId}</span>
                            <input
                                className="rbs-input"
                                value={derivedDraft.id}
                                maxLength={256}
                                disabled={editingDisabled}
                                onChange={(event) =>
                                    setDerivedDraft({ ...derivedDraft, id: event.target.value })
                                }
                            />
                        </label>
                        {derivedDraft.editingId ? (
                            <span className="rbs-muted">{loc.renameDerivedSourceHint}</span>
                        ) : null}
                        <label>
                            <span>{loc.derivedFrom}</span>
                            <select
                                className="rbs-select"
                                value={derivedDraft.sourceKey}
                                disabled={editingDisabled}
                                onChange={(event) =>
                                    setDerivedDraft({
                                        ...derivedDraft,
                                        sourceKey: event.target.value,
                                    })
                                }>
                                {derivedSourceOptions.map((option) => (
                                    <option key={option.key} value={option.key}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            <span>{loc.transformOperation}</span>
                            <select
                                className="rbs-select"
                                value={derivedDraft.transform}
                                disabled={editingDisabled}
                                onChange={(event) =>
                                    setDerivedDraft({
                                        ...derivedDraft,
                                        transform: event.target.value as DerivedTransformKind,
                                    })
                                }>
                                <option value="top-rows">{loc.topRows}</option>
                                <option value="select">{loc.selectColumns}</option>
                                <option value="rename">{loc.renameColumns}</option>
                                <option value="filter">{loc.filterRows}</option>
                                <option value="aggregate">{loc.summarizeRows}</option>
                                <option value="pivot">{loc.pivotRows}</option>
                                <option value="to-timeseries">{loc.timeSeries}</option>
                            </select>
                        </label>
                        {derivedDraft.transform === "top-rows" ? (
                            <>
                                <span className="rbs-derived-field-label">
                                    {loc.sortFieldsOptional}
                                </span>
                                {derivedDraft.sorts.map((sort, index) => (
                                    <div className="rbs-derived-operation-row" key={sort.key}>
                                        <label>
                                            <span>{loc.field}</span>
                                            <input
                                                className="rbs-input"
                                                value={sort.field}
                                                maxLength={256}
                                                disabled={editingDisabled}
                                                onChange={(event) => {
                                                    const sorts = [...derivedDraft.sorts];
                                                    sorts[index] = {
                                                        ...sort,
                                                        field: event.target.value,
                                                    };
                                                    setDerivedDraft({ ...derivedDraft, sorts });
                                                }}
                                            />
                                        </label>
                                        <label>
                                            <span>{loc.sortDirection}</span>
                                            <select
                                                className="rbs-select"
                                                value={sort.direction}
                                                disabled={editingDisabled || !sort.field.trim()}
                                                onChange={(event) => {
                                                    const sorts = [...derivedDraft.sorts];
                                                    sorts[index] = {
                                                        ...sort,
                                                        direction: event.target.value as
                                                            | "asc"
                                                            | "desc",
                                                    };
                                                    setDerivedDraft({ ...derivedDraft, sorts });
                                                }}>
                                                <option value="desc">{loc.descending}</option>
                                                <option value="asc">{loc.ascending}</option>
                                            </select>
                                        </label>
                                        <button
                                            type="button"
                                            className="rbs-link-button"
                                            disabled={editingDisabled}
                                            onClick={() =>
                                                setDerivedDraft({
                                                    ...derivedDraft,
                                                    sorts: derivedDraft.sorts.filter(
                                                        (candidate) => candidate.key !== sort.key,
                                                    ),
                                                })
                                            }>
                                            {loc.removeSort}
                                        </button>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    className="rbs-link-button rbs-derived-add"
                                    disabled={editingDisabled || derivedDraft.sorts.length >= 100}
                                    onClick={() =>
                                        setDerivedDraft({
                                            ...derivedDraft,
                                            sorts: [
                                                ...derivedDraft.sorts,
                                                {
                                                    key: draftRowKey(),
                                                    field: "",
                                                    direction: "desc",
                                                },
                                            ],
                                        })
                                    }>
                                    {loc.addSort}
                                </button>
                                <label>
                                    <span>{loc.maximumRows}</span>
                                    <input
                                        className="rbs-input"
                                        type="number"
                                        min={0}
                                        max={10_000}
                                        value={derivedDraft.limit}
                                        disabled={editingDisabled}
                                        onChange={(event) =>
                                            setDerivedDraft({
                                                ...derivedDraft,
                                                limit: Number(event.target.value),
                                            })
                                        }
                                    />
                                </label>
                            </>
                        ) : null}
                        {derivedDraft.transform === "select" ? (
                            <label>
                                <span>{loc.columnsCommaSeparated}</span>
                                <input
                                    className="rbs-input"
                                    value={derivedDraft.selectedColumns}
                                    disabled={editingDisabled}
                                    onChange={(event) =>
                                        setDerivedDraft({
                                            ...derivedDraft,
                                            selectedColumns: event.target.value,
                                        })
                                    }
                                />
                            </label>
                        ) : null}
                        {derivedDraft.transform === "rename" ? (
                            <>
                                {derivedDraft.renames.map((rename, index) => (
                                    <div className="rbs-derived-operation-row" key={rename.key}>
                                        <label>
                                            <span>{loc.sourceColumn}</span>
                                            <input
                                                className="rbs-input"
                                                value={rename.from}
                                                maxLength={256}
                                                disabled={editingDisabled}
                                                onChange={(event) => {
                                                    const renames = [...derivedDraft.renames];
                                                    renames[index] = {
                                                        ...rename,
                                                        from: event.target.value,
                                                    };
                                                    setDerivedDraft({ ...derivedDraft, renames });
                                                }}
                                            />
                                        </label>
                                        <label>
                                            <span>{loc.outputColumn}</span>
                                            <input
                                                className="rbs-input"
                                                value={rename.to}
                                                maxLength={256}
                                                disabled={editingDisabled}
                                                onChange={(event) => {
                                                    const renames = [...derivedDraft.renames];
                                                    renames[index] = {
                                                        ...rename,
                                                        to: event.target.value,
                                                    };
                                                    setDerivedDraft({ ...derivedDraft, renames });
                                                }}
                                            />
                                        </label>
                                        <button
                                            type="button"
                                            className="rbs-link-button"
                                            disabled={
                                                editingDisabled || derivedDraft.renames.length === 1
                                            }
                                            onClick={() =>
                                                setDerivedDraft({
                                                    ...derivedDraft,
                                                    renames: derivedDraft.renames.filter(
                                                        (candidate) => candidate.key !== rename.key,
                                                    ),
                                                })
                                            }>
                                            {loc.removeRename}
                                        </button>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    className="rbs-link-button rbs-derived-add"
                                    disabled={editingDisabled || derivedDraft.renames.length >= 100}
                                    onClick={() =>
                                        setDerivedDraft({
                                            ...derivedDraft,
                                            renames: [
                                                ...derivedDraft.renames,
                                                { key: draftRowKey(), from: "", to: "" },
                                            ],
                                        })
                                    }>
                                    {loc.addRename}
                                </button>
                            </>
                        ) : null}
                        {derivedDraft.transform === "filter" ? (
                            <>
                                <div className="rbs-derived-compact-row">
                                    <label>
                                        <span>{loc.matchConditions}</span>
                                        <select
                                            className="rbs-select"
                                            value={derivedDraft.filterMatch}
                                            disabled={editingDisabled}
                                            onChange={(event) =>
                                                setDerivedDraft({
                                                    ...derivedDraft,
                                                    filterMatch: event.target.value as "and" | "or",
                                                })
                                            }>
                                            <option value="and">{loc.matchAll}</option>
                                            <option value="or">{loc.matchAny}</option>
                                        </select>
                                    </label>
                                    <label className="rbs-check-row">
                                        <input
                                            type="checkbox"
                                            checked={derivedDraft.filterNegated}
                                            disabled={editingDisabled}
                                            onChange={(event) =>
                                                setDerivedDraft({
                                                    ...derivedDraft,
                                                    filterNegated: event.target.checked,
                                                })
                                            }
                                        />
                                        <span>{loc.negateFilter}</span>
                                    </label>
                                </div>
                                {derivedDraft.filters.map((filter, index) => (
                                    <div className="rbs-derived-operation-row" key={filter.key}>
                                        <label>
                                            <span>{loc.field}</span>
                                            <input
                                                className="rbs-input"
                                                value={filter.field}
                                                maxLength={256}
                                                disabled={editingDisabled}
                                                onChange={(event) => {
                                                    const filters = [...derivedDraft.filters];
                                                    filters[index] = {
                                                        ...filter,
                                                        field: event.target.value,
                                                    };
                                                    setDerivedDraft({ ...derivedDraft, filters });
                                                }}
                                            />
                                        </label>
                                        <label>
                                            <span>{loc.operator}</span>
                                            <select
                                                className="rbs-select"
                                                value={filter.operator}
                                                disabled={editingDisabled}
                                                onChange={(event) => {
                                                    const filters = [...derivedDraft.filters];
                                                    filters[index] = {
                                                        ...filter,
                                                        operator: event.target
                                                            .value as FilterOperator,
                                                    };
                                                    setDerivedDraft({ ...derivedDraft, filters });
                                                }}>
                                                <option value="eq">{loc.equals}</option>
                                                <option value="ne">{loc.notEquals}</option>
                                                <option value="gt">{loc.greaterThan}</option>
                                                <option value="gte">
                                                    {loc.greaterThanOrEqual}
                                                </option>
                                                <option value="lt">{loc.lessThan}</option>
                                                <option value="lte">{loc.lessThanOrEqual}</option>
                                                <option value="in">{loc.inList}</option>
                                                <option value="is-null">{loc.isNull}</option>
                                                <option value="not-null">{loc.isNotNull}</option>
                                            </select>
                                        </label>
                                        {filter.operator !== "is-null" &&
                                        filter.operator !== "not-null" ? (
                                            <>
                                                <label>
                                                    <span>{loc.valueType}</span>
                                                    <select
                                                        className="rbs-select"
                                                        value={filter.valueKind}
                                                        disabled={editingDisabled}
                                                        onChange={(event) => {
                                                            const filters = [
                                                                ...derivedDraft.filters,
                                                            ];
                                                            filters[index] = {
                                                                ...filter,
                                                                valueKind: event.target
                                                                    .value as ScalarKind,
                                                            };
                                                            setDerivedDraft({
                                                                ...derivedDraft,
                                                                filters,
                                                            });
                                                        }}>
                                                        <option value="string">
                                                            {loc.stringValue}
                                                        </option>
                                                        <option value="number">
                                                            {loc.numberValue}
                                                        </option>
                                                        <option value="boolean">
                                                            {loc.booleanValue}
                                                        </option>
                                                        <option value="null">
                                                            {loc.nullValue}
                                                        </option>
                                                    </select>
                                                </label>
                                                {filter.valueKind !== "null" ? (
                                                    <label>
                                                        <span>
                                                            {filter.operator === "in"
                                                                ? loc.valuesCommaSeparated
                                                                : loc.value}
                                                        </span>
                                                        {filter.valueKind === "boolean" &&
                                                        filter.operator !== "in" ? (
                                                            <select
                                                                className="rbs-select"
                                                                value={filter.value}
                                                                disabled={editingDisabled}
                                                                onChange={(event) => {
                                                                    const filters = [
                                                                        ...derivedDraft.filters,
                                                                    ];
                                                                    filters[index] = {
                                                                        ...filter,
                                                                        value: event.target.value,
                                                                    };
                                                                    setDerivedDraft({
                                                                        ...derivedDraft,
                                                                        filters,
                                                                    });
                                                                }}>
                                                                <option value="">—</option>
                                                                <option value="true">
                                                                    {loc.trueValue}
                                                                </option>
                                                                <option value="false">
                                                                    {loc.falseValue}
                                                                </option>
                                                            </select>
                                                        ) : (
                                                            <input
                                                                className="rbs-input"
                                                                value={filter.value}
                                                                maxLength={4096}
                                                                disabled={editingDisabled}
                                                                onChange={(event) => {
                                                                    const filters = [
                                                                        ...derivedDraft.filters,
                                                                    ];
                                                                    filters[index] = {
                                                                        ...filter,
                                                                        value: event.target.value,
                                                                    };
                                                                    setDerivedDraft({
                                                                        ...derivedDraft,
                                                                        filters,
                                                                    });
                                                                }}
                                                            />
                                                        )}
                                                    </label>
                                                ) : null}
                                            </>
                                        ) : null}
                                        <button
                                            type="button"
                                            className="rbs-link-button"
                                            disabled={
                                                editingDisabled || derivedDraft.filters.length === 1
                                            }
                                            onClick={() =>
                                                setDerivedDraft({
                                                    ...derivedDraft,
                                                    filters: derivedDraft.filters.filter(
                                                        (candidate) => candidate.key !== filter.key,
                                                    ),
                                                })
                                            }>
                                            {loc.removeCondition}
                                        </button>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    className="rbs-link-button rbs-derived-add"
                                    disabled={editingDisabled || derivedDraft.filters.length >= 100}
                                    onClick={() =>
                                        setDerivedDraft({
                                            ...derivedDraft,
                                            filters: [
                                                ...derivedDraft.filters,
                                                {
                                                    key: draftRowKey(),
                                                    field: "",
                                                    operator: "eq",
                                                    value: "",
                                                    valueKind: "string",
                                                },
                                            ],
                                        })
                                    }>
                                    {loc.addCondition}
                                </button>
                            </>
                        ) : null}
                        {derivedDraft.transform === "aggregate" ? (
                            <>
                                <label>
                                    <span>{loc.groupByColumnsOptional}</span>
                                    <input
                                        className="rbs-input"
                                        value={derivedDraft.groupBy}
                                        disabled={editingDisabled}
                                        onChange={(event) =>
                                            setDerivedDraft({
                                                ...derivedDraft,
                                                groupBy: event.target.value,
                                            })
                                        }
                                    />
                                </label>
                                <span className="rbs-derived-field-label">{loc.measures}</span>
                                {derivedDraft.measures.map((measure, index) => (
                                    <div className="rbs-derived-operation-row" key={measure.key}>
                                        <label>
                                            <span>{loc.function}</span>
                                            <select
                                                className="rbs-select"
                                                value={measure.fn}
                                                disabled={editingDisabled}
                                                onChange={(event) => {
                                                    const measures = [...derivedDraft.measures];
                                                    measures[index] = {
                                                        ...measure,
                                                        fn: event.target.value as AggregateFunction,
                                                    };
                                                    setDerivedDraft({ ...derivedDraft, measures });
                                                }}>
                                                <option value="count">{loc.count}</option>
                                                <option value="count-distinct">
                                                    {loc.countDistinct}
                                                </option>
                                                <option value="sum">{loc.sum}</option>
                                                <option value="avg">{loc.average}</option>
                                                <option value="min">{loc.minimum}</option>
                                                <option value="max">{loc.maximum}</option>
                                            </select>
                                        </label>
                                        <label>
                                            <span>
                                                {measure.fn === "count"
                                                    ? loc.fieldOptional
                                                    : loc.field}
                                            </span>
                                            <input
                                                className="rbs-input"
                                                value={measure.field}
                                                maxLength={256}
                                                disabled={editingDisabled}
                                                onChange={(event) => {
                                                    const measures = [...derivedDraft.measures];
                                                    measures[index] = {
                                                        ...measure,
                                                        field: event.target.value,
                                                    };
                                                    setDerivedDraft({ ...derivedDraft, measures });
                                                }}
                                            />
                                        </label>
                                        <label>
                                            <span>{loc.outputColumn}</span>
                                            <input
                                                className="rbs-input"
                                                value={measure.as}
                                                maxLength={256}
                                                disabled={editingDisabled}
                                                onChange={(event) => {
                                                    const measures = [...derivedDraft.measures];
                                                    measures[index] = {
                                                        ...measure,
                                                        as: event.target.value,
                                                    };
                                                    setDerivedDraft({ ...derivedDraft, measures });
                                                }}
                                            />
                                        </label>
                                        <button
                                            type="button"
                                            className="rbs-link-button"
                                            disabled={
                                                editingDisabled ||
                                                derivedDraft.measures.length === 1
                                            }
                                            onClick={() =>
                                                setDerivedDraft({
                                                    ...derivedDraft,
                                                    measures: derivedDraft.measures.filter(
                                                        (candidate) =>
                                                            candidate.key !== measure.key,
                                                    ),
                                                })
                                            }>
                                            {loc.removeMeasure}
                                        </button>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    className="rbs-link-button rbs-derived-add"
                                    disabled={
                                        editingDisabled || derivedDraft.measures.length >= 100
                                    }
                                    onClick={() =>
                                        setDerivedDraft({
                                            ...derivedDraft,
                                            measures: [
                                                ...derivedDraft.measures,
                                                {
                                                    key: draftRowKey(),
                                                    field: "",
                                                    fn: "count",
                                                    as: "",
                                                },
                                            ],
                                        })
                                    }>
                                    {loc.addMeasure}
                                </button>
                            </>
                        ) : null}
                        {derivedDraft.transform === "pivot" ? (
                            <>
                                <label>
                                    <span>{loc.pivotIndexColumns}</span>
                                    <input
                                        className="rbs-input"
                                        value={derivedDraft.pivotIndex}
                                        disabled={editingDisabled}
                                        onChange={(event) =>
                                            setDerivedDraft({
                                                ...derivedDraft,
                                                pivotIndex: event.target.value,
                                            })
                                        }
                                    />
                                </label>
                                <label>
                                    <span>{loc.pivotColumn}</span>
                                    <input
                                        className="rbs-input"
                                        value={derivedDraft.pivotColumn}
                                        maxLength={256}
                                        disabled={editingDisabled}
                                        onChange={(event) =>
                                            setDerivedDraft({
                                                ...derivedDraft,
                                                pivotColumn: event.target.value,
                                            })
                                        }
                                    />
                                </label>
                                <label>
                                    <span>{loc.pivotValueColumn}</span>
                                    <input
                                        className="rbs-input"
                                        value={derivedDraft.pivotValue}
                                        maxLength={256}
                                        disabled={editingDisabled}
                                        onChange={(event) =>
                                            setDerivedDraft({
                                                ...derivedDraft,
                                                pivotValue: event.target.value,
                                            })
                                        }
                                    />
                                </label>
                                <label>
                                    <span>{loc.reducer}</span>
                                    <select
                                        className="rbs-select"
                                        value={derivedDraft.pivotReducer}
                                        disabled={editingDisabled}
                                        onChange={(event) =>
                                            setDerivedDraft({
                                                ...derivedDraft,
                                                pivotReducer: event.target
                                                    .value as AggregateFunction,
                                            })
                                        }>
                                        <option value="count">{loc.count}</option>
                                        <option value="count-distinct">{loc.countDistinct}</option>
                                        <option value="sum">{loc.sum}</option>
                                        <option value="avg">{loc.average}</option>
                                        <option value="min">{loc.minimum}</option>
                                        <option value="max">{loc.maximum}</option>
                                    </select>
                                </label>
                            </>
                        ) : null}
                        {derivedDraft.transform === "to-timeseries" ? (
                            <>
                                <label>
                                    <span>{loc.timeField}</span>
                                    <input
                                        className="rbs-input"
                                        value={derivedDraft.timeField}
                                        maxLength={256}
                                        disabled={editingDisabled}
                                        onChange={(event) =>
                                            setDerivedDraft({
                                                ...derivedDraft,
                                                timeField: event.target.value,
                                            })
                                        }
                                    />
                                </label>
                                <label>
                                    <span>{loc.measureFields}</span>
                                    <input
                                        className="rbs-input"
                                        value={derivedDraft.measureFields}
                                        disabled={editingDisabled}
                                        onChange={(event) =>
                                            setDerivedDraft({
                                                ...derivedDraft,
                                                measureFields: event.target.value,
                                            })
                                        }
                                    />
                                </label>
                            </>
                        ) : null}
                        {duplicateDerivedId ? (
                            <span className="rbs-error-text">{loc.derivedSourceExists}</span>
                        ) : null}
                        <div className="rbs-inline-actions">
                            <button
                                type="button"
                                className="rbs-btn"
                                disabled={editingDisabled || !canStageDerived}
                                onClick={stageDerivedSource}>
                                {derivedDraft.editingId
                                    ? loc.stageDerivedUpdate
                                    : loc.stageDerivedView}
                            </button>
                            <button
                                type="button"
                                className="rbs-btn rbs-btn-quiet"
                                disabled={editingDisabled}
                                onClick={() => setDerivedDraft(undefined)}>
                                {loc.cancel}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </aside>
    );
}

function PreviewPage() {
    const { state } = useRbs();
    const loc = locConstants.runbookStudio;
    const [width, setWidth] = useState<"compact" | "medium" | "wide">("wide");
    const [scenarioId, setScenarioId] = useState<"clean" | "blockingErrors" | "approvalRejected">(
        "clean",
    );
    const [editingLayout, setEditingLayout] = useState(false);
    const [outputsOpen, setOutputsOpen] = useState(false);
    const scenarios =
        state?.previewScenarios ??
        (state?.previewPresentation
            ? [
                  {
                      id: "clean" as const,
                      presentation: state.previewPresentation,
                      hiddenBranchWidgetCount: 0,
                      hiddenBranchNodeIds: [],
                  },
              ]
            : []);
    const scenario = scenarios.find((candidate) => candidate.id === scenarioId) ?? scenarios[0];
    const draftTarget = useMemo<PresentationDraftTarget | undefined>(
        () =>
            scenario
                ? {
                      kind: "sample",
                      scenario: scenario.id,
                  }
                : undefined,
        [scenario?.id],
    );
    const layoutDraft = usePresentationDraft(
        scenario?.presentation,
        draftTarget,
        state?.artifact ? `preview:${state.artifact.id}` : undefined,
    );
    if (state?.artifactError) {
        return <InvalidArtifact />;
    }
    if (!state?.artifact?.hasLock || !scenario || !layoutDraft.presentation) {
        return <EmptyState title={loc.noPreviewTitle} detail={loc.noPreviewDetail} />;
    }
    const presentation = layoutDraft.presentation;
    return (
        <div className="rbs-page-body">
            <div className="rbs-preview-toolbar">
                <div>
                    <strong>{loc.previewResultsLayout}</strong>
                    <div className="rbs-muted">{loc.previewResultsLayoutDetail}</div>
                </div>
                <span className="rbs-chip rbs-chip-suggested">{loc.sample}</span>
                <div className="rbs-spacer" />
                <label className="rbs-output-picker">
                    <span className="rbs-muted">{loc.previewScenario}</span>
                    <select
                        className="rbs-select"
                        value={scenario.id}
                        onChange={(event) =>
                            setScenarioId(
                                event.target.value as
                                    | "clean"
                                    | "blockingErrors"
                                    | "approvalRejected",
                            )
                        }>
                        {scenarios.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                                {candidate.id === "clean"
                                    ? loc.previewScenarioClean
                                    : candidate.id === "blockingErrors"
                                      ? loc.previewScenarioBlockingErrors
                                      : loc.previewScenarioApprovalRejected}
                            </option>
                        ))}
                    </select>
                </label>
                <button
                    type="button"
                    className="rbs-btn"
                    aria-pressed={editingLayout}
                    onClick={() => setEditingLayout((value) => !value)}>
                    {editingLayout ? loc.finishCustomizing : loc.customizeLayout}
                </button>
                <button
                    type="button"
                    className="rbs-btn rbs-btn-quiet"
                    aria-pressed={outputsOpen}
                    onClick={() => setOutputsOpen((value) => !value)}>
                    {loc.outputsDrawer}
                </button>
                <LayoutStrategyControl
                    presentation={presentation}
                    onChange={layoutDraft.stagePolicy}
                    disabled={layoutDraft.saving || layoutDraft.conflict}
                />
                <div className="rbs-graph-toggle-group" role="group" aria-label={loc.previewWidth}>
                    {(["compact", "medium", "wide"] as const).map((candidate) => (
                        <button
                            key={candidate}
                            type="button"
                            className={`rbs-graph-toggle ${width === candidate ? "active" : ""}`}
                            aria-pressed={width === candidate}
                            onClick={() => setWidth(candidate)}>
                            {candidate === "compact"
                                ? loc.previewCompact
                                : candidate === "medium"
                                  ? loc.previewMedium
                                  : loc.previewWide}
                        </button>
                    ))}
                </div>
            </div>
            {scenario.hiddenBranchWidgetCount > 0 ? (
                <div className="rbs-inline-notice" role="status">
                    {loc.branchWidgetsHidden(scenario.hiddenBranchWidgetCount)}
                </div>
            ) : null}
            <PresentationDraftBanner draft={layoutDraft} previewOnly />
            <div className={`rbs-results-compose ${outputsOpen ? "with-drawer" : ""}`}>
                <div className={`rbs-preview-canvas rbs-preview-${width}`}>
                    <PresentationSections
                        presentation={presentation}
                        sample
                        editing={editingLayout}
                        onLayoutEdits={layoutDraft.stageEdits}
                        editingDisabled={layoutDraft.saving || layoutDraft.conflict}
                    />
                </div>
                {outputsOpen ? (
                    <OutputsDrawer
                        presentation={presentation}
                        layoutEdits={layoutDraft.edits}
                        branchNotTakenNodeIds={scenario.hiddenBranchNodeIds}
                        onLayoutEdits={layoutDraft.stageEdits}
                        editingDisabled={layoutDraft.saving || layoutDraft.conflict}
                    />
                ) : null}
            </div>
        </div>
    );
}

function HistoryPage() {
    const { state, selectRun, navigate, openDiagnostics } = useRbs();
    const loc = locConstants.runbookStudio;
    const history = state?.history ?? [];
    if (history.length === 0) {
        return <EmptyState title={loc.noHistoryTitle} detail={loc.noHistoryDetail} />;
    }
    return (
        <div className="rbs-page-body">
            <div className="rbs-history-summary">
                <strong>{loc.retainedRuns(history.length)}</strong>
                {state?.artifact?.planRevision ? (
                    <span className="rbs-muted">
                        {loc.currentPlanRevision(state.artifact.planRevision)}
                    </span>
                ) : null}
            </div>
            <div className="rbs-table-wrap">
                <table className="rbs-table">
                    <thead>
                        <tr>
                            <th>{loc.run}</th>
                            <th>{loc.started}</th>
                            <th>{loc.runOutcome}</th>
                            <th>{loc.state}</th>
                            <th>{loc.planRevision}</th>
                            <th>{loc.actions}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {history.map((entry) => {
                            const presented = presentRunHistoryEntry(
                                entry,
                                state?.artifact?.planRevision,
                                state?.selectedRunId ?? state?.run?.runId,
                            );
                            return (
                                <tr
                                    key={entry.runId}
                                    className={presented.selected ? "rbs-history-selected" : ""}
                                    aria-current={presented.selected ? "true" : undefined}>
                                    <td className="rbs-mono">
                                        {entry.runId}
                                        {presented.selected ? (
                                            <span className="rbs-chip rbs-history-selected-chip">
                                                {loc.selectedRun}
                                            </span>
                                        ) : null}
                                    </td>
                                    <td>{new Date(entry.startedEpochMs).toLocaleString()}</td>
                                    <td>
                                        <span
                                            className={`rbs-chip ${
                                                presented.tone === "active"
                                                    ? `rbs-state-${entry.state}`
                                                    : `rbs-verdict-${presented.tone}`
                                            }`}>
                                            {runOutcomeLabel(entry)}
                                        </span>
                                    </td>
                                    <td>
                                        <span className={`rbs-chip rbs-state-${entry.state}`}>
                                            {runStateLabel(entry.state)}
                                        </span>
                                    </td>
                                    <td>
                                        <span className="rbs-mono">{entry.planRevision}</span>{" "}
                                        {presented.planRelation === "current" ? (
                                            <span className="rbs-chip rbs-chip-ok">
                                                {loc.currentPlan}
                                            </span>
                                        ) : presented.planRelation === "different" ? (
                                            <span className="rbs-chip rbs-chip-warning">
                                                {loc.differentRevision}
                                            </span>
                                        ) : null}
                                    </td>
                                    <td>
                                        <div className="rbs-history-actions">
                                            <button
                                                type="button"
                                                className="rbs-link-button"
                                                onClick={() => {
                                                    void selectRun(entry.runId).then((selected) => {
                                                        if (selected) {
                                                            navigate("results");
                                                        }
                                                    });
                                                }}>
                                                {loc.viewResults}
                                            </button>
                                            <button
                                                type="button"
                                                className="rbs-link-button"
                                                onClick={() => openDiagnostics(entry.runId)}>
                                                {loc.openDiagnostics}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export function RunbookStudioApp() {
    const { route, state } = useRbs();

    // Cross-process readiness endpoint (registered webviewMark): first paint
    // with a populated snapshot.
    useEffect(() => {
        if (state) {
            perfMarkAfterNextPaint("mssql.runbookStudio.webview.ready");
        }
    }, [state !== undefined]);

    let page: React.ReactNode;
    switch (route) {
        case "author":
            page = <AuthorPage />;
            break;
        // "parameters" is an alias for the merged Run page (form expanded);
        // "debug" (page removed) falls back there too. RbsRoute keeps both
        // members so deep links stay valid.
        case "parameters":
        case "run":
        case "debug":
            page = <RunPage />;
            break;
        case "plan":
            page = <PlanPage />;
            break;
        case "preview":
            page = <PreviewPage />;
            break;
        case "results":
            page = <ResultsPage />;
            break;
        case "history":
            page = <HistoryPage />;
            break;
        default:
            page = <AuthorPage />;
    }
    return (
        <div className="rbs-shell">
            <TopBar />
            <NavRail />
            <main className="rbs-page">{page}</main>
        </div>
    );
}
