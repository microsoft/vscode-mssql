/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { locConstants } from "../../src/reactviews/common/locConstants";
import {
    normalizeTable,
    normalizeColumn,
    shouldAutoArrangeForToolBatch,
    TOOL_AUTO_ARRANGE_FOREIGN_KEY_THRESHOLD,
    TOOL_AUTO_ARRANGE_TABLE_THRESHOLD,
    validateTable,
} from "../../src/reactviews/pages/SchemaDesigner/model/toolBatchUtils";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";

const createColumn = (partial: Partial<SchemaDesigner.Column>): SchemaDesigner.Column =>
    partial as SchemaDesigner.Column;

suite("Schema Designer tool batch utils", () => {
    test("shouldAutoArrangeForToolBatch triggers on table or foreign key thresholds", () => {
        expect(TOOL_AUTO_ARRANGE_TABLE_THRESHOLD).to.equal(5);
        expect(TOOL_AUTO_ARRANGE_FOREIGN_KEY_THRESHOLD).to.equal(3);

        expect(
            shouldAutoArrangeForToolBatch({
                preTableCount: 0,
                postTableCount: 4,
                preForeignKeyCount: 0,
                postForeignKeyCount: 0,
            }),
        ).to.equal(false);

        expect(
            shouldAutoArrangeForToolBatch({
                preTableCount: 0,
                postTableCount: 5,
                preForeignKeyCount: 0,
                postForeignKeyCount: 0,
            }),
        ).to.equal(true);

        expect(
            shouldAutoArrangeForToolBatch({
                preTableCount: 10,
                postTableCount: 10,
                preForeignKeyCount: 0,
                postForeignKeyCount: 3,
            }),
        ).to.equal(true);

        expect(
            shouldAutoArrangeForToolBatch({
                preTableCount: 10,
                postTableCount: 10,
                preForeignKeyCount: 0,
                postForeignKeyCount: 2,
            }),
        ).to.equal(false);
    });

    test("normalizeColumn enforces primary key non-nullable and defaults lengths", () => {
        const pk = normalizeColumn(
            createColumn({ name: "Id", dataType: "int", isPrimaryKey: true }),
        );
        expect(pk.isNullable).to.equal(false);

        const nvarchar = normalizeColumn(createColumn({ name: "Name", dataType: "nvarchar" }));
        expect(nvarchar.maxLength).to.not.equal("");
    });

    test("validateTable rejects empty columns and unknown schema", () => {
        const schema: SchemaDesigner.Schema = { tables: [] };

        const noColumns = validateTable(
            schema,
            { id: "t1", name: "T", schema: "dbo", columns: [], foreignKeys: [] },
            ["dbo"],
        );
        expect(noColumns).to.equal(locConstants.schemaDesigner.tableMustHaveColumns);

        const unknownSchema = validateTable(
            schema,
            {
                id: "t2",
                name: "T2",
                schema: "missing",
                columns: [normalizeColumn(createColumn({ name: "Id", dataType: "int" }))],
                foreignKeys: [],
            },
            ["dbo"],
        );
        expect(unknownSchema).to.equal(locConstants.schemaDesigner.schemaNotAvailable("missing"));
    });

    test("normalizeTable maps legacy FK column names to id-based fields", () => {
        const sourceId = "c1";
        const table = {
            id: "t1",
            name: "T1",
            schema: "dbo",
            columns: [
                {
                    id: sourceId,
                    name: "Id",
                    dataType: "int",
                    maxLength: "",
                    precision: 0,
                    scale: 0,
                    isPrimaryKey: true,
                    isIdentity: false,
                    identitySeed: 1,
                    identityIncrement: 1,
                    isNullable: false,
                    defaultValue: "",
                    isComputed: false,
                    computedFormula: "",
                    computedPersisted: false,
                },
            ],
            foreignKeys: [
                {
                    id: "fk1",
                    name: "FK_T1_T2",
                    columns: ["Id"],
                    referencedTableName: "T2",
                    referencedColumns: ["rid1"],
                    onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                    onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                },
            ],
        } as unknown as SchemaDesigner.Table;

        const normalized = normalizeTable(table);
        expect(normalized).to.not.equal(undefined);
        expect(normalized?.foreignKeys[0].columnsIds).to.deep.equal([sourceId]);
        expect(normalized?.foreignKeys[0].referencedColumnsIds).to.deep.equal(["rid1"]);
        expect(normalized?.foreignKeys[0].referencedTableId).to.equal("");
    });
});
