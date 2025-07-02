/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

"use strict";

// Recommended modules, loading them here to speed up NYC init
// and minimize risk of race condition
import "ts-node/register";
import "source-map-support/register";

import * as Mocha from "mocha";
// Simulates the recommended config option
// extends: "@istanbuljs/nyc-config-typescript",
import * as baseConfig from "@istanbuljs/nyc-config-typescript";
import * as glob from "glob";
import * as path from "path";

const NYC = require("nyc");

// Linux: prevent a weird NPE when mocha on Linux requires the window size from the TTY
// Since we are not running in a tty environment, we just implementt he method statically
const tty = require("tty");
if (!tty.getWindowSize) {
    tty.getWindowSize = (): number[] => {
        return [80, 75];
    };
}

export async function run(): Promise<void> {
    const testsRoot = path.resolve(__dirname, "..");

    process.env.JUNIT_REPORT_PATH =
        path.join(__dirname, "..", "..") + "/test-reports/test-results-ext.xml";

    // Setup coverage pre-test, including post-test hook to report
    const nyc = new NYC({
        ...baseConfig,
        cwd: path.join(__dirname, "..", "..", ".."),
        reporter: ["text-summary", "html", "lcov", "cobertura"],
        all: true,
        silent: false,
        instrument: true,
        hookRequire: true,
        hookRunInContext: true,
        hookRunInThisContext: true,
        include: ["out/**/*.js"],
        exclude: [
            "out/test/**",
            "**/node_modules/**",
            "**/libs/**",
            "**/lib/**",
            "**/htmlcontent/**/*.js",
            "**/views/**/*.js",
            "**/*.bundle.js",
        ],
        tempDir: "./coverage/.nyc_output",
    });
    await nyc.reset();
    await nyc.wrap();

    // Print a warning for any module that should be instrumented and is already loaded,
    // delete its cache entry and re-require
    // NOTE: This would not be a good practice for production code (possible memory leaks), but can be accepted for unit tests
    Object.keys(require.cache)
        .filter((f) => nyc.exclude.shouldInstrument(f))
        .forEach((m) => {
            console.warn("Module loaded before NYC, invalidating:", m);
            delete require.cache[m];
            require(m);
        });

    // Debug which files will be included/excluded
    // console.log('Glob verification', await nyc.exclude.glob(nyc.cwd));

    // Create the mocha test
    const mocha = new Mocha({
        ui: "tdd",
        timeout: 10 * 1000,
        reporter: "mocha-junit-reporter",
        reporterOptions: {
            mochaFile: path.join(
                __dirname,
                "..",
                "..",
                "..",
                "test-reports",
                "test-results-ext.xml",
            ),
        },
    });
    (mocha.options as any).color = true;

    // Add all files to the test suite
    const files = glob.sync("**/*.test.js", { cwd: testsRoot });
    files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

    // Array to store failed tests
    const failedTests: string[] = [];

    const failures: number = await new Promise((resolve) => {
        const runner = mocha.run(resolve);

        // Capture failed test titles
        runner.on("fail", (test, err) => {
            failedTests.push(`${test.fullTitle()}: ${err.message}`);
        });
    });
    await nyc.writeCoverageFile();

    // Capture text-summary reporter's output and log it in console
    console.log(await captureStdout(nyc.report.bind(nyc)));

    if (failures > 0) {
        console.log("\nFailed Tests:");
        failedTests.forEach((test, index) => console.log(`${index + 1}) ${test}`));
        throw new Error(`${failures} tests failed.`);
    }
}

async function captureStdout(fn) {
    let w = process.stdout.write,
        buffer = "";
    process.stdout.write = (s) => {
        buffer = buffer + s;
        return true;
    };
    await fn();
    process.stdout.write = w;
    return buffer;
}
