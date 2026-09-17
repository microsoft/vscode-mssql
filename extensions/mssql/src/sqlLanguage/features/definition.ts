/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Native go-to-definition (design 05 §13.4, B12/LS-4). Routing by BOUND
 * symbol kind:
 *
 *   script-local symbols — aliases (declaration located token-level, because
 *   SourceRef.span covers only the object name, not the alias — B11
 *   finding), variables (DECLARE span, including batch-visible declarations
 *   from earlier statements), CTEs, temp tables / table variables / script
 *   tables (their creating statement, column-anchored when the name is
 *   findable), derived-table columns (the select item) — all IN-DOCUMENT
 *   ranges;
 *
 *   catalog objects — a SCRIPTED definition through the scripting engine
 *   (stored module text for views/procedures/functions, synthesized CREATE
 *   TABLE for tables), delivered as virtual content;
 *
 *   columns of catalog tables — the owning object's script anchored AT the
 *   column via the emitter anchors.
 *
 * Honesty mirrors hover/diagnostics: USE-switched statements make no catalog
 * claims, ambiguous unqualified columns are refused, encrypted/permission-
 * hidden module text yields an honest comment-only virtual document (never a
 * fabricated body). Pure: no vscode, no node builtins (lint-enforced).
 */

import { DefinitionLocationResult, SqlLanguagePosition, SqlLanguageRange } from "../api";
import { BoundSource, StatementBinding, resolveNameParts } from "../core/binder";
import { Token, TokenKind, nextSignificant, tokenIndexAt } from "../core/lexer";
import {
    NameChain,
    isBuiltinFunctionName,
    isNameKind,
    namePartText,
    readChainAround,
} from "../core/nameChain";
import { OverlayObject, ScriptOverlay, SketchedStatement } from "../core/overlay";
import { SketchSpan, SourceRef, StatementSketch } from "../core/sketch";
import { IPinnedMetadataView, LangObjectRef } from "../provider/types";
import { ScriptResult, SqlScriptingService } from "../../sqlScripting/api";

export type DefinitionTargetKind =
    | "alias"
    | "selectAlias"
    | "variable"
    | "parameter"
    | "cte"
    | "tempTable"
    | "tableVariable"
    | "scriptTable"
    | "column"
    | "derivedColumn"
    | "table"
    | "view"
    | "procedure"
    | "scalarFunction"
    | "tableFunction"
    | "synonym"
    | "builtin"
    | "none";

export interface DefinitionComputeInput {
    readonly text: string;
    readonly offset: number;
    readonly tokens: readonly Token[];
    readonly sketch: StatementSketch;
    readonly binding: StatementBinding;
    readonly overlay: ScriptOverlay;
    /** All analyzed statements (cross-statement declaration targets). */
    readonly statements: readonly SketchedStatement[];
    readonly batchIndex: number;
    readonly ordinal: number;
    readonly pinned: IPinnedMetadataView;
    /** Effective database at this statement when a USE precedes it (§4.4). */
    readonly effectiveDatabase?: string;
    readonly scripting: SqlScriptingService;
    readonly positionAt: (offset: number) => SqlLanguagePosition;
}

export interface DefinitionComputation {
    readonly result: DefinitionLocationResult | undefined;
    /** Target kind for telemetry (never identifier text). */
    readonly targetKind: DefinitionTargetKind;
}

const NONE: DefinitionComputation = { result: undefined, targetKind: "none" };

