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
    catalogKey,
    formatMultipartName,
    identifierRole,
    parseMultipartName,
    quoteIdentifierIfNeeded,
    tsqlIdentifierPattern,
    unknownEngineCapabilities,
} = require("../../../dist/index.js");

function provider() {
    return new InMemoryMetadataProvider({
        environment: { currentDatabase: "db", defaultSchema: "dbo" },
        schemas: [{ database: "db", name: "dbo" }],
        databases: [{ name: "db" }],
        objects: [
            {
                ref: { id: "customers", database: "db" },
                database: "db",
                schema: "dbo",
                name: "Customers",
                kind: "table",
            },
            {
                ref: { id: "rows-function", database: "db" },
                database: "db",
                schema: "dbo",
                name: "SplitRows",
                kind: "tableFunction",
            },
            {
                ref: { id: "total-function", database: "db" },
                database: "db",
                schema: "dbo",
                name: "Total",
                kind: "scalarFunction",
                returnType: "decimal(18,2)",
            },
        ],
        columns: new Map([
            [
                "customers",
                [
                    { name: "Id", typeDisplay: "int", nullable: false },
                    { name: "Name", typeDisplay: "nvarchar(100)", nullable: true },
                ],
            ],
            ["rows-function", [{ name: "Value", typeDisplay: "nvarchar(max)" }]],
        ]),
        parameters: new Map([
            ["rows-function", [{ ordinal: 1, name: "@csv", typeDisplay: "nvarchar(max)" }]],
            ["total-function", []],
        ]),
    });
}

async function open(sql, metadata = provider(), capabilities) {
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(undefined, capabilities),
        new CatalogSemanticBinder(),
        metadata,
    );
    const snapshot = await runtime.open("file:///model.sql", 1, sql);
    return {
        snapshot,
        runtime,
        metadata,
        features: new TsqlLanguageFeatureService(runtime, metadata),
    };
}

/** Types keyed by the exact source text of the expression they were bound to. */
function typesByText(snapshot, sql) {
    const result = new Map();
    for (const entry of snapshot.semantics.model.expressions) {
        result.set(sql.slice(entry.range.start, entry.range.end), entry.type);
    }
    return result;
}

function providerWithAmount() {
    const metadata = provider();
    return new InMemoryMetadataProvider({
        environment: { currentDatabase: "db", defaultSchema: "dbo" },
        schemas: [{ database: "db", name: "dbo" }],
        databases: [{ name: "db" }],
        objects: [
            {
                ref: { id: "customers", database: "db" },
                database: "db",
                schema: "dbo",
                name: "Customers",
                kind: "table",
            },
        ],
        columns: new Map([
            [
                "customers",
                [
                    { name: "Id", typeDisplay: "int", nullable: false },
                    { name: "Amount", typeDisplay: "money", nullable: true },
                ],
            ],
        ]),
        ...(metadata ? {} : {}),
    });
}

