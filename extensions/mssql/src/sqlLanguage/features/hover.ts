/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Native hover (design 05 §12.1, B11/LS-3). Markdown tooltips for the bound
 * symbol under the caret: catalog objects (kind, schema-qualified name,
 * column count + PK badge + FK count WHERE the matching sections are ready),
 * columns (type, nullability, PK/identity/computed badges, FK edge, owning
 * object, H7 description), aliases, variables and EXEC parameters, CTEs,
 * temp tables / table variables (overlay shape ONLY when trustworthy —
 * SELECT INTO shapes drop unaliased column names and ALTER'd shapes are
 * unreliable, so neither claims a column list; B10 finding), routines
 * (signature where parameters are ready), and curated builtins from the
 * data asset.
 *
 * NEVER overclaims: missing/lite/failed metadata yields no hover or a
 * minimal honest one, mirroring the B10 suppression ladder — USE-switched
 * statements get no catalog claims, MERGE column binding is unsupported,
 * ambiguous unqualified names are refused. Identifier text may appear in
 * hover CONTENT (editor-only); telemetry gets only the symbol KIND.
 * Pure: no vscode, no node builtins, no I/O (lint-enforced).
 */

import { HoverResult, SqlLanguagePosition } from "../api";
import { BoundColumn, BoundSource, StatementBinding, resolveNameParts } from "../core/binder";
import { Token, TokenKind, isTrivia, nextSignificant, tokenIndexAt } from "../core/lexer";
import { OverlayObject, ScriptOverlay } from "../core/overlay";
import { CteDecl, SketchSpan, StatementSketch } from "../core/sketch";
import { BuiltinFunctionInfo, TSQL_BUILTIN_FUNCTIONS } from "../data/builtinFunctions.generated";
import {
    IPinnedMetadataView,
    LangDatabase,
    LangObjectInfo,
    LangObjectRef,
} from "../provider/types";

export type HoverSymbolKind =
    | "table"
    | "view"
    | "synonym"
    | "procedure"
    | "scalarFunction"
    | "tableFunction"
    | "column"
    | "selectAlias"
    | "alias"
    | "cte"
    | "tempTable"
    | "tableVariable"
    | "scriptTable"
    | "derived"
    | "variable"
    | "parameter"
    | "builtinFunction"
    | "schema"
    | "database"
    | "none";

export interface HoverComputeInput {
    readonly text: string;
    readonly offset: number;
    readonly tokens: readonly Token[];
    readonly sketch: StatementSketch;
    readonly binding: StatementBinding;
    readonly overlay: ScriptOverlay;
    readonly batchIndex: number;
    readonly ordinal: number;
    readonly pinned: IPinnedMetadataView;
    readonly databases?: readonly LangDatabase[];
    /** Effective database at this statement when a USE precedes it (§4.4). */
    readonly effectiveDatabase?: string;
    readonly positionAt: (offset: number) => SqlLanguagePosition;
}

export interface HoverComputation {
    readonly result: HoverResult | undefined;
    /** Symbol kind for telemetry (never identifier text). */
    readonly symbolKind: HoverSymbolKind;
}

const NONE: HoverComputation = { result: undefined, symbolKind: "none" };

const KIND_WORDS: Record<LangObjectInfo["kind"], string> = {
    table: "table",
    view: "view",
    synonym: "synonym",
    procedure: "procedure",
    scalarFunction: "scalar function",
    tableFunction: "table function",
};

const BUILTIN_BY_NAME = new Map<string, BuiltinFunctionInfo>(
    TSQL_BUILTIN_FUNCTIONS.map((fn) => [fn.name, fn]),
);

function isNameKind(kind: TokenKind): boolean {
    return (
        kind === TokenKind.Identifier ||
        kind === TokenKind.BracketedIdentifier ||
        kind === TokenKind.QuotedIdentifier ||
        kind === TokenKind.TempName ||
        kind === TokenKind.GlobalTempName
    );
}

function namePartText(text: string, t: Token): string {
    const raw = text.slice(t.start, t.end);
    switch (t.kind) {
        case TokenKind.BracketedIdentifier:
            return raw.slice(1, raw.endsWith("]") ? -1 : undefined).replace(/\]\]/g, "]");
        case TokenKind.QuotedIdentifier:
            return raw.slice(1, raw.endsWith('"') ? -1 : undefined).replace(/""/g, '"');
        default:
            return raw;
    }
}

function prevSignificant(tokens: readonly Token[], index: number): number {
    for (let i = index - 1; i >= 0; i--) {
        if (!isTrivia(tokens[i].kind)) {
            return i;
        }
    }
    return -1;
}

