import { parseOne, expectSql } from "./parser.helpers";

import { Parser } from "../../src/parser/saral/parser/parser.js";
import { Lexer } from "../../src/parser/saral/parser/lexer.js";

describe("T-SQL Parser - Window Functions", () => {
    describe("basic OVER clause", () => {
        test("empty OVER()", () => {
            const stmt = parseOne<any>(`
                SELECT ROW_NUMBER() OVER() AS RowNum
                FROM dbo.Employee
            `);

            const over = stmt.columns[0].expression;

            expect(over.type).toBe("OverExpression");
            expect(over.expression.type).toBe("FunctionCall");
            expect(over.window.type).toBe("WindowDefinition");
            expect(over.window.partitionBy).toBeUndefined();
            expect(over.window.orderBy).toBeUndefined();
            expect(over.window.frame).toBeUndefined();
        });

        test("OVER with ORDER BY only", () => {
            const stmt = parseOne<any>(`
                SELECT ROW_NUMBER() OVER(ORDER BY Salary DESC)
                FROM dbo.Employee
            `);

            const over = stmt.columns[0].expression;

            expect(over.window.partitionBy).toBeUndefined();
            expect(over.window.orderBy).toHaveLength(1);
            expect(over.window.orderBy[0].direction).toBe("DESC");
            expectSql(over.window.orderBy[0].expression, "Salary");
        });

        test("OVER with PARTITION BY only", () => {
            const stmt = parseOne<any>(`
                SELECT AVG(Salary) OVER(PARTITION BY DeptId)
                FROM dbo.Employee
            `);

            const over = stmt.columns[0].expression;

            expect(over.window.partitionBy).toHaveLength(1);
            expectSql(over.window.partitionBy[0], "DeptId");
            expect(over.window.orderBy).toBeUndefined();
        });

        test("OVER with PARTITION BY and ORDER BY", () => {
            const stmt = parseOne<any>(`
                SELECT SUM(Salary) OVER(PARTITION BY DeptId ORDER BY Salary DESC)
                FROM dbo.Employee
            `);

            const over = stmt.columns[0].expression;

            expect(over.window.partitionBy).toHaveLength(1);
            expect(over.window.orderBy).toHaveLength(1);
            expect(over.window.orderBy[0].direction).toBe("DESC");
            expectSql(over.window.partitionBy[0], "DeptId");
            expectSql(over.window.orderBy[0].expression, "Salary");
        });

        test("OVER with multiple PARTITION BY columns", () => {
            const stmt = parseOne<any>(`
                SELECT AVG(Price) OVER(PARTITION BY Category, SubCategory)
                FROM dbo.Product
            `);

            const over = stmt.columns[0].expression;

            expect(over.window.partitionBy).toHaveLength(2);
            expectSql(over.window.partitionBy[0], "Category");
            expectSql(over.window.partitionBy[1], "SubCategory");
        });

        test("OVER with multiple ORDER BY columns", () => {
            const stmt = parseOne<any>(`
                SELECT RANK() OVER(ORDER BY DeptId ASC, Salary DESC)
                FROM dbo.Employee
            `);

            const over = stmt.columns[0].expression;

            expect(over.window.orderBy).toHaveLength(2);
            expect(over.window.orderBy[0].direction).toBe("ASC");
            expect(over.window.orderBy[1].direction).toBe("DESC");
        });
    });

    describe("frame clause - ROWS", () => {
        test("ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW", () => {
            const stmt = parseOne<any>(`
                SELECT SUM(Salary) OVER(
                    ORDER BY Salary
                    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                )
                FROM dbo.Employee
            `);

            const frame = stmt.columns[0].expression.window.frame;

            expect(frame).toBeDefined();
            expect(frame.unit).toBe("ROWS");
            expect(frame.from.type).toBe("UNBOUNDED_PRECEDING");
            expect(frame.to.type).toBe("CURRENT_ROW");
        });

        test("ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING", () => {
            const stmt = parseOne<any>(`
                SELECT SUM(Salary) OVER(
                    ORDER BY Salary
                    ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING
                )
                FROM dbo.Employee
            `);

            const frame = stmt.columns[0].expression.window.frame;

            expect(frame.unit).toBe("ROWS");
            expect(frame.from.type).toBe("CURRENT_ROW");
            expect(frame.to.type).toBe("UNBOUNDED_FOLLOWING");
        });

        test("ROWS BETWEEN n PRECEDING AND CURRENT ROW", () => {
            const stmt = parseOne<any>(`
                SELECT AVG(Salary) OVER(
                    ORDER BY HireDate
                    ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
                )
                FROM dbo.Employee
            `);

            const frame = stmt.columns[0].expression.window.frame;

            expect(frame.unit).toBe("ROWS");
            expect(frame.from.type).toBe("PRECEDING");
            expectSql(frame.from.value, "3");
            expect(frame.to.type).toBe("CURRENT_ROW");
        });

        test("ROWS BETWEEN CURRENT ROW AND n FOLLOWING", () => {
            const stmt = parseOne<any>(`
                SELECT AVG(Salary) OVER(
                    ORDER BY HireDate
                    ROWS BETWEEN CURRENT ROW AND 2 FOLLOWING
                )
                FROM dbo.Employee
            `);

            const frame = stmt.columns[0].expression.window.frame;

            expect(frame.from.type).toBe("CURRENT_ROW");
            expect(frame.to.type).toBe("FOLLOWING");
            expectSql(frame.to.value, "2");
        });

        test("ROWS UNBOUNDED PRECEDING (single boundary)", () => {
            const stmt = parseOne<any>(`
                SELECT SUM(Salary) OVER(
                    ORDER BY Salary
                    ROWS UNBOUNDED PRECEDING
                )
                FROM dbo.Employee
            `);

            const frame = stmt.columns[0].expression.window.frame;

            expect(frame.unit).toBe("ROWS");
            expect(frame.from.type).toBe("UNBOUNDED_PRECEDING");
            expect(frame.to).toBeUndefined();
        });
    });

    describe("frame clause - RANGE", () => {
        test("RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW", () => {
            const stmt = parseOne<any>(`
                SELECT SUM(Salary) OVER(
                    ORDER BY Salary
                    RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                )
                FROM dbo.Employee
            `);

            const frame = stmt.columns[0].expression.window.frame;

            expect(frame.unit).toBe("RANGE");
            expect(frame.from.type).toBe("UNBOUNDED_PRECEDING");
            expect(frame.to.type).toBe("CURRENT_ROW");
        });

        test("RANGE BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING", () => {
            const stmt = parseOne<any>(`
                SELECT SUM(Salary) OVER(
                    RANGE BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
                )
                FROM dbo.Employee
            `);

            const frame = stmt.columns[0].expression.window.frame;

            expect(frame.unit).toBe("RANGE");
            expect(frame.from.type).toBe("UNBOUNDED_PRECEDING");
            expect(frame.to.type).toBe("UNBOUNDED_FOLLOWING");
        });

        test("RANGE UNBOUNDED PRECEDING (single boundary)", () => {
            const stmt = parseOne<any>(`
                SELECT SUM(Salary) OVER(
                    ORDER BY Salary
                    RANGE UNBOUNDED PRECEDING
                )
                FROM dbo.Employee
            `);

            const frame = stmt.columns[0].expression.window.frame;

            expect(frame.unit).toBe("RANGE");
            expect(frame.from.type).toBe("UNBOUNDED_PRECEDING");
            expect(frame.to).toBeUndefined();
        });
    });

    describe("frame clause - coverage matrix", () => {
        test.each([
            ["ROWS CURRENT ROW", "ROWS", "CURRENT_ROW", undefined, undefined, undefined],
            ["ROWS 1 PRECEDING", "ROWS", "PRECEDING", undefined, "1", undefined],
            ["ROWS 1 FOLLOWING", "ROWS", "FOLLOWING", undefined, "1", undefined],
            [
                "ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING",
                "ROWS",
                "PRECEDING",
                "FOLLOWING",
                "1",
                "1",
            ],
            [
                "ROWS BETWEEN CURRENT ROW AND CURRENT ROW",
                "ROWS",
                "CURRENT_ROW",
                "CURRENT_ROW",
                undefined,
                undefined,
            ],
            [
                "ROWS BETWEEN 1 FOLLOWING AND 2 FOLLOWING",
                "ROWS",
                "FOLLOWING",
                "FOLLOWING",
                "1",
                "2",
            ],
            [
                "ROWS BETWEEN 1 PRECEDING AND 2 PRECEDING",
                "ROWS",
                "PRECEDING",
                "PRECEDING",
                "1",
                "2",
            ],
            ["RANGE CURRENT ROW", "RANGE", "CURRENT_ROW", undefined, undefined, undefined],
            [
                "RANGE BETWEEN CURRENT ROW AND CURRENT ROW",
                "RANGE",
                "CURRENT_ROW",
                "CURRENT_ROW",
                undefined,
                undefined,
            ],
            [
                "RANGE BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING",
                "RANGE",
                "CURRENT_ROW",
                "UNBOUNDED_FOLLOWING",
                undefined,
                undefined,
            ],
            [
                "RANGE BETWEEN 1 PRECEDING AND CURRENT ROW",
                "RANGE",
                "PRECEDING",
                "CURRENT_ROW",
                "1",
                undefined,
            ],
            ["RANGE 1 PRECEDING", "RANGE", "PRECEDING", undefined, "1", undefined],
            ["RANGE 1 FOLLOWING", "RANGE", "FOLLOWING", undefined, "1", undefined],
            [
                "RANGE BETWEEN 1 FOLLOWING AND 2 FOLLOWING",
                "RANGE",
                "FOLLOWING",
                "FOLLOWING",
                "1",
                "2",
            ],
        ])("%s", (frameSql, unit, fromType, toType, fromValue, toValue) => {
            const stmt = parseOne<any>(`
                    SELECT SUM(Salary) OVER(
                        ORDER BY Salary
                        ${frameSql}
                    )
                    FROM dbo.Employee
                `);

            const frame = stmt.columns[0].expression.window.frame;

            expect(frame.unit).toBe(unit);
            expect(frame.from.type).toBe(fromType);

            if (toType) {
                expect(frame.to.type).toBe(toType);
            } else {
                expect(frame.to).toBeUndefined();
            }

            if (fromValue) {
                expectSql(frame.from.value, fromValue);
            }

            if (toValue) {
                expectSql(frame.to.value, toValue);
            }
        });
    });

    describe("frame clause - node location", () => {
        test("frame clause has start and end", () => {
            const stmt = parseOne<any>(`
                SELECT SUM(Salary) OVER(
                    ORDER BY Salary
                    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                )
                FROM dbo.Employee
            `);

            const frame = stmt.columns[0].expression.window.frame;

            expect(frame.start).toBeDefined();
            expect(frame.end).toBeDefined();
            expect(frame.end).toBeGreaterThan(frame.start);
        });
    });

    describe("real-world patterns", () => {
        test("running total", () => {
            const stmt = parseOne<any>(`
                SELECT
                    EmployeeId,
                    Salary,
                    SUM(Salary) OVER(
                        ORDER BY EmployeeId
                        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                    ) AS RunningTotal
                FROM dbo.Employee
            `);

            const over = stmt.columns[2].expression;

            expect(over.type).toBe("OverExpression");
            expect(over.window.orderBy).toHaveLength(1);
            expect(over.window.frame.unit).toBe("ROWS");
            expect(over.window.frame.from.type).toBe("UNBOUNDED_PRECEDING");
            expect(over.window.frame.to.type).toBe("CURRENT_ROW");
        });

        test("moving average", () => {
            const stmt = parseOne<any>(`
                SELECT
                    EmployeeId,
                    Salary,
                    AVG(Salary) OVER(
                        PARTITION BY DeptId
                        ORDER BY HireDate
                        ROWS BETWEEN 2 PRECEDING AND CURRENT ROW
                    ) AS MovingAvg
                FROM dbo.Employee
            `);

            const over = stmt.columns[2].expression;

            expect(over.window.partitionBy).toHaveLength(1);
            expect(over.window.orderBy).toHaveLength(1);
            expect(over.window.frame.unit).toBe("ROWS");
            expect(over.window.frame.from.type).toBe("PRECEDING");
            expectSql(over.window.frame.from.value, "2");
            expect(over.window.frame.to.type).toBe("CURRENT_ROW");
        });

        test("dense rank with partition", () => {
            const stmt = parseOne<any>(`
                SELECT
                    DENSE_RANK() OVER(
                        PARTITION BY DeptId
                        ORDER BY Salary DESC
                    ) AS DenseRank
                FROM dbo.Employee
            `);

            const over = stmt.columns[0].expression;

            expect(over.expression.type).toBe("FunctionCall");
            expect(over.window.partitionBy).toHaveLength(1);
            expect(over.window.orderBy).toHaveLength(1);
            expect(over.window.frame).toBeUndefined();
        });

        test("multiple window functions in same SELECT", () => {
            const stmt = parseOne<any>(`
                SELECT
                    ROW_NUMBER() OVER(ORDER BY Salary) AS RowNum,
                    RANK() OVER(PARTITION BY DeptId ORDER BY Salary DESC) AS Rnk,
                    SUM(Salary) OVER(
                        PARTITION BY DeptId
                        ORDER BY Salary
                        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                    ) AS RunningTotal
                FROM dbo.Employee
            `);

            const col0 = stmt.columns[0].expression;
            const col1 = stmt.columns[1].expression;
            const col2 = stmt.columns[2].expression;

            expect(col0.window.orderBy).toHaveLength(1);
            expect(col0.window.frame).toBeUndefined();

            expect(col1.window.partitionBy).toHaveLength(1);
            expect(col1.window.orderBy[0].direction).toBe("DESC");
            expect(col1.window.frame).toBeUndefined();

            expect(col2.window.frame.unit).toBe("ROWS");
            expect(col2.window.frame.from.type).toBe("UNBOUNDED_PRECEDING");
            expect(col2.window.frame.to.type).toBe("CURRENT_ROW");
        });
    });

    describe("recoverability", () => {
        test("ROWS with no boundary recovers", () => {
            const stmt = parseOne<any>(`
                SELECT SUM(Salary) OVER(ORDER BY Salary ROWS)
                FROM dbo.Employee
            `);

            const frame = stmt.columns[0].expression.window.frame;

            expect(frame).toBeDefined();
            expect(frame.incomplete).toBe(true);
            expect(frame.from).toBeNull();
        });

        test("ROWS BETWEEN with no AND recovers", () => {
            const stmt = parseOne<any>(`
                SELECT SUM(Salary) OVER(
                    ORDER BY Salary
                    ROWS BETWEEN UNBOUNDED PRECEDING
                )
                FROM dbo.Employee
            `);

            const frame = stmt.columns[0].expression.window.frame;

            expect(frame.incomplete).toBe(true);
            expect(frame.from.type).toBe("UNBOUNDED_PRECEDING");
            expect(frame.to).toBeUndefined();
        });

        test("ROWS BETWEEN x AND with no end boundary recovers", () => {
            const stmt = parseOne<any>(`
                SELECT SUM(Salary) OVER(
                    ORDER BY Salary
                    ROWS BETWEEN UNBOUNDED PRECEDING AND
                )
                FROM dbo.Employee
            `);

            const frame = stmt.columns[0].expression.window.frame;

            expect(frame.incomplete).toBe(true);
            expect(frame.from.type).toBe("UNBOUNDED_PRECEDING");
            expect(frame.to).toBeUndefined();
        });

        test("ROWS BETWEEN with omitted AND but present end boundary recovers and stays aligned", () => {
            const sql = `
                SELECT SUM(Salary) OVER(
                    ORDER BY Salary
                    ROWS BETWEEN 1 PRECEDING CURRENT ROW
                ) AS RunningTotal
                FROM dbo.Employee;
                SELECT 1;
            `;

            const parser = new Parser(new Lexer(sql));
            const result = parser.parse();
            const stmt = result.ast.body[0] as any;
            const frame = stmt.columns[0].expression.window.frame;

            expect(frame.incomplete).toBe(true);
            expect(frame.from.type).toBe("PRECEDING");
            expectSql(frame.from.value, "1");
            expect(frame.to.type).toBe("CURRENT_ROW");
            expect(result.ast.body[1].type).toBe("SelectStatement");
        });

        test("continues parsing after broken frame clause", () => {
            const sql = `
                SELECT SUM(Salary) OVER(ORDER BY Salary ROWS) FROM dbo.Employee;
                SELECT 1;
            `;

            const parser = new Parser(new Lexer(sql));
            const ast = parser.parse().ast;

            expect(ast.body.length).toBeGreaterThanOrEqual(2);
            expect(ast.body[1].type).toBe("SelectStatement");
        });
    });

    test("debug column shape", () => {
        parseOne<any>(`
        SELECT SUM(Salary) OVER(
            ORDER BY Salary
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )
        FROM dbo.Employee
    `);
    });

    describe("OVER clause — node location accuracy", () => {
        const getSqlFragment = (sql: string, node: { start: number; end: number }) => {
            return sql.substring(node.start, node.end);
        };

        test("should handle basic ROW_NUMBER() OVER()", () => {
            const sql = "SELECT ROW_NUMBER() OVER() as row_num FROM T";
            const stmt = parseOne<any>(sql);
            const overExpr = stmt.columns[0].expression;

            expect(overExpr.type).toBe("OverExpression");
            expect(overExpr.expression.type).toBe("FunctionCall");
            expect(overExpr.window.type).toBe("WindowDefinition");

            expect(getSqlFragment(sql, overExpr)).toBe("ROW_NUMBER() OVER()");
            expect(getSqlFragment(sql, overExpr.window)).toBe("OVER()");
        });

        test("should handle OVER with PARTITION BY and ORDER BY", () => {
            const sql =
                "SELECT SUM(Salary) OVER(PARTITION BY DeptID ORDER BY Salary DESC) FROM Emp";
            const stmt = parseOne<any>(sql);
            const overExpr = stmt.columns[0].expression;

            expect(overExpr.window.partitionBy).toHaveLength(1);
            expect(overExpr.window.orderBy).toHaveLength(1);
            expect(overExpr.window.orderBy[0].direction).toBe("DESC");

            expect(getSqlFragment(sql, overExpr)).toBe(
                "SUM(Salary) OVER(PARTITION BY DeptID ORDER BY Salary DESC)",
            );
            expect(getSqlFragment(sql, overExpr.window)).toBe(
                "OVER(PARTITION BY DeptID ORDER BY Salary DESC)",
            );

            const orderByItem = overExpr.window.orderBy[0];
            expect(getSqlFragment(sql, orderByItem)).toBe("Salary DESC");
        });

        test("should handle multiple columns in PARTITION BY", () => {
            const sql = "SELECT AVG(Price) OVER(PARTITION BY Category, SubCategory) FROM Products";
            const stmt = parseOne<any>(sql);
            const overExpr = stmt.columns[0].expression;

            expect(overExpr.window.partitionBy).toHaveLength(2);
            expect(getSqlFragment(sql, overExpr.window.partitionBy[1])).toBe("SubCategory");
        });

        test("should handle Window functions in ORDER BY clause", () => {
            const sql = "SELECT Name FROM T ORDER BY ROW_NUMBER() OVER(ORDER BY Name)";
            const stmt = parseOne<any>(sql);
            const orderByExpr = stmt.orderBy[0].expression;

            expect(orderByExpr.type).toBe("OverExpression");
            expect(getSqlFragment(sql, orderByExpr)).toBe("ROW_NUMBER() OVER(ORDER BY Name)");
        });
    });
});
