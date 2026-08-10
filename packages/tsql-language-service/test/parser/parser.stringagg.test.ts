import { parseOne, parseResult } from "./parser.helpers";

describe("T-SQL Parser - STRING_AGG WITHIN GROUP", () => {
    test("should parse STRING_AGG with WITHIN GROUP ORDER BY", () => {
        const stmt = parseOne<any>(`
            SELECT STRING_AGG(item.Name, ',') WITHIN GROUP (ORDER BY item.Name DESC) AS ItemNames
            FROM dbo.Items item
        `);

        const expr = stmt.columns[0].expression;

        expect(expr.type).toBe("FunctionCall");
        expect(expr.name).toBe("STRING_AGG");
        expect(expr.args).toHaveLength(2);
        expect(expr.withinGroup).toHaveLength(1);
        expect(expr.withinGroup[0].direction).toBe("DESC");
    });

    test("should parse ordered aggregate inside joined subquery", () => {
        const result = parseResult(`
            SELECT ISNULL(aggregated.ItemNames, '') AS ItemNames
            FROM dbo.Items item
            LEFT JOIN (
                SELECT parentItem.Id,
                       STRING_AGG(childItem.Name, ',') WITHIN GROUP (ORDER BY childItem.Name) AS ItemNames
                FROM dbo.ParentItems parentItem
                LEFT JOIN dbo.ChildItems childItem ON childItem.ParentId = parentItem.Id
                GROUP BY parentItem.Id
            ) AS aggregated ON aggregated.Id = item.Id
        `);

        expect(result.issues).toHaveLength(0);
        expect(result.ast.body[0].type).toBe("SelectStatement");
    });

    test("should not treat WITHIN as an implicit alias after STRING_AGG", () => {
        const result = parseResult(`
            SELECT STRING_AGG(item.Name, ',') WITHIN GROUP (ORDER BY item.Name) AS ItemNames
            FROM dbo.Items item
        `);

        const stmt = result.ast.body[0] as any;

        expect(result.issues).toHaveLength(0);
        expect(stmt.columns[0].alias).toBe("ItemNames");
        expect(stmt.columns[0].expression.withinGroup).toHaveLength(1);
    });
});
