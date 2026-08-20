/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** One language-defined member that is not supplied by catalog metadata. */
export interface LanguageTypeMember {
    readonly name: string;
    readonly detail: string;
    /** A fixed scalar result. Dynamic, rowset, and mutating results omit this field. */
    readonly returnType?: string;
    readonly result: "scalar" | "dynamic-scalar" | "rowset" | "mutation";
}

/**
 * The XML data type member surface.
 *
 * Completion, type inference, and semantic validation all consume this table. Keeping the result
 * shape beside the display text prevents those features from accepting different method sets.
 */
export const xmlDataTypeMembers: readonly LanguageTypeMember[] = Object.freeze([
    {
        name: "value",
        detail: "value(xquery, sqlType) — one typed scalar",
        result: "dynamic-scalar",
    },
    {
        name: "query",
        detail: "query(xquery) — an XML result",
        returnType: "xml",
        result: "scalar",
    },
    {
        name: "exist",
        detail: "exist(xquery) — 1, 0, or NULL",
        returnType: "bit",
        result: "scalar",
    },
    {
        name: "nodes",
        detail: "nodes(xquery) — a rowset of fragments",
        result: "rowset",
    },
    {
        name: "modify",
        detail: "modify(xmlDml) — changes the value in place",
        result: "mutation",
    },
]);

const xmlMembersByName = new Map(
    xmlDataTypeMembers.map((member) => [member.name.toLowerCase(), member]),
);

export function xmlDataTypeMember(name: string): LanguageTypeMember | undefined {
    return xmlMembersByName.get(name.toLowerCase());
}
