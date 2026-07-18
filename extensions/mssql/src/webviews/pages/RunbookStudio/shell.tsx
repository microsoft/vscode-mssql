/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Runbook Studio document shell (A2 §5.2): compact top bar + product route
 * rail (Author | Parameters | Run | Plan | Results | History [| Debug]).
 * Every route renders an explicit state — empty, invalid, untrusted, or
 * populated — never a blank panel (rendering-spec total-layout rule).
 */

import { useEffect, useState } from "react";
import { locConstants } from "../../common/locConstants";
import { perfMarkAfterNextPaint } from "../../common/perfMarks";
import {
    RbsArtifactSummary,
    RbsRoute,
    RunbookParameterDefinition,
    RunbookPlanNode,
    RunbookRunSnapshot,
} from "../../../sharedInterfaces/runbookStudio";
import { useRbs } from "./state";
import { displayOrder, PlanStepper } from "./planStepper";
import { ResolvedWidgetView } from "./widgets";

const ROUTES: Array<{ id: RbsRoute; label: () => string; icon: string }> = [
    { id: "author", label: () => locConstants.runbookStudio.author, icon: "✎" },
    { id: "parameters", label: () => locConstants.runbookStudio.parameters, icon: "⛭" },
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
    const { state, route, navigate } = useRbs();
    const routes = state?.debugEnabled
        ? [
              ...ROUTES,
              {
                  id: "debug" as RbsRoute,
                  label: () => locConstants.runbookStudio.debugReplay,
                  icon: "⟳",
              },
          ]
        : ROUTES;
    return (
        <nav className="rbs-rail" aria-label={locConstants.runbookStudio.sectionsAriaLabel}>
            {routes.map((item) => (
                <button
                    key={item.id}
                    className={`rbs-rail-item ${route === item.id ? "active" : ""}`}
                    aria-current={route === item.id ? "page" : undefined}
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

function AuthorPage() {
    const { state, compile, compiling, navigate } = useRbs();
    const loc = locConstants.runbookStudio;
    const [intentDraft, setIntentDraft] = useState<string | undefined>(undefined);
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
                    {compiling ? <span className="rbs-spinner" aria-hidden /> : null}
                </div>
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

function ParametersPage() {
    const { state, startRun } = useRbs();
    const loc = locConstants.runbookStudio;
    const [values, setValues] = useState<Record<string, string>>({});
    const [starting, setStarting] = useState(false);
    if (state?.artifactError) {
        return <InvalidArtifact />;
    }
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
        <div className="rbs-page-body">
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
                                        onChange={(next) =>
                                            setValues((current) => ({
                                                ...current,
                                                [parameter.id]: next,
                                            }))
                                        }
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
        </div>
    );
}

function RunPage() {
    const { state, openDiagnostics, cancelRun, respondToGate } = useRbs();
    const loc = locConstants.runbookStudio;
    if (state?.artifactError) {
        return <InvalidArtifact />;
    }
    const run = state?.run;
    if (!run) {
        return (
            <EmptyState
                title={loc.noRunTitle}
                detail={state?.workspaceTrusted ? loc.noRunDetail : loc.untrustedDetail}
            />
        );
    }
    const runActive = !["succeeded", "failed", "cancelled"].includes(run.state);
    const completed = run.nodes.filter((n) =>
        ["succeeded", "failed", "skipped", "cancelled"].includes(n.state),
    ).length;
    return (
        <div className="rbs-page-body">
            <div className="rbs-run-header">
                <span className={`rbs-chip rbs-state-${run.state}`}>{run.state}</span>
                {run.verdict ? (
                    <span className={`rbs-chip rbs-verdict-${run.verdict}`}>{run.verdict}</span>
                ) : null}
                <span className="rbs-muted">{loc.stepsComplete(completed, run.nodes.length)}</span>
                {runActive ? (
                    <button className="rbs-btn" onClick={() => void cancelRun(run.runId)}>
                        {loc.cancelRun}
                    </button>
                ) : null}
                <button className="rbs-btn" onClick={() => openDiagnostics(run.runId)}>
                    {loc.openDiagnostics}
                </button>
            </div>
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
            <RunTimeline run={run} artifact={state?.artifact} />
            <RunEventLog />
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

/** The mockup's "status timeline — what happened": plan-ordered step rows
 *  with state icon, impact chip, outcome one-liner, and duration. */
function RunTimeline({
    run,
    artifact,
}: {
    run: RunbookRunSnapshot;
    artifact: RbsArtifactSummary | undefined;
}) {
    const loc = locConstants.runbookStudio;
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
    return (
        <section aria-label={loc.statusTimeline}>
            <div className="rbs-timeline-title">{loc.statusTimeline}</div>
            <ol className="rbs-timeline">
                {ordered.map((nodeId) => {
                    const snapshot = snapshots.get(nodeId);
                    const plan = planNodes.get(nodeId);
                    const nodeState = snapshot?.state ?? "pending";
                    const chip = stepImpactChip(plan);
                    return (
                        <li className={`rbs-timeline-row rbs-tl-${nodeState}`} key={nodeId}>
                            <span aria-hidden className={`rbs-tl-icon rbs-tl-icon-${nodeState}`}>
                                {timelineIcon(nodeState)}
                            </span>
                            <div className="rbs-tl-body">
                                <div className="rbs-tl-head">
                                    <span className="rbs-tl-label">{plan?.label ?? nodeId}</span>
                                    {chip ? <span className="rbs-chip">{chip}</span> : null}
                                    <span className="rbs-tl-duration rbs-mono">
                                        {snapshot?.durationMs !== undefined
                                            ? `${snapshot.durationMs} ms`
                                            : nodeState === "pending"
                                              ? ""
                                              : "—"}
                                    </span>
                                </div>
                                <div className="rbs-muted">
                                    {snapshot?.message ??
                                        (nodeState === "pending" ? loc.queuedLabel : nodeState)}
                                </div>
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
    if (state?.artifactError) {
        return <InvalidArtifact />;
    }
    const artifact = state?.artifact;
    if (!artifact?.hasLock) {
        return <EmptyState title={loc.noCompiledPlanTitle} detail={loc.notCompiledDetail} />;
    }
    return (
        <div className="rbs-page-body">
            <PlanStepper
                entryNodeId={artifact.entryNodeId ?? artifact.nodes[0]?.id ?? ""}
                nodes={artifact.nodes}
                edges={artifact.edges}
                run={state?.run}
            />
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

function DebugPage() {
    const loc = locConstants.runbookStudio;
    return <EmptyState title={loc.debugReplay} detail={loc.debugPlaceholderDetail} />;
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
        case "parameters":
            page = <ParametersPage />;
            break;
        case "run":
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
        case "debug":
            page = <DebugPage />;
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
