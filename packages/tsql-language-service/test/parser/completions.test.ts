import {
    analyze,
    getCompletionContext,
    getCompletionContextFromAnalysis,
    getCompletionsAt,
    getCompletionsAtFromAnalysis,
    Parser,
} from "../../src/parser/saral/index.js";

describe("completion helpers", () => {
    test("returns visible symbols for the current offset", () => {
        const sql = "DECLARE @CustomerId INT; SELECT @C";
        const offset = sql.length;

        const context = getCompletionContext(sql, offset);

        expect(context.prefix).toBe("@C");
        expect(context.visibleSymbols.map((symbol) => symbol.name)).toContain("@CustomerId");
    });

    test("returns symbol completions matching the current prefix", () => {
        const sql = "DECLARE @CustomerId INT; SELECT @C";
        const completions = getCompletionsAt(sql, sql.length);

        expect(completions).toContainEqual(
            expect.objectContaining({
                label: "@CustomerId",
                kind: "variable",
            }),
        );
    });

    test("returns keyword completions matching the current prefix", () => {
        const sql = "SEL";
        const completions = getCompletionsAt(sql, sql.length);

        expect(completions).toContainEqual(
            expect.objectContaining({
                label: "SELECT",
                kind: "keyword",
                start: 0,
                end: 3,
            }),
        );
    });

    test("returns qualified column completions for temp table alias", () => {
        const sql = `
CREATE TABLE #TempUsers (
  Id INT,
  Name NVARCHAR(100)
);

SELECT *
FROM #TempUsers t
WHERE t.
`;
        const offset = sql.lastIndexOf("t.") + 2;
        const completions = getCompletionsAt(sql, offset);

        expect(completions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ label: "Id", kind: "column" }),
                expect.objectContaining({ label: "Name", kind: "column" }),
            ]),
        );
    });

    test("pre-analyzed completion APIs never invoke the parser", () => {
        const sql = "DECLARE @CustomerId INT; SELECT @C";
        const analysis = analyze(sql);
        const parseSpy = jest.spyOn(Parser.prototype, "parse");

        try {
            const context = getCompletionContextFromAnalysis(sql, analysis, sql.length);
            const completions = getCompletionsAtFromAnalysis(sql, analysis, sql.length);

            expect(parseSpy).not.toHaveBeenCalled();
            expect(context.visibleSymbols.map((symbol) => symbol.name)).toContain("@CustomerId");
            expect(completions).toContainEqual(
                expect.objectContaining({ label: "@CustomerId", kind: "variable" }),
            );
        } finally {
            parseSpy.mockRestore();
        }
    });

    test("legacy completion APIs accept an optional existing analysis", () => {
        const sql = "DECLARE @CustomerId INT; SELECT @C";
        const analysis = analyze(sql);
        const parseSpy = jest.spyOn(Parser.prototype, "parse");

        try {
            expect(getCompletionContext(sql, sql.length, analysis).prefix).toBe("@C");
            expect(getCompletionsAt(sql, sql.length, analysis)).toContainEqual(
                expect.objectContaining({ label: "@CustomerId" }),
            );
            expect(parseSpy).not.toHaveBeenCalled();
        } finally {
            parseSpy.mockRestore();
        }
    });
});
