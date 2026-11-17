/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Checks the tags on the MSSQL e2e tests (see extensions/mssql/test/e2e/README.md). A test may
 * not be both @pull-request and @flaky, since pull request checks must be stable, and only known
 * tags are allowed, so a misspelled tag cannot silently move a test into another tier. Tags
 * inherited from a describe block count.
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extensionDirectory = fileURLToPath(new URL("../extensions/mssql/", import.meta.url));
const KNOWN_TAGS = new Set(["pull-request", "flaky"]);

/** Lists the tag problems in a Playwright JSON report. */
export function findTagProblems(report) {
    const problems = [];
    const visit = (suite, titlePath) => {
        const suiteTitle = suite.title && !suite.title.endsWith(".ts") ? [suite.title] : [];
        const nextPath = [...titlePath, ...suiteTitle];
        for (const spec of suite.specs ?? []) {
            const name = `${spec.file}: ${[...nextPath, spec.title].join(" › ")}`;
            const tags = new Set(spec.tags ?? []);
            for (const tag of tags) {
                if (!KNOWN_TAGS.has(tag)) {
                    problems.push(`${name} has unknown tag @${tag}.`);
                }
            }
            if (tags.has("pull-request") && tags.has("flaky")) {
                problems.push(`${name} is tagged both @pull-request and @flaky.`);
            }
        }
        for (const child of suite.suites ?? []) {
            visit(child, nextPath);
        }
    };
    for (const suite of report.suites ?? []) {
        visit(suite, []);
    }
    // Parameterized tests appear once per project, so report each problem once.
    return [...new Set(problems)];
}

/** Lists every e2e test with Playwright and returns the process exit code for the check. */
export function checkE2eTags(run = spawnSync) {
    const require = createRequire(path.join(extensionDirectory, "package.json"));
    const playwrightCli = require.resolve("@playwright/test/cli");
    const result = run(process.execPath, [playwrightCli, "test", "--list", "--reporter=json"], {
        cwd: extensionDirectory,
        env: { ...process.env, E2E_TIER: "all" },
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) {
        throw result.error;
    }

    let report;
    try {
        report = JSON.parse(result.stdout);
    } catch {
        console.error("Could not list the e2e tests.");
        console.error(result.stderr || result.stdout);
        return result.status || 1;
    }

    const problems = [
        ...(report.errors ?? []).map((error) => error.message),
        ...findTagProblems(report),
    ];
    if (problems.length > 0) {
        console.error("E2E test tag check failed:");
        for (const problem of problems) {
            console.error(`  ${problem}`);
        }
        return 1;
    }
    console.log("E2E test tags are valid.");
    return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = checkE2eTags();
}
