/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { classifySqlError } from "./sqlErrors";
import { SqlReadError } from "./sqlReader";

export type ReadStatus =
    /** The data is complete for the request. */
    | "ready"
    /** The source works but has no rows for the request. */
    | "noData"
    /** The platform supports the source, but it is off, for example Query Store OFF. */
    | "notConfigured"
    /** The principal does not have the necessary permission. */
    | "permissionMissing"
    /** The platform or version does not have the source. */
    | "unsupported"
    /** A timeout, throttling, failover, or cancel stopped the read. A retry can succeed. */
    | "temporarilyUnavailable"
    | "failed";

export interface ReadError {
    readonly message: string;
    readonly errorNumber?: number;
}

/**
 * The outcome of a read. Results are JSON-serializable, so callers can send them to webviews and
 * language model tools as they are.
 */
export interface ReadResult<T> {
    readonly status: ReadStatus;
    /** Set for `ready`, and for `noData` when an empty value is useful. */
    readonly data?: T;
    readonly error?: ReadError;
}

/** Maps a read failure to a status. */
export function statusForError(error: unknown): ReadStatus {
    switch (classifySqlError(error)) {
        case "permission":
            return "permissionMissing";
        case "unsupported":
            return "unsupported";
        case "transient":
            return "temporarilyUnavailable";
        default:
            return "failed";
    }
}

export function errorResult<T>(error: unknown): ReadResult<T> {
    return {
        status: statusForError(error),
        error: {
            message: error instanceof Error ? error.message : String(error),
            ...(error instanceof SqlReadError && error.errorNumber !== undefined
                ? { errorNumber: error.errorNumber }
                : {}),
        },
    };
}
