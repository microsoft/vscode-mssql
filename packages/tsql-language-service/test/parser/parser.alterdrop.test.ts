import { parseOne, expectSql } from "./parser.helpers";

import { Parser } from "../../src/parser/saral/parser/parser.js";
import { Lexer } from "../../src/parser/saral/parser/lexer.js";

describe("T-SQL Parser - DDL Changes", () => {
    describe("DROP IF EXISTS", () => {
        test("should parse DROP TABLE IF EXISTS", () => {
            const stmt = parseOne<any>("DROP TABLE IF EXISTS dbo.Users");

            expect(stmt.type).toBe("DropStatement");
            expect(stmt.objectType).toBe("TABLE");
            expect(stmt.ifExists).toBe(true);
            expect(stmt.target.name).toBe("dbo.Users");
        });

        test("should parse standard DROP VIEW", () => {
            const stmt = parseOne<any>("DROP VIEW MyView");

            expect(stmt.type).toBe("DropStatement");
            expect(stmt.ifExists).toBe(false);
            expect(stmt.target.name).toBe("MyView");
        });

        test("DROP PROCEDURE IF EXISTS", () => {
            const stmt = parseOne<any>("DROP PROCEDURE IF EXISTS dbo.usp_GetEmployee");

            expect(stmt.type).toBe("DropStatement");
            expect(stmt.objectType).toBe("PROCEDURE");
            expect(stmt.ifExists).toBe(true);
            expect(stmt.target.name).toBe("dbo.usp_GetEmployee");
        });

        test("DROP INDEX IF EXISTS", () => {
            const stmt = parseOne<any>("DROP INDEX IF EXISTS ix_Employee_LastName ON dbo.Employee");

            expect(stmt.type).toBe("DropStatement");
            expect(stmt.objectType).toBe("INDEX");
            expect(stmt.ifExists).toBe(true);
        });
    });

    // ─────────────────────────────────────────────────────────
    // ALTER TABLE ADD
    // ─────────────────────────────────────────────────────────

    describe("ALTER TABLE ADD", () => {
        test("ADD COLUMN without COLUMN keyword", () => {
            const stmt = parseOne<any>("ALTER TABLE Users ADD Email VARCHAR(255) NOT NULL");

            expect(stmt.type).toBe("AlterTableStatement");
            expect(stmt.table.name).toBe("Users");
            expect(stmt.action.kind).toBe("ADD_COLUMN");
            expect(stmt.action.column.name).toBe("Email");
            expect(stmt.action.column.dataType).toBe("VARCHAR(255)");
        });

        test("ADD COLUMN with COLUMN keyword", () => {
            const stmt = parseOne<any>("ALTER TABLE Users ADD COLUMN Phone VARCHAR(20) NULL");

            expect(stmt.action.kind).toBe("ADD_COLUMN");
            expect(stmt.action.column.name).toBe("Phone");
            expect(stmt.action.column.dataType).toBe("VARCHAR(20)");
        });

        test("ADD COLUMN with DEFAULT constraint", () => {
            const stmt = parseOne<any>("ALTER TABLE Users ADD IsActive BIT DEFAULT 1");

            expect(stmt.action.kind).toBe("ADD_COLUMN");
            expect(stmt.action.column.name).toBe("IsActive");

            const def = stmt.action.column.constraints.find((c: any) => c.kind === "DEFAULT");

            expect(def).toBeDefined();
            expectSql(def.expression, "1");
        });

        test("ADD COLUMN with named DEFAULT constraint", () => {
            const stmt = parseOne<any>(`
                ALTER TABLE Users
                ADD IsActive BIT
                    CONSTRAINT DF_Users_IsActive DEFAULT 1
            `);

            expect(stmt.action.kind).toBe("ADD_COLUMN");

            const def = stmt.action.column.constraints.find((c: any) => c.kind === "DEFAULT");

            expect(def.name).toBe("DF_Users_IsActive");
        });

        test("ADD CONSTRAINT PRIMARY KEY", () => {
            const stmt = parseOne<any>(`
                ALTER TABLE Orders
                ADD CONSTRAINT PK_Orders PRIMARY KEY (OrderId)
            `);

            expect(stmt.action.kind).toBe("ADD_CONSTRAINT");
            expect(stmt.action.constraint.name).toBe("PK_Orders");
            expect(stmt.action.constraint.kind).toBe("PRIMARY KEY");
            expect(stmt.action.constraint.columns).toContain("OrderId");
        });

        test("ADD CONSTRAINT FOREIGN KEY", () => {
            const stmt = parseOne<any>(`
                ALTER TABLE Orders
                ADD CONSTRAINT FK_Orders_Customer
                FOREIGN KEY (CustomerId)
                REFERENCES Customer(CustomerId)
            `);

            expect(stmt.action.kind).toBe("ADD_CONSTRAINT");
            expect(stmt.action.constraint.kind).toBe("FOREIGN KEY");
            expect(stmt.action.constraint.columns).toContain("CustomerId");
            expect(stmt.action.constraint.referencesTable).toBe("Customer");
        });

        test("ADD CONSTRAINT UNIQUE", () => {
            const stmt = parseOne<any>(`
                ALTER TABLE Users
                ADD CONSTRAINT UQ_Users_Email UNIQUE (Email)
            `);

            expect(stmt.action.kind).toBe("ADD_CONSTRAINT");
            expect(stmt.action.constraint.kind).toBe("UNIQUE");
            expect(stmt.action.constraint.columns).toContain("Email");
        });

        test("ADD CONSTRAINT CHECK", () => {
            const stmt = parseOne<any>(`
                ALTER TABLE Orders
                ADD CONSTRAINT CHK_Orders_Amount
                CHECK (Amount > 0)
            `);

            expect(stmt.action.kind).toBe("ADD_CONSTRAINT");
            expect(stmt.action.constraint.kind).toBe("CHECK");
            expectSql(stmt.action.constraint.expression, "Amount > 0");
        });

        test("ADD CONSTRAINT with WITH CHECK preamble", () => {
            const stmt = parseOne<any>(`
                ALTER TABLE dbo.Orders
                WITH CHECK
                ADD CONSTRAINT FK_Orders_Customers
                FOREIGN KEY (CustomerId)
                REFERENCES dbo.Customers(Id)
            `);

            expect(stmt.action.kind).toBe("ADD_CONSTRAINT");
            expect(stmt.action.enforcement).toBe("CHECK");
            expect(stmt.action.constraint.kind).toBe("FOREIGN KEY");
            expect(stmt.action.constraint.name).toBe("FK_Orders_Customers");
        });

        test("ADD CONSTRAINT DEFAULT ... FOR column", () => {
            const stmt = parseOne<any>(`
                ALTER TABLE [dbo].[GdoDuplicateMessage]
                ADD CONSTRAINT [DF_GdoDuplicateMessage1_ATSReceivedOn]
                DEFAULT (getutcdate()) FOR [ATSReceivedOn]
            `);

            expect(stmt.action.kind).toBe("ADD_CONSTRAINT");
            expect(stmt.action.constraint.kind).toBe("DEFAULT");
            expect(stmt.action.constraint.name).toBe("[DF_GdoDuplicateMessage1_ATSReceivedOn]");
            expect(stmt.action.constraint.columns).toEqual(["[ATSReceivedOn]"]);
        });

        test("ADD DEFAULT ... FOR column without constraint name", () => {
            const stmt = parseOne<any>(`
                ALTER TABLE dbo.MissedKafkaLogs
                ADD DEFAULT (GETUTCDATE()) FOR CreatedOnUTC
            `);

            expect(stmt.action.kind).toBe("ADD_CONSTRAINT");
            expect(stmt.action.constraint.kind).toBe("DEFAULT");
            expect(stmt.action.constraint.name).toBeUndefined();
            expect(stmt.action.constraint.columns).toEqual(["CreatedOnUTC"]);
        });
    });

    describe("ALTER INDEX", () => {
        test("REBUILD with WITH options", () => {
            const stmt = parseOne<any>(
                "ALTER INDEX IX_Users_Name ON dbo.Users REBUILD WITH (ONLINE = ON, FILLFACTOR = 80)",
            );

            expect(stmt.type).toBe("AlterIndexStatement");
            expect(stmt.indexName).toBe("IX_Users_Name");
            expect(stmt.table.name).toBe("dbo.Users");
            expect(stmt.action.kind).toBe("REBUILD");
            expect(stmt.action.options).toHaveLength(2);
        });

        test("ALL REORGANIZE PARTITION expression", () => {
            const stmt = parseOne<any>("ALTER INDEX ALL ON dbo.Users REORGANIZE PARTITION = 3");

            expect(stmt.type).toBe("AlterIndexStatement");
            expect(stmt.indexName).toBe("ALL");
            expect(stmt.action.kind).toBe("REORGANIZE");
            expect(stmt.action.partition.type).toBe("Literal");
        });

        test("REBUILD PARTITION = ALL with options", () => {
            const stmt = parseOne<any>(
                "ALTER INDEX ALL ON dbo.Users REBUILD PARTITION = ALL WITH (FILLFACTOR = 100, SORT_IN_TEMPDB = ON, STATISTICS_NORECOMPUTE = OFF)",
            );

            expect(stmt.type).toBe("AlterIndexStatement");
            expect(stmt.indexName).toBe("ALL");
            expect(stmt.action.kind).toBe("REBUILD");
            expect(stmt.action.partition.type).toBe("Identifier");
            expect(stmt.action.partition.name).toBe("ALL");
            expect(stmt.action.options).toHaveLength(3);
        });

        test("DISABLE", () => {
            const stmt = parseOne<any>("ALTER INDEX IX_Users_Name ON dbo.Users DISABLE");

            expect(stmt.type).toBe("AlterIndexStatement");
            expect(stmt.action.kind).toBe("DISABLE");
        });

        test("SET bare option list", () => {
            const stmt = parseOne<any>(
                "ALTER INDEX IX_Users_Name ON dbo.Users SET (ALLOW_PAGE_LOCKS = OFF)",
            );

            expect(stmt.type).toBe("AlterIndexStatement");
            expect(stmt.action.kind).toBe("SET");
            expect(stmt.action.options).toHaveLength(1);
            expect(stmt.action.options[0].name).toBe("ALLOW_PAGE_LOCKS");
            expect(stmt.action.options[0].value).toBe("OFF");
        });
    });

    describe("UPDATE STATISTICS", () => {
        test("table and statistics name", () => {
            const stmt = parseOne<any>("UPDATE STATISTICS dbo.Users IX_Users_Name");

            expect(stmt.type).toBe("UpdateStatisticsStatement");
            expect(stmt.table.name).toBe("dbo.Users");
            expect(stmt.statistics).toBe("IX_Users_Name");
        });

        test("table only with WITH options", () => {
            const stmt = parseOne<any>("UPDATE STATISTICS dbo.Users WITH FULLSCAN, NORECOMPUTE");

            expect(stmt.type).toBe("UpdateStatisticsStatement");
            expect(stmt.table.name).toBe("dbo.Users");
            expect(stmt.options).toHaveLength(2);
            expect(stmt.options[0].name).toBe("FULLSCAN");
            expect(stmt.options[1].name).toBe("NORECOMPUTE");
        });

        test("table only before following IF statement", () => {
            const result = new Parser(
                new Lexer(`
                UPDATE STATISTICS dbo.Users

                IF EXISTS (SELECT 1 FROM dbo.Users)
                BEGIN
                    DROP TABLE dbo.UsersOld
                END
            `),
            ).parse();

            expect(result.issues).toHaveLength(0);
            expect(result.ast.body[0].type).toBe("UpdateStatisticsStatement");
            expect((result.ast.body[0] as any).table.name).toBe("dbo.Users");
            expect((result.ast.body[0] as any).statistics).toBeUndefined();
            expect(result.ast.body[1].type).toBe("IfStatement");
        });

        test("statistics list in parentheses", () => {
            const stmt = parseOne<any>(
                "UPDATE STATISTICS dbo.Users (IX_A, IX_B) WITH SAMPLE = 25 PERCENT",
            );

            expect(stmt.type).toBe("UpdateStatisticsStatement");
            expect(stmt.statistics).toBe("IX_A, IX_B");
            expect(stmt.options[0].name).toBe("SAMPLE");
            expect(stmt.options[0].value).toBe("25 PERCENT");
        });
    });

    // ─────────────────────────────────────────────────────────
    // ALTER TABLE DROP
    // ─────────────────────────────────────────────────────────

    describe("ALTER TABLE DROP", () => {
        test("DROP COLUMN IF EXISTS", () => {
            const stmt = parseOne<any>("ALTER TABLE Users DROP COLUMN IF EXISTS Phone");

            expect(stmt.action.kind).toBe("DROP_COLUMN");
            expect(stmt.action.name).toBe("Phone");
            expect(stmt.action.ifExists).toBe(true);
        });

        test("DROP COLUMN without IF EXISTS", () => {
            const stmt = parseOne<any>("ALTER TABLE Users DROP COLUMN Phone");

            expect(stmt.action.kind).toBe("DROP_COLUMN");
            expect(stmt.action.name).toBe("Phone");
            expect(stmt.action.ifExists).toBeFalsy();
        });

        test("DROP COLUMN without COLUMN keyword", () => {
            const stmt = parseOne<any>("ALTER TABLE Users DROP Phone");

            expect(stmt.action.kind).toBe("DROP_COLUMN");
            expect(stmt.action.name).toBe("Phone");
        });

        test("DROP CONSTRAINT IF EXISTS", () => {
            const stmt = parseOne<any>("ALTER TABLE Orders DROP CONSTRAINT IF EXISTS FK_User");

            expect(stmt.action.kind).toBe("DROP_CONSTRAINT");
            expect(stmt.action.name).toBe("FK_User");
            expect(stmt.action.ifExists).toBe(true);
        });

        test("DROP CONSTRAINT without IF EXISTS", () => {
            const stmt = parseOne<any>("ALTER TABLE Orders DROP CONSTRAINT FK_User");

            expect(stmt.action.kind).toBe("DROP_CONSTRAINT");
            expect(stmt.action.name).toBe("FK_User");
            expect(stmt.action.ifExists).toBeFalsy();
        });
    });

    // ─────────────────────────────────────────────────────────
    // ALTER TABLE ALTER COLUMN
    // ─────────────────────────────────────────────────────────

    describe("ALTER TABLE ALTER COLUMN", () => {
        test("ALTER COLUMN change data type", () => {
            const stmt = parseOne<any>("ALTER TABLE Users ALTER COLUMN Email NVARCHAR(500)");

            expect(stmt.type).toBe("AlterTableStatement");
            expect(stmt.table.name).toBe("Users");
            expect(stmt.action.kind).toBe("ALTER_COLUMN");
            expect(stmt.action.column.name).toBe("Email");
            expect(stmt.action.column.dataType).toBe("NVARCHAR(500)");
        });

        test("ALTER COLUMN add NOT NULL", () => {
            const stmt = parseOne<any>(
                "ALTER TABLE Users ALTER COLUMN Email NVARCHAR(500) NOT NULL",
            );

            expect(stmt.action.kind).toBe("ALTER_COLUMN");
            expect(stmt.action.column.name).toBe("Email");

            const notNull = stmt.action.column.constraints?.find((c: any) => c.kind === "NOT NULL");

            expect(notNull).toBeDefined();
        });

        test("ALTER COLUMN remove NOT NULL (allow nulls)", () => {
            const stmt = parseOne<any>("ALTER TABLE Users ALTER COLUMN Phone VARCHAR(20) NULL");

            expect(stmt.action.kind).toBe("ALTER_COLUMN");

            const nullable = stmt.action.column.constraints?.find((c: any) => c.kind === "NULL");

            expect(nullable).toBeDefined();
        });

        test("ALTER COLUMN without COLUMN keyword", () => {
            const stmt = parseOne<any>("ALTER TABLE Users ALTER Email NVARCHAR(500)");

            expect(stmt.action.kind).toBe("ALTER_COLUMN");
            expect(stmt.action.column.name).toBe("Email");
            expect(stmt.action.column.dataType).toBe("NVARCHAR(500)");
        });

        test("ALTER COLUMN schema-qualified table", () => {
            const stmt = parseOne<any>(
                "ALTER TABLE dbo.Employee ALTER COLUMN Salary DECIMAL(12,2) NOT NULL",
            );

            expect(stmt.table.name).toBe("dbo.Employee");
            expect(stmt.action.kind).toBe("ALTER_COLUMN");
            expect(stmt.action.column.name).toBe("Salary");
            expect(stmt.action.column.dataType).toBe("DECIMAL(12,2)");
        });

        test("ALTER COLUMN carries source location", () => {
            const sql = "ALTER TABLE Users ALTER COLUMN Email NVARCHAR(500)";

            const stmt = parseOne<any>(sql);

            expect(stmt.start).toBe(0);
            expect(stmt.end).toBe(sql.length);
        });
    });

    // ─────────────────────────────────────────────────────────
    // TRUNCATE TABLE
    // ─────────────────────────────────────────────────────────

    describe("TRUNCATE TABLE", () => {
        test("bare TRUNCATE TABLE", () => {
            const stmt = parseOne<any>("TRUNCATE TABLE Logs");

            expect(stmt.type).toBe("TruncateStatement");
            expect(stmt.table.name).toBe("Logs");
        });

        test("TRUNCATE TABLE schema-qualified", () => {
            const stmt = parseOne<any>("TRUNCATE TABLE dbo.AuditLog");

            expect(stmt.type).toBe("TruncateStatement");
            expect(stmt.table.name).toBe("dbo.AuditLog");
        });
    });

    // ─────────────────────────────────────────────────────────
    // Routing logic
    // ─────────────────────────────────────────────────────────

    describe("Routing logic", () => {
        test("ALTER TABLE routes to AlterTableStatement", () => {
            const stmt = parseOne<any>("ALTER TABLE T ADD C INT");
            expect(stmt.type).toBe("AlterTableStatement");
        });

        test("ALTER VIEW routes to CreateStatement with orAlter", () => {
            const stmt = parseOne<any>("ALTER VIEW V AS SELECT 1");
            expect(stmt.type).toBe("CreateStatement");
            expect(stmt.orAlter).toBe(true);
        });

        test("ALTER PROCEDURE routes to CreateStatement with orAlter", () => {
            const stmt = parseOne<any>(`
                ALTER PROCEDURE dbo.usp_Test
                AS
                SELECT 1
            `);

            expect(stmt.type).toBe("CreateStatement");
            expect(stmt.orAlter).toBe(true);
        });
    });

    // ─────────────────────────────────────────────────────────
    // Recoverability
    // ─────────────────────────────────────────────────────────

    describe("recoverability", () => {
        test("continues after broken ALTER TABLE", () => {
            const sql = `
                ALTER TABLE Users ADD
                SELECT 1
            `;

            const parser = new Parser(new Lexer(sql));

            const ast = parser.parse().ast;

            expect(ast.body.length).toBeGreaterThanOrEqual(1);
        });

        test("unsupported ALTER TABLE action stays local to AlterTableStatement", () => {
            const sql = `
                ALTER TABLE Users SWITCH PARTITION 1 TO UsersArchive;
                SELECT 1;
            `;

            const parser = new Parser(new Lexer(sql));

            const result = parser.parse();
            const ast = result.ast;

            expect(ast.body.length).toBeGreaterThanOrEqual(2);

            expect(ast.body[0].type).toBe("AlterTableStatement");

            expect((ast.body[0] as any).incomplete).toBe(true);

            expect((ast.body[0] as any).errors).toContain("Unsupported ALTER TABLE action: SWITCH");

            expect(ast.body[1].type).toBe("SelectStatement");
        });

        test("TRUNCATE TABLE without name produces incomplete node", () => {
            // TRUNCATE TABLE with no name — parseMultipartIdentifier returns
            // an incomplete identifier rather than crashing. The batch stays alive.
            const sql = `
                TRUNCATE TABLE;
                SELECT 1;
            `;

            const parser = new Parser(new Lexer(sql));

            const ast = parser.parse().ast;

            expect(ast.body.length).toBeGreaterThanOrEqual(2);

            expect(ast.body[0].type).toBe("TruncateStatement");

            expect(ast.body[1].type).toBe("SelectStatement");
        });
    });

    describe("ALTER ROLE", () => {
        test("ADD MEMBER", () => {
            const stmt = parseOne<any>(
                "ALTER ROLE [db_owner] ADD MEMBER [AMERICAS\\ProdSvcDevelopers]",
            );

            expect(stmt.type).toBe("AlterRoleStatement");
            expect(stmt.role.name).toBe("[db_owner]");
            expect(stmt.action.kind).toBe("ADD_MEMBER");
            expect(stmt.action.member.name).toBe("[AMERICAS\\ProdSvcDevelopers]");
        });
    });

    describe("ALTER DATABASE", () => {
        test("ADD FILEGROUP with memory optimized data", () => {
            const stmt = parseOne<any>(`
                ALTER DATABASE [$(DatabaseName)]
                ADD FILEGROUP [SomeFileGroup] CONTAINS MEMORY_OPTIMIZED_DATA
            `);

            expect(stmt.type).toBe("AlterDatabaseStatement");
            expect(stmt.database.name).toBe("[$(DatabaseName)]");
            expect(stmt.actionTokens).toEqual([
                "ADD",
                "FILEGROUP",
                "[SomeFileGroup]",
                "CONTAINS",
                "MEMORY_OPTIMIZED_DATA",
            ]);
        });
    });

    describe("GRANT / DENY", () => {
        test("GRANT permission on object to principal as grantor", () => {
            const stmt = parseOne<any>(`
                GRANT VIEW DEFINITION
                    ON OBJECT::[dbo].[SomeView] TO [service_sna]
                    AS [dbo]
            `);

            expect(stmt.type).toBe("PermissionStatement");
            expect(stmt.action).toBe("GRANT");
            expect(stmt.permissions).toEqual(["VIEW DEFINITION"]);
            expect(stmt.securableClass).toBe("OBJECT");
            expect(stmt.securable.name).toBe("[dbo].[SomeView]");
            expect(stmt.principal.name).toBe("[service_sna]");
            expect(stmt.asPrincipal.name).toBe("[dbo]");
        });

        test("DENY permission on object to principal", () => {
            const stmt = parseOne<any>(`
                DENY SELECT
                    ON OBJECT::[dbo].[SomeView] TO [service_sna]
            `);

            expect(stmt.type).toBe("PermissionStatement");
            expect(stmt.action).toBe("DENY");
            expect(stmt.permissions).toEqual(["SELECT"]);
            expect(stmt.securable.name).toBe("[dbo].[SomeView]");
            expect(stmt.principal.name).toBe("[service_sna]");
        });
    });
});

