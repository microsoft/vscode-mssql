import { Lexer } from "../../src/parser/saral/parser/lexer.js";
import {
    type InsertNode,
    type UpdateNode,
    type DeleteNode,
    type SelectNode,
} from "../../src/parser/saral/ast/types.js";
import { Parser } from "../../src/parser/saral/parser/parser.js";
import { toSql, getTableName } from "./parser.helpers";

describe("T-SQL Parser - INSERT / UPDATE / DELETE", () => {
    const parse = (sql: string) => {
        const lexer = new Lexer(sql);
        const parser = new Parser(lexer);
        return parser.parse().ast;
    };

    test("should handle INSERT INTO ... VALUES", () => {
        const sql = `INSERT INTO Users (Name) VALUES ('Saral')`;
        const node = parse(sql).body[0] as InsertNode;
        expect(node.type).toBe("InsertStatement");
        expect(node.columns).toEqual(["Name"]);
        expect(node.columnNodes?.[0]).toMatchObject({
            type: "Identifier",
            name: "Name",
            start: sql.indexOf("Name"),
            end: sql.indexOf("Name") + "Name".length,
        });
    });

    test("should handle INSERT INTO ... SELECT", () => {
        const sql = `INSERT INTO T1 SELECT * FROM T2`;
        const node = parse(sql).body[0] as InsertNode;
        expect(node.selectQuery?.type).toBe("SelectStatement");
    });

    test("should handle INSERT column list with keyword-shaped identifiers", () => {
        const sql = `
            INSERT INTO dbo.OrgLkp
            (
                OrgId,
                OffSet,
                Region
            )
            SELECT
                src.OrgId,
                src.OffSet,
                src.Region
            FROM @InputRows src
        `;

        const node = parse(sql).body[0] as InsertNode;

        expect(node.selectQuery?.type).toBe("SelectStatement");
        expect(node.columns).toEqual(["OrgId", "OFFSET", "Region"]);
    });

    test("should handle multi-row and multi-column INSERT (2D Values)", () => {
        const sql = "INSERT INTO Users (ID, Name) VALUES (1, 'Alice'), (2, 'Bob');";
        const ast = parse(sql);
        const insert = ast.body[0] as any;

        expect(insert.type).toBe("InsertStatement");
        expect(insert.columns).toEqual(["ID", "Name"]);

        expect(insert.values.length).toBe(2); // 2 rows
        expect(insert.values[0].length).toBe(2); // 2 columns in row 1
        expect(insert.values[1].length).toBe(2); // 2 columns in row 2

        expect(insert.values[0][0].value).toBe(1);
        expect(insert.values[1][1].value).toBe("Bob");
    });

    test("should handle standard UPDATE", () => {
        const sql = `UPDATE Users SET Status = 1 WHERE ID = 1`;
        const node = parse(sql).body[0] as UpdateNode;
        expect(node.type).toBe("UpdateStatement");
        expect(node.assignments?.[0]).toMatchObject({
            type: "UpdateAssignment",
            column: "Status",
            start: sql.indexOf("Status"),
            end: sql.indexOf("1") + 1,
        });
        expect(node.assignments?.[0].columnNode).toMatchObject({
            type: "Identifier",
            name: "Status",
            start: sql.indexOf("Status"),
            end: sql.indexOf("Status") + "Status".length,
        });
    });

    test("should handle compound UPDATE assignment", () => {
        const sql = `UPDATE ProductStatus SET [Committed] -= @MinusQuantity WHERE ProductId = @ProductID`;
        const node = parse(sql).body[0] as UpdateNode;

        expect(node.type).toBe("UpdateStatement");
        expect(node.assignments?.[0].column).toBe("[Committed]");
        expect(toSql(node.assignments?.[0].value)).toBe("[Committed] - @MinusQuantity");
    });

    test("should handle keyword column name in UPDATE assignment target", () => {
        const sql = `UPDATE T SET OUTPUT = 1 WHERE Id = 1`;
        const node = parse(sql).body[0] as UpdateNode;

        expect(node.type).toBe("UpdateStatement");
        expect(node.assignments?.[0].column).toBe("OUTPUT");
        expect(toSql(node.assignments?.[0].value)).toBe("1");
    });

    test("should handle UPDATE with FROM and JOIN", () => {
        const sql = `UPDATE u SET x = 1 FROM Users u JOIN T2 ON u.id = T2.id`;
        const node = parse(sql).body[0] as UpdateNode;
        expect(getTableName(node.target)).toBe("u");
        expect(node.from?.[0].joins.length).toBe(1);
    });

    test("should handle standard DELETE", () => {
        const sql = `DELETE FROM Users WHERE ID = 1`;
        expect(parse(sql).body[0].type).toBe("DeleteStatement");
    });

    test("should handle DELETE with FROM and JOIN", () => {
        const sql = `DELETE u FROM Users u JOIN T2 ON u.id = T2.id`;
        const node = parse(sql).body[0] as DeleteNode;
        expect(getTableName(node.target)).toBe("u");
    });

    test("should omit absent INSERT/UPDATE/DELETE clauses from the AST", () => {
        const insertStmt = parse(`INSERT INTO dbo.Users (Id) VALUES (1)`).body[0] as InsertNode;
        expect("selectQuery" in insertStmt).toBe(false);
        expect("output" in insertStmt).toBe(false);

        const updateStmt = parse(`UPDATE dbo.Users SET Name = 'A'`).body[0] as UpdateNode;
        expect("from" in updateStmt).toBe(false);
        expect("where" in updateStmt).toBe(false);
        expect("output" in updateStmt).toBe(false);

        const deleteStmt = parse(`DELETE FROM dbo.Users`).body[0] as DeleteNode;
        expect("from" in deleteStmt).toBe(false);
        expect("where" in deleteStmt).toBe(false);
        expect("output" in deleteStmt).toBe(false);
    });

    test("Consolidation Fix: parseFrom should handle UPDATE targets correctly", () => {
        const sql = `UPDATE u SET Name = 'Saral' FROM Users u`;
        const ast = parse(sql);
        const updateNode = ast.body[0] as UpdateNode;

        expect(getTableName(updateNode.from?.[0].table)).toBe("Users");
        expect(updateNode.from?.[0].alias).toBe("u");
    });

    test("should handle SELECT subquery in FROM preserved as object (Architectural)", () => {
        const sql = `SELECT * FROM (SELECT Name FROM Users) AS Derived`;
        const ast = parse(sql);
        const stmt = ast.body[0] as SelectNode;

        const tableSource = stmt.from?.[0].table;
        expect(typeof tableSource).toBe("object");
        if (typeof tableSource === "object" && tableSource!.type === "SubqueryExpression") {
            expect(tableSource.query.type).toBe("SelectStatement");
        }
    });
});

