import { Lexer } from "../../src/parser/saral/parser/lexer.js";
import { type SetNode } from "../../src/parser/saral/ast/types.js";
import { Parser } from "../../src/parser/saral/parser/parser.js";
import { toSql } from "./parser.helpers";

describe("T-SQL Parser - SET / USE", () => {
    const parse = (sql: string) => {
        const lexer = new Lexer(sql);
        const parser = new Parser(lexer);
        return parser.parse().ast;
    };

    test("should handle SET @Var = Expr", () => {
        const sql = `SET @ID = @ID + 1`;
        expect(toSql((parse(sql).body[0] as SetNode).value)).toBe("@ID + 1");
    });

    test("should handle SET @Var compound assignment", () => {
        const sql = `SET @ID -= 1`;
        expect(toSql((parse(sql).body[0] as SetNode).value)).toBe("@ID - 1");
    });

    test("should handle complex Session SET options", () => {
        const sql = "SET TRANSACTION ISOLATION LEVEL READ COMMITTED;";
        const ast = parse(sql);
        const setStmt = ast.body[0] as any;

        expect(setStmt.type).toBe("SetStatement");
        // Now captures the entire multi-token string
        expect(setStmt.variable).toBe("TRANSACTION ISOLATION LEVEL READ COMMITTED");
    });

    test("should parse USE database statement", () => {
        const stmt = parse(`USE [ReportingDb]`).body[0] as any;

        expect(stmt.type).toBe("UseStatement");
        expect(stmt.database?.type).toBe("Identifier");
        expect(stmt.database?.name).toBe("[ReportingDb]");
    });
});
