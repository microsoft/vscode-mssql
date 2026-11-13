/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SQLCMD preprocessor (SQLCMD_MODE_PLAN.md §3.1): the client-side analog of
 * STS's ManagedBatchParser SQLCMD path. Pure module — no vscode, no fs;
 * includes and environment variables come in through seams.
 *
 * Command-set parity with STS (the six things that actually function):
 * GO [n] (left in batch text — splitBatches handles it downstream), :setvar,
 * $(var) substitution, :r include, :on error exit|ignore, :connect. The
 * remaining sqlcmd commands are recognized then rejected ("Command not
 * supported"), and unknown :commands are errors — exactly like STS's parser
 * (Parser.cs ParseLines), never silently ignored.
 *
 * STS semantics copied deliberately:
 * - variable lookup: :setvar table (case-insensitive) first, then process
 *   env (seam); an undefined $(var) is FATAL for the whole parse
 *   (ThrowOnUnresolvedVariable=true in ExecutionEngine).
 * - :setvar name with no value REMOVES the variable.
 * - directives are only recognized when the line STARTS in code region —
 *   a ":" line inside a multi-line string/comment is content, not a command
 *   (tracked with the same scanLine lexer the GO splitter uses).
 * - substitution applies everywhere on a line, including inside strings and
 *   comments (documented sqlcmd quirk), but region tracking uses the RAW
 *   line, matching STS where the lexer sees original tokens.
 *
 * Privacy: this module never logs. Callers must keep variable names/values,
 * file paths, and server names out of diagnostics (counts only).
 */

import { scanLine } from "./batchSplitter";

export type SqlcmdErrorCode =
    | "unsupportedCommand"
    | "unrecognizedCommand"
    | "badSyntax"
    | "variableNotDefined"
    | "invalidVariableName"
    | "includeFailed"
    | "circularInclude"
    | "includeDepthExceeded";

export interface SqlcmdBatchStep {
    kind: "batch";
    text: string;
    /** 0-based line offset of the step's first line within the INPUT text. */
    startLine: number;
}

export interface SqlcmdConnectStep {
    kind: "connect";
    server: string;
    user?: string;
    /** Never log or surface; exists only to build an auth closure. */
    password?: string;
    line: number;
}

export interface SqlcmdOnErrorStep {
    kind: "onError";
    action: "exit" | "ignore";
    line: number;
}

export type SqlcmdStep = SqlcmdBatchStep | SqlcmdConnectStep | SqlcmdOnErrorStep;

export interface SqlcmdStats {
    setvars: number;
    includes: number;
    connects: number;
    onErrors: number;
    substitutions: number;
}

export interface SqlcmdSeams {
    /** Environment variable lookup (STS falls back to process env). */
    env?(name: string): string | undefined;
    /**
     * Resolve + read an :r include. Returns the RESOLVED path (circularity
     * identity) and content, or undefined when unreadable. Absent seam =
     * every :r fails honestly.
     */
    readInclude?(rawPath: string): { path: string; text: string } | undefined;
}

/**
 * String discriminant (house style): this repo compiles with strict:false,
 * where truthiness narrowing on boolean-literal discriminants does not work —
 * `kind === "..."` comparisons always narrow.
 */
export type SqlcmdParseResult =
    | { kind: "script"; steps: SqlcmdStep[]; stats: SqlcmdStats }
    | { kind: "parseError"; line: number; code: SqlcmdErrorCode; message: string };

/** STS LexerTokenType commands that parse but are not supported (Parser.cs:425). */
const UNSUPPORTED_COMMANDS = new Set([
    "ed",
    "error",
    "exit",
    "help",
    "list",
    "listvar",
    "out",
    "perftrace",
    "quit",
    "reset",
    "serverlist",
    "xml",
]);

const INCLUDE_DEPTH_LIMIT = 16;

interface LineEntry {
    text: string;
    /** 0-based line in the ORIGINAL input; included lines carry the :r line. */
    docLine: number;
}

interface ParseContext {
    steps: SqlcmdStep[];
    stats: SqlcmdStats;
    vars: Map<string, string>;
    segment: LineEntry[];
    lexState: ReturnType<typeof scanLine>;
    seams: SqlcmdSeams;
    includeStack: string[];
    error?: { line: number; code: SqlcmdErrorCode; message: string };
}

function fail(ctx: ParseContext, line: number, code: SqlcmdErrorCode, message: string): void {
    ctx.error ??= { line, code, message };
}

function flushSegment(ctx: ParseContext): void {
    if (ctx.segment.length === 0) {
        return;
    }
    const lines = ctx.segment;
    ctx.segment = [];
    if (lines.every((entry) => entry.text.trim().length === 0)) {
        return;
    }
    ctx.steps.push({
        kind: "batch",
        text: lines.map((entry) => entry.text).join("\n"),
        startLine: lines[0].docLine,
    });
}

/**
 * $(var) substitution over one line. Names are [A-Za-z0-9_]+; an unclosed
 * "$(", an empty/invalid name, or an undefined variable is fatal (STS).
 */
function substituteLine(ctx: ParseContext, line: string, docLine: number): string | undefined {
    if (!line.includes("$(")) {
        return line;
    }
    let out = "";
    let i = 0;
    while (i < line.length) {
        const start = line.indexOf("$(", i);
        if (start < 0) {
            out += line.slice(i);
            break;
        }
        out += line.slice(i, start);
        const close = line.indexOf(")", start + 2);
        if (close < 0) {
            fail(ctx, docLine, "invalidVariableName", "Unclosed $( variable reference.");
            return undefined;
        }
        const name = line.slice(start + 2, close);
        if (!/^[A-Za-z0-9_]+$/.test(name)) {
            fail(ctx, docLine, "invalidVariableName", `Invalid variable name "$(${name})".`);
            return undefined;
        }
        const value = ctx.vars.get(name.toLowerCase()) ?? ctx.seams.env?.(name);
        if (value === undefined) {
            fail(ctx, docLine, "variableNotDefined", `Variable ${name} is not defined.`);
            return undefined;
        }
        ctx.stats.substitutions++;
        out += value;
        i = close + 1;
    }
    return out;
}

/** Strip one pair of outer double quotes (STS UnquoteVariableValue). */
function unquote(token: string): string {
    if (token.length >= 2 && token.startsWith('"') && token.endsWith('"')) {
        return token.slice(1, -1);
    }
    return token;
}

/** Split directive arguments on whitespace, honoring "quoted tokens". */
function tokenizeArgs(raw: string): string[] | undefined {
    const tokens: string[] = [];
    const pattern = /"[^"]*"|\S+/g;
    let consumed = 0;
    for (const match of raw.matchAll(pattern)) {
        const at = match.index ?? 0;
        const before = raw.slice(consumed, at);
        if (before.trim().length > 0) {
            return undefined; // stray quote fragments
        }
        tokens.push(match[0]);
        consumed = at + match[0].length;
    }
    if (raw.slice(consumed).trim().length > 0) {
        return undefined;
    }
    return tokens;
}

