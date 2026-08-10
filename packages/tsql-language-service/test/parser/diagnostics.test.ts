import { Lexer } from "../../src/parser/saral/parser/lexer.js";
import { Parser } from "../../src/parser/saral/parser/parser.js";
import { ScopeBuilder } from "../../src/parser/saral/semantic/scopeBuilder.js";
import {
    diagnose,
    DiagnosticCode,
    type Diagnostic,
} from "../../src/parser/saral/diagnostics/diagnostics.js";

beforeAll(() => jest.spyOn(console, "error").mockImplementation(() => {}));
afterAll(() => jest.restoreAllMocks());

// ─── Helpers ──────────────────────────────────────────────────────────────────

function run(sql: string): Diagnostic[] {
    const { ast } = new Parser(new Lexer(sql)).parse();
    const scopeResult = new ScopeBuilder().build(ast);
    return diagnose(ast, scopeResult);
}

function only(sql: string, code: DiagnosticCode): Diagnostic[] {
    return run(sql).filter((d) => d.code === code);
}

// ─── VAR001: Undeclared variable ─────────────────────────────────────────────

describe("VAR001 — undeclared variable", () => {
    test("fires on undeclared variable in WHERE", () => {
        const d = only(
            `SELECT Name FROM Users WHERE Id = @Ghost`,
            DiagnosticCode.UndeclaredVariable,
        );
        expect(d.length).toBe(1);
        expect(d[0].severity).toBe("error");
    });

    test("fires on undeclared variable in UPDATE SET", () => {
        const d = only(
            `UPDATE Users SET Status = @Ghost WHERE Id = 1`,
            DiagnosticCode.UndeclaredVariable,
        );
        expect(d.length).toBe(1);
    });

    test("does NOT fire on declared variable", () => {
        const d = only(
            `DECLARE @Id INT = 1; SELECT Name FROM Users WHERE Id = @Id`,
            DiagnosticCode.UndeclaredVariable,
        );
        expect(d.length).toBe(0);
    });

    test("does NOT fire on system variables", () => {
        const d = only(`SELECT @@ROWCOUNT, @@ERROR, @@IDENTITY`, DiagnosticCode.UndeclaredVariable);
        expect(d.length).toBe(0);
    });

    test("fires multiple times for multiple undeclared vars", () => {
        const d = only(`SELECT @A + @B + @C`, DiagnosticCode.UndeclaredVariable);
        expect(d.length).toBe(3);
    });

    test("fires on undeclared var in HAVING", () => {
        const d = only(
            `SELECT DeptId FROM Employees GROUP BY DeptId HAVING COUNT(*) > @Min`,
            DiagnosticCode.UndeclaredVariable,
        );
        expect(d.length).toBe(1);
    });

    test("fires on undeclared var inside CASE WHEN", () => {
        const d = only(
            `SELECT CASE WHEN @Flag = 1 THEN 'Y' END`,
            DiagnosticCode.UndeclaredVariable,
        );
        expect(d.length).toBe(1);
    });

    test("fires on undeclared var inside subquery", () => {
        const d = only(
            `SELECT * FROM Users WHERE Id IN (SELECT Id FROM T WHERE X = @Ghost)`,
            DiagnosticCode.UndeclaredVariable,
        );
        expect(d.length).toBe(1);
    });

    test("parameter declared in proc resolves inside proc body", () => {
        const d = only(
            `
            CREATE PROCEDURE dbo.Proc1 @Id INT
            AS BEGIN
                SELECT Name FROM Users WHERE Id = @Id;
            END
        `,
            DiagnosticCode.UndeclaredVariable,
        );
        expect(d.length).toBe(0);
    });
});

// ─── VAR002: Unused variable ─────────────────────────────────────────────────

describe("VAR002 — unused variable", () => {
    test("fires on declared but never used variable", () => {
        const d = only(`DECLARE @Unused INT;`, DiagnosticCode.UnusedVariable);
        expect(d.length).toBe(1);
        expect(d[0].severity).toBe("warning");
    });

    test("fires when variable is only assigned but never read", () => {
        const d = only(`DECLARE @X INT; SET @X = 1;`, DiagnosticCode.UnusedVariable);

        expect(d.length).toBe(1);
    });

    test("does NOT fire when variable is later read", () => {
        const d = only(
            `
        DECLARE @X INT;
        SET @X = 1;
        SELECT @X;
        `,
            DiagnosticCode.UnusedVariable,
        );

        expect(d.length).toBe(0);
    });

    test("does NOT fire on compound SET assignment because the variable is read and written", () => {
        const d = only(`DECLARE @X INT = 5; SET @X -= 1;`, DiagnosticCode.UnusedVariable);

        expect(d.length).toBe(0);
    });

    test("does NOT fire when initialized and later PRINTED", () => {
        const d = only(
            `
        DECLARE @X INT = 1;
        PRINT @X;
        `,
            DiagnosticCode.UnusedVariable,
        );

        expect(d.length).toBe(0);
    });

    test("does NOT fire when variable is used in WHERE", () => {
        const d = only(
            `DECLARE @Id INT = 5; SELECT * FROM T WHERE Id = @Id;`,
            DiagnosticCode.UnusedVariable,
        );
        expect(d.length).toBe(0);
    });

    test("fires for each unused variable in multi-declare", () => {
        const d = only(`DECLARE @A INT, @B INT, @C INT; SELECT @A;`, DiagnosticCode.UnusedVariable);
        // @B and @C are unused
        expect(d.length).toBe(2);
    });

    test("does NOT fire on table variables — schema intent differs", () => {
        // Table variables declared for use as temp tables
        // are often populated later; keep them as warning-free for now
        const d = only(
            `DECLARE @T TABLE(Id INT, Name VARCHAR(50));`,
            DiagnosticCode.UnusedVariable,
        );
        // Table variables are SymbolKind.Table not Variable, so no warning
        expect(d.length).toBe(0);
    });

    test("does NOT fire when variable is used in RAISERROR", () => {
        const d = only(
            `
            DECLARE @Message VARCHAR(100) = 'bad';
            RAISERROR(@Message, 16, 1);
            `,
            DiagnosticCode.UnusedVariable,
        );

        expect(d.length).toBe(0);
    });

    test("does NOT fire when variable is used in THROW", () => {
        const d = only(
            `
            DECLARE @Message VARCHAR(100) = 'bad';
            THROW 50001, @Message, 1;
            `,
            DiagnosticCode.UnusedVariable,
        );

        expect(d.length).toBe(0);
    });

    test("does NOT fire when variable is used in WHILE condition and loop body", () => {
        const d = only(
            `
            DECLARE @DepthLevel INT = 0;
            WHILE @DepthLevel < 3
            BEGIN
                SET @DepthLevel = @DepthLevel + 1;
            END
            `,
            DiagnosticCode.UnusedVariable,
        );

        expect(d.length).toBe(0);
    });

    test("does NOT fire when variable is passed as EXEC output argument", () => {
        const d = only(
            `
            DECLARE @Result INT;
            EXEC dbo.uspGetValue @Result OUTPUT;
            `,
            DiagnosticCode.UnusedVariable,
        );

        expect(d.length).toBe(0);
    });

    test("does NOT fire when variable is passed as EXEC input argument", () => {
        const d = only(
            `
            DECLARE @InputValue INT = 42;
            EXEC dbo.uspUseValue @InputValue;
            `,
            DiagnosticCode.UnusedVariable,
        );

        expect(d.length).toBe(0);
    });

    test("does NOT fire when variable is passed as named EXEC input argument", () => {
        const d = only(
            `
            DECLARE @InputValue INT = 42;
            EXEC dbo.uspUseValue @Value = @InputValue;
            `,
            DiagnosticCode.UnusedVariable,
        );

        expect(d.length).toBe(0);
    });

    test("does NOT fire when variable is used in SELECT TOP quantity", () => {
        const d = only(
            `
            DECLARE @TakeCount INT = 10;
            SELECT TOP (@TakeCount) Id FROM dbo.Items;
            `,
            DiagnosticCode.UnusedVariable,
        );

        expect(d.length).toBe(0);
    });

    test("does NOT fire when variable is used in DELETE TOP quantity", () => {
        const d = only(
            `
            DECLARE @TakeCount INT = 10;
            DELETE TOP (@TakeCount) FROM dbo.Items WHERE IsActive = 0;
            `,
            DiagnosticCode.UnusedVariable,
        );

        expect(d.length).toBe(0);
    });

    test("does NOT fire when variable is used in UPDATE TOP quantity", () => {
        const d = only(
            `
            DECLARE @TakeCount INT = 10;
            UPDATE TOP (@TakeCount) dbo.Items
            SET IsActive = 1
            WHERE IsActive = 0;
            `,
            DiagnosticCode.UnusedVariable,
        );

        expect(d.length).toBe(0);
    });
});