interface NameChain {
    readonly parts: readonly string[];
    readonly spans: readonly SketchSpan[];
    /** Which part the caret token is. */
    readonly partIndex: number;
}

/** Read the full dotted chain around the token at `index` (both directions). */
function readChainAround(text: string, tokens: readonly Token[], index: number): NameChain {
    const parts: string[] = [namePartText(text, tokens[index])];
    const spans: SketchSpan[] = [{ start: tokens[index].start, end: tokens[index].end }];
    // Backward: name . name . <caret>
    let i = index;
    for (;;) {
        const dot = prevSignificant(tokens, i);
        if (dot < 0 || text.slice(tokens[dot].start, tokens[dot].end) !== ".") {
            break;
        }
        const name = prevSignificant(tokens, dot);
        if (name < 0 || !isNameKind(tokens[name].kind)) {
            break;
        }
        parts.unshift(namePartText(text, tokens[name]));
        spans.unshift({ start: tokens[name].start, end: tokens[name].end });
        i = name;
    }
    const partIndex = parts.length - 1;
    // Forward: <caret> . name . name
    let j = index;
    for (;;) {
        const dot = nextSignificant(tokens, j + 1);
        if (dot >= tokens.length || text.slice(tokens[dot].start, tokens[dot].end) !== ".") {
            break;
        }
        const name = nextSignificant(tokens, dot + 1);
        if (name >= tokens.length || !isNameKind(tokens[name].kind)) {
            break;
        }
        parts.push(namePartText(text, tokens[name]));
        spans.push({ start: tokens[name].start, end: tokens[name].end });
        j = name;
    }
    return { parts, spans, partIndex };
}

