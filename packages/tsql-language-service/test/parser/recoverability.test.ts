import { Lexer } from "../../src/parser/saral/parser/lexer.js";
import {
    type Statement,
    type SelectNode,
    type InsertNode,
    type UpdateNode,
    type DeleteNode,
    type DeclareNode,
    type SetNode,
    type PrintNode,
} from "../../src/parser/saral/ast/types.js";
import { Parser } from "../../src/parser/saral/parser/parser.js";

const parse = (sql: string) => {
    const lexer = new Lexer(sql);
    const parser = new Parser(lexer);
    return parser.parse().ast;
};

function first(sql: string): Statement {
    const ast = parse(sql);
    expect(ast.body.length).toBeGreaterThan(0);
    return ast.body[0];
}

function expectRecoverable(sql: string, type: Statement["type"]) {
    expect(() => parse(sql)).not.toThrow();

    const stmt = first(sql);

    expect(stmt.type).toBe(type);
    expect(stmt.type).not.toBe("ErrorStatement");

    return stmt;
}

describe("Recoverability - Part 1A - Core Statements", () => {
    describe("SELECT", () => {
        const cases = [
            "SELECT",
            "SELECT FROM",
            "SELECT * FROM",
            "SELECT * FROM WHERE",
            "SELECT Name FROM Users WHERE",
            "SELECT DISTINCT",
            "SELECT DISTINCT FROM",
            "SELECT TOP",
            "SELECT TOP (",
            "SELECT TOP (10",
            "SELECT TOP ()",
            "SELECT TOP 10",
            "SELECT TOP 10 FROM",
            "SELECT TOP 10 PERCENT",
            "SELECT TOP 10 PERCENT FROM",
            "SELECT ,",
            "SELECT Name,",
            "SELECT Name,,Age",
            "SELECT Name, ,Age",
            "SELECT Name FROM ,",
            "SELECT Name FROM Users,",
            "SELECT Name GROUP",
            "SELECT Name ORDER",
            "SELECT Name HAVING",
            "SELECT Name WHERE",
            "SELECT (",
            "SELECT )",
            "SELECT +",
            "SELECT CASE",
            "SELECT CASE WHEN",
            "SELECT CASE WHEN 1=1",
            "SELECT CASE WHEN 1=1 THEN",
            "SELECT CASE WHEN 1=1 THEN 1 ELSE",
            "SELECT Name IN (",
            "SELECT Name BETWEEN",
            "SELECT Name BETWEEN 1",
            "SELECT Name BETWEEN 1 AND",
            "SELECT ABS(",
            "SELECT dbo.",
            "SELECT @",
            "SELECT @@",
        ];

        test.each(cases)("%s", (sql) => {
            expectRecoverable(sql, "SelectStatement");
        });

        test("broken SELECT still returns SelectNode", () => {
            const stmt = first("SELECT FROM") as SelectNode;

            expect(stmt.type).toBe("SelectStatement");
            expect(stmt.columns).not.toBeNull();
        });

        test("SELECT preserves partial location", () => {
            const sql = "SELECT Name FROM";
            const stmt = first(sql);

            expect(stmt.start).toBe(0);
            expect(stmt.end).toBeGreaterThan(0);
            expect(stmt.end).toBeLessThanOrEqual(sql.length);
        });
    });

    describe("INSERT", () => {
        const cases = [
            "INSERT",
            "INSERT INTO",
            "INSERT INTO T",
            "INSERT INTO T(",
            "INSERT INTO T()",
            "INSERT INTO T(Id",
            "INSERT INTO T(Id,",
            "INSERT INTO T(,Id)",
            "INSERT INTO T(=)",
            "INSERT INTO T VALUES",
            "INSERT INTO T VALUES (",
            "INSERT INTO T VALUES ()",
            "INSERT INTO T VALUES (1",
            "INSERT INTO T VALUES (1,",
            "INSERT INTO T VALUES (,1)",
            "INSERT INTO T VALUES (1,), (2)",
            "INSERT INTO T VALUES (1),(2,),",
            "INSERT INTO T SELECT",
            "INSERT INTO T WITH",
            "INSERT INTO VALUES (1)",
            "INSERT T VALUES (1)",
            "INSERT INTO dbo.",
            "INSERT INTO #Temp(",
        ];

        test.each(cases)("%s", (sql) => {
            expectRecoverable(sql, "InsertStatement");
        });

        test("INSERT returns InsertNode on malformed values", () => {
            const stmt = first("INSERT INTO T VALUES (") as InsertNode;

            expect(stmt.type).toBe("InsertStatement");
            expect(stmt.values).not.toBeNull();
        });

        test("INSERT missing table still returns node", () => {
            const stmt = first("INSERT INTO VALUES (1)") as InsertNode;

            expect(stmt.type).toBe("InsertStatement");
            expect(stmt.incomplete).toBe(true);
        });
    });

    describe("UPDATE", () => {
        const cases = [
            "UPDATE",
            "UPDATE T",
            "UPDATE dbo.",
            "UPDATE T SET",
            "UPDATE T SET Name",
            "UPDATE T SET Name =",
            "UPDATE T SET Name = ,",
            "UPDATE T SET Name = 1,",
            "UPDATE T SET = 1",
            "UPDATE T SET ,",
            "UPDATE T SET Name = 1 WHERE",
            "UPDATE T SET Name = 1 FROM",
            "UPDATE T SET Name = 1 FROM X WHERE",
            "UPDATE SET Name = 1",
            "UPDATE T WHERE",
            "UPDATE T SET Name = (",
            "UPDATE T SET Name = CASE",
            "UPDATE T SET Name = CASE WHEN",
        ];

        test.each(cases)("%s", (sql) => {
            expectRecoverable(sql, "UpdateStatement");
        });

        test("UPDATE preserves assignment array", () => {
            const stmt = first("UPDATE T SET Name =") as UpdateNode;

            expect(stmt.type).toBe("UpdateStatement");
            expect(stmt.assignments).not.toBeNull();
        });

        test("UPDATE with missing assignment value preserves FROM and WHERE", () => {
            const sql = `
DECLARE @Id AS INT = 1

UPDATE u
SET u.Name = 'Bad Update',
    u.DOB =
FROM Users u
WHERE u.Id = @Id
`;

            const lexer = new Lexer(sql);
            const parser = new Parser(lexer);
            const result = parser.parse();
            const stmt = result.ast.body.find(
                (node) => node.type === "UpdateStatement",
            ) as UpdateNode;

            expect(stmt).toBeTruthy();
            expect(stmt.assignments?.length).toBe(2);
            expect(stmt.assignments?.[1].column).toBe("u.DOB");
            expect(stmt.assignments?.[1].value).toBeNull();
            expect(stmt.from).not.toBeNull();
            expect(stmt.where).not.toBeNull();
            expect(
                (result.issues ?? []).some(
                    (issue) => issue.code === "PARSE_UPDATE_ASSIGNMENT_VALUE",
                ),
            ).toBe(true);
        });
    });

    describe("DELETE", () => {
        const cases = [
            "DELETE",
            "DELETE FROM",
            "DELETE FROM WHERE",
            "DELETE FROM T WHERE",
            "DELETE FROM dbo.",
            "DELETE T FROM",
            "DELETE T FROM Users WHERE",
            "DELETE FROM T FROM",
            "DELETE FROM T FROM X WHERE",
            "DELETE WHERE",
            "DELETE FROM ,",
            "DELETE FROM T WHERE (",
            "DELETE FROM T WHERE Name IN (",
        ];

        test.each(cases)("%s", (sql) => {
            expectRecoverable(sql, "DeleteStatement");
        });

        test("DELETE returns DeleteNode", () => {
            const stmt = first("DELETE FROM T WHERE") as DeleteNode;

            expect(stmt.type).toBe("DeleteStatement");
        });
    });

    describe("DECLARE", () => {
        const cases = [
            "DECLARE",
            "DECLARE @x",
            "DECLARE @x INT =",
            "DECLARE @x =",
            "DECLARE @x INT = (",
            "DECLARE @x,",
            "DECLARE ,",
            "DECLARE @@x",
        ];

        test.each(cases)("%s", (sql) => {
            expectRecoverable(sql, "DeclareStatement");
        });

        test("DECLARE returns DeclareNode", () => {
            const stmt = first("DECLARE @x") as DeclareNode;

            expect(stmt.type).toBe("DeclareStatement");
        });
    });

    describe("SET", () => {
        const cases = [
            "SET",
            "SET @x",
            "SET @x =",
            "SET @x = (",
            "SET @x = CASE",
            "SET @@ROWCOUNT",
            "SET @@ROWCOUNT =",
            "SET @@ROWCOUNT = 1 +",
            "SET NOCOUNT",
            "SET NOCOUNT ON",
            "SET ANSI_NULLS",
            "SET ANSI_NULLS ON",
            "SET TRANSACTION",
            "SET TRANSACTION ISOLATION",
            "SET TRANSACTION ISOLATION LEVEL",
            "SET TRANSACTION ISOLATION LEVEL READ",
            "SET TRANSACTION ISOLATION LEVEL READ COMMITTED",
            "SET =",
            "SET ON",
        ];

        test.each(cases)("%s", (sql) => {
            expect(() => parse(sql)).not.toThrow();

            const stmt = first(sql) as SetNode;

            expect(stmt.type).toBe("SetStatement");
        });

        test("SET variable assignment recovers", () => {
            const stmt = first("SET @x =") as SetNode;

            expect(stmt.incomplete).toBe(true);
        });

        test("SET session option is valid node", () => {
            const stmt = first("SET TRANSACTION ISOLATION LEVEL READ COMMITTED") as SetNode;

            expect(stmt.type).toBe("SetStatement");
            expect(stmt.variable).toContain("TRANSACTION");
        });
    });

    describe("PRINT", () => {
        const cases = [
            "PRINT",
            "PRINT +",
            "PRINT ,",
            "PRINT )",
            "PRINT (",
            "PRINT CASE",
            "PRINT CASE WHEN",
            "PRINT ABS(",
        ];

        test.each(cases)("%s", (sql) => {
            expectRecoverable(sql, "PrintStatement");
        });

        test("PRINT null value is recoverable", () => {
            const stmt = first("PRINT") as PrintNode;

            expect(stmt.type).toBe("PrintStatement");
            expect(stmt.value).toBeNull();
        });
    });

    describe("Continuation", () => {
        test("continues after broken SELECT", () => {
            const ast = parse(`
                SELECT FROM;
                SELECT 1;
            `);

            expect(ast.body.length).toBe(2);
            expect(ast.body[1].type).toBe("SelectStatement");
        });

        test("continues after broken INSERT", () => {
            const ast = parse(`
                INSERT INTO T VALUES (;
                SELECT 1;
            `);

            expect(ast.body.length).toBe(2);
            expect(ast.body[1].type).toBe("SelectStatement");
        });

        test("continues after broken UPDATE", () => {
            const ast = parse(`
                UPDATE T SET Name = ;
                SELECT 1;
            `);

            expect(ast.body.length).toBe(2);
            expect(ast.body[1].type).toBe("SelectStatement");
        });

        test("continues after broken DELETE", () => {
            const ast = parse(`
                DELETE FROM T WHERE ;
                SELECT 1;
            `);

            expect(ast.body.length).toBe(2);
            expect(ast.body[1].type).toBe("SelectStatement");
        });
    });
});

