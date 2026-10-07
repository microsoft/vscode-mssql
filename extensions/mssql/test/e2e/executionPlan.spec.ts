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
    runCommandFromPalette,
    waitForCommandPaletteToBeVisible,
    withClipboardLock,
} from "./utils/testHelpers";
import { writeCoverage } from "./utils/coverageHelpers";
import path from "path";
import { QuickInput } from "./pageObjects/quickInput";

test.describe("MSSQL Extension - Query Plan", async () => {
    let vsCodePage: Page;
    let iframe: FrameLocator;
    let queryPlanContainer: Locator;
    let currentZoom = 100;

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: {
            initialConfig: {
                "mssql.showChangelogOnUpdate": false,
            },
        },
        afterLaunch: async ({ page }) => {
            vsCodePage = page;
            // Query plan entry point
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
            queryPlanContainer = iframe.locator("#queryPlanParent1");
            await expect(queryPlanContainer).toBeVisible();
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
        await expect(
            iframe.getByRole("tree", { name: /Execution plan 1, use arrow keys/ }),
        ).toBeVisible();
        await expect(iframe.getByRole("status")).toHaveAttribute("aria-live", "polite");
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

        await rootNode.focus();
        await rootNode.press("ArrowRight");
        await expect(rootNode).toHaveAttribute("aria-expanded", "false");
        await expect(rootNode).toBeFocused();

        await collapseButton.focus();
        await collapseButton.press("Enter");
        await expect(rootNode).toHaveAttribute("aria-expanded", "true");
        await expect(collapseButton).toBeFocused();

        await rootNode.focus();
        await rootNode.press("ArrowLeft");
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
        const selectedNode = queryPlanContainer.locator(".execution-plan-flow-node.selected");
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

        // View the full value of a property
        const physicalOperationRow = propertyRows.filter({ hasText: "Physical Operation" }).first();
        await physicalOperationRow.hover();
        await physicalOperationRow
            .getByRole("button", { name: "View full value of Physical Operation" })
            .click();
        const fullValueDialog = iframe.getByRole("dialog", { name: "Physical Operation" });
        await expect(fullValueDialog).toBeVisible();
        // The dialog loads Monaco on first open. The chunk is large (and instrumented for
        // coverage in CI), so the editor can take well over the default timeout to appear.
        await expect(fullValueDialog.locator(".view-lines")).toContainText("Nested Loops", {
            timeout: 30 * 1000,
        });
        await fullValueDialog.getByRole("button", { name: "Close" }).click();
        await expect(fullValueDialog).toBeHidden();

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
        const highlightedNode = queryPlanContainer.locator(".execution-plan-flow-node.highlighted");
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
    test("Test Comparison Selection, Full Property Values, and Wheel Scrolling", async () => {
        await expect(queryPlanContainer.getByRole("treeitem").first()).toBeVisible();
        await iframe.getByRole("button", { name: "Compare Execution Plan", exact: true }).click();
        const comparison = await getWebviewByTitle(vsCodePage, "Compare Execution Plans 1");
        const primary = comparison.getByRole("region", { name: "Primary plan", exact: true });
        await expect(
            primary.getByRole("tree", { name: /Execution plan 1, use arrow keys/ }),
        ).toBeVisible();
        await expect(primary.locator(".execution-plan-flow-arrow").first()).toBeVisible();
        await expect(
            primary.getByText("select * from sys.all_views", { exact: true }),
        ).toBeVisible();

        await comparison
            .getByRole("toolbar", { name: "Compare Execution Plans" })
            .getByRole("button", { name: "Add execution plan", exact: true })
            .click();
        const quickInput = new QuickInput(vsCodePage);
        await quickInput.filter("plan.sqlplan");
        await quickInput.pick("plan.sqlplan");
        const secondary = comparison.getByRole("region", { name: "Added plan", exact: true });
        await expect(secondary.getByRole("treeitem").first()).toBeVisible();
        await expect(comparison.locator(".execution-plan-comparison-loading")).toBeHidden();
        const similarAreas = comparison.locator(".execution-plan-comparison-group");
        await expect(similarAreas.first()).toBeVisible();
        const similarAreasToggle = comparison
            .getByRole("toolbar", { name: "Compare Execution Plans" })
            .getByRole("button", { name: "Toggle Similar Areas", exact: true });
        await similarAreasToggle.click();
        await expect(similarAreas).toHaveCount(0);
        await similarAreasToggle.click();
        await expect(similarAreas.first()).toBeVisible();

        await comparison.getByRole("button", { name: "Properties", exact: true }).click();
        const properties = comparison.locator(".execution-plan-comparison-properties");
        // Each column header shows its name as a tooltip anywhere over the header, not only
        // over its label text.
        for (const header of ["Name", "Value (Top Plan)", "Comparison", "Value (Bottom Plan)"]) {
            await expect(
                properties.getByRole("columnheader", { name: header, exact: true }),
            ).toHaveAttribute("title", header);
        }
        // The resize handle announces its whole range: from the smallest width to the largest.
        const resizer = properties.getByRole("separator");
        const [minimum, current, maximum] = await Promise.all(
            ["aria-valuemin", "aria-valuenow", "aria-valuemax"].map(async (name) =>
                Number(await resizer.getAttribute(name)),
            ),
        );
        expect(minimum).toBeLessThanOrEqual(current);
        expect(current).toBeLessThanOrEqual(maximum);
        await properties
            .getByRole("textbox", { name: "Filter comparison properties..." })
            .fill("Physical Operation");
        const physicalRow = properties.getByRole("row").filter({ hasText: "Physical Operation" });
        const equivalent = properties.getByRole("button", { name: /Equivalent Properties/ });

        // Pan the added plan's operators out of view, to see the match brought back. The drag
        // starts left of the minimap and ends inside the canvas, so React Flow sees its release.
        const secondaryCanvas = (await secondary
            .locator(".execution-plan-flow-canvas")
            .boundingBox())!;
        const dragY = secondaryCanvas.y + secondaryCanvas.height * 0.6;
        await vsCodePage.mouse.move(secondaryCanvas.x + secondaryCanvas.width * 0.6, dragY);
        await vsCodePage.mouse.down();
        await vsCodePage.mouse.move(secondaryCanvas.x + 5, dragY, { steps: 10 });
        await vsCodePage.mouse.up();
        await expect
            .poll(() =>
                isWithin(
                    secondary,
                    secondary.locator(".execution-plan-flow-node", { hasText: "Nested Loops" }),
                ),
            )
            .toBe(false);

        const nestedLoops = primary.getByRole("treeitem", { name: /Nested Loops/ }).first();
        await nestedLoops.focus();
        await expect(nestedLoops).toBeFocused();
        await expect(secondary.locator('[role="treeitem"][aria-selected="true"]')).toContainText(
            "Nested Loops",
        );
        // The match is outlined and centered in the added plan, while focus stays here.
        const linkedMatch = secondary.locator(".execution-plan-flow-node.linked");
        await expect(linkedMatch).toContainText("Nested Loops");
        await expect.poll(() => isWithin(secondary, linkedMatch)).toBe(true);
        // Panels over the canvas, such as the minimap, do not count as showing the match.
        await expect
            .poll(async () => {
                const match = await linkedMatch.boundingBox();
                const minimap = await secondary.locator(".react-flow__minimap").boundingBox();
                return (
                    !!match &&
                    !!minimap &&
                    (match.x + match.width <= minimap.x ||
                        minimap.x + minimap.width <= match.x ||
                        match.y + match.height <= minimap.y ||
                        minimap.y + minimap.height <= match.y)
                );
            })
            .toBe(true);
        await expect(nestedLoops).toBeFocused();
        await equivalent.click();
        await expect(physicalRow).toContainText("Nested Loops");

        // Each side opens its own exact value in the shared read-only SQL editor.
        for (const side of ["primary", "secondary"]) {
            await physicalRow.hover();
            const valueButton = physicalRow
                .locator(`[data-side="${side}"]`)
                .getByRole("button", { name: "View full value of Physical Operation" });
            await valueButton.click();
            const dialog = comparison.getByRole("dialog", { name: "Physical Operation" });
            await expect(dialog.locator(".view-lines")).toContainText("Nested Loops", {
                timeout: 30 * 1000,
            });
            await dialog.getByRole("button", { name: "Close", exact: true }).click();
            await expect(dialog).toBeHidden();
            await expect(valueButton).toBeFocused();
        }

        // Find selects through the graph controller, rather than through a node click.
        await comparison.getByRole("button", { name: "Find in primary plan", exact: true }).click();
        const find = primary.locator("#findNodeInputContainer");
        await find.locator("#findNodeDropdown").click();
        const propertySearch = comparison.getByRole("searchbox").last();
        await propertySearch.fill("Node ID");
        await propertySearch.press("Enter");
        await find.locator("#findNodeComparisonDropdown").click();
        await comparison.getByRole("option", { name: "Equals", exact: true }).click();
        await find.locator("#findNodeInputBox").fill("2");
        await find.getByRole("button", { name: "Next", exact: true }).click();
        const selectedPrimary = primary.locator('[role="treeitem"][aria-selected="true"]');
        await expect(selectedPrimary).toContainText("Hash Match");
        await expect(selectedPrimary).toBeFocused();
        await expect(secondary.locator('[role="treeitem"][aria-selected="true"]')).toContainText(
            "Hash Match",
        );
        await expect(equivalent).toHaveAttribute("aria-expanded", "false");
        await equivalent.click();
        await expect(physicalRow).toContainText("Hash Match");
        await find.getByRole("button", { name: "Close", exact: true }).click();

        // The panel docks below the plans and back beside them.
        await properties.getByRole("button", { name: "Dock to the bottom", exact: true }).click();
        await expect(properties).toHaveClass(/execution-plan-comparison-properties-bottom/);
        await properties.getByRole("button", { name: "Dock to the side", exact: true }).click();
        await expect(properties).toHaveClass(/execution-plan-comparison-properties-side/);
        await properties.getByRole("button", { name: "Close", exact: true }).click();
        const initialZoom = await getZoom(comparison);
        await primary.locator(".execution-plan-flow-canvas").hover();
        await vsCodePage.mouse.wheel(0, 500);
        await expect.poll(() => getZoom(comparison)).toBeCloseTo(initialZoom!, 4);

        // Each plan zooms with the controls on its own canvas, leaving the other plan as it is.
        const paneZoom = async (pane: Locator) => {
            const style = (await pane.locator(".react-flow__viewport").getAttribute("style")) ?? "";
            return parseFloat(style.match(/scale\(([^)]+)\)/)?.[1] ?? "1");
        };
        const [primaryZoom, secondaryZoom] = [await paneZoom(primary), await paneZoom(secondary)];
        await primary.getByRole("button", { name: "Zoom In", exact: true }).click();
        await expect.poll(() => paneZoom(primary)).toBeGreaterThan(primaryZoom);
        expect(await paneZoom(secondary)).toBe(secondaryZoom);
        await secondary.getByRole("button", { name: "Zoom Out", exact: true }).click();
        await expect.poll(() => paneZoom(secondary)).toBeLessThan(secondaryZoom);

        // Synced, zooming one plan zooms the other to match. Sync is saved, so turn it off again.
        const syncToggle = comparison
            .getByRole("toolbar", { name: "Compare Execution Plans" })
            .getByRole("button", { name: "Sync Zoom and Scroll", exact: true });
        await expect(syncToggle).toHaveAttribute("aria-pressed", "false");
        await syncToggle.click();
        await primary.getByRole("button", { name: "Zoom In", exact: true }).click();
        await expect
            .poll(async () => (await paneZoom(secondary)) - (await paneZoom(primary)))
            .toBeCloseTo(0, 4);
        await syncToggle.click();
        await expect(syncToggle).toHaveAttribute("aria-pressed", "false");

        // The query line copies its query.
        await withClipboardLock(async () => {
            await primary.getByRole("button", { name: "Copy Query", exact: true }).click();
            await expect(
                primary.getByRole("button", { name: "Copy Query", exact: true }),
            ).toHaveAttribute("title", "Copied");
        });

        // Both plans show a minimap and tooltips until the user turns them off, and later
        // comparisons keep that.
        const toolbarToggle = (frame: FrameLocator, name: string) =>
            frame
                .getByRole("toolbar", { name: "Compare Execution Plans" })
                .getByRole("button", { name, exact: true });
        const minimapToggle = (frame: FrameLocator) => toolbarToggle(frame, "Toggle Minimap");
        const tooltipsToggle = (frame: FrameLocator) => toolbarToggle(frame, "Toggle Tooltips");
        await expect(comparison.locator(".react-flow__minimap")).toHaveCount(2);
        await minimapToggle(comparison).click();
        await expect(comparison.locator(".react-flow__minimap")).toHaveCount(0);
        await expect(tooltipsToggle(comparison)).toHaveAttribute("aria-pressed", "true");
        await tooltipsToggle(comparison).click();
        await expect(tooltipsToggle(comparison)).toHaveAttribute("aria-pressed", "false");
        await writeCoverage(comparison, "executionPlanComparison");
        await vsCodePage.keyboard.press(`${getModifierKey()}+W`);

        await refocusQueryPlanTab(vsCodePage);
        await iframe.getByRole("button", { name: "Compare Execution Plan", exact: true }).click();
        const activeTab = vsCodePage.locator('div[role="tab"].active');
        await expect(activeTab).toHaveAttribute("aria-label", /^Compare Execution Plans \d+$/);
        const reopened = await getWebviewByTitle(
            vsCodePage,
            (await activeTab.getAttribute("aria-label"))!,
        );
        await expect(reopened.getByRole("region", { name: "Primary plan" })).toBeVisible();
        await expect(reopened.locator(".react-flow__minimap")).toHaveCount(0);
        await expect(tooltipsToggle(reopened)).toHaveAttribute("aria-pressed", "false");
        // Turn them on again, so the comparisons that follow start from the defaults.
        await minimapToggle(reopened).click();
        await expect(reopened.locator(".react-flow__minimap")).toHaveCount(1);
        await tooltipsToggle(reopened).click();
        await expect(tooltipsToggle(reopened)).toHaveAttribute("aria-pressed", "true");
        await vsCodePage.keyboard.press(`${getModifierKey()}+W`);
    });

    test("Test Comparing Plans Added to a Blank Comparison", async () => {
        await runCommandFromPalette(
            vsCodePage,
            "Compare Execution Plans",
            "MS SQL: Compare Execution Plans",
        );
        // Each comparison editor is numbered, so take the title of the one just opened.
        const activeTab = vsCodePage.locator('div[role="tab"].active');
        await expect(activeTab).toHaveAttribute("aria-label", /^Compare Execution Plans \d+$/);
        const comparison = await getWebviewByTitle(
            vsCodePage,
            (await activeTab.getAttribute("aria-label"))!,
        );
        const placeholders = comparison.locator(".execution-plan-comparison-placeholder");
        await expect(placeholders).toHaveCount(2);

        const quickInput = new QuickInput(vsCodePage);
        await placeholders
            .first()
            .getByRole("button", { name: "Add execution plan", exact: true })
            .click();
        await quickInput.filter("plan.sqlplan");
        await quickInput.pick("plan.sqlplan");
        const primary = comparison.getByRole("region", { name: "Primary plan", exact: true });
        await expect(primary.getByRole("treeitem").first()).toBeVisible();
        await expect(placeholders).toHaveCount(1);

        // With the primary pane full, the toolbar fills the secondary one.
        const toolbar = comparison.getByRole("toolbar", { name: "Compare Execution Plans" });
        await toolbar.getByRole("button", { name: "Add execution plan", exact: true }).click();
        await quickInput.filter("plan.sqlplan");
        await quickInput.pick("plan.sqlplan");
        const secondary = comparison.getByRole("region", { name: "Added plan", exact: true });
        await expect(secondary.getByRole("treeitem").first()).toBeVisible();
        await expect(placeholders).toHaveCount(0);
        await expect(comparison.locator(".execution-plan-comparison-group").first()).toBeVisible();
        // With both panes full, the toolbar asks which plan to replace, and the picker names it.
        await toolbar.getByRole("button", { name: "Replace execution plan", exact: true }).click();
        await expect(comparison.getByRole("menuitem", { name: /Replace top plan/ })).toContainText(
            "plan.sqlplan",
        );
        await comparison.getByRole("menuitem", { name: /Replace bottom plan/ }).click();
        await expect(vsCodePage.locator(".quick-input-widget input")).toHaveAttribute(
            "placeholder",
            "Select an execution plan to replace plan.sqlplan",
        );
        await quickInput.filter("plan.sqlplan");
        await quickInput.pick("plan.sqlplan");
        await expect(secondary.getByRole("treeitem").first()).toBeVisible();
        await vsCodePage.keyboard.press(`${getModifierKey()}+W`);
    });
});

/** Whether an operator lies inside the visible canvas of a plan pane. */
async function isWithin(pane: Locator, node: Locator): Promise<boolean> {
    // React Flow leaves operators out of view unrendered.
    if ((await node.count()) === 0) {
        return false;
    }
    const canvas = await pane.locator(".execution-plan-flow-canvas").boundingBox();
    const box = await node.first().boundingBox();
    return (
        !!canvas &&
        !!box &&
        box.x >= canvas.x &&
        box.y >= canvas.y &&
        box.x + box.width <= canvas.x + canvas.width &&
        box.y + box.height <= canvas.y + canvas.height
    );
}

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
