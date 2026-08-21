/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import * as diagnosticTextFacts from "../../../src/semantics/diagnostics/diagnosticTextFacts.ts";
const {
    columnConstraintCounts,
    columnDefinitionTextFacts,
    hasBooleanOperator,
    indexColumnTypeFacts,
    integerIndexOption,
    isCreateClusteredIndex,
    isCreateOrAlter,
    isInvalidSparseDataType,
    isNumericIdentityValue,
    isXmlNodeNullCheckSuffix,
    localLoginOperation,
    localTypeCategory,
    normalizedSystemDataTypeText,
    parseDataTypeText,
    recoveredConstraintName,
    recoveredSelectAlias,
    recoveredVariableDeclarations,
    routineParameterTextFacts,
    selectElementAssignsVariable,
    selectStarQualifier,
} = diagnosticTextFacts;

suite("owned diagnostic text facts", () => {
    test("classifies only options inside an already parsed column definition", () => {
        // Unicode identifiers and misleading keyword prefixes must not alter token-boundary facts.
        const facts = columnDefinitionTextFacts(
            "[列] datetime2 NOT NULL GENERATED ALWAYS AS ROW START HIDDEN PRIMARY KEY",
        );
        assert.equal(facts.generatedRow, "START");
        assert.equal(facts.nullable, false);
        assert.equal(facts.primaryKeyCount, 1);
        assert.equal(columnDefinitionTextFacts("[nullability] int").explicitlyNullable, false);
        assert.equal(isInvalidSparseDataType(" geography "), true);
        assert.equal(isInvalidSparseDataType("[geographyx]"), false);
    });

    test("counts duplicate options without accepting keyword substrings", () => {
        // Duplicate checks need exact keyword boundaries even in malformed in-progress input.
        const counts = columnConstraintCounts(
            "c int DEFAULT 1 DEFAULT 2 NULL NOT NULL UNIQUE UNIQUE",
        );
        assert.equal(counts.get("DEFAULT"), 2);
        assert.equal(counts.get("NULL"), 2);
        assert.equal(counts.get("UNIQUE"), 2);
        assert.equal(columnConstraintCounts("c int [DEFAULTED]").get("DEFAULT"), 0);
    });

    test("classifies routine, DDL, and index spellings at exact boundaries", () => {
        // These inputs are already scoped to their parser-owned nodes; near misses stay neutral.
        assert.deepEqual(routineParameterTextFacts("@p dbo.T = NULL READONLY OUTPUT"), {
            output: true,
            readOnly: true,
            hasDefault: true,
        });
        assert.equal(localLoginOperation(" CREATE LOGIN [登录]"), "CREATE");
        assert.equal(localLoginOperation("CREATE LOGINS x"), undefined);
        assert.equal(localTypeCategory("CREATE TYPE x AS TABLE (c int)"), "table");
        assert.equal(localTypeCategory("CREATE TYPE x EXTERNAL NAME a.b"), "clr");
        assert.equal(isCreateOrAlter("CREATE OR ALTER VIEW dbo.v AS SELECT 1"), true);
        assert.equal(isCreateOrAlter("CREATE OR ALTERED VIEW dbo.v"), false);
        assert.equal(isCreateClusteredIndex("CREATE UNIQUE CLUSTERED INDEX ix ON t(c)"), true);
        assert.equal(integerIndexOption("MAXDOP = 65", "MAXDOP"), 65);
        assert.equal(integerIndexOption("MAXDOPX = 65", "MAXDOP"), undefined);
    });

    test("handles recovery-only aliases, assignments, stars, and constraints", () => {
        // Delimited hostile names remain intact while malformed non-matches return neutral values.
        assert.equal(recoveredSelectAlias("c AS [Display Name]"), "Display Name");
        assert.equal(recoveredConstraintName("CONSTRAINT [PK-订单] PRIMARY KEY"), "PK-订单");
        assert.equal(selectElementAssignsVariable("@résultat += 1"), true);
        assert.equal(selectElementAssignsVariable("résultat = 1"), false);
        assert.equal(selectStarQualifier("[My.Schema].*"), "My.Schema");
        assert.equal(selectStarQualifier("count(*)"), false);
    });

    test("keeps expression fallbacks conservative", () => {
        // Boolean and XML fallbacks run only inside parser-owned expression contexts.
        assert.equal(hasBooleanOperator("[列] IS NOT NULL"), true);
        assert.equal(hasBooleanOperator("[island]"), false);
        assert.equal(isXmlNodeNullCheckSuffix(" IS NULL"), true);
        assert.equal(isXmlNodeNullCheckSuffix(" ISNULL(x, 0)"), false);
        assert.equal(isNumericIdentityValue("(€ 1.5e2)"), true);
        assert.equal(isNumericIdentityValue("(one)"), false);
    });

    test("owns data-type and opaque-declaration recovery", () => {
        // DataType and OpaqueSqlStatement are the two measured recovery nodes using text here.
        assert.deepEqual(parseDataTypeText(" [dbo].[Vector Alias] (1536, -1) trailing"), {
            name: "vector alias",
            arguments: [1536, -1],
        });
        assert.equal(parseDataTypeText("."), undefined);
        assert.deepEqual(parseDataTypeText(`dbo.Vector ${"(".repeat(50_000)}`), {
            name: "vector",
            arguments: [],
        });
        assert.deepEqual(parseDataTypeText("dbo.𐐀Type(1)"), {
            name: "𐐨type",
            arguments: [1],
        });
        assert.equal(normalizedSystemDataTypeText(" NATIONAL   CHAR (10) "), "national char");
        assert.deepEqual(
            recoveredVariableDeclarations("noise DECLARE @变量 int; DECLARED @wrong", 50),
            [{ name: "@变量", start: 64, end: 67 }],
        );
    });

    test("classifies metadata type displays for index diagnostics", () => {
        // Catalog type displays are trusted metadata strings, not reparsed SQL statements.
        assert.deepEqual(indexColumnTypeFacts("nvarchar(max)"), {
            validKey: false,
            validIncluded: true,
            requiresOfflineBuild: true,
            validIndexedViewProjection: true,
        });
        assert.equal(indexColumnTypeFacts("xml").validIndexedViewProjection, false);
        assert.equal(indexColumnTypeFacts("int").validKey, true);
    });
});
