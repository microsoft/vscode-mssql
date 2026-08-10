import { Lexer } from "../../src/parser/saral/parser/lexer.js";
import {
    type SelectNode,
    type UpdateNode,
    type WithNode,
    type SetOperatorNode,
} from "../../src/parser/saral/ast/types.js";
import { Parser } from "../../src/parser/saral/parser/parser.js";
import { toSql, getTableName } from "./parser.helpers";

describe("T-SQL Parser - SELECT clauses", () => {
    const parse = (sql: string) => {
        const lexer = new Lexer(sql);
        const parser = new Parser(lexer);
        return parser.parse().ast;
    };

    test("should build AST for a basic SELECT", () => {
        const sql = "SELECT Name, Age FROM Users WHERE Id = 1;";
        const ast = parse(sql);
        expect(ast).toMatchSnapshot();
    });

    test("should handle bracketed identifiers and spaces", () => {
        const sql = `SELECT [First Name] FROM [Sales].[Customer Orders]`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;

        expect(stmt.columns[0].sourceName).toBe("[First Name]");
        expect(stmt.columns[0].outputName).toBe("[First Name]");

        expect(getTableName(stmt.from?.[0].table)).toBe("[Sales].[Customer Orders]");
    });

    test("should handle escaped closing bracket inside bracketed identifier", () => {
        const sql = `SELECT [My]]Column] FROM [dbo].[T]`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;

        expect(stmt.columns[0].sourceName).toBe("[My]]Column]");
        expect(getTableName(stmt.from?.[0].table)).toBe("[dbo].[T]");
    });

    test("should handle WHERE clause with T-SQL operators", () => {
        const sql = `SELECT Name FROM Users WHERE Status = 'Active' AND [Date] >= '2025-01-01'`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;
        expect(toSql(stmt.where)).toMatch(/Status = 'Active' AND \[Date\] >= '2025-01-01'/);
    });

    test("should handle ORDER BY with multiple columns", () => {
        const sql = `SELECT Name FROM Users ORDER BY Name, Id DESC`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;
        expect(stmt.orderBy).toHaveLength(2);
        expect(stmt.orderBy![0].direction).toBe("ASC");
        expect(stmt.orderBy![1].direction).toBe("DESC");
    });

    test("should handle GROUP BY with multiple columns", () => {
        const sql = `SELECT R, C FROM T GROUP BY R, C`;
        const ast = parse(sql);
        expect((ast.body[0] as SelectNode).groupBy).toHaveLength(2);
    });

    test("should handle GROUP BY with HAVING clause", () => {
        const sql = `SELECT C FROM T GROUP BY C HAVING SUM(S) > 1000`;
        const ast = parse(sql);
        expect(toSql((ast.body[0] as SelectNode).having)).toBe("SUM(S) > 1000");
    });

    test("should handle SELECT DISTINCT", () => {
        const sql = `SELECT DISTINCT Name FROM Users`;
        expect((parse(sql).body[0] as SelectNode).distinct).toBe(true);
    });

    test("should parse SELECT DISTINCT with leading unary plus concatenation", () => {
        const sql = `
            SELECT DISTINCT + @LineBreak + 'Message ' + CAST(item.RowNum AS VARCHAR(10))
            FROM dbo.Items item
        `;

        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0] as SelectNode;
        const expr = stmt.columns[0].expression;

        expect(result.issues).toHaveLength(0);
        expect(stmt.distinct).toBe(true);
        expect(expr.type).toBe("BinaryExpression");
        if (expr.type !== "BinaryExpression") {
            throw new Error("Expected select expression to be a BinaryExpression");
        }
        const leftConcat = expr.left;
        expect(leftConcat.type).toBe("BinaryExpression");
        if (leftConcat.type !== "BinaryExpression") {
            throw new Error("Expected left concatenation to be a BinaryExpression");
        }
        expect(leftConcat.left.type).toBe("UnaryExpression");
        if (leftConcat.left.type !== "UnaryExpression") {
            throw new Error("Expected leading expression to be a UnaryExpression");
        }
        expect(leftConcat.left.operator).toBe("+");
    });

    test("should parse COUNT DISTINCT inside aggregate function arguments", () => {
        const sql = `SELECT COUNT(DISTINCT h.HolidayDate) AS HolidayCount FROM dbo.Holiday h`;
        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0] as SelectNode;
        const expr = stmt.columns[0].expression;

        expect(result.issues).toEqual([]);
        expect(expr.type).toBe("FunctionCall");

        if (expr.type !== "FunctionCall") {
            throw new Error("Expected aggregate expression to be a FunctionCall");
        }

        expect(expr.name.toUpperCase()).toBe("COUNT");
        expect(expr.distinct).toBe(true);
        expect(expr.args).toHaveLength(1);
    });

    test("should parse SUM DISTINCT inside aggregate function arguments", () => {
        const sql = `SELECT SUM(DISTINCT o.Amount) AS TotalAmount FROM Orders o`;
        const result = new Parser(new Lexer(sql)).parse();

        expect(result.issues).toEqual([]);
    });

    test("should handle SELECT ALL", () => {
        const sql = `SELECT ALL Name FROM Users`;
        expect((parse(sql).body[0] as SelectNode).distinct).toBe(false);
    });

    test("should handle SELECT INTO simple", () => {
        const sql = `SELECT Id INTO #Tmp FROM Users`;
        const stmt = parse(sql).body[0] as SelectNode;
        expect(stmt.into?.name).toBe("#Tmp");
    });

    test("should handle SELECT * INTO multipart schema", () => {
        const sql = `SELECT * INTO #Agg FROM X`;
        const stmt = parse(sql).body[0] as SelectNode;
        expect(stmt.into?.name).toBe("#Agg");
    });

    test("should handle assignment alias (ID = UserID)", () => {
        const sql = `SELECT ID = UserID FROM Users`;
        const col = (parse(sql).body[0] as SelectNode).columns[0];
        expect(col.alias).toBe("ID");
        expect(col.sourceName).toBe("UserID");
    });

    test("should handle AS alias (Name AS UserName)", () => {
        const sql = `SELECT Name AS UserName FROM Users`;
        const col = (parse(sql).body[0] as SelectNode).columns[0];
        expect(col.alias).toBe("UserName");
    });

    test("should handle implicit alias (Email UserEmail)", () => {
        const sql = `SELECT Email UserEmail FROM Users`;
        const col = (parse(sql).body[0] as SelectNode).columns[0];
        expect(col.alias).toBe("UserEmail");
    });

    test("should handle u.Name in SELECT", () => {
        const sql = `SELECT u.Name FROM Users u`;
        const col = (parse(sql).body[0] as SelectNode).columns[0];

        expect(col.alias).toBeUndefined();
        expect(col.sourceName).toBe("Name");
        expect(col.outputName).toBe("Name");

        expect(col.expression.type).toBe("Identifier");

        const expr = col.expression as any;

        expect(expr.name).toBe("u.Name");
        expect(expr.parts).toEqual(["u", "Name"]);
    });

    test("should not swallow WHERE as a table alias", () => {
        const sql = `SELECT Name FROM Users u WHERE ID = 1`;
        const stmt = parse(sql).body[0] as SelectNode;
        expect(stmt.from?.[0].alias).toBe("u");
        expect(stmt.where).not.toBeNull();
    });

    test("should handle Users AS u", () => {
        const sql = `SELECT Name FROM Users AS u`;
        expect((parse(sql).body[0] as SelectNode).from?.[0].alias).toBe("u");
    });

    test("should handle keyword column name in SELECT projection", () => {
        const sql = `SELECT OUTPUT, Name FROM T`;
        const node = parse(sql).body[0] as SelectNode;

        expect(node.type).toBe("SelectStatement");
        expect(node.columns[0].expression.type).toBe("Identifier");
        expect((node.columns[0].expression as any).name).toBe("OUTPUT");
    });

    test("should parse LEFT and RIGHT as scalar function calls in projections", () => {
        const sql = `
            SELECT LEFT(colA, 1) AS LeftValue,
                   RIGHT(colB, 2) AS RightValue
            FROM dbo.SampleRows
        `;

        const node = parse(sql).body[0] as SelectNode;

        expect(node.columns[0].expression.type).toBe("FunctionCall");
        expect((node.columns[0].expression as any).name).toBe("LEFT");
        expect(node.columns[1].expression.type).toBe("FunctionCall");
        expect((node.columns[1].expression as any).name).toBe("RIGHT");
    });

    test("should omit absent SELECT clauses from the AST", () => {
        const stmt = parse(`SELECT Id FROM dbo.Users`).body[0] as SelectNode;

        expect("top" in stmt).toBe(false);
        expect("where" in stmt).toBe(false);
        expect("groupBy" in stmt).toBe(false);
        expect("having" in stmt).toBe(false);
        expect("orderBy" in stmt).toBe(false);
        expect("into" in stmt).toBe(false);
        expect(stmt.from).toBeDefined();
    });

    test("should preserve temp table identifiers in expression position", () => {
        const stmt = parse("SELECT #Temp;").body[0] as SelectNode;
        const expr = stmt.columns[0].expression as any;

        expect(expr.type).toBe("Identifier");
        expect(expr.name).toBe("#Temp");
        expect(expr.parts).toEqual(["#Temp"]);
    });

    test("should preserve temp table multipart identifiers in expression position", () => {
        const stmt = parse("SELECT #Temp.Id;").body[0] as SelectNode;
        const expr = stmt.columns[0].expression as any;

        expect(expr.type).toBe("Identifier");
        expect(expr.name).toBe("#Temp.Id");
        expect(expr.parts).toEqual(["#Temp", "Id"]);
    });

    test("should preserve source casing for keyword-like multipart segments", () => {
        const stmt = parse("SELECT dbo.Target FROM dbo.Source;").body[0] as SelectNode;
        const expr = stmt.columns[0].expression as any;

        expect(expr.type).toBe("Identifier");
        expect(expr.name).toBe("dbo.Target");
        expect(expr.parts).toEqual(["dbo", "Target"]);
    });

    test("should parse SELECT columns with string literal aliases", () => {
        const sql = `
            SELECT @UploadedFileName AS 'UploadedFileName',
                   @InternalFileName AS 'InternalFileName'
        `;

        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0] as SelectNode;

        expect(result.issues).toHaveLength(0);
        expect(stmt.type).toBe("SelectStatement");
        expect(stmt.columns).toHaveLength(2);
        expect(stmt.columns[0].alias).toBe("UploadedFileName");
        expect(stmt.columns[1].alias).toBe("InternalFileName");
    });

    test("should parse SELECT columns with implicit string literal aliases", () => {
        const sql = `
            SELECT CASE category.RegionCode WHEN 1 THEN 'Primary' ELSE 'Secondary' END 'Source Label',
                   item.LastModifiedAt 'Modified Date'
            FROM dbo.Items item
            JOIN dbo.Category category ON category.Id = item.CategoryId
        `;

        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0] as SelectNode;

        expect(result.issues).toHaveLength(0);
        expect(stmt.type).toBe("SelectStatement");
        expect(stmt.columns).toHaveLength(2);
        expect(stmt.columns[0].alias).toBe("Source Label");
        expect(stmt.columns[1].alias).toBe("Modified Date");
        expect(stmt.from).toHaveLength(1);
        expect(stmt.from?.[0].joins).toHaveLength(1);
    });

    test("should handle UNION and EXCEPT", () => {
        const sql = `SELECT 1 UNION SELECT 2 EXCEPT SELECT 3`;
        const root = parse(sql).body[0] as SetOperatorNode;

        expect(root.operator).toBe("EXCEPT");
        expect((root.left as SetOperatorNode).operator).toBe("UNION");
    });

    test("should keep INTERSECT higher precedence than UNION", () => {
        const sql = `SELECT 1 UNION SELECT 2 INTERSECT SELECT 3`;
        const root = parse(sql).body[0] as SetOperatorNode;

        expect(root.operator).toBe("UNION");
        expect((root.right as SetOperatorNode).operator).toBe("INTERSECT");
    });

    test("should accept a parenthesized query as the left operand of a set operator", () => {
        const sql = `(SELECT 1) UNION SELECT 2`;
        const result = new Parser(new Lexer(sql)).parse();

        expect(result.issues).toEqual([]);
        expect(result.ast.body).toHaveLength(1);
        const root = result.ast.body[0] as SetOperatorNode;
        expect(root.type).toBe("SetOperator");
        expect(root.operator).toBe("UNION");
    });

    test("should accept a parenthesized query as the right operand of a set operator", () => {
        const sql = `SELECT 1 UNION (SELECT 2)`;
        const result = new Parser(new Lexer(sql)).parse();

        expect(result.issues).toEqual([]);
        const root = result.ast.body[0] as SetOperatorNode;
        expect(root.type).toBe("SetOperator");
        expect(root.operator).toBe("UNION");
    });

    test("should accept parenthesized operands on both sides, used to override default precedence", () => {
        const sql = `SELECT 1 UNION (SELECT 2 EXCEPT SELECT 3)`;
        const result = new Parser(new Lexer(sql)).parse();

        expect(result.issues).toEqual([]);
        const root = result.ast.body[0] as SetOperatorNode;
        expect(root.type).toBe("SetOperator");
        expect(root.operator).toBe("UNION");
        expect((root.right as SetOperatorNode).operator).toBe("EXCEPT");
    });

    test("should accept a chain of fully parenthesized operands", () => {
        const sql = `(SELECT 1) UNION (SELECT 2) EXCEPT (SELECT 3)`;
        const result = new Parser(new Lexer(sql)).parse();

        expect(result.issues).toEqual([]);
        expect(result.ast.body).toHaveLength(1);
        const root = result.ast.body[0] as SetOperatorNode;
        expect(root.type).toBe("SetOperator");
        expect(root.operator).toBe("EXCEPT");
    });

    test("should parse WITH XMLNAMESPACES followed by SELECT", () => {
        const sql = `
            DECLARE @Message XML;
            ;WITH XMLNAMESPACES (
                'http://example.com/service' AS svc,
                'http://example.com/data' AS data
            )
            SELECT @Message.value('(/svc:Root/data:Value)[1]', 'varchar(20)');
        `;

        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[1] as WithNode;

        expect(result.issues).toEqual([]);
        expect(stmt.type).toBe("WithStatement");
        expect(stmt.xmlNamespaces).toHaveLength(2);
        expect(stmt.xmlNamespaces?.[0].prefix).toBe("svc");
        expect((stmt.body as SelectNode).type).toBe("SelectStatement");
    });

    describe("Node Location Accuracy", () => {
        const getSqlFragment = (sql: string, node: { start: number; end: number }) => {
            return sql.substring(node.start, node.end);
        };

        test("SELECT statement should span from SELECT to the end of WHERE", () => {
            const sql = "SELECT Name, Age FROM Users WHERE ID = 10;";
            const ast = parse(sql);
            const stmt = ast.body[0] as SelectNode;

            expect(getSqlFragment(sql, stmt)).toBe("SELECT Name, Age FROM Users WHERE ID = 10");
        });

        test("Column nodes should have precise bounds", () => {
            const sql = "SELECT FirstName AS Name FROM Users";
            const ast = parse(sql);
            const stmt = ast.body[0] as SelectNode;
            const col = stmt.columns[0];

            // Should include the alias but not the trailing FROM
            expect(getSqlFragment(sql, col)).toBe("FirstName AS Name");
        });

        test("UPDATE statement location spanning", () => {
            const sql = "UPDATE Users SET Active = 1 FROM Profile WHERE PId = 1";
            const ast = parse(sql);
            const stmt = ast.body[0] as UpdateNode;

            expect(getSqlFragment(sql, stmt)).toBe(
                "UPDATE Users SET Active = 1 FROM Profile WHERE PId = 1",
            );
        });

        test("JOIN sequence should expand TableReference bounds", () => {
            const sql = "SELECT * FROM T1 INNER JOIN T2 ON T1.id = T2.id";
            const ast = parse(sql);
            const stmt = ast.body[0] as SelectNode;
            const from = stmt.from!;

            // The FROM node should span from 'FROM' keyword to the end of the ON clause
            expect(getSqlFragment(sql, from[0])).toBe("FROM T1 INNER JOIN T2 ON T1.id = T2.id");
        });
    });
});
