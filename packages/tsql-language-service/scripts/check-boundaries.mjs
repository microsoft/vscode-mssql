#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFile, readdir } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const root = resolve("src");
const forbidden = new Map([
    ["syntax", ["metadata", "semantics", "features", "runtime", "worker", "lsp", "adapters"]],
    ["semantics", ["adapters", "runtime", "worker", "lsp"]],
    ["features", ["adapters", "worker"]],
    ["coloring", ["adapters", "features", "runtime", "worker", "lsp"]],
    ["metadata", ["syntax", "semantics", "features", "runtime", "worker", "lsp"]],
]);
const hostImports = [/from\s+["']vscode["']/, /from\s+["']tedious["']/, /from\s+["']mssql["']/];
const errors = [];

for await (const file of files(root)) {
    if (![".ts", ".mts", ".js"].includes(extname(file))) continue;
    if (file.includes(`${resolve("src/syntax/lezer/generated")}`)) continue;
    const source = await readFile(file, "utf8");
    const path = relative(root, file).replaceAll("\\", "/");
    for (const pattern of hostImports) {
        if (pattern.test(source))
            errors.push(`${path}: portable source imports a host/database API`);
    }
    const layer = path.split("/")[0];
    for (const target of forbidden.get(layer) ?? []) {
        if (new RegExp(`from\\s+["'][^"']*\\/${target}\\/`).test(source)) {
            errors.push(`${path}: ${layer} must not import ${target}`);
        }
    }
}

if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
} else {
    console.log("Architecture boundaries passed.");
}

async function* files(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) yield* files(path);
        else yield path;
    }
}
