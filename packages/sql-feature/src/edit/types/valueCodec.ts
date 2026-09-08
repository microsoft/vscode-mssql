/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Turns an edited cell into a SQL literal of the column's declared type.
 *
 * Encoding is driven by the column type, never by the shape of the incoming JavaScript value.
 * That is what makes the result safe and predictable: a value destined for an `int` is parsed
 * as an integer and rejected if it is not one, so no string ever reaches the statement in a
 * position where a number belongs.
 *
 * The awkward types are handled deliberately rather than discovered in production. Spatial,
 * hierarchyid, sql_variant, rowversion and vector each have their own rule below, because each
 * one breaks a different assumption a naive encoder would make.
 */

import { Sql, SqlEditError, binaryLiteral, stringLiteral } from "../core/sql";

/** An explicit request to let SQL Server evaluate a column default. */
export interface DefaultValue {
    readonly $t: "default";
}

export const DEFAULT_VALUE: DefaultValue = { $t: "default" };

/** Values as they cross the wire from the grid: text, explicit null, or a default request. */
export type EditValue = string | null | DefaultValue;

export function isDefaultValue(value: unknown): value is DefaultValue {
    return typeof value === "object" && value !== null && (value as DefaultValue).$t === "default";
}

export interface ColumnTypeInfo {
    /** Base type name as `sys.types` reports it, lowercased, e.g. `nvarchar`, `geography`. */
    readonly typeName: string;
    readonly maxLength?: number;
    readonly precision?: number;
    readonly scale?: number;
    readonly isNullable: boolean;
    readonly hasDefault?: boolean;
}

const INTEGER_TYPES = new Set(["bit", "tinyint", "smallint", "int", "bigint"]);
const DECIMAL_TYPES = new Set(["decimal", "numeric", "money", "smallmoney"]);
const FLOAT_TYPES = new Set(["float", "real"]);
const TEXT_TYPES = new Set(["char", "nchar", "varchar", "nvarchar", "text", "ntext", "sysname"]);
const BINARY_TYPES = new Set(["binary", "varbinary", "image"]);
const DATE_TYPES = new Set(["date", "datetime", "datetime2", "smalldatetime"]);
const SPATIAL_TYPES = new Set(["geography", "geometry"]);

/**
 * Types a client must never be allowed to write.
 *
 * `rowversion` is maintained by the engine and is the one thing that makes optimistic
 * concurrency cheap, so writing it would defeat the check it exists to support. `timestamp` is
 * its older spelling.
 */
export const SERVER_ASSIGNED_TYPES: ReadonlySet<string> = new Set(["timestamp", "rowversion"]);

/** True for a type this engine can send a value for. */
export function isWritableType(typeName: string): boolean {
    const name = typeName.toLowerCase();
    return (
        INTEGER_TYPES.has(name) ||
        DECIMAL_TYPES.has(name) ||
        FLOAT_TYPES.has(name) ||
        TEXT_TYPES.has(name) ||
        BINARY_TYPES.has(name) ||
        DATE_TYPES.has(name) ||
        SPATIAL_TYPES.has(name) ||
        [
            "time",
            "datetimeoffset",
            "uniqueidentifier",
            "xml",
            "hierarchyid",
            "sql_variant",
            "vector",
            "json",
        ].includes(name)
    );
}

/**
 * Encodes one value as a literal of the column's type.
 *
 * A null is only accepted where the column allows it, so the failure names the column instead
 * of arriving from the server as a constraint violation with no context.
 */
