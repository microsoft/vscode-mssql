/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    analyzeRepositorySqlTests,
    MAX_DISCOVERED_SQL_TESTS,
} from "../../src/runbookStudio/runtime/repositorySqlTestDiscovery";

suite("Runbook Studio repository SQL test discovery", () => {
    test("finds tSQLt classes and test procedures across files in stable order", () => {
        const result = analyzeRepositorySqlTests([
            {
                relativePath: "tests/ZetaTests.sql",
                text: [
                    "CREATE OR ALTER PROCEDURE [OrderTests].[test total is correct] AS",
                    "BEGIN EXEC tSQLt.AssertEquals 1, 1; END",
                ].join("\n"),
            },
            {
                relativePath: "tests/classes.sql",
                text: "EXEC tSQLt.NewTestClass @ClassName = N'CustomerTests';",
            },
            {
                relativePath: "tests/CustomerTests.sql",
                text: [
                    "CREATE PROC [CustomerTests].[test_email_is_unique] AS SELECT 1;",
                    "CREATE PROCEDURE [CustomerTests].[helper] AS SELECT 1;",
                ].join("\n"),
            },
        ]);

        expect(result).to.deep.include({
            tSqltClassCount: 2,
            tSqltSourceFileCount: 2,
            duplicateDefinitionCount: 0,
            truncated: false,
        });
        expect(result.tests).to.deep.equal([
            {
                framework: "tSQLt",
                suite: "CustomerTests",
                name: "test_email_is_unique",
                relativePath: "tests/CustomerTests.sql",
                line: 1,
            },
            {
                framework: "tSQLt",
                suite: "OrderTests",
                name: "test total is correct",
                relativePath: "tests/ZetaTests.sql",
                line: 1,
            },
        ]);
    });

    test("ignores comments, string examples, helpers, and unrelated test-named procedures", () => {
        const result = analyzeRepositorySqlTests([
            {
                relativePath: "ordinary.sql",
                text: [
                    "-- CREATE PROC [NotTests].[test commented] AS SELECT 1;",
                    "SELECT N'CREATE PROC [NotTests].[test string] AS SELECT 1';",
                    "CREATE PROC [NotTests].[test real but not tSQLt] AS SELECT 1;",
                    "/* EXEC tSQLt.NewTestClass N'NotTests'; */",
                ].join("\n"),
            },
        ]);
        expect(result.tests).to.deep.equal([]);
        expect(result.tSqltClassCount).to.equal(0);
    });

    test("deduplicates identities and bounds retained test metadata", () => {
        const definitions = Array.from(
            { length: MAX_DISCOVERED_SQL_TESTS + 1 },
            (_value, index) =>
                `CREATE PROC [ManyTests].[test_${index.toString().padStart(4, "0")}] AS EXEC tSQLt.AssertEquals 1, 1;`,
        );
        definitions.push(definitions[0]);
        const result = analyzeRepositorySqlTests([
            { relativePath: "many.sql", text: definitions.join("\n") },
        ]);

        expect(result.tests).to.have.length(MAX_DISCOVERED_SQL_TESTS);
        expect(result.duplicateDefinitionCount).to.equal(1);
        expect(result.truncated).to.equal(true);
    });
});
