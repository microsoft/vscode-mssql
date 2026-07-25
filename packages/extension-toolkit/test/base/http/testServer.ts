/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from "http";
import { AddressInfo } from "net";

/** A local HTTP server used to exercise the client against a real socket. */
export interface ITestServer {
    /** Origin of the running server, for example `http://127.0.0.1:51234`. */
    readonly origin: string;

    /** Stops the server and waits for it to close. */
    close(): Promise<void>;
}

/**
 * Starts a local HTTP server bound to a loopback ephemeral port.
 *
 * @param handler Request handler used for every request.
 */
export async function startTestServer(handler: http.RequestListener): Promise<ITestServer> {
    const server = http.createServer(handler);

    await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address() as AddressInfo;

    return {
        origin: `http://127.0.0.1:${address.port}`,
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.closeAllConnections();
                server.close((error) => (error ? reject(error) : resolve()));
            }),
    };
}

/** Reads an entire request body as a UTF-8 string. */
export async function readRequestBody(request: http.IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(chunk as Buffer);
    }

    return Buffer.concat(chunks).toString("utf8");
}
