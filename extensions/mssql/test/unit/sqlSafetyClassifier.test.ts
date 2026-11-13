/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { isModifyingSql } from "../../src/sql/sqlSafetyClassifier";

suite("Query Studio production SQL guard", () => {
    test("warns for implicit procedure calls at the start of every batch", () => {
        for (const sql of [
            "dbo.PurgeData;",
            "[dbo].[PurgeData];",
            '"dbo"."PurgeData";',
            "sp_who;",
            "SELECT 1;\nGO 2\n/* nested /* c */ */ dbo.PurgeData;",
            "\n-- comment\nPurgeData @x = 1;",
        ]) {
            expect(isModifyingSql(sql), sql).to.equal(true);
        }
    });

    test("warns for SQLCMD includes whose contents are not available at preflight", () => {
        expect(isModifyingSql(':r "deploy.sql"')).to.equal(true);
        expect(isModifyingSql("SELECT 1;\nGO\n  :r deploy.sql")).to.equal(true);
    });

    test("keeps reads and quoted/commented commands free of warnings", () => {
        for (const sql of [
            "SELECT [Delete], 'DROP TABLE x' FROM t;",
            "-- :r deploy.sql\nSELECT 1",
            "SELECT '\n:r deploy.sql\n'",
            "/*\n:r deploy.sql\n*/\nSELECT 1",
            'SELECT "DROP""TABLE" FROM t;',
            "WITH c AS (SELECT 1 AS n) SELECT * FROM c;",
            "SELECT 1\nGO\nSELECT 2",
        ]) {
            expect(isModifyingSql(sql), sql).to.equal(false);
        }
    });
});
