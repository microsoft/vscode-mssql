/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TextChange, TextRange } from "../text/index.js";
import type {
    SqlCmdArgument,
    SqlCmdConnectionRegion,
    SqlCmdDiagnostic,
    SqlCmdDirective,
    SqlCmdDocumentSnapshot,
    SqlCmdHost,
    SqlCmdIncludeDependency,
    SqlCmdIncludeState,
    SqlCmdMapping,
    SqlCmdVariableDefinition,
    SqlCmdVariableReference,
} from "./contracts.js";
import { defaultSqlCmdPolicy } from "./contracts.js";
import { ImmutableSqlCmdSnapshot } from "./sqlCmdSnapshot.js";
import {
    isValidVariableName,
    scanSqlCmdLines,
    type ScannedArgument,
    type ScannedDirective,
    type ScannedLine,
} from "./sqlCmdScanner.js";

/**
 * The fold state recorded at the start of one root line.
 *
 * Everything a line can change is either a counter into an append-only output array or an
 * immutable value, so resuming a fold is a truncation plus an assignment. That is what makes an
 * incremental update produce output identical to a full one.
 */
export interface FoldCheckpoint {
    readonly projectedLength: number;
    readonly partCount: number;
    readonly mappingCount: number;
    readonly directiveCount: number;
    readonly definitionCount: number;
    readonly referenceCount: number;
    readonly includeCount: number;
    readonly diagnosticCount: number;
    readonly regionCount: number;
    readonly includeCharacters: number;
    readonly regionStart: number;
    readonly variables: ReadonlyMap<string, string>;
    readonly pendingRegion: PendingRegion;
}

export interface PendingRegion {
    readonly index: number;
    readonly server?: string;
    readonly connectionId?: string;
    readonly displayName?: string;
    readonly directive?: SqlCmdDirective;
}

export interface FoldState {
    variables: ReadonlyMap<string, string>;
    readonly parts: string[];
    projectedLength: number;
    readonly mappings: SqlCmdMapping[];
    readonly directives: SqlCmdDirective[];
    readonly definitions: SqlCmdVariableDefinition[];
    readonly references: SqlCmdVariableReference[];
    readonly includes: SqlCmdIncludeDependency[];
    readonly diagnostics: SqlCmdDiagnostic[];
    readonly regions: SqlCmdConnectionRegion[];
    regionStart: number;
    pendingRegion: PendingRegion;
    includeCharacters: number;
}

/**
 * Builds immutable SQLCMD document snapshots.
 *
 * The service never opens a file, connects to a server, runs a command, or reads an environment
 * variable. A host supplies already-loaded include text and a connection lookup; anything the
 * service cannot answer becomes a SQLCMD diagnostic rather than a guess, and unresolved text is
 * projected exactly as written so it can never become a phantom SQL object.
 */
export class SqlCmdDocumentService {
    private readonly _scans = new Map<
        string,
        { readonly text: string; readonly lines: readonly ScannedLine[] }
    >();

    public constructor(private readonly _host: SqlCmdHost = {}) {}

    /** Reads a document from scratch. */
    public parse(uri: string, version: number, text: string): SqlCmdDocumentSnapshot {
        const lines = scanSqlCmdLines(text);
        return this.build(uri, version, text, lines, undefined, 0, "full", lines.length);
    }

    /**
     * Reads a document again after an edit.
     *
     * Scanning is line-local and the fold is a left-to-right accumulation, so both resume from the
     * checkpoint before the first changed line. Everything after that line is recomputed, because a
     * `:setvar`, a `:connect`, or a `:r` on it changes the state every later line reads.
     */
    public update(
        previous: SqlCmdDocumentSnapshot,
        version: number,
        text: string,
        changes: readonly TextChange[],
    ): SqlCmdDocumentSnapshot {
        if (!(previous instanceof ImmutableSqlCmdSnapshot)) {
            return this.parse(previous.uri, version, text);
        }
        let firstChange = Number.POSITIVE_INFINITY;
        for (const change of changes) firstChange = Math.min(firstChange, change.start);
        if (!Number.isFinite(firstChange)) firstChange = 0;

        // Resume at the line containing the edit. Its own scan is invalid, so the reusable prefix
        // ends at the previous line.
        let resumeLine = 0;
        while (
            resumeLine < previous.lines.length &&
            previous.lines[resumeLine]!.next <= firstChange
        ) {
            resumeLine++;
        }
        const prefix = previous.lines.slice(0, resumeLine);
        const offset = prefix.at(-1)?.next ?? 0;
        const suffix = scanSqlCmdLines(text.slice(offset));
        const shifted = offset === 0 ? suffix : suffix.map((line) => shiftLine(line, offset));
        const lines = prefix.length === 0 ? shifted : [...prefix, ...shifted];
        return this.build(
            previous.uri,
            version,
            text,
            lines,
            previous,
            resumeLine,
            "incremental",
            shifted.length,
        );
    }

