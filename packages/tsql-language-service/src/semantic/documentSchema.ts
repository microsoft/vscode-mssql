/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    SemanticColumn,
    SemanticObject,
    SemanticObjectKind,
    SemanticParameter,
    SemanticSpan,
} from "./contracts.js";
import {
    normalizeSemanticIdentifier,
    sameSemanticName,
    semanticObjectIdentity,
    splitMultipartIdentifier,
} from "./names.js";

export type DocumentSchemaOperation =
    | "create"
    | "replace"
    | "drop"
    | "addColumns"
    | "alterColumns"
    | "dropColumns";

/** Ordered, parser-normalized DDL fact. Adapters may create these directly from their AST. */
export interface DocumentSchemaChange {
    readonly operation: DocumentSchemaOperation;
    readonly kind: SemanticObjectKind;
    readonly nameParts: readonly string[];
    readonly span: SemanticSpan;
    readonly declarationSpan?: SemanticSpan;
    readonly batch?: number;
    readonly columns?: readonly SemanticColumn[];
    readonly parameters?: readonly SemanticParameter[];
    readonly returnType?: string;
    readonly typeKind?: "alias" | "table" | "clr" | "xmlSchema";
    readonly baseType?: string;
}

export interface DocumentSchemaOptions {
    readonly defaultSchema?: string;
    readonly uri?: string;
}

/** A lightweight view whose lookups are constrained to schema facts visible at one offset. */
export interface DocumentSchemaView {
    readonly offset: number;
    resolve(parts: readonly string[], kind?: SemanticObjectKind): SemanticObject | undefined;
    columnsFor(parts: readonly string[]): readonly SemanticColumn[] | undefined;
    definitionSpanFor(
        parts: readonly string[],
        kind?: SemanticObjectKind,
    ): SemanticSpan | undefined;
}

interface ObjectTimeline {
    readonly identityKey: string;
    readonly parts: readonly string[];
    readonly kind: SemanticObjectKind;
    readonly states: SchemaState[];
}

interface SchemaState {
    readonly visibleAt: number;
    readonly object: SemanticObject | undefined;
}

/**
 * Immutable, ordered model of the objects visible from a document. `GO` ends a batch but does
 * not reset schema objects, matching SQL Server scripting semantics.
 */
export class DocumentSchemaEvolution {
    private readonly timelinesBySuffix: ReadonlyMap<string, readonly ObjectTimeline[]>;

    public readonly objects: readonly SemanticObject[];
    public readonly defaultSchema: string;
    public readonly uri?: string;

    public constructor(
        changes: readonly DocumentSchemaChange[],
        options: DocumentSchemaOptions = {},
    ) {
        this.defaultSchema = options.defaultSchema ?? "dbo";
        this.uri = options.uri;
        const objects = new Map<string, SemanticObject>();
        const timelines = new Map<string, ObjectTimeline>();
        for (const change of [...changes].sort(compareChanges)) {
            const identityKey = this.apply(objects, change);
            if (!identityKey) continue;
            const current = objects.get(identityKey);
            const timeline =
                timelines.get(identityKey) ??
                createTimeline(identityKey, current, change, this.defaultSchema);
            timeline.states.push({ visibleAt: change.span.end, object: current });
            timelines.set(identityKey, timeline);
        }
        this.objects = Object.freeze([...objects.values()].sort(compareObjects));
        this.timelinesBySuffix = indexTimelines(timelines.values());
    }

    public static fromText(
        text: string,
        options: DocumentSchemaOptions = {},
    ): DocumentSchemaEvolution {
        return new DocumentSchemaEvolution(extractDocumentSchemaChanges(text), options);
    }

    public resolve(
        parts: readonly string[],
        kind?: SemanticObjectKind,
    ): SemanticObject | undefined {
        return this.selectCandidate(
            parts,
            this.objects.filter(
                (object) => (!kind || object.kind === kind) && suffixMatches(object.parts, parts),
            ),
        );
    }

