import { Lexer } from "../../src/parser/saral/parser/lexer.js";
import { type SelectNode, type SetNode } from "../../src/parser/saral/ast/types.js";
import { Parser } from "../../src/parser/saral/parser/parser.js";
import { toSql } from "./parser.helpers";

describe("T-SQL Parser - Expressions", () => {
    const parse = (sql: string) => {
        const lexer = new Lexer(sql);
        const parser = new Parser(lexer);
        return parser.parse().ast;
    };

    test("should handle IN clause (1, 2, 3)", () => {
        const sql = `SELECT x FROM T WHERE ID IN (1, 2, 3)`;
        expect(toSql((parse(sql).body[0] as SelectNode).where)).toBe("ID IN (1, 2, 3)");
    });

    test("should handle IN clause with subquery", () => {
        const sql = `SELECT x FROM T WHERE ID IN (SELECT ID FROM T2)`;
        expect(toSql((parse(sql).body[0] as SelectNode).where)).toContain("SelectStatement");
    });

    test("should handle BETWEEN clause", () => {
        const sql = `SELECT x FROM T WHERE Y BETWEEN 1 AND 10`;
        expect(toSql((parse(sql).body[0] as SelectNode).where)).toBe("Y BETWEEN 1 AND 10");
    });

    test("should handle complex IN and BETWEEN combination", () => {
        const sql = `SELECT * FROM T WHERE A IN (1) AND B BETWEEN 1 AND 2`;
        expect(toSql((parse(sql).body[0] as SelectNode).where)).toBe(
            "A IN (1) AND B BETWEEN 1 AND 2",
        );
    });

    test("should handle CASE WHEN", () => {
        const sql = `SELECT CASE WHEN 1=1 THEN 'A' END`;
        expect(toSql((parse(sql).body[0] as SelectNode).columns[0].expression)).toBe(
            "CASE WHEN 1 = 1 THEN 'A' END",
        );
    });

    test("should handle EXISTS subquery", () => {
        const sql = `SELECT 1 WHERE EXISTS (SELECT 1)`;

        const where = (parse(sql).body[0] as SelectNode).where;

        expect(where).toBeDefined();

        expect(where!.type).toBe("ExistsExpression");

        expect(toSql(where!)).toContain("EXISTS");
    });

    test("should handle (1 + 2) * 3", () => {
        const sql = `SET @X = (1 + 2) * 3`;
        expect(toSql((parse(sql).body[0] as SetNode).value)).toBe("(1 + 2) * 3");
    });

    test("should parse static member call with double colon", () => {
        const stmt = parse(`SELECT GEOGRAPHY::Point(@Latitude, @Longitude, 4326) AS GeoLocation`)
            .body[0] as SelectNode;
        const expr = stmt.columns[0].expression as any;

        expect(expr.type).toBe("FunctionCall");
        expect(expr.name).toBe("GEOGRAPHY.Point");
        expect(expr.args).toHaveLength(3);
    });

    test("should handle IS NOT NULL and NOT IN", () => {
        const sql = `SELECT x FROM T WHERE y IS NOT NULL AND z NOT IN (1, 2)`;
        const stmt = parse(sql).body[0] as SelectNode;
        expect(toSql(stmt.where)).toContain("IS NOT NULL");
        expect(toSql(stmt.where)).toContain("NOT IN (1, 2)");
    });

    test("Fix Check: should correctly stringify prefix vs postfix unary operators", () => {
        const sql = `SELECT Name FROM Users WHERE NOT ID = 1 AND DeletedAt IS NULL`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;

        const whereSql = toSql(stmt.where);
        expect(whereSql).toContain("NOT");
        expect(whereSql).toMatch(/ID\s*=\s*1/);
        expect(whereSql).toMatch(/DeletedAt IS NULL/);
    });

    test("should handle deeply nested function calls and math", () => {
        const sql = `SELECT ROUND(SUM(Sales) * (1 + @TaxRate), 2) FROM Data`;
        const ast = parse(sql);
        const col = (ast.body[0] as SelectNode).columns[0];

        expect(col.expression.type).toBe("FunctionCall");
        const func = col.expression as any;
        expect(func.args[0].type).toBe("BinaryExpression");
        expect(func.args[0].operator).toBe("*");
    });

    test("should handle Boolean logic precedence (AND vs OR)", () => {
        const sql = `SELECT * FROM T WHERE A = 1 OR B = 2 AND C = 3`;
        const ast = parse(sql);
        const where = (ast.body[0] as SelectNode).where as any;

        expect(where.operator).toBe("OR");
        expect(where.right.operator).toBe("AND"); // Proves AND was grouped first
    });

    test("should handle complex CASE WHEN with nested logic", () => {
        const sql = `
            SELECT CASE
                WHEN Type = 1 THEN (Price * 0.9)
                WHEN Type IN (2, 3) THEN Price
                ELSE 0
            END FROM Products`;
        const ast = parse(sql);
        const expr = (ast.body[0] as SelectNode).columns[0].expression as any;

        expect(expr.type).toBe("CaseExpression");
        expect(expr.branches[0].then.type).toBe("GroupingExpression");
        expect(expr.branches[1].when.type).toBe("InExpression");
    });

    test("should handle complex IN clause with subquery and parameters", () => {
        const sql = `SELECT * FROM Users WHERE ID NOT IN (SELECT UserID FROM Blacklist) AND Status = @Status`;
        const ast = parse(sql);
        const where = (ast.body[0] as SelectNode).where as any;

        expect(where.type).toBe("BinaryExpression");
        expect(where.left.type).toBe("InExpression");
        expect(where.left.isNot).toBe(true);
        expect(where.left.subquery).toBeDefined();
    });

    test("should handle T-SQL casting and collation", () => {
        const sql = `SELECT [dbo].[fn_Compute](Name) COLLATE Latin1_General_CS_AS FROM Users`;
        const ast = parse(sql);
        const col = (ast.body[0] as SelectNode).columns[0];

        const expr =
            col.expression.type === "BinaryExpression"
                ? (col.expression as any).left
                : col.expression;

        expect(expr.type).toBe("FunctionCall");
    });

    test("should handle negative numbers and unary NOT", () => {
        const sql = "SELECT -10 + (NOT 1)";
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;
        const val = stmt.columns[0].expression as any;

        expect(val.left.type).toBe("Literal");
        expect(val.left.value).toBe(-10);
        expect(val.left.variant).toBe("number");

        const rightSide = val.right.expression; // Inside the Grouping
        expect(rightSide.type).toBe("UnaryExpression");
        expect(rightSide.operator).toBe("NOT");
    });

    test("Should resolve 3-part identifiers", () => {
        const sql = "SELECT [DB].[Schema].[Table] FROM T";
        const parser = new Parser(new Lexer(sql));
        const ast = parser.parse().ast;

        const select = ast.body[0] as SelectNode;
        const identifier = select.columns[0].expression as any;

        expect(identifier.type).toBe("Identifier");
        expect(identifier.parts).toEqual(["[DB]", "[Schema]", "[Table]"]);
        expect(identifier.name).toBe("[DB].[Schema].[Table]");
    });

    test("Should handle mixed bracketed and standard segments", () => {
        const sql = "SELECT dbo.[Users] FROM T";
        const parser = new Parser(new Lexer(sql));
        const ast = parser.parse().ast;

        const identifier = (ast.body[0] as any).columns[0].expression;
        expect(identifier.name).toBe("dbo.[Users]");
    });

    test("Should maintain correct offsets for the whole multipart string", () => {
        const sql = "SELECT   dbo.Table";
        const parser = new Parser(new Lexer(sql));
        const ast = parser.parse().ast;
        const identifier = (ast.body[0] as any).columns[0].expression;

        // "SELECT" (6) + 3 spaces = index 9
        expect(identifier.start).toBe(9);
        // index 9 + "dbo.Table" (9 chars) = index 18
        expect(identifier.end).toBe(18);
    });

    test("BETWEEN expression location bounds", () => {
        const sql = "SELECT x FROM T WHERE Y BETWEEN 1 AND 10";
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;
        const between = stmt.where as any;

        expect(sql.substring(between.start, between.end)).toBe("Y BETWEEN 1 AND 10");
    });

    test("should fold negative numbers into single Literals", () => {
        const sql = "SELECT -50, NOT 1";
        const ast = parse(sql);
        const select = ast.body[0] as any;

        const firstCol = select.columns[0].expression;
        const secondCol = select.columns[1].expression;

        expect(firstCol.type).toBe("Literal");
        expect(firstCol.value).toBe(-50);

        expect(secondCol.type).toBe("UnaryExpression");
        expect(secondCol.operator).toBe("NOT");
    });

    test("should handle Dot precedence in complex expressions", () => {
        const sql = "SELECT u.ID + 10 FROM Users u";
        const ast = parse(sql);
        const select = ast.body[0] as any;
        const expr = select.columns[0].expression;

        // If Dot precedence was low, + would grab 'ID' and fail.
        expect(expr.type).toBe("BinaryExpression");
        expect(expr.operator).toBe("+");
        expect(expr.left.type).toBe("Identifier");
        expect(expr.left.name).toBe("u.ID");
    });

    test("should handle empty parseList resilience in Functions", () => {
        const sql = "SELECT COUNT(), GETDATE()";
        expect(() => parse(sql)).not.toThrow();
        const ast = parse(sql);
        const select = ast.body[0] as any;

        expect(select.columns[0].expression.args.length).toBe(0);
    });

    test("should parse built-in keyword arguments in DATEDIFF correctly", () => {
        const sql = "SELECT DATEDIFF(day, StartDate, EndDate) FROM Dates";
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;
        const funcCall = stmt.columns[0].expression as any;

        expect(funcCall.type).toBe("FunctionCall");
        expect(funcCall.name).toBe("DATEDIFF");
        expect(funcCall.args).toHaveLength(3);

        expect(funcCall.args[0].type).toBe("BuiltInArgument");
        expect(funcCall.args[0].value).toBe("day");
        expect(funcCall.args[1].type).toBe("Identifier");
        expect(funcCall.args[2].type).toBe("Identifier");
    });

    test("Architectural: should handle complex expressions in GROUP BY and ORDER BY", () => {
        const sql = `SELECT Year FROM Sales GROUP BY DATEPART(year, SaleDate) ORDER BY CASE WHEN Year > 2000 THEN 1 ELSE 0 END`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;

        expect(stmt.groupBy![0].type).toBe("FunctionCall");
        expect(stmt.orderBy![0].expression.type).toBe("CaseExpression");
    });
});
