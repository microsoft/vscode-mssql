/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { SaralSqlAnalysisEngine } = require("../dist/index.js");

const users = [
    { name: "Id", type: "int", nullable: false },
    { name: "DisplayName", type: "nvarchar(100)", nullable: true },
];

function createCatalog(world = "closed") {
    return {
        version: 1,
        world,
        columnsFor(parts) {
            return parts.join(".").toLowerCase() === "dbo.users" ? users : undefined;
        },
        objectFor(parts) {
            switch (parts.join(".").toLowerCase()) {
                case "dbo.users":
                    return { parts: ["dbo", "Users"], kind: "table", columns: users };
                case "dbo.refreshusers":
                    return { parts: ["dbo", "RefreshUsers"], kind: "procedure" };
                default:
                    return undefined;
            }
        },
        tableCandidates(parts) {
            return parts.length === 1 ? [["dbo", parts[0]]] : [];
        },
    };
}

describe("SaralSqlAnalysisEngine", () => {
    it("reuses unchanged GO batches without mutating prior snapshots", () => {
        const engine = new SaralSqlAnalysisEngine();
        const firstText = "SELECT 1;\nGO\nSELECT 2;";
        const first = engine.createSnapshot({ text: firstText, uri: "file:///query.sql" });
        const firstStatements = structuredClone(first.statements);
        const second = engine.updateSnapshot(first, {
            text: "SELECT 1;\nGO\nSELECT 3;",
        });

        assert.equal(engine.capabilities.incrementalUpdate.level, "partial");
        assert.deepEqual(first.incrementalStatistics, {
            parsedBatchCount: 2,
            reusedBatchCount: 0,
            totalBatchCount: 2,
            reusedCharacterCount: 0,
            totalCharacterCount: 19,
        });
        assert.equal(second.incrementalStatistics.parsedBatchCount, 1);
        assert.equal(second.incrementalStatistics.reusedBatchCount, 1);
        assert.equal(second.version, first.version + 1);
        assert.equal(second.uri, first.uri);
        assert.equal(first.text, firstText);
        assert.deepEqual(first.statements, firstStatements);
    });

    it("reports exact catalog object diagnostics for query, DML, MERGE, and EXEC targets", () => {
        const text = [
            "SELECT m.Id FROM dbo.Missing AS m;",
            "INSERT INTO dbo.MissingInsert (Id) VALUES (1);",
            "UPDATE dbo.MissingUpdate SET Id = 2;",
            "DELETE FROM dbo.MissingDelete;",
            "MERGE dbo.MissingMerge AS target USING dbo.Users AS source",
            "ON target.Id = source.Id WHEN MATCHED THEN UPDATE SET target.Id = source.Id;",
            "EXEC dbo.MissingProc;",
            "EXEC dbo.RefreshUsers;",
        ].join("\n");
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({
            text,
            catalog: createCatalog(),
        });
        const diagnostics = snapshot.semanticDiagnostics.filter(
            (diagnostic) => diagnostic.code === "MSSQL208",
        );
        const missing = [
            "dbo.Missing",
            "dbo.MissingInsert",
            "dbo.MissingUpdate",
            "dbo.MissingDelete",
            "dbo.MissingMerge",
            "dbo.MissingProc",
        ];

        assert.deepEqual(
            diagnostics.map((diagnostic) => diagnostic.message),
            missing.map((name) => `Invalid object name '${name}'.`),
        );
        assert.deepEqual(
            diagnostics.map((diagnostic) => text.slice(diagnostic.span.start, diagnostic.span.end)),
            missing,
        );
        assert.equal(
            snapshot.mutationTargets().some((target) => target.operation === "merge"),
            true,
        );
    });

    it("reports MSSQL208 for a missing multiline INSERT target", () => {
        const text = `insert into dbo.hhh (
    Name,
    CreatedDate
)
VALUES (
    NULL,
    NULL
);`;
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({
            text,
            catalog: createCatalog(),
        });

        assert.deepEqual(
            snapshot.semanticDiagnostics.filter((diagnostic) => diagnostic.code === "MSSQL208"),
            [
                {
                    kind: "semantic",
                    code: "MSSQL208",
                    message: "Invalid object name 'dbo.hhh'.",
                    span: { start: text.indexOf("dbo.hhh"), end: text.indexOf("dbo.hhh") + 7 },
                    severity: "error",
                },
            ],
        );
    });

    it("binds schema-qualified document DDL in statement order across GO batches", () => {
        const text = [
            "CREATE TABLE dbo.gbf ([ggg] int NULL, [ColumnName] nvarchar(20) NOT NULL);",
            "GO",
            "SELECT g.ggg, g.ColumnName FROM dbo.gbf AS g;",
            "INSERT INTO dbo.gbf ([ggg], [ColumnName]) VALUES (1, N'one');",
        ].join("\n");
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({
            text,
            catalog: createCatalog(),
        });

        assert.deepEqual(
            snapshot.semanticDiagnostics.filter((diagnostic) => diagnostic.code === "MSSQL208"),
            [],
        );
        assert.equal(snapshot.typeAt(text.indexOf("g.ggg") + 3).display.toLowerCase(), "int");
        assert.equal(
            snapshot.typeAt(text.indexOf("g.ColumnName") + "g.Column".length).display.toLowerCase(),
            "nvarchar(20)",
        );
        const reference = snapshot.symbolAt(text.lastIndexOf("dbo.gbf") + 5);
        assert.equal(text.slice(reference.definition.start, reference.definition.end), "dbo.gbf");
    });

    it("does not make document DDL visible before CREATE or after DROP", () => {
        const text = [
            "SELECT * FROM dbo.Later;",
            "CREATE TABLE dbo.Later (Id int);",
            "SELECT Id FROM dbo.Later;",
            "DROP TABLE dbo.Later;",
            "SELECT * FROM dbo.Later;",
        ].join("\n");
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({
            text,
            catalog: createCatalog(),
        });
        const missing = snapshot.semanticDiagnostics.filter(
            (diagnostic) => diagnostic.code === "MSSQL208",
        );

        assert.deepEqual(
            missing.map((diagnostic) => diagnostic.span.start),
            [text.indexOf("dbo.Later"), text.lastIndexOf("dbo.Later")],
        );
    });

    it("applies ALTER TABLE columns to later completion and validation only", () => {
        const text = [
            "CREATE TABLE dbo.Evolving (Id int NOT NULL);",
            "ALTER TABLE dbo.Evolving ADD Label nvarchar(40) NULL;",
            "SELECT e.Label FROM dbo.Evolving AS e;",
        ].join("\n");
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({
            text,
            catalog: createCatalog(),
        });

        assert.equal(
            snapshot.typeAt(text.indexOf("e.Label") + 3).display.toLowerCase(),
            "nvarchar(40)",
        );
        assert.equal(
            snapshot.semanticDiagnostics.some(
                (diagnostic) =>
                    diagnostic.code === "unknown-column" || diagnostic.code === "MSSQL207",
            ),
            false,
        );
    });

    it("uses catalog columns for qualified completion and type lookup", () => {
        const text = "SELECT u.DisplayName FROM Users AS u";
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({
            text,
            catalog: createCatalog(),
        });
        const columnOffset = text.indexOf("DisplayName") + 2;
        const completionText = "SELECT u.Dis FROM Users AS u";
        const completionSnapshot = new SaralSqlAnalysisEngine().createSnapshot({
            text: completionText,
            catalog: createCatalog(),
        });
        const completionOffset = completionText.indexOf("Dis") + 3;

        assert.deepEqual(snapshot.typeAt(columnOffset), {
            kind: "scalar",
            name: "nvarchar(100)",
            display: "nvarchar(100)",
        });
        assert.deepEqual(completionSnapshot.completeAt(completionOffset), {
            items: [
                {
                    label: "DisplayName",
                    kind: "column",
                    detail: "nvarchar(100)",
                    documentation: "Column `DisplayName` has SQL type `nvarchar(100)`.",
                },
            ],
            replaceSpan: {
                start: completionText.indexOf("Dis"),
                end: completionOffset,
            },
        });
        assert.deepEqual(
            snapshot.semanticDiagnostics.filter((diagnostic) => diagnostic.code === "MSSQL208"),
            [],
        );

        const builtin = new SaralSqlAnalysisEngine().createSnapshot({
            text: "SELECT COUNT(*) FROM dbo.Users",
            catalog: createCatalog(),
        });
        assert.equal(
            builtin.semanticDiagnostics.some((item) => item.code === "MSSQL208"),
            false,
        );
    });

    it("binds XML method receivers and generated nodes columns without catalog false positives", () => {
        const text = `SELECT
    t.Id,
    n.value('(Name/text())[1]', 'nvarchar(100)') AS Name,
    n.value('(Value/text())[1]', 'int') AS Value
FROM dbo.XmlDocuments AS t
CROSS APPLY t.XmlData.nodes('/Root/Item') AS x(n)
WHERE n.exist('Value[. > 10]') = 1;`;
        const xmlColumns = [
            { name: "Id", type: "int", nullable: false },
            { name: "XmlData", type: "xml", nullable: true },
        ];
        const catalog = {
            version: 1,
            world: "closed",
            columnsFor(parts) {
                return parts.join(".").toLowerCase() === "dbo.xmldocuments"
                    ? xmlColumns
                    : undefined;
            },
            objectFor(parts) {
                return parts.join(".").toLowerCase() === "dbo.xmldocuments"
                    ? { parts: ["dbo", "XmlDocuments"], kind: "table", columns: xmlColumns }
                    : undefined;
            },
            tableCandidates() {
                return [];
            },
        };
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({ text, catalog });

        assert.deepEqual(snapshot.semanticDiagnostics, []);
        assert.equal(
            snapshot
                .externalReferences()
                .some(
                    (reference) =>
                        reference.kind === "table" && reference.name === "t.XmlData.nodes",
                ),
            false,
        );
        assert.equal(
            snapshot
                .symbols()
                .some((symbol) => symbol.name === "t.XmlData" && symbol.kind === "column"),
            true,
        );
        assert.equal(
            snapshot.symbols().some((symbol) => symbol.name === "n" && symbol.kind === "column"),
            true,
        );
    });

    it("resolves catalog-backed spatial methods and properties", () => {
        const text = "SELECT s.Shape.STArea(), s.Shape.STSrid FROM dbo.SpatialRows AS s;";
        const spatialColumns = [{ name: "Shape", type: "geometry", nullable: true }];
        const catalog = {
            version: 1,
            world: "closed",
            columnsFor(parts) {
                return parts.join(".").toLowerCase() === "dbo.spatialrows"
                    ? spatialColumns
                    : undefined;
            },
            objectFor(parts) {
                return parts.join(".").toLowerCase() === "dbo.spatialrows"
                    ? { parts: ["dbo", "SpatialRows"], kind: "table", columns: spatialColumns }
                    : undefined;
            },
            tableCandidates() {
                return [];
            },
        };
        const snapshot = new SaralSqlAnalysisEngine().createSnapshot({ text, catalog });

        assert.deepEqual(snapshot.syntaxDiagnostics, []);
        assert.deepEqual(snapshot.semanticDiagnostics, []);
        assert.equal(snapshot.typeAt(text.indexOf("STArea") + 2).display, "FLOAT");
        assert.equal(snapshot.typeAt(text.indexOf("STSrid") + 2).display, "INT");
    });

    it("retains, replaces, and removes catalogs according to update semantics", () => {
        const engine = new SaralSqlAnalysisEngine();
        const first = engine.createSnapshot({
            text: "SELECT u.Id FROM dbo.Users AS u",
            catalog: createCatalog(),
        });
        const retained = engine.updateSnapshot(first, {
            text: "SELECT u.DisplayName FROM dbo.Users AS u",
        });
        const open = engine.updateSnapshot(retained, {
            text: "SELECT m.Id FROM dbo.Missing AS m",
            catalog: createCatalog("open"),
        });
        const removed = engine.updateSnapshot(retained, {
            text: "SELECT m.Id FROM dbo.Missing AS m",
            catalog: null,
        });

        assert.equal(
            retained.typeAt(retained.text.indexOf("DisplayName") + 1).display,
            "nvarchar(100)",
        );
        assert.equal(
            open.semanticDiagnostics.some((item) => item.code === "MSSQL208"),
            false,
        );
        assert.equal(
            removed.semanticDiagnostics.some((item) => item.code === "MSSQL208"),
            false,
        );
        assert.equal(first.text, "SELECT u.Id FROM dbo.Users AS u");
    });
});
