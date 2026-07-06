/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Native diagnostics (design 05 §11, B10/LS-2).
 *
 * Tier T1 (errors — lexical/structural certainty): unterminated strings /
 * block comments / delimited identifiers, invalid GO lines ("GO abc" ships to
 * the server as content), unbalanced parentheses where recovery is certain,
 * duplicate exposed source names in one FROM scope.
 *
 * Tier T2 (warnings — binder-backed): invalid object name (208-style),
 * invalid column name (207-style), ambiguous column name (209-style) — under
 * the §11.2 SUPPRESSION LADDER: whenever metadata, the overlay, the database
 * context, or the sketch cannot support an honest claim, the check is
 * suppressed and COUNTED BY REASON. Suppression counts never contain
 * identifier text or document text; only the marker message (which stays in
 * the editor) may quote what the user wrote.
 *
 * The pass is a resumable computation (one step ≈ one statement) so the host
 * scheduler can time-slice whole-document runs and cancel stale versions.
 * Pure — no vscode, no node, no I/O (lint-enforced).
 */

import { SqlDiagnostic, SqlLanguagePosition } from "../api";
import {
    BoundSource,
    StatementBinding,
    SuppressionReason as BinderReason,
    NameResolutionContext,
    bindStatement,
    resolveNameParts,
} from "../core/binder";
import { buildDatabaseContext } from "../core/databaseContext";
import { Token, TokenKind, isTrivia } from "../core/lexer";
import { ScriptOverlay } from "../core/overlay";
import { StatementSegment } from "../core/segmenter";
import { ClauseKind, StatementSketch } from "../core/sketch";
import { IPinnedMetadataView } from "../provider/types";

export const NATIVE_DIAGNOSTIC_SOURCE = "T-SQL (native)";

/**
 * Suppression taxonomy (design §11.2 + local reality). Reasons — never
 * identifier text — are the only per-suppression payload.
 */
export type DiagnosticSuppressionReason =
    | "providerNotReady" // object metadata not fully hydrated / mode not full
    | "columnsNotReady" // column metadata not fully hydrated for a source
    | "databaseNotHydrated" // USE switched to a database the provider has not hydrated
    | "crossDatabaseUnhydrated" // db.schema.object reference outside the pinned database
    | "linkedServer" // 4-part names
    | "opaqueSource" // OPENROWSET, unresolved TVFs, synonyms without shape
    | "dynamicSql" // EXEC('...') / sp_executesql content is invisible
    | "unknownSketchRegion" // sketch cannot name the shape (derived/CTE column set)
    | "unknownOverlayType" // overlay shape untrusted (SELECT INTO, ALTER'd, undeclared @t)
    | "tempTableUnknown" // #temp not visible in the overlay (session may own it)
    | "systemObject" // sys/INFORMATION_SCHEMA/legacy system catalog names
    | "ambiguousName" // object resolution ambiguous — never guess
    | "unresolvedQualifier" // qualifier matches no visible source (multi-part honesty)
    | "quotedIdentifierAmbiguous" // "..." may be a string under QUOTED_IDENTIFIER OFF
    | "setOperationScope" // UNION/EXCEPT/INTERSECT branches share one sketch scope
    | "unsupportedSyntax"; // statement families the binder does not model yet

export interface AnalyzedStatementInput {
    readonly segment: StatementSegment;
    readonly sketch: StatementSketch;
    readonly batchIndex: number;
    /** Global statement ordinal across the document. */
    readonly ordinal: number;
}

export interface DiagnosticsComputeInput {
    readonly text: string;
    readonly tokens: readonly Token[];
    readonly statements: readonly AnalyzedStatementInput[];
    readonly overlay: ScriptOverlay;
    readonly pinned: IPinnedMetadataView;
    readonly positionAt: (offset: number) => SqlLanguagePosition;
}

export interface DiagnosticsPassResult {
    readonly diagnostics: readonly SqlDiagnostic[];
    /** Suppression counts by reason; keys with zero counts are omitted. */
    readonly suppressed: Readonly<Record<string, number>>;
    readonly statementCount: number;
}

/** A resumable whole-document pass; one step is one slice-able work unit. */
export interface DiagnosticsComputation {
    /** Run the next work unit; returns true while more work remains. */
    step(): boolean;
    /** The result — only valid once step() has returned false. */
    result(): DiagnosticsPassResult;
}

/** Convenience driver: run the pass to completion synchronously. */
export function computeDiagnostics(input: DiagnosticsComputeInput): DiagnosticsPassResult {
    const pass = createDiagnostics(input);
    while (pass.step()) {
        // run to completion
    }
    return pass.result();
}

