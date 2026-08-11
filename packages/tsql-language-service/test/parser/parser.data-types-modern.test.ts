import { analyze, DiagnosticCode } from "../../src/parser/saral/index.js";
import { createStmt, parseBody, parseResult } from "./parser.helpers.js";

// Independently authored from SQL Server syntax plus SqlParser's DataTypeLookup, Vector, and
// SystemClrDataTypes behavior suites. No SqlParser source or baseline text is copied here.

describe("SQL Server data types", () => {
    test("accepts system types and ISO type synonyms without type diagnostics", () => {
        const sql = `
            DECLARE @name sysname;
            DECLARE @revision rowversion;
            DECLARE @amount dec(18, 2);
            DECLARE @whole integer;
            DECLARE @approx double precision;
            DECLARE @label national character varying(100);
            SELECT CAST(@name AS character varying(128));
        `;

        const result = analyze(sql);
        expect(
            result.semanticDiagnostics.filter(
                (item) => item.code === DiagnosticCode.InvalidDataType,
            ),
        ).toEqual([]);
    });

    test("preserves multiword aliases and typed XML schema specifications", () => {
        const result = parseResult(`
            CREATE TABLE dbo.TypedDocuments (
                Name national character varying(100) NOT NULL,
                Document xml(DOCUMENT dbo.InvoiceSchemaCollection) NULL
            );
        `);

        expect(result.issues).toEqual([]);
        const columns = (result.ast.body[0] as any).columns;
        expect(
            columns.find((column: any) => column.name.toLocaleLowerCase() === "name")?.dataType,
        ).toMatch(/^national character varying\(100\)$/i);
        expect(
            columns.find((column: any) => column.name.toLocaleLowerCase() === "document")?.dataType,
        ).toMatch(/^xml\(document dbo\.invoiceschemacollection\)$/i);
        expect(
            analyze(
                `CREATE TABLE dbo.T (Document xml(CONTENT dbo.InvoiceSchemaCollection));`,
            ).semanticDiagnostics.filter((item) => item.code === DiagnosticCode.InvalidDataType),
        ).toEqual([]);
    });

    test("allows CURSOR and TABLE only in their supported declaration contexts", () => {
        const valid = analyze(`
            DECLARE @cursor cursor;
            DECLARE @rows table (Id int NOT NULL);
            CREATE PROCEDURE dbo.AcceptCursor @cursor cursor VARYING OUTPUT AS SELECT 1;
            CREATE FUNCTION dbo.InlineRows() RETURNS TABLE AS RETURN SELECT 1 AS Id;
        `);
        expect(
            valid.semanticDiagnostics.filter(
                (item) => item.code === DiagnosticCode.InvalidDataType,
            ),
        ).toEqual([]);

        const invalid = analyze(`
            CREATE TABLE dbo.InvalidContexts (CursorColumn cursor, TableColumn table);
            CREATE PROCEDURE dbo.InvalidCursor @cursor cursor AS SELECT 1;
        `).semanticDiagnostics.filter((item) => item.code === DiagnosticCode.InvalidDataType);
        expect(
            invalid.some((item) =>
                /cursor data type is not valid in a column/iu.test(item.message),
            ),
        ).toBe(true);
        expect(
            invalid.some((item) => /table data type is not valid in a column/iu.test(item.message)),
        ).toBe(true);
        expect(invalid.some((item) => /cursor procedure parameter/iu.test(item.message))).toBe(
            true,
        );
    });

    test("parses alias, table, and CLR user-defined type declarations", () => {
        const body = parseBody(`
            CREATE TYPE dbo.PhoneNumber FROM nvarchar(24) NOT NULL;
            CREATE TYPE dbo.OrderLine AS TABLE (OrderId int NOT NULL, Quantity decimal(9, 2) NOT NULL);
            CREATE TYPE dbo.GeoPoint EXTERNAL NAME DemoAssembly.GeoPoint;
        `) as any[];

        expect(body).toHaveLength(3);
        expect(body[0]).toMatchObject({
            type: "CreateStatement",
            objectType: "TYPE",
            name: "dbo.PhoneNumber",
            nullable: false,
        });
        expect(body[0].baseType.replace(/\s/gu, "").toLocaleLowerCase()).toBe("nvarchar(24)");
        expect(body[1]).toMatchObject({
            objectType: "TYPE",
            name: "dbo.OrderLine",
            isTableType: true,
            columns: [
                expect.objectContaining({ name: "OrderId" }),
                expect.objectContaining({ name: "Quantity" }),
            ],
        });
        expect(
            body[1].columns.map((column: any) =>
                column.dataType.replace(/\s/gu, "").toLocaleLowerCase(),
            ),
        ).toEqual(["int", "decimal(9,2)"]);
        expect(body[2]).toMatchObject({
            objectType: "TYPE",
            name: "dbo.GeoPoint",
            isClrType: true,
            externalName: "DemoAssembly.GeoPoint",
        });
    });

    test("captures scalar and table-valued function return types", () => {
        const scalar = createStmt(
            "CREATE FUNCTION dbo.Scale(@value int) RETURNS decimal(10, 2) AS BEGIN RETURN @value; END;",
        ) as any;
        const tabular = createStmt(
            "CREATE FUNCTION dbo.Rows() RETURNS TABLE AS RETURN SELECT 1 AS Id;",
        ) as any;

        expect(scalar.returnType.replace(/\s/gu, "").toLocaleLowerCase()).toBe("decimal(10,2)");
        expect(tabular.returnType).toBe("TABLE");
    });

    test("validates type argument limits, vector float16 dimensions, and malformed typed XML", () => {
        const diagnostics = analyze(`
            DECLARE @long varchar(9001);
            DECLARE @numeric decimal(39, 0);
            DECLARE @scale numeric(4, 5);
            DECLARE @clock time(8);
            DECLARE @float float(54);
            DECLARE @tooLarge32 vector(1999, float32);
            DECLARE @tooLarge16 vector(3997, float16);
            DECLARE @invalidBase vector(16, float64);
            DECLARE @invalidXml xml(DOCUMENT 42);
        `).semanticDiagnostics.filter((item) => item.code === DiagnosticCode.InvalidDataType);

        expect(diagnostics).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ message: expect.stringContaining("varchar length") }),
                expect.objectContaining({ message: expect.stringContaining("decimal precision") }),
                expect.objectContaining({ message: expect.stringContaining("numeric scale") }),
                expect.objectContaining({ message: expect.stringContaining("time scale") }),
                expect.objectContaining({ message: expect.stringContaining("float precision") }),
                expect.objectContaining({
                    message: expect.stringContaining("vector dimensions for float32"),
                }),
                expect.objectContaining({
                    message: expect.stringContaining("vector dimensions for float16"),
                }),
                expect.objectContaining({ message: expect.stringContaining("vector base type") }),
                expect.objectContaining({ message: expect.stringContaining("xml type arguments") }),
            ]),
        );
    });
});
