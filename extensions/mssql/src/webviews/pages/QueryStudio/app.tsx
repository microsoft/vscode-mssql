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

import * as React from "react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type * as monacoNs from "monaco-editor";
import { VscodeEditor } from "../../common/vscodeMonaco";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { perfMark, perfMarkAfterNextPaint } from "../../common/perfMarks";
import { ExecutionPlanState } from "../../../sharedInterfaces/executionPlan";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import {
    QsCancelRequest,
    QsConnectRequest,
    QsDisconnectRequest,
    QsExecuteRequest,
    QsGetDiagnosticsSummaryRequest,
    QsGetMessagesRequest,
    QsGetPlanStateRequest,
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
    QsPinAllResultsRequest,
    QsPinResultSetRequest,
    QsSetViewModeRequest,
    QsState,
    QsStateChangedNotification,
    QsRestoreEditorFocusNotification,
    QsRunStartedNotification,
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
import { diffTextEdit, textHash, SYNC_COALESCE_MS } from "../../../queryStudio/textSync";
// BOOT-2 staged loading: the grid stack (slickgrid) and the plan surface
// (azdataGraph) are DYNAMIC chunks — the entry carries Monaco + shell only.
// Their CSS is hoisted here statically so lazy chunks never strand styles.
// ORDER IS THE CASCADE (dogfood 2026-07-10 grid-row-size regression): the
// slickgrid THEME must load BEFORE our FluentResultGrid overrides — when
// the theme entered via dynamic-import dedup it landed LAST and stomped
// the row metrics (clipped rows). Keep lib css first, ours after.
import "@slickgrid-universal/common/dist/styles/css/slickgrid-theme-fluent.css";
import "../../common/FluentResultGrid/FluentResultGrid.css";
import "../../common/FluentResultGrid/FluentResultGrid.vscode.css";
import "../../media/table.css";
import {
    gridStackLoaded,
    LazyExecutionPlanView,
    LazyMessagesView,
    LazyQsResultsGridProvider,
    LazyResultGridBlock,
    prefetchGridStack,
    ResultsSurfaceLoading,
    whenGridStackLoaded,
} from "./lazyResults";
import { qsGridRowHeight } from "./resultsGridShared";
import { QueryStudioResultsTextView } from "./resultsTextView";
import { monacoApi } from "./monacoSetup";
import {
    QS_ACCEPT_INLINE_SUGGESTION_ACTION,
    QS_ACCEPT_SELECTED_SUGGESTION_ACTION,
    QS_INSERT_TAB_ACTION,
    QS_OUTDENT_ACTION,
    QS_REDO_ACTION,
    QS_SHIFT_TAB_OUTDENT_CONTEXT,
    QS_TAB_ACCEPT_INLINE_CONTEXT,
    QS_TAB_ACCEPT_SUGGESTION_CONTEXT,
    QS_TAB_INSERT_CONTEXT,
    QS_UNDO_ACTION,
} from "./keybindings";
import { executeParamsForSelection } from "./executionRequests";

type Editor = monacoNs.editor.IStandaloneCodeEditor;
type QueryStudioEol = "\n" | "\r\n";
type QueryStudioTab = "results" | "messages" | "queryPlan";

interface QueryPlanTabState {
    readonly key: string;
    readonly executionPlanState: ExecutionPlanState;
}

let editGroupCounter = 0;

interface EditorFocusBookmark {
    readonly selection: monacoNs.Selection | null;
    readonly position: monacoNs.Position | null;
}

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
const QS_COMPLETION_STALE_GUARD_DELAY_MS = 15;

function eolPreference(eol: QueryStudioEol): monacoNs.editor.EndOfLinePreference {
    return eol === "\r\n"
        ? monacoApi.editor.EndOfLinePreference.CRLF
        : monacoApi.editor.EndOfLinePreference.LF;
}

function eolSequence(eol: QueryStudioEol): monacoNs.editor.EndOfLineSequence {
    return eol === "\r\n"
        ? monacoApi.editor.EndOfLineSequence.CRLF
        : monacoApi.editor.EndOfLineSequence.LF;
}

function editorValue(editor: Editor, eol: QueryStudioEol): string {
    return editor.getModel()?.getValue(eolPreference(eol)) ?? editor.getValue();
}

function applyEditorEol(editor: Editor, eol: QueryStudioEol): void {
    editor.getModel()?.pushEOL(eolSequence(eol));
}

export function QueryStudioApp() {
    const {
        extensionRpc: rpc,
        getSnapshot,
        subscribe,
        themeKind,
    } = useVscodeWebview<QsState, void>();
    const snapshot = useSyncExternalStore(subscribe, getSnapshot);
    const providerState = isQueryStudioState(snapshot) ? snapshot : undefined;
    const [pushedState, setPushedState] = useState<QsState | undefined>(undefined);
    const state = providerState ?? pushedState;
    const [cursor, setCursor] = useState({ line: 1, column: 1 });
    const [messages, setMessages] = useState<QsMessageRow[]>([]);
    // Live per-set row counts accumulated from QsRowsAppended (counts only —
    // rows never ride notifications). The coarse state's summary rowCount is
    // debounced (≤10/s); the max of the two keeps grids growing smoothly.
    const [liveRowCounts, setLiveRowCounts] = useState<Record<string, number>>({});
    const [activeTab, setActiveTab] = useState<QueryStudioTab>("results");
    const [queryPlanTabState, setQueryPlanTabState] = useState<QueryPlanTabState | undefined>(
        undefined,
    );
    const [resultsCollapsed, setResultsCollapsed] = useState(false);
    const [resultsPaneMaximized, setResultsPaneMaximized] = useState(false);
    // Editor/results split (SSMS ≈ 50/50). The configured default
    // (mssql.queryStudio.resultsPaneHeightPercent) arrives with the first
    // state push; a manual splitter drag wins for the rest of the session.
    const [resultsHeightPct, setResultsHeightPct] = useState(50);
    const splitAdjustedRef = useRef(false);
    const configuredSplitRef = useRef(50);
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
    const syncedTextRef = useRef("");
    const preferredEolRef = useRef<QueryStudioEol>("\n");
    const syncInFlightRef = useRef(false);
    const flushAgainRef = useRef(false);
    const awaitingResyncRef = useRef(false);
    const flushEditsRef = useRef<() => void>(() => undefined);
    const applyRemoteTextRef = useRef<
        (text: string, hostVersion: number, eol?: QueryStudioEol) => void
    >(() => undefined);
    const suppressLocalRef = useRef(false);
    const flushTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const expectedEchoGroupsRef = useRef<Set<string>>(new Set());
    const expectedEchoTextsRef = useRef<Map<string, string>>(new Map());
    const renderedRunRef = useRef<number | undefined>(undefined);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const dbWrapRef = useRef<HTMLSpanElement | null>(null);
    const dbListRequestRef = useRef(0);
    const pendingEditorFocusRestoreRef = useRef<EditorFocusBookmark | undefined>(undefined);
    // Plan-tab focus: runs are always webview-initiated, so plan mode is
    // tracked locally at the point the run is triggered. `planRunArmedRef`
    // is set by the Estimated Plan button (or Execute while the Actual Plan
    // toggle is on) and consumed once when the run starts; terminal states
    // then focus the embedded Query Plan tab exactly once.
    const actualPlanEnabledRef = useRef(false);
    const planRunArmedRef = useRef(false);
    const startedRunRef = useRef<number | undefined>(undefined);
    const planTabFocusRef = useRef<{ runId?: number; focused: boolean }>({ focused: false });

    const captureEditorFocusBookmark = useCallback(() => {
        const editor = editorRef.current;
        if (!editor) {
            return;
        }
        pendingEditorFocusRestoreRef.current = {
            selection: editor.getSelection(),
            position: editor.getPosition(),
        };
    }, []);

    const restoreEditorFocus = useCallback(() => {
        const editor = editorRef.current;
        if (!editor) {
            return;
        }
        const bookmark = pendingEditorFocusRestoreRef.current;
        pendingEditorFocusRestoreRef.current = undefined;
        if (bookmark?.selection) {
            editor.setSelection(bookmark.selection);
        }
        const position = bookmark?.position ?? editor.getPosition();
        if (position) {
            editor.revealPositionInCenterIfOutsideViewport(position);
        }
        editor.focus();
    }, []);
    const restoreEditorFocusSoon = useCallback(() => {
        window.setTimeout(restoreEditorFocus, 0);
    }, [restoreEditorFocus]);

    const resetRunViewForStart = useCallback(
        (runId: number, fetchMessageSnapshot: boolean) => {
            startedRunRef.current = runId;
            setActionHint(undefined);
            setLiveRowCounts({});
            setActiveTab("results");
            setResultsCollapsed(false);
            setMaximizedGridId(undefined);
            setMessages([]);
            setQueryPlanTabState(undefined);
            if (fetchMessageSnapshot) {
                void rpc
                    .sendRequest(QsGetMessagesRequest.type, {})
                    .then((result) => setMessages(result.messages));
            }
            planTabFocusRef.current = {
                ...(planRunArmedRef.current ? { runId } : {}),
                focused: false,
            };
            planRunArmedRef.current = false;
        },
        [rpc],
    );

    // --- sync: webview → host --------------------------------------------
    const flushEdits = useCallback(() => {
        if (flushTimerRef.current) {
            clearTimeout(flushTimerRef.current);
            flushTimerRef.current = undefined;
        }
        const editor = editorRef.current;
        if (!editor) {
            return;
        }
        if (awaitingResyncRef.current) {
            flushAgainRef.current = true;
            return;
        }
        if (syncInFlightRef.current) {
            flushAgainRef.current = true;
            return;
        }
        const currentText = editorValue(editor, preferredEolRef.current);
        if (currentText === syncedTextRef.current) {
            return;
        }
        const edits = diffTextEdit(syncedTextRef.current, currentText);
        if (edits.length === 0) {
            return;
        }
        const groupId = `wg_${(++editGroupCounter).toString(36)}`;
        expectedEchoGroupsRef.current.add(groupId);
        expectedEchoTextsRef.current.set(groupId, currentText);
        const payload: QsSyncEdits = {
            baseHostVersion: hostVersionRef.current,
            editGroupId: groupId,
            edits,
            textHashAfter: textHash(currentText),
        };
        syncInFlightRef.current = true;
        void rpc
            .sendRequest(QsSyncEditsRequest.type, payload)
            .then((outcome) => {
                if (outcome.applied) {
                    hostVersionRef.current = outcome.hostVersion;
                    syncedTextRef.current = currentText;
                    return;
                }
                // Divergence rejections reconcile via the resync notification;
                // stale-base rejections carry NO reconciliation (the host assumes
                // an interleaved remote reached us — false when the init itself
                // was missed) and would deadlock every subsequent group. Heal by
                // converging the host to the visible editor content, which is
                // the user-facing truth.
                expectedEchoGroupsRef.current.delete(groupId);
                expectedEchoTextsRef.current.delete(groupId);
                hostVersionRef.current = outcome.hostVersion;
                if (outcome.resyncPending) {
                    awaitingResyncRef.current = true;
                    return undefined;
                }
                const liveEditor = editorRef.current;
                if (!liveEditor) {
                    return undefined;
                }
                const adoptText = editorValue(liveEditor, preferredEolRef.current);
                if (adoptText === syncedTextRef.current) {
                    return undefined;
                }
                const adoptGroupId = `wg_${(++editGroupCounter).toString(36)}`;
                expectedEchoGroupsRef.current.add(adoptGroupId);
                expectedEchoTextsRef.current.set(adoptGroupId, adoptText);
                return rpc
                    .sendRequest(QsSyncAdoptRequest.type, {
                        text: adoptText,
                        editGroupId: adoptGroupId,
                    })
                    .then((adopted) => {
                        hostVersionRef.current = adopted.hostVersion;
                        if (adopted.applied) {
                            syncedTextRef.current = adoptText;
                            return;
                        }
                        expectedEchoGroupsRef.current.delete(adoptGroupId);
                        expectedEchoTextsRef.current.delete(adoptGroupId);
                        awaitingResyncRef.current = true;
                        return rpc
                            .sendRequest(QsSyncResyncRequest.type, {
                                webviewVersion: adopted.hostVersion,
                                textHash: textHash(
                                    editorValue(liveEditor, preferredEolRef.current),
                                ),
                            })
                            .then((resync) =>
                                applyRemoteTextRef.current(
                                    resync.text,
                                    resync.hostVersion,
                                    resync.eol,
                                ),
                            );
                    });
            })
            .catch(() => {
                expectedEchoGroupsRef.current.delete(groupId);
                expectedEchoTextsRef.current.delete(groupId);
            })
            .finally(() => {
                syncInFlightRef.current = false;
                if (awaitingResyncRef.current) {
                    return;
                }
                if (
                    flushAgainRef.current ||
                    (editorRef.current !== null &&
                        editorValue(editorRef.current, preferredEolRef.current) !==
                            syncedTextRef.current)
                ) {
                    flushAgainRef.current = false;
                    flushTimerRef.current = setTimeout(() => flushEditsRef.current(), 0);
                }
            });
    }, [rpc]);
    flushEditsRef.current = flushEdits;

    const queueLocalEdits = useCallback(
        (edits: QsTextEdit[]) => {
            if (edits.length > 0 && !flushTimerRef.current) {
                flushTimerRef.current = setTimeout(flushEdits, SYNC_COALESCE_MS);
            }
        },
        [flushEdits],
    );

    // --- sync: host → webview ----------------------------------------------
    const applyRemoteText = useCallback(
        (text: string, hostVersion: number, eol?: QueryStudioEol) => {
            if (hostVersion < hostVersionRef.current) {
                awaitingResyncRef.current = false;
                return;
            }
            if (eol !== undefined) {
                preferredEolRef.current = eol;
            }
            const editor = editorRef.current;
            awaitingResyncRef.current = false;
            expectedEchoGroupsRef.current.clear();
            expectedEchoTextsRef.current.clear();
            hostVersionRef.current = hostVersion;
            syncedTextRef.current = text;
            flushAgainRef.current = false;
            if (!editor) {
                return;
            }
            applyEditorEol(editor, preferredEolRef.current);
            if (editorValue(editor, preferredEolRef.current) === text) {
                return;
            }
            suppressLocalRef.current = true;
            try {
                const model = editor.getModel();
                model?.pushEditOperations(
                    [],
                    [{ range: model.getFullModelRange(), text }],
                    () => null,
                );
                applyEditorEol(editor, preferredEolRef.current);
            } finally {
                suppressLocalRef.current = false;
            }
        },
        [],
    );
    applyRemoteTextRef.current = applyRemoteText;

    useEffect(() => {
        // onNotification registrations live for the webview lifetime.
        [
            rpc.onNotification(QsSyncInitNotification.type, (init: QsSyncInit) => {
                applyRemoteText(init.text, init.hostVersion, init.eol);
            }),
            rpc.onNotification(QsSyncRemoteNotification.type, (remote: QsSyncRemote) => {
                if (
                    remote.reason === "echo" &&
                    remote.echoOfEditGroupId &&
                    expectedEchoGroupsRef.current.delete(remote.echoOfEditGroupId)
                ) {
                    const echoText = expectedEchoTextsRef.current.get(remote.echoOfEditGroupId);
                    expectedEchoTextsRef.current.delete(remote.echoOfEditGroupId);
                    if (remote.toHostVersion >= hostVersionRef.current) {
                        hostVersionRef.current = remote.toHostVersion;
                    }
                    if (echoText !== undefined && remote.toHostVersion >= hostVersionRef.current) {
                        syncedTextRef.current = echoText;
                    }
                    return; // our own edit reflected — do not reapply
                }
                if (remote.toHostVersion <= hostVersionRef.current) {
                    return;
                }
                const editor = editorRef.current;
                if (!editor) {
                    return;
                }
                if (remote.fromHostVersion !== hostVersionRef.current) {
                    awaitingResyncRef.current = true;
                    void rpc
                        .sendRequest(QsSyncResyncRequest.type, {
                            webviewVersion: hostVersionRef.current,
                            textHash: textHash(editorValue(editor, preferredEolRef.current)),
                        })
                        .then((resync) =>
                            applyRemoteText(resync.text, resync.hostVersion, resync.eol),
                        );
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
                const currentText = editorValue(editor, preferredEolRef.current);
                if (currentText && textHash(currentText) !== remote.textHash) {
                    awaitingResyncRef.current = true;
                    void rpc
                        .sendRequest(QsSyncResyncRequest.type, {
                            webviewVersion: remote.toHostVersion,
                            textHash: textHash(currentText),
                        })
                        .then((resync) =>
                            applyRemoteText(resync.text, resync.hostVersion, resync.eol),
                        );
                }
            }),
            rpc.onNotification(QsSyncResyncNotification.type, (resync: QsSyncResync) => {
                applyRemoteText(resync.text, resync.hostVersion, resync.eol);
            }),
            rpc.onNotification(QsStateChangedNotification.type, (next: QsState) => {
                setPushedState(next);
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
            rpc.onNotification(QsRunStartedNotification.type, (p: { startedEpochMs: number }) => {
                resetRunViewForStart(p.startedEpochMs, false);
            }),
            rpc.onNotification(
                QsMessagesAppendedNotification.type,
                (p: { startIndex: number; messages: QsMessageRow[] }) => {
                    // Position-addressed (QO-7): coalesced batches can
                    // interleave with the catch-up fetch — dedupe by the
                    // host's absolute index, never double-append.
                    setMessages((current) => {
                        if (p.startIndex === current.length) {
                            return [...current, ...p.messages];
                        }
                        if (p.startIndex > current.length) {
                            // Gap: the messageCount catch-up effect fills it.
                            return current;
                        }
                        const fresh = p.messages.slice(current.length - p.startIndex);
                        return fresh.length > 0 ? [...current, ...fresh] : current;
                    });
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
            rpc.onNotification(QsRestoreEditorFocusNotification.type, restoreEditorFocus),
        ];
        // Signal readiness → host ends the open marker.
        void rpc.sendRequest(QsGetDiagnosticsSummaryRequest.type, undefined);
    }, [rpc, applyRemoteText, flushEdits, resetRunViewForStart, restoreEditorFocus]);

    useEffect(() => {
        const onFocus = () => {
            if (pendingEditorFocusRestoreRef.current) {
                window.setTimeout(restoreEditorFocus, 0);
            }
        };
        window.addEventListener("focus", onFocus);
        return () => window.removeEventListener("focus", onFocus);
    }, [restoreEditorFocus]);

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
            // Message notifications can beat this (debounced) state push —
            // clearing alone would drop the run's opening lines. Replace
            // with the host's snapshot instead: notifications processed
            // after the response are strictly newer than the snapshot
            // (ordered channel), so nothing is lost or duplicated.
            resetRunViewForStart(runId, true);
        }
        if (TERMINAL_KINDS.has(executionKind) && runId && renderedRunRef.current !== runId) {
            renderedRunRef.current = runId;
            // BOOT-2 honesty: with the lazy grid, "rendered" means the REAL
            // grid painted — never the Suspense placeholder (the first live
            // run proved the mark drifted 120ms early without this gate).
            const attrs = {
                status: executionKind,
                rows: state?.results.totalRows ?? 0,
                resultSets: state?.results.resultSets.length ?? 0,
            };
            if ((state?.results.resultSets.length ?? 0) > 0 && !gridStackLoaded()) {
                void whenGridStackLoaded().then(() =>
                    perfMarkAfterNextPaint("mssql.queryStudio.resultsRendered", attrs),
                );
            } else {
                perfMarkAfterNextPaint("mssql.queryStudio.resultsRendered", attrs);
            }
            // Error terminal states: land the user on Messages even when the
            // run also produced result sets, so the failure text is visible.
            const terminalHasErrors =
                executionKind === "completedWithErrors" || executionKind === "failed";
            const hasMessagesOrErrors =
                (state?.results.messageCount ?? 0) > 0 || (state?.results.errorCount ?? 0) > 0;
            if (
                hasMessagesOrErrors &&
                (terminalHasErrors || (state?.results.resultSets.length ?? 0) === 0)
            ) {
                setActiveTab("messages");
            }
        }
        // Plan-mode runs land on the embedded Query Plan tab once the
        // plan-flagged result sets exist. The tabbar exposes Open in New Tab
        // for the previous external viewer behavior.
        if (
            executionKind === "succeeded" &&
            runId !== undefined &&
            planTabFocusRef.current.runId === runId &&
            !planTabFocusRef.current.focused &&
            (state?.results.planCount ?? 0) > 0
        ) {
            planTabFocusRef.current.focused = true;
            setActiveTab("queryPlan");
        }
    }, [executionKind, runId, state, rpc, resetRunViewForStart]);
    const messageCount = state?.results.messageCount ?? 0;
    useEffect(() => {
        if (messageCount <= messages.length) {
            return;
        }
        const afterIndex = messages.length;
        let canceled = false;
        void rpc.sendRequest(QsGetMessagesRequest.type, { afterIndex }).then((result) => {
            if (canceled || result.messages.length === 0) {
                return;
            }
            setMessages((current) => {
                const alreadyAppended = Math.max(0, current.length - afterIndex);
                const missing = result.messages.slice(alreadyAppended);
                return missing.length > 0 ? [...current, ...missing] : current;
            });
        });
        return () => {
            canceled = true;
        };
    }, [messageCount, messages.length, rpc]);

    // --- editor wiring -------------------------------------------------------
    const onEditorMount = useCallback(
        (editor: Editor) => {
            editorRef.current = editor;
            // BOOT-1: the editor exists (Monaco booted); editorInteractive is
            // the first PAINT after that — the above-the-fold moment. P1
            // prefetch (grid chunk) kicks on the first idle slice after it.
            perfMark("mssql.queryStudio.boot.monacoReady", {});
            perfMarkAfterNextPaint("mssql.queryStudio.boot.editorInteractive", {});
            prefetchGridStack();
            // Trim built-in context-menu entries that don't fit Query Studio:
            // "Go to Symbol" opens Monaco's quick-outline overlay, which
            // duplicates nothing useful here. Monaco has no public API for
            // removing built-in menu items, so filter the contextmenu
            // contribution's action list (the widely-used seam for this).
            const contextMenu = editor.getContribution("editor.contrib.contextmenu") as unknown as {
                _getMenuActions?: (...args: unknown[]) => { id?: string }[];
            } | null;
            const originalGetMenuActions = contextMenu?._getMenuActions;
            if (contextMenu && typeof originalGetMenuActions === "function") {
                contextMenu._getMenuActions = function (...args: unknown[]) {
                    return originalGetMenuActions
                        .apply(contextMenu, args)
                        .filter((action) => action?.id !== "editor.action.quickOutline");
                };
            }
            // Pull the sync baseline instead of trusting the pushed init
            // alone — the push races webview startup, and a missed init used
            // to deadlock every edit group as stale-base. Gentle: never
            // clobber text the user already typed (the adopt path converges
            // that case).
            void rpc
                .sendRequest(QsSyncResyncRequest.type, { webviewVersion: 0, textHash: "" })
                .then((resync) => {
                    if (resync.eol !== undefined) {
                        preferredEolRef.current = resync.eol;
                        applyEditorEol(editor, resync.eol);
                    }
                    if (editor.getValue().length === 0) {
                        applyRemoteText(resync.text, resync.hostVersion, resync.eol);
                    } else {
                        hostVersionRef.current = resync.hostVersion;
                        syncedTextRef.current = resync.text;
                        flushEditsRef.current();
                    }
                    restoreEditorFocusSoon();
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
            // Monaco owns interactive undo/redo; the normal text-sync path
            // then pushes the resulting model change back to the host.
            editor.addCommand(monacoKeyMod().CtrlCmd | monacoKeyCode().KeyZ, () => {
                editor.trigger("keyboard", QS_UNDO_ACTION, undefined);
            });
            editor.addCommand(monacoKeyMod().CtrlCmd | monacoKeyCode().KeyY, () => {
                editor.trigger("keyboard", QS_REDO_ACTION, undefined);
            });
            editor.addCommand(
                monacoKeyMod().CtrlCmd | monacoKeyMod().Shift | monacoKeyCode().KeyZ,
                () => {
                    editor.trigger("keyboard", QS_REDO_ACTION, undefined);
                },
            );
            // F1: VS Code's palette, not Monaco's quick-command (commands
            // route to this editor through VS Code).
            editor.addCommand(monacoKeyCode().F1, () => {
                captureEditorFocusBookmark();
                void rpc.sendRequest(QsShowCommandPaletteRequest.type, undefined);
            });
            editor.addCommand(monacoKeyMod().CtrlCmd | monacoKeyCode().KeyS, () => {
                flushEdits();
                void rpc.sendRequest(QsSyncSaveRequest.type, undefined);
            });
            editor.addCommand(
                monacoKeyCode().Tab,
                () => editor.trigger("keyboard", QS_ACCEPT_SELECTED_SUGGESTION_ACTION, undefined),
                QS_TAB_ACCEPT_SUGGESTION_CONTEXT,
            );
            editor.addCommand(
                monacoKeyCode().Tab,
                () => editor.trigger("keyboard", QS_ACCEPT_INLINE_SUGGESTION_ACTION, undefined),
                QS_TAB_ACCEPT_INLINE_CONTEXT,
            );
            editor.addCommand(
                monacoKeyCode().Tab,
                () => editor.trigger("keyboard", QS_INSERT_TAB_ACTION, undefined),
                QS_TAB_INSERT_CONTEXT,
            );
            editor.addCommand(
                monacoKeyMod().Shift | monacoKeyCode().Tab,
                () => editor.trigger("keyboard", QS_OUTDENT_ACTION, undefined),
                QS_SHIFT_TAB_OUTDENT_CONTEXT,
            );
            restoreEditorFocusSoon();
        },
        [
            queueLocalEdits,
            flushEdits,
            rpc,
            applyRemoteText,
            captureEditorFocusBookmark,
            restoreEditorFocusSoon,
        ],
    );

    // --- commands -------------------------------------------------------------
    // Every run request surfaces a refused outcome in the status bar — a
    // guard reason (not connected / already executing / nothing to execute)
    // must never look like a dead button.
    const runOutcome = useCallback((outcome: { started: boolean; reason?: string }) => {
        setActionHint(outcome.started ? undefined : (outcome.reason ?? "Could not start the run."));
    }, []);
    const selectedExecuteParams = useCallback(
        () => executeParamsForSelection(editorRef.current?.getSelection()),
        [],
    );
    const execute = useCallback(() => {
        flushEdits();
        setActionHint(undefined);
        // QS-1: an execute while the Actual Plan toggle is on is a plan-mode
        // run — its plan result sets auto-open on completion.
        planRunArmedRef.current = actualPlanEnabledRef.current;
        void rpc.sendRequest(QsExecuteRequest.type, selectedExecuteParams()).then(runOutcome);
    }, [rpc, flushEdits, runOutcome, selectedExecuteParams]);
    const cancel = useCallback(() => {
        void rpc.sendRequest(QsCancelRequest.type, undefined);
    }, [rpc]);
    const connect = useCallback(() => {
        void rpc.sendRequest(QsConnectRequest.type, {});
    }, [rpc]);
    // Connection dropdown (chevron next to Change): compact home for the
    // less-common connection commands, mirroring the database selector.
    const [connMenuOpen, setConnMenuOpen] = useState(false);
    const connWrapRef = useRef<HTMLSpanElement | null>(null);
    const disconnect = useCallback(() => {
        setConnMenuOpen(false);
        void rpc.sendRequest(QsDisconnectRequest.type, undefined);
    }, [rpc]);
    useEffect(() => {
        if (!connMenuOpen) {
            return;
        }
        const closeIfOutside = (event: MouseEvent | FocusEvent) => {
            const target = event.target;
            if (target instanceof Node && connWrapRef.current?.contains(target)) {
                return;
            }
            setConnMenuOpen(false);
        };
        window.addEventListener("pointerdown", closeIfOutside, true);
        window.addEventListener("focusin", closeIfOutside, true);
        return () => {
            window.removeEventListener("pointerdown", closeIfOutside, true);
            window.removeEventListener("focusin", closeIfOutside, true);
        };
    }, [connMenuOpen]);
    const [dbList, setDbList] = useState<string[] | undefined>(undefined);
    const toggleDbList = useCallback(() => {
        if (dbList !== undefined) {
            dbListRequestRef.current++;
            setDbList(undefined);
            return;
        }
        captureEditorFocusBookmark();
        const requestId = ++dbListRequestRef.current;
        setDbList([]);
        void rpc.sendRequest(QsListDatabasesRequest.type, undefined).then((r) => {
            if (dbListRequestRef.current !== requestId) {
                return;
            }
            setDbList(r.databases);
        });
    }, [captureEditorFocusBookmark, dbList, rpc]);
    const pickDatabase = useCallback(
        (database: string) => {
            dbListRequestRef.current++;
            setDbList(undefined);
            restoreEditorFocusSoon();
            void rpc
                .sendRequest(QsSetDatabaseRequest.type, { database })
                .then(restoreEditorFocusSoon, restoreEditorFocusSoon);
        },
        [restoreEditorFocusSoon, rpc],
    );
    useEffect(() => {
        if (dbList === undefined) {
            return;
        }
        const closeIfOutside = (event: MouseEvent | FocusEvent) => {
            const target = event.target;
            if (target instanceof Node && dbWrapRef.current?.contains(target)) {
                return;
            }
            dbListRequestRef.current++;
            setDbList(undefined);
        };
        window.addEventListener("pointerdown", closeIfOutside, true);
        window.addEventListener("focusin", closeIfOutside, true);
        return () => {
            window.removeEventListener("pointerdown", closeIfOutside, true);
            window.removeEventListener("focusin", closeIfOutside, true);
        };
    }, [dbList]);
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
                ...selectedExecuteParams(),
                estimatedPlanOnly: true,
            })
            .then(runOutcome);
    }, [rpc, flushEdits, runOutcome, selectedExecuteParams]);
    const toggleActualPlan = useCallback(() => {
        void rpc.sendRequest(QsSetActualPlanRequest.type, {
            enabled: !(state?.toggles.actualPlan ?? false),
        });
    }, [rpc, state]);
    const toggleResultsViewMode = useCallback(() => {
        const current = state?.toggles.viewMode ?? "grid";
        void rpc.sendRequest(QsSetViewModeRequest.type, {
            viewMode: current === "text" ? "grid" : "text",
        });
    }, [rpc, state?.toggles.viewMode]);

    // Pin results (C2D-2): one set or all complete sets into a read-only
    // snapshot tab. Refusals (streaming set, disabled, budget) surface via
    // the status line like refused runs do.
    const pinResults = useCallback(
        (resultSetId: string | undefined) => {
            const request = resultSetId
                ? rpc.sendRequest(QsPinResultSetRequest.type, { resultSetId })
                : rpc.sendRequest(QsPinAllResultsRequest.type, {});
            void request.then((result) => {
                const r = result as { opened: boolean; error?: string };
                if (!r.opened && r.error) {
                    setActionHint(r.error);
                }
            });
        },
        [rpc],
    );

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
            } else if (ctrlOnly && e.key.toLowerCase() === "a") {
                handled = !shouldAllowBrowserSelectAll(e.target);
            } else if (altOnly && e.key.toLowerCase() === "b") {
                cancel();
                handled = true;
            } else if (noMods && e.key === "Escape" && dbList !== undefined) {
                dbListRequestRef.current++;
                setDbList(undefined);
                handled = true;
            }
            if (handled) {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [execute, cancel, dbList]);

    useEffect(() => {
        const stopEditorClipboardChord = (e: KeyboardEvent) => {
            if (e.defaultPrevented || !isEditorClipboardChord(e) || !isFromMonacoEditor(e.target)) {
                return;
            }
            // Let Monaco and the browser clipboard event run first, then keep the
            // chord from bubbling into VS Code's webview keybinding bridge.
            e.stopPropagation();
        };
        document.addEventListener("keydown", stopEditorClipboardChord, false);
        return () => document.removeEventListener("keydown", stopEditorClipboardChord, false);
    }, []);

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
            provideInlineCompletions: async (model, position, context) => {
                const requestVersion = model.getVersionId();
                const requestHash = textHash(model.getValue());
                const trigger =
                    context.triggerKind === monacoApi.languages.InlineCompletionTriggerKind.Explicit
                        ? "invoke"
                        : "automatic";
                if (trigger === "automatic") {
                    await delay(QS_COMPLETION_STALE_GUARD_DELAY_MS);
                    if (!isModelStateCurrent(model, requestVersion, requestHash)) {
                        return { items: [] };
                    }
                }
                // Same staleness rule as lang completions: the host bridge
                // resolves positions against its mirror — push edits first.
                flushEdits();
                if (trigger === "automatic" && syncInFlightRef.current) {
                    return { items: [] };
                }
                const response = await rpc.sendRequest(QsInlineCompletionRequest.type, {
                    line: position.lineNumber - 1,
                    character: position.column - 1,
                    textHash: requestHash,
                    trigger,
                });
                if (!isModelStateCurrent(model, requestVersion, requestHash)) {
                    return { items: [] };
                }
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
    }, [completionsEnabled, flushEdits, rpc]);

    // --- language features (LS-0): Monaco providers over the qs/lang.* bridge --
    useEffect(() => {
        const providerDisposables = [
            monacoApi.languages.registerCompletionItemProvider("sql", {
                triggerCharacters: [".", " ", "@", "("],
                provideCompletionItems: async (model, position, context) => {
                    try {
                        const requestVersion = model.getVersionId();
                        const requestText = model.getValue();
                        const requestHash = textHash(requestText);
                        const triggerCharacter = context.triggerCharacter;
                        const shouldDelay =
                            context.triggerKind ===
                                monacoApi.languages.CompletionTriggerKind.TriggerCharacter &&
                            triggerCharacter !== ".";
                        if (shouldDelay) {
                            await delay(QS_COMPLETION_STALE_GUARD_DELAY_MS);
                            if (!isModelStateCurrent(model, requestVersion, requestHash)) {
                                return { suggestions: [] };
                            }
                        }
                        // Push pending keystrokes NOW and tell the host the
                        // exact text this request was computed against —
                        // otherwise completions bind one keystroke behind.
                        flushEdits();
                        const result = await rpc.sendRequest(QsLangCompletionRequest.type, {
                            line: position.lineNumber - 1,
                            character: position.column - 1,
                            text: requestText,
                            textHash: requestHash,
                            trigger:
                                context.triggerKind ===
                                monacoApi.languages.CompletionTriggerKind.TriggerCharacter
                                    ? "character"
                                    : "invoke",
                            ...(triggerCharacter ? { triggerCharacter } : {}),
                        });
                        if (!isModelStateCurrent(model, requestVersion, requestHash)) {
                            return { suggestions: [] };
                        }
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
    // Configured default split; applied until the user drags the splitter.
    const configuredSplit = state?.gridStyle?.resultsPaneHeightPct;
    useEffect(() => {
        if (configuredSplit !== undefined) {
            configuredSplitRef.current = configuredSplit;
            if (!splitAdjustedRef.current) {
                setResultsHeightPct(configuredSplit);
            }
        }
    }, [configuredSplit]);
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
            splitAdjustedRef.current = true;
            setResultsHeightPct(pct);
        };
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    }, []);
    const resetSplit = useCallback(() => {
        splitAdjustedRef.current = false;
        setResultsHeightPct(configuredSplitRef.current);
    }, []);

    const connection = state?.connection ?? { kind: "disconnected" as const };
    const connected = connection.kind === "connected" || connection.kind === "executing";
    const executing = executionKind === "executing" || executionKind === "cancelRequested";
    const results = state?.results;
    const showResults = (results?.present ?? false) && !resultsCollapsed;
    const errorCount = results?.errorCount ?? 0;
    const resultViewMode = state?.toggles.viewMode ?? "grid";

    // Results-pane sizing v2 (issue A): one grid (or a maximized one) FILLS
    // the pane — the grid's virtualized scrollbar is THE scrollbar. Multiple
    // grids split the measured pane: exact content heights when everything
    // fits, otherwise fair shares with a 12-row minimum and pane scrolling
    // only once even the minimums overflow (queryStudioResultsLayout).
    const allResultSetSummaries = results?.resultSets ?? [];
    const effectiveRowCount = (summary: (typeof allResultSetSummaries)[number]) =>
        Math.max(summary.rowCount, liveRowCounts[summary.resultSetId] ?? 0);
    const resultSetSummaries = allResultSetSummaries.filter(
        (summary) => summary.isPlanResult !== true,
    );
    const planResultSetSummaries = allResultSetSummaries.filter(
        (summary) => summary.isPlanResult === true,
    );
    const gridResultSetSummaries = resultSetSummaries;
    const hasDataResults = resultSetSummaries.length > 0;
    const hasPlanResults = planResultSetSummaries.length > 0;
    const visibleActiveTab: QueryStudioTab =
        activeTab === "results" && !hasDataResults
            ? "messages"
            : activeTab === "queryPlan" && !hasPlanResults
              ? hasDataResults
                  ? "results"
                  : "messages"
              : activeTab;
    const dataTotalRows = resultSetSummaries.reduce(
        (total, summary) => total + effectiveRowCount(summary),
        0,
    );
    const planResultSetIdsKey = planResultSetSummaries
        .map((summary) => summary.resultSetId)
        .join("|");
    const planResultSetKey = `${runId ?? "idle"}:${planResultSetIdsKey}`;
    const planRowsAvailable =
        planResultSetSummaries.length > 0 &&
        planResultSetSummaries.every(
            (summary) => effectiveRowCount(summary) > 0 || summary.complete,
        );
    const maximizedGrid = gridResultSetSummaries.some((s) => s.resultSetId === maximizedGridId)
        ? maximizedGridId
        : undefined;
    const singleGrid = gridResultSetSummaries.length === 1;
    const resultsFillActive =
        (visibleActiveTab === "results" &&
            gridResultSetSummaries.length > 0 &&
            (singleGrid || maximizedGrid !== undefined)) ||
        visibleActiveTab === "queryPlan";
    const resultsLayout = computeResultsLayout(
        gridResultSetSummaries.map(effectiveRowCount),
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
    useEffect(() => {
        if (planResultSetSummaries.length === 0) {
            setQueryPlanTabState(undefined);
            return;
        }
        const key = planResultSetKey;
        const loadingState: QueryPlanTabState = {
            key,
            executionPlanState: {
                loadState: ApiStatus.Loading,
                executionPlanGraphs: [],
                totalCost: 0,
            },
        };
        if (!planRowsAvailable) {
            setQueryPlanTabState((current) => (current?.key === key ? current : loadingState));
            return;
        }
        const resultSetIds = planResultSetIdsKey.length > 0 ? planResultSetIdsKey.split("|") : [];
        setQueryPlanTabState((current) => (current?.key === key ? current : loadingState));
        let canceled = false;
        void rpc
            .sendRequest(QsGetPlanStateRequest.type, { resultSetIds })
            .then((result) => {
                if (canceled) {
                    return;
                }
                setQueryPlanTabState({
                    key,
                    executionPlanState:
                        result.executionPlanState ??
                        ({
                            loadState: ApiStatus.Error,
                            executionPlanGraphs: [],
                            totalCost: 0,
                            errorMessage: result.error ?? "Execution plan could not be loaded.",
                        } satisfies ExecutionPlanState),
                });
            })
            .catch((error) => {
                if (canceled) {
                    return;
                }
                setQueryPlanTabState({
                    key,
                    executionPlanState: {
                        loadState: ApiStatus.Error,
                        executionPlanGraphs: [],
                        totalCost: 0,
                        errorMessage: error instanceof Error ? error.message : String(error),
                    },
                });
            });
        return () => {
            canceled = true;
        };
    }, [
        planRowsAvailable,
        planResultSetIdsKey,
        planResultSetKey,
        planResultSetSummaries.length,
        rpc,
    ]);
    useEffect(() => {
        if (activeTab === "queryPlan" && planResultSetSummaries.length === 0) {
            setActiveTab(gridResultSetSummaries.length > 0 ? "results" : "messages");
        }
    }, [activeTab, gridResultSetSummaries.length, planResultSetSummaries.length]);

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
                <span className="qs-db-wrap" ref={connWrapRef}>
                    <button
                        className={`qs-btn ${connection.kind === "disconnected" ? "primary" : ""}`}
                        title={connected ? "Change connection" : "Connect to a SQL Server"}
                        onClick={connect}>
                        <span className="codicon codicon-plug" /> {connected ? "Change" : "Connect"}
                    </button>
                    {connected ? (
                        <>
                            <button
                                className="qs-btn qs-btn-chevron"
                                title="More connection commands"
                                aria-haspopup="menu"
                                aria-expanded={connMenuOpen}
                                onClick={() => setConnMenuOpen((open) => !open)}>
                                <span className="codicon codicon-chevron-down" />
                            </button>
                            {connMenuOpen ? (
                                <div className="qs-db-menu" role="menu">
                                    <div
                                        role="menuitem"
                                        className="qs-db-item"
                                        onClick={disconnect}>
                                        <span className="codicon codicon-debug-disconnect" />{" "}
                                        Disconnect
                                    </div>
                                </div>
                            ) : null}
                        </>
                    ) : null}
                </span>
                <div className="qs-sep" />
                <span className="qs-db-wrap" ref={dbWrapRef}>
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
                data-tabster='{"focusable": {"ignoreKeydown": {"Tab": true}}, "uncontrolled": {}}'
                style={
                    showResults
                        ? {
                              flexBasis: resultsPaneMaximized ? "0%" : `${100 - resultsHeightPct}%`,
                              display: resultsPaneMaximized ? "none" : undefined,
                          }
                        : undefined
                }>
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
                        snippetSuggestions: "bottom",
                        tabFocusMode: false,
                    }}
                />
            </div>
            {showResults && results ? (
                <>
                    {!resultsPaneMaximized ? (
                        <div
                            className="qs-splitter"
                            onPointerDown={onSplitterDown}
                            onDoubleClick={resetSplit}
                            role="separator"
                            aria-orientation="horizontal"
                        />
                    ) : null}
                    <div
                        className="qs-results"
                        style={{
                            flexBasis: resultsPaneMaximized ? "100%" : `${resultsHeightPct}%`,
                        }}>
                        <div className="qs-results-tabs" role="tablist">
                            {hasDataResults ? (
                                <button
                                    role="tab"
                                    aria-selected={visibleActiveTab === "results"}
                                    className={`qs-tab ${visibleActiveTab === "results" ? "active" : ""}`}
                                    onClick={() => setActiveTab("results")}>
                                    Results
                                    {dataTotalRows > 0
                                        ? ` (${dataTotalRows.toLocaleString()})`
                                        : ""}
                                </button>
                            ) : null}
                            <button
                                role="tab"
                                aria-selected={visibleActiveTab === "messages"}
                                className={`qs-tab ${visibleActiveTab === "messages" ? "active" : ""} ${errorCount > 0 ? "has-errors" : ""}`}
                                onClick={() => setActiveTab("messages")}>
                                Messages
                                {errorCount > 0 ? ` (${errorCount} ⚠)` : ""}
                            </button>
                            {hasPlanResults ? (
                                <button
                                    role="tab"
                                    aria-selected={visibleActiveTab === "queryPlan"}
                                    className={`qs-tab ${visibleActiveTab === "queryPlan" ? "active" : ""}`}
                                    onClick={() => setActiveTab("queryPlan")}>
                                    Query Plan
                                    {planResultSetSummaries.length > 1
                                        ? ` (${planResultSetSummaries.length})`
                                        : ""}
                                </button>
                            ) : null}
                            <span className="qs-spacer" />
                            {visibleActiveTab === "results" &&
                            hasDataResults &&
                            !results.streaming ? (
                                <button
                                    className="qs-tabbar-btn"
                                    title="Pin all results to a read-only tab that survives reruns"
                                    aria-label="Pin all results"
                                    onClick={() => pinResults(undefined)}>
                                    <span className="codicon codicon-pin" />
                                </button>
                            ) : null}
                            {visibleActiveTab === "results" && hasDataResults ? (
                                <button
                                    className="qs-tabbar-btn"
                                    title={
                                        resultViewMode === "text"
                                            ? "Switch to Grid View"
                                            : "Switch to Text View"
                                    }
                                    aria-label={
                                        resultViewMode === "text"
                                            ? "Switch to Grid View"
                                            : "Switch to Text View"
                                    }
                                    onClick={toggleResultsViewMode}>
                                    <span
                                        className={`codicon codicon-${resultViewMode === "text" ? "table" : "file-text"}`}
                                    />
                                </button>
                            ) : null}
                            {visibleActiveTab === "queryPlan" && hasPlanResults ? (
                                <button
                                    className="qs-tabbar-btn"
                                    title="Open in New Tab"
                                    aria-label="Open query plan in new tab"
                                    onClick={() => {
                                        const resultSetId = planResultSetIdsKey.split("|")[0];
                                        if (resultSetId) {
                                            void rpc.sendRequest(QsOpenPlanRequest.type, {
                                                resultSetId,
                                            });
                                        }
                                    }}>
                                    <span className="codicon codicon-link-external" />
                                </button>
                            ) : null}
                            <button
                                className="qs-tabbar-btn"
                                title={
                                    resultsPaneMaximized
                                        ? "Restore editor and results split"
                                        : "Maximize results pane"
                                }
                                aria-label={
                                    resultsPaneMaximized
                                        ? "Restore editor and results split"
                                        : "Maximize results pane"
                                }
                                onClick={() => setResultsPaneMaximized((value) => !value)}>
                                <span
                                    className={`codicon codicon-${resultsPaneMaximized ? "screen-normal" : "screen-full"}`}
                                />
                            </button>
                            {results.streaming ? (
                                <span className="qs-muted qs-streaming">streaming…</span>
                            ) : null}
                        </div>
                        <div
                            className={`qs-results-body${resultsFillActive ? " qs-results-body-fill" : ""}`}
                            ref={resultsBodyRef}>
                            {visibleActiveTab === "results" ? (
                                resultViewMode === "text" ? (
                                    <QueryStudioResultsTextView
                                        rpc={rpc}
                                        resultSets={gridResultSetSummaries}
                                        liveRowCounts={liveRowCounts}
                                        gridStyle={state?.gridStyle}
                                    />
                                ) : (
                                    // Lazy mounting: captions always render; grid
                                    // bodies mount near the viewport (never unmount).
                                    // BOOT-2: the grid stack is a dynamic chunk —
                                    // Suspense covers the rare results-beat-chunk ms.
                                    <React.Suspense fallback={<ResultsSurfaceLoading />}>
                                        <LazyQsResultsGridProvider>
                                            {gridResultSetSummaries.map((summary, index) => {
                                                const isMaximized =
                                                    maximizedGrid === summary.resultSetId;
                                                return (
                                                    <LazyResultGridBlock
                                                        key={summary.resultSetId}
                                                        rpc={rpc}
                                                        summary={summary}
                                                        displayOrdinal={index + 1}
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
                                                            maximizedGrid !== undefined &&
                                                            !isMaximized
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
                                                        captionExtras={
                                                            summary.complete ? (
                                                                <button
                                                                    className="qs-btn qs-grid-pin"
                                                                    title="Pin this result set to a read-only tab that survives reruns"
                                                                    aria-label="Pin result set"
                                                                    onClick={() =>
                                                                        pinResults(
                                                                            summary.resultSetId,
                                                                        )
                                                                    }>
                                                                    <span className="codicon codicon-pin" />
                                                                </button>
                                                            ) : undefined
                                                        }
                                                    />
                                                );
                                            })}
                                        </LazyQsResultsGridProvider>
                                    </React.Suspense>
                                )
                            ) : visibleActiveTab === "queryPlan" ? (
                                // BOOT-2/P2: azdataGraph loads on FIRST plan-tab
                                // activation only — never at init.
                                <React.Suspense fallback={<ResultsSurfaceLoading />}>
                                    <LazyExecutionPlanView
                                        rpc={rpc}
                                        executionPlanState={queryPlanTabState?.executionPlanState}
                                    />
                                </React.Suspense>
                            ) : (
                                <React.Suspense fallback={<ResultsSurfaceLoading />}>
                                    <LazyMessagesView rpc={rpc} messages={messages} />
                                </React.Suspense>
                            )}
                        </div>
                    </div>
                </>
            ) : null}
            <div
                className={`qs-statusbar${connection.accentColor ? " qs-statusbar-accent" : ""}`}
                role="status"
                // Production safety: the server-group accent colors the WHOLE
                // status bar; text color is luminance-picked host-side.
                style={
                    connection.accentColor
                        ? {
                              background: connection.accentColor,
                              color: connection.accentTextColor ?? "#ffffff",
                          }
                        : undefined
                }
                title={
                    connection.production
                        ? "PRODUCTION connection — modifications will ask for confirmation"
                        : undefined
                }>
                <span
                    className="qs-status-message"
                    data-kind={actionHint ? "error" : (state?.statusMessage.kind ?? "ready")}>
                    {actionHint ?? state?.statusMessage.text ?? "Ready — not connected"}
                </span>
                <span className="qs-spacer" />
                {results?.present ? (
                    <span className="qs-status-seg">{dataTotalRows.toLocaleString()} rows</span>
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

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isModelStateCurrent(
    model: monacoNs.editor.ITextModel,
    version: number,
    hash: string,
): boolean {
    return model.getVersionId() === version && textHash(model.getValue()) === hash;
}

function shouldAllowBrowserSelectAll(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) {
        return false;
    }
    return (
        target.closest(
            [
                "input",
                "textarea",
                "[contenteditable='true']",
                ".monaco-editor",
                ".fluent-result-grid",
                ".monaco-table",
                ".qs-messages",
            ].join(","),
        ) !== null
    );
}

function isEditorClipboardChord(event: KeyboardEvent): boolean {
    const primaryOnly =
        (event.ctrlKey || event.metaKey) &&
        !(event.ctrlKey && event.metaKey) &&
        !event.shiftKey &&
        !event.altKey;
    if (!primaryOnly) {
        return false;
    }
    switch (event.key.toLowerCase()) {
        case "c":
        case "x":
        case "v":
            return true;
        default:
            return false;
    }
}

function isFromMonacoEditor(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(".monaco-editor") !== null;
}

function isQueryStudioState(value: unknown): value is QsState {
    return (
        typeof value === "object" &&
        value !== null &&
        "schemaVersion" in value &&
        "connection" in value &&
        "results" in value
    );
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
