/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query Studio Replay Lab (v1): captured run records, replay cart, and run
 * progress. Deliberately lean — records are digest-only unless elevated
 * capture was active, and only text-bearing records can replay.
 */

import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { useVscodeSelector } from "../../common/useVscodeSelector";
import {
    QsRunRecord,
    QueryStudioReplayReducers,
    QueryStudioReplayWebviewState,
} from "../../../sharedInterfaces/queryStudioReplay";

const PAGE_STYLE: React.CSSProperties = {
    fontFamily: "var(--vscode-font-family)",
    color: "var(--vscode-foreground)",
    padding: "12px 16px",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    height: "100vh",
    overflow: "auto",
    boxSizing: "border-box",
};

const TABLE_STYLE: React.CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "12px",
};

const CELL_STYLE: React.CSSProperties = {
    borderBottom: "1px solid var(--vscode-panel-border)",
    padding: "3px 8px",
    textAlign: "left",
    whiteSpace: "nowrap",
};

const BADGE_STYLE: React.CSSProperties = {
    display: "inline-block",
    borderRadius: "3px",
    padding: "0 6px",
    fontSize: "10px",
    lineHeight: "16px",
    marginLeft: "6px",
};

function Button(props: { label: string; onClick: () => void; disabled?: boolean }) {
    return (
        <button
            style={{
                background: "var(--vscode-button-background)",
                color: "var(--vscode-button-foreground)",
                border: "none",
                borderRadius: "2px",
                padding: "3px 10px",
                cursor: props.disabled ? "default" : "pointer",
                opacity: props.disabled ? 0.5 : 1,
            }}
            disabled={props.disabled}
            onClick={props.onClick}>
            {props.label}
        </button>
    );
}

function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString([], { hour12: false });
}

function recordStatusColor(result: string): string {
    if (result === "succeeded") {
        return "var(--vscode-testing-iconPassed, #3fb950)";
    }
    if (result === "pending" || result === "queued") {
        return "var(--vscode-descriptionForeground)";
    }
    return "var(--vscode-testing-iconFailed, #f85149)";
}

