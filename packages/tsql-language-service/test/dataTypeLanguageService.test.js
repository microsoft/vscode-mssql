/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { SaralSqlAnalysisEngine } = require("../dist/index.js");

// Independently authored regression expectations informed by SqlParser's public behavior corpus:
// FunctionalTest/.../SystemClrDataTypes/{Geography,Geometry,HierarchyId}.xml.
// No SqlParser implementation or baseline content is copied into this package.

function complete(text, marker, catalog) {
    const offset = text.lastIndexOf(marker) + marker.length;
    return new SaralSqlAnalysisEngine().createSnapshot({ text, catalog }).completeAt(offset);
}

function typeCatalog() {
    const types = [
        {
            parts: ["TestDatabase", "dbo", "PhoneNumber"],
            kind: "type",
            typeKind: "alias",
            baseType: "nvarchar(24)",
        },
        {
            parts: ["TestDatabase", "sales", "OrderLine"],
            kind: "type",
            typeKind: "table",
            columns: [
                { name: "OrderId", type: "int", nullable: false },
                { name: "Quantity", type: "decimal(9, 2)", nullable: false },
            ],
        },
        {
            parts: ["TestDatabase", "dbo", "GeoPoint"],
            kind: "type",
            typeKind: "clr",
        },
        {
            parts: ["TestDatabase", "dbo", "InvoiceSchemaCollection"],
            kind: "type",
            typeKind: "xmlSchema",
        },
    ];
    return {
        version: 1,
        world: "closed",
        columnsFor() {
            return undefined;
        },
        typeCandidates() {
            return types.filter((type) => type.typeKind !== "xmlSchema");
        },
        xmlSchemaCandidates() {
            return types.filter((type) => type.typeKind === "xmlSchema");
        },
    };
}

