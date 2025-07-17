/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as paths from "path";
import * as fs from "fs";
import * as Mocha from "mocha";
import * as istanbul from "istanbul";
import * as glob from "glob";
import * as remapIstanbul from "remap-istanbul";

// Linux: prevent a weird NPE when mocha on Linux requires the window size from the TTY
// Since we are not running in a tty environment, we just implementt he method statically
// tslint:disable-next-line:no-require-imports
let tty = require("tty");
if (!tty.getWindowSize) {
    tty.getWindowSize = function (): number[] {
        return [80, 75];
    };
}

let mocha = new Mocha({
    ui: "tdd",
    useColors: true,
});

let testCoverOptions: ITestCoverOptions | undefined = undefined;

export function configure(mochaOpts: Mocha.MochaOptions, testCoverOpts: ITestCoverOptions): void {
    mocha = new Mocha(mochaOpts);
    testCoverOptions = testCoverOpts;
}

function mkDirIfExists(dir: string): void {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }
}

class CoverageRunner {
    private coverageVar: string = "$$cov_" + Date.now() + "$$";
    private transformer: any = undefined;
    private matchFn: any = undefined;
    private instrumenter: any = undefined;

    constructor(
        private options: ITestRunnerOptions,
        private testsRoot: string,
        endRunCallback: any,
    ) {
        if (!options.relativeSourcePath) {
            return endRunCallback(
                "Error - relativeSourcePath must be defined for code coverage to work",
            );
        }
    }

    public setupCoverage(): void {
        // Set up Code Coverage, hooking require so that instrumented code is returned
        let self = this;
        self.instrumenter = new istanbul.Instrumenter({
            coverageVariable: self.coverageVar,
        });
        let sourceRoot = paths.join(self.testsRoot, self.options.relativeSourcePath);

        // Glob source files
        let srcFiles = glob.sync("**/**.js", {
            ignore: [...self.options.ignorePatterns, "**/reactviews/**"], // ignore reactviews folder for now
            cwd: sourceRoot,
        });

        // Create a match function - taken from the run-with-cover.js in istanbul.
        // tslint:disable-next-line:no-require-imports
        let decache = require("decache");
        let fileMap = {};
        srcFiles.forEach((file) => {
            let fullPath = paths.join(sourceRoot, file);
            fileMap[fullPath] = true;

            // On Windows, extension is loaded pre-test hooks and this mean we lose
            // our chance to hook the Require call. In order to instrument the code
            // we have to decache the JS file so on next load it gets instrumented.
            // This doesn't impact tests, but is a concern if we had some integration
            // tests that relied on VSCode accessing our module since there could be
            // some shared global state that we lose.
            decache(fullPath);
        });

        self.matchFn = function (file): boolean {
            return fileMap[file];
        };
        self.matchFn.files = Object.keys(fileMap);

        // Hook up to the Require function so that when this is called, if any of our source files
        // are required, the instrumented version is pulled in instead. These instrumented versions
        // write to a global coverage variable with hit counts whenever they are accessed
        self.transformer = self.instrumenter.instrumentSync.bind(self.instrumenter);
        let hookOpts = { verbose: false, extensions: [".js"] };
        istanbul.hook.hookRequire(self.matchFn, self.transformer, hookOpts);

        // initialize the global variable to stop mocha from complaining about leaks
        global[self.coverageVar] = {};

        // Hook the process exit event to handle reporting
        // Only report coverage if the process is exiting successfully
        process.on("exit", (code) => {
            self.reportCoverage();
        });
    }