describe("T-SQL Parser - DROP TABLE / VIEW / PROC / FUNCTION / INDEX (bare forms)", () => {
    const parse = (sql: string) => {
        const lexer = new Lexer(sql);
        const parser = new Parser(lexer);
        return parser.parse().ast;
    };

    test("should handle DROP TABLE", () => {
        const sql = `DROP TABLE #Sales`;
        const node = parse(sql).body[0] as any;
        expect(node.type).toBe("DropStatement");
        expect(node.objectType).toBe("TABLE");
        expect(node.target?.name).toBe("#Sales");
    });

    test("should handle DROP VIEW", () => {
        const sql = `DROP VIEW dbo.V1`;
        const node = parse(sql).body[0] as any;
        expect(node.objectType).toBe("VIEW");
        expect(node.target?.name).toBe("dbo.V1");
        expect(node.target?.parts).toEqual(["dbo", "V1"]);
    });

    test("should handle DROP PROC", () => {
        const sql = `DROP PROC dbo.P1`;
        const node = parse(sql).body[0] as any;
        expect(node.objectType).toBe("PROCEDURE");
        expect(node.target?.name).toBe("dbo.P1");
        expect(node.target?.parts).toEqual(["dbo", "P1"]);
    });

    test("should handle DROP FUNCTION", () => {
        const sql = `DROP FUNCTION dbo.fn_Test`;
        const node = parse(sql).body[0] as any;
        expect(node.objectType).toBe("FUNCTION");
        expect(node.target?.name).toBe("dbo.fn_Test");
    });

    test("should handle DROP INDEX", () => {
        const sql = `DROP INDEX IX_Test ON dbo.T1`;
        const node = parse(sql).body[0] as any;
        expect(node.objectType).toBe("INDEX");
        expect(node.target?.name).toBe("IX_Test");
    });

    test("should handle DROP in IF statement", () => {
        const sql = `IF OBJECT_ID('dbo.Sales') IS NOT NULL DROP TABLE dbo.Sales`;
        const node = parse(sql).body[0] as any;
        expect(node.type).toBe("IfStatement");
        const dropStmt = Array.isArray(node.thenBranch) ? node.thenBranch[0] : node.thenBranch;
        if (dropStmt && "objectType" in dropStmt) {
            expect(dropStmt.objectType).toBe("TABLE");
        }
    });
});