    /** Resolves only objects whose DDL has completed on or before the requested offset. */
    public resolveAt(
        parts: readonly string[],
        offset: number,
        kind?: SemanticObjectKind,
    ): SemanticObject | undefined {
        const candidates = (this.timelinesBySuffix.get(normalizedPartsKey(parts)) ?? [])
            .filter((timeline) => !kind || timeline.kind === kind)
            .map((timeline) => stateAt(timeline.states, offset)?.object)
            .filter((object): object is SemanticObject => !!object);
        return this.selectCandidate(parts, candidates);
    }

    /** Creates a reusable offset-bound view for multiple completion/hover/reference lookups. */
    public atOffset(offset: number): DocumentSchemaView {
        return Object.freeze({
            offset,
            resolve: (parts, kind) => this.resolveAt(parts, offset, kind),
            columnsFor: (parts) => this.columnsForAt(parts, offset),
            definitionSpanFor: (parts, kind) => this.definitionSpanAt(parts, offset, kind),
        });
    }

    public columnsForAt(
        parts: readonly string[],
        offset: number,
    ): readonly SemanticColumn[] | undefined {
        return this.resolveAt(parts, offset)?.columns;
    }

    /** Object declaration/replacement span, suitable for LSP definition navigation. */
    public definitionSpanAt(
        parts: readonly string[],
        offset: number,
        kind?: SemanticObjectKind,
    ): SemanticSpan | undefined {
        return this.resolveAt(parts, offset, kind)?.definition;
    }

    private selectCandidate(
        parts: readonly string[],
        candidates: readonly SemanticObject[],
    ): SemanticObject | undefined {
        if (candidates.length === 0) {
            return undefined;
        }
        if (parts.length === 1) {
            return (
                candidates.find(
                    (candidate) =>
                        normalizeSemanticIdentifier(candidate.parts.at(-2) ?? "") ===
                        normalizeSemanticIdentifier(this.defaultSchema),
                ) ?? (candidates.length === 1 ? candidates[0] : undefined)
            );
        }
        return candidates.length === 1 ? candidates[0] : undefined;
    }

    public columnsFor(parts: readonly string[]): readonly SemanticColumn[] | undefined {
        return this.resolve(parts)?.columns;
    }

    public objectFor(parts: readonly string[]): SemanticObject | undefined {
        return this.resolve(parts);
    }

    private apply(
        objects: Map<string, SemanticObject>,
        change: DocumentSchemaChange,
    ): string | undefined {
        const parts = qualifyParts(change.nameParts, this.defaultSchema);
        const existing =
            this.findExisting(objects, parts, change.kind) ??
            (change.operation === "drop" && change.kind === "scalarFunction"
                ? this.findExisting(objects, parts, "tableFunction")
                : undefined);
        const key = existing?.identity.key ?? semanticObjectIdentity(change.kind, parts).key;

        if (change.operation === "drop") {
            if (existing) {
                objects.delete(existing.identity.key);
            }
            return existing?.identity.key;
        }

        if (change.operation === "addColumns" || change.operation === "alterColumns") {
            const target = existing;
            if (!target) {
                return undefined;
            }
            const columns = mergeColumns(target.columns ?? [], change.columns ?? []);
            objects.set(key, makeObject(target, { columns, batch: change.batch }));
            return key;
        }

        if (change.operation === "dropColumns") {
            if (!existing) {
                return undefined;
            }
            const names = new Set(
                (change.columns ?? []).map((column) => normalizeSemanticIdentifier(column.name)),
            );
            const columns = (existing.columns ?? []).filter(
                (column) => !names.has(normalizeSemanticIdentifier(column.name)),
            );
            objects.set(key, makeObject(existing, { columns, batch: change.batch }));
            return key;
        }

        const replace = change.operation === "replace" || !existing;
        const source = existing;
        const object: SemanticObject = Object.freeze({
            identity: source?.identity ?? semanticObjectIdentity(change.kind, parts),
            parts: Object.freeze([...parts]),
            name: parts.at(-1) ?? "",
            kind: change.kind,
            columns: freezeColumns(replace ? change.columns : (change.columns ?? source?.columns)),
            parameters: freezeParameters(
                replace ? change.parameters : (change.parameters ?? source?.parameters),
            ),
            returnType: change.returnType ?? source?.returnType,
            typeKind: change.typeKind ?? source?.typeKind,
            baseType: change.baseType ?? source?.baseType,
            definition: change.declarationSpan ?? change.span,
            uri: this.uri,
            batch: change.batch ?? 0,
        });
        objects.set(key, object);
        return key;
    }