export function QueryStudioReplayApp() {
    const { extensionRpc } = useVscodeWebview<
        QueryStudioReplayWebviewState,
        QueryStudioReplayReducers
    >();
    const state = useVscodeSelector<
        QueryStudioReplayWebviewState,
        QueryStudioReplayReducers,
        QueryStudioReplayWebviewState
    >((snapshot) => snapshot);

    if (!state) {
        return <div style={PAGE_STYLE}>Loading…</div>;
    }

    const action = <K extends keyof QueryStudioReplayReducers>(
        name: K,
        payload: QueryStudioReplayReducers[K],
    ) => extensionRpc.action(name, payload);

    const activeRun = state.replay.runs.find((run) => run.id === state.replay.activeRunId);

    return (
        <div style={PAGE_STYLE}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <h2 style={{ margin: 0, fontSize: "15px" }}>Query Studio Replay Lab</h2>
                <span
                    style={{
                        ...BADGE_STYLE,
                        background: state.captureArmed
                            ? "var(--vscode-testing-iconPassed, #3fb950)"
                            : "var(--vscode-descriptionForeground)",
                        color: "var(--vscode-editor-background)",
                    }}>
                    {state.captureArmed ? "capture armed" : "capture off"}
                </span>
                <span
                    style={{
                        ...BADGE_STYLE,
                        background: state.elevatedCapture
                            ? "var(--vscode-charts-orange, #d29922)"
                            : "var(--vscode-descriptionForeground)",
                        color: "var(--vscode-editor-background)",
                    }}>
                    {state.elevatedCapture ? "elevated (SQL text)" : "digest-only"}
                </span>
                <div style={{ flex: 1 }} />
                <Button label="Refresh" onClick={() => action("refresh", {})} />
                <Button label="Save trace" onClick={() => action("saveTraceNow", {})} />
                <Button label="Clear records" onClick={() => action("clearRecords", {})} />
            </div>

            <div style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)" }}>
                Runs are captured while this panel is open (or when mssql.queryStudio.replay.enabled
                is set). Replayable SQL text requires Debug Console elevated capture at record time;
                digest-only records cannot re-execute. Live targets:{" "}
                {state.liveTargets.length === 0
                    ? "none — open a Query Studio document to replay"
                    : state.liveTargets
                          .map(
                              (target) =>
                                  `${target.fileName}${target.connected ? "" : " (disconnected)"}`,
                          )
                          .join(", ")}
            </div>

            {state.lastError ? (
                <div
                    style={{
                        color: "var(--vscode-errorForeground)",
                        fontSize: "12px",
                        border: "1px solid var(--vscode-errorForeground)",
                        borderRadius: "3px",
                        padding: "4px 8px",
                    }}>
                    {state.lastError}
                </div>
            ) : undefined}

            <section>
                <h3 style={{ margin: "0 0 6px", fontSize: "13px" }}>
                    Captured runs ({state.records.length})
                </h3>
                <table style={TABLE_STYLE}>
                    <thead>
                        <tr>
                            {[
                                "Time",
                                "Status",
                                "Database",
                                "Scope",
                                "Mode",
                                "Batches",
                                "Rows",
                                "ms",
                                "Text",
                                "",
                            ].map((header) => (
                                <th key={header} style={{ ...CELL_STYLE, fontWeight: 600 }}>
                                    {header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {state.records.map((record: QsRunRecord) => (
                            <tr key={record.id}>
                                <td style={CELL_STYLE}>{formatTime(record.timestamp)}</td>
                                <td
                                    style={{
                                        ...CELL_STYLE,
                                        color: recordStatusColor(record.result),
                                    }}>
                                    {record.result}
                                    {record.replayTags ? (
                                        <span
                                            style={{
                                                ...BADGE_STYLE,
                                                background: "var(--vscode-charts-blue, #388bfd)",
                                                color: "var(--vscode-editor-background)",
                                            }}>
                                            replay
                                        </span>
                                    ) : undefined}
                                </td>
                                <td style={CELL_STYLE}>{record.database ?? "—"}</td>
                                <td style={CELL_STYLE}>{record.scope}</td>
                                <td style={CELL_STYLE}>{record.mode}</td>
                                <td style={CELL_STYLE}>{record.batches.length}</td>
                                <td style={CELL_STYLE}>{record.outcome?.totalRows ?? "—"}</td>
                                <td style={CELL_STYLE}>{record.outcome?.durationMs ?? "—"}</td>
                                <td style={CELL_STYLE}>{record.elevated ? "yes" : "digest"}</td>
                                <td style={CELL_STYLE}>
                                    <Button
                                        label="Add to cart"
                                        disabled={
                                            record.result === "pending" ||
                                            record.result === "queued"
                                        }
                                        onClick={() =>
                                            action("addToCart", { recordIds: [record.id] })
                                        }
                                    />
                                </td>
                            </tr>
                        ))}
                        {state.records.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={10}
                                    style={{
                                        ...CELL_STYLE,
                                        color: "var(--vscode-descriptionForeground)",
                                    }}>
                                    No captured runs yet — execute a query in Query Studio while
                                    capture is armed.
                                </td>
                            </tr>
                        ) : undefined}
                    </tbody>
                </table>
            </section>

            <section>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <h3 style={{ margin: "0 0 6px", fontSize: "13px" }}>
                        Replay cart ({state.replay.cart.length})
                    </h3>
                    <div style={{ flex: 1 }} />
                    <Button
                        label="Replay cart"
                        disabled={state.replay.cart.length === 0}
                        onClick={() => action("queueCart", {})}
                    />
                    <Button
                        label="Cancel run"
                        disabled={!state.replay.activeRunId}
                        onClick={() => action("cancelRun", {})}
                    />
                    <Button
                        label="Clear cart"
                        disabled={state.replay.cart.length === 0}
                        onClick={() => action("clearCart", {})}
                    />
                </div>
                <table style={TABLE_STYLE}>
                    <tbody>
                        {state.replay.cart.map((snapshot) => (
                            <tr key={snapshot.id}>
                                <td style={CELL_STYLE}>{snapshot.sourceLabel}</td>
                                <td style={CELL_STYLE}>{snapshot.configMode}</td>
                                <td style={CELL_STYLE}>
                                    {snapshot.event.elevated ? "replayable" : "digest-only"}
                                </td>
                                <td style={CELL_STYLE}>
                                    <Button
                                        label="Remove"
                                        onClick={() =>
                                            action("removeFromCart", { snapshotId: snapshot.id })
                                        }
                                    />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>

            <section>
                <h3 style={{ margin: "0 0 6px", fontSize: "13px" }}>Runs</h3>
                {activeRun ? (
                    <div style={{ fontSize: "12px", marginBottom: "4px" }}>
                        Active: {activeRun.id} — {activeRun.completedEvents}/{activeRun.totalEvents}
                    </div>
                ) : undefined}
                <table style={TABLE_STYLE}>
                    <tbody>
                        {state.replay.runs
                            .slice()
                            .reverse()
                            .map((run) => (
                                <tr key={run.id}>
                                    <td style={CELL_STYLE}>{formatTime(run.startedAt)}</td>
                                    <td style={CELL_STYLE}>{run.kind}</td>
                                    <td style={CELL_STYLE}>{run.status}</td>
                                    <td style={CELL_STYLE}>
                                        {run.completedEvents}/{run.totalEvents}
                                    </td>
                                    <td style={CELL_STYLE}>{run.traceId}</td>
                                </tr>
                            ))}
                    </tbody>
                </table>
            </section>
        </div>
    );
}
