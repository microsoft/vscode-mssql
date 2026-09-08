/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import type { IDbColumn } from "vscode-mssql";
import type { IDisposableDataProvider } from "../../../src/webviews/pages/QueryResult/table/dataProvider";
import {
    buildQualifiedTableName,
    generateDelete,
    generateInsertForRows,
    generateSelect,
    generateUpdate,
    getSelectedColumnIndices,
    isFullRowSelected,
    isSingleRowSelection,
} from "../../../src/webviews/common/sqlScriptGenerator";

function restoreProperty(name: string, descriptor: PropertyDescriptor | undefined): void {
    if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
    } else {
        delete (globalThis as any)[name];
    }
}

function makeRange(fromRow: number, toRow: number, fromCell: number, toCell: number) {
    return { fromRow, toRow, fromCell, toCell };
}

function makeCol(index: number, name: string, toolTip?: string): Slick.Column<Slick.SlickData> {
    return {
        field: String(index),
        id: String(index),
        name,
        toolTip,
    } as Slick.Column<Slick.SlickData>;
}

function makeDbCol(
    dataTypeName: string,
    baseColumnName?: string,
    baseTableName?: string,
    baseSchemaName?: string,
): IDbColumn {
    return { dataTypeName, baseColumnName, baseTableName, baseSchemaName } as IDbColumn;
}

function makeCell(displayValue: string, isNull = false) {
    return { displayValue, isNull };
}

type CellRow = Record<string, { displayValue: string; isNull: boolean }>;

function makeProvider(rows: CellRow[]): IDisposableDataProvider<Slick.SlickData> {
    return {
        getItem: (row: number) => rows[row] ?? {},
    } as unknown as IDisposableDataProvider<Slick.SlickData>;
}

suite("sqlScriptGenerator", () => {
    let navigatorDescriptor: PropertyDescriptor | undefined;

    suiteSetup(() => {
        navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
        Object.defineProperty(globalThis, "navigator", {
            value: {
                userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            },
            configurable: true,
        });
    });

    suiteTeardown(() => {
        restoreProperty("navigator", navigatorDescriptor);
    });

    suite("buildQualifiedTableName", () => {
        test("falls back to UnknownTable when baseTableName is empty", () => {
            expect(buildQualifiedTableName(makeDbCol("int"))).to.equal("UnknownTable");
        });

        test("uses schema-qualified, escaped table name when present", () => {
            expect(buildQualifiedTableName(makeDbCol("int", "Id", "Order] Item", "dbo"))).to.equal(
                "[dbo].[Order]] Item]",
            );
        });
    });

    suite("isSingleRowSelection / isFullRowSelected", () => {
        const cols = [makeCol(0, "Id"), makeCol(1, "Name")];

        test("single cell in a row is a single-row, non-full-row selection", () => {
            const ranges = [makeRange(0, 0, 0, 0)];
            expect(isSingleRowSelection(ranges)).to.equal(true);
            expect(isFullRowSelected(ranges, cols)).to.equal(false);
        });

        test("all columns of one row is a full-row selection", () => {
            const ranges = [makeRange(0, 0, 0, 1)];
            expect(isSingleRowSelection(ranges)).to.equal(true);
            expect(isFullRowSelected(ranges, cols)).to.equal(true);
        });

        test("multi-row selection is not single-row", () => {
            const ranges = [makeRange(0, 1, 0, 1)];
            expect(isSingleRowSelection(ranges)).to.equal(false);
            expect(isFullRowSelected(ranges, cols)).to.equal(false);
        });
    });

    suite("generateSelect / generateUpdate / generateDelete", () => {
        const columnInfo = [
            makeDbCol("int", "Id", "Customers", "dbo"),
            makeDbCol("nvarchar", "Name", "Customers", "dbo"),
            makeDbCol("nvarchar", "Email", "Customers", "dbo"),
        ];
        const cols = [makeCol(0, "Id"), makeCol(1, "Name"), makeCol(2, "Email")];
        const rows: CellRow[] = [
            {
                "0": makeCell("42"),
                "1": makeCell("Alice"),
                "2": makeCell("", true),
            },
        ];

        test("generateSelect builds WHERE from only the selected columns, IS NULL for null cells", () => {
            const provider = makeProvider(rows);
            const selected = getSelectedColumnIndices([makeRange(0, 0, 0, 0)], cols);
            const result = generateSelect(0, selected, cols, provider, columnInfo);
            expect(result).to.equal(
                "SELECT [Id], [Name], [Email]\r\nFROM [dbo].[Customers]\r\nWHERE [Id] = 42;",
            );
        });

        test("generateDelete uses only the selected column as WHERE", () => {
            const provider = makeProvider(rows);
            const selected = getSelectedColumnIndices([makeRange(0, 0, 0, 0)], cols);
            const result = generateDelete(0, selected, cols, provider, columnInfo);
            expect(result).to.equal("DELETE FROM [dbo].[Customers]\r\nWHERE [Id] = 42;");
        });

        test("generateUpdate SETs every other column, NULL cell stays NULL", () => {
            const provider = makeProvider(rows);
            const selected = getSelectedColumnIndices([makeRange(0, 0, 0, 0)], cols);
            const result = generateUpdate(0, selected, cols, provider, columnInfo);
            expect(result).to.equal(
                "UPDATE [dbo].[Customers]\r\nSET [Name] = 'Alice',\r\n    [Email] = NULL\r\nWHERE [Id] = 42;",
            );
        });

        test("generateSelect renders IS NULL in WHERE when the selected cell is null", () => {
            const provider = makeProvider(rows);
            const selected = getSelectedColumnIndices([makeRange(0, 0, 2, 2)], cols);
            const result = generateSelect(0, selected, cols, provider, columnInfo);
            expect(result).to.include("WHERE [Email] IS NULL");
        });
    });

    suite("generateInsertForRows", () => {
        test("uses the real table name instead of a placeholder", () => {
            const columnInfo = [makeDbCol("nvarchar", "Name", "Customers", "dbo")];
            const cols = [makeCol(0, "Name")];
            const provider = makeProvider([{ "0": makeCell("Alice") }]);
            const result = generateInsertForRows(
                [makeRange(0, 0, 0, 0)],
                cols,
                provider,
                columnInfo,
            );
            expect(result).to.equal(
                "INSERT INTO [dbo].[Customers] ([Name])\r\nVALUES\r\n    ('Alice');",
            );
        });

        test("falls back to UnknownTable when no table metadata is available", () => {
            const columnInfo = [makeDbCol("nvarchar")];
            const cols = [makeCol(0, "Name")];
            const provider = makeProvider([{ "0": makeCell("Alice") }]);
            const result = generateInsertForRows(
                [makeRange(0, 0, 0, 0)],
                cols,
                provider,
                columnInfo,
            );
            expect(result).to.equal(
                "INSERT INTO UnknownTable ([Name])\r\nVALUES\r\n    ('Alice');",
            );
        });
    });
});