export function encodeValue(value: EditValue, column: ColumnTypeInfo, columnName: string): Sql {
    const typeName = column.typeName.toLowerCase();

    if (isDefaultValue(value)) {
        if (!column.hasDefault) {
            throw new SqlEditError(
                `Column "${columnName}" does not have a default value.`,
                "invalidValue",
            );
        }
        return "DEFAULT";
    }

    if (!isWritableType(typeName)) {
        throw new SqlEditError(
            SERVER_ASSIGNED_TYPES.has(typeName)
                ? `Column "${columnName}" is maintained by the server and cannot be written.`
                : `Column "${columnName}" has type "${column.typeName}", which this editor cannot write.`,
            "unsupportedType",
        );
    }

    if (value === null) {
        if (!column.isNullable) {
            throw new SqlEditError(`Column "${columnName}" does not accept null.`, "invalidValue");
        }
        return "NULL";
    }

    if (INTEGER_TYPES.has(typeName)) {
        return encodeInteger(value, typeName, columnName);
    }
    if (DECIMAL_TYPES.has(typeName)) {
        return encodeExactNumeric(value, column, columnName);
    }
    if (FLOAT_TYPES.has(typeName)) {
        return encodeNumeric(value, typeName, columnName);
    }
    if (TEXT_TYPES.has(typeName)) {
        return encodeText(value, column, columnName);
    }
    if (BINARY_TYPES.has(typeName)) {
        return encodeBinary(value, columnName);
    }
    if (DATE_TYPES.has(typeName)) {
        return encodeDateTime(value, typeName, columnName);
    }

    switch (typeName) {
        case "time":
            return `CONVERT(time, ${stringLiteral(requireTime(value, columnName))}, 108)`;
        case "datetimeoffset":
            return `CONVERT(datetimeoffset, ${stringLiteral(requireOffset(value, columnName))}, 127)`;
        case "uniqueidentifier":
            return `CONVERT(uniqueidentifier, ${stringLiteral(requireGuid(value, columnName))})`;
        case "xml":
            // XML is checked by the server; sending it as an nvarchar cast keeps the literal
            // rules identical to text and lets the server report a malformed document.
            return `CONVERT(xml, ${stringLiteral(value)})`;
        case "hierarchyid":
            // The canonical string form, e.g. `/1/3/`. Parsing it here would duplicate the
            // server's own validation, so the cast is left to fail with a clear message.
            return `CONVERT(hierarchyid, ${stringLiteral(value)})`;
        case "sql_variant":
            // Without a declared inner type the safest representation is text: SQL Server keeps
            // the variant's base type as nvarchar, which round-trips what the user typed.
            return `CONVERT(sql_variant, ${stringLiteral(value)})`;
        case "vector":
            return `CONVERT(${vectorTypeFor(column, columnName)}, ${stringLiteral(requireJsonArray(value, columnName))})`;
        case "json":
            return `CONVERT(json, ${stringLiteral(value)})`;
        default:
            break;
    }

    if (SPATIAL_TYPES.has(typeName)) {
        return encodeSpatial(value, typeName, columnName);
    }

    // A type this engine does not model must not be guessed at: writing the wrong
    // representation would corrupt the column rather than fail.
    throw new SqlEditError(
        `Column "${columnName}" has type "${column.typeName}", which this editor cannot write.`,
        "unsupportedType",
    );
}

/**
 * Encodes a value for a comparison rather than for a write.
 *
 * A rowversion is the one thing that can never be written and yet must be comparable: matching
 * on it is the whole of the concurrency check. Writability is enforced where the SET and column
 * lists are built, so relaxing it here cannot let a value be written that should not be.
 */
export function encodeComparisonValue(
    value: EditValue,
    column: ColumnTypeInfo,
    columnName: string,
): Sql {
    if (isDefaultValue(value)) {
        throw new SqlEditError(
            `Column "${columnName}" cannot use a default in a row comparison.`,
            "invalidValue",
        );
    }
    if (value === null) {
        return "NULL";
    }
    if (SERVER_ASSIGNED_TYPES.has(column.typeName.toLowerCase())) {
        // rowversion and timestamp are eight-byte binary values.
        return encodeBinary(value, columnName);
    }
    return encodeValue(value, column, columnName);
}

function encodeInteger(value: string, typeName: string, columnName: string): Sql {
    const text = value.trim();
    if (typeName === "bit") {
        const lowered = text.toLowerCase();
        if (["1", "true", "yes"].includes(lowered)) {
            return "1";
        }
        if (["0", "false", "no"].includes(lowered)) {
            return "0";
        }
        throw new SqlEditError(`Column "${columnName}" takes true or false.`, "invalidValue");
    }
    if (!/^[+-]?\d+$/.test(text)) {
        throw new SqlEditError(`Column "${columnName}" takes a whole number.`, "invalidValue");
    }
    const n = BigInt(text);
    const range = INTEGER_RANGES[typeName];
    if (range && (n < range[0] || n > range[1])) {
        throw new SqlEditError(
            `${text} is outside the range of ${typeName} for column "${columnName}".`,
            "invalidValue",
        );
    }
    return n.toString();
}

