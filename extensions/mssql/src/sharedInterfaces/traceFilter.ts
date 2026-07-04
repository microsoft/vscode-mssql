/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Consolidated Trace filter expressions (completions-style live capture):
 *
 *   dur>1000      duration greater than 1000ms   (also dur>=, dur<, dur<=, 1.5s)
 *   proc:sts      process (sts|extension|webview|sql|driver|harness|system)
 *   feat:query    feature bucket
 *   status:error  status
 *   type:submit   free text (joins the text search)
 *   plain words   free text
 *
 * Tokens are ANDed. Pure + shared so the webview and unit tests use the exact
 * same parsing the queries run with.
 */

import { DiagProcess, DiagStatus, EventQuery } from "./debugConsole";

export interface ParsedTraceFilter {
    text?: string;
    processes?: DiagProcess[];
    features?: string[];
    statuses?: DiagStatus[];
    minDurationMs?: number;
    maxDurationMs?: number;
    /** Tokens that could not be parsed (surfaced in the UI, never ignored silently). */
    invalid: string[];
}

const PROCESS_ALIASES: Record<string, DiagProcess> = {
    sts: "sqlToolsService",
    sqltoolsservice: "sqlToolsService",
    extension: "extensionHost",
    ext: "extensionHost",
    extensionhost: "extensionHost",
    webview: "webview",
    renderer: "renderer",
    sql: "sqlServer",
    sqlserver: "sqlServer",
    driver: "harness",
    harness: "harness",
    system: "system",
};

const STATUSES = new Set(["ok", "error", "warning", "info", "blocked", "partial"]);

function parseDuration(raw: string): number | undefined {
    const match = /^(\d+(?:\.\d+)?)(ms|s)?$/i.exec(raw.trim());
    if (!match) {
        return undefined;
    }
    const value = Number(match[1]);
    return match[2]?.toLowerCase() === "s" ? value * 1000 : value;
}

export function parseTraceFilter(input: string): ParsedTraceFilter {
    const out: ParsedTraceFilter = { invalid: [] };
    const words: string[] = [];
    for (const token of input.split(/\s+/).filter(Boolean)) {
        const durMatch = /^dur(>=|<=|>|<)(.+)$/i.exec(token);
        if (durMatch) {
            const ms = parseDuration(durMatch[2]);
            if (ms === undefined) {
                out.invalid.push(token);
                continue;
            }
            const op = durMatch[1];
            if (op === ">" || op === ">=") {
                out.minDurationMs = ms;
            } else {
                out.maxDurationMs = ms;
            }
            continue;
        }
        const kv = /^(proc|process|feat|feature|status|type)\s*:(.*)$/i.exec(token);
        if (kv) {
            const key = kv[1].toLowerCase();
            const value = kv[2].trim();
            if (!value) {
                out.invalid.push(token);
                continue;
            }
            if (key === "proc" || key === "process") {
                const mapped = PROCESS_ALIASES[value.toLowerCase()];
                if (!mapped) {
                    out.invalid.push(token);
                    continue;
                }
                out.processes = [...(out.processes ?? []), mapped];
            } else if (key === "feat" || key === "feature") {
                out.features = [...(out.features ?? []), value];
            } else if (key === "status") {
                if (!STATUSES.has(value.toLowerCase())) {
                    out.invalid.push(token);
                    continue;
                }
                out.statuses = [...(out.statuses ?? []), value.toLowerCase() as DiagStatus];
            } else {
                // type: — joins the text haystack (which includes event type).
                words.push(value);
            }
            continue;
        }
        words.push(token);
    }
    if (words.length > 0) {
        out.text = words.join(" ");
    }
    return out;
}

/** Merge a parsed expression into an EventQuery (expression wins on conflicts). */
export function applyTraceFilter(base: EventQuery, parsed: ParsedTraceFilter): EventQuery {
    return {
        ...base,
        ...(parsed.text ? { text: base.text ? `${base.text} ${parsed.text}` : parsed.text } : {}),
        ...(parsed.processes ? { processes: parsed.processes } : {}),
        ...(parsed.features ? { features: parsed.features } : {}),
        ...(parsed.statuses ? { statuses: parsed.statuses } : {}),
        ...(parsed.minDurationMs !== undefined ? { minDurationMs: parsed.minDurationMs } : {}),
        ...(parsed.maxDurationMs !== undefined ? { maxDurationMs: parsed.maxDurationMs } : {}),
    };
}
