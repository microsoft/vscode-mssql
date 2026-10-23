/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const eslintCli = path.join(path.dirname(require.resolve("eslint/package.json")), "bin/eslint.js");
const extensionDirectory = fileURLToPath(new URL("../extensions/mssql/", import.meta.url));
const groups = [
    { name: "extension", patterns: ["./src", "--ignore-pattern", "src/webviews/**"] },
    { name: "webviews", patterns: ["./src/webviews"] },
    { name: "tests", patterns: ["./test"] },
];

export function lintMssql(args = [], run = spawnSync) {
    // Release each group's TypeScript programs and lint ASTs before starting
    // the next one. The combined run exceeds the hosted macOS Node heap limit.
    for (const { name, patterns } of groups) {
        console.log(`\nMSSQL lint: ${name}`);
        const result = run(
            process.execPath,
            [
                ...process.execArgv,
                eslintCli,
                "--quiet",
                "--cache",
                "--cache-location",
                path.join("out", ".eslintcache", name),
                ...patterns,
                ...args,
            ],
            { cwd: extensionDirectory, stdio: "inherit" },
        );
        if (result.error) {
            throw result.error;
        }
        if (result.status !== 0) {
            return result.status ?? 1;
        }
    }
    return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = lintMssql(process.argv.slice(2));
}
