/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewApi } from "vscode-webview";
import {
    WebviewTelemetryActionEvent,
    WebviewTelemetryErrorEvent,
} from "../../sharedInterfaces/webview";

/**
 * Rpc to communicate with the extension.
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
    private _methodSubscriptions: {
        [method: string]: Record<string, (params: unknown) => void>;
    } = {};
    private static _instance: WebviewRpc<any>;
    public static getInstance<Reducers>(
        vscodeApi: WebviewApi<unknown>,
    ): WebviewRpc<Reducers> {
        if (!WebviewRpc._instance) {
            WebviewRpc._instance = new WebviewRpc<Reducers>(vscodeApi);
        }
        return WebviewRpc._instance;
    }

    private constructor(private _vscodeApi: WebviewApi<unknown>) {
        window.addEventListener("message", (event) => {
            const message = event.data;
            if (message.type === "response") {
                const { id, result, error } = message;
                if (this._rpcHandlers[id]) {
                    if (error) {
                        this._rpcHandlers[id].reject(error);
                    } else {
                        this._rpcHandlers[id].resolve(result);
                    }
                    delete this._rpcHandlers[id];
                }
            }
            if (message.type === "notification") {
                const { method, params } = message;
                if (this._methodSubscriptions[method]) {
                    Object.values(this._methodSubscriptions[method]).forEach(
                        (cb) => cb(params),
                    );
                }
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

    public subscribe(
        callerId: string,
        method: string,
        callback: (params: unknown) => void,
    ) {
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
}