export function computeHover(input: HoverComputeInput): HoverComputation {
    const { text, tokens, offset, pinned } = input;
    const fold = (value: string): string =>
        pinned.env.caseSensitive ? value : value.toLowerCase();

    // USE moved the statement away from the hydrated database: no catalog
    // claims (mirrors the diagnostics databaseNotHydrated suppression).
    const current = pinned.env.currentDatabase;
    const catalogSuppressed =
        input.effectiveDatabase !== undefined &&
        (current === undefined || fold(input.effectiveDatabase) !== fold(current));

    const index = tokenIndexAt(tokens, offset);
    const token = tokens[index];
    if (token === undefined || offset < token.start || offset >= token.end) {
        return NONE;
    }
    if (
        token.kind === TokenKind.LineComment ||
        token.kind === TokenKind.BlockComment ||
        token.kind === TokenKind.StringLiteral ||
        token.kind === TokenKind.SqlCmdDirective ||
        token.kind === TokenKind.NumberLiteral
    ) {
        return NONE;
    }

    const rangeOf = (span: SketchSpan): HoverResult["range"] => ({
        start: input.positionAt(span.start),
        end: input.positionAt(span.end),
    });
    const hover = (
        symbolKind: HoverSymbolKind,
        content: string,
        span: SketchSpan,
    ): HoverComputation => ({
        result: { contentsMarkdown: content, range: rangeOf(span) },
        symbolKind,
    });
    const tokenSpan: SketchSpan = { start: token.start, end: token.end };

    // ---- variables and EXEC parameters ------------------------------------
    if (token.kind === TokenKind.Variable) {
        return variableHover(input, token, fold, catalogSuppressed, hover);
    }
    if (token.kind === TokenKind.SystemVariable) {
        return NONE; // no curated @@-data; never guess (§12.1 honesty)
    }

    // ---- temp tables referenced bare (#t / ##t) ---------------------------
    if (token.kind === TokenKind.TempName || token.kind === TokenKind.GlobalTempName) {
        const name = text.slice(token.start, token.end);
        const obj = input.overlay.findObject(name, input.batchIndex, input.ordinal);
        if (obj === undefined) {
            return NONE; // session may own it — never claim (§11.2 mirror)
        }
        const overlayContent = overlayHover(obj, input.overlay);
        return hover(overlayContent.kind, overlayContent.content, tokenSpan);
    }

    if (!isNameKind(token.kind)) {
        return NONE;
    }

    const chain = readChainAround(text, tokens, index);
    const caretSpan = chain.spans[chain.partIndex];
    const word = chain.parts[chain.partIndex];

    // ---- builtins: NAME( … or a niladic builtin ---------------------------
    if (chain.parts.length === 1) {
        const builtin = BUILTIN_BY_NAME.get(word.toUpperCase());
        if (builtin !== undefined) {
            const after = nextSignificant(tokens, index + 1);
            const isCall =
                after < tokens.length && text.slice(tokens[after].start, tokens[after].end) === "(";
            if (isCall || builtin.niladic === true) {
                return hover("builtinFunction", builtinHoverContent(builtin), caretSpan);
            }
        }
    }

    // ---- caret inside a FROM-clause source name ----------------------------
    const source = input.sketch.sources.find((s) => offset >= s.span.start && offset <= s.span.end);
    if (source !== undefined && source.parts.length > 0) {
        if (chain.partIndex < chain.parts.length - 1) {
            return qualifierHover(input, chain, fold, catalogSuppressed, hover);
        }
        const bound = input.binding
            .sourcesAt(source.span.start)
            .find((candidate) => candidate.source === source);
        if (bound !== undefined) {
            return boundSourceHover(input, bound, caretSpan, fold, catalogSuppressed, hover);
        }
    }

    // ---- single-part alias / source-label references ----------------------
    if (chain.parts.length === 1) {
        const bound = input.binding.resolveQualifier(offset, word);
        if (bound !== undefined) {
            if (bound.source.alias !== undefined && fold(bound.source.alias) === fold(word)) {
                const target = resolutionDisplay(bound, pinned, catalogSuppressed);
                if (target !== undefined) {
                    return hover("alias", "**alias** `" + word + "` = " + target, caretSpan);
                }
                return NONE;
            }
            // Matched a source by its object name — show the object itself.
            return boundSourceHover(input, bound, caretSpan, fold, catalogSuppressed, hover);
        }
    }

    // ---- columns (qualified, then unqualified) -----------------------------
    if (chain.partIndex === chain.parts.length - 1 && input.sketch.kind !== "merge") {
        const columnResult = columnHover(input, chain, fold, catalogSuppressed, hover);
        if (columnResult !== undefined) {
            return columnResult;
        }
    }

    // ---- select-list aliases (ORDER BY / GROUP BY addressability) ---------
    if (chain.parts.length === 1) {
        for (const item of input.sketch.selectItems) {
            if (
                item.alias !== undefined &&
                fold(item.alias) === fold(word) &&
                !(offset >= item.span.start && offset <= item.span.end)
            ) {
                return hover(
                    "selectAlias",
                    "**alias** `" + item.alias + "` (select list)",
                    caretSpan,
                );
            }
        }
    }

    // ---- CTE name references -----------------------------------------------
    if (chain.parts.length === 1) {
        const cte = input.sketch.ctes.find((c) => fold(c.name) === fold(word));
        if (cte !== undefined) {
            return hover("cte", cteHoverContent(input, cte), caretSpan);
        }
    }

    // ---- qualifier parts of longer chains (schema/database/objects) -------
    if (chain.partIndex < chain.parts.length - 1) {
        return qualifierHover(input, chain, fold, catalogSuppressed, hover);
    }

    // ---- general dotted-name resolution (targets, EXEC, DDL, calls) --------
    return generalNameHover(input, chain, fold, catalogSuppressed, hover);
}

// ---------------------------------------------------------------------------
// symbol-family helpers
// ---------------------------------------------------------------------------

type HoverFn = (symbolKind: HoverSymbolKind, content: string, span: SketchSpan) => HoverComputation;

