/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The profiler's filter language.
 *
 * A capture is a firehose, so filtering has to be quick to type and still precise enough to
 * answer a real question. The grammar is the one people already know from issue trackers and
 * mail clients: bare words match anywhere, `field:value` narrows to a field, `-` negates, and
 * numeric fields take comparisons. Everything is ANDed, because that is what people expect when
 * they keep adding words to narrow a search.
 *
 *   order by name              text appearing in any field
 *   "order by name"            that exact phrase
 *   database:master            a field contains a value
 *   event:completed            the event type
 *   duration:>100ms            a numeric field, with units where they make sense
 *   reads:>1000 -app:SQLCMD    several terms, one of them negated
 *
 * Anything that does not parse is treated as plain text rather than rejected, so a half-typed
 * filter narrows progressively instead of erroring at every keystroke.
 */

import { ProfilerEvent } from "./xelParser";

export type Comparison = ">" | ">=" | "<" | "<=" | "=";

export interface FilterTerm {
    /** Field to match, or undefined to match any field and the event name. */
    readonly field?: string;
    /** Text to look for, lowercased. Absent for numeric terms. */
    readonly text?: string;
    /** Numeric comparison, for fields such as duration or reads. */
    readonly compare?: { op: Comparison; value: number };
    readonly negated: boolean;
}

export interface EventFilter {
    readonly terms: readonly FilterTerm[];
    readonly isEmpty: boolean;
}

/**
 * Short names for the fields people filter on most.
 *
 * Extended Events field names are long and inconsistent between event types; an alias means a
 * user can type `app` without knowing whether this session collects `client_app_name`.
 */
export const FIELD_ALIASES: Readonly<Record<string, readonly string[]>> = {
    text: ["batch_text", "statement", "sql_text"],
    sql: ["batch_text", "statement", "sql_text"],
    statement: ["batch_text", "statement", "sql_text"],
    db: ["database_name"],
    database: ["database_name"],
    app: ["client_app_name"],
    application: ["client_app_name"],
    host: ["client_hostname"],
    user: ["username", "server_principal_name"],
    login: ["server_principal_name", "username"],
    session: ["session_id"],
    spid: ["session_id"],
    duration: ["duration"],
    cpu: ["cpu_time"],
    reads: ["logical_reads"],
    writes: ["writes"],
    rows: ["row_count"],
    error: ["error_number"],
    result: ["result"],
};

/** Fields compared as numbers rather than text. */
const NUMERIC_FIELDS = new Set([
    "duration",
    "cpu_time",
    "logical_reads",
    "physical_reads",
    "page_server_reads",
    "writes",
    "spills",
    "row_count",
    "session_id",
    "error_number",
    "severity",
]);

/** Fields whose raw unit is microseconds, so a bare `ms` or `s` has to be converted. */
const MICROSECOND_FIELDS = new Set(["duration", "cpu_time"]);

/** `event:` is not a field on the event, it is the event's own name. */
const EVENT_NAME_KEY = "event";

export function parseFilter(input: string): EventFilter {
    const terms: FilterTerm[] = [];
    for (const token of tokenize(input)) {
        const term = parseTerm(token);
        if (term) {
            terms.push(term);
        }
    }
    return { terms, isEmpty: terms.length === 0 };
}

