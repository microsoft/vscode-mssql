/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SqlWorkerClient, type SqlWorkerTransport } from "./client.js";
import type { SqlWorkerRequest } from "./protocol.js";

export interface BrowserWorkerLike {
    postMessage(message: unknown): void;
    addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
    addEventListener(type: "error" | "messageerror", listener: (event: unknown) => void): void;
    removeEventListener(
        type: "message",
        listener: (event: { readonly data: unknown }) => void,
    ): void;
    removeEventListener(type: "error" | "messageerror", listener: (event: unknown) => void): void;
    terminate(): void;
}

/** Wraps a host-created Web Worker; callers control URL resolution and CSP policy. */
export function createBrowserSqlWorkerClient(worker: BrowserWorkerLike): SqlWorkerClient {
    const transport: SqlWorkerTransport = {
        postMessage(message: SqlWorkerRequest): void {
            worker.postMessage(message);
        },
        subscribe(onMessage, onError): () => void {
            const message = (event: { readonly data: unknown }): void => onMessage(event.data);
            worker.addEventListener("message", message);
            worker.addEventListener("error", onError);
            worker.addEventListener("messageerror", onError);
            return () => {
                worker.removeEventListener("message", message);
                worker.removeEventListener("error", onError);
                worker.removeEventListener("messageerror", onError);
            };
        },
        terminate(): void {
            worker.terminate();
        },
    };
    return new SqlWorkerClient(transport);
}
