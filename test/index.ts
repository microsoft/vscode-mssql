/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

//
// PLEASE DO NOT MODIFY / DELETE UNLESS YOU KNOW WHAT YOU ARE DOING
//
// This file is providing the test runner to use when running extension tests.
// By default the test runner in use is Mocha based.
//
// You can provide your own test runner if you want to override it by exporting
// a function run(testRoot: string, clb: (error:Error) => void) that the extension
// host can call to run the tests. The test runner is expected to use console.log
// to report the results back to the caller. When the tests are finished, return
// a possible error to the callback or null if none.

import * as IstanbulTestRunner from './istanbultestrunner';

let testRunner: any = IstanbulTestRunner;

// You can directly control Mocha options by uncommenting the following lines
// See https://github.com/mochajs/mocha/wiki/Using-mocha-programmatically#set-options for more info
testRunner.configure(
    // Mocha Options
    {
        ui: 'tdd', 		        // the TDD UI is being used in extension.test.ts (suite, test, etc.)
        reporter: 'pm-mocha-jenkins-reporter',
        reporterOptions: {
            junit_report_name: 'Extension Tests',
            junit_report_path: __dirname + '../../test-reports/extension_tests.xml',
            junit_report_stack: 1
        },
        useColors: true         // colored output from test results
    },
    // Coverage configuration options
    {
        coverConfig: '../coverconfig.json'
    });

module.exports = testRunner;
