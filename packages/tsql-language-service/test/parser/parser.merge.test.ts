import { Lexer } from "../../src/parser/saral/parser/lexer.js";
import { type LiteralNode } from "../../src/parser/saral/ast/types.js";
import { Parser } from "../../src/parser/saral/parser/parser.js";

describe("T-SQL Parser - MERGE Statement", () => {
    const parse = (sql: string) => {
        const lexer = new Lexer(sql);
        const parser = new Parser(lexer);
        return parser.parse().ast;
    };

    test("should preserve source casing for MERGE target multipart identifier", () => {
        const sql = `MERGE dbo.Target AS T
USING dbo.Source AS S
ON T.Id = S.Id
WHEN MATCHED THEN UPDATE SET Name = S.Name;`;
        const stmt = parse(sql).body[0] as any;

        expect(stmt.target?.type).toBe("Identifier");
        expect(stmt.target?.name).toBe("dbo.Target");
        expect(stmt.target?.parts).toEqual(["dbo", "Target"]);
    });

    test("should parse MERGE with UPDATE and INSERT actions", () => {
        const sql = `MERGE dbo.Target AS T
USING dbo.Source AS S
ON T.Id = S.Id
WHEN MATCHED THEN UPDATE SET Name = S.Name
WHEN NOT MATCHED THEN INSERT (Name) VALUES (S.Name);`;
        const ast = parse(sql);
        const stmt = ast.body[0] as any;

        expect(stmt.type).toBe("MergeStatement");
        expect(stmt.targetAlias).toBe("T");
        expect(stmt.using.alias).toBe("S");
        expect(stmt.whenClauses).toHaveLength(2);
        expect(stmt.whenClauses[0].action.type).toBe("MergeUpdateAction");
        expect(stmt.whenClauses[1].action.type).toBe("MergeInsertAction");
        expect(stmt.whenClauses[1].action.columns).toEqual(["Name"]);
        expect(stmt.whenClauses[1].action.values).toHaveLength(1);
    });

    test("should parse MERGE TOP clause and DELETE action", () => {
        const sql = `MERGE TOP (10) dbo.Target AS T
USING dbo.Source AS S
ON T.Id = S.Id
WHEN MATCHED THEN DELETE;`;
        const ast = parse(sql);
        const stmt = ast.body[0] as any;

        expect(stmt.type).toBe("MergeStatement");
        expect(stmt.top?.type).toBe("TopClause");
        expect(stmt.top?.percent).toBe(false);
        expect(stmt.top?.withTies).toBe(false);
        expect((stmt.top?.quantity as LiteralNode).value).toBe(10);
        expect(stmt.whenClauses).toHaveLength(1);
        expect(stmt.whenClauses[0].action.type).toBe("MergeDeleteAction");
    });

    test("should parse MERGE TOP variable expression", () => {
        const sql = `MERGE TOP (@n) dbo.Target AS T
USING dbo.Source AS S
ON T.Id = S.Id
WHEN MATCHED THEN DELETE;`;
        const ast = parse(sql);
        const stmt = ast.body[0] as any;

        expect(stmt.type).toBe("MergeStatement");
        expect(stmt.top?.type).toBe("TopClause");
        expect(stmt.top?.quantity?.type).toBe("Variable");
        expect(stmt.top?.quantity?.name).toBe("@n");
    });

    test("should parse MERGE NOT MATCHED BY SOURCE with INSERT SELECT", () => {
        const sql = `MERGE dbo.Target AS T
USING dbo.Source AS S
ON T.Id = S.Id
WHEN NOT MATCHED BY SOURCE THEN INSERT (Name) SELECT S.Name;`;
        const ast = parse(sql);
        const stmt = ast.body[0] as any;

        expect(stmt.type).toBe("MergeStatement");
        expect(stmt.whenClauses[0].condition).toBe("NOT MATCHED BY SOURCE");
        expect(stmt.whenClauses[0].action.type).toBe("MergeInsertAction");
        expect(stmt.whenClauses[0].action.columns).toEqual(["Name"]);
        expect(stmt.whenClauses[0].action.selectQuery).toBeDefined();
    });

    test("should parse MERGE NOT MATCHED BY TARGET with INSERT action", () => {
        const sql = `MERGE dbo.Target AS T
USING dbo.Source AS S
ON T.Id = S.Id
WHEN NOT MATCHED BY TARGET THEN INSERT (Name) VALUES (S.Name);`;
        const ast = parse(sql);
        const stmt = ast.body[0] as any;

        expect(stmt.type).toBe("MergeStatement");
        expect(stmt.whenClauses[0].condition).toBe("NOT MATCHED BY TARGET");
        expect(stmt.whenClauses[0].action.type).toBe("MergeInsertAction");
        expect(stmt.whenClauses[0].action.columns).toEqual(["Name"]);
        expect(stmt.whenClauses[0].action.values).toHaveLength(1);
    });

    test("should parse MERGE with OUTPUT clause", () => {
        const sql = `MERGE dbo.Target AS T
USING dbo.Source AS S
ON T.Id = S.Id
WHEN MATCHED THEN UPDATE SET Name = S.Name
OUTPUT inserted.Id, deleted.Id INTO Audit(InsertedId, DeletedId);`;
        const ast = parse(sql);
        const stmt = ast.body[0] as any;

        expect(stmt.type).toBe("MergeStatement");
        expect(stmt.output).toBeDefined();
        expect(stmt.output.columns.length).toBe(2);
        expect(stmt.output.intoTable.name).toBe("Audit");
        expect(stmt.output.intoColumns).toEqual(["InsertedId", "DeletedId"]);
    });

    test("should parse MERGE INTO with derived USING source and OUTPUT INTO table variable", () => {
        const sql = `MERGE INTO dbo.Target AS tgt
  USING
  (
    SELECT DISTINCT pendingRow.KeyValue, pendingRow.DisplayValue
    FROM @PendingRows pendingRow
) AS srcRows
ON 1 = 0
WHEN NOT MATCHED THEN
    INSERT (KeyValue, DisplayValue)
    VALUES (srcRows.KeyValue, srcRows.DisplayValue)
OUTPUT srcRows.KeyValue, srcRows.DisplayValue, INSERTED.TargetId
INTO @NewRows (KeyValue, DisplayValue, TargetId);`;
        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0] as any;

        expect(result.issues).toEqual([]);
        expect(stmt.type).toBe("MergeStatement");
        expect(stmt.targetAlias).toBe("tgt");
        expect(stmt.using?.table?.type).toBe("SubqueryExpression");
        expect(stmt.using?.alias).toBe("srcRows");
        expect(stmt.whenClauses[0].action.type).toBe("MergeInsertAction");
        expect(stmt.output).toBeDefined();
        expect(stmt.output.intoTable.name).toBe("@NewRows");
        expect(stmt.output.intoColumns).toEqual(["KeyValue", "DisplayValue", "TargetId"]);
    });

    test("should not treat following MERGE statement as a JOIN after prior FROM without semicolon", () => {
        const sql = `
            SELECT @MaxDate = MAX(ModifiedOn)
            FROM dbo.StageRows WITH (NOLOCK)

            MERGE INTO dbo.TargetRows tgt
            USING (SELECT RowId FROM dbo.SourceRows) src
            ON tgt.RowId = src.RowId
            WHEN NOT MATCHED BY TARGET THEN
                INSERT (RowId) VALUES (src.RowId)
            WHEN MATCHED THEN
                UPDATE SET tgt.RowId = src.RowId;
        `;

        const result = new Parser(new Lexer(sql)).parse();

        expect(result.issues).toEqual([]);
        expect(result.ast.body[0].type).toBe("SelectStatement");
        expect(result.ast.body[1].type).toBe("MergeStatement");
    });
});
