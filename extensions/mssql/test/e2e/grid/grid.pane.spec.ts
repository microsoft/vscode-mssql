/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator, Locator } from "@playwright/test";
import { test, expect } from "../baseFixtures";
import { useSharedVsCodeLifecycle } from "../utils/testLifecycle";
import { executeQueryAndWait, setQueryText, waitForResultGrid } from "../utils/testHelpers";
import { getGridLaunchConfig } from "./gridLaunchConfig";
import { clickCell, stageQuery } from "./gridActions";
import { MESSAGES_QUERY, MIXED_TYPES_QUERY, MIXED_TYPES_ROW_COUNT } from "./gridFixtures";

test.describe("MSSQL Extension - Preview Grid Pane", () => {
    let resultsFrame: FrameLocator;
    let grid: Locator;

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: { initialConfig: getGridLaunchConfig() },
        afterLaunch: async ({ electronApp, page }) => {
            const staged = await stageQuery(electronApp, page, MIXED_TYPES_QUERY, {
                minRows: MIXED_TYPES_ROW_COUNT,
            });
            resultsFrame = staged.resultsFrame;
            grid = staged.grid;
        },
    });

    test("shows result count and switches between results and messages", async () => {
        const tabs = resultsFrame.getByTestId("results-tab-list");
        const resultsTab = tabs.getByRole("tab", { name: "Results Preview (1)" });
        const messagesTab = tabs.getByRole("tab", { name: "Messages" });
        await expect(resultsTab).toHaveAttribute("aria-selected", "true");
        await expect(grid).toHaveAttribute("data-row-count", String(MIXED_TYPES_ROW_COUNT));
        await expect(
            resultsFrame.getByTestId("summary-footer").locator('[data-metric="rows"]'),
        ).toContainText(String(MIXED_TYPES_ROW_COUNT));

        await messagesTab.click();
        await expect(messagesTab).toHaveAttribute("aria-selected", "true");
        await resultsTab.click();
        await expect(resultsTab).toHaveAttribute("aria-selected", "true");
        await expect(grid).toBeVisible();
    });

    test("the footer reports count, average and sum for a numeric selection", async () => {
        await clickCell(grid, 0, 3);
        await clickCell(grid, 2, 3, { modifiers: ["Shift"] });
        const selection = resultsFrame
            .getByTestId("summary-footer")
            .locator('[data-metric="selection"]');
        await expect(selection).toContainText("Count: 3");
        await expect(selection).toContainText("Avg: 6.58");
        await expect(selection).toContainText("Sum: 19.75");
        await selection.hover();
        await expect(resultsFrame.getByRole("tooltip")).not.toContainText("Null:");
    });

    test("the footer shows a final execution time", async () => {
        const time = resultsFrame.getByTestId("summary-footer").locator('[data-metric="time"]');
        await expect(time).toContainText(/\d+(?:ms|s)/);
    });

    test("selection details include min, max and null count", async () => {
        await clickCell(grid, 0, 3);
        await clickCell(grid, 4, 3, { modifiers: ["Shift"] });
        const selection = resultsFrame
            .getByTestId("summary-footer")
            .locator('[data-metric="selection"]');
        await expect(selection).toContainText("Avg: 29.94");
        await selection.hover();
        const tooltip = resultsFrame.getByRole("tooltip");
        await expect(tooltip).toContainText("Min:0");
        await expect(tooltip).toContainText("Max:99.99");
        await expect(tooltip).toContainText("Null:1");
    });

    test("renders PRINT output and a query error in the messages pane", async () => {
        const { electronApp, page } = getContext();
        await setQueryText(electronApp, page, MESSAGES_QUERY);
        await executeQueryAndWait(page);

        await resultsFrame
            .getByTestId("results-tab-list")
            .getByRole("tab", { name: "Messages" })
            .click();
        const messagesPane = resultsFrame.locator(
            '[data-vscode-context*="queryResultMessagesPane"]',
        );
        await expect(messagesPane).toContainText("indented   output");
        await expect(messagesPane).toContainText("Divide by zero error encountered");
        const errorCell = messagesPane.getByRole("gridcell").filter({
            hasText: "Divide by zero error encountered",
        });
        await expect(errorCell.locator('div[style*="--vscode-errorForeground"]')).toBeVisible();
        await expect(
            messagesPane
                .getByRole("gridcell", { name: /Msg 8134, Level 16, State 1, Line 3/ })
                .getByRole("button", { name: "Line 3" }),
        ).toBeVisible();

        await page.locator(".view-lines .view-line").first().click();
        await expect(page.getByRole("button", { name: /Ln 1, Col/ })).toBeVisible();
        await messagesPane
            .getByRole("gridcell", { name: /Msg 8134, Level 16, State 1, Line 3/ })
            .getByRole("button", { name: "Line 3" })
            .click();
        await expect(page.getByRole("button", { name: /Ln 3, Col/ })).toBeVisible();
    });

    test("switches the preview grid to the classic results mode", async () => {
        const { electronApp, page } = getContext();
        await setQueryText(electronApp, page, MIXED_TYPES_QUERY);
        await executeQueryAndWait(page);
        await waitForResultGrid(resultsFrame, "0_0", MIXED_TYPES_ROW_COUNT);

        await resultsFrame.getByRole("button", { name: "More Actions" }).click();
        const previewSwitch = resultsFrame.getByTestId("preview-grid-switch");
        await expect(previewSwitch).toHaveAttribute("aria-checked", "true");
        await previewSwitch.click();

        await expect(
            resultsFrame.getByTestId("results-tab-list").getByRole("tab", { name: "Results (1)" }),
        ).toBeVisible();
        await expect(resultsFrame.getByTestId("summary-footer")).toHaveCount(0);
    });

    test("opens the result in a document tab", async () => {
        const { page } = getContext();
        await resultsFrame.getByRole("button", { name: "Open in New Tab" }).click();

        // The document webview uses the query title rather than the panel's "Query Results"
        // title. Its toolbar omits the panel-only Open in New Tab action (queryResultPane.tsx),
        // which identifies it without relying on workbench tab ordering or iframe indices.
        let documentFrame: FrameLocator | undefined;
        await expect
            .poll(async () => {
                const outerFrames = page.locator(".webview");
                for (let index = 0; index < (await outerFrames.count()); index++) {
                    const activeFrame = outerFrames
                        .nth(index)
                        .contentFrame()
                        .locator("iframe#active-frame");
                    if ((await activeFrame.count()) === 0) {
                        continue;
                    }
                    const candidate = activeFrame.contentFrame();
                    if (
                        (await candidate.getByTestId("results-tab-list").count()) === 1 &&
                        (await candidate
                            .getByRole("button", { name: "Open in New Tab" })
                            .count()) === 0
                    ) {
                        documentFrame = candidate;
                        return true;
                    }
                }
                return false;
            })
            .toBe(true);

        await expect(
            documentFrame!
                .getByTestId("results-tab-list")
                .getByRole("tab", { name: "Results (1)" }),
        ).toBeVisible();
    });
});
