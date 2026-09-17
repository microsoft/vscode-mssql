/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import { NotebookContextMenu } from "../../../src/webviews/pages/NotebookRenderer/notebookContextMenu.plugin";
import type { IDbColumn } from "vscode-mssql";
import type { IDisposableDataProvider } from "../../../src/webviews/pages/QueryResult/table/dataProvider";
import type { NotebookCopyAsCsvOptions } from "../../../src/sharedInterfaces/notebookQueryResult";

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

function makeMenu(
    columnInfo: IDbColumn[] = [],
    copyAsCsvOptions: NotebookCopyAsCsvOptions = {
        delimiter: ",",
        includeHeaders: false,
        lineSeparator: "\r\n",
        textIdentifier: '"',
    },
): NotebookContextMenu<Slick.SlickData> {
    return new NotebookContextMenu<Slick.SlickData>(columnInfo, copyAsCsvOptions);
}

const fmt = {
    csv(
        menu: NotebookContextMenu<Slick.SlickData>,
        ranges: Slick.Range[],
        cols: Slick.Column<Slick.SlickData>[],
        provider: IDisposableDataProvider<Slick.SlickData>,
    ): string {
        return menu.formatAsCsv(ranges, cols, provider);
    },

    json(
        menu: NotebookContextMenu<Slick.SlickData>,
        ranges: Slick.Range[],
        cols: Slick.Column<Slick.SlickData>[],
        provider: IDisposableDataProvider<Slick.SlickData>,
    ): string {
        return menu.formatAsJson(ranges, cols, provider);
    },

    inClause(
        menu: NotebookContextMenu<Slick.SlickData>,
        ranges: Slick.Range[],
        cols: Slick.Column<Slick.SlickData>[],
        provider: IDisposableDataProvider<Slick.SlickData>,
    ): string | null {
        return menu.formatAsInClause(ranges, cols, provider);
    },

    insertInto(
        menu: NotebookContextMenu<Slick.SlickData>,
        ranges: Slick.Range[],
        cols: Slick.Column<Slick.SlickData>[],
        provider: IDisposableDataProvider<Slick.SlickData>,
    ): string {
        return menu.formatAsInsertInto(ranges, cols, provider);
    },
};

