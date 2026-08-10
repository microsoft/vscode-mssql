import { Lexer } from "../../src/parser/saral/parser/lexer.js";
import { Parser } from "../../src/parser/saral/parser/parser.js";
import { type CreateNode, type SetNode } from "../../src/parser/saral/ast/types.js";

// ─── Test helper ─────────────────────────────────────────────────────────────

const parse = (sql: string) => {
    return new Parser(new Lexer(sql)).parse();
};

const parseFirst = <T>(sql: string): T => {
    return parse(sql).ast.body[0] as T;
};

// Extracts a named fragment from the source using node start/end offsets.
// Used to verify that spans are correct without hardcoding offset numbers.
const fragment = (sql: string, node: { start: number; end: number }): string => {
    return sql.substring(node.start, node.end);
};

// ─── CREATE PROCEDURE ─────────────────────────────────────────────────────────

describe("CREATE PROCEDURE", () => {
    test("basic CREATE PROCEDURE sets orAlter to false", () => {
        const sql = `
            CREATE PROCEDURE dbo.GetUser
                @Id INT
            AS
            BEGIN
                SELECT * FROM Users WHERE Id = @Id
            END
        `;
        const stmt = parseFirst<CreateNode>(sql);

        expect(stmt.type).toBe("CreateStatement");
        expect(stmt.objectType).toBe("PROCEDURE");
        expect(stmt.name).toBe("dbo.GetUser");
        expect(stmt.orAlter).toBe(false);
        expect(stmt.incomplete).toBeFalsy();
    });

    test("CREATE PROCEDURE parameters are parsed", () => {
        const sql = `
            CREATE PROCEDURE GetUser
                @Id INT,
                @Name NVARCHAR(100)
            AS BEGIN SELECT 1 END
        `;
        const stmt = parseFirst<CreateNode>(sql);

        expect(stmt.parameters).toHaveLength(2);
        expect(stmt.parameters![0].name).toBe("@Id");
        expect(stmt.parameters![0].dataType).toBe("INT");
        expect(stmt.parameters![1].name).toBe("@Name");
        expect(stmt.parameters![1].dataType).toBe("NVARCHAR(100)");
    });

    test("CREATE PROCEDURE with OUTPUT parameter", () => {
        const sql = `
            CREATE PROCEDURE GetCount
                @Count INT OUTPUT
            AS BEGIN SELECT 1 END
        `;
        const stmt = parseFirst<CreateNode>(sql);

        expect(stmt.parameters![0].isOutput).toBe(true);
    });

    test("CREATE PROCEDURE span covers full statement", () => {
        const sql = "CREATE PROCEDURE GetUser @Id INT AS BEGIN SELECT 1 END";
        const stmt = parseFirst<CreateNode>(sql);

        expect(fragment(sql, stmt)).toMatch(/^CREATE PROCEDURE/);
        expect(stmt.start).toBe(0);
    });
});

// ─── CREATE OR ALTER ──────────────────────────────────────────────────────────

describe("CREATE OR ALTER", () => {
    test("CREATE OR ALTER PROCEDURE sets orAlter to true", () => {
        const sql = `
            CREATE OR ALTER PROCEDURE dbo.GetUser
                @Id INT
            AS
            BEGIN
                SELECT * FROM Users WHERE Id = @Id
            END
        `;
        const stmt = parseFirst<CreateNode>(sql);

        expect(stmt.type).toBe("CreateStatement");
        expect(stmt.objectType).toBe("PROCEDURE");
        expect(stmt.name).toBe("dbo.GetUser");
        expect(stmt.orAlter).toBe(true);
        expect(stmt.incomplete).toBeFalsy();
    });

    test("CREATE OR ALTER FUNCTION sets orAlter to true", () => {
        const sql = `
            CREATE OR ALTER FUNCTION dbo.GetFullName(@First NVARCHAR(50), @Last NVARCHAR(50))
            RETURNS NVARCHAR(101)
            AS
            BEGIN
                RETURN @First + ' ' + @Last
            END
        `;
        const stmt = parseFirst<CreateNode>(sql);

        expect(stmt.objectType).toBe("FUNCTION");
        expect(stmt.orAlter).toBe(true);
        expect(stmt.incomplete).toBeFalsy();
    });

    test("CREATE OR ALTER VIEW sets orAlter to true", () => {
        const sql = `
            CREATE OR ALTER VIEW dbo.ActiveUsers
            AS
                SELECT Id, Name FROM Users WHERE Active = 1
        `;
        const stmt = parseFirst<CreateNode>(sql);

        expect(stmt.objectType).toBe("VIEW");
        expect(stmt.orAlter).toBe(true);
        expect(stmt.incomplete).toBeFalsy();
    });

    test("CREATE OR ALTER PROCEDURE parameters are still parsed correctly", () => {
        const sql = `
            CREATE OR ALTER PROCEDURE UpdateUser
                @Id INT,
                @Name NVARCHAR(100)
            AS BEGIN SELECT 1 END
        `;
        const stmt = parseFirst<CreateNode>(sql);

        expect(stmt.orAlter).toBe(true);
        expect(stmt.parameters).toHaveLength(2);
        expect(stmt.parameters![0].name).toBe("@Id");
        expect(stmt.parameters![1].name).toBe("@Name");
    });

    test("CREATE OR missing ALTER produces incomplete node with error", () => {
        const sql = `
            CREATE OR PROCEDURE GetUser @Id INT AS BEGIN SELECT 1 END
        `;
        const stmt = parseFirst<CreateNode>(sql);

        expect(stmt.incomplete).toBe(true);
        expect(stmt.errors).toBeDefined();
        expect(stmt.errors!.length).toBeGreaterThan(0);
        expect(stmt.orAlter).toBe(false);
    });

    test("CREATE OR ALTER span starts at CREATE keyword", () => {
        const sql = "CREATE OR ALTER PROCEDURE GetUser @Id INT AS BEGIN SELECT 1 END";
        const stmt = parseFirst<CreateNode>(sql);

        expect(stmt.start).toBe(0);
        expect(fragment(sql, stmt)).toMatch(/^CREATE OR ALTER PROCEDURE/);
    });
});

