/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator, Locator } from "@playwright/test";
import { test, expect } from "../baseFixtures";
import { useSharedVsCodeLifecycle } from "../utils/testLifecycle";
import {
    executeQueryAndWait,
    openNewQueryEditor,
    setQueryText,
    waitForResultGrid,
} from "../utils/testHelpers";
import { GRID_KEYS, getGridLaunchConfig } from "./gridLaunchConfig";
import {
    clickMenuItem,
    getCell,
    getColumnHeader,
    openHeaderContextMenu,
    stageQuery,
} from "./gridActions";
import {
    ABOVE_THRESHOLD_QUERY,
    getManyResultsQuery,
    LARGE_QUERY,
    MULTI_RESULT_QUERY,
} from "./gridFixtures";

test.describe("MSSQL Extension - Preview Grid Layout", () => {
    let resultsFrame: FrameLocator;
    let firstGrid: Locator;

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: { initialConfig: getGridLaunchConfig() },
        afterLaunch: async ({ electronApp, page }) => {
            const staged = await stageQuery(electronApp, page, MULTI_RESULT_QUERY);
            resultsFrame = staged.resultsFrame;
            firstGrid = staged.grid;
        },
    });

    test("renders three result sets and restores them after maximizing one", async () => {
        // The preview grid deliberately lazy-mounts offscreen result sets.
        await resultsFrame.locator('[id="0_2"]').scrollIntoViewIfNeeded();
        const secondGrid = await waitForResultGrid(resultsFrame, "0_1", 1);
        const thirdGrid = await waitForResultGrid(resultsFrame, "0_2", 1);
        await expect(getCell(firstGrid, 0, 0)).toHaveText("1");
        await expect(getCell(secondGrid, 0, 0)).toHaveText("2");
        await expect(getCell(thirdGrid, 0, 0)).toHaveText("4");

        const { page } = getContext();
        await getCell(firstGrid, 0, 0).click();
        await page.keyboard.press(GRID_KEYS.maximizeGrid);
        await expect(firstGrid).toBeVisible();
        await expect(secondGrid).toHaveCount(0);
        await expect(thirdGrid).toHaveCount(0);

        const tabs = resultsFrame.getByTestId("results-tab-list");
        await tabs.getByRole("tab", { name: "Messages" }).click();
        await tabs.getByRole("tab", { name: /Results Preview/ }).click();
        await expect(firstGrid).toBeVisible();
        await expect(secondGrid).toHaveCount(0);
        await expect(thirdGrid).toHaveCount(0);

        await getCell(firstGrid, 0, 0).click();
        await page.keyboard.press(GRID_KEYS.maximizeGrid);
        await expect(secondGrid).toBeVisible();
        await expect(thirdGrid).toBeVisible();
    });

    test("Ctrl+Down and Ctrl+Up move focus between result grids", async () => {
        const { page } = getContext();
        await resultsFrame.locator('[id="0_2"]').scrollIntoViewIfNeeded();
        const secondGrid = await waitForResultGrid(resultsFrame, "0_1", 1);
        const thirdGrid = await waitForResultGrid(resultsFrame, "0_2", 1);
        const isFocusedWithin = (target: Locator) =>
            target.evaluate((element) => element.contains(element.ownerDocument.activeElement));

        await getCell(firstGrid, 0, 0).click();
        await page.keyboard.press("Control+ArrowDown");
        await expect.poll(() => isFocusedWithin(secondGrid)).toBe(true);
        await page.keyboard.press("Control+ArrowDown");
        await expect.poll(() => isFocusedWithin(thirdGrid)).toBe(true);
        await page.keyboard.press("Control+ArrowUp");
        await expect.poll(() => isFocusedWithin(secondGrid)).toBe(true);
    });

    test("resizing one result set does not resize its siblings", async () => {
        const secondGrid = await waitForResultGrid(resultsFrame, "0_1", 1);
        await resultsFrame.locator('[id="0_2"]').scrollIntoViewIfNeeded();
        const thirdGrid = await waitForResultGrid(resultsFrame, "0_2", 1);
        const columnWidth = async (target: Locator, column: string) =>
            (await getColumnHeader(target, column).boundingBox())!.width;
        const secondWidth = await columnWidth(secondGrid, "b");
        const thirdWidth = await columnWidth(thirdGrid, "d");
        await firstGrid.scrollIntoViewIfNeeded();
        const firstWidth = await columnWidth(firstGrid, "a");

        async function resizeFirstColumn(width: number): Promise<void> {
            await openHeaderContextMenu(firstGrid, "a");
            await clickMenuItem(resultsFrame, "Resize");
            const dialog = resultsFrame.getByRole("dialog").filter({ hasText: "Resize" }).first();
            await dialog.locator('input[type="number"]').fill(String(width));
            await dialog.getByRole("button", { name: "Resize" }).last().click();
            await expect(dialog).toBeHidden();
        }

        await resizeFirstColumn(Math.round(firstWidth + 30));
        try {
            await expect.poll(() => columnWidth(firstGrid, "a")).toBeGreaterThan(firstWidth + 20);
            await resultsFrame.locator('[id="0_2"]').scrollIntoViewIfNeeded();
            expect(Math.abs((await columnWidth(secondGrid, "b")) - secondWidth)).toBeLessThan(2);
            expect(Math.abs((await columnWidth(thirdGrid, "d")) - thirdWidth)).toBeLessThan(2);
        } finally {
            await firstGrid.scrollIntoViewIfNeeded();
            await resizeFirstColumn(Math.round(firstWidth));
        }
    });

    test("renders results in batch order with heights based on row counts", async () => {
        const { electronApp, page } = getContext();
        await setQueryText(
            electronApp,
            page,
            `SELECT 1 AS first_result;
             SELECT 2 AS second_result UNION ALL SELECT 3 UNION ALL SELECT 4;
             GO
             SELECT TOP (20) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS third_result
             FROM sys.all_objects;`,
        );
        await executeQueryAndWait(page);
        try {
            const containers = ["0_0", "0_1", "1_0"].map((id) =>
                resultsFrame.locator(`[id="${id}"]`),
            );
            await expect(containers[2]).toBeVisible();
            await expect
                .poll(async () =>
                    resultsFrame
                        .locator('[id="0_0"], [id="0_1"], [id="1_0"]')
                        .evaluateAll((elements) => elements.map((element) => element.id)),
                )
                .toEqual(["0_0", "0_1", "1_0"]);

            for (const [index, id, rowCount] of [
                [0, "1", 1],
                [1, "2", 3],
                [2, "1", 20],
            ] as const) {
                await containers[index].scrollIntoViewIfNeeded();
                const result = await waitForResultGrid(
                    resultsFrame,
                    ["0_0", "0_1", "1_0"][index],
                    rowCount,
                );
                await expect(getCell(result, 0, 0)).toHaveText(id);
            }
            const heights = await Promise.all(
                containers.map(async (container) => (await container.boundingBox())!.height),
            );
            expect(heights[1]).toBeGreaterThan(heights[0]);
            expect(heights[2]).toBeGreaterThan(heights[1]);
        } finally {
            await setQueryText(electronApp, page, MULTI_RESULT_QUERY);
            await executeQueryAndWait(page);
            firstGrid = await waitForResultGrid(resultsFrame, "0_0", 1);
        }
    });

    test("switches to text results and back without rerunning the query", async () => {
        const { page } = getContext();
        await getCell(firstGrid, 0, 0).click();
        await page.keyboard.press(GRID_KEYS.switchToTextView);
        await expect(firstGrid).toHaveCount(0);
        await expect(resultsFrame.locator(".monaco-editor").first()).toBeVisible();
        await expect(resultsFrame.getByTestId("summary-footer")).toHaveCount(0);

        await page.keyboard.press(GRID_KEYS.switchToTextView);
        await expect(firstGrid).toHaveAttribute("data-row-count", "1");
        await expect(getCell(firstGrid, 0, 0)).toHaveText("1");
    });

    test("keeps a result above the processing threshold virtualized", async () => {
        const { electronApp, page } = getContext();
        await setQueryText(electronApp, page, ABOVE_THRESHOLD_QUERY);
        await executeQueryAndWait(page);
        const largeGrid = await waitForResultGrid(resultsFrame, "0_0", 5001);

        await expect(largeGrid).toHaveAttribute("data-row-count", "5001");
        await expect(getCell(largeGrid, 0, 0)).toHaveText("1");
        // SlickGrid renders only its viewport plus a buffer. The grid's own row count establishes
        // that the unrendered rows are still in the result, rather than merely sampling the DOM.
        await expect.poll(() => largeGrid.locator(".slick-row").count()).toBeLessThan(5001);

        await getColumnHeader(largeGrid, "id").locator(".slick-header-sortbutton").click();
        await expect(
            page
                .getByText("Max row count for filtering/sorting has been exceeded.", {
                    exact: false,
                })
                .last(),
        ).toBeVisible();
        await expect(getColumnHeader(largeGrid, "id")).toHaveAttribute(
            "data-sort-direction",
            "none",
        );
        await getColumnHeader(largeGrid, "id").locator(".slick-header-filterbutton").click();
        await expect(resultsFrame.getByRole("dialog", { name: "Filter Options" })).toHaveCount(0);

        await largeGrid.evaluate((element) => {
            for (const viewport of Array.from(element.querySelectorAll(".slick-viewport"))) {
                viewport.scrollTo({ top: viewport.scrollHeight });
            }
        });
        await expect
            .poll(async () => Number(await getCell(largeGrid, 0, 0).innerText()))
            .toBeGreaterThan(1);
    });

    test("keeps only a viewport of a 100k-row result rendered", async () => {
        const { electronApp, page } = getContext();
        await setQueryText(electronApp, page, LARGE_QUERY);
        await executeQueryAndWait(page);
        const largeGrid = await waitForResultGrid(resultsFrame, "0_0", 100000);
        await expect(largeGrid).toHaveAttribute("data-row-count", "100000");
        // SlickGrid's renderRows/getRenderedRange contract bounds live rows to the viewport and
        // its buffer, even when the data view advertises the full result length.
        await expect.poll(() => largeGrid.locator(".slick-row").count()).toBeLessThan(1000);
        await largeGrid.evaluate((element) => {
            for (const viewport of Array.from(element.querySelectorAll(".slick-viewport"))) {
                viewport.scrollTo({ top: viewport.scrollHeight });
            }
        });
        await expect
            .poll(() =>
                largeGrid.locator(".fluent-result-grid-row-number").last().getAttribute("title"),
            )
            .toBe("100000");
    });

    test("defers an offscreen result set and mounts it when scrolled into view", async () => {
        const { electronApp, page } = getContext();
        await setQueryText(electronApp, page, getManyResultsQuery());
        await executeQueryAndWait(page);
        const lastContainer = resultsFrame.locator('[id="0_19"]');
        await expect(lastContainer).toBeAttached();
        await expect(lastContainer.locator('[aria-busy="true"][tabindex="0"]')).toBeAttached();
        await expect(resultsFrame.locator('[data-grid-id="0_19"]')).toHaveCount(0);
        await lastContainer.scrollIntoViewIfNeeded();
        const lastGrid = await waitForResultGrid(resultsFrame, "0_19", 1);
        await expect(getCell(lastGrid, 0, 0)).toHaveText("20");

        const scrollContainer = lastContainer.locator("xpath=..");
        const scrolledTop = await scrollContainer.evaluate((element) => element.scrollTop);
        expect(scrolledTop).toBeGreaterThan(100);
        const tabs = resultsFrame.getByTestId("results-tab-list");
        await tabs.getByRole("tab", { name: "Messages" }).click();
        await tabs.getByRole("tab", { name: /Results Preview/ }).click();
        await expect
            .poll(async () =>
                scrollContainer.evaluate(
                    (element, previousTop) => Math.abs(element.scrollTop - previousTop),
                    scrolledTop,
                ),
            )
            .toBeLessThan(5);
        await openNewQueryEditor(page);
        await page
            .getByRole("tab", { name: /Untitled-1/ })
            .first()
            .click();
        await expect
            .poll(async () =>
                scrollContainer.evaluate(
                    (element, previousTop) => Math.abs(element.scrollTop - previousTop),
                    scrolledTop,
                ),
            )
            .toBeLessThan(5);
    });
});