// ─── VAR003: Unused parameter ────────────────────────────────────────────────

describe("VAR003 — unused parameter", () => {
    test("fires on unused procedure parameter", () => {
        const d = only(
            `
            CREATE PROCEDURE dbo.Proc1 @Id INT, @Name VARCHAR(100)
            AS BEGIN
                SELECT @Id;
            END
        `,
            DiagnosticCode.UnusedParameter,
        );
        // @Name is unused
        expect(d.length).toBe(1);
        expect(d[0].message).toContain("@Name");
    });

    test("does NOT fire when all parameters are used", () => {
        const d = only(
            `
            CREATE PROCEDURE dbo.Proc1 @Id INT
            AS BEGIN
                SELECT Name FROM Users WHERE Id = @Id;
            END
        `,
            DiagnosticCode.UnusedParameter,
        );
        expect(d.length).toBe(0);
    });

    test("does NOT fire when parameter is used in SELECT TOP quantity", () => {
        const d = only(
            `
            CREATE PROCEDURE dbo.TakeItems @TakeCount INT
            AS
            BEGIN
                SELECT TOP (@TakeCount) Id FROM dbo.Items;
            END
        `,
            DiagnosticCode.UnusedParameter,
        );
        expect(d.length).toBe(0);
    });

    test("does NOT fire when parameter is used in DELETE TOP quantity", () => {
        const d = only(
            `
            CREATE PROCEDURE dbo.DeleteItems @TakeCount INT
            AS
            BEGIN
                DELETE TOP (@TakeCount) FROM dbo.Items WHERE IsActive = 0;
            END
        `,
            DiagnosticCode.UnusedParameter,
        );
        expect(d.length).toBe(0);
    });

    test("does NOT fire when parameter is used in UPDATE TOP quantity", () => {
        const d = only(
            `
            CREATE PROCEDURE dbo.UpdateItems @TakeCount INT
            AS
            BEGIN
                UPDATE TOP (@TakeCount) dbo.Items
                SET IsActive = 1
                WHERE IsActive = 0;
            END
        `,
            DiagnosticCode.UnusedParameter,
        );
        expect(d.length).toBe(0);
    });

    test("does NOT fire for TVP used in INSERT SELECT FROM inside procedure body", () => {
        const d = only(
            `
            CREATE PROCEDURE dbo.ImportItems
                @Items dbo.ItemType READONLY
            AS
            BEGIN
                INSERT INTO dbo.Target (Id, Name)
                SELECT i.Id, i.Name
                FROM @Items i
                WHERE i.Id > 0;
            END
        `,
            DiagnosticCode.UnusedParameter,
        );
        expect(d.length).toBe(0);
    });

    test("does NOT fire for parameters used inside TRY CATCH procedure body with TVPs", () => {
        const d = only(
            `
            CREATE PROCEDURE [dbo].[ProcessItems]
                @InputItems [dbo].[ItemTableType] READONLY,
                @OutputItems [dbo].[ItemTableType] READONLY,
                @UserName VARCHAR(50),
                @AuditMessage VARCHAR(50) = NULL
            AS
            BEGIN
                BEGIN TRY
                    SET @UserName = TRIM(@UserName);

                    INSERT INTO #Tmp (Attribute)
                    SELECT TRIM(src.Attribute)
                    FROM @InputItems src;

                    INSERT INTO #Tmp (Attribute)
                    SELECT TRIM(dst.Attribute)
                    FROM @OutputItems dst;

                    SELECT @AuditMessage;
                END TRY
                BEGIN CATCH
                    SELECT ERROR_MESSAGE() AS Remarks;
                END CATCH
            END
        `,
            DiagnosticCode.UnusedParameter,
        );

        expect(d.length).toBe(0);
    });

    test("does NOT fire for output parameters assigned inside procedure body", () => {
        const d = only(
            `
            CREATE PROCEDURE dbo.GetDetails
                @ItemId VARCHAR(50),
                @RequestPayload NVARCHAR(MAX) OUTPUT,
                @ResponsePayload NVARCHAR(MAX) OUTPUT
            AS
            BEGIN
                IF EXISTS (SELECT 1 FROM dbo.NotificationLog WHERE ItemId = @ItemId)
                BEGIN
                    SET @RequestPayload = (SELECT TOP 1 RequestPayload FROM dbo.NotificationLog WHERE ItemId = @ItemId);
                    SET @ResponsePayload = (SELECT TOP 1 ResponsePayload FROM dbo.NotificationLog WHERE ItemId = @ItemId);

                    SELECT ItemId
                    FROM dbo.NotificationLog
                    WHERE ItemId = @ItemId;
                END
            END
        `,
            DiagnosticCode.UnusedParameter,
        );

        expect(d.length).toBe(0);
    });

    test("does NOT fire when parameters are used in OFFSET and FETCH", () => {
        const d = only(
            `
            CREATE PROCEDURE [dbo].[TestSproc] @CatalogID VARCHAR(50)
                                                         , @StartRow INT = 0
                                                         , @BatchSize INT = 1000
            AS
            BEGIN
                SELECT
                    oc.Id,
                    oc.Name
                FROM [dbo].[TestTable] oc WITH(NOLOCK)
                WHERE oc.CatalogId = @CatalogID
                    AND oc.IsActive = 1
                    AND oc.ReferenceId IS NULL
                ORDER BY oc.Id
                OFFSET (@StartRow * @BatchSize) ROWS
                FETCH NEXT @BatchSize ROWS ONLY
            END
        `,
            DiagnosticCode.UnusedParameter,
        );

        expect(d.length).toBe(0);
    });
    test("does NOT fire when parameter is only referenced through invalid schema-qualified TVP syntax", () => {
        const d = only(
            `
            CREATE PROCEDURE [dbo].[UpdateSomeTable]
                @UpdateSomeTable dbo.UpdateSomeTableType READONLY
            AS
            BEGIN
                SELECT dsa.Id
                FROM [dbo].[@UpdateSomeTable] dsa
            END
        `,
            DiagnosticCode.UnusedParameter,
        );

        expect(d).toHaveLength(0);
    });

    test("does NOT fire when XML parameter is used via .nodes()", () => {
        const d = only(
            `
            CREATE PROCEDURE dbo.ReadOrders
                @Request XML
            AS
            BEGIN
                SELECT rowAlias.NodeCol.value('OrderNumber[1]', 'BIGINT')
                FROM @Request.nodes('/Request/Orders/Order') AS rowAlias(NodeCol)
            END
        `,
            DiagnosticCode.UnusedParameter,
        );

        expect(d).toHaveLength(0);
    });

    test("does NOT fire for function parameter used in body when RETURNS is followed directly by BEGIN", () => {
        const d = only(
            `
            CREATE FUNCTION [dbo].[GetTrimmedZipCode]
            (
                @CustomerZipCode VARCHAR(MAX)
            )
            RETURNS NVARCHAR(100)
            BEGIN
                SET @CustomerZipCode = REPLACE(@CustomerZipCode, ' ', '')

                DECLARE @ZipCode NVARCHAR(100) = NULL
                WHILE (LEN(@CustomerZipCode) > 0)
                BEGIN
                    SELECT @ZipCode = zipcode
                    FROM zipcode WITH (NOLOCK)
                    WHERE zipcode = @CustomerZipCode

                    IF (@ZipCode IS NOT NULL)
                        RETURN @ZipCode

                    SET @CustomerZipCode = LEFT(@CustomerZipCode, LEN(@CustomerZipCode) - 1)
                END

                RETURN @ZipCode
            END
        `,
            DiagnosticCode.UnusedParameter,
        );

        expect(d).toHaveLength(0);
    });

    test("does NOT fire for the TVF return table variable used in the function body", () => {
        const d = only(
            `
            CREATE FUNCTION dbo.GetEmployees(@DeptId INT)
            RETURNS @result TABLE (Id INT, Name VARCHAR(50))
            AS
            BEGIN
                INSERT INTO @result SELECT Id, Name FROM Employee WHERE DeptId = @DeptId;
                RETURN;
            END
        `,
            DiagnosticCode.UndeclaredVariable,
        );

        expect(d).toHaveLength(0);
    });

    test("does NOT fire for TVF return variable read via SELECT in body", () => {
        const d = only(
            `
            CREATE FUNCTION dbo.GetEmployees(@DeptId INT)
            RETURNS @result TABLE (Id INT, Name VARCHAR(50))
            AS
            BEGIN
                INSERT INTO @result SELECT Id, Name FROM Employee WHERE DeptId = @DeptId;
                SELECT * FROM @result;
                RETURN;
            END
        `,
            DiagnosticCode.UndeclaredVariable,
        );

        expect(d).toHaveLength(0);
    });
});