function variableHover(
    input: HoverComputeInput,
    token: Token,
    fold: (v: string) => string,
    catalogSuppressed: boolean,
    hover: HoverFn,
): HoverComputation {
    const { text, pinned } = input;
    const name = text.slice(token.start, token.end);
    const span: SketchSpan = { start: token.start, end: token.end };

    // EXEC named argument (@p = …): parameter facts from metadata win.
    const exec = input.sketch.exec;
    if (exec !== undefined && !catalogSuppressed && pinned.readiness.parameters === "ready") {
        const arg = exec.args.find(
            (a) =>
                a.name !== undefined &&
                fold(a.name) === fold(name) &&
                token.start >= a.span.start &&
                token.start < a.span.start + a.name.length,
        );
        if (arg !== undefined && exec.procParts.length > 0) {
            const resolution = resolveNameParts(exec.procParts, {
                overlay: input.overlay,
                batchIndex: input.batchIndex,
                ordinal: input.ordinal,
                pinned,
                caseSensitive: pinned.env.caseSensitive,
            });
            if (resolution.kind === "catalog") {
                const params = pinned.getParameters(resolution.ref);
                const param = params?.find((p) => fold(p.name) === fold(name));
                const info = pinned.getObject(resolution.ref);
                if (param !== undefined && info !== undefined) {
                    const lines = [
                        "**parameter** `" +
                            param.name +
                            "` — `" +
                            param.typeDisplay +
                            "`" +
                            (param.isOutput ? " OUTPUT" : ""),
                        "`" + info.schema + "." + info.name + "`",
                    ];
                    const description = pinned.getDescription?.(resolution.ref);
                    return hover(
                        "parameter",
                        lines.join("  \n") +
                            (description !== undefined ? "\n\n" + description : ""),
                        span,
                    );
                }
            }
        }
    }

    // Statement-local declaration (DECLARE / module header parameters).
    const decl = input.sketch.declares.find((d) => fold(d.name) === fold(name));
    if (decl !== undefined) {
        if (decl.isTable === true) {
            const obj = input.overlay.findObject(name, input.batchIndex, input.ordinal);
            if (obj !== undefined) {
                const overlayContent = overlayHover(obj, input.overlay);
                return hover(overlayContent.kind, overlayContent.content, span);
            }
            return hover("tableVariable", "**table variable** `" + name + "`", span);
        }
        const head =
            "**variable** `" +
            decl.name +
            "`" +
            (decl.typeText !== undefined ? " — `" + decl.typeText + "`" : "");
        const line = input.positionAt(decl.span.start).line + 1;
        return hover("variable", head + "  \ndeclared at line " + line, span);
    }

    // Batch-visible variable from an earlier statement (overlay).
    const visible = input.overlay
        .visibleVariablesAt(input.batchIndex, input.ordinal)
        .find((v) => fold(v.name) === fold(name));
    if (visible !== undefined) {
        if (visible.isTable === true) {
            const obj = input.overlay.findObject(name, input.batchIndex, input.ordinal);
            if (obj !== undefined) {
                const overlayContent = overlayHover(obj, input.overlay);
                return hover(overlayContent.kind, overlayContent.content, span);
            }
            return hover("tableVariable", "**table variable** `" + name + "`", span);
        }
        const head =
            "**variable** `" +
            visible.name +
            "`" +
            (visible.typeText !== undefined ? " — `" + visible.typeText + "`" : "");
        return hover("variable", head, span);
    }

    return NONE; // undeclared: never guess
}

function overlayHover(
    obj: OverlayObject,
    overlay: ScriptOverlay,
): { content: string; kind: HoverSymbolKind } {
    const kind: HoverSymbolKind =
        obj.kind === "tempTable"
            ? "tempTable"
            : obj.kind === "tableVariable"
              ? "tableVariable"
              : "scriptTable";
    const kindWord =
        obj.kind === "tempTable"
            ? "temp table"
            : obj.kind === "tableVariable"
              ? "table variable"
              : "script table";
    const lines = ["**" + kindWord + "** `" + obj.name + "`"];
    // Overlay shape only when trustworthy: SELECT INTO shapes drop unaliased
    // column names (B10 finding) and ALTER'd shapes are unreliable — neither
    // may claim a column list.
    const trustworthy =
        obj.columnsUntyped !== true &&
        obj.columns.length > 0 &&
        !overlay.alteredNames.has(obj.name.toLowerCase());
    if (trustworthy) {
        const plural = obj.columns.length === 1 ? "" : "s";
        lines.push(obj.columns.length + " column" + plural + " (" + obj.columns.join(", ") + ")");
    }
    return { content: lines.join("  \n"), kind };
}

function builtinHoverContent(builtin: BuiltinFunctionInfo): string {
    const lines = ["**function** `" + builtin.name + "`"];
    for (const signature of builtin.signatures) {
        lines.push("`" + signature.label + "` → " + signature.returnType);
    }
    let content = lines.join("  \n") + "\n\n" + builtin.description;
    if (builtin.docUrl !== undefined) {
        content += "\n\n[Microsoft Learn](" + builtin.docUrl + ")";
    }
    return content;
}

function cteHoverContent(input: HoverComputeInput, cte: CteDecl): string {
    const lines = ["**CTE** `" + cte.name + "`"];
    const columns = cteColumns(input, cte);
    if (columns !== undefined && columns.length > 0) {
        lines.push("columns: " + columns.join(", "));
    }
    return lines.join("  \n");
}

function cteColumns(input: HoverComputeInput, cte: CteDecl): readonly string[] | undefined {
    if (cte.columns !== undefined && cte.columns.length > 0) {
        return cte.columns;
    }
    const bound: BoundSource = {
        source: { scopeId: 0, parts: [cte.name], kind: "table", span: cte.span },
        resolution: { kind: "cte", cte },
        label: cte.name,
    };
    return input.binding.columnsOf(bound)?.map((c) => c.name);
}

