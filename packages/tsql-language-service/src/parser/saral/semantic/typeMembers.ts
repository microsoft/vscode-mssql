/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

import { type TypeMember } from "./scope.js";

const BUILTIN_TYPE_MEMBERS: Record<string, TypeMember[]> = {
    GEOGRAPHY: [
        // Properties exposed by the SQL Server geography CLR type.
        { name: "IsNull", kind: "property", returnType: "BIT" },
        { name: "Lat", kind: "property", returnType: "FLOAT" },
        { name: "Long", kind: "property", returnType: "FLOAT" },
        { name: "M", kind: "property", returnType: "FLOAT" },
        { name: "STSrid", kind: "property", returnType: "INT" },
        { name: "Z", kind: "property", returnType: "FLOAT" },

        // OGC methods.
        { name: "STArea", kind: "method", returnType: "FLOAT" },
        { name: "STAsBinary", kind: "method", returnType: "VARBINARY(MAX)" },
        { name: "STAsText", kind: "method", returnType: "NVARCHAR(MAX)" },
        { name: "STBuffer", kind: "method", returnType: "GEOGRAPHY" },
        { name: "STContains", kind: "method", returnType: "BIT" },
        { name: "STCurveN", kind: "method", returnType: "GEOGRAPHY" },
        { name: "STCurveToLine", kind: "method", returnType: "GEOGRAPHY" },
        { name: "STDifference", kind: "method", returnType: "GEOGRAPHY" },
        { name: "STDimension", kind: "method", returnType: "INT" },
        { name: "STDisjoint", kind: "method", returnType: "BIT" },
        { name: "STDistance", kind: "method", returnType: "FLOAT" },
        { name: "STEndPoint", kind: "method", returnType: "GEOGRAPHY" },
        { name: "STEquals", kind: "method", returnType: "BIT" },
        { name: "STGeometryN", kind: "method", returnType: "GEOGRAPHY" },
        { name: "STGeometryType", kind: "method", returnType: "NVARCHAR(4000)" },
        { name: "STIntersection", kind: "method", returnType: "GEOGRAPHY" },
        { name: "STIntersects", kind: "method", returnType: "BIT" },
        { name: "STIsClosed", kind: "method", returnType: "BIT" },
        { name: "STIsEmpty", kind: "method", returnType: "BIT" },
        { name: "STIsValid", kind: "method", returnType: "BIT" },
        { name: "STLength", kind: "method", returnType: "FLOAT" },
        { name: "STNumCurves", kind: "method", returnType: "INT" },
        { name: "STNumGeometries", kind: "method", returnType: "INT" },
        { name: "STNumPoints", kind: "method", returnType: "INT" },
        { name: "STPointN", kind: "method", returnType: "GEOGRAPHY" },
        { name: "STStartPoint", kind: "method", returnType: "GEOGRAPHY" },
        { name: "STSymDifference", kind: "method", returnType: "GEOGRAPHY" },
        { name: "STUnion", kind: "method", returnType: "GEOGRAPHY" },
        { name: "STWithin", kind: "method", returnType: "BIT" },

        // SQL Server geography extensions.
        { name: "AsGml", kind: "method", returnType: "XML" },
        { name: "AsTextZM", kind: "method", returnType: "NVARCHAR(MAX)" },
        { name: "BufferWithCurves", kind: "method", returnType: "GEOGRAPHY" },
        { name: "BufferWithTolerance", kind: "method", returnType: "GEOGRAPHY" },
        { name: "CurveToLineWithTolerance", kind: "method", returnType: "GEOGRAPHY" },
        { name: "EnvelopeAngle", kind: "method", returnType: "FLOAT" },
        { name: "EnvelopeCenter", kind: "method", returnType: "GEOGRAPHY" },
        { name: "Filter", kind: "method", returnType: "BIT" },
        { name: "InstanceOf", kind: "method", returnType: "BIT" },
        { name: "MakeValid", kind: "method", returnType: "GEOGRAPHY" },
        { name: "MinDbCompatibilityLevel", kind: "method", returnType: "INT" },
        { name: "NumRings", kind: "method", returnType: "INT" },
        { name: "Reduce", kind: "method", returnType: "GEOGRAPHY" },
        { name: "ReorientObject", kind: "method", returnType: "GEOGRAPHY" },
        { name: "RingN", kind: "method", returnType: "GEOGRAPHY" },
        { name: "ShortestLineTo", kind: "method", returnType: "GEOGRAPHY" },
        { name: "ToString", kind: "method", returnType: "NVARCHAR(MAX)" },
    ],
    GEOMETRY: [
        // Properties exposed by the SQL Server geometry CLR type.
        { name: "IsNull", kind: "property", returnType: "BIT" },
        { name: "M", kind: "property", returnType: "FLOAT" },
        { name: "STSrid", kind: "property", returnType: "INT" },
        { name: "STX", kind: "property", returnType: "FLOAT" },
        { name: "STY", kind: "property", returnType: "FLOAT" },
        { name: "Z", kind: "property", returnType: "FLOAT" },

        // OGC methods.
        { name: "STArea", kind: "method", returnType: "FLOAT" },
        { name: "STAsBinary", kind: "method", returnType: "VARBINARY(MAX)" },
        { name: "STAsText", kind: "method", returnType: "NVARCHAR(MAX)" },
        { name: "STBoundary", kind: "method", returnType: "GEOMETRY" },
        { name: "STBuffer", kind: "method", returnType: "GEOMETRY" },
        { name: "STCentroid", kind: "method", returnType: "GEOMETRY" },
        { name: "STContains", kind: "method", returnType: "BIT" },
        { name: "STConvexHull", kind: "method", returnType: "GEOMETRY" },
        { name: "STCrosses", kind: "method", returnType: "BIT" },
        { name: "STCurveN", kind: "method", returnType: "GEOMETRY" },
        { name: "STCurveToLine", kind: "method", returnType: "GEOMETRY" },
        { name: "STDifference", kind: "method", returnType: "GEOMETRY" },
        { name: "STDimension", kind: "method", returnType: "INT" },
        { name: "STDisjoint", kind: "method", returnType: "BIT" },
        { name: "STDistance", kind: "method", returnType: "FLOAT" },
        { name: "STEndPoint", kind: "method", returnType: "GEOMETRY" },
        { name: "STEnvelope", kind: "method", returnType: "GEOMETRY" },
        { name: "STEquals", kind: "method", returnType: "BIT" },
        { name: "STExteriorRing", kind: "method", returnType: "GEOMETRY" },
        { name: "STGeometryN", kind: "method", returnType: "GEOMETRY" },
        { name: "STGeometryType", kind: "method", returnType: "NVARCHAR(4000)" },
        { name: "STInteriorRingN", kind: "method", returnType: "GEOMETRY" },
        { name: "STIntersection", kind: "method", returnType: "GEOMETRY" },
        { name: "STIntersects", kind: "method", returnType: "BIT" },
        { name: "STIsClosed", kind: "method", returnType: "BIT" },
        { name: "STIsEmpty", kind: "method", returnType: "BIT" },
        { name: "STIsRing", kind: "method", returnType: "BIT" },
        { name: "STIsSimple", kind: "method", returnType: "BIT" },
        { name: "STIsValid", kind: "method", returnType: "BIT" },
        { name: "STLength", kind: "method", returnType: "FLOAT" },
        { name: "STNumCurves", kind: "method", returnType: "INT" },
        { name: "STNumGeometries", kind: "method", returnType: "INT" },
        { name: "STNumInteriorRing", kind: "method", returnType: "INT" },
        { name: "STNumPoints", kind: "method", returnType: "INT" },
        { name: "STOverlaps", kind: "method", returnType: "BIT" },
        { name: "STPointN", kind: "method", returnType: "GEOMETRY" },
        { name: "STPointOnSurface", kind: "method", returnType: "GEOMETRY" },
        { name: "STRelate", kind: "method", returnType: "BIT" },
        { name: "STStartPoint", kind: "method", returnType: "GEOMETRY" },
        { name: "STSymDifference", kind: "method", returnType: "GEOMETRY" },
        { name: "STTouches", kind: "method", returnType: "BIT" },
        { name: "STUnion", kind: "method", returnType: "GEOMETRY" },
        { name: "STWithin", kind: "method", returnType: "BIT" },

        // SQL Server geometry extensions.
        { name: "AsGml", kind: "method", returnType: "XML" },
        { name: "AsTextZM", kind: "method", returnType: "NVARCHAR(MAX)" },
        { name: "BufferWithTolerance", kind: "method", returnType: "GEOMETRY" },
        { name: "Filter", kind: "method", returnType: "BIT" },
        { name: "InstanceOf", kind: "method", returnType: "BIT" },
        { name: "MakeValid", kind: "method", returnType: "GEOMETRY" },
        { name: "Reduce", kind: "method", returnType: "GEOMETRY" },
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
        { name: "GetReparentedValue", kind: "method", returnType: "HIERARCHYID" },
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