describe("VAR004 — variable used before SET", () => {
    test("fires when a declared variable with no initializer is read before any SET", () => {
        const d = only(
            `
            DECLARE @x INT;
            SELECT @x;
        `,
            DiagnosticCode.VariableUsedBeforeSet,
        );

        expect(d.length).toBe(1);
        expect(d[0].severity).toBe("warning");
    });

    test("does NOT fire when the variable is initialized in its DECLARE", () => {
        const d = only(
            `
            DECLARE @x INT = 5;
            SELECT @x;
        `,
            DiagnosticCode.VariableUsedBeforeSet,
        );

        expect(d.length).toBe(0);
    });

    test("does NOT fire when SET precedes the read", () => {
        const d = only(
            `
            DECLARE @x INT;
            SET @x = 5;
            SELECT @x;
        `,
            DiagnosticCode.VariableUsedBeforeSet,
        );

        expect(d.length).toBe(0);
    });

    test("does NOT fire when SELECT assignment precedes the read", () => {
        const d = only(
            `
            DECLARE @NewDeliveryId INT;
            SELECT @NewDeliveryId = ISNULL(MAX(DeliveryId), 0) + 1
            FROM GoodieDeliveries;
            SELECT @NewDeliveryId;
        `,
            DiagnosticCode.VariableUsedBeforeSet,
        );

        expect(d.length).toBe(0);
    });

    test("does NOT fire when UPDATE SET assignment precedes the read", () => {
        const d = only(
            `
            DECLARE @X INT;
            UPDATE dbo.Users SET @X = Id WHERE Id = 1;
            SELECT @X;
        `,
            DiagnosticCode.VariableUsedBeforeSet,
        );

        expect(d.length).toBe(0);
    });

    test("still fires for an unset variable read on the RHS of a SELECT assignment", () => {
        const d = only(
            `
            DECLARE @x INT;
            DECLARE @y INT;
            SELECT @x = @y;
        `,
            DiagnosticCode.VariableUsedBeforeSet,
        );

        expect(d).toHaveLength(1);
        expect(d[0].message).toContain("@y");
    });

    test("fires only for the read that precedes the SET, not for reads after it", () => {
        const d = only(
            `
            DECLARE @x INT;
            SELECT @x;
            SET @x = 5;
            SELECT @x;
        `,
            DiagnosticCode.VariableUsedBeforeSet,
        );

        expect(d.length).toBe(1);
    });

    test("does NOT fire for parameters (always have a value at call time)", () => {
        const d = only(
            `
            CREATE PROCEDURE dbo.Proc1
                @x INT
            AS
            BEGIN
                SELECT @x;
            END
        `,
            DiagnosticCode.VariableUsedBeforeSet,
        );

        expect(d.length).toBe(0);
    });

    test("fires for table variables read before any INSERT/DELETE/OUTPUT populates them", () => {
        const d = only(
            `
            DECLARE @t TABLE (Id INT);
            SELECT * FROM @t;
        `,
            DiagnosticCode.VariableUsedBeforeSet,
        );

        expect(d.length).toBe(1);
    });

    test("does NOT fire when a SET inside an IF branch textually precedes the read (conservative, no control-flow analysis)", () => {
        const d = only(
            `
            DECLARE @x INT;
            IF 1 = 1
                SET @x = 1;
            SELECT @x;
        `,
            DiagnosticCode.VariableUsedBeforeSet,
        );

        expect(d.length).toBe(0);
    });

    test("does NOT fire when EXEC OUTPUT precedes the read", () => {
        const d = only(
            `
            DECLARE @x INT;
            EXEC dbo.GetValue @x OUTPUT;
            SELECT @x;
        `,
            DiagnosticCode.VariableUsedBeforeSet,
        );

        expect(d.length).toBe(0);
    });

    test("does NOT fire when FETCH INTO precedes the read", () => {
        const d = only(
            `
            DECLARE @x INT;
            DECLARE cur CURSOR FOR SELECT Id FROM dbo.T;
            OPEN cur;
            FETCH NEXT FROM cur INTO @x;
            SELECT @x;
            CLOSE cur;
            DEALLOCATE cur;
        `,
            DiagnosticCode.VariableUsedBeforeSet,
        );

        expect(d.length).toBe(0);
    });

    test("fires for every read before the SET, not just the first", () => {
        const d = only(
            `
            DECLARE @x INT;
            SELECT @x;
            SELECT @x;
            SET @x = 5;
        `,
            DiagnosticCode.VariableUsedBeforeSet,
        );

        expect(d.length).toBe(2);
    });

    test("does NOT fire for the implicit self-read in a compound SET (offset-based check is optimistic)", () => {
        const d = only(
            `
            DECLARE @x INT;
            SET @x += 1;
            SELECT @x;
        `,
            DiagnosticCode.VariableUsedBeforeSet,
        );

        expect(d.length).toBe(0);
    });

    test("does NOT fire when INSERT INTO @tbl precedes the read", () => {
        const d = only(
            `
            DECLARE @tbl TABLE (Id INT);
            INSERT INTO @tbl SELECT Id FROM dbo.Source;
            SELECT * FROM @tbl;
        `,
            DiagnosticCode.VariableUsedBeforeSet,
        );

        expect(d.length).toBe(0);
    });

    test("does NOT fire when DELETE FROM @tbl precedes INSERT and SELECT in a loop", () => {
        const d = only(
            `
            DECLARE @tbl TABLE (Id INT);
            WHILE 1 = 1
            BEGIN
                DELETE FROM @tbl;
                INSERT INTO @tbl SELECT Id FROM dbo.Source;
                SELECT * FROM @tbl;
            END
        `,
            DiagnosticCode.VariableUsedBeforeSet,
        );

        expect(d.length).toBe(0);
    });

    test("does NOT fire when OUTPUT INTO @tbl precedes the read", () => {
        const d = only(
            `
            DECLARE @tbl TABLE (Id INT);
            DELETE FROM dbo.Source
            OUTPUT DELETED.Id INTO @tbl;
            SELECT * FROM @tbl;
        `,
            DiagnosticCode.VariableUsedBeforeSet,
        );

        expect(d.length).toBe(0);
    });

    test("fires when @tbl is read before any INSERT/DELETE/OUTPUT write", () => {
        const d = only(
            `
            DECLARE @tbl TABLE (Id INT);
            SELECT * FROM @tbl;
            INSERT INTO @tbl SELECT Id FROM dbo.Source;
        `,
            DiagnosticCode.VariableUsedBeforeSet,
        );

        expect(d.length).toBe(1);
    });

    test("does NOT fire for TVF return variable when INSERT precedes SELECT", () => {
        const d = only(
            `
            CREATE FUNCTION dbo.Fn(@DeptId INT)
            RETURNS @result TABLE (Id INT, Name VARCHAR(50))
            AS
            BEGIN
                INSERT INTO @result SELECT Id, Name FROM Employee WHERE DeptId = @DeptId;
                SELECT * FROM @result;
                RETURN;
            END
        `,
            DiagnosticCode.VariableUsedBeforeSet,
        );

        expect(d).toHaveLength(0);
    });
});

