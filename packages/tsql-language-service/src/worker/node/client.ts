/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { LanguageServiceWorkerClient, type WorkerTransport } from "../client.js";
import type { WorkerRequest } from "../protocol.js";

export function createNodeWorkerClient(): LanguageServiceWorkerClient {
    const worker = new Worker(join(__dirname, "worker.js"));
    const transport: WorkerTransport = {
        postMessage: (message: WorkerRequest) => worker.postMessage(message),
        subscribe(onMessage, onError) {
            worker.on("message", onMessage);
            worker.on("error", onError);
            return () => {
                worker.off("message", onMessage);
                worker.off("error", onError);
            };
        },
        terminate: () => worker.terminate().then(() => undefined),
    };
    return new LanguageServiceWorkerClient(transport);
}
