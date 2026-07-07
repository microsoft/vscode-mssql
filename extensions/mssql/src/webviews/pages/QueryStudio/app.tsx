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
    QsGetMessagesRequest,
    QsMessageRow,
    QsInlineCompletionAcceptedRequest,
    QsInlineCompletionRequest,
    QsMessagesAppendedNotification,
    QsOpenPlanRequest,
    QsRevealPositionNotification,
    QsListDatabasesRequest,
    QsRowsAppendedNotification,
    QsSetActualPlanRequest,
    QsSetDatabaseRequest,
    QsState,
    QsStateChangedNotification,
    QsSyncEdits,
    QsShowCommandPaletteRequest,
    QsSyncAdoptRequest,
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
import {
    QsLangCompletionItemKind,
    QsLangCompletionRequest,
    QsLangDefinitionRequest,
    QsLangDiagnostic,
    QsLangDiagnosticSeverity,
    QsLangDiagnosticsChangedNotification,
    QsLangDiagnosticsRequest,
    QsLangDocumentSymbol,
    QsLangDocumentSymbolsRequest,
    QsLangFoldingRequest,
    QsLangHoverRequest,
    QsLangRange,
    QsLangSignatureHelpRequest,
} from "../../../sharedInterfaces/queryStudioLanguage";
import { computeResultsLayout } from "../../../sharedInterfaces/queryStudioResultsLayout";
import { textHash, SYNC_COALESCE_MS } from "../../../queryStudio/textSync";
import { MessagesView, ResultGridBlock } from "./results";
import { QsResultsGridProvider, qsGridRowHeight } from "./resultsGrid";
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

/**
 * Results layout metrics (sizing v2): rowHeight rides the grid style; the
 * header/chrome values approximate the slickgrid header strip plus borders
 * and the horizontal-scrollbar allowance so "every row visible" never grows
 * a per-grid scrollbar; captionPx is the caption strip + block margin.
 */
const GRID_HEADER_PX = 34;
const GRID_CHROME_PX = 20;
const GRID_CAPTION_PX = 30;