    private findExisting(
        objects: ReadonlyMap<string, SemanticObject>,
        parts: readonly string[],
        kind: SemanticObjectKind,
    ): SemanticObject | undefined {
        return [...objects.values()].find(
            (object) => object.kind === kind && sameSemanticName(object.parts, parts),
        );
    }
}

/**
 * Lightweight fallback extractor for hosts that have not yet supplied AST normalization. It is
 * deliberately limited to DDL facts; production adapters should prefer emitting
 * `DocumentSchemaChange` directly from their current parser snapshots.
 */
export function extractDocumentSchemaChanges(text: string): readonly DocumentSchemaChange[] {
    const tokens = lexDdl(text);
    const changes: DocumentSchemaChange[] = [];
    let batch = 0;
    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index]!;
        if (isWord(token, "GO")) {
            batch++;
            continue;
        }
        if (isWord(token, "CREATE")) {
            const parsed = parseCreate(tokens, index, batch);
            if (parsed) {
                changes.push(parsed.change);
                index = parsed.end - 1;
            }
            continue;
        }
        if (isWord(token, "ALTER")) {
            const parsed = parseAlter(tokens, index, batch);
            if (parsed) {
                changes.push(parsed.change);
                index = parsed.end - 1;
            }
            continue;
        }
        if (isWord(token, "DROP")) {
            const parsed = parseDrop(tokens, index, batch);
            if (parsed) {
                changes.push(parsed.change);
                index = parsed.end - 1;
            }
        }
    }
    return Object.freeze(changes);
}

interface DdlToken {
    readonly value: string;
    readonly start: number;
    readonly end: number;
}

interface ParsedChange {
    readonly change: DocumentSchemaChange;
    readonly end: number;
}

function parseCreate(
    tokens: readonly DdlToken[],
    start: number,
    batch: number,
): ParsedChange | undefined {
    let index = start + 1;
    if (isWord(tokens[index], "OR") && isWord(tokens[index + 1], "ALTER")) {
        index += 2;
    }
    const kind = objectKind(tokens[index]);
    if (!kind) {
        return undefined;
    }
    index++;
    const name = readMultipartName(tokens, index);
    if (!name) {
        return undefined;
    }
    index = name.end;
    const objectEnd = findStatementEnd(tokens, index);
    const body = tokens.slice(index, objectEnd);
    const parameters = isRoutine(kind) ? parseParameters(body) : undefined;
    const columns = kind === "table" ? parseTableColumns(body) : undefined;
    const functionShape = kind === "scalarFunction" ? functionKind(body) : kind;
    return {
        change: {
            operation: "replace",
            kind: functionShape,
            nameParts: name.parts,
            span: { start: tokens[start]!.start, end: tokens[Math.max(start, objectEnd - 1)]!.end },
            batch,
            columns,
            parameters,
            returnType: functionReturnType(body),
        },
        end: objectEnd,
    };
}

