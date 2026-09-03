/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";

const { assertValid, parse } = createSyntaxHarness("ledger-table-options.sql");

const ledgerListExpectation = "Expecting CTWL_APPEND_ONLY, or CTWL_LEDGER_VIEW.";
const ledgerViewListExpectation =
    "Expecting CTWL_LV_OPERATION_TYPE_DESC_COLUMN_NAME, CTWL_LV_OPERATION_TYPE_ID_COLUMN_NAME," +
    " CTWL_LV_SEQUENCE_NUMBER_COLUMN_NAME, or CTWL_LV_TRANSACTION_ID_COLUMN_NAME.";

const ledgerViewColumns =
    "transaction_id_column_name = transaction_id," +
    " sequence_number_column_name = sequence_number," +
    " operation_type_column_name = operation_type," +
    " operation_type_desc_column_name = operation_type_desc";

suite("ledger table option diagnostics", () => {
    test("accepts the supported ledger option shapes", () => {
        assertValid("create table t (a int) with (system_versioning = on, ledger = on)");
        assertValid("create table t (a int) with (ledger = on (append_only = on))");
        assertValid("create table t (a int) with (ledger = on (ledger_view = dbo.v))");
        assertValid(
            "create table t (a int) with (ledger = on (ledger_view = dbo.v, append_only = on))",
        );
        assertValid(
            `create table t (a int) with (ledger = on (ledger_view = dbo.v (${ledgerViewColumns})))`,
        );
        assertValid(
            "create table t (a int) with" +
                ` (ledger = on (ledger_view = dbo.v (${ledgerViewColumns}), append_only = on))`,
        );
        assertValid("create table t (a int) with (ledger = off)");
    });

    test("accepts the supported generated column boundaries", () => {
        assertValid(
            "create table t (\n" +
                "  a int,\n" +
                "  ts bigint generated always as transaction_id start not null,\n" +
                "  te bigint generated always as transaction_id end null,\n" +
                "  ss bigint generated always as sequence_number start not null,\n" +
                "  se bigint generated always as sequence_number end null,\n" +
                "  rs datetime2 generated always as row start not null,\n" +
                "  re datetime2 generated always as row end not null)",
        );
    });

    test("rejects ledger option words used as table options", () => {
        for (const word of ["append_only", "ledger_view"]) {
            const sql = `create table t (a int) with (ledger = on (append_only = on), ${word} = on)`;
            const start = sql.lastIndexOf(word);
            assert.deepEqual(
                parse(sql).diagnostics,
                [
                    {
                        code: "syntax",
                        message: `Incorrect syntax near '${word}'.`,
                        severity: "error",
                        range: { start, end: start + word.length },
                    },
                ],
                sql,
            );
        }
    });

    test("rejects unknown words inside the ledger option list", () => {
        const sql = "create table t (a int) with (ledger = on (transaction_id_column_name = ticn))";
        const start = sql.indexOf("transaction_id_column_name");
        assert.deepEqual(parse(sql).diagnostics, [
            {
                code: "syntax",
                message: `Incorrect syntax near 'transaction_id_column_name'.  ${ledgerListExpectation}`,
                severity: "error",
                range: { start, end: start + "transaction_id_column_name".length },
            },
        ]);
    });

    test("rejects unknown words inside the ledger view column list", () => {
        const sql =
            "create table t (a int) with (ledger = on (ledger_view = dbo.lv (" +
            "transaction_id_column_name = ticn, sequence_number_column_name = sncn," +
            " operation_type_id_column_name = opticn," +
            " operation_type_desc_column_name = otdcn)))";
        const start = sql.indexOf("operation_type_id_column_name");
        assert.deepEqual(parse(sql).diagnostics, [
            {
                code: "syntax",
                message:
                    "Incorrect syntax near 'operation_type_id_column_name'.  " +
                    ledgerViewListExpectation,
                severity: "error",
                range: { start, end: start + "operation_type_id_column_name".length },
            },
        ]);
    });

    test("rejects an unmodeled generated column boundary", () => {
        const sql =
            "create table t (a int, ts bigint generated always as transaction_id_start start null)";
        const start = sql.indexOf("transaction_id_start");
        assert.deepEqual(parse(sql).diagnostics, [
            {
                code: "syntax",
                message: "Incorrect syntax near 'transaction_id_start'.",
                severity: "error",
                range: { start, end: start + "transaction_id_start".length },
            },
        ]);
    });

    test("keeps ledger option checks inside their own statement", () => {
        const sql =
            "create table a (c int) with (ledger = on (append_only = on));\n" +
            "go\n" +
            "create table b (c int) with (ledger = on (bogus_option = on));\n" +
            "go\n" +
            "select 1;\n";
        const start = sql.indexOf("bogus_option");
        assert.deepEqual(parse(sql).diagnostics, [
            {
                code: "syntax",
                message: `Incorrect syntax near 'bogus_option'.  ${ledgerListExpectation}`,
                severity: "error",
                range: { start, end: start + "bogus_option".length },
            },
        ]);
    });

    test("leaves unrelated table options alone", () => {
        assertValid(
            "create table t (a int) with (data_compression = page, memory_optimized = on," +
                " durability = schema_only)",
        );
        assertValid("create table t (a int) with (system_versioning = on (history_table = dbo.h))");
    });

    test("does not report ledger words that a damaged statement swallowed", () => {
        const sql = "create table t (a int) with (ledger = on (append_only";
        assert.ok(
            parse(sql).diagnostics.every(({ message }) => !message.includes("CTWL_APPEND_ONLY")),
            "recovered ledger lists must not add option-word diagnostics",
        );
    });
});
