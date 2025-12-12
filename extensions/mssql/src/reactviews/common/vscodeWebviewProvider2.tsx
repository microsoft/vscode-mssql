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
export interface VscodeWebviewContext2Props<State, Reducers> {
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

export const VscodeWebviewContext2 = createContext<
    VscodeWebviewContext2Props<unknown, unknown> | undefined
>(undefined);

interface VscodeWebviewProvider2Props {
    children: React.ReactNode;
}

/**
 * Provider for essential vscode webview functionality like
 * theming, state management, rpc and vscode api.
 * @param param0 child components
 */
export function VscodeWebviewProvider2<State, Reducers>({ children }: VscodeWebviewProvider2Props) {
    const vscodeApi = vscodeApiInstance;
    const extensionRpc = WebviewRpc.getInstance<Reducers>(vscodeApi);

    const [theme, setTheme] = useState(ColorThemeKind.Light);
    const [keyBindings, setKeyBindings] = useState<WebviewKeyBindings>({} as WebviewKeyBindings);
    const [localization, setLocalization] = useState<boolean>(false);
    const [EOL, setEOL] = useState<string>(getEOL());

    const stateRef = useRef<State | undefined>(undefined);
    const emptyStateRef = useRef({} as State);
    const listenersRef = useRef(new Set<() => void>());
    const [isInitialized, setIsInitialized] = useState(false);

    const getSnapshot = useCallback(() => {
        // Return a safe default while not initialized to prevent useSyncExternalStore from erroring
        return stateRef.current ?? emptyStateRef.current;
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
            emit();
        });

        async function bootstrap() {
            try {
                // Coordinate all initialization operations
                const [theme, keyboardShortcuts, initialState, eol, fileContents] =
                    await Promise.all([
                        extensionRpc.sendRequest(GetThemeRequest.type),
                        extensionRpc.sendRequest(GetKeyBindingsConfigRequest.type),
                        extensionRpc.sendRequest(GetStateRequest.type<State>()),
                        extensionRpc.sendRequest(GetEOLRequest.type),
                        extensionRpc.sendRequest(GetLocalizationRequest.type),
                    ]);

                // Set state atomically
                setTheme(theme);
                setKeyBindings(parseWebviewKeyboardShortcutConfig(keyboardShortcuts));
                stateRef.current = initialState;
                setEOL(eol);

                // Handle localization if available
                if (fileContents) {
                    await l10n.config({
                        contents: fileContents,
                    });
                    // Brief delay to ensure l10n is properly initialized
                    await new Promise((resolve) => setTimeout(resolve, 100));
                    LocConstants.createInstance();
                }
                setLocalization(true);

                // Send load stats notification
                await extensionRpc.sendNotification(LoadStatsNotification.type, {
                    loadCompleteTimeStamp: Date.now(),
                });

                // Mark as initialized and emit state change
                setIsInitialized(true);
                emit();
            } catch (error) {
                console.error("Bootstrap failed:", error);
                // Still mark as initialized to prevent infinite loading
                setIsInitialized(true);
            }
        }

        void bootstrap();
    }, []);

    return (
        <VscodeWebviewContext2.Provider
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
                    // don't render webview unless initialization is complete and state is available
                    isInitialized && stateRef.current !== undefined && children
                }
            </FluentProvider>
        </VscodeWebviewContext2.Provider>
    );
}

export function useVscodeWebview2<State, Reducers>() {
    const context = useContext(VscodeWebviewContext2);
    if (!context) {
        throw new Error("useVscodeWebview2 must be used within a VscodeWebviewProvider2");
    }
    return context as VscodeWebviewContext2Props<State, Reducers>;
}