// ---------------------------------------------------------------------------
// Scanner word sets
// ---------------------------------------------------------------------------

/** Clause kinds whose token content is scanned for column references. */
const SCAN_KINDS: ReadonlySet<ClauseKind> = new Set([
    "selectList",
    "where",
    "on",
    "having",
    "groupBy",
    "orderBy",
    "setAssignments",
]);

/** Words that are never column references (not in the keyword map). */
const NEVER_COLUMN_WORDS = new Set(["GROUPING", "SETS", "ROLLUP", "CUBE", "VALUE"]);

/** Functions whose FIRST argument is a datepart/type name, not a column. */
const FIRST_ARG_OPAQUE_FUNCTIONS = new Set([
    "DATEADD",
    "DATEDIFF",
    "DATEDIFF_BIG",
    "DATEPART",
    "DATENAME",
    "DATETRUNC",
    "DATE_BUCKET",
    "CONVERT",
    "TRY_CONVERT",
    "PARSE",
    "TRY_PARSE",
    "TRIM",
]);

/** Keyword ids after which a name chain is not a column reference. */
const SKIP_AFTER_KEYWORDS = new Set(["AS", "FOR", "COLLATE"]);

/** Legacy dbo-visible system catalog names the provider never hydrates. */
const LEGACY_SYSTEM_TABLES = new Set([
    "sysobjects",
    "syscolumns",
    "sysindexes",
    "sysusers",
    "sysdatabases",
    "systypes",
    "sysconstraints",
    "sysreferences",
    "sysdepends",
    "syscomments",
    "sysprocesses",
    "sysfiles",
    "sysfilegroups",
    "sysforeignkeys",
]);

const SYSTEM_SCHEMAS = new Set(["sys", "information_schema"]);

// ---------------------------------------------------------------------------
// Pass implementation
// ---------------------------------------------------------------------------

type ColumnsVerdict =
    | { readonly kind: "columns"; readonly names: ReadonlySet<string> }
    | { readonly kind: "suppress"; readonly reason: DiagnosticSuppressionReason }
    /** Unverifiable but already counted/diagnosed at the source tier. */
    | { readonly kind: "silent" };

/**
 * One name-resolution level: the sources of a single scope. Levels are
 * ordered innermost-out; a name resolves at the first level that knows it,
 * so ambiguity is only claimable WITHIN one level (server scoping rules).
 */
interface VisibilityLevel {
    readonly scopeId: number | undefined;
    readonly sets: readonly ReadonlySet<string>[];
    readonly complete: boolean;
}

interface TargetInfo {
    /** Trusted column names of the DML target, when claimable. */
    readonly columns?: ReadonlySet<string>;
    /** True when a target exists but its columns cannot be claimed. */
    readonly untrusted: boolean;
}

