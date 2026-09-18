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

    test("every tool asks the model to prefer it when referenced by name", () => {
        for (const tool of tools) {
            expect(
                tool.modelDescription,
                `${tool.name} does not open with the explicit-reference directive naming itself`,
            ).to.have.string(explicitReferenceDirective(tool.name));
        }
    });

    test("keeps each tool's own guidance after the directive", () => {
        for (const tool of tools) {
            const remainder = tool.modelDescription
                .replace(explicitReferenceDirective(tool.name), "")
                .trim();

            expect(
                remainder,
                `${tool.name} has no guidance beyond the explicit-reference directive`,
            ).to.not.be.empty;
        }
    });
});
