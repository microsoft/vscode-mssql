/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { resolve } from "node:path";
import { Worker } from "node:worker_threads";

import { LanguageServiceWorkerClient, type WorkerTransport } from "../../../src/worker/client.ts";
import type { WorkerRequest } from "../../../src/worker/protocol.ts";

export function createSourceNodeWorkerClient(): LanguageServiceWorkerClient {
    const worker = new Worker(resolve(__dirname, "../../../src/worker/node/worker.ts"), {
        execArgv: ["--import", "tsx"],
    });
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
