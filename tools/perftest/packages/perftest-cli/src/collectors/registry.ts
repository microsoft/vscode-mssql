/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CollectorCost } from "./types";
import type { PassType } from "@mssqlperf/contracts";

export interface CollectorDescriptor {
    name: string;
    cost: CollectorCost;
    allowedPassTypes: PassType[];
}

const IMPLEMENTED_COLLECTORS: CollectorDescriptor[] = [
    {
        name: "markers",
        cost: "low",
        allowedPassTypes: ["measurement", "diagnostic", "calibration"],
    },
    {
        name: "processSampler",
        cost: "low",
        allowedPassTypes: ["measurement", "diagnostic", "calibration"],
    },
    { name: "stsEnvelopeJournal", cost: "low", allowedPassTypes: ["diagnostic", "calibration"] },
    { name: "sqlServerXEvents", cost: "medium", allowedPassTypes: ["diagnostic"] },
    { name: "dotnetCounters", cost: "low", allowedPassTypes: ["diagnostic", "calibration"] },
    { name: "dotnetTrace", cost: "high", allowedPassTypes: ["diagnostic"] },
    { name: "wprEtw", cost: "high", allowedPassTypes: ["diagnostic"] },
    { name: "cdpExtHostProfile", cost: "medium", allowedPassTypes: ["diagnostic"] },
    { name: "cdpRendererTrace", cost: "high", allowedPassTypes: ["diagnostic"] },
    { name: "cdpRendererProfile", cost: "medium", allowedPassTypes: ["diagnostic"] },
    { name: "heapSnapshots", cost: "high", allowedPassTypes: ["diagnostic"] },
    { name: "gcDump", cost: "high", allowedPassTypes: ["diagnostic"] },
];

export function listCollectors(): CollectorDescriptor[] {
    return [...IMPLEMENTED_COLLECTORS];
}

/** Catalog entries that still have no implementation in runPipeline. */
export const PLANNED_COLLECTORS: Array<{ name: string; milestone: string }> = [
    { name: "otelMinimal", milestone: "future OpenTelemetry integration" },
    { name: "vscodeDiag", milestone: "future VS Code diagnostics integration" },
];
