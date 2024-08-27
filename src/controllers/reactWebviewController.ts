/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { WebviewRoute } from '../sharedInterfaces/webviewRoutes';
import { ReactWebviewBaseController } from './reactWebviewBaseController';

/**
 * ReactWebViewPanelController is a class that manages a vscode.WebviewPanel and provides
 * a way to communicate with it. It provides a way to register request handlers and reducers
 * that can be called from the webview. It also provides a way to post notifications to the webview.
 * @template State The type of the state object that the webview will use
 * @template Reducers The type of the reducers that the webview will use
 */
export class ReactWebViewPanelController<State, Reducers> extends ReactWebviewBaseController<State, Reducers> {
	private _panel: vscode.WebviewPanel;

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
		this._panel = vscode.window.createWebviewPanel(
			'mssql-react-webview',
			title,
			viewColumn,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.file(this._context.extensionPath)]
			}
		);

		this._panel.webview.html = this._getHtmlTemplate();
		this._panel.iconPath = this._iconPath;
		this.registerDisposable(this._panel.webview.onDidReceiveMessage(this._webviewMessageHandler));
		this._panel.onDidDispose(() => {
			this.dispose();
		});

		// This call sends messages to the Webview so it's called after the Webview creation.
		this.initializeBase();
	}

	protected _getWebview(): vscode.Webview {
		return this._panel.webview;
	}

	/**
	 * Gets the vscode.WebviewPanel that the controller is managing
	 */
	public get panel(): vscode.WebviewPanel {
		return this._panel;
	}

	/**
	 * Displays the webview in the foreground
	 * @param viewColumn The view column that the webview will be displayed in
	 */
	public revealToForeground(viewColumn: vscode.ViewColumn = vscode.ViewColumn.One): void {
		this._panel.reveal(viewColumn, true);
	}
}