suite("shared semantic model", () => {
    // The first vertical slice from the centralization plan: one alias, read the same way by
    // every projection that needs it.
    test("publishes one relation for an aliased table source", async () => {
        const sql = "SELECT t.Id FROM dbo.Customers AS t;";
        const { snapshot } = await open(sql);
        const model = snapshot.semantics.model;

        const relation = model.relationFor("t", sql.indexOf("t.Id"));
        assert.ok(relation, "the alias is visible where it is used");
        assert.equal(relation.exposedName, "t");
        assert.equal(relation.kind, "table");
        assert.equal(relation.name.object, "Customers");
        assert.equal(relation.name.schema, "dbo");
        assert.equal(relation.name.database, "db");
        assert.equal(relation.name.resolution.kind, "catalog");
        assert.deepEqual(
            relation.columns.map(({ name }) => name),
            ["Id", "Name"],
        );

        // The scope the caret is in is the scope the relation belongs to.
        const scope = model.scopeAt(sql.indexOf("t.Id"));
        assert.ok(scope);
        assert.equal(relation.scopeId, scope.id);
    });

    // A CTE, a derived table, and a table variable are relations in the same list, so a feature
    // never has to know which syntax produced one.
    test("publishes CTE, derived, and variable relations in one scope list", async () => {
        const sql = [
            "DECLARE @rows TABLE (Id int);",
            "WITH Numbered AS (SELECT Id FROM dbo.Customers)",
            "SELECT * FROM Numbered n CROSS JOIN (SELECT 1 AS one) d CROSS JOIN @rows v;",
        ].join("\n");
        const { snapshot } = await open(sql);
        const model = snapshot.semantics.model;
        const offset = sql.indexOf("Numbered n") + 1;

        const visible = model.visibleRelations(offset).map(({ exposedName, kind }) => ({
            exposedName,
            kind,
        }));
        assert.deepEqual(
            [...visible].sort((left, right) => left.exposedName.localeCompare(right.exposedName)),
            [
                { exposedName: "d", kind: "derived" },
                { exposedName: "n", kind: "cte" },
                { exposedName: "Numbered", kind: "cte" },
                { exposedName: "v", kind: "variable" },
            ].sort((left, right) => left.exposedName.localeCompare(right.exposedName)),
        );
    });

    // A relation whose columns have not arrived is "unknown", never an empty list: the two answers
    // mean different things and only one of them may suppress a completion.
    test("keeps an unhydrated relation shape distinct from an empty one", async () => {
        const metadata = new InMemoryMetadataProvider({
            environment: { currentDatabase: "db", defaultSchema: "dbo" },
            objects: [
                {
                    ref: { id: "pending", database: "db" },
                    database: "db",
                    schema: "dbo",
                    name: "Pending",
                    kind: "table",
                },
            ],
            columnStates: new Map([["pending", { kind: "loading" }]]),
        });
        const { snapshot } = await open("SELECT * FROM dbo.Pending;", metadata);
        const [relation] = snapshot.semantics.model.relations;
        assert.equal(relation.columns, "unknown");
    });

    // Every callable shape reduces to one ResolvedCall, which is what stops signature help and
    // arity validation from describing the same call differently.
    test("publishes one call model for scalar, table-valued, conversion, and operator calls", async () => {
        const sql = [
            "SELECT TOP (1) CAST(Id AS bigint), LEFT(Name, 2)",
            "FROM dbo.SplitRows(N'a,b');",
        ].join("\n");
        const { snapshot } = await open(sql);
        const calls = snapshot.semantics.model.calls;

        const byName = new Map(
            calls.map((call) => [
                call.target.kind === "catalog" ? call.name.object : call.target.name,
                call,
            ]),
        );

        assert.equal(byName.get("TOP").target.kind, "operator");
        assert.equal(byName.get("TOP").shape, "keywordSeparated");
        assert.equal(byName.get("CAST").target.kind, "builtin");
        assert.equal(byName.get("CAST").shape, "keywordSeparated");
        assert.equal(byName.get("LEFT").shape, "parenthesized");

        const tableCall = byName.get("SplitRows");
        assert.ok(tableCall, "a table-valued source is a call");
        assert.equal(tableCall.rowset, true);
        assert.equal(tableCall.arguments.length, 1, "the argument list is counted, not skipped");
        assert.equal(tableCall.parameters.length, 1);
    });

    // The confirmed cross-feature mismatch: the same table-valued call must expose the same
    // arguments to diagnostics and to signature help.
    test("agrees between diagnostics and signature help for a table-valued call", async () => {
        const sql = "SELECT * FROM dbo.SplitRows(N'a');";
        const { snapshot, features } = await open(sql);
        const offset = sql.indexOf("N'a'");

        assert.deepEqual(snapshot.semantics.diagnostics, []);
        const call = snapshot.semantics.model.callAt(offset);
        assert.equal(call.arguments.length, 1);

        const help = features.signatureHelp("file:///model.sql", 1, offset);
        assert.ok(help, "signature help answers for the same call");
        assert.equal(help.signatures[0].parameters.length, call.parameters.length);
    });

    // FEATURE-ROLE-012: CAST is a keyword in source and a conversion routine in meaning. One
    // resolved call records both, so coloring and signature help stop disagreeing about it.
    test("records one conversion role for CAST", async () => {
        const sql = "SELECT CAST(1 AS int);";
        const { snapshot, features } = await open(sql);
        const call = snapshot.semantics.model.callAt(sql.indexOf("CAST"));

        assert.equal(call.target.kind, "builtin");
        assert.equal(call.target.name, "CAST");
        assert.deepEqual(call.keywordRange, {
            start: sql.indexOf("CAST"),
            end: sql.indexOf("CAST") + 4,
        });

        const help = features.signatureHelp("file:///model.sql", 1, sql.indexOf("1 AS"));
        assert.match(help.signatures[0].label, /^CAST\(/u);
    });

    // Same-document DDL is one ordered timeline, so "before" and "after" are answered once.
    test("resolves a document-local object through the timeline", async () => {
        const sql = [
            "SELECT * FROM dbo.Staging;",
            "GO",
            "CREATE TABLE dbo.Staging (Id int NOT NULL);",
            "GO",
            "SELECT * FROM dbo.Staging;",
            "GO",
            "DROP TABLE dbo.Staging;",
            "GO",
            "SELECT * FROM dbo.Staging;",
        ].join("\n");
        const { snapshot } = await open(sql);
        const timeline = snapshot.semantics.model.timeline;
        const parts = ["dbo", "Staging"];

        assert.equal(timeline.resolve(parts, sql.indexOf("dbo.Staging")), undefined);
        assert.equal(timeline.resolve(parts, sql.lastIndexOf("dbo.Staging")).exists, false);
        const afterCreate = timeline.resolve(parts, sql.indexOf("DROP TABLE") - 1);
        assert.equal(afterCreate.exists, true);
        assert.equal(afterCreate.kind, "table");
    });

    // Availability is decided once. With no reported engine the answer is "deferred", which is a
    // decision, not a missing one: nothing is declared unavailable while the engine is unknown.
    test("defers availability decisions while the engine is unidentified", async () => {
        const { snapshot } = await open(
            "BACKUP DATABASE db TO DISK = 'd.bak';",
            provider(),
            unknownEngineCapabilities,
        );
        const decisions = snapshot.semantics.model.availability;
        assert.ok(decisions.length > 0, "the construct is gated by the registry");
        for (const decision of decisions) assert.equal(decision.status, "deferred");
        assert.deepEqual(snapshot.syntax.diagnostics, []);
    });

    // Types are inferred once and read from the snapshot. A feature that infers its own is how
    // hover, member completion, and argument validation came to disagree about the same value.
    test("binds literal, variable, column, conversion, and call types", async () => {
        const sql = [
            "DECLARE @count int, @document xml;",
            "SELECT 1, N'a', CAST(1 AS bigint), TRY_CAST(1 AS date), @count, @document, c.Id, c.Name",
            "FROM dbo.Customers AS c;",
        ].join("\n");
        const { snapshot } = await open(sql);
        const model = snapshot.semantics.model;
        const typeAt = (text) => model.typeAt(sql.indexOf(text));

        assert.equal(typeAt("1,").displayName, "int");
        assert.equal(typeAt("N'a'").displayName, "nvarchar");
        assert.equal(typeAt("CAST(1 AS bigint)").displayName, "bigint");

        // A TRY_ conversion returns NULL when it fails, so its result is nullable whatever the
        // target type says.
        const tryCast = typeAt("TRY_CAST");
        assert.equal(tryCast.displayName, "date");
        assert.equal(tryCast.nullable, true);

        assert.equal(typeAt("@count,").displayName, "int");
        assert.equal(typeAt("@document,").category, "xml");
        assert.equal(typeAt("c.Id").displayName, "int");
        assert.equal(typeAt("c.Id").nullable, false);
        assert.equal(typeAt("c.Name").displayName, "nvarchar(100)");
        assert.equal(typeAt("c.Name").nullable, true);
    });

    // "Unknown" is a real answer and must stay distinguishable from a wrong one, because a caller
    // may not turn it into a diagnostic.
    test("reports no type rather than a guessed one", async () => {
        const sql = "SELECT Mystery FROM dbo.Unmapped;";
        const { snapshot } = await open(sql);
        assert.equal(snapshot.semantics.model.typeAt(sql.indexOf("Mystery")), undefined);
    });

    // A column's bound type names the relation it came from, which is what lets a member or
    // rename operation act on the right source rather than on a name that merely matches.
    test("attributes a column type to the relation that exposed it", async () => {
        const sql = "SELECT c.Name FROM dbo.Customers AS c;";
        const { snapshot } = await open(sql);
        const model = snapshot.semantics.model;
        const type = model.typeAt(sql.indexOf("c.Name"));
        assert.equal(type.sourceRelation, model.relationFor("c", sql.indexOf("c.Name")).id);
    });
    // Composite forms are typed from their parts. The engine converts operands to the higher
    // precedence type, so the result names that type rather than the first operand's.
    test("types operators by data type precedence", async () => {
        const sql =
            "SELECT 1 + 2, 1 + 1.5, c.Id + c.Amount, 'a' + 'b', N'a' + 'b' FROM dbo.Customers AS c;";
        const { snapshot } = await open(sql, providerWithAmount());
        const typed = typesByText(snapshot, sql);

        assert.equal(typed.get("1 + 2").displayName, "int");
        assert.equal(typed.get("1 + 1.5").displayName, "numeric");
        assert.equal(typed.get("c.Id + c.Amount").displayName, "money");
        assert.equal(typed.get("c.Id + c.Amount").nullable, true);
        assert.equal(typed.get("'a' + 'b'").displayName, "varchar");
        assert.equal(typed.get("N'a' + 'b'").displayName, "nvarchar");
    });

    // T-SQL has no Boolean value, so a comparison has no type to name. Inventing one would let a
    // caller compare against a type the language does not have.
    test("leaves comparisons untyped", async () => {
        const sql = "SELECT 1 = 1, 1 < 2;";
        const { snapshot } = await open(sql);
        const typed = typesByText(snapshot, sql);
        assert.equal(typed.get("1 = 1"), undefined);
        assert.equal(typed.get("1 < 2"), undefined);
    });

    // A CASE is typed from its branches, and a missing ELSE makes the result nullable however
    // certain the branches are.
    test("types CASE from its result branches", async () => {
        const sql = "SELECT CASE WHEN 1 = 1 THEN 1 ELSE 2 END, CASE WHEN 1 = 1 THEN 1 END;";
        const { snapshot } = await open(sql);
        const typed = typesByText(snapshot, sql);

        assert.equal(typed.get("CASE WHEN 1 = 1 THEN 1 ELSE 2 END").displayName, "int");
        assert.equal(typed.get("CASE WHEN 1 = 1 THEN 1 ELSE 2 END").nullable, false);
        assert.equal(typed.get("CASE WHEN 1 = 1 THEN 1 END").nullable, true);
    });

    // A scalar subquery is the type of its one projected column, and always nullable because a
    // subquery that matches no row yields NULL.
    test("types a scalar subquery through its projected column", async () => {
        const sql = "SELECT (SELECT 1);";
        const { snapshot } = await open(sql);
        const type = typesByText(snapshot, sql).get("(SELECT 1)");
        assert.equal(type.displayName, "int");
        assert.equal(type.nullable, true);
    });

    // A catalog scalar function's result type is a metadata fact. A provider that reports one is
    // believed; one that does not leaves the call untyped rather than guessed.
    test("types a catalog scalar call from reported metadata", async () => {
        const sql = "SELECT dbo.Total();";
        const { snapshot } = await open(sql);
        assert.equal(typesByText(snapshot, sql).get("dbo.Total()").displayName, "decimal(18,2)");
    });

    // The binder and the model agree on what a query boundary is, because there is one definition:
    // the scope the binder bound a reference in is the scope the model publishes.
    test("binds references in the scopes the model publishes", async () => {
        const sql = [
            "SELECT o.Id",
            "FROM dbo.Customers AS o",
            "WHERE EXISTS (SELECT 1 FROM dbo.Customers AS i WHERE i.Id = o.Id);",
        ].join("\n");
        const { snapshot } = await open(sql);
        const model = snapshot.semantics.model;

        const innerOffset = sql.indexOf("i.Id");
        const inner = model.scopeAt(innerOffset);
        assert.ok(inner, "the subquery is its own scope");
        assert.ok(model.relationFor("i", innerOffset), "its own source is visible");
        // The outer alias is visible from inside, which is what makes the correlation resolve.
        assert.ok(model.relationFor("o", innerOffset), "the outer source correlates in");
        assert.notEqual(inner.id, model.scopeAt(sql.indexOf("o.Id")).id);
    });

    // Local DDL is resolved through the published timeline by diagnostics as well as by features,
    // so a table dropped earlier in the document is gone for both.
    test("resolves local DDL identically for diagnostics and features", async () => {
        const sql = [
            "CREATE TABLE dbo.Staging (Id int NOT NULL);",
            "GO",
            "SELECT * FROM dbo.Staging;",
            "GO",
            "DROP TABLE dbo.Staging;",
            "GO",
            "SELECT * FROM dbo.Staging;",
        ].join("\n");
        const { snapshot } = await open(sql);

        assert.deepEqual(
            snapshot.semantics.diagnostics.map(({ code }) => code),
            ["MSSQL208"],
            "only the read after the DROP is invalid",
        );
        const timeline = snapshot.semantics.model.timeline;
        assert.equal(timeline.resolve(["dbo", "Staging"], sql.indexOf("DROP") - 1).exists, true);
        assert.equal(timeline.resolve(["dbo", "Staging"], sql.length).exists, false);
    });

    // Procedures, relations, and user-defined types occupy namespaces one name can hold
    // independently, so the shared timeline has to be asked about one of them at a time.
    test("keeps object namespaces apart in the shared timeline", async () => {
        const sql = [
            "CREATE TABLE dbo.Shared (Id int NOT NULL);",
            "GO",
            "CREATE PROCEDURE dbo.Shared AS SELECT 1;",
            "GO",
            "SELECT * FROM dbo.Shared;",
        ].join("\n");
        const { snapshot } = await open(sql);
        const timeline = snapshot.semantics.model.timeline;
        const end = sql.length;

        assert.equal(timeline.resolve(["dbo", "Shared"], end, ["table"]).kind, "table");
        assert.equal(timeline.resolve(["dbo", "Shared"], end, ["procedure"]).kind, "procedure");
        assert.deepEqual(
            snapshot.semantics.diagnostics.filter(({ code }) => code === "MSSQL208"),
            [],
            "the table is still a table after a procedure takes the same name",
        );
    });
});
suite("identifier handling", () => {
    // One module owns splitting, normalization, and insertion, so the name completion writes is
    // the name binding looks up.
    test("round-trips bracketed, quoted, and omitted-part names", () => {
        const bracketed = parseMultipartName("[my db].[dbo].[Order Details]");
        assert.deepEqual(
            bracketed.parts.map(({ normalized, quoted }) => ({ normalized, quoted })),
            [
                { normalized: "my db", quoted: true },
                { normalized: "dbo", quoted: true },
                { normalized: "Order Details", quoted: true },
            ],
        );
        assert.equal(bracketed.hasOmittedParts, false);

        const quoted = parseMultipartName('"a""b".t');
        assert.equal(quoted.parts[0].normalized, 'a"b');

        const omitted = parseMultipartName("db..t");
        assert.equal(omitted.hasOmittedParts, true);
        assert.deepEqual(
            omitted.parts.map(({ normalized }) => normalized),
            ["db", "t"],
        );

        assert.equal(formatMultipartName(["dbo", "Order Details"]), "dbo.[Order Details]");
        assert.equal(quoteIdentifierIfNeeded("plain"), "plain");
        assert.equal(quoteIdentifierIfNeeded("has space"), "[has space]");
        assert.equal(quoteIdentifierIfNeeded("select"), "[select]");
        assert.deepEqual(
            parseMultipartName("dbo.Users;").parts.map(({ normalized }) => normalized),
            ["dbo", "Users"],
        );
        assert.equal(catalogKey(["DBO", "t"]), "DBO.T");
        const component = new RegExp(`^${tsqlIdentifierPattern.component}$`, "u");
        assert.equal(component.test("[Order]]Items]"), true);
        assert.equal(component.test('"Order""Items"'), true);
        assert.equal(component.test("金額$"), true);
        assert.equal(component.test("Order-Items"), false);
        assert.equal(
            new RegExp(`^${tsqlIdentifierPattern.namedVariable}$`, "u").test("@välue"),
            true,
        );
        assert.equal(identifierRole("dbo"), "regular");
        assert.equal(identifierRole("[#permanent-looking]"), "regular");
        assert.equal(identifierRole("#temporary"), "temporaryObject");
        assert.equal(identifierRole("@local"), "localVariable");
        assert.equal(identifierRole("@@global"), "globalVariable");
    });

    // Part ranges are absolute when the caller supplies the name's own start, so a diagnostic can
    // point at one component without recomputing where it began.
    test("reports absolute part ranges", () => {
        const name = parseMultipartName("a.bb.ccc", 10);
        assert.deepEqual(
            name.parts.map(({ range }) => range),
            [
                { start: 10, end: 11 },
                { start: 12, end: 14 },
                { start: 15, end: 18 },
            ],
        );
    });
});