const INTEGER_RANGES: Record<string, [bigint, bigint]> = {
    tinyint: [0n, 255n],
    smallint: [-32768n, 32767n],
    int: [-2147483648n, 2147483647n],
    bigint: [-9223372036854775808n, 9223372036854775807n],
};

function encodeNumeric(value: string, typeName: string, columnName: string): Sql {
    const text = value.trim();
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(text)) {
        throw new SqlEditError(`Column "${columnName}" takes a number.`, "invalidValue");
    }
    return `CONVERT(${typeName}, ${stringLiteral(text)})`;
}

/** Validate fixed-point values without ever passing through a JavaScript or SQL float. */
function encodeExactNumeric(value: string, column: ColumnTypeInfo, columnName: string): Sql {
    const typeName = column.typeName.toLowerCase();
    const money = typeName === "money" || typeName === "smallmoney";
    const precision = money ? (typeName === "money" ? 19 : 10) : column.precision;
    const scale = money ? 4 : column.scale;
    if (
        precision === undefined ||
        scale === undefined ||
        !Number.isInteger(precision) ||
        !Number.isInteger(scale) ||
        precision < 1 ||
        precision > 38 ||
        scale < 0 ||
        scale > precision
    ) {
        throw new SqlEditError(
            `The precision and scale for column "${columnName}" could not be determined.`,
            "unsupportedType",
        );
    }
    const text = value.trim();
    const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
    if (!match || !(match[2] || match[3])) {
        throw new SqlEditError(`Column "${columnName}" takes a decimal number.`, "invalidValue");
    }
    const integer = match[2].replace(/^0+/, "");
    const fraction = (match[3] ?? "").replace(/0+$/, "");
    if (integer.length > precision - scale || fraction.length > scale) {
        throw new SqlEditError(
            `Column "${columnName}" takes at most ${precision - scale} integer digits and ${scale} fractional digits; this value would overflow or be rounded.`,
            "invalidValue",
        );
    }
    const normalized = `${match[1] === "-" ? "-" : ""}${integer || "0"}${fraction ? `.${fraction}` : ""}`;
    if (money) {
        const scaled = BigInt(
            `${match[1] === "-" ? "-" : ""}${integer || "0"}${fraction.padEnd(scale, "0")}`,
        );
        const range = INTEGER_RANGES[typeName === "money" ? "bigint" : "int"];
        if (scaled < range[0] || scaled > range[1]) {
            throw new SqlEditError(
                `The value is outside the range of ${typeName} for column "${columnName}".`,
                "invalidValue",
            );
        }
    }
    return `CONVERT(${money ? typeName : `${typeName}(${precision},${scale})`}, ${stringLiteral(normalized)})`;
}

function encodeText(value: string, column: ColumnTypeInfo, columnName: string): Sql {
    // maxLength is in bytes and -1 means max; a Unicode column stores two bytes per character.
    const max = column.maxLength;
    if (max !== undefined && max > 0) {
        const isUnicode = column.typeName.toLowerCase().startsWith("n");
        const limit = isUnicode ? Math.floor(max / 2) : max;
        if (value.length > limit) {
            throw new SqlEditError(
                `Column "${columnName}" holds at most ${limit} characters; this value has ${value.length}.`,
                "invalidValue",
            );
        }
    }
    return stringLiteral(value);
}

function encodeBinary(value: string, columnName: string): Sql {
    const text = value.trim();
    const hex = text.startsWith("0x") || text.startsWith("0X") ? text.slice(2) : text;
    if (hex.length === 0) {
        return "0x";
    }
    if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
        throw new SqlEditError(
            `Column "${columnName}" takes hexadecimal bytes, such as 0x00FF.`,
            "invalidValue",
        );
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Number.parseInt(hex.substr(i * 2, 2), 16);
    }
    return binaryLiteral(bytes);
}

