import { Lexer } from "../../src/parser/saral/parser/lexer.js";
import { Parser } from "../../src/parser/saral/parser/parser.js";
import {
    ScopeBuilder,
    type ScopeBuilderResult,
} from "../../src/parser/saral/semantic/scopeBuilder.js";
import { SymbolKind } from "../../src/parser/saral/semantic/scope.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function build(sql: string): ScopeBuilderResult {
    const { ast } = new Parser(new Lexer(sql)).parse();
    return new ScopeBuilder().build(ast);
}

// Shorthand when only the root scope is needed
function rootScope(sql: string) {
    return build(sql).root;
}

// ─── 1. Variable Declaration ──────────────────────────────────────────────────

describe("DECLARE", () => {
    test("scalar variable", () => {
        const scope = rootScope(`DECLARE @Id INT;`);
        const sym = scope.resolve("@Id");
        expect(sym).toBeDefined();
        expect(sym?.kind).toBe(SymbolKind.Variable);
        expect(sym?.dataType).toBe("INT");
    });

    test("multiple variables in one statement", () => {
        const scope = rootScope(`
            DECLARE @Id INT, @Name VARCHAR(100), @Amount DECIMAL(18,2);
        `);
        expect(scope.resolve("@Id")?.kind).toBe(SymbolKind.Variable);
        expect(scope.resolve("@Name")?.kind).toBe(SymbolKind.Variable);
        expect(scope.resolve("@Amount")?.kind).toBe(SymbolKind.Variable);
    });

    test("table variable", () => {
        const scope = rootScope(`
            DECLARE @Users TABLE(
                Id   INT,
                Name VARCHAR(100)
            );
        `);
        const sym = scope.resolve("@Users");
        expect(sym).toBeDefined();
        expect(sym?.kind).toBe(SymbolKind.Table);
        expect(sym?.columns).toEqual(["Id", "Name"]);
        expect(sym?.localColumns?.map((c) => c.rawName)).toEqual(["Id", "Name"]);
        expect(sym?.localColumns?.map((c) => c.normalizedName)).toEqual(["id", "name"]);
        expect(sym?.localColumns?.map((c) => c.dataType)).toEqual(["INT", "VARCHAR(100)"]);
    });

    test("typed local column exposes known type members", () => {
        const scope = rootScope(`
            DECLARE @Stores TABLE(
                GeoPoint GEOGRAPHY
            );
        `);
        const sym = scope.resolve("@Stores");
        const geo = sym?.localColumns?.find((c) => c.rawName === "GeoPoint");

        expect(geo?.dataType).toBe("GEOGRAPHY");
        expect(geo?.typeMembers?.some((m) => m.name === "Lat" && m.returnType === "FLOAT")).toBe(
            true,
        );
        expect(geo?.typeMembers?.some((m) => m.name === "STDistance" && m.kind === "method")).toBe(
            true,
        );
    });

    test("XML typed local column exposes common XML members", () => {
        const scope = rootScope(`
            DECLARE @Docs TABLE(
                Payload XML
            );
        `);
        const sym = scope.resolve("@Docs");
        const payload = sym?.localColumns?.find((c) => c.rawName === "Payload");

        expect(payload?.dataType).toBe("XML");
        expect(
            payload?.typeMembers?.some((m) => m.name === "value" && m.returnType === "SQL_VARIANT"),
        ).toBe(true);
        expect(
            payload?.typeMembers?.some((m) => m.name === "exist" && m.returnType === "BIT"),
        ).toBe(true);
    });

    test("hierarchyid typed local column exposes common hierarchyid members", () => {
        const scope = rootScope(`
            DECLARE @Org TABLE(
                Node hierarchyid
            );
        `);
        const sym = scope.resolve("@Org");
        const node = sym?.localColumns?.find((c) => c.rawName === "Node");

        expect(node?.dataType?.toUpperCase()).toBe("HIERARCHYID");
        expect(
            node?.typeMembers?.some((m) => m.name === "GetLevel" && m.returnType === "INT"),
        ).toBe(true);
        expect(
            node?.typeMembers?.some((m) => m.name === "IsDescendantOf" && m.returnType === "BIT"),
        ).toBe(true);
    });

    test("declaration with initialiser visits expression", () => {
        // @Base is referenced inside @Derived's initialiser
        const result = build(`
            DECLARE @Base   INT = 10;
            DECLARE @Derived INT = @Base + 5;
        `);
        const baseSym = result.root.resolve("@Base");
        expect(baseSym?.references.length).toBeGreaterThan(0);
    });

    test("GO separates variable declaration scopes", () => {
        const result = build(`
            DECLARE @ID INT = 20
            GO
            DECLARE @ID INT = 30
        `);

        const batches = result.root.getChildren().filter((scope) => scope.name === "batch");

        expect(result.duplicates).toHaveLength(0);
        expect(batches).toHaveLength(2);
        expect(batches[0].resolveLocal("@ID")).toBeDefined();
        expect(batches[1].resolveLocal("@ID")).toBeDefined();
        expect(result.root.resolveLocal("@ID")).toBeUndefined();
    });
});

