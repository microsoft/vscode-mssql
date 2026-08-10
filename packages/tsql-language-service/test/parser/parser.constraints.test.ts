import { parseOne, expectSql } from "./parser.helpers";

import { Parser } from "../../src/parser/saral/parser/parser.js";
import { Lexer } from "../../src/parser/saral/parser/lexer.js";

describe("T-SQL Parser - Constraints", () => {
    describe("column constraints", () => {
        test("PRIMARY KEY", () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Country(
                    CountryId INT PRIMARY KEY
                )
            `);

            const c = stmt.columns[0];
            const k = c.constraints[0];

            expect(c.name).toBe("CountryId");
            expect(k.kind).toBe("PRIMARY KEY");
            expect(k.columns).toEqual(["CountryId"]);
        });

        test("NOT NULL", () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Country(
                    Name VARCHAR(100) NOT NULL
                )
            `);

            const k = stmt.columns[0].constraints[0];

            expect(k.kind).toBe("NOT NULL");
        });

        test("DEFAULT literal", () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Country(
                    IsActive BIT DEFAULT 1
                )
            `);

            const k = stmt.columns[0].constraints[0];

            expect(k.kind).toBe("DEFAULT");
            expectSql(k.expression, "1");
        });

        test("DEFAULT function", () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Country(
                    CreatedAt DATETIME DEFAULT GETDATE()
                )
            `);

            const k = stmt.columns[0].constraints[0];

            expect(k.kind).toBe("DEFAULT");
            expectSql(k.expression, "GETDATE()");
        });

        test("inline FOREIGN KEY REFERENCES", () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Department(
                    HeadEmployeeId INT
                        FOREIGN KEY
                        REFERENCES Employee(EmployeeId)
                )
            `);

            const k = stmt.columns[0].constraints[0];

            expect(k.kind).toBe("FOREIGN KEY");
            expect(k.columns).toEqual(["HeadEmployeeId"]);
            expect(k.referencesTable).toBe("Employee");
            expect(k.referencesColumns).toEqual(["EmployeeId"]);
        });

        test("CHECK", () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Country(
                    ISOCode CHAR(2)
                        CHECK (LEN(ISOCode)=2)
                )
            `);

            const k = stmt.columns[0].constraints[0];

            expect(k.kind).toBe("CHECK");
            expectSql(k.expression, "LEN(ISOCode) = 2");
        });

        test("named column-level REFERENCES shorthand (no FOREIGN KEY keywords)", () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Department(
                    HeadEmployeeId INT
                        CONSTRAINT FK_Department_Employee
                        REFERENCES Employee(EmployeeId)
                )
            `);

            const k = stmt.columns[0].constraints[0];

            expect(k.name).toBe("FK_Department_Employee");
            expect(k.kind).toBe("FOREIGN KEY");
            expect(k.columns).toEqual(["HeadEmployeeId"]);
            expect(k.referencesTable).toBe("Employee");
            expect(k.referencesColumns).toEqual(["EmployeeId"]);
        });

        test("named column-level REFERENCES shorthand with ON DELETE CASCADE", () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.OrderItem(
                    OrderId INT
                        CONSTRAINT FK_OrderItem_Order
                        REFERENCES [Order](OrderId)
                        ON DELETE CASCADE
                )
            `);

            const k = stmt.columns[0].constraints[0];

            expect(k.kind).toBe("FOREIGN KEY");
            expect(k.onDelete).toBe("CASCADE");
        });
    });

    describe("named constraints", () => {
        test("named DEFAULT", () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Country(
                    IsActive BIT
                        CONSTRAINT DF_Country_IsActive
                        DEFAULT 1
                )
            `);

            const k = stmt.columns[0].constraints[0];

            expect(k.name).toBe("DF_Country_IsActive");

            expect(k.kind).toBe("DEFAULT");
        });

        test("named CHECK", () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Country(
                    Code CHAR(2)
                        CONSTRAINT CHK_Code
                        CHECK (LEN(Code)=2)
                )
            `);

            const k = stmt.columns[0].constraints[0];

            expect(k.name).toBe("CHK_Code");

            expect(k.kind).toBe("CHECK");
        });
    });

    describe("table constraints", () => {
        test("PRIMARY KEY", () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Country(
                    CountryId INT,
                    CONSTRAINT PK_Country
                    PRIMARY KEY (CountryId)
                )
            `);

            const k = stmt.constraints[0];

            expect(k.name).toBe("PK_Country");

            expect(k.kind).toBe("PRIMARY KEY");

            expect(k.columns).toEqual(["CountryId"]);
        });

        test("PRIMARY KEY CLUSTERED with ordered columns", () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Country(
                    CountryId INT,
                    PRIMARY KEY CLUSTERED (CountryId ASC)
                )
            `);

            const k = stmt.constraints[0];

            expect(k.kind).toBe("PRIMARY KEY");

            expect(k.columns).toEqual(["CountryId"]);
        });

        test("recovers table-level PRIMARY KEY without comma after last column", () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Country(
                    CountryId INT,
                    Code VARCHAR(20) NULL
                    PRIMARY KEY CLUSTERED (CountryId ASC)
                )
            `);

            expect(stmt.columns.map((c: any) => c.name)).toEqual(["CountryId", "Code"]);

            expect(stmt.constraints[0].kind).toBe("PRIMARY KEY");

            expect(stmt.constraints[0].columns).toEqual(["CountryId"]);
        });

        test("UNIQUE", () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Country(
                    Code CHAR(2),
                    CONSTRAINT UQ_Country_Code
                    UNIQUE (Code)
                )
            `);

            const k = stmt.constraints[0];

            expect(k.kind).toBe("UNIQUE");

            expect(k.columns).toEqual(["Code"]);
        });

        test("FOREIGN KEY REFERENCES", () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Department(
                    HeadEmployeeId INT,
                    CONSTRAINT FK_Department_HeadEmployee
                    FOREIGN KEY (HeadEmployeeId)
                    REFERENCES Employee(EmployeeId)
                )
            `);

            const k = stmt.constraints[0];

            expect(k.kind).toBe("FOREIGN KEY");

            expect(k.columns).toEqual(["HeadEmployeeId"]);

            expect(k.referencesTable).toBe("Employee");

            expect(k.referencesColumns).toEqual(["EmployeeId"]);
        });

        test("CHECK", () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Country(
                    ISOCode CHAR(2),
                    CONSTRAINT CHK_Code
                    CHECK (LEN(ISOCode)=2)
                )
            `);

            const k = stmt.constraints[0];

            expect(k.kind).toBe("CHECK");

            expectSql(k.expression, "LEN(ISOCode) = 2");
        });
    });

    describe("table variables", () => {
        test("DECLARE TABLE with constraints", () => {
            const stmt = parseOne<any>(`
                DECLARE @T TABLE(
                    Id INT PRIMARY KEY,
                    Name VARCHAR(50) NOT NULL,
                    CONSTRAINT UQ_T_Name UNIQUE(Name)
                )
            `);

            const v = stmt.variables[0];

            expect(v.dataType).toBe("TABLE");

            expect(v.columns).toHaveLength(2);

            expect(v.constraints).toHaveLength(1);

            expect(v.constraints[0].kind).toBe("UNIQUE");
        });

        test("computed column", () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Items(
                    FirstName VARCHAR(50),
                    LastName VARCHAR(50),
                    FullName AS (FirstName + ' ' + LastName)
                )
            `);

            const c = stmt.columns[2];

            expect(c.name).toBe("FullName");
            expect(c.dataType).toBe("");
            expectSql(c.computedExpression, "FirstName + ' ' + LastName");
            expect(c.persisted).toBeUndefined();
        });

        test("persisted computed column", () => {
            const stmt = parseOne<any>(`
                CREATE TABLE dbo.Items(
                    Qty INT,
                    Price DECIMAL(10,2),
                    Total AS (Qty * Price) PERSISTED
                )
            `);

            const c = stmt.columns[2];

            expect(c.name).toBe("Total");
            expectSql(c.computedExpression, "Qty * Price");
            expect(c.persisted).toBe(true);
        });
    });

    describe("recoverability", () => {
        test("broken REFERENCES still recovers", () => {
            const stmt = parseOne<any>(`
        CREATE TABLE X(
            Id INT,
            CONSTRAINT FK_X
            FOREIGN KEY (Id)
            REFERENCES
        )
    `);

            expect(stmt.constraints[0].incomplete).toBe(true);

            expect(stmt.constraints[0].kind).toBe("FOREIGN KEY");
        });

        test("broken CHECK still recovers", () => {
            const stmt = parseOne<any>(`
        CREATE TABLE X(
            Id INT CHECK (
        )
    `);

            expect(stmt.columns[0].constraints[0].incomplete).toBe(true);

            expect(stmt.columns[0].constraints[0].kind).toBe("CHECK");
        });

        test("continues after broken table definition", () => {
            const sql = `
                DECLARE @T TABLE(
                    Id INT CHECK (
                ;
                SELECT 1;
            `;

            const parser = new Parser(new Lexer(sql));

            const ast = parser.parse().ast;

            expect(ast.body.length).toBeGreaterThanOrEqual(2);

            expect(ast.body[1].type).toBe("SelectStatement");
        });

        test("broken table column definition recovers to next column", () => {
            const stmt = parseOne<any>(`
                CREATE TABLE X(
                    Id INT,
                    dbo.* INT,
                    Name NVARCHAR(50)
                )
            `);

            expect(stmt.columns.some((c: any) => c.name === "Name")).toBe(true);
        });
    });
});

describe("IDENTITY constraints", () => {
    test("IDENTITY before PRIMARY KEY", () => {
        const stmt = parseOne<any>(`
            CREATE TABLE X(
                Id INT IDENTITY(1,1) PRIMARY KEY
            )
        `);

        const constraints = stmt.columns[0].constraints;

        expect(constraints).toHaveLength(2);

        expect(constraints[0].kind).toBe("IDENTITY");

        expect(constraints[0].seed).toBe(1);

        expect(constraints[0].increment).toBe(1);

        expect(constraints[1].kind).toBe("PRIMARY KEY");
    });

    test("PRIMARY KEY before IDENTITY", () => {
        const stmt = parseOne<any>(`
            CREATE TABLE X(
                Id INT PRIMARY KEY IDENTITY(1,1)
            )
        `);

        const constraints = stmt.columns[0].constraints;

        expect(constraints).toHaveLength(2);

        expect(constraints[0].kind).toBe("PRIMARY KEY");

        expect(constraints[1].kind).toBe("IDENTITY");

        expect(constraints[1].seed).toBe(1);

        expect(constraints[1].increment).toBe(1);
    });

    test("IDENTITY without explicit seed/increment", () => {
        const stmt = parseOne<any>(`
            CREATE TABLE X(
                Id INT IDENTITY PRIMARY KEY
            )
        `);

        const identity = stmt.columns[0].constraints.find((x: any) => x.kind === "IDENTITY");

        expect(identity).toBeDefined();

        expect(identity.seed).toBeUndefined();

        expect(identity.increment).toBeUndefined();
    });

    test("NOT FOR REPLICATION before NOT NULL", () => {
        const stmt = parseOne<any>(`
            CREATE TABLE X(
                Id INT NOT FOR REPLICATION NOT NULL
            )
        `);

        const constraints = stmt.columns[0].constraints;

        expect(constraints.map((x: any) => x.kind)).toEqual(["NOT FOR REPLICATION", "NOT NULL"]);
    });
});

describe("unnamed table constraints", () => {
    test("unnamed PRIMARY KEY composite", () => {
        const stmt = parseOne<any>(`
            CREATE TABLE PatentAssignment(
                PatentId INT NOT NULL,
                EmployeeId INT NOT NULL,
                PRIMARY KEY (
                    PatentId,
                    EmployeeId
                )
            )
        `);

        expect(stmt.constraints).toHaveLength(1);

        const pk = stmt.constraints[0];

        expect(pk.kind).toBe("PRIMARY KEY");

        expect(pk.columns).toEqual(["PatentId", "EmployeeId"]);
    });

    test("unnamed FOREIGN KEY", () => {
        const stmt = parseOne<any>(`
            CREATE TABLE SalaryCreditLog(
                EmployeeId INT,
                FOREIGN KEY (EmployeeId)
                REFERENCES Employee(EmployeeId)
            )
        `);

        expect(stmt.constraints).toHaveLength(1);

        const fk = stmt.constraints[0];

        expect(fk.kind).toBe("FOREIGN KEY");

        expect(fk.columns).toEqual(["EmployeeId"]);

        expect(fk.referencesTable).toBe("Employee");

        expect(fk.referencesColumns).toEqual(["EmployeeId"]);
    });

    test("FOREIGN KEY with ON DELETE/ON UPDATE CASCADE", () => {
        const stmt = parseOne<any>(`
            CREATE TABLE SalaryCreditLog(
                EmployeeId INT,
                FOREIGN KEY (EmployeeId)
                REFERENCES Employee(EmployeeId)
                ON DELETE CASCADE
                ON UPDATE CASCADE
            )
        `);

        const fk = stmt.constraints[0];
        expect(fk.kind).toBe("FOREIGN KEY");
        expect(fk.onDelete).toBe("CASCADE");
        expect(fk.onUpdate).toBe("CASCADE");
    });

    test("FOREIGN KEY with mixed referential action variants in any order", () => {
        const stmt = parseOne<any>(`
            CREATE TABLE SalaryCreditLog(
                EmployeeId INT,
                FOREIGN KEY (EmployeeId)
                REFERENCES Employee(EmployeeId)
                ON UPDATE SET NULL
                ON DELETE NO ACTION
            )
        `);

        const fk = stmt.constraints[0];
        expect(fk.kind).toBe("FOREIGN KEY");
        expect(fk.onDelete).toBe("NO ACTION");
        expect(fk.onUpdate).toBe("SET NULL");
    });

    test("multiple unnamed table constraints", () => {
        const stmt = parseOne<any>(`
            CREATE TABLE X(
                A INT,
                B INT,
                PRIMARY KEY (A,B),
                FOREIGN KEY (B)
                REFERENCES Y(Id)
            )
        `);

        expect(stmt.constraints).toHaveLength(2);

        expect(stmt.constraints[0].kind).toBe("PRIMARY KEY");

        expect(stmt.constraints[1].kind).toBe("FOREIGN KEY");
    });
});

describe("real-world DDL", () => {
    test("SalaryCreditLog", () => {
        const stmt = parseOne<any>(`
            CREATE TABLE SalaryCreditLog (
                LogId INT PRIMARY KEY IDENTITY(1,1),
                EmployeeId INT,
                CreditDate DATE,
                Amount DECIMAL(10,2),
                FOREIGN KEY (EmployeeId)
                    REFERENCES Employee(EmployeeId)
            )
        `);

        expect(stmt.columns).toHaveLength(4);

        expect(stmt.columns[0].constraints.map((x: any) => x.kind)).toEqual([
            "PRIMARY KEY",
            "IDENTITY",
        ]);

        expect(stmt.constraints).toHaveLength(1);

        expect(stmt.constraints[0].kind).toBe("FOREIGN KEY");
    });

    test("PatentAssignment composite PK", () => {
        const stmt = parseOne<any>(`
            CREATE TABLE PatentAssignment(
                PatentId INT NOT NULL,
                EmployeeId INT NOT NULL,
                Status VARCHAR(20)
                    DEFAULT 'Active',
                PRIMARY KEY (
                    PatentId,
                    EmployeeId
                ),
                FOREIGN KEY (PatentId)
                    REFERENCES Patent(PatentId),
                FOREIGN KEY (EmployeeId)
                    REFERENCES Employee(EmployeeId)
            )
        `);

        expect(stmt.constraints).toHaveLength(3);

        expect(stmt.constraints[0].kind).toBe("PRIMARY KEY");

        expect(stmt.constraints[1].kind).toBe("FOREIGN KEY");

        expect(stmt.constraints[2].kind).toBe("FOREIGN KEY");
    });
});

describe("T-SQL Parser - CREATE TABLE inline indexes and storage options", () => {
    test("should parse table constraint WITH index options and ON storage inside CREATE TABLE", () => {
        const sql = `
            CREATE TABLE dbo.GdoDuplicateMessage (
                DuplicateID INT NOT NULL,
                CONSTRAINT PK_GdoDuplicateMessage PRIMARY KEY CLUSTERED
                (
                    DuplicateID ASC
                )
                WITH (
                    PAD_INDEX = OFF,
                    STATISTICS_NORECOMPUTE = OFF,
                    IGNORE_DUP_KEY = OFF,
                    ALLOW_ROW_LOCKS = ON,
                    ALLOW_PAGE_LOCKS = ON
                ) ON [PRIMARY]
            ) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
        `;

        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0] as any;

        expect(result.issues).toEqual([]);
        expect(stmt.constraints).toHaveLength(1);
        expect(stmt.constraints?.[0].kind).toBe("PRIMARY KEY");
        expect(stmt.constraints?.[0].storage?.name).toBe("[PRIMARY]");
        expect(stmt.columns?.some((col: any) => col.name === "WITH")).toBe(false);
    });

    test("should keep named inline UNIQUE and DEFAULT constraints on their columns", () => {
        const sql = `
            CREATE TABLE [dbo].[Configuration]
            (
                [Id] INT IDENTITY(1,1) NOT NULL,
                [ConfigName] VARCHAR(50) CONSTRAINT [UK_Configuration_ConfigName] UNIQUE NOT NULL,
                [ConfigValue] VARCHAR(2000) NOT NULL,
                [IsActive] BIT NOT NULL,
                [UpdatedBy] NVARCHAR(50) NULL,
                [UpdatedDate] DATETIME CONSTRAINT [DC_Configuration_UpdatedDate] DEFAULT (GETUTCDATE()) NOT NULL,
                [Comment] VARCHAR(255) NULL,
                CONSTRAINT PK_Configuration_Id PRIMARY KEY CLUSTERED(Id ASC)
            );
        `;

        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0] as any;
        const configName = stmt.columns?.find((col: any) => col.name === "[ConfigName]");
        const updatedDate = stmt.columns?.find((col: any) => col.name === "[UpdatedDate]");

        expect(result.issues).toEqual([]);
        expect(configName?.constraints?.some((c: any) => c.kind === "UNIQUE")).toBe(true);
        expect(configName?.constraints?.some((c: any) => c.kind === "NOT NULL")).toBe(true);
        expect(updatedDate?.constraints?.some((c: any) => c.kind === "DEFAULT")).toBe(true);
        expect(updatedDate?.constraints?.some((c: any) => c.kind === "NOT NULL")).toBe(true);
        expect(stmt.constraints).toHaveLength(1);
        expect(stmt.columns?.some((col: any) => col.name === "NOT")).toBe(false);
    });

    test("should parse inline table indexes inside CREATE TABLE", () => {
        const sql = `
            CREATE TABLE [dbo].[ItemsSelected]
            (
                [Id] BIGINT IDENTITY(1,1) NOT NULL,
                [ItemsId] BIGINT,
                [ContextId] BIGINT,
                CONSTRAINT [PK_ItemsSelected] PRIMARY KEY CLUSTERED ([Id] ASC),
                INDEX NC_ItemsSelected_ContextId_ItemsId NONCLUSTERED ([ContextId], [ItemsId])
            )
        `;

        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0] as any;

        expect(result.issues).toEqual([]);
        expect(stmt.indexes).toHaveLength(1);
        expect(stmt.indexes?.[0].name).toBe("NC_ItemsSelected_ContextId_ItemsId");
        expect(stmt.indexes?.[0].clustered).toBe("NONCLUSTERED");
        expect(stmt.indexes?.[0].columns.map((c: any) => c.name)).toEqual([
            "[ContextId]",
            "[ItemsId]",
        ]);
        expect(stmt.columns?.some((col: any) => col.name === "INDEX")).toBe(false);
    });

    test("should parse inline indexes inside CREATE TYPE AS TABLE", () => {
        const sql = `
            CREATE TYPE [dbo].[SomeTableType] AS TABLE (
                [Name] NVARCHAR(30) NOT NULL,
                [ModelId] VARCHAR(20) NULL,
                [IsService] BIT NOT NULL,
                [IsNonSelected] BIT NOT NULL,
                INDEX [ix_nc_1] ([ModelId]),
                INDEX [ix_nc_2] ([Name], [IsService]),
                INDEX [ix_nc_3] ([IsNonSelected])
            );
        `;

        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0] as any;

        expect(result.issues).toEqual([]);
        expect(stmt.objectType).toBe("TYPE");
        expect(stmt.isTableType).toBe(true);
        expect(stmt.indexes).toHaveLength(3);
        expect(stmt.indexes?.map((i: any) => i.name)).toEqual([
            "[ix_nc_1]",
            "[ix_nc_2]",
            "[ix_nc_3]",
        ]);
    });
});
