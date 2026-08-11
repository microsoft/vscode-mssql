/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** SQL Server contexts in which a data type can occur. */
export type SqlDataTypeUsage = "column" | "variable" | "parameter" | "cast" | "return" | "unknown";

export type SqlDataTypeParameterKind =
    | "none"
    | "length"
    | "precisionScale"
    | "floatPrecision"
    | "temporalScale"
    | "vector"
    | "typedXml";

export interface SqlDataTypeDescriptor {
    readonly name: string;
    readonly aliases?: readonly string[];
    readonly parameterKind: SqlDataTypeParameterKind;
    readonly usages?: readonly SqlDataTypeUsage[];
    readonly deprecated?: boolean;
    readonly detail: string;
}

export interface ParsedSqlDataType {
    readonly text: string;
    readonly name: string;
    readonly normalizedName: string;
    readonly canonicalName: string;
    readonly arguments: readonly string[];
    readonly descriptor?: SqlDataTypeDescriptor;
    readonly isAlias: boolean;
    readonly hasParentheses: boolean;
    readonly hasBalancedParentheses: boolean;
}

export interface SqlDataTypeValidationIssue {
    readonly code:
        | "invalid-context"
        | "invalid-arguments"
        | "invalid-length"
        | "invalid-precision"
        | "invalid-scale"
        | "invalid-vector-dimensions"
        | "invalid-vector-base-type"
        | "invalid-xml-schema";
    readonly message: string;
}

const allOrdinaryUsages = Object.freeze([
    "column",
    "variable",
    "parameter",
    "cast",
    "return",
] as const satisfies readonly SqlDataTypeUsage[]);

/**
 * Single source of truth for built-in T-SQL data types used by parser diagnostics, completion,
 * hover normalization, and the VS Code host. Aliases are accepted spellings; metadata continues
 * to expose the canonical SQL Server type name.
 */
export const sqlServerDataTypes: readonly SqlDataTypeDescriptor[] = Object.freeze([
    scalar("bigint", "Eight-byte signed integer."),
    length("binary", "Fixed-length binary data."),
    scalar("bit", "Boolean-compatible integer value."),
    length("char", "Fixed-length non-Unicode character data.", ["character"]),
    scalar("date", "Calendar date."),
    scalar("datetime", "Legacy date and time value."),
    temporal("datetime2", "High-precision date and time value."),
    temporal("datetimeoffset", "Date and time value with a time-zone offset."),
    precisionScale("decimal", "Fixed precision and scale numeric value.", ["dec"]),
    scalar(
        "float",
        "Approximate floating-point value.",
        ["double", "double precision"],
        "floatPrecision",
    ),
    scalar("geography", "CLR spatial geography value."),
    scalar("geometry", "CLR spatial geometry value."),
    scalar("hierarchyid", "CLR hierarchical path value."),
    deprecated("image", "Legacy variable-length binary large object."),
    scalar("int", "Four-byte signed integer.", ["integer"]),
    scalar("json", "Native JSON document value."),
    scalar("money", "Eight-byte monetary value."),
    length("nchar", "Fixed-length Unicode character data.", [
        "national char",
        "national character",
        "ncharacter",
    ]),
    deprecated("ntext", "Legacy Unicode large text value.", ["national text"]),
    precisionScale("numeric", "Fixed precision and scale numeric value."),
    length("nvarchar", "Variable-length Unicode character data.", [
        "national char varying",
        "national character varying",
        "nchar varying",
        "ncharacter varying",
    ]),
    scalar("real", "Single-precision approximate numeric value."),
    scalar("smalldatetime", "Minute-precision legacy date and time value."),
    scalar("smallint", "Two-byte signed integer."),
    scalar("smallmoney", "Four-byte monetary value."),
    scalar("sql_variant", "Value containing one of several SQL Server scalar types."),
    scalar("sysname", "System identifier type; equivalent to nvarchar(128)."),
    deprecated("text", "Legacy non-Unicode large text value."),
    temporal("time", "Time-of-day value."),
    scalar("timestamp", "Automatically generated binary version stamp.", ["rowversion"]),
    scalar("tinyint", "One-byte unsigned integer."),
    scalar("uniqueidentifier", "Globally unique identifier."),
    length("varbinary", "Variable-length binary data.", ["binary varying"]),
    length("varchar", "Variable-length non-Unicode character data.", [
        "char varying",
        "character varying",
    ]),
    {
        name: "vector",
        parameterKind: "vector",
        usages: allOrdinaryUsages,
        detail: "Fixed-dimensional float32 or float16 vector value.",
    },
    {
        name: "xml",
        parameterKind: "typedXml",
        usages: allOrdinaryUsages,
        detail: "Native typed or untyped XML value.",
    },
    {
        name: "cursor",
        parameterKind: "none",
        usages: Object.freeze(["variable", "parameter"] as const),
        detail: "Cursor reference for local variables and procedure output parameters.",
    },
    {
        name: "table",
        parameterKind: "none",
        usages: Object.freeze(["variable", "return"] as const),
        detail: "Inline table variable or table-valued function return type.",
    },
]);

