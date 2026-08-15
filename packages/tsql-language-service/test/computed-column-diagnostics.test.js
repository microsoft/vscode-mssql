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
} = require("../dist/index.js");

// A computed column always accepts UNIQUE and PRIMARY KEY. Constraints that describe stored data
// require the column to be persisted first.
suite("T-SQL computed column constraint validation", () => {
    // The report covers the offending constraint.
    test("rejects a CHECK constraint on a non-persisted computed column with exact output", async () => {
        const sql = "CREATE TABLE dbo.T (A int, B AS (A + 1) CHECK (B > 0));";
        const diagnostics = (await analyze(sql)).filter(
            ({ code }) => code === "ComputedColumnsConstraintCheckError",
        );

        assert.deepEqual(
            diagnostics.map(({ code, message, severity, range }) => ({
                code,
                message,
                severity,
                text: sql.slice(range.start, range.end),
            })),
            [
                {
                    code: "ComputedColumnsConstraintCheckError",
                    message:
                        "Only UNIQUE or PRIMARY KEY constraints can be created on computed columns, while CHECK, FOREIGN KEY, and NOT NULL constraints require that computed columns be persisted.",
                    severity: "error",
                    text: "CHECK (B > 0)",
                },
            ],
        );
    });

    // A referential constraint describes stored data in the same way.
    test("rejects referential constraints on a non-persisted computed column", async () => {
        for (const constraint of [
            "REFERENCES dbo.Other (Id)",
            "FOREIGN KEY REFERENCES dbo.Other (Id)",
            "CONSTRAINT ck CHECK (B > 0)",
        ]) {
            const sql = `CREATE TABLE dbo.T (A int, B AS (A + 1) ${constraint});`;
            assert.deepEqual(
                (await analyze(sql)).filter(
                    ({ code }) => code === "ComputedColumnsConstraintCheckError",
                ).length,
                1,
                constraint,
            );
        }
    });

    // PERSISTED makes the same constraints legal.
    test("accepts the same constraints on a persisted computed column", async () => {
        for (const sql of [
            "CREATE TABLE dbo.T (A int, B AS (A + 1) PERSISTED CHECK (B > 0));",
            "CREATE TABLE dbo.T (A int, B AS (A + 1) PERSISTED NOT NULL);",
            "CREATE TABLE dbo.T (A int, B AS (A + 1) PERSISTED REFERENCES dbo.Other (Id));",
        ]) {
            assert.deepEqual(
                (await analyze(sql)).filter(
                    ({ code }) => code === "ComputedColumnsConstraintCheckError",
                ),
                [],
                sql,
            );
        }
    });

    // Key constraints are always legal on a computed column, persisted or not.
    test("accepts key constraints without PERSISTED", async () => {
        for (const sql of [
            "CREATE TABLE dbo.T (A int, B AS (A + 1) UNIQUE);",
            "CREATE TABLE dbo.T (A int, B AS (A + 1) PRIMARY KEY);",
            "CREATE TABLE dbo.T (A int, B AS (A + 1) CONSTRAINT pk PRIMARY KEY);",
        ]) {
            assert.deepEqual(
                (await analyze(sql)).filter(
                    ({ code }) => code === "ComputedColumnsConstraintCheckError",
                ),
                [],
                sql,
            );
        }
    });

    // An ordinary column keeps every constraint it is allowed to carry.
    test("leaves ordinary columns alone", async () => {
        const sql = `CREATE TABLE dbo.T (
    A int NOT NULL CHECK (A > 0),
    B int REFERENCES dbo.Other (Id)
);`;
        assert.deepEqual(
            (await analyze(sql)).filter(
                ({ code }) => code === "ComputedColumnsConstraintCheckError",
            ),
            [],
        );
    });

    // An incomplete computed expression remains a syntax problem and is not reclassified.
    test("does not classify a damaged computed column", async () => {
        const snapshot = await open("CREATE TABLE dbo.T (A int, B AS (A + ) CHECK (B > 0));");
        assert.notDeepEqual(snapshot.syntax.diagnostics, []);
        assert.deepEqual(
            snapshot.semantics.diagnostics.filter(
                ({ code }) => code === "ComputedColumnsConstraintCheckError",
            ),
            [],
        );
    });
});

async function analyze(sql) {
    const snapshot = await open(sql);
    assert.deepEqual(snapshot.syntax.diagnostics, [], sql);
    return snapshot.semantics.diagnostics;
}

async function open(sql) {
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        new InMemoryMetadataProvider({
            environment: { currentDatabase: "db", defaultSchema: "dbo" },
            schemas: [{ database: "db", name: "dbo" }],
            databases: [{ name: "db" }],
        }),
    );
    return runtime.open("file:///computed-columns.sql", 1, sql);
}
