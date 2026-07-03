/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Runtime loader for the @mssqlperf/inproc package (sibling perftest repo's
 * built dist). Resolution walks UP from this module's location until a
 * `perftest/packages/perftest-inproc/dist/index.js` appears, so it works from
 * every compiled layout (esbuild `dist/`, tsc `out/src/`, unit-test hosts) and
 * degrades gracefully — self-test reports "module not found" instead of taking
 * the whole extension module graph down when the perftest repo isn't built.
 *
 * Types are imported statically (type-only ⇒ erased at compile time).
 */

import * as fs from "fs";
import * as path from "path";

export type InprocModule =
    typeof import("../../../../../../perftest/packages/perftest-inproc/dist/index");

let cached: InprocModule | undefined;
let cachedError: string | undefined;

export function inprocPath(): string | undefined {
    let dir = __dirname;
    for (let depth = 0; depth < 12; depth++) {
        const candidate = path.join(
            dir,
            "perftest",
            "packages",
            "perftest-inproc",
            "dist",
            "index.js",
        );
        try {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        } catch {
            // keep walking
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            break;
        }
        dir = parent;
    }
    return undefined;
}

/** Load (and cache) the in-process runner module; undefined with a reason when absent. */
export function loadInproc(): { module?: InprocModule; error?: string } {
    if (cached) {
        return { module: cached };
    }
    if (cachedError) {
        return { error: cachedError };
    }
    const resolved = inprocPath();
    if (!resolved) {
        cachedError =
            "perftest in-process runner not found — build the sibling perftest repo (npm run build) so packages/perftest-inproc/dist exists";
        return { error: cachedError };
    }
    try {
        // Dynamic path on purpose: resolved at runtime, not bundled.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        cached = require(resolved) as InprocModule;
        return { module: cached };
    } catch (error) {
        cachedError = `perftest in-process runner failed to load from ${resolved}: ${
            error instanceof Error ? error.message : String(error)
        }`;
        return { error: cachedError };
    }
}
