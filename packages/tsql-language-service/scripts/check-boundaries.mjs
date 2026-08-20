#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";

const root = resolve("src");
const forbidden = new Map([
    ["syntax", ["metadata", "semantics", "features", "runtime", "worker", "lsp", "adapters"]],
    ["semantics", ["adapters", "runtime", "worker", "lsp"]],
    ["features", ["adapters", "worker"]],
    ["coloring", ["adapters", "features", "runtime", "worker", "lsp"]],
    ["metadata", ["syntax", "semantics", "features", "runtime", "worker", "lsp"]],
    // SQLCMD is a document layer in front of the parser: it must not learn T-SQL, metadata, or a host.
    ["sqlcmd", ["syntax", "semantics", "metadata", "runtime", "worker", "lsp", "adapters"]],
]);
const hostImports = [/from\s+["']vscode["']/, /from\s+["']tedious["']/, /from\s+["']mssql["']/];
const errors = [];
const sources = new Map();

for await (const file of files(root)) {
    if (![".ts", ".mts", ".js"].includes(extname(file))) continue;
    if (file.includes(`${resolve("src/syntax/lezer/generated")}`)) continue;
    const source = await readFile(file, "utf8");
    sources.set(file, source);
    const path = relative(root, file).replaceAll("\\", "/");
    if (/\.toLocale(?:Lower|Upper)Case\s*\(/u.test(source)) {
        errors.push(`${path}: locale-sensitive casing is forbidden in portable source`);
    }
    if (/\.localeCompare\s*\(/u.test(source)) {
        errors.push(`${path}: locale-sensitive ordering is forbidden in portable source`);
    }
    if (
        path !== "semantics/identifiers.ts" &&
        !path.startsWith("syntax/lezer/") &&
        /\\p\{L\}.*\\p\{N\}.*\*/u.test(source)
    ) {
        errors.push(`${path}: identifier character grammar must come from semantics/identifiers`);
    }
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

for (const cycle of dependencyCycles(sources)) {
    errors.push(
        `dependency cycle: ${cycle.map((file) => relative(root, file).replaceAll("\\", "/")).join(" -> ")}`,
    );
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

/** Finds cycles among portable relative imports. External packages and generated output are leaves. */
function dependencyCycles(allSources) {
    const files = new Set(allSources.keys());
    const edges = new Map(
        [...allSources].map(([file, source]) => [file, relativeImports(file, source, files)]),
    );
    const visiting = new Set();
    const visited = new Set();
    const stack = [];
    const reported = new Set();
    const cycles = [];

    function visit(file) {
        if (visited.has(file)) return;
        if (visiting.has(file)) {
            const start = stack.indexOf(file);
            const cycle = [...stack.slice(start), file];
            const identity = canonicalCycle(cycle);
            if (!reported.has(identity)) {
                reported.add(identity);
                cycles.push(cycle);
            }
            return;
        }
        visiting.add(file);
        stack.push(file);
        for (const target of edges.get(file) ?? []) visit(target);
        stack.pop();
        visiting.delete(file);
        visited.add(file);
    }

    for (const file of [...files].sort()) visit(file);
    return cycles;
}

function relativeImports(file, source, files) {
    const result = [];
    const imports = /(?:from\s+|import\s*)["'](\.[^"']+)["']/gu;
    for (const match of source.matchAll(imports)) {
        const requested = resolve(dirname(file), match[1]);
        const candidates = extname(requested)
            ? [requested, requested.replace(/\.js$/u, ".ts"), requested.replace(/\.js$/u, ".mts")]
            : [requested, `${requested}.ts`, `${requested}.mts`, resolve(requested, "index.ts")];
        const target = candidates.find((candidate) => files.has(candidate));
        if (target) result.push(target);
    }
    return result;
}

function canonicalCycle(cycle) {
    const body = cycle.slice(0, -1);
    const rotations = body.map((_, index) => [...body.slice(index), ...body.slice(0, index)]);
    return rotations.map((candidate) => candidate.join("\0")).sort()[0];
}
