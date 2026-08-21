/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    multipartIdentifierParts,
    normalizeIdentifier,
    tsqlIdentifierPattern,
} from "../identifiers.js";

/**
 * Narrow text facts used only when the grammar deliberately retains an option as opaque text.
 *
 * This module is not a second SQL parser. Every recognizer answers one lexical question inside an
 * already-identified syntax node. Keeping the expressions here gives them one owner and lets the
 * focused tests exercise valid, malformed, Unicode, and token-boundary cases directly.
 */

const primaryKey = /\bPRIMARY\s+KEY\b/giu;
const generatedRow = /\bGENERATED\s+ALWAYS\s+AS\s+ROW\s+(START|END)\b/iu;
const nullOption = /\b(?:NOT\s+)?NULL\b/giu;
const sparseInvalidOption = /\bNOT\s+NULL\b|\bIDENTITY\b|\bROWGUIDCOL\b|\bFILESTREAM\b/iu;
const invalidSparseType = /^\s*(?:GEOGRAPHY|GEOMETRY|TEXT|NTEXT|IMAGE|TIMESTAMP)\b/iu;
const numericIdentity = /^[+-]?(?:[$£¥€]\s*)?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;

export interface ColumnDefinitionTextFacts {
    readonly primaryKeyCount: number;
    readonly columnSet: boolean;
    readonly generatedRow?: "START" | "END";
    readonly nullable: boolean;
    readonly explicitlyNullable: boolean;
    readonly identity: boolean;
    readonly computed: boolean;
    readonly rowGuidColumn: boolean;
    readonly hasDefault: boolean;
    readonly hasUnique: boolean;
    readonly hasSparse: boolean;
    readonly invalidSparseOption: boolean;
}

/** Reads options from a parser-owned column-definition node. */
export function columnDefinitionTextFacts(source: string): ColumnDefinitionTextFacts {
    const nullOptions = source.match(nullOption) ?? [];
    return {
        primaryKeyCount: countMatches(source, primaryKey),
        columnSet: /\bCOLUMN_SET\s+FOR\s+ALL_SPARSE_COLUMNS\b/iu.test(source),
        generatedRow: generatedRow.exec(source)?.[1]?.toUpperCase() as "START" | "END" | undefined,
        nullable: !/\bNOT\s+NULL\b/iu.test(source),
        explicitlyNullable: /\bNULL\b/iu.test(source) && !/\bNOT\s+NULL\b/iu.test(source),
        identity: /\bIDENTITY\b/iu.test(source),
        computed: /\bAS\b/iu.test(source),
        rowGuidColumn: /\bROWGUIDCOL\b/iu.test(source),
        hasDefault: /\bDEFAULT\b/iu.test(source),
        hasUnique: /\bUNIQUE\b/iu.test(source),
        hasSparse: /\bSPARSE\b/iu.test(source),
        invalidSparseOption: nullOptions.length === 0 || sparseInvalidOption.test(source),
    };
}

