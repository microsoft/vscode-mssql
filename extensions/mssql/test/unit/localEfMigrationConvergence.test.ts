/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import type { LocalEfMigrationManifest } from "../../src/runbookStudio/runtime/localEfMigrationGenerator";
import {
    LocalEfMigrationConvergenceError,
    projectLocalEfLiveSchema,
    verifyLocalEfMigrationScope,
} from "../../src/runbookStudio/runtime/localEfMigrationConvergence";
import {
    createLocalEfRelationalModel,
    type LocalEfRelationalModel,
    type LocalEfRelationalTable,
} from "../../src/runbookStudio/runtime/localEfRelationalModel";

const repeatedDigest = (value: string) => value.repeat(64);

function model(tables: LocalEfRelationalTable[]): LocalEfRelationalModel {
    return createLocalEfRelationalModel({
        provider: { name: "Microsoft.EntityFrameworkCore.SqlServer", version: "8.0.19" },
        source: {
            commit: "1".repeat(40),
            projectPath: "src/App.Data/App.Data.csproj",
            dbContext: "AppDbContext",
            targetFramework: "net8.0",
            sourceSnapshotSha256: repeatedDigest("a"),
            toolchainSha256: repeatedDigest("b"),
        },
        complete: true,
        unsupported: [],
        tables,
    });
}

function rehearsalTable(): LocalEfRelationalTable {
    return {
        schema: "dbo",
        name: "RehearsalEvents",
        columns: [
            {
                name: "Id",
                storeType: "int",
                nullable: false,
                identity: true,
                computed: false,
                defaultKind: "none",
            },
            {
                name: "Message",
                storeType: "nvarchar(200)",
                nullable: false,
                identity: false,
                computed: false,
                defaultKind: "none",
            },
        ],
        primaryKey: { name: "PK_RehearsalEvents", columns: ["Id"] },
        uniqueConstraints: [],
        indexes: [
            {
                name: "IX_RehearsalEvents_Message",
                columns: ["Message"],
                unique: false,
            },
        ],
        foreignKeys: [],
        checks: [],
        temporal: false,
    };
}

function manifest(
    base: LocalEfRelationalModel,
    head: LocalEfRelationalModel,
): LocalEfMigrationManifest {
    return {
        schemaVersion: 1,
        baseModelSha256: base.modelSha256,
        headModelSha256: head.modelSha256,
        diffSha256: repeatedDigest("c"),
        riskSha256: repeatedDigest("d"),
        renameDecisions: [],
        operations: [
            {
                sequence: 1,
                kind: "addTable",
                objectType: "table",
                path: "[dbo].[RehearsalEvents]",
                risk: "safe",
                forwardStatementCount: 1,
                rollbackStatementCount: 1,
            },
        ],
        potentialDataLoss: false,
        rollbackCompleteness: "complete",
        forwardScriptSha256: repeatedDigest("e"),
        rollbackScriptSha256: repeatedDigest("f"),
        manifestSha256: repeatedDigest("0"),
    };
}

function environmentRow(): unknown[] {
    return ["environment", "", "", "", 0, "0", "SQL_Latin1_General_CP1_CI_AS"];
}

function matchingRows(): unknown[][] {
    return [
        environmentRow(),
        ["table", "dbo", "RehearsalEvents", "RehearsalEvents", 0, "0"],
        [
            "column",
            "dbo",
            "RehearsalEvents",
            "Id",
            1,
            "int",
            "4",
            "10",
            "0",
            "0",
            "1",
            "1",
            "1",
            "0",
            "0",
            null,
        ],
        [
            "column",
            "dbo",
            "RehearsalEvents",
            "Message",
            2,
            "nvarchar",
            "400",
            "0",
            "0",
            "0",
            "0",
            null,
            null,
            "0",
            "0",
            "SQL_Latin1_General_CP1_CI_AS",
        ],
        ["key", "dbo", "RehearsalEvents", "PK_RehearsalEvents", 1, "primaryKey", "Id"],
        [
            "index",
            "dbo",
            "RehearsalEvents",
            "IX_RehearsalEvents_Message",
            1,
            "Message",
            "0",
            "0",
            null,
        ],
    ];
}

