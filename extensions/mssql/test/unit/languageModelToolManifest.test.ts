/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

interface LanguageModelToolContribution {
    name: string;
    modelDescription: string;
}

interface ExtensionPackageJson {
    contributes: {
        languageModelTools: LanguageModelToolContribution[];
    };
}

/**
 * Every contributed tool opens its model description with this directive so that a `#`-mention of
 * the tool routes to the tool itself rather than to an agent skill or a terminal command.
 */
const explicitReferenceDirective = (toolName: string): string =>
    `When the user explicitly references #${toolName}, call this tool first. ` +
    "Do not invoke or load an agent skill, run terminal commands, or edit files as a substitute " +
    "unless the user explicitly asks to switch workflows.";

suite("Language model tool manifest", () => {
    const packageJson = JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", "..", "..", "package.json"), "utf8"),
    ) as ExtensionPackageJson;
    const tools = packageJson.contributes.languageModelTools;

    test("contributes language model tools with names and model descriptions", () => {
        expect(tools, "contributes.languageModelTools is missing or empty").to.not.be.empty;

        for (const tool of tools) {
            expect(tool.name, "tool is missing a name").to.be.a("string").and.to.not.be.empty;
            expect(tool.modelDescription, `${tool.name} is missing a modelDescription`).to.be.a(
                "string",
            ).and.to.not.be.empty;
        }
    });

    test("every tool opens with the directive naming itself", () => {
        for (const tool of tools) {
            const directive = explicitReferenceDirective(tool.name);

            // Compared against the opening slice rather than searched for anywhere in the string:
            // a description that answered the mention only after other instructions would satisfy
            // a substring check while still letting the model route somewhere else first.
            expect(
                tool.modelDescription.slice(0, directive.length),
                `${tool.name} does not open with the explicit-reference directive naming itself`,
            ).to.equal(directive);
        }
    });

    test("keeps each tool's own guidance after the directive", () => {
        for (const tool of tools) {
            const directive = explicitReferenceDirective(tool.name);
            // Taken by position, so this measures what follows the opening directive rather than
            // what is left after removing that text from wherever it happens to appear.
            const remainder = tool.modelDescription.slice(directive.length).trim();

            expect(
                remainder,
                `${tool.name} has no guidance beyond the explicit-reference directive`,
            ).to.not.be.empty;
        }
    });
});
