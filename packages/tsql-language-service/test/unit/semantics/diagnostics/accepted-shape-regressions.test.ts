/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSemanticHarness } from "../../support/semanticHarness.ts";

const { analyze } = createSemanticHarness({ uri: "file:///accepted-shapes.sql" });

const codes = async (
    sql: string,
    options?: { readonly allowSyntaxDiagnostics?: boolean },
): Promise<readonly string[]> => (await analyze(sql, options)).map(({ code }) => code);

/**
 * Shapes an earlier rule reported that Transact-SQL accepts. Each one is a construct a user writes
 * on purpose, so a diagnostic on it is worse than no diagnostic at all.
 */
suite("shapes no diagnostic may claim", () => {
    test("a computed column takes its type from its expression", async () => {
        assert.deepEqual(
            await codes(
                "CREATE TABLE t (Yr INT NOT NULL, Mo INT NOT NULL," +
                    " FinalDate AS (DATEFROMPARTS(Yr, Mo, 1)));",
            ),
            [],
        );
        assert.deepEqual(await codes("CREATE TABLE t (a int, b AS a + 1 PERSISTED);"), []);
    });

    test("a column with neither a type nor an expression is still reported", async () => {
        assert.deepEqual(
            await codes("CREATE TABLE t (MissingType);", { allowSyntaxDiagnostics: true }),
            ["DataTypeMissing"],
        );
    });

    test("every documented date part abbreviation is recognized", async () => {
        for (const part of ["m", "y", "d", "w", "mi", "n", "q", "s", "yy", "mm", "dd", "wk"]) {
            assert.deepEqual(
                await codes(`SELECT DATEPART(${part}, GETDATE());`),
                [],
                `DATEPART(${part})`,
            );
        }
        assert.deepEqual(await codes("SELECT DATEPART(bogus, GETDATE());"), [
            "NotRecognizedDatePartOption",
        ]);
    });

    test("an alias type may be based on any system type but the CLR and XML ones", async () => {
        for (const base of [
            "int",
            "varchar(10)",
            "json",
            "sysname",
            "vector(1536)",
            "numeric(18)",
        ]) {
            assert.deepEqual(await codes(`CREATE TYPE t FROM ${base};`), [], base);
        }
        for (const base of ["geography", "geometry", "hierarchyid", "xml"]) {
            assert.deepEqual(
                await codes(`CREATE TYPE t FROM ${base};`),
                ["InvalidBaseTypeForAlias"],
                base,
            );
        }
    });

    test("the approximate and checksum aggregates are known routines", async () => {
        assert.deepEqual(await codes("SELECT APPROX_COUNT_DISTINCT(1);"), []);
        assert.deepEqual(await codes("SELECT CHECKSUM_AGG(1);"), []);
        assert.deepEqual(await codes("SELECT NOT_A_FUNCTION(1);"), ["NotRecognizedFunctionName"]);
    });
});
