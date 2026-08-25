/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Run/trace identity and time helpers (design §11).
 *
 * Two timing planes: epoch nanoseconds (as decimal strings) for cross-process
 * ordering, and process-local monotonic nanoseconds for exact intervals.
 * Never subtract monotonic timestamps from different processes.
 */

import { randomBytes } from "node:crypto";

/** Globally unique, human-sortable run id: 2026-06-29T22-00-00Z_ab12cd34 */
export function newRunId(now: Date = new Date()): string {
    const iso = now
        .toISOString()
        .replace(/\.\d{3}Z$/, "Z")
        .replace(/:/g, "-");
    return `${iso}_${randomBytes(4).toString("hex")}`;
}

/** W3C trace id: 32 lowercase hex chars. */
export function newTraceId(): string {
    return randomBytes(16).toString("hex");
}

/** W3C span id: 16 lowercase hex chars. */
export function newSpanId(): string {
    return randomBytes(8).toString("hex");
}

/** W3C traceparent header value for a sampled trace. */
export function traceparent(traceId: string, spanId: string): string {
    return `00-${traceId}-${spanId}-01`;
}

/** 128-bit random control-channel auth token. */
export function newControlToken(): string {
    return randomBytes(16).toString("hex");
}

/**
 * Current epoch time in nanoseconds as a decimal string.
 * Precision is milliseconds (Date.now) scaled to ns — sufficient for the
 * cross-process ordering plane; exact intervals use monotonicNs.
 */
export function nowUnixNs(): string {
    return (BigInt(Date.now()) * 1_000_000n).toString();
}

/** Process-local monotonic nanoseconds as a decimal string. */
export function nowMonotonicNs(): string {
    return process.hrtime.bigint().toString();
}

/** Convert an epoch-ns decimal string to fractional milliseconds. */
export function unixNsToMs(ns: string): number {
    return Number(BigInt(ns)) / 1e6;
}

/** Difference (b - a) of two epoch-ns decimal strings, in fractional ms. */
export function diffNsToMs(aNs: string, bNs: string): number {
    return Number(BigInt(bNs) - BigInt(aNs)) / 1e6;
}
