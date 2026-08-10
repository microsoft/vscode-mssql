import {
    analyze,
    extractDeclarations,
    extractDependencies,
    extractReferences,
} from "../../src/parser/saral/index.js";

describe("AST fact extractors", () => {
    test("extractDeclarations returns schema object declarations with columns and parameters", () => {
        const sql = `
            CREATE TABLE dbo.Users(
                Id INT,
                Name NVARCHAR(100)
            );

            CREATE PROCEDURE dbo.GetUser
                @Id INT
            AS
            BEGIN
                SELECT Id FROM dbo.Users WHERE Id = @Id;
            END
        `;

        const declarations = extractDeclarations(analyze(sql).ast);
        const table = declarations.find((d) => d.name === "dbo.Users");
        const proc = declarations.find((d) => d.name === "dbo.GetUser");

        expect(table).toMatchObject({
            kind: "table",
            normalizedName: "dbo.users",
        });
        expect(table?.columns?.map((c) => c.name)).toEqual(["Id", "Name"]);

        expect(proc).toMatchObject({
            kind: "procedure",
            normalizedName: "dbo.getuser",
        });
        expect(proc?.parameters?.map((p) => p.name)).toEqual(["@Id"]);
        expect(proc?.nameLocation.start).toBe(sql.indexOf("dbo.GetUser"));
    });

    test("extractReferences returns object references from DML and query sources", () => {
        const sql = `
            INSERT INTO dbo.Audit(Id)
            SELECT u.Id
            FROM dbo.Users u
            JOIN dbo.Roles r ON r.Id = u.RoleId;
        `;

        const references = extractReferences(analyze(sql).ast);

        expect(references).toContainEqual(
            expect.objectContaining({
                kind: "table",
                context: "insert-target",
                name: "dbo.Audit",
                normalizedName: "dbo.audit",
            }),
        );
        expect(references).toContainEqual(
            expect.objectContaining({
                kind: "table",
                context: "from",
                name: "dbo.Users",
                normalizedName: "dbo.users",
            }),
        );
        expect(references).toContainEqual(
            expect.objectContaining({
                kind: "table",
                context: "join",
                name: "dbo.Roles",
                normalizedName: "dbo.roles",
            }),
        );
    });

    test("extractReferences tags FROM/JOIN aliases as alias kind, not bare table-name lookalikes", () => {
        // Before the fix: the alias itself ('u', 'r') had no reference
        // entry of its own at all — only the real table names did. A host
        // doing schema validation by scanning for table-like tokens had no
        // parser-native signal to avoid treating 'u'/'r' as table names.
        const sql = `
            SELECT u.Id FROM dbo.Users u
            JOIN dbo.Roles r ON r.Id = u.RoleId;
        `;

        const references = extractReferences(analyze(sql).ast);

        expect(references).toContainEqual(
            expect.objectContaining({
                kind: "alias",
                context: "from",
                name: "u",
                normalizedName: "u",
            }),
        );
        expect(references).toContainEqual(
            expect.objectContaining({
                kind: "alias",
                context: "join",
                name: "r",
                normalizedName: "r",
            }),
        );
    });

    test("extractReferences tags an alias.* wildcard qualifier as alias kind, not unknown", () => {
        const sql = `SELECT d.* FROM dbo.Department d;`;
        const references = extractReferences(analyze(sql).ast);

        const wildcardQualifier = references.find(
            (r) => r.context === "expression" && r.name === "d",
        );

        expect(wildcardQualifier).toMatchObject({ kind: "alias" });
    });

    test("extractReferences emits qualified OUTPUT pseudo-table references", () => {
        const sql = `
            UPDATE dbo.Users
            SET Name = 'A'
            OUTPUT inserted.Id, deleted.Name
            INTO dbo.Audit(UserId, OldName)
            WHERE Id = 1;
        `;
        const references = extractReferences(analyze(sql).ast);

        expect(references).toContainEqual(
            expect.objectContaining({
                kind: "column",
                context: "expression",
                name: "INSERTED.Id",
                normalizedName: "inserted.id",
            }),
        );
        expect(references).toContainEqual(
            expect.objectContaining({
                kind: "column",
                context: "expression",
                name: "DELETED.Name",
                normalizedName: "deleted.name",
            }),
        );
    });

    test("insert-target reference remains anchored to target table token", () => {
        const sql = `INSERT INTO dbo.TargetTable (FirstCol, SecondCol) VALUES (1, 2);`;
        const references = extractReferences(analyze(sql).ast);
        const insertTarget = references.find((r) => r.context === "insert-target");
        const firstColOffset = sql.indexOf("FirstCol");

        expect(insertTarget).toBeDefined();
        expect(insertTarget?.name).toBe("dbo.TargetTable");
        expect(insertTarget?.location.start).toBe(sql.indexOf("dbo.TargetTable"));
        expect(insertTarget!.location.start).toBeLessThan(firstColOffset);
    });

    test("extractReferences includes execute target context", () => {
        const sql = `EXEC dbo.SyncUsers @BatchId = 1;`;
        const references = extractReferences(analyze(sql).ast);

        expect(references).toContainEqual(
            expect.objectContaining({
                kind: "table",
                context: "execute-target",
                name: "dbo.SyncUsers",
                normalizedName: "dbo.syncusers",
            }),
        );
    });

    test("extractReferences reports physical mutation and routine targets", () => {
        const sql = `
            INSERT INTO dbo.InsertTarget(Id) VALUES (1);
            UPDATE u SET Name = 'updated' FROM dbo.UpdateTarget AS u WHERE u.Id = 1;
            DELETE d FROM dbo.DeleteTarget AS d WHERE d.Id = 1;
            MERGE INTO dbo.MergeTarget AS target
            USING dbo.MergeSource AS source ON target.Id = source.Id
            WHEN MATCHED THEN UPDATE SET Name = source.Name
            WHEN NOT MATCHED THEN INSERT (Id, Name) VALUES (source.Id, source.Name);
            EXEC dbo.SyncTargets;
        `;

        const references = extractReferences(analyze(sql).ast);

        expect(references).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ context: "insert-target", name: "dbo.InsertTarget" }),
                expect.objectContaining({ context: "update-target", name: "dbo.UpdateTarget" }),
                expect.objectContaining({ context: "delete-target", name: "dbo.DeleteTarget" }),
                expect.objectContaining({ context: "merge-target", name: "dbo.MergeTarget" }),
                expect.objectContaining({ context: "from", name: "dbo.MergeSource" }),
                expect.objectContaining({ context: "execute-target", name: "dbo.SyncTargets" }),
            ]),
        );
        expect(references).not.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ context: "update-target", name: "u" }),
                expect.objectContaining({ context: "delete-target", name: "d" }),
            ]),
        );
    });

    test("derived table alias does not emit invalid object reference names", () => {
        const sql = `
            SELECT d.SomeName
            FROM (
                SELECT e.FirstName AS SomeName
                FROM Employee e
            ) d
        `;
        const references = extractReferences(analyze(sql).ast);
        const names = references.map((r) => r.name);

        expect(names).not.toContain("[object Object]");
        expect(references.some((r) => r.context === "from" && r.name === "Employee")).toBe(true);
    });

    test("extractReferences includes references inside TRY...CATCH blocks", () => {
        const sql = `
            BEGIN TRY
                INSERT INTO dbo.Audit(Id) VALUES (1);
            END TRY
            BEGIN CATCH
                SELECT Id FROM dbo.ErrorLog;
            END CATCH
        `;
        const references = extractReferences(analyze(sql).ast);

        expect(references).toContainEqual(
            expect.objectContaining({ name: "dbo.Audit", context: "insert-target" }),
        );
        expect(references).toContainEqual(
            expect.objectContaining({ name: "dbo.ErrorLog", context: "from" }),
        );
    });

    test("extractReferences includes references inside control flow blocks", () => {
        const sql = `
            WHILE @Count < 10
            BEGIN
                EXEC dbo.DoWork @Count;
            END
        `;
        const references = extractReferences(analyze(sql).ast);

        expect(references).toContainEqual(
            expect.objectContaining({ name: "dbo.DoWork", context: "execute-target" }),
        );
        expect(references).toContainEqual(
            expect.objectContaining({ name: "@Count", context: "expression" }),
        );
    });

    test("extractDependencies links created objects to referenced objects", () => {
        const sql = `
            CREATE VIEW dbo.ActiveUsers AS
            SELECT u.Id
            FROM dbo.Users u
            JOIN dbo.Roles r ON r.Id = u.RoleId;
        `;

        const dependencies = extractDependencies(analyze(sql).ast);

        expect(dependencies).toContainEqual(
            expect.objectContaining({
                from: "dbo.ActiveUsers",
                to: "dbo.Users",
                normalizedFrom: "dbo.activeusers",
                normalizedTo: "dbo.users",
                context: "from",
            }),
        );
        expect(dependencies).toContainEqual(
            expect.objectContaining({
                from: "dbo.ActiveUsers",
                to: "dbo.Roles",
                normalizedFrom: "dbo.activeusers",
                normalizedTo: "dbo.roles",
                context: "join",
            }),
        );
    });

    test("extractDependencies ignores local CTE names as external dependencies", () => {
        const sql = `
            WITH UserIds AS (SELECT Id FROM dbo.Users)
            SELECT Id FROM UserIds;
        `;

        const dependencies = extractDependencies(analyze(sql).ast);

        expect(dependencies.map((d) => d.normalizedTo)).toContain("dbo.users");
        expect(dependencies.map((d) => d.normalizedTo)).not.toContain("userids");
    });
});