const descriptorBySpelling = new Map<string, SqlDataTypeDescriptor>();
for (const descriptor of sqlServerDataTypes) {
    descriptorBySpelling.set(normalizeTypeSpelling(descriptor.name), descriptor);
    for (const alias of descriptor.aliases ?? []) {
        descriptorBySpelling.set(normalizeTypeSpelling(alias), descriptor);
    }
}

/** Ordinary column/cast type names. Context-only TABLE and CURSOR are intentionally omitted. */
export const sqlServerDataTypeCompletionNames: readonly string[] = Object.freeze(
    sqlServerDataTypes
        .filter((descriptor) => descriptor.name !== "cursor" && descriptor.name !== "table")
        .flatMap((descriptor) => [descriptor.name, ...(descriptor.aliases ?? [])])
        .filter((name) => name !== "double")
        .sort((left, right) => left.localeCompare(right)),
);

export function sqlServerDataTypeNamesForUsage(
    usage: SqlDataTypeUsage,
    includeAliases = true,
): readonly string[] {
    return sqlServerDataTypes
        .filter((descriptor) => !descriptor.usages || descriptor.usages.includes(usage))
        .flatMap((descriptor) => [
            descriptor.name,
            ...(includeAliases ? (descriptor.aliases ?? []) : []),
        ])
        .filter((name) => name !== "double")
        .sort((left, right) => left.localeCompare(right));
}

export function parseSqlDataType(text: string): ParsedSqlDataType {
    const trimmed = text.trim();
    const open = trimmed.indexOf("(");
    const close = trimmed.lastIndexOf(")");
    const hasParentheses = open >= 0;
    const hasBalancedParentheses =
        !hasParentheses || (close > open && trimmed.slice(close + 1).trim().length === 0);
    const name = (hasParentheses ? trimmed.slice(0, open) : trimmed).trim();
    const normalizedName = normalizeTypeSpelling(name);
    const descriptor = descriptorBySpelling.get(normalizedName);
    const argumentText = hasParentheses && close > open ? trimmed.slice(open + 1, close) : "";
    const arguments_ = splitArguments(argumentText);
    return Object.freeze({
        text,
        name,
        normalizedName,
        canonicalName: descriptor?.name ?? name,
        arguments: Object.freeze(arguments_),
        descriptor,
        isAlias: Boolean(descriptor && normalizedName !== normalizeTypeSpelling(descriptor.name)),
        hasParentheses,
        hasBalancedParentheses,
    });
}

export function canonicalSqlDataTypeName(text: string): string {
    const parsed = parseSqlDataType(text);
    if (!parsed.descriptor) {
        return text.trim();
    }
    const suffix = parsed.hasParentheses ? `(${parsed.arguments.join(", ")})` : "";
    return `${parsed.canonicalName}${suffix}`;
}

