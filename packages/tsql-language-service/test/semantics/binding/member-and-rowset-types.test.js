/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");
const {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    TsqlLanguageFeatureService,
} = require("../../../dist/index.js");

const uri = "file:///members.sql";

function metadata() {
    return new InMemoryMetadataProvider({
        environment: { currentDatabase: "db", defaultSchema: "dbo" },
        schemas: [{ database: "db", name: "dbo" }],
        databases: [{ name: "db" }],
        objects: [
            {
                ref: { id: "docs", database: "db" },
                database: "db",
                schema: "dbo",
                name: "Documents",
                kind: "table",
            },
            {
                ref: { id: "point", database: "db" },
                database: "db",
                schema: "dbo",
                name: "Point",
                kind: "type",
                typeCategory: "clr",
            },
            {
                ref: { id: "total", database: "db" },
                database: "db",
                schema: "dbo",
                name: "Total",
                kind: "scalarFunction",
            },
        ],
        columns: new Map([
            [
                "docs",
                [
                    { name: "Body", typeDisplay: "xml", nullable: true },
                    { name: "Amount", typeDisplay: "money", nullable: true },
                    { name: "Kind", typeDisplay: "nvarchar(10)", nullable: false },
                ],
            ],
        ]),
        // `sys.parameters` reports a scalar function's return value as ordinal zero, alongside its
        // real parameters. This is the shape a live provider publishes.
        parameters: new Map([
            [
                "total",
                [
                    { ordinal: 0, name: "", typeDisplay: "decimal(18,2)" },
                    { ordinal: 1, name: "@id", typeDisplay: "int", hasDefault: false },
                ],
            ],
        ]),
        clrTypes: new Map([
            [
                "point",
                {
                    className: "Point",
                    assemblyName: "Spatial",
                    system: true,
                    members: [
                        { name: "Latitude", kind: "property", typeDisplay: "float" },
                        { name: "Distance", kind: "method" },
                        { name: "Parse", kind: "method", static: true },
                    ],
                },
            ],
        ]),
    });
}

async function open(sql) {
    const provider = metadata();
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        provider,
    );
    const snapshot = await runtime.open(uri, 1, sql);
    return {
        snapshot,
        sql,
        features: new TsqlLanguageFeatureService(runtime, provider),
        typed: typesByText(snapshot, sql),
    };
}

function typesByText(snapshot, sql) {
    const result = new Map();
    for (const entry of snapshot.semantics.model.expressions) {
        result.set(sql.slice(entry.range.start, entry.range.end), entry.type);
    }
    return result;
}

suite("member expression types", () => {
    // The XML methods are defined by the language. `value` is the interesting one: it names its own
    // result type in its second argument, so the type is written in the source.
    test("types XML methods from the method and its written result type", async () => {
        const sql = [
            "DECLARE @body xml;",
            "SELECT @body.value('(/a)[1]', 'int'), @body.query('/a'), @body.exist('/a'),",
            "  d.Body.value('(/a)[1]', 'nvarchar(20)')",
            "FROM dbo.Documents AS d;",
        ].join("\n");
        const { typed } = await open(sql);

        assert.equal(typed.get("@body.value('(/a)[1]', 'int')").displayName, "int");
        assert.equal(typed.get("@body.query('/a')").displayName, "xml");
        assert.equal(typed.get("@body.exist('/a')").displayName, "bit");
        // A column receiver reaches the same conclusion as a variable receiver: `xml` is `xml`
        // however it was declared.
        assert.equal(
            typed.get("d.Body.value('(/a)[1]', 'nvarchar(20)')").displayName,
            "nvarchar(20)",
        );
    });

    // A CLR member's type is a metadata fact. A member the backend reports without one leaves the
    // expression untyped rather than guessed.
    test("types a CLR member from its reported type", async () => {
        const sql = "DECLARE @location dbo.Point;\nSELECT @location.Latitude, @location.Distance;";
        const { typed } = await open(sql);

        assert.equal(typed.get("@location.Latitude").displayName, "float");
        assert.equal(typed.get("@location.Distance"), undefined);
    });

    // A method on a receiver that is not XML is an ordinary call, not an XML method.
    test("does not treat a non-XML receiver as XML", async () => {
        const sql = "DECLARE @count int;\nSELECT dbo.Total(@count);";
        const { typed } = await open(sql);
        assert.equal(typed.get("dbo.Total(@count)").displayName, "decimal(18,2)");
    });

    // The return value a live provider reports as ordinal zero types the call and is not counted
    // as a parameter the caller has to supply.
    test("reads a scalar routine's return value without demanding it as an argument", async () => {
        const sql = "SELECT dbo.Total(1);";
        const { snapshot, typed } = await open(sql);

        assert.equal(typed.get("dbo.Total(1)").displayName, "decimal(18,2)");
        assert.deepEqual(snapshot.semantics.diagnostics, []);
    });
});

