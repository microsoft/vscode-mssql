/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OBS_CONTRACT } from "../sharedInterfaces/observabilityContract.generated";
import { DataClassification } from "../sharedInterfaces/diagnostics";
const NUMERIC_METADATA = new Set([
    "count",
    "durationMs",
    "elapsedMs",
    "rowCount",
    "rowsAffected",
    "batchCount",
    "resultSetCount",
    "columnCount",
    "bytes",
    "pid",
    "iteration",
    "repId",
    "error",
    "success",
    "cancelled",
    "diag",
    "warmup",
    "officialEligible",
]);
/** Unknown wire/imported fields never become plaintext, even during elevation. */
export function importClassification(
    key: string,
    value: unknown,
    eventType?: string,
): DataClassification {
    if (
        NUMERIC_METADATA.has(key) &&
        (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)))
    )
        return "diagnostic.metadata";
    if (
        key === "method" &&
        typeof value === "string" &&
        /^[a-zA-Z][\w]*(?:\/[a-zA-Z][\w]*){1,2}$/.test(value)
    )
        return "diagnostic.metadata";
    const entry =
        eventType === undefined
            ? undefined
            : OBS_CONTRACT.events.find(
                  (entry) =>
                      entry.name === eventType ||
                      (entry.prefix !== undefined && eventType.startsWith(entry.prefix)),
              );
    if (
        entry?.attrs[key] === "structuralMetadata" &&
        (value === null || ["string", "number", "boolean"].includes(typeof value))
    ) {
        return "diagnostic.metadata";
    }
    return "secret";
}