function parseSetvar(ctx: ParseContext, args: string, docLine: number): void {
    const tokens = tokenizeArgs(args);
    if (!tokens || tokens.length === 0 || tokens.length > 2) {
        fail(ctx, docLine, "badSyntax", "Syntax: :setvar name [value]");
        return;
    }
    const name = tokens[0];
    if (!/^[A-Za-z0-9_]+$/.test(name)) {
        fail(ctx, docLine, "invalidVariableName", `Invalid variable name "${name}".`);
        return;
    }
    ctx.stats.setvars++;
    if (tokens.length === 1) {
        ctx.vars.delete(name.toLowerCase()); // STS: no value removes the var
        return;
    }
    ctx.vars.set(name.toLowerCase(), unquote(tokens[1]));
}

function parseOnError(ctx: ParseContext, args: string, docLine: number): void {
    const match = /^error\s+(exit|ignore)\s*$/i.exec(args.trim());
    if (!match) {
        fail(ctx, docLine, "badSyntax", "Syntax: :on error exit | :on error ignore");
        return;
    }
    flushSegment(ctx);
    ctx.stats.onErrors++;
    ctx.steps.push({
        kind: "onError",
        action: match[1].toLowerCase() as "exit" | "ignore",
        line: docLine,
    });
}

function parseConnect(ctx: ParseContext, args: string, docLine: number): void {
    const tokens = tokenizeArgs(args);
    if (!tokens || tokens.length === 0) {
        fail(ctx, docLine, "badSyntax", "Syntax: :connect server [-U user] [-P password]");
        return;
    }
    let server: string | undefined;
    let user: string | undefined;
    let password: string | undefined;
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token === "-U" || token === "-P") {
            const value = tokens[i + 1];
            if (value === undefined || value.startsWith("-")) {
                fail(ctx, docLine, "badSyntax", `Missing value for ${token}.`);
                return;
            }
            if (token === "-U") {
                user = unquote(value);
            } else {
                password = unquote(value);
            }
            i++;
        } else if (server === undefined) {
            server = unquote(token);
        } else {
            fail(ctx, docLine, "badSyntax", "Syntax: :connect server [-U user] [-P password]");
            return;
        }
    }
    if (!server) {
        fail(ctx, docLine, "badSyntax", "Syntax: :connect server [-U user] [-P password]");
        return;
    }
    flushSegment(ctx);
    ctx.stats.connects++;
    ctx.steps.push({
        kind: "connect",
        server,
        ...(user !== undefined ? { user } : {}),
        ...(password !== undefined ? { password } : {}),
        line: docLine,
    });
}

