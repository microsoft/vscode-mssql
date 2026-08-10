import { Parser, Lexer } from "../../src/parser/saral/index.js";
import { LineageBuilder } from "../../src/parser/saral/lineage/lineageBuilder.js";

function lineage(sql: string) {
    const parser = new Parser(new Lexer(sql));
    const ast = parser.parse().ast;

    return new LineageBuilder().build(ast);
}

function edgeStrings(sql: string): string[] {
    return lineage(sql)
        .edges.map((e) => `${e.from.name} -> ${e.to.name}`)
        .sort();
}

describe("LineageBuilder", () => {
    test("simple direct column", () => {
        expect(edgeStrings(`SELECT Id FROM Orders`)).toEqual(["Orders.Id -> Id"]);
    });

    test("qualified column", () => {
        expect(edgeStrings(`SELECT o.Id FROM Orders o`)).toEqual(["Orders.Id -> Id"]);
    });

    test("bare column over a locally-defined #temp table resolves an edge (same as a table variable would)", () => {
        // Before the fix: CREATE TABLE #T registers each column with an
        // empty `inputs` array (correct for columns *derived* from
        // something else, like a CTE column, but wrong for a temp
        // table's own raw column definitions, which have no further
        // upstream lineage to flatten into). The lookup path returned
        // that empty array verbatim instead of resolving to #T itself,
        // so no edge was produced at all.
        expect(
            edgeStrings(`
                CREATE TABLE #T (Id INT, Name VARCHAR(50));
                SELECT Id, Name FROM #T;
            `),
        ).toEqual(["#T.Id -> Id", "#T.Name -> Name"]);
    });

    test("alias output", () => {
        expect(
            edgeStrings(`
                SELECT o.Id AS OrderId
                FROM Orders o
            `),
        ).toEqual(["Orders.Id -> OrderId"]);
    });

    test("computed expression", () => {
        expect(
            edgeStrings(`
                SELECT o.Amount * 1.1 AS Gross
                FROM Orders o
            `),
        ).toEqual(["Orders.Amount -> Gross"]);
    });

    test("function call", () => {
        expect(
            edgeStrings(`
                SELECT SUM(o.Amount) AS Total
                FROM Orders o
            `),
        ).toEqual(["Orders.Amount -> Total"]);
    });

    test("cast expression", () => {
        expect(
            edgeStrings(`
                SELECT CAST(o.Amount AS DECIMAL(10,2)) AS Total
                FROM Orders o
            `),
        ).toEqual(["Orders.Amount -> Total"]);
    });

    test("multiple dependencies", () => {
        expect(
            edgeStrings(`
                SELECT o.Price * o.Qty AS Total
                FROM Orders o
            `),
        ).toEqual(["Orders.Price -> Total", "Orders.Qty -> Total"]);
    });

    test("join lineage", () => {
        expect(
            edgeStrings(`
                SELECT c.Name
                FROM Orders o
                JOIN Customer c ON o.CustomerId = c.Id
            `),
        ).toEqual(["Customer.Name -> Name"]);
    });

    test("wildcard", () => {
        expect(
            edgeStrings(`
                SELECT o.*
                FROM Orders o
            `),
        ).toEqual(["Orders.* -> *"]);
    });

    test("cte flattening", () => {
        expect(
            edgeStrings(`
                WITH X AS (
                    SELECT o.Amount
                    FROM Orders o
                )
                SELECT X.Amount
                FROM X
            `),
        ).toEqual(["Orders.Amount -> Amount"]);
    });

    test("subquery flattening", () => {
        expect(
            edgeStrings(`
                SELECT s.Amount
                FROM (
                    SELECT o.Amount
                    FROM Orders o
                ) s
            `),
        ).toEqual(["Orders.Amount -> Amount"]);
    });

    test("scalar subquery expression", () => {
        expect(
            edgeStrings(`
                SELECT (
                    SELECT o.Amount
                    FROM Orders o
                ) AS AmountValue
            `),
        ).toEqual(["Orders.Amount -> AmountValue"]);
    });

    test("case expression", () => {
        expect(
            edgeStrings(`
            SELECT
                CASE
                    WHEN o.Amount > 100 THEN o.Amount
                    ELSE o.Discount
                END AS FinalAmount
            FROM Orders o
        `),
        ).toEqual(["Orders.Amount -> FinalAmount", "Orders.Discount -> FinalAmount"]);
    });

    test("where clause should not affect output lineage", () => {
        expect(
            edgeStrings(`
                SELECT o.Amount
                FROM Orders o
                WHERE o.Status = 'Paid'
            `),
        ).toEqual(["Orders.Amount -> Amount"]);
    });

    test("insert select mapping", () => {
        expect(
            edgeStrings(`
                INSERT INTO Audit(Id, Amount)
                SELECT o.Id, o.Amount
                FROM Orders o
            `),
        ).toEqual(["Orders.Amount -> Audit.Amount", "Orders.Id -> Audit.Id"]);
    });

    test("update assignment lineage", () => {
        expect(
            edgeStrings(`
                UPDATE t
                SET Total = c.Amount
                FROM Target t
                JOIN Customer c ON t.CustomerId = c.Id
            `),
        ).toEqual(["Customer.Amount -> t.Total"]);
    });

    test("exists expression", () => {
        expect(
            edgeStrings(`
                SELECT CASE
                    WHEN EXISTS (
                        SELECT o.CustomerId
                        FROM Orders o
                    ) THEN 1
                    ELSE 0
                END AS HasOrders
            `),
        ).toEqual(["Orders.CustomerId -> HasOrders"]);
    });

    test("in subquery expression", () => {
        expect(
            edgeStrings(`
                SELECT CASE
                    WHEN c.Id IN (
                        SELECT o.CustomerId
                        FROM Orders o
                    ) THEN 1
                    ELSE 0
                END AS MatchFlag
                FROM Customer c
            `),
        ).toEqual(["Customer.Id -> MatchFlag", "Orders.CustomerId -> MatchFlag"]);
    });

    test("over expression includes partition and order inputs", () => {
        expect(
            edgeStrings(`
                SELECT ROW_NUMBER() OVER (
                    PARTITION BY o.RegionId
                    ORDER BY o.CreatedOn
                ) AS RowNumber
                FROM Orders o
            `),
        ).toEqual(["Orders.CreatedOn -> RowNumber", "Orders.RegionId -> RowNumber"]);
    });

    test("within group order by contributes lineage", () => {
        expect(
            edgeStrings(`
                SELECT STRING_AGG(o.Name, ',') WITHIN GROUP (ORDER BY o.SortOrder) AS Names
                FROM Orders o
            `),
        ).toEqual(["Orders.Name -> Names", "Orders.SortOrder -> Names"]);
    });

    test("lineage flows through TRY/CATCH blocks", () => {
        expect(
            edgeStrings(`
                CREATE PROCEDURE dbo.SaveInventory
                AS
                BEGIN
                    BEGIN TRY
                        UPDATE io
                        SET io.OrganizationCode = iot.OrganizationCode
                        FROM dbo.InventoryOrgLkp io
                        JOIN @InventoryType iot ON io.OrgId = iot.OrgId;

                        INSERT INTO dbo.InventoryOrgLkp(OrgId, OrganizationCode)
                        SELECT iot.OrgId, iot.OrganizationCode
                        FROM @InventoryType iot;
                    END TRY
                    BEGIN CATCH
                        THROW;
                    END CATCH
                END
            `),
        ).toEqual([
            "@InventoryType.OrgId -> dbo.InventoryOrgLkp.OrgId",
            "@InventoryType.OrganizationCode -> dbo.InventoryOrgLkp.OrganizationCode",
            "@InventoryType.OrganizationCode -> io.OrganizationCode",
        ]);
    });

    test("merge update and insert lineage", () => {
        expect(
            edgeStrings(`
                MERGE dbo.Target AS T
                USING dbo.Source AS S
                ON T.Id = S.Id
                WHEN MATCHED THEN UPDATE SET Name = S.Name
                WHEN NOT MATCHED THEN INSERT (Name) VALUES (S.Name);
            `),
        ).toEqual(["dbo.Source.Name -> T.Name"]);
    });

    test("nested cte chain", () => {
        expect(
            edgeStrings(`
                WITH A AS (
                    SELECT Id FROM Orders
                ),
                B AS (
                    SELECT A.Id FROM A
                )
                SELECT B.Id FROM B
            `),
        ).toEqual(["Orders.Id -> Id"]);
    });

    test("select star from single table", () => {
        expect(
            edgeStrings(`
            SELECT *
            FROM Users
        `),
        ).toEqual(["Users.* -> *"]);
    });

    test("select star from aliased table", () => {
        expect(
            edgeStrings(`
            SELECT *
            FROM Users u
        `),
        ).toEqual(["Users.* -> *"]);
    });

    test("qualified wildcard", () => {
        expect(
            edgeStrings(`
            SELECT u.*
            FROM Users u
        `),
        ).toEqual(["Users.* -> *"]);
    });

    test("star across join", () => {
        expect(
            edgeStrings(`
            SELECT *
            FROM Orders o
            JOIN Customer c
                ON o.CustomerId = c.Id
        `),
        ).toEqual(["Customer.* -> *", "Orders.* -> *"]);
    });

    test("qualified wildcard in join", () => {
        expect(
            edgeStrings(`
            SELECT o.*
            FROM Orders o
            JOIN Customer c
                ON o.CustomerId = c.Id
        `),
        ).toEqual(["Orders.* -> *"]);
    });

    test("cte wildcard flattening", () => {
        expect(
            edgeStrings(`
            WITH X AS (
                SELECT *
                FROM Orders
            )
            SELECT *
            FROM X
        `),
        ).toEqual(["Orders.* -> *"]);
    });

    test("subquery wildcard flattening", () => {
        expect(
            edgeStrings(`
            SELECT *
            FROM (
                SELECT *
                FROM Orders
            ) s
        `),
        ).toEqual(["Orders.* -> *"]);
    });

    test("cte alias column flattening", () => {
        expect(
            edgeStrings(`
            WITH X AS (
                SELECT Amount AS Total
                FROM Orders
            )
            SELECT X.Total
            FROM X
        `),
        ).toEqual(["Orders.Amount -> Total"]);
    });

    test("nested alias flattening", () => {
        expect(
            edgeStrings(`
            WITH A AS (
                SELECT Id AS OrderId
                FROM Orders
            ),
            B AS (
                SELECT A.OrderId AS FinalId
                FROM A
            )
            SELECT B.FinalId
            FROM B
        `),
        ).toEqual(["Orders.Id -> FinalId", "Orders.Id -> OrderId"]);
    });

    test("insert select wildcard lineage", () => {
        expect(
            edgeStrings(`
            INSERT INTO Audit(Id)
            SELECT *
            FROM Orders
        `),
        ).toEqual(["Orders.* -> Audit.Id"]);
    });

    test("insert values lineage from procedure parameters", () => {
        expect(
            edgeStrings(`
            CREATE PROCEDURE dbo.InsertEvent
                @Category NVARCHAR(100),
                @GroupId NVARCHAR(100),
                @ItemIndex INT,
                @LocationCode NVARCHAR(100)
            AS
            BEGIN
                INSERT INTO dbo.EventLog (
                    Category,
                    GroupId,
                    ItemIndex,
                    LocationCode,
                    StatusFlag
                )
                VALUES (
                    @Category,
                    @GroupId,
                    @ItemIndex,
                    @LocationCode,
                    NULL
                );
            END
        `),
        ).toEqual([
            "@Category -> dbo.EventLog.Category",
            "@GroupId -> dbo.EventLog.GroupId",
            "@ItemIndex -> dbo.EventLog.ItemIndex",
            "@LocationCode -> dbo.EventLog.LocationCode",
        ]);
    });

    test("temp table lineage survives insert-select without explicit target columns", () => {
        expect(
            edgeStrings(`
            CREATE TABLE #ActiveProducts
            (
                ProductId INT
            )

            INSERT INTO #ActiveProducts
            SELECT DISTINCT p.Id
            FROM dbo.SourceProducts p

            CREATE TABLE #ActiveMappings
            (
                MappingId INT
            )

            INSERT INTO #ActiveMappings
            SELECT sourceMap.Id
            FROM dbo.SourceMappings sourceMap
            JOIN #ActiveProducts P
              ON sourceMap.ProductId = P.ProductId
        `),
        ).toEqual([
            "dbo.SourceMappings.Id -> #ActiveMappings.MappingId",
            "dbo.SourceProducts.Id -> #ActiveProducts.ProductId",
        ]);
    });

    test("select variable assignment emits variable-target lineage", () => {
        expect(
            edgeStrings(`
            SELECT TOP 1 @IsEnabled = CONVERT(BIT, ConfigValue)
            FROM dbo.Settings
        `),
        ).toEqual(["dbo.Settings.ConfigValue -> @IsEnabled"]);
    });

    test("update computed assignment lineage", () => {
        expect(
            edgeStrings(`
            UPDATE t
            SET Total = c.Amount + c.Tax
            FROM Target t
            JOIN Charges c
                ON c.Id = t.Id
        `),
        ).toEqual(["Charges.Amount -> t.Total", "Charges.Tax -> t.Total"]);
    });

    test("case dedupes repeated dependency", () => {
        expect(
            edgeStrings(`
            SELECT
                CASE
                    WHEN Amount > 100 THEN Amount
                    ELSE Amount
                END AS FinalAmount
            FROM Orders
        `),
        ).toEqual(["Orders.Amount -> FinalAmount"]);
    });

    test("select star with where preserves source", () => {
        expect(
            edgeStrings(`
            SELECT *
            FROM Users
            WHERE Id = @Id
        `),
        ).toEqual(["Users.* -> *"]);
    });

    test("select star with alias preserves physical table", () => {
        expect(
            edgeStrings(`
            SELECT *
            FROM Users u
            WHERE u.Id = @Id
        `),
        ).toEqual(["Users.* -> *"]);
    });

    test("qualified wildcard resolves physical table", () => {
        expect(
            edgeStrings(`
            SELECT u.*
            FROM Users u
        `),
        ).toEqual(["Users.* -> *"]);
    });

    test("star across multiple joins", () => {
        expect(
            edgeStrings(`
            SELECT *
            FROM Orders o
            JOIN Customer c
                ON o.CustomerId = c.Id
            JOIN Region r
                ON c.RegionId = r.Id
        `),
        ).toEqual(["Customer.* -> *", "Orders.* -> *", "Region.* -> *"]);
    });

    test("mixed wildcard and explicit column", () => {
        expect(
            edgeStrings(`
            SELECT o.*, c.Name
            FROM Orders o
            JOIN Customer c
                ON o.CustomerId = c.Id
        `),
        ).toEqual(["Customer.Name -> Name", "Orders.* -> *"]);
    });

    test("cte star flattening preserves base table", () => {
        expect(
            edgeStrings(`
            WITH X AS (
                SELECT *
                FROM Orders
            )
            SELECT *
            FROM X
        `),
        ).toEqual(["Orders.* -> *"]);
    });

    test("subquery star flattening preserves base table", () => {
        expect(
            edgeStrings(`
            SELECT *
            FROM (
                SELECT *
                FROM Orders
            ) s
        `),
        ).toEqual(["Orders.* -> *"]);
    });

    test("nested cte star flattening", () => {
        expect(
            edgeStrings(`
            WITH A AS (
                SELECT *
                FROM Orders
            ),
            B AS (
                SELECT *
                FROM A
            )
            SELECT *
            FROM B
        `),
        ).toEqual(["Orders.* -> *"]);
    });

    test("cte explicit column flattening", () => {
        expect(
            edgeStrings(`
            WITH X AS (
                SELECT Amount
                FROM Orders
            )
            SELECT X.Amount
            FROM X
        `),
        ).toEqual(["Orders.Amount -> Amount"]);
    });

    test("cte alias flattening", () => {
        expect(
            edgeStrings(`
            WITH X AS (
                SELECT Amount AS Total
                FROM Orders
            )
            SELECT X.Total
            FROM X
        `),
        ).toEqual(["Orders.Amount -> Total"]);
    });

    test("nested cte alias flattening", () => {
        expect(
            edgeStrings(`
            WITH A AS (
                SELECT Id AS OrderId
                FROM Orders
            ),
            B AS (
                SELECT A.OrderId AS FinalId
                FROM A
            )
            SELECT B.FinalId
            FROM B
        `),
        ).toEqual(["Orders.Id -> FinalId", "Orders.Id -> OrderId"]);
    });

    test("subquery alias flattening", () => {
        expect(
            edgeStrings(`
            SELECT s.Total
            FROM (
                SELECT Amount AS Total
                FROM Orders
            ) s
        `),
        ).toEqual(["Orders.Amount -> Total"]);
    });

    test("insert select wildcard lineage", () => {
        expect(
            edgeStrings(`
            INSERT INTO Audit(Id)
            SELECT *
            FROM Orders
        `),
        ).toEqual(["Orders.* -> Audit.Id"]);
    });

    test("update from wildcard expression source", () => {
        expect(
            edgeStrings(`
            UPDATE t
            SET JsonBlob = c.*
            FROM Target t
            JOIN Customer c
                ON c.Id = t.Id
        `),
        ).toEqual(["Customer.* -> t.JsonBlob"]);
    });

    test("case expression dedupes repeated dependency", () => {
        expect(
            edgeStrings(`
            SELECT
                CASE
                    WHEN Amount > 100 THEN Amount
                    ELSE Amount
                END AS FinalAmount
            FROM Orders
        `),
        ).toEqual(["Orders.Amount -> FinalAmount"]);
    });

    describe("OUTPUT lineage", () => {
        test("insert output inserted column", () => {
            expect(
                edgeStrings(`
                INSERT INTO Users(Name)
                OUTPUT inserted.Id
                VALUES ('John')
            `),
            ).toEqual(["INSERTED.Id -> Id"]);
        });

        test("insert output inserted wildcard", () => {
            expect(
                edgeStrings(`
                INSERT INTO Users(Name)
                OUTPUT inserted.*
                VALUES ('John')
            `),
            ).toEqual(["INSERTED.* -> *"]);
        });

        test("insert output into table", () => {
            expect(
                edgeStrings(`
                INSERT INTO Users(Name)
                OUTPUT inserted.Id
                INTO Audit(Id)
                VALUES ('John')
            `),
            ).toEqual(["INSERTED.Id -> Audit.Id"]);
        });

        test("insert output multiple columns into table", () => {
            expect(
                edgeStrings(`
                INSERT INTO Users(Name)
                OUTPUT inserted.Id, inserted.Name
                INTO Audit(Id, Name)
                VALUES ('John')
            `),
            ).toEqual(["INSERTED.Id -> Audit.Id", "INSERTED.Name -> Audit.Name"]);
        });

        test("update output inserted and deleted", () => {
            expect(
                edgeStrings(`
                UPDATE Users
                SET Name = 'John'
                OUTPUT inserted.Name, deleted.Name
                WHERE Id = 1
            `),
            ).toEqual(["DELETED.Name -> Name", "INSERTED.Name -> Name"]);
        });

        test("update output into table", () => {
            expect(
                edgeStrings(`
                UPDATE Users
                SET Name = 'John'
                OUTPUT inserted.Id, deleted.Name
                INTO Audit(Id, OldName)
                WHERE Id = 1
            `),
            ).toEqual(["DELETED.Name -> Audit.OldName", "INSERTED.Id -> Audit.Id"]);
        });

        test("delete output deleted column", () => {
            expect(
                edgeStrings(`
                DELETE FROM Users
                OUTPUT deleted.Id
                WHERE Id = 1
            `),
            ).toEqual(["DELETED.Id -> Id"]);
        });

        test("delete output deleted wildcard", () => {
            expect(
                edgeStrings(`
                DELETE FROM Users
                OUTPUT deleted.*
                WHERE Id = 1
            `),
            ).toEqual(["DELETED.* -> *"]);
        });

        test("delete output into table", () => {
            expect(
                edgeStrings(`
                DELETE FROM Users
                OUTPUT deleted.Id, deleted.Name
                INTO Audit(Id, Name)
                WHERE Id = 1
            `),
            ).toEqual(["DELETED.Id -> Audit.Id", "DELETED.Name -> Audit.Name"]);
        });

        test("output alias maps target name", () => {
            expect(
                edgeStrings(`
                INSERT INTO Users(Name)
                OUTPUT inserted.Id AS NewId
                VALUES ('John')
            `),
            ).toEqual(["INSERTED.Id -> NewId"]);
        });

        test("output assignment alias maps target name", () => {
            expect(
                edgeStrings(`
                INSERT INTO Users(Name)
                OUTPUT NewId = inserted.Id
                VALUES ('John')
            `),
            ).toEqual(["INSERTED.Id -> NewId"]);
        });

        test("output expression lineage", () => {
            expect(
                edgeStrings(`
                UPDATE Users
                SET Name = 'John'
                OUTPUT inserted.Id + deleted.Id AS Delta
                WHERE Id = 1
            `),
            ).toEqual(["DELETED.Id -> Delta", "INSERTED.Id -> Delta"]);
        });

        test("output function lineage", () => {
            expect(
                edgeStrings(`
                INSERT INTO Users(Name)
                OUTPUT LEN(inserted.Name) AS NameLen
                VALUES ('John')
            `),
            ).toEqual(["INSERTED.Name -> NameLen"]);
        });

        test("output literal expression", () => {
            expect(
                edgeStrings(`
                INSERT INTO Users(Name)
                OUTPUT 1 AS Flag
                VALUES ('John')
            `),
            ).toEqual([]);
        });

        test("insert select plus output emits both lineages", () => {
            expect(
                edgeStrings(`
                INSERT INTO Audit(Id)
                OUTPUT inserted.Id INTO Log(Id)
                SELECT Id
                FROM Users
            `),
            ).toEqual(["INSERTED.Id -> Log.Id", "Users.Id -> Audit.Id"]);
        });
    });
});

