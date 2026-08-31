/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * B12 / LS-4 scripting engine suite (design 05 §13, §17.6): golden module
 * CREATE→ALTER / CREATE OR ALTER token-level rewrites (comments, whitespace,
 * bracketed names, lowercase heads, stored-ALTER definitions, capability
 * gating), CreateTable F1/F2 goldens over the standard fixture catalog,
 * DML template goldens, anchor exactness, and the encrypted/permission/
 * not-loaded honesty ladder (never a fabricated body).
 */

import { expect } from "chai";
import {
    FixtureCatalogSpec,
    FixtureLanguageMetadataProvider,
} from "../../src/sqlLanguage/provider/fixtureProvider";
import { IPinnedMetadataView } from "../../src/sqlLanguage/provider/types";
import { STANDARD_FIXTURE_CATALOG } from "../../src/sqlLanguage/testSupport/fixtureCatalog";
import {
    ScriptMetadataProvenance,
    ScriptOperation,
    ScriptResult,
} from "../../src/sqlScripting/api";
import { SqlScriptingEngine } from "../../src/sqlScripting/scriptingService";

function pinOf(spec: FixtureCatalogSpec = STANDARD_FIXTURE_CATALOG): IPinnedMetadataView {
    return new FixtureLanguageMetadataProvider(spec).pin();
}

function engineOf(spec: FixtureCatalogSpec = STANDARD_FIXTURE_CATALOG): {
    engine: SqlScriptingEngine;
    pinned: IPinnedMetadataView;
} {
    const pinned = pinOf(spec);
    return { engine: new SqlScriptingEngine(pinned), pinned };
}

function refOf(pinned: IPinnedMetadataView, schema: string, name: string) {
    const resolution = pinned.resolveObject([schema, name]);
    if (resolution.kind !== "resolved") {
        throw new Error(`fixture object ${schema}.${name} did not resolve`);
    }
    return resolution.ref;
}

async function scriptOf(
    schema: string,
    name: string,
    operation: ScriptOperation,
    spec: FixtureCatalogSpec = STANDARD_FIXTURE_CATALOG,
    provenance?: ScriptMetadataProvenance,
): Promise<ScriptResult> {
    const { engine, pinned } = engineOf(spec);
    return engine.script({
        target: { ref: refOf(pinned, schema, name) },
        operation,
        ...(provenance !== undefined ? { provenance } : {}),
    });
}

function lines(result: ScriptResult): string[] {
    return result.text.split("\r\n");
}

/** Fixture catalog with tricky module heads + honesty cases. */
const MODULE_CATALOG: FixtureCatalogSpec = {
    ...STANDARD_FIXTURE_CATALOG,
    objects: [
        ...STANDARD_FIXTURE_CATALOG.objects,
        {
            schema: "dbo",
            name: "CommentedProc",
            kind: "procedure",
            definition:
                "-- provenance header\r\n/* block */ CREATE /* between head and kind */ PROC [dbo].[CommentedProc]\r\n    @p int -- trailing\r\nAS\r\nSELECT @p;",
        },
        {
            schema: "dbo",
            name: "LowerProc",
            kind: "procedure",
            definition: "create procedure dbo.LowerProc as select 1;",
        },
        {
            schema: "dbo",
            name: "OrAlterProc",
            kind: "procedure",
            definition: "CREATE OR ALTER PROCEDURE dbo.OrAlterProc AS SELECT 1;",
        },
        {
            schema: "dbo",
            name: "StoredAlterProc",
            kind: "procedure",
            definition: "ALTER PROCEDURE dbo.StoredAlterProc AS SELECT 2;",
        },
        {
            schema: "dbo",
            name: "WeirdHeadProc",
            kind: "procedure",
            definition: "/* header only */ SELECT 'not a module';",
        },
        {
            schema: "dbo",
            name: "SecretProc",
            kind: "procedure",
            definitionUnavailable: "encrypted",
        },
        {
            schema: "dbo",
            name: "HiddenProc",
            kind: "procedure",
            definitionUnavailable: "permission",
        },
        { schema: "dbo", name: "NoTextView", kind: "view" },
        {
            schema: "dbo",
            name: "OrderCountFn",
            kind: "scalarFunction",
            definition:
                "CREATE FUNCTION dbo.OrderCountFn (@CustomerID int)\r\nRETURNS int\r\nAS\r\nBEGIN RETURN 1; END;",
        },
    ],
};

/** Catalog without CREATE OR ALTER support (pre-2016 SP1 server). */
const OLD_SERVER_CATALOG: FixtureCatalogSpec = {
    ...MODULE_CATALOG,
    env: {
        ...MODULE_CATALOG.env,
        capabilities: { createOrAlterProgrammability: false, dropIfExists: false },
    },
};