function parseInclude(ctx: ParseContext, args: string, docLine: number): void {
    const tokens = tokenizeArgs(args);
    if (!tokens || tokens.length !== 1) {
        fail(ctx, docLine, "badSyntax", "Syntax: :r filename");
        return;
    }
    const rawPath = unquote(tokens[0]);
    if (ctx.includeStack.length >= INCLUDE_DEPTH_LIMIT) {
        fail(ctx, docLine, "includeDepthExceeded", "Include nesting is too deep.");
        return;
    }
    const resolved = ctx.seams.readInclude?.(rawPath);
    if (!resolved) {
        fail(ctx, docLine, "includeFailed", `Could not read included file "${rawPath}".`);
        return;
    }
    const identity = resolved.path.toLowerCase();
    if (ctx.includeStack.includes(identity)) {
        fail(ctx, docLine, "circularInclude", `Circular :r include of "${rawPath}".`);
        return;
    }
    ctx.stats.includes++;
    ctx.includeStack.push(identity);
    // Included lines splice inline and carry the :r directive's line for
    // error mapping (documented approximation — same shape STS produces).
    processLines(
        ctx,
        resolved.text.split(/\r?\n/).map((text) => ({ text, docLine })),
    );
    ctx.includeStack.pop();
}

function parseDirective(ctx: ParseContext, line: string, docLine: number): void {
    const substituted = substituteLine(ctx, line, docLine);
    if (substituted === undefined) {
        return;
    }
    const match = /^\s*:(\S+)\s*(.*)$/.exec(substituted);
    if (!match) {
        fail(ctx, docLine, "badSyntax", "Malformed sqlcmd command.");
        return;
    }
    const command = match[1].toLowerCase();
    const args = match[2] ?? "";
    // :!! quirk: lexed without a word boundary so ":!!dir" is one token.
    if (command.startsWith("!!")) {
        fail(ctx, docLine, "unsupportedCommand", "The :!! command is not supported.");
        return;
    }
    switch (command) {
        case "setvar":
            parseSetvar(ctx, args, docLine);
            return;
        case "r":
            parseInclude(ctx, args, docLine);
            return;
        case "on":
            parseOnError(ctx, args, docLine);
            return;
        case "connect":
            parseConnect(ctx, args, docLine);
            return;
        default:
            if (UNSUPPORTED_COMMANDS.has(command)) {
                fail(
                    ctx,
                    docLine,
                    "unsupportedCommand",
                    `The :${command} command is not supported.`,
                );
            } else {
                fail(ctx, docLine, "unrecognizedCommand", `Unrecognized command ":${command}".`);
            }
    }
}

function processLines(ctx: ParseContext, lines: LineEntry[]): void {
    for (const entry of lines) {
        if (ctx.error) {
            return;
        }
        const inCode = ctx.lexState.region === "code";
        if (inCode && /^\s*:/.test(entry.text)) {
            parseDirective(ctx, entry.text, entry.docLine);
            continue; // directives are single-line; no region tracking
        }
        const substituted = substituteLine(ctx, entry.text, entry.docLine);
        if (substituted === undefined) {
            return;
        }
        ctx.segment.push({ text: substituted, docLine: entry.docLine });
        // Region tracking walks the RAW line (STS lexes original tokens).
        ctx.lexState = scanLine(entry.text, ctx.lexState);
    }
}

export function parseSqlcmdScript(text: string, seams: SqlcmdSeams = {}): SqlcmdParseResult {
    const ctx: ParseContext = {
        steps: [],
        stats: { setvars: 0, includes: 0, connects: 0, onErrors: 0, substitutions: 0 },
        vars: new Map(),
        segment: [],
        lexState: { region: "code", blockDepth: 0 } as ReturnType<typeof scanLine>,
        seams,
        includeStack: [],
    };
    processLines(
        ctx,
        text.split(/\r?\n/).map((line, index) => ({ text: line, docLine: index })),
    );
    if (ctx.error) {
        return { kind: "parseError", ...ctx.error };
    }
    flushSegment(ctx);
    return { kind: "script", steps: ctx.steps, stats: ctx.stats };
}

/**
 * Known sqlcmd directive heads for scan-and-detect (framework rule SC-4):
 * both the functional set and the recognized-but-rejected set — a file full
 * of :out/:exit is still a sqlcmd file.
 */
export const SQLCMD_DIRECTIVE_HEADS: ReadonlySet<string> = new Set([
    "setvar",
    "r",
    "on",
    "connect",
    ...UNSUPPORTED_COMMANDS,
]);
