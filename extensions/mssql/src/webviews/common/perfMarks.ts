/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Webview-side perf marks (harness design §17.5). Disabled by default: marks
 * are emitted only after the extension controller sends PerfEnableNotification,
 * which it does only under PERF_MODE=1. Outside perf mode every call here is
 * an inert boolean check.
 */

import type { WebviewRpc } from "./rpc";
import { PerfEnableNotification, PerfWebviewMarkNotification } from "../../sharedInterfaces/perf";

interface PendingMark {
    name: string;
    timestampUnixNs: string;
    monotonicNs: string;
    attrs?: { [key: string]: string | number | boolean | null };
}

let rpcRef: WebviewRpc<unknown> | undefined;
let enabled = false;
// Marks recorded before enablement arrives. Timestamps are captured at mark
// time, so late delivery never distorts timing. Bounded: outside perf mode
// enablement never comes and this stays a small fixed-size array.
const MAX_PENDING = 50;
let pending: PendingMark[] = [];

/** Wire up the enable notification. Called once by the webview provider. */
export function initPerfMarks(rpc: WebviewRpc<unknown>): void {
    rpcRef = rpc;
    rpc.onNotification(PerfEnableNotification.type, () => {
        enabled = true;
        const queued = pending;
        pending = [];
        for (const mark of queued) {
            send(mark);
        }
    });
}

export function perfMarksEnabled(): boolean {
    return enabled;
}

function send(mark: PendingMark): void {
    try {
        void rpcRef?.sendNotification(PerfWebviewMarkNotification.type, mark);
    } catch {
        // Perf marks must never break the webview.
    }
}

/**
 * Record a perf mark with this webview's own clocks:
 * epoch ns from performance.timeOrigin + performance.now(), monotonic ns from
 * performance.now() (µs precision — ms×1e6 would overflow Number precision).
 * Sent immediately when enabled; queued (bounded) until enablement otherwise.
 */
export function perfMark(
    name: string,
    attrs?: { [key: string]: string | number | boolean | null },
): void {
    try {
        const now = performance.now();
        const mark: PendingMark = {
            name,
            timestampUnixNs: (
                BigInt(Math.round(performance.timeOrigin + now)) * 1000000n
            ).toString(),
            monotonicNs: (BigInt(Math.round(now * 1000)) * 1000n).toString(),
            attrs,
        };
        if (enabled && rpcRef) {
            performance.mark(name);
            send(mark);
        } else if (pending.length < MAX_PENDING) {
            pending.push(mark);
        }
    } catch {
        // Perf marks must never break the webview.
    }
}

/**
 * Record a mark after the next paint has committed (double
 * requestAnimationFrame, design §17.5) — the honest "visually complete"
 * moment. Runs unconditionally so pre-enablement marks still carry
 * paint-accurate timestamps; the cost is two coalesced rAF callbacks on
 * completion events only.
 */
export function perfMarkAfterNextPaint(
    name: string,
    attrs?: { [key: string]: string | number | boolean | null },
): void {
    perfMarkAfterNextPaintComputed(name, () => attrs);
}

/** Compute diagnostic attributes at the actual post-paint/fallback boundary. */
export function perfMarkAfterNextPaintComputed(
    name: string,
    attrs: () => { [key: string]: string | number | boolean | null } | undefined,
): void {
    // Hidden/backgrounded webviews get their rAF throttled to a standstill
    // (VS Code suspends hidden views) — the 500ms fallback keeps the mark
    // honest-ish (attr says so) instead of silently absent (BOOT-4: warmup
    // reps lost editorInteractive entirely to this).
    let done = false;
    const emit = (throttled: boolean) => {
        if (done) {
            return;
        }
        done = true;
        clearTimeout(fallback);
        const computed = attrs();
        perfMark(name, throttled ? { ...(computed ?? {}), rafThrottled: true } : computed);
    };
    const fallback = setTimeout(() => emit(true), 500);
    requestAnimationFrame(() => {
        requestAnimationFrame(() => emit(false));
    });
}
