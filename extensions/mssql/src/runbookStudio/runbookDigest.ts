/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from "crypto";

/** Deterministic JSON for security and lifecycle identity digests. */
export function canonicalRunbookJson(value: unknown): string {
    return JSON.stringify(sortValue(value)) ?? "null";
}

/** Full, labeled SHA-256 over canonical JSON. */
export function digestRunbookValue(value: unknown): string {
    return `sha256:${crypto
        .createHash("sha256")
        .update(canonicalRunbookJson(value), "utf8")
        .digest("hex")}`;
}

function sortValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((entry) => (entry === undefined ? null : sortValue(entry)));
    }
    if (value !== null && typeof value === "object") {
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>).sort((a, b) =>
            a.localeCompare(b),
        )) {
            const entry = (value as Record<string, unknown>)[key];
            if (entry !== undefined) {
                sorted[key] = sortValue(entry);
            }
        }
        return sorted;
    }
    return value;
}