/** Alias-target display for the alias hover, or undefined when unclaimable. */
function resolutionDisplay(
    bound: BoundSource,
    pinned: IPinnedMetadataView,
    catalogSuppressed: boolean,
): string | undefined {
    switch (bound.resolution.kind) {
        case "catalog": {
            if (catalogSuppressed) {
                return undefined;
            }
            const info = pinned.getObject(bound.resolution.ref);
            return info === undefined ? undefined : "`" + info.schema + "." + info.name + "`";
        }
        case "cte":
            return "`" + bound.resolution.cte.name + "` (CTE)";
        case "overlay":
            return "`" + bound.resolution.overlay.name + "`";
        case "derived":
            return "(derived table)";
        case "opaque":
        default:
            return undefined;
    }
}

function boundSourceHover(
    input: HoverComputeInput,
    bound: BoundSource,
    span: SketchSpan,
    fold: (v: string) => string,
    catalogSuppressed: boolean,
    hover: HoverFn,
): HoverComputation {
    switch (bound.resolution.kind) {
        case "catalog": {
            if (catalogSuppressed) {
                return NONE;
            }
            const content = catalogObjectHover(input, bound.resolution.ref);
            return content === undefined ? NONE : hover(content.kind, content.content, span);
        }
        case "cte":
            return hover("cte", cteHoverContent(input, bound.resolution.cte), span);
        case "overlay": {
            const overlayContent = overlayHover(bound.resolution.overlay, input.overlay);
            return hover(overlayContent.kind, overlayContent.content, span);
        }
        case "derived": {
            const lines = ["**derived table** `" + bound.label + "`"];
            const columns = input.binding.columnsOf(bound);
            if (columns !== undefined && columns.length > 0) {
                lines.push("columns: " + columns.map((c) => c.name).join(", "));
            }
            return hover("derived", lines.join("  \n"), span);
        }
        case "opaque":
        default:
            return NONE; // suppressed — never guess
    }
}

function catalogObjectHover(
    input: HoverComputeInput,
    ref: LangObjectRef,
): { content: string; kind: HoverSymbolKind } | undefined {
    const { pinned } = input;
    const info = pinned.getObject(ref);
    if (info === undefined) {
        return undefined;
    }
    const lines = ["**" + KIND_WORDS[info.kind] + "** `" + info.schema + "." + info.name + "`"];

    if (info.kind === "table" || info.kind === "view" || info.kind === "tableFunction") {
        // Column facts only from fully-ready sections for shapes the script
        // did not ALTER (mirrors trustedColumnsOf in diagnostics).
        const altered = input.overlay.alteredNames.has(info.name.toLowerCase());
        if (!altered && pinned.readiness.columns === "ready") {
            const columns = pinned.getColumns(ref);
            if (columns !== undefined && columns.length > 0) {
                const facts: string[] = [
                    columns.length + " column" + (columns.length === 1 ? "" : "s"),
                ];
                const pk = columns.filter((c) => c.isPrimaryKey === true).map((c) => c.name);
                if (pk.length > 0) {
                    facts.push("PK(" + pk.join(", ") + ")");
                }
                if (pinned.readiness.foreignKeys === "ready") {
                    const fkCount = pinned.fkFrom(ref).length;
                    if (fkCount > 0) {
                        facts.push(fkCount + " foreign key" + (fkCount === 1 ? "" : "s"));
                    }
                }
                lines.push(facts.join(" · "));
            }
        }
    }
    if (
        info.kind === "procedure" ||
        info.kind === "scalarFunction" ||
        info.kind === "tableFunction"
    ) {
        if (pinned.readiness.parameters === "ready") {
            const params = pinned.getParameters(ref);
            if (params !== undefined) {
                const shown = params.filter((p) => p.ordinal !== 0);
                if (shown.length > 0) {
                    lines.push(
                        shown
                            .map(
                                (p) => p.name + " " + p.typeDisplay + (p.isOutput ? " OUTPUT" : ""),
                            )
                            .join(", "),
                    );
                }
                const returns = params.find((p) => p.ordinal === 0);
                if (returns !== undefined) {
                    lines.push("returns " + returns.typeDisplay);
                }
            }
        }
    }
    const description = pinned.getDescription?.(ref);
    const content = lines.join("  \n") + (description !== undefined ? "\n\n" + description : "");
    const kind: HoverSymbolKind = info.kind;
    return { content, kind };
}

