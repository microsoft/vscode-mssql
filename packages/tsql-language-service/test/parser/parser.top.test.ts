import { parseOne, expectSql } from "./parser.helpers";

import { Parser } from "../../src/parser/saral/parser/parser.js";
import { Lexer } from "../../src/parser/saral/parser/lexer.js";

describe("T-SQL Parser - TOP clause", () => {
    describe("basic TOP", () => {
        test("TOP literal", () => {
            const stmt = parseOne<any>(`
                SELECT TOP 10 Id FROM dbo.Employee
            `);

            expect(stmt.top).not.toBeNull();
            expect(stmt.top.percent).toBe(false);
            expect(stmt.top.withTies).toBe(false);
            expectSql(stmt.top.quantity, "10");
        });

        test("TOP with parens", () => {
            const stmt = parseOne<any>(`
                SELECT TOP (10) Id FROM dbo.Employee
            `);

            expect(stmt.top).not.toBeNull();
            expectSql(stmt.top.quantity, "10");
        });

        test("TOP with expression", () => {
            const stmt = parseOne<any>(`
                SELECT TOP (@n) Id FROM dbo.Employee
            `);

            expect(stmt.top).not.toBeNull();
            expectSql(stmt.top.quantity, "@n");
        });

        test("TOP with scalar subquery expression", () => {
            const stmt = parseOne<any>(`
                SELECT TOP (SELECT @TakeCount) Id
                FROM dbo.Employee
            `);

            expect(stmt.top).not.toBeNull();
            expect(stmt.top.quantity.type).toBe("SubqueryExpression");
        });
    });

    describe("TOP PERCENT", () => {
        test("TOP n PERCENT", () => {
            const stmt = parseOne<any>(`
                SELECT TOP 10 PERCENT Id FROM dbo.Employee
            `);

            expect(stmt.top.percent).toBe(true);
            expect(stmt.top.withTies).toBe(false);
            expectSql(stmt.top.quantity, "10");
        });

        test("TOP (n) PERCENT", () => {
            const stmt = parseOne<any>(`
                SELECT TOP (25) PERCENT Id FROM dbo.Employee
            `);

            expect(stmt.top.percent).toBe(true);
            expectSql(stmt.top.quantity, "25");
        });
    });

    describe("TOP WITH TIES", () => {
        test("TOP n WITH TIES", () => {
            const stmt = parseOne<any>(`
                SELECT TOP 10 WITH TIES Id
                FROM dbo.Employee
                ORDER BY Salary DESC
            `);

            expect(stmt.top.withTies).toBe(true);
            expect(stmt.top.percent).toBe(false);
            expectSql(stmt.top.quantity, "10");
        });

        test("TOP (n) PERCENT WITH TIES", () => {
            const stmt = parseOne<any>(`
                SELECT TOP (10) PERCENT WITH TIES Id
                FROM dbo.Employee
                ORDER BY Salary DESC
            `);

            expect(stmt.top.percent).toBe(true);
            expect(stmt.top.withTies).toBe(true);
            expectSql(stmt.top.quantity, "10");
        });
    });

    describe("node location", () => {
        test("TOP node has start and end", () => {
            const stmt = parseOne<any>(`
                SELECT TOP 10 Id FROM dbo.Employee
            `);

            expect(stmt.top.start).toBeDefined();
            expect(stmt.top.end).toBeDefined();
            expect(stmt.top.end).toBeGreaterThan(stmt.top.start);
        });
    });

    describe("no TOP", () => {
        test("SELECT without TOP omits top", () => {
            const stmt = parseOne<any>(`
                SELECT Id FROM dbo.Employee
            `);

            expect(stmt.top).toBeUndefined();
        });
    });

    describe("recoverability", () => {
        test("TOP WITH missing TIES recovers", () => {
            const stmt = parseOne<any>(`
                SELECT TOP 10 WITH Id FROM dbo.Employee
            `);

            expect(stmt.top).not.toBeNull();
            expect(stmt.top.incomplete).toBe(true);
            expect(stmt.top.errors).toEqual(
                expect.arrayContaining([expect.stringContaining("Expected TIES after WITH")]),
            );
            expect(stmt.top.withTies).toBe(false);
        });

        test("continues parsing after broken TOP", () => {
            const sql = `
                SELECT TOP 10 WITH Id FROM dbo.Employee;
                SELECT 1;
            `;

            const parser = new Parser(new Lexer(sql));
            const ast = parser.parse().ast;

            expect(ast.body.length).toBeGreaterThanOrEqual(2);
            expect(ast.body[1].type).toBe("SelectStatement");
        });
    });

    describe("TOP across statement types", () => {
        test("should handle T-SQL TOP clause", () => {
            const sql = `SELECT TOP 10 * FROM Logs;`;
            const ast = parseOne<any>(sql);
            expect(ast.top?.quantity.value).toBe(10);
        });

        test("should handle T-SQL TOP (10) and JOINs", () => {
            const sql = `SELECT TOP (10) e.Name FROM Employees AS e INNER JOIN Departments AS d ON e.DeptId = d.Id`;
            const stmt = parseOne<any>(sql);
            expect(stmt.top?.quantity.value).toBe(10);
            expect(stmt.from?.[0].table.parts.join(".")).toBe("Employees");
            expect(stmt.from?.[0].joins[0].type).toBe("INNER JOIN");
            expectSql(stmt.from?.[0].joins[0].on, "e.DeptId = d.Id");
        });

        test("should handle SELECT TOP ... INTO", () => {
            const sql = `SELECT TOP 10 * INTO dbo.Backup FROM Orders`;
            const stmt = parseOne<any>(sql);
            expect(stmt.top?.quantity.value).toBe(10);
            expect(stmt.into?.name).toBe("dbo.Backup");
            expect(stmt.into?.parts).toEqual(["dbo", "Backup"]);
        });

        test("should handle UPDATE TOP variable", () => {
            const sql = `UPDATE TOP (@n) dbo.Items SET IsActive = 1 WHERE IsActive = 0`;
            const node = parseOne<any>(sql);
            expect(node.top?.type).toBe("TopClause");
            expect(node.top?.quantity?.type).toBe("Variable");
            expect(node.top?.quantity?.name).toBe("@n");
        });

        test("should handle DELETE TOP variable", () => {
            const sql = `DELETE TOP (@n) FROM dbo.Items WHERE IsActive = 0`;
            const node = parseOne<any>(sql);
            expect(node.top?.type).toBe("TopClause");
            expect(node.top?.quantity?.type).toBe("Variable");
            expect(node.top?.quantity?.name).toBe("@n");
        });
    });
});
