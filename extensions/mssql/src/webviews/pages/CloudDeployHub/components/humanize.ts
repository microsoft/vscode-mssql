/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { locConstants } from "../../../common/locConstants";

/**
 * Human-friendly labels for the machine identifiers that flow through the hub —
 * validation type slugs and diagnostic event types. The dashboard should read
 * like plain English, not like the wire format, so every surface that would
 * otherwise show `static-analysis` or `validation-run-started` routes through
 * here.
 */

/** Friendly name for a validation type slug, e.g. `static-analysis` -> "Static Analysis". */
export function validationTypeLabel(type: string | undefined): string {
    const strings = locConstants.cloudDeployHub;
    switch (type) {
        case "connectivity":
            return strings.validationConnectivity;
        case "static-analysis":
            return strings.validationStaticAnalysis;
        case "unit-tests":
            return strings.validationUnitTests;
        case "workload-playback":
            return strings.validationWorkloadPlayback;
        default:
            return type ?? "";
    }
}

/** Friendly name for a source-of-truth kind, e.g. `sqlproj` -> "SQL project". */
export function sourceKindLabel(kind: string | undefined): string {
    const strings = locConstants.cloudDeployHub;
    switch (kind) {
        case "sqlproj":
            return strings.sourceKindSqlProj;
        case "dacpac":
            return strings.sourceKindDacpac;
        case "container":
            return strings.sourceKindContainer;
        case "connection":
            return strings.sourceKindConnection;
        default:
            return kind ?? "";
    }
}

/** Title-cases a status slug for display, e.g. `passed` -> "Passed". */
function titleCaseStatus(status: unknown): string {
    if (typeof status !== "string" || status.length === 0) {
        return "";
    }
    return status.charAt(0).toUpperCase() + status.slice(1);
}

/** A read of a diagnostic event's flat payload bag. */
type EventPayload = Record<string, unknown> | undefined;

function payloadOf(event: { readonly payload?: Record<string, unknown> }): EventPayload {
    return event.payload;
}

function num(value: unknown): number | undefined {
    return typeof value === "number" ? value : undefined;
}

/**
 * A friendly, English description of a single diagnostic event for the run
 * timeline — e.g. "Run started" or "Static Analysis finished — Failed (2
 * findings)" instead of `validation-finished` + `validationType=...`.
 */
export function describeEvent(event: {
    readonly type: string;
    readonly payload?: Record<string, unknown>;
}): string {
    const strings = locConstants.cloudDeployHub;
    const p = payloadOf(event);
    switch (event.type) {
        case "validation-run-started":
            return strings.eventRunStarted;
        case "validation-started":
            return strings.eventValidationStarted(
                validationTypeLabel(p?.validationType as string | undefined),
            );
        case "validation-progress":
            return strings.eventValidationProgress(
                validationTypeLabel(p?.validationType as string | undefined),
            );
        case "validation-finished": {
            const label = validationTypeLabel(p?.validationType as string | undefined);
            const status = titleCaseStatus(p?.status);
            const findings = num(p?.findingsCount);
            return strings.eventValidationFinished(label, status, findings ?? 0);
        }
        case "validation-run-finished": {
            const status = titleCaseStatus(p?.status);
            const count = num(p?.validationCount) ?? 0;
            return strings.eventRunFinished(status, count);
        }
        case "run-persisted":
            return strings.eventRunSaved;
        case "run-persist-failed":
            return strings.eventRunSaveFailed;
        default:
            return event.type;
    }
}
