/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ts-native debug overrides (TSQ2 addendum §11, base design §12.4):
 * `mssql.sqlDataPlane.tsNative.overrides` — a single object setting, unknown
 * keys ignored with a diagnostic, every effective value visible in status.
 *
 * Rules (addendum §11): capability masks turn support OFF, never fabricate
 * support ON; fault profiles are deterministic from `seed` and implemented
 * at the ITdsDriver boundary (same vocabulary for fake and decorated live
 * driver); official perftest passes assert no fault/lossy override is
 * active; settings apply to FUTURE sessions.
 */

import { SqlBackendCapabilities } from "../sqlDataPlane/api";
import { STRUCT_FIELD_TO_CAPABILITY } from "../sqlDataPlane/capabilityRegistry";
import {
    DataPlaneOperationContext,
    ITdsConnection,
    ITdsDriver,
    TdsConnectionObserver,
    TdsOpenRequest,
    TsNativeFaultProfile,
    EngineClock,
} from "./driver/tdsDriver";

export const TS_NATIVE_OVERRIDES_SETTING = "mssql.sqlDataPlane.tsNative.overrides";

/** Capabilities a mask may force OFF (never ON). */
const MASKABLE_CAPABILITIES = new Set([
    "types.vectorBinaryV1",
    "types.spatialWkbV1",
    "types.typedCells",
    "exec.compactRows",
    "auth.entraToken",
]);

export interface TsNativeOverrides {
    pageRows?: number;
    pageBytes?: number;
    maxCellBytes?: number;
    /** Combined heap+external budget in MiB → engine memory breaker. */
    memoryBudgetMiB?: number;
    lossyPreview?: boolean;
    /** Capability ids forced to unsupported (gating-UX testing). */
    capabilityMask?: string[];
    faults?: TsNativeFaultProfile;
    /** Keys present in the raw object but not understood (diagnosed). */
    ignoredKeys?: string[];
}

const KNOWN_KEYS = new Set([
    "pageRows",
    "pageBytes",
    "maxCellBytes",
    "memoryBudgetMiB",
    "lossyPreview",
    "capabilityMask",
    "faults",
]);

export function parseTsNativeOverrides(raw: unknown): TsNativeOverrides {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
    }
    const source = raw as Record<string, unknown>;
    const out: TsNativeOverrides = {};
    const ignored: string[] = [];
    for (const key of Object.keys(source)) {
        if (!KNOWN_KEYS.has(key)) {
            ignored.push(key);
        }
    }
    for (const key of ["pageRows", "pageBytes", "maxCellBytes", "memoryBudgetMiB"] as const) {
        const value = source[key];
        if (typeof value === "number" && Number.isFinite(value) && value > 0) {
            out[key] = Math.floor(value);
        }
    }
    if (source.lossyPreview === true) {
        out.lossyPreview = true;
    }
    if (Array.isArray(source.capabilityMask)) {
        const mask = source.capabilityMask.filter(
            (id): id is string => typeof id === "string" && MASKABLE_CAPABILITIES.has(id),
        );
        const rejected = source.capabilityMask.filter(
            (id) => typeof id === "string" && !MASKABLE_CAPABILITIES.has(id),
        );
        if (mask.length > 0) {
            out.capabilityMask = mask;
        }
        if (rejected.length > 0) {
            ignored.push(...rejected.map((id) => `capabilityMask:${String(id)}`));
        }
    }
    if (source.faults !== null && typeof source.faults === "object") {
        const rawFaults = source.faults as Record<string, unknown>;
        const faults: TsNativeFaultProfile = {
            seed: typeof rawFaults.seed === "number" ? rawFaults.seed : 0,
        };
        const numeric = [
            "openDelayMs",
            "delayEveryPageMs",
            "dropAfterDriverEvents",
            "dropAfterPages",
            "malformedEventAt",
            "memoryPressureAfterBytes",
            "sinkDelayMs",
        ] as const;
        for (const key of numeric) {
            const value = rawFaults[key];
            if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
                faults[key] = value;
            }
        }
        if (
            rawFaults.openFailure === "auth" ||
            rawFaults.openFailure === "network" ||
            rawFaults.openFailure === "timeout"
        ) {
            faults.openFailure = rawFaults.openFailure;
        }
        if (rawFaults.hangOnCancel === true) {
            faults.hangOnCancel = true;
        }
        if (rawFaults.hangOnClose === true) {
            faults.hangOnClose = true;
        }
        if (
            rawFaults.delayEveryRows !== null &&
            typeof rawFaults.delayEveryRows === "object" &&
            typeof (rawFaults.delayEveryRows as { rows?: unknown }).rows === "number" &&
            typeof (rawFaults.delayEveryRows as { ms?: unknown }).ms === "number"
        ) {
            faults.delayEveryRows = rawFaults.delayEveryRows as { rows: number; ms: number };
        }
        out.faults = faults;
    }
    if (ignored.length > 0) {
        out.ignoredKeys = ignored;
    }
    return out;
}