describe("VAR005 — invalid schema-qualified table variable reference", () => {
    test("fires on schema-qualified TVP reference and points to the real fix", () => {
        const d = only(
            `
            CREATE PROCEDURE [dbo].[UpdateSomeTable]
                @UpdateSomeTable dbo.UpdateSomeTableType READONLY
            AS
            BEGIN
                SELECT dsa.Id
                FROM [dbo].[@UpdateSomeTable] dsa
            END
        `,
            DiagnosticCode.InvalidQualifiedTableVariableReference,
        );

        expect(d).toHaveLength(1);
        expect(d[0].severity).toBe("error");
        expect(d[0].message).toContain("[dbo].[@UpdateSomeTable]");
        expect(d[0].message).toContain("@UpdateSomeTable");
    });
});

// ─── DML001: UPDATE without WHERE ────────────────────────────────────────────

describe("DML001 — UPDATE without WHERE", () => {
    test("fires when WHERE is absent", () => {
        const d = only(`UPDATE Users SET Status = 1`, DiagnosticCode.UpdateWithoutWhere);
        expect(d.length).toBe(1);
        expect(d[0].severity).toBe("warning");
    });

    test("does NOT fire when WHERE is present", () => {
        const d = only(
            `UPDATE Users SET Status = 1 WHERE Id = 5`,
            DiagnosticCode.UpdateWithoutWhere,
        );
        expect(d.length).toBe(0);
    });

    test("fires inside a stored procedure body", () => {
        const d = only(
            `
            CREATE PROCEDURE dbo.Proc1
            AS BEGIN
                UPDATE Users SET Status = 0;
            END
        `,
            DiagnosticCode.UpdateWithoutWhere,
        );
        expect(d.length).toBe(1);
    });

    test("fires inside IF branch", () => {
        const d = only(`IF 1=1 UPDATE Users SET Status = 0`, DiagnosticCode.UpdateWithoutWhere);
        expect(d.length).toBe(1);
    });

    test("does NOT fire when joined FROM clause limits rows", () => {
        const d = only(
            `
            UPDATE targetRow
            SET Status = 0
            FROM dbo.Users targetRow
            JOIN dbo.AllowedUsers allowedRow
                ON allowedRow.Id = targetRow.Id
            `,
            DiagnosticCode.UpdateWithoutWhere,
        );
        expect(d.length).toBe(0);
    });

    test("diagnostic start offset points to UPDATE keyword", () => {
        const sql = `UPDATE Users SET Status = 1`;
        const d = only(sql, DiagnosticCode.UpdateWithoutWhere);
        expect(d[0].start).toBe(0);
        expect(d[0].end).toBe(6);
    });
});

// ─── DML002: DELETE without WHERE ────────────────────────────────────────────

describe("DML002 — DELETE without WHERE", () => {
    test("fires when WHERE is absent", () => {
        const d = only(`DELETE FROM Users`, DiagnosticCode.DeleteWithoutWhere);
        expect(d.length).toBe(1);
        expect(d[0].severity).toBe("warning");
    });

    test("does NOT fire when WHERE is present", () => {
        const d = only(`DELETE FROM Users WHERE Id = 1`, DiagnosticCode.DeleteWithoutWhere);
        expect(d.length).toBe(0);
    });

    test("fires inside BEGIN…END block", () => {
        const d = only(
            `
            BEGIN
                DELETE FROM Users;
            END
        `,
            DiagnosticCode.DeleteWithoutWhere,
        );
        expect(d.length).toBe(1);
    });
});

// ─── DML003: INSERT without column list ──────────────────────────────────────

describe("DML003 — INSERT without column list", () => {
    test("fires when column list is absent", () => {
        const d = only(
            `INSERT INTO Users VALUES ('Alice', 30)`,
            DiagnosticCode.InsertWithoutColumnList,
        );
        expect(d.length).toBe(1);
        expect(d[0].severity).toBe("warning");
    });

    test("does NOT fire when column list is present", () => {
        const d = only(
            `INSERT INTO Users (Name, Age) VALUES ('Alice', 30)`,
            DiagnosticCode.InsertWithoutColumnList,
        );
        expect(d.length).toBe(0);
    });

    test("fires for INSERT … SELECT without column list", () => {
        const d = only(
            `INSERT INTO Archive SELECT * FROM Users`,
            DiagnosticCode.InsertWithoutColumnList,
        );
        expect(d.length).toBe(1);
    });

    test("fires for MERGE INSERT action without column list", () => {
        const d = only(
            `MERGE dbo.Target AS T
            USING dbo.Source AS S
            ON T.Id = S.Id
            WHEN NOT MATCHED THEN INSERT VALUES (S.Name);`,
            DiagnosticCode.InsertWithoutColumnList,
        );
        expect(d.length).toBe(1);
        expect(d[0].severity).toBe("warning");
    });
});

