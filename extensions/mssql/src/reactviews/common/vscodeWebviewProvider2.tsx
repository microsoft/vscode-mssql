/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from "@vscode/l10n";

import { createContext, useCallback, useContext, useEffect, useRef } from "react";

import { FluentProvider } from "@fluentui/react-components";
import { useStore } from "zustand";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { createStore } from "zustand/vanilla";
import { LocConstants } from "./locConstants";
import { webviewTheme } from "./theme";
import {
    VscodeWebviewContext,
    VscodeWebviewContextProps,
    useVscodeWebview,
} from "./vscodeWebviewProvider";
import { WebviewRpc } from "./rpc";
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

interface VscodeWebviewStoreState<State> {
    state: State | undefined;
    themeKind: ColorThemeKind;
    keyBindings: WebviewKeyBindings;
    localization: boolean;
    localizationContents?: string;
    EOL: string;
    isBootstrapComplete: boolean;
}

interface VscodeWebviewStoreActions<State> {
    replaceState: (state: State) => void;
    setThemeKind: (themeKind: ColorThemeKind) => void;
    setKeyBindings: (keyBindings: WebviewKeyBindings) => void;
    setLocalization: (localization: boolean, localizationContents?: string) => void;
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
        localizationContents: undefined,
        EOL: getEOL(),
        isBootstrapComplete: false,
        replaceState: (state) => set({ state }),
        setThemeKind: (themeKind) => set({ themeKind }),
        setKeyBindings: (keyBindings) => set({ keyBindings }),
        setLocalization: (localization, localizationContents) =>
            set({ localization, localizationContents }),
        setEOL: (EOL) => set({ EOL }),
        setBootstrapComplete: (isBootstrapComplete) => set({ isBootstrapComplete }),
    }));
}

const vscodeApiInstance = vsCodeApiInstance.vscodeApiInstance;
const VscodeWebviewStoreContext = createContext<
    ReturnType<typeof createVscodeWebviewStore<any>> | undefined
>(undefined);

interface VscodeWebviewProvider2Props {
    children: React.ReactNode;
}

export function VscodeWebviewProvider2<State, Reducers>({ children }: VscodeWebviewProvider2Props) {
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
    const keyBindings = useStore(store, (currentStore) => currentStore.keyBindings);
    const localization = useStore(store, (currentStore) => currentStore.localization);
    const EOL = useStore(store, (currentStore) => currentStore.EOL);
    const isBootstrapComplete = useStore(store, (currentStore) => currentStore.isBootstrapComplete);

    const getSnapshot = useCallback(() => {
        return store.getState().state ?? ({} as State);
    }, [store]);

    const subscribe = useCallback(
        (listener: () => void) => {
            return store.subscribe((currentStore, previousStore) => {
                if (currentStore.state !== previousStore.state) {
                    listener();
                }
            });
        },
        [store],
    );

    useEffect(() => {
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
                            await new Promise((resolve) => setTimeout(resolve, 100));
                            LocConstants.createInstance();
                        }
                        store.getState().setLocalization(true, fileContents);
                    } catch (error) {
                        console.error("Localization bootstrap failed:", error);
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
                if (store.getState().state === undefined) {
                    store.getState().replaceState({} as State);
                }
                store.getState().setBootstrapComplete(true);
            }
        }

        void bootstrap();
    }, [extensionRpc, store]);

    const contextValue: VscodeWebviewContextProps<State, Reducers> = {
        vscodeApi,
        extensionRpc,
        getSnapshot,
        subscribe,
        themeKind,
        keyBindings,
        localization,
        EOL,
    };

    return (
        <VscodeWebviewStoreContext.Provider value={store}>
            <VscodeWebviewContext.Provider value={contextValue}>
                <FluentProvider
                    style={{
                        height: "100%",
                        width: "100%",
                    }}
                    theme={webviewTheme(themeKind)}>
                    {isBootstrapComplete && store.getState().state !== undefined && children}
                </FluentProvider>
            </VscodeWebviewContext.Provider>
        </VscodeWebviewStoreContext.Provider>
    );
}

export const useVscodeWebview2 = useVscodeWebview;

export function useVscodeWebviewSelector2<State, T>(
    selector: (state: State) => T,
    equals: (a: T, b: T) => boolean = Object.is,
) {
    const store = useContext(VscodeWebviewStoreContext) as
        | ReturnType<typeof createVscodeWebviewStore<State>>
        | undefined;

    if (!store) {
        throw new Error("useVscodeWebviewSelector2 must be used within a VscodeWebviewProvider2");
    }

    return useStoreWithEqualityFn(
        store,
        (currentStore) => selector((currentStore.state ?? {}) as State),
        equals,
    );
}
