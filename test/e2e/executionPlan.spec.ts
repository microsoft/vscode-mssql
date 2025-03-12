/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ElectronApplication, FrameLocator, Page } from "@playwright/test";
import { test, expect } from "./baseFixtures";
import { launchVsCodeWithMssqlExtension } from "./utils/launchVscodeWithMsSqlExt";
import { screenshotOnFailure } from "./utils/screenshotOnError";
import {
    checkScreenshot,
    waitForCommandPaletteToBeVisible,
} from "./utils/testHelpers";
import { writeCoverage } from "./utils/coverageHelpers";
import * as epTestUtils from "./utils/executionPlanHelpers";

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
    });

    test(epTestUtils.QueryPlanTestNames.LoadPlan, async () => {
        // Wait for plan to load
        await new Promise((resolve) => setTimeout(resolve, 20 * 1000));
        await checkScreenshot(
            vsCodePage,
            epTestUtils.queryPlanScreenshotPath,
            epTestUtils.QueryPlanTestNames.LoadPlan,
        );
    });

    test(epTestUtils.QueryPlanTestNames.SavePlan, async () => {
        // TBD
    });

    test(epTestUtils.QueryPlanTestNames.ShowXML, async () => {
        // Click Show XML Button
        await epTestUtils.goToNextButton(vsCodePage);
        await checkScreenshot(
            vsCodePage,
            epTestUtils.queryPlanScreenshotPath,
            epTestUtils.QueryPlanTestNames.ShowXML,
        );
    });

    test(epTestUtils.QueryPlanTestNames.OpenQuery, async () => {
        // Click Open Query Button
        await epTestUtils.goToNextButton(vsCodePage);
        await checkScreenshot(
            vsCodePage,
            epTestUtils.queryPlanScreenshotPath,
            epTestUtils.QueryPlanTestNames.OpenQuery,
        );
    });

    test(epTestUtils.QueryPlanTestNames.ZoomIn, async () => {
        // Click Zoom In Button
        await epTestUtils.goToNextButton(vsCodePage);
        await checkScreenshot(
            vsCodePage,
            epTestUtils.queryPlanScreenshotPath,
            epTestUtils.QueryPlanTestNames.ZoomIn,
        );
    });

    test(epTestUtils.QueryPlanTestNames.ZoomOut, async () => {
        // Click Zoom Out Button
        await epTestUtils.goToNextButton(vsCodePage);
        await checkScreenshot(
            vsCodePage,
            epTestUtils.queryPlanScreenshotPath,
            epTestUtils.QueryPlanTestNames.ZoomOut,
        );
    });

    test(epTestUtils.QueryPlanTestNames.ZoomToFit, async () => {
        // Click Zoom to Fit Button
        await epTestUtils.goToNextButton(vsCodePage);
        await checkScreenshot(
            vsCodePage,
            epTestUtils.queryPlanScreenshotPath,
            epTestUtils.QueryPlanTestNames.ZoomToFit,
        );
    });

    test(epTestUtils.QueryPlanTestNames.CustomZoom, async () => {
        // Click Zoom to Fit Button
        await epTestUtils.goToNextButton(vsCodePage);
        await epTestUtils.testCustomZoomClose(vsCodePage);
        await checkScreenshot(
            vsCodePage,
            epTestUtils.queryPlanScreenshotPath,
            epTestUtils.QueryPlanTestNames.CustomZoom,
        );
        await epTestUtils.reclickButton(vsCodePage);
        await epTestUtils.testCustomZoom(vsCodePage);
        await checkScreenshot(
            vsCodePage,
            epTestUtils.queryPlanScreenshotPath,
            epTestUtils.QueryPlanTestNames.CustomZoom,
        );
    });

    test(epTestUtils.QueryPlanTestNames.FindNode, async () => {
        // Click Find Node Button
        await epTestUtils.goToNextButton(vsCodePage);
        await epTestUtils.testFindNodeClose(vsCodePage);
        await checkScreenshot(
            vsCodePage,
            epTestUtils.queryPlanScreenshotPath,
            epTestUtils.QueryPlanTestNames.FindNode,
        );
        await epTestUtils.reclickButton(vsCodePage);
        await epTestUtils.testFindNodeUp(vsCodePage);
        await checkScreenshot(
            vsCodePage,
            epTestUtils.queryPlanScreenshotPath,
            epTestUtils.QueryPlanTestNames.FindNode,
        );
        await epTestUtils.testFindNodeDown(vsCodePage);
        await epTestUtils.testFindNodeDown(vsCodePage);
        await checkScreenshot(
            vsCodePage,
            epTestUtils.queryPlanScreenshotPath,
            epTestUtils.QueryPlanTestNames.FindNode,
        );
    });

    test(epTestUtils.QueryPlanTestNames.Properties, async () => {
        // Click Properties Button
        await epTestUtils.openPropertiesAfterFindNode(vsCodePage);
        await checkScreenshot(
            vsCodePage,
            epTestUtils.queryPlanScreenshotPath,
            epTestUtils.QueryPlanTestNames.Properties,
        );
        // Test closing properties pane
        await vsCodePage.keyboard.press("Enter");
        await checkScreenshot(
            vsCodePage,
            epTestUtils.queryPlanScreenshotPath,
            epTestUtils.QueryPlanTestNames.Properties,
        );
        await epTestUtils.reclickButton(vsCodePage);
        await epTestUtils.testPropertiesSortAlphabetical(vsCodePage);
        await checkScreenshot(
            vsCodePage,
            epTestUtils.queryPlanScreenshotPath,
            epTestUtils.QueryPlanTestNames.Properties,
        );
        // Sort Reverse Alphabetical
        await epTestUtils.testNextPropertiesButton(vsCodePage);
        await checkScreenshot(
            vsCodePage,
            epTestUtils.queryPlanScreenshotPath,
            epTestUtils.QueryPlanTestNames.Properties,
        );
        // Expand All
        await epTestUtils.testNextPropertiesButton(vsCodePage);
        await checkScreenshot(
            vsCodePage,
            epTestUtils.queryPlanScreenshotPath,
            epTestUtils.QueryPlanTestNames.Properties,
        );
        // Collapse All
        await epTestUtils.testNextPropertiesButton(vsCodePage);
        await checkScreenshot(
            vsCodePage,
            epTestUtils.queryPlanScreenshotPath,
            epTestUtils.QueryPlanTestNames.Properties,
        );
        await epTestUtils.testPropertiesSearch(vsCodePage);
        await checkScreenshot(
            vsCodePage,
            epTestUtils.queryPlanScreenshotPath,
            epTestUtils.QueryPlanTestNames.Properties,
        );
        await epTestUtils.testPropertiesSortByImportance(vsCodePage);
        await checkScreenshot(
            vsCodePage,
            epTestUtils.queryPlanScreenshotPath,
            epTestUtils.QueryPlanTestNames.Properties,
        );
    });

    test(epTestUtils.QueryPlanTestNames.HighlightOps, async () => {
        // Click HighlightOps Button
        await epTestUtils.openHighlightOpsFromProperties(vsCodePage);
        await epTestUtils.testHighlightOpsActualElapsedTime(vsCodePage);
        await checkScreenshot(
            vsCodePage,
            epTestUtils.queryPlanScreenshotPath,
            epTestUtils.QueryPlanTestNames.HighlightOps,
        );
        await epTestUtils.testHighlightOpsMetric(
            vsCodePage,
            "Actual Elapsed CPU Time",
        );
        await checkScreenshot(
            vsCodePage,
            epTestUtils.queryPlanScreenshotPath,
            epTestUtils.QueryPlanTestNames.HighlightOps,
        );
        await epTestUtils.testHighlightOpsMetric(vsCodePage, "Cost");
        await checkScreenshot(
            vsCodePage,
            epTestUtils.queryPlanScreenshotPath,
            epTestUtils.QueryPlanTestNames.HighlightOps,
        );
        await epTestUtils.testHighlightOpsMetric(vsCodePage, "Subtree Cost");
        await checkScreenshot(
            vsCodePage,
            epTestUtils.queryPlanScreenshotPath,
            epTestUtils.QueryPlanTestNames.HighlightOps,
        );
        await epTestUtils.testHighlightOpsMetric(
            vsCodePage,
            "Actual Number of Rows For All Executions",
        );
        await checkScreenshot(
            vsCodePage,
            epTestUtils.queryPlanScreenshotPath,
            epTestUtils.QueryPlanTestNames.HighlightOps,
        );
        await epTestUtils.testHighlightOpsMetric(
            vsCodePage,
            "Number of Rows Read",
        );
        await checkScreenshot(
            vsCodePage,
            epTestUtils.queryPlanScreenshotPath,
            epTestUtils.QueryPlanTestNames.HighlightOps,
        );
        await epTestUtils.testHighlightOpsMetric(vsCodePage, "Off");
        await checkScreenshot(
            vsCodePage,
            epTestUtils.queryPlanScreenshotPath,
            epTestUtils.QueryPlanTestNames.HighlightOps,
        );
        await vsCodePage.keyboard.press("Tab");
        await vsCodePage.keyboard.press("Enter");
        await checkScreenshot(
            vsCodePage,
            epTestUtils.queryPlanScreenshotPath,
            epTestUtils.QueryPlanTestNames.HighlightOps,
        );
    });

    test.afterEach(async ({}, testInfo) => {
        await screenshotOnFailure(vsCodePage, testInfo);
        await epTestUtils.refocusQueryPlanTab(vsCodePage);
    });

    test.afterAll(async () => {
        await epTestUtils.refocusQueryPlanTab(vsCodePage);
        await writeCoverage(iframe, "executionPlan");

        // Close query plan webview
        await vsCodePage.keyboard.press("Control+F4");

        await vsCodeApp.close();
    });
});
