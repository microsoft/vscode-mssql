import { parseOne, parseAst, parseResult, expectSql } from "./parser.helpers";

describe("T-SQL Parser - RETURN", () => {
    test("should parse bare RETURN", () => {
        const stmt = parseOne<any>(`RETURN`);

        expect(stmt.type).toBe("ReturnStatement");
        expect(stmt.value).toBeNull();
        expect(stmt.incomplete).toBeUndefined();
    });

    test("should parse RETURN literal", () => {
        const stmt = parseOne<any>(`RETURN 1`);

        expect(stmt.type).toBe("ReturnStatement");
        expectSql(stmt.value, "1");
    });

    test("should parse RETURN string literal", () => {
        const stmt = parseOne<any>(`RETURN 'done'`);

        expect(stmt.type).toBe("ReturnStatement");
        expectSql(stmt.value, `'done'`);
    });

    test("should parse RETURN variable", () => {
        const stmt = parseOne<any>(`RETURN @Result`);

        expect(stmt.type).toBe("ReturnStatement");
        expect(stmt.value.type).toBe("Variable");
        expect(stmt.value.name).toBe("@Result");
    });

    test("should parse RETURN arithmetic expression", () => {
        const stmt = parseOne<any>(`RETURN 1 + 2 * 3`);

        expect(stmt.type).toBe("ReturnStatement");
        expectSql(stmt.value, "1 + 2 * 3");
    });

    test("should parse RETURN grouping expression", () => {
        const stmt = parseOne<any>(`RETURN (1 + 2) * 3`);

        expect(stmt.type).toBe("ReturnStatement");
        expectSql(stmt.value, "(1 + 2) * 3");
    });

    test("should parse RETURN function call", () => {
        const stmt = parseOne<any>(`RETURN LEN(@Name)`);

        expect(stmt.type).toBe("ReturnStatement");
        expectSql(stmt.value, "LEN(@Name)");
    });

    test("should parse RETURN CASE expression", () => {
        const stmt = parseOne<any>(`
            RETURN CASE
                WHEN @Flag = 1 THEN 100
                ELSE 0
            END
        `);

        expect(stmt.type).toBe("ReturnStatement");
        expectSql(stmt.value, "CASE WHEN @Flag = 1 THEN 100 ELSE 0 END");
    });

    test("should parse RETURN in IF branch", () => {
        const ast = parseAst(`
            IF @X = 1
                RETURN 10
        `);

        const ifStmt = ast.body[0] as any;

        expect(ifStmt.type).toBe("IfStatement");

        const branch = Array.isArray(ifStmt.thenBranch) ? ifStmt.thenBranch[0] : ifStmt.thenBranch;

        expect(branch.type).toBe("ReturnStatement");
        expectSql(branch.value, "10");
    });

    test("should parse RETURN inside BEGIN END block", () => {
        const ast = parseAst(`
            BEGIN
                RETURN 5
            END
        `);

        const block = ast.body[0] as any;

        expect(block.type).toBe("BlockStatement");
        expect(block.body).toHaveLength(1);
        expect(block.body[0].type).toBe("ReturnStatement");
        expectSql(block.body[0].value, "5");
    });

    test("should parse bare RETURN before END inside validation blocks", () => {
        const result = parseResult(`
            CREATE PROCEDURE dbo.ValidateInput
                @Value INT
            AS
            BEGIN
                IF @Value <= 0
                BEGIN
                    RAISERROR('Value must be greater than 0', 16, 1)
                    RETURN
                END
            END
        `);

        expect(result.issues).toHaveLength(0);
        expect(result.ast.body).toHaveLength(1);
    });

    test("should terminate SET DATEFIRST before following SELECT without semicolon", () => {
        const result = parseResult(`
            SET DATEFIRST 6
            SELECT @WeeklyBucketStartDate = DATEADD(dd, (8 - DATEPART(dw, @refDateTime)), @refDateTime) + 14
        `);

        expect(result.issues).toHaveLength(0);
        expect(result.ast.body).toHaveLength(2);
        expect(result.ast.body[0].type).toBe("SetStatement");
        expect(result.ast.body[1].type).toBe("SelectStatement");
    });

    test("should continue procedure body parsing after leading semicolon statements", () => {
        const result = parseResult(`
            CREATE PROCEDURE dbo.HasLooseSemicolon
            AS
            ;
            SELECT 1;
            PRINT 'done';
        `);

        expect(result.issues).toHaveLength(0);
        expect(result.ast.body).toHaveLength(1);

        const create = result.ast.body[0];
        expect(create.type).toBe("CreateStatement");

        if (create.type !== "CreateStatement" || !Array.isArray(create.body)) {
            throw new Error("Expected CreateStatement with statement body");
        }

        expect(create.body.some((stmt) => stmt.type === "SelectStatement")).toBe(true);
        expect(create.body.some((stmt) => stmt.type === "PrintStatement")).toBe(true);
    });

    test("should parse GOTO statement", () => {
        const stmt = parseOne<any>(`GOTO ExitLabel`);

        expect(stmt.type).toBe("GotoStatement");
        expect(stmt.label).toBe("ExitLabel");
    });

    test("should parse label statement", () => {
        const stmt = parseOne<any>(`ExitLabel:`);

        expect(stmt.type).toBe("LabelStatement");
        expect(stmt.name).toBe("ExitLabel");
    });

    test("should parse GOTO and label inside procedure block", () => {
        const result = parseResult(`
            CREATE PROCEDURE dbo.SkipWork
            AS
            BEGIN
                IF @ShouldSkip = 1
                    GOTO ExitLabel;

                SELECT 1 AS WorkValue;

                ExitLabel:
                RETURN 0;
            END
        `);

        expect(result.issues).toHaveLength(0);

        const create = result.ast.body[0] as any;
        const block = create.body[0];

        expect(block.type).toBe("BlockStatement");
        expect(block.body[0].type).toBe("IfStatement");
        expect(block.body[0].thenBranch.type).toBe("GotoStatement");
        expect(block.body.some((s: any) => s.type === "LabelStatement")).toBe(true);
    });

    test("should parse label followed by statement on same line", () => {
        const ast = parseAst(`
            BEGIN
                RetryLabel: SELECT 1 AS AttemptValue;
            END
        `);

        const block = ast.body[0] as any;
        expect(block.body[0].type).toBe("LabelStatement");
        expect(block.body[1].type).toBe("SelectStatement");
    });

    test("should parse label named END after an END block terminator", () => {
        const result = parseResult(`
            SELECT TOP 1 Name
            FROM Table1

            IF (@@ROWCOUNT > 0)
            BEGIN
                GOTO END
            END

            END:
        `);

        expect(result.issues).toEqual([]);
        expect(result.ast.body[result.ast.body.length - 1].type).toBe("LabelStatement");
    });

    test("should not treat GOTO or labels as implicit aliases after FROM", () => {
        const result = parseResult(`
            DECLARE @ID INT

            SELECT TOP 1 @ID = Id
            FROM dbo.Table

            IF (@ID = 1)
            BEGIN
                GOTO Somewhere
            END

            SELECT TOP 1 Id
            FROM Table1

            GOTO SomewhereElse

            SELECT TOP 1 Id
            FROM Table1

            Somewhere:

            SELECT TOP 1 Address
            FROM Table1

            SomewhereElse:
        `);

        expect(result.issues).toEqual([]);
        expect(result.ast.body.some((s: any) => s.type === "GotoStatement")).toBe(true);
        expect(result.ast.body.filter((s: any) => s.type === "LabelStatement")).toHaveLength(2);
    });

    test("should not consume a following label as a transaction name", () => {
        const result = parseResult(`
            COMMIT TRANSACTION
            GOTO EndSave
            QuitWithRollback:
                IF (@@TRANCOUNT > 0) ROLLBACK TRANSACTION
            EndSave:
        `);

        expect(result.issues).toEqual([]);
        expect(result.ast.body.filter((s: any) => s.type === "LabelStatement")).toHaveLength(2);
    });

    test("should parse WAITFOR TIME", () => {
        const stmt = parseOne<any>(`WAITFOR TIME '22:30:00'`);

        expect(stmt.type).toBe("WaitForStatement");
        expect(stmt.kind).toBe("TIME");
        expectSql(stmt.value, `'22:30:00'`);
    });

    test("should parse WAITFOR DELAY", () => {
        const stmt = parseOne<any>(`WAITFOR DELAY '00:00:05'`);

        expect(stmt.type).toBe("WaitForStatement");
        expect(stmt.kind).toBe("DELAY");
        expectSql(stmt.value, `'00:00:05'`);
    });

    test("should parse WAITFOR inside procedure block", () => {
        const result = parseResult(`
            CREATE PROCEDURE dbo.PauseWork
            AS
            BEGIN
                WAITFOR DELAY '00:00:01';
                WAITFOR TIME '23:59:59';
            END
        `);

        expect(result.issues).toHaveLength(0);

        const create = result.ast.body[0] as any;
        const block = create.body[0];

        expect(block.type).toBe("BlockStatement");
        expect(block.body[0].type).toBe("WaitForStatement");
        expect(block.body[0].kind).toBe("DELAY");
        expect(block.body[1].type).toBe("WaitForStatement");
        expect(block.body[1].kind).toBe("TIME");
    });

    test("should recover missing WAITFOR mode", () => {
        const stmt = parseOne<any>(`WAITFOR '00:00:05'`);

        expect(stmt.type).toBe("WaitForStatement");
        expect(stmt.incomplete).toBe(true);
    });

    test("should recover missing WAITFOR value", () => {
        const stmt = parseOne<any>(`WAITFOR DELAY`);

        expect(stmt.type).toBe("WaitForStatement");
        expect(stmt.incomplete).toBe(true);
    });

    test("should parse DECLARE CURSOR FOR SELECT", () => {
        const stmt = parseOne<any>(`
            DECLARE item_cursor CURSOR LOCAL FAST_FORWARD
            FOR
            SELECT Id, Name FROM dbo.Items
        `);

        expect(stmt.type).toBe("DeclareCursorStatement");
        expect(stmt.name).toBe("item_cursor");
        expect(stmt.options).toEqual(["LOCAL", "FAST_FORWARD"]);
        expect(stmt.query.type).toBe("SelectStatement");
    });

    test("should parse cursor lifecycle statements", () => {
        const result = parseResult(`
            CREATE PROCEDURE dbo.ProcessItems
            AS
            BEGIN
                DECLARE item_cursor CURSOR FOR
                SELECT Id FROM dbo.Items;
                OPEN item_cursor;
                FETCH NEXT FROM item_cursor INTO @ItemId;
                CLOSE item_cursor;
                DEALLOCATE item_cursor;
            END
        `);

        expect(result.issues).toHaveLength(0);

        const create = result.ast.body[0] as any;
        const block = create.body[0];

        expect(block.body[0].type).toBe("DeclareCursorStatement");
        expect(block.body[1].type).toBe("OpenCursorStatement");
        expect(block.body[2].type).toBe("FetchCursorStatement");
        expect(block.body[2].direction).toBe("NEXT");
        expect(block.body[2].name).toBe("item_cursor");
        expect(block.body[2].into).toEqual(["@ItemId"]);
        expect(block.body[3].type).toBe("CloseCursorStatement");
        expect(block.body[4].type).toBe("DeallocateCursorStatement");
    });

    test("should parse cursor-variable lifecycle statements (SET @c = CURSOR FOR ...)", () => {
        const result = parseResult(`
            CREATE PROCEDURE dbo.ProcessItems
            AS
            BEGIN
                DECLARE @ItemCursor CURSOR;
                SET @ItemCursor = CURSOR FOR
                    SELECT Id FROM dbo.Items;
                OPEN @ItemCursor;
                FETCH NEXT FROM @ItemCursor INTO @ItemId;
                CLOSE @ItemCursor;
                DEALLOCATE @ItemCursor;
            END
        `);

        expect(result.issues).toHaveLength(0);

        const create = result.ast.body[0] as any;
        const block = create.body[0];

        expect(block.body[0].type).toBe("DeclareStatement");
        expect(block.body[1].type).toBe("SetStatement");
        expect(block.body[1].cursorQuery.type).toBe("SelectStatement");
        expect(block.body[2].type).toBe("OpenCursorStatement");
        expect(block.body[2].name).toBe("@ItemCursor");
        expect(block.body[3].type).toBe("FetchCursorStatement");
        expect(block.body[3].name).toBe("@ItemCursor");
        expect(block.body[3].into).toEqual(["@ItemId"]);
        expect(block.body[4].type).toBe("CloseCursorStatement");
        expect(block.body[4].name).toBe("@ItemCursor");
        expect(block.body[5].type).toBe("DeallocateCursorStatement");
        expect(block.body[5].name).toBe("@ItemCursor");
    });

    test("should parse FETCH ABSOLUTE cursor statement", () => {
        const stmt = parseOne<any>(`FETCH ABSOLUTE 5 FROM item_cursor INTO @ItemId`);

        expect(stmt.type).toBe("FetchCursorStatement");
        expect(stmt.direction).toBe("ABSOLUTE");
        expectSql(stmt.offset, "5");
    });

    test("should parse keyword function call in SET inside conditional block", () => {
        const result = parseResult(`
            CREATE PROCEDURE dbo.NormalizeRuleId
                @RuleId VARCHAR(100)
            AS
            BEGIN
                DECLARE @BaseRuleId VARCHAR(100) = @RuleId;

                IF (@RuleId LIKE '%_REGION')
                BEGIN
                    SET @BaseRuleId = LEFT(@RuleId, CHARINDEX('_', @RuleId) - 1)
                END
            END
        `);

        expect(result.issues).toHaveLength(0);
        expect(result.ast.body).toHaveLength(1);
    });
});

