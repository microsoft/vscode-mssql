/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ReactDOM from 'react-dom/client';
import './index.css';
import { useVscodeWebview, VscodeWebViewProvider } from './common/vscodeWebViewProvider'
import { TableDesignerStateProvider } from './pages/TableDesigner/tableDesignerStateProvider';
import { TableDesigner } from './pages/TableDesigner/tableDesignerPage';
import { WebviewRoute } from '../sharedInterfaces/webviewRoutes';
import { ConnectionDialogStateProvider } from './pages/ConnectionDialog/connectionDialogStateProvider';
import { ConnectionPage } from './pages/ConnectionDialog/connectionPage';

const Router = () => {
	const vscodeWebviewState = useVscodeWebview<unknown, unknown>();
	if (!vscodeWebviewState) {
		return null;
	}
	const routes = vscodeWebviewState.route;

	switch (routes) {
		case WebviewRoute.tableDesigner:
			return (
				<TableDesignerStateProvider>
					<TableDesigner />
				</TableDesignerStateProvider>
			);
		case WebviewRoute.connectionDialog:
			return (
				<ConnectionDialogStateProvider>
					<ConnectionPage />
				</ConnectionDialogStateProvider>
			);
		default: (
			<div>Route not found</div>
		);
	}
};

ReactDOM.createRoot(document.getElementById('root')!).render(
	<VscodeWebViewProvider>
		<Router />
	</VscodeWebViewProvider>
)