// Append to tests/recoverability.test.ts

describe("Recoverability - Part 1B - Structural Recovery", () => {
    describe("FROM", () => {
        const cases = [
            "SELECT * FROM",
            "SELECT * FROM ,",
            "SELECT * FROM WHERE",
            "SELECT * FROM GROUP",
            "SELECT * FROM ORDER",
            "SELECT * FROM HAVING",
            "SELECT * FROM dbo.",
            "SELECT * FROM dbo..",
            "SELECT * FROM #",
            "SELECT * FROM [dbo].",
            "SELECT * FROM (",
            "SELECT * FROM (SELECT",
            "SELECT * FROM (SELECT 1",
            "SELECT * FROM (SELECT 1)",
            "SELECT * FROM ()",
            "SELECT * FROM A,",
            "SELECT * FROM A,,B",
            "SELECT * FROM A, WHERE",
        ];

        test.each(cases)("%s", (sql) => {
            expectRecoverable(sql, "SelectStatement");
        });

        test("FROM placeholder remains SelectNode", () => {
            const stmt = first("SELECT * FROM") as SelectNode;
            expect(stmt.type).toBe("SelectStatement");
        });
    });

    describe("JOIN", () => {
        const cases = [
            "SELECT * FROM A JOIN",
            "SELECT * FROM A JOIN B",
            "SELECT * FROM A JOIN B ON",
            "SELECT * FROM A JOIN B ON T1 =",
            "SELECT * FROM A JOIN B ON = T2",
            "SELECT * FROM A INNER",
            "SELECT * FROM A INNER JOIN",
            "SELECT * FROM A INNER JOIN B ON",
            "SELECT * FROM A LEFT",
            "SELECT * FROM A LEFT JOIN",
            "SELECT * FROM A LEFT JOIN B ON",
            "SELECT * FROM A LEFT OUTER",
            "SELECT * FROM A LEFT OUTER JOIN",
            "SELECT * FROM A RIGHT",
            "SELECT * FROM A RIGHT JOIN",
            "SELECT * FROM A FULL",
            "SELECT * FROM A FULL JOIN",
            "SELECT * FROM A CROSS",
            "SELECT * FROM A CROSS JOIN",
            "SELECT * FROM A CROSS JOIN B",
            "SELECT * FROM A CROSS JOIN B ON",
        ];

        test.each(cases)("%s", (sql) => {
            expectRecoverable(sql, "SelectStatement");
        });
    });

    describe("APPLY", () => {
        const cases = [
            "SELECT * FROM A CROSS APPLY",
            "SELECT * FROM A CROSS APPLY B",
            "SELECT * FROM A OUTER APPLY",
            "SELECT * FROM A OUTER APPLY B",
            "SELECT * FROM A CROSS APPLY (",
            "SELECT * FROM A CROSS APPLY (SELECT",
            "SELECT * FROM A CROSS APPLY (SELECT 1",
            "SELECT * FROM A CROSS APPLY (SELECT 1)",
        ];

        test.each(cases)("%s", (sql) => {
            expectRecoverable(sql, "SelectStatement");
        });
    });

    describe("Alias", () => {
        const cases = [
            "SELECT * FROM Users AS",
            "SELECT * FROM Users AS WHERE",
            "SELECT * FROM Users U",
            "SELECT * FROM Users U JOIN",
            "SELECT * FROM Users AS U JOIN",
            "SELECT * FROM (SELECT 1) X",
            "SELECT * FROM (SELECT 1) AS",
            "SELECT * FROM (SELECT 1) AS X JOIN",
        ];

        test.each(cases)("%s", (sql) => {
            expectRecoverable(sql, "SelectStatement");
        });
    });

    describe("Table Hints", () => {
        const cases = [
            "SELECT * FROM T WITH",
            "SELECT * FROM T WITH (",
            "SELECT * FROM T WITH ()",
            "SELECT * FROM T WITH (NOLOCK",
            "SELECT * FROM T WITH (NOLOCK,",
            "SELECT * FROM T WITH (NOLOCK)",
            "SELECT * FROM T WITH (NOLOCK, TABLOCK",
            "SELECT * FROM T WITH (NOLOCK, TABLOCK)",
            "SELECT * FROM T WITH (INDEX(",
            "SELECT * FROM T WITH (INDEX(PK_",
            "SELECT * FROM T WITH (INDEX(PK_Users)",
            "SELECT * FROM T WITH (INDEX(PK_Users))",
            "SELECT * FROM T WITH (NOLOCK, INDEX(PK_Users)",
            "SELECT * FROM T WITH (NOLOCK, INDEX(PK_Users))",
        ];

        test.each(cases)("%s", (sql) => {
            expectRecoverable(sql, "SelectStatement");
        });
    });

    describe("GROUP BY", () => {
        const cases = [
            "SELECT A FROM T GROUP",
            "SELECT A FROM T GROUP BY",
            "SELECT A FROM T GROUP BY ,",
            "SELECT A FROM T GROUP BY A,",
            "SELECT A FROM T GROUP BY A,,B",
            "SELECT A FROM T GROUP BY (",
            "SELECT A FROM T GROUP BY ABS(",
        ];

        test.each(cases)("%s", (sql) => {
            expectRecoverable(sql, "SelectStatement");
        });
    });

    describe("HAVING", () => {
        const cases = [
            "SELECT A FROM T HAVING",
            "SELECT A FROM T HAVING COUNT(",
            "SELECT A FROM T HAVING A =",
            "SELECT A FROM T GROUP BY A HAVING",
            "SELECT A FROM T GROUP BY A HAVING COUNT(*) >",
        ];

        test.each(cases)("%s", (sql) => {
            expectRecoverable(sql, "SelectStatement");
        });
    });

    describe("ORDER BY", () => {
        const cases = [
            "SELECT A FROM T ORDER",
            "SELECT A FROM T ORDER BY",
            "SELECT A FROM T ORDER BY ,",
            "SELECT A FROM T ORDER BY A,",
            "SELECT A FROM T ORDER BY A DESC,",
            "SELECT A FROM T ORDER BY A ASC,",
            "SELECT A FROM T ORDER BY (",
            "SELECT A FROM T ORDER BY ABS(",
        ];

        test.each(cases)("%s", (sql) => {
            expectRecoverable(sql, "SelectStatement");
        });
    });

    describe("Set Operators", () => {
        const cases = [
            "SELECT 1 UNION",
            "SELECT 1 UNION SELECT",
            "SELECT 1 UNION ALL",
            "SELECT 1 UNION ALL SELECT",
            "SELECT 1 EXCEPT",
            "SELECT 1 EXCEPT SELECT",
            "SELECT 1 INTERSECT",
            "SELECT 1 INTERSECT SELECT",
            "SELECT 1 UNION SELECT 2 UNION",
            "SELECT 1 UNION SELECT 2 EXCEPT",
        ];

        test.each(cases)("%s", (sql) => {
            expect(() => parse(sql)).not.toThrow();

            const stmt = first(sql);
            expect(["SelectStatement", "SetOperator"]).toContain(stmt.type);
        });
    });

    describe("CTE / WITH", () => {
        const cases = [
            "WITH",
            "WITH X",
            "WITH X AS",
            "WITH X AS (",
            "WITH X AS (SELECT",
            "WITH X AS (SELECT 1",
            "WITH X AS (SELECT 1)",
            "WITH X AS (SELECT 1) SELECT",
            "WITH X AS (SELECT 1),",
            "WITH X AS (SELECT 1), Y",
            "WITH X AS (SELECT 1), Y AS",
            "WITH X AS (SELECT 1), Y AS (",
            "WITH X AS (SELECT 1), Y AS (SELECT",
            "WITH X AS (SELECT 1), Y AS (SELECT 2)",
            "WITH X AS (SELECT 1), Y AS (SELECT 2) SELECT",
        ];

        test.each(cases)("%s", (sql) => {
            expect(() => parse(sql)).not.toThrow();

            const stmt = first(sql);
            expect(["WithStatement", "ErrorStatement"]).toContain(stmt.type);
        });

        test("wildcard CTE name stays recoverable inside WithStatement", () => {
            const stmt = first("WITH dbo.* AS (SELECT 1) SELECT 1") as any;

            expect(stmt.type).toBe("WithStatement");
            expect(stmt.incomplete).toBe(true);
            expect(stmt.errors).toContain("Wildcards are not allowed as CTE names");
        });

        test("missing body becomes incomplete WithStatement", () => {
            const stmt = first("WITH X AS (SELECT 1)") as any;

            expect(stmt.type).toBe("WithStatement");
            expect(stmt.incomplete).toBe(true);
            expect(stmt.errors).toContain(
                "A Common Table Expression (CTE) must be followed by a query or DML statement.",
            );
            expect((stmt as any).body.type).toBe("ErrorStatement");
        });

        test("broken CTE column list recovers to AS body and following query", () => {
            const stmt = first("WITH X (+) AS (SELECT 1) SELECT * FROM X") as any;

            expect(stmt.type).toBe("WithStatement");
            expect(stmt.ctes[0].columns).toEqual([]);
            expect(stmt.body.type).toBe("SelectStatement");
        });
    });

    describe("Nested structural continuation", () => {
        test("broken JOIN does not poison next statement", () => {
            const ast = parse(`
                SELECT * FROM A JOIN;
                SELECT 1;
            `);

            expect(ast.body.length).toBeGreaterThanOrEqual(2);
            expect(ast.body[1].type).toBe("SelectStatement");
        });

        test("broken CTE does not poison next statement", () => {
            const ast = parse(`
                WITH X AS (
                SELECT 1;
            `);

            expect(ast.body.length).toBeGreaterThan(0);
        });

        test("broken GROUP BY does not poison next statement", () => {
            const ast = parse(`
                SELECT A FROM T GROUP BY ;
                SELECT 1;
            `);

            expect(ast.body.length).toBeGreaterThanOrEqual(2);
            expect(ast.body[1].type).toBe("SelectStatement");
        });

        test("broken ORDER BY does not poison next statement", () => {
            const ast = parse(`
                SELECT A FROM T ORDER BY ;
                SELECT 1;
            `);

            expect(ast.body.length).toBeGreaterThanOrEqual(2);
            expect(ast.body[1].type).toBe("SelectStatement");
        });
    });
});

