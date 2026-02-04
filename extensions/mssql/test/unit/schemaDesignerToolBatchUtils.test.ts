/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { locConstants } from "../../src/reactviews/common/locConstants";
import {
    normalizeColumn,
    shouldAutoArrangeForToolBatch,
    TOOL_AUTO_ARRANGE_FOREIGN_KEY_THRESHOLD,
    TOOL_AUTO_ARRANGE_TABLE_THRESHOLD,
    validateTable,
} from "../../src/reactviews/pages/SchemaDesigner/schemaDesignerToolBatchUtils";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";

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
        const pk = normalizeColumn({ name: "Id", dataType: "int", isPrimaryKey: true } as any);
        expect(pk.isNullable).to.equal(false);

        const nvarchar = normalizeColumn({ name: "Name", dataType: "nvarchar" } as any);
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
                columns: [normalizeColumn({ name: "Id", dataType: "int" } as any)],
                foreignKeys: [],
            },
            ["dbo"],
        );
        expect(unknownSchema).to.equal(locConstants.schemaDesigner.schemaNotAvailable("missing"));
    });
});
