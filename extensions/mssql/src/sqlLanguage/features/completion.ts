/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Native completion engine (design 05 §10): context-driven candidates over
 * the pinned metadata view + binder + overlay, deterministic explainable
 * ranking (§10.5), honest incompleteness under partial readiness (§4.2),
 * FK join suggestions (§10.3), star expansion (§10.4), INSERT scaffolds and
 * EXEC parameter intelligence. Pure — no vscode, no network, snapshot-only.
 */

import {
    CompletionResult,
    SqlCompletionItem,
    SqlCompletionItemKind,
    SqlLanguageRange,
} from "../api";
import { BoundSource, StatementBinding, resolveNameParts } from "../core/binder";
import { CompletionContext } from "../core/context";
import { matchScore, ordinalCompare } from "../core/fuzzy";
import { quoteIdentifier, quoteParts } from "../core/quote";
import { ScriptOverlay } from "../core/overlay";
import { StatementSketch } from "../core/sketch";
import { TSQL_KEYWORDS } from "../data/keywords.generated";
import { TSQL_BUILTIN_FUNCTIONS } from "../data/builtinFunctions.generated";
import { TSQL_SNIPPETS } from "../data/snippets";
import { isSystemSchemaName } from "../data/systemObjectCatalog";
import {
    IPinnedMetadataView,
    LangDatabase,
    LangObjectKind,
    LangObjectRef,
} from "../provider/types";

export interface CompletionComputeInput {
    readonly text: string;
    readonly offset: number;
    readonly context: CompletionContext;
    readonly sketch: StatementSketch;
    readonly binding: StatementBinding;
    readonly overlay: ScriptOverlay;
    readonly batchIndex: number;
    readonly ordinal: number;
    readonly pinned: IPinnedMetadataView;
    readonly databases?: readonly LangDatabase[];
    readonly snippetsEnabled: boolean;
    readonly keywordCasing: "upper" | "lower";
    /** For replaceRange conversion. */
    readonly positionAt: (offset: number) => { line: number; character: number };
}

interface Candidate {
    readonly item: SqlCompletionItem;
    readonly score: number;
}

/**
 * How member-access qualifier resolution fared (LS journal field):
 * - "loaded":     the qualifier resolved and candidates were served.
 * - "loading":    columns of the resolved table/view are hydrating right now.
 * - "notLoaded":  columns of the resolved table/view are NOT loaded and no
 *                 load is known to be in flight — the HOST must kick one
 *                 (fire-and-forget) so the isIncomplete retrigger can serve.
 * - "unresolved": the qualifier did not resolve to anything claimable.
 */
export type MemberAccessResolution = "loaded" | "loading" | "notLoaded" | "unresolved";

export interface MemberAccessInfo {
    readonly resolution: MemberAccessResolution;
    /** The resolved catalog object whose columns are missing (kick target). */
    readonly columnsRef?: LangObjectRef;
}

/** Engine-internal completion result: never crosses the RPC (host strips it). */
export interface CompletionComputation extends CompletionResult {
    /** Present only for memberAccess contexts. */
    readonly memberAccess?: MemberAccessInfo;
}

const KIND_PRIORITY: Readonly<Record<SqlCompletionItemKind, number>> = {
    join: 900,
    column: 700,
    table: 600,
    view: 590,
    schema: 500,
    procedure: 600,
    function: 450,
    variable: 650,
    parameter: 700,
    database: 600,
    keyword: 300,
    snippet: 250,
    systemObject: 200,
};

const MAX_ITEMS = 250;

