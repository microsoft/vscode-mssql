import { parseOne } from "./parser.helpers";

import { Parser } from "../../src/parser/saral/parser/parser.js";
import { Lexer } from "../../src/parser/saral/parser/lexer.js";

describe("T-SQL Parser - TRY / CATCH / THROW / BREAK / CONTINUE", () => {
    describe("TRY / CATCH", () => {
        test("simple try catch", () => {
            const stmt = parseOne<any>(`
                BEGIN TRY
                    SELECT 1;
                END TRY
                BEGIN CATCH
                    SELECT 2;
                END CATCH
            `);

            expect(stmt.type).toBe("TryCatchStatement");

            expect(stmt.tryBlock.body).toHaveLength(1);

            expect(stmt.tryBlock.body[0].type).toBe("SelectStatement");

            expect(stmt.catchBlock.body).toHaveLength(1);

            expect(stmt.catchBlock.body[0].type).toBe("SelectStatement");
        });

        test("multiple statements in try and catch", () => {
            const stmt = parseOne<any>(`
                BEGIN TRY
                    PRINT 'A';
                    SELECT 1;
                    RETURN;
                END TRY
                BEGIN CATCH
                    PRINT 'B';
                    THROW;
                END CATCH
            `);

            expect(stmt.tryBlock.body).toHaveLength(3);

            expect(stmt.catchBlock.body).toHaveLength(2);

            expect(stmt.catchBlock.body[1].type).toBe("ThrowStatement");
        });

        test("nested block inside TRY", () => {
            const stmt = parseOne<any>(`
                BEGIN TRY
                    BEGIN
                        SELECT 1;
                    END
                END TRY
                BEGIN CATCH
                    PRINT 'X';
                END CATCH
            `);

            expect(stmt.tryBlock.body).toHaveLength(1);

            expect(stmt.tryBlock.body[0].type).toBe("BlockStatement");
        });

        test("TRY does not swallow following statement", () => {
            const sql = `
                BEGIN TRY
                    SELECT 1;
                END TRY
                BEGIN CATCH
                    SELECT 2;
                END CATCH;

                SELECT 3;
            `;

            const parser = new Parser(new Lexer(sql));

            const ast = parser.parse().ast;

            expect(ast.body).toHaveLength(2);

            expect(ast.body[0].type).toBe("TryCatchStatement");

            expect(ast.body[1].type).toBe("SelectStatement");
        });

        test("TRY block stops exactly at END TRY", () => {
            const stmt = parseOne<any>(`
                BEGIN TRY
                    SELECT 1;
                END TRY
                BEGIN CATCH
                    SELECT 2;
                    SELECT 3;
                END CATCH
            `);

            expect(stmt.tryBlock.body).toHaveLength(1);

            expect(stmt.catchBlock.body).toHaveLength(2);
        });

        test("TRY block continues after TRUNCATE statement semicolon", () => {
            const stmt = parseOne<any>(`
                BEGIN TRY
                    BEGIN TRAN;
                    TRUNCATE TABLE dbo.WorkQueue;
                    INSERT INTO dbo.WorkQueue (Id)
                    SELECT Id
                    FROM @PendingRows;
                    COMMIT TRAN;
                END TRY
                BEGIN CATCH
                    IF @@TRANCOUNT > 0
                        ROLLBACK TRAN;
                    THROW;
                END CATCH
            `);

            expect(stmt.type).toBe("TryCatchStatement");

            expect(stmt.tryBlock.body.map((x: any) => x.type)).toEqual([
                "TransactionStatement",
                "TruncateStatement",
                "InsertStatement",
                "TransactionStatement",
            ]);

            expect(stmt.catchBlock.body.map((x: any) => x.type)).toEqual([
                "IfStatement",
                "ThrowStatement",
            ]);
        });

        test("stored procedure with TVP, TRUNCATE, INSERT, and THROW parses without issues", () => {
            const sql = `
                CREATE PROCEDURE dbo.RefreshLookupCodes
                (
                    @LookupCodes LookupCodeTableType READONLY
                )
                AS
                BEGIN
                    SET NOCOUNT ON;
                    SET XACT_ABORT ON;

                    BEGIN TRY
                        BEGIN TRAN;

                        TRUNCATE TABLE dbo.LookupCode;

                        INSERT INTO dbo.LookupCode
                        (
                            LookupCode,
                            [Description],
                            SortOrder
                        )
                        SELECT LookupCode,
                               [Description],
                               SortOrder
                        FROM @LookupCodes;

                        COMMIT TRAN;
                    END TRY
                    BEGIN CATCH
                        IF @@TRANCOUNT > 0
                            ROLLBACK TRAN;

                        THROW;
                    END CATCH
                END
                GO
            `;

            const result = new Parser(new Lexer(sql)).parse();

            expect(result.issues).toEqual([]);
        });

        test("missing END CATCH recovers", () => {
            const stmt = parseOne<any>(`
                BEGIN TRY
                    SELECT 1;
                END TRY
                BEGIN CATCH
                    SELECT 2;
            `);

            expect(stmt.type).toBe("TryCatchStatement");

            expect(stmt.incomplete).toBe(true);
        });
    });

    describe("THROW", () => {
        test("bare THROW", () => {
            const stmt = parseOne<any>(`
                THROW;
            `);

            expect(stmt.type).toBe("ThrowStatement");

            expect(stmt.errorNumber).toBeUndefined();
        });

        test("THROW with arguments", () => {
            const stmt = parseOne<any>(`
                THROW 50001,
                      'Something failed',
                      1;
            `);

            expect(stmt.type).toBe("ThrowStatement");

            expect(stmt.errorNumber).toBeDefined();

            expect(stmt.message).toBeDefined();

            expect(stmt.state).toBeDefined();
        });

        test("partial THROW recovers", () => {
            const stmt = parseOne<any>(`
                THROW 50001;
            `);

            expect(stmt.type).toBe("ThrowStatement");

            expect(stmt.incomplete).toBe(true);
        });
    });

    describe("BREAK", () => {
        test("BREAK statement", () => {
            const stmt = parseOne<any>(`
                BREAK;
            `);

            expect(stmt.type).toBe("BreakStatement");
        });

        test("BREAK inside WHILE block", () => {
            const stmt = parseOne<any>(`
                WHILE 1 = 1
                BEGIN
                    BREAK;
                END
            `);

            expect(stmt.type).toBe("WhileStatement");

            expect(stmt.body.body[0].type).toBe("BreakStatement");
        });
    });

    describe("CONTINUE", () => {
        test("CONTINUE statement", () => {
            const stmt = parseOne<any>(`
                CONTINUE;
            `);

            expect(stmt.type).toBe("ContinueStatement");
        });

        test("CONTINUE inside WHILE block", () => {
            const stmt = parseOne<any>(`
                WHILE 1 = 1
                BEGIN
                    CONTINUE;
                END
            `);

            expect(stmt.type).toBe("WhileStatement");

            expect(stmt.body.body[0].type).toBe("ContinueStatement");
        });
    });

    describe("continuation / recovery", () => {
        test("broken TRY still continues", () => {
            const sql = `
                BEGIN TRY
                    SELECT 1;
                SELECT 2;
            `;

            const parser = new Parser(new Lexer(sql));

            const ast = parser.parse().ast;

            expect(ast.body.length).toBeGreaterThanOrEqual(1);
        });

        test("THROW does not swallow next statement", () => {
            const sql = `
                THROW 50001, 'X', 1;
                SELECT 1;
            `;

            const parser = new Parser(new Lexer(sql));

            const ast = parser.parse().ast;

            expect(ast.body).toHaveLength(2);

            expect(ast.body[0].type).toBe("ThrowStatement");

            expect(ast.body[1].type).toBe("SelectStatement");
        });
    });
});
