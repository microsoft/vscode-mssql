/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    MappingCatalogProvider,
    SaralSqlAnalysisEngine,
} from "@vscode-mssql/tsql-language-service";

/** Parser-facing contracts below the Langium lifecycle adapter. */
suite("Langium migration package parser contracts", () => {
    const catalog = new MappingCatalogProvider(
        {
            dbo: {
                Orders: {
                    OrderId: "int",
                    UserId: "int",
                    Total: "decimal(10,2)",
                    OrderDate: "datetime2",
                    Status: "nvarchar",
                },
                Users: {
                    UserId: "int",
                    DisplayName: "nvarchar",
                    IsActive: "bit",
                },
                ArchiveUsers: {},
            },
        },
        1,
        "closed",
    );
    const engine = new SaralSqlAnalysisEngine();

    test("reuses unchanged GO batches across immutable edits", () => {
        const originalText =
            "SELECT UserId FROM dbo.Users;\nGO\n" +
            "SELECT OrderId, Total FROM dbo.Orders WHERE Total > 10;\nGO\n" +
            "SELECT DisplayName FROM dbo.Users;";
        const original = engine.createSnapshot({
            text: originalText,
            uri: "file:///langium-incremental-contract.sql",
            catalog,
        });
        const edited = engine.updateSnapshot(original, {
            text: originalText.replace("Total > 10", "Total > 20"),
        });

        expect(edited).to.not.equal(original);
        expect(edited.version).to.equal(original.version + 1);
        expect(edited.uri).to.equal(original.uri);
        expect(original.text).to.equal(originalText);
        const statistics = (
            edited as typeof edited & {
                readonly incrementalStatistics: {
                    readonly parsedBatchCount: number;
                    readonly reusedBatchCount: number;
                    readonly totalBatchCount: number;
                };
            }
        ).incrementalStatistics;
        expect(statistics).to.deep.include({
            parsedBatchCount: 1,
            reusedBatchCount: 2,
            totalBatchCount: 3,
        });
        expect(original.syntaxDiagnostics).to.be.empty;
        expect(edited.syntaxDiagnostics).to.be.empty;
    });

    test("keeps monotonically versioned snapshots for stale-result rejection", () => {
        const first = engine.createSnapshot({
            text: "SELECT UserId FROM dbo.Users",
            uri: "file:///langium-version-contract.sql",
            catalog,
        });
        const second = engine.updateSnapshot(first, {
            text: "SELECT DisplayName FROM dbo.Users",
        });
        const third = engine.updateSnapshot(second, {
            text: "SELECT IsActive FROM dbo.Users",
        });

        expect([first.version, second.version, third.version]).to.deep.equal([1, 2, 3]);
        expect(new Set([first.uri, second.uri, third.uri])).to.deep.equal(
            new Set(["file:///langium-version-contract.sql"]),
        );
    });

    const parserSurface = [
        `WITH ActiveUsers AS (SELECT UserId FROM dbo.Users), RankedOrders AS
         (SELECT o.UserId, ROW_NUMBER() OVER (PARTITION BY o.UserId ORDER BY o.OrderDate) AS rn
          FROM dbo.Orders AS o) SELECT * FROM ActiveUsers;`,
        `MERGE dbo.Users AS target USING dbo.Users AS source ON target.UserId = source.UserId
         WHEN MATCHED THEN UPDATE SET target.DisplayName = source.DisplayName
         WHEN NOT MATCHED THEN INSERT (UserId) VALUES (source.UserId);`,
        `SELECT u.UserId, latest.Total FROM dbo.Users AS u OUTER APPLY
         (SELECT TOP (1) o.Total FROM dbo.Orders AS o WHERE o.UserId = u.UserId) AS latest;`,
        `SELECT UserId, [Open] FROM (SELECT UserId, Status, Total FROM dbo.Orders) AS source
         PIVOT (SUM(Total) FOR Status IN ([Open])) AS pivoted;`,
        `SELECT UserId FROM dbo.Users FOR JSON PATH, ROOT('users');`,
        `BEGIN TRY SELECT UserId FROM dbo.Users; END TRY BEGIN CATCH THROW; END CATCH;`,
        `CREATE OR ALTER VIEW dbo.ActiveUsers AS SELECT UserId FROM dbo.Users;`,
        `DROP TABLE IF EXISTS dbo.LegacyUsers;`,
        `EXEC dbo.ArchiveUsers @UserId = 42;`,
    ] as const;

    for (const [index, sql] of parserSurface.entries()) {
        test(`parses SqlParser-derived surface ${index + 1}`, () => {
            const snapshot = engine.createSnapshot({ text: sql, catalog });
            expect(snapshot.statements).to.not.be.empty;
            expect(
                snapshot.syntaxDiagnostics,
                snapshot.syntaxDiagnostics.map((item) => item.message).join("; "),
            ).to.be.empty;
        });
    }

    test("returns cross-statement variable references", () => {
        const sql =
            "DECLARE @MinTotal decimal(10,2) = 10;\n" +
            "SELECT OrderId FROM dbo.Orders WHERE Total > @MinTotal;\n" +
            "SELECT @MinTotal AS Threshold;";
        const snapshot = engine.createSnapshot({ text: sql, catalog });
        const references = snapshot.referencesAt(sql.indexOf("@MinTotal", 20));

        expect(references).to.deep.include({ symbol: "@MinTotal", kind: "variable" });
        expect(references?.occurrences.map((occurrence) => occurrence.role)).to.deep.equal([
            "declaration",
            "reference",
            "reference",
        ]);
    });

    test("exposes tokens, clauses, and star expansion through the neutral contract", () => {
        const sql = "/* note\n note */ SELECT * FROM dbo.Users WHERE IsActive = 1;";
        const snapshot = engine.createSnapshot({ text: sql, catalog });
        expect(new Set(snapshot.tokens.map((token) => token.role))).to.include.members([
            "comment",
            "keyword",
            "identifier",
            "number",
            "operator",
        ]);
        expect(snapshot.clausesAt(sql.indexOf("WHERE")).map((clause) => clause.kind)).to.deep.equal(
            ["select", "from", "where"],
        );
        expect(
            snapshot.expandStarAt(sql.lastIndexOf("*"))?.map((column) => column.name),
        ).to.deep.equal(["UserId", "DisplayName", "IsActive"]);
    });
});