/** Identity/computed/no-PK shapes for CreateTable + DML edge tests. */
const WIDGET_CATALOG: FixtureCatalogSpec = {
    databases: ["FixtureDb"],
    env: { currentDatabase: "FixtureDb", defaultSchema: "dbo", caseSensitive: false },
    objects: [
        {
            schema: "dbo",
            name: "Widgets",
            kind: "table",
            columns: [
                {
                    name: "WidgetID",
                    typeDisplay: "int",
                    nullable: false,
                    isPrimaryKey: true,
                    isIdentity: true,
                },
                { name: "Name", typeDisplay: "nvarchar(50)", nullable: false },
                { name: "Price", typeDisplay: "money", nullable: true },
                { name: "Total", typeDisplay: "money", nullable: true, isComputed: true },
            ],
            keyConstraints: [{ name: "PK_Widgets", kind: "primaryKey", columns: ["WidgetID"] }],
            description: "Widget master data.",
            columnDescriptions: { Name: "Display name.\nSecond line." },
        },
        {
            schema: "dbo",
            name: "Heap",
            kind: "table",
            columns: [{ name: "Payload", typeDisplay: "nvarchar(max)", nullable: true }],
        },
        {
            schema: "dbo",
            name: "Reserved",
            kind: "table",
            columns: [
                { name: "Order", typeDisplay: "int", nullable: false, isPrimaryKey: true },
                { name: "Select", typeDisplay: "int", nullable: true },
            ],
        },
    ],
};

suite("sqlScripting module emitter: head rewrites", () => {
    test("create returns the stored definition verbatim", async () => {
        const result = await scriptOf("Sales", "GetOrders", "create");
        expect(result.text).to.equal(
            STANDARD_FIXTURE_CATALOG.objects.find((o) => o.name === "GetOrders")!.definition,
        );
        expect(result.source).to.equal("catalogDefinition");
        expect(result.unavailableReason).to.equal(undefined);
        expect(result.operation).to.equal("create");
        expect(result.objectKind).to.equal("procedure");
    });

    test("alter rewrites ONLY the CREATE token", async () => {
        const result = await scriptOf("Sales", "GetOrders", "alter");
        expect(result.text.startsWith("ALTER PROCEDURE Sales.GetOrders")).to.equal(true);
        expect(result.text.endsWith("SELECT 1;")).to.equal(true);
    });

    test("alter preserves comments and whitespace around the head", async () => {
        const result = await scriptOf("dbo", "CommentedProc", "alter", MODULE_CATALOG);
        expect(result.text).to.equal(
            "-- provenance header\r\n/* block */ ALTER /* between head and kind */ PROC [dbo].[CommentedProc]\r\n    @p int -- trailing\r\nAS\r\nSELECT @p;",
        );
    });

    test("alter rewrites a lowercase head", async () => {
        const result = await scriptOf("dbo", "LowerProc", "alter", MODULE_CATALOG);
        expect(result.text).to.equal("ALTER procedure dbo.LowerProc as select 1;");
    });

    test("alter collapses a stored CREATE OR ALTER head", async () => {
        const result = await scriptOf("dbo", "OrAlterProc", "alter", MODULE_CATALOG);
        expect(result.text).to.equal("ALTER PROCEDURE dbo.OrAlterProc AS SELECT 1;");
    });

    test("create rewrites a stored ALTER head and notes the rewrite", async () => {
        const result = await scriptOf("dbo", "StoredAlterProc", "create", MODULE_CATALOG);
        expect(result.text).to.equal("CREATE PROCEDURE dbo.StoredAlterProc AS SELECT 2;");
        expect(result.fidelityNotes.join(" ")).to.contain("rewritten to CREATE");
    });

    test("createOrAlter rewrites a plain CREATE head when supported", async () => {
        const result = await scriptOf("Sales", "GetOrders", "createOrAlter");
        expect(result.text.startsWith("CREATE OR ALTER PROCEDURE Sales.GetOrders")).to.equal(true);
        expect(result.unavailableReason).to.equal(undefined);
    });

    test("createOrAlter keeps a stored CREATE OR ALTER head verbatim", async () => {
        const result = await scriptOf("dbo", "OrAlterProc", "createOrAlter", MODULE_CATALOG);
        expect(result.text).to.equal("CREATE OR ALTER PROCEDURE dbo.OrAlterProc AS SELECT 1;");
    });

    test("createOrAlter rewrites a stored ALTER head", async () => {
        const result = await scriptOf("dbo", "StoredAlterProc", "createOrAlter", MODULE_CATALOG);
        expect(result.text).to.equal("CREATE OR ALTER PROCEDURE dbo.StoredAlterProc AS SELECT 2;");
    });

    test("createOrAlter is REFUSED on servers without the capability", async () => {
        const result = await scriptOf("Sales", "GetOrders", "createOrAlter", OLD_SERVER_CATALOG);
        expect(result.unavailableReason).to.equal("unsupported");
        expect(result.text).to.not.contain("CREATE OR ALTER PROCEDURE");
        expect(result.fidelityNotes.join(" ")).to.contain("not supported");
    });

    test("plain alter still works on servers without CREATE OR ALTER", async () => {
        const result = await scriptOf("Sales", "GetOrders", "alter", OLD_SERVER_CATALOG);
        expect(result.text.startsWith("ALTER PROCEDURE")).to.equal(true);
        expect(result.unavailableReason).to.equal(undefined);
    });

    test("a definition whose head is not CREATE/ALTER is refused honestly", async () => {
        const result = await scriptOf("dbo", "WeirdHeadProc", "alter", MODULE_CATALOG);
        expect(result.unavailableReason).to.equal("unsupported");
        expect(result.text).to.not.contain("ALTER PROC");
    });

    test("view definitions script as modules", async () => {
        const result = await scriptOf("Sales", "vOrderSummary", "create");
        expect(result.text.startsWith("CREATE VIEW Sales.vOrderSummary")).to.equal(true);
        expect(result.source).to.equal("catalogDefinition");
    });

    test("view alter rewrite", async () => {
        const result = await scriptOf("Sales", "vOrderSummary", "alter");
        expect(result.text.startsWith("ALTER VIEW Sales.vOrderSummary")).to.equal(true);
    });

    test("function alter rewrite", async () => {
        const result = await scriptOf("dbo", "OrderCountFn", "alter", MODULE_CATALOG);
        expect(result.text.startsWith("ALTER FUNCTION dbo.OrderCountFn")).to.equal(true);
    });
});

