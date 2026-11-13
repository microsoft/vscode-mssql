/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OBS_CONTRACT } from "../sharedInterfaces/observabilityContract.generated";
import { createHash } from "crypto";
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
    "perf_heapDeltaKB",
]);
const knownKeys = new Set([
    ...NUMERIC_METADATA,
    "method",
    "password",
    "sql",
    "text",
    ...OBS_CONTRACT.events.flatMap((entry) => Object.keys(entry.attrs)),
]);
/** Unknown field names are untrusted data too. Keep only an opaque correlation key. */
export function importedFieldKey(key: string): string {
    return knownKeys.has(key)
        ? key
        : `field_${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
}
export function validMarkerClock(value: unknown): value is string {
    return (
        typeof value === "string" &&
        /^\d{1,22}$/.test(value) &&
        BigInt(value) <= 8_640_000_000_000_000_000_000n
    );
}
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
        entry?.attrs[key] === "diagnosticMetric" &&
        typeof value === "number" &&
        Number.isFinite(value)
    )
        return "diagnostic.metadata";
    if (
        entry?.attrs[key] === "structuralMetadata" &&
        (value === null || ["string", "number", "boolean"].includes(typeof value))
    ) {
        return "diagnostic.metadata";
    }
    return "secret";
}

const registeredTypes = new Set(
    OBS_CONTRACT.events.flatMap((entry) => (entry.name ? [entry.name] : [])),
);
const stsTypes = new Set([
    "sts.sql.connectionOpen",
    "sts.sql.executeReader",
    "sts.smo.refresh",
    "sts.smo.expand",
    "sts.dacfx.schemaDesigner.createSession",
    "sts.dacfx.schemaDesigner.generateScript",
    "sts.dacfx.schemaDesigner.publish",
    "sts.dacfx.tableDesigner.initialize",
    "sts.dacfx.tableDesigner.processEdit",
    "sts.dacfx.tableDesigner.publish",
    "sts.dacfx.tableDesigner.generateScript",
    "sts.dacfx.tableDesigner.previewReport",
]);
/** Dynamic families retain their family and pairing phase, never untrusted suffix text. */
export function importedEventType(name: string): string {
    if (registeredTypes.has(name) || stsTypes.has(name)) return name;
    const family = OBS_CONTRACT.events.find(
        (entry) => entry.prefix !== undefined && name.startsWith(entry.prefix),
    );
    if (family?.prefix) {
        const phase = /\.(begin|end)$/.exec(name)?.[0] ?? "";
        return family.prefix + "unknown" + phase;
    }
    return "import.unknown";
}
