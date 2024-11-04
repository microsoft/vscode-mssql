/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    FluentProvider,
    Theme,
    teamsHighContrastTheme,
    webDarkTheme,
    webLightTheme,
} from "@fluentui/react-components";
import { createContext, useContext, useEffect, useState } from "react";
import { WebviewApi } from "vscode-webview";
import { WebviewRpc } from "./rpc";
import * as l10n from "@vscode/l10n";
import { LocConstants } from "./locConstants";

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
    theme: Theme;
    /**
     * Localization status. The value is true when the localization file content is received from the extension.
     * This is used to force a re-render of the component when the localization file content is received.
     */
    localization: boolean;
}

const vscodeApiInstance = acquireVsCodeApi<unknown>();

const VscodeWebviewContext = createContext<
    VscodeWebviewContext<unknown, unknown> | undefined
>(undefined);

interface VscodeWebviewProviderProps {
    children: React.ReactNode;
}

/**
 * Provider for essential vscode webview functionality like
 * theming, state management, rpc and vscode api.
 * @param param0 child components
 */
export function VscodeWebviewProvider<State, Reducers>({
    children,
}: VscodeWebviewProviderProps) {
    const vscodeApi = vscodeApiInstance;
    const extensionRpc = WebviewRpc.getInstance<Reducers>(vscodeApi);
    const [theme, setTheme] = useState(webLightTheme);
    const [state, setState] = useState<State>();
    const [localization, setLocalization] = useState<boolean>(false);

    useEffect(() => {
        async function getTheme() {
            const theme = await extensionRpc.call("getTheme");
            switch (theme) {
                case ColorThemeKind.Dark:
                    setTheme(webDarkTheme);
                    break;
                case ColorThemeKind.HighContrast:
                    setTheme(teamsHighContrastTheme);
                    break;
                default:
                    setTheme(webLightTheme);
                    break;
            }
        }

        async function getState() {
            const state = await extensionRpc.call("getState");
            setState(state as State);
        }

        async function loadStats() {
            await extensionRpc.call("loadStats", {
                loadCompleteTimeStamp: Date.now(),
            });
        }

        async function getLocalization() {
            const fileContents = (await extensionRpc.call(
                "getLocalization",
            )) as string;
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

        void getTheme();
        void getState();
        void loadStats();
        void getLocalization();
    }, []);

    extensionRpc.subscribe(
        "vscodeWebviewProvider",
        "onDidChangeTheme",
        (params) => {
            const kind = params as ColorThemeKind;
            switch (kind) {
                case ColorThemeKind.Dark:
                    setTheme(webDarkTheme);
                    break;
                case ColorThemeKind.HighContrast:
                    setTheme(teamsHighContrastTheme);
                    break;
                default:
                    setTheme(webLightTheme);
                    break;
            }
        },
    );

    extensionRpc.subscribe("vscodeWebviewProvider", "updateState", (params) => {
        setState(params as State);
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
                theme: theme,
                localization: localization,
            }}
        >
            <FluentProvider
                style={{
                    height: "100%",
                    width: "100%",
                    color: "var(--vscode-foreground)",
                }}
                theme={theme}
            >
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
        throw new Error(
            "useVscodeWebview must be used within a VscodeWebviewProvider",
        );
    }
    return context as VscodeWebviewContext<State, Reducers>;
}

export enum ColorThemeKind {
    Light = 1,
    Dark = 2,
    HighContrast = 3,
    HighContrastLight = 4,
}
