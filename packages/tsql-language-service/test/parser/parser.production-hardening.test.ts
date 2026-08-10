import { IncrementalBatchParser } from "../../src/parser/incremental/incrementalBatchParser.js";
import { DiagnosticCode, diagnose } from "../../src/parser/saral/diagnostics/diagnostics.js";
import { Lexer, TokenType } from "../../src/parser/saral/parser/lexer.js";
import { Parser } from "../../src/parser/saral/parser/parser.js";
import { ScopeBuilder } from "../../src/parser/saral/semantic/scopeBuilder.js";

// These fixtures were authored independently from public T-SQL syntax. They
// characterize editor recovery and SQLCMD behavior; no SqlParser test/source is
// copied into this repository.
const parse = (sql: string) => new Parser(new Lexer(sql)).parse();

describe("production parser hardening", () => {
    test("recognizes quoted identifiers in multipart names", () => {
        const result = parse('SELECT "order".Id FROM "db"."sales"."order";');
        const select = result.ast.body[0] as any;

        expect(result.issues).toEqual([]);
        expect(select.columns[0].expression.name).toBe('"order".Id');
        expect(select.from[0].table.name).toBe('"db"."sales"."order"');
    });

    test("reports unterminated editor lexemes without dropping the remaining AST", () => {
        const bracket = parse("SELECT [unfinished");
        const quoted = parse('SELECT "unfinished');
        const comment = parse("SELECT 1 /* unfinished");

        expect(bracket.ast.body[0]?.type).toBe("SelectStatement");
        expect(bracket.issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ code: "LEX_UNTERMINATED_BRACKET_IDENTIFIER" }),
            ]),
        );
        expect(quoted.ast.body[0]?.type).toBe("SelectStatement");
        expect(quoted.issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ code: "LEX_UNTERMINATED_QUOTED_IDENTIFIER" }),
            ]),
        );
        expect(comment.ast.body[0]?.type).toBe("SelectStatement");
        expect(comment.issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ code: "LEX_UNTERMINATED_BLOCK_COMMENT" }),
            ]),
        );
    });

    test("keeps direct parsing aligned with line-isolated SQLCMD GO", () => {
        const result = parse(
            [
                "SELECT 1 AS [GO];",
                "GO 2 -- repeat the preceding batch",
                "SELECT GO AS identifierName;",
            ].join("\n"),
        );

        expect(result.issues).toEqual([]);
        expect(result.ast.body.map((statement) => statement.type)).toEqual([
            "SelectStatement",
            "BatchSeparatorStatement",
            "SelectStatement",
        ]);
        expect(result.ast.body[1]).toMatchObject({ count: 2 });

        const incremental = new IncrementalBatchParser().create("SELECT 1;\nGO\nSELECT 2;");
        expect(incremental.parseResult().ast.body.map((statement) => statement.type)).toEqual(
            parse("SELECT 1;\nGO\nSELECT 2;").ast.body.map((statement) => statement.type),
        );
    });

    test("diagnoses inline or malformed GO instead of silently splitting a statement", () => {
        const result = parse("SELECT 1; GO SELECT 2;");

        expect(
            result.ast.body.some((statement) => statement.type === "BatchSeparatorStatement"),
        ).toBe(false);
        expect(result.issues).toEqual(
            expect.arrayContaining([expect.objectContaining({ code: "PARSE_GO_SEPARATOR" })]),
        );
        expect(result.ast.body.map((statement) => statement.type)).toEqual([
            "SelectStatement",
            "ErrorStatement",
            "SelectStatement",
        ]);
    });

    test("parses common DROP target lists and DROP INDEX ON qualification", () => {
        const result = parse(
            "DROP SEQUENCE IF EXISTS dbo.One, dbo.Two; DROP INDEX ix_one, ix_two ON dbo.Events; SELECT 1;",
        );
        const sequenceDrop = result.ast.body[0] as any;
        const indexDrop = result.ast.body[1] as any;

        expect(result.issues).toEqual([]);
        expect(sequenceDrop).toMatchObject({
            objectType: "SEQUENCE",
            ifExists: true,
            target: { name: "dbo.One" },
        });
        expect(sequenceDrop.targets.map((target: any) => target.name)).toEqual([
            "dbo.One",
            "dbo.Two",
        ]);
        expect(indexDrop).toMatchObject({
            objectType: "INDEX",
            onTable: { name: "dbo.Events" },
        });
        expect(indexDrop.targets.map((target: any) => target.name)).toEqual(["ix_one", "ix_two"]);
        expect(result.ast.body[2]?.type).toBe("SelectStatement");
    });

    test("parses temporal table qualifiers before aliases and joins", () => {
        const result = parse(`
            SELECT history.Id
            FROM dbo.History FOR SYSTEM_TIME AS OF @asOf AS history
            INNER JOIN dbo.Other FOR SYSTEM_TIME BETWEEN @from AND @to AS otherHistory
                ON history.Id = otherHistory.Id;
        `);
        const select = result.ast.body[0] as any;

        expect(result.issues).toEqual([]);
        expect(select.from[0].forSystemTime).toMatchObject({ kind: "AS_OF" });
        expect(select.from[0].alias).toBe("history");
        expect(select.from[0].joins[0].forSystemTime).toMatchObject({ kind: "BETWEEN" });
        expect(select.from[0].joins[0].alias).toBe("otherHistory");
    });

    test("includes temporal qualifier expressions in semantic variable analysis", () => {
        const result = parse(`
            DECLARE @asOf DATETIME2 = '2024-01-01';
            SELECT Id FROM dbo.History FOR SYSTEM_TIME AS OF @asOf;
        `);
        const diagnostics = diagnose(result.ast, new ScopeBuilder().build(result.ast));

        expect(
            diagnostics.some((diagnostic) => diagnostic.code === DiagnosticCode.UndeclaredVariable),
        ).toBe(false);
    });

    test("lexes a quoted identifier as one token", () => {
        const lexer = new Lexer('"a""b"');
        const token = lexer.nextToken();

        expect(token).toMatchObject({ type: TokenType.Identifier, value: '"a""b"' });
        expect(lexer.getIssues()).toEqual([]);
    });
});