describe("data type language-service completion", () => {
    it("offers SQL Server system types and supported ISO synonyms at a column declaration", () => {
        const result = complete("CREATE TABLE dbo.T (Value ", "Value ");
        assert.equal(result.context.kind, "type");
        const labels = result.items
            .filter((item) => item.kind === "type")
            .map((item) => item.label);
        assert.ok(labels.includes("sysname"));
        assert.ok(labels.includes("rowversion"));
        assert.ok(labels.includes("dec"));
        assert.ok(labels.includes("double precision"));
        assert.ok(labels.includes("national character varying"));
    });

    it("offers CURSOR and TABLE only in compatible declaration positions", () => {
        const cursor = complete("DECLARE @cursor cur", "cur");
        assert.equal(cursor.context.kind, "type");
        assert.ok(cursor.items.some((item) => item.label.toLocaleLowerCase() === "cursor"));

        const table = complete("DECLARE @rows tab", "tab");
        assert.equal(table.context.kind, "type");
        assert.ok(table.items.some((item) => item.label.toLocaleLowerCase() === "table"));

        const column = complete("CREATE TABLE dbo.Invalid (Value c", "c");
        assert.equal(column.context.kind, "type");
        assert.equal(
            column.items.some((item) => item.label.toLocaleLowerCase() === "cursor"),
            false,
        );
        assert.equal(
            column.items.some((item) => item.label.toLocaleLowerCase() === "table"),
            false,
        );
    });

    it("completes catalog alias, table, and CLR types with useful details", () => {
        const catalog = typeCatalog();
        const alias = complete("DECLARE @phone dbo.Ph", "Ph", catalog);
        assert.equal(alias.context.kind, "type");
        assert.ok(
            alias.items.some(
                (item) =>
                    item.label === "PhoneNumber" && item.detail === "Alias type — nvarchar(24)",
            ),
        );

        const table = complete("CREATE FUNCTION dbo.F() RETURNS sales.Or", "Or", catalog);
        assert.ok(
            table.items.some(
                (item) => item.label === "OrderLine" && item.detail === "Table type — 2 columns",
            ),
        );

        const clr = complete("CREATE TABLE dbo.Points (Value dbo.Ge", "Ge", catalog);
        assert.ok(
            clr.items.some(
                (item) => item.label === "GeoPoint" && item.detail === "CLR user-defined type",
            ),
        );
    });

    it("retains native JSON and vector type completion alongside the expanded type registry", () => {
        const vector = complete("DECLARE @embedding vec", "vec");
        assert.ok(vector.items.some((item) => item.label === "vector"));
        const json = complete("CREATE TABLE dbo.Documents (Payload js", "js");
        assert.ok(json.items.some((item) => item.label === "json"));
    });

    it("completes and understands spatial and hierarchyid static methods", () => {
        for (const [text, expected] of [
            ["SELECT geography::P", ["Parse", "Point"]],
            ["SELECT geometry::STG", ["STGeomCollFromText", "STGeomFromText", "STGeomFromWKB"]],
            ["SELECT geography::U", ["UnionAggregate"]],
            ["SELECT hierarchyid::G", ["GetRoot"]],
        ]) {
            const result = complete(text, text);
            const labels = result.items.map((item) => item.label);
            for (const label of expected) {
                assert.ok(labels.includes(label), `${text} should offer ${label}`);
            }
        }

        const call = "SELECT GEOGRAPHY::Point(1, 2, 4326";
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({ text: call });
        const signature = snapshot.signatureAt(call.length);
        assert.equal(signature?.signatures[0].label, "GEOGRAPHY.Point(latitude, longitude, srid)");
        assert.equal(signature?.activeParameter, 2);

        const completeCall = "SELECT GEOGRAPHY::Point(1, 2, 4326)";
        const typed = new SaralSqlAnalysisEngine().createSnapshot({ text: completeCall });
        assert.equal(
            typed.typeAt(completeCall.indexOf("Point") + 1).display.toLocaleLowerCase(),
            "geography",
        );
    });

    it("completes XML schema collections only inside a typed XML declaration", () => {
        const catalog = typeCatalog();
        const xml = complete(
            "CREATE TABLE dbo.Documents (Payload xml(DOCUMENT dbo.Inv",
            "Inv",
            catalog,
        );
        assert.equal(xml.context.kind, "type");
        assert.ok(
            xml.items.some(
                (item) =>
                    item.label === "InvoiceSchemaCollection" &&
                    item.detail === "XML schema collection",
            ),
        );

        const ordinary = complete("CREATE TABLE dbo.Documents (Payload Inv", "Inv", catalog);
        assert.equal(
            ordinary.items.some((item) => item.label.includes("InvoiceSchemaCollection")),
            false,
        );
    });

    it("navigates a user-defined type reference to an earlier local CREATE TYPE", () => {
        const text =
            "CREATE TYPE dbo.PhoneNumber FROM nvarchar(24);\n" + "DECLARE @phone dbo.PhoneNumber;";
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({ text });
        const reference = text.lastIndexOf("PhoneNumber");
        const symbol = snapshot.symbolAt(reference + 2);

        assert.equal(symbol?.kind, "type");
        assert.deepEqual(symbol?.definition, {
            start: text.indexOf("dbo.PhoneNumber"),
            end: text.indexOf("dbo.PhoneNumber") + "dbo.PhoneNumber".length,
        });
    });

    it("diagnoses missing user-defined types and XML schema collections only in a closed catalog", () => {
        const closed = {
            version: 1,
            world: "closed",
            columnsFor() {
                return undefined;
            },
            typeCandidates() {
                return [];
            },
            xmlSchemaCandidates() {
                return [];
            },
        };
        const text =
            "DECLARE @phone dbo.MissingType;\n" +
            "DECLARE @document xml(DOCUMENT dbo.MissingCollection);";
        const diagnostics = new SaralSqlAnalysisEngine().createSnapshot({
            text,
            catalog: closed,
        }).semanticDiagnostics;

        assert.ok(
            diagnostics.some(
                (item) => item.code === "MSSQL2715" && item.message.includes("dbo.MissingType"),
            ),
        );
        assert.ok(
            diagnostics.some(
                (item) =>
                    item.code === "MSSQL6314" && item.message.includes("dbo.MissingCollection"),
            ),
        );

        const open = { ...closed, world: "open" };
        assert.equal(
            new SaralSqlAnalysisEngine()
                .createSnapshot({ text, catalog: open })
                .semanticDiagnostics.some(
                    (item) => item.code === "MSSQL2715" || item.code === "MSSQL6314",
                ),
            false,
        );
    });
});
