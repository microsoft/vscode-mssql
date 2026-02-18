/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from "@vscode/l10n";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { FluentProvider } from "@fluentui/react-components";
import { LocConstants } from "./locConstants";
import { WebviewApi } from "vscode-webview";
import { WebviewRpc } from "./rpc";
import { webviewTheme } from "./theme";
import {
    ColorThemeChangeNotification,
    ColorThemeKind,
    GetEOLRequest,
    GetKeyBindingsConfigRequest,
    GetLocalizationRequest,
    GetStateRequest,
    GetThemeRequest,
    LoadStatsNotification,
    StateChangeNotification,
    WebviewKeyBindings,
} from "../../sharedInterfaces/webview";
import { getEOL } from "./utils";
import { vsCodeApiInstance } from "./acquireVsCodeApi";
import { parseWebviewKeyboardShortcutConfig } from "./keyboardUtils";

/**
 * Context for vscode webview functionality like theming, state management, rpc and vscode api.
 * @template State interface that contains definitions for all state properties.
 * @template Reducers interface that contains definitions for all reducers and their payloads.
 */
export interface VscodeWebviewContextProps<State, Reducers> {
    /**
     * The vscode api instance.
     */
    vscodeApi: WebviewApi<unknown>;
    /**
     * Rpc to communicate with the extension.
     */
    extensionRpc: WebviewRpc<Reducers>;
    /**
     * Selector friendly state
     * @returns
     */
    getSnapshot: () => State;
    subscribe: (listener: () => void) => () => void;
    /**
     * Theme of the webview.
     */
    themeKind: ColorThemeKind;
    /**
     * Key bindings for the webview.
     */
    keyBindings: WebviewKeyBindings;
    /**
     * Localization status. The value is true when the localization file content is received from the extension.
     * This is used to force a re-render of the component when the localization file content is received.
     */
    localization: boolean;
    /**
     * OS specific end of line character.
     */
    EOL: string;
}

const vscodeApiInstance = vsCodeApiInstance.vscodeApiInstance;

export const VscodeWebviewContext = createContext<
    VscodeWebviewContextProps<unknown, unknown> | undefined
>(undefined);

interface VscodeWebviewProviderProps {
    children: React.ReactNode;
}

/**
 * Provider for essential vscode webview functionality like
 * theming, state management, rpc and vscode api.
 * @param param0 child components
 */
export function VscodeWebviewProvider<State, Reducers>({ children }: VscodeWebviewProviderProps) {
    const vscodeApi = vscodeApiInstance;
    const extensionRpc = WebviewRpc.getInstance<Reducers>(vscodeApi);

    const [theme, setTheme] = useState(ColorThemeKind.Light);
    const [keyBindings, setKeyBindings] = useState<WebviewKeyBindings>({} as WebviewKeyBindings);
    const [localization, setLocalization] = useState<boolean>(false);
    const [EOL, setEOL] = useState<string>(getEOL());

    const stateRef = useRef<State | undefined>(undefined);
    const listenersRef = useRef(new Set<() => void>());
    const [hasInitialState, setHasInitialState] = useState(false);

    const getSnapshot = useCallback(() => {
        // Return a safe default while not initialized to prevent useSyncExternalStore from erroring
        return stateRef.current ?? ({} as State);
    }, []);

    const subscribe = useCallback((listener: () => void) => {
        listenersRef.current.add(listener);
        return () => {
            listenersRef.current.delete(listener);
        };
    }, []);

    const emit = () => {
        listenersRef.current.forEach((fn) => fn());
    };

    // Bootstrap - register notification handlers BEFORE fetching state
    useEffect(() => {
        // Register notification handlers first to prevent race conditions
        extensionRpc.onNotification(ColorThemeChangeNotification.type, (params) => {
            setTheme(params as ColorThemeKind);
        });

        extensionRpc.onNotification<State>(StateChangeNotification.type<State>(), (params) => {
            stateRef.current = params;
            setHasInitialState(true);
            emit();
        });

        async function bootstrap() {
            try {
                // First paint gate: only wait for initial state.
                const initialState = await extensionRpc.sendRequest(GetStateRequest.type<State>());
                stateRef.current = initialState;

                try {
                    const keyboardShortcuts = await extensionRpc.sendRequest(
                        GetKeyBindingsConfigRequest.type,
                    );
                    setKeyBindings(parseWebviewKeyboardShortcutConfig(keyboardShortcuts));
                } catch (error) {
                    console.error("KeyBindings bootstrap failed:", error);
                }

                try {
                    const eol = await extensionRpc.sendRequest(GetEOLRequest.type);
                    setEOL(eol);
                } catch (error) {
                    console.error("EOL bootstrap failed:", error);
                }

                setHasInitialState(true);
                emit();

                // Non-critical initialization should not block first render.
                void (async () => {
                    try {
                        const theme = await extensionRpc.sendRequest(GetThemeRequest.type);
                        setTheme(theme);
                    } catch (error) {
                        console.error("Theme bootstrap failed:", error);
                    }
                })();

                void (async () => {
                    try {
                        const fileContents = await extensionRpc.sendRequest(
                            GetLocalizationRequest.type,
                        );
                        if (fileContents) {
                            await l10n.config({
                                contents: fileContents,
                            });
                            // Brief delay to ensure l10n is properly initialized
                            await new Promise((resolve) => setTimeout(resolve, 100));
                            LocConstants.createInstance();
                        }
                    } catch (error) {
                        console.error("Localization bootstrap failed:", error);
                    } finally {
                        setLocalization(true);
                    }
                })();

                void extensionRpc
                    .sendNotification(LoadStatsNotification.type, {
                        loadCompleteTimeStamp: Date.now(),
                    })
                    .catch((error) => {
                        console.error("Load stats notification failed:", error);
                    });
            } catch (error) {
                console.error("Bootstrap failed:", error);
                // Prevent indefinite blank screen when initial state fetch fails.
                if (stateRef.current === undefined) {
                    stateRef.current = {} as State;
                }
                setHasInitialState(true);
                emit();
            }
        }

        void bootstrap();
    }, []);

    return (
        <VscodeWebviewContext.Provider
            value={{
                vscodeApi,
                extensionRpc,
                getSnapshot,
                subscribe,
                themeKind: theme,
                keyBindings,
                localization,
                EOL,
            }}>
            <FluentProvider
                style={{
                    height: "100%",
                    width: "100%",
                }}
                theme={webviewTheme(theme)}>
                {
                    // don't render webview until initial state is available
                    hasInitialState && stateRef.current !== undefined && children
                }
            </FluentProvider>
        </VscodeWebviewContext.Provider>
    );
}

export function useVscodeWebview<State, Reducers>() {
    const context = useContext(VscodeWebviewContext);
    if (!context) {
        throw new Error("useVscodeWebview must be used within a VscodeWebviewProvider");
    }
    return context as VscodeWebviewContextProps<State, Reducers>;
}