// ─── SEL001: SELECT * ────────────────────────────────────────────────────────

describe("SEL001 — SELECT *", () => {
    test("fires on bare SELECT *", () => {
        const d = only(`SELECT * FROM Users`, DiagnosticCode.SelectStar);
        expect(d.length).toBe(1);
        expect(d[0].severity).toBe("info");
    });

    test("does NOT fire on explicit column list", () => {
        const d = only(`SELECT Id, Name FROM Users`, DiagnosticCode.SelectStar);
        expect(d.length).toBe(0);
    });

    test("fires inside CTE query", () => {
        const d = only(
            `
            WITH X AS (SELECT * FROM Users)
            SELECT Id FROM X
        `,
            DiagnosticCode.SelectStar,
        );
        expect(d.length).toBeGreaterThanOrEqual(1);
    });

    test("fires inside subquery in FROM", () => {
        const d = only(`SELECT d.Id FROM (SELECT * FROM Users) d`, DiagnosticCode.SelectStar);
        expect(d.length).toBeGreaterThanOrEqual(1);
    });

    test("fires inside INSERT SELECT query", () => {
        const d = only(
            `
            CREATE PROCEDURE dbo.LoadItems
                @InputRows dbo.ItemType READONLY
            AS
            BEGIN
                INSERT INTO dbo.Target (Id)
                SELECT *
                FROM @InputRows src;
            END
        `,
            DiagnosticCode.SelectStar,
        );
        expect(d.length).toBe(1);
    });
});

// ─── SEL002: SELECT * in view ────────────────────────────────────────────────

describe("SEL002 — SELECT * inside CREATE VIEW", () => {
    test("fires as error inside CREATE VIEW", () => {
        const d = only(
            `
            CREATE VIEW dbo.AllUsers AS
            SELECT * FROM dbo.Users
        `,
            DiagnosticCode.SelectStarInView,
        );
        expect(d.length).toBe(1);
        expect(d[0].severity).toBe("error");
    });

    test("SEL001 does NOT also fire inside a view (only SEL002)", () => {
        const all = run(`
            CREATE VIEW dbo.AllUsers AS
            SELECT * FROM dbo.Users
        `);
        const sel001 = all.filter((d) => d.code === DiagnosticCode.SelectStar);
        const sel002 = all.filter((d) => d.code === DiagnosticCode.SelectStarInView);
        expect(sel002.length).toBe(1);
        expect(sel001.length).toBe(0);
    });

    test("does NOT fire on explicit column list in view", () => {
        const d = only(
            `
            CREATE VIEW dbo.AllUsers AS
            SELECT Id, Name FROM dbo.Users
        `,
            DiagnosticCode.SelectStarInView,
        );
        expect(d.length).toBe(0);
    });

    test("fires inside CREATE VIEW when body starts with CTE", () => {
        const d = only(
            `
            CREATE VIEW dbo.AllUsers AS
            WITH X AS (
                SELECT * FROM dbo.Users
            )
            SELECT * FROM X
        `,
            DiagnosticCode.SelectStarInView,
        );
        expect(d.length).toBeGreaterThanOrEqual(1);
    });
});

// ─── DUP002: Duplicate CTE name ──────────────────────────────────────────────

describe("DUP002 — duplicate CTE name", () => {
    test("fires when two CTEs share a name", () => {
        const d = only(
            `
            WITH
                Users AS (SELECT 1 Id),
                Users AS (SELECT 2 Id)
            SELECT * FROM Users
        `,
            DiagnosticCode.DuplicateCte,
        );
        expect(d.length).toBe(1);
        expect(d[0].severity).toBe("error");
    });

    test("does NOT fire for unique CTE names", () => {
        const d = only(
            `
            WITH
                A AS (SELECT 1 x),
                B AS (SELECT 2 y)
            SELECT * FROM A JOIN B ON A.x = B.y
        `,
            DiagnosticCode.DuplicateCte,
        );
        expect(d.length).toBe(0);
    });
});

// ─── Sorting and position ─────────────────────────────────────────────────────

describe("DUP001 â€” duplicate declaration", () => {
    test("does not fire when a SELECT output alias matches a table alias", () => {
        const d = only(
            `
            SELECT
                itemBase.Code BaseCode,
                parentItem.Code
            FROM dbo.Items itemBase
            JOIN dbo.Items parentItem ON parentItem.ParentId = itemBase.Id
        `,
            DiagnosticCode.DuplicateVariable,
        );

        expect(d.length).toBe(0);
    });
});

describe("DUP003 — duplicate SELECT output alias", () => {
    test("fires as a warning when the same select alias is used twice", () => {
        const d = only(
            `
            SELECT
                (SELECT 1 FOR XML PATH('')) PlatformCodes,
                (SELECT 2 FOR XML PATH('')) PlatformCodes
        `,
            DiagnosticCode.DuplicateSelectAlias,
        );

        expect(d.length).toBe(1);
        expect(d[0].severity).toBe("warning");
    });

    test("does not also fire DUP001 for duplicate select aliases", () => {
        const d = only(
            `
            SELECT
                (SELECT 1 FOR XML PATH('')) PlatformCodes,
                (SELECT 2 FOR XML PATH('')) PlatformCodes
        `,
            DiagnosticCode.DuplicateVariable,
        );

        expect(d.length).toBe(0);
    });
});

describe("diagnostic ordering", () => {
    test("diagnostics are sorted by start offset", () => {
        const d = run(`
            SELECT @A, @B, @C FROM T
        `);
        const offsets = d.map((x) => x.start);
        expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    });
});

// ─── Combined scenarios ───────────────────────────────────────────────────────

describe("DML004 â€” UPDATE target WITH (NOLOCK)", () => {
    test("fires when update target alias uses NOLOCK in FROM", () => {
        const d = only(
            `UPDATE u SET Status = 1 FROM Users u WITH (NOLOCK) WHERE Id = 1`,
            DiagnosticCode.UpdateTargetNoLock,
        );
        expect(d.length).toBe(1);
        expect(d[0].severity).toBe("error");
    });

    test("fires when update target table uses NOLOCK in FROM", () => {
        const d = only(
            `UPDATE Users SET Status = 1 FROM Users WITH (NOLOCK) WHERE Id = 1`,
            DiagnosticCode.UpdateTargetNoLock,
        );
        expect(d.length).toBe(1);
        expect(d[0].severity).toBe("error");
    });

    test("does NOT fire when NOLOCK is on a non-target joined table", () => {
        const d = only(
            `UPDATE u SET Status = 1 FROM Users u JOIN Audit a WITH (NOLOCK) ON u.Id = a.UserId WHERE u.Id = 1`,
            DiagnosticCode.UpdateTargetNoLock,
        );
        expect(d.length).toBe(0);
    });
});

