import { parseResult } from "./parser.helpers";
import { type BlockNode } from "../../src/parser/saral/ast/types.js";

type QuirkyCase = {
    name: string;
    statement: string;
    expectedType: string;
};

function buildScript(statement: string): string {
    return `
        SELECT 0 AS BeforeValue;
        ${statement}
        SELECT 2 AS AfterValue;
    `;
}

describe("T-SQL quirky syntax in multi-statement scripts", () => {
    const cases: QuirkyCase[] = [
        {
            name: "statement-style variable assignment in SELECT",
            statement: "SELECT @Total = SUM(Amount) FROM dbo.Payments;",
            expectedType: "SelectStatement",
        },
        {
            name: "TOP PERCENT WITH TIES",
            statement: "SELECT TOP (10) PERCENT WITH TIES Id FROM dbo.Users ORDER BY Id;",
            expectedType: "SelectStatement",
        },
        {
            name: "leading semicolon before CTE",
            statement: ";WITH X AS (SELECT 1 AS Id) SELECT Id FROM X;",
            expectedType: "WithStatement",
        },
        {
            name: "leading semicolon before CTE inside block",
            statement: "BEGIN ;WITH X AS (SELECT 1 AS Id) SELECT Id FROM X; END",
            expectedType: "BlockStatement",
        },
        {
            name: "DELETE alias target with FROM join",
            statement: "DELETE t FROM dbo.Target t INNER JOIN dbo.Source s ON t.Id = s.Id;",
            expectedType: "DeleteStatement",
        },
        {
            name: "UPDATE target with FROM and table hint",
            statement:
                "UPDATE t SET t.Name = s.Name FROM dbo.Target t WITH (UPDLOCK) INNER JOIN dbo.Source s ON t.Id = s.Id;",
            expectedType: "UpdateStatement",
        },
        {
            name: "CROSS APPLY derived table",
            statement: "SELECT a.Id FROM dbo.Accounts a CROSS APPLY (SELECT a.Id AS AccountId) x;",
            expectedType: "SelectStatement",
        },
        {
            name: "MERGE with matched and not matched actions",
            statement: `MERGE dbo.Target AS T
                USING dbo.Source AS S
                    ON T.Id = S.Id
                WHEN MATCHED THEN
                    UPDATE SET T.Name = S.Name
                WHEN NOT MATCHED THEN
                    INSERT (Id, Name)
                    VALUES (S.Id, S.Name);`,
            expectedType: "MergeStatement",
        },
    ];

    test.each(cases)(
        "$name parses cleanly beside neighboring statements",
        ({ statement, expectedType }) => {
            const result = parseResult(buildScript(statement));
            const body = result.ast.body;

            expect(result.issues).toEqual([]);
            expect(body.length).toBeGreaterThanOrEqual(3);

            expect(body[0].type).toBe("SelectStatement");
            expect(body[1].type).toBe(expectedType);
            expect(body[body.length - 1].type).toBe("SelectStatement");

            expect(body[0].type).not.toBe("ErrorStatement");
            expect(body[1].type).not.toBe("ErrorStatement");
            expect(body[body.length - 1].type).not.toBe("ErrorStatement");

            if (expectedType === "BlockStatement") {
                const block = body[1] as BlockNode;
                expect(block.type).toBe("BlockStatement");
                expect(block.body[0].type).toBe("WithStatement");
            }
        },
    );
});
