/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { fold, script } from "../../support/foldingHarness.ts";

suite("GitHub issue folding regressions", () => {
    test("folds nested T-SQL control-flow blocks (vscode-mssql#17884; azuredatastudio#22629)", () => {
        const { described } = fold(
            script(
                "CREATE PROCEDURE dbo.ProcessItems",
                "AS",
                "BEGIN",
                "    IF @enabled = 1",
                "    BEGIN",
                "        SELECT 1;",
                "    END",
                "END;",
            ),
        );

        assert.ok(described.includes("0-7 code"));
        assert.ok(described.includes("2-7 code"));
        assert.ok(described.includes("4-6 code"));
    });

    test("folds SQL region markers (vscode-mssql#1183, #19570; azuredatastudio#4900)", () => {
        const { described } = fold(
            script(
                "-- #region setup",
                "CREATE TABLE #work (Id int);",
                "SELECT * FROM #work;",
                "-- #endregion setup",
            ),
        );

        assert.deepEqual(
            described.filter((range) => range.endsWith(" region")),
            ["0-3 region"],
        );
    });

    test("does not include trailing blank lines in a fold (azuredatastudio#23167)", () => {
        const { described } = fold(script("BEGIN", "    SELECT 1;", "END;", "", "", "SELECT 2;"));

        assert.ok(described.includes("0-2 code"));
        assert.ok(!described.includes("0-4 code"));
    });
});