suite("sqlScripting module emitter: anchors", () => {
    test("header, objectName, and parameter anchors on a procedure", async () => {
        const result = await scriptOf("Sales", "GetOrders", "create");
        const header = result.anchors.find((a) => a.symbol.kind === "header");
        expect(header).to.deep.include({ line: 0, character: 0 });
        const objectName = result.anchors.find((a) => a.symbol.kind === "objectName");
        expect(objectName).to.not.equal(undefined);
        expect(objectName!.character).to.equal("CREATE PROCEDURE Sales.".length);
        const paramNames = result.anchors
            .filter((a) => a.symbol.kind === "parameter")
            .map((a) => (a.symbol.kind === "parameter" ? a.symbol.name : ""));
        expect(paramNames).to.deep.equal(["@CustomerID", "@Since", "@Total"]);
        const total = result.anchors.find(
            (a) => a.symbol.kind === "parameter" && a.symbol.name === "@Total",
        );
        expect(total!.character).to.equal(result.text.indexOf("@Total"));
    });

    test("anchors are computed on the REWRITTEN text", async () => {
        const result = await scriptOf("Sales", "GetOrders", "alter");
        const objectName = result.anchors.find((a) => a.symbol.kind === "objectName");
        expect(objectName!.character).to.equal("ALTER PROCEDURE Sales.".length);
    });

    test("parameter anchors stop at the module body AS", async () => {
        const result = await scriptOf("dbo", "CommentedProc", "create", MODULE_CATALOG);
        const parameters = result.anchors.filter((a) => a.symbol.kind === "parameter");
        expect(parameters.length).to.equal(1); // @p in the header, not the body use
        expect(parameters[0].line).to.equal(2);
    });

    test("objectName anchor lands on the bracketed name token", async () => {
        const result = await scriptOf("dbo", "CommentedProc", "create", MODULE_CATALOG);
        const objectName = result.anchors.find((a) => a.symbol.kind === "objectName");
        expect(result.text.slice(objectName!.span.start, objectName!.span.end)).to.equal(
            "[CommentedProc]",
        );
    });
});

suite("sqlScripting module emitter: honesty (encrypted / permission / missing)", () => {
    test("encrypted module: honest refusal, no fabricated body", async () => {
        const result = await scriptOf("dbo", "SecretProc", "create", MODULE_CATALOG);
        expect(result.unavailableReason).to.equal("encrypted");
        expect(result.text).to.contain("encrypted");
        expect(result.text).to.not.contain("CREATE PROC");
        expect(result.anchors.length).to.equal(0);
    });

    test("permission-hidden module: honest refusal", async () => {
        const result = await scriptOf("dbo", "HiddenProc", "create", MODULE_CATALOG);
        expect(result.unavailableReason).to.equal("permission");
        expect(result.text).to.not.contain("CREATE PROC");
    });

    test("module without loaded text: notLoaded", async () => {
        const result = await scriptOf("dbo", "NoTextView", "create", MODULE_CATALOG);
        expect(result.unavailableReason).to.equal("notLoaded");
    });

    test("alter on an encrypted module is refused the same way", async () => {
        const result = await scriptOf("dbo", "SecretProc", "alter", MODULE_CATALOG);
        expect(result.unavailableReason).to.equal("encrypted");
        expect(result.text).to.not.contain("ALTER");
    });
});

