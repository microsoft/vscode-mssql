import { Lexer } from "../../src/parser/saral/parser/lexer.js";
import { Parser } from "../../src/parser/saral/parser/parser.js";

function parseResult(sql: string) {
    return new Parser(new Lexer(sql)).parse();
}

describe("UNPIVOT parsing", () => {
    test("parses basic UNPIVOT over subquery", () => {
        const sql = `
            SELECT unpvt.ProductId, unpvt.AttributeName, unpvt.AttributeValue
            FROM (
                SELECT ProductId, Color, Size
                FROM dbo.Products
            ) src
            UNPIVOT (
                AttributeValue
                FOR AttributeName IN ([Color], [Size])
            ) unpvt;
        `;

        const result = parseResult(sql);
        const stmt = result.ast.body[0] as any;
        const from = stmt.from[0];

        expect(result.issues).toHaveLength(0);
        expect(stmt.type).toBe("SelectStatement");
        expect(from.unpivot).toBeDefined();
        expect(from.unpivot.type).toBe("UnpivotClause");
        expect(from.unpivot.sourceAlias).toBe("src");
        expect(from.alias).toBe("unpvt");
        expect(from.unpivot.valueColumn.name).toBe("AttributeValue");
        expect(from.unpivot.forColumn.name).toBe("AttributeName");
        expect(from.unpivot.inColumns.map((x: any) => x.name)).toEqual(["[Color]", "[Size]"]);
    });

    test("parses UNPIVOT over table source with source alias", () => {
        const sql = `
            SELECT u.AttributeName, u.AttributeValue
            FROM dbo.Products p
            UNPIVOT (
                AttributeValue
                FOR AttributeName IN ([Color], [Size])
            ) u;
        `;

        const result = parseResult(sql);
        const from = (result.ast.body[0] as any).from[0];

        expect(result.issues).toHaveLength(0);
        expect(from.unpivot.sourceAlias).toBe("p");
        expect(from.alias).toBe("u");
    });

    test("parses joins after UNPIVOT alias", () => {
        const sql = `
            SELECT u.ProductId, d.Name
            FROM (
                SELECT ProductId, Color, Size
                FROM dbo.Products
            ) src
            UNPIVOT (
                AttributeValue
                FOR AttributeName IN ([Color], [Size])
            ) u
            JOIN dbo.Dimension d ON d.ProductId = u.ProductId;
        `;

        const result = parseResult(sql);
        const from = (result.ast.body[0] as any).from[0];

        expect(result.issues).toHaveLength(0);
        expect(from.joins).toHaveLength(1);
        expect(from.alias).toBe("u");
    });

    test("parses UNPIVOT after joined source", () => {
        const sql = `
            SELECT *
            FROM (
                SELECT srcItem.Item, sourceUnpivot.Quantity
                FROM dbo.SourceItems srcItem
                JOIN dbo.ConfigRows cfgRow ON cfgRow.Item = srcItem.Item
                UNPIVOT (
                    Quantity
                    FOR BucketName IN ([MRP_1], [MRP_2])
                ) sourceUnpivot
            ) outerRows;
        `;

        const result = parseResult(sql);
        const from = (result.ast.body[0] as any).from[0];
        const innerFrom = from.table.query.from[0];

        expect(result.issues).toHaveLength(0);
        expect(from.alias).toBe("outerRows");
        expect(innerFrom.unpivot).toBeDefined();
        expect(innerFrom.alias).toBe("sourceUnpivot");
        expect(innerFrom.joins).toHaveLength(1);
    });

    test("reports recoverable issue when UNPIVOT alias is missing", () => {
        const sql = `
            SELECT *
            FROM (
                SELECT ProductId, Color, Size
                FROM dbo.Products
            ) src
            UNPIVOT (
                AttributeValue
                FOR AttributeName IN ([Color], [Size])
            );
        `;

        const result = parseResult(sql);
        const from = (result.ast.body[0] as any).from[0];

        expect(from.unpivot).toBeDefined();
        expect(from.incomplete).toBe(true);
        expect((result.issues ?? []).map((x: any) => x.code)).toContain("PARSE_UNPIVOT_ALIAS");
        expect(from.errors).toContain("Expected alias after UNPIVOT clause");
    });

    test("reports recoverable issue for malformed UNPIVOT IN list", () => {
        const sql = `
            SELECT *
            FROM (
                SELECT ProductId, Color, Size
                FROM dbo.Products
            ) src
            UNPIVOT (
                AttributeValue
                FOR AttributeName IN ([Color], +)
            ) u;
        `;

        const result = parseResult(sql);
        const from = (result.ast.body[0] as any).from[0];

        expect(from.unpivot).toBeDefined();
        expect(from.unpivot.incomplete).toBe(true);
    });
});
