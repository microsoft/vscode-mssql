import { Lexer } from "../../src/parser/saral/parser/lexer.js";
import {
    type InsertNode,
    type UpdateNode,
    type DeleteNode,
    type IdentifierNode,
} from "../../src/parser/saral/ast/types.js";
import { Parser } from "../../src/parser/saral/parser/parser.js";

describe("OUTPUT clause", () => {
    const parse = (sql: string) => {
        const lexer = new Lexer(sql);
        const parser = new Parser(lexer);
        return parser.parse().ast;
    };

    test("should parse INSERT OUTPUT inserted.Id", () => {
        const sql = `
            INSERT INTO Users(Name)
            OUTPUT inserted.Id
            VALUES ('John')
        `;

        const stmt = parse(sql).body[0] as InsertNode;

        expect(stmt.output).toBeDefined();
        expect(stmt.output!.columns).toHaveLength(1);
        expect(stmt.output!.columns[0].sourceTable).toBe("INSERTED");
        expect(stmt.output!.columns[0].column.sourceName).toBe("Id");
    });

    test("should parse INSERT OUTPUT multiple columns", () => {
        const sql = `
            INSERT INTO Users(Name)
            OUTPUT inserted.Id, inserted.Name
            VALUES ('John')
        `;

        const stmt = parse(sql).body[0] as InsertNode;

        expect(stmt.output!.columns).toHaveLength(2);

        expect(stmt.output!.columns[0].sourceTable).toBe("INSERTED");
        expect(stmt.output!.columns[0].column.sourceName).toBe("Id");

        expect(stmt.output!.columns[1].sourceTable).toBe("INSERTED");
        expect(stmt.output!.columns[1].column.sourceName).toBe("Name");
    });

    test("should parse UPDATE OUTPUT inserted and deleted", () => {
        const sql = `
            UPDATE Users
            SET Name = 'John'
            OUTPUT inserted.Name, deleted.Name
            WHERE Id = 1
        `;

        const stmt = parse(sql).body[0] as UpdateNode;

        expect(stmt.output).toBeDefined();
        expect(stmt.output!.columns).toHaveLength(2);

        expect(stmt.output!.columns[0].sourceTable).toBe("INSERTED");
        expect(stmt.output!.columns[0].column.sourceName).toBe("Name");

        expect(stmt.output!.columns[1].sourceTable).toBe("DELETED");
        expect(stmt.output!.columns[1].column.sourceName).toBe("Name");
    });

    test("should parse DELETE OUTPUT deleted.Id", () => {
        const sql = `
            DELETE FROM Users
            OUTPUT deleted.Id
            WHERE Id = 1
        `;

        const stmt = parse(sql).body[0] as DeleteNode;

        expect(stmt.output).toBeDefined();
        expect(stmt.output!.columns).toHaveLength(1);
        expect(stmt.output!.columns[0].sourceTable).toBe("DELETED");
        expect(stmt.output!.columns[0].column.sourceName).toBe("Id");
    });

    test("should parse DELETE TOP alias OUTPUT FROM join shape without issues", () => {
        const sql = `
            DELETE TOP (20000) targetRow
            OUTPUT deleted.SKU
                 , deleted.LocationCode
                 , deleted.CurrentValue
                 , NULL NewValue
                 , NULL NewDate
                 , deleted.PreviousValue
                 , NULL NewPreviousValue
                 , 'Cleanup' UpdatedBy INTO #AuditHistory (SKU, LocationCode, CurrentValue, NewValue, NewDate, PreviousValue, NewPreviousValue, UpdatedBy)
            FROM dbo.TargetTable targetRow
                JOIN #SelectedLocations selectedLocation ON selectedLocation.LocationCode = targetRow.LocationCode
                LEFT JOIN dbo.LocationReplica replica WITH (NOLOCK) ON replica.ReplicaLocationCode = targetRow.LocationCode
                LEFT JOIN dbo.SourceTable sourceRow WITH(NOLOCK) ON sourceRow.SKU = targetRow.SKU
                                                                AND sourceRow.LocationCode = ISNULL(replica.PrimaryLocationCode, targetRow.LocationCode)
            WHERE sourceRow.SKU IS NULL
        `;

        const result = new Parser(new Lexer(sql)).parse();
        const stmt = result.ast.body[0] as DeleteNode;

        expect(result.issues).toHaveLength(0);
        expect(stmt.type).toBe("DeleteStatement");
        expect((stmt.target as IdentifierNode).name).toBe("targetRow");
        expect(stmt.output).toBeDefined();
        expect(stmt.from).toHaveLength(1);
        expect(stmt.from?.[0].joins).toHaveLength(3);
        expect(stmt.where).toBeDefined();
    });

    test("should parse OUTPUT wildcard", () => {
        const sql = `
            INSERT INTO Users(Name)
            OUTPUT inserted.*
            VALUES ('John')
        `;

        const stmt = parse(sql).body[0] as InsertNode;

        expect(stmt.output).toBeDefined();
        expect(stmt.output!.columns).toHaveLength(1);

        const col = stmt.output!.columns[0];

        expect(col.sourceTable).toBe("INSERTED");
        expect(col.column.wildcard).toBe(true);
        expect(col.column.sourceName).toBe("*");
    });

    test("should parse OUTPUT INTO table", () => {
        const sql = `
            INSERT INTO Users(Name)
            OUTPUT inserted.Id
            INTO Audit
            VALUES ('John')
        `;

        const stmt = parse(sql).body[0] as InsertNode;

        expect(stmt.output).toBeDefined();
        expect(stmt.output!.intoTable).toBeDefined();

        const table = stmt.output!.intoTable as IdentifierNode;
        expect(table.name).toBe("Audit");
    });

    test("should parse OUTPUT INTO table columns", () => {
        const sql = `
            INSERT INTO Users(Name)
            OUTPUT inserted.Id, inserted.Name
            INTO Audit(Id, Name)
            VALUES ('John')
        `;

        const stmt = parse(sql).body[0] as InsertNode;

        expect(stmt.output).toBeDefined();

        const table = stmt.output!.intoTable as IdentifierNode;
        expect(table.name).toBe("Audit");

        expect(stmt.output!.intoColumns).toEqual(["Id", "Name"]);
    });

    test("should parse OUTPUT INTO columns with keyword-shaped identifiers", () => {
        const sql = `
            INSERT INTO Users(Name)
            OUTPUT inserted.Id
            INTO Audit(OffSet)
            VALUES ('John')
        `;

        const stmt = parse(sql).body[0] as InsertNode;

        expect(stmt.output!.intoColumns).toEqual(["OFFSET"]);
    });

    test("should parse OUTPUT INTO multipart table name", () => {
        const sql = `
            INSERT INTO Users(Name)
            OUTPUT inserted.Id
            INTO dbo.Audit
            VALUES ('John')
        `;

        const stmt = parse(sql).body[0] as InsertNode;

        const table = stmt.output!.intoTable as IdentifierNode;

        expect(table.parts).toEqual(["dbo", "Audit"]);
    });

    test("should parse bracketed OUTPUT identifiers", () => {
        const sql = `
            INSERT INTO Users(Name)
            OUTPUT inserted.[User Id]
            VALUES ('John')
        `;

        const stmt = parse(sql).body[0] as InsertNode;

        expect(stmt.output!.columns[0].column.sourceName).toBe("[User Id]");
    });

    test("should parse OUTPUT alias", () => {
        const sql = `
            INSERT INTO Users(Name)
            OUTPUT inserted.Id AS NewId
            VALUES ('John')
        `;

        const stmt = parse(sql).body[0] as InsertNode;

        const col = stmt.output!.columns[0].column;

        expect(col.sourceName).toBe("Id");
        expect(col.outputName).toBe("NewId");
    });

    test("should parse OUTPUT assignment alias style", () => {
        const sql = `
            INSERT INTO Users(Name)
            OUTPUT NewId = inserted.Id
            VALUES ('John')
        `;

        const stmt = parse(sql).body[0] as InsertNode;

        const col = stmt.output!.columns[0].column;

        expect(col.sourceName).toBe("Id");
        expect(col.outputName).toBe("NewId");
    });

    test("should parse OUTPUT function expression", () => {
        const sql = `
            INSERT INTO Users(Name)
            OUTPUT LEN(inserted.Name) AS NameLength
            VALUES ('John')
        `;

        const stmt = parse(sql).body[0] as InsertNode;

        const col = stmt.output!.columns[0].column;

        expect(col.outputName).toBe("NameLength");
        expect(col.expression.type).toBe("FunctionCall");
    });

    test("should parse OUTPUT literal expression", () => {
        const sql = `
            INSERT INTO Users(Name)
            OUTPUT 1 AS Flag
            VALUES ('John')
        `;

        const stmt = parse(sql).body[0] as InsertNode;

        const col = stmt.output!.columns[0].column;

        expect(col.outputName).toBe("Flag");
        expect(col.expression.type).toBe("Literal");
    });

    test("should parse OUTPUT INTO variable table", () => {
        const sql = `
            INSERT INTO Users(Name)
            OUTPUT inserted.Id
            INTO @Audit
            VALUES ('John')
        `;

        const stmt = parse(sql).body[0] as InsertNode;

        expect(stmt.output!.intoTable).toBeDefined();

        const table = stmt.output!.intoTable as IdentifierNode;
        expect(table.name).toBe("@Audit");
    });

    test("should recover malformed OUTPUT clause", () => {
        const sql = `
        INSERT INTO Users(Name)
        OUTPUT inserted.
        VALUES ('John')
    `;

        const stmt = parse(sql).body[0] as InsertNode;

        expect(stmt.output).toBeDefined();
        expect(stmt.output!.columns.length).toBeGreaterThanOrEqual(0);
    });
});
