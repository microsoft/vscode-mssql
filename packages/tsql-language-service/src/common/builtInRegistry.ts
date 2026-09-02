/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SqlEngineProfile } from "./engineProfile.js";

/**
 * Shared editor-facing descriptions of SQL Server routines, system variables, and built-in data
 * types that no catalog lookup returns. Completion, hover, signature help, and coloring read this
 * registry. Semantic diagnostics own usage constraints, but not a second inventory of names.
 *
 * Availability is expressed as data rather than in code. A caller that knows the profile it is
 * analysing filters with `isBuiltInAvailable`; a caller that does not sees every entry.
 */
export type BuiltInKind = "routine" | "systemVariable" | "dataType";

export interface BuiltInParameter {
    readonly name: string;
    /** The argument may be omitted. */
    readonly optional?: boolean;
    /** The argument repeats, as the values of `CONCAT` or `COALESCE` do. */
    readonly variadic?: boolean;
}

export interface BuiltInSignature {
    readonly parameters: readonly BuiltInParameter[];
    readonly documentation: string;
    readonly returnType?: string;
    /**
     * How the written form separates arguments. `CAST` and `PARSE` separate theirs with keywords,
     * so a comma would misrepresent them.
     */
    readonly separator?: string;
}

export interface BuiltInAvailability {
    /** Lowest database compatibility level that accepts the name. */
    readonly minimumCompatibility?: number;
    /** Engine profiles that accept the name; absent means every resolved profile does. */
    readonly engineProfiles?: readonly SqlEngineProfile[];
}

export interface BuiltInEntry extends BuiltInAvailability {
    readonly name: string;
    readonly kind: BuiltInKind;
    readonly documentation?: string;
    readonly returnType?: string;
    readonly signatures?: readonly BuiltInSignature[];
}

/** The profile a caller is analysing, as far as availability is concerned. */
export interface BuiltInProfile {
    readonly compatibilityLevel?: number;
    readonly engineProfile?: SqlEngineProfile;
}

export function lookupBuiltIn(name: string, kind?: BuiltInKind): BuiltInEntry | undefined {
    const normalized = normalize(name);
    if (kind) return registry.get(registryKey(normalized, kind));
    // A spelling such as CHAR can be both a routine and a data type. An unqualified lookup is for
    // display only; context-aware consumers always supply a kind.
    for (const candidate of builtInKinds) {
        const entry = registry.get(registryKey(normalized, candidate));
        if (entry) return entry;
    }
    return undefined;
}

export function builtInsOfKind(kind: BuiltInKind): readonly BuiltInEntry[] {
    return [...registry.values()].filter((entry) => entry.kind === kind);
}

/**
 * True when the profile accepts the name.
 *
 * A missing fact defers rather than restricts: an absent profile, an absent compatibility level,
 * and the `unknown` engine profile all accept everything, so a still-connecting document never
 * loses a completion it would have been offered.
 */
export function isBuiltInAvailable(entry: BuiltInAvailability, profile?: BuiltInProfile): boolean {
    if (!profile) return true;
    if (
        entry.minimumCompatibility !== undefined &&
        profile.compatibilityLevel !== undefined &&
        profile.compatibilityLevel < entry.minimumCompatibility
    ) {
        return false;
    }
    return (
        entry.engineProfiles === undefined ||
        profile.engineProfile === undefined ||
        profile.engineProfile === "unknown" ||
        entry.engineProfiles.includes(profile.engineProfile)
    );
}

/** How many arguments a routine accepts, derived from the signatures the registry publishes. */
export interface BuiltInArity {
    readonly minimum: number;
    /** `Infinity` for a variadic routine, which absorbs every argument after its last named one. */
    readonly maximum: number;
}

/**
 * The argument count a built-in accepts.
 *
 * Derived from the signatures rather than listed separately: a routine's parameter list already
 * says which arguments are required, optional, and repeatable, and a second hand-maintained list
 * of counts is a list that can disagree with the help text shown beside it.
 *
 * Returns nothing when the registry does not describe the routine, which is not the same as a
 * routine that takes no arguments.
 */
export function builtInArity(name: string): BuiltInArity | undefined {
    const entry = lookupBuiltIn(name, "routine");
    if (!entry?.signatures || entry.signatures.length === 0) return undefined;
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = 0;
    for (const signature of entry.signatures) {
        let required = 0;
        let accepted = 0;
        let variadic = false;
        for (const parameter of signature.parameters) {
            if (parameter.variadic) variadic = true;
            else {
                accepted++;
                if (!parameter.optional) required++;
            }
        }
        minimum = Math.min(minimum, required);
        maximum = variadic ? Number.POSITIVE_INFINITY : Math.max(maximum, accepted);
    }
    return Number.isFinite(minimum) ? { minimum, maximum } : undefined;
}

/** The written form of a signature, as it reads in source. */
export function formatSignature(name: string, signature: BuiltInSignature): string {
    const parameters = signature.parameters.map(formatParameter);
    return `${name.toUpperCase()}(${parameters.join(signature.separator ?? ", ")})`;
}

export function formatParameter(parameter: BuiltInParameter): string {
    if (parameter.variadic) return `...${parameter.name}`;
    return parameter.optional ? `[${parameter.name}]` : parameter.name;
}

/**
 * Canonical system type for a T-SQL type spelling, including documented multiword synonyms.
 * Whitespace is folded because type synonyms are lexical spellings, not catalog identifiers.
 */
export function normalizeSystemDataTypeName(name: string): string | undefined {
    const normalized = name.trim().replaceAll(/\s+/gu, " ").toLowerCase();
    const canonical = systemDataTypeSynonyms.get(normalized) ?? normalized;
    return registry.has(registryKey(canonical, "dataType")) ? canonical : undefined;
}

/** True when a spelling is a built-in SQL Server data type rather than a catalog-defined type. */
export function isSystemDataTypeName(name: string): boolean {
    return normalizeSystemDataTypeName(name) !== undefined;
}

function normalize(name: string): string {
    const trimmed = name.trim();
    const undelimited =
        trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
    return undelimited.toLowerCase();
}

/** Builds the parameter list of a routine from its written form. */
function parameters(...names: readonly string[]): readonly BuiltInParameter[] {
    return names.map((name) => {
        if (name.startsWith("...")) return { name: name.slice(3), variadic: true };
        if (name.startsWith("[") && name.endsWith("]")) {
            return { name: name.slice(1, -1), optional: true };
        }
        return { name };
    });
}

interface RoutineDeclaration extends BuiltInAvailability {
    readonly parameters?: readonly string[];
    readonly documentation: string;
    readonly returnType?: string;
    readonly separator?: string;
}

function routine(name: string, declaration: RoutineDeclaration): BuiltInEntry {
    return {
        name,
        kind: "routine",
        ...(declaration.minimumCompatibility !== undefined
            ? { minimumCompatibility: declaration.minimumCompatibility }
            : {}),
        ...(declaration.engineProfiles ? { engineProfiles: declaration.engineProfiles } : {}),
        ...(declaration.returnType ? { returnType: declaration.returnType } : {}),
        signatures: [
            {
                parameters: parameters(...(declaration.parameters ?? [])),
                documentation: declaration.documentation,
                ...(declaration.returnType ? { returnType: declaration.returnType } : {}),
                ...(declaration.separator ? { separator: declaration.separator } : {}),
            },
        ],
    };
}

function named(name: string, kind: BuiltInKind, documentation: string): BuiltInEntry {
    return { name, kind, documentation };
}

/** A routine whose behavior is known but whose argument list is not documented here yet. */
function undocumentedRoutine(name: string): BuiltInEntry {
    return { name, kind: "routine" };
}