describe("COL001 â€” unknown column", () => {
    test("fires for unknown column on declared table variable alias", () => {
        const d = only(
            `
            DECLARE @Items TABLE (Id INT, Name VARCHAR(50));
            SELECT item.MissingColumn
            FROM @Items item;
        `,
            DiagnosticCode.UnknownColumn,
        );

        expect(d.length).toBe(1);
        expect(d[0].severity).toBe("warning");
        expect(d[0].message).toContain("MissingColumn");
    });

    test("fires for unknown column on PIVOT alias with known output columns", () => {
        const d = only(
            `
            SELECT pvt.UnknownBucket
            FROM (
                SELECT ProductId, RegionName, Amount
                FROM dbo.Sales
            ) src
            PIVOT (
                SUM(Amount)
                FOR RegionName IN ([North], [South])
            ) pvt;
        `,
            DiagnosticCode.UnknownColumn,
        );

        expect(d.length).toBe(1);
        expect(d[0].message).toContain("UnknownBucket");
    });

    test("fires for unknown column on UNPIVOT alias with known output columns", () => {
        const d = only(
            `
            SELECT u.DoesNotExist
            FROM (
                SELECT ProductId, Color, Size
                FROM dbo.Products
            ) src
            UNPIVOT (
                AttributeValue FOR AttributeName IN ([Color], [Size])
            ) u;
        `,
            DiagnosticCode.UnknownColumn,
        );

        expect(d.length).toBe(1);
        expect(d[0].message).toContain("DoesNotExist");
    });

    test("does NOT fire for TVP alias when shape is not known in-file", () => {
        const d = only(
            `
            CREATE PROCEDURE dbo.ImportItems
                @Items dbo.ItemType READONLY
            AS
            BEGIN
                SELECT item.MaybeMissing
                FROM @Items item;
            END
        `,
            DiagnosticCode.UnknownColumn,
        );

        expect(d.length).toBe(0);
    });

    test("does not emit COL001 UnknownColumn for date parts in DATEDIFF", () => {
        const d = run(`
            DECLARE @StartDate DATETIME = GETDATE();
            DECLARE @EndDate DATETIME = GETDATE();
            SELECT DATEDIFF(day, @StartDate, @EndDate);
        `);
        const cols = d.filter((x) => x.code === DiagnosticCode.UnknownColumn);
        expect(cols.length).toBe(0);
    });

    test("fires for unknown column on CTE alias with known output columns", () => {
        const d = only(
            `
            WITH Employees AS (SELECT Id, Name FROM dbo.Employee)
            SELECT e.MissingColumn
            FROM Employees e;
        `,
            DiagnosticCode.UnknownColumn,
        );

        expect(d.length).toBe(1);
        expect(d[0].message).toContain("MissingColumn");
    });

    test("does NOT fire for known column on CTE alias", () => {
        const d = only(
            `
            WITH Employees AS (SELECT Id, Name FROM dbo.Employee)
            SELECT e.Name
            FROM Employees e;
        `,
            DiagnosticCode.UnknownColumn,
        );

        expect(d.length).toBe(0);
    });

    test("does NOT fire for chained CTE columns visible in second CTE body", () => {
        const d = only(
            `
            WITH
                Base AS (SELECT Id, Name FROM dbo.Employee),
                Filtered AS (SELECT b.Id, b.Name FROM Base b WHERE b.Id > 0)
            SELECT f.Name
            FROM Filtered f;
        `,
            DiagnosticCode.UnknownColumn,
        );

        expect(d.length).toBe(0);
    });

    test("does NOT fire for columns accessed via recursive CTE recursive member", () => {
        const d = only(
            `
            WITH rcte AS (
                SELECT Id, Name FROM dbo.Employee WHERE ManagerId IS NULL
                UNION ALL
                SELECT e.Id, e.Name FROM dbo.Employee e JOIN rcte r ON e.ManagerId = r.Id
            )
            SELECT * FROM rcte;
        `,
            DiagnosticCode.UnknownColumn,
        );

        expect(d.length).toBe(0);
    });
});

describe("LOG001 â€” self comparison", () => {
    test("fires for identifier compared to itself", () => {
        const d = only(
            `
            SELECT *
            FROM dbo.Users
            WHERE Id = Id;
        `,
            DiagnosticCode.SelfComparison,
        );

        expect(d.length).toBe(1);
        expect(d[0].severity).toBe("warning");
    });

    test("fires for variable compared to itself", () => {
        const d = only(
            `
            DECLARE @Id INT = 1;
            SELECT *
            FROM dbo.Users
            WHERE @Id = @Id;
        `,
            DiagnosticCode.SelfComparison,
        );

        expect(d.length).toBe(1);
    });

    test("fires for qualified identifier compared to itself in UPDATE WHERE clause", () => {
        const d = only(
            `
            UPDATE u
            SET u.Id = 1
            FROM dbo.Users u
            WHERE u.Id = u.Id;
        `,
            DiagnosticCode.SelfComparison,
        );

        expect(d.length).toBe(1);
        expect(d[0].severity).toBe("warning");
    });

    test("does NOT fire when the two sides are different", () => {
        const d = only(
            `
            SELECT *
            FROM dbo.Users
            WHERE UserId = RoleId;
        `,
            DiagnosticCode.SelfComparison,
        );

        expect(d.length).toBe(0);
    });
});

describe("DDL001 â€” missing comma before table-level constraint", () => {
    test("fires when PRIMARY KEY follows the last column without a comma", () => {
        const d = only(
            `
            CREATE TABLE dbo.Items(
                Id INT,
                Name VARCHAR(50) NULL
                PRIMARY KEY CLUSTERED (Id ASC)
            )
            `,
            DiagnosticCode.MissingCommaBeforeTableConstraint,
        );

        expect(d.length).toBe(1);
        expect(d[0].severity).toBe("warning");
    });

    test("does NOT fire when table-level constraint is comma-separated", () => {
        const d = only(
            `
            CREATE TABLE dbo.Items(
                Id INT,
                Name VARCHAR(50) NULL,
                PRIMARY KEY CLUSTERED (Id ASC)
            )
            `,
            DiagnosticCode.MissingCommaBeforeTableConstraint,
        );

        expect(d.length).toBe(0);
    });

    test("does NOT fire for named inline UNIQUE and DEFAULT column constraints", () => {
        const d = only(
            `
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
            `,
            DiagnosticCode.MissingCommaBeforeTableConstraint,
        );

        expect(d.length).toBe(0);
    });
});

describe("CUR001 â€” cursor usage", () => {
    test("fires on cursor declaration", () => {
        const d = only(
            `
            DECLARE item_cursor CURSOR FOR
            SELECT Id FROM dbo.Items
            `,
            DiagnosticCode.CursorUsage,
        );

        expect(d.length).toBe(1);
        expect(d[0].severity).toBe("warning");
    });

    test("does not emit duplicate warnings for cursor lifecycle statements", () => {
        const d = only(
            `
            DECLARE item_cursor CURSOR FOR
            SELECT Id FROM dbo.Items;
            OPEN item_cursor;
            FETCH NEXT FROM item_cursor INTO @ItemId;
            CLOSE item_cursor;
            DEALLOCATE item_cursor;
            `,
            DiagnosticCode.CursorUsage,
        );

        expect(d.length).toBe(1);
    });
});

