import { parseOne, expectSql } from "./parser.helpers";

import { Parser } from "../../src/parser/saral/parser/parser.js";
import { Lexer } from "../../src/parser/saral/parser/lexer.js";

// ─────────────────────────────────────────────────────────────
// Basic CREATE INDEX forms
// ─────────────────────────────────────────────────────────────

describe("T-SQL Parser - CREATE INDEX", () => {
    describe("basic forms", () => {
        test("simple index", () => {
            const stmt = parseOne<any>(`
                CREATE INDEX ix_Employee_LastName
                ON dbo.Employee (LastName)
            `);

            expect(stmt.type).toBe("CreateIndexStatement");

            expect(stmt.unique).toBe(false);
            expect(stmt.clustered).toBeNull();

            expect(stmt.name).toBe("ix_Employee_LastName");

            expect(stmt.table.name).toBe("dbo.Employee");
        });

        test("unique index", () => {
            const stmt = parseOne<any>(`
                CREATE UNIQUE INDEX uq_Employee_Email
                ON dbo.Employee (Email)
            `);

            expect(stmt.unique).toBe(true);
            expect(stmt.clustered).toBeNull();

            expect(stmt.name).toBe("uq_Employee_Email");
        });

        test("clustered index", () => {
            const stmt = parseOne<any>(`
                CREATE CLUSTERED INDEX cx_Order_OrderDate
                ON dbo.Order (OrderDate)
            `);

            expect(stmt.clustered).toBe("CLUSTERED");

            expect(stmt.unique).toBe(false);
        });

        test("nonclustered index", () => {
            const stmt = parseOne<any>(`
                CREATE NONCLUSTERED INDEX ix_Order_CustomerId
                ON dbo.Order (CustomerId)
            `);

            expect(stmt.clustered).toBe("NONCLUSTERED");
        });

        test("mixed-case nonclustered index keyword", () => {
            const stmt = parseOne<any>(`
                Create NonClustered Index [IX_MissedKafkaLogs_RequestId_IsProcessed]
                ON [dbo].[MissedKafkaLogs] ([RequestId], [IsProcessed])
            `);

            expect(stmt.type).toBe("CreateIndexStatement");

            expect(stmt.clustered).toBe("NONCLUSTERED");

            expect(stmt.name).toBe("[IX_MissedKafkaLogs_RequestId_IsProcessed]");
        });

        test("unique clustered index", () => {
            const stmt = parseOne<any>(`
                CREATE UNIQUE CLUSTERED INDEX cx_Product_Code
                ON dbo.Product (ProductCode)
            `);

            expect(stmt.unique).toBe(true);

            expect(stmt.clustered).toBe("CLUSTERED");
        });

        test("unique nonclustered index", () => {
            const stmt = parseOne<any>(`
                CREATE UNIQUE NONCLUSTERED INDEX uq_Product_Sku
                ON dbo.Product (Sku)
            `);

            expect(stmt.unique).toBe(true);

            expect(stmt.clustered).toBe("NONCLUSTERED");
        });
    });

    // ─────────────────────────────────────────────────────────
    // Columns
    // ─────────────────────────────────────────────────────────

    describe("index columns", () => {
        test("single column default direction", () => {
            const stmt = parseOne<any>(`
                CREATE INDEX ix_Employee_LastName
                ON dbo.Employee (LastName)
            `);

            expect(stmt.columns).toHaveLength(1);

            expect(stmt.columns[0].name).toBe("LastName");

            expect(stmt.columns[0].direction).toBe("ASC");
        });

        test("explicit ASC direction", () => {
            const stmt = parseOne<any>(`
                CREATE INDEX ix_Employee_LastName
                ON dbo.Employee (LastName ASC)
            `);

            expect(stmt.columns[0].direction).toBe("ASC");
        });

        test("explicit DESC direction", () => {
            const stmt = parseOne<any>(`
                CREATE INDEX ix_Order_Date
                ON dbo.Order (OrderDate DESC)
            `);
            expect(stmt.columns[0].direction).toBe("DESC");
        });

        test("composite index with mixed directions", () => {
            const stmt = parseOne<any>(`
                CREATE INDEX ix_Order_Composite
                ON dbo.Order (CustomerId ASC, OrderDate DESC)
            `);

            expect(stmt.columns).toHaveLength(2);

            expect(stmt.columns[0].name).toBe("CustomerId");

            expect(stmt.columns[0].direction).toBe("ASC");

            expect(stmt.columns[1].name).toBe("OrderDate");

            expect(stmt.columns[1].direction).toBe("DESC");
        });

        test("three-column composite index", () => {
            const stmt = parseOne<any>(`
                CREATE INDEX ix_Log_Composite
                ON dbo.Log (Year, Month, Day)
            `);

            expect(stmt.columns).toHaveLength(3);

            expect(stmt.columns.map((c: any) => c.name)).toEqual(["Year", "Month", "Day"]);
        });

        test("columns carry source locations", () => {
            const stmt = parseOne<any>(`
                CREATE INDEX ix_X ON dbo.X (Id)
            `);

            const col = stmt.columns[0];

            expect(col.start).toBeGreaterThanOrEqual(0);

            expect(col.end).toBeGreaterThan(col.start);
        });
    });

    // ─────────────────────────────────────────────────────────
    // INCLUDE columns
    // ─────────────────────────────────────────────────────────

    describe("INCLUDE columns", () => {
        test("single INCLUDE column", () => {
            const stmt = parseOne<any>(`
                CREATE INDEX ix_Employee_LastName
                ON dbo.Employee (LastName)
                INCLUDE (FirstName)
            `);

            expect(stmt.include).toHaveLength(1);

            expect(stmt.include[0].name).toBe("FirstName");
        });

        test("multiple INCLUDE columns", () => {
            const stmt = parseOne<any>(`
                CREATE INDEX ix_Employee_LastName
                ON dbo.Employee (LastName)
                INCLUDE (FirstName, Email, DepartmentId)
            `);

            expect(stmt.include).toHaveLength(3);

            expect(stmt.include.map((c: any) => c.name)).toEqual([
                "FirstName",
                "Email",
                "DepartmentId",
            ]);
        });

        test("no INCLUDE — property absent", () => {
            const stmt = parseOne<any>(`
                CREATE INDEX ix_X ON dbo.X (Id)
            `);

            expect(stmt.include).toBeUndefined();
        });
    });

    // ─────────────────────────────────────────────────────────
    // Filtered indexes (WHERE)
    // ─────────────────────────────────────────────────────────

    describe("filtered indexes", () => {
        test("WHERE IS NOT NULL", () => {
            const stmt = parseOne<any>(`
                CREATE INDEX ix_Employee_ManagerId
                ON dbo.Employee (ManagerId)
                WHERE ManagerId IS NOT NULL
            `);

            expect(stmt.where).toBeDefined();

            expectSql(stmt.where, "ManagerId IS NOT NULL");
        });

        test("WHERE equality predicate", () => {
            const stmt = parseOne<any>(`
                CREATE INDEX ix_Order_Active
                ON dbo.Order (CustomerId)
                WHERE IsDeleted = 0
            `);

            expect(stmt.where).toBeDefined();

            expectSql(stmt.where, "IsDeleted = 0");
        });

        test("no WHERE — property absent", () => {
            const stmt = parseOne<any>(`
                CREATE INDEX ix_X ON dbo.X (Id)
            `);

            expect(stmt.where).toBeUndefined();
        });
    });

    // ─────────────────────────────────────────────────────────
    // WITH options
    // ─────────────────────────────────────────────────────────

    describe("WITH options", () => {
        test("single option ONLINE = ON", () => {
            const stmt = parseOne<any>(`
                CREATE INDEX ix_X ON dbo.X (Id)
                WITH (ONLINE = ON)
            `);

            expect(stmt.options).toHaveLength(1);

            expect(stmt.options[0].name).toBe("ONLINE");

            expect(stmt.options[0].value).toBe("ON");
        });

        test("FILLFACTOR option", () => {
            const stmt = parseOne<any>(`
                CREATE INDEX ix_X ON dbo.X (Id)
                WITH (FILLFACTOR = 80)
            `);

            expect(stmt.options[0].name).toBe("FILLFACTOR");

            expect(stmt.options[0].value).toBe("80");
        });

        test("multiple options", () => {
            const stmt = parseOne<any>(`
                CREATE INDEX ix_X ON dbo.X (Id)
                WITH (ONLINE = ON, FILLFACTOR = 90)
            `);

            expect(stmt.options).toHaveLength(2);

            expect(stmt.options.map((o: any) => o.name)).toEqual(["ONLINE", "FILLFACTOR"]);

            expect(stmt.options.map((o: any) => o.value)).toEqual(["ON", "90"]);
        });

        test("no WITH — property absent", () => {
            const stmt = parseOne<any>(`
                CREATE INDEX ix_X ON dbo.X (Id)
            `);

            expect(stmt.options).toBeUndefined();
        });

        test("options carry source locations", () => {
            const stmt = parseOne<any>(`
                CREATE INDEX ix_X ON dbo.X (Id)
                WITH (ONLINE = ON)
            `);

            const opt = stmt.options[0];

            expect(opt.start).toBeGreaterThanOrEqual(0);

            expect(opt.end).toBeGreaterThan(opt.start);
        });
    });

    // ─────────────────────────────────────────────────────────
    // Combined real-world forms
    // ─────────────────────────────────────────────────────────

    describe("real-world forms", () => {
        test("covering index with INCLUDE and options", () => {
            const stmt = parseOne<any>(`
                CREATE NONCLUSTERED INDEX ix_Employee_Dept
                ON dbo.Employee (DepartmentId ASC)
                INCLUDE (LastName, FirstName, Email)
                WITH (ONLINE = ON, FILLFACTOR = 80)
            `);

            expect(stmt.unique).toBe(false);

            expect(stmt.clustered).toBe("NONCLUSTERED");

            expect(stmt.columns).toHaveLength(1);

            expect(stmt.include).toHaveLength(3);

            expect(stmt.options).toHaveLength(2);
        });

        test("unique filtered index", () => {
            const stmt = parseOne<any>(`
                CREATE UNIQUE INDEX uq_Employee_NationalId
                ON dbo.Employee (NationalId)
                WHERE NationalId IS NOT NULL
            `);

            expect(stmt.unique).toBe(true);

            expect(stmt.where).toBeDefined();

            expect(stmt.include).toBeUndefined();
        });

        test("schema-qualified table name", () => {
            const stmt = parseOne<any>(`
                CREATE INDEX ix_X
                ON hr.Employee (LastName)
            `);

            expect(stmt.table.name).toBe("hr.Employee");

            expect(stmt.table.parts).toEqual(["hr", "Employee"]);
        });

        test("statement carries source locations", () => {
            const sql = `CREATE INDEX ix_X ON dbo.X (Id)`;

            const stmt = parseOne<any>(sql);

            expect(stmt.start).toBe(0);

            expect(stmt.end).toBe(sql.trim().length);
        });
    });

    // ─────────────────────────────────────────────────────────
    // Recoverability
    // ─────────────────────────────────────────────────────────

    describe("recoverability", () => {
        test("missing ON clause recovers", () => {
            const stmt = parseOne<any>(`
                CREATE INDEX ix_X (Id)
            `);

            expect(stmt.incomplete).toBe(true);

            expect(stmt.name).toBe("ix_X");
        });

        test("missing column list recovers", () => {
            const stmt = parseOne<any>(`
                CREATE INDEX ix_X ON dbo.X
            `);

            expect(stmt.incomplete).toBe(true);

            expect(stmt.table.name).toBe("dbo.X");
        });

        test("unclosed column list recovers", () => {
            const stmt = parseOne<any>(`
                CREATE INDEX ix_X ON dbo.X (Id
            `);

            expect(stmt.incomplete).toBe(true);

            expect(stmt.columns).toHaveLength(1);
        });

        test("continues parsing after broken index", () => {
            const sql = `
                CREATE INDEX ix_X ON dbo.X (
                ;
                SELECT 1;
            `;

            const parser = new Parser(new Lexer(sql));

            const ast = parser.parse().ast;

            expect(ast.body.length).toBeGreaterThanOrEqual(2);

            expect(ast.body[1].type).toBe("SelectStatement");
        });

        test("broken WITH options recovers", () => {
            const stmt = parseOne<any>(`
                CREATE INDEX ix_X ON dbo.X (Id)
                WITH (ONLINE =
            `);

            expect(stmt.incomplete).toBe(true);

            expect(stmt.columns).toHaveLength(1);
        });

        test("broken INCLUDE list does not swallow filtered-index WHERE", () => {
            const stmt = parseOne<any>(`
                CREATE INDEX ix_X ON dbo.X (Id)
                INCLUDE (dbo.*)
                WHERE IsActive = 1
            `);

            expect(stmt.include).toEqual([]);
            expect(stmt.where).toBeDefined();
        });
    });
});
