/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator, Locator, Page } from "@playwright/test";
import { test, expect } from "./baseFixtures";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";
import {
    getModifierKey,
    getWebviewByTitle,
    waitForCommandPaletteToBeVisible,
} from "./utils/testHelpers";
import { writeCoverage } from "./utils/coverageHelpers";
import path from "path";

test.describe("MSSQL Extension - Query Plan", async () => {
    let vsCodePage: Page;
    let iframe: FrameLocator;
    let queryPlanMXGraph: Locator;
    let currentZoom = 100;

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: {
            initialConfig: {
                "mssql.showChangelogOnUpdate": false,
                "mssql.preview.betaExecutionPlan": true,
            },
        },
        afterLaunch: async ({ page }) => {
            vsCodePage = page;
            // Query plan entry point
            await new Promise((resolve) => setTimeout(resolve, 1 * 1000));
            await vsCodePage.keyboard.press(`${getModifierKey()}+P`);
            await waitForCommandPaletteToBeVisible(vsCodePage);
            await vsCodePage.keyboard.type(
                // Use __dirname so this works regardless of the process working directory.
                path.join(__dirname, "..", "resources", "plan.sqlplan"),
            );
            await waitForCommandPaletteToBeVisible(vsCodePage);
            // Press Enter in the VS Code page
            await vsCodePage.keyboard.press("Enter");

            iframe = await getWebviewByTitle(vsCodePage, "plan.sqlplan");

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
        },
        afterEach: async ({ page: vsCodePage }) => {
            await refocusQueryPlanTab(vsCodePage);
        },
        beforeClose: async ({ page: vsCodePage }) => {
            await refocusQueryPlanTab(vsCodePage);
            await writeCoverage(iframe, "executionPlan");

            // Close query plan webview
            await vsCodePage.keyboard.press(`${getModifierKey()}+W`);
        },
    });

    test.beforeEach("Set up before each test", async () => {
        getContext();
        currentZoom = await getZoom(iframe);
    });

    test("Test Initial Query Plan Zoom and Accessibility", async () => {
        await expect(Math.round(currentZoom)).toBe(100);
        await expect(iframe.locator(".execution-plan-flow-arrow").first()).toBeVisible();

        const rootNode = iframe.locator('[role="treeitem"][tabindex="0"]').first();
        await expect(rootNode).toBeVisible();
        await rootNode.focus();
        const viewport = iframe.locator(".react-flow__viewport").first();
        const viewportStyle = await viewport.getAttribute("style");
        await rootNode.press("ArrowRight");
        await expect(iframe.locator('[role="treeitem"]:focus')).toBeVisible();
        await vsCodePage.waitForTimeout(250);
        expect(await viewport.getAttribute("style")).toBe(viewportStyle);
    });

    test("Test Keyboard Tooltips and Collapse", async () => {
        const rootNode = iframe.locator('[role="treeitem"]').first();
        await rootNode.focus();
        await rootNode.press("Enter");
        await expect(iframe.locator('[role="dialog"]')).toBeVisible();
        await rootNode.press("Escape");
        await expect(iframe.locator('[role="dialog"]')).toBeHidden();

        const collapseButton = rootNode.getByRole("button");
        await collapseButton.focus();
        await collapseButton.press("Space");
        await expect(rootNode).toHaveAttribute("aria-expanded", "false");
        await expect(collapseButton).toBeFocused();
        await collapseButton.press("Enter");
        await expect(rootNode).toHaveAttribute("aria-expanded", "true");
        await expect(collapseButton).toBeFocused();

        await rootNode.focus();
        await rootNode.press("ArrowLeft");
        await expect(rootNode).toHaveAttribute("aria-expanded", "false");
        await expect(rootNode).toBeFocused();

        await rootNode.press("ArrowRight");
        await expect(rootNode).toHaveAttribute("aria-expanded", "true");
        await expect(rootNode).toBeFocused();

        await rootNode.press("ArrowRight");
        const firstChildNode = iframe.locator('[role="treeitem"]').nth(1);
        await expect(firstChildNode).toBeFocused();
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
        const queryText = vsCodePage.getByText("select * from sys.all_views").last();
        await expect(queryText).toBeVisible();
        const ensureSqlFileOpened = vsCodePage.locator('[aria-label^="Execute Query"]');
        await expect(ensureSqlFileOpened).toBeVisible();
    });

    test("Test Zooming In to the Query Plan Graph", async () => {
        // Click Zoom In Button
        const zoomInButtonLocator = iframe.locator(
            '[type="button"][aria-label="Zoom In"][class*="fui-Button"]',
        );
        await zoomInButtonLocator.click();

        const newZoom = await getSettledZoom(iframe);
        await expect(newZoom).toBeGreaterThan(currentZoom);
    });

    test("Test Zooming Out from the Query Plan Graph", async () => {
        // Click Zoom Out Button
        const zoomOutButtonLocator = iframe.locator(
            '[type="button"][aria-label="Zoom Out"][class*="fui-Button"]',
        );
        await zoomOutButtonLocator.click();

        const newZoom = await getSettledZoom(iframe);
        await expect(newZoom).toBeLessThan(currentZoom);
    });

    test("Test Mouse Wheel Scroll Does Not Zoom the Query Plan Graph", async () => {
        const graphCanvas = iframe.locator(".execution-plan-flow-canvas");
        await graphCanvas.hover();
        await vsCodePage.mouse.wheel(0, 500);

        await expect.poll(() => getZoom(iframe)).toBeCloseTo(currentZoom, 4);
    });

    test("Test Zooming to Fit for Query Plan Graph", async () => {
        // Click Zoom to Fit Button
        const zoomToFitButtonLocator = iframe.locator(
            '[type="button"][aria-label="Zoom to Fit"][class*="fui-Button"]',
        );
        await zoomToFitButtonLocator.click();

        const newZoom = await getSettledZoom(iframe);
        await expect(newZoom).toBeGreaterThan(0);
        await expect(newZoom).toBeLessThanOrEqual(200);
    });

    test("Test Custom Zooming for the Query Plan Graph", async () => {
        // Click Custom Zoom Button
        const customZoomButtonLocator = iframe.locator(
            '[type="button"][aria-label="Custom Zoom"][class*="fui-Button"]',
        );
        await customZoomButtonLocator.click();

        const customZoomInput = iframe.locator("#customZoomInputBox");
        await expect(customZoomInput).toBeVisible();

        await customZoomInput.fill((currentZoom - 5).toString());
        const customZoomContainer = iframe.locator("#customZoomInputContainer");
        const customZoomApplyButton = customZoomContainer.getByRole("button", {
            name: "Apply",
        });
        await customZoomApplyButton.click();

        const newZoom = await getSettledZoom(iframe);
        await expect(newZoom).toBeLessThan(currentZoom);

        await customZoomButtonLocator.click();
        await expect(customZoomInput).toBeVisible();
        const customZoomCloseButton = customZoomContainer.getByRole("button", {
            name: "Close",
        });
        await customZoomCloseButton.click();
        await expect(customZoomInput).toBeHidden();
    });

    test("Test Find Node", async () => {
        // Click Find Node Button
        const findNodeButtonLocator = iframe.locator(
            '[type="button"][aria-label="Find Node"][class*="fui-Button"]',
        );
        await findNodeButtonLocator.click();

        const findNodeContainer = iframe.locator("#findNodeInputContainer");
        const findNodeComboBox = iframe.locator("#findNodeDropdown");
        await findNodeComboBox.click();
        const findNodeSearchBox = iframe.getByRole("searchbox").last();
        await findNodeSearchBox.fill("Node ID");
        await findNodeSearchBox.press("Enter");

        const findNodeComparisonDropdown = iframe.locator("#findNodeComparisonDropdown");
        await findNodeComparisonDropdown.click();
        await iframe.getByRole("option", { name: "<", exact: true }).click();

        const findNodeInputBox = iframe.locator("#findNodeInputBox");
        await findNodeInputBox.fill("5");

        const findNodeDownButtonLocator = iframe.locator(
            '[type="button"][aria-label="Next"][class*="fui-Button"]',
        );
        await findNodeDownButtonLocator.click();
        await findNodeDownButtonLocator.click();
        const selectedNode = queryPlanMXGraph.locator(".execution-plan-flow-node.selected");
        await expect(selectedNode).toContainText("Compute Scalar");

        const findNodeUpButtonLocator = iframe.locator(
            '[type="button"][aria-label="Previous"][class*="fui-Button"]',
        );
        await findNodeUpButtonLocator.click();
        await expect(selectedNode).toContainText("Nested Loops");
        await findNodeUpButtonLocator.click();
        await expect(selectedNode).toContainText("Index Scan");

        await findNodeContainer.getByRole("button", { name: "Close" }).click();

        await expect(findNodeInputBox).toBeHidden();
    });

    test("Test the Query Plan Properties Panel", async () => {
        // Select a plan operator so the panel shows operator properties even when
        // this test is retried independently with the statement root selected.
        const nestedLoopsNode = iframe.getByRole("treeitem", { name: /Nested Loops/ }).first();
        await nestedLoopsNode.focus();
        await expect(nestedLoopsNode).toHaveAttribute("aria-selected", "true");

        // Click Properties Button
        const propertiesButtonLocator = iframe.locator(
            '[type="button"][aria-label="Properties"][class*="fui-Button"]',
        );
        await propertiesButtonLocator.click();

        const propertiesPanel = iframe.locator("#propertiesPanelContainer");

        // Sort Alphabetical
        const alphabeticalButton = iframe.locator(
            '[type="button"][aria-label="Alphabetical"][class*="fui-Button"]',
        );
        await alphabeticalButton.click();
        let firstCellLocator = propertiesPanel.locator('[role="gridcell"]').first();
        const alphabeticalFirst = ((await firstCellLocator.textContent()) ?? "").trim();
        await expect(alphabeticalFirst.length).toBeGreaterThan(0);

        // Sort Reverse Alphabetical
        const reverseAlphabeticalButton = iframe.locator(
            '[type="button"][aria-label="Reverse Alphabetical"][class*="fui-Button"]',
        );
        await reverseAlphabeticalButton.click();
        firstCellLocator = propertiesPanel.locator('[role="gridcell"]').first();
        const reverseAlphabeticalFirst = ((await firstCellLocator.textContent()) ?? "").trim();
        await expect(reverseAlphabeticalFirst.length).toBeGreaterThan(0);
        await expect(reverseAlphabeticalFirst).not.toBe(alphabeticalFirst);

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
        await importanceButton.press("ArrowRight");
        await expect(alphabeticalButton).toBeFocused();
        await expect(
            propertiesPanel.getByText("Physical Operation", { exact: true }).first(),
        ).toBeVisible();

        const propertiesTreeGrid = propertiesPanel.getByRole("treegrid");
        const propertyRows = propertiesTreeGrid.locator('[role="row"][data-property-id]');
        const firstPropertyRow = propertyRows.first();
        const secondPropertyRow = propertyRows.nth(1);
        await firstPropertyRow.focus();
        await firstPropertyRow.press("ArrowDown");
        await expect(secondPropertyRow).toBeFocused();
        await secondPropertyRow.press("ArrowUp");
        await expect(firstPropertyRow).toBeFocused();

        const firstExpandableRowByButton = propertiesTreeGrid
            .getByRole("button", { name: "Expand", exact: true })
            .first()
            .locator('xpath=ancestor::*[@role="row"]');
        const expandablePropertyId =
            await firstExpandableRowByButton.getAttribute("data-property-id");
        const firstExpandableRow = propertiesTreeGrid.locator(
            `[role="row"][data-property-id="${expandablePropertyId}"]`,
        );
        await firstExpandableRow.focus();
        await firstExpandableRow.press("ArrowRight");
        await expect(firstExpandableRow).toHaveAttribute("aria-expanded", "true");
        await expect(firstExpandableRow).toBeFocused();

        await firstExpandableRow.press("ArrowRight");
        const focusedChildRow = propertiesTreeGrid.locator('[role="row"]:focus');
        await expect(focusedChildRow).toHaveAttribute("aria-level", "2");
        await focusedChildRow.press("ArrowLeft");
        await expect(firstExpandableRow).toBeFocused();
        await firstExpandableRow.press("ArrowLeft");
        await expect(firstExpandableRow).toHaveAttribute("aria-expanded", "false");

        const searchProperties = iframe.locator(
            '[placeholder="Filter for any field..."][class*="fui-Input__input"]',
        );
        await searchProperties.fill("Physical");
        await expect(
            propertiesPanel.getByText("Physical Operation", { exact: true }).first(),
        ).toBeVisible();

        await propertiesPanel.getByRole("button", { name: "Close" }).click();

        await expect(alphabeticalButton).toBeHidden();
    });

    test("Test Query Plan Highlight Expensive Metric", async () => {
        // Click HighlightOps Button
        const highlightOpsButtonLocator = iframe.locator(
            '[type="button"][aria-label="Highlight Expensive Operation"][class*="fui-Button"]',
        );
        await highlightOpsButtonLocator.click();

        const highlightOpsComponent = iframe.locator("#highlightExpensiveOpsContainer");

        const highlightOpsInputBox = iframe.locator("#highlightExpensiveOpsDropdown");
        const highlightOpsApplyButton = highlightOpsComponent.getByRole("button", {
            name: "Apply",
        });
        const highlightedNode = queryPlanMXGraph.locator(".execution-plan-flow-node.highlighted");
        const selectMetric = async (metric: string) => {
            await highlightOpsInputBox.click();
            const searchBox = iframe.getByRole("searchbox").last();
            await searchBox.fill(metric);
            await searchBox.press("Enter");
        };

        await selectMetric("Actual Elapsed Time");
        await highlightOpsApplyButton.click();
        await expect(highlightedNode).toHaveCount(0);

        await selectMetric("Actual Elapsed CPU Time");
        await highlightOpsApplyButton.click();
        await expect(highlightedNode).toHaveCount(0);

        await selectMetric("Cost");
        await highlightOpsApplyButton.click();
        await expect(highlightedNode).toHaveCount(1);

        await selectMetric("Subtree Cost");
        await highlightOpsApplyButton.click();
        await expect(highlightedNode).toHaveCount(1);

        await selectMetric("Actual Number of Rows For All Executions");
        await highlightOpsApplyButton.click();
        await expect(highlightedNode).toHaveCount(1);

        await selectMetric("Number of Rows Read");
        await highlightOpsApplyButton.click();
        await expect(highlightedNode).toHaveCount(1);

        await selectMetric("Off");
        await highlightOpsApplyButton.click();
        await expect(highlightedNode).toHaveCount(0);

        await highlightOpsComponent.getByRole("button", { name: "Close" }).click();

        await expect(highlightOpsInputBox).toBeHidden();
    });
});