function parseAlter(
    tokens: readonly DdlToken[],
    start: number,
    batch: number,
): ParsedChange | undefined {
    const kind = objectKind(tokens[start + 1]);
    if (!kind) {
        return undefined;
    }
    const name = readMultipartName(tokens, start + 2);
    if (!name) {
        return undefined;
    }
    const end = findStatementEnd(tokens, name.end);
    const body = tokens.slice(name.end, end);
    const functionShape = kind === "scalarFunction" ? functionKind(body) : kind;
    if (kind !== "table") {
        return {
            change: {
                operation: "replace",
                kind: functionShape,
                nameParts: name.parts,
                span: { start: tokens[start]!.start, end: tokens[Math.max(start, end - 1)]!.end },
                batch,
                parameters: isRoutine(kind) ? parseParameters(body) : undefined,
                returnType: functionReturnType(body),
            },
            end,
        };
    }
    const action = body[0]?.value.toLocaleUpperCase("en-US");
    const afterAction = body.slice(1);
    const columns = parseAlterColumns(
        isWord(afterAction[0], "COLUMN") ? afterAction.slice(1) : afterAction,
    );
    if (!action || columns.length === 0 || !["ADD", "ALTER", "DROP"].includes(action)) {
        return undefined;
    }
    return {
        change: {
            operation:
                action === "ADD"
                    ? "addColumns"
                    : action === "ALTER"
                      ? "alterColumns"
                      : "dropColumns",
            kind,
            nameParts: name.parts,
            span: { start: tokens[start]!.start, end: tokens[Math.max(start, end - 1)]!.end },
            batch,
            columns,
        },
        end,
    };
}

function parseDrop(
    tokens: readonly DdlToken[],
    start: number,
    batch: number,
): ParsedChange | undefined {
    const kind = objectKind(tokens[start + 1]);
    if (!kind) {
        return undefined;
    }
    let index = start + 2;
    if (isWord(tokens[index], "IF") && isWord(tokens[index + 1], "EXISTS")) {
        index += 2;
    }
    const name = readMultipartName(tokens, index);
    if (!name) {
        return undefined;
    }
    return {
        change: {
            operation: "drop",
            kind,
            nameParts: name.parts,
            span: { start: tokens[start]!.start, end: name.endOffset },
            batch,
        },
        end: name.end,
    };
}

function objectKind(token: DdlToken | undefined): SemanticObjectKind | undefined {
    switch (token?.value.toLocaleUpperCase("en-US")) {
        case "TABLE":
            return "table";
        case "VIEW":
            return "view";
        case "PROC":
        case "PROCEDURE":
            return "procedure";
        case "FUNCTION":
            return "scalarFunction";
        default:
            return undefined;
    }
}

function readMultipartName(
    tokens: readonly DdlToken[],
    start: number,
):
    | { readonly parts: readonly string[]; readonly end: number; readonly endOffset: number }
    | undefined {
    const parts: string[] = [];
    let index = start;
    while (tokens[index] && tokens[index]!.value !== "(" && tokens[index]!.value !== ";") {
        if (tokens[index]!.value === ".") {
            index++;
            continue;
        }
        if (!isIdentifierLike(tokens[index]!)) {
            break;
        }
        parts.push(unquoteIdentifier(tokens[index]!.value));
        index++;
        if (tokens[index]?.value !== ".") {
            break;
        }
    }
    if (parts.length === 0) {
        return undefined;
    }
    return { parts: Object.freeze(parts), end: index, endOffset: tokens[index - 1]!.end };
}

function parseTableColumns(tokens: readonly DdlToken[]): readonly SemanticColumn[] {
    const open = tokens.findIndex((token) => token.value === "(");
    if (open < 0) {
        return Object.freeze([]);
    }
    const close = matchingCloseParen(tokens, open);
    if (close < 0) {
        return Object.freeze([]);
    }
    return Object.freeze(
        splitTopLevel(tokens.slice(open + 1, close), ",")
            .map(parseColumn)
            .filter((column): column is SemanticColumn => !!column),
    );
}

function parseAlterColumns(tokens: readonly DdlToken[]): readonly SemanticColumn[] {
    const withoutParens =
        tokens[0]?.value === "(" && matchingCloseParen(tokens, 0) === tokens.length - 1
            ? tokens.slice(1, -1)
            : tokens;
    return Object.freeze(
        splitTopLevel(withoutParens, ",")
            .map(parseColumn)
            .filter((column): column is SemanticColumn => !!column),
    );
}