suite("rowset-producing operators", () => {
    // `nodes()` shreds an XML column into a rowset. It is written like a table-valued call but is a
    // method on a column, and every column it produces is XML.
    test("publishes an XML nodes() rowset as a relation", async () => {
        const sql = "SELECT * FROM dbo.Documents CROSS APPLY Body.nodes('/a') AS n(fragment);";
        const { snapshot } = await open(sql);
        const relation = snapshot.semantics.model.relationFor("n", sql.indexOf("nodes"));

        assert.ok(relation);
        assert.equal(relation.kind, "xmlNodes");
        assert.deepEqual(
            relation.columns.map(({ name, type }) => ({ name, type: type.displayName })),
            [{ name: "fragment", type: "xml" }],
        );
    });

    // PIVOT names its output columns in its IN list; those are the ones a query written against it
    // refers to.
    test("publishes a PIVOT output as a relation", async () => {
        const sql = "SELECT * FROM dbo.Documents PIVOT (SUM(Amount) FOR Kind IN ([a], [b])) AS p;";
        const { snapshot } = await open(sql);
        const relation = snapshot.semantics.model.relationFor("p", sql.indexOf("PIVOT"));

        assert.ok(relation);
        assert.equal(relation.kind, "pivot");
        assert.deepEqual(
            relation.columns.map(({ name }) => name),
            ["a", "b"],
        );
    });

    // UNPIVOT replaces the listed columns with the pair that holds each value and names where it
    // came from.
    test("publishes an UNPIVOT output as a relation", async () => {
        const sql = "SELECT * FROM dbo.Documents UNPIVOT (Value FOR Name IN (Amount, Kind)) AS u;";
        const { snapshot } = await open(sql);
        const relation = snapshot.semantics.model.relationFor("u", sql.indexOf("UNPIVOT"));

        assert.ok(relation);
        assert.equal(relation.kind, "unpivot");
        assert.deepEqual(
            relation.columns.map(({ name }) => name),
            ["Value", "Name"],
        );
    });
});

suite("member completion", () => {
    async function membersAt(sql, marker) {
        const { features } = await open(sql);
        const offset = sql.indexOf(marker) + marker.length;
        return features
            .completion(uri, 1, offset)
            .items.filter((item) => item.kind === "method" || item.kind === "property")
            .map((item) => item.label);
    }

    // The receiver's type comes from the model, so what completion offers is what hover describes.
    test("offers XML methods on an XML receiver", async () => {
        const members = await membersAt("DECLARE @body xml;\nSELECT @body.;", "@body.");
        assert.deepEqual(members.sort(), ["exist", "modify", "nodes", "query", "value"]);
    });

    // Instance members only: a static member is reached through the type, not through a value.
    test("offers a CLR type's instance members", async () => {
        const members = await membersAt(
            "DECLARE @location dbo.Point;\nSELECT @location.;",
            "@location.",
        );
        assert.deepEqual(members.sort(), ["Distance", "Latitude"]);
    });

    // A receiver with no members offers none, rather than falling back to something unrelated.
    test("offers nothing on a scalar receiver", async () => {
        assert.deepEqual(await membersAt("DECLARE @count int;\nSELECT @count.;", "@count."), []);
    });
});
