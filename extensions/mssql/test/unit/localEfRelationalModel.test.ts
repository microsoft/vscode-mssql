/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { analyzeLocalEfMigrationRisk } from "../../src/runbookStudio/runtime/localEfMigrationRisk";
import {
    compareLocalEfRelationalModels,
    createLocalEfRelationalModel,
    LocalEfRelationalModelInput,
    LocalEfRelationalTable,
} from "../../src/runbookStudio/runtime/localEfRelationalModel";

const digestA = "a".repeat(64);
const digestB = "b".repeat(64);
const commitA = "1".repeat(40);
const commitB = "2".repeat(40);

function column(
    name: string,
    storeType: string,
    nullable = false,
): LocalEfRelationalTable["columns"][number] {
    return {
        name,
        storeType,
        nullable,
        identity: name.endsWith("Id"),
        computed: false,
        defaultKind: "none",
    };
}

function table(
    name: string,
    columns: LocalEfRelationalTable["columns"],
    overrides: Partial<LocalEfRelationalTable> = {},
): LocalEfRelationalTable {
    return {
        schema: "dbo",
        name,
        columns,
        primaryKey: columns.some((item) => item.name === `${name}Id`)
            ? { name: `PK_${name}`, columns: [`${name}Id`] }
            : undefined,
        uniqueConstraints: [],
        indexes: [],
        foreignKeys: [],
        checks: [],
        temporal: false,
        ...overrides,
    };
}

function model(
    tables: LocalEfRelationalTable[],
    overrides: Partial<LocalEfRelationalModelInput> = {},
) {
    return createLocalEfRelationalModel({
        provider: { name: "Microsoft.EntityFrameworkCore.SqlServer", version: "8.0.19" },
        source: {
            commit: commitA,
            projectPath: "src/MyApp.Data/MyApp.Data.csproj",
            dbContext: "MyAppDbContext",
            targetFramework: "net8.0",
            sourceSnapshotSha256: digestA,
            toolchainSha256: digestB,
        },
        complete: true,
        unsupported: [],
        tables,
        ...overrides,
    });
}

suite("Runbook Studio EF relational model core", () => {
    test("normalizes ordering into a stable full-model identity", () => {
        const customers = table("Customers", [
            column("Name", "nvarchar(200)"),
            column("CustomersId", "int"),
        ]);
        const orders = table("Orders", [column("OrdersId", "bigint")]);
        const first = model([orders, customers]);
        const second = model([{ ...customers, columns: [...customers.columns].reverse() }, orders]);

        expect(first.modelSha256).to.equal(second.modelSha256);
        expect(first.tables.map((item) => item.name)).to.deep.equal(["Customers", "Orders"]);
        expect(first.tables[0].columns.map((item) => item.name)).to.deep.equal([
            "CustomersId",
            "Name",
        ]);
    });

    test("emits typed additive, destructive, and review changes", () => {
        const base = model([
            table("Customers", [
                column("CustomersId", "int"),
                { ...column("Name", "nvarchar(200)", true), maxLength: 200 },
                column("LegacyCode", "varchar(20)", true),
            ]),
            table("Obsolete", [column("ObsoleteId", "int")]),
        ]);
        const head = model(
            [
                table(
                    "Customers",
                    [
                        column("CustomersId", "int"),
                        { ...column("Name", "nvarchar(100)"), maxLength: 100 },
                        column("Email", "nvarchar(320)", true),
                    ],
                    {
                        indexes: [
                            {
                                name: "IX_Customers_Email",
                                columns: ["Email"],
                                unique: false,
                            },
                        ],
                    },
                ),
                table("AuditLogs", [column("AuditLogsId", "bigint")]),
            ],
            {
                source: {
                    ...base.source,
                    commit: commitB,
                    sourceSnapshotSha256: "c".repeat(64),
                },
            },
        );

        const diff = compareLocalEfRelationalModels(base, head);
        expect(diff.comparable).to.equal(true);
        expect(diff.changes.map((item) => item.kind)).to.include.members([
            "dropTable",
            "addTable",
            "dropColumn",
            "addColumn",
            "alterColumn",
            "addIndex",
        ]);
        expect(diff.changes.find((item) => item.kind === "alterColumn")).to.deep.include({
            risk: "review",
        });
        expect(diff.destructiveChangeCount).to.equal(2);
        expect(diff.potentialDataLoss).to.equal(true);
        expect(diff.diffSha256).to.match(/^[a-f0-9]{64}$/);
    });

    test("surfaces rename candidates but never resolves drop/add implicitly", () => {
        const beforeTable = table("Customers", [
            column("CustomersId", "int"),
            column("DisplayName", "nvarchar(200)", true),
        ]);
        const renamedTable = {
            ...beforeTable,
            name: "Accounts",
            primaryKey: { name: "PK_Accounts", columns: ["CustomersId"] },
        };
        const tableDiff = compareLocalEfRelationalModels(
            model([beforeTable]),
            model([renamedTable]),
        );
        expect(tableDiff.renameCandidates).to.deep.include({
            objectType: "table",
            fromPath: "[dbo].[Customers]",
            toPath: "[dbo].[Accounts]",
            similarity: 1,
        });
        expect(tableDiff.changes.map((item) => item.kind)).to.have.members([
            "dropTable",
            "addTable",
        ]);
        expect(tableDiff.requiresRenameDecision).to.equal(true);

        const columnDiff = compareLocalEfRelationalModels(
            model([beforeTable]),
            model([
                {
                    ...beforeTable,
                    columns: [column("CustomersId", "int"), column("Name", "nvarchar(200)", true)],
                },
            ]),
        );
        expect(columnDiff.renameCandidates[0]).to.deep.include({
            objectType: "column",
            fromPath: "[dbo].[Customers].[DisplayName]",
            toPath: "[dbo].[Customers].[Name]",
            similarity: 1,
        });
        expect(columnDiff.changes.map((item) => item.kind)).to.include.members([
            "dropColumn",
            "addColumn",
        ]);
    });

    test("refuses semantic comparison across incomplete or incompatible providers", () => {
        const base = model([table("Customers", [column("CustomersId", "int")])]);
        const incomplete = model(base.tables, { complete: false });
        expect(compareLocalEfRelationalModels(base, incomplete)).to.deep.include({
            comparable: false,
            reason: "incompleteModel",
            changes: [],
        });

        const otherProvider = model(base.tables, {
            provider: { name: "Microsoft.EntityFrameworkCore.Sqlite", version: "8.0.19" },
        });
        expect(compareLocalEfRelationalModels(base, otherProvider)).to.deep.include({
            comparable: false,
            reason: "providerChanged",
            changes: [],
        });
    });

    test("rejects duplicate objects, unsafe paths, and absent foreign-key targets", () => {
        const duplicate = table("Customers", [column("CustomersId", "int")]);
        expect(() => model([duplicate, duplicate])).to.throw("duplicate table");
        expect(() =>
            model([duplicate], {
                source: {
                    ...model([duplicate]).source,
                    projectPath: "../outside.csproj",
                },
            }),
        ).to.throw("project path");
        expect(() =>
            model([
                table("Orders", [column("OrdersId", "int"), column("CustomerId", "int")], {
                    foreignKeys: [
                        {
                            name: "FK_Orders_Customers",
                            columns: ["CustomerId"],
                            principalSchema: "dbo",
                            principalTable: "Customers",
                            principalColumns: ["CustomersId"],
                            onDelete: "NO_ACTION",
                        },
                    ],
                }),
            ]),
        ).to.throw("absent table");
    });
});

