/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { BeforeMount } from "@monaco-editor/react";
import { useRef, useCallback, useEffect } from "react";
import {
    WebviewCompletionRequest,
    WebviewCompletionResult,
    WebviewDefinitionItem,
    WebviewDefinitionRequest,
    WebviewDefinitionResult,
    WebviewOpenDefinitionRequest,
    WebviewDiagnosticsNotification,
    WebviewDocumentSyncNotification,
    WebviewFormatDocumentRequest,
    WebviewFormatDocumentResult,
    WebviewHoverRequest,
    WebviewHoverResult,
    WebviewSignatureHelpRequest,
    WebviewSignatureHelpResult,
} from "../../../sharedInterfaces/webviewLanguageService";
import { WebviewRpc } from "../../common/rpc";

const MONACO_MARKER_OWNER = "mssql-sql-diagnostics";

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
): {
    beforeMount: BeforeMount;
    onContentChange: (value: string) => void;
    onMount: (
        editor: import("monaco-editor").editor.IStandaloneCodeEditor,
        monaco: typeof import("monaco-editor"),
    ) => void;
} {
    const disposablesRef = useRef<{ dispose(): void }[]>([]);

    // Use a ref so the completion provider closure always reads the latest ownerUri,
    // even though beforeMount only runs once when Monaco mounts.
    const ownerUriRef = useRef(ownerUri);
    useEffect(() => {
        ownerUriRef.current = ownerUri;
    }, [ownerUri]);

    // Track the Monaco global so the diagnostics listener (wired via the
    // webview RPC outside the beforeMount callback) can reach setModelMarkers
    // without having to re-import monaco-editor.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const monacoRef = useRef<any | null>(null);

    // Track the specific model instance for the table query editor so diagnostics
    // don't bleed into other SQL editors (e.g., Script Changes viewer)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const modelRef = useRef<any | null>(null);

    const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const definitionModelsRef = useRef<Map<string, any>>(new Map());

    // Cleanup on unmount to prevent provider accumulation when the script pane is toggled
    useEffect(() => {
        return () => {
            disposablesRef.current.forEach((d) => d.dispose());
            disposablesRef.current = [];
            definitionModelsRef.current.forEach((m) => m.dispose());
            definitionModelsRef.current.clear();
            if (syncTimeoutRef.current !== null) {
                clearTimeout(syncTimeoutRef.current);
                syncTimeoutRef.current = null;
            }
        };
    }, []);

    // Subscribe to diagnostics notifications pushed by the extension host and
    // apply them as Monaco model markers. STS publishes automatically ~750ms
    // after each didChange (see DiagnosticsHelper.PublishScriptDiagnostics),
    // so the squiggles update as the user types without any pull on our side.
    useEffect(() => {
        extensionRpc.onNotification(WebviewDiagnosticsNotification.type, (params) => {
            if (!params || params.ownerUri !== ownerUriRef.current) {
                return;
            }
            const monaco = monacoRef.current;
            const model = modelRef.current;
            if (!monaco || !model) {
                return;
            }
            const markers = params.diagnostics.map((d) => ({
                startLineNumber: d.startLineNumber,
                startColumn: d.startColumn,
                endLineNumber: d.endLineNumber,
                endColumn: d.endColumn,
                message: d.message,
                severity: d.severity,
                source: d.source,
                code: d.code,
            }));
            monaco.editor.setModelMarkers(model, MONACO_MARKER_OWNER, markers);
        });
    }, [extensionRpc]);

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
            // Cache the Monaco global so the diagnostics subscription can call
            // setModelMarkers without needing the mount callback to run first.
            monacoRef.current = monaco;

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
                    // Cache the model reference on first use so diagnostics can target this specific editor
                    if (!modelRef.current) {
                        modelRef.current = model;
                    }

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

            const getOrCreateDefinitionModel = (def: WebviewDefinitionItem) => {
                const key = def.name;
                const existing = definitionModelsRef.current.get(key);
                if (existing && !existing.isDisposed()) {
                    existing.setValue(def.content);
                    return existing;
                }
                const uri = monaco.Uri.parse(
                    `mssql-definition://definition/${encodeURIComponent(def.name)}.sql`,
                );
                const existingModel = monaco.editor.getModel(uri);
                if (existingModel) {
                    existingModel.setValue(def.content);
                    definitionModelsRef.current.set(key, existingModel);
                    return existingModel;
                }
                const newModel = monaco.editor.createModel(def.content, "sql", uri);
                definitionModelsRef.current.set(key, newModel);
                return newModel;
            };

            const definitionProvider = monaco.languages.registerDefinitionProvider("sql", {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                provideDefinition: async (model: any, position: any, token: any) => {
                    const currentUri = ownerUriRef.current;
                    if (!currentUri) {
                        return [];
                    }
                    try {
                        const result: WebviewDefinitionResult = await extensionRpc.sendRequest(
                            WebviewDefinitionRequest.type,
                            {
                                ownerUri: currentUri,
                                position: {
                                    lineNumber: position.lineNumber,
                                    column: position.column,
                                },
                                fullText: model.getValue(),
                            },
                            token,
                        );
                        return result.definitions.map((def) => {
                            const defModel = getOrCreateDefinitionModel(def);
                            return {
                                uri: defModel.uri,
                                range: def.range,
                            };
                        });
                    } catch (error) {
                        console.error(`[Definition] Error in provideDefinition:`, error);
                        return [];
                    }
                },
            });
            disposablesRef.current.push(definitionProvider);

            const hoverProvider = monaco.languages.registerHoverProvider("sql", {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                provideHover: async (model: any, position: any, token: any) => {
                    const currentUri = ownerUriRef.current;
                    if (!currentUri) {
                        return null;
                    }
                    try {
                        const result: WebviewHoverResult = await extensionRpc.sendRequest(
                            WebviewHoverRequest.type,
                            {
                                ownerUri: currentUri,
                                position: {
                                    lineNumber: position.lineNumber,
                                    column: position.column,
                                },
                                fullText: model.getValue(),
                            },
                            token,
                        );
                        if (!result.contents || result.contents.length === 0) {
                            return null;
                        }
                        return {
                            contents: result.contents.map((c) => ({ value: c.value })),
                            range: result.range,
                        };
                    } catch (error) {
                        console.error(`[Hover] Error in provideHover:`, error);
                        return null;
                    }
                },
            });
            disposablesRef.current.push(hoverProvider);

            const signatureHelpProvider = monaco.languages.registerSignatureHelpProvider("sql", {
                signatureHelpTriggerCharacters: ["(", ","],
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                provideSignatureHelp: async (model: any, position: any, token: any) => {
                    const currentUri = ownerUriRef.current;
                    if (!currentUri) {
                        return null;
                    }
                    try {
                        const result: WebviewSignatureHelpResult = await extensionRpc.sendRequest(
                            WebviewSignatureHelpRequest.type,
                            {
                                ownerUri: currentUri,
                                position: {
                                    lineNumber: position.lineNumber,
                                    column: position.column,
                                },
                                fullText: model.getValue(),
                            },
                            token,
                        );
                        if (!result.signatures || result.signatures.length === 0) {
                            return null;
                        }
                        return {
                            value: {
                                signatures: result.signatures.map((sig) => ({
                                    label: sig.label,
                                    documentation: sig.documentation
                                        ? { value: sig.documentation }
                                        : undefined,
                                    parameters: sig.parameters.map((p) => ({
                                        label: p.label,
                                        documentation: p.documentation
                                            ? { value: p.documentation }
                                            : undefined,
                                    })),
                                })),
                                activeSignature: result.activeSignature,
                                activeParameter: result.activeParameter,
                            },
                            dispose: () => {},
                        };
                    } catch (error) {
                        console.error(`[SignatureHelp] Error in provideSignatureHelp:`, error);
                        return null;
                    }
                },
            });
            disposablesRef.current.push(signatureHelpProvider);
        },
        [extensionRpc],
    );

    const onMount = useCallback(
        (
            editor: import("monaco-editor").editor.IStandaloneCodeEditor,
            monaco: typeof import("monaco-editor"),
        ) => {
            const openDefinitionInEditor = async () => {
                const position = editor.getPosition();
                const model = editor.getModel();
                const currentUri = ownerUriRef.current;
                if (!position || !model || !currentUri) {
                    return;
                }
                try {
                    await extensionRpc.sendRequest(WebviewOpenDefinitionRequest.type, {
                        ownerUri: currentUri,
                        position: {
                            lineNumber: position.lineNumber,
                            column: position.column,
                        },
                        fullText: model.getValue(),
                    });
                } catch (error) {
                    console.error(`[GoToDefinition] Error:`, error);
                }
            };

            // Override F12 / Ctrl+F12 keybindings without adding a context
            // menu entry — the built-in "Go to Definition" menu item is
            // redirected via a click interceptor (same pattern as Paste).
            editor.addCommand(monaco.KeyCode.F12, openDefinitionInEditor);
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.F12, openDefinitionInEditor);

            const goToDefClickInterceptor = (evt: MouseEvent) => {
                const path = evt.composedPath();
                for (const node of path) {
                    if (!(node instanceof Element)) {
                        continue;
                    }
                    const role = node.getAttribute?.("role");
                    const hasMenuItemClass =
                        node.classList?.contains("action-menu-item") ||
                        node.classList?.contains("action-item") ||
                        node.classList?.contains("action-label");
                    if (role !== "menuitem" && !hasMenuItemClass) {
                        continue;
                    }
                    const label =
                        node.querySelector?.(".action-label")?.textContent?.trim() ??
                        node.textContent?.trim();
                    if (label === "Go to Definition") {
                        evt.preventDefault();
                        evt.stopPropagation();
                        void openDefinitionInEditor();
                        return;
                    }
                }
            };
            document.addEventListener("click", goToDefClickInterceptor, true);
            editor.onDidDispose(() => {
                document.removeEventListener("click", goToDefClickInterceptor, true);
            });
        },
        [extensionRpc],
    );

    return { beforeMount, onContentChange, onMount };
}