suite("sqlScripting CreateTable: F2 golden", () => {
    test("Sales.Orders golden (named PK + FK with column pairs)", async () => {
        const result = await scriptOf("Sales", "Orders", "create");
        expect(lines(result)).to.deep.equal([
            "-- Synthesized from catalog metadata by the native T-SQL language service (fidelity F2).",
            "-- not hydrated: default constraints, check constraints, indexes, column collation, identity seed/increment",
            "CREATE TABLE Sales.Orders (",
            "    OrderID int NOT NULL,",
            "    CustomerID int NOT NULL,",
            "    OrderDate datetime2(7) NOT NULL,",
            "    Comments nvarchar(max) NULL,",
            "    CONSTRAINT PK_Orders PRIMARY KEY (OrderID),",
            "    CONSTRAINT FK_Orders_Customers FOREIGN KEY (CustomerID) REFERENCES Sales.Customers (CustomerID)",
            ");",
            "",
        ]);
        expect(result.fidelity).to.equal("F2");
        expect(result.source).to.equal("synthesized");
    });

    test("composite key order is preserved (OrderLines)", async () => {
        const result = await scriptOf("Sales", "OrderLines", "create");
        expect(result.text).to.contain(
            "CONSTRAINT PK_OrderLines PRIMARY KEY (OrderID, LineNumber)",
        );
    });

    test("unique constraints emit with their names (Customers)", async () => {
        const result = await scriptOf("Sales", "Customers", "create");
        expect(result.text).to.contain(
            "CONSTRAINT UQ_Customers_CustomerName UNIQUE (CustomerName)",
        );
    });

    test("identity flag renders bare IDENTITY with a fidelity note", async () => {
        const result = await scriptOf("dbo", "Widgets", "create", WIDGET_CATALOG);
        expect(result.text).to.contain("    WidgetID int IDENTITY NOT NULL,");
        expect(result.fidelityNotes.join(" ")).to.contain("seed/increment");
    });

    test("computed columns become comments — never fabricated definitions", async () => {
        const result = await scriptOf("dbo", "Widgets", "create", WIDGET_CATALOG);
        expect(result.text).to.contain("-- Total computed column (expression not hydrated)");
        expect(result.text).to.not.contain("Total money");
        expect(result.fidelityNotes.join(" ")).to.contain("computed column expressions");
    });

    test("comment lines never carry commas; no dangling comma before )", async () => {
        const result = await scriptOf("dbo", "Widgets", "create", WIDGET_CATALOG);
        const body = lines(result);
        // The computed-column comment carries no comma even mid-list…
        const commentLine = body.find((l) => l.includes("computed column"))!;
        expect(commentLine.endsWith(",")).to.equal(false);
        // …the real item before it still separates from the constraint…
        expect(body.find((l) => l.includes("Price money"))!.endsWith(",")).to.equal(true);
        // …and the last line before ) never ends with a comma.
        const closeIndex = body.indexOf(");");
        expect(body[closeIndex - 1].endsWith(",")).to.equal(false);
    });

    test("descriptions ride as comments AFTER the comma (syntax-safe)", async () => {
        const result = await scriptOf("dbo", "Widgets", "create", WIDGET_CATALOG);
        expect(result.text).to.contain("-- Description: Widget master data.");
        expect(result.text).to.contain("nvarchar(50) NOT NULL, -- Display name. Second line.");
        expect(result.fidelityNotes.join(" ")).to.contain("truncated at 4000");
    });

    test("reserved-word identifiers are bracketed", async () => {
        const result = await scriptOf("dbo", "Reserved", "create", WIDGET_CATALOG);
        expect(result.text).to.contain("    [Order] int NOT NULL,");
        expect(result.text).to.contain("    [Select] int NULL");
    });
});

