/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import type { IDbColumn, DbCellValue } from "vscode-mssql";
import { toPlain, toHtml } from "../../src/notebooks/resultFormatter";

function makeColumn(name: string): IDbColumn {
    return { columnName: name } as IDbColumn;
}

function makeCell(value: string, isNull = false): DbCellValue {
    return { displayValue: value, isNull } as DbCellValue;
}

suite("resultFormatter", () => {
    suite("toPlain", () => {
        test("returns zero rows message for empty result set", () => {
            const result = toPlain([makeColumn("id")], []);
            expect(result).to.include("(0 rows)");
        });

        test("formats single column single row", () => {
            const columns = [makeColumn("name")];
            const rows = [[makeCell("Alice")]];
            const result = toPlain(columns, rows);
            expect(result).to.include("name");
            expect(result).to.include("Alice");
            expect(result).to.include("(1 row)");
        });

        test("formats multiple columns", () => {
            const columns = [makeColumn("id"), makeColumn("name")];
            const rows = [
                [makeCell("1"), makeCell("Alice")],
                [makeCell("2"), makeCell("Bob")],
            ];
            const result = toPlain(columns, rows);
            expect(result).to.include("id");
            expect(result).to.include("name");
            expect(result).to.include("Alice");
            expect(result).to.include("Bob");
            expect(result).to.include("(2 rows)");
        });

        test("displays NULL for null values", () => {
            const columns = [makeColumn("val")];
            const rows = [[makeCell("", true)]];
            const result = toPlain(columns, rows);
            expect(result).to.include("NULL");
        });

        test("includes separator line", () => {
            const columns = [makeColumn("id")];
            const rows = [[makeCell("1")]];
            const result = toPlain(columns, rows);
            const lines = result.split("\n");
            // Second line should be the separator
            expect(lines[1]).to.match(/^-+$/);
        });
    });

    suite("toHtml", () => {
        test("generates table with column headers", () => {
            const columns = [makeColumn("id"), makeColumn("name")];
            const rows = [[makeCell("1"), makeCell("Alice")]];
            const result = toHtml(columns, rows);
            expect(result).to.include("<table");
            expect(result).to.include("id");
            expect(result).to.include("name");
            expect(result).to.include("Alice");
        });

        test("escapes HTML characters in cell values", () => {
            const columns = [makeColumn("val")];
            const rows = [[makeCell("<script>alert('xss')</script>")]];
            const result = toHtml(columns, rows);
            expect(result).to.not.include("<script>alert");
            expect(result).to.include("&lt;script&gt;");
        });

        test("shows row count", () => {
            const columns = [makeColumn("id")];
            const rows = [[makeCell("1")], [makeCell("2")]];
            const result = toHtml(columns, rows);
            expect(result).to.include("(2 rows)");
        });

        test("displays NULL for null values", () => {
            const columns = [makeColumn("val")];
            const rows = [[makeCell("", true)]];
            const result = toHtml(columns, rows);
            expect(result).to.include("NULL");
        });

        test("includes resize script", () => {
            const columns = [makeColumn("id")];
            const rows = [[makeCell("1")]];
            const result = toHtml(columns, rows);
            expect(result).to.include("<script>");
            expect(result).to.include("col-resize");
        });
    });
});
