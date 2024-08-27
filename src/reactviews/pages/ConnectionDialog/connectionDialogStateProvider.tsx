/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext } from "react";
import { useVscodeWebview } from "../../common/vscodeWebViewProvider";
import { ConnectionDialogContextProps, ConnectionDialogReducers, ConnectionDialogWebviewState, FormTabType, IConnectionDialogProfile } from "../../../sharedInterfaces/connectionDialog";

const ConnectionDialogContext = createContext<ConnectionDialogContextProps | undefined>(undefined);

interface ConnectionDialogProviderProps {
	children: React.ReactNode;
}

const ConnectionDialogStateProvider: React.FC<ConnectionDialogProviderProps> = ({ children }) => {
	const webViewState = useVscodeWebview<ConnectionDialogWebviewState, ConnectionDialogReducers>();
	const connectionDialogState = webViewState?.state;
	return <ConnectionDialogContext.Provider value={
		{
			state: connectionDialogState,
			theme: webViewState?.theme,
			loadConnection: function (connection: IConnectionDialogProfile): void {
				webViewState?.extensionRpc.action('loadConnection', {
					connection: connection,
				});
			},
			formAction: function (event): void {
				webViewState?.extensionRpc.action('formAction', {
					event: event
				});
			},
			setFormTab: function (tab: FormTabType): void {
				webViewState?.extensionRpc.action('setFormTab', {
					tab: tab
				});
			},
			connect: function (): void {
				webViewState?.extensionRpc.action('connect');
			},
		}
	}>{children}</ConnectionDialogContext.Provider>;
};

export { ConnectionDialogContext, ConnectionDialogStateProvider };