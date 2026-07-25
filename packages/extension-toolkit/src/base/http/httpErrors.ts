/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Categories of failures raised by the HTTP client.
 *
 * HTTP status codes never produce an error; they are returned to the caller instead.
 */
export type HttpClientErrorKind =
    /** The request could not be completed because of a transport failure. */
    | "network"
    /** The request or the response stream exceeded the configured timeout. */
    | "timeout"
    /** The caller aborted the request through an `AbortSignal`. */
    | "cancelled"
    /** The response body failed while being read. */
    | "response-stream"
    /** The download destination could not be opened, written, or replaced. */
    | "destination"
    /** A caller-supplied progress callback threw. */
    | "progress-callback"
    /** The configured proxy could not be parsed or applied. */
    | "proxy-configuration";

/** Error raised by the HTTP client for transport, streaming, and destination failures. */
export class HttpClientError extends Error {
    /** Discriminator used by callers to translate this error into a domain-specific error. */
    public override readonly name = "HttpClientError";

    /**
     * Creates an HTTP client error.
     *
     * @param kind Category of the failure.
     * @param message Credential-free description of the failure.
     * @param code Underlying error code, when the transport reported one.
     * @param options Wraps the original failure as the standard error `cause`.
     */
    constructor(
        public readonly kind: HttpClientErrorKind,
        message: string,
        public readonly code: string | undefined,
        options: { cause: unknown },
    ) {
        super(message, options);
    }
}

/**
 * Extracts a string error code from an arbitrary thrown value, when one is present.
 *
 * @param error Value thrown by the transport or the file system.
 */
export function getErrorCode(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null) {
        return undefined;
    }

    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
}
