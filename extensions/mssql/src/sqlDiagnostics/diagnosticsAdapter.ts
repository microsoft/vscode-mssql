/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    DataClass,
    DiagEventInput,
    DiagField,
    DiagSpanHandle,
    DiagnosticsPort,
} from "sql-feature/core";

import { DiagnosticsCore, RawField, diag } from "../diagnostics/diagnosticsCore";
import { DataClassification, DiagStatus } from "../sharedInterfaces/diagnostics";

/** The feature name every event from this package is filed under. */
export const SQL_DIAGNOSTICS_FEATURE = "sqlDiagnostics";

/**
 * The package declares what each field contains; this is the single place that turns those
 * declarations into the extension's classifications. Keeping the mapping here means a new
 * field cannot reach a sink without someone having said what it holds.
 */
const classificationFor: Readonly<Record<DataClass, DataClassification>> = {
    system: "system.metadata",
    serverName: "server.name",
    databaseName: "database.name",
    objectName: "object.name",
    sqlText: "sql.text",
    userText: "user.text",
};

/**
 * The package reports "canceled", which the extension's status vocabulary expresses as
 * "partial": the work stopped before finishing rather than failing outright.
 */
function toStatus(status: DiagEventInput["status"]): DiagStatus | undefined {
    switch (status) {
        case "ok":
            return "ok";
        case "error":
            return "error";
        case "canceled":
            return "partial";
        default:
            return undefined;
    }
}

function toRawFields(
    fields: Readonly<Record<string, DiagField>> | undefined,
): Record<string, RawField> | undefined {
    if (!fields) {
        return undefined;
    }
    const mapped: Record<string, RawField> = {};
    for (const [key, field] of Object.entries(fields)) {
        mapped[key] = { raw: field.value, cls: classificationFor[field.cls] ?? "unknown" };
    }
    return mapped;
}

/**
 * Routes the sql-diagnostics package's telemetry into the extension's DiagnosticsCore, where
 * it is redacted according to each field's classification and handed to the configured sinks.
 */
export class DiagnosticsAdapter implements DiagnosticsPort {
    constructor(private readonly core: DiagnosticsCore = diag) {}

    emit(event: DiagEventInput): void {
        this.core.emit({
            feature: SQL_DIAGNOSTICS_FEATURE,
            type: event.type,
            status: toStatus(event.status),
            traceId: event.traceId,
            durationMs: event.durationMs,
            fields: toRawFields(event.fields),
        });
    }

    startSpan(type: string, fields?: Readonly<Record<string, DiagField>>): DiagSpanHandle {
        const span = this.core.startSpan({
            feature: SQL_DIAGNOSTICS_FEATURE,
            type,
            fields: toRawFields(fields),
        });

        return {
            traceId: span.traceId,
            end: (status, endFields) => span.end(toStatus(status), toRawFields(endFields)),
            fail: (error) => span.fail(error),
        };
    }
}