    private build(
        uri: string,
        version: number,
        text: string,
        lines: readonly ScannedLine[],
        previous: ImmutableSqlCmdSnapshot | undefined,
        resumeLine: number,
        mode: "full" | "incremental",
        rescannedLines: number,
    ): SqlCmdDocumentSnapshot {
        const checkpoint =
            previous && resumeLine > 0 ? previous.checkpoints[resumeLine] : undefined;
        const state: FoldState =
            checkpoint && previous
                ? {
                      variables: checkpoint.variables,
                      parts: previous.parts.slice(0, checkpoint.partCount),
                      projectedLength: checkpoint.projectedLength,
                      mappings: previous.mappings.slice(0, checkpoint.mappingCount),
                      directives: previous.directives.slice(0, checkpoint.directiveCount),
                      definitions: previous.variableDefinitions.slice(
                          0,
                          checkpoint.definitionCount,
                      ),
                      references: previous.variableReferences.slice(0, checkpoint.referenceCount),
                      includes: previous.includes.slice(0, checkpoint.includeCount),
                      diagnostics: previous.diagnostics.slice(0, checkpoint.diagnosticCount),
                      regions: previous.connectionRegions.slice(0, checkpoint.regionCount),
                      regionStart: checkpoint.regionStart,
                      pendingRegion: checkpoint.pendingRegion,
                      includeCharacters: checkpoint.includeCharacters,
                  }
                : {
                      variables: seedVariables(this._host),
                      parts: [],
                      projectedLength: 0,
                      mappings: [],
                      directives: [],
                      definitions: [],
                      references: [],
                      includes: [],
                      diagnostics: [],
                      regions: [],
                      regionStart: 0,
                      pendingRegion: { index: 0 },
                      includeCharacters: 0,
                  };
        const checkpoints: FoldCheckpoint[] =
            checkpoint && previous ? previous.checkpoints.slice(0, resumeLine) : [];
        if (!checkpoint) {
            // Values supplied outside the document are recorded once, before any line runs.
            for (const [name, value] of state.variables) {
                state.definitions.push({
                    name,
                    value,
                    origin: "seed",
                    range: { start: 0, end: 0 },
                    documentUri: uri,
                });
            }
        }
        const startLine = checkpoint ? resumeLine : 0;
        for (let index = startLine; index < lines.length; index++) {
            checkpoints[index] = {
                projectedLength: state.projectedLength,
                partCount: state.parts.length,
                mappingCount: state.mappings.length,
                directiveCount: state.directives.length,
                definitionCount: state.definitions.length,
                referenceCount: state.references.length,
                includeCount: state.includes.length,
                diagnosticCount: state.diagnostics.length,
                regionCount: state.regions.length,
                includeCharacters: state.includeCharacters,
                regionStart: state.regionStart,
                variables: state.variables,
                pendingRegion: state.pendingRegion,
            };
            this.foldLine(state, uri, text, lines[index]!, 0, new Set([uri]));
        }
        closeRegion(state, state.projectedLength);
        return new ImmutableSqlCmdSnapshot(
            uri,
            version,
            text,
            state,
            lines,
            checkpoints,
            mode,
            rescannedLines,
        );
    }

    private foldLine(
        state: FoldState,
        documentUri: string,
        text: string,
        line: ScannedLine,
        depth: number,
        stack: ReadonlySet<string>,
    ): void {
        const directive = line.directive;
        if (!directive) {
            this.projectSqlLine(state, documentUri, text, line);
            return;
        }
        const published = this.publishDirective(state, documentUri, directive);
        if (directive.kind === "go") {
            this.projectGoLine(state, documentUri, text, line, directive);
            return;
        }
        switch (directive.kind) {
            case "setvar":
                this.applySetVar(state, documentUri, published, directive);
                break;
            case "include":
                this.applyInclude(state, documentUri, published, depth, stack);
                break;
            case "connect":
                this.applyConnect(state, published);
                break;
            case "shell":
                const allowed = (this._host.policy ?? defaultSqlCmdPolicy).allowShellCommands;
                state.diagnostics.push({
                    code: allowed ? "SqlCmdShellCommandNotExecuted" : "SqlCmdShellCommandDisabled",
                    message: allowed
                        ? "A '!!' shell command is allowed by host policy but is never executed by the language service."
                        : "A '!!' shell command is disabled by host policy and was not executed.",
                    severity: allowed ? "information" : "warning",
                    range: directive.keywordRange,
                    documentUri,
                });
                break;
            default:
                break;
        }
        if (directive.malformed) {
            state.diagnostics.push({
                code: directive.malformed.code,
                message: directive.malformed.message,
                severity: directive.kind === "unknown" ? "warning" : "error",
                range: directive.malformed.range,
                documentUri,
            });
        }
        // A directive line contributes no SQL. Its line break is projected so the statements around
        // it stay separated, and the mapping keeps the whole directive addressable from the result.
        appendSubstituted(state, documentUri, directive.range, lineBreakOf(text, line));
    }