// ─── 2. CREATE ────────────────────────────────────────────────────────────────

describe("CREATE", () => {
    test("CREATE TABLE", () => {
        const scope = rootScope(`
            CREATE TABLE dbo.Users(
                Id   INT,
                Name VARCHAR(100)
            );
        `);
        const sym = scope.resolve("dbo.Users");
        expect(sym).toBeDefined();
        expect(sym?.kind).toBe(SymbolKind.Table);
        expect(sym?.columns).toEqual(["Id", "Name"]);
    });

    test("CREATE VIEW", () => {
        const scope = rootScope(`
            CREATE VIEW dbo.ActiveUsers AS
            SELECT Id FROM dbo.Users;
        `);
        expect(scope.resolve("dbo.ActiveUsers")?.kind).toBe(SymbolKind.Table);
    });

    test("CREATE VIEW body WITH CTE is scoped and visited", () => {
        const result = build(`
            CREATE VIEW dbo.vEmployeeDepartment
            AS
            WITH cteEmp AS (
                SELECT EmployeeId, DepartmentId FROM Employee
            )
            SELECT c.EmployeeId
            FROM cteEmp c;
        `);

        const viewScope = result.root
            .getChildren()
            .find((x) => x.name === "dbo.vEmployeeDepartment");
        expect(viewScope).toBeDefined();

        const withScope = viewScope?.getChildren().find((x) => x.name === "with");
        expect(withScope).toBeDefined();
        expect(withScope?.resolveLocal("cteEmp")?.kind).toBe(SymbolKind.CTE);
    });

    test("FUNCTION RETURN body WITH CTE is scoped and visited", () => {
        const result = build(`
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
        `);

        const fnScope = result.root.getChildren().find((x) => x.name === "dbo.fnInline");
        expect(fnScope).toBeDefined();

        const withScope = fnScope?.getChildren().find((x) => x.name === "with");
        expect(withScope).toBeDefined();
        expect(withScope?.resolveLocal("cteX")?.kind).toBe(SymbolKind.CTE);
    });

    test("CREATE TYPE AS TABLE", () => {
        const scope = rootScope(`
            CREATE TYPE dbo.UserType AS TABLE(
                Id   INT,
                Name VARCHAR(50)
            );
        `);
        const sym = scope.resolve("dbo.UserType");
        expect(sym).toBeDefined();
        expect(sym?.kind).toBe(SymbolKind.Type);
        expect(sym?.columns).toEqual(["Id", "Name"]);
    });

    test("procedure symbol registered in root scope", () => {
        const scope = rootScope(`
            CREATE PROCEDURE dbo.TestProc
                @Id INT
            AS
            BEGIN
                SELECT @Id;
            END
        `);
        const sym = scope.resolve("dbo.TestProc");
        expect(sym).toBeDefined();
        expect(sym?.kind).toBe(SymbolKind.Procedure);
    });

    test("procedure parameters live in proc child scope, not root", () => {
        const scope = rootScope(`
            CREATE PROCEDURE dbo.TestProc
                @Id   INT,
                @Name VARCHAR(100)
            AS
            BEGIN
                SELECT @Id, @Name;
            END
        `);
        const procScope = scope.getChildren().find((x) => x.name === "dbo.TestProc");

        expect(procScope).toBeDefined();
        expect(procScope?.resolveLocal("@Id")?.kind).toBe(SymbolKind.Parameter);
        expect(procScope?.resolveLocal("@Name")?.kind).toBe(SymbolKind.Parameter);

        // Parameters must NOT leak into root
        expect(scope.resolveLocal("@Id")).toBeUndefined();
        expect(scope.resolveLocal("@Name")).toBeUndefined();
    });

    test("variables declared inside proc body are in proc scope", () => {
        const scope = rootScope(`
            CREATE PROCEDURE dbo.Proc1
            AS
            BEGIN
                DECLARE @Local INT;
                SELECT @Local;
            END
        `);
        const procScope = scope.getChildren().find((x) => x.name === "dbo.Proc1");

        expect(procScope?.resolve("@Local")?.kind).toBe(SymbolKind.Variable);
        expect(scope.resolveLocal("@Local")).toBeUndefined();
    });
});

