/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Page } from "@playwright/test";

export const queryPlanScreenshotPath =
    process.cwd() +
    `\\test\\resources\\screenshots\\executionPlan.spec.ts\\MSSQL-Extension---Query-Plan-`;

export enum QueryPlanTestNames {
    LoadPlan = "Test Plan Loaded",
    SavePlan = "Test Save Plan",
    ShowXML = "Test Show XML",
    OpenQuery = "Test Open Query",
    ZoomIn = "Test Zoom In",
    ZoomOut = "Test Zoom Out",
    ZoomToFit = "Test Zoom To Fit",
    CustomZoom = "Test Custom Zoom",
    FindNode = "Test Find Node",
    Properties = "Test Properties",
    HighlightOps = "Test Highlight Expensive Operations",
    ToggleTooltips = "Test Toggle Tooltips",
}

export async function tabToQueryPlanToolbar(vsCodePage: Page): Promise<void> {
    // Go to query plan toolbar from main state
    await vsCodePage.keyboard.press("Tab");
    await vsCodePage.keyboard.press("Tab");
    await vsCodePage.keyboard.press("Tab");
}

export async function refocusQueryPlanTab(page: Page) {
    const queryPlanTab = page.locator(
        'div[role="tab"][aria-label="plan.sqlplan (Preview)"]',
    );
    await queryPlanTab.focus();
    await page.keyboard.press("Enter");
}

export async function goToNextButton(page: Page) {
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
}

export async function reclickButton(page: Page) {
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
}

export async function testCustomZoomClose(page: Page) {
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
}

export async function testCustomZoom(page: Page) {
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("80");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
}

export async function testFindNodeClose(page: Page) {
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
}

export async function testFindNode(page: Page) {
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("Node ID");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.type("5");
}

export async function testFindNodeUp(page: Page) {
    await testFindNode(page);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
}

export async function testFindNodeDown(page: Page) {
    // Focus on Down
    for (let i = 0; i < 7; i++) {
        await page.keyboard.press("Tab");
    }
    await page.keyboard.press("Enter");
}

export async function openPropertiesAfterFindNode(page: Page) {
    // Focus on toolbar
    for (let i = 0; i < 10; i++) {
        await page.keyboard.press("Tab");
    }
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
}

export async function testPropertiesSortAlphabetical(page: Page) {
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
}

export async function testNextPropertiesButton(page: Page) {
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
}

export async function testPropertiesSearch(page: Page) {
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type("S");
}

export async function testPropertiesSortByImportance(page: Page) {
    for (let i = 0; i < 6; i++) {
        await page.keyboard.press("ArrowLeft");
    }
    await page.keyboard.press("Enter");
}

export async function openHighlightOpsFromProperties(page: Page) {
    // Focus on toolbar
    for (let i = 0; i < 9; i++) {
        await page.keyboard.press("Tab");
    }
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
}

export async function testHighlightOpsActualElapsedTime(page: Page) {
    await page.keyboard.type("Actual Elapsed Time");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
}

export async function testHighlightOpsMetric(page: Page, metric: string) {
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(metric);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
}

export async function selectNodeAfterTooltipsButton(page: Page) {
    // Focus on Node
    for (let i = 0; i < 20; i++) {
        await page.keyboard.press("Tab");
    }
}
