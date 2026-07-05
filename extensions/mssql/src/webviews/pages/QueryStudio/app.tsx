/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query Studio webview app (doc 01 layout): toolbar 35px, editor, results
 * region (ABSENT until the first execution; then tab strip + stacked
 * virtualized grids + Messages), status bar 24px. Monaco rides the shared
 * VscodeEditor; text convergence uses the QsSync protocol (coalesced edit
 * groups, echo suppression, resync valve). Rows never ride notifications —
 * QsRowsAppended counts trigger window refetches through QsGetRows.
 * `mssql.queryStudio.resultsRendered` fires after the terminal state's next
 * paint (double-rAF — the user-perceived end of a run).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type * as monacoNs from "monaco-editor";
import { VscodeEditor } from "../../common/vscodeMonaco";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { perfMarkAfterNextPaint } from "../../common/perfMarks";
import {
    QsCancelRequest,
    QsConnectRequest,
    QsExecuteRequest,
    QsGetDiagnosticsSummaryRequest,
    QsMessageRow,
    QsMessagesAppendedNotification,
    QsRevealPositionNotification,
    QsListDatabasesRequest,
    QsRowsAppendedNotification,
    QsSetActualPlanRequest,
    QsSetDatabaseRequest,
    QsState,
    QsStateChangedNotification,
    QsSyncEdits,
    QsSyncEditsRequest,
    QsSyncInit,
    QsSyncInitNotification,
    QsSyncRemote,
    QsSyncRemoteNotification,
    QsSyncResync,
    QsSyncResyncNotification,
    QsSyncResyncRequest,
    QsSyncSaveRequest,
    QsSyncUndoRequest,
    QsTextEdit,
} from "../../../sharedInterfaces/queryStudio";
import { textHash, SYNC_COALESCE_MS } from "../../../queryStudio/textSync";
import { MessagesView, ResultGrid } from "./results";
import { monacoApi } from "./monacoSetup";

type Editor = monacoNs.editor.IStandaloneCodeEditor;

let editGroupCounter = 0;

const TERMINAL_KINDS = new Set([
    "succeeded",
    "completedWithErrors",
    "failed",
    "canceled",
    "connectionLost",
]);