    private publishDirective(
        state: FoldState,
        documentUri: string,
        directive: ScannedDirective,
    ): SqlCmdDirective {
        const args = directive.rawArguments.map((argument) =>
            this.substituteArgument(state, documentUri, argument),
        );
        const published: SqlCmdDirective = {
            kind: directive.kind,
            keyword: directive.keyword,
            range: directive.range,
            keywordRange: directive.keywordRange,
            arguments: Object.freeze(args),
            documentUri,
            ...(directive.batchCount === undefined ? {} : { batchCount: directive.batchCount }),
        };
        state.directives.push(published);
        return published;
    }

    private substituteArgument(
        state: FoldState,
        documentUri: string,
        argument: ScannedArgument,
    ): SqlCmdArgument {
        if (argument.secret || argument.text.length === 0) {
            return {
                value: "",
                range: argument.range,
                quoted: argument.quoted,
                secret: argument.secret,
            };
        }
        const value = argument.text.replaceAll(/\$\((\w+)\)/gu, (whole, name: string) => {
            const resolved = state.variables.get(normalizeVariableName(name));
            state.references.push({
                name,
                range: argument.range,
                documentUri,
                resolved: resolved !== undefined,
            });
            return resolved ?? whole;
        });
        return { value, range: argument.range, quoted: argument.quoted, secret: false };
    }

    private applySetVar(
        state: FoldState,
        documentUri: string,
        published: SqlCmdDirective,
        directive: ScannedDirective,
    ): void {
        const name = published.arguments[0]?.value ?? "";
        if (!isValidVariableName(name)) {
            state.diagnostics.push({
                code: "SqlCmdInvalidVariableName",
                message:
                    name.length === 0
                        ? "':setvar' requires a variable name."
                        : `'${name}' is not a valid SQLCMD variable name.`,
                severity: "error",
                range: published.arguments[0]?.range ?? directive.keywordRange,
                documentUri,
            });
            return;
        }
        const key = normalizeVariableName(name);
        const next = new Map(state.variables);
        if (published.arguments.length < 2) {
            next.delete(key);
        } else {
            const value = published.arguments
                .slice(1)
                .map((argument) => argument.value)
                .join(" ");
            next.set(key, value);
            state.definitions.push({
                name,
                value,
                origin: "setvar",
                range: published.range,
                documentUri,
            });
        }
        state.variables = next;
    }

    private applyConnect(state: FoldState, published: SqlCmdDirective): void {
        const server = published.arguments[0]?.value;
        if (!server) {
            state.diagnostics.push({
                code: "SqlCmdMalformedDirective",
                message: "':connect' requires a server name.",
                severity: "error",
                range: published.keywordRange,
                documentUri: published.documentUri,
            });
            return;
        }
        // A new region begins here. The regions already closed keep the connection they were
        // written under, so typing a later ':connect' never re-points earlier statements.
        closeRegion(state, state.projectedLength);
        const resolved = this._host.connections?.resolve(server, published.arguments);
        state.pendingRegion = {
            index: state.pendingRegion.index + 1,
            server,
            ...(resolved ? { connectionId: resolved.id, displayName: resolved.displayName } : {}),
            directive: published,
        };
        state.regionStart = state.projectedLength;
        if (!resolved && this._host.connections) {
            state.diagnostics.push({
                code: "SqlCmdUnknownConnection",
                message: "The connection named by ':connect' is not available to the editor.",
                severity: "warning",
                range: published.keywordRange,
                documentUri: published.documentUri,
            });
        }
    }

