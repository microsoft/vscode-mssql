import { parseOne, parseResult } from "./parser.helpers";

describe("T-SQL Parser - OPTION clause", () => {
    test("should parse SELECT OPTION(RECOMPILE)", () => {
        const stmt = parseOne<any>(`
            SELECT Name
            FROM dbo.Users
            OPTION (RECOMPILE)
        `);

        expect(stmt.type).toBe("SelectStatement");
        expect(stmt.optionClause).toBeDefined();
        expect(stmt.optionClause.hints).toHaveLength(1);
        expect(stmt.optionClause.hints[0].kind).toBe("RECOMPILE");
    });

    test("should parse SELECT OPTION with numeric hints", () => {
        const stmt = parseOne<any>(`
            SELECT Name
            FROM dbo.Users
            OPTION (MAXDOP 4, FAST 10)
        `);

        expect(stmt.optionClause.hints).toHaveLength(2);
        expect(stmt.optionClause.hints[0]).toMatchObject({ kind: "MAXDOP", value: 4 });
        expect(stmt.optionClause.hints[1]).toMatchObject({ kind: "FAST", value: 10 });
    });

    test("should parse SELECT OPTION with OPTIMIZE FOR and USE HINT", () => {
        const result = parseResult(`
            SELECT Name
            FROM dbo.Users
            OPTION (
                OPTIMIZE FOR (@UserId = 1, UNKNOWN),
                USE HINT('ASSUME_MIN_SELECTIVITY_FOR_FILTER_ESTIMATES')
            )
        `);

        const stmt = result.ast.body[0] as any;

        expect(result.issues).toHaveLength(0);
        expect(stmt.optionClause.hints[0].kind).toBe("OPTIMIZE_FOR");
        expect(stmt.optionClause.hints[1].kind).toBe("USE_HINT");
    });

    test("should parse UPDATE OPTION(RECOMPILE)", () => {
        const stmt = parseOne<any>(`
            UPDATE dbo.Users
            SET Status = 1
            WHERE Id = 1
            OPTION (RECOMPILE)
        `);

        expect(stmt.type).toBe("UpdateStatement");
        expect(stmt.optionClause.hints[0].kind).toBe("RECOMPILE");
    });

    test("should parse DELETE OPTION(LOOP JOIN)", () => {
        const stmt = parseOne<any>(`
            DELETE targetRow
            FROM dbo.Users targetRow
            JOIN dbo.AllowedUsers allowedRow ON allowedRow.Id = targetRow.Id
            OPTION (LOOP JOIN)
        `);

        expect(stmt.type).toBe("DeleteStatement");
        expect(stmt.optionClause.hints[0].kind).toBe("LOOP_JOIN");
    });

    test("should parse MERGE OPTION(HASH JOIN)", () => {
        const stmt = parseOne<any>(`
            MERGE dbo.Target AS targetRow
            USING dbo.Source AS sourceRow
            ON targetRow.Id = sourceRow.Id
            WHEN MATCHED THEN UPDATE SET Name = sourceRow.Name
            OPTION (HASH JOIN)
        `);

        expect(stmt.type).toBe("MergeStatement");
        expect(stmt.optionClause.hints[0].kind).toBe("HASH_JOIN");
    });

    test("should report invalid MAXDOP argument", () => {
        const result = parseResult(`
            SELECT Name
            FROM dbo.Users
            OPTION (MAXDOP)
        `);
        const issues = result.issues ?? [];

        expect(
            issues.some(
                (issue) => issue.code === "PARSE_OPTION_HINT" && issue.message.includes("MAXDOP"),
            ),
        ).toBe(true);
    });

    test("should report invalid PARAMETERIZATION argument", () => {
        const result = parseResult(`
            SELECT Name
            FROM dbo.Users
            OPTION (PARAMETERIZATION AUTO)
        `);
        const issues = result.issues ?? [];

        expect(
            issues.some(
                (issue) =>
                    issue.code === "PARSE_OPTION_HINT" &&
                    issue.message.includes("PARAMETERIZATION"),
            ),
        ).toBe(true);
    });

    test("should report unsupported OPTION hint", () => {
        const result = parseResult(`
            SELECT Name
            FROM dbo.Users
            OPTION (MAGIC_HINT)
        `);
        const issues = result.issues ?? [];

        expect(
            issues.some(
                (issue) =>
                    issue.code === "PARSE_OPTION_HINT" &&
                    issue.message.includes("Unsupported OPTION hint"),
            ),
        ).toBe(true);
    });
});
