/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FluentProvider, Theme, teamsHighContrastTheme, webDarkTheme, webLightTheme } from "@fluentui/react-components";
import { createContext, useState } from "react";
import { WebviewApi } from "vscode-webview";
import { WebviewRpc } from "./rpc";

interface VscodeWebviewContext {
	vscodeApi: WebviewApi<unknown>;
	extensionRpc: WebviewRpc;
	state: unknown;
	theme: Theme;
}

const vscodeApiInstance = acquireVsCodeApi<unknown>();

const VscodeWebviewContext = createContext<VscodeWebviewContext | undefined>(undefined);

interface VscodeWebViewProviderProps {
	children: React.ReactNode;
}

const VscodeWebViewProvider: React.FC<VscodeWebViewProviderProps> = ({ children }) => {
	const vscodeApi = vscodeApiInstance;
	const extensionRpc = new WebviewRpc(vscodeApi);
	const [theme, setTheme] = useState(webLightTheme);
	const [state, setState] = useState<unknown>();

	extensionRpc.subscribe('onDidChangeTheme', (params) => {
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
	});

	extensionRpc.subscribe('updateState', (params) => {
		setState(params);
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
			color: 'var(--vscode-foreground)',
		}} theme={theme}>
			{children}
		</FluentProvider>
	</VscodeWebviewContext.Provider>;
}

export { VscodeWebviewContext, VscodeWebViewProvider };
export enum ColorThemeKind {
	Light = 1,
	Dark = 2,
	HighContrast = 3,
	HighContrastLight = 4
}