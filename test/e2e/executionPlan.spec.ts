/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ElectronApplication,
    FrameLocator,
    Locator,
    Page,
} from "@playwright/test";
import { test, expect } from "./baseFixtures";
import { launchVsCodeWithMssqlExtension } from "./utils/launchVscodeWithMsSqlExt";
import { screenshotOnFailure } from "./utils/screenshotOnError";
import { waitForCommandPaletteToBeVisible } from "./utils/testHelpers";
import { writeCoverage } from "./utils/coverageHelpers";

export const queryPlanScreenshotPath =
    process.cwd() +
    `\\test\\resources\\screenshots\\executionPlan.spec.ts\\MSSQL-Extension---Query-Plan-`;

test.describe("MSSQL Extension - Query Plan", async () => {
    let vsCodeApp: ElectronApplication;
    let vsCodePage: Page;
    let iframe: FrameLocator;
    let queryPlanMXGraph: Locator;

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

        iframe = vsCodePage
            .frameLocator(".webview")
            .frameLocator("[title='plan.sqlplan (Preview)']");

        // Wait for plan to load
        const queryCostElementLocator = iframe.getByText(
            "Query 1: Query cost (relative to the script): 100.00%",
        );
        await queryCostElementLocator.waitFor({
            state: "visible",
            timeout: 30 * 1000,
        });
        queryPlanMXGraph = iframe.locator("#queryPlanParent1");
        await expect(queryPlanMXGraph).toBeVisible();
    });

    test.beforeEach("Set up before each test", async () => {
        // Click zoom to fit button
        await iframe
            .locator(
                '[type="button"][aria-label="Zoom to Fit"][class*="fui-Button"]',
            )
            .click();
    });

    test("Test Saving a Query Plan", async () => {
        // TBD
    });

    test("Test Showing the XML file of a Query Plan", async () => {
        // Click Show XML Button
        const showXmlButtonLocator = iframe.locator(
            '[type="button"][aria-label="Open XML"][class*="fui-Button"]',
        );
        await showXmlButtonLocator.click();
        const showPlanXMLFile = vsCodePage.getByText("<ShowPlanXML").last();
        await expect(showPlanXMLFile).toBeVisible();
    });

    test("Test Opening the Query file of a Query Plan", async () => {
        // Click Open Query Button
        const openQueryButtonLocator = iframe.locator(
            '[type="button"][aria-label="Open Query"][class*="fui-Button"]',
        );
        await openQueryButtonLocator.click();
        const queryText = vsCodePage
            .getByText("select * from sys.all_views")
            .last();
        await expect(queryText).toBeVisible();
        const ensureSqlFileOpened = vsCodePage.locator(
            '[aria-label="Execute Query (Ctrl+Shift+E)"]',
        );
        await expect(ensureSqlFileOpened).toBeVisible();
    });

    test("Test Zooming In to the Query Plan Graph", async () => {
        // Click Zoom In Button
        const zoomInButtonLocator = iframe.locator(
            '[type="button"][aria-label="Zoom In"][class*="fui-Button"]',
        );
        await zoomInButtonLocator.click();
        await expect(vsCodePage).toHaveScreenshot();
    });

    test("Test Zooming Out from the Query Plan Graph", async () => {
        // Click Zoom Out Button
        const zoomOutButtonLocator = iframe.locator(
            '[type="button"][aria-label="Zoom Out"][class*="fui-Button"]',
        );
        await zoomOutButtonLocator.click();
        await expect(vsCodePage).toHaveScreenshot();
    });

    test("Test Zooming to Fit for Query Plan Graph", async () => {
        // Click Zoom to Fit Button
        const zoomToFitButtonLocator = iframe.locator(
            '[type="button"][aria-label="Zoom to Fit"][class*="fui-Button"]',
        );
        await zoomToFitButtonLocator.click();
        await expect(vsCodePage).toHaveScreenshot();
    });

    test("Test Custom Zooming for the Query Plan Graph", async () => {
        // Click Custom Zoom Button
        const customZoomButtonLocator = iframe.locator(
            '[type="button"][aria-label="Custom Zoom"][class*="fui-Button"]',
        );
        await customZoomButtonLocator.click();

        const customZoomInput = iframe.locator("#customZoomInputBox");
        await expect(customZoomInput).toBeVisible();

        await customZoomInput.fill("80");
        const customZoomApplyButton = iframe.locator(
            '[type="button"][aria-label="Apply"][class*="fui-Button"]',
        );
        await customZoomApplyButton.click();
        await expect(vsCodePage).toHaveScreenshot();

        await customZoomButtonLocator.click();
        await expect(customZoomInput).toBeVisible();
        const customZoomCloseButton = iframe.locator(
            '[type="button"][aria-label="Close"][class*="fui-Button"]',
        );
        await customZoomCloseButton.click();
        await expect(customZoomInput).toBeHidden();
    });

    test("Test Find Node", async () => {
        // Click Find Node Button
        const findNodeButtonLocator = iframe.locator(
            '[type="button"][aria-label="Find Node"][class*="fui-Button"]',
        );
        await findNodeButtonLocator.click();

        const findNodeComboBox = iframe.locator("#findNodeDropdown");
        await findNodeComboBox.fill("Node ID");

        const findNodeComparisonDropdown = iframe.locator(
            "#findNodeComparisonDropdown",
        );
        await findNodeComparisonDropdown.click();
        for (let i = 0; i < 3; i++)
            await vsCodePage.keyboard.press("ArrowDown");
        await vsCodePage.keyboard.press("Enter");

        const findNodeInputBox = iframe.locator("#findNodeInputBox");
        await findNodeInputBox.fill("5");

        const findNodeDownButtonLocator = iframe.locator(
            '[type="button"][aria-label="Next"][class*="fui-Button"]',
        );
        await findNodeDownButtonLocator.click();
        await findNodeDownButtonLocator.click();
        await expect(vsCodePage).toHaveScreenshot();

        const findNodeUpButtonLocator = iframe.locator(
            '[type="button"][aria-label="Previous"][class*="fui-Button"]',
        );
        await findNodeUpButtonLocator.click();
        await findNodeUpButtonLocator.click();
        await findNodeUpButtonLocator.click();
        await expect(vsCodePage).toHaveScreenshot();

        const findNodeCloseButtonLocator = iframe.locator(
            '[type="button"][aria-label="Close"][class*="fui-Button"]',
        );
        await findNodeCloseButtonLocator.click();

        await expect(findNodeInputBox).toBeHidden();
    });

    test("Test the Query Plan Properties Panel", async () => {
        // Click Properties Button
        const propertiesButtonLocator = iframe.locator(
            '[type="button"][aria-label="Properties"][class*="fui-Button"]',
        );
        await propertiesButtonLocator.click();

        // Sort Alphabetical
        const alphabeticalButton = iframe.locator(
            '[type="button"][aria-label="Alphabetical"][class*="fui-Button"]',
        );
        await alphabeticalButton.click();
        let firstCellLocator = iframe.locator('[role="gridcell"]').first();
        let firstCellOuterHTML = await firstCellLocator.evaluate(
            (el) => el.outerHTML,
        );
        await expect(
            firstCellOuterHTML.includes("Defined Values"),
        ).toBeTruthy();

        // Sort Reverse Alphabetical
        const reverseAlphabeticalButton = iframe.locator(
            '[type="button"][aria-label="Reverse Alphabetical"][class*="fui-Button"]',
        );
        await reverseAlphabeticalButton.click();
        firstCellLocator = iframe.locator('[role="gridcell"]').first();
        firstCellOuterHTML = await firstCellLocator.evaluate(
            (el) => el.outerHTML,
        );
        await expect(
            firstCellOuterHTML.includes("TableCardinality"),
        ).toBeTruthy();

        // Expand All
        const expandAllButton = iframe.locator(
            '[type="button"][aria-label="Expand All"][class*="fui-Button"]',
        );
        await expandAllButton.click();
        const expandedCellLocator = iframe.getByText("Database").first();
        await expect(expandedCellLocator).toBeVisible();

        // Collapse All
        const collapseAllButton = iframe.locator(
            '[type="button"][aria-label="Collapse All"][class*="fui-Button"]',
        );
        await collapseAllButton.click();
        await expect(expandedCellLocator).toBeHidden();

        // Sort By Importance
        const importanceButton = iframe.locator(
            '[type="button"][aria-label="Importance"][class*="fui-Button"]',
        );
        await importanceButton.click();
        firstCellLocator = iframe.locator('[role="gridcell"]').first();
        firstCellOuterHTML = await firstCellLocator.evaluate(
            (el) => el.outerHTML,
        );
        await expect(
            firstCellOuterHTML.includes("Physical Operation"),
        ).toBeTruthy();

        const searchProperties = iframe.locator(
            '[placeholder="Filter for any field..."][class*="fui-Input__input"]',
        );
        await searchProperties.fill("S");
        firstCellLocator = iframe.locator('[role="gridcell"]').first();
        firstCellOuterHTML = await firstCellLocator.evaluate(
            (el) => el.outerHTML,
        );
        await expect(
            firstCellOuterHTML.includes("Physical Operation"),
        ).toBeTruthy();

        const propertiesCloseButtonLocator = iframe.locator(
            '[type="button"][aria-label="Close"][class*="fui-Button"]',
        );
        await propertiesCloseButtonLocator.click();

        await expect(alphabeticalButton).toBeHidden();
    });

    test("Test Query Plan Highlight Expensive Metric", async () => {
        // Click HighlightOps Button
        const highlightOpsButtonLocator = iframe.locator(
            '[type="button"][aria-label="Highlight Expensive Operation"][class*="fui-Button"]',
        );
        await highlightOpsButtonLocator.click();

        const highlightOpsInputBox = iframe.locator(
            "#highlightExpensiveOpsDropdown",
        );
        const highlightOpsApplyButton = iframe.locator(
            '[type="button"][aria-label="Apply"][class*="fui-Button"]',
        );

        await highlightOpsInputBox.fill("Actual Elapsed Time");
        await highlightOpsApplyButton.click();
        await expect(vsCodePage).toHaveScreenshot();

        await highlightOpsInputBox.fill("Actual Elapsed CPU Time");
        await highlightOpsApplyButton.click();
        await expect(vsCodePage).toHaveScreenshot();

        await highlightOpsInputBox.fill("Cost");
        await highlightOpsApplyButton.click();
        await expect(vsCodePage).toHaveScreenshot();

        await highlightOpsInputBox.fill("Subtree Cost");
        await highlightOpsApplyButton.click();
        await expect(vsCodePage).toHaveScreenshot();

        await highlightOpsInputBox.fill(
            "Actual Number of Rows For All Executions",
        );
        await highlightOpsApplyButton.click();
        await expect(vsCodePage).toHaveScreenshot();

        await highlightOpsInputBox.fill("Number of Rows Read");
        await highlightOpsApplyButton.click();
        await expect(vsCodePage).toHaveScreenshot();

        await highlightOpsInputBox.fill("Off");
        await highlightOpsApplyButton.click();
        await expect(vsCodePage).toHaveScreenshot();

        const highlightOpsCloseButton = iframe.locator(
            '[type="button"][aria-label="Close"][class*="fui-Button"]',
        );
        await highlightOpsCloseButton.click();

        await expect(highlightOpsInputBox).toBeHidden();
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

export async function refocusQueryPlanTab(page: Page) {
    const queryPlanTab = page.locator(
        'div[role="tab"][aria-label="plan.sqlplan (Preview)"]',
    );
    await queryPlanTab.focus();
    await page.keyboard.press("Enter");
}