    private applyInclude(
        state: FoldState,
        documentUri: string,
        published: SqlCmdDirective,
        depth: number,
        stack: ReadonlySet<string>,
    ): void {
        const policy = this._host.policy ?? defaultSqlCmdPolicy;
        const reference = published.arguments
            .map((argument) => argument.value)
            .join(" ")
            .trim();
        const range = published.range;
        const record = (uri: string | undefined, includeState: SqlCmdIncludeState): void => {
            state.includes.push({
                ...(uri === undefined ? {} : { uri }),
                parentUri: documentUri,
                reference,
                range,
                state: includeState,
                depth,
            });
        };
        const report = (
            code: string,
            message: string,
            severity: SqlCmdDiagnostic["severity"] = "warning",
        ): void => {
            state.diagnostics.push({ code, message, severity, range, documentUri });
        };
        if (reference.length === 0 || /\$\(\w+\)/u.test(reference)) {
            record(undefined, "unresolvedReference");
            report(
                "SqlCmdUnresolvedInclude",
                reference.length === 0
                    ? "':r' requires a file to include."
                    : "The file named by ':r' still contains an unresolved SQLCMD variable.",
                "error",
            );
            return;
        }
        if (depth >= policy.maximumIncludeDepth) {
            record(undefined, "depthExceeded");
            report(
                "SqlCmdIncludeDepthExceeded",
                `Includes are nested more than ${policy.maximumIncludeDepth} deep.`,
                "error",
            );
            return;
        }
        if (state.includes.length >= policy.maximumIncludeCount) {
            record(undefined, "countExceeded");
            report(
                "SqlCmdIncludeCountExceeded",
                `A document may include at most ${policy.maximumIncludeCount} files.`,
                "error",
            );
            return;
        }
        const store = this._host.includes;
        const uri = store?.resolve(reference, documentUri);
        if (!store || !uri) {
            record(undefined, "missing");
            report("SqlCmdIncludeUnavailable", "The file named by ':r' could not be resolved.");
            return;
        }
        if (stack.has(uri)) {
            record(uri, "cycle");
            report(
                "SqlCmdIncludeCycle",
                "The file named by ':r' includes itself, directly or indirectly.",
                "error",
            );
            return;
        }
        const entry = store.get(uri);
        if (!entry || entry.state !== "loaded") {
            const includeState: SqlCmdIncludeState = entry?.state ?? "loading";
            record(uri, includeState);
            if (includeState === "loading") {
                report(
                    "SqlCmdIncludeLoading",
                    "The file named by ':r' has not been read yet.",
                    "information",
                );
            } else if (includeState === "denied") {
                report(
                    "SqlCmdIncludeDenied",
                    "The file named by ':r' could not be read with the current permissions.",
                );
            } else {
                report(
                    "SqlCmdIncludeUnavailable",
                    entry?.message ?? "The file named by ':r' could not be read.",
                );
            }
            return;
        }
        if (state.includeCharacters + entry.text.length > policy.maximumIncludeCharacters) {
            record(uri, "sizeExceeded");
            report(
                "SqlCmdIncludeSizeExceeded",
                `Included files exceed the ${policy.maximumIncludeCharacters} character budget.`,
                "error",
            );
            return;
        }
        state.includeCharacters += entry.text.length;
        state.includes.push({
            uri,
            parentUri: documentUri,
            reference,
            range,
            state: "loaded",
            depth,
            characters: entry.text.length,
        });
        const nested = new Set(stack);
        nested.add(uri);
        for (const line of this.scanCached(uri, entry.text)) {
            this.foldLine(state, uri, entry.text, line, depth + 1, nested);
        }
    }

    private scanCached(uri: string, text: string): readonly ScannedLine[] {
        // Includes can change without changing length, so content identity—not length—is required
        // to prevent stale directives and variable references.
        const cached = this._scans.get(uri);
        if (cached?.text === text) return cached.lines;
        const lines = scanSqlCmdLines(text);
        // Bound the cache so a long session cannot retain every include it ever read.
        if (this._scans.size >= 64) this._scans.clear();
        this._scans.set(uri, { text, lines });
        return lines;
    }

    private projectGoLine(
        state: FoldState,
        documentUri: string,
        text: string,
        line: ScannedLine,
        directive: ScannedDirective,
    ): void {
        // `GO` stays in the projection because the SQL layer owns batch separation. A repeat count
        // is SQLCMD's own, so it is dropped and its substitution records where it came from.
        const keywordEnd = directive.keywordRange.end;
        appendVerbatim(state, documentUri, text, { start: line.start, end: keywordEnd });
        if (keywordEnd < line.end) {
            appendSubstituted(state, documentUri, { start: keywordEnd, end: line.end }, "");
        }
        appendVerbatimBreak(state, documentUri, text, line);
    }

