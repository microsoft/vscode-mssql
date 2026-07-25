/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IHttpHeaders } from "./httpHeaders";

/** HTTP methods supported by the client. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

/** Request headers supplied by the caller. */
export type HttpRequestHeaders = Readonly<Record<string, string>>;

/** Options shared by every request helper. */
export interface IHttpRequestOptions {
    /**
     * Headers sent with the request. Bearer authentication is supplied here, for example
     * `{ Authorization: \`Bearer ${token}\` }`.
     */
    readonly headers?: HttpRequestHeaders;

    /** Signal used to cancel the request; cancellation rejects with a `cancelled` error. */
    readonly signal?: AbortSignal;

    /** Maximum time to wait for the response, in milliseconds. */
    readonly timeoutMs?: number;
}

/**
 * A fully described HTTP request.
 *
 * @template TBody Type of the serialized request body.
 */
export interface IHttpRequest<TBody = undefined> extends IHttpRequestOptions {
    /** HTTP method. */
    readonly method: HttpMethod;

    /** Target URL. The URL is sent to the transport unchanged. */
    readonly url: string | URL;

    /** Request body. Omit for methods that do not carry a payload. */
    readonly body?: TBody;
}

/**
 * A completed HTTP response.
 *
 * Every HTTP status resolves, including 4xx and 5xx; inspect {@link IHttpResponse.ok} or
 * {@link IHttpResponse.status} to detect failures.
 *
 * @template TResponse Compile-time assertion about the payload shape. The client performs no
 * runtime validation of the response body.
 */
export interface IHttpResponse<TResponse = unknown> {
    /** Deserialized response payload. */
    readonly data: TResponse;

    /** HTTP status code. */
    readonly status: number;

    /** HTTP status text reported by the server. */
    readonly statusText: string;

    /** `true` when the status is in the 200-299 range. */
    readonly ok: boolean;

    /** Case-insensitive response headers. */
    readonly headers: IHttpHeaders;
}

/** Progress reported while a download is being written. */
export interface IDownloadProgress {
    /** Number of bytes received so far. */
    readonly downloadedBytes: number;

    /**
     * Total number of bytes to expect.
     *
     * `undefined` means the length is unknown; `0` means the response is known to be empty.
     */
    readonly totalBytes: number | undefined;
}

/** Options accepted by the download helpers. */
export interface IDownloadOptions extends IHttpRequestOptions {
    /**
     * Receives progress updates while the response body is written.
     *
     * An exception thrown from this callback fails the download with a `progress-callback` error.
     */
    readonly onProgress?: (progress: IDownloadProgress) => void;
}

/** Result of a completed download request. */
export interface IDownloadResult {
    /** HTTP status code. */
    readonly status: number;

    /** HTTP status text reported by the server. */
    readonly statusText: string;

    /** `true` when the status is in the 200-299 range and the destination was written. */
    readonly ok: boolean;

    /** Case-insensitive response headers. */
    readonly headers: IHttpHeaders;
}

/** Minimal logging surface used for HTTP diagnostics. */
export interface IHttpClientLogger {
    /** Writes a diagnostic message. */
    debug(message: string, ...args: unknown[]): void;

    /** Writes a warning message. */
    warn(message: string, ...args: unknown[]): void;

    /** Writes an error message. */
    error(message: string, ...args: unknown[]): void;
}
