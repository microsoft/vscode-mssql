#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readdir, readFile, writeFile } from "node:fs/promises";

const corpusDirectory = new URL("../test/resources/corpus/", import.meta.url);
const manifestUrl = new URL("../test/resources/corpus/manifest.json", import.meta.url);
const intentionalRecoveryFiles = new Set([
    "BeginEndStatementErrorTests.sql",
    "CreateSchemaStatementErrorTests.sql",
    "CreateTriggerStatementErrorTests.sql",
    "MultipleErrorTests.sql",
]);

const names = (await readdir(corpusDirectory)).filter((name) => name.endsWith(".sql")).sort();
const files = [];

for (const name of names) {
    const bytes = await readFile(new URL(name, corpusDirectory));
    files.push({
        path: name,
        bytes: bytes.byteLength,
        encoding: detectEncoding(bytes),
        flavorHint: inferFlavor(name),
        versionHint: inferVersion(name),
        expectation: intentionalRecoveryFiles.has(name) ? "recovery" : "parseable",
    });
}

const manifest = {
    schemaVersion: 1,
    files,
};

await writeFile(manifestUrl, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

function detectEncoding(bytes) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf16le";
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf16be";
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf8-bom";
    return "utf8";
}

function inferFlavor(name) {
    if (/fabric/iu.test(name)) return "fabric";
    if (/azure/iu.test(name)) return "azure-sql";
    if (/(?:sql)?dw/iu.test(name) || /copycommand/iu.test(name)) return "synapse-dw";
    return "sql-server-or-common";
}

function inferVersion(name) {
    const matches = [
        ...name.matchAll(/(?:^|[^0-9])(80|90|100|110|120|130|140|150|160|170|180)(?=[^0-9]|$)/gu),
    ];
    return matches.length === 0 ? null : Number(matches.at(-1)[1]);
}
