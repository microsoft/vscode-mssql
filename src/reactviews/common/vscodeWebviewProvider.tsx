/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from "@vscode/l10n";

import { createContext, useContext, useEffect, useState } from "react";

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
import { vsCodeApiInstance } from "./acquireVsCodeApi";

/**
 * Context for vscode webview functionality like theming, state management, rpc and vscode api.
 * @template State interface that contains definitions for all state properties.
 * @template Reducers interface that contains definitions for all reducers and their payloads.
 */
export interface VscodeWebviewContext<State, Reducers> {
    /**
     * The vscode api instance.
     */
    vscodeApi: WebviewApi<unknown>;
    /**
     * Rpc to communicate with the extension.
     */
    extensionRpc: WebviewRpc<Reducers>;
    /**
     * State of the webview.
     */
    state: State;
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

const vscodeApiInstance = vsCodeApiInstance.vscodeApiInstance;

const VscodeWebviewContext = createContext<VscodeWebviewContext<unknown, unknown> | undefined>(
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
    const [theme, setTheme] = useState(ColorThemeKind.Light);
    const [state, setState] = useState<State>();
    const [localization, setLocalization] = useState<boolean>(false);
    const [EOL, setEOL] = useState<string>(getEOL());

    useEffect(() => {
        async function getTheme() {
            const theme = await extensionRpc.sendRequest(GetThemeRequest.type);
            setTheme(theme);
        }

        async function getState() {
            const state = await extensionRpc.sendRequest(GetStateRequest.type<State>());
            setState(state);
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
        setState(params);
    });

    function isInitialized(): boolean {
        return state !== undefined;
    }

    return (
        <VscodeWebviewContext.Provider
            value={{
                vscodeApi: vscodeApi,
                extensionRpc: extensionRpc,
                state: state,
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
        </VscodeWebviewContext.Provider>
    );
}

export function useVscodeWebview<State, Reducers>() {
    const context = useContext(VscodeWebviewContext);
    if (!context) {
        throw new Error("useVscodeWebview must be used within a VscodeWebviewProvider");
    }
    return context as VscodeWebviewContext<State, Reducers>;
}
