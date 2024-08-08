/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FluentProvider, Theme, teamsHighContrastTheme, webDarkTheme, webLightTheme } from "@fluentui/react-components";
import { createContext, useContext, useEffect, useState } from "react";
import { WebviewApi } from "vscode-webview";
import { WebviewRpc } from "./rpc";
import { getCustomColor } from "./vscodeToFluentTheme";

/**
 * Context for vscode webview functionality like theming, state management, rpc and vscode api.
 * @template State interface that contains definitions for all state properties.
 * @template Reducers interface that contains definitions for all reducers and their payloads.
 */
interface VscodeWebviewContext<State, Reducers> {
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
}

const vscodeApiInstance = acquireVsCodeApi<unknown>();

const VscodeWebviewContext = createContext<VscodeWebviewContext<unknown, unknown> | undefined>(undefined);

interface VscodeWebViewProviderProps {
	children: React.ReactNode;
}

/**
 * Provider for essential vscode webview functionality like
 * theming, state management, rpc and vscode api.
 * @param param0 child components
 */
export function VscodeWebViewProvider<State, Reducers>({ children }: VscodeWebViewProviderProps) {
	const vscodeApi = vscodeApiInstance;
	const extensionRpc = new WebviewRpc<Reducers>(vscodeApi);
	const [theme, setTheme] = useState(webLightTheme);
	const [state, setState] = useState<State>();

	function updateTheme(kind: ColorThemeKind) {
		let theme;
		switch (kind) {
			case ColorThemeKind.Dark:
				theme = webDarkTheme;
				break;
			case ColorThemeKind.HighContrast:
				theme = teamsHighContrastTheme;
				break;
			default:
				theme = webLightTheme;
				break;
		}
		setTheme({
			...theme,
			...getCustomColor(kind)
		});
	}

	useEffect(() => {
		async function getTheme() {
			const kind = await extensionRpc.call('getTheme');
			updateTheme(kind as ColorThemeKind);
		}
		getTheme();
	});

	extensionRpc.subscribe('onDidChangeTheme', (params) => {
		updateTheme(params as ColorThemeKind);
	});

	extensionRpc.subscribe('updateState', (params) => {
		setState(params as State);
	});

	return <VscodeWebviewContext.Provider value={{
		vscodeApi: vscodeApi,
		extensionRpc: extensionRpc,
		state: state,
		theme: theme
	}}>
		<FluentProvider style={{
			height: '100%',
			width: '100%',
		}} theme={theme}>
			{children}
		</FluentProvider>
	</VscodeWebviewContext.Provider>;
}

export function useVscodeWebview<State, Reducers>() {
	const context = useContext(VscodeWebviewContext);
	if (!context) {
		throw new Error('useVscodeWebview must be used within a VscodeWebviewProvider');
	}
	return context as VscodeWebviewContext<State, Reducers>;
}

export enum ColorThemeKind {
	Light = 1,
	Dark = 2,
	HighContrast = 3,
	HighContrastLight = 4
}