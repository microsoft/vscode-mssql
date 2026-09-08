/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Identifier and literal construction.
 *
 * The data plane carries a query as text and has no parameter collection, so every value this
 * engine sends reaches the server inside the statement itself. That makes this file the whole
 * of the injection boundary: nothing else may build SQL from a user-supplied string. Values are
 * encoded by their column's declared type rather than by guessing from the JavaScript value, so
 * a string can never be spliced in where a number was expected.
 */

/** A composed SQL fragment. The type exists so a raw string cannot be mistaken for safe SQL. */
export type Sql = string & { readonly __sql?: unique symbol };

export class SqlEditError extends Error {
    constructor(
        message: string,
        readonly code:
            | "invalidIdentifier"
            | "invalidValue"
            | "unsupportedType"
            | "noKey"
            | "notEditable"
            | "concurrency"
            | "incompleteValue"
            | "commitFailed",
    ) {
        super(message);
        this.name = "SqlEditError";
    }
}

/**
 * Wraps an identifier in brackets, doubling any closing bracket.
 *
 * A name carrying `]` is the one way a bracketed identifier can be closed early, so it is the
 * one thing that has to be escaped. Empty names are rejected rather than producing `[]`, which
 * SQL Server accepts and which would silently target the wrong object.
 */
export function quoteName(identifier: string): Sql {
    if (typeof identifier !== "string" || identifier.trim().length === 0) {
        throw new SqlEditError("An identifier must not be empty.", "invalidIdentifier");
    }
    if (identifier.includes("\0")) {
        throw new SqlEditError(
            "An identifier must not contain a null character.",
            "invalidIdentifier",
        );
    }
    return `[${identifier.replace(/]/g, "]]")}]`;
}

/** `[schema].[table]`, or `[table]` when no schema is known. */
export function qualifiedName(schema: string | undefined, name: string): Sql {
    return schema && schema.length > 0
        ? `${quoteName(schema)}.${quoteName(name)}`
        : quoteName(name);
}

/**
 * A Unicode string literal with embedded quotes doubled.
 *
 * Always `N'...'`: a non-Unicode literal silently transcodes through the database collation,
 * which turns characters it cannot represent into `?` on the way into the table.
 */
export function stringLiteral(value: string): Sql {
    if (value.includes("\0")) {
        // SQL Server truncates a literal at a null character, which would quietly write a
        // shorter value than the user typed.
        throw new SqlEditError("A text value must not contain a null character.", "invalidValue");
    }
    return `N'${value.replace(/'/g, "''")}'`;
}

/** `0x...` for binary values. */
export function binaryLiteral(bytes: Uint8Array): Sql {
    if (bytes.length === 0) {
        return "0x";
    }
    let hex = "";
    for (const byte of bytes) {
        hex += byte.toString(16).padStart(2, "0");
    }
    return `0x${hex}`;
}

/** A comment-safe label, for tagging generated scripts without letting text escape into SQL. */
export function comment(text: string): Sql {
    return `-- ${text.replace(/[\r\n]+/g, " ")}`;
}
