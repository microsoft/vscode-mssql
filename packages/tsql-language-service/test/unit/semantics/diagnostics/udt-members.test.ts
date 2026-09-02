/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import * as api from "../../../../src/index.ts";
import type {
    ClrTypeMetadata,
    InMemoryMetadataInput,
    MetadataLoadState,
    MetadataSectionState,
    ObjectMetadata,
    SemanticDiagnostic,
    SemanticSnapshot,
} from "../../../../src/index.ts";
// Member access is decided entirely by the receiver. A CLR user type is checked against its own
// member list, where methods and data members are separate namespaces and only a system type's list
// is complete enough to prove a member is absent. An XML value exposes a fixed method set and no
// properties. Any other known scalar type carries no members at all, and an undeterminable receiver
// produces nothing.
const {
    CatalogSemanticBinder,
    ImmutableTextSnapshot,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
} = api;

const type = (
    id: string,
    schema: string,
    name: string,
    typeCategory: NonNullable<ObjectMetadata["typeCategory"]>,
): ObjectMetadata => ({
    ref: { id, database: "db" },
    database: "db",
    schema,
    name,
    kind: "type",
    typeCategory,
});

const catalog = {
    environment: { currentDatabase: "db", defaultSchema: "dbo" },
    schemas: [
        { database: "db", name: "dbo" },
        { database: "db", name: "sys" },
    ],
    databases: [{ name: "db" }],
    completeness: { clrTypes: "ready" },
    objects: [
        type("point", "dbo", "Point", "clr"),
        type("geometry", "sys", "geometry", "clr"),
        type("code", "dbo", "Code", "alias"),
    ],
    clrTypes: new Map([
        [
            "point",
            {
                className: "Point",
                assemblyName: "GeoAssembly",
                system: false,
                members: [
                    { name: "X", kind: "property" },
                    { name: "Label", kind: "field" },
                    { name: "Origin", kind: "property", static: true },
                    { name: "Distance", kind: "method" },
                    { name: "Parse", kind: "method", static: true },
                ],
            },
        ],
        [
            "geometry",
            {
                className: "SqlGeometry",
                assemblyName: "Microsoft.SqlServer.Types",
                system: true,
                members: [
                    { name: "STArea", kind: "method" },
                    { name: "STSrid", kind: "property" },
                    { name: "Parse", kind: "method", static: true },
                ],
            },
        ],
    ]),
} satisfies InMemoryMetadataInput;

interface AnalyzePatch extends InMemoryMetadataInput {
    readonly allowSyntaxDiagnostics?: boolean;
}

async function analyze(sql: string, patch: AnalyzePatch = {}) {
    const { allowSyntaxDiagnostics = false, ...metadataPatch } = patch;
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        new InMemoryMetadataProvider({ ...catalog, ...metadataPatch }),
    );
    const snapshot = await runtime.open("file:///udt-members.sql", 1, sql);
    if (!allowSyntaxDiagnostics) assert.deepEqual(snapshot.syntax.diagnostics, []);
    return snapshot.semantics.diagnostics.map(({ code, message, severity, range }) => ({
        code,
        message,
        severity,
        text: sql.slice(range.start, range.end),
    }));
}

const codes = (diagnostics: readonly Pick<SemanticDiagnostic, "code">[]): string[] =>
    diagnostics.map(({ code }) => code);
const declarePoint = "DECLARE @p dbo.Point;";
const declareGeometry = "DECLARE @g sys.geometry;";
type UnloadedClrTypeState = Exclude<
    MetadataLoadState<ClrTypeMetadata>,
    { readonly kind: "loaded" }
>;

suite("T-SQL UDT instance member validation", () => {
    // Exact output when an instance access resolves to a static data member.
    test("reports a static data member reached through an instance", async () => {
        assert.deepEqual(await analyze(`${declarePoint} SELECT @p.Origin;`), [
            {
                code: "UdtPropertyIsStatic",
                message:
                    "Property or field 'Origin' for type 'Point' in assembly 'GeoAssembly' is static.",
                severity: "error",
                text: "Origin",
            },
        ]);
    });

    // Exact output when an instance call resolves to a static method.
    test("reports a static method reached through an instance", async () => {
        assert.deepEqual(await analyze(`${declarePoint} SELECT @p.Parse(1);`), [
            {
                code: "UdtMemberIsStatic",
                message:
                    "Method, property or field 'Parse' of class 'Point' in assembly 'GeoAssembly' is static.",
                severity: "error",
                text: "Parse",
            },
        ]);
    });

    // Instance members and methods of the same type stay silent, including a field.
    test("accepts every instance member", async () => {
        for (const sql of [
            `${declarePoint} SELECT @p.X;`,
            `${declarePoint} SELECT @p.Label;`,
            `${declarePoint} SELECT @p.Distance(1);`,
            `${declareGeometry} SELECT @g.STArea();`,
            `${declareGeometry} SELECT @g.STSrid;`,
        ]) {
            assert.deepEqual(await analyze(sql), [], sql);
        }
    });

    // Methods and data members are separate namespaces, so the shape decides which list is searched.
    test("keeps methods and data members in separate namespaces", async () => {
        assert.deepEqual(codes(await analyze(`${declareGeometry} SELECT @g.STArea;`)), [
            "CouldNotFindPropertyOrField",
        ]);
        assert.deepEqual(codes(await analyze(`${declareGeometry} SELECT @g.STSrid();`)), [
            "CouldNotFindMethod",
        ]);
    });
});

