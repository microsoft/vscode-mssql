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
    /* Mints this run's cross-worker clipboard lock path; see globalSetup.ts. */
    globalSetup: require.resolve("./test/e2e/globalSetup"),
    globalTeardown: require.resolve("./test/e2e/globalTeardown"),
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
            /*
             * Sized for one grid interaction, so an ordinary test fails fast. Staging needs far
             * longer and sets its own budget in the shared beforeAll (testLifecycle.ts); a hook
             * would otherwise inherit this value.
             */
            timeout: 60 * 1000,
            expect: {
                timeout: 10 * 1000,
            },
            /*
             * One retry, so a timing blip reports as flaky rather than as a red build and the
             * difference between flake and a real break stays visible in the report.
             */
            retries: 1,
        },
    ],
});
