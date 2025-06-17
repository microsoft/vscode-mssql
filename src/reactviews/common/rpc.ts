/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewApi } from "vscode-webview";
import {
    LoggerLevel,
    LogNotification,
    MessageType,
    PendingRequest,
    ReducerRequest,
    SendActionEventNotification,
    SendErrorEventNotification,
    WebviewRpcMessage,
    WebviewTelemetryActionEvent,
    WebviewTelemetryErrorEvent,
} from "../../sharedInterfaces/webview";
import { NotificationType, RequestHandler, RequestType } from "vscode-jsonrpc/browser";
import { v4 as uuidv4 } from "uuid";

/**
 * RPC to communicate with the extension.
 * @template Reducers interface that contains definitions for all reducers and their payloads.
 */
export class WebviewRpc<Reducers> {
    private _pendingRequests = new Map<string, PendingRequest>();
    private _requestHandlers = new Map<string, RequestHandler<any, any, any>>();
    private _notificationHandlers = new Map<string, ((params: any) => void)[]>();

    /**
     * Singleton instance of the WebviewRpc class.
     * @param vscodeApi The WebviewApi instance to communicate with the extension.
     * @returns The singleton instance of WebviewRpc.
     */
    private static _instance: WebviewRpc<any>;
    /**
     * Get the singleton instance of the WebviewRpc class.
     * This method ensures that only one instance of the WebviewRpc class is created.
     * @param vscodeApi The WebviewApi instance to communicate with the extension.
     * @returns The singleton instance of WebviewRpc.
     */
    public static getInstance<Reducers>(vscodeApi: WebviewApi<unknown>): WebviewRpc<Reducers> {
        if (!WebviewRpc._instance) {
            WebviewRpc._instance = new WebviewRpc<Reducers>(vscodeApi);
        }
        return WebviewRpc._instance;
    }

    private constructor(private _vscodeApi: WebviewApi<unknown>) {
        this._setupMessageListener();
    }

    private _setupMessageListener() {
        window.addEventListener("message", async (event) => {
            const message = event.data as WebviewRpcMessage;
            switch (message.type) {
                case MessageType.Response:
                    this._handleResponse(message);
                    break;
                case MessageType.Request:
                    await this._handleRequest(message);
                    break;
                case MessageType.Notification:
                    this._handleNotification(message);
                    break;
                default:
                    console.warn(`Unknown message type: ${message.type}`);
            }
        });
    }

    private _handleResponse(message: WebviewRpcMessage) {
        const { id, result, error } = message;

        if (id === undefined) {
            console.warn("Received response without an id, ignoring.");
            return;
        }

        const pendingRequest = this._pendingRequests.get(id);
        if (!pendingRequest) {
            console.warn(`No pending request found for id ${id}, ignoring response.`);
            return;
        }

        this._pendingRequests.delete(id);

        if (error) {
            pendingRequest.reject(error);
        } else {
            pendingRequest.resolve(result);
        }
    }

    private async _handleRequest(message: WebviewRpcMessage) {
        const { id, method, params } = message;

        if (!method || id === undefined) {
            console.warn("Received request without method or id, ignoring.");
            return;
        }

        const handler = this._requestHandlers.get(method);
        if (!handler) {
            console.warn(`No handler found for method ${method}, ignoring request.`);
            return;
        }

        try {
            const result = await handler(params, undefined!); // Not supporting cancellation for now
            this._vscodeApi.postMessage({
                type: MessageType.Response,
                id,
                result,
            });
        } catch (error) {
            this._vscodeApi.postMessage({
                type: MessageType.Response,
                id,
                error,
            });
        }
    }

    private _handleNotification(message: WebviewRpcMessage) {
        const { method, params } = message;

        if (!method) {
            console.warn("Received notification without method, ignoring.");
            return;
        }

        const handlers = this._notificationHandlers.get(method);
        if (!handlers) {
            console.warn(`No handlers found for notification method ${method}, ignoring.`);
            return;
        }

        handlers.forEach((handler) => {
            try {
                handler(params);
            } catch (error) {
                console.error(`Error in notification handler for ${method}:`, error);
            }
        });
    }

    /**
     * Call reducers defined for the webview. Use this for actions that modify the state of the webview.
     * @param method name of the method to call
     * @param payload parameters to pass to the method
     * @template MethodName name of the method to call. Must be a key of the Reducers interface.
     */
    public action<MethodName extends keyof Reducers>(
        method: MethodName,
        payload?: Reducers[MethodName],
    ) {
        void this.sendRequest(ReducerRequest.type<Reducers>(), {
            type: method,
            payload: payload,
        });
    }

    public sendActionEvent(event: WebviewTelemetryActionEvent) {
        this.sendNotification(SendActionEventNotification.type, event);
    }

    public sendErrorEvent(event: WebviewTelemetryErrorEvent) {
        this.sendNotification(SendErrorEventNotification.type, event);
    }

    public log(message: string, level?: LoggerLevel) {
        this.sendNotification(LogNotification.type, { message, level });
    }

    public onRequest<P, R, E>(type: RequestType<P, R, E>, handler: RequestHandler<P, R, E>): void {
        if (this._requestHandlers.has(type.method)) {
            throw new Error(`Handler for method ${type.method} already exists.`);
        }

        this._requestHandlers.set(type.method, handler);
    }

    public sendRequest<P, R, E>(type: RequestType<P, R, E>, params?: P): Promise<R> {
        const id = uuidv4();
        return new Promise<R>((resolve, reject) => {
            this._pendingRequests.set(id, { resolve, reject });
            this._vscodeApi.postMessage({
                type: MessageType.Request,
                id,
                method: type.method,
                params,
            } as WebviewRpcMessage);
        });
    }

    public sendNotification<P>(type: NotificationType<P>, params?: P): void {
        this._vscodeApi.postMessage({
            type: MessageType.Notification,
            method: type.method,
            params,
        } as WebviewRpcMessage);
    }

    public onNotification<P>(type: NotificationType<P>, handler: (params: P) => void): void {
        if (!this._notificationHandlers.has(type.method)) {
            this._notificationHandlers.set(type.method, []);
        }
        this._notificationHandlers.get(type.method)!.push(handler);
    }
}