export async function refocusQueryPlanTab(page: Page) {
    const queryPlanTab = page.locator('div[role="tab"][aria-label="plan.sqlplan"]');
    await queryPlanTab.focus();
    await page.keyboard.press("Enter");
}

export async function getZoom(iframe: FrameLocator) {
    const reactFlowViewport = iframe.locator(".react-flow__viewport").first();
    if ((await reactFlowViewport.count()) > 0) {
        const style = (await reactFlowViewport.getAttribute("style")) ?? "";
        const scaleMatch = style.match(/scale\(([^)]+)\)/);
        return scaleMatch?.[1] ? parseFloat(scaleMatch[1]) * 100 : 100;
    }

    const zoomElement = await iframe.locator('[transform*="scale"]').first();
    if (zoomElement) {
        // Try to extract the scale value using a regular expression
        try {
            const scaleMatch = (await zoomElement.getAttribute("transform")).match(
                /scale\(([^)]+)\)/,
            );

            if (scaleMatch && scaleMatch[1]) {
                // Multiply by 100 to get the zoom percentage
                return parseFloat(scaleMatch[1]) * 100;
            }
        } catch {
            // If the scale value doesn not exist, then the zoom is 100
            return 100;
        }
    }
}

export async function getSettledZoom(iframe: FrameLocator) {
    let previousZoom = await getZoom(iframe);
    let stableSamples = 0;

    await expect
        .poll(
            async () => {
                const currentZoom = await getZoom(iframe);
                stableSamples =
                    currentZoom !== undefined &&
                    previousZoom !== undefined &&
                    Math.abs(currentZoom - previousZoom) < 0.01
                        ? stableSamples + 1
                        : 0;
                previousZoom = currentZoom;
                return stableSamples;
            },
            { intervals: [50], timeout: 2_000 },
        )
        .toBeGreaterThanOrEqual(2);

    return previousZoom;
}
