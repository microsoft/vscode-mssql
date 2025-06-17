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
    MessageType,
    PendingRequest,
    ReducerRequest,
    SendActionEventNotification,
    SendErrorEventNotification,
    StateChangeNotification,
    WebviewRpcMessage,
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
    private _onDisposed: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDisposed: vscode.Event<void> = this._onDisposed.event;

    private _state: State;
    private _isFirstLoad: boolean = true;
    protected _loadStartTime: number = Date.now();
    private _endLoadActivity = startActivity(
        TelemetryViews.WebviewController,
        TelemetryActions.Load,
    );

    private _pendingRequests = new Map<string, PendingRequest>();
    private _requestHandlers = new Map<string, RequestHandler<any, any, any>>();
    private _notificationHandlers = new Map<string, ((params: any) => void)[]>();
    private _reducerHandlers = new Map<
        keyof Reducers,
        (state: State, payload: Reducers[keyof Reducers]) => ReducerResponse<State>
    >();

    protected _webviewMessageHandler = async (message: WebviewRpcMessage) => {
        switch (message.type) {
            case MessageType.Response:
                await this._handleResponse(message);
                break;
            case MessageType.Request:
                await this._handleRequest(message);
                break;
            case MessageType.Notification:
                await this._handleNotification(message);
                break;
            default:
                this.logger.error(`Unknown message type: ${message.type}`);
                return;
        }
    };

    private _handleResponse = async (message: WebviewRpcMessage) => {
        const responseActivity = startActivity(
            TelemetryViews.WebviewController,
            TelemetryActions.WebviewResponse,
        );
        const { id, result, error } = message;
        if (id === undefined) {
            responseActivity.endFailed(
                new Error("Received response without an id"),
                true,
                "InvalidResponse",
                "InvalidResponse",
                {
                    type: this._sourceFile,
                },
            );
            this.logger.error("Received response without an id");
            return;
        }
        const pendingRequest = this._pendingRequests.get(id);
        if (!pendingRequest) {
            responseActivity.endFailed(
                new Error(`No pending request found for id ${id}`),
                true,
                "NoPendingRequest",
                "NoPendingRequest",
                {
                    type: this._sourceFile,
                },
            );
            this.logger.warn(`No pending request found for id ${id}`);
            return;
        }

        this._pendingRequests.delete(id);
        if (error) {
            responseActivity.endFailed(
                error,
                false,
                "ResponseHandlerFailed",
                "ResponseHandlerFailed",
                {
                    type: this._sourceFile,
                },
            );
            pendingRequest.reject(error);
        } else {
            pendingRequest.resolve(result);
        }
    };

    private _handleRequest = async (message: WebviewRpcMessage) => {
        const requestActivity = startActivity(
            TelemetryViews.WebviewController,
            TelemetryActions.WebviewRequest,
        );
        const { id, method, params } = message;
        if (!method || id === undefined) {
            this.logger.error("Received request without method or id");
            requestActivity.endFailed(
                new Error("Received request without method or id"),
                true,
                "InvalidRequest",
                "InvalidRequest",
                {
                    type: this._sourceFile,
                },
            );
            return;
        }

        const handler = this._requestHandlers.get(method);
        if (!handler) {
            this.logger.warn(`No handler found for method ${method}`);
            requestActivity.endFailed(
                new Error(`No handler registered for method ${method}`),
                true,
                "NoHandlerRegistered",
                "NoHandlerRegistered",
                {
                    type: this._sourceFile,
                    method,
                },
            );
            return;
        }

        try {
            const result = await handler(params, undefined!); // Not supporting cancellation for now
            this.postMessage({
                type: MessageType.Response,
                id,
                result,
            });
            requestActivity.end(ActivityStatus.Succeeded, {
                type: this._sourceFile,
                method,
            });
        } catch (error) {
            requestActivity.endFailed(
                error,
                false,
                "RequestHandlerFailed",
                "RequestHandlerFailed",
                {
                    type: this._sourceFile,
                    method,
                },
            );
            this.postMessage({
                type: MessageType.Response,
                id,
                error: {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                },
            });
        }
    };

    private _handleNotification = async (message: WebviewRpcMessage) => {
        const notificationActivity = startActivity(
            TelemetryViews.WebviewController,
            TelemetryActions.WebviewNotification,
        );
        const { method, params } = message;
        if (!method) {
            notificationActivity.endFailed(
                new Error("Received notification without method"),
                true,
                "InvalidNotification",
                "InvalidNotification",
                {
                    type: this._sourceFile,
                },
            );
            this.logger.error("Received notification without method");
            return;
        }

        const handlers = this._notificationHandlers.get(method);
        if (!handlers) {
            notificationActivity.endFailed(
                new Error(`No handlers registered for notification method ${method}`),
                true,
                "NoNotificationHandlerRegistered",
                "NoNotificationHandlerRegistered",
                {
                    type: this._sourceFile,
                    method,
                },
            );
            this.logger.warn(`No handlers found for notification method ${method}`);
            return;
        }

        let errorCount = 0;
        handlers.forEach((handler) => {
            try {
                handler(params);
            } catch (error) {
                errorCount++;
                console.error(`Error in notification handler for ${method}:`, error);
            }
        });
        if (errorCount > 0) {
            this.logger.error(`Error in ${errorCount} notification handlers for ${method}`);
            notificationActivity.endFailed(
                new Error(`Error in ${errorCount} notification handlers for ${method}`),
                false,
                "NotificationHandlerError",
                "NotificationHandlerError",
                {
                    type: this._sourceFile,
                    method,
                    errorCount: errorCount.toString(),
                },
            );
        } else {
            this.logger.log(`Notification ${method} handled successfully`);
            notificationActivity.end(ActivityStatus.Succeeded, {
                type: this._sourceFile,
                method,
            });
        }
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

        this.onRequest(ReducerRequest.type<Reducers>(), async (action) => {
            const reducer = this._reducerHandlers.get(action.type);
            if (reducer) {
                this.state = await reducer(this.state, action.payload);
            } else {
                throw new Error(`No reducer registered for action ${action.type as string}`);
            }
        });
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
        this._reducerHandlers.set(method, reducer);
    }

    /**
     * Registers a request handler for a specific request type.
     * @param type The request type that the handler will handle
     * @param handler The handler that will be called when the request is made
     */
    public onRequest<TParam, TResult, TError>(
        type: RequestType<TParam, TResult, TError>,
        handler: RequestHandler<TParam, TResult, TError>,
    ): void {
        if (this._isDisposed) {
            throw new Error("Cannot register request handler on disposed controller");
        }
        this._requestHandlers.set(type.method, handler);
    }

    /**
     * Registers a reducer that can be called from the webview.
     */
    public sendRequest<TParam, TResult, TError>(
        type: RequestType<TParam, TResult, TError>,
        params: TParam,
    ): Thenable<TResult> {
        if (this._isDisposed) {
            return Promise.reject(new Error("Cannot send request on disposed controller"));
        }
        return new Promise<TResult>((resolve, reject) => {
            this._pendingRequests.set(generateGuid(), {
                resolve,
                reject,
            });
            this.postMessage({
                type: MessageType.Request,
                id: generateGuid(), // Generate a unique ID for the request
                method: type.method,
                params,
            } as WebviewRpcMessage);
        });
    }

    /**
     * Sends a notification to the webview. This is used to notify the webview of changes
     * @param type The notification type that the webview will handle
     * @param params The parameters that will be passed to the notification handler
     */
    public sendNotification<TParams>(type: NotificationType<TParams>, params: TParams): void {
        if (this._isDisposed) {
            throw new Error("Cannot send notification on disposed controller");
        }
        this.postMessage({ type: MessageType.Notification, method: type.method, params });
    }

    /**
     * Registers a notification handler for a specific notification type.
     * This handler will be called when the webview sends a notification of that type.
     * @param type The notification type that the handler will handle
     * @param handler The handler that will be called when the notification is received
     */
    public onNotification<TParams>(
        type: NotificationType<TParams>,
        handler: (params: TParams) => void,
    ): void {
        if (this._isDisposed) {
            throw new Error("Cannot register notification handler on disposed controller");
        }
        if (!this._notificationHandlers.has(type.method)) {
            this._notificationHandlers.set(type.method, []);
        }
        this._notificationHandlers.get(type.method)!.push(handler);
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
    public postMessage(message: WebviewRpcMessage) {
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