describe("HINT001 â€” table hint usage", () => {
    test("does not warn on NOLOCK by default", () => {
        const d = only(`SELECT * FROM dbo.Users WITH (NOLOCK)`, DiagnosticCode.TableHintUsage);

        expect(d).toHaveLength(0);
    });

    test("does not warn on READUNCOMMITTED by default", () => {
        const d = only(
            `SELECT * FROM dbo.Users WITH (READUNCOMMITTED)`,
            DiagnosticCode.TableHintUsage,
        );

        expect(d).toHaveLength(0);
    });

    test("does not warn on NOEXPAND by default", () => {
        const d = only(
            `SELECT * FROM dbo.IndexedSalesView WITH (NOEXPAND)`,
            DiagnosticCode.TableHintUsage,
        );

        expect(d).toHaveLength(0);
    });

    test("warns on INDEX hint with tuning alternative guidance", () => {
        const d = only(
            `SELECT * FROM dbo.Users WITH (INDEX(IX_Users_Name))`,
            DiagnosticCode.TableHintUsage,
        );

        expect(d).toHaveLength(1);
        expect(d[0].message).toContain(`specific index`);
        expect(d[0].message).toContain(`statistics`);
    });

    test("does not warn on derived table alias column lists", () => {
        const d = only(
            `
            SELECT outerRow.EmpNumbers
            FROM dbo.SourceTable sourceRow
            CROSS APPLY (
                SELECT sourceInner.Value
                FROM dbo.SourceInner sourceInner
                FOR XML PATH('')
            ) outerRow (EmpNumbers)
            `,
            DiagnosticCode.TableHintUsage,
        );

        expect(d).toHaveLength(0);
    });
});

describe("OPT001 â€” query option usage", () => {
    test("warns on OPTION(RECOMPILE)", () => {
        const d = only(
            `SELECT Name FROM dbo.Users OPTION (RECOMPILE)`,
            DiagnosticCode.QueryOptionUsage,
        );

        expect(d).toHaveLength(1);
        expect(d[0].message).toContain(`avoids plan reuse`);
        expect(d[0].message).toContain(`Query Store hints`);
    });

    test("warns on multiple option hints", () => {
        const d = only(
            `SELECT Name FROM dbo.Users OPTION (MAXDOP 1, FORCE ORDER)`,
            DiagnosticCode.QueryOptionUsage,
        );

        expect(d).toHaveLength(2);
        expect(d.some((x) => x.message.includes(`parallelism cap`))).toBe(true);
        expect(d.some((x) => x.message.includes(`join reordering freedom`))).toBe(true);
    });
});

describe("JOIN001 â€” join hint usage", () => {
    test("fires on HASH JOIN hint", () => {
        const d = only(
            `
            SELECT *
            FROM dbo.Items itemRow
            HASH JOIN dbo.Categories categoryRow ON categoryRow.Id = itemRow.CategoryId
            `,
            DiagnosticCode.JoinHintUsage,
        );

        expect(d.length).toBe(1);
        expect(d[0].severity).toBe("warning");
    });

    test("fires once per hinted join", () => {
        const d = only(
            `
            SELECT *
            FROM dbo.Items itemRow
            INNER LOOP JOIN dbo.Categories categoryRow ON categoryRow.Id = itemRow.CategoryId
            LEFT MERGE JOIN dbo.Regions regionRow ON regionRow.Id = categoryRow.RegionId
            `,
            DiagnosticCode.JoinHintUsage,
        );

        expect(d.length).toBe(2);
    });
});

describe("NAM001 - unbracketed keyword column name", () => {
    test("warns for INSERT column list using an unbracketed keyword-shaped name", () => {
        const d = only(
            `
            INSERT INTO dbo.InventoryOrgLkp
            (
                OrgId,
                OffSet
            )
            SELECT src.OrgId, src.OffSet
            FROM @InventoryRows src
            `,
            DiagnosticCode.UnbracketedKeywordColumnName,
        );

        expect(d.length).toBe(1);
        expect(d[0].severity).toBe("warning");
        expect(d[0].message).toContain("OFFSET");
    });

    test("warns for INSERT column list using OUTPUT as an unbracketed keyword-shaped name", () => {
        const d = only(
            `
            INSERT INTO dbo.InventoryOrgLkp
            (
                OrgId,
                OUTPUT
            )
            SELECT src.OrgId, src.OUTPUT
            FROM @InventoryRows src
            `,
            DiagnosticCode.UnbracketedKeywordColumnName,
        );

        expect(d.length).toBe(1);
        expect(d[0].severity).toBe("warning");
        expect(d[0].message).toContain("OUTPUT");
    });

    test("warns for CREATE TABLE column using an unbracketed keyword-shaped name", () => {
        const d = only(
            `
            CREATE TABLE dbo.InventoryOrgLkp
            (
                Id INT,
                OffSet VARCHAR(50)
            )
            `,
            DiagnosticCode.UnbracketedKeywordColumnName,
        );

        expect(d.length).toBe(1);
        expect(d[0].message).toContain("OFFSET");
    });

    test("does not warn for bracketed keyword column names", () => {
        const d = only(
            `
            CREATE TABLE dbo.InventoryOrgLkp
            (
                [OffSet] VARCHAR(50)
            )
            `,
            DiagnosticCode.UnbracketedKeywordColumnName,
        );

        expect(d.length).toBe(0);
    });
});

describe("joined DML without WHERE", () => {
    test("UPDATE without WHERE does NOT fire when joined FROM clause limits rows", () => {
        const d = only(
            `
            UPDATE targetRow
            SET Status = 0
            FROM dbo.Users targetRow
            JOIN dbo.AllowedUsers allowedRow
                ON allowedRow.Id = targetRow.Id
            `,
            DiagnosticCode.UpdateWithoutWhere,
        );

        expect(d.length).toBe(0);
    });

    test("DELETE without WHERE does NOT fire when joined FROM clause limits rows", () => {
        const d = only(
            `
            DELETE targetRow
            FROM dbo.Users targetRow
            JOIN dbo.AllowedUsers allowedRow
                ON allowedRow.Id = targetRow.Id
        `,
            DiagnosticCode.DeleteWithoutWhere,
        );

        expect(d.length).toBe(0);
    });
});

describe("combined real-world scenarios", () => {
    test("dangerous proc: UPDATE without WHERE + unused param", () => {
        const d = run(`
            CREATE PROCEDURE dbo.DangerProc
                @Id INT,
                @Unused VARCHAR(50)
            AS BEGIN
                UPDATE Users SET Status = 0;
            END
        `);
        const codes = d.map((x) => x.code);
        expect(codes).toContain(DiagnosticCode.UpdateWithoutWhere);
        expect(codes).toContain(DiagnosticCode.UnusedParameter);
    });

    test("clean proc produces no diagnostics", () => {
        const d = run(`
            CREATE PROCEDURE dbo.CleanProc
                @Id INT
            AS BEGIN
                UPDATE Users SET Status = 1 WHERE Id = @Id;
            END
        `);
        expect(d.length).toBe(0);
    });

    test("multiple DML issues in one script", () => {
        const d = run(`
            UPDATE Orders SET Total = 0;
            DELETE FROM Logs;
            INSERT INTO Archive VALUES (1, 'test');
        `);
        const codes = d.map((x) => x.code);
        expect(codes).toContain(DiagnosticCode.UpdateWithoutWhere);
        expect(codes).toContain(DiagnosticCode.DeleteWithoutWhere);
        expect(codes).toContain(DiagnosticCode.InsertWithoutColumnList);
    });
});