    private projectSqlLine(
        state: FoldState,
        documentUri: string,
        text: string,
        line: ScannedLine,
    ): void {
        let cursor = line.start;
        for (const reference of line.references) {
            const value = state.variables.get(normalizeVariableName(reference.name));
            if (cursor < reference.range.start) {
                appendVerbatim(state, documentUri, text, {
                    start: cursor,
                    end: reference.range.start,
                });
            }
            state.references.push({
                name: reference.name,
                range: reference.range,
                documentUri,
                resolved: value !== undefined,
            });
            if (value === undefined) {
                // Unresolved text is kept exactly as written. Substituting an empty string would
                // manufacture SQL the author never wrote and produce phantom object diagnostics.
                state.diagnostics.push({
                    code: "SqlCmdUnresolvedVariable",
                    message: `The SQLCMD variable '${reference.name}' has no value.`,
                    severity: "error",
                    range: reference.range,
                    documentUri,
                });
                appendVerbatim(state, documentUri, text, reference.range);
            } else {
                appendSubstituted(state, documentUri, reference.range, value);
            }
            cursor = reference.range.end;
        }
        if (cursor < line.end) {
            appendVerbatim(state, documentUri, text, { start: cursor, end: line.end });
        }
        appendVerbatimBreak(state, documentUri, text, line);
    }
}

function appendVerbatimBreak(
    state: FoldState,
    documentUri: string,
    text: string,
    line: ScannedLine,
): void {
    if (line.next <= line.end || line.end >= text.length) return;
    appendVerbatim(state, documentUri, text, {
        start: line.end,
        end: Math.min(line.next, text.length),
    });
}

function appendVerbatim(
    state: FoldState,
    documentUri: string,
    text: string,
    range: TextRange,
): void {
    if (range.end <= range.start) return;
    const value = text.slice(range.start, range.end);
    state.parts.push(value);
    state.mappings.push({
        projectedStart: state.projectedLength,
        projectedEnd: state.projectedLength + value.length,
        documentUri,
        sourceStart: range.start,
        sourceEnd: range.end,
        substituted: false,
    });
    state.projectedLength += value.length;
}

function appendSubstituted(
    state: FoldState,
    documentUri: string,
    range: TextRange,
    value: string,
): void {
    state.parts.push(value);
    state.mappings.push({
        projectedStart: state.projectedLength,
        projectedEnd: state.projectedLength + value.length,
        documentUri,
        sourceStart: range.start,
        sourceEnd: range.end,
        substituted: true,
    });
    state.projectedLength += value.length;
}

function seedVariables(host: SqlCmdHost): ReadonlyMap<string, string> {
    const seeds = host.variableSeeds;
    if (!seeds || seeds.size === 0) return emptyVariables;
    const result = new Map<string, string>();
    for (const [name, value] of seeds) result.set(normalizeVariableName(name), value);
    return result;
}

const emptyVariables: ReadonlyMap<string, string> = Object.freeze(new Map<string, string>());

/** SQLCMD matches variable names without regard to case. */
function normalizeVariableName(name: string): string {
    return name.toUpperCase();
}

function lineBreakOf(text: string, line: ScannedLine): string {
    return line.next > line.end && line.end < text.length
        ? text.slice(line.end, Math.min(line.next, text.length))
        : "";
}

function closeRegion(state: FoldState, projectedEnd: number): void {
    const pending = state.pendingRegion;
    state.regions.push({
        index: pending.index,
        range: { start: state.regionStart, end: projectedEnd },
        ...(pending.server === undefined ? {} : { server: pending.server }),
        ...(pending.connectionId === undefined ? {} : { connectionId: pending.connectionId }),
        ...(pending.displayName === undefined ? {} : { displayName: pending.displayName }),
        ...(pending.directive === undefined ? {} : { directive: pending.directive }),
    });
}

function shiftLine(line: ScannedLine, offset: number): ScannedLine {
    return {
        start: line.start + offset,
        end: line.end + offset,
        next: line.next + offset,
        ...(line.directive ? { directive: shiftDirective(line.directive, offset) } : {}),
        references: line.references.map((reference) => ({
            name: reference.name,
            range: shiftRange(reference.range, offset),
        })),
    };
}

function shiftDirective(directive: ScannedDirective, offset: number): ScannedDirective {
    return {
        ...directive,
        keywordRange: shiftRange(directive.keywordRange, offset),
        range: shiftRange(directive.range, offset),
        rawArguments: directive.rawArguments.map((argument) => ({
            ...argument,
            range: shiftRange(argument.range, offset),
        })),
        ...(directive.malformed
            ? {
                  malformed: {
                      ...directive.malformed,
                      range: shiftRange(directive.malformed.range, offset),
                  },
              }
            : {}),
    };
}

function shiftRange(range: TextRange, offset: number): TextRange {
    return { start: range.start + offset, end: range.end + offset };
}