// ─── 3. Block scoping (T-SQL variable scoping rules) ─────────────────────────

describe("BEGIN…END block scoping", () => {
    // T-SQL: variables are batch/procedure-scoped, NOT block-scoped.
    // A DECLARE inside BEGIN…END is visible after the END.
    test("variable declared inside block is visible in parent scope", () => {
        const scope = rootScope(`
            BEGIN
                DECLARE @Inner INT;
            END
            SELECT @Inner;
        `);
        // Must resolve from root because blocks do NOT create a new scope
        expect(scope.resolve("@Inner")?.kind).toBe(SymbolKind.Variable);
    });

    test("BEGIN…END does NOT create a child scope node", () => {
        const scope = rootScope(`
            DECLARE @A INT;
            BEGIN
                DECLARE @B INT;
            END
        `);
        // Both symbols live in root — no 'block' child scope should exist
        expect(scope.resolveLocal("@A")).toBeDefined();
        expect(scope.resolveLocal("@B")).toBeDefined();
        // No block child scope
        const block = scope.getChildren().find((x) => x.name === "block");
        expect(block).toBeUndefined();
    });

    test("nested blocks both resolve to root", () => {
        const scope = rootScope(`
            DECLARE @Outer INT;

            BEGIN
                DECLARE @Inner INT;

                BEGIN
                    DECLARE @Deep INT;
                END
            END
        `);
        // All three visible from root
        expect(scope.resolveLocal("@Outer")).toBeDefined();
        expect(scope.resolveLocal("@Inner")).toBeDefined();
        expect(scope.resolveLocal("@Deep")).toBeDefined();
    });
});

// ─── 4. CTEs ─────────────────────────────────────────────────────────────────

describe("CTEs", () => {
    test("explicit CTE column aliases replace inferred projection names", () => {
        const result = build(
            "WITH RowsToInsert(RowNumber) AS (SELECT ROW_NUMBER() OVER (ORDER BY (SELECT NULL))) SELECT RowNumber FROM RowsToInsert",
        );
        const withScope = result.root.getChildren().find((scope) => scope.name === "with");

        expect(withScope?.resolveLocal("RowsToInsert")?.columns).toEqual(["RowNumber"]);
    });

    test("CTE wildcard projections inherit columns from an earlier CTE", () => {
        const result = build(
            "WITH Base AS (SELECT 1 AS Id, 2 AS CategoryId), Latest AS (SELECT * FROM Base) SELECT l.Id FROM Latest AS l",
        );
        const withScope = result.root.getChildren().find((scope) => scope.name === "with");

        expect(withScope?.resolveLocal("Latest")?.columns).toEqual(["Id", "CategoryId"]);
    });

    test("CTE name is visible inside WITH scope", () => {
        const scope = rootScope(`
            WITH Users AS (SELECT 1 Id)
            SELECT * FROM Users;
        `);
        const withScope = scope.getChildren().find((x) => x.name === "with");
        expect(withScope?.resolveLocal("Users")?.kind).toBe(SymbolKind.CTE);
    });

    test("CTE name does NOT leak into root scope", () => {
        const scope = rootScope(`
            WITH Users AS (SELECT 1 Id)
            SELECT * FROM Users;
        `);
        expect(scope.resolveLocal("Users")).toBeUndefined();
    });

    test("multiple CTEs all registered in WITH scope", () => {
        const scope = rootScope(`
            WITH
                A AS (SELECT 1 x),
                B AS (SELECT 2 y)
            SELECT * FROM A JOIN B ON A.x = B.y;
        `);
        const withScope = scope.getChildren().find((x) => x.name === "with");
        expect(withScope?.resolveLocal("A")?.kind).toBe(SymbolKind.CTE);
        expect(withScope?.resolveLocal("B")?.kind).toBe(SymbolKind.CTE);
    });
});

