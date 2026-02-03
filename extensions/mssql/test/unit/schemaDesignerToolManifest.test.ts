/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

suite("Schema Designer LM tool manifest schema", () => {
    test("mssql_schema_designer edits use op-specific oneOf schemas", () => {
        const packageJsonPath = path.join(__dirname, "..", "..", "..", "package.json");
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

        const tool = (packageJson.contributes?.languageModelTools ?? []).find(
            (t: any) => t?.name === "mssql_schema_designer",
        );
        expect(tool, "missing mssql_schema_designer tool in contributes.languageModelTools").to
            .exist;

        const editsItemsSchema =
            tool.inputSchema?.properties?.payload?.properties?.edits?.items ?? undefined;
        expect(editsItemsSchema, "missing inputSchema.properties.payload.properties.edits.items").to
            .exist;

        const oneOf = editsItemsSchema.oneOf;
        expect(oneOf, "edits.items.oneOf").to.be.an("array");
        expect(oneOf).to.have.length(9);

        const byOp = new Map<string, any>();
        for (const variant of oneOf) {
            const op = variant?.properties?.op?.enum?.[0];
            expect(op, "each oneOf variant must constrain op via properties.op.enum[0]").to.be.a(
                "string",
            );
            byOp.set(op, variant);

            expect(variant.additionalProperties, `${op}: additionalProperties`).to.equal(false);
            expect(variant.required, `${op}: required`).to.include("op");
        }

        expect([...byOp.keys()].sort()).to.deep.equal(
            [
                "add_column",
                "add_foreign_key",
                "add_table",
                "drop_column",
                "drop_foreign_key",
                "drop_table",
                "set_column",
                "set_foreign_key",
                "set_table",
            ].sort(),
        );

        const addForeignKey = byOp.get("add_foreign_key");
        expect(addForeignKey.required).to.include.members(["table", "foreignKey"]);
        expect(addForeignKey.properties).to.not.have.property("foreignKeyColumn");
        expect(addForeignKey.properties).to.not.have.property("referencedColumn");
        expect(addForeignKey.properties).to.not.have.property("referencedTable");
        expect(addForeignKey.properties).to.not.have.property("constraintName");
        expect(addForeignKey.properties).to.not.have.property("targetTable");

        const foreignKeySchema = addForeignKey.properties.foreignKey;
        expect(foreignKeySchema.additionalProperties).to.equal(false);
        expect(foreignKeySchema.required).to.include.members([
            "name",
            "referencedTable",
            "mappings",
            "onDeleteAction",
            "onUpdateAction",
        ]);

        const addTable = byOp.get("add_table");
        expect(addTable.properties).to.have.property("initialColumns");
        expect(addTable.properties).to.not.have.property("columns");

        const addColumn = byOp.get("add_column");
        expect(addColumn.required).to.include.members(["table", "column"]);
        expect(addColumn.properties.column.required).to.include.members(["name", "dataType"]);

        const setForeignKey = byOp.get("set_foreign_key");
        expect(setForeignKey.required).to.include.members(["table", "foreignKey", "set"]);
        expect(setForeignKey.properties.set.properties).to.have.property("mappings");
    });

    test("mssql_schema_designer apply_edits requires payload.expectedVersion", () => {
        const packageJsonPath = path.join(__dirname, "..", "..", "..", "package.json");
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

        const tool = (packageJson.contributes?.languageModelTools ?? []).find(
            (t: any) => t?.name === "mssql_schema_designer",
        );
        expect(tool, "missing mssql_schema_designer tool in contributes.languageModelTools").to
            .exist;

        const rootOneOf = tool.inputSchema?.oneOf ?? undefined;
        expect(rootOneOf, "missing inputSchema.oneOf").to.be.an("array");

        const applyEditsVariant = rootOneOf.find(
            (v: any) => v?.properties?.operation?.enum?.[0] === "apply_edits",
        );
        expect(applyEditsVariant, "missing inputSchema.oneOf variant for apply_edits").to.exist;

        expect(applyEditsVariant.required, "apply_edits: required").to.include("payload");
        expect(
            applyEditsVariant.properties?.payload?.required,
            "apply_edits: payload.required",
        ).to.include.members(["expectedVersion", "edits"]);
    });
});
