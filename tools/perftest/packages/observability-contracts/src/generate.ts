/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** File-writing CLI for the pure observability-contract generators. */

import * as fs from "node:fs";
import * as path from "node:path";
import { format } from "prettier";
import { generateMarkdown, generateSnapshot } from "./generator";

async function main(): Promise<void> {
    const outRoot = path.join(__dirname, "..", "generated");
    const markdownDir = path.join(outRoot, "markdown");
    const typescriptDir = path.join(outRoot, "typescript");
    fs.mkdirSync(markdownDir, { recursive: true });
    fs.mkdirSync(typescriptDir, { recursive: true });

    const prettierOptions = { endOfLine: "lf" as const, printWidth: 100, tabWidth: 4 };
    fs.writeFileSync(
        path.join(markdownDir, "EVENTS.md"),
        await format(generateMarkdown(), { ...prettierOptions, parser: "markdown" }),
    );
    fs.writeFileSync(
        path.join(typescriptDir, "observabilityContract.generated.ts"),
        await format(generateSnapshot(), { ...prettierOptions, parser: "typescript" }),
    );
    console.log("generated: markdown/EVENTS.md, typescript/observabilityContract.generated.ts");
}

void main();