    /**
     * Writes a coverage report. Note that as this is called in the process exit callback, all calls must be synchronous.
     *
     * @returns
     *
     * @memberOf CoverageRunner
     */
    public reportCoverage(): void {
        let self = this;
        istanbul.hook.unhookRequire();
        let cov: any;
        if (
            typeof global[self.coverageVar] === "undefined" ||
            Object.keys(global[self.coverageVar]).length === 0
        ) {
            console.error(
                "No coverage information was collected, exit without writing coverage information",
            );
            return;
        } else {
            cov = global[self.coverageVar];
        }

        // TODO consider putting this under a conditional flag
        // Files that are not touched by code ran by the test runner is manually instrumented, to
        // illustrate the missing coverage.
        self.matchFn.files.forEach((file) => {
            if (!cov[file]) {
                self.transformer(fs.readFileSync(file, "utf-8"), file);

                // When instrumenting the code, istanbul will give each FunctionDeclaration a value of 1 in coverState.s,
                // presumably to compensate for function hoisting. We need to reset this, as the function was not hoisted,
                // as it was never loaded.
                Object.keys(self.instrumenter.coverState.s).forEach((key) => {
                    self.instrumenter.coverState.s[key] = 0;
                });

                cov[file] = self.instrumenter.coverState;
            }
        });

        // TODO Allow config of reporting directory with
        let reportingDir = paths.join(self.testsRoot, self.options.relativeCoverageDir);
        let includePid = self.options.includePid;
        let pidExt = includePid ? "-" + process.pid : "",
            coverageFile = paths.resolve(reportingDir, "coverage" + pidExt + ".json");

        mkDirIfExists(reportingDir); // yes, do this again since some test runners could clean the dir initially created

        fs.writeFileSync(coverageFile, JSON.stringify(cov), "utf8");

        let remappedCollector: istanbul.Collector = remapIstanbul.remap(cov, {
            warn: (warning) => {
                // We expect some warnings as any JS file without a typescript mapping will cause this.
                // By default, we'll skip printing these to the console as it clutters it up
                if (self.options.verbose) {
                    console.warn(warning);
                }
            },
        });

        let reporter = new istanbul.Reporter(undefined, reportingDir);
        let reportTypes = self.options.reports instanceof Array ? self.options.reports : ["lcov"];
        reporter.addAll(reportTypes);
        reporter.write(remappedCollector, true, () => {
            console.log(`reports written to ${reportingDir}`);
        });
    }
}

function readCoverOptions(testsRoot: string): ITestRunnerOptions {
    if (!testCoverOptions) {
        console.warn("No coverage options passed in, skipping code coverage");
        return undefined;
    }
    let coverConfigPath = paths.join(testsRoot, testCoverOptions.coverConfig);
    let coverConfig: ITestRunnerOptions | undefined = undefined;
    if (fs.existsSync(coverConfigPath)) {
        let configContent = fs.readFileSync(coverConfigPath);
        coverConfig = JSON.parse(configContent.toString());
    }
    return coverConfig;
}

export function run(testsRoot: string, clb: (error: any, failures?: number) => void): any {
    // Enable source map support
    // tslint:disable-next-line:no-require-imports
    require("source-map-support").install();

    // Read configuration for the coverage file
    let coverOptions: ITestRunnerOptions | undefined = readCoverOptions(testsRoot);
    if (coverOptions?.enabled) {
        // Setup coverage pre-test, including post-test hook to report
        let coverageRunner = new CoverageRunner(coverOptions, testsRoot, clb);
        coverageRunner.setupCoverage();
    }

    // Force the extension to activate by running one of our commands
    vscode.commands.executeCommand("mssql.connect").then(() => {
        // Glob test files
        try {
            const files = glob.globSync("**/**.test.js", { cwd: testsRoot });

            // Fill into Mocha
            files.forEach(function (f): Mocha {
                return mocha.addFile(paths.join(testsRoot, f));
            });
            // Run the tests
            let failureCount = 0;

            mocha
                .run()
                .on("fail", function (test, err): void {
                    failureCount++;
                })
                .on("end", function (): void {
                    clb(undefined, failureCount);
                });
        } catch (error) {
            return clb(error);
        }
    });
}

export interface ITestCoverOptions {
    /**
     * Relative path to the coverage config file with configuration
     * options for the test runner options.
     */
    coverConfig: string;
}

interface ITestRunnerOptions {
    enabled?: boolean;
    relativeCoverageDir: string;
    relativeSourcePath: string;
    ignorePatterns: string[];
    includePid?: boolean;
    reports?: string[];
    verbose?: boolean;
}
