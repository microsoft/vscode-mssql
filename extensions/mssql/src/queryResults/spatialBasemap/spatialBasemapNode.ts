/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Node seam kept out of testable modules (mirrors the codebase's io seams). */
import * as dnsModule from "dns";
import * as https from "https";
import { isIP, LookupFunction } from "net";
import { Readable } from "stream";

export const dns = dnsModule.promises;

/** The socket cannot perform a second, unvalidated DNS lookup. */
export function pinnedBasemapLookup(addresses: readonly string[]): LookupFunction {
    return (_hostname, options, callback) => {
        const matches = addresses
            .map((address) => ({ address, family: isIP(address) }))
            .filter(
                (entry) => entry.family && (!options.family || options.family === entry.family),
            );
        if (!matches.length) {
            callback(new Error("No approved map endpoint address"), "", 0);
        } else if (options.all) {
            callback(null, matches);
        } else {
            callback(null, matches[0].address, matches[0].family);
        }
    };
}

export function fetchBasemapResponse(
    url: string,
    init: RequestInit,
    addresses: readonly string[],
): Promise<Response> {
    return new Promise((resolve, reject) => {
        const request = https.request(
            url,
            {
                method: "GET",
                headers: Object.fromEntries(new Headers(init.headers).entries()),
                signal: init.signal ?? undefined,
                agent: false,
                lookup: pinnedBasemapLookup(addresses),
            },
            (incoming) => {
                try {
                    const headers = new Headers();
                    for (let i = 0; i < incoming.rawHeaders.length; i += 2)
                        headers.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
                    const status = incoming.statusCode ?? 502;
                    resolve(
                        new Response(
                            [204, 205, 304].includes(status)
                                ? null
                                : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>),
                            { status, headers },
                        ),
                    );
                } catch (error) {
                    incoming.destroy();
                    reject(error);
                }
            },
        );
        request.once("error", reject);
        request.end();
    });
}