export async function computeDefinition(
    input: DefinitionComputeInput,
): Promise<DefinitionComputation> {
    const { text, tokens, offset, pinned } = input;
    const fold = (value: string): string =>
        pinned.env.caseSensitive ? value : value.toLowerCase();

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

    const rangeOf = (span: SketchSpan): SqlLanguageRange => ({
        start: input.positionAt(span.start),
        end: input.positionAt(span.end),
    });
    const inDocument = (
        targetKind: DefinitionTargetKind,
        span: SketchSpan,
    ): DefinitionComputation => ({ result: { range: rangeOf(span) }, targetKind });

    // ---- variables and EXEC parameters -------------------------------------
    if (token.kind === TokenKind.Variable) {
        return variableDefinition(input, token, fold, catalogSuppressed, inDocument);
    }
    if (token.kind === TokenKind.SystemVariable) {
        return NONE;
    }

    // ---- temp tables referenced bare (#t / ##t) -----------------------------
    if (token.kind === TokenKind.TempName || token.kind === TokenKind.GlobalTempName) {
        const name = text.slice(token.start, token.end);
        const obj = input.overlay.findObject(name, input.batchIndex, input.ordinal);
        if (obj === undefined) {
            return NONE; // session may own it — never claim
        }
        return inDocument(overlayTargetKind(obj), creationSpan(input, obj, fold));
    }

    if (!isNameKind(token.kind)) {
        return NONE;
    }

    const chain = readChainAround(text, tokens, index);
    const word = chain.parts[chain.partIndex];

    // ---- builtins are not navigable ----------------------------------------
    if (chain.parts.length === 1 && isBuiltinFunctionName(word)) {
        const after = nextSignificant(tokens, index + 1);
        if (after < tokens.length && text.slice(tokens[after].start, tokens[after].end) === "(") {
            return { result: undefined, targetKind: "builtin" };
        }
    }

    // ---- caret inside a FROM-clause source name ------------------------------
    const source = input.sketch.sources.find((s) => offset >= s.span.start && offset <= s.span.end);
    if (source !== undefined && source.parts.length > 0) {
        if (chain.partIndex < chain.parts.length - 1) {
            return qualifierDefinition(input, chain, fold, catalogSuppressed, inDocument);
        }
        const bound = input.binding
            .sourcesAt(source.span.start)
            .find((candidate) => candidate.source === source);
        if (bound !== undefined) {
            return boundSourceDefinition(input, bound, fold, catalogSuppressed, inDocument);
        }
    }

    // ---- single-part alias / source-label references --------------------------
    if (chain.parts.length === 1) {
        const bound = input.binding.resolveQualifier(offset, word);
        if (bound !== undefined) {
            if (bound.source.alias !== undefined && fold(bound.source.alias) === fold(word)) {
                return inDocument("alias", aliasDeclarationSpan(input, bound.source, fold));
            }
            return boundSourceDefinition(input, bound, fold, catalogSuppressed, inDocument);
        }
    }

    // ---- columns (qualified, then unqualified) --------------------------------
    if (chain.partIndex === chain.parts.length - 1 && input.sketch.kind !== "merge") {
        const columnResult = await columnDefinition(
            input,
            chain,
            fold,
            catalogSuppressed,
            inDocument,
        );
        if (columnResult !== undefined) {
            return columnResult;
        }
    }

    // ---- select-list aliases (ORDER BY / GROUP BY addressability) -------------
    if (chain.parts.length === 1) {
        for (const item of input.sketch.selectItems) {
            if (
                item.alias !== undefined &&
                fold(item.alias) === fold(word) &&
                !(offset >= item.span.start && offset <= item.span.end)
            ) {
                return inDocument("selectAlias", item.span);
            }
        }
    }

    // ---- CTE name references ---------------------------------------------------
    if (chain.parts.length === 1) {
        const cte = input.sketch.ctes.find((c) => fold(c.name) === fold(word));
        if (cte !== undefined) {
            return inDocument("cte", cte.span);
        }
    }

    // ---- qualifier parts of longer chains --------------------------------------
    if (chain.partIndex < chain.parts.length - 1) {
        return qualifierDefinition(input, chain, fold, catalogSuppressed, inDocument);
    }

    // ---- general dotted-name resolution (targets, EXEC, DDL, calls) -------------
    return generalNameDefinition(input, chain, fold, catalogSuppressed, inDocument);
}

// ---------------------------------------------------------------------------
// scripted (virtual content) targets
// ---------------------------------------------------------------------------

interface ScriptedAnchorRequest {
    readonly columnName?: string;
    readonly parameterName?: string;
}