export function QueryStudioApp() {
    const { extensionRpc: rpc, themeKind } = useVscodeWebview<QsState, void>();
    const [state, setState] = useState<QsState | undefined>(undefined);
    const [cursor, setCursor] = useState({ line: 1, column: 1 });
    const [messages, setMessages] = useState<QsMessageRow[]>([]);
    // Live per-set row counts accumulated from QsRowsAppended (counts only —
    // rows never ride notifications). The coarse state's summary rowCount is
    // debounced (≤10/s); the max of the two keeps grids growing smoothly.
    const [liveRowCounts, setLiveRowCounts] = useState<Record<string, number>>({});
    const [activeTab, setActiveTab] = useState<"results" | "messages">("results");
    const [resultsCollapsed, setResultsCollapsed] = useState(false);
    const [resultsHeightPct, setResultsHeightPct] = useState(45);
    // Grid maximize/restore (issue A): one grid can fill the whole results
    // pane; the others stay mounted but hidden. Reset per run.
    const [maximizedGridId, setMaximizedGridId] = useState<string | undefined>(undefined);
    // Measured results-body height — drives stacked-grid default heights.
    const resultsBodyRef = useRef<HTMLDivElement | null>(null);
    const [resultsPaneHeight, setResultsPaneHeight] = useState<number | undefined>(undefined);
    // Transient reason from a refused run attempt (execute guards return
    // { started: false, reason } — silence here was the "Execute does
    // nothing" bug). Overrides the host status line until the next attempt.
    const [actionHint, setActionHint] = useState<string | undefined>(undefined);
    const editorRef = useRef<Editor | null>(null);
    const hostVersionRef = useRef(0);
    const suppressLocalRef = useRef(false);
    const pendingEditsRef = useRef<QsTextEdit[]>([]);
    const flushTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const expectedEchoGroupsRef = useRef<Set<string>>(new Set());
    const renderedRunRef = useRef<number | undefined>(undefined);
    const rootRef = useRef<HTMLDivElement | null>(null);
    // QS-1 auto-open: runs are always webview-initiated, so plan mode is
    // tracked locally at the point the run is triggered. `planRunArmedRef`
    // is set by the Estimated Plan button (or Execute while the Actual Plan
    // toggle is on) and consumed once when the run starts; terminal states
    // then open each plan-flagged result set exactly once.
    const actualPlanEnabledRef = useRef(false);
    const planRunArmedRef = useRef(false);
    const startedRunRef = useRef<number | undefined>(undefined);
    const planAutoOpenRef = useRef<{ runId?: number; opened: Set<string> }>({
        opened: new Set(),
    });

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
                return;
            }
            // Divergence rejections reconcile via the resync notification;
            // stale-base rejections carry NO reconciliation (the host assumes
            // an interleaved remote reached us — false when the init itself
            // was missed) and would deadlock every subsequent group. Heal by
            // converging the host to the visible editor content, which is
            // the user-facing truth.
            expectedEchoGroupsRef.current.delete(groupId);
            hostVersionRef.current = outcome.hostVersion;
            const liveEditor = editorRef.current;
            if (!liveEditor) {
                return;
            }
            const adoptGroupId = `wg_${(++editGroupCounter).toString(36)}`;
            expectedEchoGroupsRef.current.add(adoptGroupId);
            void rpc
                .sendRequest(QsSyncAdoptRequest.type, {
                    text: liveEditor.getValue(),
                    editGroupId: adoptGroupId,
                })
                .then((adopted) => {
                    hostVersionRef.current = adopted.hostVersion;
                });
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
                    setLiveRowCounts((counts) => ({
                        ...counts,
                        [p.resultSetId]: (counts[p.resultSetId] ?? 0) + p.newRowCount,
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
    // Mirror the host's actual-plan toggle so `execute` can read it at
    // trigger time without re-registering its callback on every state push.
    useEffect(() => {
        actualPlanEnabledRef.current = state?.toggles.actualPlan ?? false;
    }, [state]);
    useEffect(() => {
        // Per-run webview reset: ONCE per run (startedRunRef), never per
        // state push — the old `renderedRunRef` guard stayed unequal for the
        // whole run, so EVERY executing-kind push wiped `messages` again and
        // a finished run showed "No messages".
        if (
            executionKind === "executing" &&
            runId !== undefined &&
            startedRunRef.current !== runId
        ) {
            startedRunRef.current = runId;
            setActionHint(undefined);
            setLiveRowCounts({});
            setActiveTab("results");
            setResultsCollapsed(false);
            setMaximizedGridId(undefined);
            // Message notifications can beat this (debounced) state push —
            // clearing alone would drop the run's opening lines. Replace
            // with the host's snapshot instead: notifications processed
            // after the response are strictly newer than the snapshot
            // (ordered channel), so nothing is lost or duplicated.
            setMessages([]);
            void rpc
                .sendRequest(QsGetMessagesRequest.type, {})
                .then((result) => setMessages(result.messages));
            // QS-1: consume the armed plan-mode flag once per run and reset
            // the "already auto-opened" tracking for the new run.
            planAutoOpenRef.current = {
                ...(planRunArmedRef.current ? { runId } : {}),
                opened: new Set(),
            };
            planRunArmedRef.current = false;
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
        // QS-1 auto-open: a plan-mode run that completed opens each of its
        // plan-flagged result sets exactly once (dedupe by resultSetId so
        // later state pushes/re-renders never re-open).
        if (
            (executionKind === "succeeded" || executionKind === "completedWithErrors") &&
            runId !== undefined &&
            planAutoOpenRef.current.runId === runId
        ) {
            for (const summary of state?.results.resultSets ?? []) {
                if (
                    summary.isPlanResult === true &&
                    !planAutoOpenRef.current.opened.has(summary.resultSetId)
                ) {
                    planAutoOpenRef.current.opened.add(summary.resultSetId);
                    void rpc.sendRequest(QsOpenPlanRequest.type, {
                        resultSetId: summary.resultSetId,
                    });
                }
            }
        }
    }, [executionKind, runId, state, rpc]);

    // --- editor wiring -------------------------------------------------------
    const onEditorMount = useCallback(
        (editor: Editor) => {
            editorRef.current = editor;
            // Pull the sync baseline instead of trusting the pushed init
            // alone — the push races webview startup, and a missed init used
            // to deadlock every edit group as stale-base. Gentle: never
            // clobber text the user already typed (the adopt path converges
            // that case).
            void rpc
                .sendRequest(QsSyncResyncRequest.type, { webviewVersion: 0, textHash: "" })
                .then((resync) => {
                    if (editor.getValue().length === 0) {
                        applyRemoteText(resync.text, resync.hostVersion);
                    } else {
                        hostVersionRef.current = resync.hostVersion;
                    }
                });
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
            // F1: VS Code's palette, not Monaco's quick-command (commands
            // route to this editor through VS Code).
            editor.addCommand(monacoKeyCode().F1, () => {
                void rpc.sendRequest(QsShowCommandPaletteRequest.type, undefined);
            });
            editor.addCommand(monacoKeyMod().CtrlCmd | monacoKeyCode().KeyS, () => {
                flushEdits();
                void rpc.sendRequest(QsSyncSaveRequest.type, undefined);
            });
        },
        [queueLocalEdits, flushEdits, rpc, applyRemoteText],
    );

    // --- commands -------------------------------------------------------------
    // Every run request surfaces a refused outcome in the status bar — a
    // guard reason (not connected / already executing / nothing to execute)
    // must never look like a dead button.
    const runOutcome = useCallback((outcome: { started: boolean; reason?: string }) => {
        setActionHint(outcome.started ? undefined : (outcome.reason ?? "Could not start the run."));
    }, []);
    const execute = useCallback(() => {
        flushEdits();
        setActionHint(undefined);
        // QS-1: an execute while the Actual Plan toggle is on is a plan-mode
        // run — its plan result sets auto-open on completion.
        planRunArmedRef.current = actualPlanEnabledRef.current;
        const editor = editorRef.current;
        const selection = editor?.getSelection();
        if (selection && !selection.isEmpty()) {
            void rpc
                .sendRequest(QsExecuteRequest.type, {
                    scope: "selection",
                    selection: {
                        startLine: selection.startLineNumber,
                        startColumn: selection.startColumn,
                        endLine: selection.endLineNumber,
                        endColumn: selection.endColumn,
                    },
                })
                .then(runOutcome);
        } else {
            void rpc.sendRequest(QsExecuteRequest.type, { scope: "document" }).then(runOutcome);
        }
    }, [rpc, flushEdits, runOutcome]);
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
        setActionHint(undefined);
        planRunArmedRef.current = false; // parse-only runs never open plans
        void rpc
            .sendRequest(QsExecuteRequest.type, { scope: "document", parseOnly: true })
            .then(runOutcome);
    }, [rpc, flushEdits, runOutcome]);
    const estimatedPlan = useCallback(() => {
        flushEdits();
        setActionHint(undefined);
        planRunArmedRef.current = true; // QS-1: auto-open the estimated plan
        void rpc
            .sendRequest(QsExecuteRequest.type, {
                scope: "document",
                estimatedPlanOnly: true,
            })
            .then(runOutcome);
    }, [rpc, flushEdits, runOutcome]);
    const toggleActualPlan = useCallback(() => {
        void rpc.sendRequest(QsSetActualPlanRequest.type, {
            enabled: !(state?.toggles.actualPlan ?? false),
        });
    }, [rpc, state]);

    // Keybindings (addendum §4): F5/Ctrl+E execute; Ctrl+R toggles results;
    // Alt+B cancels. CAPTURE phase + stopPropagation: VS Code's webview
    // bootstrap forwards bubbled keydowns to the workbench keybinding
    // service, so an un-stopped F5 here ALSO started a debug session in VS
    // Code. Chords this app does not handle fall through untouched — the
    // editor's clipboard/typing keys must keep their browser defaults.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const noMods = !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey;
            const ctrlOnly = e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey;
            const altOnly = e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey;
            let handled = false;
            if (e.key === "F5" && noMods) {
                execute();
                handled = true;
            } else if (ctrlOnly && e.key.toLowerCase() === "e") {
                execute();
                handled = true;
            } else if (ctrlOnly && e.key.toLowerCase() === "r") {
                setResultsCollapsed((c) => !c);
                handled = true;
            } else if (altOnly && e.key.toLowerCase() === "b") {
                cancel();
                handled = true;
            }
            if (handled) {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [execute, cancel]);

    // --- inline completions (B6): ghost text via the host's shared provider ----
    const completionsEnabled = state?.completions?.enabled === true;
    useEffect(() => {
        if (!completionsEnabled) {
            return;
        }
        const acceptedCommandId = "mssql.qs.inlineCompletionAccepted";
        let commandDisposable: { dispose(): void } | undefined;
        try {
            commandDisposable = monacoApi.editor.registerCommand(
                acceptedCommandId,
                (_accessor: unknown, eventId?: string) => {
                    void rpc.sendRequest(QsInlineCompletionAcceptedRequest.type, { eventId });
                },
            );
        } catch {
            // Already registered by a previous enable/disable cycle.
        }
        const providerDisposable = monacoApi.languages.registerInlineCompletionsProvider("sql", {
            provideInlineCompletions: async (_model, position, context) => {
                // Same staleness rule as lang completions: the host bridge
                // resolves positions against its mirror — push edits first.
                flushEdits();
                const response = await rpc.sendRequest(QsInlineCompletionRequest.type, {
                    line: position.lineNumber - 1,
                    character: position.column - 1,
                    trigger:
                        context.triggerKind ===
                        monacoApi.languages.InlineCompletionTriggerKind.Explicit
                            ? "invoke"
                            : "automatic",
                });
                if (!response?.text) {
                    return { items: [] };
                }
                return {
                    items: [
                        {
                            insertText: response.text,
                            range: new monacoApi.Range(
                                position.lineNumber,
                                position.column,
                                position.lineNumber,
                                position.column,
                            ),
                            command: {
                                id: acceptedCommandId,
                                title: "MSSQL inline SQL completion accepted",
                                arguments: [response.eventId],
                            },
                        },
                    ],
                };
            },
            disposeInlineCompletions: () => undefined,
        });
        return () => {
            providerDisposable.dispose();
            commandDisposable?.dispose();
        };
    }, [completionsEnabled, rpc]);

    // --- language features (LS-0): Monaco providers over the qs/lang.* bridge --
    useEffect(() => {
        const providerDisposables = [
            monacoApi.languages.registerCompletionItemProvider("sql", {
                triggerCharacters: [".", " ", "@", "("],
                provideCompletionItems: async (model, position, context) => {
                    try {
                        // Push pending keystrokes NOW and tell the host the
                        // exact text this request was computed against —
                        // otherwise completions bind one keystroke behind.
                        flushEdits();
                        const result = await rpc.sendRequest(QsLangCompletionRequest.type, {
                            line: position.lineNumber - 1,
                            character: position.column - 1,
                            textHash: textHash(model.getValue()),
                            trigger:
                                context.triggerKind ===
                                monacoApi.languages.CompletionTriggerKind.TriggerCharacter
                                    ? "character"
                                    : "invoke",
                            ...(context.triggerCharacter
                                ? { triggerCharacter: context.triggerCharacter }
                                : {}),
                        });
                        const word = model.getWordUntilPosition(position);
                        const range = new monacoApi.Range(
                            position.lineNumber,
                            word.startColumn,
                            position.lineNumber,
                            word.endColumn,
                        );
                        return {
                            suggestions: result.items.map((item) => ({
                                label: item.label,
                                kind: completionItemKind(item.kind),
                                insertText: item.insertText,
                                range: item.replaceRange
                                    ? new monacoApi.Range(
                                          item.replaceRange.start.line + 1,
                                          item.replaceRange.start.character + 1,
                                          item.replaceRange.end.line + 1,
                                          item.replaceRange.end.character + 1,
                                      )
                                    : range,
                                ...(item.isSnippet
                                    ? {
                                          insertTextRules:
                                              monacoApi.languages.CompletionItemInsertTextRule
                                                  .InsertAsSnippet,
                                      }
                                    : {}),
                                ...(item.detail !== undefined ? { detail: item.detail } : {}),
                                ...(item.documentation !== undefined
                                    ? { documentation: item.documentation }
                                    : {}),
                                ...(item.sortText !== undefined ? { sortText: item.sortText } : {}),
                                ...(item.filterText !== undefined
                                    ? { filterText: item.filterText }
                                    : {}),
                                ...(item.commitCharacters
                                    ? { commitCharacters: [...item.commitCharacters] }
                                    : {}),
                            })),
                            incomplete: result.isIncomplete,
                        };
                    } catch {
                        return { suggestions: [] };
                    }
                },
            }),
            monacoApi.languages.registerHoverProvider("sql", {
                provideHover: async (model, position) => {
                    try {
                        flushEdits();
                        const result = await rpc.sendRequest(QsLangHoverRequest.type, {
                            line: position.lineNumber - 1,
                            character: position.column - 1,
                            textHash: textHash(model.getValue()),
                        });
                        if (!result) {
                            return null;
                        }
                        return {
                            contents: [{ value: result.contentsMarkdown }],
                            ...(result.range ? { range: langRangeToMonaco(result.range) } : {}),
                        };
                    } catch {
                        return null;
                    }
                },
            }),
            monacoApi.languages.registerSignatureHelpProvider("sql", {
                signatureHelpTriggerCharacters: ["(", ","],
                provideSignatureHelp: async (model, position) => {
                    try {
                        // "(" fires this the instant it is typed — flush and
                        // converge or the host resolves one keystroke behind.
                        flushEdits();
                        const result = await rpc.sendRequest(QsLangSignatureHelpRequest.type, {
                            line: position.lineNumber - 1,
                            character: position.column - 1,
                            textHash: textHash(model.getValue()),
                        });
                        if (!result) {
                            return null;
                        }
                        return {
                            value: {
                                signatures: result.signatures.map((signature) => ({
                                    label: signature.label,
                                    ...(signature.documentation !== undefined
                                        ? { documentation: signature.documentation }
                                        : {}),
                                    parameters: signature.parameters.map((parameter) => ({
                                        label: parameter.label,
                                        ...(parameter.documentation !== undefined
                                            ? { documentation: parameter.documentation }
                                            : {}),
                                    })),
                                })),
                                activeSignature: result.activeSignature,
                                activeParameter: result.activeParameter,
                            },
                            dispose: () => undefined,
                        };
                    } catch {
                        return null;
                    }
                },
            }),
            monacoApi.languages.registerDefinitionProvider("sql", {
                provideDefinition: async (model, position) => {
                    try {
                        flushEdits();
                        const result = await rpc.sendRequest(QsLangDefinitionRequest.type, {
                            line: position.lineNumber - 1,
                            character: position.column - 1,
                            textHash: textHash(model.getValue()),
                        });
                        if (!result?.range) {
                            return null;
                        }
                        return { uri: model.uri, range: langRangeToMonaco(result.range) };
                    } catch {
                        return null;
                    }
                },
            }),
            monacoApi.languages.registerFoldingRangeProvider("sql", {
                provideFoldingRanges: async () => {
                    try {
                        const result = await rpc.sendRequest(QsLangFoldingRequest.type, undefined);
                        return result.ranges.map((range) => ({
                            start: range.startLine + 1,
                            end: range.endLine + 1,
                            ...(range.kind === "comment"
                                ? { kind: monacoApi.languages.FoldingRangeKind.Comment }
                                : range.kind === "region"
                                  ? { kind: monacoApi.languages.FoldingRangeKind.Region }
                                  : {}),
                        }));
                    } catch {
                        return [];
                    }
                },
            }),
            monacoApi.languages.registerDocumentSymbolProvider("sql", {
                provideDocumentSymbols: async () => {
                    try {
                        const result = await rpc.sendRequest(
                            QsLangDocumentSymbolsRequest.type,
                            undefined,
                        );
                        return result.symbols.map(langSymbolToMonaco);
                    } catch {
                        return [];
                    }
                },
            }),
        ];
        const applyMarkers = (diagnostics: readonly QsLangDiagnostic[]) => {
            const model = editorRef.current?.getModel();
            if (!model) {
                return;
            }
            monacoApi.editor.setModelMarkers(
                model,
                "mssql-sqlLanguage",
                diagnostics.map(langDiagnosticToMarker),
            );
        };
        rpc.onNotification(QsLangDiagnosticsChangedNotification.type, (p) =>
            applyMarkers(p.diagnostics),
        );
        // Seed markers once — the changed notification only covers future pushes.
        void rpc
            .sendRequest(QsLangDiagnosticsRequest.type, undefined)
            .then((result) => applyMarkers(result.diagnostics))
            .catch(() => undefined);
        return () => {
            for (const disposable of providerDisposables) {
                disposable.dispose();
            }
        };
    }, [rpc, flushEdits]);

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

    // Results-pane sizing v2 (issue A): one grid (or a maximized one) FILLS
    // the pane — the grid's virtualized scrollbar is THE scrollbar. Multiple
    // grids split the measured pane: exact content heights when everything
    // fits, otherwise fair shares with a 12-row minimum and pane scrolling
    // only once even the minimums overflow (queryStudioResultsLayout).
    const resultSetSummaries = results?.resultSets ?? [];
    const maximizedGrid = resultSetSummaries.some((s) => s.resultSetId === maximizedGridId)
        ? maximizedGridId
        : undefined;
    const singleGrid = resultSetSummaries.length === 1;
    const resultsFillActive =
        activeTab === "results" &&
        resultSetSummaries.length > 0 &&
        (singleGrid || maximizedGrid !== undefined);
    const effectiveRowCount = (summary: (typeof resultSetSummaries)[number]) =>
        Math.max(summary.rowCount, liveRowCounts[summary.resultSetId] ?? 0);
    const resultsLayout = computeResultsLayout(
        resultSetSummaries.map(effectiveRowCount),
        // clientHeight includes the body's 4px vertical paddings.
        resultsPaneHeight !== undefined ? resultsPaneHeight - 8 : undefined,
        {
            rowHeight: qsGridRowHeight(state?.gridStyle),
            headerHeight: GRID_HEADER_PX,
            chromePx: GRID_CHROME_PX,
            captionPx: GRID_CAPTION_PX,
        },
    );
    useEffect(() => {
        const el = resultsBodyRef.current;
        if (!el) {
            return;
        }
        const measure = () =>
            setResultsPaneHeight((prev) => (prev === el.clientHeight ? prev : el.clientHeight));
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [showResults]);

    // Live elapsed ticker (SSMS parity): while executing, derive elapsed
    // locally from startedEpochMs so the clock counts even when no row or
    // message events arrive; terminal states show the host's final value.
    const startedEpochMs = state?.execution.startedEpochMs;
    const [nowMs, setNowMs] = useState<number>(() => Date.now());
    useEffect(() => {
        if (!executing) {
            return;
        }
        setNowMs(Date.now());
        const timer = window.setInterval(() => setNowMs(Date.now()), 500);
        return () => window.clearInterval(timer);
    }, [executing, startedEpochMs]);
    const elapsed =
        executing && startedEpochMs !== undefined
            ? Math.max(0, nowMs - startedEpochMs)
            : state?.execution.elapsedMs;

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
                        inlineSuggest: { enabled: true },
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
                        <div
                            className={`qs-results-body${resultsFillActive ? " qs-results-body-fill" : ""}`}
                            ref={resultsBodyRef}>
                            {activeTab === "results" ? (
                                results.resultSets.length > 0 ? (
                                    // Lazy mounting: captions always render; grid
                                    // bodies mount near the viewport (never unmount).
                                    <QsResultsGridProvider>
                                        {results.resultSets.map((summary, index) => {
                                            const isMaximized =
                                                maximizedGrid === summary.resultSetId;
                                            return (
                                                <ResultGridBlock
                                                    key={summary.resultSetId}
                                                    rpc={rpc}
                                                    summary={summary}
                                                    rowCount={effectiveRowCount(summary)}
                                                    gridStyle={state?.gridStyle}
                                                    sizing={
                                                        singleGrid || isMaximized
                                                            ? { kind: "fill" }
                                                            : (resultsLayout.sizing[index] ?? {
                                                                  kind: "fill",
                                                              })
                                                    }
                                                    runActive={executing}
                                                    hidden={
                                                        maximizedGrid !== undefined && !isMaximized
                                                    }
                                                    maximized={isMaximized}
                                                    onToggleMaximize={
                                                        singleGrid
                                                            ? undefined
                                                            : () =>
                                                                  setMaximizedGridId(
                                                                      isMaximized
                                                                          ? undefined
                                                                          : summary.resultSetId,
                                                                  )
                                                    }
                                                />
                                            );
                                        })}
                                    </QsResultsGridProvider>
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
                    data-kind={actionHint ? "error" : (state?.statusMessage.kind ?? "ready")}>
                    {actionHint ?? state?.statusMessage.text ?? "Ready — not connected"}
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
                        {(connection.openTransactions ?? 0) > 0 ? (
                            <span
                                className="qs-status-seg qs-status-tran"
                                title={`${connection.openTransactions} open transaction(s) on this session — COMMIT or ROLLBACK, or they roll back on disconnect`}>
                                <span className="codicon codicon-git-commit" /> TRAN (
                                {connection.openTransactions})
                            </span>
                        ) : null}
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
                        {connection.spid !== undefined ? (
                            <span className="qs-status-seg" title="Server process id">
                                SPID {connection.spid}
                            </span>
                        ) : null}
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

// --- language-feature mapping (qs/lang.* DTOs ⇄ Monaco, 0-based ⇄ 1-based) ----

function langRangeToMonaco(range: QsLangRange): monacoNs.IRange {
    return {
        startLineNumber: range.start.line + 1,
        startColumn: range.start.character + 1,
        endLineNumber: range.end.line + 1,
        endColumn: range.end.character + 1,
    };
}

function completionItemKind(kind: QsLangCompletionItemKind): monacoNs.languages.CompletionItemKind {
    const kinds = monacoApi.languages.CompletionItemKind;
    switch (kind) {
        case "keyword":
            return kinds.Keyword;
        case "table":
            return kinds.Class;
        case "view":
            return kinds.Interface;
        case "column":
            return kinds.Field;
        case "schema":
            return kinds.Module;
        case "database":
            return kinds.File;
        case "procedure":
            return kinds.Method;
        case "function":
            return kinds.Function;
        case "variable":
        case "parameter":
            return kinds.Variable;
        case "snippet":
        case "join":
            return kinds.Snippet;
        case "systemObject":
            return kinds.Class;
    }
}

function langDiagnosticToMarker(diagnostic: QsLangDiagnostic): monacoNs.editor.IMarkerData {
    return {
        severity: markerSeverity(diagnostic.severity),
        message: diagnostic.message,
        source: diagnostic.source,
        ...(diagnostic.code !== undefined ? { code: diagnostic.code } : {}),
        startLineNumber: diagnostic.range.start.line + 1,
        startColumn: diagnostic.range.start.character + 1,
        endLineNumber: diagnostic.range.end.line + 1,
        endColumn: diagnostic.range.end.character + 1,
    };
}

function markerSeverity(severity: QsLangDiagnosticSeverity): monacoNs.MarkerSeverity {
    switch (severity) {
        case "error":
            return monacoApi.MarkerSeverity.Error;
        case "warning":
            return monacoApi.MarkerSeverity.Warning;
        case "information":
            return monacoApi.MarkerSeverity.Info;
        case "hint":
            return monacoApi.MarkerSeverity.Hint;
    }
}

function documentSymbolKind(kind: QsLangDocumentSymbol["kind"]): monacoNs.languages.SymbolKind {
    switch (kind) {
        case "batch":
            return monacoApi.languages.SymbolKind.Namespace;
        case "statement":
            return monacoApi.languages.SymbolKind.Event;
        case "object":
            return monacoApi.languages.SymbolKind.Class;
        default:
            return monacoApi.languages.SymbolKind.Key;
    }
}

function langSymbolToMonaco(symbol: QsLangDocumentSymbol): monacoNs.languages.DocumentSymbol {
    const range = langRangeToMonaco(symbol.range);
    return {
        name: symbol.name,
        detail: "",
        kind: documentSymbolKind(symbol.kind),
        tags: [],
        range,
        selectionRange: range,
        ...(symbol.children && symbol.children.length > 0
            ? { children: symbol.children.map(langSymbolToMonaco) }
            : {}),
    };
}