/** The column facts hover renders (BoundColumn and LangColumn both fit). */
interface ColumnFacts {
    readonly name: string;
    readonly typeDisplay?: string;
    readonly nullable?: boolean;
    readonly isPrimaryKey?: boolean;
    readonly isIdentity?: boolean;
    readonly isComputed?: boolean;
}

function columnHoverContent(
    label: string,
    col: ColumnFacts,
    owner: { display: string; ref?: LangObjectRef },
    pinned: IPinnedMetadataView,
    fold: (v: string) => string,
): string {
    let head = "**column** `" + label + "`";
    if (col.typeDisplay !== undefined) {
        head +=
            " — `" +
            col.typeDisplay +
            "`" +
            (col.nullable === true ? " NULL" : col.nullable === false ? " NOT NULL" : "");
    }
    const facts: string[] = ["`" + owner.display + "`"];
    if (col.isPrimaryKey === true) {
        facts.push("PK");
    }
    if (col.isIdentity === true) {
        facts.push("identity");
    }
    if (col.isComputed === true) {
        facts.push("computed");
    }
    const lines = [head, facts.join(" · ")];
    if (owner.ref !== undefined && pinned.readiness.foreignKeys === "ready") {
        for (const edge of pinned.fkFrom(owner.ref)) {
            const pairs = edge.columns.filter((p) => fold(p.fromColumn) === fold(col.name));
            if (pairs.length > 0) {
                const target = pinned.getObject(edge.to);
                if (target !== undefined) {
                    lines.push(
                        "FK → " +
                            target.schema +
                            "." +
                            target.name +
                            "(" +
                            pairs.map((p) => p.toColumn).join(", ") +
                            ")",
                    );
                }
            }
        }
    }
    let content = lines.join("  \n");
    if (owner.ref !== undefined) {
        const description = pinned.getDescription?.(owner.ref, col.name);
        if (description !== undefined) {
            content += "\n\n" + description;
        }
    }
    return content;
}

/** Owning-object facts of a bound source for the column hover. */
function ownerOf(
    bound: BoundSource,
    pinned: IPinnedMetadataView,
): { display: string; ref?: LangObjectRef } {
    if (bound.resolution.kind === "catalog") {
        const info = pinned.getObject(bound.resolution.ref);
        if (info !== undefined) {
            return { display: info.schema + "." + info.name, ref: bound.resolution.ref };
        }
    }
    return { display: bound.label };
}

function columnHover(
    input: HoverComputeInput,
    chain: NameChain,
    fold: (v: string) => string,
    catalogSuppressed: boolean,
    hover: HoverFn,
): HoverComputation | undefined {
    const { pinned, offset } = input;
    const word = chain.parts[chain.partIndex];
    const caretSpan = chain.spans[chain.partIndex];

    // Qualified: alias/source qualifier first (alias-before-object).
    if (chain.parts.length >= 2 && chain.partIndex === chain.parts.length - 1) {
        const qualifier = chain.parts[chain.parts.length - 2];
        const bound = input.binding.resolveQualifier(offset, qualifier);
        if (bound !== undefined && chain.parts.length === 2) {
            if (bound.resolution.kind === "catalog" && catalogSuppressed) {
                return NONE;
            }
            const columns = input.binding.columnsOf(bound);
            if (columns === undefined) {
                return NONE; // cannot claim (suppression mirror)
            }
            const col = columns.find((c) => fold(c.name) === fold(word));
            if (col === undefined) {
                return NONE; // trusted shape without the column: still no guess
            }
            const owner = ownerOf(bound, pinned);
            return hover(
                "column",
                columnHoverContent(qualifier + "." + col.name, col, owner, pinned, fold),
                caretSpan,
            );
        }
        // schema.table.column / db.schema.table.column → catalog resolution.
        if (chain.parts.length >= 3) {
            if (catalogSuppressed) {
                return NONE;
            }
            const resolution = resolveNameParts(chain.parts.slice(0, -1), {
                overlay: input.overlay,
                batchIndex: input.batchIndex,
                ordinal: input.ordinal,
                pinned,
                caseSensitive: pinned.env.caseSensitive,
            });
            if (resolution.kind !== "catalog") {
                return resolution.kind === "opaque" ? NONE : undefined;
            }
            if (pinned.readiness.columns !== "ready") {
                return NONE;
            }
            const columns = pinned.getColumns(resolution.ref);
            const col = columns?.find((c) => fold(c.name) === fold(word));
            if (col === undefined) {
                return NONE;
            }
            const info = pinned.getObject(resolution.ref);
            const owner = {
                display: info !== undefined ? info.schema + "." + info.name : chain.parts[0],
                ref: resolution.ref,
            };
            return hover(
                "column",
                columnHoverContent(col.name, col, owner, pinned, fold),
                caretSpan,
            );
        }
        return undefined; // qualifier did not resolve — other hovers may still
    }

    // Unqualified: server scoping — innermost level that knows the name wins;
    // any untrusted source at that level makes the claim dishonest (mirror of
    // the diagnostics visibility levels).
    if (chain.parts.length === 1) {
        const sources = input.binding.sourcesAt(offset);
        const byScope: { scopeId: number; sources: BoundSource[] }[] = [];
        for (const bound of sources) {
            const last = byScope[byScope.length - 1];
            if (last !== undefined && last.scopeId === bound.source.scopeId) {
                last.sources.push(bound);
            } else {
                byScope.push({ scopeId: bound.source.scopeId, sources: [bound] });
            }
        }
        for (const level of byScope) {
            let complete = true;
            const matches: { col: BoundColumn; bound: BoundSource }[] = [];
            for (const bound of level.sources) {
                if (bound.resolution.kind === "catalog" && catalogSuppressed) {
                    complete = false;
                    continue;
                }
                const columns = input.binding.columnsOf(bound);
                if (columns === undefined) {
                    complete = false;
                    continue;
                }
                for (const col of columns) {
                    if (fold(col.name) === fold(word)) {
                        matches.push({ col, bound });
                    }
                }
            }
            if (matches.length === 1 && complete) {
                const { col, bound } = matches[0];
                const owner = ownerOf(bound, pinned);
                return hover(
                    "column",
                    columnHoverContent(col.name, col, owner, pinned, fold),
                    caretSpan,
                );
            }
            if (matches.length > 0 || !complete) {
                return undefined; // ambiguous or unverifiable — no column claim
            }
        }
        // DML-target columns: INSERT column lists and UPDATE/DELETE bodies
        // resolve bare names against the target (server semantics).
        return targetColumnHover(input, word, caretSpan, fold, catalogSuppressed, hover);
    }
    return undefined;
}

