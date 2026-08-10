import {
    analyze,
    analyzeParseResult,
    DiagnosticCode,
    Lexer,
    Parser,
    SymbolKind,
    TokenType,
} from "../../src/parser/saral/index.js";

describe("analyze facade", () => {
    test("returns parser, semantic, lineage, and column analysis results", () => {
        const result = analyze(`
            DECLARE @Id INT = 1;
            SELECT Id FROM Users WHERE Id = @Ghost;
        `);

        expect(result.ast.type).toBe("Program");
        expect(result.ast.start).toBeGreaterThanOrEqual(0);
        expect(result.ast.end).toBeGreaterThan(result.ast.start);
        expect(result.ast.body.length).toBeGreaterThan(0);

        expect(Array.isArray(result.issues)).toBe(true);
        expect(result.scope.root).toBeDefined();
        expect(result.lineage.columns).toBeDefined();
        expect(result.lineage.edges).toBeDefined();
        expect(result.columns.resolutions).toBeDefined();
        expect(result.typeMembers).toBeDefined();
        expect(result.typeMembers.builtIn.GEOGRAPHY?.some((x) => x.name === "Lat")).toBe(true);

        expect(result.diagnostics.map((d) => d.code)).toContain(DiagnosticCode.UndeclaredVariable);
        expect(result.semanticDiagnostics.map((d) => d.code)).toContain(
            DiagnosticCode.UndeclaredVariable,
        );
    });

    test("exposes referenced type members as top-level channel", () => {
        const result = analyze(`
            DECLARE @Location GEOGRAPHY;
            SELECT @Location.Lat;
        `);

        expect(result.typeMembers.referenced.GEOGRAPHY).toBeDefined();
        expect(result.typeMembers.referenced.GEOGRAPHY.some((x) => x.name === "Lat")).toBe(true);
    });

    test("combines parse issues and semantic diagnostics into one sorted stream", () => {
        const result = analyze(`
            SELECT CASE WHEN;
            SELECT @Ghost;
        `);

        expect(result.issues.length).toBeGreaterThan(0);
        expect(result.semanticDiagnostics.length).toBeGreaterThan(0);

        expect(result.diagnostics.map((d) => d.source)).toContain("parser");
        expect(result.diagnostics.map((d) => d.source)).toContain("semantic");

        const offsets = result.diagnostics.map((d) => d.start);
        expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    });

    test("SQLCMD preprocessing maps AST and diagnostic offsets correctly", () => {
        const sql = `:setvar TableName "Users"\nSELECT Id FROM $(TableName) WHERE Id = @Missing;`;
        const result = analyze(sql);

        expect(result.diagnostics.length).toBeGreaterThan(0);

        const diag = result.diagnostics.find((d) => d.code === DiagnosticCode.UndeclaredVariable);
        expect(diag).toBeDefined();

        // Ensure offset points to @Missing in the original text, regardless of
        // the fact that $(TableName) was expanded behind the scenes!
        const missingOffset = sql.indexOf("@Missing");
        expect(diag!.start).toBe(missingOffset);
    });

    test("analyzes an existing parser result without changing facade behavior", () => {
        const sql = "DECLARE @Id INT; SELECT @Id, @Missing;";
        const parsed = new Parser(new Lexer(sql)).parse();

        const direct = analyzeParseResult(parsed);
        const facade = analyze(sql);

        expect(direct.ast).toBe(parsed.ast);
        expect(direct.diagnostics).toEqual(facade.diagnostics);
        expect(direct.lineage).toEqual(facade.lineage);
        expect(direct.columns).toEqual(facade.columns);
    });

    test("exports runtime enums from the root API", () => {
        expect(TokenType.Keyword).toBe(0);
        expect(SymbolKind.Table).toBe("Table");
    });
});
