/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { BeforeMount } from "@monaco-editor/react";
import { useRef, useCallback, useEffect } from "react";
import {
    WebviewCompletionRequest,
    WebviewCompletionResult,
} from "../../../sharedInterfaces/webviewLanguageService";
import { WebviewRpc } from "../../common/rpc";

/**
 * Hook that registers a Monaco SQL completion provider which proxies requests
 * through the extension host to the SQL Tools Service.
 *
 * @param ownerUri - The ownerUri identifying the connection/session context.
 *                   May start empty and get populated later.
 * @param extensionRpc - The webview RPC instance for communicating with the extension host.
 * @returns An object containing a `beforeMount` callback for the VscodeEditor component.
 */
export function useMonacoSqlIntellisense(
    ownerUri: string,
    extensionRpc: WebviewRpc<unknown>,
): { beforeMount: BeforeMount } {
    const disposablesRef = useRef<{ dispose(): void }[]>([]);

    // Use a ref so the completion provider closure always reads the latest ownerUri,
    // even though beforeMount only runs once when Monaco mounts.
    const ownerUriRef = useRef(ownerUri);
    useEffect(() => {
        ownerUriRef.current = ownerUri;
    }, [ownerUri]);

    // Cleanup on unmount to prevent provider accumulation when the script pane is toggled
    useEffect(() => {
        return () => {
            disposablesRef.current.forEach((d) => d.dispose());
            disposablesRef.current = [];
        };
    }, []);

    const beforeMount: BeforeMount = useCallback(
        (monaco) => {
            // Dispose previous providers if re-mounting
            disposablesRef.current.forEach((d) => d.dispose());
            disposablesRef.current = [];

            console.log(
                `[IntelliSense] Registering SQL completion provider (ownerUri ref: "${ownerUriRef.current}")`,
            );
            const completionProvider = monaco.languages.registerCompletionItemProvider("sql", {
                triggerCharacters: [".", " "],
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                provideCompletionItems: async function (
                    model: any,
                    position: any,
                    _context: any,
                    token: any,
                ) {
                    const currentUri = ownerUriRef.current;
                    console.log(
                        `[IntelliSense] provideCompletionItems called - ownerUri: "${currentUri}", ` +
                            `position: (${position.lineNumber}, ${position.column})`,
                    );

                    if (!currentUri) {
                        console.log(`[IntelliSense] No ownerUri available yet, returning empty`);
                        return { suggestions: [] };
                    }

                    const fullText = model.getValue();
                    const textUntilPosition = model.getValueInRange({
                        startLineNumber: position.lineNumber,
                        startColumn: 1,
                        endLineNumber: position.lineNumber,
                        endColumn: position.column,
                    });

                    console.log(
                        `[IntelliSense] Sending RPC request - textUntilPosition: "${textUntilPosition}", ` +
                            `fullText length: ${fullText.length}`,
                    );

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

                        console.log(
                            `[IntelliSense] Received ${result.suggestions.length} suggestions. ` +
                                `First 5: [${result.suggestions
                                    .slice(0, 5)
                                    .map((s) => `"${s.label}" (kind=${s.kind})`)
                                    .join(", ")}]`,
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
        },
        [extensionRpc],
    );

    return { beforeMount };
}