suite("sqlScripting CreateTable: F1 degradation", () => {
    test("no key-constraint metadata → F1 with unnamed PK and note", async () => {
        const result = await scriptOf("dbo", "Reserved", "create", WIDGET_CATALOG);
        expect(result.fidelity).to.equal("F1");
        expect(result.text).to.contain("PRIMARY KEY ([Order])");
        expect(result.text).to.not.contain("CONSTRAINT");
        expect(result.fidelityNotes.join(" ")).to.contain("constraint name");
    });

    test("heap without PK: no PRIMARY KEY line at all", async () => {
        const result = await scriptOf("dbo", "Heap", "create", WIDGET_CATALOG);
        expect(result.text).to.not.contain("PRIMARY KEY");
    });

    test("foreign keys not ready → F1 + note", async () => {
        const spec: FixtureCatalogSpec = {
            ...STANDARD_FIXTURE_CATALOG,
            readiness: { foreignKeys: "loading" },
        };
        const result = await scriptOf("Sales", "Orders", "create", spec);
        expect(result.fidelity).to.equal("F1");
        expect(result.text).to.not.contain("FOREIGN KEY");
        expect(result.fidelityNotes.join(" ")).to.contain("foreign keys not hydrated");
    });

    test("columns not ready → honest refusal, never a partial table", async () => {
        const spec: FixtureCatalogSpec = {
            ...STANDARD_FIXTURE_CATALOG,
            readiness: { columns: "loading" },
        };
        const result = await scriptOf("Sales", "Orders", "create", spec);
        expect(result.unavailableReason).to.equal("notLoaded");
        expect(result.text).to.not.contain("CREATE TABLE");
    });

    test("alter operation on a table is refused (no stored definition)", async () => {
        const result = await scriptOf("Sales", "Orders", "alter");
        expect(result.unavailableReason).to.equal("unsupported");
    });
});

suite("sqlScripting CreateTable: anchors", () => {
    test("column anchors land on exact lines/characters", async () => {
        const result = await scriptOf("Sales", "Orders", "create");
        const anchorOf = (name: string) =>
            result.anchors.find((a) => a.symbol.kind === "column" && a.symbol.name === name)!;
        expect(anchorOf("OrderID")).to.deep.include({ line: 3, character: 4 });
        expect(anchorOf("CustomerID")).to.deep.include({ line: 4, character: 4 });
        expect(anchorOf("OrderDate")).to.deep.include({ line: 5, character: 4 });
        expect(anchorOf("Comments")).to.deep.include({ line: 6, character: 4 });
    });

    test("anchor spans slice exactly the identifier text", async () => {
        const result = await scriptOf("Sales", "Orders", "create");
        for (const anchor of result.anchors) {
            if (anchor.symbol.kind === "column") {
                expect(result.text.slice(anchor.span.start, anchor.span.end)).to.equal(
                    anchor.symbol.name,
                );
            }
        }
    });

    test("header and objectName anchors", async () => {
        const result = await scriptOf("Sales", "Orders", "create");
        const header = result.anchors.find((a) => a.symbol.kind === "header")!;
        expect(header).to.deep.include({ line: 2, character: 0 });
        const objectName = result.anchors.find((a) => a.symbol.kind === "objectName")!;
        expect(objectName).to.deep.include({ line: 2, character: "CREATE TABLE Sales.".length });
    });

    test("constraint + foreignKey anchors carry their names", async () => {
        const result = await scriptOf("Sales", "Orders", "create");
        const constraint = result.anchors.find((a) => a.symbol.kind === "constraint")!;
        expect(constraint.symbol).to.deep.equal({ kind: "constraint", name: "PK_Orders" });
        const fk = result.anchors.find((a) => a.symbol.kind === "foreignKey")!;
        expect(fk.symbol).to.deep.equal({ kind: "foreignKey", name: "FK_Orders_Customers" });
        expect(fk.line).to.equal(8);
    });

    test("computed-column comment still gets a column anchor", async () => {
        const result = await scriptOf("dbo", "Widgets", "create", WIDGET_CATALOG);
        const total = result.anchors.find(
            (a) => a.symbol.kind === "column" && a.symbol.name === "Total",
        );
        expect(total).to.not.equal(undefined);
        expect(result.text.slice(total!.span.start, total!.span.end)).to.equal("Total");
    });
});

