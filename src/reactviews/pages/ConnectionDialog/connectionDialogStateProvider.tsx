/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useContext } from "react";
import * as vscodeMssql from 'vscode-mssql';
import { VscodeWebviewContext } from "../../common/vscodeWebViewProvider";

const ConnectionDialogContext = createContext<vscodeMssql.ConnectionDialog.ConnectionDialogContextProps | undefined>(undefined);

interface ConnectionDialogContextProps {
	children: React.ReactNode;
}
export enum FormTabs {
	Parameters = 'parameter',
	ConnectionString = 'connString'
}

const ConnectionDialogStateProvider: React.FC<ConnectionDialogContextProps> = ({ children }) => {
	const webViewState = useContext(VscodeWebviewContext);
	const connectionDialogState = webViewState?.state as vscodeMssql.ConnectionDialog.ConnectionDialogWebviewState;
	return <ConnectionDialogContext.Provider value={
		{
			state: connectionDialogState,
			updateConnection: function (connection: vscodeMssql.ConnectionDialog.ConnectionInfo): void {
				webViewState?.extensionRpc.action('loadConnection', {
					connection: connection
				 });
			},
			setFormTab: function (tab: FormTabs): void {
				webViewState?.extensionRpc.action('setFormTab', {
					tab: tab
				});
			}
		}
	}>{children}</ConnectionDialogContext.Provider>;
};

export { ConnectionDialogContext, ConnectionDialogStateProvider };