// ─── 5. SELECT scope / aliases ────────────────────────────────────────────────

describe("SELECT aliases", () => {
    test("table alias registered in select scope", () => {
        const scope = rootScope(`
            SELECT u.Id FROM dbo.Users u;
        `);
        const selectScope = scope.getChildren().find((x) => x.name === "select");
        expect(selectScope?.resolveLocal("u")?.kind).toBe(SymbolKind.Alias);
    });

    test("JOIN alias registered in select scope", () => {
        const scope = rootScope(`
            SELECT *
            FROM   dbo.Users u
            JOIN   dbo.Roles r ON r.Id = u.RoleId;
        `);
        const selectScope = scope.getChildren().find((x) => x.name === "select");
        expect(selectScope?.resolveLocal("u")?.kind).toBe(SymbolKind.Alias);
        expect(selectScope?.resolveLocal("r")?.kind).toBe(SymbolKind.Alias);
    });

    test("table-variable alias exposes structured local columns", () => {
        const scope = rootScope(`
            DECLARE @Emp TABLE(
                FirstName2 VARCHAR(100),
                LastName2 VARCHAR(100)
            );

            SELECT te.FirstName2
            FROM @Emp te;
        `);
        const selectScope = scope.getChildren().find((x) => x.name === "select");
        const alias = selectScope?.resolveLocal("te");

        expect(alias?.kind).toBe(SymbolKind.Alias);
        expect(alias?.columns).toEqual(["FirstName2", "LastName2"]);
        expect(alias?.localColumns?.map((c) => c.rawName)).toEqual(["FirstName2", "LastName2"]);
        expect(alias?.localColumns?.map((c) => c.dataType)).toEqual([
            "VARCHAR(100)",
            "VARCHAR(100)",
        ]);
    });

    test("table alias does NOT leak into root scope", () => {
        const scope = rootScope(`
            SELECT u.Id FROM dbo.Users u;
        `);
        expect(scope.resolveLocal("u")).toBeUndefined();
    });

    test("TVP parameter typed with a same-file CREATE TYPE AS TABLE exposes structured local columns", () => {
        // Before the fix: the TYPE symbol (dbo.EmpTableType) correctly
        // captured its own localColumns, but the PARAMETER declared with
        // that type name never cross-referenced it — even though the type
        // definition is right there in the same file. Both the parameter
        // and its alias ended up with localColumns: undefined.
        const scope = rootScope(`
            CREATE TYPE dbo.EmpTableType AS TABLE (EmpId INT, FirstName2 VARCHAR(100));
            GO
            CREATE PROCEDURE dbo.P (@Emp dbo.EmpTableType READONLY) AS
            SELECT te.FirstName2 FROM @Emp te;
        `);

        const procScope = scope
            .getChildren()
            .flatMap((batch) => batch.getChildren())
            .find((x) => x.name === "dbo.P");
        expect(procScope).toBeDefined();

        const param = procScope?.resolveLocal("@Emp");
        expect(param?.localColumns?.map((c) => c.rawName)).toEqual(["EmpId", "FirstName2"]);

        const selectScope = procScope?.getChildren().find((x) => x.name === "select");
        const alias = selectScope?.resolveLocal("te");
        expect(alias?.localColumns?.map((c) => c.rawName)).toEqual(["EmpId", "FirstName2"]);
    });

    test("column alias registered in select scope", () => {
        const scope = rootScope(`
        SELECT Name AS UserName FROM dbo.Users;
    `);

        // Look for the inner 'select-output' scope
        const selectScope = scope.getChildren().find((x) => x.name === "select");

        const outputScope = selectScope?.getChildren().find((x) => x.name === "select-output");

        expect(outputScope?.resolveLocal("UserName")?.kind).toBe(SymbolKind.Alias);
    });

    test("PIVOT alias exposes pivot output columns in select scope", () => {
        const scope = rootScope(`
            SELECT pvt.ProductId, pvt.[North], pvt.[South]
            FROM (
                SELECT ProductId, RegionName, Amount
                FROM dbo.Sales
            ) src
            PIVOT (
                SUM(Amount)
                FOR RegionName IN ([North], [South])
            ) pvt;
        `);

        const selectScope = scope.getChildren().find((x) => x.name === "select");
        const pivotAlias = selectScope?.resolveLocal("pvt");

        expect(pivotAlias?.kind).toBe(SymbolKind.Alias);
        expect(pivotAlias?.columns).toEqual(["ProductId", "[North]", "[South]"]);
    });

    test("UNPIVOT alias exposes unpivot output columns in select scope", () => {
        const scope = rootScope(`
            SELECT u.ProductId, u.AttributeName, u.AttributeValue
            FROM (
                SELECT ProductId, Color, Size
                FROM dbo.Products
            ) src
            UNPIVOT (
                AttributeValue
                FOR AttributeName IN ([Color], [Size])
            ) u;
        `);

        const selectScope = scope.getChildren().find((x) => x.name === "select");
        const unpivotAlias = selectScope?.resolveLocal("u");

        expect(unpivotAlias?.kind).toBe(SymbolKind.Alias);
        expect(unpivotAlias?.columns).toEqual(["ProductId", "AttributeValue", "AttributeName"]);
    });
});

