/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * What a column type can do, in one place.
 *
 * Comparability, projection and the editor a value deserves were previously about to be decided
 * in three files. They have to agree: a type excluded from a WHERE but included in a
 * concurrency check produces a statement the server rejects, and one projected raw but edited as
 * text does not round-trip. Keeping the rules together is what makes that impossible.
 */

/**
 * Types SQL Server cannot compare with `=`.
 *
 * These can never appear in a WHERE, which rules them out of row identity and out of the
 * concurrency check. The large object types are the historical cases; xml, json and vector are
 * structured types with no equality operator at all.
 */
export const UNCOMPARABLE_TYPES: ReadonlySet<string> = new Set([
    "text",
    "ntext",
    "image",
    "xml",
    "json",
    "vector",
    "geography",
    "geometry",
]);

export function isComparableType(typeName: string): boolean {
    return !UNCOMPARABLE_TYPES.has(typeName.toLowerCase());
}

/**
 * How a value should be edited.
 *
 * The grid uses this to offer something better than a single-line text box for a value that is
 * a document. Editing a 40 KB XML column in a one-line cell is the difference between the
 * feature being usable and being a demo.
 */
export type EditorKind =
    | "scalar"
    | "multiline"
    | "json"
    | "xml"
    | "binary"
    | "spatial"
    | "vector"
    | "boolean"
    | "date"
    | "readOnly";

const EDITOR_BY_TYPE: Readonly<Record<string, EditorKind>> = {
    xml: "xml",
    json: "json",
    vector: "vector",
    geography: "spatial",
    geometry: "spatial",
    bit: "boolean",
    binary: "binary",
    varbinary: "binary",
    image: "binary",
    date: "date",
    datetime: "date",
    datetime2: "date",
    smalldatetime: "date",
    datetimeoffset: "date",
    time: "date",
    text: "multiline",
    ntext: "multiline",
    sql_variant: "scalar",
    hierarchyid: "scalar",
};

/**
 * Picks the editor for a column.
 *
 * A `max` length string is treated as a document rather than a scalar: its whole point is that
 * it does not fit on a line.
 */
export function editorKindFor(typeName: string, maxLength?: number, isWritable = true): EditorKind {
    if (!isWritable) {
        return "readOnly";
    }
    const name = typeName.toLowerCase();
    const known = EDITOR_BY_TYPE[name];
    if (known) {
        return known;
    }
    if ((name === "nvarchar" || name === "varchar") && maxLength === -1) {
        return "multiline";
    }
    return "scalar";
}

/**
 * Types read through a cast so the text the grid shows is the text the codec can write back.
 *
 * Without this a structured value arrives in whatever shape the driver chose, which for the
 * binary-backed types is unreadable and for the rest is not guaranteed to round-trip.
 */
export function projectionCastFor(
    typeName: string,
): "text" | "binary" | "spatial" | "path" | undefined {
    switch (typeName.toLowerCase()) {
        case "text":
        case "ntext":
        case "xml":
        case "json":
        case "vector":
        case "sql_variant":
            return "text";
        case "image":
            return "binary";
        case "geography":
        case "geometry":
            return "spatial";
        case "hierarchyid":
            return "path";
        default:
            return undefined;
    }
}

/** True for values that routinely exceed a wire cell bound and so may arrive clipped. */
export function isLargeValueType(typeName: string, maxLength?: number): boolean {
    const name = typeName.toLowerCase();
    if (["text", "ntext", "image", "xml", "json", "vector"].includes(name)) {
        return true;
    }
    return maxLength === -1 && ["nvarchar", "varchar", "varbinary"].includes(name);
}