export function computeCompletion(input: CompletionComputeInput): CompletionComputation {
    const ctx = input.context;
    const candidates: Candidate[] = [];
    let isIncomplete = false;
    let incompleteReason: string | undefined;
    let memberAccess: MemberAccessInfo | undefined;

    const markIncomplete = (reason: string): void => {
        isIncomplete = true;
        incompleteReason = incompleteReason ?? reason;
    };

    const add = (
        item: Omit<SqlCompletionItem, "sortText">,
        prefix: string,
        boost: number = 0,
    ): void => {
        const score = matchScore(item.filterText ?? item.label, prefix);
        if (score === undefined) {
            return;
        }
        candidates.push({
            item: item as SqlCompletionItem,
            score: KIND_PRIORITY[item.kind] + score + boost,
        });
    };

    switch (ctx.kind) {
        case "none":
            return { items: [], isIncomplete: false };

        case "statementStart": {
            addStatementKeywords(input, add);
            if (input.snippetsEnabled) {
                addSnippets(input, add);
            }
            break;
        }

        case "memberAccess": {
            memberAccess = addMemberAccess(input, ctx.parts, ctx.prefix, add, markIncomplete);
            break;
        }

        case "tableSource": {
            addTableSources(input, "", ctx.afterJoin, add, markIncomplete);
            break;
        }

        case "joinPredicate": {
            addJoinPredicates(input, add);
            addColumns(input, "", add, markIncomplete);
            addExpressionKeywords(input, "", add);
            break;
        }

        case "expression": {
            addColumns(input, ctx.prefix, add, markIncomplete);
            addVariables(input, ctx.prefix, add);
            addBuiltins(input, ctx.prefix, add);
            addExpressionKeywords(input, ctx.prefix, add);
            if (ctx.clause === "selectList") {
                addStarExpansion(input, add);
                add(keywordItem(input, "FROM"), ctx.prefix, 50);
            }
            if (ctx.clause === "orderBy" || ctx.clause === "groupBy") {
                // SELECT-list aliases are addressable here (§10.2).
                for (const item of input.sketch.selectItems) {
                    if (item.scopeId === ctx.scopeId && item.alias !== undefined) {
                        add(
                            {
                                label: item.alias,
                                kind: "column",
                                insertText: quoteIdentifier(item.alias),
                                detail: "select alias",
                                filterText: item.alias,
                            },
                            ctx.prefix,
                            30,
                        );
                    }
                }
            }
            break;
        }

        case "insertColumnList": {
            addInsertColumns(input, add, markIncomplete);
            break;
        }

        case "updateSetTarget": {
            addUpdateSetColumns(input, add, markIncomplete);
            break;
        }

        case "execProcedure": {
            addProcedures(input, ctx.prefix, add, markIncomplete);
            break;
        }

        case "execArgs": {
            addExecParams(input, add, markIncomplete);
            addVariables(input, "", add);
            break;
        }

        case "declareType": {
            addTypeKeywords(input, ctx.prefix, add);
            break;
        }

        case "useDatabase": {
            addDatabases(input, ctx.prefix, add, markIncomplete);
            break;
        }
    }

    // Deterministic order: score desc, then label (§10.5 tie-breakers) —
    // ordinal, not localeCompare: ICU order drifts across Electron updates.
    candidates.sort((a, b) => b.score - a.score || ordinalCompare(a.item.label, b.item.label));
    const items = candidates.slice(0, MAX_ITEMS).map((c, index) => ({
        ...c.item,
        sortText: String(10000 + index).padStart(5, "0"),
    }));
    if (candidates.length > MAX_ITEMS) {
        isIncomplete = true;
    }
    return { items, isIncomplete, incompleteReason, memberAccess };
}

// ---- candidate groups -------------------------------------------------------

type AddFn = (item: Omit<SqlCompletionItem, "sortText">, prefix: string, boost?: number) => void;

function casing(input: CompletionComputeInput, word: string): string {
    return input.keywordCasing === "lower" ? word.toLowerCase() : word.toUpperCase();
}

function keywordItem(
    input: CompletionComputeInput,
    word: string,
): Omit<SqlCompletionItem, "sortText"> {
    const text = casing(input, word);
    return { label: text, kind: "keyword", insertText: text, filterText: word };
}

function addStatementKeywords(input: CompletionComputeInput, add: AddFn): void {
    for (const kw of TSQL_KEYWORDS) {
        if (kw.category === "statement") {
            add(keywordItem(input, kw.id), "");
        }
    }
}

const EXPRESSION_KEYWORDS = [
    "AND",
    "OR",
    "NOT",
    "NULL",
    "IN",
    "LIKE",
    "BETWEEN",
    "EXISTS",
    "IS",
    "CASE",
    "WHEN",
    "THEN",
    "ELSE",
    "END",
    "AS",
    "ASC",
    "DESC",
    "DISTINCT",
];

function addExpressionKeywords(input: CompletionComputeInput, prefix: string, add: AddFn): void {
    for (const word of EXPRESSION_KEYWORDS) {
        add(keywordItem(input, word), prefix, 0);
    }
}

