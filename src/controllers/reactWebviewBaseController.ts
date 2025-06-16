/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import { ActivityStatus, TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import {
    ColorThemeChangeNotification,
    ExecuteCommandParams,
    ExecuteCommandRequest,
    GetLocalizationRequest,
    GetPlatformRequest,
    GetStateRequest,
    GetThemeRequest,
    LoadStatsNotification,
    LogEvent,
    LogNotification,
    SendActionEventNotification,
    SendErrorEventNotification,
    StateChangeNotification,
    WebviewTelemetryActionEvent,
    WebviewTelemetryErrorEvent,
} from "../sharedInterfaces/webview";
import { sendActionEvent, sendErrorEvent, startActivity } from "../telemetry/telemetry";

import { getNonce } from "../utils/utils";
import { Logger } from "../models/logger";
import VscodeWrapper from "./vscodeWrapper";
import { NotificationType, RequestHandler, RequestType } from "vscode-jsonrpc/node";
import { generateGuid } from "../models/utils";

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
    private _webviewRequestHandlers: { [key: string]: (params: any) => any } = {};
    private _reducers: Record<
        keyof Reducers,
        (state: State, payload: Reducers[keyof Reducers]) => ReducerResponse<State>
    > = {} as Record<
        keyof Reducers,
        (state: State, payload: Reducers[keyof Reducers]) => ReducerResponse<State>
    >;
    private _notificationHandlers: {
        [key: string]: (params: any) => void;
    } = {};

    private _isFirstLoad: boolean = true;
    protected _loadStartTime: number = Date.now();
    private _endLoadActivity = startActivity(
        TelemetryViews.WebviewController,
        TelemetryActions.Load,
    );
    private _onDisposed: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
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
                        reducer: message.method === "action" ? message.params.type : undefined,
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
                            reducer: message.method === "action" ? message.params.type : undefined,
                        },
                    );
                    this.postMessage({
                        type: "response",
                        id: message.id,
                        error: {
                            name: error.name,
                            message: error.message,
                            stack: error.stack,
                        },
                    });
                }
            } else {
                const error = new Error(`No handler registered for method ${message.method}`);
                endActivity.endFailed(error, true, "NoHandlerRegistered", "NoHandlerRegistered", {
                    type: this._sourceFile,
                    method: message.method,
                });
                this.postMessage({
                    type: "response",
                    id: message.id,
                    error: {
                        name: error.name,
                        message: error.message,
                        stack: error.stack,
                    },
                });
            }
        } else if (message.type === "response") {
            const handler = this._responseHandlers[message.id];
            if (handler) {
                if (message.error) {
                    handler.reject(message.error);
                } else {
                    handler.resolve(message.result);
                }
                delete this._responseHandlers[message.id];
            } else {
                this.logger.warn(`No response handler registered for id ${message.id}`);
            }
        }
    };

    private _responseHandlers: {
        [id: string]: {
            resolve: (result: any) => void;
            reject: (error: any) => void;
        };
    };

    protected logger: Logger;

    /**
     * Creates a new ReactWebviewPanelController
     * @param _context The context of the extension
     * @param _sourceFile The source file that the webview will use
     * @param _initialData The initial state object that the webview will use
     */
    constructor(
        protected _context: vscode.ExtensionContext,
        protected vscodeWrapper: VscodeWrapper,
        private _sourceFile: string,
        private _initialData: State,
        viewId?: string,
    ) {
        if (!vscodeWrapper) {
            vscodeWrapper = new VscodeWrapper();
        }

        this.logger = Logger.create(vscodeWrapper.outputChannel, viewId);
    }

    protected initializeBase() {
        if (!this.state) {
            this.state = this._initialData;
        }
        this._registerDefaultRequestHandlers();
        this.setupTheming();
    }

    protected registerDisposable(disposable: vscode.Disposable) {
        this._disposables.push(disposable);
    }

    protected _getHtmlTemplate() {
        const nonce = getNonce();

        const baseUrl = this._getWebview().asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, "out", "src", "reactviews", "assets"),
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
                this.sendNotification(ColorThemeChangeNotification.type, theme.kind);
            }),
        );
        this.sendNotification(
            ColorThemeChangeNotification.type,
            vscode.window.activeColorTheme.kind,
        );
    }

    private _registerDefaultRequestHandlers() {
        this.onNotification(
            SendActionEventNotification.type,
            (message: WebviewTelemetryActionEvent) => {
                sendActionEvent(
                    message.telemetryView,
                    message.telemetryAction,
                    message.additionalProps,
                    message.additionalMeasurements,
                );
            },
        );

        this.onNotification(
            SendErrorEventNotification.type,
            (message: WebviewTelemetryErrorEvent) => {
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
            },
        );

        this.onNotification(LogNotification.type, async (message: LogEvent) => {
            this.logger[message.level ?? "log"](message.message);
        });

        this.onNotification(LoadStatsNotification.type, (message) => {
            const timeStamp = message.loadCompleteTimeStamp;
            const timeToLoad = timeStamp - this._loadStartTime;
            if (this._isFirstLoad) {
                console.log(
                    `Load stats for ${this._sourceFile}` + "\n" + `Total time: ${timeToLoad} ms`,
                );
                this._endLoadActivity.end(ActivityStatus.Succeeded, {
                    type: this._sourceFile,
                });
                this._isFirstLoad = false;
            }
        });

        this.onRequest(GetStateRequest.type<State>(), () => {
            return this.state;
        });

        this.onRequest(GetThemeRequest.type, () => {
            return vscode.window.activeColorTheme.kind;
        });

        this.onRequest(GetLocalizationRequest.type, async () => {
            if (vscode.l10n.uri?.fsPath) {
                const file = await vscode.workspace.fs.readFile(vscode.l10n.uri);
                const fileContents = Buffer.from(file).toString();
                return fileContents;
            } else {
                return undefined;
            }
        });

        this.onRequest(ExecuteCommandRequest.type, async (params: ExecuteCommandParams) => {
            if (!params?.command) {
                this.logger.log("No command provided to execute");
                return;
            }
            const args = params?.args ?? [];
            return await vscode.commands.executeCommand(params.command, ...args);
        });

        this.onRequest(GetPlatformRequest.type, async () => {
            return process.platform;
        });

        this._webviewRequestHandlers["action"] = async (action) => {
            const reducer = this._reducers[action.type];
            if (reducer) {
                this.state = await reducer(this.state, action.payload);
            } else {
                throw new Error(`No reducer registered for action ${action.type}`);
            }
        };
    }

    /**
     * Register a request handler that the webview can call and get a response from.
     * @param method The method name that the webview will use to call the handler
     * @param handler The handler that will be called when the method is called
     */
    public registerRequestHandler(method: string, handler: (params: any) => any) {
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
        reducer: (state: State, payload: Reducers[Method]) => ReducerResponse<State>,
    ) {
        this._reducers[method] = reducer;
    }

    /**
     * Registers a request handler for a specific request type.
     * @param type The request type that the handler will handle
     * @param handler The handler that will be called when the request is made
     */
    onRequest<P, R, E>(type: RequestType<P, R, E>, handler: RequestHandler<P, R, E>): void {
        if (this._isDisposed) {
            throw new Error("Cannot register request handler on disposed controller");
        }
        this._webviewRequestHandlers[type.method] = async (params: P) => {
            try {
                const result = await handler(params, undefined);
                return result;
            } catch (error) {
                this.logger.error(`Error in request handler for ${type.method}:`, error);
                throw error;
            }
        };
    }

    /**
     * Registers a reducer that can be called from the webview.
     */
    sendRequest<P, R, E>(type: RequestType<P, R, E>, params: P): Thenable<R> {
        if (this._isDisposed) {
            return Promise.reject(new Error("Cannot send request on disposed controller"));
        }
        this.postMessage({
            type: "request",
            id: generateGuid(), // Generate a unique ID for the request
            method: type.method,
            params,
        });
        return new Promise<R>((resolve, reject) => {
            this._responseHandlers[type.method] = {
                resolve: (result: R) => {
                    resolve(result);
                },
                reject: (error: E) => {
                    reject(error);
                },
            };
        });
    }

    /**
     * Sends a notification to the webview. This is used to notify the webview of changes
     * @param type The notification type that the webview will handle
     * @param params The parameters that will be passed to the notification handler
     */
    sendNotification<P>(type: NotificationType<P>, params: P): void {
        if (this._isDisposed) {
            throw new Error("Cannot send notification on disposed controller");
        }
        this.postMessage({ type: "notification", method: type.method, params });
    }

    /**
     * Registers a notification handler for a specific notification type.
     * This handler will be called when the webview sends a notification of that type.
     * @param type The notification type that the handler will handle
     * @param handler The handler that will be called when the notification is received
     */
    onNotification<P>(type: NotificationType<P>, handler: (params: P) => void): void {
        if (this._isDisposed) {
            throw new Error("Cannot register notification handler on disposed controller");
        }
        this._notificationHandlers[type.method] = handler;
        this._disposables.push({
            dispose: () => {
                delete this._notificationHandlers[type.method];
            },
        });
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
        this.sendNotification(StateChangeNotification.type<State>(), value);
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

export type ReducerResponse<T> = T | Promise<T>;