export function QueryStudioApp() {
    const { extensionRpc: rpc, themeKind } = useVscodeWebview<QsState, void>();
    const [state, setState] = useState<QsState | undefined>(undefined);
    const [cursor, setCursor] = useState({ line: 1, column: 1 });
    const [messages, setMessages] = useState<QsMessageRow[]>([]);
    const [rowVersions, setRowVersions] = useState<Record<string, number>>({});
    const [activeTab, setActiveTab] = useState<"results" | "messages">("results");
    const [resultsCollapsed, setResultsCollapsed] = useState(false);
    const [resultsHeightPct, setResultsHeightPct] = useState(45);
    const editorRef = useRef<Editor | null>(null);
    const hostVersionRef = useRef(0);
    const suppressLocalRef = useRef(false);
    const pendingEditsRef = useRef<QsTextEdit[]>([]);
    const flushTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const expectedEchoGroupsRef = useRef<Set<string>>(new Set());
    const renderedRunRef = useRef<number | undefined>(undefined);
    const rootRef = useRef<HTMLDivElement | null>(null);

    // --- sync: webview → host --------------------------------------------
    const flushEdits = useCallback(() => {
        if (flushTimerRef.current) {
            clearTimeout(flushTimerRef.current);
            flushTimerRef.current = undefined;
        }
        const editor = editorRef.current;
        const edits = pendingEditsRef.current;
        if (!editor || edits.length === 0) {
            return;
        }
        pendingEditsRef.current = [];
        const groupId = `wg_${(++editGroupCounter).toString(36)}`;
        expectedEchoGroupsRef.current.add(groupId);
        const payload: QsSyncEdits = {
            baseHostVersion: hostVersionRef.current,
            editGroupId: groupId,
            edits,
            textHashAfter: textHash(editor.getValue()),
        };
        void rpc.sendRequest(QsSyncEditsRequest.type, payload).then((outcome) => {
            if (outcome.applied) {
                hostVersionRef.current = outcome.hostVersion;
            }
            // Rejections reconcile via the remote/resync notifications.
        });
    }, [rpc]);

    const queueLocalEdits = useCallback(
        (edits: QsTextEdit[]) => {
            pendingEditsRef.current.push(...edits);
            if (!flushTimerRef.current) {
                flushTimerRef.current = setTimeout(flushEdits, SYNC_COALESCE_MS);
            }
        },
        [flushEdits],
    );

    // --- sync: host → webview ----------------------------------------------
    const applyRemoteText = useCallback((text: string, hostVersion: number) => {
        const editor = editorRef.current;
        hostVersionRef.current = hostVersion;
        if (!editor || editor.getValue() === text) {
            return;
        }
        suppressLocalRef.current = true;
        try {
            const model = editor.getModel();
            model?.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
        } finally {
            suppressLocalRef.current = false;
        }
    }, []);

    useEffect(() => {
        // onNotification registrations live for the webview lifetime.
        [
            rpc.onNotification(QsSyncInitNotification.type, (init: QsSyncInit) => {
                applyRemoteText(init.text, init.hostVersion);
            }),
            rpc.onNotification(QsSyncRemoteNotification.type, (remote: QsSyncRemote) => {
                if (
                    remote.reason === "echo" &&
                    remote.echoOfEditGroupId &&
                    expectedEchoGroupsRef.current.delete(remote.echoOfEditGroupId)
                ) {
                    hostVersionRef.current = remote.toHostVersion;
                    return; // our own edit reflected — do not reapply
                }
                const editor = editorRef.current;
                if (!editor) {
                    return;
                }
                // Apply host-origin edits; verify hash, else request resync.
                flushEdits();
                suppressLocalRef.current = true;
                try {
                    const model = editor.getModel();
                    if (model) {
                        const ops = remote.edits.map((edit) => ({
                            range: monacoRange(model, edit),
                            text: edit.text,
                        }));
                        if (ops.length > 0) {
                            model.pushEditOperations([], ops, () => null);
                        }
                    }
                } finally {
                    suppressLocalRef.current = false;
                }
                hostVersionRef.current = remote.toHostVersion;
                if (editor.getValue() && textHash(editor.getValue()) !== remote.textHash) {
                    void rpc
                        .sendRequest(QsSyncResyncRequest.type, {
                            webviewVersion: remote.toHostVersion,
                            textHash: textHash(editor.getValue()),
                        })
                        .then((resync) => applyRemoteText(resync.text, resync.hostVersion));
                }
            }),
            rpc.onNotification(QsSyncResyncNotification.type, (resync: QsSyncResync) => {
                applyRemoteText(resync.text, resync.hostVersion);
            }),
            rpc.onNotification(QsStateChangedNotification.type, (next: QsState) => {
                setState(next);
            }),
            rpc.onNotification(
                QsRowsAppendedNotification.type,
                (p: { resultSetId: string; newRowCount: number }) => {
                    setRowVersions((v) => ({
                        ...v,
                        [p.resultSetId]: (v[p.resultSetId] ?? 0) + 1,
                    }));
                },
            ),
            rpc.onNotification(
                QsMessagesAppendedNotification.type,
                (p: { messages: QsMessageRow[] }) => {
                    setMessages((m) => [...m, ...p.messages]);
                },
            ),
            rpc.onNotification(
                QsRevealPositionNotification.type,
                (p: { line: number; column: number; flash?: boolean }) => {
                    const editor = editorRef.current;
                    if (!editor) {
                        return;
                    }
                    editor.revealLineInCenter(p.line);
                    editor.setPosition({ lineNumber: p.line, column: p.column });
                    editor.focus();
                },
            ),
        ];
        // Signal readiness → host ends the open marker.
        void rpc.sendRequest(QsGetDiagnosticsSummaryRequest.type, undefined);
    }, [rpc, applyRemoteText, flushEdits]);

    // Run lifecycle: reset per-run webview state on a new run; fire the
    // resultsRendered mark once per run after the terminal paint.
    const runId = state?.execution.startedEpochMs;
    const executionKind = state?.execution.kind ?? "idle";
    useEffect(() => {
        if (executionKind === "executing" && renderedRunRef.current !== runId) {
            setMessages([]);
            setRowVersions({});
            setActiveTab("results");
            setResultsCollapsed(false);
        }
        if (TERMINAL_KINDS.has(executionKind) && runId && renderedRunRef.current !== runId) {
            renderedRunRef.current = runId;
            perfMarkAfterNextPaint("mssql.queryStudio.resultsRendered", {
                status: executionKind,
                rows: state?.results.totalRows ?? 0,
                resultSets: state?.results.resultSets.length ?? 0,
            });
            // Error-only runs: land the user on Messages (SSMS behavior).
            if (
                (state?.results.resultSets.length ?? 0) === 0 &&
                (state?.results.messageCount ?? 0) > 0
            ) {
                setActiveTab("messages");
            }
        }
    }, [executionKind, runId, state]);

    // --- editor wiring -------------------------------------------------------
    const onEditorMount = useCallback(
        (editor: Editor) => {
            editorRef.current = editor;
            editor.onDidChangeModelContent((e) => {
                if (suppressLocalRef.current) {
                    return;
                }
                queueLocalEdits(
                    e.changes.map((change) => ({
                        start: change.rangeOffset,
                        end: change.rangeOffset + change.rangeLength,
                        text: change.text,
                    })),
                );
            });
            editor.onDidChangeCursorPosition((e) => {
                setCursor({ line: e.position.lineNumber, column: e.position.column });
            });
            // Host-owned undo/redo (doc 04 §8.4).
            editor.addCommand(monacoKeyMod().CtrlCmd | monacoKeyCode().KeyZ, () => {
                flushEdits();
                void rpc.sendRequest(QsSyncUndoRequest.type, { redo: false });
            });
            editor.addCommand(monacoKeyMod().CtrlCmd | monacoKeyCode().KeyY, () => {
                flushEdits();
                void rpc.sendRequest(QsSyncUndoRequest.type, { redo: true });
            });
            editor.addCommand(monacoKeyMod().CtrlCmd | monacoKeyCode().KeyS, () => {
                flushEdits();
                void rpc.sendRequest(QsSyncSaveRequest.type, undefined);
            });
        },
        [queueLocalEdits, flushEdits, rpc],
    );

    // --- commands -------------------------------------------------------------
    const execute = useCallback(() => {
        flushEdits();
        const editor = editorRef.current;
        const selection = editor?.getSelection();
        if (selection && !selection.isEmpty()) {
            void rpc.sendRequest(QsExecuteRequest.type, {
                scope: "selection",
                selection: {
                    startLine: selection.startLineNumber,
                    startColumn: selection.startColumn,
                    endLine: selection.endLineNumber,
                    endColumn: selection.endColumn,
                },
            });
        } else {
            void rpc.sendRequest(QsExecuteRequest.type, { scope: "document" });
        }
    }, [rpc, flushEdits]);
    const cancel = useCallback(() => {
        void rpc.sendRequest(QsCancelRequest.type, undefined);
    }, [rpc]);
    const connect = useCallback(() => {
        void rpc.sendRequest(QsConnectRequest.type, {});
    }, [rpc]);
    const [dbList, setDbList] = useState<string[] | undefined>(undefined);
    const toggleDbList = useCallback(() => {
        setDbList((current) => {
            if (current) {
                return undefined;
            }
            void rpc
                .sendRequest(QsListDatabasesRequest.type, undefined)
                .then((r) => setDbList(r.databases));
            return [];
        });
    }, [rpc]);
    const pickDatabase = useCallback(
        (database: string) => {
            setDbList(undefined);
            void rpc.sendRequest(QsSetDatabaseRequest.type, { database });
        },
        [rpc],
    );
    const parse = useCallback(() => {
        flushEdits();
        void rpc.sendRequest(QsExecuteRequest.type, { scope: "document", parseOnly: true });
    }, [rpc, flushEdits]);
    const estimatedPlan = useCallback(() => {
        flushEdits();
        void rpc.sendRequest(QsExecuteRequest.type, {
            scope: "document",
            estimatedPlanOnly: true,
        });
    }, [rpc, flushEdits]);
    const toggleActualPlan = useCallback(() => {
        void rpc.sendRequest(QsSetActualPlanRequest.type, {
            enabled: !(state?.toggles.actualPlan ?? false),
        });
    }, [rpc, state]);

    // Keybindings (addendum §4): F5/Ctrl+E execute; Ctrl+R toggles results.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "F5") {
                e.preventDefault();
                execute();
            } else if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "e") {
                e.preventDefault();
                execute();
            } else if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "r") {
                e.preventDefault();
                setResultsCollapsed((c) => !c);
            } else if (e.altKey && e.key.toLowerCase() === "b") {
                e.preventDefault();
                cancel();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [execute, cancel]);

    // --- splitter --------------------------------------------------------------
    const onSplitterDown = useCallback((down: React.PointerEvent) => {
        down.preventDefault();
        const root = rootRef.current;
        if (!root) {
            return;
        }
        const move = (e: PointerEvent) => {
            const rect = root.getBoundingClientRect();
            const fromBottom = rect.bottom - 24 - e.clientY; // status bar
            const pct = Math.min(80, Math.max(15, (fromBottom / (rect.height - 59)) * 100));
            setResultsHeightPct(pct);
        };
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    }, []);
    const resetSplit = useCallback(() => setResultsHeightPct(45), []);

    const connection = state?.connection ?? { kind: "disconnected" as const };
    const connected = connection.kind === "connected" || connection.kind === "executing";
    const executing = executionKind === "executing" || executionKind === "cancelRequested";
    const results = state?.results;
    const showResults = (results?.present ?? false) && !resultsCollapsed;
    const errorCount = results?.errorCount ?? 0;
    const elapsed = state?.execution.elapsedMs;

    return (
        <div className="qs-root" ref={rootRef}>
            <div className="qs-toolbar" role="toolbar" aria-label="Query Studio toolbar">
                <button
                    className={`qs-btn ${connection.kind === "disconnected" ? "primary" : ""}`}
                    title={connected ? "Change connection" : "Connect to a SQL Server"}
                    onClick={connect}>
                    <span className="codicon codicon-plug" /> {connected ? "Change" : "Connect"}
                </button>
                <div className="qs-sep" />
                <span className="qs-db-wrap">
                    <button
                        className="qs-btn qs-database"
                        disabled={!connected || executing}
                        onClick={toggleDbList}
                        title={connected ? "Change database" : "Connect first"}>
                        <span className="codicon codicon-database" />{" "}
                        {connection.database ?? "Database"}
                        <span className="codicon codicon-chevron-down" />
                    </button>
                    {dbList ? (
                        <div className="qs-db-menu" role="listbox">
                            {dbList.length === 0 ? (
                                <div className="qs-db-item qs-muted">Loading…</div>
                            ) : (
                                dbList.map((db) => (
                                    <div
                                        key={db}
                                        role="option"
                                        aria-selected={db === connection.database}
                                        className={`qs-db-item ${db === connection.database ? "active" : ""}`}
                                        onClick={() => pickDatabase(db)}>
                                        {db}
                                    </div>
                                ))
                            )}
                        </div>
                    ) : null}
                </span>
                <div className="qs-sep" />
                <button
                    className="qs-btn"
                    disabled={!connected || executing}
                    title="Execute (F5 / Ctrl+E)"
                    onClick={execute}>
                    <span className="codicon codicon-play" /> Execute
                </button>
                <button
                    className="qs-btn"
                    disabled={!executing}
                    title="Cancel executing query (Alt+B)"
                    onClick={cancel}>
                    <span className="codicon codicon-debug-stop" />
                </button>
                <button
                    className="qs-btn"
                    disabled={!connected || executing}
                    title="Parse (syntax check only)"
                    onClick={parse}>
                    <span className="codicon codicon-check" />
                </button>
                <div className="qs-sep" />
                <button
                    className="qs-btn"
                    disabled={!connected || executing}
                    title="Display estimated execution plan"
                    onClick={estimatedPlan}>
                    <span className="codicon codicon-type-hierarchy-sub" />
                </button>
                <button
                    className={`qs-btn ${state?.toggles.actualPlan ? "toggled" : ""}`}
                    disabled={!connected}
                    title="Include actual execution plan (applies to next execute)"
                    onClick={toggleActualPlan}>
                    <span className="codicon codicon-graph" />
                </button>
                <span className="qs-spacer" />
                {results?.present ? (
                    <button
                        className="qs-btn"
                        title="Toggle results pane (Ctrl+R)"
                        onClick={() => setResultsCollapsed((c) => !c)}>
                        <span
                            className={`codicon codicon-layout-panel${resultsCollapsed ? "-off" : ""}`}
                        />
                    </button>
                ) : null}
                <span className="qs-muted" title="Trace: recording digests · Replay: not armed">
                    <span className="codicon codicon-pulse" />
                </span>
            </div>
            <div
                className="qs-editor"
                style={showResults ? { flexBasis: `${100 - resultsHeightPct}%` } : undefined}>
                <VscodeEditor
                    themeKind={themeKind}
                    height="100%"
                    language="sql"
                    onMount={onEditorMount as never}
                    options={{
                        minimap: { enabled: false },
                        lineNumbers: "on",
                        wordWrap: "off",
                        renderLineHighlight: "line",
                        scrollBeyondLastLine: false,
                    }}
                />
            </div>
            {showResults && results ? (
                <>
                    <div
                        className="qs-splitter"
                        onPointerDown={onSplitterDown}
                        onDoubleClick={resetSplit}
                        role="separator"
                        aria-orientation="horizontal"
                    />
                    <div className="qs-results" style={{ flexBasis: `${resultsHeightPct}%` }}>
                        <div className="qs-results-tabs" role="tablist">
                            <button
                                role="tab"
                                aria-selected={activeTab === "results"}
                                className={`qs-tab ${activeTab === "results" ? "active" : ""}`}
                                onClick={() => setActiveTab("results")}>
                                Results
                                {results.totalRows > 0
                                    ? ` (${results.totalRows.toLocaleString()})`
                                    : ""}
                            </button>
                            <button
                                role="tab"
                                aria-selected={activeTab === "messages"}
                                className={`qs-tab ${activeTab === "messages" ? "active" : ""} ${errorCount > 0 ? "has-errors" : ""}`}
                                onClick={() => setActiveTab("messages")}>
                                Messages
                                {errorCount > 0 ? ` (${errorCount} ⚠)` : ""}
                            </button>
                            <span className="qs-spacer" />
                            {results.streaming ? (
                                <span className="qs-muted qs-streaming">streaming…</span>
                            ) : null}
                        </div>
                        <div className="qs-results-body">
                            {activeTab === "results" ? (
                                results.resultSets.length > 0 ? (
                                    results.resultSets.map((summary) => (
                                        <ResultGrid
                                            key={summary.resultSetId}
                                            rpc={rpc}
                                            summary={summary}
                                            version={rowVersions[summary.resultSetId] ?? 0}
                                        />
                                    ))
                                ) : (
                                    <div className="qs-muted qs-message">
                                        No result sets returned.
                                    </div>
                                )
                            ) : (
                                <MessagesView rpc={rpc} messages={messages} />
                            )}
                        </div>
                    </div>
                </>
            ) : null}
            <div className="qs-statusbar" role="status">
                <span
                    className="qs-status-message"
                    data-kind={state?.statusMessage.kind ?? "ready"}>
                    {state?.statusMessage.text ?? "Ready — not connected"}
                </span>
                <span className="qs-spacer" />
                {results?.present ? (
                    <span className="qs-status-seg">{results.totalRows.toLocaleString()} rows</span>
                ) : null}
                {elapsed !== undefined ? (
                    <span className="qs-status-seg">{formatElapsed(elapsed)}</span>
                ) : null}
                {connected ? (
                    <>
                        <span className="qs-status-seg">
                            {connection.encrypted ? (
                                <span className="codicon codicon-lock" />
                            ) : null}{" "}
                            {connection.serverDisplayName}
                        </span>
                        <span className="qs-status-seg">
                            {connection.loginName}
                            {connection.spid !== undefined ? ` (${connection.spid})` : ""}
                        </span>
                        <span className="qs-status-seg">{connection.database}</span>
                    </>
                ) : null}
                <span className="qs-status-seg">
                    Ln {cursor.line}, Col {cursor.column}
                </span>
            </div>
        </div>
    );
}

function formatElapsed(ms: number): string {
    if (ms < 1000) {
        return `${ms}ms`;
    }
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// --- Monaco helpers over the BUNDLED namespace (monacoSetup) -----------------

function monacoKeyMod(): typeof monacoNs.KeyMod {
    return monacoApi.KeyMod;
}

function monacoKeyCode(): typeof monacoNs.KeyCode {
    return monacoApi.KeyCode;
}

function monacoRange(model: monacoNs.editor.ITextModel, edit: QsTextEdit): monacoNs.IRange {
    const start = model.getPositionAt(edit.start);
    const end = model.getPositionAt(edit.end);
    return {
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
    };
}