describe("UPDATE SET — mixed column and variable assignment targets", () => {
    test("tags each assignment target as column or variable (not just a heuristic on the string)", () => {
        const sql = `
            UPDATE ri SET IsCommitted = 1, @DowncountEvent = CASE WHEN ri.IsExpired = 1 THEN 1 ELSE 0 END
            FROM dbo.RuleInstance ri;
        `;
        const result = new Parser(new Lexer(sql)).parse();

        expect(result.issues).toEqual([]);
        const update = result.ast.body[0] as any;
        expect(update.assignments).toHaveLength(2);
        expect(update.assignments[0].column).toBe("IsCommitted");
        expect(update.assignments[0].targetKind).toBe("column");
        expect(update.assignments[1].column).toBe("@DowncountEvent");
        expect(update.assignments[1].targetKind).toBe("variable");
    });

    test("tags the target in a MERGE ... WHEN MATCHED THEN UPDATE SET action too", () => {
        const sql = `
            MERGE INTO dbo.T AS t USING dbo.S AS s ON t.Id = s.Id
            WHEN MATCHED THEN UPDATE SET t.Name = s.Name, @Touched = 1;
        `;
        const result = new Parser(new Lexer(sql)).parse();

        expect(result.issues).toEqual([]);
        const merge = result.ast.body[0] as any;
        const updateAction = merge.whenClauses[0].action;
        expect(updateAction.assignments[0].targetKind).toBe("column");
        expect(updateAction.assignments[1].targetKind).toBe("variable");
    });
});
