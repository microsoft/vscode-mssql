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
import { productionClock } from "./driver/tdsDriver";
import { TediousDriver, TEDIOUS_DRIVER_VERSION } from "./driver/tediousDriver";
import { TsNativeBackend, TsNativeDeadlines } from "./tsNativeBackend";
import { EngineObserver, EngineSlicePolicy } from "./queryEngine";

export interface TsNativeProviderOptions {
    deadlines?: Partial<TsNativeDeadlines>;
    slice?: EngineSlicePolicy;
    observer?: EngineObserver;
    lossyPreview?: boolean;
}

export interface TsNativeProviderModule {
    driverName: "tedious";
    driverVersion: string;
    createBackend(options?: TsNativeProviderOptions): ISqlConnectionService;
}

let idCounter = 0;

export function createBackend(options?: TsNativeProviderOptions): ISqlConnectionService {
    return new TsNativeBackend({
        driver: new TediousDriver(),
        clock: productionClock(),
        ids: {
            next: (prefix) => `${prefix}-${Date.now().toString(36)}-${(++idCounter).toString(36)}`,
        },
        ...(options?.deadlines ? { deadlines: options.deadlines } : {}),
        ...(options?.slice ? { slice: options.slice } : {}),
        ...(options?.observer ? { observer: options.observer } : {}),
        ...(options?.lossyPreview !== undefined ? { lossyPreview: options.lossyPreview } : {}),
        probeOnOpen: true,
    });
}

export const driverName = "tedious" as const;
export const driverVersion: string = TEDIOUS_DRIVER_VERSION;
