/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dotenv from "dotenv";
import * as path from "path";
import { defineConfig } from "@playwright/test";

dotenv.config({ path: path.resolve(__dirname, "test/e2e/.env") });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
    /* Fail the build on CI if you accidentally left test.only in the source code. */
    forbidOnly: !!process.env.CI,
    /* Smoke and grid projects share one CI run; cap total VS Code instances at two. */
    workers: 2,
    /* Reporter to use. See https://playwright.dev/docs/test-reporters */
    reporter: [
        [
            "junit",
            {
                outputFile: "./test-reports/smoke-results.xml",
            },
        ],
        /* Prints the flaky count, so a test that only passes on retry stays visible. */
        ["list"],
    ],
    /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
    use: {
        /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
        trace: "on-first-retry",
        /*
         * Electron video recording is configured per launch in launchVscodeWithMsSqlExt.ts and is
         * opt-in via ENABLE_ELECTRON_VIDEO_RECORDING. Nothing here uses a browser context, so there
         * is no second recording path to leave enabled.
         */
        video: "off",
    },
    projects: [
        {
            name: "e2e",
            testDir: "./test/e2e",
            testMatch: ["**/*.spec.ts"],
            testIgnore: ["**/grid/**"],
            fullyParallel: false,
            workers: 1,
            /* Set timeout to 5 minutes */
            timeout: 5 * 60 * 1000,
            retries: process.env.CI ? 2 : 0,
        },
        {
            name: "grid-e2e",
            testDir: "./test/e2e/grid",
            testMatch: ["**/*.spec.ts"],
            /*
             * Tests inside a file share one VS Code instance and one set of staged result grids,
             * so they must run in order. Playwright still distributes whole files across workers.
             */
            fullyParallel: false,
            /*
             * Each worker launches its own VS Code. Two fits an ubuntu-latest runner (4 vCPU)
             * comfortably alongside the SQL Server container; raise to 3 once the suite has
             * proven stable, since CPU contention surfaces as timing flake.
             */
            workers: 2,
            /* Staging happens in hooks, which get their own timeout below. */
            timeout: 60 * 1000,
            expect: {
                timeout: 10 * 1000,
            },
            retries: 0,
        },
    ],
});
