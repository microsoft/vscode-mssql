import { Lexer } from "../../src/parser/saral/parser/lexer.js";
import { Parser } from "../../src/parser/saral/parser/parser.js";

type LegacyCase = {
    name: string;
    sql: string;
    expectedType: string;
    aliases?: Array<string | undefined>;
};

function parseResult(sql: string) {
    return new Parser(new Lexer(sql)).parse();
}

function firstStatement(sql: string) {
    const result = parseResult(sql);
    expect(result.issues).toHaveLength(0);
    expect(result.ast.body.length).toBeGreaterThan(0);
    return {
        result,
        stmt: result.ast.body[0] as any,
    };
}

describe("Legacy T-SQL syntax coverage", () => {
    const cases: LegacyCase[] = [
        {
            name: "numeric literal with implicit string alias",
            sql: `SELECT 1 'One';`,
            expectedType: "SelectStatement",
            aliases: ["One"],
        },
        {
            name: "numeric literal with AS string alias",
            sql: `SELECT 1 AS 'One';`,
            expectedType: "SelectStatement",
            aliases: ["One"],
        },
        {
            name: "variable with implicit string alias",
            sql: `SELECT @Value 'Reported Value';`,
            expectedType: "SelectStatement",
            aliases: ["Reported Value"],
        },
        {
            name: "variable with AS string alias",
            sql: `SELECT @Value AS 'Reported Value';`,
            expectedType: "SelectStatement",
            aliases: ["Reported Value"],
        },
        {
            name: "CASE expression with implicit string alias",
            sql: `SELECT CASE Region WHEN 1 THEN 'SCDH' ELSE 'PRISM' END 'Source' FROM dbo.Country;`,
            expectedType: "SelectStatement",
            aliases: ["Source"],
        },
        {
            name: "CASE expression with AS string alias",
            sql: `SELECT CASE Region WHEN 1 THEN 'SCDH' ELSE 'PRISM' END AS 'Source' FROM dbo.Country;`,
            expectedType: "SelectStatement",
            aliases: ["Source"],
        },
        {
            name: "datetime member with spaced implicit string alias",
            sql: `SELECT i.InventoryStatusChangedDateTime 'Updated Date' FROM dbo.Inventory i;`,
            expectedType: "SelectStatement",
            aliases: ["Updated Date"],
        },
        {
            name: "aggregate with implicit string alias",
            sql: `SELECT COUNT(*) 'Total Rows' FROM dbo.Inventory;`,
            expectedType: "SelectStatement",
            aliases: ["Total Rows"],
        },
        {
            name: "scalar function with AS string alias",
            sql: `SELECT GETUTCDATE() AS 'Created On';`,
            expectedType: "SelectStatement",
            aliases: ["Created On"],
        },
        {
            name: "NULL literal with implicit string alias",
            sql: `SELECT NULL 'Nothing';`,
            expectedType: "SelectStatement",
            aliases: ["Nothing"],
        },
        {
            name: "TOP DISTINCT with implicit string alias",
            sql: `SELECT DISTINCT TOP (10) p.SKU 'Sku Number' FROM dbo.Product p;`,
            expectedType: "SelectStatement",
            aliases: ["Sku Number"],
        },
        {
            name: "CTE projection with implicit string alias",
            sql: `WITH X AS (SELECT 1 Id) SELECT Id 'Identifier' FROM X;`,
            expectedType: "WithStatement",
        },
        {
            name: "set operator branches with string aliases",
            sql: `SELECT 1 'FirstValue' UNION ALL SELECT 2 'SecondValue';`,
            expectedType: "SetOperator",
        },
        {
            name: "subquery projection with implicit string alias",
            sql: `SELECT d.Id 'Inner Id' FROM (SELECT 1 AS Id) d;`,
            expectedType: "SelectStatement",
            aliases: ["Inner Id"],
        },
        {
            name: "join with nolock and legacy aliases",
            sql: `
                SELECT c.Code 'Country Code',
                       p.SKU 'Sku',
                       i.OnHand 'On Hand'
                FROM dbo.Inventory i WITH (NOLOCK)
                JOIN dbo.ProductCountry pc WITH (NOLOCK) ON i.ProductCountryID = pc.Id
                JOIN dbo.Product p WITH (NOLOCK) ON pc.ProductId = p.Id
                JOIN dbo.Country c WITH (NOLOCK) ON pc.CountryId = c.Id;
            `,
            expectedType: "SelectStatement",
            aliases: ["Country Code", "Sku", "On Hand"],
        },
        {
            name: "old-style report query with CASE and dated alias",
            sql: `
                SELECT c.Code,
                       CASE c.Region WHEN 1 THEN 'SCDH' ELSE 'PRISM' END 'Source',
                       i.InventoryStatusChangedDateTime 'Updated Date'
                FROM dbo.Inventory i WITH (NOLOCK)
                JOIN dbo.Country c WITH (NOLOCK) ON c.Id = i.Id
                WHERE 1 = 1;
            `,
            expectedType: "SelectStatement",
        },
        {
            name: "procedure returning old-style string aliases",
            sql: `
                CREATE PROCEDURE dbo.ReportProc
                AS
                BEGIN
                    SELECT @UploadedFileName AS 'UploadedFileName',
                           @InternalFileName 'InternalFileName';
                END
            `,
            expectedType: "CreateStatement",
        },
        {
            name: "procedure with report query and nolock joins",
            sql: `
                CREATE PROCEDURE dbo.ReportProc2
                AS
                BEGIN
                    SELECT c.Code,
                           CASE c.Region WHEN 1 THEN 'SCDH' ELSE 'PRISM' END 'Source',
                           i.InventoryStatusChangedDateTime 'Updated Date'
                    FROM dbo.Inventory i WITH (NOLOCK)
                    JOIN dbo.Country c WITH (NOLOCK) ON c.Id = i.Id
                    WHERE i.Id > 0;
                END
            `,
            expectedType: "CreateStatement",
        },
        {
            name: "mixed identifier and string aliases in select list",
            sql: `SELECT p.SKU AS ItemCode, p.FGA 'Model Name' FROM dbo.Product p;`,
            expectedType: "SelectStatement",
            aliases: ["ItemCode", "Model Name"],
        },
        {
            name: "exists predicate with old-style alias in projection",
            sql: `
                SELECT p.SKU 'Sku'
                FROM dbo.Product p
                WHERE EXISTS (SELECT 1 FROM dbo.Inventory i WHERE i.Id = p.Id);
            `,
            expectedType: "SelectStatement",
            aliases: ["Sku"],
        },
    ];

    test.each(cases)("$name", ({ sql, expectedType, aliases }) => {
        const { stmt } = firstStatement(sql);

        expect(stmt.type).toBe(expectedType);

        if (expectedType === "SelectStatement" && aliases) {
            expect(stmt.columns.map((col: any) => col.alias)).toEqual(aliases);
        }
    });
});
