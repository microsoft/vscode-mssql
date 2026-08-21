/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { SqlCmdDocumentService } from "../../../src/index.ts";

const uri = "file:///github-sqlcmd-regressions.sql";

suite("GitHub issue SQLCMD regressions", () => {
    test("projects setvar references without SQL syntax diagnostics (azuredatastudio#17691)", () => {
        const sql = ':setvar database "ApplicationDb"\nUSE [$(database)];\nSELECT 1;';
        const snapshot = new SqlCmdDocumentService().parse(uri, 1, sql);

        assert.equal(snapshot.projectedSql.includes(":setvar"), false);
        assert.match(snapshot.projectedSql, /USE \[ApplicationDb\]/u);
        assert.deepEqual(snapshot.diagnostics, []);
    });

    test("recognizes error redirection as a SQLCMD directive (azuredatastudio#20325)", () => {
        const sql = ':error "errors.txt"\nSELECT 1;';
        const snapshot = new SqlCmdDocumentService().parse(uri, 1, sql);

        assert.equal(snapshot.directives[0]?.kind, "error");
        assert.equal(snapshot.projectedSql.includes(":error"), false);
        assert.deepEqual(snapshot.diagnostics, []);
    });

    test("keeps GO while removing a valid repeat count from projected SQL (azuredatastudio#7842)", () => {
        const snapshot = new SqlCmdDocumentService().parse(uri, 1, "SELECT 1;\nGO 10\n");

        assert.match(snapshot.projectedSql, /GO\n/u);
        assert.equal(snapshot.projectedSql.includes("GO 10"), false);
        assert.deepEqual(snapshot.diagnostics, []);
    });

    test("recognizes XML output mode as a SQLCMD directive (SqlParser#14)", () => {
        const snapshot = new SqlCmdDocumentService().parse(uri, 1, ":XML ON\nSELECT 1;\n");

        assert.equal(snapshot.directives[0]?.kind, "xmlMode");
        assert.equal(snapshot.projectedSql.includes(":XML"), false);
        assert.deepEqual(snapshot.diagnostics, []);
    });
});
