/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Dummy perf-regression delay for the perf-comparison branch.
 *
 * This branch exists only to prove out the perftest harness's regression
 * detection: the measured product scenarios are intentionally made slower here
 * than on the baseline branch. The delays are gated on PERF_MODE=1 exactly like
 * every other perf seam, so when the harness flag is off the product behaves
 * identically (rule #3: flag off => zero behavior change).
 *
 * Each injection site passes a baseline delay; the harness can override every
 * site uniformly via the PERF_SLOWDOWN_MS environment variable (0 disables).
 */

import { Perf } from "./perfTelemetry";

/**
 * Resolve the injected delay (ms) for a slowdown site. Returns 0 (no delay)
 * whenever perf mode is off so the product path is untouched in normal use.
 */
function resolveDelayMs(defaultMs: number): number {
    if (!Perf.enabled) {
        return 0;
    }
    const raw = process.env.PERF_SLOWDOWN_MS;
    if (raw !== undefined && raw !== "") {
        const override = Number(raw);
        if (Number.isFinite(override) && override >= 0) {
            return override;
        }
    }
    return defaultMs;
}

/**
 * Await an intentional slowdown inside a measured interval. No-op unless
 * PERF_MODE=1, so it can be sprinkled on real product paths safely.
 */
export function perfSlowdown(defaultMs: number): Promise<void> {
    const ms = resolveDelayMs(defaultMs);
    if (ms <= 0) {
        return Promise.resolve();
    }
    return new Promise((resolve) => setTimeout(resolve, ms));
}