suite("T-SQL UDT static member validation", () => {
    // Exact output when a static access resolves to an instance data member.
    test("reports an instance data member reached through the type", async () => {
        assert.deepEqual(await analyze("SELECT dbo.Point::X;"), [
            {
                code: "UdtPropertyIsNotStatic",
                message:
                    "Property or field 'X' for type 'Point' in assembly 'GeoAssembly' is not static",
                severity: "error",
                text: "X",
            },
        ]);
    });

    // Exact output when a static call resolves to an instance method.
    test("reports an instance method reached through the type", async () => {
        assert.deepEqual(await analyze("SELECT dbo.Point::Distance(1);"), [
            {
                code: "UdtMemberIsNotStatic",
                message:
                    "Method, property or field 'Distance' of class 'Point' in assembly 'GeoAssembly' is not static.",
                severity: "error",
                text: "Distance",
            },
        ]);
    });

    // Static members reached through the type stay silent, including an empty argument list.
    test("accepts every static member", async () => {
        for (const sql of [
            "SELECT dbo.Point::Origin;",
            "SELECT dbo.Point::Parse(1);",
            "SELECT sys.geometry::Parse('POINT(0 0)');",
        ]) {
            assert.deepEqual(await analyze(sql), [], sql);
        }
    });

    // Quoted type and member names resolve to the same catalog entries.
    test("handles quoted names", async () => {
        assert.deepEqual(codes(await analyze("SELECT [dbo].[Point]::[X];")), [
            "UdtPropertyIsNotStatic",
        ]);
        assert.deepEqual(await analyze("SELECT [dbo].[Point]::[Origin];"), []);
    });
});

suite("T-SQL UDT member resolution", () => {
    // Only a system type's member list is complete enough to prove a member is absent.
    test("reports an unresolved member only for a system type", async () => {
        assert.deepEqual(await analyze(`${declareGeometry} SELECT @g.Missing;`), [
            {
                code: "CouldNotFindPropertyOrField",
                message:
                    "Could not find property or field 'Missing' for type 'SqlGeometry' in assembly 'Microsoft.SqlServer.Types'.",
                severity: "error",
                text: "Missing",
            },
        ]);
        assert.deepEqual(await analyze(`${declareGeometry} SELECT @g.Missing(1);`), [
            {
                code: "CouldNotFindMethod",
                message:
                    "Could not find method 'Missing' for type 'SqlGeometry' in assembly 'Microsoft.SqlServer.Types'.",
                severity: "error",
                text: "Missing",
            },
        ]);
        // A user type's member list may be incomplete, so absence proves nothing.
        assert.deepEqual(await analyze(`${declarePoint} SELECT @p.Missing;`), []);
        assert.deepEqual(await analyze(`${declarePoint} SELECT @p.Missing(1);`), []);
    });

    // A known type that is not a CLR type carries no members at all.
    test("reports member access on a type that has none", async () => {
        assert.deepEqual(await analyze("DECLARE @i int; SELECT @i.X;"), [
            {
                code: "CannotCallMethodsOnType",
                message: "Cannot call methods on int.",
                severity: "error",
                text: "@i",
            },
        ]);
        // Through the type, the engine names only the object part of the type name.
        assert.deepEqual(await analyze("SELECT dbo.Code::X;"), [
            {
                code: "CannotCallMethodsOnType",
                message: "Cannot call methods on Code.",
                severity: "error",
                text: "dbo.Code",
            },
        ]);
    });

    // A receiver whose type cannot be determined must not produce a member result.
    test("stays silent when the receiver type is unknown", async () => {
        for (const sql of [
            // The variable is never declared.
            "SELECT @undeclared.X;",
            // The declared type does not resolve in the catalog.
            "DECLARE @u dbo.Missing; SELECT @u.X;",
        ]) {
            assert.deepEqual(
                codes(await analyze(sql)).filter((code) => udtCodes.has(code)),
                [],
                sql,
            );
        }
        // A CLR type whose member list is not loaded proves nothing either, whether that is an
        // explicit per-type state or a section that has not published this type at all.
        const loadStates: readonly UnloadedClrTypeState["kind"][] = [
            "loading",
            "notLoaded",
            "failed",
        ];
        for (const kind of loadStates) {
            assert.deepEqual(
                await analyze(`${declarePoint} SELECT @p.Origin;`, {
                    clrTypeStates: new Map([["point", { kind }]]),
                }),
                [],
                kind,
            );
        }
        const sectionStates: readonly MetadataSectionState[] = [
            "loading",
            "unknown",
            "failed",
            "partial",
            "stale",
        ];
        for (const state of sectionStates) {
            assert.deepEqual(
                await analyze(`${declarePoint} SELECT @p.Origin;`, {
                    clrTypes: new Map(),
                    completeness: { clrTypes: state },
                }),
                [],
                state,
            );
        }
    });

    // A member's own type is not modelled, so a chained access checks only the first member.
    test("checks only the first member of a chain", async () => {
        assert.deepEqual(codes(await analyze(`${declarePoint} SELECT @p.Origin.X;`)), [
            "UdtPropertyIsStatic",
        ]);
        assert.deepEqual(await analyze("SELECT dbo.Point::Origin.Anything;"), []);
    });

    // Damaged input and unrelated expressions never produce a member result.
    test("does not report unrelated expressions", async () => {
        for (const sql of ["SELECT a.b FROM dbo.Missing AS a;", "SELECT dbo.Fn(1);", "SELECT 1;"]) {
            assert.deepEqual(
                codes(await analyze(sql, { allowSyntaxDiagnostics: true })).filter((code) =>
                    udtCodes.has(code),
                ),
                [],
                sql,
            );
        }
        for (const sql of [
            "SELECT @p.",
            "SELECT dbo.Point::",
            "DECLARE @p dbo.Point; SELECT @p.",
        ]) {
            assert.deepEqual(
                codes(await analyze(sql, { allowSyntaxDiagnostics: true })).filter((code) =>
                    udtCodes.has(code),
                ),
                [],
                sql,
            );
        }
    });
});

