import { parseOne, parseAst, expectSql } from "./parser.helpers";

describe("T-SQL Parser - EXEC / EXECUTE", () => {
    test("should parse simple EXEC proc", () => {
        const stmt = parseOne<any>(`
            EXEC dbo.uspGet
        `);

        expect(stmt.type).toBe("ExecuteStatement");
        expectSql(stmt.target, "dbo.uspGet");
        expect(stmt.args).toHaveLength(0);
    });

    test("should parse EXECUTE proc", () => {
        const stmt = parseOne<any>(`
            EXECUTE dbo.uspGet
        `);

        expect(stmt.type).toBe("ExecuteStatement");
        expectSql(stmt.target, "dbo.uspGet");
        expect(stmt.args).toHaveLength(0);
    });

    test("should parse EXEC variable target", () => {
        const stmt = parseOne<any>(`
            EXEC @ProcName
        `);

        expect(stmt.type).toBe("ExecuteStatement");
        expect(stmt.target.type).toBe("Variable");
        expect(stmt.target.name).toBe("@ProcName");
        expect(stmt.args).toHaveLength(0);
    });

    test("should parse EXEC dynamic SQL", () => {
        const stmt = parseOne<any>(`
            EXEC(@sql)
        `);

        expect(stmt.type).toBe("ExecuteStatement");
        expect(stmt.target.type).toBe("Variable");
        expect(stmt.target.name).toBe("@sql");
        expect(stmt.args).toHaveLength(0);
    });

    test("should parse EXEC dynamic SQL expression", () => {
        const stmt = parseOne<any>(`
            EXEC(@sql + @suffix)
        `);

        expect(stmt.type).toBe("ExecuteStatement");
        expectSql(stmt.target, "@sql + @suffix");
        expect(stmt.args).toHaveLength(0);
    });

    test("should parse EXEC single positional arg", () => {
        const stmt = parseOne<any>(`
            EXEC dbo.uspGet 1
        `);

        expect(stmt.type).toBe("ExecuteStatement");
        expectSql(stmt.target, "dbo.uspGet");

        expect(stmt.args).toHaveLength(1);
        expect(stmt.args[0].name).toBeUndefined();
        expectSql(stmt.args[0].value, "1");
    });

    test("should parse EXEC multiple positional args", () => {
        const stmt = parseOne<any>(`
            EXEC dbo.uspGet 1, 'abc', @Name
        `);

        expect(stmt.args).toHaveLength(3);

        expectSql(stmt.args[0].value, "1");
        expectSql(stmt.args[1].value, `'abc'`);
        expectSql(stmt.args[2].value, "@Name");
    });

    test("should parse EXEC single named arg", () => {
        const stmt = parseOne<any>(`
            EXEC dbo.uspGet @Id = 1
        `);

        expect(stmt.args).toHaveLength(1);

        expect(stmt.args[0].name).toBe("@Id");
        expectSql(stmt.args[0].value, "1");
    });

    test("should parse EXEC multiple named args", () => {
        const stmt = parseOne<any>(`
            EXEC dbo.uspGet
                @Id = 1,
                @Name = 'Saral',
                @Flag = @Enabled
        `);

        expect(stmt.args).toHaveLength(3);

        expect(stmt.args[0].name).toBe("@Id");
        expectSql(stmt.args[0].value, "1");

        expect(stmt.args[1].name).toBe("@Name");
        expectSql(stmt.args[1].value, `'Saral'`);

        expect(stmt.args[2].name).toBe("@Flag");
        expectSql(stmt.args[2].value, "@Enabled");
    });

    test("should parse EXEC mixed positional and named args", () => {
        const stmt = parseOne<any>(`
            EXEC dbo.uspGet
                1,
                'abc',
                @Id = 10
        `);

        expect(stmt.args).toHaveLength(3);

        expect(stmt.args[0].name).toBeUndefined();
        expectSql(stmt.args[0].value, "1");

        expect(stmt.args[1].name).toBeUndefined();
        expectSql(stmt.args[1].value, `'abc'`);

        expect(stmt.args[2].name).toBe("@Id");
        expectSql(stmt.args[2].value, "10");
    });

    test("should parse EXEC arithmetic arg", () => {
        const stmt = parseOne<any>(`
            EXEC dbo.uspGet @Id = 1 + 2 * 3
        `);

        expect(stmt.args).toHaveLength(1);
        expectSql(stmt.args[0].value, "1 + 2 * 3");
    });

    test("should parse EXEC function arg", () => {
        const stmt = parseOne<any>(`
            EXEC dbo.uspGet LEN(@Name)
        `);

        expect(stmt.args).toHaveLength(1);
        expect(stmt.args[0].value.type).toBe("FunctionCall");
    });

    test("should parse EXEC output variable arg", () => {
        const stmt = parseOne<any>(`
            EXEC dbo.uspGet @Result OUTPUT
        `);

        expect(stmt.args).toHaveLength(1);
        expectSql(stmt.args[0].value, "@Result");
        expect(stmt.args[0].isOutput).toBe(true);
    });

    test("should parse sp_executesql", () => {
        const stmt = parseOne<any>(`
            EXEC sp_executesql @sql, @params
        `);

        expect(stmt.type).toBe("ExecuteStatement");
        expectSql(stmt.target, "sp_executesql");

        expect(stmt.args).toHaveLength(2);
        expectSql(stmt.args[0].value, "@sql");
        expectSql(stmt.args[1].value, "@params");
    });

    test("should parse sp_executesql named args", () => {
        const stmt = parseOne<any>(`
            EXEC sp_executesql
                @stmt = @sql,
                @params = @paramDef
        `);

        expect(stmt.args).toHaveLength(2);

        expect(stmt.args[0].name).toBe("@stmt");
        expectSql(stmt.args[0].value, "@sql");

        expect(stmt.args[1].name).toBe("@params");
        expectSql(stmt.args[1].value, "@paramDef");
    });

    test("should parse EXEC inside IF", () => {
        const ast = parseAst(`
            IF @Run = 1
                EXEC dbo.uspGet @Id = 1
        `);

        const ifStmt = ast.body[0] as any;

        const branch = Array.isArray(ifStmt.thenBranch) ? ifStmt.thenBranch[0] : ifStmt.thenBranch;

        expect(branch.type).toBe("ExecuteStatement");
        expectSql(branch.target, "dbo.uspGet");
        expect(branch.args).toHaveLength(1);
    });

    test("should parse EXEC inside BEGIN END block", () => {
        const ast = parseAst(`
            BEGIN
                EXEC dbo.uspGet
            END
        `);

        const block = ast.body[0] as any;

        expect(block.type).toBe("BlockStatement");
        expect(block.body).toHaveLength(1);
        expect(block.body[0].type).toBe("ExecuteStatement");
    });

    test("should recover missing close paren in EXEC()", () => {
        const stmt = parseOne<any>(`
            EXEC(@sql
        `);

        expect(stmt.type).toBe("ExecuteStatement");
        expect(stmt.incomplete).toBe(true);
    });

    test("should recover missing target", () => {
        const stmt = parseOne<any>(`
            EXEC
        `);

        expect(stmt.type).toBe("ExecuteStatement");
        expect(stmt.incomplete).toBe(true);
    });

    test("should recover missing named arg value", () => {
        const stmt = parseOne<any>(`
            EXEC dbo.uspGet @Id =
        `);

        expect(stmt.type).toBe("ExecuteStatement");
        expect(stmt.incomplete).toBe(true);
    });
});