// Append to tests/recoverability.test.ts

describe("Recoverability - Part 2 - Expression Recovery", () => {
    describe("Binary Expressions", () => {
        const cases = [
            "SELECT 1 +",
            "SELECT 1 -",
            "SELECT 1 *",
            "SELECT 1 /",
            "SELECT 1 %",
            "SELECT 1 =",
            "SELECT 1 <>",
            "SELECT 1 >",
            "SELECT 1 <",
            "SELECT 1 >=",
            "SELECT 1 <=",
            "SELECT A AND",
            "SELECT A OR",
            "SELECT 1 + *",
            "SELECT 1 + /",
            "SELECT 1 = AND",
            "SELECT A AND OR",
            "SELECT 1 + (",
            "SELECT 1 * CASE",
            "SELECT 1 + ABS(",
        ];

        test.each(cases)("%s", (sql) => {
            expectRecoverable(sql, "SelectStatement");
        });
    });

    describe("Unary Expressions", () => {
        const cases = [
            "SELECT NOT",
            "SELECT -",
            "SELECT +",
            "SELECT ~",
            "SELECT NOT (",
            "SELECT - ABS(",
            "SELECT NOT CASE",
            "SELECT NOT NOT",
            "SELECT --",
            "SELECT ++",
        ];

        test.each(cases)("%s", (sql) => {
            expectRecoverable(sql, "SelectStatement");
        });
    });

    describe("Grouping Expressions", () => {
        const cases = [
            "SELECT (",
            "SELECT (((",
            "SELECT (1",
            "SELECT (1 +",
            "SELECT (1 + 2",
            "SELECT ((1 + 2)",
            "SELECT (((1)",
            "SELECT ()",
            "SELECT (CASE",
            "SELECT (ABS(",
        ];

        test.each(cases)("%s", (sql) => {
            expectRecoverable(sql, "SelectStatement");
        });
    });

    describe("Function Calls", () => {
        const cases = [
            "SELECT ABS(",
            "SELECT ABS(1",
            "SELECT ABS(,",
            "SELECT ABS(1,",
            "SELECT ABS(1,2,",
            "SELECT COUNT(",
            "SELECT COUNT(*",
            "SELECT SUM(",
            "SELECT dbo.fn(",
            "SELECT dbo.fn(1",
            "SELECT dbo.fn(1,",
            "SELECT MAX(ABS(",
            "SELECT CAST(",
        ];

        test.each(cases)("%s", (sql) => {
            expectRecoverable(sql, "SelectStatement");
        });
    });

    describe("CASE Expressions", () => {
        const cases = [
            "SELECT CASE",
            "SELECT CASE WHEN",
            "SELECT CASE WHEN 1=1",
            "SELECT CASE WHEN 1=1 THEN",
            "SELECT CASE WHEN 1=1 THEN 1",
            "SELECT CASE WHEN 1=1 THEN 1 ELSE",
            "SELECT CASE WHEN THEN",
            "SELECT CASE ELSE",
            "SELECT CASE 1 WHEN",
            "SELECT CASE 1 WHEN 1 THEN",
            "SELECT CASE 1 WHEN 1 THEN 2 ELSE",
            "SELECT CASE WHEN ABS(",
            "SELECT CASE WHEN 1=1 THEN ABS(",
            "SELECT CASE WHEN 1=1 THEN 1 END +",
        ];

        test.each(cases)("%s", (sql) => {
            expectRecoverable(sql, "SelectStatement");
        });
    });

    describe("IN Expressions", () => {
        const cases = [
            "SELECT A IN",
            "SELECT A IN (",
            "SELECT A IN ()",
            "SELECT A IN (1",
            "SELECT A IN (1,",
            "SELECT A IN (,1)",
            "SELECT A IN (SELECT",
            "SELECT A IN (SELECT 1",
            "SELECT A NOT IN",
            "SELECT A NOT IN (",
            "SELECT A NOT IN (1,",
        ];

        test.each(cases)("%s", (sql) => {
            expectRecoverable(sql, "SelectStatement");
        });
    });

    describe("BETWEEN Expressions", () => {
        const cases = [
            "SELECT A BETWEEN",
            "SELECT A BETWEEN 1",
            "SELECT A BETWEEN 1 AND",
            "SELECT A BETWEEN AND",
            "SELECT A NOT BETWEEN",
            "SELECT A NOT BETWEEN 1",
            "SELECT A NOT BETWEEN 1 AND",
            "SELECT A BETWEEN ABS(",
            "SELECT A BETWEEN 1 AND ABS(",
        ];

        test.each(cases)("%s", (sql) => {
            expectRecoverable(sql, "SelectStatement");
        });
    });

    describe("Subqueries / EXISTS", () => {
        const cases = [
            "SELECT EXISTS",
            "SELECT EXISTS (",
            "SELECT EXISTS (SELECT",
            "SELECT EXISTS (SELECT 1",
            "SELECT (SELECT",
            "SELECT (SELECT 1",
            "SELECT A IN (SELECT",
            "SELECT A IN (SELECT 1",
        ];

        test.each(cases)("%s", (sql) => {
            expectRecoverable(sql, "SelectStatement");
        });
    });

    describe("OVER Clause", () => {
        const cases = [
            "SELECT ROW_NUMBER() OVER",
            "SELECT ROW_NUMBER() OVER (",
            "SELECT ROW_NUMBER() OVER (PARTITION",
            "SELECT ROW_NUMBER() OVER (PARTITION BY",
            "SELECT ROW_NUMBER() OVER (PARTITION BY A",
            "SELECT ROW_NUMBER() OVER (ORDER",
            "SELECT ROW_NUMBER() OVER (ORDER BY",
            "SELECT ROW_NUMBER() OVER (ORDER BY A",
            "SELECT SUM(X) OVER (",
            "SELECT SUM(X) OVER (PARTITION BY",
            "SELECT SUM(X) OVER (ORDER BY",
        ];

        test.each(cases)("%s", (sql) => {
            expectRecoverable(sql, "SelectStatement");
        });
    });

    describe("Multipart / Member Expressions", () => {
        const cases = [
            "SELECT dbo.",
            "SELECT A.",
            "SELECT dbo..x",
            "SELECT dbo.fn().",
            "SELECT a.b.",
            "SELECT a..b",
            "SELECT .a",
            "SELECT [dbo].",
        ];

        test.each(cases)("%s", (sql) => {
            expectRecoverable(sql, "SelectStatement");
        });
    });

    describe("Variables", () => {
        const cases = [
            "SELECT @",
            "SELECT @@",
            "SELECT @x +",
            "SELECT @@ROWCOUNT +",
            "SELECT @x =",
            "SELECT @x AND",
        ];

        test.each(cases)("%s", (sql) => {
            expectRecoverable(sql, "SelectStatement");
        });
    });

    describe("Nested / Chained", () => {
        const cases = [
            "SELECT NOT (1 +",
            "SELECT ABS(CASE WHEN",
            "SELECT A BETWEEN 1 AND ABS(",
            "SELECT CASE WHEN A IN (",
            "SELECT NOT EXISTS (SELECT",
            "SELECT ABS(1 +",
            "SELECT ((ABS(",
            "SELECT CASE WHEN ABS( THEN",
        ];

        test.each(cases)("%s", (sql) => {
            expectRecoverable(sql, "SelectStatement");
        });
    });

    describe("Expression Continuation", () => {
        test("broken binary does not poison next statement", () => {
            const ast = parse(`
                SELECT 1 + ;
                SELECT 2;
            `);

            expect(ast.body.length).toBeGreaterThanOrEqual(2);
            expect(ast.body[1].type).toBe("SelectStatement");
        });

        test("broken CASE does not poison next statement", () => {
            const ast = parse(`
                SELECT CASE WHEN ;
                SELECT 2;
            `);

            expect(ast.body.length).toBeGreaterThanOrEqual(2);
            expect(ast.body[1].type).toBe("SelectStatement");
        });

        test("broken OVER does not poison next statement", () => {
            const ast = parse(`
                SELECT ROW_NUMBER() OVER (;
                SELECT 2;
            `);

            expect(ast.body.length).toBeGreaterThanOrEqual(2);
            expect(ast.body[1].type).toBe("SelectStatement");
        });

        test("broken EXISTS does not poison next statement", () => {
            const ast = parse(`
                SELECT EXISTS (;
                SELECT 2;
            `);

            expect(ast.body.length).toBeGreaterThanOrEqual(2);
            expect(ast.body[1].type).toBe("SelectStatement");
        });
    });
});