/** Validates only recognized built-in types. Unknown names may be database-defined types. */
export function validateSqlDataType(
    text: string,
    usage: SqlDataTypeUsage = "unknown",
): readonly SqlDataTypeValidationIssue[] {
    const parsed = parseSqlDataType(text);
    const descriptor = parsed.descriptor;
    if (!descriptor) {
        return [];
    }
    const issues: SqlDataTypeValidationIssue[] = [];
    if (usage !== "unknown" && descriptor.usages && !descriptor.usages.includes(usage)) {
        issues.push({
            code: "invalid-context",
            message: `The ${descriptor.name} data type is not valid in a ${usage} declaration.`,
        });
    }
    if (!parsed.hasBalancedParentheses) {
        issues.push({
            code: "invalid-arguments",
            message: `Invalid ${descriptor.name} type arguments.`,
        });
        return issues;
    }

    switch (descriptor.parameterKind) {
        case "none":
            if (parsed.hasParentheses) {
                invalidArgumentCount(issues, descriptor.name, "does not accept arguments");
            }
            break;
        case "length":
            validateLength(parsed, issues);
            break;
        case "precisionScale":
            validatePrecisionScale(parsed, issues);
            break;
        case "floatPrecision":
            validateSingleInteger(parsed, issues, 1, 53, "precision", "invalid-precision");
            break;
        case "temporalScale":
            validateSingleInteger(parsed, issues, 0, 7, "scale", "invalid-scale");
            break;
        case "vector":
            validateVector(parsed, issues);
            break;
        case "typedXml":
            validateTypedXml(parsed, issues);
            break;
    }
    return issues;
}

function scalar(
    name: string,
    detail: string,
    aliases?: readonly string[],
    parameterKind: SqlDataTypeParameterKind = "none",
): SqlDataTypeDescriptor {
    return { name, aliases, parameterKind, usages: allOrdinaryUsages, detail };
}

function length(name: string, detail: string, aliases?: readonly string[]): SqlDataTypeDescriptor {
    return { name, aliases, parameterKind: "length", usages: allOrdinaryUsages, detail };
}

function temporal(name: string, detail: string): SqlDataTypeDescriptor {
    return { name, parameterKind: "temporalScale", usages: allOrdinaryUsages, detail };
}

function precisionScale(
    name: string,
    detail: string,
    aliases?: readonly string[],
): SqlDataTypeDescriptor {
    return { name, aliases, parameterKind: "precisionScale", usages: allOrdinaryUsages, detail };
}

function deprecated(
    name: string,
    detail: string,
    aliases?: readonly string[],
): SqlDataTypeDescriptor {
    return {
        name,
        aliases,
        parameterKind: "none",
        usages: allOrdinaryUsages,
        deprecated: true,
        detail,
    };
}

function normalizeTypeSpelling(value: string): string {
    return value
        .trim()
        .replace(/^\[|\]$/gu, "")
        .replace(/\s+/gu, "")
        .toLocaleLowerCase("en-US");
}

function splitArguments(value: string): string[] {
    if (!value.trim()) return [];
    return value.split(",").map((argument) => argument.trim());
}

function invalidArgumentCount(
    issues: SqlDataTypeValidationIssue[],
    name: string,
    expectation: string,
): void {
    issues.push({ code: "invalid-arguments", message: `${name} ${expectation}.` });
}

function validateLength(parsed: ParsedSqlDataType, issues: SqlDataTypeValidationIssue[]): void {
    if (!parsed.hasParentheses) return;
    if (parsed.arguments.length !== 1) {
        invalidArgumentCount(issues, parsed.canonicalName, "accepts one length argument");
        return;
    }
    const argument = parsed.arguments[0]!.toLocaleLowerCase();
    const allowsMax = ["varchar", "nvarchar", "varbinary"].includes(parsed.canonicalName);
    if (argument === "max") {
        if (!allowsMax) {
            issues.push({
                code: "invalid-length",
                message: `${parsed.canonicalName} does not support the MAX length.`,
            });
        }
        return;
    }
    const lengthValue = strictInteger(argument);
    const maximum = ["nchar", "nvarchar"].includes(parsed.canonicalName) ? 4000 : 8000;
    if (lengthValue === undefined || lengthValue < 1 || lengthValue > maximum) {
        issues.push({
            code: "invalid-length",
            message: `${parsed.canonicalName} length must be between 1 and ${maximum}${allowsMax ? ", or MAX" : ""}.`,
        });
    }
}