function addSnippets(input: CompletionComputeInput, add: AddFn): void {
    for (const snippet of TSQL_SNIPPETS) {
        add(
            {
                label: snippet.name,
                kind: "snippet",
                insertText: snippet.body,
                isSnippet: true,
                detail: snippet.description,
                filterText: snippet.prefix,
            },
            "",
        );
    }
}

function addBuiltins(input: CompletionComputeInput, prefix: string, add: AddFn): void {
    for (const fn of TSQL_BUILTIN_FUNCTIONS) {
        const label = fn.niladic === true ? fn.name : `${fn.name}(…)`;
        add(
            {
                label,
                kind: "function",
                insertText: fn.niladic === true ? fn.name : `${fn.name}($1)`,
                isSnippet: fn.niladic !== true || undefined,
                detail: fn.signatures[0]?.label,
                documentation: fn.description,
                filterText: fn.name,
            },
            prefix,
        );
    }
}

function addVariables(input: CompletionComputeInput, prefix: string, add: AddFn): void {
    const seen = new Set<string>();
    // Statement-local declares first, then batch-visible overlay variables.
    for (const decl of input.sketch.declares) {
        if (!seen.has(decl.name)) {
            seen.add(decl.name);
            add(
                {
                    label: decl.name,
                    kind: "variable",
                    insertText: decl.name,
                    detail: decl.typeText,
                },
                prefix,
                20,
            );
        }
    }
    for (const v of input.overlay.visibleVariablesAt(input.batchIndex, input.ordinal)) {
        if (!seen.has(v.name)) {
            seen.add(v.name);
            add(
                { label: v.name, kind: "variable", insertText: v.name, detail: v.typeText },
                prefix,
                10,
            );
        }
    }
}

function addColumns(
    input: CompletionComputeInput,
    prefix: string,
    add: AddFn,
    markIncomplete: (reason: string) => void,
): void {
    const { columns, complete } = input.binding.visibleColumns(input.offset);
    if (!complete) {
        markIncomplete("columnsNotReady");
    }
    const counts = new Map<string, number>();
    for (const col of columns) {
        counts.set(col.name.toLowerCase(), (counts.get(col.name.toLowerCase()) ?? 0) + 1);
    }
    for (const col of columns) {
        const ambiguous = (counts.get(col.name.toLowerCase()) ?? 0) > 1;
        const label = ambiguous ? `${col.fromLabel}.${col.name}` : col.name;
        const insert = ambiguous
            ? `${quoteIdentifier(col.fromLabel)}.${quoteIdentifier(col.name)}`
            : quoteIdentifier(col.name);
        add(
            {
                label,
                kind: "column",
                insertText: insert,
                detail: columnDetail(col.typeDisplay, col.isPrimaryKey, col.fromLabel),
                filterText: col.name,
            },
            prefix,
            col.isPrimaryKey === true ? 10 : 0,
        );
    }
}

function columnDetail(
    typeDisplay: string | undefined,
    isPrimaryKey: boolean | undefined,
    fromLabel: string,
): string {
    const parts: string[] = [];
    if (typeDisplay !== undefined) {
        parts.push(typeDisplay);
    }
    if (isPrimaryKey === true) {
        parts.push("PK");
    }
    parts.push(fromLabel);
    return parts.join(" · ");
}

