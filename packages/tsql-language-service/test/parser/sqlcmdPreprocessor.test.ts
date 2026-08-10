import { SqlCmdPreprocessor } from "../../src/parser/saral/parser/sqlcmdPreprocessor.js";

describe("SqlCmdPreprocessor", () => {
    test("fast path for standard SQL", () => {
        const preprocessor = new SqlCmdPreprocessor();
        const sql = "SELECT * FROM Users;";
        const result = preprocessor.process(sql);

        expect(result.text).toBe(sql);
        expect(result.issues).toHaveLength(0);
        expect(result.mapOffset(10)).toBe(10);
    });

    test("blanks out :setvar and keeps offset 1:1", () => {
        const preprocessor = new SqlCmdPreprocessor();
        const sql = ':setvar DatabaseName "MyDb"\nSELECT * FROM $(DatabaseName);';
        const result = preprocessor.process(sql, { initialVariables: {} });

        expect(result.text.startsWith(" ".repeat(27))).toBe(true);
        expect(result.text).toContain("SELECT * FROM MyDb;");
        expect(result.issues).toHaveLength(0);
    });

    test("blanks out :r includes and keeps offset 1:1, without asserting whether it resolves", () => {
        // Whether a :r include actually resolves is a workspace fact (file
        // existence, project layout) that a single-file parser has no way
        // to know — so this is silently blanked out, not flagged as an issue.
        const preprocessor = new SqlCmdPreprocessor();
        const sql = ":r ./some/script.sql\nSELECT 1;";
        const result = preprocessor.process(sql);

        expect(result.text.startsWith(" ".repeat(20))).toBe(true);
        expect(result.text).toContain("SELECT 1;");
        expect(result.issues).toHaveLength(0);
        expect(result.mapOffset(25)).toBe(25);
    });

    test("expands $(Variables) and tracks offsets", () => {
        const preprocessor = new SqlCmdPreprocessor();
        const sql = "SELECT * FROM $(SchemaName).Users;";
        // $(SchemaName) is 13 chars. 'dbo' is 3 chars. Difference is -10.
        const result = preprocessor.process(sql, { initialVariables: { SchemaName: "dbo" } });

        expect(result.text).toBe("SELECT * FROM dbo.Users;");
        expect(result.issues).toHaveLength(0);

        // 'SELECT * FROM ' is 14 chars. (0-13)
        expect(result.mapOffset(0)).toBe(0);
        expect(result.mapOffset(14)).toBe(14);
        // 'dbo' ends at index 17 in preprocessed. In original, '$(SchemaName)' ends at 14 + 13 = 27.
        expect(result.mapOffset(17)).toBe(27);
    });

    test("emits diagnostic for undefined variable", () => {
        const preprocessor = new SqlCmdPreprocessor();
        const sql = "SELECT * FROM $(Missing);";
        const result = preprocessor.process(sql);

        expect(result.text).toBe("SELECT * FROM $(Missing);");
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0].code).toBe("SQLCMD_UNKNOWN_VAR");
        expect(result.mapOffset(14)).toBe(14);
    });

    test("handles files with both :r includes and $(Variables)", () => {
        const preprocessor = new SqlCmdPreprocessor();
        const sql = ":r setup.sql\nSELECT * FROM $(Table);";
        const result = preprocessor.process(sql, { initialVariables: { Table: "dbo.Users" } });

        expect(result.text.startsWith(" ".repeat(12))).toBe(true);
        expect(result.text).toContain("SELECT * FROM dbo.Users;");
        expect(result.issues.map((x) => x.code)).not.toContain("SQLCMD_UNRESOLVED_INCLUDE");

        const semiColonPrepIndex = result.text.indexOf(";");
        const semiColonOrigIndex = sql.indexOf(";");
        expect(result.mapOffset(semiColonPrepIndex)).toBe(semiColonOrigIndex);
    });

    test("does not warn about $(Variables) mentioned in a line comment", () => {
        const preprocessor = new SqlCmdPreprocessor();
        const sql = "-- uses $(Missing) for staging\nSELECT 1;";
        const result = preprocessor.process(sql);

        expect(result.issues).toHaveLength(0);
        expect(result.text).toBe(sql);
    });

    test("does not warn about $(Variables) mentioned in a block comment", () => {
        const preprocessor = new SqlCmdPreprocessor();
        const sql = "/* uses $(Missing) for staging */\nSELECT 1;";
        const result = preprocessor.process(sql);

        expect(result.issues).toHaveLength(0);
        expect(result.text).toBe(sql);
    });

    test("does not substitute $(Variables) mentioned in a comment even when defined", () => {
        const preprocessor = new SqlCmdPreprocessor();
        const sql = "-- $(SchemaName) is the target schema\nSELECT 1;";
        const result = preprocessor.process(sql, { initialVariables: { SchemaName: "dbo" } });

        expect(result.issues).toHaveLength(0);
        expect(result.text).toBe(sql);
    });

    test("still substitutes and warns for $(Variables) outside comments, even when a comment precedes them", () => {
        const preprocessor = new SqlCmdPreprocessor();
        const sql = "-- references $(Missing)\nSELECT * FROM $(SchemaName).Users, $(StillMissing);";
        const result = preprocessor.process(sql, { initialVariables: { SchemaName: "dbo" } });

        expect(result.text).toContain("SELECT * FROM dbo.Users, $(StillMissing);");
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0].code).toBe("SQLCMD_UNKNOWN_VAR");
        expect(result.issues[0].message).toContain("StillMissing");
    });

    test("still substitutes $(Variables) inside string literals (common sqlcmd usage)", () => {
        const preprocessor = new SqlCmdPreprocessor();
        const sql = "PRINT '$(Environment)';";
        const result = preprocessor.process(sql, { initialVariables: { Environment: "prod" } });

        expect(result.text).toBe("PRINT 'prod';");
        expect(result.issues).toHaveLength(0);
    });

    test("does not mistake comment markers inside a string literal for a real comment", () => {
        const preprocessor = new SqlCmdPreprocessor();
        const sql = "SELECT '--not a comment $(Missing)';";
        const result = preprocessor.process(sql);

        expect(result.issues).toHaveLength(1);
        expect(result.issues[0].code).toBe("SQLCMD_UNKNOWN_VAR");
    });
});
