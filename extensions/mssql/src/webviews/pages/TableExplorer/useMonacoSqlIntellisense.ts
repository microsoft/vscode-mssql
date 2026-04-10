/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { BeforeMount } from "@monaco-editor/react";
import { useRef, useCallback, useEffect } from "react";
import {
    WebviewCompletionRequest,
    WebviewCompletionResult,
    WebviewDocumentSyncNotification,
    WebviewFormatDocumentRequest,
    WebviewFormatDocumentResult,
} from "../../../sharedInterfaces/webviewLanguageService";
import { WebviewRpc } from "../../common/rpc";

/**
 * Hook that registers a Monaco SQL completion provider which proxies requests
 * through the extension host to the SQL Tools Service.
 *
 * @param ownerUri - The ownerUri identifying the connection/session context.
 *                   May start empty and get populated later.
 * @param extensionRpc - The webview RPC instance for communicating with the extension host.
 * @returns An object containing a `beforeMount` callback for the VscodeEditor component
 *          and an `onContentChange` callback to sync editor content with the STS.
 */
const DOCUMENT_SYNC_DEBOUNCE_MS = 300;

export function useMonacoSqlIntellisense(
    ownerUri: string,
    extensionRpc: WebviewRpc<unknown>,
): { beforeMount: BeforeMount; onContentChange: (value: string) => void } {
    const disposablesRef = useRef<{ dispose(): void }[]>([]);

    // Use a ref so the completion provider closure always reads the latest ownerUri,
    // even though beforeMount only runs once when Monaco mounts.
    const ownerUriRef = useRef(ownerUri);
    useEffect(() => {
        ownerUriRef.current = ownerUri;
    }, [ownerUri]);

    const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Cleanup on unmount to prevent provider accumulation when the script pane is toggled
    useEffect(() => {
        return () => {
            disposablesRef.current.forEach((d) => d.dispose());
            disposablesRef.current = [];
            if (syncTimeoutRef.current !== null) {
                clearTimeout(syncTimeoutRef.current);
                syncTimeoutRef.current = null;
            }
        };
    }, []);

    // Debounce document sync notifications so we don't fire an RPC on every keystroke.
    // Completion requests carry the latest fullText and trigger their own sync on the
    // extension host side, so debouncing here is safe — STS still sees fresh text when
    // it actually matters for IntelliSense.
    const onContentChange = useCallback(
        (value: string) => {
            if (syncTimeoutRef.current !== null) {
                clearTimeout(syncTimeoutRef.current);
            }
            syncTimeoutRef.current = setTimeout(() => {
                syncTimeoutRef.current = null;
                const currentUri = ownerUriRef.current;
                if (!currentUri) {
                    return;
                }
                void extensionRpc.sendNotification(WebviewDocumentSyncNotification.type, {
                    ownerUri: currentUri,
                    fullText: value,
                });
            }, DOCUMENT_SYNC_DEBOUNCE_MS);
        },
        [extensionRpc],
    );

    const beforeMount: BeforeMount = useCallback(
        (monaco) => {
            // Dispose previous providers if re-mounting
            disposablesRef.current.forEach((d) => d.dispose());
            disposablesRef.current = [];

            const completionProvider = monaco.languages.registerCompletionItemProvider("sql", {
                // Only "." triggers automatic completions — matches SSMS/ADS behavior and
                // avoids firing a request after every space in normal SQL typing. Users can
                // still invoke completions manually via Ctrl+Space.
                triggerCharacters: ["."],
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                provideCompletionItems: async function (
                    model: any,
                    position: any,
                    _context: any,
                    token: any,
                ) {
                    const currentUri = ownerUriRef.current;
                    if (!currentUri) {
                        return { suggestions: [] };
                    }

                    const fullText = model.getValue();
                    const textUntilPosition = model.getValueInRange({
                        startLineNumber: position.lineNumber,
                        startColumn: 1,
                        endLineNumber: position.lineNumber,
                        endColumn: position.column,
                    });

                    try {
                        const result: WebviewCompletionResult = await extensionRpc.sendRequest(
                            WebviewCompletionRequest.type,
                            {
                                ownerUri: currentUri,
                                position: {
                                    lineNumber: position.lineNumber,
                                    column: position.column,
                                },
                                textUntilPosition,
                                fullText,
                            },
                            token,
                        );

                        const word = model.getWordUntilPosition(position);
                        const defaultRange = {
                            startLineNumber: position.lineNumber,
                            startColumn: word.startColumn,
                            endLineNumber: position.lineNumber,
                            endColumn: position.column,
                        };

                        return {
                            suggestions: result.suggestions.map((item) => ({
                                label: item.label,
                                kind: item.kind,
                                insertText: item.insertText,
                                detail: item.detail,
                                documentation: item.documentation,
                                sortText: item.sortText,
                                filterText: item.filterText,
                                preselect: item.preselect,
                                range: item.range ?? defaultRange,
                            })),
                        };
                    } catch (error) {
                        console.error(`[IntelliSense] Error in provideCompletionItems:`, error);
                        return { suggestions: [] };
                    }
                },
            });

            disposablesRef.current.push(completionProvider);

            // Format Document / Format Selection — proxied to STS so the
            // command palette surfaces these actions for the embedded editor
            // and the output matches what the main SQL editor produces.
            const documentFormattingProvider =
                monaco.languages.registerDocumentFormattingEditProvider("sql", {
                    displayName: "SQL Tools Service",
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    provideDocumentFormattingEdits: async (
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        model: any,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        options: any,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        token: any,
                    ) => {
                        const currentUri = ownerUriRef.current;
                        if (!currentUri) {
                            return [];
                        }
                        try {
                            const result: WebviewFormatDocumentResult =
                                await extensionRpc.sendRequest(
                                    WebviewFormatDocumentRequest.type,
                                    {
                                        ownerUri: currentUri,
                                        fullText: model.getValue(),
                                        options: {
                                            tabSize: options.tabSize,
                                            insertSpaces: options.insertSpaces,
                                        },
                                    },
                                    token,
                                );
                            return result.edits.map((edit) => ({
                                range: edit.range,
                                text: edit.text,
                            }));
                        } catch (error) {
                            console.error(`[Formatter] provideDocumentFormattingEdits:`, error);
                            return [];
                        }
                    },
                });
            disposablesRef.current.push(documentFormattingProvider);

            const rangeFormattingProvider =
                monaco.languages.registerDocumentRangeFormattingEditProvider("sql", {
                    displayName: "SQL Tools Service",
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    provideDocumentRangeFormattingEdits: async (
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        model: any,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        range: any,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        options: any,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        token: any,
                    ) => {
                        const currentUri = ownerUriRef.current;
                        if (!currentUri) {
                            return [];
                        }
                        try {
                            const result: WebviewFormatDocumentResult =
                                await extensionRpc.sendRequest(
                                    WebviewFormatDocumentRequest.type,
                                    {
                                        ownerUri: currentUri,
                                        fullText: model.getValue(),
                                        options: {
                                            tabSize: options.tabSize,
                                            insertSpaces: options.insertSpaces,
                                        },
                                        range: {
                                            startLineNumber: range.startLineNumber,
                                            startColumn: range.startColumn,
                                            endLineNumber: range.endLineNumber,
                                            endColumn: range.endColumn,
                                        },
                                    },
                                    token,
                                );
                            return result.edits.map((edit) => ({
                                range: edit.range,
                                text: edit.text,
                            }));
                        } catch (error) {
                            console.error(
                                `[Formatter] provideDocumentRangeFormattingEdits:`,
                                error,
                            );
                            return [];
                        }
                    },
                });
            disposablesRef.current.push(rangeFormattingProvider);
        },
        [extensionRpc],
    );

    return { beforeMount, onContentChange };
}
