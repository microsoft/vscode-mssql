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
// Since we are not running in a tty environment, we just implement the method statically
const tty = require("tty");
if (!tty.getWindowSize) {
    tty.getWindowSize = (): number[] => {
        return [80, 75];
    };
}

interface TestResult {
    title: string;
    file: string;
    duration: number;
    status: "passed" | "failed" | "skipped";
    error?: {
        message: string;
        stack?: string;
    };
}

export async function run(): Promise<void> {
    const testsRoot = path.resolve(__dirname, "..");

    process.env.JUNIT_REPORT_PATH =
        path.join(__dirname, "..", "..") + "/test-reports/test-results-ext.xml";

    console.log("🚀 Starting Test Suite");
    console.log("=".repeat(60));

    // Setup coverage pre-test, including post-test hook to report
    const nyc = new NYC({
        ...baseConfig,
        cwd: path.join(__dirname, "..", "..", ".."),
        reporter: ["text-summary", "html", "lcov", "cobertura"],
        all: true,
        silent: true, // Keep NYC quiet during test execution
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
            "**/reactviews/**/*.js",
            "**/*.bundle.js",
        ],
        tempDir: "./coverage/.nyc_output",
    });

    await nyc.reset();
    await nyc.wrap();

    // Print a warning for any module that should be instrumented and is already loaded,
    // delete its cache entry and re-require
    const instrumentedModules = Object.keys(require.cache).filter((f) =>
        nyc.exclude.shouldInstrument(f),
    );

    if (instrumentedModules.length > 0) {
        console.log("⚠️  Re-instrumenting pre-loaded modules:");
        instrumentedModules.forEach((m) => {
            console.log(`   • ${path.relative(process.cwd(), m)}`);
            delete require.cache[m];
            require(m);
        });
        console.log();
    }

    // Create the mocha test with a custom reporter for cleaner output
    const mocha = new Mocha({
        ui: "tdd",
        timeout: 30 * 1000, // some tests require installing sts and can take longer
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

    const rawPattern = process.env.TEST_PATTERN || process.env.MOCHA_GREP;
    const invert = /^true$/i.test(process.env.TEST_INVERT || process.env.MOCHA_INVERT || "");
    if (rawPattern) {
        let rx: RegExp;
        try {
            rx = new RegExp(rawPattern);
        } catch {
            const esc = rawPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            rx = new RegExp(esc);
        }
        mocha.grep(rx);
        if (invert) mocha.invert();
        console.log(`🔎 Filtering tests with pattern: ${rx}${invert ? " (inverted)" : ""}`);
    }

    // Add all files to the test suite
    const files = glob.sync("**/*.test.js", { cwd: testsRoot });
    files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

    console.log(`📁 Found ${files.length} test file(s):`);
    files.forEach((f, i) => {
        console.log(`   ${i + 1}. ${f}`);
    });
    console.log();

    // Arrays to store test results
    const testResults: TestResult[] = [];
    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;
    let skippedTests = 0;

    console.log("🧪 Running Tests");
    console.log("-".repeat(60));

    const failures: number = await new Promise((resolve) => {
        const runner = mocha.run(resolve);

        // Track test start times for duration calculation
        const testStartTimes = new Map<string, number>();

        runner.on("suite", (suite) => {
            if (suite.title && suite.file) {
                console.log(`\n📂 ${suite.title}`);
                console.log(`   File: ${path.relative(process.cwd(), suite.file)}`);
            }
        });

        runner.on("test", (test) => {
            testStartTimes.set(test.fullTitle(), Date.now());
        });

        runner.on("pass", (test) => {
            const startTime = testStartTimes.get(test.fullTitle()) || Date.now();
            const duration = Date.now() - startTime;

            console.log(`   ✅ ${test.title} (${duration}ms)`);

            testResults.push({
                title: test.fullTitle(),
                file: test.file || "unknown",
                duration,
                status: "passed",
            });

            passedTests++;
            totalTests++;
        });

        runner.on("fail", (test, err) => {
            const startTime = testStartTimes.get(test.fullTitle()) || Date.now();
            const duration = Date.now() - startTime;

            console.log(`   ❌ ${test.title} (${duration}ms)`);
            console.log(`      Error: ${err.message}`);

            // Show a concise stack trace (first few lines)
            if (err.stack) {
                const stackLines = err.stack.split("\n").slice(1, 4);
                stackLines.forEach((line) => {
                    console.log(`      ${line.trim()}`);
                });
            }

            testResults.push({
                title: test.fullTitle(),
                file: test.file || "unknown",
                duration,
                status: "failed",
                error: {
                    message: err.message,
                    stack: err.stack,
                },
            });

            failedTests++;
            totalTests++;
        });

        runner.on("pending", (test) => {
            console.log(`   ⏭️  ${test.title} (skipped)`);

            testResults.push({
                title: test.fullTitle(),
                file: test.file || "unknown",
                duration: 0,
                status: "skipped",
            });

            skippedTests++;
            totalTests++;
        });

        runner.on("end", () => {
            console.log("-".repeat(60));
        });
    });

    await nyc.writeCoverageFile();

    // Print test summary
    console.log("\n📊 Test Summary");
    console.log("=".repeat(60));
    console.log(`Total Tests: ${totalTests}`);
    console.log(`Passed: ${passedTests}`);
    console.log(`Failed: ${failedTests}`);
    console.log(`Skipped: ${skippedTests}`);

    // Calculate and display timing statistics
    const testDurations = testResults
        .filter((t) => t.status === "passed" || t.status === "failed")
        .map((t) => t.duration);
    if (testDurations.length > 0) {
        const totalDuration = testDurations.reduce((sum, duration) => sum + duration, 0);
        const avgDuration = Math.round(totalDuration / testDurations.length);
        const maxDuration = Math.max(...testDurations);

        console.log(
            `\nTiming: Total ${totalDuration}ms, Average ${avgDuration}ms, Max ${maxDuration}ms`,
        );
    }

    // Show detailed failure information if any
    if (failedTests > 0) {
        console.log("\n❌ Failed Tests Details");
        console.log("=".repeat(60));

        const failedResults = testResults.filter((t) => t.status === "failed");
        failedResults.forEach((test, index) => {
            console.log(`\n${index + 1}. ${test.title}`);
            console.log(`   File: ${path.relative(process.cwd(), test.file)}`);
            console.log(`   Duration: ${test.duration}ms`);

            if (test.error) {
                console.log(`   Error: ${test.error.message}`);

                if (test.error.stack) {
                    console.log(`   Stack Trace:`);
                    test.error.stack.split("\n").forEach((line) => {
                        console.log(`     ${line}`);
                    });
                }
            }
        });
    }

    // Print coverage summary separately and cleanly
    console.log("\n📈 Coverage Report");
    console.log("=".repeat(60));

    try {
        const coverageOutput = await captureStdout(nyc.report.bind(nyc));
        console.log(coverageOutput);
    } catch (error) {
        console.log("⚠️  Coverage report generation failed");
    }

    // Final result
    if (failures > 0) {
        console.log(`\n💥 ${failures} test(s) failed!`);
        console.log("Check the detailed failure information above.");
        throw new Error(`${failures} tests failed.`);
    } else {
        console.log("\n🎉 All tests passed!");
        if (totalTests === 0) {
            console.log("⚠️  No tests were found to run.");
        }
    }
}

async function captureStdout(fn): Promise<string> {
    const originalWrite = process.stdout.write;
    let buffer = "";

    process.stdout.write = (chunk: any) => {
        buffer += chunk;
        return true;
    };

    try {
        await fn();
    } finally {
        process.stdout.write = originalWrite;
    }

    return buffer;
}
