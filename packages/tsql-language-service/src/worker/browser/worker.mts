/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { WorkerRequest } from "../protocol.js";
import { WorkerRequestHandler } from "../requestHandler.js";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const handler = new WorkerRequestHandler();
scope.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
    void handler.handle(event.data).then((response) => scope.postMessage(response));
});