describe("T-SQL Parser - RAISERROR", () => {
    test("should parse RAISERROR with standard 3 args", () => {
        const stmt = parseOne<any>(`
            RAISERROR('bad', 16, 1)
        `);

        expect(stmt.type).toBe("RaiseErrorStatement");
        expect(stmt.args).toHaveLength(3);

        expectSql(stmt.args[0], `'bad'`);
        expectSql(stmt.args[1], "16");
        expectSql(stmt.args[2], "1");

        expect(stmt.options).toBeUndefined();
    });

    test("should parse RAISERROR variable message", () => {
        const stmt = parseOne<any>(`
            RAISERROR(@msg, 16, 1)
        `);

        expect(stmt.type).toBe("RaiseErrorStatement");
        expect(stmt.args).toHaveLength(3);

        expect(stmt.args[0].type).toBe("Variable");
        expect(stmt.args[0].name).toBe("@msg");
    });

    test("should parse RAISERROR function argument", () => {
        const stmt = parseOne<any>(`
            RAISERROR(FORMATMESSAGE('bad %d', @Id), 16, 1)
        `);

        expect(stmt.type).toBe("RaiseErrorStatement");
        expect(stmt.args).toHaveLength(3);

        expect(stmt.args[0].type).toBe("FunctionCall");
    });

    test("should parse RAISERROR arithmetic argument", () => {
        const stmt = parseOne<any>(`
            RAISERROR(@Msg, 10 + 6, 1)
        `);

        expect(stmt.type).toBe("RaiseErrorStatement");
        expect(stmt.args).toHaveLength(3);

        expectSql(stmt.args[1], "10 + 6");
    });

    test("should parse RAISERROR WITH NOWAIT", () => {
        const stmt = parseOne<any>(`
            RAISERROR('bad', 16, 1) WITH NOWAIT
        `);

        expect(stmt.type).toBe("RaiseErrorStatement");
        expect(stmt.options).toEqual(["NOWAIT"]);
    });

    test("should parse RAISERROR WITH LOG", () => {
        const stmt = parseOne<any>(`
            RAISERROR('bad', 16, 1) WITH LOG
        `);

        expect(stmt.options).toEqual(["LOG"]);
    });

    test("should parse RAISERROR WITH multiple options", () => {
        const stmt = parseOne<any>(`
            RAISERROR('bad', 16, 1)
            WITH LOG, NOWAIT, SETERROR
        `);

        expect(stmt.options).toEqual(["LOG", "NOWAIT", "SETERROR"]);
    });

    test("should parse RAISERROR inside IF", () => {
        const ast = parseAst(`
            IF @X = 1
                RAISERROR('bad',16,1)
        `);

        const ifStmt = ast.body[0] as any;

        const branch = Array.isArray(ifStmt.thenBranch) ? ifStmt.thenBranch[0] : ifStmt.thenBranch;

        expect(branch.type).toBe("RaiseErrorStatement");
        expect(branch.args).toHaveLength(3);
    });

    test("should parse RAISERROR inside BEGIN END block", () => {
        const ast = parseAst(`
            BEGIN
                RAISERROR('bad',16,1)
            END
        `);

        const block = ast.body[0] as any;

        expect(block.type).toBe("BlockStatement");
        expect(block.body).toHaveLength(1);
        expect(block.body[0].type).toBe("RaiseErrorStatement");
    });

    test("should recover missing closing paren", () => {
        const stmt = parseOne<any>(`
            RAISERROR('bad',16,1
        `);

        expect(stmt.type).toBe("RaiseErrorStatement");
        expect(stmt.incomplete).toBe(true);
    });

    test("should recover empty WITH clause", () => {
        const stmt = parseOne<any>(`
            RAISERROR('bad',16,1) WITH
        `);

        expect(stmt.type).toBe("RaiseErrorStatement");
        expect(stmt.incomplete).toBe(true);
    });

    test("should recover missing opening paren", () => {
        const stmt = parseOne<any>(`
            RAISERROR 'bad',16,1
        `);

        expect(stmt.type).toBe("RaiseErrorStatement");
        expect(stmt.incomplete).toBe(true);
    });
});
