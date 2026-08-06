/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { HttpRequestHeaders, IHttpRequestOptions } from "./httpTypes";

/** Adds bearer authentication to a new request options object. */
export function withBearerToken<TOptions extends IHttpRequestOptions = IHttpRequestOptions>(
    token: string,
    options?: TOptions,
): TOptions & { readonly headers: HttpRequestHeaders } {
    if (
        token.length === 0 ||
        token.trim().length === 0 ||
        token !== token.trim() ||
        /^Bearer /i.test(token) ||
        /[\r\n]/.test(token)
    ) {
        throw new TypeError(
            "Bearer token must be an unprefixed, non-empty value without whitespace padding or newlines",
        );
    }

    if (
        Object.keys(options?.headers ?? {}).some(
            (header) => header.toLowerCase() === "authorization",
        )
    ) {
        throw new TypeError("Request options already contain an Authorization header");
    }

    return {
        ...options,
        headers: {
            ...options?.headers,
            Authorization: `Bearer ${token}`,
        },
    } as TOptions & { readonly headers: HttpRequestHeaders };
}
