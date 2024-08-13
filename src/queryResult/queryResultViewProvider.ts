/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export class QueryResultViewProvider implements vscode.WebviewViewProvider {

	public static readonly viewType = 'queryResult';

	private _view?: vscode.WebviewView;

	constructor(
		private readonly _extensionUri: vscode.Uri,
	) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,

			localResourceRoots: [
				this._extensionUri
			]
		};

		// hello world html

		webviewView.webview.html = "<h1>Hello World</h1>";

		webviewView.webview.onDidReceiveMessage(data => {
			console.log('received message from webview:', data);
		});
	}

	public show() {
		this._view?.show();
	}

}
