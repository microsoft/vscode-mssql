/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import type { QsResultSetSummary } from "../../src/sharedInterfaces/queryStudio";
import { classifyQueryStudioResultTabs } from "../../src/sharedInterfaces/queryStudioResultTabs";

suite("Query Studio result tab classification", () => {
    test("classifies mixed schemas in one metadata pass", () => {
        const data: QsResultSetSummary = {
            resultSetId: "b0r0s0",
            batchOrdinal: 0,
            columnNames: ["id", "shape", "label", "embedding"],
            columns: [
                { name: "id", displayName: "id", sqlType: "int" },
                {
                    name: "shape",
                    displayName: "Location",
                    sqlType: "geography",
                    spatial: { kind: "geography", encoding: "wkb-v1" },
                },
                { name: "label", displayName: "Label", sqlType: "nvarchar" },
                {
                    name: "embedding",
                    displayName: "Embedding",
                    sqlType: "vector",
                    vector: { transport: "binary-v1", dimensions: 1536 },
                },
            ],
            rowCount: 42,
            complete: true,
        };
        const plan: QsResultSetSummary = {
            resultSetId: "b0r1s0",
            batchOrdinal: 1,
            columnNames: ["ShowPlanXML"],
            columns: [{ name: "ShowPlanXML", displayName: "ShowPlanXML", sqlType: "xml" }],
            rowCount: 1,
            complete: true,
            isPlanResult: true,
        };

        const classified = classifyQueryStudioResultTabs([data, plan]);

        expect(classified.dataResultSets).to.deep.equal([data]);
        expect(classified.planResultSets).to.deep.equal([plan]);
        expect(classified.totalColumns).to.equal(5);
        expect(classified.gridKeysByResult["b0r0s0"]).to.match(/^b0r0s0:4:/);
        expect(classified.gridKeysByResult["b0r1s0"]).to.equal(undefined);
        expect(classified.vectorColumns).to.deep.equal([
            {
                resultSetId: "b0r0s0",
                columnOrdinal: 3,
                columnName: "Embedding",
                dimensions: 1536,
                transport: "binary-v1",
            },
        ]);
        expect(classified.stringColumnsByResult).to.deep.equal({
            b0r0s0: [{ ordinal: 2, name: "Label" }],
        });
        expect(classified.spatialColumns).to.have.length(1);
        expect(classified.spatialColumns[0]).to.include({
            resultSetId: "b0r0s0",
            resultSetLabel: "Result 1",
            columnOrdinal: 1,
            columnName: "Location",
            kind: "geography",
            summaryRowCount: 42,
        });
    });

    test("shares display-column metadata across spatial columns", () => {
        const summary: QsResultSetSummary = {
            resultSetId: "b0r0s0",
            batchOrdinal: 0,
            columnNames: ["a", "b", "label"],
            columns: [
                {
                    name: "a",
                    displayName: "a",
                    sqlType: "geometry",
                    spatial: { kind: "geometry", encoding: "wkb-v1" },
                },
                {
                    name: "b",
                    displayName: "b",
                    sqlType: "geography",
                    spatial: { kind: "geography", encoding: "wkb-v1" },
                },
                { name: "label", displayName: "label", sqlType: "varchar" },
            ],
            rowCount: 10,
            complete: false,
        };

        const classified = classifyQueryStudioResultTabs([summary]);

        expect(classified.spatialColumns).to.have.length(2);
        expect(classified.spatialColumns[0].columns).to.equal(classified.spatialColumns[1].columns);
        expect(classified.spatialColumns[0].columns).to.deep.equal([
            { ordinal: 0, name: "a", sqlType: "geometry" },
            { ordinal: 1, name: "b", sqlType: "geography" },
            { ordinal: 2, name: "label", sqlType: "varchar" },
        ]);
    });

    test("changes the immutable grid key when a reused result id changes schema", () => {
        const classify = (columns: NonNullable<QsResultSetSummary["columns"]>) =>
            classifyQueryStudioResultTabs([
                {
                    resultSetId: "same",
                    batchOrdinal: 0,
                    columnNames: columns.map((column) => column.name),
                    columns,
                    rowCount: 1,
                    complete: true,
                },
            ]).gridKeysByResult.same;

        const scalar = classify([{ name: "value", displayName: "value", sqlType: "int" }]);
        const wide = classify([
            { name: "value", displayName: "value", sqlType: "int" },
            { name: "payload", displayName: "payload", sqlType: "nvarchar" },
        ]);
        const renamed = classify([{ name: "renamed", displayName: "renamed", sqlType: "int" }]);

        expect(wide).not.to.equal(scalar);
        expect(renamed).not.to.equal(scalar);
    });
});
