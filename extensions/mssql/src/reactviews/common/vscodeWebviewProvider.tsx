/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from "@vscode/l10n";

import { createContext, useContext, useEffect, useRef } from "react";

import { FluentProvider } from "@fluentui/react-components";
import { useStore } from "zustand";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { createStore } from "zustand/vanilla";
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
    KeyBindingsChangeNotification,
    LoadStatsNotification,
    StateChangeNotification,
    WebviewKeyBindings,
} from "../../sharedInterfaces/webview";
import { getEOL } from "./utils";
import { vsCodeApiInstance } from "./acquireVsCodeApi";
import { parseWebviewKeyboardShortcutConfig } from "./keyboardUtils";

/**
 * Context for vscode webview functionality like rpc, vscode api, and the Zustand store.
 * @template Reducers interface that contains definitions for all reducers and their payloads.
 */
export interface VscodeWebviewContextProps<Reducers> {
    /**
     * The vscode api instance.
     */
    vscodeApi: WebviewApi<unknown>;
    /**
     * Rpc to communicate with the extension.
     */
    extensionRpc: WebviewRpc<Reducers>;
    /**
     * The Zustand store instance for webview state.
     */
    store: ReturnType<typeof createVscodeWebviewStore<any>>;
}

interface VscodeWebviewStoreState<State> {
    state: State | undefined;
    themeKind: ColorThemeKind;
    keyBindings: WebviewKeyBindings;
    localization: boolean;
    EOL: string;
    isBootstrapComplete: boolean;
}

interface VscodeWebviewStoreActions<State> {
    replaceState: (state: State) => void;
    setThemeKind: (themeKind: ColorThemeKind) => void;
    setKeyBindings: (keyBindings: WebviewKeyBindings) => void;
    setLocalization: (localization: boolean) => void;
    setEOL: (EOL: string) => void;
    setBootstrapComplete: (isBootstrapComplete: boolean) => void;
}

type VscodeWebviewStore<State> = VscodeWebviewStoreState<State> & VscodeWebviewStoreActions<State>;

function createVscodeWebviewStore<State>() {
    return createStore<VscodeWebviewStore<State>>((set) => ({
        state: undefined,
        themeKind: ColorThemeKind.Light,
        keyBindings: parseWebviewKeyboardShortcutConfig(),
        localization: false,
        EOL: getEOL(),
        isBootstrapComplete: false,
        replaceState: (state) => set({ state }),
        setThemeKind: (themeKind) => set({ themeKind }),
        setKeyBindings: (keyBindings) => set({ keyBindings }),
        setLocalization: (localization) => set({ localization }),
        setEOL: (EOL) => set({ EOL }),
        setBootstrapComplete: (isBootstrapComplete) => set({ isBootstrapComplete }),
    }));
}

const vscodeApiInstance = vsCodeApiInstance.vscodeApiInstance;

export const VscodeWebviewContext = createContext<VscodeWebviewContextProps<unknown> | undefined>(
    undefined,
);

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

    const storeRef = useRef<ReturnType<typeof createVscodeWebviewStore<State>> | undefined>(
        undefined,
    );
    if (!storeRef.current) {
        storeRef.current = createVscodeWebviewStore<State>();
    }
    const store = storeRef.current;

    const themeKind = useStore(store, (currentStore) => currentStore.themeKind);
    const isBootstrapComplete = useStore(store, (currentStore) => currentStore.isBootstrapComplete);

    // Bootstrap - register notification handlers BEFORE fetching state
    useEffect(() => {
        // Register notification handlers first to prevent race conditions
        extensionRpc.onNotification(ColorThemeChangeNotification.type, (params) => {
            store.getState().setThemeKind(params as ColorThemeKind);
        });

        extensionRpc.onNotification<State>(StateChangeNotification.type<State>(), (params) => {
            store.getState().replaceState(params);
        });

        extensionRpc.onNotification(KeyBindingsChangeNotification.type, (params) => {
            store.getState().setKeyBindings(parseWebviewKeyboardShortcutConfig(params));
        });

        async function bootstrap() {
            try {
                // First paint gate: only wait for initial state.
                const initialState = await extensionRpc.sendRequest(GetStateRequest.type<State>());
                store.getState().replaceState(initialState);

                try {
                    const keyboardShortcuts = await extensionRpc.sendRequest(
                        GetKeyBindingsConfigRequest.type,
                    );
                    store
                        .getState()
                        .setKeyBindings(parseWebviewKeyboardShortcutConfig(keyboardShortcuts));
                } catch (error) {
                    console.error("KeyBindings bootstrap failed:", error);
                }

                try {
                    const eol = await extensionRpc.sendRequest(GetEOLRequest.type);
                    store.getState().setEOL(eol);
                } catch (error) {
                    console.error("EOL bootstrap failed:", error);
                }

                store.getState().setBootstrapComplete(true);

                // Non-critical initialization should not block first render.
                void (async () => {
                    try {
                        const theme = await extensionRpc.sendRequest(GetThemeRequest.type);
                        store.getState().setThemeKind(theme);
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
                        store.getState().setLocalization(true);
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
                if (store.getState().state === undefined) {
                    store.getState().replaceState({} as State);
                }
                store.getState().setBootstrapComplete(true);
            }
        }

        void bootstrap();
    }, [extensionRpc, store]);

    const contextValue: VscodeWebviewContextProps<Reducers> = {
        vscodeApi,
        extensionRpc,
        store,
    };

    return (
        <VscodeWebviewContext.Provider value={contextValue}>
            <FluentProvider
                style={{
                    height: "100%",
                    width: "100%",
                }}
                theme={webviewTheme(themeKind)}>
                {
                    // don't render webview until bootstrap has completed
                    isBootstrapComplete && store.getState().state !== undefined && children
                }
            </FluentProvider>
        </VscodeWebviewContext.Provider>
    );
}

export function useVscodeWebview<Reducers>() {
    const context = useContext(VscodeWebviewContext);
    if (!context) {
        throw new Error("useVscodeWebview must be used within a VscodeWebviewProvider");
    }
    return context as VscodeWebviewContextProps<Reducers>;
}

/**
 * Hook to select store-level properties (themeKind, keyBindings, localization, EOL) directly
 * from the Zustand store.
 */
export function useWebviewStore<T>(
    selector: (store: VscodeWebviewStoreState<unknown>) => T,
    equals: (a: T, b: T) => boolean = Object.is,
): T {
    const context = useContext(VscodeWebviewContext);
    if (!context) {
        throw new Error("useWebviewStore must be used within a VscodeWebviewProvider");
    }

    return useStoreWithEqualityFn(context.store, selector, equals);
}

export function useVscodeWebviewSelector<State, T>(
    selector: (state: State) => T,
    equals: (a: T, b: T) => boolean = Object.is,
) {
    const context = useContext(VscodeWebviewContext);
    if (!context) {
        throw new Error("useVscodeWebviewSelector must be used within a VscodeWebviewProvider");
    }

    const store = context.store as ReturnType<typeof createVscodeWebviewStore<State>>;

    return useStoreWithEqualityFn(
        store,
        (currentStore) => selector((currentStore.state ?? {}) as State),
        equals,
    );
}
