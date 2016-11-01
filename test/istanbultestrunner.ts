/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
/// <reference path="../typings/node.d.ts" />

'use strict';
import paths = require('path');
import fs = require('fs');
import Mocha = require('mocha');
import istanbul = require('istanbul');

let glob = require('glob');
let remapIstanbul = require('remap-istanbul');
// Linux: prevent a weird NPE when mocha on Linux requires the window size from the TTY
// Since we are not running in a tty environment, we just implementt he method statically
let tty = require('tty');
if (!tty.getWindowSize) {
    tty.getWindowSize = function (): number[] { return [80, 75]; };
}

let mocha = new Mocha({
    ui: 'tdd',
    useColors: true
});

let coverOptions: ITestRunnerOptions = undefined;

function configure(mochaOpts, testRunnerOpts: ITestRunnerOptions): void {
    mocha = new Mocha(mochaOpts);
    coverOptions = testRunnerOpts;
}
exports.configure = configure;

function _mkDirIfExists(dir: string): void {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }
}

function run(testsRoot, clb): any {
    // Enable source map support
    require('source-map-support').install();

    // Setup coverage pre-test
    let coverageRunner: CoverageRunner = undefined;
    if (coverOptions) {
        coverageRunner = new CoverageRunner(coverOptions, testsRoot, clb);
        coverageRunner.setupCoverage();
    }

    // Glob test files
    glob('**/**.test.js', { cwd: testsRoot }, function (error, files): any {
        if (error) {
            return clb(error);
        }
        try {
            // Fill into Mocha
            files.forEach(function (f): Mocha {
                return mocha.addFile(paths.join(testsRoot, f));
            });
            // Run the tests
            let failureCount = 0;

            mocha.run()
                .on('fail', function (test, err): void {
                failureCount++;
            })
            .on('end', function (): void {
                // Report the results of code coverage if relevant
                if (coverageRunner) {
                    coverageRunner.reportCoverage(failureCount);
                }
                clb(undefined, failureCount);
            });
        } catch (error) {
            return clb(error);
        }
    });
}

interface ITestRunnerOptions {
    relativeCoverageDir: string;
    relativeSourcePath: string;
    ignorePatterns: string[];
    verbose?: boolean;
}

class CoverageRunner {

    private coverageVar: string = '$$cov_' + new Date().getTime() + '$$';
    private transformer: any = undefined;
    private matchFn: any = undefined;
    private instrumenter: any = undefined;

    constructor(private options: ITestRunnerOptions, private testsRoot: string, private endRunCallback: any) {
        if (!options.relativeSourcePath) {
            return endRunCallback('Error - relativeSourcePath must be defined for code coverage to work');
        }

    }

    public setupCoverage(): void {
        // Set up Code Coverage, hooking require so that instrumented code is returned
        let self = this;
        self.instrumenter = new istanbul.Instrumenter({ coverageVariable: self.coverageVar });
        let sourceRoot = paths.join(self.testsRoot, self.options.relativeSourcePath);

        // Glob source files
        let srcFiles = glob.sync('**/**.js', {
            ignore: self.options.ignorePatterns,
            cwd: sourceRoot
        });

        // Create a match function - taken from the run-with-cover.js in istanbul.
        let fileMap = {};
        srcFiles.forEach(file => {
            let fullPath = paths.join(sourceRoot, file);
            fileMap[fullPath] = true;
        });

        self.matchFn = function (file): boolean { return fileMap[file]; };
        self.matchFn.files = Object.keys(fileMap);

        // Hook up to the Require function so that when this is called, if any of our source files
        // are required, the instrumented version is pulled in instead. These instrumented versions
        // write to a global coverage variable with hit counts whenever they are accessed
        self.transformer = self.instrumenter.instrumentSync.bind(self.instrumenter);
        let hookOpts = { verbose: false, extensions: ['.js']};

        istanbul.hook.hookRequire(self.matchFn, self.transformer, hookOpts);

        // initialize the global variable to stop mocha from complaining about leaks
        global[self.coverageVar] = {};
    }

    public reportCoverage(failureCount: number): void {
        let self = this;
        istanbul.hook.unhookRequire();
        let cov: any;
        if (typeof global[self.coverageVar] === 'undefined' || Object.keys(global[self.coverageVar]).length === 0) {
            console.error('No coverage information was collected, exit without writing coverage information');
            return;
        } else {
            cov = global[self.coverageVar];
        }

        // TODO consider putting this under a conditional flag
        // Files that are not touched by code ran by the test runner is manually instrumented, to
        // illustrate the missing coverage.
        self.matchFn.files.forEach(file => {
            if (!cov[file]) {
                self.transformer(fs.readFileSync(file, 'utf-8'), file);

                // When instrumenting the code, istanbul will give each FunctionDeclaration a value of 1 in coverState.s,
                // presumably to compensate for function hoisting. We need to reset this, as the function was not hoisted,
                // as it was never loaded.
                Object.keys(self.instrumenter.coverState.s).forEach(key => {
                    self.instrumenter.coverState.s[key] = 0;
                });

                cov[file] = self.instrumenter.coverState;
            }
        });

        // TODO Allow config of reporting directory with
        let reportingDir = paths.join(self.testsRoot, coverOptions.relativeCoverageDir);
        let includePid = true;
        let pidExt = includePid ? ('-' + process.pid) : '',
        coverageFile = paths.resolve(reportingDir, 'coverage' + pidExt + '.json');

        _mkDirIfExists(reportingDir); // yes, do this again since some test runners could clean the dir initially created

        fs.writeFileSync(coverageFile, JSON.stringify(cov), 'utf8');

        let remappedCollector: istanbul.Collector = remapIstanbul.remap(cov, {warn: warning => {
            if (coverOptions.verbose) {
                console.warn(warning);
            }
        }});

        let reporter = new istanbul.Reporter(undefined, reportingDir);
        reporter.addAll(['lcov', 'html']);
        let reportCount = 0;
        reporter.write(remappedCollector, true, () => {
            reportCount++;
        });
        console.log(`report run ${reportCount} times`);
    }
}

exports.run = run;
