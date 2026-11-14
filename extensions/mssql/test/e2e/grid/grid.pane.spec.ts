/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator, Locator, Page } from "@playwright/test";
import { test, expect } from "../baseFixtures";
import { useSharedVsCodeLifecycle } from "../utils/testLifecycle";
import {
    executeQueryAndWait,
    getExecuteQueryShortcut,
    setQueryText,
    waitForQueryExecutionToEnd,
    waitForResultGrid,
} from "../utils/testHelpers";
import { getGridLaunchConfig } from "./gridLaunchConfig";
import { clickCell, getCell, stageQuery } from "./gridActions";
import {
    getMarkerQuery,
    MESSAGES_QUERY,
    MIXED_TYPES_QUERY,
    MIXED_TYPES_ROW_COUNT,
    RUN_ID_QUERY,
} from "./gridFixtures";
import { testCases } from "../utils/testCases";

/**
 * How long a one-row SELECT may take from the execute shortcut to a rendered, finished result.
 * Tight enough to fail when the run starts seconds late, with CI headroom over a round trip
 * that takes well under a second locally.
 */
const SHORTCUT_RUN_BUDGET_MS = 5 * 1000;

/** Mirrors msgRunQueryInProgress in src/constants/locConstants.ts. */
const QUERY_IN_PROGRESS_MESSAGE = "A query is already running for this editor session";

test.describe("MSSQL Extension - Results Grid Pane", () => {
    let resultsFrame: FrameLocator;
    let grid: Locator;

    /**
     * Presses the execute shortcut and requires the run to render `expected` and finish within
     * one budget measured from the keypress, without the "already running" toast that a stuck
     * execution state shows instead of running the query. Returns the rendered value.
     *
     * Every wait gets only the time left before the shared deadline. Giving each its own budget
     * would let a run several seconds late pass. `replaces` is the value the previous run left on
     * screen, for re-runs whose new value matches the same pattern.
     */
    async function runWithShortcut(
        page: Page,
        expected: string | RegExp,
        replaces?: string,
    ): Promise<string> {
        const deadline = Date.now() + SHORTCUT_RUN_BUDGET_MS;
        // A Playwright timeout of 0 means "no timeout", so an expired budget becomes 1ms.
        const remaining = () => Math.max(deadline - Date.now(), 1);

        await page.keyboard.press(getExecuteQueryShortcut());
        const resultGrid = await waitForResultGrid(resultsFrame, "0_0", 1, remaining());
        const cell = getCell(resultGrid, 0, 0);
        if (replaces !== undefined) {
            await expect(cell, "the re-run did not execute").not.toHaveText(replaces, {
                timeout: remaining(),
            });
        }
        await expect(cell).toHaveText(expected, { timeout: remaining() });
        await waitForQueryExecutionToEnd(page, remaining());
        await expect(
            page.locator(".notifications-toasts").getByText(QUERY_IN_PROGRESS_MESSAGE),
        ).toHaveCount(0);
        return cell.innerText();
    }

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: {
            initialConfig: getGridLaunchConfig({ "mssql.resultsGrid.rightAlignNumbers": true }),
        },
        afterLaunch: async ({ electronApp, page }) => {
            const staged = await stageQuery(electronApp, page, MIXED_TYPES_QUERY, {
                minRows: MIXED_TYPES_ROW_COUNT,
            });
            resultsFrame = staged.resultsFrame;
            grid = staged.grid;
        },
    });

    test("right-aligns numeric columns while keeping text left-aligned", async () => {
        await expect(getCell(grid, 0, 0)).toHaveCSS("justify-content", "flex-end");
        await expect(getCell(grid, 0, 3)).toHaveCSS("justify-content", "flex-end");
        await expect(getCell(grid, 3, 3)).toHaveCSS("justify-content", "flex-end");
        await expect(getCell(grid, 0, 1)).not.toHaveCSS("justify-content", "flex-end");
        await expect(getCell(grid, 0, 2)).not.toHaveCSS("justify-content", "flex-end");
    });

    test(
        "shows result count and switches between results and messages",
        testCases(5878837),
        async () => {
            const tabs = resultsFrame.getByTestId("results-tab-list");
            const resultsTab = tabs.getByRole("tab", { name: "Results (1)" });
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
        },
    );

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

    test("the footer shows a live timer and becomes polite after execution", async () => {
        const { electronApp, page } = getContext();
        await setQueryText(electronApp, page, "WAITFOR DELAY '00:00:03'; SELECT 1 AS id;");
        const footer = resultsFrame.getByTestId("summary-footer");
        const time = footer.locator('[data-metric="time"]');
        await page.locator('[aria-label^="Execute Query"]').first().click();
        try {
            await expect(footer).toHaveAttribute("aria-live", "off");
            const initialTime = await time.innerText();
            await expect.poll(() => time.innerText()).not.toBe(initialTime);
            await expect(footer).toHaveAttribute("aria-live", "polite", { timeout: 15_000 });
            await waitForResultGrid(resultsFrame, "0_0", 1);
            await expect(time).toContainText(/\d+(?:ms|s)/);
        } finally {
            await setQueryText(electronApp, page, MIXED_TYPES_QUERY);
            await executeQueryAndWait(page);
            grid = await waitForResultGrid(resultsFrame, "0_0", MIXED_TYPES_ROW_COUNT);
        }
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

    // The shortcut cases replace the staged result; nothing after them reads `grid`.
    test("the execute shortcut runs the edited text on every press, promptly", async () => {
        const { electronApp, page } = getContext();

        // No wait between the edit and the press: the regression treated the new text as
        // unchanged, ran the previous query, or ran the new one several seconds late.
        for (let run = 1; run <= 3; run++) {
            const marker = `pasted-${run}`;
            await setQueryText(electronApp, page, getMarkerQuery(marker));
            await runWithShortcut(page, marker);
        }

        // Typing produces one content change per keystroke, unlike setQueryText's single insert.
        // Only the digit before `' AS marker;` changes, inside the string literal, where the
        // editor determinism settings leave nothing to autocomplete.
        await setQueryText(electronApp, page, getMarkerQuery("typed-0"));
        for (let run = 1; run <= 2; run++) {
            await page.keyboard.press("End");
            for (let step = 0; step < "' AS marker;".length; step++) {
                await page.keyboard.press("ArrowLeft");
            }
            await page.keyboard.press("Backspace");
            await page.keyboard.type(String(run));
            await runWithShortcut(page, `typed-${run}`);
        }
    });

    test("the execute shortcut re-runs unchanged text and runs only a selection", async () => {
        const { electronApp, page } = getContext();
        const runIdPattern = /^[0-9A-F-]{36}$/i;

        await setQueryText(electronApp, page, RUN_ID_QUERY);
        let previousRunId = await runWithShortcut(page, runIdPattern);

        // Pressing again without touching the text must still execute; a skipped run leaves the
        // previous NEWID() on screen.
        for (let run = 1; run <= 2; run++) {
            previousRunId = await runWithShortcut(page, runIdPattern, previousRunId);
        }

        // setQueryText leaves the cursor at the end of the last line; select only that line.
        await setQueryText(
            electronApp,
            page,
            `${getMarkerQuery("not-selected")}\n${getMarkerQuery("selected")}`,
        );
        await page.keyboard.press("Shift+Home");
        await runWithShortcut(page, "selected");
        await expect(
            resultsFrame.getByTestId("results-tab-list").getByRole("tab", { name: "Results (1)" }),
        ).toBeVisible();
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
        await expect(messagesPane).toContainText("Started executing query");
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
