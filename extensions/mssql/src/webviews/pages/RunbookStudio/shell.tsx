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
import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { locConstants } from "../../common/locConstants";
import { perfMarkAfterNextPaint } from "../../common/perfMarks";
import {
    RbsArtifactSummary,
    RbsEvidenceExportFormat,
    RbsRoute,
    RunbookNodeSnapshot,
    RunbookParameterDefinition,
    RunbookPlanNode,
    RunbookRunSnapshot,
} from "../../../sharedInterfaces/runbookStudio";
import {
    defaultViewFor,
    expectedContractFor,
    PresentationLayoutEdit,
    ResolvedPresentation,
    ResolvedWidget,
} from "../../../sharedInterfaces/runbookPresentation";
import { PlannerConsoleTurn, PlannerFeedEntry, useRbs } from "./state";
import { displayOrder, PlanStepper } from "./planStepper";
import { PlanGraphView } from "./graphView";
import { ResolvedWidgetView } from "./widgets";
import {
    mergePresentationLayoutEdits,
    presentationLayoutSnapshot,
    PresentationLayoutConflict,
    rebasePresentationLayoutEdits,
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
            {sql ? <pre className="rbs-code rbs-mono">{sql}</pre> : null}
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
    const [draftBaseRevision, setDraftBaseRevision] = useState<number | undefined>();
    const [draftBaseline, setDraftBaseline] = useState<PresentationLayoutEdit[]>();
    const [draftPresentation, setDraftPresentation] = useState<ResolvedPresentation | undefined>();
    const [runOnlyEdits, setRunOnlyEdits] = useState<PresentationLayoutEdit[]>([]);
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
    const currentLayoutSnapshot = useMemo(
        () => presentationLayoutSnapshot(basePresentation, state?.artifact?.outputPresentations),
        [basePresentation, state?.artifact?.outputPresentations],
    );

    const resolveEdits = useCallback(
        async (
            edits: PresentationLayoutEdit[],
            baseRevision: number,
            destination: "draft" | "runOnly",
        ) => {
            if (!target || edits.length === 0) {
                return false;
            }
            const sequence = ++requestSequence.current;
            const result = await previewPresentationLayout(edits, baseRevision, target);
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
        setDraftBaseRevision(undefined);
        setDraftBaseline(undefined);
        setDraftPresentation(undefined);
        setRunOnlyEdits([]);
        setRunOnlyPresentation(undefined);
        setError(undefined);
        setConflict(undefined);
    }, [resetKey]);

    useEffect(() => {
        if (draftEdits.length > 0 && draftBaseRevision !== undefined) {
            setDraftPresentation(undefined);
            if (draftBaseRevision !== currentRevision) {
                setConflict({ kind: "stale" });
            } else {
                void resolveEdits(draftEdits, draftBaseRevision, "draft");
            }
        } else if (runOnlyEdits.length > 0) {
            setRunOnlyPresentation(undefined);
            void resolveEdits(runOnlyEdits, currentRevision, "runOnly");
        }
    }, [currentRevision, targetKey]);

    const stageEdits = useCallback(
        (changes: PresentationLayoutEdit[]) => {
            if (!target || changes.length === 0 || conflict) {
                return;
            }
            if (runOnlyEdits.length > 0) {
                setRunOnlyEdits([]);
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
                }
                setDraftBaseRevision(revision);
                void resolveEdits(next, revision, "draft");
                return next;
            });
        },
        [
            conflict,
            currentRevision,
            currentLayoutSnapshot,
            draftBaseline,
            draftBaseRevision,
            hostRunOnlyEdits,
            resolveEdits,
            runOnlyEdits,
            targetKey,
        ],
    );

    const resetDraft = useCallback(() => {
        requestSequence.current++;
        setDraftEdits([]);
        setDraftBaseRevision(undefined);
        setDraftBaseline(undefined);
        setDraftPresentation(undefined);
        setError(undefined);
        setConflict(undefined);
    }, []);

    const applyToRun = useCallback(async () => {
        if (!draftPresentation || draftEdits.length === 0 || draftBaseRevision === undefined) {
            return false;
        }
        if (target?.kind === "run") {
            setSaving(true);
            try {
                const result = await applyPresentationOverlay(
                    target.runId,
                    draftEdits,
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
        setRunOnlyPresentation(draftPresentation);
        resetDraft();
        return true;
    }, [
        applyPresentationOverlay,
        draftBaseRevision,
        draftEdits,
        draftPresentation,
        resetDraft,
        targetKey,
    ]);

    const resetRunOnly = useCallback(async () => {
        if (target?.kind === "run" && state?.presentationOverlay?.runId === target.runId) {
            await clearPresentationOverlay(target.runId);
        }
        setRunOnlyEdits([]);
        setRunOnlyPresentation(undefined);
    }, [clearPresentationOverlay, state?.presentationOverlay?.runId, targetKey]);

    const saveToRunbook = useCallback(async () => {
        if (draftEdits.length === 0 || draftBaseRevision === undefined) {
            return false;
        }
        setSaving(true);
        setError(undefined);
        try {
            const result = await applyPresentationLayout(draftEdits, draftBaseRevision);
            if (result.applied) {
                await resetRunOnly();
                resetDraft();
                return true;
            }
            if (result.reason === "revisionConflict") {
                setConflict({ kind: "stale" });
            } else {
                setError("invalid");
            }
            return false;
        } finally {
            setSaving(false);
        }
    }, [applyPresentationLayout, draftBaseRevision, draftEdits, resetDraft, resetRunOnly]);

    const rebase = useCallback(async () => {
        if (draftEdits.length === 0 || draftBaseline === undefined) {
            return;
        }
        setSaving(true);
        try {
            const rebased = rebasePresentationLayoutEdits(
                draftBaseline,
                currentLayoutSnapshot,
                draftEdits,
            );
            if (rebased.conflicts.length > 0) {
                setConflict({ kind: "overlap", conflicts: rebased.conflicts });
                return;
            }
            const resolved = await resolveEdits(rebased.edits, currentRevision, "draft");
            if (resolved) {
                setDraftEdits(rebased.edits);
                setDraftBaseRevision(currentRevision);
                setDraftBaseline(currentLayoutSnapshot);
                setConflict(undefined);
            }
        } finally {
            setSaving(false);
        }
    }, [currentLayoutSnapshot, currentRevision, draftBaseline, draftEdits, resolveEdits]);

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
            const resolved = await resolveEdits(rebased.edits, currentRevision, "draft");
            if (resolved) {
                setDraftEdits(rebased.edits);
                setDraftBaseRevision(currentRevision);
                setDraftBaseline(currentLayoutSnapshot);
                setConflict(undefined);
            }
        } finally {
            setSaving(false);
        }
    }, [conflict, currentLayoutSnapshot, currentRevision, draftBaseline, draftEdits, resolveEdits]);

    return {
        presentation: draftPresentation ?? runOnlyPresentation ?? basePresentation,
        pending: draftEdits.length > 0,
        runOnly: runOnlyEdits.length > 0 || hostRunOnlyEdits.length > 0,
        saving,
        error,
        conflict: conflict !== undefined,
        conflictDetail: conflict,
        canOverwriteConflicts:
            conflict?.kind === "overlap" &&
            !conflict.conflicts.some((entry) => entry.fields.includes("node")),
        stageEdits,
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
                                            entry.nodeId,
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

function ResultsPage() {
    const { state } = useRbs();
    const loc = locConstants.runbookStudio;
    const paintedResults = useRef<Map<string, string>>(new Map());
    const [editingLayout, setEditingLayout] = useState(false);
    const [outputsOpen, setOutputsOpen] = useState(false);
    const widgets = (state?.presentation?.sections ?? []).flatMap((section) => section.widgets);
    const readyWidgets = widgets.filter((widget) => widget.state === "ready");
    const runId = state?.run?.runId;
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
                    <EvidenceExportControl />
                </div>
                <EmptyState title={loc.noOutputsTitle} detail={loc.noOutputsDetail} />
            </div>
        );
    }
    return (
        <div className="rbs-page-body">
            <div className="rbs-run-header">
                {state.run.verdict ? (
                    <span className={`rbs-chip rbs-verdict-${state.run.verdict}`}>
                        {state.run.verdict}
                    </span>
                ) : null}
                <ResultsRunPicker />
                <div className="rbs-spacer" />
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
                <EvidenceExportControl />
            </div>
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
    return (
        <>
            {presentation.sections.map((section) => (
                <section className="rbs-section" key={section.id}>
                    <h2 className="rbs-section-title">{section.title}</h2>
                    <div
                        className={`rbs-layout-grid rbs-layout-${presentation.layout.sectionFlow}`}>
                        {section.widgets.map((widget, index) => (
                            <div
                                className="rbs-layout-widget"
                                style={layoutStyle(widget, presentation)}
                                key={widget.id}>
                                {editing ? (
                                    <LayoutEditorControls
                                        widget={widget}
                                        siblings={section.widgets}
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

const SPAN_PRESETS = {
    full: { compact: 1, medium: 6, wide: 12 },
    twoThirds: { compact: 1, medium: 4, wide: 8 },
    half: { compact: 1, medium: 3, wide: 6 },
    third: { compact: 1, medium: 2, wide: 4 },
} as const;

function spanPresetOf(span: { wide?: number } | undefined) {
    const wide = span?.wide;
    return wide === 4 ? "third" : wide === 6 ? "half" : wide === 8 ? "twoThirds" : "full";
}

function LayoutEditorControls({
    widget,
    siblings,
    index,
    onLayoutEdits,
    disabled,
}: {
    widget: ResolvedWidget;
    siblings: ResolvedWidget[];
    index: number;
    onLayoutEdits?: (edits: PresentationLayoutEdit[]) => void;
    disabled: boolean;
}) {
    const { state } = useRbs();
    const loc = locConstants.runbookStudio;
    const configured = state?.artifact?.outputPresentations?.[widget.nodeId];
    const sections = state?.artifact?.presentationSections ?? [];
    const placement = widget.placement ?? configured?.placement ?? { order: 0 };
    const currentSectionId =
        (sections.some((section) => section.id === widget.sectionId)
            ? widget.sectionId
            : undefined) ??
        configured?.sectionId ??
        "primary";
    const editFor = (
        target: ResolvedWidget,
        edit: Partial<PresentationLayoutEdit> = {},
    ): PresentationLayoutEdit => {
        const targetConfigured = state?.artifact?.outputPresentations?.[target.nodeId];
        const targetSectionId =
            (sections.some((section) => section.id === target.sectionId)
                ? target.sectionId
                : undefined) ??
            targetConfigured?.sectionId ??
            "primary";
        return {
            nodeId: target.nodeId,
            widgetId: targetConfigured?.widgetId ?? target.id,
            defaultView: targetConfigured?.defaultView ?? target.view,
            sectionId: targetSectionId,
            placement: target.placement ?? targetConfigured?.placement ?? { order: 0 },
            hidden: false,
            ...edit,
        };
    };
    const commitEdits = (edits: PresentationLayoutEdit[]) => onLayoutEdits?.(edits);
    const commit = (edit: Partial<PresentationLayoutEdit>) => commitEdits([editFor(widget, edit)]);
    const move = (delta: -1 | 1) => {
        const sibling = siblings[index + delta];
        if (!sibling) {
            return;
        }
        const currentOrder = placement.order;
        const siblingConfigured = state?.artifact?.outputPresentations?.[sibling.nodeId];
        const siblingPlacement = sibling.placement ??
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
    return (
        <div className="rbs-layout-controls">
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
                    value={spanPresetOf(placement.span)}
                    disabled={disabled}
                    onChange={(event) =>
                        commit({
                            placement: {
                                ...placement,
                                span: SPAN_PRESETS[event.target.value as keyof typeof SPAN_PRESETS],
                            },
                        })
                    }>
                    <option value="full">{loc.layoutFull}</option>
                    <option value="twoThirds">{loc.layoutTwoThirds}</option>
                    <option value="half">{loc.layoutHalf}</option>
                    <option value="third">{loc.layoutThird}</option>
                </select>
            </label>
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

function OutputsDrawer({
    presentation,
    branchNotTakenNodeIds = [],
    onLayoutEdits,
    editingDisabled = false,
}: {
    presentation: ResolvedPresentation;
    branchNotTakenNodeIds?: string[];
    onLayoutEdits?: (edits: PresentationLayoutEdit[]) => void;
    editingDisabled?: boolean;
}) {
    const { state } = useRbs();
    const loc = locConstants.runbookStudio;
    const sections = state?.artifact?.presentationSections ?? [];
    const visibleNodes = new Set(
        presentation.sections.flatMap((section) => section.widgets.map((widget) => widget.nodeId)),
    );
    const branchNotTakenNodes = new Set(branchNotTakenNodeIds);
    const outputs = (state?.artifact?.nodes ?? [])
        .map((node) => ({
            node,
            contract: expectedContractFor(node.kind, node.activityKind),
        }))
        .filter(
            (entry): entry is typeof entry & { contract: string } => entry.contract !== undefined,
        );

    const update = (nodeId: string, hidden: boolean, sectionId?: string) => {
        const configured = state?.artifact?.outputPresentations?.[nodeId];
        const node = outputs.find((entry) => entry.node.id === nodeId);
        if (!node) {
            return;
        }
        const resolved = presentation.sections
            .flatMap((candidate) => candidate.widgets)
            .find((widget) => widget.nodeId === nodeId);
        onLayoutEdits?.([
            {
                nodeId,
                ...(configured?.widgetId ? { widgetId: configured.widgetId } : {}),
                defaultView:
                    configured?.defaultView ?? resolved?.view ?? defaultViewFor(node.contract),
                sectionId: sectionId ?? resolved?.sectionId ?? configured?.sectionId ?? "primary",
                placement: resolved?.placement ??
                    configured?.placement ?? {
                        order: outputs.findIndex((entry) => entry.node.id === nodeId),
                        span: SPAN_PRESETS.full,
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
                {outputs.map(({ node, contract }) => {
                    const configured = state?.artifact?.outputPresentations?.[node.id];
                    const resolved = presentation.sections
                        .flatMap((candidate) => candidate.widgets)
                        .find((widget) => widget.nodeId === node.id);
                    const branchNotTaken = branchNotTakenNodes.has(node.id);
                    const hidden = !visibleNodes.has(node.id) && !branchNotTaken;
                    return (
                        <div className="rbs-output-row" key={node.id}>
                            <div>
                                <strong>{node.label}</strong>
                                <div className="rbs-chip rbs-mono">{contract}</div>
                            </div>
                            <select
                                className="rbs-select"
                                aria-label={loc.layoutSectionFor(node.label)}
                                value={resolved?.sectionId ?? configured?.sectionId ?? "primary"}
                                disabled={editingDisabled || hidden || branchNotTaken}
                                onChange={(event) => update(node.id, false, event.target.value)}>
                                {sections.map((section) => (
                                    <option key={section.id} value={section.id}>
                                        {section.label ?? section.role}
                                    </option>
                                ))}
                            </select>
                            <button
                                type="button"
                                className="rbs-btn rbs-btn-quiet"
                                disabled={editingDisabled || branchNotTaken}
                                onClick={() => update(node.id, !hidden)}>
                                {branchNotTaken
                                    ? loc.branchNotTaken
                                    : hidden
                                      ? loc.showOutput
                                      : loc.hideOutput}
                            </button>
                        </div>
                    );
                })}
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
    const { state, selectRun, navigate } = useRbs();
    const loc = locConstants.runbookStudio;
    const history = state?.history ?? [];
    if (history.length === 0) {
        return <EmptyState title={loc.noHistoryTitle} detail={loc.noHistoryDetail} />;
    }
    return (
        <div className="rbs-page-body">
            <table className="rbs-table">
                <thead>
                    <tr>
                        <th>{loc.run}</th>
                        <th>{loc.started}</th>
                        <th>{loc.state}</th>
                        <th>{loc.planRevision}</th>
                        <th>{loc.results}</th>
                    </tr>
                </thead>
                <tbody>
                    {history.map((entry) => (
                        <tr key={entry.runId}>
                            <td className="rbs-mono">{entry.runId}</td>
                            <td>{new Date(entry.startedEpochMs).toLocaleString()}</td>
                            <td>
                                <span className={`rbs-chip rbs-state-${entry.state}`}>
                                    {entry.state}
                                </span>
                            </td>
                            <td className="rbs-mono">{entry.planRevision}</td>
                            <td>
                                <button
                                    type="button"
                                    className="rbs-link-button"
                                    onClick={() => {
                                        void selectRun(entry.runId).then(() => navigate("results"));
                                    }}>
                                    {loc.viewResults}
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
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
