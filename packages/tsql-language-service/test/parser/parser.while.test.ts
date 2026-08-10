import { parseOne, expectSql } from "./parser.helpers";

import { Parser } from "../../src/parser/saral/parser/parser.js";
import { Lexer } from "../../src/parser/saral/parser/lexer.js";

describe("T-SQL Parser - WHILE", () => {
    test("simple WHILE", () => {
        const stmt = parseOne<any>(`
            WHILE @I < 10
                SET @I = @I + 1
        `);

        expect(stmt.type).toBe("WhileStatement");

        expectSql(stmt.condition, "@I < 10");

        expect(stmt.body).toBeDefined();

        expect(stmt.body.type).toBe("SetStatement");
    });

    test("WHILE with BEGIN END block", () => {
        const stmt = parseOne<any>(`
            WHILE @I < 10
            BEGIN
                PRINT 'hello';
                SET @I = @I + 1;
            END
        `);

        expect(stmt.type).toBe("WhileStatement");

        expectSql(stmt.condition, "@I < 10");

        expect(stmt.body).toBeDefined();

        expect(stmt.body.type).toBe("BlockStatement");

        expect(stmt.body.body.length).toBe(2);
    });

    test("WHILE EXISTS", () => {
        const stmt = parseOne<any>(`
            WHILE EXISTS(
                SELECT 1
            )
                PRINT 'x'
        `);

        expect(stmt.type).toBe("WhileStatement");

        expect(stmt.condition).toBeDefined();

        expect(stmt.body.type).toBe("PrintStatement");
    });

    test("nested WHILE", () => {
        const stmt = parseOne<any>(`
            WHILE @I < 10
                WHILE @J < 5
                    SET @J = @J + 1
        `);

        expect(stmt.type).toBe("WhileStatement");

        expect(stmt.body.type).toBe("WhileStatement");

        expect(stmt.body.body.type).toBe("SetStatement");
    });

    test("WHILE with SELECT body", () => {
        const stmt = parseOne<any>(`
            WHILE @I < 10
                SELECT @I
        `);

        expect(stmt.type).toBe("WhileStatement");

        expect(stmt.body.type).toBe("SelectStatement");
    });

    test("WHILE with EXEC body", () => {
        const stmt = parseOne<any>(`
            WHILE @Running = 1
                EXEC dbo.DoWork
        `);

        expect(stmt.type).toBe("WhileStatement");

        expect(stmt.body.type).toBe("ExecuteStatement");
    });

    test("missing condition recovers", () => {
        const stmt = parseOne<any>(`
            WHILE
            SELECT 1;
        `);

        expect(stmt.type).toBe("WhileStatement");

        expect(stmt.incomplete).toBe(true);

        expect(stmt.condition).toBeNull();

        expect(stmt.body).toBeDefined();

        expect(stmt.body.type).toBe("SelectStatement");
    });

    test("missing body recovers", () => {
        const stmt = parseOne<any>(`
            WHILE @I < 10;
        `);

        expect(stmt.type).toBe("WhileStatement");

        expect(stmt.incomplete).toBe(true);

        expectSql(stmt.condition, "@I < 10");

        expect(stmt.body).toBeNull();
    });

    test("broken expression recovers", () => {
        const stmt = parseOne<any>(`
        WHILE @I < ;
        SELECT 1;
    `);

        expect(stmt.type).toBe("WhileStatement");

        expect(stmt.incomplete).toBe(true);
    });

    test("continues after malformed WHILE", () => {
        const sql = `
            WHILE ;
            SELECT 1;
        `;

        const parser = new Parser(new Lexer(sql));

        const ast = parser.parse().ast;

        expect(ast.body.length).toBeGreaterThanOrEqual(2);

        expect(ast.body[1].type).toBe("SelectStatement");
    });
});
