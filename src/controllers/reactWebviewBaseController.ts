/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { WebviewRoute } from '../sharedInterfaces/webviewRoutes';
import { getNonce } from '../utils/utils';

/**
 * ReactWebviewBaseController is a class that manages a vscode.Webview and provides
 * a way to communicate with it. It provides a way to register request handlers and reducers
 * that can be called from the webview. It also provides a way to post notifications to the webview.
 * @template State The type of the state object that the webview will use
 * @template Reducers The type of the reducers that the webview will use
 */
export abstract class ReactWebviewBaseController<State, Reducers> implements vscode.Disposable {
	private _disposables: vscode.Disposable[] = [];
	private _isDisposed: boolean = false;
	private _state: State;
	private _webViewRequestHandlers: { [key: string]: (params: any) => any } = {};
	private _reducers: Record<keyof Reducers, (state: State, payload: Reducers[keyof Reducers]) => ReducerResponse<State>> = {} as Record<keyof Reducers, (state: State, payload: Reducers[keyof Reducers]) => ReducerResponse<State>>;
	private _isFirstLoad: boolean = true;
	private _loadStartTime: number = Date.now();
	private _onDisposed: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
	public readonly onDisposed: vscode.Event<void> = this._onDisposed.event;
	protected _webviewMessageHandler = (message) => {
		if (message.type === 'request') {
			const handler = this._webViewRequestHandlers[message.method];
			if (handler) {
				const result = handler(message.params);
				this.postMessage({ type: 'response', id: message.id, result });
			} else {
				throw new Error(`No handler registered for method ${message.method}`);
			}
		}
	};

	/**
	 * Creates a new ReactWebViewPanelController
	 * @param _context The context of the extension
	 * @param title The title of the webview panel
	 * @param _route The route that the webview will use
	 * @param _initialData The initial state object that the webview will use
	 */
	constructor(
		protected _context: vscode.ExtensionContext,
		private _route: WebviewRoute,
		private _initialData: State,
	) {
	}

	protected initializeBase() {
		this.state = this._initialData;
		this._registerDefaultRequestHandlers();
		this.setupTheming();
	}

	protected registerDisposable(disposable: vscode.Disposable) {
		this._disposables.push(disposable);
	}

	protected _getHtmlTemplate() {
		const nonce = getNonce();
		const scriptUri = this.resourceUrl(['mssqlwebview.js']);
		const styleUri = this.resourceUrl(['mssqlwebview.css']);
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
				  <script>
				 	const assetPathVscodeUri = "${this.resourceUrl(['']).toString()}";
				  </script>
				  <script nonce="${nonce}" src="${scriptUri}"></script>
				</body>
				</html>
		`;
	}

	protected abstract _getWebview(): vscode.Webview;

	protected setupTheming() {
		this._disposables.push(vscode.window.onDidChangeActiveColorTheme((theme) => {
			this.postNotification(DefaultWebViewNotifications.onDidChangeTheme, theme.kind);
		}));
		this.postNotification(DefaultWebViewNotifications.onDidChangeTheme, vscode.window.activeColorTheme.kind);
	}

	private _registerDefaultRequestHandlers() {
		this._webViewRequestHandlers['getState'] = () => {
			return this.state;
		};
		this._webViewRequestHandlers['action'] = async (action) => {
			const reducer = this._reducers[action.type];
			if (reducer) {
				this.state = await reducer(this.state, action.payload);
			}
			else {
				throw new Error(`No reducer registered for action ${action.type}`);
			}
		};
		this._webViewRequestHandlers['getTheme'] = () => {
			return vscode.window.activeColorTheme.kind;
		};
		this._webViewRequestHandlers['getRoute'] = () => {
			return this._route;
		};
		this._webViewRequestHandlers['loadStats'] = (message) => {
			const timeStamp = message.loadCompleteTimeStamp;
			const timeToLoad = timeStamp - this._loadStartTime;
			if (this._isFirstLoad) {
				console.log(`
					Load stats for ${this._route}
					Total time: ${timeToLoad} ms
				`);
				this._isFirstLoad = false;
			}
		};
		this._webViewRequestHandlers['getUri'] = async (path: string) => {
			path = path.replace('./', '');
			const result =  this.resourceUrl([path]).toString();
			return result;
		};
	}

	private resourceUrl(path: string[]) {
		return this._getWebview().asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'out', 'src', 'reactviews', 'assets', ...path));
	}

	/**
	 * Register a request handler that the webview can call and get a response from.
	 * @param method The method name that the webview will use to call the handler
	 * @param handler The handler that will be called when the method is called
	 */
	public registerRequestHandler(method: string, handler: (params: any) => any) {
		this._webViewRequestHandlers[method] = handler;
	}

	/**
	 * Reducers are methods that can be called from the webview to modify the state of the webview.
	 * This method registers a reducer that can be called from the webview.
	 * @param method The method name that the webview will use to call the reducer
	 * @param reducer The reducer that will be called when the method is called
	 * @template Method The key of the reducer that is being registered
	 */
	public registerReducer<Method extends keyof Reducers>(method: Method, reducer: (state: State, payload: Reducers[Method]) => ReducerResponse<State>) {
		this._reducers[method] = reducer;
	}

	/**
	 * Gets the state object that the webview is using
	 */
	public get state(): State {
		return this._state;
	}

	/**
	 * Sets the state object that the webview is using. This will update the state in the webview
	 * and may cause the webview to re-render.
	 * @param value The new state object
	 */
	public set state(value: State) {
		this._state = value;
		this.postNotification(DefaultWebViewNotifications.updateState, value);
	}

	/**
	 * Gets whether the controller has been disposed
	 */
	public get isDisposed(): boolean {
		return this._isDisposed;
	}

	/**
	 * Posts a notification to the webview
	 * @param method The method name that the webview will use to handle the notification
	 * @param params The parameters that will be passed to the method
	 */
	public postNotification(method: string, params: any) {
		this.postMessage({ type: 'notification', method, params });
	}

	/**
	 * Posts a message to the webview
	 * @param message The message to post to the webview
	 */
	public postMessage(message: any) {
		if (!this._isDisposed) {
			this._getWebview().postMessage(message);
		}
	}

	/**
	 * Disposes the controller
	 */
	public dispose() {
		this._onDisposed.fire();
		this._disposables.forEach(d => d.dispose());
		this._isDisposed = true;
	}
}

export enum DefaultWebViewNotifications {
	updateState = 'updateState',
	onDidChangeTheme = 'onDidChangeTheme'
}

export type ReducerResponse<T> = T | Promise<T>;