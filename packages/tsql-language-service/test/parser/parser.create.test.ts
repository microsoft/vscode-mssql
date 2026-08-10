import { Lexer } from "../../src/parser/saral/parser/lexer.js";
import { Parser } from "../../src/parser/saral/parser/parser.js";
import { type CreateNode, type CreateIndexNode } from "../../src/parser/saral/ast/types.js";

describe("T-SQL Parser - CREATE TABLE / VIEW / PROCEDURE / FUNCTION / TRIGGER", () => {
    const parse = (sql: string) => {
        const lexer = new Lexer(sql);
        const parser = new Parser(lexer);
        return parser.parse().ast;
    };

    test("should handle CREATE TABLE", () => {
        const sql = `CREATE TABLE T (ID INT PRIMARY KEY)`;
        const node = parse(sql).body[0] as CreateNode;
        expect(node.objectType).toBe("TABLE");
        expect(node.name).toBe("T");
        expect(node.nameNode).toMatchObject({
            type: "Identifier",
            name: "T",
            start: sql.indexOf("T ("),
            end: sql.indexOf("T (") + 1,
        });
    });

    test("should parse CREATE TABLE columns with keyword-shaped identifiers", () => {
        const sql = `
            CREATE TABLE dbo.OrgLkp
            (
                Id INT,
                OffSet VARCHAR(50)
            )
        `;

        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0] as any;

        expect(result.issues).toEqual([]);
        expect(stmt.type).toBe("CreateStatement");
        expect(stmt.columns?.map((col: any) => col.name)).toEqual(["Id", "OFFSET"]);
    });

    test("should handle CREATE VIEW and PROC", () => {
        const sqlV = `CREATE VIEW V AS SELECT 1`;
        const sqlP = `CREATE PROC P AS SELECT 1`;
        expect((parse(sqlV).body[0] as CreateNode).objectType).toBe("VIEW");
        expect((parse(sqlP).body[0] as CreateNode).objectType).toBe("PROCEDURE");
    });

    test("should handle CREATE LOGIN", () => {
        const sql = `
            CREATE LOGIN ReportingUser
            WITH PASSWORD = 'StrongPassword!42',
                 CHECK_POLICY = OFF,
                 DEFAULT_DATABASE = ReportingDb
        `;

        const node = parse(sql).body[0] as CreateNode;

        expect(node.objectType).toBe("LOGIN");
        expect(node.name).toBe("ReportingUser");
    });

    test("should handle CREATE USER", () => {
        const sql = `
            CREATE USER ReportingUser
            FOR LOGIN ReportingLogin
            WITH DEFAULT_SCHEMA = dbo
        `;

        const node = parse(sql).body[0] as CreateNode;

        expect(node.objectType).toBe("USER");
        expect(node.name).toBe("ReportingUser");
    });

    test("should parse indexed view definition and index creation batch", () => {
        const sql = `
            CREATE VIEW dbo.SalesByCustomer
            WITH SCHEMABINDING
            AS
            SELECT salesRow.CustomerId,
                   COUNT_BIG(*) AS OrderCount
            FROM dbo.Sales salesRow
            GROUP BY salesRow.CustomerId;
            GO
            CREATE UNIQUE CLUSTERED INDEX IX_SalesByCustomer
            ON dbo.SalesByCustomer (CustomerId);
        `;

        const ast = parse(sql);
        const statements = ast.body.filter((stmt) => stmt.type !== "BatchSeparatorStatement");
        const viewStmt = statements[0] as CreateNode;
        const indexStmt = statements[1] as CreateIndexNode;

        expect(viewStmt.objectType).toBe("VIEW");
        expect(indexStmt.type).toBe("CreateIndexStatement");
        expect(indexStmt.unique).toBe(true);
        expect(indexStmt.clustered).toBe("CLUSTERED");
        expect(indexStmt.table.name).toBe("dbo.SalesByCustomer");
    });

    test("should parse procedure WITH EXECUTE AS OWNER before AS", () => {
        const sql = `
            CREATE PROCEDURE dbo.Foo
                @p INT
            WITH EXECUTE AS OWNER
            AS
            BEGIN
                SELECT @p;
            END
        `;

        const result = new Parser(new Lexer(sql)).parse();

        expect(result.issues).toEqual([]);
    });

    test("should parse view WITH SCHEMABINDING before AS", () => {
        const sql = `
            CREATE VIEW dbo.ActiveUsers
            WITH SCHEMABINDING
            AS
            SELECT Id
            FROM dbo.Users
        `;

        const result = new Parser(new Lexer(sql)).parse();

        expect(result.issues).toEqual([]);
    });

    test("should parse view body starting with CTE", () => {
        const sql = `
            CREATE VIEW dbo.ActiveUsers
            AS
            WITH RecentUsers AS (
                SELECT Id
                FROM dbo.Users
            )
            SELECT Id
            FROM RecentUsers
        `;

        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0] as CreateNode;

        expect(result.issues).toEqual([]);
        expect(stmt.objectType).toBe("VIEW");
        expect((stmt.body as any).type).toBe("WithStatement");
    });

    test("should parse parenthesized view body", () => {
        const sql = `
            CREATE VIEW [dbo].[SomeView]
            AS
            (
                SELECT st.Name, sot.Description
                FROM dbo.SomeTable st
                     JOIN dbo.SomeOtherTable sot ON sot.Id = st.Id
            );
        `;

        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0] as CreateNode;

        expect(result.issues).toEqual([]);
        expect(stmt.objectType).toBe("VIEW");
        expect((stmt.body as any).type).toBe("SelectStatement");
    });

    test("should parse parenthesized standalone select inside procedure body", () => {
        const sql = `
            CREATE PROCEDURE [dbo].[PROC_ATS_GetProductNotifications_2012I1]
            (
                  @ResultCount INT,
                  @RegionId INT
            )
            AS
            BEGIN
                IF(@ResultCount>0)SET ROWCOUNT @ResultCount
                (
                    (
                        SELECT
                            TOP 1 CreationDate, Info, NotificationType
                        FROM PRODUCT productRow WITH (NOLOCK)
                        INNER JOIN ProductCatalog catalogRow WITH (NOLOCK)
                            ON productRow.ID = catalogRow.ProductID
                        INNER JOIN ProductCountry countryRow
                            ON (
                                countryRow.ProductId = productRow.Id
                                AND catalogRow.CatalogID = @RegionId
                            )
                        INNER JOIN ProductNotification notificationRow
                            ON (countryRow.Id = notificationRow.ProductCountryId)
                    )
                )
                ORDER BY CreationDate DESC
            END
        `;

        const result = new Parser(new Lexer(sql)).parse();

        expect(result.issues).toEqual([]);
    });

    test("should parse scalar function RETURNS clause before AS", () => {
        const sql = `
            CREATE FUNCTION dbo.GetFlag(@Id INT)
            RETURNS INT
            AS
            BEGIN
                RETURN @Id;
            END
        `;

        const result = new Parser(new Lexer(sql)).parse();

        expect(result.issues).toEqual([]);
    });

    test("should parse inline table function RETURN with CTE query body", () => {
        const sql = `
            CREATE FUNCTION dbo.fnInline()
            RETURNS TABLE
            AS
            RETURN (
                WITH cteX AS (
                    SELECT 1 AS Id
                )
                SELECT Id
                FROM cteX
            )
        `;

        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0];

        expect(result.issues).toEqual([]);
        expect(stmt.type).toBe("CreateStatement");
        if (stmt.type !== "CreateStatement") {
            throw new Error("Expected CreateStatement");
        }

        const ret = (stmt.body as any[]).find((x) => x.type === "ReturnStatement");
        expect(ret).toBeDefined();
        expect(ret.query?.type).toBe("WithStatement");
    });

    test("should parse multi-statement TVF and capture returnVariable and returnColumns", () => {
        const sql = `
            CREATE FUNCTION dbo.GetEmployees(@DeptId INT)
            RETURNS @result TABLE (Id INT, Name VARCHAR(50))
            AS
            BEGIN
                INSERT INTO @result SELECT Id, Name FROM Employee WHERE DeptId = @DeptId;
                RETURN;
            END
        `;

        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0] as CreateNode;

        expect(result.issues).toEqual([]);
        expect(stmt.objectType).toBe("FUNCTION");
        expect(stmt.returnVariable).toBe("@result");
        expect(stmt.returnColumns).toHaveLength(2);
        expect(stmt.returnColumns![0].name).toBe("Id");
        expect(stmt.returnColumns![1].name).toBe("Name");
    });

    test("scalar RETURNS does not set returnVariable", () => {
        const sql = `
            CREATE FUNCTION dbo.GetFlag(@Id INT)
            RETURNS INT
            AS
            BEGIN
                RETURN @Id;
            END
        `;

        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0] as CreateNode;

        expect(result.issues).toEqual([]);
        expect(stmt.returnVariable).toBeUndefined();
        expect(stmt.returnColumns).toBeUndefined();
    });

    test("inline TVF RETURNS TABLE does not set returnVariable", () => {
        const sql = `
            CREATE FUNCTION dbo.fnInline(@Id INT)
            RETURNS TABLE
            AS
            RETURN (SELECT Id, Name FROM Employee WHERE Id = @Id)
        `;

        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0] as CreateNode;

        expect(result.issues).toEqual([]);
        expect(stmt.returnVariable).toBeUndefined();
    });

    test("should parse trigger and retain body after header clauses", () => {
        const sql = `
            CREATE TRIGGER dbo.trgUsersAudit
            ON dbo.Users
            AFTER INSERT
            AS
            BEGIN
                PRINT 'audit';
            END
        `;

        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0];

        expect(result.issues).toEqual([]);
        expect(stmt.type).toBe("CreateStatement");

        if (stmt.type !== "CreateStatement") {
            throw new Error("Expected CreateStatement");
        }

        expect(stmt.objectType).toBe("TRIGGER");
    });

    test("should parse procedure TVP parameter with optional AS", () => {
        const sql = `
            CREATE PROCEDURE dbo.ProcessItems
                @ItemIds AS [dbo].[IdType] READONLY,
                @ChangedBy VARCHAR(255)
            AS
            BEGIN
                DECLARE @AuditItems [dbo].[AuditType];
            END
        `;

        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0] as CreateNode;

        expect(result.issues).toHaveLength(0);
        expect(stmt.type).toBe("CreateStatement");
        expect(stmt.parameters).toHaveLength(2);
        expect(stmt.parameters?.[0].dataType).toBe("[dbo].[IdType]");
        expect(stmt.parameters?.[0].isReadOnly).toBe(true);
    });
});

