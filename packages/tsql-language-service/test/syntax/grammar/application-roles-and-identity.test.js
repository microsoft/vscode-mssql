/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");

// Every positive form here was confirmed against ScriptDOM before the grammar was changed.
const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { assertValid, parse } = createSyntaxHarness("application-roles-and-identity.sql");

suite("T-SQL application roles, IDENTITY projection, and constraint storage", () => {
    // An application role carries a password and an optional default schema.
    test("parses application role statements", () => {
        assertValid("CREATE APPLICATION ROLE weekly_receipts WITH PASSWORD = '987';");
        assertValid(
            "CREATE APPLICATION ROLE [weekly_receipts] WITH PASSWORD = 'p', DEFAULT_SCHEMA = Sales;",
        );
        assertValid("ALTER APPLICATION ROLE wr WITH NAME = wr2, PASSWORD = 'p';");
        assertValid("DROP APPLICATION ROLE wr;");
    });

    // Database and server roles keep their own shapes.
    test("keeps database and server roles intact", () => {
        assertValid("CREATE ROLE r1 AUTHORIZATION owner1;");
        assertValid("ALTER SERVER ROLE r1 ADD MEMBER m1;");
    });

    // SELECT ... INTO may generate an identity column. IDENTITY is reserved, so the call has its
    // own production rather than the ordinary function-call path.
    test("parses IDENTITY projection in SELECT INTO", () => {
        assertValid("SELECT Identity(int) AS c1 INTO t2 FROM t1;");
        assertValid("SELECT Identity(tinyint, 10, 5) AS c1 INTO t2 FROM t1;");
        assertValid("SELECT Identity(decimal(10,0), - 100, 5) AS c1 INTO t2 FROM t1;");
    });

    // The IDENTITY column option and the ordinary function-call path must not regress.
    test("keeps IDENTITY column options and ordinary calls intact", () => {
        assertValid("CREATE TABLE t (c1 int IDENTITY(1, 1) NOT NULL);");
        assertValid("CREATE TABLE t (c1 int IDENTITY NOT FOR REPLICATION);");
        assertValid("SELECT dbo.f(1, 2) FROM t1;");
    });

    // A constraint's storage target may name a partition scheme and its partitioning column.
    test("parses constraint storage clauses naming a partition column", () => {
        assertValid("CREATE TABLE t (a9 int CONSTRAINT C3 UNIQUE Clustered ON partScheme(col));");
        assertValid(
            "CREATE TABLE t (a1 int, a2 int, CONSTRAINT C19 UNIQUE Clustered (a1 asc, a2 desc) WITH FILLFACTOR = 34 ON MyGroup(c2));",
        );
    });

    // Ordinary filegroup storage keeps working.
    test("keeps ordinary storage clauses intact", () => {
        assertValid("CREATE TABLE t (c1 int) ON [PRIMARY];");
        assertValid("CREATE TABLE t (c1 int, CONSTRAINT pk PRIMARY KEY (c1) ON [PRIMARY]);");
    });

    // A damaged application role clause must not leak past its GO batch.
    test("keeps a damaged application role clause inside its GO batch", () => {
        const snapshot = parse("CREATE APPLICATION ROLE r WITH PASSWORD =\nGO\nSELECT 1;");
        assert.ok(snapshot.diagnostics.length > 0);
        assert.match(snapshot.tree.toString(), /BatchSeparator\(Go\)/);
        assert.equal(parse("SELECT 1;").statistics.rawErrorNodeCount, 0);
    });
});
