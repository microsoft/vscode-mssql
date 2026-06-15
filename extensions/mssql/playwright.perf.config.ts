/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dotenv from "dotenv";
import * as path from "path";
import { defineConfig } from "@playwright/test";

dotenv.config({ path: path.resolve(__dirname, "test/e2e/.env") });

export default defineConfig({
    testDir: "./test/perf",
    testMatch: ["**/*.spec.ts"],
    fullyParallel: false,
    retries: 0,
    workers: 1,
    reporter: [
        ["list"],
        [
            "json",
            {
                outputFile: "./test-reports/grid-perf/playwright-results.json",
            },
        ],
    ],
    timeout: 10 * 60 * 1000,
    use: {
        trace: "retain-on-failure",
        video: "off",
    },
});
