import { Lexer, TokenType } from "../../src/parser/saral/parser/lexer.js";

describe("T-SQL Lexer - Tests", () => {
    test("Offset Precision: Should track exact positions regardless of whitespace", () => {
        const sql = "SELECT   [Name],\n@ID";
        const lexer = new Lexer(sql);

        const t1 = lexer.nextToken(); // SELECT
        const t2 = lexer.nextToken(); // [Name]
        const t3 = lexer.nextToken(); // ,
        const t4 = lexer.nextToken(); // @ID

        // "SELECT" is at 0
        expect(t1.offset).toBe(0);
        // "   " is 3 spaces, so "[" is at index 9
        expect(t2.offset).toBe(9);
        expect(t2.value).toBe("[Name]");
        // "," is immediately after "]" (index 15)
        expect(t3.offset).toBe(15);
        // "\n" is 1 char, so "@" is at index 17
        expect(t4.offset).toBe(17);
        expect(t4.line).toBe(2);
        expect(t4.col).toBe(1);
    });

    test("T-SQL Identifiers: Should distinguish between Keywords, Variables, and Temp Tables", () => {
        const sql = "SELECT @Var, #Temp, [KeywordTable]";
        const lexer = new Lexer(sql);

        const tokens = [];
        let t;
        while ((t = lexer.nextToken()).type !== TokenType.EOF) tokens.push(t);

        expect(tokens[0].type).toBe(TokenType.Keyword); // SELECT
        expect(tokens[1].type).toBe(TokenType.Variable); // @Var
        expect(tokens[3].type).toBe(TokenType.TempTable); // #Temp
        expect(tokens[5].type).toBe(TokenType.Identifier); // [KeywordTable]
    });

    test("String Literals: Should handle N-prefix and escaped quotes", () => {
        const sql = "N'Unicode String' + 'Standard ''Escaped'' String'";
        const lexer = new Lexer(sql);

        const t1 = lexer.nextToken(); // N'Unicode String'
        lexer.nextToken(); // +
        const t3 = lexer.nextToken(); // 'Standard ''Escaped'' String'

        expect(t1.type).toBe(TokenType.String);
        expect(t1.value).toBe("N'Unicode String'");

        expect(t3.type).toBe(TokenType.String);
        expect(t3.value).toBe("'Standard ''Escaped'' String'");
        // Ensure the offset points to the first quote
        expect(sql.substring(t3.offset, t3.offset + 1)).toBe("'");
    });

    test("Comments: Should skip and maintain correct offsets for subsequent tokens", () => {
        const sql = `
            /* Multi-line
               Block Comment */
            SELECT -- End of line comment
            * FROM T
        `;
        const lexer = new Lexer(sql);

        const t1 = lexer.nextToken(); // SELECT
        const t2 = lexer.nextToken(); // *

        expect(t1.value.toLowerCase()).toBe("select");
        // Verify we can find the token in the original string using the offset
        expect(sql.substring(t1.offset, t1.offset + 6).toLowerCase()).toBe("select");

        expect(t2.value).toBe("*");
        expect(sql.substring(t2.offset, t2.offset + 1)).toBe("*");
    });

    test("Comments: Should skip nested block comments", () => {
        const sql = `
            /*
                /* nested */
                SELECT 1
            */
            SELECT 2
        `;
        const lexer = new Lexer(sql);

        const t1 = lexer.nextToken();
        const t2 = lexer.nextToken();

        expect(t1.value.toLowerCase()).toBe("select");
        expect(t2.value).toBe("2");
    });

    test("Edge Case: Bracketed keywords should be Identifiers", () => {
        const sql = "SELECT [FROM] FROM [SELECT]";
        const lexer = new Lexer(sql);

        const t1 = lexer.nextToken(); // SELECT
        const t2 = lexer.nextToken(); // [FROM]
        const t3 = lexer.nextToken(); // FROM

        expect(t1.type).toBe(TokenType.Keyword);
        expect(t2.type).toBe(TokenType.Identifier);
        expect(t2.value).toBe("[FROM]");
        expect(t3.type).toBe(TokenType.Keyword);
    });

    test("Numbers: Should handle decimals", () => {
        const sql = "123.45";
        const lexer = new Lexer(sql);
        const t = lexer.nextToken();

        expect(t.type).toBe(TokenType.Number);
        expect(t.value).toBe("123.45");
    });

    test("MAX: Should lex as Identifier, not Keyword", () => {
        const lexer = new Lexer("MAX(Value)");
        const t = lexer.nextToken();

        expect(t.type).toBe(TokenType.Identifier);
        expect(t.value).toBe("MAX");
    });

    test("CAST family: Should lex as Keywords", () => {
        const lexer = new Lexer("Cast(@Value AS INT) TRY_CAST(@Value AS INT) CONVERT(INT, @Value)");
        const t1 = lexer.nextToken();
        lexer.nextToken(); // (
        lexer.nextToken(); // @Value
        const t4 = lexer.nextToken(); // AS
        lexer.nextToken(); // INT
        lexer.nextToken(); // )
        const t7 = lexer.nextToken(); // TRY_CAST
        const t8 = lexer.nextToken(); // (
        lexer.nextToken(); // @Value
        const t10 = lexer.nextToken(); // AS
        lexer.nextToken(); // INT
        lexer.nextToken(); // )
        const t13 = lexer.nextToken(); // CONVERT

        expect(t1.type).toBe(TokenType.Keyword);
        expect(t1.value).toBe("CAST");
        expect(t4.type).toBe(TokenType.Keyword);
        expect(t4.value).toBe("AS");
        expect(t7.type).toBe(TokenType.Keyword);
        expect(t7.value).toBe("TRY_CAST");
        expect(t8.type).toBe(TokenType.OpenParen);
        expect(t10.type).toBe(TokenType.Keyword);
        expect(t10.value).toBe("AS");
        expect(t13.type).toBe(TokenType.Keyword);
        expect(t13.value).toBe("CONVERT");
    });

    test("Numbers: Should handle scientific notation", () => {
        const lexer = new Lexer("1e10 2.5E-3");
        const t1 = lexer.nextToken();
        const t2 = lexer.nextToken();

        expect(t1.type).toBe(TokenType.Number);
        expect(t1.value).toBe("1e10");
        expect(t2.type).toBe(TokenType.Number);
        expect(t2.value).toBe("2.5E-3");
    });

    test("Numbers: Should handle hex literals", () => {
        const lexer = new Lexer("0x1A 0Xff");
        const t1 = lexer.nextToken();
        const t2 = lexer.nextToken();

        expect(t1.type).toBe(TokenType.Number);
        expect(t1.value).toBe("0x1A");
        expect(t2.type).toBe(TokenType.Number);
        expect(t2.value).toBe("0Xff");
    });

    test("String Literals: Unterminated string emits lexer issue", () => {
        const lexer = new Lexer("'unterminated");
        const t = lexer.nextToken();

        expect(t.type).toBe(TokenType.String);
        expect(t.value).toBe("'unterminated");
        expect(lexer.getIssues()).toEqual([
            {
                code: "LEX_UNTERMINATED_STRING",
                message: "Unterminated string literal",
                start: 0,
                end: 13,
            },
        ]);
    });

    test("should correctly identify Comma as a distinct token type", () => {
        const lexer = new Lexer("A, B");
        lexer.nextToken(); // A
        const comma = lexer.nextToken();
        expect(comma.type).toBe(TokenType.Comma);
        expect(comma.value).toBe(",");
    });

    test("should not fold spaced comparison operators into composite operators", () => {
        const sql = `
            SELECT recordRow.Id
            FROM dbo.Records recordRow
            WHERE recordRow.CreatedOn > = @Cutoff
              AND recordRow.Score < = @Threshold
        `;

        const lexer = new Lexer(sql);
        const operators: string[] = [];
        while (true) {
            const token = lexer.nextToken();
            if (token.type === TokenType.Operator) {
                operators.push(token.value);
            }
            if (token.type === TokenType.EOF) break;
        }

        expect(operators).toContain(">");
        expect(operators).toContain("<");
        expect(operators).toContain("=");
        expect(operators).not.toContain(">=");
        expect(operators).not.toContain("<=");
    });
});
