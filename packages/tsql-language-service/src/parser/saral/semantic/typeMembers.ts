/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

import { type TypeMember } from "./scope.js";

const BUILTIN_TYPE_MEMBERS: Record<string, TypeMember[]> = {
    GEOGRAPHY: [
        { name: "Lat", kind: "property", returnType: "FLOAT" },
        { name: "Long", kind: "property", returnType: "FLOAT" },
        { name: "STSrid", kind: "property", returnType: "INT" },
        { name: "STAsText", kind: "method", returnType: "NVARCHAR(MAX)" },
        { name: "STBuffer", kind: "method", returnType: "GEOGRAPHY" },
        { name: "STContains", kind: "method", returnType: "BIT" },
        { name: "STDistance", kind: "method", returnType: "FLOAT" },
        { name: "STIntersects", kind: "method", returnType: "BIT" },
        { name: "STWithin", kind: "method", returnType: "BIT" },
        { name: "ToString", kind: "method", returnType: "NVARCHAR(MAX)" },
    ],
    GEOMETRY: [
        { name: "STSrid", kind: "property", returnType: "INT" },
        { name: "STArea", kind: "method", returnType: "FLOAT" },
        { name: "STAsText", kind: "method", returnType: "NVARCHAR(MAX)" },
        { name: "STBuffer", kind: "method", returnType: "GEOMETRY" },
        { name: "STContains", kind: "method", returnType: "BIT" },
        { name: "STDistance", kind: "method", returnType: "FLOAT" },
        { name: "STIntersects", kind: "method", returnType: "BIT" },
        { name: "STLength", kind: "method", returnType: "FLOAT" },
        { name: "STWithin", kind: "method", returnType: "BIT" },
        { name: "ToString", kind: "method", returnType: "NVARCHAR(MAX)" },
    ],
    XML: [
        { name: "value", kind: "method", returnType: "SQL_VARIANT" },
        { name: "query", kind: "method", returnType: "XML" },
        { name: "exist", kind: "method", returnType: "BIT" },
        { name: "nodes", kind: "method", returnType: "TABLE" },
        { name: "modify", kind: "method", returnType: "VOID" },
    ],
    HIERARCHYID: [
        { name: "GetAncestor", kind: "method", returnType: "HIERARCHYID" },
        { name: "GetDescendant", kind: "method", returnType: "HIERARCHYID" },
        { name: "GetLevel", kind: "method", returnType: "INT" },
        { name: "IsDescendantOf", kind: "method", returnType: "BIT" },
        { name: "ToString", kind: "method", returnType: "NVARCHAR(4000)" },
    ],
};

export function getBuiltinTypeMembersCatalog(): Record<string, TypeMember[]> {
    const clone: Record<string, TypeMember[]> = {};
    for (const [key, members] of Object.entries(BUILTIN_TYPE_MEMBERS)) {
        clone[key] = members.map((member) => ({ ...member }));
    }
    return clone;
}

function canonicalDataType(dataType?: string): string | undefined {
    if (!dataType) return undefined;

    const normalized = dataType.trim().toUpperCase();
    const base = normalized.includes("(")
        ? normalized.substring(0, normalized.indexOf("(")).trim()
        : normalized;
    return base || undefined;
}

export function getTypeMembers(dataType?: string): TypeMember[] | undefined {
    const key = canonicalDataType(dataType);
    if (!key) return undefined;
    const members = BUILTIN_TYPE_MEMBERS[key];
    if (!members?.length) return undefined;
    return members.map((member) => ({ ...member }));
}

export function resolveTypeMember(
    dataType: string | undefined,
    memberName: string,
): TypeMember | undefined {
    const members = getTypeMembers(dataType);
    if (!members?.length) return undefined;
    const key = memberName.toLowerCase();
    return members.find((member) => member.name.toLowerCase() === key);
}
