/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { suite, test } = require("node:test");

const { createSyntaxHarness } = require("../../support/syntaxHarness.js");
const { assertValid, parse } = createSyntaxHarness("unpivot-partition-and-copy.sql");

// Distributed tables and COPY INTO belong to the analytics engines, so those structural
// fixtures are read under the dedicated SQL pool profile.
const analyticsProfile = {
    engineProfile: "azure-synapse-dedicated",
    serverMajorVersion: 13,
    compatibilityLevel: 130,
    previewFeatures: false,
};

suite("T-SQL UNPIVOT column lists, partition range changes, and COPY options", () => {
    // The unpivoted column list parses multipart names so a qualified name is diagnosed by
    // validation rather than collapsing into recovery.
    test("parses qualified names in an UNPIVOT column list", () => {
        assertValid("SELECT * FROM t1 CROSS APPLY t2 UNPIVOT (q FOR n IN (t1.c0, c1)) AS a;");
        assertValid("SELECT * FROM t1 UNPIVOT (q FOR n IN (dbo.t1.c0, c1, c2)) AS a;");
    });

    // The ordinary unqualified list and PIVOT must not regress.
    test("keeps ordinary UNPIVOT and PIVOT forms intact", () => {
        assertValid("SELECT * FROM t1 UNPIVOT (q FOR n IN (c1, c2)) AS a;");
        assertValid("SELECT * FROM t1 PIVOT (SUM(c) FOR n IN ([a], [b])) AS p;");
        assertValid("SELECT * FROM t1 CROSS APPLY dbo.f(t1.a) AS x;");
    });

    // A partitioned table merges or splits one boundary range in place.
    test("parses ALTER TABLE partition range changes", () => {
        assertValid("ALTER TABLE T MERGE RANGE ('2004-01-01');");
        assertValid("ALTER TABLE T SPLIT RANGE ('2004-01-01');");
        assertValid("ALTER TABLE T SPLIT RANGE (@boundary);");
    });

    // The other ALTER TABLE actions keep working.
    test("keeps other ALTER TABLE actions intact", () => {
        assertValid("ALTER TABLE t1 REBUILD PARTITION = ALL;");
        assertValid("ALTER TABLE t1 SWITCH PARTITION 1 TO t2 PARTITION 1;");
        assertValid("ALTER TABLE t1 ADD c1 int NULL;");
    });

    // IDENTITY_INSERT is a reserved SET option name that is also a COPY option name.
    test("parses IDENTITY_INSERT as a COPY option", () => {
        // COPY INTO belongs to the analytics engines, so its structural fixtures are read under the
        // dedicated SQL pool profile; the availability gate is covered by the dialect inventory.
        assertValid("COPY INTO t FROM 'x' WITH (IDENTITY_INSERT = 'ON');", analyticsProfile);
        assertValid(
            "COPY INTO t FROM 'x' WITH (FILE_TYPE = 'CSV', IDENTITY_INSERT = 'OFF');",
            analyticsProfile,
        );
    });

    // The SET statement form of IDENTITY_INSERT is unaffected.
    test("keeps SET IDENTITY_INSERT intact", () => {
        assertValid("SET IDENTITY_INSERT dbo.Target ON;");
    });

    // A damaged range clause must not leak past its GO batch.
    test("keeps a damaged partition range inside its GO batch", () => {
        const snapshot = parse("ALTER TABLE T MERGE RANGE (\nGO\nSELECT 1;");
        assert.ok(snapshot.diagnostics.length > 0);
        assert.match(snapshot.tree.toString(), /BatchSeparator\(Go\)/);
        assert.equal(parse("SELECT 1;").statistics.rawErrorNodeCount, 0);
    });
});