const documentedRoutines: readonly BuiltInEntry[] = [
    routine("ABS", {
        parameters: ["numeric_expression"],
        documentation: "Returns the absolute value.",
        returnType: "same as the argument",
    }),
    routine("AVG", {
        parameters: ["expression"],
        documentation: "Returns the average of the values in a group.",
    }),
    routine("CAST", {
        parameters: ["expression", "AS data_type"],
        documentation: "Converts an expression to the named data type.",
        returnType: "the named type",
        separator: " ",
    }),
    routine("TRY_CAST", {
        parameters: ["expression", "AS data_type"],
        documentation: "Converts an expression to the named data type, or returns NULL.",
        returnType: "the named type, or NULL",
        separator: " ",
    }),
    routine("CONVERT", {
        parameters: ["data_type", "expression", "[style]"],
        documentation: "Converts an expression to the named data type, using an optional style.",
        returnType: "the named type",
    }),
    routine("TRY_CONVERT", {
        parameters: ["data_type", "expression", "[style]"],
        documentation: "Converts an expression to the named data type, or returns NULL.",
        returnType: "the named type, or NULL",
    }),
    routine("PARSE", {
        parameters: ["string_value", "AS data_type", "[USING culture]"],
        documentation: "Reads a string as the named type, using an optional culture.",
        returnType: "the named type",
        separator: " ",
    }),
    routine("TRY_PARSE", {
        parameters: ["string_value", "AS data_type", "[USING culture]"],
        documentation: "Reads a string as the named type, or returns NULL.",
        returnType: "the named type, or NULL",
        separator: " ",
    }),
    routine("COALESCE", {
        // Two values before the repeat: SQL Server rejects a single-argument COALESCE.
        parameters: ["expression", "expression", "...expression"],
        documentation: "Returns the first expression that is not NULL.",
    }),
    routine("CONCAT", {
        // "two or more" is the contract, so two named values precede the repeat.
        parameters: ["string_value", "string_value", "...string_value"],
        documentation: "Concatenates two or more values as text.",
        returnType: "nvarchar or varchar",
    }),
    routine("CONCAT_WS", {
        parameters: ["separator", "argument", "argument", "...argument"],
        documentation: "Concatenates values, placing the separator between them.",
        returnType: "nvarchar or varchar",
        minimumCompatibility: 140,
    }),
    routine("COUNT", {
        parameters: ["expression"],
        documentation: "Returns the number of values in a group.",
        returnType: "int",
    }),
    routine("COUNT_BIG", {
        parameters: ["expression"],
        documentation: "Returns the number of values in a group.",
        returnType: "bigint",
    }),
    routine("DATEADD", {
        parameters: ["datepart", "number", "date"],
        documentation: "Adds an interval to a date.",
    }),
    routine("DATEDIFF", {
        parameters: ["datepart", "startdate", "enddate"],
        documentation: "Returns the number of datepart boundaries crossed between two dates.",
        returnType: "int",
    }),
    routine("DATEDIFF_BIG", {
        parameters: ["datepart", "startdate", "enddate"],
        documentation: "Returns the number of datepart boundaries crossed between two dates.",
        returnType: "bigint",
        minimumCompatibility: 130,
    }),
    routine("DATEFROMPARTS", {
        parameters: ["year", "month", "day"],
        documentation: "Returns a date value for the specified year, month, and day.",
        returnType: "date",
    }),
    routine("DATENAME", {
        parameters: ["datepart", "date"],
        documentation: "Returns the named part of a date as text.",
        returnType: "nvarchar",
    }),
    routine("DATEPART", {
        parameters: ["datepart", "date"],
        documentation: "Returns the named part of a date as a number.",
        returnType: "int",
    }),
    routine("DATETRUNC", {
        parameters: ["datepart", "date"],
        documentation: "Truncates a date to the named part.",
        minimumCompatibility: 160,
    }),
    routine("FORMAT", {
        parameters: ["value", "format", "[culture]"],
        documentation: "Formats a value as text, using an optional culture.",
        returnType: "nvarchar",
    }),
    routine("GETDATE", {
        documentation: "Returns the current database system timestamp.",
        returnType: "datetime",
    }),
    routine("GETUTCDATE", {
        documentation: "Returns the current database system timestamp in UTC.",
        returnType: "datetime",
    }),
    routine("SYSDATETIME", {
        documentation: "Returns the current database system timestamp.",
        returnType: "datetime2",
    }),
    routine("SYSUTCDATETIME", {
        documentation: "Returns the current database system timestamp in UTC.",
        returnType: "datetime2",
    }),
    routine("IIF", {
        parameters: ["condition", "true_value", "false_value"],
        documentation: "Returns one of two values, according to a condition.",
    }),
    routine("ISNULL", {
        parameters: ["check_expression", "replacement_value"],
        documentation: "Returns the replacement when the first expression is NULL.",
    }),
    routine("ISJSON", {
        parameters: ["expression", "[json_type_constraint]"],
        documentation: "Tests whether a string holds valid JSON.",
        returnType: "int",
        minimumCompatibility: 130,
    }),
    routine("JSON_QUERY", {
        parameters: ["expression", "[path]"],
        documentation: "Extracts an object or array from a JSON string.",
        returnType: "nvarchar(max)",
        minimumCompatibility: 130,
    }),
    routine("JSON_VALUE", {
        parameters: ["expression", "path"],
        documentation: "Extracts a scalar value from a JSON string.",
        returnType: "nvarchar(4000)",
        minimumCompatibility: 130,
    }),
    routine("JSON_MODIFY", {
        parameters: ["expression", "path", "new_value"],
        documentation: "Returns a JSON string with the value at the path replaced.",
        returnType: "nvarchar(max)",
        minimumCompatibility: 130,
    }),
    routine("JSON_PATH_EXISTS", {
        parameters: ["value_expression", "sql_json_path"],
        documentation: "Tests whether a path exists in a JSON string.",
        returnType: "int",
        minimumCompatibility: 160,
    }),
    routine("JSON_OBJECT", {
        parameters: ["...key_value"],
        documentation: "Builds a JSON object from key and value pairs.",
        returnType: "nvarchar(max)",
        minimumCompatibility: 160,
    }),
    routine("JSON_ARRAY", {
        parameters: ["...value"],
        documentation: "Builds a JSON array from its arguments.",
        returnType: "nvarchar(max)",
        minimumCompatibility: 160,
    }),
    routine("JSON_OBJECTAGG", {
        parameters: ["key_value"],
        documentation: "Builds a JSON object from the values in a group.",
        returnType: "nvarchar(max)",
        minimumCompatibility: 170,
    }),
    routine("JSON_ARRAYAGG", {
        parameters: ["value"],
        documentation: "Builds a JSON array from the values in a group.",
        returnType: "nvarchar(max)",
        minimumCompatibility: 170,
    }),
    routine("LEN", {
        parameters: ["string_expression"],
        documentation: "Returns the length of a string, ignoring trailing blanks.",
        returnType: "int",
    }),
    routine("MAX", {
        parameters: ["expression"],
        documentation: "Returns the largest value in a group.",
    }),
    routine("MIN", {
        parameters: ["expression"],
        documentation: "Returns the smallest value in a group.",
    }),
    routine("NEWID", { documentation: "Returns a new GUID.", returnType: "uniqueidentifier" }),
    routine("NULLIF", {
        parameters: ["expression", "expression"],
        documentation: "Returns NULL when the two expressions are equal.",
    }),
    routine("OBJECT_ID", {
        parameters: ["object_name", "[object_type]"],
        documentation: "Returns the identifier of a schema-scoped object.",
        returnType: "int",
    }),
    routine("OBJECT_NAME", {
        parameters: ["object_id", "[database_id]"],
        documentation: "Returns the name of a schema-scoped object.",
        returnType: "sysname",
    }),
    routine("OPENJSON", {
        parameters: ["json_expression", "[path]"],
        documentation: "Returns the elements of a JSON document as a rowset.",
        minimumCompatibility: 130,
    }),
    routine("ROW_NUMBER", {
        documentation: "Numbers the rows of a result set within its window.",
        returnType: "bigint",
    }),
    routine("RANK", {
        documentation: "Ranks rows within a window, leaving gaps after ties.",
        returnType: "bigint",
    }),
    routine("DENSE_RANK", {
        documentation: "Ranks rows within a window, leaving no gaps after ties.",
        returnType: "bigint",
    }),
    routine("STRING_AGG", {
        parameters: ["expression", "separator"],
        documentation: "Concatenates the values in a group, separated by the separator.",
        minimumCompatibility: 140,
    }),
    routine("STRING_SPLIT", {
        parameters: ["string", "separator", "[enable_ordinal]"],
        documentation: "Splits a string into a rowset of substrings.",
        minimumCompatibility: 130,
    }),
    routine("SUBSTRING", {
        parameters: ["expression", "start", "length"],
        documentation: "Returns part of a string.",
    }),
    routine("SUM", {
        parameters: ["expression"],
        documentation: "Returns the sum of the values in a group.",
    }),
    routine("TRIM", {
        parameters: ["[characters FROM]", "string"],
        documentation: "Removes leading and trailing blanks, or the named characters.",
        minimumCompatibility: 140,
    }),
    routine("VECTOR_DISTANCE", {
        parameters: ["metric", "vector1", "vector2"],
        documentation: "Returns the distance between two vectors under the named metric.",
        returnType: "float",
        minimumCompatibility: 170,
    }),
    routine("RAISERROR", {
        parameters: ["message", "severity", "state", "...argument"],
        documentation: "Raises an error, optionally formatting the message with its arguments.",
    }),
    routine("THROW", {
        parameters: ["[error_number]", "[message]", "[state]"],
        documentation: "Raises an exception, or re-raises the current one when given no arguments.",
    }),
    routine("WAITFOR", {
        parameters: ["DELAY or TIME", "time_to_pass"],
        documentation: "Blocks the batch until a time of day, or for an interval.",
        separator: " ",
    }),
    routine("AI_GENERATE_EMBEDDINGS", {
        parameters: [
            "source",
            "USE MODEL model_identifier",
            "[PARAMETERS optional_json_request_body_parameters]",
        ],
        documentation: "Returns the embedding a registered model produces for the expression.",
        returnType: "vector",
        minimumCompatibility: 170,
        separator: " ",
    }),
    // Fabric Data Warehouse AI functions. They are ordinary calls rather than distinct grammar
    // nodes, so availability is expressed here: completion withholds them elsewhere and hover
    // still describes one a document already contains.
    routine("AI_TRANSLATE", {
        parameters: ["expression", "target_language"],
        documentation: "Translates the expression into the target language.",
        returnType: "nvarchar",
        engineProfiles: ["fabric-warehouse"],
    }),
    routine("AI_SUMMARIZE", {
        parameters: ["expression"],
        documentation: "Summarizes the expression.",
        returnType: "nvarchar",
        engineProfiles: ["fabric-warehouse"],
    }),
    routine("AI_CLASSIFY", {
        parameters: ["expression", "label", "label", "...label"],
        documentation: "Returns the label that best classifies the expression.",
        returnType: "nvarchar",
        engineProfiles: ["fabric-warehouse"],
    }),
    routine("AI_EXTRACT", {
        parameters: ["expression", "field", "field", "...field"],
        documentation: "Extracts the named fields from the expression.",
        returnType: "nvarchar",
        engineProfiles: ["fabric-warehouse"],
    }),
    routine("AI_FIX_GRAMMAR", {
        parameters: ["expression"],
        documentation: "Returns the expression with its grammar corrected.",
        returnType: "nvarchar",
        engineProfiles: ["fabric-warehouse"],
    }),
    routine("AI_GENERATE_RESPONSE", {
        parameters: ["prompt", "[data]"],
        documentation: "Returns a generated response for the prompt.",
        returnType: "nvarchar",
        engineProfiles: ["fabric-warehouse"],
    }),
    routine("AI_ANALYZE_SENTIMENT", {
        parameters: ["expression"],
        documentation: "Returns the sentiment the expression expresses.",
        returnType: "nvarchar",
        engineProfiles: ["fabric-warehouse"],
    }),
    routine("INVOKE_EXTERNAL_API", {
        parameters: ["function_set", "function_name", "...argument"],
        documentation: "Calls a registered external function set.",
        returnType: "nvarchar",
        engineProfiles: ["fabric-warehouse"],
    }),
    routine("GREATEST", {
        parameters: ["expression", "...expression"],
        documentation: "Returns the largest of its arguments.",
        minimumCompatibility: 160,
    }),
    routine("LEAST", {
        parameters: ["expression", "...expression"],
        documentation: "Returns the smallest of its arguments.",
        minimumCompatibility: 160,
    }),
    routine("ACOS", {
        parameters: ["float_expression"],
        documentation: "Returns the angle, in radians, whose cosine is the specified value.",
        returnType: "float",
    }),
    routine("APP_NAME", {
        documentation: "Returns the application name for the current session.",
        returnType: "nvarchar(128)",
    }),
    routine("ASCII", {
        parameters: ["character_expression"],
        documentation: "Returns the ASCII code of the leftmost character.",
        returnType: "int",
    }),
    routine("ASIN", {
        parameters: ["float_expression"],
        documentation: "Returns the angle, in radians, whose sine is the specified value.",
        returnType: "float",
    }),
    routine("ATAN", {
        parameters: ["float_expression"],
        documentation: "Returns the angle, in radians, whose tangent is the specified value.",
        returnType: "float",
    }),
    routine("ATN2", {
        parameters: ["float_expression_y", "float_expression_x"],
        documentation:
            "Returns the angle, in radians, between the positive x-axis and the specified point.",
        returnType: "float",
    }),
    routine("CEILING", {
        parameters: ["numeric_expression"],
        documentation: "Returns the smallest integer greater than or equal to the specified value.",
    }),
    routine("CHAR", {
        parameters: ["integer_expression"],
        documentation: "Returns the single-byte character represented by an integer ASCII code.",
        returnType: "char(1)",
    }),
    routine("CHARINDEX", {
        parameters: ["expression_to_find", "expression_to_search", "[start_location]"],
        documentation: "Returns the starting position of one character expression inside another.",
        returnType: "int or bigint",
    }),
    routine("CHECKSUM", {
        parameters: ["expression", "...expression"],
        documentation: "Returns a checksum value computed over its arguments.",
        returnType: "int",
    }),
    routine("CHOOSE", {
        parameters: ["index", "value", "...value"],
        documentation: "Returns the value at the specified one-based index.",
    }),
    routine("COL_LENGTH", {
        parameters: ["table_name", "column_name"],
        documentation: "Returns the defined length of a table column in bytes.",
        returnType: "smallint",
    }),
    routine("COL_NAME", {
        parameters: ["table_id", "column_id"],
        documentation: "Returns the name of a column from its table and column identifiers.",
        returnType: "sysname",
    }),
    routine("COS", {
        parameters: ["float_expression"],
        documentation: "Returns the trigonometric cosine of an angle in radians.",
        returnType: "float",
    }),
    routine("COT", {
        parameters: ["float_expression"],
        documentation: "Returns the trigonometric cotangent of an angle in radians.",
        returnType: "float",
    }),
    routine("CUME_DIST", {
        documentation: "Returns the cumulative distribution of a value within a window partition.",
        returnType: "float",
    }),
    routine("DATALENGTH", {
        parameters: ["expression"],
        documentation: "Returns the number of bytes used to represent an expression.",
        returnType: "int or bigint",
    }),
    routine("DAY", {
        parameters: ["date"],
        documentation: "Returns the day of the month from a date value.",
        returnType: "int",
    }),
    routine("DB_ID", {
        parameters: ["[database_name]"],
        documentation: "Returns the identifier of a database.",
        returnType: "int",
    }),
    routine("DB_NAME", {
        parameters: ["[database_id]"],
        documentation: "Returns the name of a database.",
        returnType: "nvarchar(128)",
    }),
    routine("DEGREES", {
        parameters: ["numeric_expression"],
        documentation: "Converts an angle from radians to degrees.",
    }),
    routine("DIFFERENCE", {
        parameters: ["character_expression", "character_expression"],
        documentation: "Returns the difference between the SOUNDEX values of two expressions.",
        returnType: "int",
    }),
    routine("EOMONTH", {
        parameters: ["start_date", "[month_to_add]"],
        documentation: "Returns the last day of the month containing the specified date.",
        returnType: "date",
    }),
    routine("ERROR_LINE", {
        documentation: "Returns the line number at which an error occurred inside a CATCH block.",
        returnType: "int",
    }),
    routine("ERROR_MESSAGE", {
        documentation: "Returns the message text for the error handled by a CATCH block.",
        returnType: "nvarchar(4000)",
    }),
    routine("ERROR_NUMBER", {
        documentation: "Returns the number of the error handled by a CATCH block.",
        returnType: "int",
    }),
    routine("ERROR_PROCEDURE", {
        documentation: "Returns the name of the routine in which an error occurred.",
        returnType: "nvarchar(128)",
    }),
    routine("ERROR_SEVERITY", {
        documentation: "Returns the severity of the error handled by a CATCH block.",
        returnType: "int",
    }),
    routine("ERROR_STATE", {
        documentation: "Returns the state number of the error handled by a CATCH block.",
        returnType: "int",
    }),
    routine("EXP", {
        parameters: ["float_expression"],
        documentation: "Returns the exponential value of the specified expression.",
        returnType: "float",
    }),
    routine("FIRST_VALUE", {
        parameters: ["scalar_expression"],
        documentation: "Returns the first value in an ordered window partition.",
    }),
    routine("FLOOR", {
        parameters: ["numeric_expression"],
        documentation: "Returns the largest integer less than or equal to the specified value.",
    }),
    routine("FORMATMESSAGE", {
        parameters: ["message", "...parameter"],
        documentation:
            "Formats a message from a message number or format string and substitution values.",
        returnType: "nvarchar",
    }),
    routine("GROUPING", {
        parameters: ["column_expression"],
        documentation: "Indicates whether a result row aggregates the specified grouping column.",
        returnType: "tinyint",
    }),
    routine("GROUPING_ID", {
        parameters: ["column_expression", "...column_expression"],
        documentation: "Returns a bit vector identifying the grouping level of a result row.",
        returnType: "int",
    }),
    routine("HAS_PERMS_BY_NAME", {
        parameters: [
            "securable",
            "securable_class",
            "permission",
            "[subsecurable]",
            "[subsecurable_class]",
        ],
        documentation: "Reports whether the current principal has a permission on a securable.",
        returnType: "int",
    }),
    routine("HOST_NAME", {
        documentation: "Returns the workstation name reported by the current client session.",
        returnType: "nvarchar(128)",
    }),
    routine("IDENT_CURRENT", {
        parameters: ["table_name"],
        documentation:
            "Returns the last identity value generated for a table in any session and scope.",
        returnType: "numeric",
    }),
    routine("INDEX_COL", {
        parameters: ["table_or_view", "index_id", "key_id"],
        documentation: "Returns the name of an indexed column from its key position.",
        returnType: "nvarchar(128)",
    }),
    routine("ISDATE", {
        parameters: ["expression"],
        documentation: "Tests whether an expression can be converted to a date or time value.",
        returnType: "int",
    }),
    routine("ISNUMERIC", {
        parameters: ["expression"],
        documentation: "Tests whether an expression can be converted to a numeric data type.",
        returnType: "int",
    }),
    routine("LAG", {
        parameters: ["scalar_expression", "[offset]", "[default]"],
        documentation: "Returns a value from a preceding row in an ordered window partition.",
    }),
    routine("LAST_VALUE", {
        parameters: ["scalar_expression"],
        documentation: "Returns the last value in an ordered window frame.",
    }),
    routine("LEAD", {
        parameters: ["scalar_expression", "[offset]", "[default]"],
        documentation: "Returns a value from a following row in an ordered window partition.",
    }),
    routine("LOG", {
        parameters: ["float_expression", "[base]"],
        documentation: "Returns the logarithm of the specified value, using an optional base.",
        returnType: "float",
    }),
    routine("LOG10", {
        parameters: ["float_expression"],
        documentation: "Returns the base-10 logarithm of the specified value.",
        returnType: "float",
    }),
    routine("LOWER", {
        parameters: ["character_expression"],
        documentation: "Converts a character expression to lowercase.",
    }),
    routine("LTRIM", {
        parameters: ["character_expression"],
        documentation: "Removes leading spaces from a string.",
    }),
    routine("MONTH", {
        parameters: ["date"],
        documentation: "Returns the month from a date value.",
        returnType: "int",
    }),
    routine("NCHAR", {
        parameters: ["integer_expression"],
        documentation: "Returns the Unicode character represented by an integer code point.",
        returnType: "nchar(1) or nchar(2)",
    }),
    routine("NEWSEQUENTIALID", {
        documentation:
            "Returns a GUID that is greater than previously generated GUIDs on the same system.",
        returnType: "uniqueidentifier",
    }),
    routine("NTILE", {
        parameters: ["integer_expression"],
        documentation:
            "Distributes rows in an ordered partition into the requested number of groups.",
        returnType: "bigint",
    }),
    routine("OBJECT_DEFINITION", {
        parameters: ["object_id"],
        documentation: "Returns the Transact-SQL source text of a schema-scoped object.",
        returnType: "nvarchar(max)",
    }),
    routine("OBJECT_SCHEMA_NAME", {
        parameters: ["object_id", "[database_id]"],
        documentation: "Returns the schema name of a schema-scoped object.",
        returnType: "sysname",
    }),
    routine("PARSENAME", {
        parameters: ["object_name", "object_piece"],
        documentation: "Returns one part of a multipart object name.",
        returnType: "sysname",
    }),
    routine("PATINDEX", {
        parameters: ["pattern", "expression"],
        documentation: "Returns the starting position of a pattern in a character expression.",
        returnType: "int or bigint",
    }),
    routine("PERCENTILE_CONT", {
        parameters: ["numeric_literal"],
        documentation: "Returns a continuous percentile within an ordered group.",
        returnType: "float(53)",
    }),
    routine("PERCENTILE_DISC", {
        parameters: ["numeric_literal"],
        documentation: "Returns a discrete percentile within an ordered group.",
    }),
    routine("PERCENT_RANK", {
        documentation: "Returns the relative rank of a row within a window partition.",
        returnType: "float",
    }),
    routine("PI", {
        documentation: "Returns the constant value of pi.",
        returnType: "float",
    }),
    routine("POWER", {
        parameters: ["float_expression", "power"],
        documentation: "Raises the specified expression to a power.",
    }),
    routine("QUOTENAME", {
        parameters: ["character_string", "[quote_character]"],
        documentation: "Returns a Unicode string delimited as a valid identifier.",
        returnType: "nvarchar(258)",
    }),
    routine("RADIANS", {
        parameters: ["numeric_expression"],
        documentation: "Converts an angle from degrees to radians.",
    }),
    routine("RAND", {
        parameters: ["[seed]"],
        documentation: "Returns a pseudo-random floating-point value from zero through one.",
        returnType: "float",
    }),
    routine("REPLACE", {
        parameters: ["string_expression", "string_pattern", "string_replacement"],
        documentation: "Replaces every occurrence of a pattern in a string.",
    }),
    routine("REPLICATE", {
        parameters: ["string_expression", "integer_expression"],
        documentation: "Repeats a string value the specified number of times.",
    }),
    routine("REVERSE", {
        parameters: ["string_expression"],
        documentation: "Returns a character expression in reverse order.",
    }),
    routine("ROUND", {
        parameters: ["numeric_expression", "length", "[function]"],
        documentation: "Returns a numeric value rounded to the specified length or precision.",
    }),
    routine("RTRIM", {
        parameters: ["character_expression"],
        documentation: "Removes trailing spaces from a string.",
    }),
    routine("SCHEMA_ID", {
        parameters: ["[schema_name]"],
        documentation: "Returns the identifier of a schema.",
        returnType: "int",
    }),
    routine("SCHEMA_NAME", {
        parameters: ["[schema_id]"],
        documentation: "Returns the name of a schema.",
        returnType: "sysname",
    }),
    routine("SCOPE_IDENTITY", {
        documentation: "Returns the last identity value inserted in the current scope and session.",
        returnType: "numeric(38,0)",
    }),
    routine("SERVERPROPERTY", {
        parameters: ["property_name"],
        documentation: "Returns the requested property of the server instance.",
        returnType: "sql_variant",
    }),
    routine("SIGN", {
        parameters: ["numeric_expression"],
        documentation: "Returns the positive, zero, or negative sign of a number.",
    }),
    routine("SIN", {
        parameters: ["float_expression"],
        documentation: "Returns the trigonometric sine of an angle in radians.",
        returnType: "float",
    }),
    routine("SOUNDEX", {
        parameters: ["character_expression"],
        documentation: "Returns a four-character phonetic code for a character expression.",
        returnType: "varchar",
    }),
    routine("SPACE", {
        parameters: ["integer_expression"],
        documentation: "Returns a string containing the requested number of spaces.",
        returnType: "varchar",
    }),
    routine("SQRT", {
        parameters: ["float_expression"],
        documentation: "Returns the square root of the specified value.",
        returnType: "float",
    }),
    routine("SQUARE", {
        parameters: ["float_expression"],
        documentation: "Returns the square of the specified value.",
        returnType: "float",
    }),
    routine("STDEV", {
        parameters: ["expression"],
        documentation:
            "Returns the sample statistical standard deviation of the values in a group.",
        returnType: "float",
    }),
    routine("STDEVP", {
        parameters: ["expression"],
        documentation:
            "Returns the population statistical standard deviation of the values in a group.",
        returnType: "float",
    }),
    routine("STR", {
        parameters: ["float_expression", "[length]", "[decimal]"],
        documentation:
            "Converts numeric data to character data with the requested length and scale.",
        returnType: "varchar",
    }),
    routine("STRING_ESCAPE", {
        parameters: ["text", "type"],
        documentation: "Escapes special characters in text using the requested rules.",
        returnType: "nvarchar(max)",
        minimumCompatibility: 130,
    }),
    routine("STUFF", {
        parameters: ["character_expression", "start", "length", "replace_with_expression"],
        documentation: "Deletes part of a string and inserts another string at that position.",
    }),
    routine("SUSER_NAME", {
        parameters: ["[server_user_id]"],
        documentation: "Returns the login name associated with a server principal identifier.",
        returnType: "nvarchar(128)",
    }),
    routine("SUSER_SNAME", {
        parameters: ["[server_user_sid]"],
        documentation: "Returns the login name associated with a security identifier.",
        returnType: "nvarchar(128)",
    }),
    routine("SWITCHOFFSET", {
        parameters: ["datetimeoffset_expression", "timezone_offset_expression"],
        documentation:
            "Changes a datetimeoffset value to a new time-zone offset while preserving its UTC value.",
        returnType: "datetimeoffset",
    }),
    routine("SYSDATETIMEOFFSET", {
        documentation: "Returns the current system date and time with its time-zone offset.",
        returnType: "datetimeoffset(7)",
    }),
    routine("TAN", {
        parameters: ["float_expression"],
        documentation: "Returns the trigonometric tangent of an angle in radians.",
        returnType: "float",
    }),
    routine("TODATETIMEOFFSET", {
        parameters: ["date_expression", "timezone_offset_expression"],
        documentation: "Interprets a date and time value at the specified time-zone offset.",
        returnType: "datetimeoffset",
    }),
    routine("TYPE_ID", {
        parameters: ["type_name"],
        documentation: "Returns the identifier of a data type.",
        returnType: "int",
    }),
    routine("TYPE_NAME", {
        parameters: ["type_id"],
        documentation: "Returns the name of a data type.",
        returnType: "sysname",
    }),
    routine("UNICODE", {
        parameters: ["character_expression"],
        documentation: "Returns the Unicode code point of the leftmost character.",
        returnType: "int",
    }),
    routine("UPPER", {
        parameters: ["character_expression"],
        documentation: "Converts a character expression to uppercase.",
    }),
    routine("USER_ID", {
        parameters: ["[user_name]"],
        documentation: "Returns the database principal identifier for a user.",
        returnType: "int",
    }),
    routine("USER_NAME", {
        parameters: ["[user_id]"],
        documentation: "Returns the database user name associated with an identifier.",
        returnType: "nvarchar(128)",
    }),
    routine("VAR", {
        parameters: ["expression"],
        documentation: "Returns the sample statistical variance of the values in a group.",
        returnType: "float",
    }),
    routine("VARP", {
        parameters: ["expression"],
        documentation: "Returns the population statistical variance of the values in a group.",
        returnType: "float",
    }),
    routine("YEAR", {
        parameters: ["date"],
        documentation: "Returns the year from a date value.",
        returnType: "int",
    }),
    routine("APPLOCK_MODE", {
        parameters: ["database_principal", "resource_name", "lock_owner"],
        documentation:
            "Returns the lock mode held by the current session for an application lock resource.",
        returnType: "nvarchar(32)",
    }),
    routine("APPLOCK_TEST", {
        parameters: ["database_principal", "resource_name", "lock_mode", "lock_owner"],
        documentation: "Tests whether an application lock can be granted without acquiring it.",
        returnType: "smallint",
    }),
    routine("ASSEMBLYPROPERTY", {
        parameters: ["assembly_name", "property_name"],
        documentation: "Returns the requested property of a CLR assembly.",
        returnType: "sql_variant",
    }),
    routine("ASYMKEY_ID", {
        parameters: ["asymmetric_key_name"],
        documentation: "Returns the identifier of an asymmetric key.",
        returnType: "int",
    }),
    routine("ASYMKEYPROPERTY", {
        parameters: ["key_id", "property_name"],
        documentation: "Returns the requested property of an asymmetric key.",
        returnType: "sql_variant",
    }),
    routine("BASE64_DECODE", {
        parameters: ["expression"],
        documentation: "Decodes Base64 text into binary data.",
        returnType: "varbinary",
        minimumCompatibility: 170,
    }),
    routine("BASE64_ENCODE", {
        parameters: ["expression", "[url_safe]"],
        documentation: "Encodes binary data as Base64 text.",
        returnType: "varchar",
        minimumCompatibility: 170,
    }),
    routine("BINARY_CHECKSUM", {
        parameters: ["expression", "...expression"],
        documentation: "Returns a binary checksum computed over a row or list of expressions.",
        returnType: "int",
    }),
    routine("BIT_COUNT", {
        parameters: ["expression_value"],
        documentation: "Returns the number of set bits in an integer or binary value.",
        returnType: "bigint",
        minimumCompatibility: 160,
    }),
    routine("CERT_ID", {
        parameters: ["certificate_name"],
        documentation: "Returns the identifier of a certificate.",
        returnType: "int",
    }),
    routine("CERTENCODED", {
        parameters: ["certificate_id"],
        documentation: "Returns the public portion of a certificate in encoded binary form.",
        returnType: "varbinary",
    }),
    routine("CERTPRIVATEKEY", {
        parameters: ["certificate_id", "encryption_password", "[decryption_password]"],
        documentation: "Exports a certificate private key protected by a password.",
        returnType: "varbinary",
    }),
    routine("CERTPROPERTY", {
        parameters: ["certificate_id", "property_name"],
        documentation: "Returns the requested property of a certificate.",
        returnType: "sql_variant",
    }),
    routine("CHANGE_TRACKING_CURRENT_VERSION", {
        documentation:
            "Returns the version associated with the last committed change-tracking transaction.",
        returnType: "bigint",
    }),
    routine("CHANGE_TRACKING_IS_COLUMN_IN_MASK", {
        parameters: ["column_id", "change_columns"],
        documentation: "Tests whether a column is present in a change-tracking column mask.",
        returnType: "bit",
    }),
    routine("CHANGE_TRACKING_MIN_VALID_VERSION", {
        parameters: ["object_id"],
        documentation: "Returns the minimum change-tracking version valid for a table.",
        returnType: "bigint",
    }),
    routine("COLUMNPROPERTY", {
        parameters: ["object_id", "column_name", "property_name"],
        documentation: "Returns the requested property of a table or procedure column.",
        returnType: "int",
    }),
    routine("COLUMNS_UPDATED", {
        documentation:
            "Returns a bit mask identifying columns affected by an INSERT or UPDATE trigger event.",
        returnType: "varbinary",
    }),
    routine("COMPRESS", {
        parameters: ["expression"],
        documentation: "Compresses an expression using the Gzip algorithm.",
        returnType: "varbinary(max)",
        minimumCompatibility: 130,
    }),
    routine("CONNECTIONPROPERTY", {
        parameters: ["property_name"],
        documentation: "Returns the requested property of the current connection.",
        returnType: "sql_variant",
    }),
    routine("CONTEXT_INFO", {
        documentation: "Returns the context_info value set for the current session or batch.",
        returnType: "varbinary(128)",
    }),
    routine("CRYPT_GEN_RANDOM", {
        parameters: ["length", "[seed]"],
        documentation: "Returns cryptographically generated random bytes.",
        returnType: "varbinary(8000)",
    }),
    routine("CURRENT_REQUEST_ID", {
        documentation: "Returns the request identifier for the current session.",
        returnType: "int",
    }),
    routine("CURRENT_TIMEZONE", {
        documentation:
            "Returns the display name of the time zone configured for the database or instance.",
        returnType: "varchar",
    }),
    routine("CURRENT_TIMEZONE_ID", {
        documentation:
            "Returns the identifier of the time zone configured for the database or instance.",
        returnType: "varchar",
    }),
    routine("CURRENT_TRANSACTION_ID", {
        documentation: "Returns the identifier of the current transaction.",
        returnType: "bigint",
    }),
    routine("CURSOR_STATUS", {
        parameters: ["scope", "cursor_name"],
        documentation: "Reports whether a cursor exists, is open, and has rows.",
        returnType: "smallint",
    }),
    routine("DATABASE_PRINCIPAL_ID", {
        parameters: ["[principal_name]"],
        documentation: "Returns the identifier of a database principal.",
        returnType: "int",
    }),
    routine("DATABASEPROPERTYEX", {
        parameters: ["database", "property_name"],
        documentation: "Returns the current value of a database property.",
        returnType: "sql_variant",
    }),
    routine("DATE_BUCKET", {
        parameters: ["datepart", "number", "date", "[origin]"],
        documentation: "Returns the beginning of the date-time bucket containing a value.",
        minimumCompatibility: 160,
    }),
    routine("DATETIME2FROMPARTS", {
        parameters: ["year", "month", "day", "hour", "minute", "seconds", "fractions", "precision"],
        documentation: "Constructs a datetime2 value from its individual date and time parts.",
        returnType: "datetime2",
    }),
    routine("DATETIMEFROMPARTS", {
        parameters: ["year", "month", "day", "hour", "minute", "seconds", "milliseconds"],
        documentation: "Constructs a datetime value from its individual date and time parts.",
        returnType: "datetime",
    }),
    routine("DATETIMEOFFSETFROMPARTS", {
        parameters: [
            "year",
            "month",
            "day",
            "hour",
            "minute",
            "seconds",
            "fractions",
            "hour_offset",
            "minute_offset",
            "precision",
        ],
        documentation: "Constructs a datetimeoffset value from its date, time, and offset parts.",
        returnType: "datetimeoffset",
    }),
    routine("DECOMPRESS", {
        parameters: ["expression"],
        documentation: "Decompresses Gzip-compressed binary data.",
        returnType: "varbinary(max)",
        minimumCompatibility: 130,
    }),
    routine("DECRYPTBYASYMKEY", {
        parameters: ["asymmetric_key_id", "ciphertext", "[asymmetric_key_password]"],
        documentation: "Decrypts data with an asymmetric key.",
        returnType: "varbinary(8000)",
    }),
    routine("DECRYPTBYCERT", {
        parameters: ["certificate_id", "ciphertext", "[certificate_password]"],
        documentation: "Decrypts data with the private key of a certificate.",
        returnType: "varbinary(8000)",
    }),
    routine("DECRYPTBYKEY", {
        parameters: ["ciphertext", "[add_authenticator]", "[authenticator]"],
        documentation: "Decrypts data with an open symmetric key.",
        returnType: "varbinary(8000)",
    }),
    routine("DECRYPTBYKEYAUTOASYMKEY", {
        parameters: [
            "asymmetric_key_id",
            "asymmetric_key_password",
            "ciphertext",
            "[add_authenticator]",
            "[authenticator]",
        ],
        documentation: "Opens a symmetric key with an asymmetric key and decrypts data with it.",
        returnType: "varbinary(8000)",
    }),
    routine("DECRYPTBYKEYAUTOCERT", {
        parameters: [
            "certificate_id",
            "certificate_password",
            "ciphertext",
            "[add_authenticator]",
            "[authenticator]",
        ],
        documentation: "Opens a symmetric key with a certificate and decrypts data with it.",
        returnType: "varbinary(8000)",
    }),
    routine("DECRYPTBYPASSPHRASE", {
        parameters: ["passphrase", "ciphertext", "[add_authenticator]", "[authenticator]"],
        documentation: "Decrypts data protected by a passphrase.",
        returnType: "varbinary(8000)",
    }),
    routine("EDIT_DISTANCE", {
        parameters: ["character_expression", "character_expression", "[maximum_distance]"],
        documentation: "Returns the edit distance between two strings.",
        returnType: "int",
        minimumCompatibility: 170,
    }),
    routine("EDIT_DISTANCE_SIMILARITY", {
        parameters: ["character_expression", "character_expression"],
        documentation: "Returns an edit-distance similarity score from zero through one hundred.",
        returnType: "int",
        minimumCompatibility: 170,
    }),
    routine("ENCRYPTBYASYMKEY", {
        parameters: ["asymmetric_key_id", "plaintext"],
        documentation: "Encrypts data with an asymmetric key.",
        returnType: "varbinary",
    }),
    routine("ENCRYPTBYCERT", {
        parameters: ["certificate_id", "cleartext"],
        documentation: "Encrypts data with the public key of a certificate.",
        returnType: "varbinary",
    }),
    routine("ENCRYPTBYKEY", {
        parameters: ["key_guid", "cleartext", "[add_authenticator]", "[authenticator]"],
        documentation: "Encrypts data with an open symmetric key.",
        returnType: "varbinary",
    }),
    routine("ENCRYPTBYPASSPHRASE", {
        parameters: ["passphrase", "cleartext", "[add_authenticator]", "[authenticator]"],
        documentation: "Encrypts data with a key derived from a passphrase.",
        returnType: "varbinary",
    }),
    routine("EVENTDATA", {
        documentation: "Returns XML describing the event that fired a DDL or logon trigger.",
        returnType: "xml",
    }),
    routine("FILE_ID", {
        parameters: ["file_name"],
        documentation: "Returns the identifier of a database file.",
        returnType: "smallint",
    }),
    routine("FILE_IDEX", {
        parameters: ["file_name"],
        documentation: "Returns the identifier of a database file as an integer.",
        returnType: "int",
    }),
    routine("FILE_NAME", {
        parameters: ["file_id"],
        documentation: "Returns the logical name of a database file.",
        returnType: "nvarchar(128)",
    }),
    routine("FILEGROUP_ID", {
        parameters: ["filegroup_name"],
        documentation: "Returns the identifier of a filegroup.",
        returnType: "smallint",
    }),
    routine("FILEGROUP_NAME", {
        parameters: ["filegroup_id"],
        documentation: "Returns the name of a filegroup.",
        returnType: "nvarchar(128)",
    }),
    routine("FILEGROUPPROPERTY", {
        parameters: ["filegroup_name", "property_name"],
        documentation: "Returns the requested property of a filegroup.",
        returnType: "int",
    }),
    routine("FILEPROPERTY", {
        parameters: ["file_name", "property_name"],
        documentation: "Returns the requested property of a database file.",
        returnType: "int",
    }),
    routine("FULLTEXTCATALOGPROPERTY", {
        parameters: ["catalog_name", "property_name"],
        documentation: "Returns the requested property of a full-text catalog.",
        returnType: "int",
    }),
    routine("FULLTEXTSERVICEPROPERTY", {
        parameters: ["property_name"],
        documentation: "Returns the requested property of the full-text engine service.",
        returnType: "int",
    }),
    routine("GET_BIT", {
        parameters: ["expression_value", "bit_offset"],
        documentation: "Returns the bit at the specified offset in an integer or binary value.",
        returnType: "bit",
        minimumCompatibility: 160,
    }),
    routine("GET_FILESTREAM_TRANSACTION_CONTEXT", {
        documentation: "Returns a token representing the current FILESTREAM transaction context.",
        returnType: "varbinary(max)",
    }),
    routine("GETANSINULL", {
        parameters: ["[database]"],
        documentation: "Returns the database default nullability setting.",
        returnType: "int",
    }),
    routine("HAS_DBACCESS", {
        parameters: ["database_name"],
        documentation: "Reports whether the current user can access a database.",
        returnType: "int",
    }),
    routine("HASHBYTES", {
        parameters: ["algorithm", "input"],
        documentation: "Returns a cryptographic hash of an input value.",
        returnType: "varbinary",
    }),
    routine("HOST_ID", {
        documentation: "Returns the workstation identifier reported by the current client session.",
        returnType: "char(10)",
    }),
    routine("IDENT_INCR", {
        parameters: ["table_or_view"],
        documentation: "Returns the increment configured for an identity column.",
        returnType: "numeric",
    }),
    routine("IDENT_SEED", {
        parameters: ["table_or_view"],
        documentation: "Returns the seed configured for an identity column.",
        returnType: "numeric",
    }),
    routine("INDEXKEY_PROPERTY", {
        parameters: ["object_id", "index_id", "key_id", "property_name"],
        documentation: "Returns the requested property of an index key column.",
        returnType: "int",
    }),
    routine("INDEXPROPERTY", {
        parameters: ["object_id", "index_or_statistics_name", "property_name"],
        documentation: "Returns the requested property of an index or statistics object.",
        returnType: "int",
    }),
    routine("IS_MEMBER", {
        parameters: ["group_or_role"],
        documentation:
            "Reports whether the current database principal belongs to a database role or Windows group.",
        returnType: "int",
    }),
    routine("IS_OBJECTSIGNED", {
        parameters: ["class", "object_id", "signing_class", "thumbprint"],
        documentation:
            "Reports whether an object is signed by the specified certificate or asymmetric key.",
        returnType: "int",
    }),
    routine("IS_ROLEMEMBER", {
        parameters: ["role", "[database_principal]"],
        documentation: "Reports whether a database principal belongs to a database role.",
        returnType: "int",
    }),
    routine("IS_SRVROLEMEMBER", {
        parameters: ["role", "[login]"],
        documentation: "Reports whether a login belongs to a fixed server role.",
        returnType: "int",
    }),
    routine("JARO_WINKLER_DISTANCE", {
        parameters: ["character_expression", "character_expression"],
        documentation: "Returns the Jaro-Winkler edit distance between two strings.",
        returnType: "float",
        minimumCompatibility: 170,
    }),
    routine("JARO_WINKLER_SIMILARITY", {
        parameters: ["character_expression", "character_expression"],
        documentation: "Returns a Jaro-Winkler similarity score from zero through one hundred.",
        returnType: "int",
        minimumCompatibility: 170,
    }),
    routine("JSON_CONTAINS", {
        parameters: [
            "target_expression",
            "search_value_expression",
            "[path_expression]",
            "[search_mode]",
        ],
        documentation: "Tests whether a JSON value occurs at a path in a JSON document.",
        returnType: "bit",
        minimumCompatibility: 170,
    }),
    routine("KEY_GUID", {
        parameters: ["key_name"],
        documentation: "Returns the GUID of a symmetric key.",
        returnType: "uniqueidentifier",
    }),
    routine("KEY_ID", {
        parameters: ["key_name"],
        documentation: "Returns the identifier of a symmetric key.",
        returnType: "int",
    }),
    routine("KEY_NAME", {
        parameters: ["ciphertext_or_key_guid"],
        documentation:
            "Returns the name of the symmetric key associated with encrypted data or a key GUID.",
        returnType: "varchar(128)",
    }),
    routine("LEFT", {
        parameters: ["character_expression", "integer_expression"],
        documentation: "Returns the requested number of characters from the left side of a string.",
    }),
    routine("LEFT_SHIFT", {
        parameters: ["expression_value", "shift_amount"],
        documentation: "Shifts the bits of an integer or binary value to the left.",
        minimumCompatibility: 160,
    }),
    routine("LOGINPROPERTY", {
        parameters: ["login_name", "property_name"],
        documentation: "Returns the requested password-policy property of a SQL login.",
        returnType: "sql_variant",
    }),
    routine("MIN_ACTIVE_ROWVERSION", {
        documentation: "Returns the lowest active rowversion value in the current database.",
        returnType: "binary(8)",
    }),
    routine("OBJECTPROPERTY", {
        parameters: ["object_id", "property_name"],
        documentation: "Returns the requested property of a schema-scoped object.",
        returnType: "int",
    }),
    routine("OBJECTPROPERTYEX", {
        parameters: ["object_id", "property_name"],
        documentation: "Returns an extended property value for a schema-scoped object.",
        returnType: "sql_variant",
    }),
    routine("ORIGINAL_DB_NAME", {
        documentation:
            "Returns the database name specified by the client for the current connection.",
        returnType: "nvarchar(128)",
    }),
    routine("ORIGINAL_LOGIN", {
        documentation: "Returns the login name that originally connected to the session.",
        returnType: "sysname",
    }),
    routine("PERMISSIONS", {
        parameters: ["[object_id]", "[column_name]"],
        documentation:
            "Returns a bitmap of statement, object, or column permissions for the current user.",
        returnType: "int",
    }),
    routine("PWDCOMPARE", {
        parameters: ["clear_text_password", "password_hash", "[version]"],
        documentation: "Tests a clear-text password against a SQL Server password hash.",
        returnType: "int",
    }),
    routine("PWDENCRYPT", {
        parameters: ["password"],
        documentation: "Returns the SQL Server password hash of a clear-text password.",
        returnType: "varbinary(128)",
    }),
    routine("REGEXP_COUNT", {
        parameters: ["string_expression", "pattern_expression", "[start]", "[flags]"],
        documentation: "Returns the number of regular-expression matches in a string.",
        returnType: "int",
    }),
    routine("REGEXP_INSTR", {
        parameters: [
            "string_expression",
            "pattern_expression",
            "[start]",
            "[occurrence]",
            "[return_option]",
            "[flags]",
            "[group]",
        ],
        documentation: "Returns the position of a substring matched by a regular expression.",
        returnType: "int",
    }),
    routine("REGEXP_LIKE", {
        parameters: ["string_expression", "pattern_expression", "[flags]"],
        documentation: "Tests whether a string matches a regular expression.",
        returnType: "bit",
        minimumCompatibility: 170,
    }),
    routine("REGEXP_REPLACE", {
        parameters: [
            "string_expression",
            "pattern_expression",
            "[string_replacement]",
            "[start]",
            "[occurrence]",
            "[flags]",
        ],
        documentation: "Replaces substrings matched by a regular expression.",
    }),
    routine("REGEXP_SUBSTR", {
        parameters: [
            "string_expression",
            "pattern_expression",
            "[start]",
            "[occurrence]",
            "[flags]",
            "[group]",
        ],
        documentation: "Returns a substring matched by a regular expression.",
    }),
    routine("RIGHT", {
        parameters: ["character_expression", "integer_expression"],
        documentation:
            "Returns the requested number of characters from the right side of a string.",
    }),
    routine("RIGHT_SHIFT", {
        parameters: ["expression_value", "shift_amount"],
        documentation: "Shifts the bits of an integer or binary value to the right.",
        minimumCompatibility: 160,
    }),
    routine("ROWCOUNT_BIG", {
        documentation: "Returns the number of rows affected by the last statement as a bigint.",
        returnType: "bigint",
    }),
    routine("SESSION_CONTEXT", {
        parameters: ["key"],
        documentation: "Returns a value stored under a key in the current session context.",
        returnType: "sql_variant",
        minimumCompatibility: 130,
    }),
    routine("SESSION_ID", {
        documentation: "Returns the identifier of the current distributed SQL session.",
        returnType: "nvarchar(32)",
    }),
    routine("SESSIONPROPERTY", {
        parameters: ["option"],
        documentation: "Returns the current session setting for a SET option.",
        returnType: "sql_variant",
    }),
    routine("SET_BIT", {
        parameters: ["expression_value", "bit_offset", "[bit_value]"],
        documentation:
            "Sets or clears a bit at the specified offset in an integer or binary value.",
        minimumCompatibility: 160,
    }),
    routine("SIGNBYASYMKEY", {
        parameters: ["asymmetric_key_id", "plaintext", "[password]"],
        documentation: "Signs data with an asymmetric key.",
        returnType: "varbinary(max)",
    }),
    routine("SIGNBYCERT", {
        parameters: ["certificate_id", "cleartext", "[password]"],
        documentation: "Signs data with a certificate private key.",
        returnType: "varbinary(max)",
    }),
    routine("SMALLDATETIMEFROMPARTS", {
        parameters: ["year", "month", "day", "hour", "minute"],
        documentation: "Constructs a smalldatetime value from its individual parts.",
        returnType: "smalldatetime",
    }),
    routine("SQL_VARIANT_PROPERTY", {
        parameters: ["expression", "property_name"],
        documentation: "Returns type information about a sql_variant value.",
        returnType: "sql_variant",
    }),
    routine("STATS_DATE", {
        parameters: ["object_id", "stats_id"],
        documentation: "Returns the date and time when statistics were last updated.",
        returnType: "datetime",
    }),
    routine("SUSER_ID", {
        parameters: ["[login]"],
        documentation: "Returns the server principal identifier for a login.",
        returnType: "int",
    }),
    routine("SUSER_SID", {
        parameters: ["[login]", "[validation_mode]"],
        documentation: "Returns the security identifier for a login.",
        returnType: "varbinary(85)",
    }),
    routine("SYMKEYPROPERTY", {
        parameters: ["key_id", "property_name"],
        documentation: "Returns the requested property of a symmetric key.",
        returnType: "sql_variant",
    }),
    routine("TIMEFROMPARTS", {
        parameters: ["hour", "minute", "seconds", "fractions", "precision"],
        documentation: "Constructs a time value from its individual parts.",
        returnType: "time",
    }),
    routine("TRANSLATE", {
        parameters: ["input_string", "characters", "translations"],
        documentation:
            "Replaces characters in a string using corresponding characters from a translation string.",
        minimumCompatibility: 140,
    }),
    routine("TRIGGER_NESTLEVEL", {
        parameters: ["[object_id]", "[trigger_type]", "[trigger_event_category]"],
        documentation: "Returns the nesting level of trigger execution.",
        returnType: "int",
    }),
    routine("TYPEPROPERTY", {
        parameters: ["type_name", "property_name"],
        documentation: "Returns the requested property of a data type.",
        returnType: "int",
    }),
    routine("UNISTR", {
        parameters: ["character_expression", "[unicode_escape_character]"],
        documentation: "Interprets Unicode escape sequences in a character expression.",
        returnType: "nvarchar",
        minimumCompatibility: 170,
    }),
    routine("VECTOR_NORM", {
        parameters: ["vector", "norm_type"],
        documentation: "Returns the magnitude of a vector under the requested norm.",
        returnType: "float",
        minimumCompatibility: 170,
    }),
    routine("VECTOR_NORMALIZE", {
        parameters: ["vector", "norm_type"],
        documentation: "Returns a vector scaled to unit length under the requested norm.",
        returnType: "vector",
        minimumCompatibility: 170,
    }),
    routine("VERIFYSIGNEDBYASYMKEY", {
        parameters: ["asymmetric_key_id", "clear_text", "signature"],
        documentation: "Verifies a digital signature made with an asymmetric key.",
        returnType: "int",
    }),
    routine("VERIFYSIGNEDBYCERT", {
        parameters: ["certificate_id", "signed_data", "signature"],
        documentation: "Verifies a digital signature made with a certificate.",
        returnType: "int",
    }),
    routine("XACT_STATE", {
        documentation:
            "Reports whether the current session has an active, committable, or uncommittable transaction.",
        returnType: "smallint",
    }),
    routine("COLLATIONPROPERTY", {
        parameters: ["collation_name", "property_name"],
        documentation: "Returns the requested property of a collation.",
        returnType: "sql_variant",
    }),
    routine("FILETABLEROOTPATH", {
        parameters: ["[filetable_name]", "option"],
        documentation: "Returns the root UNC path for a FileTable or the current database.",
        returnType: "nvarchar(4000)",
    }),
    routine("GETPATHLOCATOR", {
        parameters: ["filenamespace_path"],
        documentation: "Returns the hierarchyid path locator for a FileTable namespace path.",
        returnType: "hierarchyid",
    }),
    routine("TERTIARY_WEIGHTS", {
        parameters: ["non_unicode_character_expression"],
        documentation: "Returns tertiary collation weights for a non-Unicode character expression.",
        returnType: "varbinary",
    }),
    routine("TEXTPTR", {
        parameters: ["column"],
        documentation: "Returns the text pointer for a text, ntext, or image column.",
        returnType: "varbinary(16)",
    }),
    routine("TEXTVALID", {
        parameters: ["table_and_column", "text_pointer"],
        documentation: "Tests whether a text pointer is valid for a text, ntext, or image column.",
        returnType: "int",
    }),
    routine("UPDATE", {
        parameters: ["column"],
        documentation: "Tests whether an INSERT or UPDATE trigger targeted a column.",
        returnType: "boolean",
    }),
    routine("VERSION", {
        documentation: "Returns version information for the distributed SQL engine.",
        returnType: "nvarchar",
        engineProfiles: ["azure-synapse-dedicated"],
    }),
    routine("GET_TRANSMISSION_STATUS", {
        parameters: ["conversation_handle"],
        documentation:
            "Returns the status of the latest Service Broker transmission for a conversation.",
        returnType: "nchar",
        engineProfiles: ["sql-server", "azure-sql-managed-instance"],
    }),
    routine("PUBLISHINGSERVERNAME", {
        documentation: "Returns the originating Publisher of a mirrored publication database.",
        returnType: "nvarchar",
        engineProfiles: ["sql-server", "azure-sql-managed-instance"],
    }),
    routine("XML_SCHEMA_NAMESPACE", {
        parameters: ["relational_schema", "xml_schema_collection_name", "[namespace]"],
        documentation: "Reconstructs schemas stored in an XML schema collection.",
        returnType: "xml",
    }),
];

