/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import type * as mssql from "vscode-mssql";
import {
    buildLocalTsqltBatch,
    LocalTsqltContractError,
    normalizeLocalTsqltSelection,
    parseLocalTsqltResult,
} from "../../src/runbookStudio/runtime/localTsqlt";

suite("Runbook Studio local tSQLt contract", () => {
    test("builds only fixed escaped Run and RunAll batches", () => {
        const all = buildLocalTsqltBatch(normalizeLocalTsqltSelection(undefined, undefined));
        expect(all).to.contain("EXEC [tSQLt].[RunAll];");
        expect(all).to.contain("IF NOT EXISTS (SELECT 1 FROM [tSQLt].[TestResult]) THROW;");
        expect(all).not.to.contain("@RunbookFirstResultId");

        const selected = buildLocalTsqltBatch(
            normalizeLocalTsqltSelection("Order]Tests", "test customer's total"),
        );
        expect(selected).to.contain(
            "EXEC [tSQLt].[Run] N'[Order]]Tests].[test customer''s total]';",
        );
        expect(selected).not.to.contain("EXEC [tSQLt].[RunAll]");
    });

    test("refuses test-only, non-string, control-character, and oversized selectors", () => {
        for (const action of [
            () => normalizeLocalTsqltSelection(undefined, "test one"),
            () => normalizeLocalTsqltSelection(42, undefined),
            () => normalizeLocalTsqltSelection("suite\nname", undefined),
            () => normalizeLocalTsqltSelection("s".repeat(129), undefined),
        ]) {
            expect(action)
                .to.throw(LocalTsqltContractError)
                .with.property("errorCode", "RunbookStudio.BindingInvalid");
        }
    });

    test("projects typed tSQLt outcomes and bounds diagnostic messages", () => {
        const result = parseLocalTsqltResult({
            rowCount: 4,
            columnInfo: [
                column("suite_name"),
                column("test_name"),
                column("result"),
                column("message"),
                column("duration_ms"),
            ],
            rows: [
                row("Orders", "test one", "Success", "", "12"),
                row("Orders", "test two", "Failure", "failed", "13"),
                row("Orders", "test three", "Error", "x".repeat(5000), "14"),
                row("Orders", "test four", "Skipped", "disabled", "0"),
            ],
        });

        expect(result).to.deep.include({
            total: 4,
            passed: 1,
            failed: 1,
            errors: 1,
            skipped: 1,
            allPassed: false,
            truncatedMessageCount: 1,
        });
        expect(result.tests[2].message).to.have.length(4096);
    });

    test("refuses empty, duplicate, malformed, and unknown result rows", () => {
        const columns = [
            column("suite_name"),
            column("test_name"),
            column("result"),
            column("message"),
            column("duration_ms"),
        ];
        for (const result of [
            { rowCount: 0, columnInfo: columns, rows: [] },
            {
                rowCount: 2,
                columnInfo: columns,
                rows: [row("S", "test", "Success", "", "1"), row("s", "TEST", "Success", "", "1")],
            },
            {
                rowCount: 1,
                columnInfo: columns.slice(0, 4),
                rows: [row("S", "test", "Success", "", "1")],
            },
            { rowCount: 1, columnInfo: columns, rows: [row("S", "test", "Mystery", "", "1")] },
            { rowCount: 1, columnInfo: columns, rows: [row("S", "test", "Success", "", "-1")] },
        ] as mssql.SimpleExecuteResult[]) {
            expect(() => parseLocalTsqltResult(result)).to.throw(LocalTsqltContractError);
        }
    });
});

function column(columnName: string): mssql.IDbColumn {
    return { columnName } as mssql.IDbColumn;
}

function row(...values: string[]): mssql.DbCellValue[] {
    return values.map((displayValue) => ({ displayValue, isNull: false })) as mssql.DbCellValue[];
}
