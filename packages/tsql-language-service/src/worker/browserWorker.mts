/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SqlWorkerRequest } from "./protocol.js";
import { SqlWorkerRequestHandler } from "./requestHandler.js";

interface BrowserWorkerScope {
    addEventListener(
        type: "message",
        listener: (event: { readonly data: SqlWorkerRequest }) => void,
    ): void;
    postMessage(message: unknown): void;
}

const scope = globalThis as unknown as BrowserWorkerScope;
const handler = new SqlWorkerRequestHandler();
scope.addEventListener("message", (event) => {
    void handler.handle(event.data).then((response) => scope.postMessage(response));
});
