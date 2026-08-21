/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";
const { assertValid, parse } = createSyntaxHarness("change-tracking-and-federation.sql");

suite("T-SQL change tracking, federations, and key sources", () => {
    // CHANGETABLE targets accept SQL Server's omitted multipart components.
    test("parses CHANGETABLE with omitted multipart targets", () => {
        assertValid(
            "SELECT * FROM CHANGETABLE(VERSION z..t1, (c1, c2), ('a', 'b')) AS a (z1, z2);",
        );
        assertValid("SELECT * FROM CHANGETABLE(CHANGES d1.dbo.t1, NULL) AS a;");
        assertValid("SELECT * FROM CHANGETABLE(CHANGES ..t1, @v) AS a;");
    });

    // The private-key clause mixes named options with the multiword password forms.
    test("parses certificate private key clauses", () => {
        assertValid("BACKUP CERTIFICATE c1 TO FILE = 'f1';");
        assertValid(
            "BACKUP CERTIFICATE c1 TO FILE = 'f1' WITH PRIVATE KEY (FILE = 'f2', ENCRYPTION BY PASSWORD = 'p1');",
        );
        assertValid(
            "CREATE CERTIFICATE c1 FROM FILE = 'f1' WITH PRIVATE KEY (FILE = 'f2', DECRYPTION BY PASSWORD = 'p1', ENCRYPTION BY PASSWORD = 'p2');",
        );
    });

    // An asymmetric key may state a source and a signing algorithm together.
    test("parses asymmetric key sources with an algorithm", () => {
        assertValid("CREATE ASYMMETRIC KEY k1 FROM PROVIDER p1 WITH ALGORITHM = DES;");
        assertValid("CREATE ASYMMETRIC KEY k1 WITH ALGORITHM = RSA_2048;");
        assertValid("CREATE ASYMMETRIC KEY k1 FROM FILE = 'f1' ENCRYPTION BY PASSWORD = 'p';");
        assertValid("CREATE ASYMMETRIC KEY k1 FROM ASSEMBLY a1;");
    });

    // Reserved words are legitimate option values in SET option lists.
    test("parses reserved words as table option values", () => {
        assertValid("ALTER TABLE t1 SET (LOCK_ESCALATION = AUTO, LOCK_ESCALATION = TABLE);");
        assertValid("ALTER TABLE t1 SET (LOCK_ESCALATION = DISABLE);");
    });

    // Remote service bindings tie a Service Broker service to a principal and certificate.
    test("parses remote service binding statements", () => {
        assertValid("CREATE REMOTE SERVICE BINDING b1 TO SERVICE 'svc' WITH USER = u1;");
        assertValid("ALTER REMOTE SERVICE BINDING b1 WITH USER = u1;");
        assertValid("ALTER REMOTE SERVICE BINDING b1 WITH USER = u1, ANONYMOUS = OFF;");
        assertValid("DROP REMOTE SERVICE BINDING b1;");
    });

    // Azure SQL Database federations are deprecated but retained for existing scripts.
    test("parses federation statements", () => {
        assertValid("CREATE FEDERATION f1 (k1 bigint RANGE);");
        assertValid("ALTER FEDERATION f1 SPLIT AT (k1 = 10);");
        assertValid("ALTER FEDERATION f1 DROP AT (LOW k1 = 20);");
        assertValid("ALTER FEDERATION f1 DROP AT (HIGH k1 = 20);");
        assertValid("DROP FEDERATION fed1;");
        assertValid("USE FEDERATION f1 (d1 = 20) WITH FILTERING = ON, RESET;");
        assertValid("USE FEDERATION ROOT WITH RESET;");
    });

    // An ordinary USE statement must not be captured by the federation form.
    test("keeps ordinary USE statements intact", () => {
        assertValid("USE tempdb;");
        const snapshot = assertValid("USE tempdb;\nSELECT 1;");
        assert.match(snapshot.tree.toString(), /UseStatement\(/);
    });

    // A damaged federation clause must not leak past its GO batch.
    test("keeps a damaged federation clause inside its GO batch", () => {
        const snapshot = parse("ALTER FEDERATION f1 SPLIT AT (\nGO\nSELECT 1;");
        assert.ok(snapshot.diagnostics.length > 0);
        assert.match(snapshot.tree.toString(), /BatchSeparator\(Go\)/);
        assert.equal(parse("SELECT 1;").statistics.rawErrorNodeCount, 0);
    });
});
