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

import { useEffect } from "react";
import { locConstants } from "../../common/locConstants";
import { perfMarkAfterNextPaint } from "../../common/perfMarks";
import {
    RbsRoute,
    RunbookParameterDefinition,
    RunbookPlanNode,
} from "../../../sharedInterfaces/runbookStudio";
import { useRbs } from "./state";

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

function AuthorPage() {
    const { state } = useRbs();
    const loc = locConstants.runbookStudio;
    if (state?.artifactError) {
        return <InvalidArtifact />;
    }
    if (!state?.artifact) {
        return <EmptyState title={loc.loading} detail="" />;
    }
    return (
        <div className="rbs-page-body">
            <section className="rbs-section">
                <h2 className="rbs-section-title">{loc.intent}</h2>
                {state.artifact.intent ? (
                    <p className="rbs-intent">{state.artifact.intent}</p>
                ) : (
                    <p className="rbs-muted">{loc.noIntent}</p>
                )}
            </section>
            <section className="rbs-section">
                <h2 className="rbs-section-title">{loc.compiledPlan}</h2>
                {state.artifact.hasLock ? (
                    <NodeList nodes={state.artifact.nodes} />
                ) : (
                    <p className="rbs-muted">{loc.notCompiledDetail}</p>
                )}
            </section>
        </div>
    );
}

function blastRadiusLabel(node: RunbookPlanNode): string | undefined {
    const radius = node.blastRadius;
    if (!radius) {
        return undefined;
    }
    return `${radius.operation}:${radius.resource}@${radius.targetEnvironment}`;
}

function NodeList({ nodes }: { nodes: RunbookPlanNode[] }) {
    const loc = locConstants.runbookStudio;
    return (
        <table className="rbs-table">
            <thead>
                <tr>
                    <th>{loc.step}</th>
                    <th>{loc.kind}</th>
                    <th>{loc.activity}</th>
                    <th>{loc.blastRadius}</th>
                </tr>
            </thead>
            <tbody>
                {nodes.map((node) => (
                    <tr key={node.id}>
                        <td>{node.label}</td>
                        <td>
                            <span className={`rbs-chip rbs-kind-${node.kind}`}>{node.kind}</span>
                        </td>
                        <td className="rbs-mono">
                            {node.activityKind
                                ? `${node.activityKind}@${node.activityVersion ?? 1}`
                                : "—"}
                        </td>
                        <td className="rbs-mono">{blastRadiusLabel(node) ?? "—"}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function defaultDisplay(parameter: RunbookParameterDefinition): string {
    if (parameter.type === "secret") {
        return locConstants.runbookStudio.rebindAtRunTime;
    }
    return parameter.default === undefined ? "—" : String(parameter.default);
}

function ParametersPage() {
    const { state } = useRbs();
    const loc = locConstants.runbookStudio;
    if (state?.artifactError) {
        return <InvalidArtifact />;
    }
    const parameters = state?.artifact?.parameters ?? [];
    if (parameters.length === 0) {
        return <EmptyState title={loc.noParametersTitle} detail={loc.noParametersDetail} />;
    }
    return (
        <div className="rbs-page-body">
            <table className="rbs-table">
                <thead>
                    <tr>
                        <th>{loc.parameter}</th>
                        <th>{loc.type}</th>
                        <th>{loc.required}</th>
                        <th>{loc.defaultColumn}</th>
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
                            <td className="rbs-mono">{defaultDisplay(parameter)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function RunPage() {
    const { state } = useRbs();
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
    return (
        <div className="rbs-page-body">
            <div className="rbs-run-header">
                <span className={`rbs-chip rbs-state-${run.state}`}>{run.state}</span>
                <span className="rbs-mono">{run.runId}</span>
            </div>
            <table className="rbs-table">
                <thead>
                    <tr>
                        <th>{loc.step}</th>
                        <th>{loc.state}</th>
                        <th>{loc.duration}</th>
                        <th>{loc.result}</th>
                    </tr>
                </thead>
                <tbody>
                    {run.nodes.map((node) => (
                        <tr key={node.nodeId}>
                            <td className="rbs-mono">{node.nodeId}</td>
                            <td>
                                <span className={`rbs-chip rbs-state-${node.state}`}>
                                    {node.state}
                                </span>
                            </td>
                            <td className="rbs-mono">
                                {node.durationMs !== undefined ? `${node.durationMs} ms` : "—"}
                            </td>
                            <td>{node.message ?? "—"}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
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
            <NodeList nodes={artifact.nodes} />
            <section className="rbs-section">
                <h2 className="rbs-section-title">{loc.edges}</h2>
                <ul className="rbs-edge-list rbs-mono">
                    {artifact.edges.map((edge, index) => (
                        <li key={index}>
                            {edge.from} → {edge.to}
                            {edge.when ? ` [${edge.when}]` : ""}
                        </li>
                    ))}
                </ul>
            </section>
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
    const outputs = state.run.nodes.flatMap((node) =>
        (node.outputs ?? []).map((output) => ({ node, output })),
    );
    if (outputs.length === 0) {
        return <EmptyState title={loc.noOutputsTitle} detail={loc.noOutputsDetail} />;
    }
    return (
        <div className="rbs-page-body">
            <table className="rbs-table">
                <thead>
                    <tr>
                        <th>{loc.step}</th>
                        <th>{loc.output}</th>
                        <th>{loc.rows}</th>
                    </tr>
                </thead>
                <tbody>
                    {outputs.map(({ node, output }) => (
                        <tr key={output.handleId}>
                            <td className="rbs-mono">{node.nodeId}</td>
                            <td className="rbs-mono">
                                {output.contract}
                                {output.expired ? ` (${loc.detailDataExpired})` : ""}
                            </td>
                            <td className="rbs-mono">{output.rows ?? "—"}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
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
