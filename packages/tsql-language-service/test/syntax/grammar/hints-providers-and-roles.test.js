/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");

const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { assertValid, parse } = createSyntaxHarness("hints-providers-and-roles.sql");

suite("T-SQL seek hints, cryptographic providers, server roles, and change tracking", () => {
    // FORCESEEK may name an index by ordinal and then list the seek columns.
    test("parses FORCESEEK index and column arguments", () => {
        assertValid("SELECT * FROM t WITH (FORCESEEK(1(c1)));");
        assertValid("SELECT * FROM t WITH (FORCESEEK(1(c1, c2)));");
        assertValid("SELECT * FROM t WITH (FORCESEEK(nci_abc(a, b)));");
        assertValid("SELECT * FROM t1 OPTION (TABLE HINT (R, FORCESEEK(nci_abc(a, b))));");
    });

    // The plain and index-name hint shapes must not regress.
    test("keeps existing table hint shapes intact", () => {
        assertValid("SELECT * FROM t WITH (FORCESEEK);");
        assertValid("SELECT * FROM t WITH (INDEX(i1));");
        assertValid("SELECT * FROM t WITH (INDEX = i1);");
        assertValid("SELECT * FROM t WITH (NOLOCK, FORCESCAN);");
    });

    // A cryptographic provider registers an external key-management DLL.
    test("parses cryptographic provider statements", () => {
        assertValid("CREATE CRYPTOGRAPHIC PROVIDER cp1 FROM FILE = 'c:\\v1.dll';");
        assertValid("ALTER CRYPTOGRAPHIC PROVIDER cp1 FROM FILE = 'c:\\v1.dll';");
        assertValid("ALTER CRYPTOGRAPHIC PROVIDER cp1 DISABLE;");
        assertValid("ALTER CRYPTOGRAPHIC PROVIDER cp1 ENABLE;");
        assertValid("DROP CRYPTOGRAPHIC PROVIDER cp1;");
    });

    // Server roles are distinct from database roles and carry the same membership actions.
    test("parses server role statements", () => {
        assertValid("CREATE SERVER ROLE r1;");
        assertValid("CREATE SERVER ROLE r1 AUTHORIZATION owner1;");
        assertValid("ALTER SERVER ROLE r1 WITH NAME = newName;");
        assertValid("ALTER SERVER ROLE r1 ADD MEMBER m1;");
        assertValid("ALTER SERVER ROLE r1 DROP MEMBER m1;");
    });

    // Database roles keep their own shapes.
    test("keeps database role statements intact", () => {
        assertValid("CREATE ROLE r1 AUTHORIZATION owner1;");
        assertValid("ALTER ROLE r1 ADD MEMBER m1;");
        assertValid("ALTER ROLE r1 WITH NAME = newName;");
    });

    // An EKM provider supplies symmetric key material instead of a WITH option list.
    test("parses symmetric keys sourced from a provider", () => {
        assertValid("CREATE SYMMETRIC KEY k1 FROM PROVIDER p1 WITH PROVIDER_KEY_NAME = 'k';");
        assertValid(
            "CREATE SYMMETRIC KEY k1 WITH ALGORITHM = AES_256 ENCRYPTION BY PASSWORD = 'p';",
        );
    });

    // ALTER COLUMN toggles metadata attributes including sparseness.
    test("parses ALTER COLUMN attribute toggles", () => {
        assertValid("ALTER TABLE t1 ALTER COLUMN c1 ADD SPARSE;");
        assertValid("ALTER TABLE t1 ALTER COLUMN c1 DROP SPARSE;");
        assertValid("ALTER TABLE t1 ALTER COLUMN c1 ADD ROWGUIDCOL;");
        assertValid("ALTER TABLE t1 ALTER COLUMN c1 DROP PERSISTED;");
    });

    // A DML statement may stamp a change-tracking context in its WITH header.
    test("parses CHANGE_TRACKING_CONTEXT in a DML WITH header", () => {
        assertValid("WITH CHANGE_TRACKING_CONTEXT (0xff) INSERT t1 DEFAULT VALUES;");
        assertValid(
            "WITH CHANGE_TRACKING_CONTEXT (0xff), DirReps(c1, c2) AS (SELECT c1, c2 FROM t1) UPDATE t1 SET c1 = 1;",
        );
        assertValid("WITH CHANGE_TRACKING_CONTEXT (@ctx) DELETE FROM t1;");
    });

    // Ordinary CTE headers keep working on both DML and SELECT.
    test("keeps ordinary CTE headers intact", () => {
        assertValid("WITH c1(a) AS (SELECT 1) SELECT * FROM c1;");
        assertValid("WITH c1(a) AS (SELECT 1) INSERT t1 SELECT * FROM c1;");
        assertValid("WITH c1(a) AS (SELECT 1) UPDATE t1 SET x = 1;");
    });

    // A damaged provider clause must not leak past its GO batch.
    test("keeps a damaged cryptographic provider clause inside its GO batch", () => {
        const snapshot = parse("ALTER CRYPTOGRAPHIC PROVIDER cp1 FROM FILE =\nGO\nSELECT 1;");
        assert.ok(snapshot.diagnostics.length > 0);
        assert.match(snapshot.tree.toString(), /BatchSeparator\(Go\)/);
        assert.equal(parse("SELECT 1;").statistics.rawErrorNodeCount, 0);
    });
});
