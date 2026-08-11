/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parentPort } from "node:worker_threads";
import type { SqlWorkerRequest } from "./protocol.js";
import { SqlWorkerRequestHandler } from "./requestHandler.js";

if (!parentPort) {
    throw new Error("The SQL worker entry point must run inside a worker thread");
}

const handler = new SqlWorkerRequestHandler();
parentPort.on("message", (request: SqlWorkerRequest) => {
    void handler.handle(request).then((response) => parentPort.postMessage(response));
});
