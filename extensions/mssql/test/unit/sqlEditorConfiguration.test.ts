/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

interface SqlLanguageConfiguration {
    wordPattern?: string;
}

interface SqlPackageManifest {
    contributes?: {
        configurationDefaults?: {
            "[sql]"?: {
                "editor.wordSeparators"?: string;
            };
        };
    };
}

function getSqlLanguageConfiguration(): SqlLanguageConfiguration {
    const configurationPath = path.join(
        __dirname,
        "..",
        "..",
        "..",
        "syntaxes",
        "sql.configuration.json",
    );

    return JSON.parse(fs.readFileSync(configurationPath, "utf8")) as SqlLanguageConfiguration;
}

function getSqlPackageManifest(): SqlPackageManifest {
    const packagePath = path.join(__dirname, "..", "..", "..", "package.json");

    return JSON.parse(fs.readFileSync(packagePath, "utf8")) as SqlPackageManifest;
}

function getSqlWordPattern(): RegExp {
    const configuration = getSqlLanguageConfiguration();

    expect(configuration.wordPattern, "Expected SQL wordPattern in sql.configuration.json").to.be.a(
        "string",
    );

    return new RegExp(configuration.wordPattern!, "g");
}

function getWordMatches(value: string): string[] {
    return value.match(getSqlWordPattern()) ?? [];
}

function getSqlEditorWordSeparators(): string {
    const manifest = getSqlPackageManifest();
    const wordSeparators =
        manifest.contributes?.configurationDefaults?.["[sql]"]?.["editor.wordSeparators"];

    expect(
        wordSeparators,
        "Expected SQL-specific editor.wordSeparators override in package.json",
    ).to.be.a("string");

    return wordSeparators!;
}

suite("SQL language configuration", () => {
    test("keeps parameter and temp table prefixes out of SQL word separators", () => {
        const sqlWordSeparators =
            getSqlPackageManifest().contributes?.configurationDefaults?.["[sql]"]?.[
                "editor.wordSeparators"
            ];

        expect(sqlWordSeparators, "Expected SQL-specific editor.wordSeparators override").to.be.a(
            "string",
        );
        expect(sqlWordSeparators).to.not.include("@");
        expect(sqlWordSeparators).to.not.include("#");
    });

    test("Testing common SQL word separators", () => {
        // Regression coverage for https://github.com/microsoft/azuredatastudio/issues/21611
        const wordSeparators = getSqlEditorWordSeparators();

        expect(wordSeparators).to.not.include("@");
        expect(wordSeparators).to.not.include("#");
        expect(wordSeparators).to.include("(");
        expect(wordSeparators).to.include(";");
    });

    test("treats temp table prefixes as part of a word", () => {
        expect(getWordMatches("#ExampleTable")).to.deep.equal(["#ExampleTable"]);
        expect(getWordMatches("##ExampleTable")).to.deep.equal(["##ExampleTable"]);
    });

    test("treats parameter prefixes as part of a word", () => {
        expect(getWordMatches("@parameterName")).to.deep.equal(["@parameterName"]);
        expect(getWordMatches("@@ROWCOUNT")).to.deep.equal(["@@ROWCOUNT"]);
    });

    test("keeps SQL punctuation out of matched words", () => {
        expect(getWordMatches("values(#ExampleTable);")).to.deep.equal(["values", "#ExampleTable"]);
    });
});
