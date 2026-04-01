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

suite("SQL language configuration", () => {
    test("treats temp table prefixes as part of a word", () => {
        // Regression coverage for https://github.com/microsoft/azuredatastudio/issues/21611
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
