/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TextRange } from "../text/index.js";

/**
 * SQLCMD is a document and execution mode, not an engine flavor.
 *
 * This layer sits before the T-SQL parser: it owns directives, variables, include dependencies,
 * the SQL it projects, and the map back to whichever file each projected character came from. The
 * Lezer grammar never learns a `:setvar` rule, and this layer never learns T-SQL.
 *
 * Nothing here performs I/O. A host supplies already-loaded include text, variable seeds, and a
 * connection lookup through {@link SqlCmdHost}; the portable service never opens a file, connects
 * to a server, runs a shell command, or reads a process environment variable.
 */
export type SqlCmdDirectiveKind =
    | "go"
    | "setvar"
    | "include"
    | "connect"
    | "onError"
    | "out"
    | "error"
    | "list"
    | "listVar"
    | "reset"
    | "quit"
    | "exit"
    | "editor"
    | "help"
    | "serverList"
    | "shell"
    | "perfTrace"
    | "xmlMode"
    | "unknown";

/** One argument of a directive, as written. */
export interface SqlCmdArgument {
    /**
     * The argument's value with surrounding quotes removed.
     *
     * Empty for an argument marked {@link secret}: a password never leaves the source text, so it
     * cannot reach a diagnostic message, a statistics payload, or a cache key.
     */
    readonly value: string;
    /** The argument's span in its own source document, including quotes. */
    readonly range: TextRange;
    readonly quoted: boolean;
    /** True for the value of a credential switch such as `-P`. */
    readonly secret: boolean;
}

export interface SqlCmdDirective {
    readonly kind: SqlCmdDirectiveKind;
    /** The directive word as written, without the leading colon. */
    readonly keyword: string;
    /** The whole directive line in its source document. */
    readonly range: TextRange;
    /** The directive word's own span, used for completion and hover. */
    readonly keywordRange: TextRange;
    readonly arguments: readonly SqlCmdArgument[];
    /** Which file the directive was written in; an include contributes its own URI. */
    readonly documentUri: string;
    /** The repeat count of `GO n`, when one was written. */
    readonly batchCount?: number;
}

/** Where a variable value came from. Seeds lose to a later `:setvar`, which is SQLCMD's own order. */
export type SqlCmdVariableOrigin = "seed" | "setvar";

export interface SqlCmdVariableDefinition {
    readonly name: string;
    /** Absent for `:setvar name`, which removes the variable. */
    readonly value?: string;
    readonly origin: SqlCmdVariableOrigin;
    readonly range: TextRange;
    readonly documentUri: string;
}

export interface SqlCmdVariableReference {
    readonly name: string;
    /** The whole `$(name)` span in its source document. */
    readonly range: TextRange;
    readonly documentUri: string;
    readonly resolved: boolean;
}

/**
 * A span of projected SQL that runs against one connection.
 *
 * `:connect` opens a new region; it never mutates a previous one, so a range that resolved against
 * the first connection keeps resolving against it after a later `:connect` is typed.
 */
export interface SqlCmdConnectionRegion {
    readonly index: number;
    /** The projected-SQL span this region covers. */
    readonly range: TextRange;
    /** The server named by `:connect`, absent for the region the document opens with. */
    readonly server?: string;
    /** The host's identity for the connection, when it recognized one. */
    readonly connectionId?: string;
    readonly displayName?: string;
    /** The directive that opened the region, absent for the initial region. */
    readonly directive?: SqlCmdDirective;
}

/** Why an include is not part of the projection. */
export type SqlCmdIncludeState =
    | "loaded"
    | "loading"
    | "missing"
    | "denied"
    | "failed"
    | "cycle"
    | "depthExceeded"
    | "countExceeded"
    | "sizeExceeded"
    | "unresolvedReference";

export interface SqlCmdIncludeDependency {
    /** The stable URI the reference resolved to, absent when it could not be resolved at all. */
    readonly uri?: string;
    /** The file containing the `:r`. */
    readonly parentUri: string;
    /** The reference as written, after variable substitution. */
    readonly reference: string;
    readonly range: TextRange;
    readonly state: SqlCmdIncludeState;
    readonly depth: number;
    readonly characters?: number;
}

export interface SqlCmdDiagnostic {
    readonly code: string;
    readonly message: string;
    readonly severity: "error" | "warning" | "information";
    readonly range: TextRange;
    readonly documentUri: string;
}

/**
 * One projected span and the source it came from.
 *
 * `substituted` marks a span whose projected text differs in length from its source — a variable
 * replacement. An offset inside such a span maps to the whole source span rather than to a
 * character position that does not exist.
 */
