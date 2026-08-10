import { Lexer } from "../../src/parser/saral/parser/lexer.js";
import { Parser } from "../../src/parser/saral/parser/parser.js";

describe("T-SQL Parser", () => {
    const parse = (sql: string) => {
        const lexer = new Lexer(sql);
        const parser = new Parser(lexer);
        return parser.parse().ast;
    };

    test("should preserve GO as a batch separator statement", () => {
        const ast = parse(`
            DECLARE @ID INT = 20
            GO
            DECLARE @ID INT = 30
        `);

        expect(ast.body.map((stmt) => stmt.type)).toEqual([
            "DeclareStatement",
            "BatchSeparatorStatement",
            "DeclareStatement",
        ]);
    });
});