// ─── ALTER (standalone) ───────────────────────────────────────────────────────

describe("ALTER (standalone)", () => {
    test("ALTER PROCEDURE sets orAlter to true", () => {
        const sql = `
            ALTER PROCEDURE dbo.GetUser
                @Id INT
            AS
            BEGIN
                SELECT * FROM Users WHERE Id = @Id
            END
        `;
        const stmt = parseFirst<CreateNode>(sql);

        expect(stmt.type).toBe("CreateStatement");
        expect(stmt.objectType).toBe("PROCEDURE");
        expect(stmt.name).toBe("dbo.GetUser");
        expect(stmt.orAlter).toBe(true);
        expect(stmt.incomplete).toBeFalsy();
    });

    test("ALTER FUNCTION sets orAlter to true", () => {
        const sql = `
            ALTER FUNCTION dbo.GetName(@Id INT)
            RETURNS NVARCHAR(100)
            AS BEGIN RETURN 'Name' END
        `;
        const stmt = parseFirst<CreateNode>(sql);

        expect(stmt.objectType).toBe("FUNCTION");
        expect(stmt.orAlter).toBe(true);
    });

    test("ALTER VIEW sets orAlter to true", () => {
        const sql = `
            ALTER VIEW dbo.ActiveUsers AS SELECT Id FROM Users WHERE Active = 1
        `;
        const stmt = parseFirst<CreateNode>(sql);

        expect(stmt.objectType).toBe("VIEW");
        expect(stmt.orAlter).toBe(true);
    });

    test("ALTER PROCEDURE parameters are parsed", () => {
        const sql = `
            ALTER PROCEDURE UpdateUser
                @Id INT,
                @Name NVARCHAR(100),
                @Result INT OUTPUT
            AS BEGIN SELECT 1 END
        `;
        const stmt = parseFirst<CreateNode>(sql);

        expect(stmt.orAlter).toBe(true);
        expect(stmt.parameters).toHaveLength(3);
        expect(stmt.parameters![2].isOutput).toBe(true);
    });

    test("ALTER span starts at ALTER keyword", () => {
        const sql = "ALTER PROCEDURE GetUser @Id INT AS BEGIN SELECT 1 END";
        const stmt = parseFirst<CreateNode>(sql);

        expect(stmt.start).toBe(0);
        expect(fragment(sql, stmt)).toMatch(/^ALTER PROCEDURE/);
    });

    test("CREATE vs ALTER produce same AST shape — only orAlter differs", () => {
        const create = parseFirst<CreateNode>(
            "CREATE PROCEDURE GetUser @Id INT AS BEGIN SELECT 1 END",
        );
        const alter = parseFirst<CreateNode>(
            "ALTER PROCEDURE GetUser @Id INT AS BEGIN SELECT 1 END",
        );

        expect(create.objectType).toBe(alter.objectType);
        expect(create.name).toBe(alter.name);
        expect(create.parameters?.length).toBe(alter.parameters?.length);
        expect(create.orAlter).toBe(false);
        expect(alter.orAlter).toBe(true);
    });
});

// ─── SET session options ──────────────────────────────────────────────────────

