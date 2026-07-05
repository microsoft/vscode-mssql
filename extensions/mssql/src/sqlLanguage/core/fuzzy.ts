/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Deterministic prefix/fuzzy scoring (design 05 §10.5): explainable, stable,
 * no randomness. Higher is better; undefined = no match (candidate dropped
 * when a prefix exists).
 */

export function matchScore(candidate: string, prefix: string): number | undefined {
    if (prefix.length === 0) {
        return 0;
    }
    const c = candidate.toLowerCase();
    const p = prefix.toLowerCase();
    if (c === p) {
        return 120;
    }
    if (c.startsWith(p)) {
        return 100 - Math.min(20, c.length - p.length);
    }
    // Word-boundary subsequence: every prefix char in order, bonus on
    // boundaries (underscore/camel).
    let ci = 0;
    let boundaryHits = 0;
    for (const ch of p) {
        let found = -1;
        while (ci < c.length) {
            if (c[ci] === ch) {
                found = ci;
                break;
            }
            ci++;
        }
        if (found < 0) {
            return undefined;
        }
        if (found === 0 || c[found - 1] === "_" || candidate[found] !== c[found]) {
            boundaryHits++;
        }
        ci++;
    }
    return 40 + boundaryHits * 5 - Math.min(20, c.length - p.length);
}