/** Bare-name column resolution against the statement's DML target. */
function targetColumnHover(
    input: HoverComputeInput,
    word: string,
    caretSpan: SketchSpan,
    fold: (v: string) => string,
    catalogSuppressed: boolean,
    hover: HoverFn,
): HoverComputation | undefined {
    const { pinned, offset, sketch } = input;
    const target = sketch.target;
    if (target === undefined || sketch.kind === "merge") {
        return undefined;
    }
    if (sketch.kind === "insert") {
        const list = sketch.insertColumns;
        if (list === undefined || offset < list.span.start || offset > list.span.end) {
            return undefined; // VALUES/SELECT positions are not target columns
        }
    } else if (sketch.kind !== "update" && sketch.kind !== "delete") {
        return undefined;
    }
    const parts = target.parts.filter((p) => p.length > 0);
    if (parts.length === 0) {
        return undefined;
    }
    const resolution = resolveNameParts(parts, {
        overlay: input.overlay,
        batchIndex: input.batchIndex,
        ordinal: input.ordinal,
        pinned,
        caseSensitive: pinned.env.caseSensitive,
    });
    if (resolution.kind === "catalog") {
        if (catalogSuppressed || pinned.readiness.columns !== "ready") {
            return undefined;
        }
        const info = pinned.getObject(resolution.ref);
        if (info === undefined || input.overlay.alteredNames.has(info.name.toLowerCase())) {
            return undefined;
        }
        const col = pinned.getColumns(resolution.ref)?.find((c) => fold(c.name) === fold(word));
        if (col === undefined) {
            return undefined;
        }
        return hover(
            "column",
            columnHoverContent(
                col.name,
                col,
                { display: info.schema + "." + info.name, ref: resolution.ref },
                pinned,
                fold,
            ),
            caretSpan,
        );
    }
    if (resolution.kind === "overlay") {
        const obj = resolution.overlay;
        const trustworthy =
            obj.columnsUntyped !== true &&
            obj.columns.length > 0 &&
            !input.overlay.alteredNames.has(obj.name.toLowerCase());
        if (trustworthy && obj.columns.some((c) => fold(c) === fold(word))) {
            const name = obj.columns.find((c) => fold(c) === fold(word))!;
            return hover(
                "column",
                columnHoverContent(name, { name }, { display: obj.name }, pinned, fold),
                caretSpan,
            );
        }
    }
    return undefined;
}

