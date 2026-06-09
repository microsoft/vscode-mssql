/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { locConstants } from "../../../common/locConstants";

/**
 * Compact run-start timestamp: time-only when the run started today, otherwise a
 * short month/day plus time. Keeps run rows scannable instead of carrying a full
 * locale date-time string on every row.
 */
export function formatStartedShort(ms: number): string {
    const started = new Date(ms);
    const now = new Date();
    const sameDay =
        started.getFullYear() === now.getFullYear() &&
        started.getMonth() === now.getMonth() &&
        started.getDate() === now.getDate();
    const time = started.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (sameDay) {
        return time;
    }
    const date = started.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
    return `${date}, ${time}`;
}

/**
 * Whole-second run duration, or an em dash when the end time is missing or
 * precedes the start (an in-flight or malformed run).
 */
export function formatDurationSeconds(startedAtMs: number, endedAtMs?: number): string {
    if (!endedAtMs || endedAtMs < startedAtMs) {
        return "—";
    }
    const seconds = Math.max(0, Math.round((endedAtMs - startedAtMs) / 1000));
    return locConstants.cloudDeployHub.durationSeconds(seconds);
}
