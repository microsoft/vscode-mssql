/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "node:assert/strict";
import { test } from "node:test";
import { SqlRunner } from "../../src/edit/core/types";
import { loadTableMetadata } from "../../src/edit/metadata/tableMetadata";
import { encodeValue } from "../../src/edit/types/valueCodec";

void test("alias metadata preserves its name while editing uses base-type constraints", async () => {
    const runner: SqlRunner = {
        async query(_sql, options) {
            if (options?.tag !== "sqlEdit.columns") {
                return { columns: [], rows: [] };
            }
            return {
                columns: [],
                rows: [
                    {
                        column_name: "Name",
                        type_name: "nvarchar",
                        declared_type_name: "Name",
                        declared_type_schema: "dbo",
                        max_length: 100,
                        is_nullable: false,
                    },
                    { column_name: "Custom", type_name: "custom_clr" },
                    { column_name: "Id", type_name: "int", is_identity: true },
                    { column_name: "Version", type_name: "timestamp" },
                ],
            };
        },
    };
    const metadata = await loadTableMetadata(runner, "HumanResources", "Department");
    const [name, custom, id, version] = metadata.columns;
    assert.equal(name.declaredTypeName, "Name");
    assert.equal(name.declaredTypeSchema, "dbo");
    assert.equal(name.isWritable, true);
    assert.equal(encodeValue("Engineering", name, name.name), "N'Engineering'");
    assert.throws(() => encodeValue("x".repeat(51), name, name.name));
    assert.equal(custom.isWritable, false);
    assert.equal(id.isWritable, false);
    assert.equal(version.isWritable, false);
    assert.equal(metadata.rowVersionColumn, "Version");
});