/**
 * Names retained for recognition without a signature.
 *
 * The current public Microsoft T-SQL reference has no dedicated callable reference for these
 * spellings. The list contains deprecated aliases and engine-internal implementation hooks, so
 * inventing a parameter list would make signature help and argument diagnostics actively
 * misleading. Move a name to `documentedRoutines` only when an authoritative contract is found.
 */
const undocumentedRoutineNames: readonly string[] = [
    "BCPCOLLATIONNAME",
    "BRICK_ID",
    "CLOUD_DATABASEPROPERTYEX",
    "COLLATIONNAME",
    "COLLATIONPROPERTYFROMID",
    "COLUMNPROPERTYEX",
    "COMPARECOMPRESSEDSCALARS",
    "COMPAREVARDECIMAL",
    "COMPRESSNUMERIC",
    "COMPRESSSCALAR",
    "CONVERTRESVTOSTRING",
    "DATABASEPROPERTY",
    "DECOMPRESSNUMERIC",
    "DECOMPRESSSCALAR",
    "DEFAULT_DOMAIN",
    "FAZUREADMINSESSION",
    "FEDERATION_FILTERING_VALUE",
    "GENDBNAMEFROMPATH",
    "GEN_NORM_TABLES",
    "GETBINARYSPARSEVECTOR",
    "GETCHECKSUM",
    "GETDEFAULT",
    "GET_CLOUD_PARTITION_MAX_SIZE",
    "GET_NEW_ROWVERSION",
    "IDENTITYPROPERTY",
    "IS_CALLERSIGNED",
    "NEWFILESTREAMVALUE",
    "NORMALIZE",
    "NORMALIZE_DENORMALIZE",
    "NT_CLIENT",
    "OBJIDUPDATE",
    "ODBCPREC",
    "ODBCSCALE",
    "PARTITION_FRAGMENT_ID",
    "PLATFORM",
    "PROGRAM_NAME",
    "RETRIEVEDBREPLICASTATE",
    "SID_BINARY",
    "SQL_CONNECTION_MODE",
    "UNCOMPRESS",
    "USER_SID",
    "XTYPETOTDS",
];

