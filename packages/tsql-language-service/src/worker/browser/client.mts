/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LanguageServiceWorkerClient, type WorkerTransport } from "../client.js";
import type { WorkerRequest } from "../protocol.js";

export function createBrowserWorkerClient(worker: Worker): LanguageServiceWorkerClient {
    const transport: WorkerTransport = {
        postMessage: (message: WorkerRequest) => worker.postMessage(message),
        subscribe(onMessage, onError) {
            const message = (event: MessageEvent<unknown>) => onMessage(event.data);
            const error = (event: ErrorEvent) => onError(event.error ?? event.message);
            worker.addEventListener("message", message);
            worker.addEventListener("error", error);
            return () => {
                worker.removeEventListener("message", message);
                worker.removeEventListener("error", error);
            };
        },
        terminate: () => worker.terminate(),
    };
    return new LanguageServiceWorkerClient(transport);
}
