/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SqlReadOptions } from "../common/sqlReader";

/** The options of the functions that run a performance read. */
export interface PerfRunOptions {
    /** Cancels the reads. */
    readonly signal?: AbortSignal;
    /** The timeout of each batch, in milliseconds. */
    readonly timeoutMs?: number;
    /**
     * The time of the request. Relative time windows end at it, and the result reports it in
     * `observedAtUtc`. Default: the current time.
     */
    readonly now?: Date;
}

/** The reader options for each batch of a run. */
export function readOptionsOf(options: PerfRunOptions): SqlReadOptions {
    return { signal: options.signal, timeoutMs: options.timeoutMs };
}