describe("MERGE scope", () => {
    test("MERGE target and source aliases are registered in merge scope", () => {
        const scope = rootScope(`
            MERGE dbo.Target AS T
            USING dbo.Source AS S
            ON T.Id = S.Id
            WHEN MATCHED THEN UPDATE SET T.Name = S.Name;
        `);

        const mergeScope = scope.getChildren().find((x) => x.name === "merge");

        expect(mergeScope).toBeDefined();
        expect(mergeScope?.resolveLocal("T")?.kind).toBe(SymbolKind.Alias);
        expect(mergeScope?.resolveLocal("S")?.kind).toBe(SymbolKind.Alias);
        expect(scope.resolveLocal("T")).toBeUndefined();
        expect(scope.resolveLocal("S")).toBeUndefined();
    });
});

describe("unverifiable sources", () => {
    test("select scope is marked unverifiable if it queries an undeclared table variable", () => {
        const scope = rootScope(`
            SELECT * FROM @UnknownTVP;
        `);
        const selectScope = scope.getChildren().find((x) => x.name === "select");
        expect(selectScope?.hasUnverifiableSources).toBe(true);
    });

    test("select scope is marked unverifiable if it queries a TVP without known columns", () => {
        const scope = rootScope(`
            DECLARE @T TABLE; -- malformed/no columns
            SELECT * FROM @T;
        `);
        const selectScope = scope.getChildren().find((x) => x.name === "select");
        expect(selectScope?.hasUnverifiableSources).toBe(true);
    });

    test("select scope is verifiable if it queries a fully declared table variable", () => {
        const scope = rootScope(`
            DECLARE @T TABLE (Id INT);
            SELECT Id FROM @T;
        `);
        const selectScope = scope.getChildren().find((x) => x.name === "select");
        expect(selectScope?.hasUnverifiableSources).toBe(false);
    });
});

// ─── 6. Reference tracking ────────────────────────────────────────────────────

