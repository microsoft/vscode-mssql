#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { buildParserFile } from "@lezer/generator";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const grammarPath = new URL("../src/syntax/lezer/grammar/tsql.grammar", import.meta.url);
const outputDirectory = new URL("../src/syntax/lezer/generated/", import.meta.url);
const grammar = await readFile(grammarPath, "utf8");
const generated = buildParserFile(grammar, {
    fileName: "tsql.grammar",
    moduleStyle: "cjs",
    includeNames: true,
});
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
    writeFile(new URL("tsqlParser.js", outputDirectory), generated.parser, "utf8"),
    writeFile(new URL("tsqlParser.terms.js", outputDirectory), generated.terms, "utf8"),
]);