suite("sqlScripting DML templates", () => {
    test("selectTop golden", async () => {
        const result = await scriptOf("Sales", "Customers", "selectTop");
        expect(lines(result)).to.deep.equal([
            "SELECT TOP (1000)",
            "    CustomerID,",
            "    CustomerName",
            "FROM Sales.Customers;",
            "",
        ]);
        expect(result.fidelity).to.equal("F0");
        expect(result.source).to.equal("template");
    });

    test("insert skips identity and computed columns and says so", async () => {
        const result = await scriptOf("dbo", "Widgets", "insert", WIDGET_CATALOG);
        expect(result.text).to.not.contain("WidgetID");
        expect(result.text).to.not.contain("Total");
        expect(result.text).to.contain("INSERT INTO dbo.Widgets (");
        expect(result.text).to.contain("/* Name nvarchar(50), NOT NULL */");
        expect(result.text).to.contain("/* Price money, NULL */");
        expect(result.fidelityNotes.join(" ")).to.contain("identity/computed");
    });

    test("update golden: PK excluded from SET, PK-based WHERE", async () => {
        const result = await scriptOf("dbo", "Widgets", "update", WIDGET_CATALOG);
        const set = result.text.slice(result.text.indexOf("SET"), result.text.indexOf("WHERE"));
        expect(set).to.contain("Name = ");
        expect(set).to.contain("Price = ");
        expect(set).to.not.contain("WidgetID");
        expect(result.text).to.contain("WHERE WidgetID = /* int */;");
    });

    test("update without PK degrades to an explicit placeholder", async () => {
        const result = await scriptOf("dbo", "Heap", "update", WIDGET_CATALOG);
        expect(result.text).to.contain("WHERE /* add a filter predicate */;");
        expect(result.fidelityNotes.join(" ")).to.contain("no primary key");
    });

    test("delete golden with composite PK conjunction", async () => {
        const result = await scriptOf("Sales", "OrderLines", "delete");
        expect(result.text).to.contain("DELETE FROM Sales.OrderLines");
        expect(result.text).to.contain("WHERE OrderID = /* int */");
        expect(result.text).to.contain("  AND LineNumber = /* int */;");
    });

    test("execute golden: classic DECLARE @RC block, named args, OUTPUT marker", async () => {
        const result = await scriptOf("Sales", "GetOrders", "execute");
        expect(lines(result)).to.deep.equal([
            "DECLARE @RC int;",
            "DECLARE @CustomerID int;",
            "DECLARE @Since datetime2(7);",
            "DECLARE @Total money;",
            "",
            "-- TODO: Set parameter values here.",
            "",
            "EXECUTE @RC = Sales.GetOrders",
            "    @CustomerID = @CustomerID,",
            "    @Since = @Since,",
            "    @Total = @Total OUTPUT;",
            "",
        ]);
    });

    test("execute parameter anchors", async () => {
        const result = await scriptOf("Sales", "GetOrders", "execute");
        const names = result.anchors
            .filter((a) => a.symbol.kind === "parameter")
            .map((a) => (a.symbol.kind === "parameter" ? a.symbol.name : ""));
        expect(names).to.deep.equal(["@CustomerID", "@Since", "@Total"]);
    });

    test("selectTop works for views", async () => {
        const result = await scriptOf("Sales", "vOrderSummary", "selectTop");
        expect(result.text).to.contain("FROM Sales.vOrderSummary;");
        expect(result.unavailableReason).to.equal(undefined);
    });

    test("insert on a view is refused", async () => {
        const result = await scriptOf("Sales", "vOrderSummary", "insert");
        expect(result.unavailableReason).to.equal("unsupported");
    });

    test("execute on a table is refused", async () => {
        const result = await scriptOf("Sales", "Orders", "execute");
        expect(result.unavailableReason).to.equal("unsupported");
    });

    test("templates refuse when columns are not ready", async () => {
        const spec: FixtureCatalogSpec = {
            ...STANDARD_FIXTURE_CATALOG,
            readiness: { columns: "loading" },
        };
        const result = await scriptOf("Sales", "Orders", "selectTop", spec);
        expect(result.unavailableReason).to.equal("notLoaded");
    });
});