describe("CREATE PROCEDURE / FUNCTION / TRIGGER — body must stop at BEGIN...END", () => {
    test("a statement after a BEGIN...END procedure body is a separate top-level statement, not swallowed into the body", () => {
        const sql = `
            CREATE PROCEDURE dbo.Proc1
            AS
            BEGIN
                SELECT 1;
            END;
            SELECT 99;
        `;

        const result = new Parser(new Lexer(sql)).parse();

        expect(result.issues).toEqual([]);
        expect(result.ast.body).toHaveLength(2);
        expect(result.ast.body[0].type).toBe("CreateStatement");
        expect(result.ast.body[1].type).toBe("SelectStatement");

        const create = result.ast.body[0] as CreateNode;
        expect(Array.isArray(create.body)).toBe(true);
        expect(create.body as any[]).toHaveLength(1);
        expect((create.body as any[])[0].type).toBe("BlockStatement");
    });

    test("does not swallow a subsequent unrelated DECLARE after the procedure body", () => {
        const sql = `
            CREATE PROCEDURE dbo.Proc1
            AS
            BEGIN
                SELECT 1;
            END
            DECLARE @X INT = 1;
        `;

        const result = new Parser(new Lexer(sql)).parse();

        expect(result.ast.body).toHaveLength(2);
        expect(result.ast.body[1].type).toBe("DeclareStatement");
    });

    test("multiple GO-separated CREATE PROCEDURE batches each parse independently", () => {
        const sql = `
            CREATE PROCEDURE dbo.Proc1 AS BEGIN SELECT 1; END
            GO
            CREATE PROCEDURE dbo.Proc2 AS BEGIN SELECT 2; END
        `;

        const result = new Parser(new Lexer(sql)).parse();

        expect(result.issues).toEqual([]);
        expect(result.ast.body.map((s) => s.type)).toEqual([
            "CreateStatement",
            "BatchSeparatorStatement",
            "CreateStatement",
        ]);
    });

    test("a bare (non BEGIN...END) procedure body still extends to the rest of the batch (matches SQL Server behavior)", () => {
        const sql = `
            CREATE PROCEDURE dbo.Proc1
            AS
                SELECT 1;
                SELECT 2;
        `;

        const result = new Parser(new Lexer(sql)).parse();
        const create = result.ast.body[0] as CreateNode;

        expect(result.ast.body).toHaveLength(1);
        expect(Array.isArray(create.body)).toBe(true);
        expect(create.body as any[]).toHaveLength(2);
    });

    test("CREATE FUNCTION and CREATE TRIGGER bodies also stop at BEGIN...END", () => {
        const fnSql = `
            CREATE FUNCTION dbo.Fn1() RETURNS INT AS BEGIN RETURN 1 END
            SELECT 99;
        `;
        const fnResult = new Parser(new Lexer(fnSql)).parse();
        expect(fnResult.ast.body).toHaveLength(2);
        expect(fnResult.ast.body[1].type).toBe("SelectStatement");

        const trgSql = `
            CREATE TRIGGER dbo.Trg1 ON dbo.Users AFTER INSERT AS BEGIN SELECT 1 END
            SELECT 99;
        `;
        const trgResult = new Parser(new Lexer(trgSql)).parse();
        expect(trgResult.ast.body).toHaveLength(2);
        expect(trgResult.ast.body[1].type).toBe("SelectStatement");
    });

    test("should parse CREATE DATABASE", () => {
        const result = new Parser(new Lexer(`CREATE DATABASE TestData_1M;`)).parse();
        const node = result.ast.body[0] as CreateNode;

        expect(result.issues).toEqual([]);
        expect(node.objectType).toBe("DATABASE");
        expect(node.name).toBe("TestData_1M");
    });

    test("should report an unmodeled CREATE target once and without inventing a name", () => {
        const sql = `CREATE EXTERNAL DATA SOURCE [MyDs] WITH (LOCATION = N'x', CREDENTIAL = [sa]);
            SELECT 1;`;
        const result = new Parser(new Lexer(sql)).parse();
        const node = result.ast.body[0] as CreateNode;

        expect(node.unsupportedObjectType).toBe("EXTERNAL");
        expect(node.name).toBe("");
        expect(result.issues.map((issue) => issue.code)).toEqual(["PARSE_CREATE_TYPE"]);
        expect(result.ast.body[1].type).toBe("SelectStatement");
    });

    test("should not read CREATE DATABASE SCOPED CREDENTIAL as a database named SCOPED", () => {
        const sql = `CREATE DATABASE SCOPED CREDENTIAL [sa] WITH IDENTITY = N'sa';`;
        const result = new Parser(new Lexer(sql)).parse();
        const node = result.ast.body[0] as CreateNode;

        expect(node.unsupportedObjectType).toBe("DATABASE SCOPED");
        expect(node.name).toBe("");
        expect(result.issues.map((issue) => issue.code)).toEqual(["PARSE_CREATE_TYPE"]);
    });
});
