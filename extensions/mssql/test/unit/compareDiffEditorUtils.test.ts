/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as mssql from "vscode-mssql";

import {
    CONSTRAINT_OBJECT_TYPE_SUFFIXES,
    formatChildName,
    getAggregatedScript,
    groupConstraintChildrenByAction,
    isConstraintObjectType,
} from "../../src/webviews/pages/SchemaCompare/components/compareDiffEditorUtils";
import { SchemaDifferenceType, SchemaUpdateAction } from "../../src/sharedInterfaces/schemaCompare";

// Test scenarios in this suite mirror the test design in the Schema Compare for Fabric
// Warehouse spec (Feature 1847587) — specifically the three webview-level cases:
//  - compare diff editor filters DiffEntry.Children by constraint object-type suffix
//  - compare diff editor renders the matched children as the "Constraints added / changed /
//    dropped" banner
//  - compare diff editor aggregated script walks DiffEntry.Children and includes constraint
//    ALTER scripts under the parent table
suite("CompareDiffEditor utils — constraint filtering and script aggregation", () => {
    const SQL_PRIMARY_KEY_CONSTRAINT_TYPE =
        "Microsoft.Data.Tools.Schema.Sql.SchemaModel.SqlPrimaryKeyConstraint";
    const SQL_FOREIGN_KEY_CONSTRAINT_TYPE =
        "Microsoft.Data.Tools.Schema.Sql.SchemaModel.SqlForeignKeyConstraint";
    const SQL_UNIQUE_CONSTRAINT_TYPE =
        "Microsoft.Data.Tools.Schema.Sql.SchemaModel.SqlUniqueConstraint";
    const SQL_CHECK_CONSTRAINT_TYPE =
        "Microsoft.Data.Tools.Schema.Sql.SchemaModel.SqlCheckConstraint";
    const SQL_DEFAULT_CONSTRAINT_TYPE =
        "Microsoft.Data.Tools.Schema.Sql.SchemaModel.SqlDefaultConstraint";
    const SQL_COLUMN_TYPE = "Microsoft.Data.Tools.Schema.Sql.SchemaModel.SqlSimpleColumn";
    const SQL_INDEX_TYPE = "Microsoft.Data.Tools.Schema.Sql.SchemaModel.SqlIndex";
    const SQL_TABLE_TYPE = "Microsoft.Data.Tools.Schema.Sql.SchemaModel.SqlTable";

    function makeDiffEntry(overrides: Partial<mssql.DiffEntry> = {}): mssql.DiffEntry {
        // Build a minimally valid DiffEntry shape so each test can override only what it cares
        // about. The defaults represent an empty top-level Object diff with no children and
        // no scripts; suites below mutate the relevant fields.
        return {
            updateAction: SchemaUpdateAction.Change,
            differenceType: SchemaDifferenceType.Object,
            name: "",
            sourceValue: [],
            targetValue: [],
            parent: undefined as unknown as mssql.DiffEntry,
            children: [],
            sourceScript: "",
            targetScript: "",
            sourceObjectType: SQL_TABLE_TYPE,
            targetObjectType: SQL_TABLE_TYPE,
            included: true,
            ...overrides,
        };
    }

    suite("isConstraintObjectType", () => {
        test("recognises every DacFx constraint type-name suffix from the shared list", () => {
            // The shared list is the authoritative source of truth; the function must accept
            // every entry. Mirrors the SqlCore-side ConstraintTypeNameSuffixes in
            // SchemaCompareUtils.cs so a divergence on either side is caught early.
            for (const suffix of CONSTRAINT_OBJECT_TYPE_SUFFIXES) {
                expect(
                    isConstraintObjectType(
                        `Microsoft.Data.Tools.Schema.Sql.SchemaModel.Sql${suffix}`,
                    ),
                ).to.equal(true, `expected suffix '${suffix}' to be recognised as a constraint`);
            }
        });

        test("matches by suffix so a fully-qualified DacFx type name still matches", () => {
            expect(isConstraintObjectType(SQL_PRIMARY_KEY_CONSTRAINT_TYPE)).to.equal(true);
            expect(isConstraintObjectType(SQL_FOREIGN_KEY_CONSTRAINT_TYPE)).to.equal(true);
            expect(isConstraintObjectType(SQL_UNIQUE_CONSTRAINT_TYPE)).to.equal(true);
            expect(isConstraintObjectType(SQL_CHECK_CONSTRAINT_TYPE)).to.equal(true);
            expect(isConstraintObjectType(SQL_DEFAULT_CONSTRAINT_TYPE)).to.equal(true);
        });

        test("rejects non-constraint object types", () => {
            expect(isConstraintObjectType(SQL_TABLE_TYPE)).to.equal(false);
            expect(isConstraintObjectType(SQL_COLUMN_TYPE)).to.equal(false);
            expect(isConstraintObjectType(SQL_INDEX_TYPE)).to.equal(false);
        });

        test("returns false for undefined and empty input", () => {
            expect(isConstraintObjectType(undefined)).to.equal(false);
            expect(isConstraintObjectType("")).to.equal(false);
        });

        test("does not match when the suffix appears mid-string", () => {
            // Substring matches would cause false positives like "SqlPrimaryKeyConstraintAction"
            // (hypothetical). The function uses endsWith specifically to avoid this.
            expect(isConstraintObjectType("SqlPrimaryKeyConstraintAction")).to.equal(false);
        });
    });

    suite("formatChildName", () => {
        test("joins source name parts with '.' when present (Add / Change diffs)", () => {
            const child = makeDiffEntry({
                sourceValue: ["dbo", "PK_Customers"],
                targetValue: [],
                name: "ignored",
            });
            expect(formatChildName(child)).to.equal("dbo.PK_Customers");
        });

        test("falls back to target name parts when source is empty (Drop-only diffs)", () => {
            const child = makeDiffEntry({
                sourceValue: [],
                targetValue: ["dbo", "FK_Orders_Customers"],
                name: "ignored",
            });
            expect(formatChildName(child)).to.equal("dbo.FK_Orders_Customers");
        });

        test("falls back to child.name when neither source nor target name parts exist", () => {
            const child = makeDiffEntry({
                sourceValue: [],
                targetValue: [],
                name: "leaf",
            });
            expect(formatChildName(child)).to.equal("leaf");
        });

        test("returns empty string when no name source is available", () => {
            const child = makeDiffEntry({
                sourceValue: [],
                targetValue: [],
                name: "",
            });
            expect(formatChildName(child)).to.equal("");
        });
    });

    suite("groupConstraintChildrenByAction", () => {
        test("returns an empty grouping when diff is undefined", () => {
            const grouped = groupConstraintChildrenByAction(undefined);
            expect(grouped).to.deep.equal({});
        });

        test("returns an empty grouping when diff has no children", () => {
            const grouped = groupConstraintChildrenByAction(
                makeDiffEntry({ children: [] as mssql.DiffEntry[] }),
            );
            expect(grouped).to.deep.equal({});
        });

        test("filters out non-constraint child object types (columns, indexes)", () => {
            // Column / index changes are already part of the parent table's CREATE / ALTER
            // script. Including them in the constraint banner would double-count and confuse
            // the user, so the grouping must skip them entirely.
            const diff = makeDiffEntry({
                children: [
                    makeDiffEntry({
                        sourceObjectType: SQL_COLUMN_TYPE,
                        targetObjectType: SQL_COLUMN_TYPE,
                        sourceValue: ["dbo", "Customers", "Email"],
                        updateAction: SchemaUpdateAction.Change,
                    }),
                    makeDiffEntry({
                        sourceObjectType: SQL_INDEX_TYPE,
                        targetObjectType: SQL_INDEX_TYPE,
                        sourceValue: ["dbo", "IX_Customers_Email"],
                        updateAction: SchemaUpdateAction.Add,
                    }),
                ],
            });
            expect(groupConstraintChildrenByAction(diff)).to.deep.equal({});
        });

        test("groups every kind of constraint child by SchemaUpdateAction", () => {
            // Mixes all three actions across PK / FK / UNIQUE / CHECK / DEFAULT to verify the
            // grouping is purely by updateAction and that every constraint kind survives the
            // suffix filter.
            const diff = makeDiffEntry({
                children: [
                    makeDiffEntry({
                        sourceObjectType: SQL_PRIMARY_KEY_CONSTRAINT_TYPE,
                        targetObjectType: SQL_PRIMARY_KEY_CONSTRAINT_TYPE,
                        sourceValue: ["dbo", "PK_Customers"],
                        updateAction: SchemaUpdateAction.Add,
                    }),
                    makeDiffEntry({
                        sourceObjectType: SQL_UNIQUE_CONSTRAINT_TYPE,
                        targetObjectType: SQL_UNIQUE_CONSTRAINT_TYPE,
                        sourceValue: ["dbo", "UQ_Customers_Email"],
                        updateAction: SchemaUpdateAction.Add,
                    }),
                    makeDiffEntry({
                        sourceObjectType: SQL_FOREIGN_KEY_CONSTRAINT_TYPE,
                        targetObjectType: SQL_FOREIGN_KEY_CONSTRAINT_TYPE,
                        sourceValue: ["dbo", "FK_Orders_Customers"],
                        updateAction: SchemaUpdateAction.Change,
                    }),
                    makeDiffEntry({
                        sourceObjectType: SQL_CHECK_CONSTRAINT_TYPE,
                        targetObjectType: SQL_CHECK_CONSTRAINT_TYPE,
                        sourceValue: ["dbo", "CK_Orders_TotalAmount"],
                        updateAction: SchemaUpdateAction.Change,
                    }),
                    makeDiffEntry({
                        sourceObjectType: SQL_DEFAULT_CONSTRAINT_TYPE,
                        targetObjectType: SQL_DEFAULT_CONSTRAINT_TYPE,
                        // Drop: only the target name is populated.
                        sourceValue: [],
                        targetValue: ["dbo", "DF_Customers_CreatedOn"],
                        updateAction: SchemaUpdateAction.Delete,
                    }),
                ],
            });

            const grouped = groupConstraintChildrenByAction(diff);

            expect(grouped[SchemaUpdateAction.Add]).to.deep.equal([
                "dbo.PK_Customers",
                "dbo.UQ_Customers_Email",
            ]);
            expect(grouped[SchemaUpdateAction.Change]).to.deep.equal([
                "dbo.FK_Orders_Customers",
                "dbo.CK_Orders_TotalAmount",
            ]);
            expect(grouped[SchemaUpdateAction.Delete]).to.deep.equal([
                "dbo.DF_Customers_CreatedOn",
            ]);
        });

        test("skips constraint children whose name parts and child.name are all empty", () => {
            // Defensive: a malformed child with no usable name source should be silently
            // dropped rather than producing an empty banner entry. (This branch is hit if STS
            // ever ships a constraint diff without sourceValue/targetValue/name.)
            const diff = makeDiffEntry({
                children: [
                    makeDiffEntry({
                        sourceObjectType: SQL_PRIMARY_KEY_CONSTRAINT_TYPE,
                        targetObjectType: SQL_PRIMARY_KEY_CONSTRAINT_TYPE,
                        sourceValue: [],
                        targetValue: [],
                        name: "",
                        updateAction: SchemaUpdateAction.Add,
                    }),
                ],
            });
            expect(groupConstraintChildrenByAction(diff)).to.deep.equal({});
        });
    });

    suite("getAggregatedScript", () => {
        test("returns the empty string when diff is null or undefined", () => {
            // The diff editor passes whatever the selector hands it; defend against both
            // null and undefined so the aggregated panel never throws on transitional states.
            // eslint-disable-next-line no-restricted-syntax
            expect(getAggregatedScript(null, true)).to.equal("");
            expect(getAggregatedScript(undefined, true)).to.equal("");
        });

        test("returns the parent script (followed by a blank line) when there are no children", () => {
            const diff = makeDiffEntry({
                sourceScript: "CREATE TABLE [dbo].[Customers] (...);",
                children: [],
            });
            expect(getAggregatedScript(diff, true)).to.equal(
                "CREATE TABLE [dbo].[Customers] (...);\n\n",
            );
        });

        test("walks DiffEntry.Children and concatenates constraint ALTER scripts under the parent", () => {
            // This mirrors the Fabric Warehouse case: the parent table diff carries the
            // CREATE TABLE script, and each constraint child carries its own
            // ALTER TABLE ... ADD CONSTRAINT script (which sqltoolsservice now preserves
            // under SqlDwUnified via the new CreateDiffEntry branch). The aggregated output
            // must contain both, so the Monaco diff editor shows the complete picture.
            const parentScript =
                "CREATE TABLE [dbo].[Customers] ([CustomerID] INT NOT NULL, [Email] VARCHAR(100) NOT NULL);";
            const pkScript =
                "ALTER TABLE [dbo].[Customers] ADD CONSTRAINT [PK_Customers] PRIMARY KEY NONCLUSTERED ([CustomerID]) NOT ENFORCED;";
            const uqScript =
                "ALTER TABLE [dbo].[Customers] ADD CONSTRAINT [UQ_Customers_Email] UNIQUE NONCLUSTERED ([Email]) NOT ENFORCED;";
            const diff = makeDiffEntry({
                sourceScript: parentScript,
                children: [
                    makeDiffEntry({
                        sourceObjectType: SQL_PRIMARY_KEY_CONSTRAINT_TYPE,
                        sourceValue: ["dbo", "PK_Customers"],
                        sourceScript: pkScript,
                    }),
                    makeDiffEntry({
                        sourceObjectType: SQL_UNIQUE_CONSTRAINT_TYPE,
                        sourceValue: ["dbo", "UQ_Customers_Email"],
                        sourceScript: uqScript,
                    }),
                ],
            });

            const aggregated = getAggregatedScript(diff, true);

            expect(aggregated).to.contain(parentScript);
            expect(aggregated).to.contain(pkScript);
            expect(aggregated).to.contain(uqScript);
            // Parent must precede its children so the executed script creates the table
            // before adding constraints to it.
            expect(aggregated.indexOf(parentScript)).to.be.lessThan(aggregated.indexOf(pkScript));
            expect(aggregated.indexOf(pkScript)).to.be.lessThan(aggregated.indexOf(uqScript));
        });

        test("uses the target script when getSourceScript is false", () => {
            // Drop diffs only populate target scripts; the diff editor's right pane reads via
            // getSourceScript=false. Verify the function honours that selector.
            const diff = makeDiffEntry({
                sourceScript: "from-source",
                targetScript: "DROP TABLE [dbo].[Customers];",
            });
            const aggregated = getAggregatedScript(diff, false);
            expect(aggregated).to.contain("DROP TABLE [dbo].[Customers];");
            expect(aggregated).to.not.contain("from-source");
        });

        test("skips missing scripts without inserting blank separators", () => {
            // A child without any script (e.g. a Drop diff inspected from the source pane)
            // must not pollute the aggregated output with stray blank lines.
            const diff = makeDiffEntry({
                sourceScript: "",
                children: [
                    makeDiffEntry({
                        sourceObjectType: SQL_PRIMARY_KEY_CONSTRAINT_TYPE,
                        sourceScript: "",
                    }),
                ],
            });
            expect(getAggregatedScript(diff, true)).to.equal("");
        });
    });
});