suite("sqlScripting service: capabilities and routing", () => {
    test("table capabilities", () => {
        const { engine, pinned } = engineOf();
        expect(engine.capabilities({ ref: refOf(pinned, "Sales", "Orders") })).to.deep.equal([
            "create",
            "drop",
            "selectTop",
            "insert",
            "update",
            "delete",
        ]);
    });

    test("procedure capabilities include createOrAlter when supported", () => {
        const { engine, pinned } = engineOf();
        expect(engine.capabilities({ ref: refOf(pinned, "Sales", "GetOrders") })).to.deep.equal([
            "create",
            "alter",
            "createOrAlter",
            "drop",
            "execute",
        ]);
    });

    test("procedure capabilities EXCLUDE createOrAlter on old servers", () => {
        const { engine, pinned } = engineOf(OLD_SERVER_CATALOG);
        expect(engine.capabilities({ ref: refOf(pinned, "Sales", "GetOrders") })).to.deep.equal([
            "create",
            "alter",
            "drop",
            "execute",
        ]);
    });

    test("view capabilities", () => {
        const { engine, pinned } = engineOf();
        expect(engine.capabilities({ ref: refOf(pinned, "Sales", "vOrderSummary") })).to.deep.equal(
            ["create", "alter", "createOrAlter", "drop", "selectTop"],
        );
    });

    test("synonym capabilities include drop only (target not hydrated)", () => {
        const { engine, pinned } = engineOf();
        expect(engine.capabilities({ ref: refOf(pinned, "dbo", "OrdersSynonym") })).to.deep.equal([
            "drop",
        ]);
    });

    test("unknown object: empty capabilities + honest notLoaded script", async () => {
        const { engine } = engineOf();
        expect(engine.capabilities({ ref: { objectId: 987654 } })).to.deep.equal([]);
        const result = await engine.script({
            target: { ref: { objectId: 987654 } },
            operation: "create",
        });
        expect(result.unavailableReason).to.equal("notLoaded");
    });

    test("drop emits object-kind-aware DROP script", async () => {
        const drop = await scriptOf("Sales", "GetOrders", "drop");
        expect(drop.unavailableReason).to.equal(undefined);
        expect(drop.text).to.equal("DROP PROCEDURE Sales.GetOrders;\r\n");
        expect(drop.source).to.equal("template");
    });

    test("dropAndCreate is not implemented yet — honest refusal", async () => {
        const dropAndCreate = await scriptOf("Sales", "GetOrders", "dropAndCreate");
        expect(dropAndCreate.unavailableReason).to.equal("unsupported");
    });

    test("synonym definition scripting is refused honestly", async () => {
        const result = await scriptOf("dbo", "OrdersSynonym", "create");
        expect(result.unavailableReason).to.equal("unsupported");
        expect(result.text).to.contain("Cannot script dbo.OrdersSynonym");
    });

    test("results carry the pinned metadata generation", async () => {
        const result = await scriptOf("Sales", "Orders", "create");
        expect(result.metadataGeneration).to.equal(1);
    });

    test("fidelity notes are also rendered as header comments", async () => {
        const result = await scriptOf("dbo", "Widgets", "create", WIDGET_CATALOG);
        for (const note of result.fidelityNotes) {
            const flattened = note.replace(/\s+/g, " ");
            expect(result.text.replace(/\s+/g, " ")).to.contain(flattened.slice(0, 40));
        }
    });
});

// ---------------------------------------------------------------------------
// CACHE-6: provenance travel + offline banner + strict refusal (addendum
// §7.5, base §16.3) — the provenance arrives as request data and is the ONE
// source of truth for result.provenance, the banner, and the refusal.
// ---------------------------------------------------------------------------

const LIVE_PROVENANCE: ScriptMetadataProvenance = {
    generation: 7,
    contentHash: "ch_live7",
    source: "live",
    freshness: "live",
    capturedAtUtc: "2026-07-06T15:12:03Z",
};

const OFFLINE_PROVENANCE: ScriptMetadataProvenance = {
    generation: 5,
    contentHash: "ch_disk5",
    source: "offline",
    freshness: "stale",
    capturedAtUtc: "2026-07-06T15:12:03Z",
};

const OFFLINE_BANNER = [
    "-- Generated from offline metadata snapshot.",
    "-- Snapshot captured at 2026-07-06T15:12:03Z.",
    "-- Live drift validation was not performed.",
];