suite("NotebookContextMenu formatters", () => {
    const sandbox = sinon.createSandbox();
    let navigatorDescriptor: PropertyDescriptor | undefined;
    let slickDescriptor: PropertyDescriptor | undefined;

    suiteSetup(() => {
        navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
        slickDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Slick");

        Object.defineProperty(globalThis, "navigator", {
            value: {
                platform: "Win32",
                userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                clipboard: {
                    writeText: sandbox.stub().resolves(),
                },
            },
            configurable: true,
        });
        Object.defineProperty(globalThis, "Slick", {
            value: {
                EventHandler: class {
                    public subscribe = sandbox.stub();
                    public unsubscribeAll = sandbox.stub();
                },
            },
            configurable: true,
        });
    });

    suiteTeardown(() => {
        sandbox.restore();
        restoreProperty("navigator", navigatorDescriptor);
        restoreProperty("Slick", slickDescriptor);
    });

    function restoreProperty(name: string, descriptor: PropertyDescriptor | undefined): void {
        if (descriptor) {
            Object.defineProperty(globalThis, name, descriptor);
        } else {
            Reflect.deleteProperty(globalThis, name);
        }
    }

    suite("formatAsCsv", () => {
        test("emits data rows only, without a header row", () => {
            const menu = makeMenu();
            const cols = [makeCol(0, "Name"), makeCol(1, "Age")];
            const rows: CellRow[] = [{ "0": makeCell("Alice"), "1": makeCell("30") }];
            const result = fmt.csv(menu, [makeRange(0, 0, 0, 1)], cols, makeProvider(rows));
            expect(result).to.equal("Alice,30");
        });

        test("uses configured headers and delimiters", () => {
            const menu = makeMenu([], {
                delimiter: ";",
                includeHeaders: true,
                lineSeparator: "\n",
                textIdentifier: "'",
            });
            const cols = [makeCol(0, "Name"), makeCol(1, "Age")];
            const rows: CellRow[] = [{ "0": makeCell("Alice"), "1": makeCell("30") }];
            const result = fmt.csv(menu, [makeRange(0, 0, 0, 1)], cols, makeProvider(rows));
            expect(result).to.equal("Name;Age\nAlice;30");
        });

        test("uses the configured text identifier", () => {
            const menu = makeMenu([], {
                delimiter: ",",
                includeHeaders: false,
                lineSeparator: "\n",
                textIdentifier: "'",
            });
            const cols = [makeCol(0, "Name")];
            const rows: CellRow[] = [{ "0": makeCell("O'Brien") }];
            const result = fmt.csv(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal("'O''Brien'");
        });

        test("quotes values that contain a comma", () => {
            const menu = makeMenu();
            const cols = [makeCol(0, "City")];
            const rows: CellRow[] = [{ "0": makeCell("Portland, OR") }];
            const result = fmt.csv(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal('"Portland, OR"');
        });

        test("escapes double-quotes inside quoted values", () => {
            const menu = makeMenu();
            const cols = [makeCol(0, "Quote")];
            const rows: CellRow[] = [{ "0": makeCell('say "hello"') }];
            const result = fmt.csv(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal('"say ""hello"""');
        });

        test("quotes values that contain a newline", () => {
            const menu = makeMenu();
            const cols = [makeCol(0, "Notes")];
            const rows: CellRow[] = [{ "0": makeCell("line1\nline2") }];
            const result = fmt.csv(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal('"line1\nline2"');
        });

        test("emits NULL for null cells", () => {
            const menu = makeMenu();
            const cols = [makeCol(0, "Val")];
            const rows: CellRow[] = [{ "0": makeCell("", true) }];
            const result = fmt.csv(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal("NULL");
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
            expect(result).to.equal("1");
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
            expect(result).to.equal("a\r\nb\r\nc");
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

        test("quotes an empty numeric display value", () => {
            const menu = makeMenu([makeDbCol("int")]);
            const cols = [makeCol(0, "Id")];
            const rows: CellRow[] = [{ "0": makeCell("") }];
            const result = fmt.json(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(JSON.parse(result)).to.deep.equal([{ Id: "" }]);
        });

        test("quotes a whitespace-only numeric display value", () => {
            const menu = makeMenu([makeDbCol("decimal")]);
            const cols = [makeCol(0, "Amount")];
            const rows: CellRow[] = [{ "0": makeCell(" ") }];
            const result = fmt.json(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(JSON.parse(result)).to.deep.equal([{ Amount: " " }]);
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
            expect(result).to.equal("IN\r\n(\r\n    'Alice'\r\n)");
        });

        test("leaves numeric values unquoted", () => {
            const menu = makeMenu([makeDbCol("int")]);
            const cols = [makeCol(0, "Id")];
            const rows: CellRow[] = [{ "0": makeCell("42") }];
            const result = fmt.inClause(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal("IN\r\n(\r\n    42\r\n)");
        });

        test("emits NULL keyword for null cells", () => {
            const menu = makeMenu([makeDbCol("int")]);
            const cols = [makeCol(0, "Id")];
            const rows: CellRow[] = [{ "0": makeCell("", true) }];
            const result = fmt.inClause(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal("IN\r\n(\r\n    NULL\r\n)");
        });

        test("single-quotes numeric values in E-notation", () => {
            const menu = makeMenu([makeDbCol("float")]);
            const cols = [makeCol(0, "Val")];
            const rows: CellRow[] = [{ "0": makeCell("1.5E+10") }];
            const result = fmt.inClause(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal("IN\r\n(\r\n    '1.5E+10'\r\n)");
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
            expect(result).to.equal("IN\r\n(\r\n    1,\r\n    2,\r\n    3\r\n)");
        });

        test("escapes single quotes inside string values", () => {
            const menu = makeMenu([makeDbCol("nvarchar")]);
            const cols = [makeCol(0, "Name")];
            const rows: CellRow[] = [{ "0": makeCell("O'Brien") }];
            const result = fmt.inClause(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal("IN\r\n(\r\n    'O''Brien'\r\n)");
        });
    });

    suite("formatAsInsertInto", () => {
        test("emits INSERT INTO with column name and single-quoted string value", () => {
            const menu = makeMenu([makeDbCol("nvarchar")]);
            const cols = [makeCol(0, "Name")];
            const rows: CellRow[] = [{ "0": makeCell("Alice") }];
            const result = fmt.insertInto(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal("INSERT INTO TableName ([Name])\r\nVALUES\r\n    ('Alice');");
        });

        test("leaves numeric column values unquoted", () => {
            const menu = makeMenu([makeDbCol("int")]);
            const cols = [makeCol(0, "Id")];
            const rows: CellRow[] = [{ "0": makeCell("42") }];
            const result = fmt.insertInto(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal("INSERT INTO TableName ([Id])\r\nVALUES\r\n    (42);");
        });

        test("emits NULL for null cells", () => {
            const menu = makeMenu([makeDbCol("nvarchar")]);
            const cols = [makeCol(0, "Name")];
            const rows: CellRow[] = [{ "0": makeCell("", true) }];
            const result = fmt.insertInto(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal("INSERT INTO TableName ([Name])\r\nVALUES\r\n    (NULL);");
        });

        test("single-quotes numeric values in E-notation", () => {
            const menu = makeMenu([makeDbCol("float")]);
            const cols = [makeCol(0, "Val")];
            const rows: CellRow[] = [{ "0": makeCell("1.5E+10") }];
            const result = fmt.insertInto(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal("INSERT INTO TableName ([Val])\r\nVALUES\r\n    ('1.5E+10');");
        });

        test("escapes single quotes inside string values", () => {
            const menu = makeMenu([makeDbCol("nvarchar")]);
            const cols = [makeCol(0, "Name")];
            const rows: CellRow[] = [{ "0": makeCell("O'Brien") }];
            const result = fmt.insertInto(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.equal(
                "INSERT INTO TableName ([Name])\r\nVALUES\r\n    ('O''Brien');",
            );
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
                "INSERT INTO TableName ([Id])\r\nVALUES\r\n    (1),\r\n    (2),\r\n    (3);",
            );
        });

        test("emits multiple columns in order", () => {
            const menu = makeMenu([makeDbCol("int"), makeDbCol("nvarchar")]);
            const cols = [makeCol(0, "Id"), makeCol(1, "Name")];
            const rows: CellRow[] = [{ "0": makeCell("1"), "1": makeCell("Alice") }];
            const result = fmt.insertInto(menu, [makeRange(0, 0, 0, 1)], cols, makeProvider(rows));
            expect(result).to.equal(
                "INSERT INTO TableName ([Id], [Name])\r\nVALUES\r\n    (1, 'Alice');",
            );
        });

        test("uses toolTip as column name when present", () => {
            const menu = makeMenu([makeDbCol("int")]);
            const cols = [makeCol(0, "short", "full_col")];
            const rows: CellRow[] = [{ "0": makeCell("1") }];
            const result = fmt.insertInto(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.include("([full_col])");
        });

        test("escapes closing brackets in column names", () => {
            const menu = makeMenu([makeDbCol("int")]);
            const cols = [makeCol(0, "Order] ID")];
            const rows: CellRow[] = [{ "0": makeCell("1") }];
            const result = fmt.insertInto(menu, [makeRange(0, 0, 0, 0)], cols, makeProvider(rows));
            expect(result).to.include("([Order]] ID])");
        });

        test("splits more than 1000 rows into separate statements", () => {
            const menu = makeMenu([makeDbCol("int")]);
            const cols = [makeCol(0, "Id")];
            const rows = Array.from({ length: 1001 }, (_, index) => ({
                "0": makeCell(String(index)),
            }));
            const result = fmt.insertInto(
                menu,
                [makeRange(0, 1000, 0, 0)],
                cols,
                makeProvider(rows),
            );
            expect(result.match(/INSERT INTO TableName/g)).to.have.lengthOf(2);
            expect(result).to.include("    (999);\r\n\r\nINSERT INTO TableName ([Id])");
            expect(result.endsWith("    (1000);")).to.equal(true);
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

    suite("multi-range selections", () => {
        const sameRowRanges = () => [
            makeRange(0, 1, 0, 0),
            makeRange(0, 1, 2, 2),
            makeRange(0, 1, 4, 4),
        ];
        const wideCols = () => [
            makeCol(0, "FirstName"),
            makeCol(1, "LastName"),
            makeCol(2, "DateOfBirth"),
            makeCol(3, "Gender"),
            makeCol(4, "Email"),
        ];
        const wideRows = (): CellRow[] => [
            {
                "0": makeCell("John"),
                "1": makeCell("Smith"),
                "2": makeCell("2003-11-09"),
                "3": makeCell("M"),
                "4": makeCell("john.smith@example.com"),
            },
            {
                "0": makeCell("Mariah"),
                "1": makeCell("Jones"),
                "2": makeCell("2004-01-30"),
                "3": makeCell("F"),
                "4": makeCell("mariah.jones@example.com"),
            },
        ];

        test("csv merges ranges that share rows into fully populated rows", () => {
            const menu = makeMenu();
            const result = fmt.csv(menu, sameRowRanges(), wideCols(), makeProvider(wideRows()));
            const row1 = "John,2003-11-09,john.smith@example.com";
            const row2 = "Mariah,2004-01-30,mariah.jones@example.com";
            expect(result).to.equal([row1, row2, row1, row2, row1, row2].join("\r\n"));
        });

        test("csv blanks out columns outside a range when ranges span different rows", () => {
            const menu = makeMenu();
            const cols = [makeCol(0, "A"), makeCol(1, "B")];
            const rows: CellRow[] = [
                { "0": makeCell("a0"), "1": makeCell("b0") },
                { "0": makeCell("a1"), "1": makeCell("b1") },
            ];
            const ranges = [makeRange(0, 0, 0, 0), makeRange(1, 1, 1, 1)];
            const result = fmt.csv(menu, ranges, cols, makeProvider(rows));
            expect(result).to.equal("a0,\r\n,b1");
        });

        test("insertInto uses the union of columns across all ranges", () => {
            const menu = makeMenu([
                makeDbCol("nvarchar"),
                makeDbCol("nvarchar"),
                makeDbCol("date"),
                makeDbCol("nvarchar"),
                makeDbCol("nvarchar"),
            ]);
            const result = fmt.insertInto(
                menu,
                sameRowRanges(),
                wideCols(),
                makeProvider(wideRows()),
            );
            expect(result).to.contain(
                "INSERT INTO TableName ([FirstName], [DateOfBirth], [Email])",
            );
            expect(result).to.contain("('John', '2003-11-09', 'john.smith@example.com')");
            expect(result).to.contain("('Mariah', '2004-01-30', 'mariah.jones@example.com')");
        });

        test("insertInto emits NULL for columns outside a range spanning other rows", () => {
            const menu = makeMenu([makeDbCol("nvarchar"), makeDbCol("nvarchar")]);
            const cols = [makeCol(0, "A"), makeCol(1, "B")];
            const rows: CellRow[] = [
                { "0": makeCell("a0"), "1": makeCell("b0") },
                { "0": makeCell("a1"), "1": makeCell("b1") },
            ];
            const ranges = [makeRange(0, 0, 0, 0), makeRange(1, 1, 1, 1)];
            const result = fmt.insertInto(menu, ranges, cols, makeProvider(rows));
            expect(result).to.equal(
                "INSERT INTO TableName ([A], [B])\r\nVALUES\r\n    ('a0', NULL),\r\n    (NULL, 'b1');",
            );
        });

        test("json gives every object the same key set", () => {
            const menu = makeMenu([
                makeDbCol("nvarchar"),
                makeDbCol("nvarchar"),
                makeDbCol("date"),
                makeDbCol("nvarchar"),
                makeDbCol("nvarchar"),
            ]);
            const result = fmt.json(menu, sameRowRanges(), wideCols(), makeProvider(wideRows()));
            const parsed = JSON.parse(result);
            expect(parsed).to.have.lengthOf(6);
            for (const obj of parsed) {
                expect(Object.keys(obj)).to.deep.equal(["FirstName", "DateOfBirth", "Email"]);
            }
            expect(parsed[0]).to.deep.equal({
                FirstName: "John",
                DateOfBirth: "2003-11-09",
                Email: "john.smith@example.com",
            });
        });

        test("inClause returns null when ranges cover different columns", () => {
            const menu = makeMenu([makeDbCol("nvarchar"), makeDbCol("nvarchar")]);
            const cols = [makeCol(0, "A"), makeCol(1, "B")];
            const rows: CellRow[] = [{ "0": makeCell("a0"), "1": makeCell("b0") }];
            const ranges = [makeRange(0, 0, 0, 0), makeRange(0, 0, 1, 1)];
            expect(fmt.inClause(menu, ranges, cols, makeProvider(rows))).to.equal(null);
        });

        test("inClause accepts multiple ranges on the same column", () => {
            const menu = makeMenu([makeDbCol("nvarchar")]);
            const cols = [makeCol(0, "A")];
            const rows: CellRow[] = [
                { "0": makeCell("a0") },
                { "0": makeCell("a1") },
                { "0": makeCell("a2") },
            ];
            const ranges = [makeRange(0, 0, 0, 0), makeRange(2, 2, 0, 0)];
            const result = fmt.inClause(menu, ranges, cols, makeProvider(rows));
            expect(result).to.equal("IN\r\n(\r\n    'a0',\r\n    'a2'\r\n)");
        });
    });
});