describe("SET session options", () => {
    // ON variants — these were previously broken because ON is a
    // structural keyword and the loop would stop before consuming it.

    test("SET NOCOUNT ON", () => {
        const sql = "SET NOCOUNT ON";
        const stmt = parseFirst<SetNode>(sql);

        expect(stmt.type).toBe("SetStatement");
        expect(stmt.variable).toBe("NOCOUNT ON");
        expect(stmt.incomplete).toBeFalsy();
    });

    test("SET NOCOUNT OFF", () => {
        const sql = "SET NOCOUNT OFF";
        const stmt = parseFirst<SetNode>(sql);

        expect(stmt.variable).toBe("NOCOUNT OFF");
        expect(stmt.incomplete).toBeFalsy();
    });

    test("SET ANSI_NULLS ON", () => {
        const sql = "SET ANSI_NULLS ON";
        const stmt = parseFirst<SetNode>(sql);

        expect(stmt.variable).toBe("ANSI_NULLS ON");
        expect(stmt.incomplete).toBeFalsy();
    });

    test("SET QUOTED_IDENTIFIER ON", () => {
        const sql = "SET QUOTED_IDENTIFIER ON";
        const stmt = parseFirst<SetNode>(sql);

        expect(stmt.variable).toBe("QUOTED_IDENTIFIER ON");
        expect(stmt.incomplete).toBeFalsy();
    });

    test("SET XACT_ABORT ON", () => {
        const sql = "SET XACT_ABORT ON";
        const stmt = parseFirst<SetNode>(sql);

        expect(stmt.variable).toBe("XACT_ABORT ON");
        expect(stmt.incomplete).toBeFalsy();
    });

    test("SET ANSI_PADDING ON", () => {
        const sql = "SET ANSI_PADDING ON";
        const stmt = parseFirst<SetNode>(sql);

        expect(stmt.variable).toBe("ANSI_PADDING ON");
        expect(stmt.incomplete).toBeFalsy();
    });

    // Multi-word session options

    test("SET TRANSACTION ISOLATION LEVEL READ COMMITTED", () => {
        const sql = "SET TRANSACTION ISOLATION LEVEL READ COMMITTED";
        const stmt = parseFirst<SetNode>(sql);

        expect(stmt.variable).toBe("TRANSACTION ISOLATION LEVEL READ COMMITTED");
        expect(stmt.incomplete).toBeFalsy();
    });

    test("SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED", () => {
        const sql = "SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED";
        const stmt = parseFirst<SetNode>(sql);

        expect(stmt.variable).toBe("TRANSACTION ISOLATION LEVEL READ UNCOMMITTED");
        expect(stmt.incomplete).toBeFalsy();
    });

    test("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE", () => {
        const sql = "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE";
        const stmt = parseFirst<SetNode>(sql);

        expect(stmt.variable).toBe("TRANSACTION ISOLATION LEVEL SERIALIZABLE");
        expect(stmt.incomplete).toBeFalsy();
    });

    // Variable assignment — verify session option fix does not
    // break the existing variable assignment path

    test("SET @variable = value still works", () => {
        const sql = "SET @Count = 10";
        const stmt = parseFirst<SetNode>(sql);

        expect(stmt.variable).toBe("@Count");
        expect(stmt.value).toBeDefined();
        expect(stmt.value?.type).toBe("Literal");
        expect(stmt.incomplete).toBeFalsy();
    });

    test("SET @variable = expression still works", () => {
        const sql = "SET @Total = @Price * @Qty";
        const stmt = parseFirst<SetNode>(sql);

        expect(stmt.variable).toBe("@Total");
        expect(stmt.value?.type).toBe("BinaryExpression");
        expect(stmt.incomplete).toBeFalsy();
    });

    // Span accuracy

    test("SET NOCOUNT ON span covers full statement", () => {
        const sql = "SET NOCOUNT ON";
        const stmt = parseFirst<SetNode>(sql);

        expect(stmt.start).toBe(0);
        expect(fragment(sql, stmt)).toBe("SET NOCOUNT ON");
    });

    test("SET NOCOUNT ON followed by next statement — next statement is not consumed", () => {
        const sql = "SET NOCOUNT ON\nSELECT 1";
        const result = parse(sql);

        // Both statements should be present
        expect(result.ast.body).toHaveLength(2);
        expect(result.ast.body[0].type).toBe("SetStatement");
        expect(result.ast.body[1].type).toBe("SelectStatement");
    });

    test("SET ANSI_NULLS ON followed by CREATE PROCEDURE — procedure is not consumed", () => {
        const sql = `
            SET ANSI_NULLS ON
            SET QUOTED_IDENTIFIER ON
            CREATE PROCEDURE GetUser @Id INT AS BEGIN SELECT 1 END
        `;
        const result = parse(sql);

        expect(result.ast.body).toHaveLength(3);
        expect(result.ast.body[0].type).toBe("SetStatement");
        expect(result.ast.body[1].type).toBe("SetStatement");
        expect(result.ast.body[2].type).toBe("CreateStatement");
    });

    // This is the canonical real-world pattern at the top of every
    // SSMS-generated stored procedure script
    test("full SSMS procedure header parses cleanly", () => {
        const sql = `
            SET ANSI_NULLS ON
            SET QUOTED_IDENTIFIER ON
            GO
            CREATE OR ALTER PROCEDURE dbo.GetUser
                @Id INT
            AS
            BEGIN
                SET NOCOUNT ON
                SELECT Id, Name FROM Users WHERE Id = @Id
            END
            GO
        `;
        const result = parse(sql);

        // GO resets the batch — statements before and after GO are separate
        // At minimum: SET ANSI_NULLS ON, SET QUOTED_IDENTIFIER ON, CREATE OR ALTER
        const createStmt = result.ast.body.find((s) => s.type === "CreateStatement") as
            | CreateNode
            | undefined;

        expect(createStmt).toBeDefined();
        expect(createStmt!.orAlter).toBe(true);
        expect(createStmt!.objectType).toBe("PROCEDURE");
        expect(createStmt!.incomplete).toBeFalsy();
    });
});
