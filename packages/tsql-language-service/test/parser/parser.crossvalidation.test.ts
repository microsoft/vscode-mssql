import { parseBody, parseOne, parseResult } from "./parser.helpers";

function parseLocalSourceResult(sql: string) {
    return parseResult(sql);
}

describe("T-SQL Parser - Cross Validation / Real World Quirks", () => {
    test("DECLARE AS variations parse successfully", () => {
        const body = parseBody(`
            DECLARE @Id AS INT
            DECLARE @Name AS VARCHAR(100) = 'John'
            DECLARE @Now DATETIME = GETDATE()

            SELECT 1
        `);

        expect(body.length).toBeGreaterThanOrEqual(4);

        expect(body[0].type).toBe("DeclareStatement");

        expect(body[1].type).toBe("DeclareStatement");

        expect(body[2].type).toBe("DeclareStatement");

        expect(body[3].type).toBe("SelectStatement");
    });

    test("DECLARE TABLE AS parses successfully", () => {
        const stmt = parseOne<any>(`
            DECLARE @Users AS TABLE (
                Id INT PRIMARY KEY,
                Name VARCHAR(100),
                CreatedAt DATETIME
            )
        `);

        expect(stmt.type).toBe("DeclareStatement");

        expect(stmt.variables[0].dataType).toBe("TABLE");

        expect(stmt.variables[0].columns).toHaveLength(3);

        expect(stmt.incomplete).toBeUndefined();
    });

    test("CASE followed by IF NOT EXISTS parses correctly", () => {
        const body = parseBody(`
            SELECT
                @Var1 =
                    CASE
                        WHEN ISNULL(@Var, '') = ''
                            THEN @Var2
                        ELSE Var1
                    END

            IF NOT EXISTS (
                SELECT TOP 1 1
                FROM Users
                WHERE Id = @Var1
            )
            BEGIN
                SELECT 1
            END
        `);

        expect(body.length).toBeGreaterThanOrEqual(2);

        expect(body[0].type).toBe("SelectStatement");

        expect(body[1].type).toBe("IfStatement");
    });

    test("nested CASE expressions parse correctly", () => {
        const stmt = parseOne<any>(`
            SELECT
                CASE
                    WHEN @Id = 1 THEN
                        CASE
                            WHEN @Name = 'John'
                                THEN 'Admin'
                            ELSE 'User'
                        END
                    ELSE 'Unknown'
                END AS RoleName
        `);

        expect(stmt.type).toBe("SelectStatement");

        expect(stmt.columns).toHaveLength(1);

        expect(stmt.columns[0].expression.type).toBe("CaseExpression");
    });

    test("EXISTS and NOT EXISTS parse correctly", () => {
        const body = parseBody(`
            SELECT 1
            WHERE EXISTS (
                SELECT 1
            )

            SELECT 1
            WHERE NOT EXISTS (
                SELECT 1
            )
        `);

        expect(body.length).toBeGreaterThanOrEqual(2);

        const first = body[0] as any;

        const second = body[1] as any;

        expect(first.where.type).toBe("ExistsExpression");

        expect(second.where.type).toBe("UnaryExpression");

        expect(second.where.operator).toBe("NOT");

        expect(second.where.right.type).toBe("ExistsExpression");
    });

    test("window functions parse successfully", () => {
        const stmt = parseOne<any>(`
            SELECT
                ROW_NUMBER() OVER (
                    PARTITION BY Name
                    ORDER BY Id
                ) AS RowNum
            FROM Users
        `);

        expect(stmt.type).toBe("SelectStatement");

        expect(stmt.incomplete).toBeUndefined();
    });

    test("CTE followed by SELECT parses correctly", () => {
        const body = parseBody(`
            WITH UserCTE AS (
                SELECT
                    Id,
                    Name
                FROM Users
            )
            SELECT *
            FROM UserCTE
        `);

        expect(body.length).toBeGreaterThanOrEqual(1);

        expect(body[0].type).toBe("WithStatement");
    });

    test("MERGE statement parses successfully", () => {
        const stmt = parseOne<any>(`
            MERGE TargetTable AS T
            USING SourceTable AS S
                ON T.Id = S.Id
            WHEN MATCHED THEN
                UPDATE SET
                    T.Name = S.Name
            WHEN NOT MATCHED THEN
                INSERT (Id, Name)
                VALUES (S.Id, S.Name);
        `);

        expect(stmt.type).toBe("MergeStatement");

        expect(stmt.incomplete).toBeUndefined();
    });

    test("TRY CATCH block parses successfully", () => {
        const stmt = parseOne<any>(`
            BEGIN TRY
                SELECT 1 / 0
            END TRY
            BEGIN CATCH
                SELECT ERROR_MESSAGE()
            END CATCH
        `);

        expect(stmt.type).toBe("TryCatchStatement");

        expect(stmt.incomplete).toBeUndefined();
    });

    test("transaction statements parse successfully", () => {
        const body = parseBody(`
            BEGIN TRAN

            UPDATE Users
            SET Name = 'Updated'
            WHERE Id = 1

            COMMIT TRAN
        `);

        console.log(JSON.stringify(body, null, 2));

        expect(body.length).toBeGreaterThanOrEqual(3);

        expect(body[0].type).toBe("TransactionStatement");

        expect(body[1].type).toBe("UpdateStatement");

        expect(body[2].type).toBe("TransactionStatement");
    });

    test("CROSS APPLY parses successfully", () => {
        const stmt = parseOne<any>(`
            SELECT *
            FROM Users u
            CROSS APPLY (
                SELECT TOP 1 1 AS X
            ) a
        `);

        expect(stmt.type).toBe("SelectStatement");

        expect(stmt.incomplete).toBeUndefined();
    });

    test("complex real-world mixed script parses successfully", () => {
        const result = parseResult(`
            DECLARE @Id AS INT = 1

            IF NOT EXISTS (
                SELECT TOP 1 1
                FROM Users
                WHERE Id = @Id
            )
            BEGIN
                INSERT INTO Users (
                    Id,
                    Name
                )
                VALUES (
                    @Id,
                    'John'
                )
            END

            SELECT
                CASE
                    WHEN @Id = 1
                        THEN 'Admin'
                    ELSE 'User'
                END AS RoleName
        `);

        expect(result.ast.body.length).toBeGreaterThanOrEqual(3);

        expect(result.issues!.length).toBe(0);

        for (const stmt of result.ast.body) {
            expect(stmt.type).not.toBe("ErrorStatement");

            expect("incomplete" in stmt ? stmt.incomplete : undefined).toBeUndefined();
        }
    });

    test("large real-world mixed workload parses under 60ms with zero issues", () => {
        const sqlParts: string[] = [];

        // -------------------------------------------------
        // Generate ~1500+ lines of mixed T-SQL
        // -------------------------------------------------

        for (let i = 0; i < 120; i++) {
            sqlParts.push(`
            DECLARE @Id${i} AS INT = ${i}
            DECLARE @Name${i} AS VARCHAR(100) = 'User${i}'

            IF NOT EXISTS (
                SELECT TOP 1 1
                FROM Users u
                WHERE u.Id = @Id${i}
            )
            BEGIN
                INSERT INTO Users (
                    Id,
                    Name,
                    CreatedAt
                )
                VALUES (
                    @Id${i},
                    @Name${i},
                    GETDATE()
                )
            END
            ELSE
            BEGIN
                UPDATE Users
                SET
                    Name =
                        CASE
                            WHEN ISNULL(@Name${i}, '') = ''
                                THEN 'Unknown'
                            ELSE @Name${i}
                        END,
                    ModifiedAt = GETDATE()
                WHERE Id = @Id${i}
            END

            SELECT
                u.Id,
                u.Name,
                CASE
                    WHEN u.Id % 2 = 0
                        THEN 'Even'
                    ELSE 'Odd'
                END AS Category,
                ROW_NUMBER() OVER (
                    PARTITION BY u.Name
                    ORDER BY u.Id
                ) AS RowNum
            FROM Users u
            WHERE EXISTS (
                SELECT 1
                FROM Orders o
                WHERE o.UserId = u.Id
            )

            WITH UserCTE AS (
                SELECT
                    Id,
                    Name
                FROM Users
                WHERE Id = @Id${i}
            )
            SELECT *
            FROM UserCTE

            BEGIN TRANSACTION

            UPDATE Users
            SET Name = 'Updated${i}'
            WHERE Id = @Id${i}

            COMMIT TRANSACTION
        `);
        }

        const sql = sqlParts.join("\n");

        console.log("Generated SQL lines:", sql.split("\n").length);

        // Warm the vendored parser once so the timing reflects the runtime
        // parser rather than one-off module/JIT startup.
        const warmup = parseLocalSourceResult(sql);

        expect(warmup.issues!.length).toBe(0);

        const samples: number[] = [];
        let result = warmup;

        for (let i = 0; i < 7; i++) {
            const start = performance.now();

            result = parseLocalSourceResult(sql);

            const elapsed = performance.now() - start;

            samples.push(elapsed);
        }

        const sorted = [...samples].sort((a, b) => a - b);

        const trimmed = sorted.slice(0, -2);

        const elapsed = trimmed[Math.floor(trimmed.length / 2)];

        console.log(
            "Parse samples:",
            samples.map((x) => x.toFixed(2)),
        );

        console.log(
            "Trimmed parse samples:",
            trimmed.map((x) => x.toFixed(2)),
        );

        console.log("Median parse time:", elapsed.toFixed(2), "ms");

        console.log("Statements:", result.ast.body.length);

        console.log("Issues:", result.issues!.length);

        if (result.issues!.length > 0) {
            console.log(JSON.stringify(result.issues!.slice(0, 20), null, 2));
        }

        // -------------------------------------------------
        // Assertions
        // -------------------------------------------------

        expect(elapsed).toBeLessThan(60);

        expect(result.issues!.length).toBe(0);

        expect(result.ast.body.length).toBeGreaterThan(500);

        for (const stmt of result.ast.body) {
            expect(stmt.type).not.toBe("ErrorStatement");

            expect((stmt as any).incomplete).toBeUndefined();
        }
    });
});
