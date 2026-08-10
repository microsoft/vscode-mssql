import { parseOne, expectSql } from "./parser.helpers";

describe("T-SQL Parser - Procedure Parameters", () => {
    test("should parse simple parameter", () => {
        const stmt = parseOne<any>(`
            CREATE PROC Test
                @Id INT
            AS
            SELECT 1
        `);

        const p = stmt.parameters[0];

        expect(p.name).toBe("@Id");
        expect(p.dataType).toBe("INT");
    });

    test("should parse default literal", () => {
        const stmt = parseOne<any>(`
            CREATE PROC Test
                @Id INT = 0
            AS
            SELECT 1
        `);

        const p = stmt.parameters[0];

        expect(p.name).toBe("@Id");
        expectSql(p.defaultValue, "0");
    });

    test("should parse default string", () => {
        const stmt = parseOne<any>(`
            CREATE PROC Test
                @Role VARCHAR(50) = 'Inventor'
            AS
            SELECT 1
        `);

        const p = stmt.parameters[0];

        expect(p.dataType).toBe("VARCHAR(50)");
        expectSql(p.defaultValue, `'Inventor'`);
    });

    test("should parse default NULL", () => {
        const stmt = parseOne<any>(`
            CREATE PROC Test
                @Name NVARCHAR(MAX) = NULL
            AS
            SELECT 1
        `);

        const p = stmt.parameters[0];

        expect(p.dataType).toBe("NVARCHAR(MAX)");
        expect(p.defaultValue.type).toBe("Literal");
        expect(p.defaultValue.value).toBeNull();
    });

    test("should parse OUTPUT", () => {
        const stmt = parseOne<any>(`
            CREATE PROC Test
                @Value INT OUTPUT
            AS
            SELECT 1
        `);

        expect(stmt.parameters[0].isOutput).toBe(true);
    });

    test("should parse READONLY", () => {
        const stmt = parseOne<any>(`
            CREATE PROC Test
                @Items dbo.TransportRequestsType READONLY
            AS
            SELECT 1
        `);

        const p = stmt.parameters[0];

        expect(p.dataType).toBe("dbo.TransportRequestsType");

        expect(p.isReadOnly).toBe(true);
    });

    test("should parse default + OUTPUT", () => {
        const stmt = parseOne<any>(`
            CREATE PROC Test
                @Value INT = 0 OUTPUT
            AS
            SELECT 1
        `);

        const p = stmt.parameters[0];

        expectSql(p.defaultValue, "0");
        expect(p.isOutput).toBe(true);
    });

    test("should parse multiple parameters", () => {
        const stmt = parseOne<any>(`
            CREATE PROC Test
                @Id INT,
                @Role VARCHAR(50) = 'Inventor',
                @Items dbo.TransportRequestsType READONLY
            AS
            SELECT 1
        `);

        expect(stmt.parameters).toHaveLength(3);
    });

    test("broken parameter list still recovers to AS body", () => {
        const stmt = parseOne<any>(`
            CREATE PROC Test
                @Id INT,
                @Bad INT = )
            AS
            SELECT 1
        `);

        expect(stmt.type).toBe("CreateStatement");
        expect(stmt.parameters).toHaveLength(1);
        expect(stmt.body[1].type).toBe("SelectStatement");
    });
});
