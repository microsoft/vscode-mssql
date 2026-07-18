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

import { useEffect, useRef, useState } from "react";
import { locConstants } from "../../common/locConstants";
import { perfMarkAfterNextPaint } from "../../common/perfMarks";
import {
    RbsArtifactSummary,
    RbsRoute,
    RunbookNodeSnapshot,
    RunbookParameterDefinition,
    RunbookPlanNode,
    RunbookRunSnapshot,
} from "../../../sharedInterfaces/runbookStudio";
import { PlannerConsoleTurn, PlannerFeedEntry, useRbs } from "./state";
import { displayOrder, PlanStepper } from "./planStepper";
import { PlanGraphView } from "./graphView";
import { ResolvedWidgetView } from "./widgets";

const ROUTES: Array<{ id: RbsRoute; label: () => string; icon: string }> = [
    { id: "author", label: () => locConstants.runbookStudio.author, icon: "✎" },
    { id: "run", label: () => locConstants.runbookStudio.run, icon: "▶" },
    { id: "plan", label: () => locConstants.runbookStudio.plan, icon: "⬡" },
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
            {state?.artifact?.hasLock ? (
                <span
                    className="rbs-chip rbs-chip-ok"
                    title={loc.compiledPlanRevisionTitle(state.artifact.planRevision ?? "")}>
                    {loc.compiledV(state.artifact.planRevision ?? "?")}
                </span>
            ) : state?.artifact ? (
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
    // Persist the typed intent into the DOCUMENT as the user pauses —
    // otherwise a window reload (hot exit) restores the document without
    // the prompt, because the draft lived only in webview memory.
    useEffect(() => {
        if (intentDraft === undefined || intentDraft === state?.artifact?.intent) {
            return;
        }
        const timer = setTimeout(() => {
            void updateIntent(intentDraft);
        }, 750);
        return () => clearTimeout(timer);
    }, [intentDraft, state?.artifact?.intent, updateIntent]);
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
        const compiled = await compile(intent.trim());
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
                    onChange={(e) => setIntentDraft(e.target.value)}
                    disabled={compiling}
                />
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
function ParametersSection() {
    const { state, startRun, parameterDraft, setParameterDraft } = useRbs();
    const loc = locConstants.runbookStudio;
    // Draft lives in the provider so navigating away (or starting a run)
    // never wipes what the user configured.
    const values = parameterDraft;
    const [starting, setStarting] = useState(false);
    const parameters = state?.artifact?.parameters ?? [];
    const runActive =
        state?.run !== undefined && !["succeeded", "failed", "cancelled"].includes(state.run.state);
    const canRun =
        (state?.workspaceTrusted ?? false) && (state?.artifact?.hasLock ?? false) && !runActive;
    const onRun = async () => {
        setStarting(true);
        try {
            const parameterValues: Record<string, string | number | boolean | null> = {};
            for (const parameter of parameters) {
                const raw = values[parameter.id];
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
    const { state, route, openDiagnostics, cancelRun, respondToGate } = useRbs();
    const loc = locConstants.runbookStudio;
    const run = state?.run;
    const [paramsExpanded, setParamsExpanded] = useState(true);
    const [statusExpanded, setStatusExpanded] = useState(true);
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
    return (
        <div className="rbs-page-body">
            <CollapsibleSection
                title={loc.parameters}
                expanded={paramsExpanded}
                onToggle={() => setParamsExpanded((current) => !current)}>
                <ParametersSection />
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
                            ) : null}
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
        return <EmptyState title={loc.noCompiledPlanTitle} detail={loc.notCompiledDetail} />;
    }
    return (
        <div className="rbs-page-body">
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
                    pinnedViews={artifact.pinnedViews}
                />
            )}
        </div>
    );
}

function ResultsPage() {
    const { state } = useRbs();
    const loc = locConstants.runbookStudio;
    if (state?.artifactError) {
        return <InvalidArtifact />;
    }
    if (!state?.run) {
        return <EmptyState title={loc.noResultsTitle} detail={loc.noResultsDetail} />;
    }
    const presentation = state.presentation;
    if (!presentation || presentation.sections.length === 0) {
        return <EmptyState title={loc.noOutputsTitle} detail={loc.noOutputsDetail} />;
    }
    return (
        <div className="rbs-page-body">
            {state.run.verdict ? (
                <div className="rbs-run-header">
                    <span className={`rbs-chip rbs-verdict-${state.run.verdict}`}>
                        {state.run.verdict}
                    </span>
                </div>
            ) : null}
            {presentation.sections.map((section) => (
                <section className="rbs-section" key={section.id}>
                    <h2 className="rbs-section-title">{section.title}</h2>
                    {section.widgets.map((widget) => (
                        <ResolvedWidgetView key={widget.id} widget={widget} />
                    ))}
                </section>
            ))}
        </div>
    );
}

function HistoryPage() {
    const { state } = useRbs();
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