suite("sqlScripting provenance + offline banner (CACHE-6 §7.5/§16.3)", () => {
    test("provenance travels through VERBATIM; live scripts carry no banner", async () => {
        const plain = await scriptOf("Sales", "Orders", "create");
        const result = await scriptOf(
            "Sales",
            "Orders",
            "create",
            STANDARD_FIXTURE_CATALOG,
            LIVE_PROVENANCE,
        );
        expect(result.provenance).to.deep.equal(LIVE_PROVENANCE);
        expect(result.text).to.equal(plain.text); // no banner, byte-identical
        expect(result.anchors).to.deep.equal(plain.anchors);
    });

    test("no provenance in the request → none on the result (non-strict callers unchanged)", async () => {
        const result = await scriptOf("Sales", "Orders", "create");
        expect(result.provenance).to.equal(undefined);
    });

    test("offline provenance renders the EXACT three banner lines above the script", async () => {
        const result = await scriptOf(
            "Sales",
            "Orders",
            "create",
            STANDARD_FIXTURE_CATALOG,
            OFFLINE_PROVENANCE,
        );
        expect(lines(result).slice(0, 3)).to.deep.equal(OFFLINE_BANNER);
        expect(result.text).to.contain("CREATE TABLE Sales.Orders (");
        expect(result.provenance).to.deep.equal(OFFLINE_PROVENANCE);
        expect(result.unavailableReason).to.equal(undefined);
    });

    test("banner and provenance come from the same fields (capturedAtUtc match)", async () => {
        const result = await scriptOf(
            "Sales",
            "Orders",
            "create",
            STANDARD_FIXTURE_CATALOG,
            OFFLINE_PROVENANCE,
        );
        expect(result.text).to.contain(`captured at ${result.provenance!.capturedAtUtc}`);
    });

    test("offline banner without capturedAtUtc stays honest (no fabricated time)", async () => {
        const result = await scriptOf("Sales", "Orders", "create", STANDARD_FIXTURE_CATALOG, {
            generation: 5,
            contentHash: "ch_disk5",
            source: "offline",
            freshness: "stale",
        });
        expect(lines(result)[0]).to.equal("-- Generated from offline metadata snapshot.");
        expect(lines(result)[1]).to.equal("-- Snapshot capture time is unknown.");
        expect(lines(result)[2]).to.equal("-- Live drift validation was not performed.");
    });

    test("the banner shifts every anchor exactly (spans, lines, characters)", async () => {
        const plain = await scriptOf("Sales", "Orders", "create");
        const banner = await scriptOf(
            "Sales",
            "Orders",
            "create",
            STANDARD_FIXTURE_CATALOG,
            OFFLINE_PROVENANCE,
        );
        const prefixLength = banner.text.length - plain.text.length;
        expect(banner.anchors.length).to.equal(plain.anchors.length);
        banner.anchors.forEach((anchor, i) => {
            const before = plain.anchors[i];
            expect(anchor.span.start).to.equal(before.span.start + prefixLength);
            expect(anchor.span.end).to.equal(before.span.end + prefixLength);
            expect(anchor.line).to.equal(before.line + 3);
            expect(anchor.character).to.equal(before.character);
            if (anchor.symbol.kind === "column") {
                expect(banner.text.slice(anchor.span.start, anchor.span.end)).to.equal(
                    anchor.symbol.name,
                );
            }
        });
    });

    test("banner applies to offline DML templates and module scripts too", async () => {
        const template = await scriptOf(
            "Sales",
            "Customers",
            "selectTop",
            STANDARD_FIXTURE_CATALOG,
            OFFLINE_PROVENANCE,
        );
        expect(lines(template).slice(0, 3)).to.deep.equal(OFFLINE_BANNER);
        const module = await scriptOf(
            "Sales",
            "GetOrders",
            "create",
            STANDARD_FIXTURE_CATALOG,
            OFFLINE_PROVENANCE,
        );
        expect(lines(module).slice(0, 3)).to.deep.equal(OFFLINE_BANNER);
        expect(module.text).to.contain("CREATE PROCEDURE Sales.GetOrders");
    });

    test("fidelity notes stay in place under the banner (existing mechanism untouched)", async () => {
        const result = await scriptOf(
            "dbo",
            "Widgets",
            "create",
            WIDGET_CATALOG,
            OFFLINE_PROVENANCE,
        );
        expect(lines(result).slice(0, 3)).to.deep.equal(OFFLINE_BANNER);
        expect(lines(result)[3]).to.contain("Synthesized from catalog metadata");
        expect(result.fidelityNotes.join(" ")).to.contain("seed/increment");
    });

    test("non-offline sources never render the banner (disk/memory/validated)", async () => {
        for (const source of ["memory", "disk", "live"] as const) {
            const result = await scriptOf("Sales", "Orders", "create", STANDARD_FIXTURE_CATALOG, {
                generation: 3,
                source,
                freshness: "validated",
            });
            expect(result.text, source).to.not.contain("offline metadata snapshot");
        }
    });

    test("freshness unavailable ONLINE: honest refusal mentioning refresh", async () => {
        const result = await scriptOf("Sales", "Orders", "create", STANDARD_FIXTURE_CATALOG, {
            generation: 3,
            source: "memory",
            freshness: "unavailable",
        });
        expect(result.unavailableReason).to.equal("notValidated");
        expect(result.text).to.contain("Cannot script Sales.Orders");
        expect(result.text).to.contain("refresh");
        expect(result.text).to.contain("mssql.metadataCache.offlineMode");
        expect(result.text).to.not.contain("CREATE TABLE");
        expect(result.anchors.length).to.equal(0);
        expect(result.provenance?.freshness).to.equal("unavailable");
    });

    test("freshness unavailable OFFLINE: refusal names offline mode, not refresh", async () => {
        const result = await scriptOf("Sales", "Orders", "create", STANDARD_FIXTURE_CATALOG, {
            generation: 0,
            source: "offline",
            freshness: "unavailable",
        });
        expect(result.unavailableReason).to.equal("offline");
        expect(result.text).to.contain("offline mode is active");
        expect(result.text).to.not.contain("CREATE TABLE");
        // A refusal NEVER carries the banner — the comment tells the truth.
        expect(result.text).to.not.contain("Generated from offline metadata snapshot");
    });

    test("engine refusals under offline provenance keep provenance but no banner", async () => {
        const result = await scriptOf(
            "dbo",
            "SecretProc",
            "create",
            MODULE_CATALOG,
            OFFLINE_PROVENANCE,
        );
        expect(result.unavailableReason).to.equal("encrypted");
        expect(result.text).to.not.contain("Generated from offline metadata snapshot");
        expect(result.provenance).to.deep.equal(OFFLINE_PROVENANCE);
    });
});
