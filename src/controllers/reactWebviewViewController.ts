/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { WebviewRoute } from '../sharedInterfaces/webviewRoutes';
import { ReactWebviewBaseController } from './reactWebviewBaseController';

/**
 * ReactWebViewViewController is a class that manages a vscode.WebviewView and provides
 * a way to communicate with it. It provides a way to register request handlers and reducers
 * that can be called from the webview. It also provides a way to post notifications to the webview.
 * @template State The type of the state object that the webview will use
 * @template Reducers The type of the reducers that the webview will use
 */
export class ReactWebViewViewController<State, Reducers> extends ReactWebviewBaseController<State, Reducers> implements vscode.WebviewViewProvider{
	private _webviewView: vscode.WebviewView;

	/**
	 * Creates a new ReactWebViewPanelController
	 * @param _context The context of the extension
	 * @param title The title of the webview panel
	 * @param _route The route that the webview will use
	 * @param initialData The initial state object that the webview will use
	 * @param viewColumn The view column that the webview will be displayed in
	 * @param _iconPath The icon path that the webview will use
	 */
	constructor(
		_context: vscode.ExtensionContext,
		title: string,
		_route: WebviewRoute,
		initialData: State,
		viewColumn: vscode.ViewColumn = vscode.ViewColumn.One,
		private _iconPath?: vscode.Uri | {
			readonly light: vscode.Uri;
			readonly dark: vscode.Uri;
		}
	) {
		super(_context, _route, initialData);
	}


	protected _getWebview(): vscode.Webview {
		return this._webviewView.webview;
	}

	/**
	 * Displays the webview in the foreground
	 * @param viewColumn The view column that the webview will be displayed in
	 */
	public revealToForeground(viewColumn: vscode.ViewColumn = vscode.ViewColumn.One): void {

	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._webviewView = webviewView;

		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,

			localResourceRoots: [
				this._context.extensionUri
			]
		};
		this._webviewView.onDidDispose(() => {
			this.dispose();
		});

		this._webviewView.webview.html = this._getHtmlTemplate();
		this.registerDisposable(this._webviewView.webview.onDidReceiveMessage(this._webviewMessageHandler));
		this.initializeBase();
	}
}