async function scriptedDefinition(
    input: DefinitionComputeInput,
    ref: LangObjectRef,
    anchorRequest: ScriptedAnchorRequest,
): Promise<DefinitionComputation> {
    const { pinned } = input;
    const info = pinned.getObject(ref);
    if (info === undefined) {
        return NONE;
    }
    const scripted = await input.scripting.script({ target: { ref }, operation: "create" });
    const anchor = pickAnchor(scripted, anchorRequest, pinned.env.caseSensitive);
    const database = pinned.env.currentDatabase ?? "";
    return {
        result: {
            virtualContent: {
                title: `${info.schema}.${info.name}`,
                text: scripted.text,
                anchor,
                cacheKey: `${database}:${ref.objectId}:create:${scripted.metadataGeneration}`,
                ...(scripted.unavailableReason !== undefined
                    ? { unavailableReason: scripted.unavailableReason }
                    : {}),
            },
        },
        targetKind: anchorRequest.columnName !== undefined ? "column" : info.kind,
    };
}

function pickAnchor(
    scripted: ScriptResult,
    request: ScriptedAnchorRequest,
    caseSensitive: boolean,
): SqlLanguagePosition {
    const fold = (value: string): string => (caseSensitive ? value : value.toLowerCase());
    if (request.columnName !== undefined) {
        const column = scripted.anchors.find(
            (a) => a.symbol.kind === "column" && fold(a.symbol.name) === fold(request.columnName!),
        );
        if (column !== undefined) {
            return { line: column.line, character: column.character };
        }
    }
    if (request.parameterName !== undefined) {
        const parameter = scripted.anchors.find(
            (a) =>
                a.symbol.kind === "parameter" &&
                fold(a.symbol.name) === fold(request.parameterName!),
        );
        if (parameter !== undefined) {
            return { line: parameter.line, character: parameter.character };
        }
    }
    const preferred =
        scripted.anchors.find((a) => a.symbol.kind === "objectName") ??
        scripted.anchors.find((a) => a.symbol.kind === "header");
    return preferred !== undefined
        ? { line: preferred.line, character: preferred.character }
        : { line: 0, character: 0 };
}

// ---------------------------------------------------------------------------
// in-document targets
// ---------------------------------------------------------------------------

type InDocumentFn = (targetKind: DefinitionTargetKind, span: SketchSpan) => DefinitionComputation;

function overlayTargetKind(obj: OverlayObject): DefinitionTargetKind {
    return obj.kind === "tempTable"
        ? "tempTable"
        : obj.kind === "tableVariable"
          ? "tableVariable"
          : "scriptTable";
}

/**
 * The creating statement span of an overlay object (CREATE TABLE /
 * SELECT INTO / DECLARE @t TABLE), narrowed to `columnName`'s token when one
 * is requested and findable.
 */
function creationSpan(
    input: DefinitionComputeInput,
    obj: OverlayObject,
    fold: (v: string) => string,
    columnName?: string,
): SketchSpan {
    const statement = input.statements.find((s) => s.ordinal === obj.fromStatement);
    let span: SketchSpan | undefined;
    if (statement !== undefined) {
        const sketch = statement.sketch;
        if (
            sketch.createdTable !== undefined &&
            lastPartMatches(sketch.createdTable.parts, obj.name, fold)
        ) {
            span = sketch.createdTable.span;
        } else if (
            sketch.selectInto !== undefined &&
            lastPartMatches(sketch.selectInto.parts, obj.name, fold)
        ) {
            span = sketch.selectInto.span;
        } else {
            const decl = sketch.declares.find((d) => fold(d.name) === fold(obj.name));
            span = decl?.span ?? sketch.span;
        }
    }
    span = span ?? { start: 0, end: 0 };
    if (columnName !== undefined) {
        const columnSpan = findNameTokenIn(input, span, columnName, fold);
        if (columnSpan !== undefined) {
            return columnSpan;
        }
    }
    return span;
}

function lastPartMatches(
    parts: readonly string[],
    name: string,
    fold: (v: string) => string,
): boolean {
    return parts.length > 0 && fold(parts[parts.length - 1]) === fold(name);
}