const systemVariables: readonly BuiltInEntry[] = [
    named("@@ROWCOUNT", "systemVariable", "Rows affected by the last statement."),
    named(
        "@@ERROR",
        "systemVariable",
        "Error number of the last statement, or 0 when it succeeded.",
    ),
    named(
        "@@IDENTITY",
        "systemVariable",
        "Last identity value inserted on this connection, in any scope.",
    ),
    named("@@TRANCOUNT", "systemVariable", "Number of open transactions on this connection."),
    named("@@FETCH_STATUS", "systemVariable", "Status of the last cursor fetch: 0 succeeded."),
    named("@@VERSION", "systemVariable", "Version, edition, and build of the server."),
    named("@@SERVERNAME", "systemVariable", "Name of the local server."),
    named("@@SPID", "systemVariable", "Session id of the current connection."),
    named("@@NESTLEVEL", "systemVariable", "Nesting level of the executing module."),
    named("@@LANGUAGE", "systemVariable", "Language currently in use."),
    named("@@LOCK_TIMEOUT", "systemVariable", "Lock timeout for this connection, in milliseconds."),
    named("@@CURSOR_ROWS", "systemVariable", "Rows in the most recently opened cursor."),
    named("@@DATEFIRST", "systemVariable", "First day of the week for this connection."),
    named("@@MAX_PRECISION", "systemVariable", "Precision that decimal and numeric types use."),
    named("@@OPTIONS", "systemVariable", "Bit map of the SET options active for this connection."),
    named(
        "@@TOTAL_ERRORS",
        "systemVariable",
        "Disk write errors the server has met since it started.",
    ),
];

