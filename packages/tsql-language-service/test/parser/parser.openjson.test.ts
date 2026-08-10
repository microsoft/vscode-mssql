import { parseResult, select } from "./parser.helpers";

describe("OPENJSON parsing", () => {
    test("parses OPENJSON as a table-valued function in FROM", () => {
        const stmt = select(`
            SELECT *
            FROM OPENJSON(@json) j
        `);

        const from = stmt.from?.[0];
        expect(from?.table?.type).toBe("FunctionCall");

        const fn = from?.table as any;
        expect(fn.name).toBe("OPENJSON");
        expect(fn.args).toHaveLength(1);
        expect(fn.args[0].type).toBe("Variable");
        expect(from?.alias).toBe("j");
    });

    test("parses OPENJSON with path argument", () => {
        const stmt = select(`
            SELECT *
            FROM OPENJSON(@json, '$.Career')
        `);

        const fn = stmt.from?.[0].table as any;
        expect(fn.type).toBe("FunctionCall");
        expect(fn.args).toHaveLength(2);
        expect(fn.args[1].type).toBe("Literal");
        expect(fn.args[1].value).toBe("$.Career");
    });

    test("parses OPENJSON WITH schema clause", () => {
        const stmt = select(`
            SELECT *
            FROM OPENJSON(@json)
            WITH (
                Number varchar(200) '$.Order.Number',
                Date datetime '$.Order.Date',
                Customer varchar(200) '$.AccountNumber',
                Quantity int '$.Item.Quantity'
            ) AS j
        `);

        const fn = stmt.from?.[0].table as any;
        expect(fn.type).toBe("FunctionCall");
        expect(fn.openJsonWith).toHaveLength(4);
        expect(fn.openJsonWith[0]).toMatchObject({
            name: "Number",
            dataType: "VARCHAR(200)",
            path: "'$.Order.Number'",
        });
        expect(fn.openJsonWith[1]).toMatchObject({
            name: "DATE",
            dataType: "DATETIME",
            path: "'$.Order.Date'",
        });
        expect(stmt.from?.[0].alias).toBe("j");
    });

    test("parses OPENJSON WITH AS JSON columns", () => {
        const stmt = select(`
            SELECT *
            FROM OPENJSON(@json, '$.Career')
            WITH (
                team nvarchar(50),
                gp int,
                period nvarchar(max) AS JSON
            ) career
        `);

        const fn = stmt.from?.[0].table as any;
        expect(fn.openJsonWith).toHaveLength(3);
        expect(fn.openJsonWith[2]).toMatchObject({
            name: "period",
            dataType: "NVARCHAR(max)",
            asJson: true,
        });
        expect(stmt.from?.[0].alias).toBe("career");
    });

    test("parses CROSS APPLY OPENJSON with schema", () => {
        const stmt = select(`
            SELECT p.Id, j.Value
            FROM dbo.Payload p
            CROSS APPLY OPENJSON(p.JsonData, '$.items')
                WITH (
                    Value nvarchar(100) '$.value'
                ) j
        `);

        const join = stmt.from?.[0].joins[0] as any;
        expect(join.type).toBe("CROSS APPLY");
        expect(join.table.type).toBe("FunctionCall");
        expect(join.table.name).toBe("OPENJSON");
        expect(join.table.openJsonWith).toHaveLength(1);
        expect(join.alias).toBe("j");
    });

    test("does not report parse issues for OPENJSON WITH schema", () => {
        const result = parseResult(`
            DECLARE @products NVARCHAR(MAX) = N'[{"ProductID":15,"Name":"Adjustable Race","Price":100.0000}]';
            SELECT ProductID, Name, Price
            FROM OPENJSON(@products) WITH(
                ProductID int,
                Name nvarchar(50),
                Price money
            );
        `);

        expect(result.issues).toEqual([]);
    });

    test("preserves OPENJSON schema inside Microsoft-style insert-select", () => {
        const result = parseResult(`
            DECLARE @products NVARCHAR(MAX) = N'[{"ProductID":15,"Name":"Adjustable Race","Price":100.0000}]';
            INSERT INTO Product(ProductID, Name, Price)
            SELECT ProductID, Name, Price
            FROM OPENJSON(@products) WITH(
                ProductID int,
                Name nvarchar(50),
                Price money
            );
        `);

        expect(result.issues).toEqual([]);

        const stmt = result.ast.body[1] as any;
        const fn = stmt.selectQuery.from[0].table;
        expect(fn.type).toBe("FunctionCall");
        expect(fn.openJsonWith).toHaveLength(3);
    });

    test("supports Microsoft-style OPENJSON WITH columns with mixed data types", () => {
        const stmt = select(`
            SELECT *
            FROM OPENJSON(@products) WITH(
                ProductID int,
                Name nvarchar(50),
                Price money,
                ValidFrom datetime2(0),
                ValidTo datetime2(0)
            ) j
        `);

        const fn = stmt.from?.[0].table as any;
        expect(fn.openJsonWith).toHaveLength(5);
        expect(fn.openJsonWith.map((column: any) => String(column.dataType).toUpperCase())).toEqual(
            ["INT", "NVARCHAR(50)", "MONEY", "DATETIME2(0)", "DATETIME2(0)"],
        );
    });
});
