/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Metric derivation from a rep's marker slice. Durations are honest deltas
 * between real product markers; a metric whose begin/end marker did not appear
 * is simply absent (never fabricated). Timestamps are unix nanoseconds as
 * strings (BigInt-safe).
 */

import type { BusMarker } from "./markerBus";
import type { MetricDef } from "./scenarios";

export interface DerivedMetric {
    name: string;
    value: number;
    unit: string;
    official: boolean;
    lowerIsBetter?: boolean;
}

function firstTs(markers: BusMarker[], name: string): bigint | undefined {
    for (const m of markers) {
        if (m.name === name) {
            try {
                return BigInt(m.timestampUnixNs);
            } catch {
                return undefined;
            }
        }
    }
    return undefined;
}

function msBetween(markers: BusMarker[], begin: string, end: string): number | undefined {
    const a = firstTs(markers, begin);
    const b = firstTs(markers, end);
    if (a === undefined || b === undefined || b < a) {
        return undefined;
    }
    return Number(b - a) / 1e6;
}

/**
 * Derive metric samples for one rep from its marker slice. `scenario.wallclock`
 * comes from scenario.start → scenario.end; named metrics from their declared
 * begin/end markers.
 */
export function deriveMetrics(markers: BusMarker[], defs: MetricDef[]): DerivedMetric[] {
    const out: DerivedMetric[] = [];
    for (const def of defs) {
        let value: number | undefined;
        if (def.name === "scenario.wallclock") {
            value = msBetween(markers, "scenario.start", "scenario.end");
        } else if (def.beginMarker && def.endMarker) {
            value = msBetween(markers, def.beginMarker, def.endMarker);
        }
        if (value === undefined) {
            continue;
        }
        out.push({
            name: def.name,
            value: Number(value.toFixed(2)),
            unit: "ms",
            official: def.official,
            ...(def.lowerIsBetter !== undefined ? { lowerIsBetter: def.lowerIsBetter } : {}),
        });
    }
    return out;
}