/** First name token inside `span` whose text folds to `name`. */
function findNameTokenIn(
    input: DefinitionComputeInput,
    span: SketchSpan,
    name: string,
    fold: (v: string) => string,
): SketchSpan | undefined {
    const { tokens, text } = input;
    let i = tokenIndexAt(tokens, span.start);
    while (i < tokens.length) {
        const t = tokens[i];
        if (t.start >= span.end || t.kind === TokenKind.EndOfFile) {
            break;
        }
        if (isNameKind(t.kind) && fold(namePartText(text, t)) === fold(name)) {
            return { start: t.start, end: t.end };
        }
        i++;
    }
    return undefined;
}

/**
 * The alias token span of a source. SourceRef.span covers only the object
 * name (B11 finding), so the alias is located token-level: skip optional AS
 * after the source span, then match the alias word.
 */
function aliasDeclarationSpan(
    input: DefinitionComputeInput,
    source: SourceRef,
    fold: (v: string) => string,
): SketchSpan {
    const { tokens, text } = input;
    if (source.alias === undefined) {
        return source.span;
    }
    let i = tokenIndexAt(tokens, source.span.end);
    if (tokens[i] !== undefined && tokens[i].end <= source.span.end) {
        i++;
    }
    i = nextSignificant(tokens, i);
    if (
        tokens[i] !== undefined &&
        tokens[i].kind === TokenKind.Identifier &&
        text.slice(tokens[i].start, tokens[i].end).toUpperCase() === "AS"
    ) {
        i = nextSignificant(tokens, i + 1);
    }
    const candidate = tokens[i];
    if (
        candidate !== undefined &&
        isNameKind(candidate.kind) &&
        fold(namePartText(text, candidate)) === fold(source.alias)
    ) {
        return { start: candidate.start, end: candidate.end };
    }
    return source.span;
}

function variableDefinition(
    input: DefinitionComputeInput,
    token: Token,
    fold: (v: string) => string,
    catalogSuppressed: boolean,
    inDocument: InDocumentFn,
): DefinitionComputation | Promise<DefinitionComputation> {
    const { text, pinned } = input;
    const name = text.slice(token.start, token.end);

    // EXEC named argument (@p = …): the routine's definition anchored at the
    // parameter (§13.4 Parameter row) when it can be bound.
    const exec = input.sketch.exec;
    if (exec !== undefined && !catalogSuppressed && exec.procParts.length > 0) {
        const arg = exec.args.find(
            (a) =>
                a.name !== undefined &&
                fold(a.name) === fold(name) &&
                token.start >= a.span.start &&
                token.start < a.span.start + a.name.length,
        );
        if (arg !== undefined) {
            const resolution = resolveNameParts(exec.procParts, {
                overlay: input.overlay,
                batchIndex: input.batchIndex,
                ordinal: input.ordinal,
                pinned,
                caseSensitive: pinned.env.caseSensitive,
            });
            if (resolution.kind === "catalog") {
                return scriptedDefinition(input, resolution.ref, {
                    parameterName: name,
                }).then((computation) =>
                    computation.result !== undefined
                        ? { result: computation.result, targetKind: "parameter" }
                        : computation,
                );
            }
        }
    }

    // Statement-local declaration (DECLARE / module header parameters).
    const decl = input.sketch.declares.find((d) => fold(d.name) === fold(name));
    if (decl !== undefined) {
        return inDocument(decl.isTable === true ? "tableVariable" : "variable", decl.span);
    }

    // Batch-visible declaration from an earlier statement (overlay).
    const earlier = input.overlay.variables
        .filter(
            (v) =>
                v.batchIndex === input.batchIndex &&
                v.fromStatement <= input.ordinal &&
                fold(v.name) === fold(name),
        )
        .pop();
    if (earlier !== undefined) {
        const statement = input.statements.find((s) => s.ordinal === earlier.fromStatement);
        const declSpan = statement?.sketch.declares.find((d) => fold(d.name) === fold(name))?.span;
        if (declSpan !== undefined) {
            return inDocument(earlier.isTable === true ? "tableVariable" : "variable", declSpan);
        }
    }

    return NONE; // undeclared: never guess
}