suite("Runbook Studio EF migration convergence", () => {
    test("projects catalog rows and proves the forward migration scope", () => {
        const base = model([]);
        const head = model([rehearsalTable()]);
        const result = verifyLocalEfMigrationScope({
            expectedState: "head",
            expected: head,
            manifest: manifest(base, head),
            live: projectLocalEfLiveSchema(matchingRows()),
            now: () => new Date("2026-07-21T00:00:00.000Z"),
        });

        expect(result).to.deep.include({
            expectedState: "head",
            scopeTableCount: 1,
            differenceCount: 0,
            complete: true,
            converged: true,
            verifiedAtUtc: "2026-07-21T00:00:00.000Z",
        });
        expect(result.checkedObjectCount).to.equal(10);
        expect(result.comparisonSha256).to.match(/^[a-f0-9]{64}$/);
    });

    test("treats explicit scale 7 temporal types as SQL Server defaults", () => {
        const table = rehearsalTable();
        table.columns.push({
            name: "RecordedAt",
            storeType: "datetime2(7)",
            nullable: false,
            identity: false,
            computed: false,
            defaultKind: "none",
        });
        const rows = matchingRows();
        rows.splice(3, 0, [
            "column",
            "dbo",
            "RehearsalEvents",
            "RecordedAt",
            3,
            "datetime2",
            "8",
            "27",
            "7",
            "0",
            "0",
            null,
            null,
            "0",
            "0",
            null,
        ]);
        const base = model([]);
        const head = model([table]);

        const result = verifyLocalEfMigrationScope({
            expectedState: "head",
            expected: head,
            manifest: manifest(base, head),
            live: projectLocalEfLiveSchema(rows),
            now: () => new Date("2026-07-21T00:00:00.000Z"),
        });

        expect(result.differences).to.deep.equal([]);
        expect(result.converged).to.equal(true);
    });

    test("returns typed facts for changed and unexpected schema objects", () => {
        const base = model([]);
        const head = model([rehearsalTable()]);
        const rows = matchingRows();
        rows[3][5] = "varchar";
        rows.push([
            "column",
            "dbo",
            "RehearsalEvents",
            "Unexpected",
            3,
            "int",
            "4",
            "10",
            "0",
            "1",
            "0",
            null,
            null,
            "0",
            "0",
            null,
        ]);

        const result = verifyLocalEfMigrationScope({
            expectedState: "head",
            expected: head,
            manifest: manifest(base, head),
            live: projectLocalEfLiveSchema(rows),
        });

        expect(result.converged).to.equal(false);
        expect(result.differences).to.deep.include.members([
            {
                kind: "changed",
                objectType: "column",
                path: "[dbo].[RehearsalEvents].[Message]",
                property: "storeType",
                expected: "nvarchar(200)",
                actual: "varchar(400)",
            },
            {
                kind: "unexpected",
                objectType: "column",
                path: "[dbo].[RehearsalEvents].[Unexpected]",
                property: "existence",
                expected: "absent",
                actual: "present",
            },
        ]);
    });

    test("proves rollback when the added table is absent from base and live schema", () => {
        const base = model([]);
        const head = model([rehearsalTable()]);
        const result = verifyLocalEfMigrationScope({
            expectedState: "base",
            expected: base,
            manifest: manifest(base, head),
            live: projectLocalEfLiveSchema([environmentRow()]),
        });

        expect(result).to.deep.include({ differenceCount: 0, converged: true });
        expect(result.checkedObjectCount).to.equal(0);
    });

    test("rejects malformed, duplicate, and digest-mismatched evidence", () => {
        expect(() => projectLocalEfLiveSchema([])).to.throw(LocalEfMigrationConvergenceError);
        expect(() =>
            projectLocalEfLiveSchema([
                environmentRow(),
                ["table", "dbo", "Events", "Events", 0, "0"],
                ["table", "dbo", "Events", "Events", 0, "0"],
            ]),
        ).to.throw("duplicate table");

        const base = model([]);
        const head = model([rehearsalTable()]);
        expect(() =>
            verifyLocalEfMigrationScope({
                expectedState: "head",
                expected: { ...head, modelSha256: repeatedDigest("9") },
                manifest: manifest(base, head),
                live: projectLocalEfLiveSchema(matchingRows()),
            }),
        ).to.throw("reviewed migration manifest");
    });
});
