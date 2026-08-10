import { Lexer } from "../../src/parser/saral/parser/lexer.js";
import {
    type SelectNode,
    type CreateNode,
    type BlockNode,
    type UpdateNode,
    type TableReference,
} from "../../src/parser/saral/ast/types.js";
import { Parser } from "../../src/parser/saral/parser/parser.js";
import { toSql } from "./parser.helpers";

describe("T-SQL Parser - Joins & Table Sources", () => {
    const parse = (sql: string) => {
        const lexer = new Lexer(sql);
        const parser = new Parser(lexer);
        return parser.parse().ast;
    };

    test("should handle CROSS APPLY", () => {
        const sql = `SELECT * FROM T CROSS APPLY fn(T.id)`;
        const stmt = parse(sql).body[0] as SelectNode;
        expect(stmt.from?.[0].joins[0].type).toBe("CROSS APPLY");
    });

    test("should handle HASH JOIN hint", () => {
        const sql = `SELECT * FROM dbo.Items i HASH JOIN dbo.Categories c ON c.Id = i.CategoryId`;
        const stmt = parse(sql).body[0] as SelectNode;
        expect(stmt.from?.[0].joins[0].type).toBe("INNER JOIN");
        expect(stmt.from?.[0].joins[0].joinHint).toBe("HASH");
    });

    test("should handle MERGE JOIN hint with LEFT JOIN", () => {
        const sql = `SELECT * FROM dbo.Items i LEFT MERGE JOIN dbo.Categories c ON c.Id = i.CategoryId`;
        const stmt = parse(sql).body[0] as SelectNode;
        expect(stmt.from?.[0].joins[0].type).toBe("LEFT OUTER JOIN");
        expect(stmt.from?.[0].joins[0].joinHint).toBe("MERGE");
    });

    test("should handle LOOP JOIN hint with INNER JOIN", () => {
        const sql = `SELECT * FROM dbo.Items i INNER LOOP JOIN dbo.Categories c ON c.Id = i.CategoryId`;
        const stmt = parse(sql).body[0] as SelectNode;
        expect(stmt.from?.[0].joins[0].type).toBe("INNER JOIN");
        expect(stmt.from?.[0].joins[0].joinHint).toBe("LOOP");
    });

    test("should handle subquery in FROM", () => {
        const sql = `SELECT * FROM (SELECT 1 as x) d`;
        const stmt = parse(sql).body[0] as SelectNode;
        expect(toSql(stmt.from?.[0].table)).toContain("SelectStatement");
    });

    test("should handle VALUES derived table in FROM with alias columns", () => {
        const sql = `CREATE PROCEDURE dbo.GetStatus @OrderNumber VARCHAR(100)
AS
BEGIN
    SELECT Status, StatusDate
    FROM (
        VALUES
            ('Ordered', DATEADD(DAY, -1, GETDATE())),
            ('Shipped', NULL)
    ) AS StatusRows (Status, StatusDate);
END`;

        const result = new Parser(new Lexer(sql)).parse();

        expect(result.issues).toEqual([]);

        const stmt = result.ast.body[0] as CreateNode;
        const statements = stmt.body as BlockNode[];
        const body = statements[0] as BlockNode;
        const select = body.body[0] as SelectNode;
        const tableSource = select.from?.[0];

        expect(tableSource?.table?.type).toBe("ValuesTableExpression");
        expect(tableSource?.alias).toBe("StatusRows");
        expect(tableSource?.aliasColumns).toEqual(["Status", "StatusDate"]);
    });

    test("should handle APPLY subquery alias columns without treating them as hints", () => {
        const sql = `
            SELECT m.ItemCodes
            FROM dbo.SourceTable sourceRow
            CROSS APPLY (
                SELECT sourceInner.Value
                FROM dbo.SourceInner sourceInner
                FOR XML PATH('')
            ) xmlRow (ItemCodes)
        `;

        const result = new Parser(new Lexer(sql)).parse();

        expect(result.issues).toEqual([]);

        const stmt = result.ast.body[0] as SelectNode;
        const join = stmt.from?.[0].joins[0];

        expect(join?.table?.type).toBe("SubqueryExpression");
        expect(join?.alias).toBe("xmlRow");
        expect(join?.aliasColumns).toEqual(["ItemCodes"]);
        expect(join?.hints).toBeUndefined();
    });

    test("should handle XML nodes table-valued function alias columns", () => {
        const sql = `
            SELECT requestRow.valueColumn.value('SessionID[1]', 'VARCHAR(50)')
            FROM @Request.nodes('/Request') AS requestRow(valueColumn)
        `;

        const result = new Parser(new Lexer(sql)).parse();

        expect(result.issues).toEqual([]);

        const stmt = result.ast.body[0] as SelectNode;
        const tableSource = stmt.from?.[0];

        expect(tableSource?.table?.type).toBe("FunctionCall");
        expect(tableSource?.alias).toBe("requestRow");
        expect(tableSource?.aliasColumns).toEqual(["valueColumn"]);
    });

    test("should parse parenthesized joined table source in FROM", () => {
        const sql = `
            SELECT baseRow.Id
            FROM (
                dbo.SourceA baseRow
                INNER JOIN dbo.SourceB childRow
                    ON baseRow.Id = childRow.SourceAId
            )
        `;

        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0] as SelectNode;

        expect(result.issues).toEqual([]);
        expect(stmt.from).toHaveLength(1);
        expect((stmt.from?.[0].table as any).type).toBe("TableReference");
    });

    test("should parse procedure with parenthesized joined source in FROM", () => {
        const sql = `
            CREATE PROCEDURE dbo.GetPendingOrderDetails
                @Interval BIGINT = 1440
            AS
            BEGIN
                SELECT itemRow.Sku
                FROM (
                    dbo.InventoryView inventoryRow
                    INNER JOIN dbo.Products itemRow
                        ON inventoryRow.Sku = itemRow.Sku
                    INNER JOIN dbo.Reservations reservationRow
                        ON itemRow.Id = reservationRow.ProductId
                )
            END
        `;

        const result = new Parser(new Lexer(sql)).parse();

        expect(result.issues).toEqual([]);
    });

    test("should handle ANSI comma-separated FROM sources", () => {
        const sql = "SELECT * FROM Users u, Orders o WHERE u.ID = o.UserID";
        const ast = parse(sql);
        const select = ast.body[0] as any;

        expect(Array.isArray(select.from)).toBe(true);
        expect(select.from.length).toBe(2);
        expect(select.from[0].alias).toBe("u");
        expect(select.from[1].alias).toBe("o");
    });

    describe("T-SQL Table Hints", () => {
        const getSqlFragment = (sql: string, node: { start: number; end: number }) => {
            return sql.substring(node.start, node.end);
        };

        test("should parse standard WITH (NOLOCK) hint", () => {
            const sql = "SELECT * FROM Users u WITH (NOLOCK)";
            const ast = parse(sql);
            const stmt = ast.body[0] as SelectNode;
            const from = stmt.from![0] as TableReference;

            expect(from.hints).toContain("NOLOCK");
            expect(from.alias).toBe("u");

            expect(getSqlFragment(sql, from)).toBe("FROM Users u WITH (NOLOCK)");
        });

        test("should handle multiple hints and complex INDEX hint", () => {
            const sql = "SELECT * FROM Products p WITH (NOLOCK, INDEX(PK_Products), TABLOCK)";
            const ast = parse(sql);
            const stmt = ast.body[0] as SelectNode;
            const from = stmt.from![0] as TableReference;

            expect(from.hints).toHaveLength(3);
            expect(from.hints).toContain("NOLOCK");
            expect(from.hints).toContain("INDEX(PK_Products)");
            expect(from.hints).toContain("TABLOCK");

            expect(getSqlFragment(sql, from)).toBe(
                "FROM Products p WITH (NOLOCK, INDEX(PK_Products), TABLOCK)",
            );
        });

        test("should handle legacy hint syntax without WITH keyword", () => {
            // T-SQL supports FROM Table (HINT) if an alias is present
            const sql = "SELECT * FROM Orders o (ROWLOCK)";
            const ast = parse(sql);
            const stmt = ast.body[0] as SelectNode;
            const from = stmt.from![0] as TableReference;

            expect(from.hints).toContain("ROWLOCK");
            expect(getSqlFragment(sql, from)).toBe("FROM Orders o (ROWLOCK)");
        });

        test("should handle hints followed by a JOIN", () => {
            // Note: T2 has a hint here
            const sql = "SELECT * FROM T1 WITH (NOLOCK) JOIN T2 WITH(NOLOCK) ON T1.id = T2.id";
            const ast = parse(sql);
            const stmt = ast.body[0] as SelectNode;
            const from = stmt.from![0] as TableReference;

            expect(from.hints).toContain("NOLOCK");
            expect(from.joins[0].hints).toContain("NOLOCK"); // Check T2's hint too!

            expect(getSqlFragment(sql, from)).toBe(
                "FROM T1 WITH (NOLOCK) JOIN T2 WITH(NOLOCK) ON T1.id = T2.id",
            );
        });

        test("should parse UPDATE target WITH(ROWLOCK)", () => {
            const sql = `
                UPDATE dbo.WorkQueue WITH(ROWLOCK)
                SET ProcessState = @BatchId
                WHERE Id IN
                    (SELECT TOP(@BatchSize) queueRow.Id
                     FROM dbo.WorkQueue queueRow WITH(NOLOCK)
                     WHERE queueRow.ProcessState = 'I'
                     ORDER BY queueRow.CreatedOnUtc ASC)
            `;
            const ast = parse(sql);
            const stmt = ast.body[0] as UpdateNode;

            expect(stmt.type).toBe("UpdateStatement");
            expect(stmt.target).not.toBeNull();
            expect(stmt.target?.type).toBe("Identifier");
            expect(stmt.targetHints).toContain("ROWLOCK");
            expect(stmt.where).toBeDefined();
        });
    });
});
