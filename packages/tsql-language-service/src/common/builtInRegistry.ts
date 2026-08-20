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
        parameters: ["separator", "argument", "...argument"],
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
        parameters: ["expression", "USE MODEL model"],
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
        parameters: ["expression", "label", "...label"],
        documentation: "Returns the label that best classifies the expression.",
        returnType: "nvarchar",
        engineProfiles: ["fabric-warehouse"],
    }),
    routine("AI_EXTRACT", {
        parameters: ["expression", "field", "...field"],
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
        parameters: ["prompt"],
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
];

/** Routines recognized by name, so coloring and hover name them even without a documented call. */
const recognizedRoutineNames: readonly string[] = [
    // Names without curated signatures are still shared here so completion, coloring, hover, and
    // semantic validation agree that they are shipped routines. Add documentation to the
    // corresponding `routine(...)` entry when richer help becomes available.
    "APPLOCK_MODE",
    "APPLOCK_TEST",
    "ASSEMBLYPROPERTY",
    "ASYMKEY_ID",
    "ASYMKEYPROPERTY",
    "BASE64_DECODE",
    "BASE64_ENCODE",
    "BCPCOLLATIONNAME",
    "BINARY_CHECKSUM",
    "BIT_COUNT",
    "BRICK_ID",
    "CERT_ID",
    "CERTENCODED",
    "CERTPRIVATEKEY",
    "CERTPROPERTY",
    "CHANGE_TRACKING_CURRENT_VERSION",
    "CHANGE_TRACKING_IS_COLUMN_IN_MASK",
    "CHANGE_TRACKING_MIN_VALID_VERSION",
    "CLOUD_DATABASEPROPERTYEX",
    "COLLATIONNAME",
    "COLLATIONPROPERTY",
    "COLLATIONPROPERTYFROMID",
    "COLUMNPROPERTY",
    "COLUMNPROPERTYEX",
    "COLUMNS_UPDATED",
    "COMPARECOMPRESSEDSCALARS",
    "COMPAREVARDECIMAL",
    "COMPRESS",
    "COMPRESSNUMERIC",
    "COMPRESSSCALAR",
    "CONNECTIONPROPERTY",
    "CONTEXT_INFO",
    "CONVERTRESVTOSTRING",
    "CRYPT_GEN_RANDOM",
    "CURRENT_DATE",
    "CURRENT_REQUEST_ID",
    "CURRENT_TIMEZONE",
    "CURRENT_TIMEZONE_ID",
    "CURRENT_TRANSACTION_ID",
    "CURSOR_STATUS",
    "DATABASE_PRINCIPAL_ID",
    "DATABASEPROPERTY",
    "DATABASEPROPERTYEX",
    "DATE_BUCKET",
    "DATETIME2FROMPARTS",
    "DATETIMEFROMPARTS",
    "DATETIMEOFFSETFROMPARTS",
    "DECOMPRESS",
    "DECOMPRESSNUMERIC",
    "DECOMPRESSSCALAR",
    "DECRYPTBYASYMKEY",
    "DECRYPTBYCERT",
    "DECRYPTBYKEY",
    "DECRYPTBYKEYAUTOASYMKEY",
    "DECRYPTBYKEYAUTOCERT",
    "DECRYPTBYPASSPHRASE",
    "DEFAULT_DOMAIN",
    "EDIT_DISTANCE",
    "EDIT_DISTANCE_SIMILARITY",
    "ENCRYPTBYASYMKEY",
    "ENCRYPTBYCERT",
    "ENCRYPTBYKEY",
    "ENCRYPTBYPASSPHRASE",
    "EVENTDATA",
    "FAZUREADMINSESSION",
    "FEDERATION_FILTERING_VALUE",
    "FILE_ID",
    "FILE_IDEX",
    "FILE_NAME",
    "FILEGROUP_ID",
    "FILEGROUP_NAME",
    "FILEGROUPPROPERTY",
    "FILEPROPERTY",
    "FILETABLEROOTPATH",
    "FULLTEXTCATALOGPROPERTY",
    "FULLTEXTSERVICEPROPERTY",
    "GEN_NORM_TABLES",
    "GENDBNAMEFROMPATH",
    "GET_BIT",
    "GET_CLOUD_PARTITION_MAX_SIZE",
    "GET_FILESTREAM_TRANSACTION_CONTEXT",
    "GET_NEW_ROWVERSION",
    "GET_TRANSMISSION_STATUS",
    "GETANSINULL",
    "GETBINARYSPARSEVECTOR",
    "GETCHECKSUM",
    "GETDEFAULT",
    "GETPATHLOCATOR",
    "HAS_DBACCESS",
    "HASHBYTES",
    "HOST_ID",
    "IDENT_INCR",
    "IDENT_SEED",
    "IDENTITYPROPERTY",
    "INDEXKEY_PROPERTY",
    "INDEXPROPERTY",
    "IS_CALLERSIGNED",
    "IS_MEMBER",
    "IS_OBJECTSIGNED",
    "IS_ROLEMEMBER",
    "IS_SRVROLEMEMBER",
    "JARO_WINKLER_DISTANCE",
    "JARO_WINKLER_SIMILARITY",
    "JSON_CONTAINS",
    "KEY_GUID",
    "KEY_ID",
    "KEY_NAME",
    "LEFT",
    "LEFT_SHIFT",
    "LOGINPROPERTY",
    "MIN_ACTIVE_ROWVERSION",
    "NEWFILESTREAMVALUE",
    "NORMALIZE",
    "NORMALIZE_DENORMALIZE",
    "NT_CLIENT",
    "OBJECTPROPERTY",
    "OBJECTPROPERTYEX",
    "OBJIDUPDATE",
    "ODBCPREC",
    "ODBCSCALE",
    "ORIGINAL_DB_NAME",
    "ORIGINAL_LOGIN",
    "PARTITION_FRAGMENT_ID",
    "PERMISSIONS",
    "PLATFORM",
    "PROGRAM_NAME",
    "PUBLISHINGSERVERNAME",
    "PWDCOMPARE",
    "PWDENCRYPT",
    "REGEXP_COUNT",
    "REGEXP_INSTR",
    "REGEXP_LIKE",
    "REGEXP_REPLACE",
    "REGEXP_SUBSTR",
    "RETRIEVEDBREPLICASTATE",
    "RIGHT",
    "RIGHT_SHIFT",
    "ROWCOUNT_BIG",
    "SESSION_CONTEXT",
    "SESSION_ID",
    "SESSIONPROPERTY",
    "SET_BIT",
    "SID_BINARY",
    "SIGNBYASYMKEY",
    "SIGNBYCERT",
    "SMALLDATETIMEFROMPARTS",
    "SQL_CONNECTION_MODE",
    "SQL_VARIANT_PROPERTY",
    "STATS_DATE",
    "SUSER_ID",
    "SUSER_SID",
    "SYMKEYPROPERTY",
    "TERTIARY_WEIGHTS",
    "TEXTPTR",
    "TEXTVALID",
    "TIMEFROMPARTS",
    "TRANSLATE",
    "TRIGGER_NESTLEVEL",
    "TYPEPROPERTY",
    "UNCOMPRESS",
    "UNISTR",
    "UPDATE",
    "USER_SID",
    "VECTOR_NORM",
    "VECTOR_NORMALIZE",
    "VERIFYSIGNEDBYASYMKEY",
    "VERIFYSIGNEDBYCERT",
    "VERSION",
    "XACT_STATE",
    "XML_SCHEMA_NAMESPACE",
    "XTYPETOTDS",
    "ACOS",
    "APP_NAME",
    "ASCII",
    "ASIN",
    "ATAN",
    "ATN2",
    "CEILING",
    "CHAR",
    "CHARINDEX",
    "CHECKSUM",
    "CHOOSE",
    "COL_LENGTH",
    "COL_NAME",
    "COS",
    "COT",
    "CUME_DIST",
    "DATALENGTH",
    "DATEFROMPARTS",
    "DAY",
    "DB_ID",
    "DB_NAME",
    "DEGREES",
    "DIFFERENCE",
    "EOMONTH",
    "ERROR_LINE",
    "ERROR_MESSAGE",
    "ERROR_NUMBER",
    "ERROR_PROCEDURE",
    "ERROR_SEVERITY",
    "ERROR_STATE",
    "EXP",
    "FIRST_VALUE",
    "FLOOR",
    "FORMATMESSAGE",
    "GROUPING",
    "GROUPING_ID",
    "HAS_PERMS_BY_NAME",
    "HOST_NAME",
    "IDENT_CURRENT",
    "INDEX_COL",
    "ISDATE",
    "ISNUMERIC",
    "LAG",
    "LAST_VALUE",
    "LEAD",
    "LOG",
    "LOG10",
    "LOWER",
    "LTRIM",
    "MONTH",
    "NCHAR",
    "NEWSEQUENTIALID",
    "NTILE",
    "OBJECT_DEFINITION",
    "OBJECT_SCHEMA_NAME",
    "PARSENAME",
    "PATINDEX",
    "PERCENTILE_CONT",
    "PERCENTILE_DISC",
    "PERCENT_RANK",
    "PI",
    "POWER",
    "QUOTENAME",
    "RADIANS",
    "RAND",
    "REPLACE",
    "REPLICATE",
    "REVERSE",
    "ROUND",
    "RTRIM",
    "SCHEMA_ID",
    "SCHEMA_NAME",
    "SCOPE_IDENTITY",
    "SERVERPROPERTY",
    "SIGN",
    "SIN",
    "SOUNDEX",
    "SPACE",
    "SQRT",
    "SQUARE",
    "STDEV",
    "STDEVP",
    "STR",
    "STRING_ESCAPE",
    "STUFF",
    "SUSER_NAME",
    "SUSER_SNAME",
    "SWITCHOFFSET",
    "SYSDATETIMEOFFSET",
    "TAN",
    "TODATETIMEOFFSET",
    "TYPE_ID",
    "TYPE_NAME",
    "UNICODE",
    "UPPER",
    "USER_ID",
    "USER_NAME",
    "VAR",
    "VARP",
    "YEAR",
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
        ...recognizedRoutineNames.map(undocumentedRoutine),
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