function addMemberAccess(
    input: CompletionComputeInput,
    parts: readonly string[],
    prefix: string,
    add: AddFn,
    markIncomplete: (reason: string) => void,
): MemberAccessInfo {
    const qualifier = parts[parts.length - 1];
    // 1. Alias / visible source (columns).
    if (parts.length === 1) {
        let bound = input.binding.resolveQualifier(input.offset, qualifier);
        // The chain being typed can match ITSELF as an incomplete source
        // ("FROM Sales.|" records a source "Sales."): never self-qualify.
        if (
            bound !== undefined &&
            input.offset >= bound.source.span.start &&
            input.offset <= bound.source.span.end + 2
        ) {
            bound = undefined;
        }
        if (bound !== undefined) {
            const columns = input.binding.columnsOf(bound);
            if (columns === undefined) {
                markIncomplete(suppressionOf(bound));
                // Columns are a lazily-hydrated section: a RESOLVED table or
                // view with missing columns must surface the miss so the host
                // can kick the load — otherwise the isIncomplete retrigger
                // finds the same emptiness forever (§4.2 honesty loop).
                if (bound.resolution.kind === "catalog") {
                    return {
                        resolution:
                            input.pinned.readiness.columns === "loading" ? "loading" : "notLoaded",
                        columnsRef: bound.resolution.ref,
                    };
                }
                return { resolution: "unresolved" };
            }
            for (const col of columns) {
                add(
                    {
                        label: col.name,
                        kind: "column",
                        insertText: quoteIdentifier(col.name),
                        detail: columnDetail(col.typeDisplay, col.isPrimaryKey, col.fromLabel),
                        filterText: col.name,
                    },
                    prefix,
                    col.isPrimaryKey === true ? 10 : 0,
                );
            }
            // alias.* star expansion offer.
            addStarExpansion(input, add, bound);
            return { resolution: "loaded" };
        }
    }
    // 2. Schema objects: qualifier (or [db,schema] with current db).
    const schemaName =
        parts.length === 1
            ? qualifier
            : parts.length === 2 &&
                input.pinned.env.currentDatabase !== undefined &&
                parts[0].toLowerCase() === input.pinned.env.currentDatabase.toLowerCase()
              ? parts[1]
              : undefined;
    if (schemaName !== undefined) {
        const knownSchema = input.pinned
            .listSchemas()
            .some((s) => s.name.toLowerCase() === schemaName.toLowerCase());
        if (knownSchema) {
            if (
                input.pinned.readiness.objects !== "ready" &&
                input.pinned.readiness.objects !== "partial"
            ) {
                markIncomplete("providerNotReady");
                return { resolution: "notLoaded" };
            }
            for (const obj of input.pinned.searchObjects({
                schema: schemaName,
                prefix,
                limit: MAX_ITEMS,
            })) {
                add(objectItem(obj.name, obj.kind), prefix);
            }
            return { resolution: "loaded" };
        }
    }
    // 3. Dotted catalog object (schema.object / db.schema.object): columns
    // through the same resolution path FROM sources use (resolveNameParts,
    // which includes the static system-catalog fallback — sys.databases.
    // serves its curated columns).
    if (parts.length === 2 || parts.length === 3) {
        const resolution = resolveNameParts(parts, {
            overlay: input.overlay,
            batchIndex: input.batchIndex,
            ordinal: input.ordinal,
            pinned: input.pinned,
            caseSensitive: input.pinned.env.caseSensitive,
        });
        if (resolution.kind === "catalog") {
            const columnsReady =
                input.pinned.readiness.columns === "ready" ||
                input.pinned.readiness.columns === "partial";
            const columns = columnsReady ? input.pinned.getColumns(resolution.ref) : undefined;
            if (columns === undefined) {
                markIncomplete("columnsNotReady");
                return {
                    resolution:
                        input.pinned.readiness.columns === "loading" ? "loading" : "notLoaded",
                    columnsRef: resolution.ref,
                };
            }
            const info = input.pinned.getObject(resolution.ref);
            const fromLabel =
                info !== undefined ? `${info.schema}.${info.name}` : parts[parts.length - 1];
            for (const col of columns) {
                add(
                    {
                        label: col.name,
                        kind: "column",
                        insertText: quoteIdentifier(col.name),
                        detail: columnDetail(col.typeDisplay, col.isPrimaryKey, fromLabel),
                        filterText: col.name,
                    },
                    prefix,
                    col.isPrimaryKey === true ? 10 : 0,
                );
            }
            return { resolution: "loaded" };
        }
    }
    // 4. Database qualifier → schemas of that database (only current db hydrated).
    if (parts.length === 1 && input.databases !== undefined) {
        const isDatabase = input.databases.some(
            (d) => d.name.toLowerCase() === qualifier.toLowerCase(),
        );
        if (isDatabase) {
            const current = input.pinned.env.currentDatabase;
            if (current !== undefined && qualifier.toLowerCase() === current.toLowerCase()) {
                for (const schema of input.pinned.listSchemas()) {
                    add(
                        {
                            label: schema.name,
                            kind: "schema",
                            insertText: quoteIdentifier(schema.name),
                        },
                        prefix,
                    );
                }
                return { resolution: "loaded" };
            }
            markIncomplete("crossDatabaseUnhydrated");
            return { resolution: "unresolved" };
        }
    }
    // Unknown qualifier: stay silent rather than wrong (§ honesty).
    return { resolution: "unresolved" };
}

function suppressionOf(bound: BoundSource): string {
    return bound.resolution.kind === "opaque" ? bound.resolution.reason : "columnsNotReady";
}

