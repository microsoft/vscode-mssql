/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const diagnosticRoot = path.resolve(__dirname, "../../src/semantics");

test("cohesive diagnostic families own their implementations outside the document coordinator", async () => {
    const coordinator = await readFile(
        path.join(diagnosticRoot, "tsqlSemanticDiagnostics.ts"),
        "utf8",
    );

    for (const implementation of [
        "validateBuildMode",
        "validateBuiltInFunctions",
        "validateCatalogFunctionArguments",
        "validateBatchContracts",
        "validateBooleanContexts",
        "validateCollations",
        "validateComputedColumnConstraints",
        "validateConstraintIndexOptions",
        "validateDatabases",
        "validateDataTypesAndColumns",
        "validateDdlObjects",
        "validateDml",
        "validateExecutions",
        "validateForeignKeys",
        "validateIdentifierNames",
        "validateIndexes",
        "validateModuleDefinitions",
        "validateNestedDml",
        "validateOptions",
        "validateOrderBy",
        "validateOutputClauses",
        "validatePermissiveKeywordTails",
        "validatePrincipals",
        "validateScopedConfigurations",
        "validateSecurables",
        "validateSynonyms",
        "validateTableDefinitions",
        "validateTriggerCatalog",
        "validateUdtMembers",
        "validateUserTypes",
        "validateVariables",
        "validateXmlTableMethods",
    ]) {
        assert.doesNotMatch(
            coordinator,
            new RegExp(`(?:public|private)\\s+${implementation}\\s*\\(`, "u"),
            `${implementation} must be implemented by its diagnostic-family module`,
        );
    }

    assert.doesNotMatch(
        coordinator,
        /new RegExp|\/[^/\r\n]*\\b[A-Z][^/\r\n]*\/[dgimsuvy]*/u,
        "grammar-sensitive text recovery must be owned and tested by a named diagnostic module",
    );
});
