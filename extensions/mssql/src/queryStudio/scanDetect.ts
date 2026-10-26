/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Scan-and-detect framework (SQLCMD_MODE_PLAN.md §3.4): a generic "spot
 * check a fixed subset of a just-opened file, run pluggable rules, let the
 * host act on what matched" mechanism. Pure core — no vscode, no IO, no
 * timers; the controller owns scheduling (idle, once per document) and the
 * ACTIONS (prompts, toggles, suppression).
 *
 * Rules declare a SamplingPolicy instead of reading the raw text so a rule
 * can never accidentally chew a 10k-line file: the default policy is the
 * first N lines, and a rule that genuinely needs everything must say so
 * explicitly (fullText carries a maxChars guard for exactly that reason).
 * Text is sliced once per DISTINCT policy, shared across rules.
 */

export type SamplingPolicy =
    | { kind: "headLines"; lines: number }
    | { kind: "fullText"; maxChars?: number };

export interface ScanSample {
    /** The sampled lines, in order. */
    lines: string[];
    /** Total line count of the full text (rules can see what they missed). */
    totalLines: number;
    /** True when the policy clipped the text. */
    truncated: boolean;
}

export interface ScanRule<T = unknown> {
    /** Stable id — appears in diagnostics (rule ids only, never content). */
    id: string;
    sampling: SamplingPolicy;
    /** Pure detection over the sample; undefined = no match. Throws are isolated. */
    detect(sample: ScanSample): T | undefined;
}

export interface ScanMatch<T = unknown> {
    id: string;
    detection: T;
}

export function sampleText(text: string, policy: SamplingPolicy): ScanSample {
    if (policy.kind === "fullText") {
        const maxChars = policy.maxChars ?? Number.POSITIVE_INFINITY;
        const truncated = text.length > maxChars;
        const clipped = truncated ? text.slice(0, maxChars) : text;
        const lines = clipped.split(/\r?\n/);
        return {
            lines,
            totalLines: truncated ? countLines(text) : lines.length,
            truncated,
        };
    }
    const all = text.split(/\r?\n/);
    const lines = all.slice(0, Math.max(0, policy.lines));
    return { lines, totalLines: all.length, truncated: all.length > lines.length };
}

function countLines(text: string): number {
    let count = 1;
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 10) {
            count++;
        }
    }
    return count;
}

function policyKey(policy: SamplingPolicy): string {
    return policy.kind === "headLines"
        ? `head:${policy.lines}`
        : `full:${policy.maxChars ?? "inf"}`;
}

/**
 * Run every rule over its (shared, policy-keyed) sample. A rule that throws
 * is dropped — one bad rule never blocks the others (framework isolation).
 */
export function runScanRules(text: string, rules: readonly ScanRule[]): ScanMatch[] {
    const samples = new Map<string, ScanSample>();
    const matches: ScanMatch[] = [];
    for (const rule of rules) {
        const key = policyKey(rule.sampling);
        let sample = samples.get(key);
        if (!sample) {
            sample = sampleText(text, rule.sampling);
            samples.set(key, sample);
        }
        try {
            const detection = rule.detect(sample);
            if (detection !== undefined) {
                matches.push({ id: rule.id, detection });
            }
        } catch {
            // Rule isolation: detection is best-effort by design.
        }
    }
    return matches;
}