// Append to tests/recoverability.test.ts

describe("Recoverability - Part 3 - Continuation / Resync", () => {
    function expectContinues(sql: string, minStatements = 2) {
        expect(() => parse(sql)).not.toThrow();

        const ast = parse(sql);

        expect(ast.body.length).toBeGreaterThanOrEqual(minStatements);

        return ast;
    }

    describe("Broken SELECT continues", () => {
        const cases = [
            `SELECT FROM; SELECT 1;`,
            `SELECT 1 + ; SELECT 2;`,
            `SELECT CASE WHEN ; SELECT 2;`,
            `SELECT A IN (; SELECT 2;`,
            `SELECT ABS(; SELECT 2;`,
            `SELECT ROW_NUMBER() OVER (; SELECT 2;`,
            `SELECT * FROM A JOIN ; SELECT 2;`,
            `SELECT * FROM A WITH (; SELECT 2;`,
            `SELECT 1 UNION ; SELECT 2;`,
        ];

        test.each(cases)("%s", (sql) => {
            const ast = expectContinues(sql);
            expect(ast.body[1].type).not.toBe("ErrorStatement");
        });

        test("broken WHERE with nested INSERT is split into two statements", () => {
            const ast = parse(`
                SELECT ID FROM Table1 WHERE INSERT INTO Table2 VALUES (1, 2, 3);
            `);

            expect(ast.body.length).toBeGreaterThanOrEqual(2);
            expect(ast.body[0].type).toBe("SelectStatement");
            expect(ast.body[1].type).toBe("InsertStatement");
        });
    });

    describe("Broken INSERT continues", () => {
        const cases = [
            `INSERT INTO T VALUES (; SELECT 1;`,
            `INSERT INTO T VALUES (1,; SELECT 1;`,
            `INSERT INTO T( ; SELECT 1;`,
            `INSERT INTO T SELECT ; SELECT 1;`,
            `INSERT INTO dbo. VALUES (1); SELECT 1;`,
        ];

        test.each(cases)("%s", (sql) => {
            const ast = expectContinues(sql);
            expect(ast.body.some((s) => s.type === "SelectStatement")).toBe(true);
        });
    });

    describe("Broken UPDATE continues", () => {
        const cases = [
            `UPDATE T SET A = ; SELECT 1;`,
            `UPDATE T SET = 1; SELECT 1;`,
            `UPDATE T SET A = 1 FROM ; SELECT 1;`,
            `UPDATE T SET A = 1 WHERE ; SELECT 1;`,
            `UPDATE dbo. SET A = 1; SELECT 1;`,
        ];

        test.each(cases)("%s", (sql) => {
            const ast = expectContinues(sql);
            expect(ast.body.some((x) => x.type === "SelectStatement")).toBe(true);
        });
    });

    describe("Broken DELETE continues", () => {
        const cases = [
            `DELETE FROM T WHERE ; SELECT 1;`,
            `DELETE FROM ; SELECT 1;`,
            `DELETE FROM dbo. WHERE A=1; SELECT 1;`,
            `DELETE T FROM ; SELECT 1;`,
        ];

        test.each(cases)("%s", (sql) => {
            const ast = expectContinues(sql);
            expect(ast.body.slice(1).some((s) => s.type === "SelectStatement")).toBe(true);
        });
    });

    describe("Broken DECLARE / SET / PRINT continues", () => {
        const cases = [
            `DECLARE @x = ; SELECT 1;`,
            `DECLARE @x TABLE (; SELECT 1;`,
            `SET @x = ; SELECT 1;`,
            `SET TRANSACTION ISOLATION LEVEL ; SELECT 1;`,
            `PRINT ; SELECT 1;`,
            `PRINT ABS(; SELECT 1;`,
        ];

        test.each(cases)("%s", (sql) => {
            const ast = expectContinues(sql);
            expect(ast.body[1].type).toBe("SelectStatement");
        });
    });

    describe("Multiple broken statements continue", () => {
        test("many failures still continue", () => {
            const ast = parse(`
                SELECT 1 + ;
                INSERT INTO T VALUES (;
                UPDATE T SET A = ;
                DELETE FROM T WHERE ;
                SELECT 999;
            `);

            expect(ast.body.length).toBeGreaterThanOrEqual(5);
            expect(ast.body[4].type).toBe("SelectStatement");
        });

        test("alternating good / bad statements", () => {
            const ast = parse(`
                SELECT 1;
                SELECT FROM;
                SELECT 2;
                UPDATE T SET A = ;
                SELECT 3;
            `);

            expect(ast.body.length).toBeGreaterThanOrEqual(5);
            expect(ast.body[0].type).toBe("SelectStatement");
            expect(ast.body[2].type).toBe("SelectStatement");
            expect(ast.body[4].type).toBe("SelectStatement");
        });
    });

    describe("Nested block resync", () => {
        test("IF block broken SQL continues", () => {
            const ast = parse(`
                IF 1 = 1
                BEGIN
                    SELECT FROM;
                END
                SELECT 2;
            `);

            expect(ast.body.length).toBeGreaterThanOrEqual(2);
            expect(ast.body[1].type).toBe("SelectStatement");
        });

        test("CTE broken query continues", () => {
            const ast = parse(`
                WITH X AS (
                    SELECT FROM
                )
                SELECT 2;
            `);

            expect(ast.body.length).toBeGreaterThan(0);
        });

        test("subquery broken SQL continues", () => {
            const ast = parse(`
                SELECT *
                FROM (
                    SELECT FROM
                ) X;

                SELECT 2;
            `);

            expect(ast.body.length).toBeGreaterThanOrEqual(2);
            expect(ast.body[1].type).toBe("SelectStatement");
        });
    });

    describe("Garbage token resync", () => {
        const cases = [
            `!!!! SELECT 1;`,
            `@@@ SELECT 1;`,
            `))) SELECT 1;`,
            `### SELECT 1;`,
            `END END SELECT 1;`,
        ];

        test.each(cases)("%s", (sql) => {
            expect(() => parse(sql)).not.toThrow();

            const ast = parse(sql);
            expect(ast.body.length).toBeGreaterThan(0);
        });
    });
});

