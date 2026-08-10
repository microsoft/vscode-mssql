import { Lexer } from "../../src/parser/saral/parser/lexer.js";
import { Parser } from "../../src/parser/saral/parser/parser.js";

describe("Lexer integration", () => {
    test("unterminated string lexer issue flows through parse result", () => {
        const result = new Parser(new Lexer("SELECT 'unterminated")).parse();

        expect(result.issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: "LEX_UNTERMINATED_STRING",
                    message: "Unterminated string literal",
                }),
            ]),
        );
    });
});