/** True when any override forbidden in official perf passes is active. */
export function hasMeasurementTaintingOverrides(overrides: TsNativeOverrides): boolean {
    return (
        overrides.faults !== undefined ||
        overrides.lossyPreview === true ||
        overrides.capabilityMask !== undefined
    );
}

/** Capability masks turn support OFF only (TSQ2 §11) — never ON. */
export function maskCapabilities(
    base: SqlBackendCapabilities,
    mask: readonly string[],
): SqlBackendCapabilities {
    const masked: SqlBackendCapabilities = { ...base };
    for (const [field, id] of Object.entries(STRUCT_FIELD_TO_CAPABILITY)) {
        if (mask.includes(id)) {
            (masked as unknown as Record<string, boolean>)[field] = false;
        }
    }
    return masked;
}

// ---------------------------------------------------------------------------
// Fault decorator — the SAME fault vocabulary over the live driver
// ---------------------------------------------------------------------------

export function withFaults(
    inner: ITdsDriver,
    faults: TsNativeFaultProfile,
    clock: EngineClock,
): ITdsDriver {
    return {
        name: inner.name,
        version: `${inner.version}+faults`,
        async open(
            request: TdsOpenRequest,
            observer: TdsConnectionObserver,
            context: DataPlaneOperationContext,
        ): Promise<ITdsConnection> {
            if (faults.openDelayMs) {
                await new Promise<void>((resolve) =>
                    clock.setTimeout(resolve, faults.openDelayMs!),
                );
            }
            if (faults.openFailure) {
                const error = new Error(
                    `injected open failure (${faults.openFailure})`,
                ) as Error & {
                    category: string;
                };
                error.category = faults.openFailure === "auth" ? "auth" : faults.openFailure;
                throw error;
            }
            const connection = await inner.open(request, observer, context);
            return decorateConnection(connection, faults);
        },
    };
}

function decorateConnection(
    connection: ITdsConnection,
    faults: TsNativeFaultProfile,
): ITdsConnection {
    let driverEvents = 0;
    return {
        get id() {
            return connection.id;
        },
        get state() {
            return connection.state;
        },
        get serverFacts() {
            return connection.serverFacts;
        },
        execute(request, observer, context) {
            const lease = connection.execute(
                request,
                {
                    onEvent: (event) => {
                        driverEvents++;
                        if (
                            faults.dropAfterDriverEvents !== undefined &&
                            driverEvents > faults.dropAfterDriverEvents
                        ) {
                            connection.destroy("injected drop (dropAfterDriverEvents)");
                            return;
                        }
                        observer.onEvent(event);
                    },
                },
                context,
            );
            if (faults.hangOnCancel) {
                return {
                    ...lease,
                    accepted: lease.accepted,
                    completed: lease.completed,
                    pause: (reason) => lease.pause(reason),
                    resume: (reason) => lease.resume(reason),
                    cancel: async () => ({ delivered: false }), // swallow attention
                };
            }
            return lease;
        },
        close: (context) =>
            faults.hangOnClose ? new Promise<never>(() => undefined) : connection.close(context),
        destroy: (reason) => connection.destroy(reason),
    };
}
