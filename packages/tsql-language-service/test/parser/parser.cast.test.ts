import { parseOne, expectSql } from "./parser.helpers";
import { analyze } from "../../src/parser/saral/index.js";

describe("T-SQL Parser - CAST / TRY_CAST / CONVERT", () => {
    test("should parse CAST literal", () => {
        const stmt = parseOne<any>(`
            SELECT CAST(1 AS DATE)
        `);

        const expr = stmt.columns[0].expression;

        expect(expr.type).toBe("CastExpression");
        expect(expr.kind).toBe("CAST");
        expect(expr.dataType).toBe("DATE");
        expectSql(expr.expression, "1");
    });

    test("should parse CAST variable", () => {
        const stmt = parseOne<any>(`
            SELECT CAST(@Id AS INT)
        `);

        const expr = stmt.columns[0].expression;

        expect(expr.type).toBe("CastExpression");
        expect(expr.kind).toBe("CAST");
        expect(expr.dataType).toBe("INT");

        expect(expr.expression.type).toBe("Variable");
        expect(expr.expression.name).toBe("@Id");
    });

    test("should parse CAST function call", () => {
        const stmt = parseOne<any>(`
            SELECT CAST(GETDATE() AS DATE)
        `);

        const expr = stmt.columns[0].expression;

        expect(expr.type).toBe("CastExpression");
        expect(expr.kind).toBe("CAST");
        expect(expr.dataType).toBe("DATE");

        expect(expr.expression.type).toBe("FunctionCall");
        expect(expr.expression.name).toBe("GETDATE");
    });

    test("should parse CAST arithmetic expression", () => {
        const stmt = parseOne<any>(`
            SELECT CAST(1 + 2 * 3 AS INT)
        `);

        const expr = stmt.columns[0].expression;

        expect(expr.type).toBe("CastExpression");
        expectSql(expr.expression, "1 + 2 * 3");
        expect(expr.dataType).toBe("INT");
    });

    test("should parse CAST grouped expression", () => {
        const stmt = parseOne<any>(`
            SELECT CAST((1 + 2) * 3 AS INT)
        `);

        const expr = stmt.columns[0].expression;

        expect(expr.type).toBe("CastExpression");
        expectSql(expr.expression, "(1 + 2) * 3");
    });

    test("should parse CAST string", () => {
        const stmt = parseOne<any>(`
            SELECT CAST('123' AS INT)
        `);

        const expr = stmt.columns[0].expression;

        expect(expr.type).toBe("CastExpression");
        expect(expr.dataType).toBe("INT");
        expectSql(expr.expression, `'123'`);
    });

    test("should parse mixed-case Cast", () => {
        const stmt = parseOne<any>(`
            SELECT Cast(@RowNum AS VARCHAR(10))
        `);

        const expr = stmt.columns[0].expression;

        expect(expr.type).toBe("CastExpression");
        expect(expr.kind).toBe("CAST");
        expect(expr.dataType).toBe("VARCHAR(10)");
        expectSql(expr.expression, "@RowNum");
    });

    test("should parse TRY_CAST", () => {
        const stmt = parseOne<any>(`
            SELECT TRY_CAST(@Value AS INT)
        `);

        const expr = stmt.columns[0].expression;

        expect(expr.type).toBe("CastExpression");
        expect(expr.kind).toBe("TRY_CAST");
        expect(expr.dataType).toBe("INT");
        expectSql(expr.expression, "@Value");
    });

    test("should parse TRY_PARSE", () => {
        const stmt = parseOne<any>(`
            SELECT TRY_PARSE(@Value AS SMALLINT)
        `);

        const expr = stmt.columns[0].expression;

        expect(expr.type).toBe("CastExpression");
        expect(expr.kind).toBe("TRY_PARSE");
        expect(expr.dataType).toBe("SMALLINT");
        expectSql(expr.expression, "@Value");
    });

    test("should parse PARSE with USING culture", () => {
        const stmt = parseOne<any>(`
            SELECT PARSE(@Value AS DATETIME USING 'en-US')
        `);

        const expr = stmt.columns[0].expression;

        expect(expr.type).toBe("CastExpression");
        expect(expr.kind).toBe("PARSE");
        expect(expr.dataType).toBe("DATETIME");
        expect(expr.culture).toBeDefined();
        expect(expr.culture.type).toBe("Literal");
    });

    test("should parse CONVERT", () => {
        const stmt = parseOne<any>(`
            SELECT CONVERT(DATE, GETDATE())
        `);

        const expr = stmt.columns[0].expression;

        expect(expr.type).toBe("CastExpression");
        expect(expr.kind).toBe("CONVERT");
        expect(expr.dataType).toBe("DATE");

        expect(expr.expression.type).toBe("FunctionCall");
        expect(expr.expression.name).toBe("GETDATE");
    });

    test("should parse CONVERT varchar length", () => {
        const stmt = parseOne<any>(`
            SELECT CONVERT(VARCHAR(10), GETDATE())
        `);

        const expr = stmt.columns[0].expression;

        expect(expr.type).toBe("CastExpression");
        expect(expr.kind).toBe("CONVERT");
        expect(expr.dataType).toBe("VARCHAR(10)");
    });

    test("should parse CONVERT with style argument", () => {
        const stmt = parseOne<any>(`
            SELECT CONVERT(VARCHAR(16), GETUTCDATE(), 120)
        `);

        const expr = stmt.columns[0].expression;

        expect(expr.type).toBe("CastExpression");
        expect(expr.kind).toBe("CONVERT");
        expect(expr.dataType).toBe("VARCHAR(16)");
        expect(expr.style).toBeDefined();
        expect(expr.style.type).toBe("Literal");
        expect(expr.style.value).toBe(120);
    });

    test("should parse CAST varchar length", () => {
        const stmt = parseOne<any>(`
            SELECT CAST(@Name AS VARCHAR(50))
        `);

        const expr = stmt.columns[0].expression;

        expect(expr.type).toBe("CastExpression");
        expect(expr.dataType).toBe("VARCHAR(50)");
    });

    test("should parse CAST decimal precision", () => {
        const stmt = parseOne<any>(`
            SELECT CAST(@Amount AS DECIMAL(18,2))
        `);

        const expr = stmt.columns[0].expression;

        expect(expr.type).toBe("CastExpression");
        expect(expr.dataType).toBe("DECIMAL(18,2)");
    });

    test("should parse TRY_CAST decimal precision", () => {
        const stmt = parseOne<any>(`
            SELECT TRY_CAST(@Amount AS DECIMAL(18,2))
        `);

        const expr = stmt.columns[0].expression;

        expect(expr.type).toBe("CastExpression");
        expect(expr.kind).toBe("TRY_CAST");
        expect(expr.dataType).toBe("DECIMAL(18,2)");
    });

    test("should parse schema type", () => {
        const stmt = parseOne<any>(`
            SELECT CAST(@Value AS dbo.TransportRequestsType)
        `);

        const expr = stmt.columns[0].expression;

        expect(expr.type).toBe("CastExpression");
        expect(expr.dataType).toBe("dbo.TransportRequestsType");
    });

    test("should parse nested CAST", () => {
        const stmt = parseOne<any>(`
            SELECT CAST(CAST(@Value AS INT) AS VARCHAR(10))
        `);

        const expr = stmt.columns[0].expression;

        expect(expr.type).toBe("CastExpression");
        expect(expr.dataType).toBe("VARCHAR(10)");

        expect(expr.expression.type).toBe("CastExpression");
        expect(expr.expression.kind).toBe("CAST");
        expect(expr.expression.dataType).toBe("INT");
    });

    test("should parse CAST inside function", () => {
        const stmt = parseOne<any>(`
            SELECT ISNULL(CAST(@Id AS VARCHAR(20)), '')
        `);

        const expr = stmt.columns[0].expression;

        expect(expr.type).toBe("FunctionCall");
        expect(expr.name).toBe("ISNULL");

        expect(expr.args[0].type).toBe("CastExpression");
        expect(expr.args[0].dataType).toBe("VARCHAR(20)");
    });

    test("should parse nested REPLACE around CONVERT with style", () => {
        const stmt = parseOne<any>(`
            SELECT REPLACE(REPLACE(REPLACE(CONVERT(VARCHAR(16), GETUTCDATE(), 120), '-', ''), ' ', ''), ':', '')
        `);

        const expr = stmt.columns[0].expression;

        expect(expr.type).toBe("FunctionCall");
        expect(expr.name).toBe("REPLACE");
    });

    test("should parse CAST in WHERE clause", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            WHERE CAST(Id AS VARCHAR(10)) = '1'
        `);

        expect(stmt.where.type).toBe("BinaryExpression");
        expect(stmt.where.left.type).toBe("CastExpression");
        expect(stmt.where.left.dataType).toBe("VARCHAR(10)");
    });

    test("should recover missing AS in CAST", () => {
        const stmt = parseOne<any>(`
            SELECT CAST(@Id INT)
        `);

        const expr = stmt.columns[0].expression;

        expect(expr.type).toBe("CastExpression");
        expect(expr.incomplete).toBe(true);
    });

    test("should recover missing close paren", () => {
        const stmt = parseOne<any>(`
            SELECT CAST(@Id AS INT
        `);

        const expr = stmt.columns[0].expression;

        expect(expr.type).toBe("CastExpression");
        expect(expr.incomplete).toBe(true);
    });

    test("should recover malformed CONVERT", () => {
        const stmt = parseOne<any>(`
            SELECT CONVERT(DATE GETDATE())
        `);

        const expr = stmt.columns[0].expression;

        expect(expr.type).toBe("CastExpression");
        expect(expr.incomplete).toBe(true);
    });

    test("should parse TRY_PARSE inside stored procedure assignment query", () => {
        const sql = `
CREATE PROCEDURE [dbo].[LoadThresholdConfig] @GroupId INT = NULL
AS
BEGIN
    DECLARE @ThresholdDays INT,
            @SettingName VARCHAR(100) = ''

    SELECT @ThresholdDays = ISNULL(TRY_PARSE(s.ConfigValue AS SMALLINT), 6)
    FROM [dbo].[Settings] s WITH (NOLOCK)
    WHERE [ConfigName] = @SettingName
END
`;

        const result = analyze(sql);

        expect(result.issues).toEqual([]);
    });
});