function objectItem(name: string, kind: LangObjectKind): Omit<SqlCompletionItem, "sortText"> {
    const itemKind: SqlCompletionItemKind =
        kind === "view"
            ? "view"
            : kind === "procedure"
              ? "procedure"
              : kind === "scalarFunction" || kind === "tableFunction"
                ? "function"
                : "table";
    return {
        label: name,
        kind: itemKind,
        insertText: quoteIdentifier(name),
        filterText: name,
        commitCharacters: ["."],
    };
}

function addTableSources(
    input: CompletionComputeInput,
    prefix: string,
    afterJoin: boolean,
    add: AddFn,
    markIncomplete: (reason: string) => void,
): void {
    // CTEs of this statement.
    for (const cte of input.sketch.ctes) {
        add(
            {
                label: cte.name,
                kind: "table",
                insertText: quoteIdentifier(cte.name),
                detail: "CTE",
            },
            prefix,
            40,
        );
    }
    // Overlay objects (#temp, @tablevar, script tables).
    for (const obj of input.overlay.visibleObjectsAt(input.batchIndex, input.ordinal)) {
        add(
            {
                label: obj.name,
                kind: "table",
                insertText: obj.name,
                detail:
                    obj.kind === "tempTable"
                        ? "temp table"
                        : obj.kind === "tableVariable"
                          ? "table variable"
                          : "script table",
            },
            prefix,
            30,
        );
    }
    // Catalog objects.
    if (
        input.pinned.readiness.objects !== "ready" &&
        input.pinned.readiness.objects !== "partial"
    ) {
        markIncomplete("providerNotReady");
        addSchemas(input, prefix, add);
        return;
    }
    // FK-adjacency boost after JOIN (§10.2): tables connected to in-scope sources.
    const adjacent = afterJoin ? fkAdjacentObjectIds(input) : new Set<number>();
    for (const obj of input.pinned.searchObjects({
        prefix: prefix.length > 0 ? prefix : undefined,
        kinds: ["table", "view", "tableFunction", "synonym"],
        limit: MAX_ITEMS,
    })) {
        const boost =
            (adjacent.has(obj.ref.objectId) ? 120 : 0) +
            (obj.schema.toLowerCase() === input.pinned.env.defaultSchema.toLowerCase() ? 10 : 0);
        add(
            {
                ...objectItem(obj.name, obj.kind),
                label: `${obj.schema}.${obj.name}`,
                insertText: quoteParts([obj.schema, obj.name]),
                filterText: obj.name,
            },
            prefix,
            boost,
        );
    }
    addSchemas(input, prefix, add);
}

function addSchemas(input: CompletionComputeInput, prefix: string, add: AddFn): void {
    for (const schema of input.pinned.listSchemas()) {
        add(
            {
                label: schema.name,
                kind: "schema",
                insertText: quoteIdentifier(schema.name),
                commitCharacters: ["."],
            },
            prefix,
        );
    }
}

function fkAdjacentObjectIds(input: CompletionComputeInput): Set<number> {
    const adjacent = new Set<number>();
    if (input.pinned.readiness.foreignKeys !== "ready") {
        return adjacent;
    }
    for (const bound of input.binding.sourcesAt(input.offset)) {
        if (bound.resolution.kind !== "catalog") {
            continue;
        }
        for (const edge of input.pinned.fkFrom(bound.resolution.ref)) {
            adjacent.add(edge.to.objectId);
        }
        for (const edge of input.pinned.fkTo(bound.resolution.ref)) {
            adjacent.add(edge.from.objectId);
        }
    }
    return adjacent;
}

function addJoinPredicates(input: CompletionComputeInput, add: AddFn): void {
    if (input.pinned.readiness.foreignKeys !== "ready") {
        return;
    }
    const sources = input.binding
        .sourcesAt(input.offset)
        .filter((s) => s.resolution.kind === "catalog");
    if (sources.length < 2) {
        return;
    }
    // The just-joined source is the LAST one in scope order.
    const joined = sources[sources.length - 1];
    const joinedRef = joined.resolution.kind === "catalog" ? joined.resolution.ref : undefined;
    if (joinedRef === undefined) {
        return;
    }
    for (const other of sources.slice(0, -1)) {
        if (other.resolution.kind !== "catalog") {
            continue;
        }
        const otherRef = other.resolution.ref;
        // joined -> other
        for (const edge of input.pinned.fkFrom(joinedRef)) {
            if (edge.to.objectId === otherRef.objectId && edge.columns.length > 0) {
                addPredicate(add, joined.label, other.label, edge.columns, true);
            }
        }
        // other -> joined
        for (const edge of input.pinned.fkFrom(otherRef)) {
            if (edge.to.objectId === joinedRef.objectId && edge.columns.length > 0) {
                addPredicate(add, other.label, joined.label, edge.columns, true);
            }
        }
    }
}

