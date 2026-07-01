/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { NotebookContextMenu } from "../../../src/webviews/pages/NotebookRenderer/notebookContextMenu.plugin";
import type { IDbColumn } from "vscode-mssql";
import type { IDisposableDataProvider } from "../../../src/webviews/pages/QueryResult/table/dataProvider";

// Mock navigator.platform for isMac() in notebookContextMenu.plugin
// Use Object.defineProperty because navigator is read-only in Electron
Object.defineProperty(global, "navigator", {
    value: {
        platform: "Win32",
        clipboard: {
            writeText: async () => {},
        },
    },
    writable: true,
    configurable: true,
});

// Slick.EventHandler is a class field — mock the global before any test instantiates NotebookContextMenu.
(global as any).Slick = {
    EventHandler: class {
        subscribe() {}
        unsubscribeAll() {}
    },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRange(fromRow: number, toRow: number, fromCell: number, toCell: number): Slick.Range {
    return { fromRow, toRow, fromCell, toCell } as unknown as Slick.Range;
}

function makeCol(index: number, name: string, toolTip?: string): Slick.Column<Slick.SlickData> {
    return {
        field: String(index),
        id: String(index),
        name,
        toolTip,
    } as Slick.Column<Slick.SlickData>;
}

function makeDbCol(dataTypeName: string): IDbColumn {
    return { dataTypeName } as IDbColumn;
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

function makeMenu(columnInfo: IDbColumn[] = []): NotebookContextMenu<Slick.SlickData> {
    return new NotebookContextMenu<Slick.SlickData>(columnInfo);
}

// Accessors for private formatter methods
const fmt = {
    csv(
        menu: NotebookContextMenu<Slick.SlickData>,
        ranges: Slick.Range[],
        cols: Slick.Column<Slick.SlickData>[],
        provider: IDisposableDataProvider<Slick.SlickData>,
    ): string {
        return (menu as any).formatAsCsv(ranges, cols, provider);
    },

    json(
        menu: NotebookContextMenu<Slick.SlickData>,
        ranges: Slick.Range[],
        cols: Slick.Column<Slick.SlickData>[],
        provider: IDisposableDataProvider<Slick.SlickData>,
    ): string {
        return (menu as any).formatAsJson(ranges, cols, provider);
    },

    inClause(
        menu: NotebookContextMenu<Slick.SlickData>,
        ranges: Slick.Range[],
        cols: Slick.Column<Slick.SlickData>[],
        provider: IDisposableDataProvider<Slick.SlickData>,
    ): string | null {
        return (menu as any).formatAsInClause(ranges, cols, provider);
    },

    insertInto(
        menu: NotebookContextMenu<Slick.SlickData>,
        ranges: Slick.Range[],
        cols: Slick.Column<Slick.SlickData>[],
        provider: IDisposableDataProvider<Slick.SlickData>,
    ): string {
        return (menu as any).formatAsInsertInto(ranges, cols, provider);
    },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

suite("NotebookContextMenu formatters", () => {
    suite("formatAsCsv", () => {
        test("emits header row followed by data row", () => {
            const menu = makeMenu();
            const cols = [makeCol(0, "Name"), makeCol(1, "Age")];
            const rows: CellRow[] = [{ "0": makeCell("Alice"), "1": makeCell("30") }];
            const result = fmt.csv(menu, [makeRange(0, 0, 0, 1)], cols, makeProvider(rows));
            expect(result).to.equal("Name,Age\r\nAlice,30");
        });

        test("quotes values that contain a comma", () => {
            const menu = makeMenu();
            const cols = [makeCol(0, "City")];
            const rows: CellRow[] = [{ "0": makeCell("Portland, OR") }];
            const result = fmt.csv(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal('City\r\n"Portland, OR"');
        });

        test("escapes double-quotes inside quoted values", () => {
            const menu = makeMenu();
            const cols = [makeCol(0, "Quote")];
            const rows: CellRow[] = [{ "0": makeCell('say "hello"') }];
            const result = fmt.csv(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal('Quote\r\n"say ""hello"""');
        });

        test("quotes values that contain a newline", () => {
            const menu = makeMenu();
            const cols = [makeCol(0, "Notes")];
            const rows: CellRow[] = [{ "0": makeCell("line1\nline2") }];
            const result = fmt.csv(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal('Notes\r\n"line1\nline2"');
        });

        test("emits NULL for null cells", () => {
            const menu = makeMenu();
            const cols = [makeCol(0, "Val")];
            const rows: CellRow[] = [{ "0": makeCell("", true) }];
            const result = fmt.csv(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal("Val\r\nNULL");
        });

        test("excludes the rowNumber column", () => {
            const menu = makeMenu();
            const rowNumCol = {
                field: "rn",
                id: "rowNumber",
                name: "#",
            } as unknown as Slick.Column<Slick.SlickData>;
            const dataCol = makeCol(0, "ID");
            const cols = [rowNumCol, dataCol];
            const rows: CellRow[] = [{ "0": makeCell("1") }];
            const result = fmt.csv(menu, [makeRange(0, 0, 0, 1)], cols, makeProvider(rows));
            expect(result).to.equal("ID\r\n1");
        });

        test("uses toolTip as column header when present", () => {
            const menu = makeMenu();
            const cols = [makeCol(0, "n", "Full Name")];
            const rows: CellRow[] = [{ "0": makeCell("Bob") }];
            const result = fmt.csv(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal("Full Name\r\nBob");
        });

        test("emits one data row per range row", () => {
            const menu = makeMenu();
            const cols = [makeCol(0, "X")];
            const rows: CellRow[] = [
                { "0": makeCell("a") },
                { "0": makeCell("b") },
                { "0": makeCell("c") },
            ];
            const result = fmt.csv(menu, [makeRange(0, 2, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal("X\r\na\r\nb\r\nc");
        });
    });

    suite("formatAsJson", () => {
        test("outputs string columns as JSON strings", () => {
            const menu = makeMenu([makeDbCol("nvarchar")]);
            const cols = [makeCol(0, "Name")];
            const rows: CellRow[] = [{ "0": makeCell("Alice") }];
            const result = fmt.json(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(JSON.parse(result)).to.deep.equal([{ Name: "Alice" }]);
        });

        test("outputs integer column as a JSON number", () => {
            const menu = makeMenu([makeDbCol("int")]);
            const cols = [makeCol(0, "Age")];
            const rows: CellRow[] = [{ "0": makeCell("42") }];
            const result = fmt.json(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(JSON.parse(result)).to.deep.equal([{ Age: 42 }]);
        });

        test("outputs decimal column as a JSON number", () => {
            const menu = makeMenu([makeDbCol("decimal")]);
            const cols = [makeCol(0, "Price")];
            const rows: CellRow[] = [{ "0": makeCell("9.99") }];
            const result = fmt.json(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(JSON.parse(result)).to.deep.equal([{ Price: 9.99 }]);
        });

        test("outputs bit column as a JSON string, not a number", () => {
            const menu = makeMenu([makeDbCol("bit")]);
            const cols = [makeCol(0, "Active")];
            const rows: CellRow[] = [{ "0": makeCell("1") }];
            const result = fmt.json(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(JSON.parse(result)).to.deep.equal([{ Active: "1" }]);
        });

        test("outputs null cells as JSON null", () => {
            const menu = makeMenu([makeDbCol("int")]);
            const cols = [makeCol(0, "Id")];
            const rows: CellRow[] = [{ "0": makeCell("", true) }];
            const result = fmt.json(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(JSON.parse(result)).to.deep.equal([{ Id: null }]);
        });

        test("preserves uppercase E in scientific notation from SQL Server", () => {
            const menu = makeMenu([makeDbCol("float")]);
            const cols = [makeCol(0, "Val")];
            const rows: CellRow[] = [{ "0": makeCell("1.5E+10") }];
            const result = fmt.json(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.include("1.5E+10");
            expect(JSON.parse(result)[0].Val).to.equal(1.5e10);
        });

        test("outputs mixed-type columns correctly", () => {
            const menu = makeMenu([makeDbCol("int"), makeDbCol("nvarchar")]);
            const cols = [makeCol(0, "Id"), makeCol(1, "Name")];
            const rows: CellRow[] = [{ "0": makeCell("1"), "1": makeCell("Alice") }];
            const result = fmt.json(menu, [makeRange(0, 0, 0, 1)], cols, makeProvider(rows));
            expect(JSON.parse(result)).to.deep.equal([{ Id: 1, Name: "Alice" }]);
        });

        test("uses toolTip as JSON key when present", () => {
            const menu = makeMenu([makeDbCol("nvarchar")]);
            const cols = [makeCol(0, "n", "full_name")];
            const rows: CellRow[] = [{ "0": makeCell("Bob") }];
            const result = fmt.json(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(JSON.parse(result)[0]).to.have.property("full_name", "Bob");
        });

        test("outputs multiple rows as a JSON array", () => {
            const menu = makeMenu([makeDbCol("int")]);
            const cols = [makeCol(0, "Id")];
            const rows: CellRow[] = [{ "0": makeCell("1") }, { "0": makeCell("2") }];
            const result = fmt.json(menu, [makeRange(0, 1, 0, 0)], cols, makeProvider(rows));
            expect(JSON.parse(result)).to.deep.equal([{ Id: 1 }, { Id: 2 }]);
        });
    });

    suite("formatAsInClause", () => {
        test("returns null when range spans more than one column", () => {
            const menu = makeMenu();
            const cols = [makeCol(0, "A"), makeCol(1, "B")];
            const rows: CellRow[] = [{ "0": makeCell("x"), "1": makeCell("y") }];
            const result = fmt.inClause(menu, [makeRange(0, 0, 0, 1)], cols, makeProvider(rows));
            expect(result).to.be.null;
        });

        test("single-quotes string values", () => {
            const menu = makeMenu([makeDbCol("nvarchar")]);
            const cols = [makeCol(0, "Name")];
            const rows: CellRow[] = [{ "0": makeCell("Alice") }];
            const result = fmt.inClause(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal("IN\n(\n    'Alice'\n)");
        });

        test("leaves numeric values unquoted", () => {
            const menu = makeMenu([makeDbCol("int")]);
            const cols = [makeCol(0, "Id")];
            const rows: CellRow[] = [{ "0": makeCell("42") }];
            const result = fmt.inClause(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal("IN\n(\n    42\n)");
        });

        test("emits NULL keyword for null cells", () => {
            const menu = makeMenu([makeDbCol("int")]);
            const cols = [makeCol(0, "Id")];
            const rows: CellRow[] = [{ "0": makeCell("", true) }];
            const result = fmt.inClause(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal("IN\n(\n    NULL\n)");
        });

        test("single-quotes numeric values in E-notation", () => {
            const menu = makeMenu([makeDbCol("float")]);
            const cols = [makeCol(0, "Val")];
            const rows: CellRow[] = [{ "0": makeCell("1.5E+10") }];
            const result = fmt.inClause(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal("IN\n(\n    '1.5E+10'\n)");
        });

        test("comma-separates multiple values with no trailing comma on the last", () => {
            const menu = makeMenu([makeDbCol("int")]);
            const cols = [makeCol(0, "Id")];
            const rows: CellRow[] = [
                { "0": makeCell("1") },
                { "0": makeCell("2") },
                { "0": makeCell("3") },
            ];
            const result = fmt.inClause(menu, [makeRange(0, 2, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal("IN\n(\n    1,\n    2,\n    3\n)");
        });

        test("escapes single quotes inside string values", () => {
            const menu = makeMenu([makeDbCol("nvarchar")]);
            const cols = [makeCol(0, "Name")];
            const rows: CellRow[] = [{ "0": makeCell("O'Brien") }];
            const result = fmt.inClause(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal("IN\n(\n    'O''Brien'\n)");
        });
    });

    suite("formatAsInsertInto", () => {
        test("emits INSERT INTO with column name and single-quoted string value", () => {
            const menu = makeMenu([makeDbCol("nvarchar")]);
            const cols = [makeCol(0, "Name")];
            const rows: CellRow[] = [{ "0": makeCell("Alice") }];
            const result = fmt.insertInto(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal("INSERT INTO table_name (Name)\nVALUES\n    ('Alice');");
        });

        test("leaves numeric column values unquoted", () => {
            const menu = makeMenu([makeDbCol("int")]);
            const cols = [makeCol(0, "Id")];
            const rows: CellRow[] = [{ "0": makeCell("42") }];
            const result = fmt.insertInto(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal("INSERT INTO table_name (Id)\nVALUES\n    (42);");
        });

        test("emits NULL for null cells", () => {
            const menu = makeMenu([makeDbCol("nvarchar")]);
            const cols = [makeCol(0, "Name")];
            const rows: CellRow[] = [{ "0": makeCell("", true) }];
            const result = fmt.insertInto(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal("INSERT INTO table_name (Name)\nVALUES\n    (NULL);");
        });

        test("single-quotes numeric values in E-notation", () => {
            const menu = makeMenu([makeDbCol("float")]);
            const cols = [makeCol(0, "Val")];
            const rows: CellRow[] = [{ "0": makeCell("1.5E+10") }];
            const result = fmt.insertInto(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal("INSERT INTO table_name (Val)\nVALUES\n    ('1.5E+10');");
        });

        test("escapes single quotes inside string values", () => {
            const menu = makeMenu([makeDbCol("nvarchar")]);
            const cols = [makeCol(0, "Name")];
            const rows: CellRow[] = [{ "0": makeCell("O'Brien") }];
            const result = fmt.insertInto(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal("INSERT INTO table_name (Name)\nVALUES\n    ('O''Brien');");
        });

        test("comma after each row except the last which gets a semicolon", () => {
            const menu = makeMenu([makeDbCol("int")]);
            const cols = [makeCol(0, "Id")];
            const rows: CellRow[] = [
                { "0": makeCell("1") },
                { "0": makeCell("2") },
                { "0": makeCell("3") },
            ];
            const result = fmt.insertInto(menu, [makeRange(0, 2, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal(
                "INSERT INTO table_name (Id)\nVALUES\n    (1),\n    (2),\n    (3);",
            );
        });

        test("emits multiple columns in order", () => {
            const menu = makeMenu([makeDbCol("int"), makeDbCol("nvarchar")]);
            const cols = [makeCol(0, "Id"), makeCol(1, "Name")];
            const rows: CellRow[] = [{ "0": makeCell("1"), "1": makeCell("Alice") }];
            const result = fmt.insertInto(menu, [makeRange(0, 0, 0, 1)], cols, makeProvider(rows));
            expect(result).to.equal("INSERT INTO table_name (Id, Name)\nVALUES\n    (1, 'Alice');");
        });

        test("uses toolTip as column name when present", () => {
            const menu = makeMenu([makeDbCol("int")]);
            const cols = [makeCol(0, "short", "full_col")];
            const rows: CellRow[] = [{ "0": makeCell("1") }];
            const result = fmt.insertInto(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.include("(full_col)");
        });

        test("returns empty string when range contains no data columns", () => {
            const menu = makeMenu();
            const rowNumCol = {
                field: "rn",
                id: "rowNumber",
                name: "#",
            } as unknown as Slick.Column<Slick.SlickData>;
            const rows: CellRow[] = [{ rn: makeCell("1") }];
            const result = fmt.insertInto(
                menu,
                [makeRange(0, 0, 0, 0)],
                [rowNumCol],
                makeProvider(rows),
            );
            expect(result).to.equal("");
        });
    });
});