const dataTypes: readonly BuiltInEntry[] = [
    named("bit", "dataType", "Integer that stores 0, 1, or NULL."),
    named("tinyint", "dataType", "Exact number, 1 byte, 0 through 255."),
    named("smallint", "dataType", "Exact number, 2 bytes, -32,768 through 32,767."),
    named("int", "dataType", "Exact number, 4 bytes, -2,147,483,648 through 2,147,483,647."),
    named("bigint", "dataType", "Exact number, 8 bytes."),
    named("decimal", "dataType", "Exact number with a fixed precision and scale."),
    named(
        "numeric",
        "dataType",
        "Exact number with a fixed precision and scale; the same type as decimal.",
    ),
    named("money", "dataType", "Currency value, 8 bytes, accurate to four decimal places."),
    named("smallmoney", "dataType", "Currency value, 4 bytes, accurate to four decimal places."),
    named(
        "float",
        "dataType",
        "Approximate number; the mantissa size follows the declared precision.",
    ),
    named("real", "dataType", "Approximate number, 4 bytes; the same type as float(24)."),
    named("date", "dataType", "Calendar date without a time."),
    named("time", "dataType", "Time of day, with a declared fractional-second precision."),
    named("datetime", "dataType", "Date and time, accurate to about 3.33 milliseconds."),
    named("datetime2", "dataType", "Date and time, with a declared fractional-second precision."),
    named("smalldatetime", "dataType", "Date and time, accurate to the minute."),
    named("datetimeoffset", "dataType", "Date and time with a time-zone offset."),
    named("char", "dataType", "Fixed-length non-Unicode text, padded to the declared length."),
    named("varchar", "dataType", "Variable-length non-Unicode text; `max` stores up to 2 GB."),
    named("text", "dataType", "Deprecated variable-length non-Unicode text. Use varchar(max)."),
    named("nchar", "dataType", "Fixed-length Unicode text, padded to the declared length."),
    named("nvarchar", "dataType", "Variable-length Unicode text; `max` stores up to 2 GB."),
    named("ntext", "dataType", "Deprecated variable-length Unicode text. Use nvarchar(max)."),
    named("binary", "dataType", "Fixed-length binary data."),
    named("varbinary", "dataType", "Variable-length binary data; `max` stores up to 2 GB."),
    named("image", "dataType", "Deprecated variable-length binary data. Use varbinary(max)."),
    named("uniqueidentifier", "dataType", "16-byte GUID."),
    named("xml", "dataType", "XML document or fragment, optionally bound to a schema collection."),
    named("sql_variant", "dataType", "Value of any of several base types, carrying its own type."),
    named("hierarchyid", "dataType", "Position in a hierarchy."),
    named("geography", "dataType", "Ellipsoidal spatial data."),
    named("geometry", "dataType", "Planar spatial data."),
    named("sysname", "dataType", "System-supplied alias for nvarchar(128)."),
    named(
        "rowversion",
        "dataType",
        "Automatically generated binary value, unique within a database.",
    ),
    named(
        "timestamp",
        "dataType",
        "Deprecated spelling of rowversion; unrelated to date and time.",
    ),
    named(
        "cursor",
        "dataType",
        "Reference to a cursor; valid for a variable or an output parameter.",
    ),
    named("table", "dataType", "Result set held for later use, declared with its own column list."),
    {
        ...named("json", "dataType", "JSON document stored in its parsed form."),
        minimumCompatibility: 170,
    },
    {
        ...named("vector", "dataType", "Fixed-length vector of single-precision values."),
        minimumCompatibility: 170,
    },
];

