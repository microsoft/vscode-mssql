/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Page } from "@playwright/test";

export enum QueryPlanToolbarButton {
    SavePlan = 0,
    ShowXML = 1,
    OpenQuery = 2,
    ZoomIn = 3,
    ZoomOut = 4,
    ZoomToFit = 5,
    CustomZoom = 6,
    FindNode = 7,
    Properties = 8,
    HighlightExpensiveOperation = 9,
    ToggleTooltips = 10,
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

export async function testProperties(page: Page) {
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await page.screenshot({
        path:
            process.cwd() + "\\test\\resources\\PropertiesSortAlphabetical.png",
    });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await page.screenshot({
        path:
            process.cwd() +
            "\\test\\resources\\PropertiesSortReverseAlphabetical.png",
    });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await page.screenshot({
        path: process.cwd() + "\\test\\resources\\PropertiesExpandAll.png",
    });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await page.screenshot({
        path: process.cwd() + "\\test\\resources\\PropertiesCollapseAll.png",
    });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type("S");
    await page.screenshot({
        path: process.cwd() + "\\test\\resources\\PropertiesSearch.png",
    });
    for (let i = 0; i < 6; i++) {
        await page.keyboard.press("ArrowLeft");
    }
    await page.keyboard.press("Enter");
    await page.screenshot({
        path:
            process.cwd() + "\\test\\resources\\PropertiesSortByImportance.png",
    });
}

export async function openHighlightOpsFromProperties(page: Page) {
    // Focus on toolbar
    for (let i = 0; i < 9; i++) {
        await page.keyboard.press("Tab");
    }
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
}

export async function testHighlightOps(page: Page) {
    await page.keyboard.type("Actual Elapsed Time");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.screenshot({
        path:
            process.cwd() +
            "\\test\\resources\\HighlightOpsActualElapsedTime.png",
    });
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("Actual Elapsed CPU Time");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.screenshot({
        path:
            process.cwd() +
            "\\test\\resources\\HighlightOpsActualElapsedCPUTime.png",
    });
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("Cost");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.screenshot({
        path: process.cwd() + "\\test\\resources\\HighlightOpsCost.png",
    });
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("Subtree Cost");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.screenshot({
        path: process.cwd() + "\\test\\resources\\HighlightOpsSubtreeCost.png",
    });
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("Actual Number of Rows For All Executions");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.screenshot({
        path:
            process.cwd() + "\\test\\resources\\HighlightOpsExecutionRows.png",
    });
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("Number of Rows Read");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.screenshot({
        path: process.cwd() + "\\test\\resources\\HighlightOpsRowsRead.png",
    });
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("Off");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.screenshot({
        path: process.cwd() + "\\test\\resources\\HighlightOpsOff.png",
    });
}

export async function selectNodeAfterTooltipsButton(page: Page) {
    // Focus on Node
    for (let i = 0; i < 20; i++) {
        await page.keyboard.press("Tab");
    }
}