/** Splits on whitespace, keeping quoted phrases together. */
function tokenize(input: string): string[] {
    const tokens: string[] = [];
    let current = "";
    let quote: string | undefined;

    for (const ch of input) {
        if (quote) {
            if (ch === quote) {
                quote = undefined;
            } else {
                current += ch;
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (/\s/.test(ch)) {
            if (current.length > 0) {
                tokens.push(current);
                current = "";
            }
            continue;
        }
        current += ch;
    }
    if (current.length > 0) {
        tokens.push(current);
    }
    return tokens;
}

function parseTerm(token: string): FilterTerm | undefined {
    let rest = token;
    let negated = false;
    if (rest.startsWith("-") && rest.length > 1) {
        negated = true;
        rest = rest.slice(1);
    }

    const colon = rest.indexOf(":");
    if (colon === rest.length - 1 && colon > 0) {
        // `duration:` on the way to `duration:>100ms`. An incomplete term contributes nothing,
        // so the grid keeps its rows while someone is still typing rather than emptying and
        // refilling at every keystroke.
        return undefined;
    }
    if (colon <= 0) {
        return rest.length > 0 ? { text: rest.toLowerCase(), negated } : undefined;
    }

    const field = rest.slice(0, colon).toLowerCase();
    const value = rest.slice(colon + 1);

    const comparison = parseComparison(value, field);
    if (comparison) {
        return { field, compare: comparison, negated };
    }
    return { field, text: value.toLowerCase(), negated };
}

/** Parses `>100ms`, `<=5`, `=0` and the like for numeric fields. */
function parseComparison(
    value: string,
    field: string,
): { op: Comparison; value: number } | undefined {
    const match = /^(>=|<=|>|<|=)?\s*(\d+(?:\.\d+)?)\s*(us|ms|s|k|m)?$/i.exec(value);
    if (!match) {
        return undefined;
    }
    const [, rawOp, rawNumber, rawUnit] = match;
    // A field:number with no operator is a text match unless the field is numeric, so
    // `session:73` still behaves the way someone typing an id expects.
    if (!rawOp && !rawUnit && !isNumericTarget(field)) {
        return undefined;
    }

    let n = Number(rawNumber);
    const unit = rawUnit?.toLowerCase();
    if (unit === "ms") {
        n *= isMicrosecondTarget(field) ? 1000 : 1;
    } else if (unit === "s") {
        n *= isMicrosecondTarget(field) ? 1_000_000 : 1;
    } else if (unit === "k") {
        n *= 1000;
    } else if (unit === "m") {
        n *= 1_000_000;
    }

    return { op: (rawOp as Comparison) ?? "=", value: n };
}

function resolveFields(field: string): readonly string[] {
    return FIELD_ALIASES[field] ?? [field];
}

function isNumericTarget(field: string): boolean {
    return resolveFields(field).some((f) => NUMERIC_FIELDS.has(f));
}

function isMicrosecondTarget(field: string): boolean {
    return resolveFields(field).some((f) => MICROSECOND_FIELDS.has(f));
}

/** True when the event satisfies every term. */
export function matchesFilter(event: ProfilerEvent, filter: EventFilter): boolean {
    for (const term of filter.terms) {
        const hit = matchesTerm(event, term);
        if (hit === term.negated) {
            return false;
        }
    }
    return true;
}

function matchesTerm(event: ProfilerEvent, term: FilterTerm): boolean {
    if (term.field === undefined) {
        return matchesAnywhere(event, term.text ?? "");
    }

    if (term.field === EVENT_NAME_KEY) {
        return term.text !== undefined && event.name.toLowerCase().includes(term.text);
    }

    for (const field of resolveFields(term.field)) {
        const raw = event.values[field];
        if (raw === undefined) {
            continue;
        }
        if (term.compare) {
            const n = Number(raw);
            if (Number.isFinite(n) && compare(n, term.compare.op, term.compare.value)) {
                return true;
            }
            continue;
        }
        if (term.text !== undefined && raw.toLowerCase().includes(term.text)) {
            return true;
        }
    }
    return false;
}

function matchesAnywhere(event: ProfilerEvent, needle: string): boolean {
    if (needle.length === 0) {
        return true;
    }
    if (event.name.toLowerCase().includes(needle)) {
        return true;
    }
    for (const value of Object.values(event.values)) {
        if (value && value.toLowerCase().includes(needle)) {
            return true;
        }
    }
    return false;
}

function compare(actual: number, op: Comparison, expected: number): boolean {
    switch (op) {
        case ">":
            return actual > expected;
        case ">=":
            return actual >= expected;
        case "<":
            return actual < expected;
        case "<=":
            return actual <= expected;
        case "=":
            return actual === expected;
    }
}

/** Examples shown in the filter's help, kept next to the grammar they document. */
export const FILTER_EXAMPLES: readonly { syntax: string; meaning: string }[] = [
    { syntax: "order by", meaning: "Text appearing in any field" },
    { syntax: '"order by name"', meaning: "That exact phrase" },
    { syntax: "db:master", meaning: "A field contains a value" },
    { syntax: "event:completed", meaning: "The event type" },
    { syntax: "duration:>100ms", meaning: "Slower than 100 ms" },
    { syntax: "reads:>1k", meaning: "More than 1,000 logical reads" },
    { syntax: "-app:SQLCMD", meaning: "Exclude matches" },
];
