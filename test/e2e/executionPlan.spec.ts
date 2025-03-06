/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ElectronApplication, FrameLocator, Page } from "@playwright/test";
import { test, expect } from "./baseFixtures";
import { launchVsCodeWithMssqlExtension } from "./utils/launchVscodeWithMsSqlExt";
import { screenshotOnFailure } from "./utils/screenshotOnError";
import { waitForCommandPaletteToBeVisible } from "./utils/testHelpers";
import { writeCoverage } from "./utils/coverageHelpers";

test.describe("MSSQL Extension - Query Plan", async () => {
    let vsCodeApp: ElectronApplication;
    let vsCodePage: Page;
    let iframe: FrameLocator;

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

        iframe = vsCodePage.frameLocator("iframe.webview.ready");
        await expect(iframe).toBeDefined();
    });

    test("Open a query plan", async () => {
        // To Do, make more comprehensive tests
        const queryCostElement = await iframe.locator("#queryCostContainer");
        await expect(queryCostElement).toBeDefined();

        const savePlanElement = iframe.locator("[aria-label=Save Plan]");
        await expect(savePlanElement).toBeDefined();
    });

    test.afterEach(async ({}, testInfo) => {
        await screenshotOnFailure(vsCodePage, testInfo);
    });

    test.afterAll(async () => {
        await writeCoverage(iframe);

        // Close query plan webview
        await vsCodePage.keyboard.press("Control+F4");

        await vsCodeApp.close();
    });
});