function boundSourceDefinition(
    input: DefinitionComputeInput,
    bound: BoundSource,
    fold: (v: string) => string,
    catalogSuppressed: boolean,
    inDocument: InDocumentFn,
): DefinitionComputation | Promise<DefinitionComputation> {
    switch (bound.resolution.kind) {
        case "catalog":
            if (catalogSuppressed) {
                return NONE;
            }
            return scriptedDefinition(input, bound.resolution.ref, {});
        case "cte":
            return inDocument("cte", bound.resolution.cte.span);
        case "overlay":
            return inDocument(
                overlayTargetKind(bound.resolution.overlay),
                creationSpan(input, bound.resolution.overlay, fold),
            );
        case "derived":
        case "opaque":
        default:
            return NONE;
    }
}

async function columnDefinition(
    input: DefinitionComputeInput,
    chain: NameChain,
    fold: (v: string) => string,
    catalogSuppressed: boolean,
    inDocument: InDocumentFn,
): Promise<DefinitionComputation | undefined> {
    const { pinned, offset } = input;
    const word = chain.parts[chain.partIndex];

    // Qualified: alias/source qualifier first (alias-before-object).
    if (chain.parts.length >= 2 && chain.partIndex === chain.parts.length - 1) {
        const qualifier = chain.parts[chain.parts.length - 2];
        const bound = input.binding.resolveQualifier(offset, qualifier);
        if (bound !== undefined && chain.parts.length === 2) {
            if (bound.resolution.kind === "catalog" && catalogSuppressed) {
                return NONE;
            }
            const columns = input.binding.columnsOf(bound);
            const col = columns?.find((c) => fold(c.name) === fold(word));
            if (columns === undefined || col === undefined) {
                return NONE; // cannot claim (suppression mirror)
            }
            return boundColumnDefinition(input, bound, col.name, fold, inDocument);
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
            const col = pinned.getColumns(resolution.ref)?.find((c) => fold(c.name) === fold(word));
            if (col === undefined) {
                return NONE;
            }
            return scriptedColumnDefinition(input, resolution.ref, col.name);
        }
        return undefined; // qualifier did not resolve — other routes may still
    }

    // Unqualified: innermost level that knows the name wins; any untrusted
    // source at that level makes the claim dishonest (hover/§11.2 mirror).
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
            const matches: { name: string; bound: BoundSource }[] = [];
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
                        matches.push({ name: col.name, bound });
                    }
                }
            }
            if (matches.length === 1 && complete) {
                const { name, bound } = matches[0];
                return boundColumnDefinition(input, bound, name, fold, inDocument);
            }
            if (matches.length > 0 || !complete) {
                return undefined; // ambiguous or unverifiable — no claim
            }
        }
        // DML-target columns (INSERT column lists, UPDATE/DELETE bodies).
        return targetColumnDefinition(input, word, fold, catalogSuppressed, inDocument);
    }
    return undefined;
}

/** Route one bound source's column to its definition per resolution kind. */
async function boundColumnDefinition(
    input: DefinitionComputeInput,
    bound: BoundSource,
    columnName: string,
    fold: (v: string) => string,
    inDocument: InDocumentFn,
): Promise<DefinitionComputation> {
    switch (bound.resolution.kind) {
        case "catalog":
            return scriptedColumnDefinition(input, bound.resolution.ref, columnName);
        case "cte": {
            const cte = bound.resolution.cte;
            const declared = findNameTokenIn(input, cte.span, columnName, fold);
            return inDocument("column", declared ?? cte.span);
        }
        case "overlay":
            return inDocument(
                "column",
                creationSpan(input, bound.resolution.overlay, fold, columnName),
            );
        case "derived": {
            const scopeId = bound.source.innerScopeId;
            if (scopeId !== undefined) {
                for (const item of input.sketch.selectItems) {
                    if (item.scopeId !== scopeId) {
                        continue;
                    }
                    if (item.alias !== undefined && fold(item.alias) === fold(columnName)) {
                        return inDocument("derivedColumn", item.span);
                    }
                    const nameSpan = findNameTokenIn(input, item.span, columnName, fold);
                    if (nameSpan !== undefined) {
                        return inDocument("derivedColumn", nameSpan);
                    }
                }
            }
            return NONE;
        }
        case "opaque":
        default:
            return NONE;
    }
}

