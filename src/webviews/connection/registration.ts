import { ViewColumn } from 'vscode';
import { Commands } from '../../constants';
import type { WebviewsController } from '../webviewsController';
import type { State } from './protocol';

export function registerConnectionWebviewPanel(controller: WebviewsController) {
	return controller.registerWebviewPanel<State>(
		{ id: Commands.ShowConnectionManager },
		{
			id: 'mssql.connection',
			fileName: 'apps/connection/connection.html',
			iconPath: 'images/sqlserver.png',
			title: 'SQL Server Connection Manager',
			contextKeyPrefix: `mssql:webview:connection`,
			// trackingFeature: 'welcomeWebview',
			plusFeature: false,
			column: ViewColumn.Active,
			webviewHostOptions: {
				retainContextWhenHidden: false,
				enableFindWidget: true,
			},
		},
		async (container, host) => {
			const { ConnectionWebviewProvider } = await import(
				/* webpackChunkName: "webview-connection" */ './connectionWebview'
			);
			return new ConnectionWebviewProvider(container, host);
		},
	);
}
