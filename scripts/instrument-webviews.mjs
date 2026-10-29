/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const extensionDirectory = fileURLToPath(new URL("../extensions/mssql/", import.meta.url));
const require = createRequire(path.join(extensionDirectory, "package.json"));
const { createInstrumenter } = require("istanbul-lib-instrument");
const coverageMarker = "/* mssql-webview-coverage:globalThis */\n";

function javascriptFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const filename = path.join(directory, entry.name);
        return entry.isDirectory()
            ? javascriptFiles(filename)
            : entry.isFile() && entry.name.endsWith(".js")
              ? [filename]
              : [];
    });
}

/** Instrument coverage without eval/Function, which strict webview CSP forbids. */
export function instrumentWebviews(directory, files = javascriptFiles(directory)) {
    for (const filename of files) {
        const relative = path.relative(directory, filename);
        if (
            relative.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relative) ||
            !filename.endsWith(".js")
        ) {
            throw new Error(`Unexpected webview output: ${filename}`);
        }
        const source = fs.readFileSync(filename, "utf8");
        // Avoid parsing a potentially huge coverage payload on repeat runs.
        if (source.startsWith(coverageMarker)) continue;
        // esbuild emits adjacent external maps. Retain the original TSX
        // mapping in coverage so nyc reports against source files.
        const inputMap = fs.existsSync(`${filename}.map`)
            ? JSON.parse(fs.readFileSync(`${filename}.map`, "utf8"))
            : undefined;
        const instrumenter = createInstrumenter({
            esModules: true,
            produceSourceMap: true,
            coverageGlobalScope: "globalThis",
            coverageGlobalScopeFunc: false,
        });
        const output = instrumenter.instrumentSync(source, filename, inputMap);
        const map = instrumenter.lastSourceMap();
        if (map) {
            // The idempotence marker adds one generated line ahead of the code.
            map.mappings = ";" + map.mappings;
        }
        fs.writeFileSync(
            filename,
            coverageMarker +
                (map
                    ? `${output}\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(JSON.stringify(map)).toString("base64")}\n`
                    : output),
        );
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    // Development rebuilds leave obsolete hashed chunks behind. Instrument
    // only this build's outputs, including lazy chunks and workers.
    const metafile = JSON.parse(
        fs.readFileSync(path.join(extensionDirectory, "webviews-metafile.json"), "utf8"),
    );
    const files = Object.keys(metafile.outputs)
        .filter((file) => file.endsWith(".js"))
        .map((file) => path.resolve(extensionDirectory, file));
    instrumentWebviews(path.join(extensionDirectory, "dist", "views"), files);
}
