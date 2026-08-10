import { type IfNode, type UnaryExpression } from "../../src/parser/saral/ast/types.js";
import { parseOne, parseBody, expectSql } from "./parser.helpers";

describe("T-SQL Parser - IF / ELSE / BEGIN / END", () => {
    describe("IF conditions", () => {
        test("simple comparison condition", () => {
            const stmt = parseOne<any>(`
                IF @Id = 1
                    SELECT 1
            `);

            expect(stmt.type).toBe("IfStatement");

            expectSql(stmt.condition, "@Id = 1");

            expect(stmt.thenBranch.type).toBe("SelectStatement");
        });

        test("condition with parentheses", () => {
            const stmt = parseOne<any>(`
                IF (@Id = 1)
                    SELECT 1
            `);

            expectSql(stmt.condition, "(@Id = 1)");

            expect(stmt.incomplete).toBeUndefined();
        });

        test("complex boolean condition", () => {
            const stmt = parseOne<any>(`
                IF @A = 1 AND (@B = 2 OR @C = 3)
                    SELECT 1
            `);

            expectSql(stmt.condition, "@A = 1 AND (@B = 2 OR @C = 3)");

            expect(stmt.incomplete).toBeUndefined();
        });

        test("EXISTS condition", () => {
            const stmt = parseOne<any>(`
        IF EXISTS (
            SELECT 1
            FROM Users
        )
            SELECT 1
    `);

            expect(stmt.condition.type).toBe("ExistsExpression");

            expect(stmt.condition.query.type).toBe("SelectStatement");

            expect(stmt.thenBranch.type).toBe("SelectStatement");
        });

        test("NOT EXISTS condition", () => {
            const stmt = parseOne<any>(`
                IF NOT EXISTS (
                    SELECT 1
                    FROM Users
                )
                    SELECT 0
            `);

            expect(stmt.condition).toBeDefined();

            expect(stmt.incomplete).toBeUndefined();
        });
    });

    describe("THEN branches", () => {
        test("single SELECT statement", () => {
            const stmt = parseOne<any>(`
                IF @Id = 1
                    SELECT 1
            `);

            expect(stmt.thenBranch.type).toBe("SelectStatement");
        });

        test("single SET statement", () => {
            const stmt = parseOne<any>(`
                IF @Id = 1
                    SET @X = 2
            `);

            expect(stmt.thenBranch.type).toBe("SetStatement");
        });

        test("BEGIN END block with multiple statements", () => {
            const stmt = parseOne<any>(`
                IF @Id = 1
                BEGIN
                    SELECT 1;
                    SET @X = 2;
                    PRINT 'Hello';
                END
            `);

            expect(stmt.thenBranch.type).toBe("BlockStatement");

            expect(stmt.thenBranch.body).toHaveLength(3);

            expect(stmt.thenBranch.body[0].type).toBe("SelectStatement");

            expect(stmt.thenBranch.body[1].type).toBe("SetStatement");

            expect(stmt.thenBranch.body[2].type).toBe("PrintStatement");
        });

        test("nested BEGIN END blocks", () => {
            const stmt = parseOne<any>(`
                BEGIN
                    BEGIN
                        BEGIN
                            SELECT 1
                        END
                    END
                END
            `);

            expect(stmt.type).toBe("BlockStatement");

            const level1 = stmt.body[0];

            const level2 = level1.body[0];

            expect(level1.type).toBe("BlockStatement");

            expect(level2.type).toBe("BlockStatement");

            expect(level2.body[0].type).toBe("SelectStatement");
        });
    });

    describe("ELSE branches", () => {
        test("ELSE with single statement", () => {
            const stmt = parseOne<any>(`
                IF @Id = 1
                    SELECT 1
                ELSE
                    SELECT 2
            `);

            expect(stmt.elseBranch).toBeDefined();

            expect(stmt.elseBranch.type).toBe("SelectStatement");
        });

        test("ELSE with BEGIN END block", () => {
            const stmt = parseOne<any>(`
                IF @Id = 1
                    SELECT 1
                ELSE
                BEGIN
                    SELECT 2;
                    PRINT 'No';
                END
            `);

            expect(stmt.elseBranch.type).toBe("BlockStatement");

            expect(stmt.elseBranch.body).toHaveLength(2);
        });

        test("ELSE IF chain", () => {
            const stmt = parseOne<any>(`
                IF @A = 1
                    SELECT 1
                ELSE IF @A = 2
                    SELECT 2
                ELSE IF @A = 3
                    SELECT 3
                ELSE
                    SELECT 4
            `);

            expect(stmt.type).toBe("IfStatement");

            const elseIf1 = stmt.elseBranch;

            expect(elseIf1.type).toBe("IfStatement");

            const elseIf2 = elseIf1.elseBranch;

            expect(elseIf2.type).toBe("IfStatement");

            expect(elseIf2.elseBranch).toBeDefined();
        });

        test("nested IF inside ELSE", () => {
            const stmt = parseOne<any>(`
                IF @A = 1
                    SELECT 1
                ELSE
                BEGIN
                    IF @B = 2
                        SELECT 2
                    ELSE
                        SELECT 3
                END
            `);

            expect(stmt.elseBranch.type).toBe("BlockStatement");

            const inner = stmt.elseBranch.body[0];

            expect(inner.type).toBe("IfStatement");
        });
    });

    describe("offset tracking", () => {
        test("IF node has valid offsets", () => {
            const stmt = parseOne<any>(`
                IF @Id = 1
                    SELECT 1
            `);

            expect(stmt.start).toBeLessThan(stmt.end);

            expect(stmt.condition.start).toBeGreaterThanOrEqual(stmt.start);

            expect(stmt.thenBranch.end).toBeLessThanOrEqual(stmt.end);
        });

        test("BEGIN END block has valid offsets", () => {
            const stmt = parseOne<any>(`
                BEGIN
                    SELECT 1
                END
            `);

            expect(stmt.start).toBeLessThan(stmt.end);

            expect(stmt.body[0].start).toBeGreaterThan(stmt.start);
        });
    });

    describe("recoverability", () => {
        test("missing END", () => {
            const stmt = parseOne<any>(`
                BEGIN
                    SELECT 1
            `);

            expect(stmt.incomplete).toBe(true);
        });

        test("missing THEN statement", () => {
            const stmt = parseOne<any>(`
                IF @Id = 1
            `);

            expect(stmt.incomplete).toBe(true);
        });

        test("missing ELSE statement", () => {
            const stmt = parseOne<any>(`
                IF @Id = 1
                    SELECT 1
                ELSE
            `);

            expect(stmt.incomplete).toBe(true);
        });

        test("broken IF condition", () => {
            const stmt = parseOne<any>(`
                IF @Id =
                    SELECT 1
            `);

            //console.log(JSON.stringify(stmt, null, 2));

            expect(stmt.incomplete).toBe(true);
        });

        test("broken nested IF recovers", () => {
            const body = parseBody(`
                IF @A = 1
                BEGIN
                    IF @B =
                        SELECT 1
                END

                SELECT 2
            `);

            expect(body.length).toBeGreaterThanOrEqual(2);

            expect(body[1].type).toBe("SelectStatement");
        });

        test("broken BEGIN block recovers", () => {
            const body = parseBody(`
                BEGIN
                    SELECT
                END

                SELECT 2
            `);

            expect(body.length).toBeGreaterThanOrEqual(2);

            expect(body[1].type).toBe("SelectStatement");
        });

        test("ELSE IF malformed chain recovers", () => {
            const stmt = parseOne<any>(`
                IF @A = 1
                    SELECT 1
                ELSE IF
                    SELECT 2
            `);

            expect(stmt.incomplete).toBe(true);
        });
    });

    describe("real-world control flow", () => {
        test("typical validation flow", () => {
            const stmt = parseOne<any>(`
                IF EXISTS (
                    SELECT 1
                    FROM Users
                    WHERE Id = @Id
                )
                BEGIN
                    UPDATE Users
                    SET Name = 'Updated'
                    WHERE Id = @Id
                END
                ELSE
                BEGIN
                    INSERT INTO Users (Id, Name)
                    VALUES (@Id, 'New')
                END
            `);

            expect(stmt.type).toBe("IfStatement");

            expect(stmt.thenBranch.type).toBe("BlockStatement");

            expect(stmt.elseBranch.type).toBe("BlockStatement");

            expect(stmt.incomplete).toBeUndefined();
        });
    });

    test("CASE with ISNULL assignment expression", () => {
        const stmt = parseOne<any>(`
        SELECT
            @Var1 =
                CASE
                    WHEN ISNULL(@Var, '') = ''
                        THEN @Var2
                    ELSE Var1
                END
    `);

        expect(stmt.type).toBe("SelectStatement");

        expect(stmt.columns).toHaveLength(1);

        const col = stmt.columns[0];

        expect(col.expression.type).toBe("BinaryExpression");

        const assign = col.expression;

        expect(assign.operator).toBe("=");

        expect(assign.left.type).toBe("Variable");

        expect(assign.right.type).toBe("CaseExpression");

        const caseExpr = assign.right;

        expect(caseExpr.branches.length).toBe(1);

        const whenExpr = caseExpr.branches[0].when;

        expect(whenExpr.type).toBe("BinaryExpression");

        expect(whenExpr.operator).toBe("=");

        expect(whenExpr.left.type).toBe("FunctionCall");

        expect(whenExpr.left.name).toBe("ISNULL");

        expect(caseExpr.branches[0].then.type).toBe("Variable");

        expect(caseExpr.elseBranch.type).toBe("Identifier");

        expect(stmt.incomplete).toBeUndefined();
    });

    test("CASE expression does not poison next statement", () => {
        const body = parseBody(`
        SET @Var1 =
            CASE
                WHEN ISNULL(@Var, '') = ''
                    THEN @Var2
                ELSE Var1
            END

        SELECT 1
    `);

        expect(body.length).toBeGreaterThanOrEqual(2);

        expect(body[0].type).toBe("SetStatement");

        expect(body[1].type).toBe("SelectStatement");
    });

    test("CASE followed by IF NOT EXISTS", () => {
        const body = parseBody(`
        SELECT @Var1 =
            CASE
                WHEN ISNULL(@Var, '') = ''
                    THEN @Var2
                ELSE Var1
            END

        IF NOT EXISTS (
            SELECT TOP 1 1
            FROM MyTable
            WHERE Column1 = @Var1
        )
        BEGIN
            SELECT 1
        END
    `);

        expect(body.length).toBeGreaterThanOrEqual(2);

        expect(body[0].type).toBe("SelectStatement");

        expect(body[1].type).toBe("IfStatement");

        const ifStmt = body[1] as IfNode;

        const condition = ifStmt.condition as UnaryExpression;

        expect(condition.type).toBe("UnaryExpression");

        expect(condition.operator).toBe("NOT");

        expect(condition.right!.type).toBe("ExistsExpression");
    });

    test("should handle IF...ELSE", () => {
        const sql = `IF 1=1 PRINT 'A' ELSE PRINT 'B'`;
        expect(parseOne<IfNode>(sql).elseBranch).toBeDefined();
    });

    test("should handle BEGIN...END", () => {
        const sql = `BEGIN PRINT 'A'; PRINT 'B'; END`;
        expect(parseOne<any>(sql).body).toHaveLength(2);
    });
});