describe("Lineage metadata", () => {
    test("exposes derived subquery projection for outer alias", () => {
        const result = lineage(`
            SELECT a.SomeName
            FROM (
                SELECT e.FirstName AS SomeName
                FROM Employee e
            ) a
        `);

        const source = result.sources.find((x) => x.alias === "a");
        expect(source?.kind).toBe("derived_subquery");
        expect(source?.projection.map((p) => p.name)).toContain("SomeName");
    });

    test("projection columns include a normalizedName for case-insensitive membership checks", () => {
        const result = lineage(`
            SELECT a.SomeName
            FROM (
                SELECT e.FirstName AS SomeName
                FROM Employee e
            ) a
        `);

        const source = result.sources.find((x) => x.alias === "a");
        const col = source?.projection.find((p) => p.name === "SomeName");

        expect(col?.normalizedName).toBe("somename");
    });

    test("classifies CROSS APPLY function alias as derived_apply source", () => {
        const result = lineage(`
            SELECT ss.value
            FROM Employee e
            CROSS APPLY STRING_SPLIT(e.FirstName, ',') ss
        `);

        const source = result.sources.find((x) => x.alias === "ss");
        expect(source).toBeDefined();
        expect(source?.kind).toBe("derived_apply");
    });

    test("reports ambiguity candidates for bare columns", () => {
        const result = lineage(`
            SELECT Id
            FROM Employee e
            JOIN Department d ON d.Id = e.DepartmentId
        `);

        expect(result.ambiguities.length).toBeGreaterThan(0);
        expect(result.ambiguities[0].name).toBe("Id");
        expect(result.ambiguities[0].candidates.length).toBeGreaterThan(1);
    });

    test("promotes bare column to single viable candidate source", () => {
        const result = lineage(`
            SELECT Name
            FROM Users u
            JOIN (SELECT 1 AS Id) b ON 1 = 1
        `);
        const projected = result.columns.find((c) => c.name === "Name");
        const promotedInput = projected?.inputs.find((i) => i.source === "Users");

        expect(projected).toBeDefined();
        expect(promotedInput).toBeDefined();
        expect(promotedInput?.resolution).toBe("resolved");
        expect(promotedInput?.candidateSources).toEqual(["Users"]);
    });

    test("exposes mutation target metadata for update/delete aliases", () => {
        const result = lineage(`
            UPDATE e
            SET e.FirstName = d.Name
            FROM Employee e
            JOIN Department d ON d.Id = e.DepartmentId;

            DELETE e
            FROM Employee e
            JOIN Department d ON d.Id = e.DepartmentId;
        `);

        const update = result.mutations.find((x) => x.statement === "UPDATE");
        const del = result.mutations.find((x) => x.statement === "DELETE");
        expect(update?.targetName).toBe("e");
        expect(del?.targetName).toBe("e");
    });

    test("exposes INSERT read-scope sources separately from mutation semantics", () => {
        const result = lineage(`
            INSERT INTO dbo.Audit(Id)
            SELECT u.Id
            FROM dbo.Users u
            JOIN dbo.Roles r ON r.Id = u.RoleId;
        `);

        const insertRead = result.readScopes.find((x) => x.statement === "INSERT");
        expect(insertRead).toBeDefined();
        expect(insertRead?.sources.map((s) => s.name)).toEqual(
            expect.arrayContaining(["dbo.Users", "dbo.Roles"]),
        );
    });

    test("exposes UPDATE read-scope sources without leaking write target", () => {
        const result = lineage(`
            UPDATE u
            SET u.Name = r.Name
            FROM dbo.Users u
            JOIN dbo.Roles r ON r.Id = u.RoleId;
        `);

        const update = result.mutations.find((x) => x.statement === "UPDATE");
        const updateRead = result.readScopes.find((x) => x.statement === "UPDATE");
        expect(update?.targetName).toBe("u");
        expect(updateRead).toBeDefined();
        expect(updateRead?.sources.map((s) => s.name)).toEqual(
            expect.arrayContaining(["dbo.Users", "dbo.Roles"]),
        );
    });

    test("exposes DELETE read-scope sources without leaking write target", () => {
        const result = lineage(`
            DELETE u
            FROM dbo.Users u
            JOIN dbo.Roles r ON r.Id = u.RoleId;
        `);

        const del = result.mutations.find((x) => x.statement === "DELETE");
        const delRead = result.readScopes.find((x) => x.statement === "DELETE");
        expect(del?.targetName).toBe("u");
        expect(delRead).toBeDefined();
        expect(delRead?.sources.map((s) => s.name)).toEqual(
            expect.arrayContaining(["dbo.Users", "dbo.Roles"]),
        );
    });

    test("captures update predicate inputs against update target source", () => {
        const result = lineage(`
            UPDATE HackathonWinners
            SET Prize = @GoodieName
            WHERE WinnerId = @WinnerId;
        `);

        const update = result.mutations.find((x) => x.statement === "UPDATE");
        const winnerPredicate = update?.predicateInputs?.find(
            (x) => x.kind === "column" && x.name === "HackathonWinners.WinnerId",
        );

        expect(winnerPredicate).toBeDefined();
        expect(winnerPredicate?.resolution).toBe("resolved");
    });

    test("captures delete predicate inputs against delete target source (DELETE never resolved WHERE at all)", () => {
        const result = lineage(`
            DELETE FROM dbo.Employee
            WHERE DeptId = @DeptId;
        `);

        const del = result.mutations.find((x) => x.statement === "DELETE");
        const deptPredicate = del?.predicateInputs?.find(
            (x) => x.kind === "column" && x.name === "dbo.Employee.DeptId",
        );

        expect(deptPredicate).toBeDefined();
        expect(deptPredicate?.resolution).toBe("resolved");
    });
});