function addPredicate(
    add: AddFn,
    fromLabel: string,
    toLabel: string,
    columns: readonly { fromColumn: string; toColumn: string }[],
    isFk: boolean,
): void {
    const predicate = columns
        .map(
            (pair) =>
                `${quoteIdentifier(fromLabel)}.${quoteIdentifier(pair.fromColumn)} = ${quoteIdentifier(toLabel)}.${quoteIdentifier(pair.toColumn)}`,
        )
        .join(" AND ");
    add(
        {
            label: predicate,
            kind: "join",
            insertText: predicate,
            detail: isFk ? "foreign key" : "inferred",
        },
        "",
        isFk ? 50 : 0,
    );
}

function addStarExpansion(
    input: CompletionComputeInput,
    add: AddFn,
    boundOverride?: BoundSource,
): void {
    // Offer expansion for the caret's star item or an explicit alias.* target.
    const starItem = input.sketch.selectItems.find(
        (it) => it.isStar && input.offset >= it.span.start - 1 && input.offset <= it.span.end + 1,
    );
    if (starItem === undefined && boundOverride === undefined) {
        return;
    }
    const sources =
        boundOverride !== undefined
            ? [boundOverride]
            : starItem?.starQualifier !== undefined
              ? [input.binding.resolveQualifier(input.offset, starItem.starQualifier)].filter(
                    (b): b is BoundSource => b !== undefined,
                )
              : input.binding.sourcesAt(input.offset);
    const names: string[] = [];
    for (const bound of sources) {
        // Static-catalog system shapes are curated subsets — expanding *
        // into a partial column list would silently drop columns (§10.4).
        if (bound.resolution.kind === "catalog") {
            const info = input.pinned.getObject(bound.resolution.ref);
            if (info !== undefined && isSystemSchemaName(info.schema)) {
                return;
            }
        }
        const columns = input.binding.columnsOf(bound);
        if (columns === undefined) {
            return; // incomplete metadata: do not offer expansion (§10.4)
        }
        const qualify = sources.length > 1 || bound.source.alias !== undefined;
        for (const col of columns) {
            names.push(
                qualify
                    ? `${quoteIdentifier(bound.label)}.${quoteIdentifier(col.name)}`
                    : quoteIdentifier(col.name),
            );
        }
    }
    if (names.length === 0) {
        return;
    }
    const single = names.join(", ");
    const insertText = single.length > 100 ? names.join(",\n       ") : single;
    const replaceRange: SqlLanguageRange | undefined =
        starItem !== undefined
            ? {
                  start: input.positionAt(starItem.span.start),
                  end: input.positionAt(starItem.span.end),
              }
            : undefined;
    add(
        {
            label: "Expand columns",
            kind: "snippet",
            insertText,
            detail: `${names.length} columns`,
            replaceRange,
            filterText: "*",
        },
        "",
        200,
    );
}

function addInsertColumns(
    input: CompletionComputeInput,
    add: AddFn,
    markIncomplete: (reason: string) => void,
): void {
    const target = input.sketch.target;
    if (target === undefined) {
        return;
    }
    const bound = input.binding.resolveQualifier(
        input.offset,
        target.parts[target.parts.length - 1],
    );
    const columns =
        bound !== undefined ? input.binding.columnsOf(bound) : columnsOfParts(input, target.parts);
    if (columns === undefined) {
        markIncomplete("columnsNotReady");
        return;
    }
    const listed = new Set((input.sketch.insertColumns?.names ?? []).map((n) => n.toLowerCase()));
    const writable = columns.filter(
        (c) => !listed.has(c.name.toLowerCase()) && c.isIdentity !== true && c.isComputed !== true,
    );
    for (const col of writable) {
        add(
            {
                label: col.name,
                kind: "column",
                insertText: quoteIdentifier(col.name),
                detail: col.typeDisplay,
                filterText: col.name,
            },
            "",
        );
    }
    // All-columns scaffold.
    if (writable.length > 1) {
        add(
            {
                label: "(all columns)",
                kind: "snippet",
                insertText: writable.map((c) => quoteIdentifier(c.name)).join(", "),
                detail: `${writable.length} writable columns`,
                filterText: "all",
            },
            "",
            100,
        );
    }
}

