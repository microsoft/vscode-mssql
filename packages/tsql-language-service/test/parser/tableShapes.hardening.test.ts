import { analyze, Lexer, Parser } from "../../src/parser/saral/index.js";
import { diagnose, DiagnosticCode } from "../../src/parser/saral/diagnostics/diagnostics.js";
import { LineageBuilder } from "../../src/parser/saral/lineage/lineageBuilder.js";
import { ScopeBuilder } from "../../src/parser/saral/semantic/scopeBuilder.js";
import { SymbolKind } from "../../src/parser/saral/semantic/scope.js";

function parseAst(sql: string) {
    return new Parser(new Lexer(sql)).parse().ast;
}

function buildScope(sql: string) {
    return new ScopeBuilder().build(parseAst(sql));
}

function semanticDiagnostics(sql: string) {
    const ast = parseAst(sql);
    const scope = new ScopeBuilder().build(ast);
    return diagnose(ast, scope);
}

function lineageEdges(sql: string): string[] {
    return new LineageBuilder()
        .build(parseAst(sql))
        .edges.map((edge) => `${edge.from.name} -> ${edge.to.name}`)
        .sort();
}

describe("TVP and table variable hardening", () => {
    test("TVP usage in FROM marks parameter as used and raises no unused-parameter diagnostic", () => {
        const sql = `
            CREATE PROCEDURE dbo.Proc1
                @Items dbo.ItemType READONLY
            AS
            BEGIN
                SELECT i.Id
                FROM @Items i
                WHERE i.Id > 0;
            END
        `;

        const scope = buildScope(sql);
        const procScope = scope.root.getChildren().find((x) => x.name === "dbo.Proc1");
        const param = procScope?.resolveLocal("@Items");
        const diagnostics = semanticDiagnostics(sql).filter(
            (d) => d.code === DiagnosticCode.UnusedParameter,
        );

        expect(param?.kind).toBe(SymbolKind.Parameter);
        expect(param?.references.length).toBeGreaterThan(0);
        expect(diagnostics).toHaveLength(0);
    });

    test("TVP alias produces lineage for qualified column reference", () => {
        const sql = `
            CREATE PROCEDURE dbo.Proc1
                @Items dbo.ItemType READONLY
            AS
            BEGIN
                SELECT i.Id
                FROM @Items i;
            END
        `;

        expect(lineageEdges(sql)).toEqual(["@Items.Id -> Id"]);
    });

    test("declared table variable keeps table metadata in scope", () => {
        const sql = `
            DECLARE @T TABLE(
                Id INT,
                Name VARCHAR(50)
            );

            SELECT *
            FROM @T;
        `;

        const scope = buildScope(sql);
        const sym = scope.root.resolve("@T");

        expect(sym?.kind).toBe(SymbolKind.Table);
        expect(sym?.columns).toEqual(["Id", "Name"]);
        expect(sym?.localColumns?.map((c) => c.rawName)).toEqual(["Id", "Name"]);
        expect(sym?.localColumns?.map((c) => c.dataType)).toEqual(["INT", "VARCHAR(50)"]);
    });

    test("table variable select produces lineage for qualified column reference", () => {
        const sql = `
            DECLARE @T TABLE(
                Id INT,
                Name VARCHAR(50)
            );

            SELECT t.Id
            FROM @T t;
        `;

        expect(lineageEdges(sql)).toEqual(["@T.Id -> Id"]);
    });

    test("table variable insert-select maps lineage into table variable target", () => {
        const sql = `
            DECLARE @T TABLE(
                Id INT
            );

            INSERT INTO @T (Id)
            SELECT u.Id
            FROM Users u;
        `;

        expect(lineageEdges(sql)).toEqual(["Users.Id -> @T.Id"]);
    });

    test("TVP wildcard insert into named table variable emits wildcard lineage", () => {
        const sql = `
            CREATE PROCEDURE dbo.Proc1
                @InputRows dbo.GenericRowSet READONLY
            AS
            BEGIN
                DECLARE @RowsToProcess dbo.GenericRowSet;

                INSERT INTO @RowsToProcess
                SELECT *
                FROM @InputRows;
            END
        `;

        expect(lineageEdges(sql)).toEqual(["@InputRows.* -> @RowsToProcess.*"]);
    });

    test("table variable update-from maps lineage into table variable target column", () => {
        const sql = `
            DECLARE @T TABLE(
                Id INT,
                Name VARCHAR(50)
            );

            UPDATE t
            SET Name = u.Name
            FROM @T t
            JOIN Users u ON u.Id = t.Id;
        `;

        expect(lineageEdges(sql)).toEqual(["Users.Name -> t.Name"]);
    });

    test("analyze stays clean for typical TVP and table variable script", () => {
        const result = analyze(`
            CREATE PROCEDURE dbo.Proc1
                @Items dbo.ItemType READONLY
            AS
            BEGIN
                DECLARE @T TABLE(Id INT, Name VARCHAR(50));

                INSERT INTO @T (Id, Name)
                SELECT i.Id, i.Name
                FROM @Items i;

                SELECT t.Name
                FROM @T t;
            END
        `);

        expect(result.issues).toHaveLength(0);
        expect(result.semanticDiagnostics).toHaveLength(0);
    });
});