suite("Runbook Studio EF migration risk", () => {
    test("blocks unresolved renames while preserving the underlying drop risks", () => {
        const before = table("Customers", [
            column("CustomersId", "int"),
            column("DisplayName", "nvarchar(200)", true),
        ]);
        const after = {
            ...before,
            columns: [column("CustomersId", "int"), column("Name", "nvarchar(200)", true)],
        };
        const diff = compareLocalEfRelationalModels(model([before]), model([after]));

        const risk = analyzeLocalEfMigrationRisk(diff);

        expect(risk).to.deep.include({
            comparable: true,
            status: "blocked",
            potentialDataLoss: true,
            requiresRenameDecision: true,
            blockerCount: 1,
            reviewCount: 1,
        });
        expect(risk.items.map((item) => item.code)).to.have.members([
            "objectDrop",
            "renameDecisionRequired",
        ]);
        expect(risk.riskSha256).to.match(/^[a-f0-9]{64}$/);
    });

    test("returns reviewRequired for narrowing and blocked for incomparable models", () => {
        const wide = table("Customers", [
            column("CustomersId", "int"),
            { ...column("Name", "nvarchar(200)", true), maxLength: 200 },
        ]);
        const narrow = {
            ...wide,
            columns: [
                column("CustomersId", "int"),
                { ...column("Name", "nvarchar(100)"), maxLength: 100 },
            ],
        };
        const review = analyzeLocalEfMigrationRisk(
            compareLocalEfRelationalModels(model([wide]), model([narrow])),
        );
        expect(review).to.deep.include({
            status: "reviewRequired",
            potentialDataLoss: true,
            blockerCount: 0,
            reviewCount: 1,
        });
        expect(review.items[0]).to.deep.include({
            code: "columnConversion",
            changeKind: "alterColumn",
        });

        const incomplete = model([wide], { complete: false });
        const blocked = analyzeLocalEfMigrationRisk(
            compareLocalEfRelationalModels(model([wide]), incomplete),
        );
        expect(blocked).to.deep.include({
            comparable: false,
            status: "blocked",
            potentialDataLoss: false,
            blockerCount: 1,
        });
        expect(blocked.items[0]).to.deep.include({
            code: "modelIncomparable",
            detail: "incompleteModel",
        });
    });
});