describe("reference tracking", () => {
    test("variable used in SET is recorded as reference", () => {
        const result = build(`
            DECLARE @Counter INT = 0;
            SET @Counter = @Counter + 1;
        `);
        const sym = result.root.resolve("@Counter");
        // One reference from SET right-hand side
        expect(sym?.references.length).toBeGreaterThanOrEqual(1);
    });

    test("variable used in WHERE is recorded as reference", () => {
        const result = build(`
            DECLARE @Id INT = 1;
            SELECT Name FROM Users WHERE Id = @Id;
        `);
        const sym = result.root.resolve("@Id");
        expect(sym?.references.length).toBeGreaterThanOrEqual(1);
    });

    test("variable used in JOIN ON is recorded", () => {
        const result = build(`
            DECLARE @DeptId INT = 5;
            SELECT e.Name
            FROM   Employees e
            JOIN   Departments d ON d.Id = @DeptId;
        `);
        const sym = result.root.resolve("@DeptId");
        expect(sym?.references.length).toBeGreaterThanOrEqual(1);
    });

    test("variable used in HAVING is recorded", () => {
        const result = build(`
            DECLARE @Min INT = 100;
            SELECT DeptId, SUM(Salary) s
            FROM   Employees
            GROUP  BY DeptId
            HAVING SUM(Salary) > @Min;
        `);
        const sym = result.root.resolve("@Min");
        expect(sym?.references.length).toBeGreaterThanOrEqual(1);
    });

    test("variable used in PRINT is recorded", () => {
        const result = build(`
            DECLARE @Msg VARCHAR(100) = 'hello';
            PRINT @Msg;
        `);
        const sym = result.root.resolve("@Msg");
        expect(sym?.references.length).toBeGreaterThanOrEqual(1);
    });

    test("variable used in UPDATE SET is recorded", () => {
        const result = build(`
            DECLARE @Status INT = 1;
            UPDATE Users SET Status = @Status WHERE Id = 1;
        `);
        const sym = result.root.resolve("@Status");
        expect(sym?.references.length).toBeGreaterThanOrEqual(1);
    });

    test("variable used in INSERT VALUES is recorded", () => {
        const result = build(`
            DECLARE @Name VARCHAR(50) = 'Alice';
            INSERT INTO Users (Name) VALUES (@Name);
        `);
        const sym = result.root.resolve("@Name");
        expect(sym?.references.length).toBeGreaterThanOrEqual(1);
    });

    test("declared but never used has zero references", () => {
        const result = build(`
            DECLARE @Unused INT;
            SELECT 1;
        `);
        const sym = result.root.resolve("@Unused");
        expect(sym?.references.length).toBe(0);
    });
});

// ─── 7. Undeclared variable detection ────────────────────────────────────────

describe("undeclared variable detection", () => {
    test("undeclared variable in WHERE is reported", () => {
        const result = build(`
            SELECT Name FROM Users WHERE Id = @Ghost;
        `);
        expect(result.undeclared.length).toBeGreaterThan(0);
        const names = Array.from(result.references.keys());
        expect(names).toContain("@ghost");
    });

    test("declared variable is NOT in undeclared list", () => {
        const result = build(`
            DECLARE @Id INT = 1;
            SELECT Name FROM Users WHERE Id = @Id;
        `);
        expect(result.undeclared.length).toBe(0);
    });

    test("system variables (@@ROWCOUNT etc.) are never undeclared", () => {
        const result = build(`
            SELECT @@ROWCOUNT;
            SELECT @@ERROR;
            SELECT @@IDENTITY;
        `);
        expect(result.undeclared.length).toBe(0);
    });

    test("undeclared variable in SET is reported", () => {
        const result = build(`
        DECLARE @Real INT = 1;
        SET @Real = @Ghost + 1;  -- @Ghost is undeclared in the RHS expression
    `);
        expect(result.undeclared.length).toBeGreaterThan(0);
    });
});

// ─── 8. Expression visitor coverage ──────────────────────────────────────────

