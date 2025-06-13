/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewApi } from "vscode-webview";
import {
    LogEvent,
    LoggerLevel,
    WebviewTelemetryActionEvent,
    WebviewTelemetryErrorEvent,
} from "../../sharedInterfaces/webview";
import { NotificationType, RequestHandler, RequestType } from "vscode-languageclient";

/**
 * RPC to communicate with the extension.
 * @template Reducers interface that contains definitions for all reducers and their payloads.
 */
export class WebviewRpc<Reducers> {
    private _rpcRequestId = 0;
    private _rpcHandlers: {
        [id: number]: {
            resolve: (result: unknown) => void;
            reject: (error: unknown) => void;
        };
    } = {};
    private _rpcMethodHandlers: {
        [method: string]: RequestHandler<unknown, unknown, unknown>;
    } = {};
    private _methodSubscriptions: {
        [method: string]: Record<string, (params: unknown) => void>;
    } = {};
    private static _instance: WebviewRpc<any>;
    public static getInstance<Reducers>(vscodeApi: WebviewApi<unknown>): WebviewRpc<Reducers> {
        if (!WebviewRpc._instance) {
            WebviewRpc._instance = new WebviewRpc<Reducers>(vscodeApi);
        }
        return WebviewRpc._instance;
    }

    private constructor(private _vscodeApi: WebviewApi<unknown>) {
        window.addEventListener("message", async (event) => {
            const message = event.data;
            switch (message.type) {
                case "response":
                    const { id, result, error } = message;
                    if (this._rpcHandlers[id]) {
                        if (error) {
                            this._rpcHandlers[id].reject(error);
                        } else {
                            this._rpcHandlers[id].resolve(result);
                        }
                        delete this._rpcHandlers[id];
                    }
                    break;
                case "request":
                    const requestId = message.id;
                    const requestMethod = message.method;
                    const requestParams = message.params;
                    try {
                        if (this._rpcMethodHandlers[requestMethod]) {
                            // If a handler exists for this request, we can call it
                            const handler = this._rpcMethodHandlers[requestMethod];
                            try {
                                const result = await handler(requestParams, undefined!);
                                this._vscodeApi.postMessage({
                                    type: "response",
                                    id: requestId,
                                    result: result,
                                });
                            } catch (error) {
                                // If the handler throws an error, we reject the promise with the error
                                this._vscodeApi.postMessage({
                                    type: "response",
                                    id: requestId,
                                    error: error,
                                });
                            }
                        }
                    } catch (error) {
                        // If an error occurs, we reject the promise with the error
                        this._vscodeApi.postMessage({
                            type: "response",
                            id: requestId,
                            error: error,
                        });
                    }

                    break;
                case "notification":
                    const { method, params } = message;
                    if (this._methodSubscriptions[method]) {
                        Object.values(this._methodSubscriptions[method]).forEach((cb) =>
                            cb(params),
                        );
                    }
                    break;
                default:
                    console.warn(`Unknown message type: ${message.type}`);
            }
        });
    }

    /**
     * Call a method on the extension. Use this method when you expect a response object from the extension.
     * @param method name of the method to call
     * @param params parameters to pass to the method
     * @returns a promise that resolves to the result of the method call
     */
    public call(method: string, params?: unknown): Promise<unknown> {
        const id = this._rpcRequestId++;
        this._vscodeApi.postMessage({ type: "request", id, method, params });
        return new Promise((resolve, reject) => {
            this._rpcHandlers[id] = { resolve, reject };
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
        void this.call("action", { type: method, payload });
    }

    public subscribe(callerId: string, method: string, callback: (params: unknown) => void) {
        if (!this._methodSubscriptions[method]) {
            this._methodSubscriptions[method] = {};
        }
        this._methodSubscriptions[method][callerId] = callback;
    }

    public sendActionEvent(event: WebviewTelemetryActionEvent) {
        void this.call("sendActionEvent", event);
    }

    public sendErrorEvent(event: WebviewTelemetryErrorEvent) {
        void this.call("sendErrorEvent", event);
    }

    public log(message: string, level?: LoggerLevel) {
        void this.call("log", { message, level } as LogEvent);
    }

    public onRequest<P, R, E, RO>(
        type: RequestType<P, R, E, RO>,
        handler: RequestHandler<P, R, E>,
    ): void {
        if (this._rpcMethodHandlers[type.method]) {
            throw new Error(`Handler for method ${type.method} already exists.`);
        }

        this._rpcMethodHandlers[type.method] = handler;
    }

    public sendRequest<P, R, E, RO>(type: RequestType<P, R, E, RO>, params?: P): Promise<R> {
        return this.call(type.method, params) as Promise<R>;
    }

    public sendNotification<P, RO>(type: NotificationType<P, RO>, params?: P): void {
        void this.call(type.method, params);
    }

    public onNotification<P, RO>(
        type: NotificationType<P, RO>,
        handler: (params: P) => void,
    ): void {
        if (!this._methodSubscriptions[type.method]) {
            this._methodSubscriptions[type.method] = {};
        }
        this._methodSubscriptions[type.method][type.method] = handler;
    }
}
