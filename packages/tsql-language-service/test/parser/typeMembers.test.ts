import {
    getBuiltinTypeMembersCatalog,
    getTypeMembers,
    resolveTypeMember,
} from "../../src/parser/saral/semantic/typeMembers.js";

// Member expectations are independently authored against SqlParser's Geography, Geometry, and
// HierarchyId behavior suites; no SqlParser source or baseline text is copied into this package.

describe("SQL Server special data type members", () => {
    test("exposes the extended geography and geometry instance surfaces", () => {
        const geography = getTypeMembers("geography");
        const geometry = getTypeMembers("GEOMETRY");

        expect(geography).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: "BufferWithCurves", returnType: "GEOGRAPHY" }),
                expect.objectContaining({ name: "EnvelopeCenter", returnType: "GEOGRAPHY" }),
                expect.objectContaining({ name: "STAsBinary", returnType: "VARBINARY(MAX)" }),
                expect.objectContaining({ name: "STCurveN", returnType: "GEOGRAPHY" }),
            ]),
        );
        expect(geometry).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: "STBoundary", returnType: "GEOMETRY" }),
                expect.objectContaining({ name: "STCentroid", returnType: "GEOMETRY" }),
                expect.objectContaining({ name: "STX", kind: "property", returnType: "FLOAT" }),
                expect.objectContaining({ name: "STRelate", returnType: "BIT" }),
            ]),
        );
    });

    test("resolves member names case-insensitively and normalizes parameterized types", () => {
        expect(resolveTypeMember("geography", "bufferwithcurves")).toEqual({
            name: "BufferWithCurves",
            kind: "method",
            returnType: "GEOGRAPHY",
        });
        expect(resolveTypeMember("xml(CONTENT dbo.Documents)", "EXIST")).toEqual({
            name: "exist",
            kind: "method",
            returnType: "BIT",
        });
        expect(resolveTypeMember("hierarchyid", "GetReparentedValue")).toEqual({
            name: "GetReparentedValue",
            kind: "method",
            returnType: "HIERARCHYID",
        });
    });

    test("returns defensive copies of the catalog", () => {
        const first = getBuiltinTypeMembersCatalog();
        first.GEOMETRY[0].name = "changed";

        expect(getBuiltinTypeMembersCatalog().GEOMETRY[0].name).not.toBe("changed");
    });
});
