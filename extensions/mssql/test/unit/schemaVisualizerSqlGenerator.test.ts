/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SV-R5 informational SQL generator (visualizer addendum §12.3): the
 * correctness cases the LEGACY generator fails are first-class here —
 * `]` escaping, named PK/UNIQUE in key-ordinal order, exact identity
 * text, named defaults, computed columns, composite FK order, referential
 * actions, self-referencing FKs — plus the honesty matrix: every unknown
 * fact is an OMITTED clause + warning, never a fabricated value. Output
 * is labeled informational; nothing here is a publish artifact.
 */

import { expect } from "chai";
import {
    CatalogBuilder,
    CatalogSection,
    SectionState,
} from "../../src/services/metadata/catalogModel";
import { buildVisualizerModel } from "../../src/schemaVisualizer/model/catalogToVisualizerModel";
import {
    generateTableScript,
    INFORMATIONAL_HEADER,
    quoteIdentifier,
} from "../../src/schemaVisualizer/scripting/schemaVisualizerSqlGenerator";

const READY_ALL: Partial<Record<CatalogSection, SectionState>> = {
    schemas: "ready",
    objects: "ready",
    synonyms: "ready",
    types: "ready",
    columns: "ready",
    keys: "ready",
    foreignKeys: "ready",
    parameters: "ready",
    descriptions: "ready",
};

const IDENTITY = { serverFingerprint: "sfp_test", database: "Db1" };

const INT_DETAIL = {
    typeName: "int",
    typeSchema: "sys",
    baseTypeName: "int",
    systemTypeId: 56,
    userTypeId: 56,
    isUserDefined: false,
    isAssemblyType: false,
    maxLengthBytes: 4,
    precision: 10,
    scale: 0,
};

