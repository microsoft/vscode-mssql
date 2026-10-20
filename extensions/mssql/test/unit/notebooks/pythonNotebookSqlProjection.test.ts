/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { projectPythonNotebookSql } from "../../../src/notebooks/pythonNotebookSqlProjection";

suite("PythonNotebookSqlProjection", () => {
    test("preserves SQL positions after a CRLF magic header", () => {
        const source = "%%tsql --bind df\r\nSELECT t.name FROM sys.tables AS t;";
        expect(projectPythonNotebookSql(source)).to.deep.equal({
            text: " ".repeat("%%tsql --bind df".length) + "\r\nSELECT t.name FROM sys.tables AS t;",
            bodyStartLine: 1,
        });
    });

    test("recognizes leading blank lines without shifting Unicode SQL positions", () => {
        const sql = "SELECT [caf\u00e9], [\ud83d\ude00] FROM dbo.example;";
        const source = "\n \t\r\n%%tsql --params values\n" + sql;
        const result = projectPythonNotebookSql(source);
        expect(result?.bodyStartLine).to.equal(3);
        expect(result?.text.length).to.equal(source.length);
        expect(result?.text.split("\n").at(-1)).to.equal(sql);
    });

    test("rejects Python code, comments, indented magic, and different magics", () => {
        for (const source of [
            "x = '%%tsql'\nprint(x)",
            "# comment\n%%tsql\nSELECT 1",
            "  %%tsql\nSELECT 1",
            "\t%%tsql\nSELECT 1",
            "%%tsqlx\nSELECT 1",
            "%%sql\nSELECT 1",
            "SELECT 1",
            "",
        ]) {
            expect(projectPythonNotebookSql(source), source).to.equal(undefined);
        }
    });

    test("does not offer SQL before a header has a body line", () => {
        expect(projectPythonNotebookSql("%%tsql --bind df")).to.equal(undefined);
        expect(projectPythonNotebookSql("%%tsql\n")).to.deep.equal({
            text: "      \n",
            bodyStartLine: 1,
        });
    });

    test("accepts options without evaluating or changing them", () => {
        const source = "%%tsql\t--all --bind frames --max-rows 5\nSELECT 1;\nSELECT 2;";
        const result = projectPythonNotebookSql(source);
        expect(result?.text).to.equal(" ".repeat(source.indexOf("\n")) + "\nSELECT 1;\nSELECT 2;");
    });
});
