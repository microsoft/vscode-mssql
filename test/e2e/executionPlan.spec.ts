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
import {
    goToNextButton,
    openHighlightOpsFromProperties,
    openPropertiesAfterFindNode,
    reclickButton,
    refocusQueryPlanTab,
    testCustomZoom,
    testCustomZoomClose,
    testFindNodeClose,
    testFindNodeDown,
    testFindNodeUp,
    testHighlightOps,
    testProperties,
} from "./utils/executionPlanHelpers";

test.describe("MSSQL Extension - Query Plan", async () => {
    let vsCodeApp: ElectronApplication;
    let vsCodePage: Page;
    let iframe: FrameLocator;

    test.beforeAll("Setting up for Query Plan Tests", async () => {
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
        await iframe.owner().waitFor({ state: "visible" });
        await expect(iframe).toBeTruthy();

        // wait for plan to load
        await new Promise((resolve) => setTimeout(resolve, 20 * 1000));
        await expect(vsCodePage).toHaveScreenshot();
    });

    test("Save Plan should work as expected", async () => {
        // Click Show XML Button
        await goToNextButton(vsCodePage);
        await vsCodePage.screenshot({
            path: process.cwd() + "\\test\\resources\\ShowXml.png",
        });
        await refocusQueryPlanTab(vsCodePage);

        // Click Open Query Button
        await goToNextButton(vsCodePage);
        await vsCodePage.screenshot({
            path: process.cwd() + "\\test\\resources\\OpenQuery.png",
        });
        await refocusQueryPlanTab(vsCodePage);

        // Click Zoom In Button
        await goToNextButton(vsCodePage);
        await vsCodePage.screenshot({
            path: process.cwd() + "\\test\\resources\\ZoomIn.png",
        });
        await refocusQueryPlanTab(vsCodePage);

        // Click Zoom Out Button
        await goToNextButton(vsCodePage);
        await vsCodePage.screenshot({
            path: process.cwd() + "\\test\\resources\\ZoomOut.png",
        });
        await refocusQueryPlanTab(vsCodePage);

        // Click Zoom To Fit Button
        await goToNextButton(vsCodePage);
        await vsCodePage.screenshot({
            path: process.cwd() + "\\test\\resources\\ZoomToFit.png",
        });
        await refocusQueryPlanTab(vsCodePage);

        // Click Custom Zoom Button
        await goToNextButton(vsCodePage);
        await testCustomZoomClose(vsCodePage);
        await vsCodePage.screenshot({
            path: process.cwd() + "\\test\\resources\\CustomZoomClose.png",
        });
        await reclickButton(vsCodePage);
        await testCustomZoom(vsCodePage);
        await vsCodePage.screenshot({
            path: process.cwd() + "\\test\\resources\\CustomZoom.png",
        });
        await refocusQueryPlanTab(vsCodePage);

        // Click Find Node Button
        await goToNextButton(vsCodePage);
        await testFindNodeClose(vsCodePage);
        await vsCodePage.screenshot({
            path: process.cwd() + "\\test\\resources\\FindNodeClose.png",
        });
        await reclickButton(vsCodePage);
        await testFindNodeUp(vsCodePage);
        await vsCodePage.screenshot({
            path: process.cwd() + "\\test\\resources\\FindNodeUp.png",
        });
        await testFindNodeDown(vsCodePage);
        await testFindNodeDown(vsCodePage);
        await vsCodePage.screenshot({
            path: process.cwd() + "\\test\\resources\\FindNodeDown.png",
        });
        await refocusQueryPlanTab(vsCodePage);

        // Click Properties Button
        await openPropertiesAfterFindNode(vsCodePage);
        await vsCodePage.screenshot({
            path: process.cwd() + "\\test\\resources\\OpenProperties.png",
        });
        // Test closing properties pane
        await vsCodePage.keyboard.press("Enter");
        await vsCodePage.screenshot({
            path: process.cwd() + "\\test\\resources\\CloseProperties.png",
        });
        await reclickButton(vsCodePage);
        await testProperties(vsCodePage);
        await refocusQueryPlanTab(vsCodePage);

        // Click HighlightOpsButton
        await openHighlightOpsFromProperties(vsCodePage);
        await testHighlightOps(vsCodePage);
        await vsCodePage.screenshot({
            path: process.cwd() + "\\test\\resources\\HighlightOps.png",
        });
        await vsCodePage.keyboard.press("Tab");
        await vsCodePage.keyboard.press("Enter");
        await testHighlightOps(vsCodePage);
        await vsCodePage.screenshot({
            path: process.cwd() + "\\test\\resources\\HighlightClose.png",
        });
    });

    test.afterEach(async ({}, testInfo) => {
        await screenshotOnFailure(vsCodePage, testInfo);
        await refocusQueryPlanTab(vsCodePage);
    });

    test.afterAll(async () => {
        await refocusQueryPlanTab(vsCodePage);
        await writeCoverage(iframe, "executionPlan");

        // Close query plan webview
        await vsCodePage.keyboard.press("Control+F4");

        await vsCodeApp.close();
    });
});
