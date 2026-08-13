/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parentPort } from "node:worker_threads";
import type { WorkerRequest } from "../protocol.js";
import { WorkerRequestHandler } from "../requestHandler.js";

const port = parentPort;
if (!port) throw new Error("The T-SQL Node worker must run in a worker thread");
const handler = new WorkerRequestHandler();
port.on("message", (request: WorkerRequest) => {
    void handler.handle(request).then((response) => port.postMessage(response));
});
