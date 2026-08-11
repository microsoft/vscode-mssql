/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "node:path";
import { Worker, type ResourceLimits } from "node:worker_threads";
import { SqlWorkerClient, type SqlWorkerTransport } from "./client.js";
import type { SqlWorkerRequest } from "./protocol.js";

export interface NodeSqlWorkerClientOptions {
    readonly workerPath?: string;
    readonly resourceLimits?: ResourceLimits;
    readonly name?: string;
}

/** Creates a desktop worker_threads transport while keeping Node APIs out of browser entry points. */
export function createNodeSqlWorkerClient(
    options: NodeSqlWorkerClientOptions = {},
): SqlWorkerClient {
    const worker = new Worker(options.workerPath ?? path.join(__dirname, "nodeWorker.js"), {
        resourceLimits: options.resourceLimits,
        name: options.name ?? "tsql-language-service",
    });
    const transport: SqlWorkerTransport = {
        postMessage(message: SqlWorkerRequest): void {
            worker.postMessage(message);
        },
        subscribe(onMessage, onError): () => void {
            const exit = (code: number): void =>
                onError(new Error(`SQL worker exited unexpectedly with code ${code}`));
            worker.on("message", onMessage);
            worker.on("error", onError);
            worker.on("messageerror", onError);
            worker.on("exit", exit);
            return () => {
                worker.off("message", onMessage);
                worker.off("error", onError);
                worker.off("messageerror", onError);
                worker.off("exit", exit);
            };
        },
        async terminate(): Promise<void> {
            await worker.terminate();
        },
    };
    return new SqlWorkerClient(transport);
}
