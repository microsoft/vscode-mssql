/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import type { IDbColumn, DbCellValue } from "vscode-mssql";
import { buildXlsx } from "../../../src/notebooks/notebookExcelWriter";
import JSZip = require("jszip");

function makeColumn(name: string, dataType?: string): IDbColumn {
    return { columnName: name, dataType, dataTypeName: dataType } as IDbColumn;
}

function makeCell(value: string, isNull = false): DbCellValue {
    return { displayValue: value, isNull } as DbCellValue;
}

suite("notebookResultsSerializer", () => {
    let sandbox: sinon.SinonSandbox;
    let configStub: sinon.SinonStubbedInstance<vscode.WorkspaceConfiguration>;

    setup(() => {
        sandbox = sinon.createSandbox();
        configStub = {
            get: sandbox.stub(),
            has: sandbox.stub(),
            inspect: sandbox.stub(),
            update: sandbox.stub(),
        } as unknown as sinon.SinonStubbedInstance<vscode.WorkspaceConfiguration>;

        sandbox.stub(vscode.workspace, "getConfiguration").returns(configStub);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("CSV export", () => {
        test("sanitizes formula injection characters", async () => {
            const { toCsv, getCsvConfig } = await import(
                "../../../src/notebooks/notebookResultsSerializer"
            );

            configStub.get.returns({});
            const config = getCsvConfig();

            const columns = [makeColumn("col")];
            const rows = [
                [makeCell("=SUM(A1:A10)")],
                [makeCell("+formula")],
                [makeCell("-negative")],
                [makeCell("@at")],
                [makeCell("\ttab")],
                [makeCell("normal")],
            ];

            const csv = toCsv(columns, rows, config);

            // Verify that dangerous formulas are prefixed with single quote
            expect(csv).to.include("'=SUM(A1:A10)");
            expect(csv).to.include("'+formula");
            expect(csv).to.include("'-negative");
            expect(csv).to.include("'@at");
            expect(csv).to.include("'\ttab");
            expect(csv).to.include('"normal"');
        });

        test("respects includeHeaders=false setting", async () => {
            const { toCsv, getCsvConfig } = await import(
                "../../../src/notebooks/notebookResultsSerializer"
            );

            configStub.get.returns({ includeHeaders: false });
            const config = getCsvConfig();

            const columns = [makeColumn("id"), makeColumn("name")];
            const rows = [[makeCell("1"), makeCell("Alice")]];

            const csv = toCsv(columns, rows, config);
            const lines = csv.trim().split(/\r?\n/);

            expect(lines).to.have.lengthOf(1);
            expect(lines[0]).to.include("1");
            expect(lines[0]).to.include("Alice");
            expect(csv).to.not.include('"id"');
            expect(csv).to.not.include('"name"');
        });

        test("respects custom delimiter setting", async () => {
            const { toCsv, getCsvConfig } = await import(
                "../../../src/notebooks/notebookResultsSerializer"
            );

            configStub.get.returns({ delimiter: "|" });
            const config = getCsvConfig();

            const columns = [makeColumn("a"), makeColumn("b")];
            const rows = [[makeCell("1"), makeCell("2")]];

            const csv = toCsv(columns, rows, config);

            expect(csv).to.include('"a"|"b"');
            expect(csv).to.include('"1"|"2"');
        });

        test("handles null values as empty strings", async () => {
            const { toCsv, getCsvConfig } = await import(
                "../../../src/notebooks/notebookResultsSerializer"
            );

            configStub.get.returns({});
            const config = getCsvConfig();

            const columns = [makeColumn("col")];
            const rows = [[makeCell("", true)]];

            const csv = toCsv(columns, rows, config);
            const lines = csv.split(/\r?\n/);

            expect(lines[1]).to.equal("");
        });

        test("escapes quotes within quoted values", async () => {
            const { toCsv, getCsvConfig } = await import(
                "../../../src/notebooks/notebookResultsSerializer"
            );

            configStub.get.returns({});
            const config = getCsvConfig();

            const columns = [makeColumn("col")];
            const rows = [[makeCell('He said "hello"')]];

            const csv = toCsv(columns, rows, config);

            expect(csv).to.include('""hello""');
        });
    });

    suite("JSON export", () => {
        test("disambiguates duplicate column names", async () => {
            const { toJson } = await import("../../../src/notebooks/notebookResultsSerializer");

            const columns = [makeColumn("x"), makeColumn("x"), makeColumn("x"), makeColumn("y")];
            const rows = [[makeCell("1"), makeCell("2"), makeCell("3"), makeCell("4")]];

            const json = toJson(columns, rows);
            const parsed = JSON.parse(json);

            expect(parsed).to.have.lengthOf(1);
            expect(parsed[0]).to.have.property("x", "1");
            expect(parsed[0]).to.have.property("x_1", "2");
            expect(parsed[0]).to.have.property("x_2", "3");
            expect(parsed[0]).to.have.property("y", "4");
        });

        test("preserves null values as JSON null", async () => {
            const { toJson } = await import("../../../src/notebooks/notebookResultsSerializer");

            const columns = [makeColumn("col")];
            const rows = [[makeCell("", true)]];

            const json = toJson(columns, rows);
            const parsed = JSON.parse(json);

            expect(parsed[0].col).to.be.null;
        });

        test("handles multiple duplicate columns correctly", async () => {
            const { toJson } = await import("../../../src/notebooks/notebookResultsSerializer");

            const columns = [
                makeColumn("a"),
                makeColumn("b"),
                makeColumn("a"),
                makeColumn("b"),
                makeColumn("a"),
            ];
            const rows = [
                [makeCell("1"), makeCell("2"), makeCell("3"), makeCell("4"), makeCell("5")],
            ];

            const json = toJson(columns, rows);
            const parsed = JSON.parse(json);

            expect(parsed[0]).to.have.property("a", "1");
            expect(parsed[0]).to.have.property("b", "2");
            expect(parsed[0]).to.have.property("a_1", "3");
            expect(parsed[0]).to.have.property("b_1", "4");
            expect(parsed[0]).to.have.property("a_2", "5");
        });
    });

    suite("Excel export", () => {
        test("respects includeHeaders=false setting", async () => {
            configStub.get.returns({ includeHeaders: false });

            const columns = [makeColumn("id", "int")];
            const rows = [[makeCell("1")]];

            const buffer = await buildXlsx(columns, rows);
            const zip = await JSZip.loadAsync(buffer);
            const sheetXml = await zip.file("xl/worksheets/sheet1.xml")?.async("string");

            expect(sheetXml).to.exist;
            expect(sheetXml).to.include('<row r="1">');
            expect(sheetXml).to.include("<v>1</v>");
            expect(sheetXml).to.not.include(">id<");
        });

        test("includes headers by default", async () => {
            configStub.get.returns({});

            const columns = [makeColumn("col1")];
            const rows = [[makeCell("val1")]];

            const buffer = await buildXlsx(columns, rows);
            const zip = await JSZip.loadAsync(buffer);
            const sheetXml = await zip.file("xl/worksheets/sheet1.xml")?.async("string");

            expect(sheetXml).to.exist;
            expect(sheetXml).to.include(">col1<");
            expect(sheetXml).to.include('<row r="1">');
            expect(sheetXml).to.include('<row r="2">');
        });

        test("generates valid xlsx structure", async () => {
            configStub.get.returns({});

            const columns = [makeColumn("id")];
            const rows = [[makeCell("1")]];

            const buffer = await buildXlsx(columns, rows);
            const zip = await JSZip.loadAsync(buffer);

            expect(zip.file("[Content_Types].xml")).to.exist;
            expect(zip.file("_rels/.rels")).to.exist;
            expect(zip.file("xl/workbook.xml")).to.exist;
            expect(zip.file("xl/_rels/workbook.xml.rels")).to.exist;
            expect(zip.file("xl/worksheets/sheet1.xml")).to.exist;
        });

        test("handles numeric columns", async () => {
            configStub.get.returns({});

            const columns = [makeColumn("amount", "decimal")];
            const rows = [[makeCell("123.45")]];

            const buffer = await buildXlsx(columns, rows);
            const zip = await JSZip.loadAsync(buffer);
            const sheetXml = await zip.file("xl/worksheets/sheet1.xml")?.async("string");

            expect(sheetXml).to.include("<v>123.45</v>");
        });

        test("omits null cells", async () => {
            configStub.get.returns({});

            const columns = [makeColumn("col1"), makeColumn("col2")];
            const rows = [[makeCell("", true), makeCell("value")]];

            const buffer = await buildXlsx(columns, rows);
            const zip = await JSZip.loadAsync(buffer);
            const sheetXml = await zip.file("xl/worksheets/sheet1.xml")?.async("string");

            expect(sheetXml).to.exist;
            // Should only have the header row cell for col1 (A1), not a data row cell (A2)
            const col1Cells = (sheetXml.match(/r="A/g) || []).length;
            expect(col1Cells).to.equal(1); // Only the header cell
        });
    });
});
