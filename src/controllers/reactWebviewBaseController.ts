/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import {
    ActivityStatus,
    TelemetryActions,
    TelemetryViews,
} from "../sharedInterfaces/telemetry";
import {
    WebviewTelemetryActionEvent,
    WebviewTelemetryErrorEvent,
} from "../sharedInterfaces/webview";
import {
    sendActionEvent,
    sendErrorEvent,
    startActivity,
} from "../telemetry/telemetry";

import { getNonce } from "../utils/utils";

/**
 * ReactWebviewBaseController is a class that manages a vscode.Webview and provides
 * a way to communicate with it. It provides a way to register request handlers and reducers
 * that can be called from the webview. It also provides a way to post notifications to the webview.
 * @template State The type of the state object that the webview will use
 * @template Reducers The type of the reducers that the webview will use
 */
export abstract class ReactWebviewBaseController<State, Reducers>
    implements vscode.Disposable
{
    private _disposables: vscode.Disposable[] = [];
    private _isDisposed: boolean = false;
    private _state: State;
    private _webviewRequestHandlers: { [key: string]: (params: any) => any } =
        {};
    private _reducers: Record<
        keyof Reducers,
        (
            state: State,
            payload: Reducers[keyof Reducers],
        ) => ReducerResponse<State>
    > = {} as Record<
        keyof Reducers,
        (
            state: State,
            payload: Reducers[keyof Reducers],
        ) => ReducerResponse<State>
    >;
    private _isFirstLoad: boolean = true;
    private _loadStartTime: number = Date.now();
    private _endLoadActivity = startActivity(
        TelemetryViews.WebviewController,
        TelemetryActions.Load,
    );
    private _onDisposed: vscode.EventEmitter<void> =
        new vscode.EventEmitter<void>();
    public readonly onDisposed: vscode.Event<void> = this._onDisposed.event;
    protected _webviewMessageHandler = async (message) => {
        if (message.type === "request") {
            const endActivity = startActivity(
                TelemetryViews.WebviewController,
                TelemetryActions.WebviewRequest,
            );
            const handler = this._webviewRequestHandlers[message.method];
            if (handler) {
                try {
                    const result = await handler(message.params);
                    this.postMessage({
                        type: "response",
                        id: message.id,
                        result,
                    });
                    endActivity.end(ActivityStatus.Succeeded, {
                        type: this._sourceFile,
                        method: message.method,
                        reducer:
                            message.method === "action"
                                ? message.params.type
                                : undefined,
                    });
                } catch (error) {
                    endActivity.endFailed(
                        error,
                        false,
                        "RequestHandlerFailed",
                        "RequestHandlerFailed",
                        {
                            type: this._sourceFile,
                            method: message.method,
                            reducer:
                                message.method === "action"
                                    ? message.params.type
                                    : undefined,
                        },
                    );
                    throw error;
                }
            } else {
                const error = new Error(
                    `No handler registered for method ${message.method}`,
                );
                endActivity.endFailed(
                    error,
                    true,
                    "NoHandlerRegistered",
                    "NoHandlerRegistered",
                    {
                        type: this._sourceFile,
                        method: message.method,
                    },
                );
                throw error;
            }
        }
    };

    /**
     * Creates a new ReactWebviewPanelController
     * @param _context The context of the extension
     * @param _sourceFile The source file that the webview will use
     * @param _initialData The initial state object that the webview will use
     */
    constructor(
        protected _context: vscode.ExtensionContext,
        private _sourceFile: string,
        private _initialData: State,
    ) {}

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

        const baseUrl = this._getWebview().asWebviewUri(
            vscode.Uri.joinPath(
                this._context.extensionUri,
                "out",
                "src",
                "reactviews",
                "assets",
            ),
        );
        const baseUrlString = baseUrl.toString() + "/";

        return `
		<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="UTF-8">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					<title>mssqlwebview</title>
					<base href="${baseUrlString}"> <!-- Required for loading relative resources in the webview -->
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
					<link rel="stylesheet" href="${this._sourceFile}.css">
					<div id="root"></div>
				  	<script type="module" nonce="${nonce}" src="${this._sourceFile}.js"></script> <!-- since our bundles are in esm format we need to use type="module" -->
				</body>
			</html>
		`;
    }

    protected abstract _getWebview(): vscode.Webview;

    protected setupTheming() {
        this._disposables.push(
            vscode.window.onDidChangeActiveColorTheme((theme) => {
                this.postNotification(
                    DefaultWebviewNotifications.onDidChangeTheme,
                    theme.kind,
                );
            }),
        );
        this.postNotification(
            DefaultWebviewNotifications.onDidChangeTheme,
            vscode.window.activeColorTheme.kind,
        );
    }

    private _registerDefaultRequestHandlers() {
        this._webviewRequestHandlers["getState"] = () => {
            return this.state;
        };

        this._webviewRequestHandlers["action"] = async (action) => {
            const reducer = this._reducers[action.type];
            if (reducer) {
                this.state = await reducer(this.state, action.payload);
            } else {
                throw new Error(
                    `No reducer registered for action ${action.type}`,
                );
            }
        };

        this._webviewRequestHandlers["getTheme"] = () => {
            return vscode.window.activeColorTheme.kind;
        };

        this._webviewRequestHandlers["loadStats"] = (message) => {
            const timeStamp = message.loadCompleteTimeStamp;
            const timeToLoad = timeStamp - this._loadStartTime;
            if (this._isFirstLoad) {
                console.log(
                    `Load stats for ${this._sourceFile}` +
                        "\n" +
                        `Total time: ${timeToLoad} ms`,
                );
                this._endLoadActivity.end(ActivityStatus.Succeeded, {
                    type: this._sourceFile,
                });
                this._isFirstLoad = false;
            }
        };

        this._webviewRequestHandlers["sendActionEvent"] = (
            message: WebviewTelemetryActionEvent,
        ) => {
            sendActionEvent(
                message.telemetryView,
                message.telemetryAction,
                message.additionalProps,
                message.additionalMeasurements,
            );
        };

        this._webviewRequestHandlers["sendErrorEvent"] = (
            message: WebviewTelemetryErrorEvent,
        ) => {
            sendErrorEvent(
                message.telemetryView,
                message.telemetryAction,
                message.error,
                message.includeErrorMessage,
                message.errorCode,
                message.errorType,
                message.additionalProps,
                message.additionalMeasurements,
            );
        };

        this._webviewRequestHandlers["getLocalization"] = async () => {
            if (vscode.l10n.uri?.fsPath) {
                const file = await vscode.workspace.fs.readFile(
                    vscode.l10n.uri,
                );
                const fileContents = Buffer.from(file).toString();
                return fileContents;
            } else {
                return undefined;
            }
        };

        this._webviewRequestHandlers["executeCommand"] = async (message) => {
            if (!message?.command) {
                console.log("No command provided to execute");
                return;
            }
            const args = message?.args ?? [];
            return await vscode.commands.executeCommand(
                message.command,
                ...args,
            );
        };
        this._webviewRequestHandlers["getPlatform"] = async () => {
            return process.platform;
        };
    }

    /**
     * Register a request handler that the webview can call and get a response from.
     * @param method The method name that the webview will use to call the handler
     * @param handler The handler that will be called when the method is called
     */
    public registerRequestHandler(
        method: string,
        handler: (params: any) => any,
    ) {
        this._webviewRequestHandlers[method] = handler;
    }

    /**
     * Reducers are methods that can be called from the webview to modify the state of the webview.
     * This method registers a reducer that can be called from the webview.
     * @param method The method name that the webview will use to call the reducer
     * @param reducer The reducer that will be called when the method is called
     * @template Method The key of the reducer that is being registered
     */
    public registerReducer<Method extends keyof Reducers>(
        method: Method,
        reducer: (
            state: State,
            payload: Reducers[Method],
        ) => ReducerResponse<State>,
    ) {
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
        this.postNotification(DefaultWebviewNotifications.updateState, value);
    }

    /**
     * Updates the state in the webview
     * @param state The new state object.  If not provided, `this.state` is used.
     */
    public updateState(state?: State) {
        this.state = state ?? this.state;
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
        this.postMessage({ type: "notification", method, params });
    }

    /**
     * Posts a message to the webview
     * @param message The message to post to the webview
     */
    public postMessage(message: any) {
        if (!this._isDisposed) {
            this._getWebview()?.postMessage(message);
        }
    }

    /**
     * Disposes the controller
     */
    public dispose() {
        this._onDisposed.fire();
        this._disposables.forEach((d) => d.dispose());
        this._isDisposed = true;
    }
}

export enum DefaultWebviewNotifications {
    updateState = "updateState",
    onDidChangeTheme = "onDidChangeTheme",
}

export type ReducerResponse<T> = T | Promise<T>;