function columnsOfParts(
    input: CompletionComputeInput,
    parts: readonly string[],
):
    | readonly { name: string; typeDisplay?: string; isIdentity?: boolean; isComputed?: boolean }[]
    | undefined {
    const resolution = input.pinned.resolveObject(parts.filter((p) => p.length > 0));
    if (resolution.kind !== "resolved") {
        return undefined;
    }
    return input.pinned.getColumns(resolution.ref);
}

function addUpdateSetColumns(
    input: CompletionComputeInput,
    add: AddFn,
    markIncomplete: (reason: string) => void,
): void {
    const target = input.sketch.target;
    if (target === undefined) {
        return;
    }
    // Alias-form target resolves through FROM sources; direct names via catalog.
    const bound = input.binding.resolveQualifier(
        input.offset,
        target.parts[target.parts.length - 1],
    );
    const columns =
        bound !== undefined ? input.binding.columnsOf(bound) : columnsOfParts(input, target.parts);
    if (columns === undefined) {
        markIncomplete("columnsNotReady");
        return;
    }
    for (const col of columns) {
        if (col.isComputed === true) {
            continue;
        }
        add(
            {
                label: col.name,
                kind: "column",
                insertText: `${quoteIdentifier(col.name)} = `,
                detail: col.typeDisplay,
                filterText: col.name,
            },
            "",
        );
    }
}

function addProcedures(
    input: CompletionComputeInput,
    prefix: string,
    add: AddFn,
    markIncomplete: (reason: string) => void,
): void {
    if (
        input.pinned.readiness.objects !== "ready" &&
        input.pinned.readiness.objects !== "partial"
    ) {
        markIncomplete("providerNotReady");
        return;
    }
    for (const obj of input.pinned.searchObjects({
        prefix: prefix.length > 0 ? prefix : undefined,
        kinds: ["procedure"],
        limit: MAX_ITEMS,
    })) {
        add(
            {
                label: `${obj.schema}.${obj.name}`,
                kind: "procedure",
                insertText: quoteParts([obj.schema, obj.name]),
                filterText: obj.name,
            },
            prefix,
        );
    }
}

function addExecParams(
    input: CompletionComputeInput,
    add: AddFn,
    markIncomplete: (reason: string) => void,
): void {
    const exec = input.sketch.exec;
    if (exec === undefined || exec.procParts.length === 0) {
        return;
    }
    if (input.pinned.readiness.parameters !== "ready") {
        markIncomplete("providerNotReady");
        return;
    }
    const resolution = input.pinned.resolveObject([...exec.procParts]);
    if (resolution.kind !== "resolved") {
        return;
    }
    const params = input.pinned.getParameters(resolution.ref);
    if (params === undefined) {
        markIncomplete("providerNotReady");
        return;
    }
    const supplied = new Set(
        exec.args.map((a) => a.name?.toLowerCase()).filter((n): n is string => n !== undefined),
    );
    for (const param of params) {
        if (param.ordinal === 0 || supplied.has(param.name.toLowerCase())) {
            continue;
        }
        add(
            {
                label: param.name,
                kind: "parameter",
                insertText: `${param.name} = `,
                detail: `${param.typeDisplay}${param.isOutput ? " OUTPUT" : ""}`,
                filterText: param.name,
            },
            "",
        );
    }
}

function addTypeKeywords(input: CompletionComputeInput, prefix: string, add: AddFn): void {
    for (const kw of TSQL_KEYWORDS) {
        if (kw.category === "type") {
            add(keywordItem(input, kw.id), prefix, 10);
        }
    }
    add(keywordItem(input, "TABLE"), prefix, 20);
}

function addDatabases(
    input: CompletionComputeInput,
    prefix: string,
    add: AddFn,
    markIncomplete: (reason: string) => void,
): void {
    if (input.databases === undefined) {
        markIncomplete("databasesUnavailable");
        return;
    }
    for (const db of input.databases) {
        add({ label: db.name, kind: "database", insertText: quoteIdentifier(db.name) }, prefix);
    }
}
