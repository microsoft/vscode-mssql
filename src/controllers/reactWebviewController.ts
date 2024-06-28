/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export class ReactWebViewPanelController<T> implements vscode.Disposable {
	private _panel: vscode.WebviewPanel;
	private _disposables: vscode.Disposable[] = [];
	private _isDisposed: boolean = false;
	private _state: T;
	private _webViewRequestHandlers: { [key: string]: (params: any) => any } = {};
	private _assetUri: vscode.Uri;
	private _reducers: { [key: string]: (state: T, payload: any) => ReducerResponse<T> } = {};

	constructor(
		private _context: vscode.ExtensionContext,
		title: string,
		private _srcFile: string,
		private _styleFile: string,
		viewColumn: vscode.ViewColumn = vscode.ViewColumn.One,
		initialData: T
	) {
		this._assetUri = vscode.Uri.joinPath(this._context.extensionUri, 'out', 'mssql-react-app');
		this._panel = vscode.window.createWebviewPanel(
			'mssql-react-app',
			title,
			viewColumn,
			{
				enableScripts: true,
			retainContextWhenHidden: true
			}
		);

		this._panel.webview.html = this._getHtmlTemplate(this._panel.webview);

		this._disposables.push(this._panel.webview.onDidReceiveMessage((message) => {
			if (message.type === 'request') {
				const handler = this._webViewRequestHandlers[message.method];
				if (handler) {
					const result = handler(message.params);
					this.postMessage({ type: 'response', id: message.id, result });
				} else {
					throw new Error(`No handler registered for method ${message.method}`);
				}
			}
		}));
		this._panel.onDidDispose(() => {
			this.dispose();
		});
		this.setupTheming();
		this._registerDefaultRequestHandlers();
		this.state =  initialData;
	}

	private setupTheming() {
		this._disposables.push(vscode.window.onDidChangeActiveColorTheme((theme) => {
			this.postNotification('onDidChangeTheme', theme.kind);
		}));
		this.postNotification('onDidChangeTheme', vscode.window.activeColorTheme.kind);
	}

	private _registerDefaultRequestHandlers() {
		this._webViewRequestHandlers['getState'] = () => {
			return this.state;
		};
		this._webViewRequestHandlers['getImageUrl'] = (path) => {
			return this.resourceUrl(path).toString();
		};
		this._webViewRequestHandlers['action'] = async (action) => {
			const reducer = this._reducers[action.type];
			if (reducer) {
				this.state =  await reducer(this.state, action.payload);
			}
			else {
				throw new Error(`No reducer registered for action ${action.type}`);
			}
		}
	}

	public registerRequestHandler(method: string, handler: (params: any) => any) {
		this._webViewRequestHandlers[method] = handler;
	}

	public registerReducer(method: string, reducer: (state: T, payload: any) => ReducerResponse<T>) {
		this._reducers[method] = reducer;
	}

	public registerReducers(reducers: { [key: string]: (state: T, payload: any) => ReducerResponse<T> }) {
		for (const key in reducers) {
			this.registerReducer(key, reducers[key]);
		}
	}

	private _getHtmlTemplate(webView: vscode.Webview) {
		const nonce = getNonce();
		const scriptUri = this.resourceUrl(['assets', this._srcFile]);
		const styleUri = this.resourceUrl(['assets', this._styleFile]);
		return `
		<!DOCTYPE html>
				<html lang="en">
				<head>
				  <meta charset="UTF-8">
				  <meta name="viewport" content="width=device-width, initial-scale=1.0">
				  <title>mssqlwebview</title>
				  <link rel="stylesheet" href="${styleUri}">
				  <style>
					html, body {
						margin: 0;
						padding: 0px;
  						width: 100%;
  						height: 100%;
					}
				  </style>
				</head>
				<body>
				  <div id="root"></div>
				  <script nonce="${nonce}" src="${scriptUri}"></script>
				</body>
				</html>
		`
	}

	public resourceUrl(path: string[]) {
		return this._panel.webview.asWebviewUri(vscode.Uri.joinPath(this._assetUri, ...path));
	}

	public get panel(): vscode.WebviewPanel {
		return this._panel;
	}

	public revealToForeground(viewColumn: vscode.ViewColumn = vscode.ViewColumn.One): void {
		this._panel.reveal(viewColumn, true);
	}

	public get state (): T {
		return this._state;
	}

	public set state (value: T) {
		this._state = value;
		this.postNotification(DefaultWebViewNotifications.updateState, value);
	}

	public get isDisposed(): boolean {
		return this._isDisposed;
	}

	public postNotification(method: string, params: any) {
		this.postMessage({ type: 'notification', method, params });
	}

	public postMessage(message: any) {
		this._panel.webview.postMessage(message);
	}

	dispose() {
		this._disposables.forEach(d => d.dispose());
		this._isDisposed = true;
	}
}

export enum DefaultWebViewNotifications {
	updateState = 'updateState',
}

export function getNonce(): string {
	let text: string = "";
	const possible: string =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

export type ReducerResponse<T> =  T | Promise<T>;