export interface SqlCmdMapping {
    readonly projectedStart: number;
    readonly projectedEnd: number;
    readonly documentUri: string;
    readonly sourceStart: number;
    readonly sourceEnd: number;
    readonly substituted: boolean;
}

export interface SqlCmdSourceLocation {
    readonly documentUri: string;
    readonly offset: number;
    /** True when the offset landed inside a substitution and names the whole reference instead. */
    readonly approximate: boolean;
}

export interface SqlCmdSourceRange extends TextRange {
    readonly documentUri: string;
    readonly approximate: boolean;
}

/** Loaded include text a host has already read. The portable service performs no I/O itself. */
export type SqlCmdIncludeEntry =
    | { readonly state: "loaded"; readonly text: string }
    | {
          readonly state: "loading" | "missing" | "denied" | "failed";
          /** Shown verbatim in a diagnostic, so it must not contain a credential or a full path. */
          readonly message?: string;
      };

export interface SqlCmdIncludeStore {
    /**
     * Turns a written reference into a stable URI. Pure string work: no file system is touched, so
     * a reference that cannot be expressed as a URI returns `undefined`.
     */
    resolve(reference: string, fromUri: string): string | undefined;
    /** Returns what the host knows about the URI. Never blocks and never performs I/O. */
    get(uri: string): SqlCmdIncludeEntry | undefined;
}

export interface SqlCmdConnectionInfo {
    readonly id: string;
    readonly displayName: string;
}

export interface SqlCmdConnectionResolver {
    /**
     * Identifies the connection a `:connect` names. The arguments are the directive's own, with
     * credential values already blanked, so a resolver cannot receive a password.
     */
    resolve(server: string, options: readonly SqlCmdArgument[]): SqlCmdConnectionInfo | undefined;
}

export interface SqlCmdPolicy {
    readonly maximumIncludeDepth: number;
    readonly maximumIncludeCount: number;
    readonly maximumIncludeCharacters: number;
    /**
     * Whether `!!` is reported as allowed by host policy. It is never executed either way; the
     * portable service has no way to run a command and does not acquire one from this flag.
     */
    readonly allowShellCommands: boolean;
}

export const defaultSqlCmdPolicy: SqlCmdPolicy = Object.freeze({
    maximumIncludeDepth: 16,
    maximumIncludeCount: 64,
    maximumIncludeCharacters: 8 * 1024 * 1024,
    allowShellCommands: false,
});

export interface SqlCmdHost {
    /** Values supplied outside the document, as `sqlcmd -v` does. Never read from the environment. */
    readonly variableSeeds?: ReadonlyMap<string, string>;
    readonly includes?: SqlCmdIncludeStore;
    readonly connections?: SqlCmdConnectionResolver;
    readonly policy?: SqlCmdPolicy;
}

export interface SqlCmdStatistics {
    readonly directiveCount: number;
    readonly variableReferenceCount: number;
    readonly unresolvedVariableCount: number;
    readonly includeCount: number;
    readonly connectionRegionCount: number;
    readonly projectedCharacters: number;
    /** How many source lines the incremental update had to rescan. */
    readonly rescannedLines: number;
    readonly mode: "full" | "incremental";
}

/**
 * The immutable result of reading one SQLCMD document.
 *
 * A document that contains no directive and no variable reference projects its own text unchanged
 * and carries one identity mapping, so an ordinary `.sql` file pays nothing for this layer.
 */
export interface SqlCmdDocumentSnapshot {
    readonly uri: string;
    readonly version: number;
    readonly text: string;
    /** True when the document actually uses SQLCMD syntax. */
    readonly usesSqlCmd: boolean;
    readonly projectedSql: string;
    readonly directives: readonly SqlCmdDirective[];
    readonly variableDefinitions: readonly SqlCmdVariableDefinition[];
    readonly variableReferences: readonly SqlCmdVariableReference[];
    /** The variable values in force at the end of the document. */
    readonly variables: ReadonlyMap<string, string>;
    readonly connectionRegions: readonly SqlCmdConnectionRegion[];
    readonly includes: readonly SqlCmdIncludeDependency[];
    readonly diagnostics: readonly SqlCmdDiagnostic[];
    readonly mappings: readonly SqlCmdMapping[];
    readonly statistics: SqlCmdStatistics;

    /** The source a projected offset came from. */
    toSource(projectedOffset: number): SqlCmdSourceLocation | undefined;
    /** The source span a projected range came from, or several when the range crosses files. */
    toSourceRanges(range: TextRange): readonly SqlCmdSourceRange[];
    /** The projected offset a source offset produced, when that source text was projected at all. */
    toProjected(documentUri: string, offset: number): number | undefined;
    /** The connection region a projected offset belongs to. */
    connectionRegionAt(projectedOffset: number): SqlCmdConnectionRegion | undefined;
}
