/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query Studio webview app — M0 shell (doc 01 layout: toolbar 35px, editor
 * fills, status bar 24px; the RESULTS REGION IS ABSENT until a first
 * execution exists — B3). Monaco rides the shared VscodeEditor (theme bridge
 * included); text convergence uses the QsSync protocol with coalesced edit
 * groups, echo suppression, and the resync valve.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type * as monacoNs from "monaco-editor";
import { VscodeEditor } from "../../common/vscodeMonaco";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import {
    QsCancelRequest,
    QsConnectRequest,
    QsExecuteRequest,
    QsGetDiagnosticsSummaryRequest,
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

type Editor = monacoNs.editor.IStandaloneCodeEditor;

let editGroupCounter = 0;

export function QueryStudioApp() {
    const { extensionRpc: rpc, themeKind } = useVscodeWebview<QsState, void>();
    const [state, setState] = useState<QsState | undefined>(undefined);
    const [cursor, setCursor] = useState({ line: 1, column: 1 });
    const editorRef = useRef<Editor | null>(null);
    const hostVersionRef = useRef(0);
    const suppressLocalRef = useRef(false);
    const pendingEditsRef = useRef<QsTextEdit[]>([]);
    const flushTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const expectedEchoGroupsRef = useRef<Set<string>>(new Set());

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
        ];
        // Signal readiness → host ends the open marker.
        void rpc.sendRequest(QsGetDiagnosticsSummaryRequest.type, undefined);
    }, [rpc, applyRemoteText, flushEdits]);

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
        void rpc.sendRequest(QsExecuteRequest.type, { scope: "document" });
    }, [rpc, flushEdits]);
    const cancel = useCallback(() => {
        void rpc.sendRequest(QsCancelRequest.type, undefined);
    }, [rpc]);
    const connect = useCallback(() => {
        void rpc.sendRequest(QsConnectRequest.type, {});
    }, [rpc]);

    // Keybindings (addendum §4): F5/Ctrl+E execute — webview-internal.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "F5") {
                e.preventDefault();
                execute();
            } else if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "e") {
                e.preventDefault();
                execute();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [execute]);

    const connection = state?.connection ?? { kind: "disconnected" as const };
    const connected = connection.kind === "connected" || connection.kind === "executing";
    const executing = state?.execution.kind === "executing";

    return (
        <div className="qs-root">
            <div className="qs-toolbar" role="toolbar" aria-label="Query Studio toolbar">
                <button
                    className={`qs-btn ${connection.kind === "disconnected" ? "primary" : ""}`}
                    title="Connect to a SQL Server (data plane arrives in M1)"
                    onClick={connect}>
                    <span className="codicon codicon-plug" /> Connect
                </button>
                <div className="qs-sep" />
                <button
                    className="qs-btn qs-database"
                    disabled={!connected}
                    title={connected ? "Change database" : "Connect first"}>
                    <span className="codicon codicon-database" />{" "}
                    {connection.database ?? "Database"}
                    <span className="codicon codicon-chevron-down" />
                </button>
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
                <button className="qs-btn" disabled={!connected} title="Parse (syntax check)">
                    <span className="codicon codicon-check" />
                </button>
                <span className="qs-spacer" />
                <span className="qs-muted" title="Trace: recording digests · Replay: not armed">
                    <span className="codicon codicon-pulse" />
                </span>
            </div>
            <div className="qs-editor">
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
            {/* Results region intentionally ABSENT before first execution
                (doc 01 §4): it mounts in B3 with the shared grid. */}
            <div className="qs-statusbar" role="status">
                <span
                    className="qs-status-message"
                    data-kind={state?.statusMessage.kind ?? "ready"}>
                    {state?.statusMessage.text ?? "Ready — not connected"}
                </span>
                <span className="qs-spacer" />
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

// --- Monaco global helpers (the shared VscodeEditor loads monaco onto the
// window via @monaco-editor/react loader; these read the runtime namespace
// without importing the full editor into this chunk twice). ------------------

function monacoGlobal(): typeof monacoNs {
    return (window as unknown as { monaco: typeof monacoNs }).monaco;
}

function monacoKeyMod(): typeof monacoNs.KeyMod {
    return monacoGlobal().KeyMod;
}

function monacoKeyCode(): typeof monacoNs.KeyCode {
    return monacoGlobal().KeyCode;
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