describe("DDL002 - unnamed key constraint", () => {
    test("fires for inline unnamed PRIMARY KEY constraint", () => {
        const d = only(
            `
            CREATE TABLE dbo.MissedKafkaLogs(
                Id INT IDENTITY PRIMARY KEY,
                RequestId VARCHAR(100) NULL
            )
            `,
            DiagnosticCode.UnnamedKeyConstraint,
        );

        expect(d.length).toBe(1);
        expect(d[0].severity).toBe("warning");
        expect(d[0].message).toContain("PRIMARY KEY");
    });

    test("does not fire for named table-level PRIMARY KEY constraint", () => {
        const d = only(
            `
            CREATE TABLE dbo.MissedKafkaLogs(
                Id INT NOT NULL,
                CONSTRAINT PK_MissedKafkaLogs PRIMARY KEY (Id)
            )
            `,
            DiagnosticCode.UnnamedKeyConstraint,
        );

        expect(d.length).toBe(0);
    });
});

describe("DDL003 - unnamed default constraint", () => {
    test("fires for inline unnamed DEFAULT constraint", () => {
        const d = only(
            `
            CREATE TABLE dbo.MissedKafkaLogs(
                CreatedOnUTC DATETIME NOT NULL DEFAULT GETUTCDATE()
            )
            `,
            DiagnosticCode.UnnamedDefaultConstraint,
        );

        expect(d.length).toBe(1);
        expect(d[0].severity).toBe("warning");
        expect(d[0].message).toContain("DEFAULT");
    });

    test("does not fire for named inline DEFAULT constraint", () => {
        const d = only(
            `
            CREATE TABLE dbo.MissedKafkaLogs(
                CreatedOnUTC DATETIME CONSTRAINT DF_MissedKafkaLogs_CreatedOnUTC DEFAULT GETUTCDATE() NOT NULL
            )
            `,
            DiagnosticCode.UnnamedDefaultConstraint,
        );

        expect(d.length).toBe(0);
    });

    test("fires for unnamed ALTER TABLE ADD DEFAULT constraint", () => {
        const d = only(
            `
            ALTER TABLE dbo.MissedKafkaLogs
            ADD DEFAULT (GETUTCDATE()) FOR CreatedOnUTC
            `,
            DiagnosticCode.UnnamedDefaultConstraint,
        );

        expect(d.length).toBe(1);
    });
});

describe("inline table indexes in CREATE TABLE", () => {
    test("do not trigger keyword-column diagnostics", () => {
        const d = only(
            `
            CREATE TABLE [dbo].[ItemsSelected]
            (
                [Id] BIGINT IDENTITY(1,1) NOT NULL,
                [ItemsId] BIGINT,
                [ContextId] BIGINT,
                CONSTRAINT [PK_ItemsSelected] PRIMARY KEY CLUSTERED ([Id] ASC),
                INDEX NC_ItemsSelected_ContextId_ItemsId NONCLUSTERED ([ContextId], [ItemsId])
            )
            `,
            DiagnosticCode.UnbracketedKeywordColumnName,
        );

        expect(d.length).toBe(0);
    });
});

describe("DUP001 batch separators", () => {
    test("does not fire across GO batch separators", () => {
        const d = only(
            `
            DECLARE @ID INT = 20
            GO
            DECLARE @ID INT = 30
        `,
            DiagnosticCode.DuplicateVariable,
        );

        expect(d.length).toBe(0);
    });
});

// ─── DDL004: CREATE/ALTER PROC|FUNCTION|VIEW|TRIGGER must be first in batch ──

describe("DDL004 — CREATE must be the first statement in a batch", () => {
    test("fires when CREATE PROCEDURE follows another statement in the same batch", () => {
        const d = only(
            `
            SELECT 1;
            CREATE PROCEDURE dbo.Proc1
            AS BEGIN
                SELECT 1;
            END
        `,
            DiagnosticCode.CreateMustBeFirstInBatch,
        );

        expect(d.length).toBe(1);
        expect(d[0].severity).toBe("error");
    });

    test("fires for CREATE VIEW, CREATE FUNCTION, and CREATE TRIGGER", () => {
        expect(
            only(
                `
            SELECT 1;
            CREATE VIEW dbo.V1 AS SELECT 1 AS Col1;
        `,
                DiagnosticCode.CreateMustBeFirstInBatch,
            ).length,
        ).toBe(1);

        expect(
            only(
                `
            SELECT 1;
            CREATE FUNCTION dbo.Fn1() RETURNS INT AS BEGIN RETURN 1 END
        `,
                DiagnosticCode.CreateMustBeFirstInBatch,
            ).length,
        ).toBe(1);

        expect(
            only(
                `
            SELECT 1;
            CREATE TRIGGER dbo.Trg1 ON dbo.Users AFTER INSERT AS BEGIN SELECT 1 END
        `,
                DiagnosticCode.CreateMustBeFirstInBatch,
            ).length,
        ).toBe(1);
    });

    test("fires for ALTER PROCEDURE too", () => {
        const d = only(
            `
            SELECT 1;
            ALTER PROCEDURE dbo.Proc1
            AS BEGIN
                SELECT 1;
            END
        `,
            DiagnosticCode.CreateMustBeFirstInBatch,
        );

        expect(d.length).toBe(1);
    });

    test("does NOT fire when CREATE PROCEDURE is the only statement", () => {
        const d = only(
            `
            CREATE PROCEDURE dbo.Proc1
            AS BEGIN
                SELECT 1;
            END
        `,
            DiagnosticCode.CreateMustBeFirstInBatch,
        );

        expect(d.length).toBe(0);
    });

    test("does NOT fire when the preceding statement is in a different batch (GO)", () => {
        const d = only(
            `
            SELECT 1;
            GO
            CREATE PROCEDURE dbo.Proc1
            AS BEGIN
                SELECT 1;
            END
        `,
            DiagnosticCode.CreateMustBeFirstInBatch,
        );

        expect(d.length).toBe(0);
    });

    test("does NOT fire when only preceded by SET ANSI_NULLS / SET QUOTED_IDENTIFIER (common SSMS scripting pattern)", () => {
        const d = only(
            `
            SET ANSI_NULLS ON
            SET QUOTED_IDENTIFIER ON
            CREATE PROCEDURE dbo.Proc1
            AS BEGIN
                SELECT 1;
            END
        `,
            DiagnosticCode.CreateMustBeFirstInBatch,
        );

        expect(d.length).toBe(0);
    });

    test("does NOT fire for CREATE TABLE preceded by another statement (no such restriction)", () => {
        const d = only(
            `
            SELECT 1;
            CREATE TABLE dbo.T1 (Id INT);
        `,
            DiagnosticCode.CreateMustBeFirstInBatch,
        );

        expect(d.length).toBe(0);
    });

    test("fires on the second CREATE PROCEDURE when two are scripted in the same batch", () => {
        const d = only(
            `
            CREATE PROCEDURE dbo.Proc1 AS BEGIN SELECT 1; END
            CREATE PROCEDURE dbo.Proc2 AS BEGIN SELECT 2; END
        `,
            DiagnosticCode.CreateMustBeFirstInBatch,
        );

        expect(d.length).toBe(1);
    });
});