function parseColumn(tokens: readonly DdlToken[]): SemanticColumn | undefined {
    const first = tokens[0];
    if (!first || !isIdentifierLike(first) || isTableConstraint(first)) {
        return undefined;
    }
    const name = unquoteIdentifier(first.value);
    if (isWord(tokens[1], "AS")) {
        return { name, span: { start: first.start, end: first.end } };
    }
    const typeTokens: DdlToken[] = [];
    let depth = 0;
    for (const token of tokens.slice(1)) {
        const upper = token.value.toLocaleUpperCase("en-US");
        if (
            depth === 0 &&
            [
                "NULL",
                "NOT",
                "CONSTRAINT",
                "PRIMARY",
                "UNIQUE",
                "REFERENCES",
                "CHECK",
                "DEFAULT",
                "IDENTITY",
                "COLLATE",
            ].includes(upper)
        ) {
            break;
        }
        typeTokens.push(token);
        if (token.value === "(") depth++;
        if (token.value === ")") depth--;
    }
    return {
        name,
        type: typeTokens.length > 0 ? renderTokens(typeTokens) : undefined,
        nullable: isWord(
            tokens.find((token) => isWord(token, "NULL")),
            "NULL",
        )
            ? !tokens.some(
                  (token, index) => isWord(token, "NOT") && isWord(tokens[index + 1], "NULL"),
              )
            : undefined,
        span: { start: first.start, end: first.end },
    };
}

function parseParameters(tokens: readonly DdlToken[]): readonly SemanticParameter[] {
    const open = tokens[0]?.value === "(" ? 0 : -1;
    const firstParameter = tokens.findIndex((token) => token.value.startsWith("@"));
    if (open < 0 && firstParameter < 0) {
        return Object.freeze([]);
    }
    const close = open >= 0 ? matchingCloseParen(tokens, open) : -1;
    const parameterTokens =
        open >= 0 && close >= 0
            ? tokens.slice(open + 1, close)
            : tokens.slice(
                  firstParameter,
                  findParameterEnd(tokens, firstParameter < 0 ? 0 : firstParameter),
              );
    return Object.freeze(
        splitTopLevel(parameterTokens, ",")
            .map((part) => {
                const first = part[0];
                if (!first || !first.value.startsWith("@")) {
                    return undefined;
                }
                const output = part.some((token) => isWord(token, "OUTPUT"));
                const equals = part.findIndex((token) => token.value === "=");
                const typeEnd = part.findIndex(
                    (token) => isWord(token, "OUTPUT") || token.value === "=",
                );
                return {
                    name: first.value,
                    type: renderTokens(part.slice(1, typeEnd < 0 ? part.length : typeEnd)),
                    direction: output ? "inputOutput" : "input",
                    optional: equals >= 0,
                    span: { start: first.start, end: first.end },
                } as SemanticParameter;
            })
            .filter((parameter): parameter is SemanticParameter => !!parameter),
    );
}

function findParameterEnd(tokens: readonly DdlToken[], start: number): number {
    for (let index = start; index < tokens.length; index++) {
        if (
            isWord(tokens[index], "AS") ||
            isWord(tokens[index], "WITH") ||
            isWord(tokens[index], "BEGIN")
        ) {
            return index;
        }
    }
    return tokens.length;
}

function functionKind(tokens: readonly DdlToken[]): SemanticObjectKind {
    const returns = tokens.findIndex((token) => isWord(token, "RETURNS"));
    if (returns >= 0 && isWord(tokens[returns + 1], "TABLE")) {
        return "tableFunction";
    }
    return "scalarFunction";
}

function functionReturnType(tokens: readonly DdlToken[]): string | undefined {
    const returns = tokens.findIndex((token) => isWord(token, "RETURNS"));
    if (returns < 0 || isWord(tokens[returns + 1], "TABLE")) {
        return undefined;
    }
    const type: DdlToken[] = [];
    for (const token of tokens.slice(returns + 1)) {
        if (isWord(token, "AS") || isWord(token, "WITH") || isWord(token, "BEGIN")) {
            break;
        }
        type.push(token);
    }
    return type.length > 0 ? renderTokens(type) : undefined;
}

