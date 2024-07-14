/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useContext } from "react";
import { VscodeWebviewContext } from "../../common/vscodeWebViewProvider";
import { ConnectionDialogContextProps, ConnectionDialogWebviewState, FormTabs, IConnectionDialogProfile } from "../../../sharedInterfaces/connectionDialog";

const ConnectionDialogContext = createContext<ConnectionDialogContextProps | undefined>(undefined);

interface ConnectionDialogProviderProps {
	children: React.ReactNode;
}

const ConnectionDialogStateProvider: React.FC<ConnectionDialogProviderProps> = ({ children }) => {
	const webViewState = useContext(VscodeWebviewContext);
	const connectionDialogState = webViewState?.state as ConnectionDialogWebviewState;
	return <ConnectionDialogContext.Provider value={
		{
			state: connectionDialogState,
			loadConnection: function (connection: IConnectionDialogProfile): void {
				webViewState?.extensionRpc.action('loadConnection', {
					connection: connection
				 });
			},
			formAction: function (event): void {
				webViewState?.extensionRpc.action('formAction', {
					event: event
				});
			},
			setFormTab: function (tab: FormTabs): void {
				webViewState?.extensionRpc.action('setFormTab', {
					tab: tab
				});
			},
			connect: function (): void {
				webViewState?.extensionRpc.action('connect', {});
			}
		}
	}>{children}</ConnectionDialogContext.Provider>;
};

export { ConnectionDialogContext, ConnectionDialogStateProvider };