function encodeDateTime(value: string, typeName: string, columnName: string): Sql {
    const text = value.trim();
    // Style 126 is unambiguous ISO 8601, which removes any dependence on the server's language
    // or date-format settings. A value that does not look like ISO is rejected here rather than
    // being reinterpreted by the server as a different date.
    if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,7})?)?)?$/.test(text)) {
        throw new SqlEditError(
            `Column "${columnName}" takes a date such as 2026-09-07 or 2026-09-07 14:30:00.`,
            "invalidValue",
        );
    }
    return `CONVERT(${typeName}, ${stringLiteral(text.replace(" ", "T"))}, 126)`;
}

function requireTime(value: string, columnName: string): string {
    const text = value.trim();
    if (!/^\d{2}:\d{2}(:\d{2}(\.\d{1,7})?)?$/.test(text)) {
        throw new SqlEditError(
            `Column "${columnName}" takes a time such as 14:30:00.`,
            "invalidValue",
        );
    }
    return text;
}

function requireOffset(value: string, columnName: string): string {
    const text = value.trim();
    if (
        !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,7})?)?\s*([+-]\d{2}:\d{2}|Z)$/.test(text)
    ) {
        throw new SqlEditError(
            `Column "${columnName}" takes a date and time with an offset, such as 2026-09-07T14:30:00+01:00.`,
            "invalidValue",
        );
    }
    return text.replace(" ", "T");
}

function requireGuid(value: string, columnName: string): string {
    const text = value.trim().replace(/^\{|\}$/g, "");
    if (
        !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(text)
    ) {
        throw new SqlEditError(`Column "${columnName}" takes a GUID.`, "invalidValue");
    }
    return text;
}

/**
 * `vector` is not a usable type name on its own: a cast must carry the dimension, as
 * `vector(3)`. The catalog does not expose the dimension directly, but it is recoverable from
 * the storage size, which is an eight-byte header plus four bytes per dimension.
 */
export function vectorDimensions(maxLength: number | undefined): number | undefined {
    if (maxLength === undefined || maxLength <= 8) {
        return undefined;
    }
    const bytes = maxLength - 8;
    return bytes % 4 === 0 ? bytes / 4 : undefined;
}

function vectorTypeFor(column: ColumnTypeInfo, columnName: string): string {
    const dimensions = vectorDimensions(column.maxLength);
    if (dimensions === undefined) {
        throw new SqlEditError(
            `The number of dimensions for vector column "${columnName}" could not be determined, so it cannot be written.`,
            "unsupportedType",
        );
    }
    return `vector(${dimensions})`;
}

function requireJsonArray(value: string, columnName: string): string {
    const text = value.trim();
    try {
        const parsed: unknown = JSON.parse(text);
        if (!Array.isArray(parsed) || parsed.some((n) => typeof n !== "number")) {
            throw new Error("not numbers");
        }
    } catch {
        throw new SqlEditError(
            `Column "${columnName}" takes an array of numbers, such as [0.1, 0.2].`,
            "invalidValue",
        );
    }
    return text;
}

/**
 * Spatial values are written from Well-Known Text.
 *
 * The SRID travels with the value rather than defaulting: geography comparisons between
 * different SRIDs return null instead of failing, so an unstated SRID becomes a silent bug.
 */
function encodeSpatial(value: string, typeName: string, columnName: string): Sql {
    const match = /^\s*(?:SRID\s*=\s*(\d+)\s*;)?\s*(.+)$/is.exec(value);
    if (!match) {
        throw new SqlEditError(
            `Column "${columnName}" takes Well-Known Text, such as POINT(0 0).`,
            "invalidValue",
        );
    }
    const srid = match[1] ? Number(match[1]) : typeName === "geography" ? 4326 : 0;
    if (!Number.isInteger(srid) || srid < 0) {
        throw new SqlEditError(`Column "${columnName}" has an invalid SRID.`, "invalidValue");
    }
    return `${typeName}::STGeomFromText(${stringLiteral(match[2].trim())}, ${srid})`;
}
