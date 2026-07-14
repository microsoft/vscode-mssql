/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure projection from the registry's passive statusSummary() onto the Debug
 * Console's typed, privacy-safe DcSqlDataPlaneStatus contract (TSQ2 §9). Kept
 * vscode-free so the privacy contract is unit-testable without the extension
 * host: the raw last-error MESSAGE (which can name the server/user) is dropped
 * here — only the typed code, retryability, and SQL error number survive.
 */

import type {
    DcSqlDataPlaneBackendEntry,
    DcSqlDataPlaneStatus,
} from "../../sharedInterfaces/debugConsole";
import type { BackendEntrySnapshot } from "./backendFactory";

export interface SqlDataPlaneObservabilityCounters {
    terminals: number;
    invariantViolations: number;
    droppedAfterTerminal: number;
}

/** Loose shape of SqlDataPlaneService.statusSummary() (Record<string, unknown>). */
export interface RawStatusSummary {
    enabled?: unknown;
    backend?: unknown;
    normalizedBackend?: unknown;
    availability?: unknown;
    activeSessions?: unknown;
    entries?: unknown;
    details?: unknown;
}

export function projectSqlDataPlaneStatus(
    summary: RawStatusSummary,
    observability: SqlDataPlaneObservabilityCounters | undefined,
    nowEpochMs: number,
): DcSqlDataPlaneStatus {
    const availabilityRaw = summary.availability as
        | { state?: string; backend?: string; reason?: string; retryable?: boolean }
        | undefined;
    const entries = (summary.entries as BackendEntrySnapshot[] | undefined) ?? [];
    return {
        capturedEpochMs: nowEpochMs,
        enabled: Boolean(summary.enabled),
        backend: String(summary.backend ?? ""),
        normalizedBackend: String(summary.normalizedBackend ?? ""),
        availability: {
            state: availabilityRaw?.state ?? "unknown",
            ...(availabilityRaw?.backend !== undefined ? { backend: availabilityRaw.backend } : {}),
            ...(availabilityRaw?.reason !== undefined ? { reason: availabilityRaw.reason } : {}),
            ...(availabilityRaw?.retryable !== undefined
                ? { retryable: availabilityRaw.retryable }
                : {}),
        },
        activeSessions: Number(summary.activeSessions ?? 0),
        entries: entries.map(
            (e): DcSqlDataPlaneBackendEntry => ({
                kind: e.kind,
                displayName: e.displayName,
                state: e.state,
                realmClass: e.realmClass,
                activeSessionCount: e.activeSessionCount,
                staleConfig: e.staleConfig,
                // Deliberately NOT spreading e.lastError: its `message` can name
                // the server/user. Only safe, typed fields cross the wire.
                ...(e.lastError !== undefined
                    ? {
                          lastError: {
                              code: e.lastError.code,
                              retryable: e.lastError.retryable,
                              ...(e.lastError.server?.number !== undefined
                                  ? { serverErrorNumber: e.lastError.server.number }
                                  : {}),
                          },
                      }
                    : {}),
            }),
        ),
        ...(observability ? { tsNativeObservability: observability } : {}),
        details: (summary.details as Record<string, unknown> | undefined) ?? {},
    };
}
