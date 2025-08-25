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
    GetLocalizationRequest,
    GetStateRequest,
    GetThemeRequest,
    LoadStatsNotification,
    StateChangeNotification,
} from "../../sharedInterfaces/webview";
import { getEOL } from "./utils";
import { VscodeApiSingleton } from "./acquireVsCodeApi";

/**
 * Context for vscode webview functionality like theming, state management, rpc and vscode api.
 * @template State interface that contains definitions for all state properties.
 * @template Reducers interface that contains definitions for all reducers and their payloads.
 */
export interface IVscodeWebviewContext2<State, Reducers> {
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
     * Localization status. The value is true when the localization file content is received from the extension.
     * This is used to force a re-render of the component when the localization file content is received.
     */
    localization: boolean;
    /**
     * OS specific end of line character.
     */
    EOL: string;
}

const vscodeApiInstance = VscodeApiSingleton.getInstance().vscodeApiInstance;

export const VscodeWebviewContext2 = createContext<
    IVscodeWebviewContext2<unknown, unknown> | undefined
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
    const [localization, setLocalization] = useState<boolean>(false);
    const [EOL, setEOL] = useState<string>(getEOL());

    const stateRef = useRef<State | undefined>(undefined);
    const listenersRef = useRef(new Set<() => void>());

    const getSnapshot = useCallback(() => stateRef.current as State, []);
    const subscribe = useCallback((listener: () => void) => {
        listenersRef.current.add(listener);
        return () => {
            listenersRef.current.delete(listener);
        };
    }, []);
    const emit = () => {
        listenersRef.current.forEach((fn) => fn());
    };

    // Bootstrap
    useEffect(() => {
        async function getTheme() {
            const theme = await extensionRpc.sendRequest(GetThemeRequest.type);
            setTheme(theme);
        }

        async function getState() {
            const initial = await extensionRpc.sendRequest(GetStateRequest.type<State>());
            stateRef.current = initial;
            emit();
        }

        async function loadStats() {
            await extensionRpc.sendNotification(LoadStatsNotification.type, {
                loadCompleteTimeStamp: Date.now(),
            });
        }

        async function getLocalization() {
            const fileContents = await extensionRpc.sendRequest(GetLocalizationRequest.type);
            if (fileContents) {
                await l10n.config({
                    contents: fileContents,
                });
                //delay 100ms to make sure the l10n is initialized before the component is rendered
                await new Promise((resolve) => setTimeout(resolve, 1000));
                LocConstants.createInstance();
            }
            /**
             * This is a hack to force a re-render of the component when the localization filecontent
             * is received from the extension.
             */
            setLocalization(true);
        }

        async function getEOL() {
            const eol = await extensionRpc.sendRequest(GetEOLRequest.type);
            setEOL(eol);
        }

        void getTheme();
        void getState();
        void loadStats();
        void getLocalization();
        void getEOL();
    }, []);

    extensionRpc.onNotification(ColorThemeChangeNotification.type, (params) => {
        setTheme(params as ColorThemeKind);
    });

    extensionRpc.onNotification<State>(StateChangeNotification.type<State>(), (params) => {
        stateRef.current = params;
        emit();
    });

    function isInitialized(): boolean {
        return stateRef.current !== undefined;
    }

    return (
        <VscodeWebviewContext2.Provider
            value={{
                vscodeApi: vscodeApi,
                extensionRpc: extensionRpc,
                getSnapshot,
                subscribe,
                themeKind: theme,
                localization: localization,
                EOL: EOL,
            }}>
            <FluentProvider
                style={{
                    height: "100%",
                    width: "100%",
                }}
                theme={webviewTheme(theme)}>
                {
                    // don't render webview unless necessary dependencies are initialized
                    isInitialized() && children
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
    return context as IVscodeWebviewContext2<State, Reducers>;
}
