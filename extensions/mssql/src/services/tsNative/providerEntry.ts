/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ts-native provider bundle entry (TSQ2 addendum §4.2-4.3, decision D6).
 * esbuild bundles this file (with tedious inside) to dist/tsNativeProvider.js
 * — a dedicated chunk loaded via computed-path require on FIRST SELECTION of
 * the ts-native backend. Nothing reachable from normal extension activation
 * imports this module or tedious (packaging tests enforce it).
 */

import { ISqlConnectionService } from "../sqlDataPlane/api";
import { ITdsDriver, productionClock } from "./driver/tdsDriver";
import { TediousDriver, TEDIOUS_DRIVER_VERSION } from "./driver/tediousDriver";
import { TS_NATIVE_CAPABILITIES, TsNativeBackend, TsNativeDeadlines } from "./tsNativeBackend";
import { EngineObserver, EngineSlicePolicy } from "./queryEngine";
import { createDiagEngineObserver } from "./observability";
import { productionMemoryReader } from "./memoryBudget";
import {
    TsNativeOverrides,
    hasMeasurementTaintingOverrides,
    maskCapabilities,
    withFaults,
} from "./overrides";

export interface TsNativeProviderOptions {
    deadlines?: Partial<TsNativeDeadlines>;
    slice?: EngineSlicePolicy;
    observer?: EngineObserver;
    lossyPreview?: boolean;
    /** Parsed `mssql.sqlDataPlane.tsNative.overrides` (TSQ2 §11). */
    overrides?: TsNativeOverrides;
}

export interface TsNativeProviderModule {
    driverName: "tedious";
    driverVersion: string;
    createBackend(options?: TsNativeProviderOptions): ISqlConnectionService;
}

let idCounter = 0;

export function createBackend(options?: TsNativeProviderOptions): ISqlConnectionService {
    const clock = productionClock();
    const overrides = options?.overrides;
    let driver: ITdsDriver = new TediousDriver();
    if (overrides?.faults) {
        driver = withFaults(driver, overrides.faults, clock);
    }
    const capabilities = overrides?.capabilityMask
        ? maskCapabilities(TS_NATIVE_CAPABILITIES, overrides.capabilityMask)
        : TS_NATIVE_CAPABILITIES;
    const defaultExecuteOptions =
        overrides &&
        (overrides.pageRows !== undefined ||
            overrides.pageBytes !== undefined ||
            overrides.maxCellBytes !== undefined)
            ? {
                  ...(overrides.pageRows !== undefined ? { pageRows: overrides.pageRows } : {}),
                  ...(overrides.pageBytes !== undefined ? { pageBytes: overrides.pageBytes } : {}),
                  ...(overrides.maxCellBytes !== undefined
                      ? { maxCellBytes: overrides.maxCellBytes }
                      : {}),
              }
            : undefined;
    return new TsNativeBackend({
        driver,
        clock,
        ids: {
            next: (prefix) => `${prefix}-${Date.now().toString(36)}-${(++idCounter).toString(36)}`,
        },
        ...(options?.deadlines ? { deadlines: options.deadlines } : {}),
        ...(options?.slice ? { slice: options.slice } : {}),
        // Diag substrate wiring is the production default (no-op with zero
        // sinks); tests inject their own recorders.
        observer: options?.observer ?? createDiagEngineObserver(),
        ...((options?.lossyPreview ?? overrides?.lossyPreview) ? { lossyPreview: true } : {}),
        capabilities,
        ...(defaultExecuteOptions ? { defaultExecuteOptions } : {}),
        ...(overrides?.memoryBudgetMiB
            ? {
                  memoryBudget: {
                      maxUsedBytes: overrides.memoryBudgetMiB * 1_048_576,
                      sampleEveryMs: 250,
                  },
                  memoryReader: productionMemoryReader(),
              }
            : {}),
        ...(overrides
            ? {
                  overridesSummary: {
                      // Safe facts only; visible in status + support surfaces.
                      active: Object.keys(overrides).filter((k) => k !== "ignoredKeys"),
                      measurementTainting: hasMeasurementTaintingOverrides(overrides),
                      ...(overrides.ignoredKeys?.length
                          ? { ignoredKeys: overrides.ignoredKeys }
                          : {}),
                  },
              }
            : {}),
        probeOnOpen: true,
    });
}

export const driverName = "tedious" as const;
export const driverVersion: string = TEDIOUS_DRIVER_VERSION;
