/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSemanticHarness } from "../../support/semanticHarness.ts";
// A data type specification carries at most a schema prefix, and one length argument that may never
// exceed the ceiling shared by every data type.
const { analyze } = createSemanticHarness({
    uri: "file:///data-type-shape.sql",
    metadata: {
        schemas: [
            { database: "db", name: "dbo" },
            { database: "db", name: "sys" },
        ],
    },
});

suite("T-SQL data type shape validation", () => {
    // The length diagnostic is ranged at the argument, not at the whole type.
    test("rejects a length above the shared ceiling with exact output", async () => {
        const sql = "DECLARE @v varchar(9001);";
        const diagnostics = await analyze(sql);

        assert.deepEqual(
            diagnostics.map(({ code, message, severity, range }) => ({
                code,
                message,
                severity,
                text: sql.slice(range.start, range.end),
            })),
            [
                {
                    code: "MaximumSizeErrorForAnyType",
                    message:
                        "The size (9001) given to the type 'varchar' exceeds the maximum allowed for any data type (8000).",
                    severity: "error",
                    text: "9001",
                },
            ],
        );
    });

    // Below the shared ceiling a type's own maximum still decides, and the two never both fire.
    test("keeps the per-type maximum below the shared ceiling", async () => {
        assert.deepEqual(
            (await analyze("DECLARE @v nvarchar(5000);")).map(({ code, message }) => [
                code,
                message,
            ]),
            [
                [
                    "MaximumSizeError",
                    "The size (5000) given to the type 'nvarchar' exceeds the maximum allowed (4000).",
                ],
            ],
        );
        assert.deepEqual(
            (await analyze("DECLARE @v nvarchar(9001);")).map(({ code }) => code),
            ["MaximumSizeErrorForAnyType"],
        );
    });

    // A fractional-seconds scale is not a length, and a legal length is silent.
    test("leaves scale arguments and legal lengths alone", async () => {
        for (const sql of [
            "DECLARE @v varchar(8000);",
            "DECLARE @v varbinary(8000);",
            "DECLARE @v time(7);",
            "DECLARE @v datetime2(7);",
            "DECLARE @v datetimeoffset(7);",
            "DECLARE @v varchar(max);",
            "DECLARE @v decimal(38, 10);",
        ]) {
            assert.deepEqual(await analyze(sql), [], sql);
        }
    });

    // A three-part type name is over-prefixed, and the report covers the whole name.
    test("rejects an over-prefixed type name with exact output", async () => {
        const sql = "DECLARE @v db.dbo.MyType;";
        const diagnostics = await analyze(sql);

        assert.deepEqual(
            diagnostics.map(({ code, message, severity, range }) => ({
                code,
                message,
                severity,
                text: sql.slice(range.start, range.end),
            })),
            [
                {
                    code: "TypeNameMaxPrefixError",
                    message:
                        "The type name 'db.dbo.MyType' contains more than the maximum number of prefixes. The maximum is 1.",
                    severity: "error",
                    text: "db.dbo.MyType",
                },
            ],
        );
    });

    // A schema-qualified or bare type name is legal, in every position that takes a type.
    test("accepts type names with at most one prefix", async () => {
        for (const sql of [
            "DECLARE @v int;",
            "SELECT CAST(1 AS int);",
            "CREATE TABLE dbo.T (A int, B sys.sysname);",
        ]) {
            assert.deepEqual(
                (await analyze(sql)).filter(({ code }) => code === "TypeNameMaxPrefixError"),
                [],
                sql,
            );
        }
    });

    // A quoted multipart name is measured by its identifier parts, not by its dots.
    test("counts quoted identifier parts rather than dots", async () => {
        assert.deepEqual(
            (await analyze("DECLARE @v [my.type];")).filter(
                ({ code }) => code === "TypeNameMaxPrefixError",
            ),
            [],
        );
        assert.deepEqual(
            (await analyze("DECLARE @v [a].[b].[c];")).map(({ code }) => code),
            ["TypeNameMaxPrefixError"],
        );
    });

    // An XML schema collection name has the same one-prefix maximum, with its own message.
    test("rejects an over-prefixed XML schema collection with exact output", async () => {
        const sql = "DECLARE @v xml(db.dbo.MyCollection);";
        const diagnostics = await analyze(sql);

        assert.deepEqual(
            diagnostics.map(({ code, message, severity, range }) => ({
                code,
                message,
                severity,
                text: sql.slice(range.start, range.end),
            })),
            [
                {
                    code: "XmlSchemaCollectionMaxPrefixError",
                    message:
                        "The xml schema collection name 'db.dbo.MyCollection' contains more than the maximum number of prefixes. The maximum is 1.",
                    severity: "error",
                    text: "db.dbo.MyCollection",
                },
            ],
        );
    });

    // A legal collection reference stays silent.
    test("accepts an XML schema collection with at most one prefix", async () => {
        for (const sql of ["DECLARE @v xml;", "DECLARE @v xml(dbo.MyCollection);"]) {
            assert.deepEqual(
                (await analyze(sql)).filter(({ code }) => code.endsWith("MaxPrefixError")),
                [],
                sql,
            );
        }
    });

    // A damaged type specification belongs to syntax recovery.
    test("stays silent on a malformed type specification", async () => {
        const diagnostics = await analyze("DECLARE @v varchar(;", {
            allowSyntaxDiagnostics: true,
        });

        assert.deepEqual(
            diagnostics.filter(({ code }) =>
                ["MaximumSizeErrorForAnyType", "TypeNameMaxPrefixError"].includes(code),
            ),
            [],
        );
    });
});