function findStatementEnd(tokens: readonly DdlToken[], start: number): number {
    let depth = 0;
    for (let index = start; index < tokens.length; index++) {
        if (tokens[index]!.value === "(") depth++;
        if (tokens[index]!.value === ")") depth--;
        if (depth === 0 && (tokens[index]!.value === ";" || isWord(tokens[index], "GO"))) {
            return index;
        }
    }
    return tokens.length;
}

function matchingCloseParen(tokens: readonly DdlToken[], open: number): number {
    let depth = 0;
    for (let index = open; index < tokens.length; index++) {
        if (tokens[index]!.value === "(") depth++;
        if (tokens[index]!.value === ")") depth--;
        if (depth === 0) {
            return index;
        }
    }
    return -1;
}

function splitTopLevel(
    tokens: readonly DdlToken[],
    separator: string,
): readonly (readonly DdlToken[])[] {
    const parts: DdlToken[][] = [[]];
    let depth = 0;
    for (const token of tokens) {
        if (token.value === "(") depth++;
        if (token.value === ")") depth--;
        if (depth === 0 && token.value === separator) {
            parts.push([]);
        } else {
            parts.at(-1)!.push(token);
        }
    }
    return parts;
}

function lexDdl(text: string): readonly DdlToken[] {
    const tokens: DdlToken[] = [];
    for (let index = 0; index < text.length; ) {
        const start = index;
        if (/\s/.test(text[index]!)) {
            index++;
        } else if (text.startsWith("--", index)) {
            index = text.indexOf("\n", index + 2);
            if (index < 0) break;
        } else if (text.startsWith("/*", index)) {
            const end = text.indexOf("*/", index + 2);
            index = end < 0 ? text.length : end + 2;
        } else if (text[index] === "'") {
            index++;
            while (index < text.length) {
                if (text[index] === "'" && text[index + 1] === "'") index += 2;
                else if (text[index++] === "'") break;
            }
        } else if (text[index] === "[") {
            index++;
            while (index < text.length) {
                if (text[index] === "]" && text[index + 1] === "]") index += 2;
                else if (text[index++] === "]") break;
            }
            tokens.push({ value: text.slice(start, index), start, end: index });
        } else if (text[index] === '"') {
            index++;
            while (index < text.length) {
                if (text[index] === '"' && text[index + 1] === '"') index += 2;
                else if (text[index++] === '"') break;
            }
            tokens.push({ value: text.slice(start, index), start, end: index });
        } else if (/[A-Za-z_@#$]/.test(text[index]!)) {
            index++;
            while (index < text.length && /[A-Za-z0-9_@#$]/.test(text[index]!)) index++;
            tokens.push({ value: text.slice(start, index), start, end: index });
        } else if (/\d/.test(text[index]!)) {
            index++;
            while (index < text.length && /\d/.test(text[index]!)) index++;
            tokens.push({ value: text.slice(start, index), start, end: index });
        } else {
            index++;
            tokens.push({ value: text.slice(start, index), start, end: index });
        }
    }
    return tokens;
}

function qualifyParts(parts: readonly string[], defaultSchema: string): readonly string[] {
    if (parts.length === 1) {
        return Object.freeze([defaultSchema, parts[0]!]);
    }
    return Object.freeze([...parts]);
}

function createTimeline(
    identityKey: string,
    current: SemanticObject | undefined,
    change: DocumentSchemaChange,
    defaultSchema: string,
): ObjectTimeline {
    return {
        identityKey,
        parts: current?.parts ?? qualifyParts(change.nameParts, defaultSchema),
        kind: current?.kind ?? change.kind,
        states: [],
    };
}

function indexTimelines(
    timelines: Iterable<ObjectTimeline>,
): ReadonlyMap<string, readonly ObjectTimeline[]> {
    const indexed = new Map<string, ObjectTimeline[]>();
    for (const timeline of timelines) {
        for (let index = 0; index < timeline.parts.length; index++) {
            const key = normalizedPartsKey(timeline.parts.slice(index));
            const candidates = indexed.get(key) ?? [];
            if (!candidates.includes(timeline)) {
                candidates.push(timeline);
                indexed.set(key, candidates);
            }
        }
    }
    return new Map([...indexed.entries()].map(([key, value]) => [key, Object.freeze([...value])]));
}

function normalizedPartsKey(parts: readonly string[]): string {
    return parts.map(normalizeSemanticIdentifier).join(".");
}

function stateAt(states: readonly SchemaState[], offset: number): SchemaState | undefined {
    let low = 0;
    let high = states.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if ((states[middle]?.visibleAt ?? Number.POSITIVE_INFINITY) <= offset) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low > 0 ? states[low - 1] : undefined;
}

function suffixMatches(parts: readonly string[], requested: readonly string[]): boolean {
    const normalizedRequested = requested.map(normalizeSemanticIdentifier);
    if (normalizedRequested.length > parts.length) {
        return false;
    }
    return normalizedRequested.every(
        (part, index) =>
            part ===
            normalizeSemanticIdentifier(
                parts[parts.length - normalizedRequested.length + index] ?? "",
            ),
    );
}

function mergeColumns(
    existing: readonly SemanticColumn[],
    changes: readonly SemanticColumn[],
): readonly SemanticColumn[] {
    const byName = new Map(
        existing.map((column) => [normalizeSemanticIdentifier(column.name), column]),
    );
    for (const column of changes) {
        byName.set(normalizeSemanticIdentifier(column.name), column);
    }
    return Object.freeze([...byName.values()]);
}

function makeObject(
    object: SemanticObject,
    change: Partial<Pick<SemanticObject, "columns" | "definition" | "batch">>,
): SemanticObject {
    return Object.freeze({
        ...object,
        ...change,
        columns: freezeColumns(change.columns ?? object.columns),
    });
}

function freezeColumns(
    columns: readonly SemanticColumn[] | undefined,
): readonly SemanticColumn[] | undefined {
    return columns
        ? Object.freeze(columns.map((column) => Object.freeze({ ...column })))
        : undefined;
}

function freezeParameters(
    parameters: readonly SemanticParameter[] | undefined,
): readonly SemanticParameter[] | undefined {
    return parameters
        ? Object.freeze(parameters.map((parameter) => Object.freeze({ ...parameter })))
        : undefined;
}

function compareChanges(left: DocumentSchemaChange, right: DocumentSchemaChange): number {
    return left.span.start - right.span.start || left.span.end - right.span.end;
}

function compareObjects(left: SemanticObject, right: SemanticObject): number {
    return left.identity.key.localeCompare(right.identity.key);
}

function isRoutine(kind: SemanticObjectKind): boolean {
    return kind === "procedure" || kind === "scalarFunction" || kind === "tableFunction";
}

function isWord(token: DdlToken | undefined, word: string): boolean {
    return token?.value.toLocaleUpperCase("en-US") === word;
}

function isIdentifierLike(token: DdlToken): boolean {
    return (
        token.value.startsWith("[") ||
        token.value.startsWith('"') ||
        /^[A-Za-z_@#$]/.test(token.value)
    );
}

function unquoteIdentifier(value: string): string {
    return splitMultipartIdentifier(value)[0] ?? value;
}

function isTableConstraint(token: DdlToken): boolean {
    return ["CONSTRAINT", "PRIMARY", "FOREIGN", "UNIQUE", "CHECK", "INDEX"].includes(
        token.value.toLocaleUpperCase("en-US"),
    );
}

function renderTokens(tokens: readonly DdlToken[]): string {
    return tokens
        .map((token, index) => {
            const previous = tokens[index - 1]?.value;
            if (token.value === ")" || token.value === "," || previous === "(") return token.value;
            if (token.value === "(") return "(";
            return `${index > 0 ? " " : ""}${token.value}`;
        })
        .join("")
        .trim();
}