describe("expression visitor", () => {
    test("variable inside CASE WHEN is recorded", () => {
        const result = build(`
            DECLARE @Flag INT = 1;
            SELECT CASE WHEN @Flag = 1 THEN 'Yes' ELSE 'No' END;
        `);
        const sym = result.root.resolve("@Flag");
        expect(sym?.references.length).toBeGreaterThanOrEqual(1);
    });

    test("variable inside IN list is recorded", () => {
        const result = build(`
            DECLARE @A INT = 1;
            DECLARE @B INT = 2;
            SELECT x FROM T WHERE Id IN (@A, @B);
        `);
        expect(result.root.resolve("@A")?.references.length).toBeGreaterThanOrEqual(1);
        expect(result.root.resolve("@B")?.references.length).toBeGreaterThanOrEqual(1);
    });

    test("variable inside BETWEEN is recorded", () => {
        const result = build(`
            DECLARE @Lo INT = 1;
            DECLARE @Hi INT = 10;
            SELECT x FROM T WHERE Id BETWEEN @Lo AND @Hi;
        `);
        expect(result.root.resolve("@Lo")?.references.length).toBeGreaterThanOrEqual(1);
        expect(result.root.resolve("@Hi")?.references.length).toBeGreaterThanOrEqual(1);
    });

    test("variable inside subquery IN is recorded", () => {
        const result = build(`
            DECLARE @DeptId INT = 3;
            SELECT Name FROM Employees
            WHERE DeptId IN (SELECT Id FROM Depts WHERE ParentId = @DeptId);
        `);
        const sym = result.root.resolve("@DeptId");
        expect(sym?.references.length).toBeGreaterThanOrEqual(1);
    });

    test("variable inside OVER PARTITION BY is recorded", () => {
        const result = build(`
            DECLARE @Cat INT = 1;
            SELECT ROW_NUMBER() OVER (PARTITION BY @Cat ORDER BY Id) rn
            FROM T;
        `);
        const sym = result.root.resolve("@Cat");
        expect(sym?.references.length).toBeGreaterThanOrEqual(1);
    });

    test("variable inside CAST and CONVERT style is recorded", () => {
        const result = build(`
            DECLARE @Amount VARCHAR(20) = '42';
            DECLARE @Style INT = 120;
            SELECT CAST(@Amount AS INT), CONVERT(DATETIME, @Amount, @Style);
        `);
        expect(result.root.resolve("@Amount")?.references.length).toBeGreaterThanOrEqual(2);
        expect(result.root.resolve("@Style")?.references.length).toBeGreaterThanOrEqual(1);
    });

    test("variable inside EXISTS subquery is recorded", () => {
        const result = build(`
            DECLARE @DeptId INT = 3;
            SELECT CASE
                WHEN EXISTS (
                    SELECT 1
                    FROM Depts d
                    WHERE d.ParentId = @DeptId
                ) THEN 1
                ELSE 0
            END;
        `);
        expect(result.root.resolve("@DeptId")?.references.length).toBeGreaterThanOrEqual(1);
    });

    test("variable inside WITHIN GROUP order by is recorded", () => {
        const result = build(`
            DECLARE @SortKey INT = 1;
            SELECT STRING_AGG(Name, ',') WITHIN GROUP (ORDER BY @SortKey)
            FROM Users;
        `);
        expect(result.root.resolve("@SortKey")?.references.length).toBeGreaterThanOrEqual(1);
    });
});

describe("statement coverage", () => {
    test("return expression is recorded", () => {
        const result = build(`
            DECLARE @Code INT = 1;
            RETURN @Code;
        `);
        expect(result.root.resolve("@Code")?.references.length).toBeGreaterThanOrEqual(1);
    });

    test("waitfor expression is recorded", () => {
        const result = build(`
            DECLARE @Delay VARCHAR(20) = '00:00:01';
            WAITFOR DELAY @Delay;
        `);
        expect(result.root.resolve("@Delay")?.references.length).toBeGreaterThanOrEqual(1);
    });

    test("cursor fetch into writes variables and cursor query is visited", () => {
        const result = build(`
            DECLARE @MinId INT = 10;
            DECLARE @FetchedId INT;
            DECLARE cur CURSOR FOR
                SELECT Id
                FROM Users
                WHERE Id > @MinId;
            OPEN cur;
            FETCH NEXT FROM cur INTO @FetchedId;
            CLOSE cur;
            DEALLOCATE cur;
        `);

        expect(result.root.resolve("@MinId")?.references.length).toBeGreaterThanOrEqual(1);

        const fetchedRefs = result.root.resolve("@FetchedId")?.references ?? [];
        expect(fetchedRefs.some((ref) => ref.kind === "write")).toBe(true);
    });
});

