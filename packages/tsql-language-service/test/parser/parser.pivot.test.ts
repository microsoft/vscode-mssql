import { Lexer } from "../../src/parser/saral/parser/lexer.js";
import { Parser } from "../../src/parser/saral/parser/parser.js";

function parseResult(sql: string) {
    return new Parser(new Lexer(sql)).parse();
}

describe("PIVOT parsing", () => {
    test("parses basic PIVOT over subquery", () => {
        const sql = `
            SELECT pvt.ProductId, pvt.[North], pvt.[South]
            FROM (
                SELECT ProductId, RegionName, Amount
                FROM dbo.Sales
            ) src
            PIVOT (
                SUM(Amount)
                FOR RegionName IN ([North], [South])
            ) pvt;
        `;

        const result = parseResult(sql);
        const stmt = result.ast.body[0] as any;
        const from = stmt.from[0];

        expect(result.issues).toHaveLength(0);
        expect(stmt.type).toBe("SelectStatement");
        expect(from.pivot).toBeDefined();
        expect(from.pivot.type).toBe("PivotClause");
        expect(from.pivot.sourceAlias).toBe("src");
        expect(from.alias).toBe("pvt");
        expect(from.pivot.forColumn.name).toBe("RegionName");
        expect(from.pivot.inColumns.map((x: any) => x.name)).toEqual(["[North]", "[South]"]);
    });

    test("parses PIVOT over table source with source alias", () => {
        const sql = `
            SELECT p.[Open], p.[Closed]
            FROM dbo.TicketFacts tf
            PIVOT (
                COUNT(Status)
                FOR Status IN ([Open], [Closed])
            ) p;
        `;

        const result = parseResult(sql);
        const from = (result.ast.body[0] as any).from[0];

        expect(result.issues).toHaveLength(0);
        expect(from.pivot.sourceAlias).toBe("tf");
        expect(from.alias).toBe("p");
        expect(from.pivot.aggregate.type).toBe("FunctionCall");
    });

    test("parses joins after PIVOT alias", () => {
        const sql = `
            SELECT pvt.ProductId, d.Name
            FROM (
                SELECT ProductId, RegionName, Amount
                FROM dbo.Sales
            ) src
            PIVOT (
                SUM(Amount)
                FOR RegionName IN ([North], [South])
            ) pvt
            JOIN dbo.Dimension d ON d.ProductId = pvt.ProductId;
        `;

        const result = parseResult(sql);
        const from = (result.ast.body[0] as any).from[0];

        expect(result.issues).toHaveLength(0);
        expect(from.joins).toHaveLength(1);
        expect(from.alias).toBe("pvt");
    });

    test("reports recoverable issue when PIVOT alias is missing", () => {
        const sql = `
            SELECT *
            FROM (
                SELECT ProductId, RegionName, Amount
                FROM dbo.Sales
            ) src
            PIVOT (
                SUM(Amount)
                FOR RegionName IN ([North], [South])
            );
        `;

        const result = parseResult(sql);
        const from = (result.ast.body[0] as any).from[0];

        expect(from.pivot).toBeDefined();
        expect(from.incomplete).toBe(true);
        expect((result.issues ?? []).map((x: any) => x.code)).toContain("PARSE_PIVOT_ALIAS");
        expect(from.errors).toContain("Expected alias after PIVOT clause");
    });

    test("reports recoverable issue for malformed PIVOT IN list", () => {
        const sql = `
            SELECT *
            FROM (
                SELECT ProductId, RegionName, Amount
                FROM dbo.Sales
            ) src
            PIVOT (
                SUM(Amount)
                FOR RegionName IN ([North], +)
            ) pvt;
        `;

        const result = parseResult(sql);
        const from = (result.ast.body[0] as any).from[0];

        expect(from.pivot).toBeDefined();
        expect(from.pivot.incomplete).toBe(true);
    });
});