export function createDiagnostics(input: DiagnosticsComputeInput): DiagnosticsComputation {
    const { text, tokens, statements, overlay, pinned, positionAt } = input;
    const caseSensitive = pinned.env.caseSensitive;
    const fold = (value: string): string => (caseSensitive ? value : value.toLowerCase());

    const diagnostics: SqlDiagnostic[] = [];
    const suppressed = new Map<DiagnosticSuppressionReason, number>();
    const databaseContext = buildDatabaseContext(statements);

    const count = (reason: DiagnosticSuppressionReason): void => {
        suppressed.set(reason, (suppressed.get(reason) ?? 0) + 1);
    };

    const report = (
        severity: "error" | "warning",
        start: number,
        end: number,
        message: string,
        code?: string,
    ): void => {
        diagnostics.push({
            range: { start: positionAt(start), end: positionAt(Math.max(end, start)) },
            severity,
            message,
            code,
            source: NATIVE_DIAGNOSTIC_SOURCE,
        });
    };

    // ---- T1: whole-document lexical sweep ----------------------------------

    const runLexicalSweep = (): void => {
        let lineStartClear = true;
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            if (t.unterminated === true) {
                switch (t.kind) {
                    case TokenKind.StringLiteral:
                        report(
                            "error",
                            t.start,
                            t.end,
                            "Unclosed quotation mark after the character string.",
                            "mssql(105)",
                        );
                        break;
                    case TokenKind.BlockComment:
                        report(
                            "error",
                            t.start,
                            t.end,
                            "Missing end comment mark '*/'.",
                            "mssql(113)",
                        );
                        break;
                    case TokenKind.BracketedIdentifier:
                        report(
                            "error",
                            t.start,
                            t.end,
                            "Unclosed bracketed identifier; ']' expected.",
                        );
                        break;
                    case TokenKind.QuotedIdentifier:
                        report(
                            "error",
                            t.start,
                            t.end,
                            "Unclosed quoted identifier; '\"' expected.",
                        );
                        break;
                    default:
                        break;
                }
            }
            if (
                t.kind === TokenKind.Identifier &&
                lineStartClear &&
                t.end - t.start === 2 &&
                text.slice(t.start, t.end).toUpperCase() === "GO" &&
                isInvalidGoLine(text, tokens, i)
            ) {
                report(
                    "error",
                    t.start,
                    t.end,
                    "'GO' followed by other statements or text is not a batch separator; " +
                        "this line is sent to the server as query text.",
                );
            }
            if (t.kind === TokenKind.NewLine) {
                lineStartClear = true;
            } else if (t.kind !== TokenKind.Whitespace) {
                lineStartClear = false;
            }
        }
    };

    // ---- T1: per-statement structure ---------------------------------------

    const checkParenBalance = (s: AnalyzedStatementInput): void => {
        const open: number[] = [];
        for (let i = s.segment.firstToken; i <= s.segment.lastToken; i++) {
            const t = tokens[i];
            if (t === undefined || t.kind !== TokenKind.Punctuation) {
                continue;
            }
            const ch = text.charCodeAt(t.start);
            if (ch === 40 /* ( */) {
                open.push(i);
            } else if (ch === 41 /* ) */) {
                if (open.length === 0) {
                    report("error", t.start, t.end, "Unmatched closing parenthesis.", "mssql(102)");
                } else {
                    open.pop();
                }
            }
        }
        if (open.length > 0) {
            // Only certain when the statement is closed off: another statement
            // follows or it ends with ';'. A trailing unclosed '(' at the end
            // of the document is mid-edit, not an error yet.
            const isLastStatement = s.ordinal === statements.length - 1;
            const lastTok = tokens[s.segment.lastToken];
            const endsWithSemicolon =
                lastTok !== undefined &&
                lastTok.kind === TokenKind.Punctuation &&
                text.charCodeAt(lastTok.start) === 59;
            if (!isLastStatement || endsWithSemicolon) {
                const at = tokens[open[open.length - 1]];
                report(
                    "error",
                    at.start,
                    at.end,
                    "Missing closing parenthesis before the end of the statement.",
                    "mssql(102)",
                );
            }
        }
    };

    const selectListCount = (sketch: StatementSketch, scopeId: number): number => {
        let n = 0;
        for (const clause of sketch.clauses) {
            if (clause.kind === "selectList" && clause.scopeId === scopeId) {
                n++;
            }
        }
        return n;
    };

    const checkDuplicateSourceNames = (s: AnalyzedStatementInput): void => {
        const seen = new Map<string, { label: string; aliased: boolean }>();
        for (const source of s.sketch.sources) {
            // UNION branches share one sketch scope; their FROM clauses are
            // distinct server-side, so exposed-name checks would lie.
            if (selectListCount(s.sketch, source.scopeId) > 1) {
                continue;
            }
            const parts = source.parts.filter((p) => p.length > 0);
            const label = source.alias ?? (parts.length > 0 ? parts[parts.length - 1] : undefined);
            if (label === undefined || label.length === 0) {
                continue;
            }
            const key = `${source.scopeId}|${fold(label)}`;
            const prior = seen.get(key);
            if (prior === undefined) {
                seen.set(key, { label, aliased: source.alias !== undefined });
                continue;
            }
            if (prior.aliased && source.alias !== undefined) {
                report(
                    "error",
                    source.span.start,
                    source.span.end,
                    `The correlation name '${label}' is specified multiple times in a FROM clause.`,
                    "mssql(1011)",
                );
            } else {
                report(
                    "error",
                    source.span.start,
                    source.span.end,
                    `The objects named '${label}' in the FROM clause have the same exposed name. ` +
                        "Use correlation names to distinguish them.",
                    "mssql(1013)",
                );
            }
        }
    };

    // ---- T2 helpers ---------------------------------------------------------

    const nameCtx = (s: AnalyzedStatementInput): NameResolutionContext => ({
        overlay,
        batchIndex: s.batchIndex,
        ordinal: s.ordinal,
        pinned,
        caseSensitive,
    });

    /** Reason mapping for object names the binder could not resolve. */
    const suppressOpaque = (reason: BinderReason, lastPart: string): void => {
        switch (reason) {
            case "notFound":
                if (lastPart.startsWith("#")) {
                    count("tempTableUnknown");
                } else if (lastPart.startsWith("@")) {
                    count("unknownOverlayType");
                } else {
                    count("unknownSketchRegion");
                }
                break;
            case "ambiguous":
                count("ambiguousName");
                break;
            case "providerNotReady":
            case "columnsNotReady":
            case "databaseNotHydrated":
            case "crossDatabaseUnhydrated":
            case "linkedServer":
            case "opaqueSource":
            case "dynamicSql":
            case "unknownSketchRegion":
            case "unknownOverlayType":
                count(reason);
                break;
            default:
                count("unsupportedSyntax");
                break;
        }
    };

    /**
     * Why a notFound object name must be suppressed — or undefined when an
     * "Invalid object name" (208-style) claim is honest.
     */
    const notFoundSuppression = (
        parts: readonly string[],
    ): DiagnosticSuppressionReason | undefined => {
        const last = parts[parts.length - 1];
        if (last.startsWith("#")) {
            return "tempTableUnknown";
        }
        if (last.startsWith("@")) {
            return "unknownOverlayType";
        }
        const schema = parts.length >= 2 ? parts[parts.length - 2] : undefined;
        if (
            (schema !== undefined && SYSTEM_SCHEMAS.has(schema.toLowerCase())) ||
            (schema === undefined && LEGACY_SYSTEM_TABLES.has(last.toLowerCase()))
        ) {
            return "systemObject";
        }
        // A same-named object created ANYWHERE in the script (even later in
        // document order) makes "invalid object" too strong a claim.
        const foldedLast = last.toLowerCase();
        if (overlay.objects.some((o) => o.name.toLowerCase() === foldedLast)) {
            return "unknownOverlayType";
        }
        return undefined;
    };

    /** 208 tier over the statement's FROM sources. */
    const checkSources = (s: AnalyzedStatementInput, binding: StatementBinding): void => {
        for (const source of s.sketch.sources) {
            const bound = binding
                .sourcesAt(source.span.start)
                .find((candidate) => candidate.source === source);
            if (bound === undefined) {
                continue;
            }
            const resolution = bound.resolution;
            if (resolution.kind !== "opaque") {
                continue;
            }
            const parts = source.parts.filter((p) => p.length > 0);
            const last = parts.length > 0 ? parts[parts.length - 1] : "";
            if (source.kind === "openrowset") {
                count("opaqueSource");
                continue;
            }
            if (source.kind === "unknown") {
                count("unknownSketchRegion");
                continue;
            }
            if (source.kind === "tvf") {
                // Unresolved TVFs may be system TVFs (STRING_SPLIT, ...).
                count("opaqueSource");
                continue;
            }
            if (resolution.reason === "notFound" && parts.length > 0) {
                const suppression = notFoundSuppression(parts);
                if (suppression === undefined) {
                    report(
                        "warning",
                        source.span.start,
                        source.span.end,
                        `Invalid object name '${parts.join(".")}'.`,
                        "mssql(208)",
                    );
                } else {
                    count(suppression);
                }
                continue;
            }
            suppressOpaque(resolution.reason, last);
        }
    };

    /** Trusted column names of a bound source, or why they cannot be claimed. */
    const trustedColumnsOf = (binding: StatementBinding, bound: BoundSource): ColumnsVerdict => {
        const resolution = bound.resolution;
        if (resolution.kind === "opaque") {
            return { kind: "silent" }; // counted (or 208-reported) at the source tier
        }
        if (resolution.kind === "catalog") {
            const info = pinned.getObject(resolution.ref);
            if (info === undefined || info.kind === "synonym") {
                return { kind: "suppress", reason: "opaqueSource" };
            }
            if (overlay.alteredNames.has(info.name.toLowerCase())) {
                return { kind: "suppress", reason: "unknownOverlayType" };
            }
            if (pinned.readiness.columns !== "ready") {
                return { kind: "suppress", reason: "columnsNotReady" };
            }
            const columns = pinned.getColumns(resolution.ref);
            if (columns === undefined) {
                return { kind: "suppress", reason: "columnsNotReady" };
            }
            return { kind: "columns", names: new Set(columns.map((c) => fold(c.name))) };
        }
        if (resolution.kind === "overlay") {
            const obj = resolution.overlay;
            if (
                obj.columnsUntyped === true ||
                obj.columns.length === 0 ||
                overlay.alteredNames.has(obj.name.toLowerCase())
            ) {
                return { kind: "suppress", reason: "unknownOverlayType" };
            }
            return { kind: "columns", names: new Set(obj.columns.map(fold)) };
        }
        // cte / derived: claim only fully nameable shapes.
        const columns = binding.columnsOf(bound);
        if (columns === undefined) {
            return { kind: "suppress", reason: "unknownSketchRegion" };
        }
        return { kind: "columns", names: new Set(columns.map((c) => fold(c.name))) };
    };

    /** Resolve the DML target's trusted columns (alias-form aware). */
    const resolveTarget = (s: AnalyzedStatementInput, binding: StatementBinding): TargetInfo => {
        const target = s.sketch.target;
        if (target === undefined) {
            return { untrusted: false };
        }
        const parts = target.parts.filter((p) => p.length > 0);
        if (parts.length === 0) {
            count("unknownSketchRegion");
            return { untrusted: true };
        }
        const last = parts[parts.length - 1];
        if (parts.length === 1) {
            // Alias-form UPDATE/DELETE targets resolve against FROM sources.
            if (target.isAliasForm === true) {
                const viaSource = binding.resolveQualifier(target.span.start, last);
                if (viaSource !== undefined) {
                    const verdict = trustedColumnsOf(binding, viaSource);
                    if (verdict.kind === "columns") {
                        return { columns: verdict.names, untrusted: false };
                    }
                    if (verdict.kind === "suppress") {
                        count(verdict.reason);
                    }
                    return { untrusted: true };
                }
            }
            // Updatable CTEs (any DML kind) — never claim their shape.
            const cte = s.sketch.ctes.find((c) => fold(c.name) === fold(last));
            if (cte !== undefined) {
                count("unknownSketchRegion");
                return { untrusted: true };
            }
        }
        const resolution = resolveNameParts(parts, nameCtx(s));
        if (resolution.kind === "opaque") {
            if (resolution.reason === "notFound") {
                const suppression = notFoundSuppression(parts);
                if (suppression === undefined) {
                    report(
                        "warning",
                        target.span.start,
                        target.span.end,
                        `Invalid object name '${parts.join(".")}'.`,
                        "mssql(208)",
                    );
                } else {
                    count(suppression);
                }
            } else {
                suppressOpaque(resolution.reason, last);
            }
            return { untrusted: true };
        }
        const bound: BoundSource = {
            source: { scopeId: 0, parts, kind: "table", span: target.span },
            resolution,
            label: last,
        };
        const verdict = trustedColumnsOf(binding, bound);
        if (verdict.kind === "columns") {
            return { columns: verdict.names, untrusted: false };
        }
        if (verdict.kind === "suppress") {
            count(verdict.reason);
        }
        return { untrusted: true };
    };

    // ---- T2 column scanner ---------------------------------------------------

    const isNameToken = (t: Token): boolean =>
        t.kind === TokenKind.Identifier ||
        t.kind === TokenKind.BracketedIdentifier ||
        t.kind === TokenKind.QuotedIdentifier ||
        t.kind === TokenKind.TempName ||
        t.kind === TokenKind.GlobalTempName;

    const namePartOf = (t: Token): string => {
        const raw = text.slice(t.start, t.end);
        switch (t.kind) {
            case TokenKind.BracketedIdentifier:
                return raw.slice(1, raw.endsWith("]") ? -1 : undefined).replace(/\]\]/g, "]");
            case TokenKind.QuotedIdentifier:
                return raw.slice(1, raw.endsWith('"') ? -1 : undefined).replace(/""/g, '"');
            default:
                return raw;
        }
    };

    const prevSignificant = (index: number, firstToken: number): Token | undefined => {
        for (let i = index - 1; i >= firstToken; i--) {
            if (!isTrivia(tokens[i].kind)) {
                return tokens[i];
            }
        }
        return undefined;
    };

    /** Innermost clause containing an offset; undefined = outside any clause. */
    const innermostClause = (sketch: StatementSketch, offset: number): ClauseKind | undefined => {
        let best: { kind: ClauseKind; size: number } | undefined;
        for (const clause of sketch.clauses) {
            if (offset >= clause.span.start && offset <= clause.span.end) {
                const size = clause.span.end - clause.span.start;
                if (best === undefined || size < best.size) {
                    best = { kind: clause.kind, size };
                }
            }
        }
        return best?.kind;
    };

    const scanStatementColumns = (
        s: AnalyzedStatementInput,
        binding: StatementBinding,
        targetInfo: TargetInfo,
    ): void => {
        // Per-scope caches for this statement.
        const visibility = new Map<number, readonly VisibilityLevel[]>();
        const aliasSets = new Map<number, Set<string>>();

        const scopeAliases = (scopeId: number): Set<string> => {
            let set = aliasSets.get(scopeId);
            if (set === undefined) {
                set = new Set<string>();
                for (const item of s.sketch.selectItems) {
                    if (item.scopeId === scopeId && item.alias !== undefined) {
                        set.add(fold(item.alias));
                    }
                }
                aliasSets.set(scopeId, set);
            }
            return set;
        };

        const scopeVisibility = (offset: number): readonly VisibilityLevel[] => {
            const scopeId = binding.scopeAt(offset);
            const cached = visibility.get(scopeId);
            if (cached !== undefined) {
                return cached;
            }
            // sourcesAt is ordered innermost scope outward; group by scope.
            const levels: VisibilityLevel[] = [];
            let currentScope: number | undefined;
            let sets: ReadonlySet<string>[] = [];
            let complete = true;
            const flushLevel = (): void => {
                if (currentScope !== undefined) {
                    levels.push({ scopeId: currentScope, sets, complete });
                }
                sets = [];
                complete = true;
            };
            for (const bound of binding.sourcesAt(offset)) {
                if (bound.source.scopeId !== currentScope) {
                    flushLevel();
                    currentScope = bound.source.scopeId;
                }
                const verdict = trustedColumnsOf(binding, bound);
                if (verdict.kind === "columns") {
                    sets.push(verdict.names);
                } else {
                    if (verdict.kind === "suppress") {
                        count(verdict.reason);
                    }
                    complete = false;
                }
            }
            flushLevel();
            // The DML target participates as the outermost resolution level.
            if (targetInfo.columns !== undefined) {
                levels.push({ scopeId: undefined, sets: [targetInfo.columns], complete: true });
            } else if (targetInfo.untrusted) {
                levels.push({ scopeId: undefined, sets: [], complete: false });
            }
            visibility.set(scopeId, levels);
            return levels;
        };

        const checkSinglePart = (headToken: Token, clause: ClauseKind): void => {
            const name = namePartOf(headToken);
            const scopeId = binding.scopeAt(headToken.start);
            if (clause === "orderBy" && scopeAliases(scopeId).has(fold(name))) {
                return; // ORDER BY may reference select-list aliases
            }
            const levels = scopeVisibility(headToken.start);
            if (levels.every((level) => level.sets.length === 0)) {
                return; // no claimable sources at all (mid-edit tolerance)
            }
            // Resolve innermost-out; the first level that knows the name wins.
            for (const level of levels) {
                if (!level.complete) {
                    return; // suppressed — reasons counted at cache build
                }
                let matches = 0;
                for (const set of level.sets) {
                    if (set.has(fold(name))) {
                        matches++;
                    }
                }
                if (matches === 1) {
                    return;
                }
                if (matches >= 2) {
                    if (
                        level.scopeId !== undefined &&
                        selectListCount(s.sketch, level.scopeId) > 1
                    ) {
                        count("setOperationScope");
                        return;
                    }
                    report(
                        "warning",
                        headToken.start,
                        headToken.end,
                        `Ambiguous column name '${name}'.`,
                        "mssql(209)",
                    );
                    return;
                }
            }
            if (headToken.kind === TokenKind.QuotedIdentifier) {
                count("quotedIdentifierAmbiguous");
                return;
            }
            report(
                "warning",
                headToken.start,
                headToken.end,
                `Invalid column name '${name}'.`,
                "mssql(207)",
            );
        };

        const checkQualified = (
            parts: readonly string[],
            headToken: Token,
            lastToken: Token,
        ): void => {
            const qualifier = parts[parts.length - 2];
            const column = parts[parts.length - 1];
            const qualifierFold = qualifier.toLowerCase();
            if (qualifierFold === "inserted" || qualifierFold === "deleted") {
                count("unsupportedSyntax"); // OUTPUT pseudo-sources — not modeled yet
                return;
            }
            const bound = binding.resolveQualifier(headToken.start, qualifier);
            if (bound === undefined) {
                count("unresolvedQualifier");
                return;
            }
            const verdict = trustedColumnsOf(binding, bound);
            if (verdict.kind === "suppress") {
                count(verdict.reason);
                return;
            }
            if (verdict.kind === "silent") {
                return;
            }
            if (!verdict.names.has(fold(column))) {
                if (lastToken.kind === TokenKind.QuotedIdentifier) {
                    count("quotedIdentifierAmbiguous");
                    return;
                }
                report(
                    "warning",
                    lastToken.start,
                    lastToken.end,
                    `Invalid column name '${column}'.`,
                    "mssql(207)",
                );
            }
        };

        let skipNextChain = false;
        let i = s.segment.firstToken;
        while (i <= s.segment.lastToken) {
            const t = tokens[i];
            if (t === undefined || isTrivia(t.kind) || !isNameToken(t)) {
                i++;
                continue;
            }
            const prev = prevSignificant(i, 0);
            if (
                prev !== undefined &&
                prev.kind === TokenKind.Punctuation &&
                text.charCodeAt(prev.start) === 46 /* . */
            ) {
                i++; // mid-chain token; chains are handled from their head
                continue;
            }

            // Read the dotted chain from its head.
            const parts: string[] = [namePartOf(t)];
            const chainTokens: Token[] = [t];
            let j = i + 1;
            let trailingDot = false;
            for (;;) {
                let k = j;
                while (k <= s.segment.lastToken && isTrivia(tokens[k].kind)) {
                    k++;
                }
                const dot = tokens[k];
                if (
                    dot === undefined ||
                    dot.kind !== TokenKind.Punctuation ||
                    text.charCodeAt(dot.start) !== 46
                ) {
                    j = k;
                    break;
                }
                let n = k + 1;
                while (n <= s.segment.lastToken && isTrivia(tokens[n].kind)) {
                    n++;
                }
                const nameTok = tokens[n];
                // A reserved keyword after the dot is mid-edit ("o. FROM"),
                // never a member — a real column would need brackets.
                if (
                    nameTok === undefined ||
                    !isNameToken(nameTok) ||
                    (nameTok.kind === TokenKind.Identifier && nameTok.keyword?.reserved === true)
                ) {
                    trailingDot = true;
                    j = n;
                    break;
                }
                parts.push(namePartOf(nameTok));
                chainTokens.push(nameTok);
                j = n + 1;
            }
            const afterChain = tokens[j];
            const isFunctionCall =
                afterChain !== undefined &&
                afterChain.kind === TokenKind.Punctuation &&
                text.charCodeAt(afterChain.start) === 40; /* ( */

            const headUpper = parts[0].toUpperCase();
            const consumedSkip = skipNextChain;
            skipNextChain = false;

            if (isFunctionCall) {
                const fnName = parts[parts.length - 1].toUpperCase();
                if (FIRST_ARG_OPAQUE_FUNCTIONS.has(fnName)) {
                    skipNextChain = true;
                }
                i = j + 1;
                continue;
            }

            const skip =
                consumedSkip ||
                trailingDot ||
                parts.some((p) => p.length === 0) ||
                // bare temp names are objects, never columns (#t.col is fine)
                (parts.length === 1 &&
                    (t.kind === TokenKind.TempName || t.kind === TokenKind.GlobalTempName)) ||
                // keyword-capable identifiers are structure, not columns
                (parts.length === 1 &&
                    t.kind === TokenKind.Identifier &&
                    t.keyword !== undefined) ||
                (parts.length === 1 && NEVER_COLUMN_WORDS.has(headUpper)) ||
                // alias/junk position: a name right after another expression
                (prev !== undefined &&
                    (prev.kind === TokenKind.BracketedIdentifier ||
                        prev.kind === TokenKind.QuotedIdentifier ||
                        prev.kind === TokenKind.NumberLiteral ||
                        prev.kind === TokenKind.StringLiteral ||
                        prev.kind === TokenKind.Variable ||
                        prev.kind === TokenKind.SystemVariable ||
                        prev.kind === TokenKind.TempName ||
                        prev.kind === TokenKind.GlobalTempName ||
                        prev.kind === TokenKind.Unknown ||
                        (prev.kind === TokenKind.Identifier &&
                            (prev.keyword === undefined ||
                                SKIP_AFTER_KEYWORDS.has(prev.keyword.id))) ||
                        (prev.kind === TokenKind.Punctuation &&
                            text.charCodeAt(prev.start) === 41))); /* ) */

            if (!skip) {
                const clause = innermostClause(s.sketch, t.start);
                if (clause !== undefined && SCAN_KINDS.has(clause)) {
                    if (parts.length === 1) {
                        checkSinglePart(t, clause);
                    } else {
                        checkQualified(parts, t, chainTokens[chainTokens.length - 1]);
                    }
                }
            }
            i = Math.max(j, i + 1);
        }

        // INSERT column lists check against the target's trusted columns.
        const insertColumns = s.sketch.insertColumns;
        if (s.sketch.kind === "insert" && insertColumns !== undefined) {
            if (targetInfo.columns === undefined) {
                if (!targetInfo.untrusted) {
                    count("unknownSketchRegion");
                }
            } else {
                for (let k = s.segment.firstToken; k <= s.segment.lastToken; k++) {
                    const tok = tokens[k];
                    if (
                        tok.start < insertColumns.span.start ||
                        tok.end > insertColumns.span.end ||
                        !isNameToken(tok)
                    ) {
                        continue;
                    }
                    const name = namePartOf(tok);
                    if (!targetInfo.columns.has(fold(name))) {
                        if (tok.kind === TokenKind.QuotedIdentifier) {
                            count("quotedIdentifierAmbiguous");
                            continue;
                        }
                        report(
                            "warning",
                            tok.start,
                            tok.end,
                            `Invalid column name '${name}'.`,
                            "mssql(207)",
                        );
                    }
                }
            }
        }
    };

    // ---- statement unit -------------------------------------------------------

    const runStatement = (s: AnalyzedStatementInput): void => {
        checkParenBalance(s);
        checkDuplicateSourceNames(s);

        // T2 gate ladder (design §11.2) — statement families first.
        const kind = s.sketch.kind;
        if (kind === "merge") {
            count("unsupportedSyntax");
            return;
        }
        if (kind === "exec") {
            const exec = s.sketch.exec;
            if (
                exec === undefined ||
                exec.procParts.length === 0 ||
                exec.procParts[exec.procParts.length - 1].toLowerCase() === "sp_executesql"
            ) {
                count("dynamicSql");
            }
            return;
        }
        if (kind !== "select" && kind !== "insert" && kind !== "update" && kind !== "delete") {
            return;
        }

        // Database context: statements under a USE that moved away from the
        // hydrated database get no binder claims.
        const effectiveDb = databaseContext.effectiveDatabaseAt(s.ordinal);
        const current = pinned.env.currentDatabase;
        if (
            effectiveDb !== undefined &&
            (current === undefined || fold(effectiveDb) !== fold(current))
        ) {
            count("databaseNotHydrated");
            return;
        }

        // Metadata readiness: full object hydration or nothing.
        if (pinned.readiness.objects !== "ready" || pinned.readiness.mode !== "full") {
            count("providerNotReady");
            return;
        }

        const binding = bindStatement({
            text,
            sketch: s.sketch,
            overlay,
            batchIndex: s.batchIndex,
            ordinal: s.ordinal,
            pinned,
            caseSensitive,
        });

        checkSources(s, binding);
        const targetInfo = resolveTarget(s, binding);

        // Column tier requires full column hydration.
        if (pinned.readiness.columns !== "ready") {
            count("columnsNotReady");
            return;
        }
        scanStatementColumns(s, binding, targetInfo);
    };

    // ---- resumable pass -------------------------------------------------------

    let unit = -1; // -1 = lexical sweep, then one unit per statement
    let done = false;

    return {
        step(): boolean {
            if (done) {
                return false;
            }
            if (unit === -1) {
                runLexicalSweep();
                unit = 0;
            } else if (unit < statements.length) {
                runStatement(statements[unit]);
                unit++;
            }
            done = unit >= statements.length;
            return !done;
        },
        result(): DiagnosticsPassResult {
            if (!done) {
                throw new Error("Diagnostics pass has not finished.");
            }
            const suppressedRecord: Record<string, number> = {};
            for (const [reason, n] of suppressed) {
                suppressedRecord[reason] = n;
            }
            return {
                diagnostics,
                suppressed: suppressedRecord,
                statementCount: statements.length,
            };
        },
    };
}

