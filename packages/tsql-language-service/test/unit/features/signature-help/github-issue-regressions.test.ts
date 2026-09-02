/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    TsqlLanguageFeatureService,
} from "../../../../src/index.ts";
import { requiredSignatureHelp } from "../../support/assertions.ts";
import { object } from "../../support/catalogFeatureHarness.ts";

function services() {
    const metadata = new InMemoryMetadataProvider({
        environment: { currentDatabase: "db", defaultSchema: "dbo" },
        databases: [{ name: "db" }],
        schemas: [{ database: "db", name: "dbo" }],
        objects: [
            object("save", "dbo", "SaveOrder", "procedure", "db"),
            object("customers", "dbo", "Customers", "table", "db"),
        ],
        columns: new Map([
            [
                "customers",
                [
                    { name: "Code", typeDisplay: "char(10)", nullable: false },
                    { name: "Label", typeDisplay: "varchar(max)", nullable: true },
                    { name: "LocalizedLabel", typeDisplay: "nvarchar(50)", nullable: false },
                    { name: "Amount", typeDisplay: "decimal(18,4)", nullable: false },
                    { name: "Ratio", typeDisplay: "numeric(12,6)", nullable: true },
                    { name: "Payload", typeDisplay: "varbinary(max)", nullable: true },
                    { name: "OccurredAt", typeDisplay: "datetime2(7)", nullable: false },
                    { name: "LocalTime", typeDisplay: "time(3)", nullable: false },
                    { name: "OffsetAt", typeDisplay: "datetimeoffset(2)", nullable: false },
                ],
            ],
        ]),
        parameters: new Map([
            [
                "save",
                [
                    { ordinal: 1, name: "@OrderId", typeDisplay: "int" },
                    { ordinal: 2, name: "@Note", typeDisplay: "nvarchar(100)", hasDefault: true },
                ],
            ],
        ]),
    });
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        metadata,
    );
    return { runtime, features: new TsqlLanguageFeatureService(runtime, metadata) };
}

suite("GitHub issue signature and hover regressions", () => {
    test("provides variadic COALESCE signature help (SqlParser#6, vscode-mssql#351)", async () => {
        const { runtime, features } = services();
        const uri = "file:///coalesce-signature.sql";
        const sql = "SELECT COALESCE(first_value, second_value, ";
        await runtime.open(uri, 1, sql);

        const help = requiredSignatureHelp(features.signatureHelp(uri, 1, sql.length));

        assert.equal(help.signatures[0].label, "COALESCE(expression, expression, ...expression)");
        assert.equal(help.activeParameter, 2);
    });

    test("describes CHARINDEX without incorrect varchar(1) parameter types (SqlParser#11)", async () => {
        const { runtime, features } = services();
        const uri = "file:///charindex-hover.sql";
        const sql = "SELECT CHARINDEX('x', ColumnValue);";
        await runtime.open(uri, 1, sql);

        const hover = features.hover(uri, 1, sql.indexOf("CHARINDEX") + 2);

        assert.ok(hover);
        assert.match(hover.markdown, /CHARINDEX/u);
        assert.doesNotMatch(hover.markdown, /varchar\(1\)/iu);
    });

    test("provides stored-procedure parameter help (vscode-mssql#351; azuredatastudio#8295)", async () => {
        const { runtime, features } = services();
        const uri = "file:///procedure-signature.sql";
        const sql = "EXEC dbo.SaveOrder @OrderId = 1, @Note = ";
        await runtime.open(uri, 1, sql);

        const help = requiredSignatureHelp(features.signatureHelp(uri, 1, sql.length));

        assert.equal(help.activeParameter, 1);
        assert.deepEqual(
            help.signatures[0].parameters.map(({ label }) => label),
            ["@OrderId int", "@Note nvarchar(100) = DEFAULT"],
        );
    });

    test("shows complete catalog column types in hover (sqltoolsservice#2746; vscode-mssql#20212)", async () => {
        const { runtime, features } = services();
        const uri = "file:///column-type-hover.sql";
        const expectedTypes = new Map([
            ["Code", "char(10) NOT NULL"],
            ["Label", "varchar(max) NULL"],
            ["LocalizedLabel", "nvarchar(50) NOT NULL"],
            ["Amount", "decimal(18,4) NOT NULL"],
            ["Ratio", "numeric(12,6) NULL"],
            ["Payload", "varbinary(max) NULL"],
            ["OccurredAt", "datetime2(7) NOT NULL"],
            ["LocalTime", "time(3) NOT NULL"],
            ["OffsetAt", "datetimeoffset(2) NOT NULL"],
        ]);
        const sql = `SELECT ${[...expectedTypes.keys()].join(", ")} FROM dbo.Customers;`;
        await runtime.open(uri, 1, sql);

        for (const [column, expectedType] of expectedTypes) {
            const hover = features.hover(uri, 1, sql.indexOf(column) + 1);
            assert.ok(hover, `expected hover for ${column}`);
            assert.ok(
                hover.markdown.includes(`Type: \`${expectedType}\``),
                `expected ${column} hover to include ${expectedType}: ${hover.markdown}`,
            );
        }
    });
});
