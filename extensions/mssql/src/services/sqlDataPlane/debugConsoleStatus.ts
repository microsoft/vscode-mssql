/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure projection from the registry's passive statusSummary() (plus env facts,
 * remembered fallbacks, and the capability matrix) onto the Debug Console's
 * typed, privacy-safe DcSqlDataPlaneStatus contract (TSQ2 §9). Kept vscode-free
 * so the privacy contract is unit-testable without the extension host: the raw
 * last-error MESSAGE (which can name the server/user) is dropped here — only the
 * typed code, retryability, and SQL error number survive.
 */

import type {
    DcSqlDataPlaneBackendEntry,
    DcSqlDataPlaneCapabilityValue,
    DcSqlDataPlaneEnvironment,
    DcSqlDataPlaneStatus,
} from "../../sharedInterfaces/debugConsole";
import type { BackendEntrySnapshot } from "./backendFactory";
import type { SqlCapabilityValue } from "./api";

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

export interface ProjectStatusInput {
    summary: RawStatusSummary;
    nowEpochMs: number;
    observability?: SqlDataPlaneObservabilityCounters;
    environment?: DcSqlDataPlaneEnvironment;
    fallbackPolicy?: string;
    rememberedFallbacks?: ReadonlyArray<{ profileFingerprint: string; backendKind: string }>;
    /** kind -> capabilityId -> value (SqlCapabilityValue is a safe-metadata shape). */
    capabilities?: Record<string, Record<string, SqlCapabilityValue>>;
}

function projectCapabilities(
    capabilities: ProjectStatusInput["capabilities"],
): DcSqlDataPlaneStatus["capabilities"] {
    if (!capabilities) {
        return undefined;
    }
    const out: Record<string, Record<string, DcSqlDataPlaneCapabilityValue>> = {};
    for (const [kind, values] of Object.entries(capabilities)) {
        const perId: Record<string, DcSqlDataPlaneCapabilityValue> = {};
        for (const [id, v] of Object.entries(values)) {
            perId[id] = {
                support: v.support,
                source: v.source,
                ...(v.fidelity !== undefined ? { fidelity: v.fidelity } : {}),
                ...(v.limit !== undefined ? { limit: v.limit } : {}),
                ...(v.unit !== undefined ? { unit: v.unit } : {}),
                ...(v.reasonCode !== undefined ? { reasonCode: v.reasonCode } : {}),
            };
        }
        out[kind] = perId;
    }
    return out;
}

export function projectSqlDataPlaneStatus(input: ProjectStatusInput): DcSqlDataPlaneStatus {
    const { summary } = input;
    const availabilityRaw = summary.availability as
        | { state?: string; backend?: string; reason?: string; retryable?: boolean }
        | undefined;
    const entries = (summary.entries as BackendEntrySnapshot[] | undefined) ?? [];
    return {
        capturedEpochMs: input.nowEpochMs,
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
        ...(input.fallbackPolicy ? { fallbackPolicy: input.fallbackPolicy } : {}),
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
        ...(input.observability ? { tsNativeObservability: input.observability } : {}),
        ...(input.environment ? { environment: input.environment } : {}),
        ...(input.rememberedFallbacks && input.rememberedFallbacks.length > 0
            ? { rememberedFallbacks: input.rememberedFallbacks.map((r) => ({ ...r })) }
            : {}),
        ...(projectCapabilities(input.capabilities)
            ? { capabilities: projectCapabilities(input.capabilities) }
            : {}),
        details: (summary.details as Record<string, unknown> | undefined) ?? {},
    };
}
