import { Lexer } from "../../src/parser/saral/parser/lexer.js";
import { Parser } from "../../src/parser/saral/parser/parser.js";

describe("Parser Fault Tolerance", () => {
    test("should recover from a missing FROM clause", () => {
        // User is currently typing...
        const sql = "SELECT Name, FROM Users;";
        const lexer = new Lexer(sql);
        const parser = new Parser(lexer);

        const ast = parser.parse().ast;

        // The parser should have "resynced" and still found the statement
        expect(ast.body.length).toBeGreaterThan(0);
        // Ensure it didn't throw an unhandled exception
    });

    test("should isolate errors in multi-batch scripts", () => {
        const sql = `
        SELECT * FROM ValidTable;
        GO
        !@#$%^&*() -- Pure garbage that cannot be a SELECT
        GO
        SELECT * FROM AnotherValidTable;
    `;
        const lexer = new Lexer(sql);
        const parser = new Parser(lexer);
        const ast = parser.parse().ast;

        // Filter for valid SelectStatements
        const validStatements = ast.body.filter((s) => s.type === "SelectStatement");

        // Now it should strictly be 2
        expect(validStatements.length).toBe(2);
    });

    test("reports a human-readable diagnostic for an incomplete WHERE clause", () => {
        const result = new Parser(new Lexer("SELECT * FROM dbo.Users WHERE")).parse();
        const issue = result.issues?.find((candidate) => candidate.code === "PARSE_SELECT_WHERE");

        expect(issue?.message).toBe("Expected expression");
        expect(issue?.message).not.toMatch(/TypeError|undefined|Cannot read/iu);
    });

    test("does not consume FROM as a member after an incomplete alias dot", () => {
        const result = new Parser(
            new Lexer("SELECT u. FROM dbo.Users AS u WHERE u.Id = 1;"),
        ).parse();
        const select = result.ast.body[0];

        expect(result.issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: "PARSE_IDENTIFIER_DOT",
                    message: "Expected identifier after dot",
                }),
            ]),
        );
        expect(select).toMatchObject({
            type: "SelectStatement",
            columns: [
                expect.objectContaining({
                    expression: expect.objectContaining({ name: "u.", incomplete: true }),
                }),
            ],
            from: [
                expect.objectContaining({
                    table: expect.objectContaining({ name: "dbo.Users" }),
                    alias: "u",
                }),
            ],
            where: expect.objectContaining({ type: "BinaryExpression" }),
        });
    });
});
