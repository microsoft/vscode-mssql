import { parseBody, declareStmt, expectSql } from "./parser.helpers";

import { type DeclareNode } from "../../src/parser/saral/ast/types.js";

function declareAt(sql: string, index: number): DeclareNode {
    return parseBody(sql)[index] as DeclareNode;
}

describe("T-SQL Parser - DECLARE", () => {
    test("single variable declaration", () => {
        const stmt = declareStmt(`
            DECLARE @Id INT
        `);

        expect(stmt.type).toBe("DeclareStatement");

        expect(stmt.variables).toHaveLength(1);

        expect(stmt.variables[0].name).toBe("@Id");

        expect(stmt.variables[0].dataType).toBe("INT");
    });

    test("multiple variable declarations", () => {
        const stmt = declareStmt(`
            DECLARE
                @Id INT,
                @Name VARCHAR(100)
        `);

        expect(stmt.variables).toHaveLength(2);

        expect(stmt.variables[0].name).toBe("@Id");

        expect(stmt.variables[1].name).toBe("@Name");

        expect(stmt.variables[1].dataType).toBe("VARCHAR(100)");
    });

    test("variable with initial value", () => {
        const stmt = declareStmt(`
            DECLARE @Id INT = 10
        `);

        expectSql(stmt.variables[0].initialValue, "10");
    });

    test("string initial value", () => {
        const stmt = declareStmt(`
            DECLARE @Name VARCHAR(50) = 'John'
        `);

        expectSql(stmt.variables[0].initialValue, `'John'`);
    });

    test("expression initial value", () => {
        const stmt = declareStmt(`
            DECLARE @Total INT = 1 + 2
        `);

        expectSql(stmt.variables[0].initialValue, "1 + 2");
    });

    test("DECLARE with function call initializer", () => {
        const stmt = declareStmt(`
            DECLARE @Now DATETIME = GETDATE()
        `);

        expectSql(stmt.variables[0].initialValue, "GETDATE()");
    });

    test("DECLARE with CAST initializer", () => {
        const stmt = declareStmt(`
        DECLARE @X INT = CAST(1 AS INT)
    `);

        const initialValue = stmt.variables[0].initialValue;

        expect(initialValue).toBeDefined();

        expect(initialValue!.type).toBe("CastExpression");
    });

    test("table variable declaration", () => {
        const stmt = declareStmt(`
            DECLARE @Users TABLE (
                Id INT,
                Name VARCHAR(100)
            )
        `);

        expect(stmt.variables).toHaveLength(1);

        expect(stmt.variables[0].name).toBe("@Users");

        expect(stmt.variables[0].dataType).toBe("TABLE");

        expect(stmt.variables[0].columns).toHaveLength(2);
    });

    test("table variable with PRIMARY KEY", () => {
        const stmt = declareStmt(`
            DECLARE @Users TABLE (
                Id INT PRIMARY KEY,
                Name VARCHAR(100)
            )
        `);

        const cols = stmt.variables[0].columns!;

        expect(cols[0].constraints).toHaveLength(1);

        expect(cols[0].constraints![0].kind).toBe("PRIMARY KEY");
    });

    test("table variable with named constraint", () => {
        const stmt = declareStmt(`
            DECLARE @Users TABLE (
                Id INT,
                CONSTRAINT PK_Users
                    PRIMARY KEY (Id)
            )
        `);

        expect(stmt.variables[0].constraints).toHaveLength(1);

        expect(stmt.variables[0].constraints![0].name).toBe("PK_Users");

        expect(stmt.variables[0].constraints![0].kind).toBe("PRIMARY KEY");
    });

    test("DECLARE with NOT NULL column", () => {
        const stmt = declareStmt(`
            DECLARE @T TABLE (
                Id INT NOT NULL
            )
        `);

        const col = stmt.variables[0].columns![0];

        expect(col.constraints![0].kind).toBe("NOT NULL");
    });

    test("DECLARE with DEFAULT constraint", () => {
        const stmt = declareStmt(`
            DECLARE @T TABLE (
                CreatedAt DATETIME
                    DEFAULT GETDATE()
            )
        `);

        const col = stmt.variables[0].columns![0];

        expect(col.constraints![0].kind).toBe("DEFAULT");
    });

    test("DECLARE with composite PRIMARY KEY", () => {
        const stmt = declareStmt(`
            DECLARE @T TABLE (
                A INT,
                B INT,
                PRIMARY KEY (A, B)
            )
        `);

        const constraints = stmt.variables[0].constraints!;

        expect(constraints).toHaveLength(1);

        expect(constraints[0].columns).toEqual(["A", "B"]);
    });

    test("multiple DECLARE statements without semicolon", () => {
        const sql = `
            DECLARE @Id INT
            DECLARE @Id2 INT
        `;

        const body = parseBody(sql);

        expect(body).toHaveLength(2);

        const first = declareAt(sql, 0);

        const second = declareAt(sql, 1);

        expect(first.type).toBe("DeclareStatement");

        expect(second.type).toBe("DeclareStatement");

        expect(first.variables[0].name).toBe("@Id");

        expect(second.variables[0].name).toBe("@Id2");

        expect(first.incomplete).toBeUndefined();

        expect(second.incomplete).toBeUndefined();
    });

    test("multiple DECLARE statements with semicolon", () => {
        const sql = `
            DECLARE @Id INT;
            DECLARE @Id2 INT;
        `;

        const body = parseBody(sql);

        expect(body).toHaveLength(2);

        const first = declareAt(sql, 0);

        const second = declareAt(sql, 1);

        expect(first.type).toBe("DeclareStatement");

        expect(second.type).toBe("DeclareStatement");
    });

    test("recover missing datatype", () => {
        const stmt = declareStmt(`
            DECLARE @Id
        `);

        expect(stmt.incomplete).toBe(true);
    });

    test("recover broken initializer", () => {
        const stmt = declareStmt(`
            DECLARE @Id INT =
        `);

        expect(stmt.incomplete).toBe(true);
    });

    test("recover broken TABLE declaration", () => {
        const stmt = declareStmt(`
            DECLARE @T TABLE (
        `);

        expect(stmt.incomplete).toBe(true);
    });

    test("continues after broken DECLARE", () => {
        const body = parseBody(`
            DECLARE @Id INT =
            SELECT 1
        `);

        expect(body.length).toBeGreaterThanOrEqual(2);

        expect(body[0].type).toBe("DeclareStatement");

        expect(body[1].type).toBe("SelectStatement");
    });

    test("DECLARE with AS datatype", () => {
        const stmt = declareStmt(`
        DECLARE @Id AS INT
    `);

        expect(stmt.type).toBe("DeclareStatement");

        expect(stmt.variables).toHaveLength(1);

        expect(stmt.variables[0].name).toBe("@Id");

        expect(stmt.variables[0].dataType).toBe("INT");

        expect(stmt.incomplete).toBeUndefined();
    });

    test("DECLARE with AS datatype and initializer", () => {
        const stmt = declareStmt(`
        DECLARE @Id AS INT = 1
    `);

        expect(stmt.variables[0].dataType).toBe("INT");

        expectSql(stmt.variables[0].initialValue, "1");

        expect(stmt.incomplete).toBeUndefined();
    });

    test("multiple DECLARE variables with AS", () => {
        const stmt = declareStmt(`
        DECLARE
            @Id AS INT,
            @Name AS VARCHAR(50)
    `);

        expect(stmt.variables).toHaveLength(2);

        expect(stmt.variables[0].dataType).toBe("INT");

        expect(stmt.variables[1].dataType).toBe("VARCHAR(50)");
    });

    test("DECLARE TABLE variable with AS", () => {
        const stmt = declareStmt(`
        DECLARE @Users AS TABLE (
            Id INT,
            Name VARCHAR(50)
        )
    `);

        expect(stmt.variables).toHaveLength(1);

        expect(stmt.variables[0].dataType).toBe("TABLE");

        expect(stmt.variables[0].columns).toHaveLength(2);

        expect(stmt.incomplete).toBeUndefined();
    });

    test("DECLARE AS does not poison next statement", () => {
        const body = parseBody(`
        DECLARE @Id AS INT

        SELECT 1
    `);

        expect(body.length).toBeGreaterThanOrEqual(2);

        expect(body[0].type).toBe("DeclareStatement");

        expect(body[1].type).toBe("SelectStatement");
    });

    test("DECLARE AS initializer does not poison next statement", () => {
        const body = parseBody(`
        DECLARE @Id AS INT = 1

        SELECT 1
    `);

        expect(body.length).toBeGreaterThanOrEqual(2);

        expect(body[0].type).toBe("DeclareStatement");

        expect(body[1].type).toBe("SelectStatement");
    });

    test("should handle DECLARE with assignment", () => {
        const stmt = declareStmt(`DECLARE @ID INT = 10`);
        expect(stmt.variables[0].name).toBe("@ID");
        expectSql(stmt.variables[0].initialValue, "10");
    });
});
