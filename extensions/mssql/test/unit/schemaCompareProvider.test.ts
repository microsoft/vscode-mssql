/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import type * as mssql from "vscode-mssql";
import { SchemaDifferenceType, SchemaUpdateAction } from "../../src/enums";
import { projectV1SchemaCompareResult } from "../../src/runbookStudio/providers/schemaCompareProvider";

suite("Runbook Schema Compare provider", () => {
    test("projects recursive STS v1 differences into a bounded provider-neutral document", () => {
        const property = entry({
            differenceType: SchemaDifferenceType.Property,
            sourceScript: "ALTER TABLE [dbo].[Logs] DROP COLUMN [Message];",
            targetScript: "ALTER TABLE [dbo].[Logs] ADD [Message] nvarchar(4000) NOT NULL;",
        });
        const table = entry({
            name: "Table",
            sourceValue: ["dbo", "Logs"],
            targetValue: ["dbo", "Logs"],
            sourceObjectType: "Table",
            targetObjectType: "Table",
            children: [property],
        });
        // The wire contract is cyclic. The adapter must never retain this
        // parent reference or recurse through it.
        property.parent = table;

        const document = projectV1SchemaCompareResult(
            {
                success: true,
                errorMessage: "",
                operationId: "compare-1",
                areEqual: false,
                differences: [table],
            },
            "WideWorldImporters.dacpac",
            "WideWorld_WIP",
        );

        expect(document).to.deep.include({
            schemaVersion: 1,
            areEqual: false,
            totalDifferences: 1,
            truncated: false,
            omittedCount: 0,
        });
        expect(document.provider).to.deep.equal({
            kind: "sts-v1-schema-compare",
            contractVersion: 1,
        });
        expect(document.items[0]).to.deep.include({
            action: "change",
            objectType: "Table",
            sourceName: "dbo.Logs",
            targetName: "dbo.Logs",
        });
        expect(document.items[0].sourceSql).to.contain("DROP COLUMN");
        expect(document.items[0].targetSql).to.contain("ADD [Message]");
        expect(JSON.stringify(document)).not.to.contain("parent");
    });

    test("caps long difference collections honestly", () => {
        const differences = Array.from({ length: 505 }, (_, index) =>
            entry({
                name: "Table",
                updateAction: SchemaUpdateAction.Add,
                targetValue: ["dbo", `Table${index}`],
                targetObjectType: "Table",
            }),
        );
        const document = projectV1SchemaCompareResult(
            {
                success: true,
                errorMessage: "",
                operationId: "compare-2",
                areEqual: false,
                differences,
            },
            "source.dacpac",
            "target",
        );

        expect(document.totalDifferences).to.equal(505);
        expect(document.items).to.have.length(500);
        expect(document.truncated).to.equal(true);
        expect(document.omittedCount).to.equal(5);
    });
});

function entry(overrides: Partial<mssql.DiffEntry>): mssql.DiffEntry {
    return {
        updateAction: SchemaUpdateAction.Change,
        differenceType: SchemaDifferenceType.Object,
        name: "Object",
        sourceValue: [],
        targetValue: [],
        parent: undefined,
        children: [],
        sourceScript: "",
        targetScript: "",
        sourceObjectType: "",
        targetObjectType: "",
        included: true,
        ...overrides,
    } as mssql.DiffEntry;
}
