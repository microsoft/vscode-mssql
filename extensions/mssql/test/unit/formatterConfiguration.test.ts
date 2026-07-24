/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

interface ConfigurationProperty {
    type: string;
    default: boolean | number | string;
    enum?: string[];
    minimum?: number;
    maximum?: number;
    scope?: string;
}

interface PackageManifest {
    contributes: {
        configuration: {
            properties: Record<string, ConfigurationProperty>;
        };
    };
}

const expectedFormatterDefaults: Record<string, boolean | number | string> = {
    sqlVersion: "sql170",
    sqlEngineType: "all",
    alignClauseBodies: true,
    alignColumnDefinitionFields: true,
    alignSetClauseItem: true,
    allowExternalLanguagePaths: true,
    allowExternalLibraryPaths: true,
    asKeywordOnOwnLine: true,
    keywordCasing: "uppercase",
    preserveComments: true,
    indentSetClause: false,
    indentViewBody: false,
    multilineInsertSourcesList: true,
    multilineInsertTargetsList: true,
    multilineSelectElementsList: true,
    multilineSetClauseItems: true,
    multilineViewColumnsList: true,
    multilineWherePredicatesList: true,
    newLineBeforeCloseParenthesisInMultilineList: true,
    newLineBeforeFromClause: true,
    newLineBeforeGroupByClause: true,
    newLineBeforeHavingClause: true,
    newLineBeforeJoinClause: true,
    newLineBeforeOffsetClause: true,
    newLineBeforeOpenParenthesisInMultilineList: false,
    newLineBeforeOrderByClause: true,
    newLineBeforeOutputClause: true,
    newLineBeforeWhereClause: true,
    newLineBeforeWindowClause: true,
    newlineFormattedCheckConstraint: false,
    newLineFormattedIndexDefinition: false,
    numNewlinesAfterStatement: 1,
    spaceBetweenDataTypeAndParameters: true,
    spaceBetweenParametersInDataType: true,
};

function getConfigurationProperties(): Record<string, ConfigurationProperty> {
    const packagePath = path.join(__dirname, "..", "..", "..", "package.json");
    const packageManifest = JSON.parse(fs.readFileSync(packagePath, "utf8")) as PackageManifest;
    return packageManifest.contributes.configuration.properties;
}

suite("SQL formatter configuration", () => {
    test("enables the new formatter by default", () => {
        const previewSetting = getConfigurationProperties()["mssql.format.enablePreviewFormatter"];

        expect(previewSetting.default).to.equal(true);
        expect(previewSetting.scope).to.equal("window");
    });

    test("contributes the currently supported ScriptDom settings", () => {
        const properties = getConfigurationProperties();
        const prefix = "mssql.format.options.";
        const actualKeys = Object.keys(properties)
            .filter((key) => key.startsWith(prefix))
            .map((key) => key.substring(prefix.length));

        expect(actualKeys).to.have.members(Object.keys(expectedFormatterDefaults));
        for (const [key, expectedDefault] of Object.entries(expectedFormatterDefaults)) {
            const setting = properties[prefix + key];
            expect(setting.default, key).to.equal(expectedDefault);
            expect(setting.scope, key).to.equal("window");
        }
    });

    test("constrains formatter enum and numeric settings", () => {
        const properties = getConfigurationProperties();
        const prefix = "mssql.format.options.";

        expect(properties[prefix + "sqlVersion"].enum).to.deep.equal([
            "sql80",
            "sql90",
            "sql100",
            "sql110",
            "sql120",
            "sql130",
            "sql140",
            "sql150",
            "sql160",
            "sql170",
        ]);
        expect(properties[prefix + "sqlEngineType"].enum).to.deep.equal([
            "all",
            "standalone",
            "sqlAzure",
        ]);
        expect(properties[prefix + "keywordCasing"].enum).to.deep.equal([
            "uppercase",
            "lowercase",
            "pascalCase",
        ]);
        expect(properties[prefix + "numNewlinesAfterStatement"].minimum).to.equal(0);
        expect(properties[prefix + "numNewlinesAfterStatement"].maximum).to.equal(5);
    });
});
