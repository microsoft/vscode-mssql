/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { BeforeMount } from "@monaco-editor/react";
import { useRef, useCallback, useEffect } from "react";
import {
    WebviewDefinitionItem,
    WebviewDefinitionRequest,
    WebviewDefinitionResult,
    WebviewOpenDefinitionRequest,
    WebviewHoverRequest,
    WebviewHoverResult,
} from "../../../sharedInterfaces/webviewLanguageService";
import { WebviewRpc } from "../../common/rpc";

export function useMonacoSqlIntellisense(
    ownerUri: string,
    extensionRpc: WebviewRpc<unknown>,
): {
    beforeMount: BeforeMount;
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const definitionModelsRef = useRef<Map<string, any>>(new Map());

    // Cleanup on unmount to prevent provider accumulation when the script pane is toggled
    useEffect(() => {
        return () => {
            disposablesRef.current.forEach((d) => d.dispose());
            disposablesRef.current = [];
            definitionModelsRef.current.forEach((m) => m.dispose());
            definitionModelsRef.current.clear();
        };
    }, []);

    const beforeMount: BeforeMount = useCallback(
        (monaco) => {
            // Dispose previous providers if re-mounting
            disposablesRef.current.forEach((d) => d.dispose());
            disposablesRef.current = [];

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

    return { beforeMount, onMount };
}
