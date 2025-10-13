/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";

import { runTests } from "@vscode/test-electron";

function parsePatternArg(argv: string[]): string | undefined {
    // Supports: --testPattern "<regex>", --pattern "<regex>", --grep "<regex>"
    const keys = new Set(["--testPattern", "--pattern", "--grep"]);
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (keys.has(arg)) {
            return argv[i + 1]; // next token as value
        }
        // also allow --testPattern=foo
        const [k, v] = arg.split("=", 2);
        if (keys.has(k) && v) {
            return v;
        }
    }
    return undefined;
}

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, "../../../");

        // The path to test runner
        // Passed to --extensionTestsPath
        const extensionTestsPath = path.resolve(__dirname, "./index");

        // Parse optional test pattern
        const patternFromArgs = parsePatternArg(process.argv.slice(2));
        // Allow env override too
        const testPattern = patternFromArgs ?? process.env.TEST_PATTERN;

        if (testPattern) {
            console.log(`Using test pattern (grep): ${testPattern}`);
        } else {
            console.log("No test pattern provided; running full test suite.");
        }

        // Download VS Code, unzip it and run the integration test
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                "--disable-extensions",
                "--skip-welcome",
                "--skip-release-notes",
                extensionDevelopmentPath, // Open the extension folder as workspace
            ],
            extensionTestsEnv: {
                ...process.env,
                TEST_PATTERN: testPattern ?? "",
                // Some runners read MOCHA_GREP; set it too for convenience
                MOCHA_GREP: testPattern ?? "",
            },
        });
    } catch (err) {
        console.error("Failed to run tests", err);
        process.exit(1);
    }
}

void main();
