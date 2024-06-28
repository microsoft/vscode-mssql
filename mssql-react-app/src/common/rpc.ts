/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewApi } from "vscode-webview";

export class WebviewRpc {
	private _rpcRequestId = 0;
	private _rpcHandlers: { [id: number]: { resolve: (result: unknown) => void, reject: (error: unknown) => void } } = {};
	private _methodSubscriptions: { [method: string]: ((params: unknown) => void)[] } = {};

	constructor(private _vscodeApi: WebviewApi<unknown>) {
		window.addEventListener('message', (event) => {
			const message = event.data;
            if (message.type === 'response') {
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
			if (message.type === 'notification') {
				const { method, params } = message;
				if (this._methodSubscriptions[method]) {
					this._methodSubscriptions[method].forEach(callback => callback(params));
				}
			}
		});

	}

	public call(method: string, params?: unknown): Promise<unknown> {
		const id = this._rpcRequestId++;
		this._vscodeApi.postMessage({ type: 'request', id, method, params });
		return new Promise((resolve, reject) => {
			this._rpcHandlers[id] = { resolve, reject };
		});
	}

	public action(type: string, payload?: unknown) {
		this.call('action', { type, payload });
	}

	public subscribe(method: string, callback: (params: unknown) => void) {
		if (!this._methodSubscriptions[method]) {
			this._methodSubscriptions[method] = [];
		}
		this._methodSubscriptions[method].push(callback);
	}
}