suite("Schema Visualizer SQL generator (SV-R5)", () => {
    test("quoteIdentifier escapes closing brackets (§12.3 — the legacy defect)", () => {
        expect(quoteIdentifier("plain")).to.equal("[plain]");
        expect(quoteIdentifier("we]ird")).to.equal("[we]]ird]");
        expect(quoteIdentifier("Ünïcode 表")).to.equal("[Ünïcode 表]");
    });

    test("full correctness fixture: exact types, named default, identity text, named composite PK in KEY order, FK actions", () => {
        const b = new CatalogBuilder();
        b.addSchema(1, "dbo");
        b.addObject(601, 1, "Orders", "table");
        b.addObject(602, 1, "Cust]omers", "table");
        b.addColumn(601, "OrderId", "bigint", false, true, false, 1, {
            typeName: "bigint",
            typeSchema: "sys",
            baseTypeName: "bigint",
            systemTypeId: 127,
            userTypeId: 127,
            isUserDefined: false,
            isAssemblyType: false,
            maxLengthBytes: 8,
            precision: 19,
            scale: 0,
            identitySeedText: "9223372036854775806",
            identityIncrementText: "2",
        });
        b.addColumn(601, "Name", "nvarchar(50)", false, false, false, 2, {
            typeName: "nvarchar",
            typeSchema: "sys",
            baseTypeName: "nvarchar",
            systemTypeId: 231,
            userTypeId: 231,
            isUserDefined: false,
            isAssemblyType: false,
            maxLengthBytes: 100,
            precision: 0,
            scale: 0,
            collationName: "Latin1_General_100_CI_AS_SC",
        });
        b.addColumn(601, "Notes", "nvarchar(max)", true, false, false, 3, {
            typeName: "nvarchar",
            typeSchema: "sys",
            baseTypeName: "nvarchar",
            systemTypeId: 231,
            userTypeId: 231,
            isUserDefined: false,
            isAssemblyType: false,
            maxLengthBytes: -1,
            precision: 0,
            scale: 0,
        });
        b.addColumn(601, "Total", "decimal(38,2)", true, false, false, 4, {
            typeName: "decimal",
            typeSchema: "sys",
            baseTypeName: "decimal",
            systemTypeId: 106,
            userTypeId: 106,
            isUserDefined: false,
            isAssemblyType: false,
            maxLengthBytes: 17,
            precision: 38,
            scale: 2,
            defaultName: "DF_Orders_Total",
            defaultDefinition: "((0))",
        });
        b.addColumn(601, "Tax", "money", true, false, true, 5, {
            typeName: "money",
            typeSchema: "sys",
            baseTypeName: "money",
            systemTypeId: 60,
            userTypeId: 60,
            isUserDefined: false,
            isAssemblyType: false,
            maxLengthBytes: 8,
            precision: 19,
            scale: 4,
            computedDefinition: "([Total]*(0.1))",
            computedPersisted: true,
        });
        b.addColumn(601, "Code", "CustomerCodeType", false, false, false, 6, {
            typeName: "CustomerCodeType",
            typeSchema: "app",
            baseTypeName: "nvarchar",
            systemTypeId: 231,
            userTypeId: 257,
            isUserDefined: true,
            isAssemblyType: false,
            maxLengthBytes: 16,
            precision: 0,
            scale: 0,
        });
        b.addColumn(602, "CustomerId", "int", false, false, false, 1, INT_DETAIL);
        // Composite PK in KEY order (Name BEFORE OrderId) ≠ column order —
        // the legacy generator would emit column order and drop the name.
        b.markPrimaryKeyColumn(601, "Name");
        b.markPrimaryKeyColumn(601, "OrderId");
        b.addKeyConstraintColumn(601, "PK_Orders", "primaryKey", "Name");
        b.addKeyConstraintColumn(601, "PK_Orders", "primaryKey", "OrderId");
        b.addKeyConstraintColumn(601, "UQ_Orders_Code", "uniqueConstraint", "Code");
        b.addForeignKey(601, 602, "FK_Orders_Customers", 901, "SET_NULL", "CASCADE");
        b.addForeignKeyColumn(901, "OrderId", "CustomerId", 1, 1, 1);
        b.addForeignKeyColumn(901, "Total", "CustomerId", 2, 4, 1);

        const model = buildVisualizerModel(b.build(1, READY_ALL, "full"), IDENTITY);
        const script = generateTableScript(model.tables[0], model);

        expect(script.text.startsWith(INFORMATIONAL_HEADER)).to.equal(true);
        expect(script.warnings).to.deep.equal([]);
        const expected =
            INFORMATIONAL_HEADER +
            "\n" +
            "CREATE TABLE [dbo].[Orders] (\n" +
            "    [OrderId] bigint IDENTITY(9223372036854775806, 2) NOT NULL,\n" +
            "    [Name] nvarchar(50) COLLATE Latin1_General_100_CI_AS_SC NOT NULL,\n" +
            "    [Notes] nvarchar(max) NULL,\n" +
            "    [Total] decimal(38, 2) NULL CONSTRAINT [DF_Orders_Total] DEFAULT ((0)),\n" +
            "    [Tax] AS ([Total]*(0.1)) PERSISTED,\n" +
            "    [Code] [app].[CustomerCodeType] NOT NULL,\n" +
            "    CONSTRAINT [PK_Orders] PRIMARY KEY ([Name], [OrderId]),\n" +
            "    CONSTRAINT [UQ_Orders_Code] UNIQUE ([Code])\n" +
            ");\n" +
            "\n" +
            "ALTER TABLE [dbo].[Orders] ADD CONSTRAINT [FK_Orders_Customers]\n" +
            "    FOREIGN KEY ([OrderId], [Total]) REFERENCES [dbo].[Cust]]omers] ([CustomerId], [CustomerId])\n" +
            "    ON DELETE SET NULL\n" +
            "    ON UPDATE CASCADE;\n";
        expect(script.text).to.equal(expected);
    });

    test("honesty: unknown facts omit clauses + warn — identity, defaults, computed, FK actions", () => {
        const b = new CatalogBuilder();
        b.addSchema(1, "dbo");
        b.addObject(701, 1, "Legacy", "table");
        b.addObject(702, 1, "Target", "table");
        // Old-shape columns: no detail at all.
        b.addColumn(701, "Id", "int", false, true, false);
        b.addColumn(701, "Ghost", "money", true, false, true); // computed, unknown definition
        b.addColumn(702, "Id", "int", false, false, false, 1, INT_DETAIL);
        b.addForeignKey(701, 702, "FK_Legacy_Target", 951); // UNKNOWN actions
        b.addForeignKeyColumn(951, "Id", "Id");
        // Self-referencing FK with unknown actions too.
        b.addForeignKey(701, 701, "FK_Legacy_Self", 952);
        b.addForeignKeyColumn(952, "Id", "Id");

        const model = buildVisualizerModel(b.build(1, READY_ALL, "full"), IDENTITY);
        const script = generateTableScript(model.tables[0], model);

        // Identity clause OMITTED (never fabricated (1,1)); display type used.
        expect(script.text).to.contain("[Id] int NOT NULL");
        expect(script.text).to.not.contain("IDENTITY");
        // Unknown computed definition: column omitted entirely.
        expect(script.text).to.not.contain("Ghost");
        // Unknown FK actions: no ON DELETE/UPDATE — and NOT "NO ACTION".
        expect(script.text).to.contain("ADD CONSTRAINT [FK_Legacy_Target]");
        expect(script.text).to.not.contain("ON DELETE");
        expect(script.text).to.not.contain("NO ACTION");
        // Self-ref FK scripts cleanly.
        expect(script.text).to.contain(
            "ALTER TABLE [dbo].[Legacy] ADD CONSTRAINT [FK_Legacy_Self]",
        );
        const warningText = script.warnings.join("\n");
        expect(warningText).to.contain("identity seed/increment unknown");
        expect(warningText).to.contain("computed column definition unknown");
        expect(warningText).to.contain("exact type facts unknown");
        expect(warningText).to.contain("default-constraint facts unknown");
        expect(warningText).to.contain("referential action(s) unknown");
    });

    test("FK to a table outside the model is omitted with a warning (raced DDL / subset)", () => {
        const b = new CatalogBuilder();
        b.addSchema(1, "dbo");
        b.addObject(801, 1, "A", "table");
        b.addColumn(801, "Id", "int", false, false, false, 1, INT_DETAIL);
        b.addForeignKey(801, 999, "FK_A_Gone", 970, "NO_ACTION", "NO_ACTION");
        b.addForeignKeyColumn(970, "Id", "Gone", 1, 1, 1);
        const model = buildVisualizerModel(b.build(1, READY_ALL, "full"), IDENTITY);
        const script = generateTableScript(model.tables[0], model);
        expect(script.text).to.not.contain("FK_A_Gone");
        expect(script.warnings.join("\n")).to.contain("references a table outside this model");
    });

    test("NO_ACTION actions emit no clause and no warning (correct default DDL)", () => {
        const b = new CatalogBuilder();
        b.addSchema(1, "dbo");
        b.addObject(811, 1, "A", "table");
        b.addObject(812, 1, "B", "table");
        b.addColumn(811, "Id", "int", false, false, false, 1, INT_DETAIL);
        b.addColumn(812, "Id", "int", false, false, false, 1, INT_DETAIL);
        b.addForeignKey(811, 812, "FK_A_B", 971, "NO_ACTION", "NO_ACTION");
        b.addForeignKeyColumn(971, "Id", "Id", 1, 1, 1);
        const model = buildVisualizerModel(b.build(1, READY_ALL, "full"), IDENTITY);
        const script = generateTableScript(model.tables[0], model);
        expect(script.text).to.contain("ADD CONSTRAINT [FK_A_B]");
        expect(script.text).to.not.contain("ON DELETE");
        expect(script.text).to.not.contain("ON UPDATE");
        expect(script.warnings).to.deep.equal([]);
    });
});