function validatePrecisionScale(
    parsed: ParsedSqlDataType,
    issues: SqlDataTypeValidationIssue[],
): void {
    if (!parsed.hasParentheses) return;
    if (parsed.arguments.length < 1 || parsed.arguments.length > 2) {
        invalidArgumentCount(issues, parsed.canonicalName, "accepts precision and optional scale");
        return;
    }
    const precision = strictInteger(parsed.arguments[0]!);
    if (precision === undefined || precision < 1 || precision > 38) {
        issues.push({
            code: "invalid-precision",
            message: `${parsed.canonicalName} precision must be between 1 and 38.`,
        });
        return;
    }
    if (parsed.arguments[1] !== undefined) {
        const scale = strictInteger(parsed.arguments[1]);
        if (scale === undefined || scale < 0 || scale > precision) {
            issues.push({
                code: "invalid-scale",
                message: `${parsed.canonicalName} scale must be between 0 and its precision (${precision}).`,
            });
        }
    }
}

function validateSingleInteger(
    parsed: ParsedSqlDataType,
    issues: SqlDataTypeValidationIssue[],
    minimum: number,
    maximum: number,
    label: string,
    code: "invalid-precision" | "invalid-scale",
): void {
    if (!parsed.hasParentheses) return;
    if (parsed.arguments.length !== 1) {
        invalidArgumentCount(issues, parsed.canonicalName, `accepts one ${label} argument`);
        return;
    }
    const value = strictInteger(parsed.arguments[0]!);
    if (value === undefined || value < minimum || value > maximum) {
        issues.push({
            code,
            message: `${parsed.canonicalName} ${label} must be between ${minimum} and ${maximum}.`,
        });
    }
}

function validateVector(parsed: ParsedSqlDataType, issues: SqlDataTypeValidationIssue[]): void {
    if (!parsed.hasParentheses || parsed.arguments.length < 1 || parsed.arguments.length > 2) {
        invalidArgumentCount(issues, "vector", "requires dimensions and an optional base type");
        return;
    }
    const baseType = (parsed.arguments[1] ?? "float32").toLocaleLowerCase();
    if (!["float32", "float16"].includes(baseType)) {
        issues.push({
            code: "invalid-vector-base-type",
            message: "vector base type must be float32 or float16.",
        });
    }
    const dimensions = strictInteger(parsed.arguments[0]!);
    const maximum = baseType === "float16" ? 3996 : 1998;
    if (dimensions === undefined || dimensions < 1 || dimensions > maximum) {
        issues.push({
            code: "invalid-vector-dimensions",
            message: `vector dimensions for ${baseType} must be between 1 and ${maximum}.`,
        });
    }
}

function validateTypedXml(parsed: ParsedSqlDataType, issues: SqlDataTypeValidationIssue[]): void {
    if (!parsed.hasParentheses) return;
    if (parsed.arguments.length !== 1) {
        invalidArgumentCount(issues, "xml", "accepts one XML schema collection specification");
        return;
    }
    const specification = parsed.arguments[0]!.trim();
    const valid =
        /^(?:(?:CONTENT|DOCUMENT)\s+)?(?:\[[^\]]+\]|"(?:[^"]|"")+"|[A-Za-z_][\w$#@]*)(?:\s*\.\s*(?:\[[^\]]+\]|"(?:[^"]|"")+"|[A-Za-z_][\w$#@]*)){0,2}$/iu.test(
            specification,
        );
    if (!valid) {
        issues.push({
            code: "invalid-xml-schema",
            message:
                "xml type arguments must name an XML schema collection, optionally preceded by CONTENT or DOCUMENT.",
        });
    }
}

function strictInteger(value: string): number | undefined {
    return /^\d+$/u.test(value.trim()) ? Number(value) : undefined;
}