suite("T-SQL XML member validation", () => {
    // Exact output when an XML method is named without its argument list.
    test("reports an XML method invoked without arguments", async () => {
        assert.deepEqual(await analyze("DECLARE @x xml; SELECT @x.query;"), [
            {
                code: "IncorrectSyntaxToInvokeXmlMethod",
                message: "Incorrect syntax was used to invoke the XML data type method 'query'.",
                severity: "error",
                text: "@x.query",
            },
        ]);
    });

    // Exact output for a member the XML data type does not expose, in either shape.
    test("reports an unknown XML member with exact output", async () => {
        assert.deepEqual(await analyze("DECLARE @x xml; SELECT @x.Bogus;"), [
            {
                code: "NotValidFunctionOrProperty",
                message: '"Bogus" is not a valid function, property, or field.',
                severity: "error",
                text: "Bogus",
            },
        ]);
        assert.deepEqual(codes(await analyze("DECLARE @x xml; SELECT @x.Bogus(1);")), [
            "NotValidFunctionOrProperty",
        ]);
    });

    // Every XML method invoked with an argument list is valid.
    test("accepts every XML data type method", async () => {
        for (const method of ["query", "value", "exist", "modify", "nodes"]) {
            assert.deepEqual(
                await analyze(`DECLARE @x xml; SELECT @x.${method}('.');`),
                [],
                method,
            );
        }
    });
});

suite("T-SQL UDT member incremental equivalence", () => {
    // Incremental analysis of the same final text and generation must equal a fresh analysis.
    test("matches a fresh analysis after an edit", async () => {
        const service = new LezerSyntaxService();
        const binder = new CatalogSemanticBinder();
        const provider = new InMemoryMetadataProvider(catalog);
        const uri = "file:///udt-incremental.sql";
        const first = `SELECT 1;\nGO\n${declarePoint} SELECT @p.X;\n`;
        const final = `SELECT 1;\nGO\n${declarePoint} SELECT @p.Origin;\n`;
        const initialSyntax = service.parse(new ImmutableTextSnapshot(uri, 1, first));
        const initial = binder.bind({ syntax: initialSyntax, metadata: provider.pin() });
        assert.deepEqual(initial.diagnostics, []);
        const change = {
            start: first.indexOf("@p.X") + "@p.".length,
            end: first.indexOf("@p.X") + "@p.X".length,
            text: "Origin",
        };
        const updatedSyntax = service.update(
            initialSyntax,
            new ImmutableTextSnapshot(uri, 2, final),
            [change],
        );
        const updated = binder.update(initial, {
            syntax: updatedSyntax,
            metadata: provider.pin(),
            previous: initial,
            changedRanges: updatedSyntax.changedRanges,
        });
        const fresh = binder.bind({
            syntax: service.parse(new ImmutableTextSnapshot(uri, 2, final)),
            metadata: provider.pin(),
        });
        const normalize = (snapshot: SemanticSnapshot): string[] =>
            snapshot.diagnostics
                .map(({ code, message, range }) => `${code}:${range.start}:${range.end}:${message}`)
                .sort();
        assert.deepEqual(normalize(updated), normalize(fresh));
        assert.equal(normalize(fresh).length, 1);
    });
});

/** Every family this suite owns, used where an unrelated validation also fires. */
const udtCodes = new Set([
    "CannotCallMethodsOnType",
    "CouldNotFindMethod",
    "CouldNotFindPropertyOrField",
    "IncorrectSyntaxToInvokeXmlMethod",
    "NotValidFunctionOrProperty",
    "UdtMemberIsNotStatic",
    "UdtMemberIsStatic",
    "UdtPropertyIsNotStatic",
    "UdtPropertyIsStatic",
]);