/** Counts duplicate column constraints retained inside one parser-owned column definition. */
export function columnConstraintCounts(source: string): ReadonlyMap<string, number> {
    return new Map([
        ["CHECK", countMatches(source, /\bCHECK\s*\(/giu)],
        ["DEFAULT", countMatches(source, /\bDEFAULT\b/giu)],
        ["IDENTITY", countMatches(source, /\bIDENTITY\b/giu)],
        ["PRIMARY KEY", countMatches(source, primaryKey)],
        ["ROWGUIDCOL", countMatches(source, /\bROWGUIDCOL\b/giu)],
        ["UNIQUE", countMatches(source, /\bUNIQUE\b/giu)],
        ["NULL", (source.match(nullOption) ?? []).length],
    ]);
}

/** True when a parsed data-type spelling is one of the types forbidden for sparse columns. */
export function isInvalidSparseDataType(source: string): boolean {
    return invalidSparseType.test(source);
}

/** Classifies a parser-owned routine parameter's trailing modifiers. */
export function routineParameterTextFacts(source: string): {
    readonly output: boolean;
    readonly readOnly: boolean;
    readonly hasDefault: boolean;
} {
    return {
        output: /\b(?:OUT|OUTPUT)\s*$/iu.test(source),
        readOnly: /\bREADONLY\b/iu.test(source),
        hasDefault: /=/u.test(source),
    };
}

/** Reads the CREATE/DROP verb from an already parsed principal statement. */
export function localLoginOperation(source: string): "CREATE" | "DROP" | undefined {
    return /^\s*(CREATE|DROP)\s+LOGIN\b/iu.exec(source)?.[1]?.toUpperCase() as
        | "CREATE"
        | "DROP"
        | undefined;
}

/** Classifies the body of an already parsed CREATE TYPE statement. */
export function localTypeCategory(source: string): "alias" | "clr" | "table" {
    if (/\bAS\s+TABLE\b/iu.test(source)) return "table";
    if (/\bEXTERNAL\s+NAME\b/iu.test(source)) return "clr";
    return "alias";
}

/** Distinguishes CREATE OR ALTER inside a shared CREATE module syntax node. */
export function isCreateOrAlter(source: string): boolean {
    return /^\s*CREATE\s+OR\s+ALTER\b/iu.test(source);
}

/** Reads a numeric generic index option from a parser-owned option node. */
export function integerIndexOption(
    source: string,
    name: "FILLFACTOR" | "MAXDOP",
): number | undefined {
    const match = new RegExp(String.raw`^\s*${name}\s*=\s*(-?\d+)`, "iu").exec(source)?.[1];
    return match === undefined ? undefined : Number(match);
}

/** Detects CREATE [UNIQUE] CLUSTERED INDEX inside a CreateIndexStatement node. */
export function isCreateClusteredIndex(source: string): boolean {
    return /^\s*CREATE\s+(?:UNIQUE\s+)?CLUSTERED\s+INDEX\b/iu.test(source);
}

/** Reads a SELECT-list assignment from an already parsed SelectElement node. */
export function selectElementAssignsVariable(source: string): boolean {
    return new RegExp(
        String.raw`^\s*${tsqlIdentifierPattern.namedVariable}\s*(?:=|\+=|-=|\*=|\/=|%=|&=|\|=|\^=)`,
        "u",
    ).test(source);
}

/** Reads an explicit AS alias when recovery did not preserve a dedicated alias node. */
export function recoveredSelectAlias(source: string): string | undefined {
    const match = new RegExp(
        String.raw`\bAS\s+(${tsqlIdentifierPattern.component})\s*$`,
        "iu",
    ).exec(source);
    return match ? normalizeIdentifier(match[1]!) : undefined;
}

/** Reads a named constraint when recovery retained only its enclosing constraint node. */
export function recoveredConstraintName(source: string): string {
    const match = new RegExp(
        String.raw`\bCONSTRAINT\s+(${tsqlIdentifierPattern.component})`,
        "iu",
    ).exec(source);
    return normalizeIdentifier(match?.[1] ?? "");
}

/** Recognizes the only direct uses permitted for an XML nodes() pseudo-column. */
export function isXmlNodeNullCheckSuffix(source: string): boolean {
    return /^\s+IS\s+(?:NOT\s+)?NULL\b/iu.test(source);
}

/** Reads an unqualified or qualified star from an already parsed SelectElement. */
export function selectStarQualifier(source: string): string | undefined | false {
    const match = /^(?:(.+)\.)?\*$/u.exec(source.trim());
    if (!match) return false;
    return match[1] === undefined ? undefined : normalizeIdentifier(match[1]);
}

/** Checks a numeric IDENTITY seed/increment after removing one optional wrapper pair. */
export function isNumericIdentityValue(source: string): boolean {
    const normalized = source
        .trim()
        .replace(/^\((.*)\)$/u, "$1")
        .trim();
    return numericIdentity.test(normalized);
}

/**
 * Conservative recovery fallback for expressions whose grammar node does not expose an operator.
 * It runs only inside a parser-owned boolean context; unknown text returns false and is diagnosed.
 */
export function hasBooleanOperator(source: string): boolean {
    return /(?:=|<>|!=|<=|>=|<|>|\bIS\s+(?:NOT\s+)?NULL\b|\bLIKE\b|\bIN\s*\(|\bBETWEEN\b|\bEXISTS\s*\(|\b(?:CONTAINS|FREETEXT)\s*\(|\bMATCH\s*\()/iu.test(
        source,
    );
}

export interface ParsedDataTypeText {
    readonly name: string;
    readonly arguments: readonly number[];
}

/**
 * Reads the lexical spelling of a parser-owned DataType node.
 *
 * DataType deliberately accepts incomplete arguments for editor recovery, so its numeric argument
 * list remains a measured text fallback rather than forcing the main grammar to reject the node.
 */
export function parseDataTypeText(source: string): ParsedDataTypeText | undefined {
    let cursor = skipWhitespace(source, 0);
    const nameStart = cursor;
    let nameEnd = dataTypeComponentEnd(source, cursor);
    if (nameEnd === undefined) return undefined;
    cursor = nameEnd;

    while (true) {
        const separator = skipWhitespace(source, cursor);
        if (source[separator] !== ".") break;
        const componentStart = skipWhitespace(source, separator + 1);
        const componentEnd = dataTypeComponentEnd(source, componentStart);
        if (componentEnd === undefined) break;
        nameEnd = componentEnd;
        cursor = componentEnd;
    }

    const name = multipartIdentifierParts(source.slice(nameStart, nameEnd)).at(-1)?.toLowerCase();
    if (!name) return undefined;
    cursor = skipWhitespace(source, cursor);
    const argumentStart = source[cursor] === "(" ? cursor + 1 : undefined;
    const argumentEnd = argumentStart === undefined ? -1 : source.indexOf(")", argumentStart);
    const argumentText = argumentEnd < 0 ? "" : source.slice(argumentStart, argumentEnd);
    const arguments_ = argumentText
        .split(",")
        .map((value) => value.trim())
        .filter((value) => /^[+-]?[0-9]+$/u.test(value))
        .map(Number);
    return { name, arguments: arguments_ };
}

function dataTypeComponentEnd(source: string, start: number): number | undefined {
    const opening = source[start];
    if (opening === "[" || opening === '"') {
        const closing = opening === "[" ? "]" : '"';
        let cursor = start + 1;
        while (cursor < source.length) {
            if (source[cursor] !== closing) {
                cursor++;
                continue;
            }
            if (source[cursor + 1] === closing) {
                cursor += 2;
                continue;
            }
            return cursor + 1;
        }
        return undefined;
    }
    const firstCharacter = codePointCharacter(source, start);
    if (!dataTypeIdentifierStart.test(firstCharacter)) return undefined;
    let cursor = start + firstCharacter.length;
    while (cursor < source.length) {
        const character = codePointCharacter(source, cursor);
        if (!dataTypeIdentifierContinuation.test(character)) break;
        cursor += character.length;
    }
    return cursor;
}

function codePointCharacter(source: string, offset: number): string {
    const codePoint = source.codePointAt(offset);
    return codePoint === undefined ? "" : String.fromCodePoint(codePoint);
}

function skipWhitespace(source: string, start: number): number {
    let cursor = start;
    while (cursor < source.length && source[cursor]!.trim().length === 0) cursor++;
    return cursor;
}

const dataTypeIdentifierStart = new RegExp(`^${tsqlIdentifierPattern.start}$`, "u");
const dataTypeIdentifierContinuation = new RegExp(`^${tsqlIdentifierPattern.continuation}$`, "u");

/** Removes a parser-owned data type's argument list while retaining its multipart name. */
export function dataTypeNameText(source: string): string {
    return source.replace(/\(.*$/su, "").trim();
}

/** Normalizes a system data-type spelling for registry lookup. */
export function normalizedSystemDataTypeText(source: string): string {
    return removeParenthesizedSegments(source).trim().replace(/\s+/gu, " ").toLowerCase();
}

function removeParenthesizedSegments(source: string): string {
    const retained: string[] = [];
    let cursor = 0;
    while (cursor < source.length) {
        const opening = source.indexOf("(", cursor);
        if (opening < 0) break;
        const closing = source.indexOf(")", opening + 1);
        if (closing < 0) break;
        retained.push(source.slice(cursor, opening));
        cursor = closing + 1;
    }
    retained.push(source.slice(cursor));
    return retained.join("");
}

/** Reads a declaration in an opaque recovery node without scanning outside that node. */
export function recoveredVariableDeclarations(
    source: string,
    baseOffset: number,
): readonly { readonly name: string; readonly start: number; readonly end: number }[] {
    const pattern = new RegExp(
        String.raw`\bDECLARE\s+(${tsqlIdentifierPattern.namedVariable})`,
        "giu",
    );
    return [...source.matchAll(pattern)].flatMap((match) => {
        if (match.index === undefined) return [];
        const relativeStart = match.index + match[0].lastIndexOf(match[1]!);
        const start = baseOffset + relativeStart;
        return [{ name: match[1]!, start, end: start + match[1]!.length }];
    });
}

/** Classifies index compatibility from a metadata-owned type display string. */
export function indexColumnTypeFacts(typeDisplay: string): {
    readonly validKey: boolean;
    readonly validIncluded: boolean;
    readonly requiresOfflineBuild: boolean;
    readonly validIndexedViewProjection: boolean;
} {
    const normalized = typeDisplay.replace(/\s+/gu, "").toLowerCase();
    const legacyLarge = /^(?:image|ntext|text)\b/u.test(normalized);
    const complex = /^(?:geography|geometry|xml)\b/u.test(normalized);
    const maximumLength = /^(?:nvarchar|varbinary|varchar)\(max\)$/u.test(normalized);
    return {
        validKey: !legacyLarge && !complex && !maximumLength,
        validIncluded: !legacyLarge,
        requiresOfflineBuild: maximumLength,
        validIndexedViewProjection: !/^(?:image|ntext|text|xml)\b/u.test(normalized),
    };
}

function countMatches(value: string, pattern: RegExp): number {
    return [...value.matchAll(pattern)].length;
}
