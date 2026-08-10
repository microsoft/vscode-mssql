import { parseOne, parseBody } from "./parser.helpers";

describe("T-SQL Parser - CASE / IF Integration & Recoverability", () => {
    // ---------------------------------------------------------
    // SIMPLE CASE
    // ---------------------------------------------------------

    describe("Simple CASE", () => {
        test("simple CASE assignment", () => {
            const stmt = parseOne<any>(`
                SELECT
                    @Var =
                        CASE @Id
                            WHEN 1 THEN 'One'
                            WHEN 2 THEN 'Two'
                            ELSE 'Other'
                        END
            `);

            expect(stmt.type).toBe("SelectStatement");

            const col = stmt.columns[0];

            // Assignment expression:
            // @Var = CASE ...
            expect(col.expression.type).toBe("BinaryExpression");

            const caseExpr = col.expression.right;

            expect(caseExpr.type).toBe("CaseExpression");

            expect(caseExpr.input).toBeDefined();

            expect(caseExpr.branches.length).toBe(2);

            expect(caseExpr.elseBranch).toBeDefined();
        });

        test("simple CASE followed by SELECT", () => {
            const body = parseBody(`
                SELECT
                    CASE @Id
                        WHEN 1 THEN 'A'
                        ELSE 'B'
                    END;

                SELECT 1;
            `);

            expect(body.length).toBeGreaterThanOrEqual(2);

            expect(body[0].type).toBe("SelectStatement");

            expect(body[1].type).toBe("SelectStatement");
        });

        test("nested simple CASE", () => {
            const stmt = parseOne<any>(`
                SELECT
                    CASE @A
                        WHEN 1 THEN
                            CASE @B
                                WHEN 2 THEN 'X'
                                ELSE 'Y'
                            END
                        ELSE 'Z'
                    END
            `);

            const expr = stmt.columns[0].expression;

            expect(expr.type).toBe("CaseExpression");

            expect(expr.branches[0].then.type).toBe("CaseExpression");
        });
    });

    // ---------------------------------------------------------
    // SEARCHED CASE
    // ---------------------------------------------------------

    describe("Searched CASE", () => {
        test("searched CASE inside SELECT", () => {
            const stmt = parseOne<any>(`
                SELECT
                    CASE
                        WHEN Score > 90 THEN 'A'
                        WHEN Score > 80 THEN 'B'
                        ELSE 'C'
                    END AS Grade
                FROM Students
            `);

            expect(stmt.type).toBe("SelectStatement");

            const expr = stmt.columns[0].expression;

            expect(expr.type).toBe("CaseExpression");

            expect(expr.branches.length).toBe(2);
        });

        test("searched CASE followed by SELECT", () => {
            const body = parseBody(`
                SELECT
                    CASE
                        WHEN @Id = 1 THEN 'One'
                        ELSE 'Other'
                    END;

                SELECT 2;
            `);

            expect(body.length).toBeGreaterThanOrEqual(2);

            expect(body[1].type).toBe("SelectStatement");
        });

        test("nested searched CASE", () => {
            const stmt = parseOne<any>(`
                SELECT
                    CASE
                        WHEN @A = 1 THEN
                            CASE
                                WHEN @B = 2 THEN 'X'
                                ELSE 'Y'
                            END
                        ELSE 'Z'
                    END
            `);

            const expr = stmt.columns[0].expression;

            expect(expr.type).toBe("CaseExpression");

            expect(expr.branches[0].then.type).toBe("CaseExpression");
        });

        test("CASE expressions preserve parser position", () => {
            const body = parseBody(`
                SELECT
                    CASE
                        WHEN @A = 1 THEN 'A'
                        ELSE 'B'
                    END;

                IF @A = 1
                    SELECT 1;
            `);

            expect(body.length).toBeGreaterThanOrEqual(2);

            expect(body[0].type).toBe("SelectStatement");

            expect(body[1].type).toBe("IfStatement");
        });
    });

    // ---------------------------------------------------------
    // IF + CASE
    // ---------------------------------------------------------

    describe("IF with CASE expressions", () => {
        test("CASE inside IF condition", () => {
            const stmt = parseOne<any>(`
                IF (
                    CASE
                        WHEN @Id = 1 THEN 1
                        ELSE 0
                    END
                ) = 1
                    SELECT 1
            `);

            expect(stmt.type).toBe("IfStatement");

            expect(stmt.thenBranch.type).toBe("SelectStatement");

            expect(stmt.incomplete).toBeUndefined();
        });

        test("simple CASE inside IF condition", () => {
            const stmt = parseOne<any>(`
                IF (
                    CASE @Id
                        WHEN 1 THEN 1
                        ELSE 0
                    END
                ) = 1
                    SELECT 1
            `);

            expect(stmt.type).toBe("IfStatement");

            expect(stmt.condition).toBeDefined();

            expect(stmt.incomplete).toBeUndefined();
        });

        test("IF ELSE with CASE assignment", () => {
            const stmt = parseOne<any>(`
                IF @Id = 1
                BEGIN
                    SELECT
                        @Result =
                            CASE
                                WHEN Score > 90 THEN 'A'
                                ELSE 'B'
                            END
                END
                ELSE
                BEGIN
                    SELECT 'No Result'
                END
            `);

            expect(stmt.type).toBe("IfStatement");

            expect(stmt.thenBranch.type).toBe("BlockStatement");

            expect(stmt.elseBranch.type).toBe("BlockStatement");

            expect(stmt.incomplete).toBeUndefined();
        });

        test("ELSE IF chain with CASE", () => {
            const stmt = parseOne<any>(`
                IF @A = 1
                    SELECT
                        CASE
                            WHEN @B = 1 THEN 'X'
                            ELSE 'Y'
                        END
                ELSE IF @A = 2
                    SELECT 2
                ELSE
                    SELECT 3
            `);

            expect(stmt.type).toBe("IfStatement");

            expect(stmt.elseBranch).toBeDefined();

            expect(stmt.incomplete).toBeUndefined();
        });
    });

    // ---------------------------------------------------------
    // RECOVERABILITY
    // ---------------------------------------------------------

    describe("Recoverability", () => {
        test("broken CASE still recovers next statement", () => {
            const body = parseBody(`
                SELECT
                    CASE
                        WHEN @A = 1 THEN
                    END;

                SELECT 1;
            `);

            expect(body.length).toBeGreaterThanOrEqual(2);

            expect(body[1].type).toBe("SelectStatement");
        });

        test("broken IF condition marks incomplete", () => {
            const stmt = parseOne<any>(`
                IF @Id =
                    SELECT 1
            `);

            expect(stmt.type).toBe("IfStatement");

            expect(stmt.incomplete).toBe(true);
        });

        test("ELSE IF malformed chain marks incomplete", () => {
            const stmt = parseOne<any>(`
                IF @Id = 1
                    SELECT 1
                ELSE IF
                    SELECT 2
            `);

            expect(stmt.type).toBe("IfStatement");

            expect(stmt.incomplete).toBe(true);
        });

        test("broken nested CASE recovers", () => {
            const body = parseBody(`
                SELECT
                    CASE
                        WHEN @A = 1 THEN
                            CASE
                                WHEN @B = 2 THEN
                            END
                        ELSE 'X'
                    END;

                SELECT 5;
            `);

            expect(body.length).toBeGreaterThanOrEqual(2);

            // Recovery may emit ErrorStatement first,
            // but parser must continue.
            expect(body.some((x) => x.type === "SelectStatement")).toBe(true);
        });

        test("CASE END boundary preserved before IF", () => {
            const body = parseBody(`
                SELECT
                    CASE
                        WHEN @A = 1 THEN 'A'
                        ELSE 'B'
                    END;

                IF @A = 1
                    SELECT 1;
            `);

            expect(body.length).toBeGreaterThanOrEqual(2);

            expect(body[1].type).toBe("IfStatement");
        });

        test("CASE END boundary preserved before BEGIN", () => {
            const body = parseBody(`
                SELECT
                    CASE
                        WHEN @A = 1 THEN 'A'
                        ELSE 'B'
                    END;

                BEGIN
                    SELECT 1;
                END
            `);

            expect(body.length).toBeGreaterThanOrEqual(2);

            expect(body[1].type).toBe("BlockStatement");
        });
    });
});
