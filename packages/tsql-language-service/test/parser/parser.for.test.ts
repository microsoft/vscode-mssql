import { parseOne } from "./parser.helpers";

describe("T-SQL Parser - FOR JSON / FOR XML", () => {
    test("FOR JSON AUTO", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            FOR JSON AUTO
        `);

        expect(stmt.type).toBe("SelectStatement");

        expect(stmt.forClause).toBeDefined();

        expect(stmt.forClause.mode).toBe("JSON");

        expect(stmt.forClause.directive).toBe("AUTO");

        expect(stmt.forClause.options).toBeUndefined();
    });

    test("FOR JSON PATH", () => {
        const stmt = parseOne<any>(`
            SELECT Id, Name
            FROM Users
            FOR JSON PATH
        `);

        expect(stmt.forClause.mode).toBe("JSON");

        expect(stmt.forClause.directive).toBe("PATH");

        expect(stmt.forClause.options).toBeUndefined();
    });

    test("FOR JSON PATH with ROOT option", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            FOR JSON PATH,
                ROOT('Users')
        `);

        expect(stmt.forClause.mode).toBe("JSON");

        expect(stmt.forClause.directive).toBe("PATH");

        expect(stmt.forClause.options).toEqual([
            {
                kind: "ROOT",
                value: "'Users'",
            },
        ]);
    });

    test("FOR JSON with multiple options", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            FOR JSON PATH,
                ROOT('Users'),
                INCLUDE_NULL_VALUES
        `);

        expect(stmt.forClause.options).toEqual([
            {
                kind: "ROOT",
                value: "'Users'",
            },
            {
                kind: "INCLUDE_NULL_VALUES",
            },
        ]);
    });

    test("FOR XML AUTO", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            FOR XML AUTO
        `);

        expect(stmt.forClause.mode).toBe("XML");

        expect(stmt.forClause.directive).toBe("AUTO");
    });

    // ─────────────────────────────────────────────────────────
    // PATH argument
    // ─────────────────────────────────────────────────────────

    test("FOR XML PATH — no argument", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            FOR XML PATH
        `);

        expect(stmt.forClause.mode).toBe("XML");

        expect(stmt.forClause.directive).toBe("PATH");

        expect(stmt.forClause.options).toBeUndefined();
    });

    test("FOR XML PATH with element argument", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            FOR XML PATH('User')
        `);

        expect(stmt.forClause.mode).toBe("XML");

        expect(stmt.forClause.directive).toBe("PATH");

        expect(stmt.forClause.argument).toBe("'User'");

        expect(stmt.forClause.options).toBeUndefined();
    });

    test("FOR XML PATH with empty argument", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            FOR XML PATH('')
        `);

        expect(stmt.forClause.directive).toBe("PATH");

        expect(stmt.forClause.argument).toBe("''");

        expect(stmt.forClause.options).toBeUndefined();
    });

    test("FOR XML RAW with element argument", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            FOR XML RAW('row')
        `);

        expect(stmt.forClause.directive).toBe("RAW");

        expect(stmt.forClause.argument).toBe("'row'");
    });

    test("FOR XML PATH with argument and TYPE option", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            FOR XML PATH('User'),
                TYPE
        `);

        expect(stmt.forClause.mode).toBe("XML");

        expect(stmt.forClause.directive).toBe("PATH");

        expect(stmt.forClause.argument).toBe("'User'");

        expect(stmt.forClause.options).toEqual([
            {
                kind: "TYPE",
            },
        ]);
    });

    test("FOR XML PATH with argument and multiple options", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            FOR XML PATH('User'),
                TYPE,
                ELEMENTS
        `);

        expect(stmt.forClause.directive).toBe("PATH");

        expect(stmt.forClause.argument).toBe("'User'");

        expect(stmt.forClause.options).toEqual([
            {
                kind: "TYPE",
            },
            {
                kind: "ELEMENTS",
            },
        ]);
    });

    // ─────────────────────────────────────────────────────────
    // Clause ordering
    // ─────────────────────────────────────────────────────────

    test("FOR clause after ORDER BY", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            ORDER BY Id
            FOR JSON AUTO
        `);

        expect(stmt.orderBy).toBeDefined();

        expect(stmt.forClause).toBeDefined();

        expect(stmt.forClause.mode).toBe("JSON");
    });

    test("FOR clause after OFFSET FETCH", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            ORDER BY Id
            OFFSET 10 ROWS
            FETCH NEXT 5 ROWS ONLY
            FOR JSON PATH
        `);

        expect(stmt.offset).toBeDefined();

        expect(stmt.fetch).toBeDefined();

        expect(stmt.forClause.mode).toBe("JSON");

        expect(stmt.forClause.directive).toBe("PATH");

        expect(stmt.forClause.options).toBeUndefined();
    });

    // ─────────────────────────────────────────────────────────
    // Recoverability
    // ─────────────────────────────────────────────────────────

    test("invalid FOR recovers", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            FOR BADTOKEN
        `);

        expect(stmt.type).toBe("SelectStatement");

        expect(stmt.incomplete).toBe(true);
    });

    test("missing directive recovers", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            FOR JSON
        `);

        expect(stmt.type).toBe("SelectStatement");

        expect(stmt.incomplete).toBe(true);
    });
});
