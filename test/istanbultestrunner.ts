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

let coverOptions = undefined;

function configure(mochaOpts, testRunnerOpts): void {
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

    let coverageVar = '$$cov_' + new Date().getTime() + '$$';

    if (coverOptions) {
        // Set up Code Coverage, hooking require so that instrumented code is returned
        if (!coverOptions.relativeSourcePath) {
            return clb('Error - relativeSourcePath must be defined for code coverage to work');
        }

        let instrumenter = new istanbul.Instrumenter({ coverageVariable: coverageVar });
        let sourceRoot = paths.join(testsRoot, coverOptions.relativeSourcePath);
        // Glob source files
        let srcFiles = glob.sync('**/**.js', {
            ignore: coverOptions.ignorePatterns,
            cwd: sourceRoot
        });

        // Create a match function - taken from the run-with-cover.js in istanbul.
        // Note: I'm unclear if the matchFn.files assignment is needed a it mostly seems
        // to use the match function with takes file input and returns true if in the map
        let fileMap = {};
        srcFiles.forEach(file => {
            let fullPath = paths.join(sourceRoot, file);
            fileMap[fullPath] = true;
        });

        let matchFn: any = function (file): boolean { return fileMap[file]; };
        matchFn.files = Object.keys(fileMap);

        // Hook up to the Require function so that when this is called, if any of our source files
        // are required, the instrumented version is pulled in instead. These instrumented versions
        // write to a global coverage variable with hit counts whenever they are accessed
        let transformer = instrumenter.instrumentSync.bind(instrumenter);
        let hookOpts = { verbose: false, extensions: ['.js']};

        istanbul.hook.hookRequire(matchFn, transformer, hookOpts);

        // initialize the global variable to stop mocha from complaining about leaks
        global[coverageVar] = {};

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
            let failures_1 = 0;

            mocha.run()
                .on('fail', function (test, err): void {
                failures_1++;
            })
            .on('end', function (): void {
                if (coverOptions) {
                    istanbul.hook.unhookRequire();
                    let cov: any;
                    if (typeof global[coverageVar] === 'undefined' || Object.keys(global[coverageVar]).length === 0) {
                        console.error('No coverage information was collected, exit without writing coverage information');
                        return;
                    } else {
                        cov = global[coverageVar];
                    }

                    // TODO Allow config of reporting directory with
                    let reportingDir = paths.join(testsRoot, coverOptions.relativeCoverageDir);
                    let includePid = true;
                    let pidExt = includePid ? ('-' + process.pid) : '',
                    coverageFile = paths.resolve(reportingDir, 'coverage' + pidExt + '.json');

                    _mkDirIfExists(reportingDir); // yes, do this again since some test runners could clean the dir initially created

                    // if (config.reporting.print() !== 'none') {
                    //     console.error('=============================================================================');
                    //     console.error('Writing coverage object [' + file + ']');
                    // }
                    fs.writeFileSync(coverageFile, JSON.stringify(cov), 'utf8');

                    // convenience method: do not use this when dealing with a large number of files
                    // let collector = new istanbul.Collector();
                    // collector.add(cov);

                    // let reporter = new istanbul.Reporter(undefined, reportingDir);
                    // reporter.addAll(['lcov', 'html', 'json', 'text-summary']);
                    // reporter.write(collector, true, () => console.log('Code Coverage written'));

                    let remappedHtmlDir = paths.resolve(reportingDir, 'remapped');
                    _mkDirIfExists(remappedHtmlDir);
                    remapIstanbul(coverageFile, {
                        'lcovonly': paths.resolve(reportingDir, 'lcov.info'),
                        'json': paths.resolve(reportingDir, 'coverage.json'),
                        'html': remappedHtmlDir
                    }).then(() => {
                        console.log('remap complete');
                    });

                    // let remappedCollector: istanbul.Collector = remapIstanbul.remap(cov); /* collector now contains the remapped coverage */
                    // remapIstanbul.writeReport(remappedCollector, {
                    //     'lcovonly': paths.resolve(reportingDir, 'lcov.info'),
                    //     'json': paths.resolve(reportingDir, 'coverage.json'),
                    //     'html': remappedHtmlDir
                    // }).then(function (): void {
                    //     /* do something else now */
                    //     console.log('Report written OK');
                    // });

                }
                clb(undefined, failures_1);
            });
        } catch (error) {
            return clb(error);
        }
    });
}
exports.run = run;