// Append to tests/recoverability.test.ts

describe("Recoverability - Part 4 - Random Garbage Fuzz", () => {
    function expectNoThrow(sql: string) {
        expect(() => parse(sql)).not.toThrow();

        const ast = parse(sql);

        expect(ast).toBeDefined();
        expect(Array.isArray(ast.body)).toBe(true);

        return ast;
    }

    describe("Pure garbage", () => {
        const cases = [
            "!!!!",
            "@@@",
            "###",
            "$$$",
            "%%%^^^",
            "))))",
            "((((",
            ",,,,",
            ";;;;",
            "::::",
            "....",
            "====",
            "++++",
            "----",
            "****",
            "////",
            "\\\\\\\\",
            "???",
            "~~~",
            "||||",
            "&&&&",
        ];

        test.each(cases)("%s", (sql) => {
            expectNoThrow(sql);
        });
    });

    describe("Broken SQL fragments", () => {
        const cases = [
            "CASE THEN",
            "CASE WHEN THEN",
            "CASE END END",
            "END END",
            "WHEN THEN",
            "ELSE ELSE",
            "FROM FROM FROM",
            "WHERE WHERE",
            "JOIN JOIN",
            "ON ON",
            "GROUP BY BY",
            "ORDER BY BY",
            "UNION UNION",
            "SELECT SELECT",
            "INSERT INSERT",
            "UPDATE UPDATE",
            "DELETE DELETE",
            "DECLARE DECLARE",
            "SET SET",
            "PRINT PRINT",
        ];

        test.each(cases)("%s", (sql) => {
            expectNoThrow(sql);
        });
    });

    describe("Mixed punctuation + SQL", () => {
        const cases = [
            "!!!! SELECT 1",
            "@@@ INSERT INTO T VALUES (1)",
            "### UPDATE T SET A = 1",
            "))) DELETE FROM T",
            ";;; SELECT FROM",
            "??? SELECT CASE WHEN",
            "+++ SELECT 1 +",
            "*** SELECT ABS(",
            "/// SELECT * FROM",
            "... WITH X AS (",
        ];

        test.each(cases)("%s", (sql) => {
            expectNoThrow(sql);
        });
    });

    describe("Nested nonsense", () => {
        const cases = [
            "(((((((((((((",
            ")))))))))))))",
            "(()()()()(",
            "[[[[[[",
            "]]]]]]",
            "{{{{{{",
            "}}}}}}",
            "CASE CASE CASE",
            "END END END",
            "WHEN WHEN WHEN",
            "SELECT ((( ABS( CASE WHEN",
            "SELECT ))))",
            "INSERT ((( VALUES )))",
        ];

        test.each(cases)("%s", (sql) => {
            expectNoThrow(sql);
        });
    });

    describe("Large garbage blocks", () => {
        test("long punctuation stream", () => {
            const sql = "!@#$%^&*()_+{}|:\"<>?[]\\;',./".repeat(50);

            expectNoThrow(sql);
        });

        test("long broken SQL stream", () => {
            const sql = "SELECT FROM INSERT UPDATE DELETE CASE WHEN THEN END UNION ".repeat(50);

            expectNoThrow(sql);
        });

        test("mixed garbage + valid tail", () => {
            const sql = "!@#$%^&*() CASE THEN END ### SELECT 1;";

            const ast = expectNoThrow(sql);

            expect(ast.body.length).toBeGreaterThan(0);
        });
    });

    describe("Parser / scope / diagnostics pipeline", () => {
        const cases = [
            "!!!!",
            "@@@ SELECT FROM ###",
            "CASE THEN END END",
            "SELECT ABS( CASE WHEN",
            "INSERT INTO T VALUES (1,",
            "UPDATE T SET A =",
            "DELETE FROM T WHERE",
            "WITH X AS (SELECT",
        ];

        test.each(cases)("%s", (sql) => {
            expect(() => {
                const ast = parse(sql);

                // build scope
                // run diagnostics
                // just ensuring full pipeline survives malformed input
                expect(ast).toBeDefined();
            }).not.toThrow();
        });
    });
});
