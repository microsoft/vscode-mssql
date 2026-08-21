/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";
import {
    applyTextChanges,
    ImmutableTextSnapshot,
    LezerSyntaxService,
} from "../../../../src/index.ts";

import { createSyntaxHarness, syntaxTree } from "../../support/syntaxHarness.ts";
const { assertValid, parse } = createSyntaxHarness("specialized-objects.sql");

suite("T-SQL CLR, XML schema, and external runtime grammar", () => {
    // Verifies assemblies preserve sources, permission settings, file changes, and guarded removal.
    test("parses assembly lifecycle statements", () => {
        const snapshot = parse(`
CREATE ASSEMBLY UtilityAssembly AUTHORIZATION dbo FROM 0x4D5A
WITH PERMISSION_SET = SAFE;
ALTER ASSEMBLY UtilityAssembly FROM 0x4D5B WITH VISIBILITY = ON, UNCHECKED DATA;
ALTER ASSEMBLY UtilityAssembly ADD FILE FROM 0x01 AS N'helper.dll';
ALTER ASSEMBLY UtilityAssembly DROP FILE N'helper.dll';
DROP ASSEMBLY IF EXISTS UtilityAssembly WITH NO DEPENDENTS;
`);

        assertValid(snapshot);
        const tree = snapshot.tree.toString();
        assert.equal((tree.match(/AssemblyStatement\(/g) ?? []).length, 5);
        assert.match(tree, /AssemblyWithClause\(/);
        assert.match(tree, /AssemblyFile\(/);
    });

    // Verifies a CLR aggregate keeps its typed parameters, return type, and assembly entry point.
    test("parses CLR aggregate lifecycle statements", () => {
        const snapshot = parse(`
CREATE AGGREGATE dbo.ConcatValues (@value nvarchar(100) NULL)
RETURNS nvarchar(max) EXTERNAL NAME UtilityAssembly.ConcatValues;
DROP AGGREGATE IF EXISTS dbo.ConcatValues;
`);

        assertValid(snapshot);
        const tree = snapshot.tree.toString();
        assert.match(tree, /AggregateStatement\(/);
        assert.match(tree, /AggregateParameter\(/);
        assert.match(tree, /AssemblyEntryPoint\(/);
    });

    // Verifies XML schema collection creation, extension, and removal retain their schema expression.
    test("parses XML schema collection lifecycle statements", () => {
        const snapshot = parse(`
CREATE XML SCHEMA COLLECTION dbo.ProductSchema AS N'<schema />';
ALTER XML SCHEMA COLLECTION dbo.ProductSchema ADD N'<schema />';
DROP XML SCHEMA COLLECTION dbo.ProductSchema;
`);

        assertValid(snapshot);
        assert.equal(
            (snapshot.tree.toString().match(/XmlSchemaCollectionStatement\(/g) ?? []).length,
            3,
        );
    });

    // Verifies external libraries preserve payload/platform entries and their runtime language.
    test("parses external library lifecycle statements", () => {
        const snapshot = parse(`
CREATE EXTERNAL LIBRARY analytics FROM
    (CONTENT = 0x0102, PLATFORM = WINDOWS),
    (CONTENT = N'/packages/analytics.zip', PLATFORM = LINUX)
WITH (LANGUAGE = N'Python');
ALTER EXTERNAL LIBRARY analytics SET (CONTENT = 0x0103, PLATFORM = WINDOWS)
WITH (LANGUAGE = N'Python');
DROP EXTERNAL LIBRARY analytics;
`);

        assertValid(snapshot);
        const tree = snapshot.tree.toString();
        assert.equal((tree.match(/ExternalLibraryStatement\(/g) ?? []).length, 3);
        assert.equal((tree.match(/ExternalFileDescriptor\(/g) ?? []).length, 3);
    });

    // Verifies external languages preserve file names, platforms, parameters, and environment variables.
    test("parses external language lifecycle statements", () => {
        const snapshot = parse(`
CREATE EXTERNAL LANGUAGE python_runtime FROM
    (CONTENT = 0x0102, FILE_NAME = N'python.dll', PLATFORM = WINDOWS,
     PARAMETERS = N'-E', ENVIRONMENT_VARIABLES = N'PYTHONUTF8=1');
ALTER EXTERNAL LANGUAGE python_runtime ADD
    (CONTENT = 0x0103, FILE_NAME = N'python.so', PLATFORM = LINUX);
ALTER EXTERNAL LANGUAGE python_runtime REMOVE PLATFORM WINDOWS;
DROP EXTERNAL LANGUAGE python_runtime;
`);

        assertValid(snapshot);
        const tree = snapshot.tree.toString();
        assert.equal((tree.match(/ExternalLanguageStatement\(/g) ?? []).length, 4);
        assert.match(tree, /ExternalLanguageDescriptorOption\(EnvironmentVariables/);
    });

    // Verifies a missing CLR entry point is reported at EOF rather than hidden by statement recovery.
    test("reports an incomplete aggregate entry point", () => {
        const sql = "CREATE AGGREGATE dbo.a (@x int) RETURNS int EXTERNAL NAME";
        const snapshot = parse(sql);

        assert.ok(snapshot.statistics.rawErrorNodeCount > 0);
        assert.deepEqual(snapshot.diagnostics, [
            {
                code: "syntax",
                message: "Incorrect syntax near 'End Of File'.",
                severity: "error",
                range: { start: sql.length, end: sql.length },
            },
        ]);
    });

    // Verifies a changed external payload remains structurally equivalent to a fresh parse.
    test("keeps specialized-object incremental and fresh parsing equivalent", () => {
        const service = new LezerSyntaxService();
        const sql =
            "CREATE EXTERNAL LIBRARY analytics FROM (CONTENT = 0x0102) WITH (LANGUAGE = N'Python');";
        const before = new ImmutableTextSnapshot("file:///specialized-objects.sql", 1, sql);
        const previous = service.parse(before);
        const start = sql.indexOf("0102");
        const change = { start, end: start + 4, text: "0103" };
        const after = applyTextChanges(before, 2, [change]);
        const incremental = service.update(previous, after, [change]);
        const fresh = service.parse(after);

        assert.equal(syntaxTree(incremental), syntaxTree(fresh));
        assert.deepEqual(incremental.diagnostics, fresh.diagnostics);
        assert.equal(incremental.statistics.rawErrorNodeCount, 0);
    });
});
