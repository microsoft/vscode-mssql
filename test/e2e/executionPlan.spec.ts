/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ElectronApplication, Page } from "@playwright/test";
import { test, expect } from "./baseFixtures";
import { launchVsCodeWithMssqlExtension } from "./utils/launchVscodeWithMsSqlExt";
import { screenshotOnFailure } from "./utils/screenshotOnError";
import { waitForCommandPaletteToBeVisible } from "./utils/testHelpers";
import path from "path";
import fs from "fs";

const istanbulCLIOutput = path.join(process.cwd(), ".nyc_output");

test.describe("MSSQL Extension - Query Plan", async () => {
    let vsCodeApp: ElectronApplication;
    let vsCodePage: Page;

    test.beforeAll(async () => {
        const { electronApp, page } = await launchVsCodeWithMssqlExtension();
        vsCodeApp = electronApp;
        vsCodePage = page;

        // Query plan entry point
        await new Promise((resolve) => setTimeout(resolve, 1 * 1000));
        await vsCodePage.keyboard.press("Control+P");
        await waitForCommandPaletteToBeVisible(vsCodePage);
        await vsCodePage.keyboard.type(
            process.cwd() + "\\out\\test\\resources\\plan.sqlplan",
        );
        await waitForCommandPaletteToBeVisible(vsCodePage);
        // Press Enter in the VS Code page
        await vsCodePage.keyboard.press("Enter");

        const iframe = vsCodePage.frameLocator("iframe.webview.ready");
        await expect(iframe).toBeDefined();
    });

    test("Open a query plan", async () => {
        const iframe = vsCodePage.frameLocator("iframe.webview.ready");

        const queryCostElement = await iframe.locator("#queryCostContainer");
        await expect(queryCostElement).toBeDefined();

        const savePlanElement = iframe.locator("[aria-label=Save Plan]");
        await expect(savePlanElement).toBeDefined();

        const iframeWindow = iframe.locator("#active-frame");
        await expect(iframeWindow).toBeDefined();
        await iframeWindow.waitFor();

        await new Promise((resolve) => setTimeout(resolve, 120 * 1000));

        // Get the HTML evaluate of the iframe
        const iframeEvaluateHandle = await iframeWindow.evaluate(
            (el) => (el as HTMLIFrameElement).contentWindow,
        );

        if (iframeEvaluateHandle) {
            console.log(iframeEvaluateHandle);

            // If you want to retrieve a specific property, use evaluate on the handle
            const coverage = (iframeEvaluateHandle as any).__coverage__;

            // Ensure coverage data exists before writing
            if (coverage) {
                const coverageJSON = JSON.stringify(coverage, null, 2); // Convert object to formatted JSON string

                // Define the file path
                const coverageFilePath = path.join(
                    istanbulCLIOutput,
                    "playwright_coverage_executionPlan.json",
                );

                // Write the JSON string to the file
                fs.writeFileSync(coverageFilePath, coverageJSON, "utf-8");

                console.log(
                    `Coverage data successfully written to: ${coverageFilePath}`,
                );
            } else {
                console.warn("No coverage data found.");
            }
        } else {
            console.error("Failed to get the iframe element.");
        }

        await vsCodePage.keyboard.press("Control+F4");
    });

    test.afterEach(async ({}, testInfo) => {
        await screenshotOnFailure(vsCodePage, testInfo);
    });

    test.afterAll(async () => {
        await vsCodeApp.close();
    });
});
