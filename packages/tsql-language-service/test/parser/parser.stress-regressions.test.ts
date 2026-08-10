/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    analyze,
    extractReferences,
    getCompletionsAtFromAnalysis,
    type FunctionCallNode,
    type SelectNode,
    type WithNode,
} from "../../src/parser/saral/index.js";
import { parseResult } from "./parser.helpers";

/**
 * Editor-stress regressions independently authored from observed T-SQL behavior. They exercise
 * parser contracts only; no SQLParser implementation or test source is reproduced here.
 */
describe("T-SQL Parser - editor stress regressions", () => {
    test("retains recursive CTE references through CAST expressions and OPTION", () => {
        const sql = `WITH Hierarchy AS (
    SELECT
        t.Id,
        t.ParentId,
        t.Name,
        0 AS Depth,
        CAST('/' + CAST(t.Id AS varchar(20)) AS varchar(max)) AS Path
    FROM dbo.DboScale00001 AS t
    WHERE t.ParentId IS NULL
    UNION ALL
    SELECT
        c.Id,
        c.ParentId,
        c.Name,
        h.Depth + 1,
        CAST(h.Path + '/' + CAST(c.Id AS varchar(20)) AS varchar(max))
    FROM dbo.DboScale00001 AS c
    INNER JOIN Hierarchy AS h
        ON c.ParentId = h.Id
)
SELECT *
FROM Hierarchy
OPTION (MAXRECURSION 100);`;

        const result = parseResult(sql);
        const statement = result.ast.body[0] as WithNode;
        const body = statement.body as SelectNode;
        const references = extractReferences(result.ast);

        expect(result.issues).toEqual([]);
        expect(body.optionClause?.hints).toContainEqual({
            kind: "MAXRECURSION",
            raw: "MAXRECURSION 100",
            value: 100,
        });
        expect(references).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: "column", name: "h.Depth" }),
                expect.objectContaining({ kind: "column", name: "h.Path" }),
            ]),
        );
    });

    test("preserves XML method receivers as column references", () => {
        const sql = `SELECT
    t.Id,
    n.value('(Name/text())[1]', 'nvarchar(100)') AS Name,
    n.value('(Value/text())[1]', 'int') AS Value
FROM dbo.DboScale00001 AS t
CROSS APPLY t.XmlData.nodes('/Root/Item') AS x(n)
WHERE n.exist('Value[. > 10]') = 1;`;

        const result = parseResult(sql);
        const statement = result.ast.body[0] as SelectNode;
        const [nameColumn] = statement.columns.slice(1);
        const nodes = statement.from?.[0].joins[0].table as FunctionCallNode;
        const references = extractReferences(result.ast);

        expect(result.issues).toEqual([]);
        expect((nameColumn.expression as FunctionCallNode).receiver).toMatchObject({
            name: "n",
            parts: ["n"],
        });
        expect(nodes.receiver).toMatchObject({
            name: "t.XmlData",
            parts: ["t", "XmlData"],
        });
        expect(references).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: "column", name: "t.XmlData" }),
                expect.objectContaining({ kind: "column", name: "n" }),
            ]),
        );
    });

    test("offers intact CTE output after an incomplete inner projection", () => {
        const markedSql = `WITH x AS (
    SELECT
        t.Id,
        t.
    FROM dbo.DboScale00001 AS t
)
SELECT x.|\nFROM x;`;
        const offset = markedSql.indexOf("|");
        const sql = markedSql.replace("|", "");
        const analysis = analyze(sql);
        const completions = getCompletionsAtFromAnalysis(sql, analysis, offset);

        expect(analysis.issues.map((issue) => issue.code)).toEqual([
            "PARSE_IDENTIFIER_DOT",
            "PARSE_IDENTIFIER_DOT",
        ]);
        expect(completions.map((item) => item.label)).toContain("Id");
    });
});