const builtInKinds: readonly BuiltInKind[] = ["routine", "systemVariable", "dataType"];

/** Documented T-SQL type synonyms, stored once for parser-independent semantic consumers. */
const systemDataTypeSynonyms: ReadonlyMap<string, string> = new Map([
    ["binary varying", "varbinary"],
    ["char varying", "varchar"],
    ["character", "char"],
    ["character varying", "varchar"],
    ["dec", "decimal"],
    ["double precision", "float"],
    ["integer", "int"],
    ["national char", "nchar"],
    ["national char varying", "nvarchar"],
    ["national character", "nchar"],
    ["national character varying", "nvarchar"],
]);

const registry: ReadonlyMap<string, BuiltInEntry> = new Map(
    [
        ...documentedRoutines,
        ...undocumentedRoutineNames.map(undocumentedRoutine),
        ...systemVariables,
        ...dataTypes,
    ].map((entry) => [registryKey(normalize(entry.name), entry.kind), entry]),
);

function registryKey(normalizedName: string, kind: BuiltInKind): string {
    return `${kind}\u0000${normalizedName}`;
}

/** Names currently recognized by editor features as shipped routines. */
export const builtInRoutineNames: ReadonlySet<string> = new Set(
    builtInsOfKind("routine").map((entry) => normalize(entry.name)),
);
