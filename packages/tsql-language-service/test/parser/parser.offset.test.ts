import { parseOne, expectSql } from "./parser.helpers";

describe("T-SQL Parser - OFFSET / FETCH", () => {
    test("should parse OFFSET only", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            ORDER BY Id
            OFFSET 10 ROWS
        `);

        expect(stmt.type).toBe("SelectStatement");
        expect(stmt.offset).toBeDefined();
        expectSql(stmt.offset, "10");
        expect(stmt.fetch).toBeUndefined();
    });

    test("should parse OFFSET ROW singular", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            ORDER BY Id
            OFFSET 1 ROW
        `);

        expect(stmt.offset).toBeDefined();
        expectSql(stmt.offset, "1");
    });

    test("should parse OFFSET variable", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            ORDER BY Id
            OFFSET @Skip ROWS
        `);

        expect(stmt.offset.type).toBe("Variable");
        expect(stmt.offset.name).toBe("@Skip");
    });

    test("should parse OFFSET arithmetic expression", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            ORDER BY Id
            OFFSET @Page * 10 ROWS
        `);

        expect(stmt.offset).toBeDefined();
        expectSql(stmt.offset, "@Page * 10");
    });

    test("should parse OFFSET + FETCH NEXT", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            ORDER BY Id
            OFFSET 10 ROWS
            FETCH NEXT 20 ROWS ONLY
        `);

        expectSql(stmt.offset, "10");
        expectSql(stmt.fetch, "20");
    });

    test("should parse OFFSET + FETCH FIRST", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            ORDER BY Id
            OFFSET 0 ROWS
            FETCH FIRST 5 ROWS ONLY
        `);

        expectSql(stmt.offset, "0");
        expectSql(stmt.fetch, "5");
    });

    test("should parse FETCH variable", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            ORDER BY Id
            OFFSET 0 ROWS
            FETCH NEXT @Take ROWS ONLY
        `);

        expect(stmt.fetch.type).toBe("Variable");
        expect(stmt.fetch.name).toBe("@Take");
    });

    test("should parse FETCH arithmetic expression", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            ORDER BY Id
            OFFSET 0 ROWS
            FETCH NEXT @PageSize * 2 ROWS ONLY
        `);

        expectSql(stmt.fetch, "@PageSize * 2");
    });

    test("should parse OFFSET with complex ORDER BY", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            ORDER BY Name DESC, Id ASC
            OFFSET 10 ROWS
            FETCH NEXT 20 ROWS ONLY
        `);

        expect(stmt.orderBy).toHaveLength(2);
        expectSql(stmt.offset, "10");
        expectSql(stmt.fetch, "20");
    });

    test("should recover missing ROWS after OFFSET", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            ORDER BY Id
            OFFSET 10
        `);

        expect(stmt.type).toBe("SelectStatement");
        expect(stmt.incomplete).toBe(true);
        expectSql(stmt.offset, "10");
    });

    test("should recover missing NEXT/FIRST", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            ORDER BY Id
            OFFSET 0 ROWS
            FETCH 10 ROWS ONLY
        `);

        expect(stmt.type).toBe("SelectStatement");
        expect(stmt.incomplete).toBe(true);
    });

    test("should recover missing ONLY", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            ORDER BY Id
            OFFSET 0 ROWS
            FETCH NEXT 10 ROWS
        `);

        expect(stmt.type).toBe("SelectStatement");
        expect(stmt.incomplete).toBe(true);
        expectSql(stmt.fetch, "10");
    });

    test("should recover missing FETCH ROWS keyword", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            ORDER BY Id
            OFFSET 0 ROWS
            FETCH NEXT 10 ONLY
        `);

        expect(stmt.type).toBe("SelectStatement");
        expect(stmt.incomplete).toBe(true);
        expectSql(stmt.fetch, "10");
    });

    test("should parse ORDER BY without OFFSET unchanged", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users
            ORDER BY Id DESC
        `);

        expect(stmt.orderBy).toHaveLength(1);
        expect(stmt.offset).toBeUndefined();
        expect(stmt.fetch).toBeUndefined();
    });
});