/**
 * Is a line-leading GO word (already NOT a GoSeparator, or the lexer would
 * have said so) a botched batch separator rather than a legal identifier?
 * Exemptions keep keyword-looking identifiers honest (§17.4).
 */
function isInvalidGoLine(text: string, tokens: readonly Token[], goIndex: number): boolean {
    // Next significant token on the SAME line.
    let next: Token | undefined;
    for (let i = goIndex + 1; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.kind === TokenKind.Whitespace) {
            continue;
        }
        if (t.kind === TokenKind.NewLine || t.kind === TokenKind.EndOfFile) {
            break;
        }
        next = t;
        break;
    }
    if (next === undefined) {
        return false; // a clean GO line lexes as GoSeparator; nothing to flag
    }
    if (
        next.kind === TokenKind.Operator ||
        next.kind === TokenKind.Punctuation ||
        next.kind === TokenKind.Unknown
    ) {
        return false; // "go = 1", "go, x", "go:" — expression/label continuations
    }
    // Previous significant token anywhere before (skipping trivia).
    for (let i = goIndex - 1; i >= 0; i--) {
        const t = tokens[i];
        if (isTrivia(t.kind)) {
            continue;
        }
        if (t.kind === TokenKind.Operator || t.kind === TokenKind.Unknown) {
            return false; // continuation of an expression
        }
        if (t.kind === TokenKind.Punctuation) {
            const ch = text.charCodeAt(t.start);
            if (ch === 46 || ch === 44 || ch === 40) {
                return false; // ". go", ", go", "( go" — name positions
            }
        }
        if (t.kind === TokenKind.Identifier && t.keyword?.reserved === true) {
            return false; // "FROM\ngo x", "AS\ngo ..." — name expected here
        }
        break;
    }
    return true;
}