// ─── 9. Derived tables ────────────────────────────────────────────────────────

describe("derived tables", () => {
    test("derived table subquery creates nested scope", () => {
        const scope = rootScope(`
            SELECT d.x
            FROM (SELECT 1 AS x) d;
        `);
        // outer select scope
        const selectScope = scope.getChildren().find((x) => x.name === "select");
        expect(selectScope).toBeDefined();
        // inner subquery scope nested inside select
        const subqueryScope = selectScope?.getChildren().find((x) => x.name === "subquery");
        expect(subqueryScope).toBeDefined();
    });

    test("variable inside derived table subquery is recorded", () => {
        const result = build(`
            DECLARE @Val INT = 42;
            SELECT d.x
            FROM (SELECT @Val AS x) d;
        `);
        const sym = result.root.resolve("@Val");
        expect(sym?.references.length).toBeGreaterThanOrEqual(1);
    });
});

// ─── 10. ScopeBuilderResult references map ────────────────────────────────────

describe("ScopeBuilderResult", () => {
    test("references map contains all variable names used", () => {
        const result = build(`
            DECLARE @A INT = 1;
            DECLARE @B INT = 2;
            SELECT @A + @B;
        `);
        expect(result.references.has("@a")).toBe(true);
        expect(result.references.has("@b")).toBe(true);
    });

    test("references map is case-insensitive keyed", () => {
        const result = build(`
            DECLARE @MyVar INT = 99;
            SELECT @myvar + @MYVAR;
        `);
        // All variations land under the same lowercase key.
        // 3 references: the DECLARE's own initializer (a write) plus the two reads.
        const refs = result.references.get("@myvar");
        expect(refs).toBeDefined();
        expect(refs!.length).toBe(3);
        expect(refs!.filter((r) => r.kind === "write").length).toBe(1);
        expect(refs!.filter((r) => r.kind === "read").length).toBe(2);
    });

    test("undeclared list location points to usage site", () => {
        const result = build(`SELECT @Ghost;`);
        expect(result.undeclared.length).toBeGreaterThan(0);
        // Location must be a valid offset object
        const loc = result.undeclared[0].location;
        expect(typeof loc.start).toBe("number");
        expect(typeof loc.end).toBe("number");
        expect(loc.start).toBeGreaterThanOrEqual(0);
    });
});

// ─── 11. Scope utility methods ────────────────────────────────────────────────

describe("Scope utilities", () => {
    test("findInnermost returns deepest scope containing offset", () => {
        const result = build(`
            DECLARE @A INT;

            CREATE PROCEDURE dbo.Proc1
            AS
            BEGIN
                DECLARE @B INT;
                SELECT @B;
            END
        `);

        const procScope = result.root.getChildren().find((x) => x.name === "dbo.Proc1")!;

        const bSym = procScope.resolveLocal("@B")!;
        const deepest = result.root.findInnermost(bSym.location.start);

        expect(deepest.resolve("@B")).toBeDefined();
        expect(deepest.resolve("@A")).toBeDefined(); // visible from parent
    });

    test("getVisibleSymbols returns merged symbols, shadowed ones hidden", () => {
        const scope = rootScope(`
            DECLARE @Id INT;

            CREATE PROCEDURE dbo.Proc1
            AS
            BEGIN
                DECLARE @Id VARCHAR(10);
                DECLARE @Name VARCHAR(20);
            END
        `);

        const procScope = scope.getChildren().find((x) => x.name === "dbo.Proc1")!;

        const visible = procScope.getVisibleSymbols();
        const names = visible.map((x) => x.name);

        // @Id shadowed by proc-local VARCHAR(10) version
        expect(names.filter((x) => x === "@Id")).toHaveLength(1);
        expect(names).toContain("@Name");

        const id = visible.find((x) => x.name === "@Id");
        expect(id?.dataType).toBe("VARCHAR(10)");
    });

    test("contains() correctly identifies offset membership", () => {
        const result = build(`DECLARE @X INT;`);
        expect(result.root.contains(0)).toBe(true);
        expect(result.root.contains(Number.MAX_SAFE_INTEGER)).toBe(true);
    });
});