/** Column of a catalog object: table → column-anchored synthesized CREATE;
 *  view/TVF → the module's definition (header anchor). */
async function scriptedColumnDefinition(
    input: DefinitionComputeInput,
    ref: LangObjectRef,
    columnName: string,
): Promise<DefinitionComputation> {
    const info = input.pinned.getObject(ref);
    if (info === undefined) {
        return NONE;
    }
    if (info.kind === "table") {
        return scriptedDefinition(input, ref, { columnName });
    }
    const computation = await scriptedDefinition(input, ref, {});
    return computation.result !== undefined
        ? { result: computation.result, targetKind: "column" }
        : computation;
}

/** Bare-name column resolution against the statement's DML target. */
async function targetColumnDefinition(
    input: DefinitionComputeInput,
    word: string,
    fold: (v: string) => string,
    catalogSuppressed: boolean,
    inDocument: InDocumentFn,
): Promise<DefinitionComputation | undefined> {
    const { pinned, offset, sketch } = input;
    const target = sketch.target;
    if (target === undefined || sketch.kind === "merge") {
        return undefined;
    }
    if (sketch.kind === "insert") {
        const list = sketch.insertColumns;
        if (list === undefined || offset < list.span.start || offset > list.span.end) {
            return undefined;
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
        const col = pinned.getColumns(resolution.ref)?.find((c) => fold(c.name) === fold(word));
        if (col === undefined) {
            return undefined;
        }
        return scriptedColumnDefinition(input, resolution.ref, col.name);
    }
    if (resolution.kind === "overlay") {
        const obj = resolution.overlay;
        if (obj.columns.some((c) => fold(c) === fold(word))) {
            return inDocument("column", creationSpan(input, obj, fold, word));
        }
    }
    return undefined;
}

function qualifierDefinition(
    input: DefinitionComputeInput,
    chain: NameChain,
    fold: (v: string) => string,
    catalogSuppressed: boolean,
    inDocument: InDocumentFn,
): DefinitionComputation | Promise<DefinitionComputation> {
    const { pinned } = input;
    const sub = chain.parts.slice(0, chain.partIndex + 1);
    const word = chain.parts[chain.partIndex];
    if (sub.length === 1) {
        const bound = input.binding.resolveQualifier(input.offset, word);
        if (bound !== undefined) {
            if (bound.source.alias !== undefined && fold(bound.source.alias) === fold(word)) {
                return inDocument("alias", aliasDeclarationSpan(input, bound.source, fold));
            }
            return boundSourceDefinition(input, bound, fold, catalogSuppressed, inDocument);
        }
        return NONE; // schemas/databases have no definition target (v1)
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
        return scriptedDefinition(input, resolution.ref, {});
    }
    if (resolution.kind === "overlay") {
        return inDocument(
            overlayTargetKind(resolution.overlay),
            creationSpan(input, resolution.overlay, fold),
        );
    }
    return NONE;
}

function generalNameDefinition(
    input: DefinitionComputeInput,
    chain: NameChain,
    fold: (v: string) => string,
    catalogSuppressed: boolean,
    inDocument: InDocumentFn,
): DefinitionComputation | Promise<DefinitionComputation> {
    const { pinned } = input;
    const parts = chain.parts.slice(0, chain.partIndex + 1);

    if (catalogSuppressed) {
        // Overlay-only resolution remains honest under a switched database.
        const last = parts[parts.length - 1];
        const obj = input.overlay.findObject(last, input.batchIndex, input.ordinal);
        if (obj !== undefined) {
            return inDocument(overlayTargetKind(obj), creationSpan(input, obj, fold));
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
        case "catalog":
            return scriptedDefinition(input, resolution.ref, {});
        case "overlay":
            return inDocument(
                overlayTargetKind(resolution.overlay),
                creationSpan(input, resolution.overlay, fold),
            );
        case "cte":
            return inDocument("cte", resolution.cte.span);
        case "derived":
        case "opaque":
        default:
            return NONE;
    }
}
