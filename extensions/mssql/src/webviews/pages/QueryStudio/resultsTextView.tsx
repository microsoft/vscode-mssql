/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState } from "react";
import type { editor as MonacoEditor } from "monaco-editor";
import { VscodeEditor } from "../../common/vscodeMonaco";
import { locConstants } from "../../common/locConstants";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { QsGridStyle, QsResultSetSummary, QsState } from "../../../sharedInterfaces/queryStudio";
import type { Rpc } from "./resultsGridShared";
import type { QsResultsTextViewState } from "../../../sharedInterfaces/queryStudioViewState";

import { buildTextViewContent, textViewContentInput } from "./resultsTextContent";

export function QueryStudioResultsTextView(props: {
    rpc: Rpc;
    resultSets: readonly QsResultSetSummary[];
    liveRowCounts: Readonly<Record<string, number>>;
    gridStyle: QsGridStyle | undefined;
    initialViewState?: QsResultsTextViewState;
    onViewStateChange?: (state: QsResultsTextViewState) => void;
}) {
    const { rpc, resultSets, gridStyle } = props;
    const { EOL, themeKind } = useVscodeWebview<QsState, void>();
    const [textContent, setTextContent] = useState("");
    const [loading, setLoading] = useState(true);
    const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | undefined>(undefined);
    const editorDisposablesRef = useRef<Array<{ dispose(): void }>>([]);
    const latestViewStateRef = useRef(props.initialViewState);
    const onViewStateChangeRef = useRef(props.onViewStateChange);
    onViewStateChangeRef.current = props.onViewStateChange;

    const emitViewState = useCallback(() => {
        const editor = editorRef.current;
        const selection = editor?.getSelection();
        if (!editor || !selection) {
            return;
        }
        const next: QsResultsTextViewState = {
            selection: {
                startLineNumber: selection.startLineNumber,
                startColumn: selection.startColumn,
                endLineNumber: selection.endLineNumber,
                endColumn: selection.endColumn,
            },
            scrollTop: editor.getScrollTop(),
            scrollLeft: editor.getScrollLeft(),
        };
        latestViewStateRef.current = next;
        onViewStateChangeRef.current?.(next);
    }, []);

    const mountEditor = useCallback(
        (editor: MonacoEditor.IStandaloneCodeEditor) => {
            for (const disposable of editorDisposablesRef.current) {
                disposable.dispose();
            }
            editorDisposablesRef.current = [];
            editorRef.current = editor;
            if (latestViewStateRef.current) {
                editor.setSelection(latestViewStateRef.current.selection);
                editor.setScrollPosition({
                    scrollTop: latestViewStateRef.current.scrollTop,
                    scrollLeft: latestViewStateRef.current.scrollLeft,
                });
            }
            editorDisposablesRef.current = [
                editor.onDidChangeCursorSelection(emitViewState),
                editor.onDidScrollChange(emitViewState),
                editor.onDidDispose(() => {
                    if (editorRef.current === editor) {
                        emitViewState();
                        editorRef.current = undefined;
                    }
                }),
            ];
        },
        [emitViewState],
    );

    useEffect(
        () => () => {
            emitViewState();
            for (const disposable of editorDisposablesRef.current) {
                disposable.dispose();
            }
            editorDisposablesRef.current = [];
            editorRef.current = undefined;
        },
        [emitViewState],
    );

    // Materialize only completed sets. Streaming notifications and unrelated
    // state updates must not repeatedly refetch the same 100,000-row prefix.
    const contentInput = textViewContentInput(resultSets, EOL, gridStyle);
    const streaming = resultSets.some((set) => !set.complete);
    useEffect(() => {
        let canceled = false;
        const input = JSON.parse(contentInput) as {
            resultSets: QsResultSetSummary[];
            eol: string;
            maxRows: number;
            sampleRows: number;
        };
        setLoading(true);
        void buildTextViewContent(
            rpc,
            input.resultSets,
            {},
            input.eol,
            {
                textViewMaxRows: input.maxRows,
                textViewSampleRows: input.sampleRows,
            },
            () => canceled,
        )
            .then((content) => {
                if (!canceled) {
                    setTextContent(content);
                    setLoading(false);
                }
            })
            .catch(() => {
                if (!canceled) {
                    setTextContent(locConstants.queryResult.errorGeneratingTextView);
                    setLoading(false);
                }
            });
        return () => {
            canceled = true;
        };
    }, [contentInput, rpc]);

    if (loading && !textContent) {
        return (
            <div className="qs-text-view-loading">{locConstants.queryResult.loadingTextView}</div>
        );
    }

    return (
        <div className="qs-text-view">
            {streaming && (
                <div role="status">{locConstants.queryStudioCore.textViewWaitingForResults}</div>
            )}
            <div className="qs-text-view-editor">
                <VscodeEditor
                    width="100%"
                    height="100%"
                    language="plaintext"
                    themeKind={themeKind}
                    value={textContent || locConstants.queryResult.noResultsToDisplay}
                    onMount={mountEditor}
                    options={{
                        readOnly: true,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        wordWrap: "off",
                        fontFamily: gridStyle?.fontFamily || "var(--vscode-editor-font-family)",
                        fontSize: gridStyle?.fontSize || 12,
                        lineNumbers: "off",
                        glyphMargin: false,
                        folding: false,
                        lineDecorationsWidth: 0,
                        lineNumbersMinChars: 0,
                        renderLineHighlight: "none",
                        automaticLayout: true,
                        scrollbar: {
                            vertical: "auto",
                            horizontal: "auto",
                        },
                    }}
                />
            </div>
        </div>
    );
}