function qualifierHover(
    input: HoverComputeInput,
    chain: NameChain,
    fold: (v: string) => string,
    catalogSuppressed: boolean,
    hover: HoverFn,
): HoverComputation {
    const { pinned } = input;
    const sub = chain.parts.slice(0, chain.partIndex + 1);
    const caretSpan = chain.spans[chain.partIndex];
    const word = chain.parts[chain.partIndex];
    if (sub.length === 1) {
        // Alias or source-name qualifier of a longer chain (o.CustomerID or
        // Orders.OrderID with the caret on the qualifier).
        const bound = input.binding.resolveQualifier(input.offset, word);
        if (bound !== undefined) {
            if (bound.source.alias !== undefined && fold(bound.source.alias) === fold(word)) {
                const target = resolutionDisplay(bound, pinned, catalogSuppressed);
                if (target !== undefined) {
                    return hover("alias", "**alias** `" + word + "` = " + target, caretSpan);
                }
                return NONE;
            }
            return boundSourceHover(input, bound, caretSpan, fold, catalogSuppressed, hover);
        }
        const schema = pinned.listSchemas().find((s) => fold(s.name) === fold(word));
        if (schema !== undefined) {
            return hover("schema", "**schema** `" + schema.name + "`", caretSpan);
        }
        const database = input.databases?.find((d) => fold(d.name) === fold(word));
        if (database !== undefined) {
            return hover("database", "**database** `" + database.name + "`", caretSpan);
        }
        return NONE;
    }
    // Two or more leading parts: db.schema (schema hover) or schema.object.
    if (sub.length === 2 && input.databases?.some((d) => fold(d.name) === fold(sub[0])) === true) {
        const current = pinned.env.currentDatabase;
        if (current !== undefined && fold(sub[0]) === fold(current)) {
            const schema = pinned.listSchemas().find((s) => fold(s.name) === fold(word));
            if (schema !== undefined) {
                return hover("schema", "**schema** `" + schema.name + "`", caretSpan);
            }
        }
        return NONE; // cross-database — never claim
    }
    if (catalogSuppressed) {
        return NONE;
    }
    const resolution = resolveNameParts(sub, {
        overlay: input.overlay,
        batchIndex: input.batchIndex,
        ordinal: input.ordinal,
        pinned,
        caseSensitive: pinned.env.caseSensitive,
    });
    if (resolution.kind === "catalog") {
        const content = catalogObjectHover(input, resolution.ref);
        return content === undefined ? NONE : hover(content.kind, content.content, caretSpan);
    }
    if (resolution.kind === "overlay") {
        const overlayContent = overlayHover(resolution.overlay, input.overlay);
        return hover(overlayContent.kind, overlayContent.content, caretSpan);
    }
    return NONE;
}

function generalNameHover(
    input: HoverComputeInput,
    chain: NameChain,
    fold: (v: string) => string,
    catalogSuppressed: boolean,
    hover: HoverFn,
): HoverComputation {
    const { pinned } = input;
    const caretSpan = chain.spans[chain.partIndex];
    const parts = chain.parts.slice(0, chain.partIndex + 1);

    if (catalogSuppressed) {
        // Overlay-only resolution remains honest under a switched database.
        const last = parts[parts.length - 1];
        const obj = input.overlay.findObject(last, input.batchIndex, input.ordinal);
        if (obj !== undefined) {
            const overlayContent = overlayHover(obj, input.overlay);
            return hover(overlayContent.kind, overlayContent.content, caretSpan);
        }
        return NONE;
    }

    const resolution = resolveNameParts(parts, {
        overlay: input.overlay,
        batchIndex: input.batchIndex,
        ordinal: input.ordinal,
        pinned,
        caseSensitive: pinned.env.caseSensitive,
    });
    switch (resolution.kind) {
        case "catalog": {
            const content = catalogObjectHover(input, resolution.ref);
            return content === undefined ? NONE : hover(content.kind, content.content, caretSpan);
        }
        case "overlay": {
            const overlayContent = overlayHover(resolution.overlay, input.overlay);
            return hover(overlayContent.kind, overlayContent.content, caretSpan);
        }
        case "cte":
            return hover("cte", cteHoverContent(input, resolution.cte), caretSpan);
        case "derived":
        case "opaque":
        default: {
            // Single-part schema names ("Sales." being typed, DDL contexts).
            if (parts.length === 1) {
                const schema = pinned.listSchemas().find((s) => fold(s.name) === fold(parts[0]));
                if (schema !== undefined) {
                    return hover("schema", "**schema** `" + schema.name + "`", caretSpan);
                }
            }
            return NONE;
        }
    }
}
