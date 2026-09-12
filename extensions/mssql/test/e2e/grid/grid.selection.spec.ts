/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator, Locator } from "@playwright/test";
import { test, expect } from "../baseFixtures";
import { useSharedVsCodeLifecycle } from "../utils/testLifecycle";
import {
    clearClipboard,
    executeQueryAndWait,
    getModifierKey,
    readClipboard,
    setQueryText,
    waitForResultGrid,
} from "../utils/testHelpers";
import { GRID_KEYS, getGridLaunchConfig } from "./gridLaunchConfig";
import {
    clickCell,
    clickMenuItem,
    getCell,
    getColumnHeader,
    getColumnHeaderLabel,
    getRowNumberCell,
    GRID_MENU_LABELS,
    openGridMenu,
    resetGrid,
    stageQuery,
} from "./gridActions";
import {
    FILTERABLE_QUERY,
    MULTI_RESULT_QUERY,
    SELECTION_COLUMN_COUNT,
    SELECTION_QUERY,
    SELECTION_ROW_COUNT,
} from "./gridFixtures";

/**
 * Selection and keyboard navigation for the preview results grid.
 *
 * Assertions read the grid's own markers: SlickGrid tags selected cells with `.selected` and the
 * anchor cell with `.active`, so counting them says exactly what is selected without inspecting
 * colours or geometry.
 */
test.describe("MSSQL Extension - Preview Grid Selection", () => {
    let resultsFrame: FrameLocator;
    let grid: Locator;

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: {
            initialConfig: getGridLaunchConfig(),
        },
        afterLaunch: async ({ electronApp, page }) => {
            const staged = await stageQuery(electronApp, page, SELECTION_QUERY, {
                minRows: SELECTION_ROW_COUNT,
            });
            resultsFrame = staged.resultsFrame;
            grid = staged.grid;
        },
    });

    test.afterEach(async () => {
        await resetGrid(grid, SELECTION_ROW_COUNT);
    });

    /** Data cells currently marked selected. */
    function selectedCells(): Locator {
        return grid.locator(".slick-cell.selected");
    }

    /** The anchor cell that keyboard navigation moves from. */
    function activeCells(): Locator {
        return grid.locator(".slick-cell.active");
    }

    /** Waits for the asynchronous extension copy to replace any transient clipboard contents. */
    async function expectCopiedRowIds(expectedIds: string[]): Promise<void> {
        const { electronApp, page } = getContext();
        await clearClipboard(electronApp);
        await page.keyboard.press(`${getModifierKey()}+C`);
        await expect
            .poll(async () =>
                (await readClipboard(electronApp))
                    .trim()
                    .split(/\r?\n/)
                    .map((row) => row.split("\t")[0].trim()),
            )
            .toEqual(expectedIds);
    }

    test("stages the fixture with every row displayed", async () => {
        await expect(grid).toHaveAttribute("data-row-count", String(SELECTION_ROW_COUNT));
    });

    test("a plain click selects exactly one cell and makes it active", async () => {
        await clickCell(grid, 1, 1);

        await expect(selectedCells()).toHaveCount(1);
        await expect(activeCells()).toHaveCount(1);
        await expect(getCell(grid, 1, 1)).toHaveClass(/active/);
    });

    test("a second click moves the selection rather than adding to it", async () => {
        await clickCell(grid, 1, 1);
        await clickCell(grid, 3, 2);

        await expect(selectedCells()).toHaveCount(1);
        await expect(getCell(grid, 3, 2)).toHaveClass(/active/);
    });

    test("shift+click extends the selection into a rectangle", async () => {
        await clickCell(grid, 0, 0);
        await clickCell(grid, 1, 1, { modifiers: ["Shift"] });

        // Two rows by two columns.
        await expect(selectedCells()).toHaveCount(4);
    });

    test("shift+click extends across every column in the range", async () => {
        await clickCell(grid, 0, 0);
        await clickCell(grid, 2, 3, { modifiers: ["Shift"] });

        // Three rows by four columns.
        await expect(selectedCells()).toHaveCount(12);
    });

    test("ctrl+click adds a disjoint cell to the selection", async () => {
        await clickCell(grid, 0, 0);
        await clickCell(grid, 4, 3, { modifiers: ["Control"] });

        await expect(selectedCells()).toHaveCount(2);
    });

    test("the select-all shortcut selects every data cell", async () => {
        const { page } = getContext();
        await clickCell(grid, 0, 0);
        await page.keyboard.press(`${getModifierKey()}+A`);

        await expect(selectedCells()).toHaveCount(SELECTION_ROW_COUNT * SELECTION_COLUMN_COUNT);
    });

    test("clicking a row number selects that whole row", async () => {
        await getRowNumberCell(grid, 2).click();

        await expect(selectedCells()).toHaveCount(SELECTION_COLUMN_COUNT);
    });

    test("ctrl+click on a row number carves the row back out", async () => {
        await getRowNumberCell(grid, 2).click();
        await expect(selectedCells()).toHaveCount(SELECTION_COLUMN_COUNT);

        await getRowNumberCell(grid, 2).click({ modifiers: ["Control"] });
        await expect(selectedCells()).toHaveCount(0);
    });

    test("shift+click on a row number extends across rows", async () => {
        await getRowNumberCell(grid, 1).click();
        await getRowNumberCell(grid, 3).click({ modifiers: ["Shift"] });

        // Three rows, every column.
        await expect(selectedCells()).toHaveCount(3 * SELECTION_COLUMN_COUNT);
    });

    test("clicking a column header selects the whole column", async () => {
        await getColumnHeaderLabel(grid, "a").click();

        await expect(selectedCells()).toHaveCount(SELECTION_ROW_COUNT);
    });

    test("ctrl+click on a column header toggles that column off again", async () => {
        await getColumnHeaderLabel(grid, "a").click();
        await expect(selectedCells()).toHaveCount(SELECTION_ROW_COUNT);

        await getColumnHeaderLabel(grid, "a").click({ modifiers: ["Control"] });
        await expect(selectedCells()).toHaveCount(0);
    });

    test("shift+arrow expands the selection and shrinks it back around the anchor", async () => {
        const { page } = getContext();
        await clickCell(grid, 1, 1);

        await page.keyboard.press("Shift+ArrowRight");
        await expect(selectedCells()).toHaveCount(2);

        await page.keyboard.press("Shift+ArrowDown");
        await expect(selectedCells()).toHaveCount(4);

        await page.keyboard.press("Shift+ArrowUp");
        await expect(selectedCells()).toHaveCount(2);

        await page.keyboard.press("Shift+ArrowLeft");
        await expect(selectedCells()).toHaveCount(1);
    });

    test("shift+arrow clamps at the first row instead of wrapping", async () => {
        const { page } = getContext();
        await clickCell(grid, 0, 0);

        await page.keyboard.press("Shift+ArrowUp");
        await page.keyboard.press("Shift+ArrowUp");

        await expect(selectedCells()).toHaveCount(1);
    });

    test("ctrl+arrow moves the active cell to the row start and end", async () => {
        const { page } = getContext();
        await clickCell(grid, 2, 1);

        await page.keyboard.press(GRID_KEYS.moveToRowEnd);
        await expect(getCell(grid, 2, SELECTION_COLUMN_COUNT - 1)).toHaveClass(/active/);

        await page.keyboard.press(GRID_KEYS.moveToRowStart);
        await expect(getCell(grid, 2, 0)).toHaveClass(/active/);
    });

    test("ctrl+space selects the active cell's column", async () => {
        const { page } = getContext();
        await clickCell(grid, 2, 1);
        await page.keyboard.press(GRID_KEYS.selectColumn);

        await expect(selectedCells()).toHaveCount(SELECTION_ROW_COUNT);
    });

    test("shift+space selects the active cell's row", async () => {
        const { page } = getContext();
        await clickCell(grid, 2, 1);
        await page.keyboard.press(GRID_KEYS.selectRow);

        await expect(selectedCells()).toHaveCount(SELECTION_COLUMN_COUNT);
    });

    test("the selection summary footer reports the selected cells", async () => {
        await clickCell(grid, 0, 1);
        await clickCell(grid, 2, 1, { modifiers: ["Shift"] });

        const footer = resultsFrame.locator('[data-testid="summary-footer"]');
        await expect(footer).toBeVisible();
        // Three numeric cells selected: the summary reports a count alongside its aggregates.
        await expect(footer.locator('[data-metric="selection"]')).toContainText("3");
    });

    test("a double-click selects the clicked row", async () => {
        await getCell(grid, 1, 1).dblclick();

        await expect(selectedCells()).toHaveCount(SELECTION_COLUMN_COUNT);
    });

    test("ctrl+click toggles a selected data cell off", async () => {
        await clickCell(grid, 2, 1);
        await expect(selectedCells()).toHaveCount(1);
        await clickCell(grid, 2, 1, { modifiers: ["Control"] });
        await expect(selectedCells()).toHaveCount(0);
    });

    test("shift+click backwards selects the same rectangular range", async () => {
        await clickCell(grid, 2, 2);
        await clickCell(grid, 0, 0, { modifiers: ["Shift"] });
        await expect(selectedCells()).toHaveCount(9);
        await expect(getCell(grid, 2, 2)).toHaveClass(/selected/);
    });

    test("shift+click on the active cell keeps one selected cell", async () => {
        await clickCell(grid, 2, 1);
        await clickCell(grid, 2, 1, { modifiers: ["Shift"] });
        await expect(selectedCells()).toHaveCount(1);
    });

    test("a plain click collapses a select-all range", async () => {
        const { page } = getContext();
        await clickCell(grid, 0, 0);
        await page.keyboard.press(`${getModifierKey()}+A`);
        await expect(selectedCells()).toHaveCount(SELECTION_ROW_COUNT * SELECTION_COLUMN_COUNT);
        await clickCell(grid, 4, 2);
        await expect(selectedCells()).toHaveCount(1);
        await expect(getCell(grid, 4, 2)).toHaveClass(/active/);
    });

    test("clicking the first row number selects only the first row", async () => {
        await getRowNumberCell(grid, 0).click();
        await expect(selectedCells()).toHaveCount(SELECTION_COLUMN_COUNT);
        await expect(getCell(grid, 0, 0)).toHaveClass(/selected/);
        await expect(getCell(grid, 1, 0)).not.toHaveClass(/selected/);
    });

    test("clicking the last row number selects only the last row", async () => {
        await getRowNumberCell(grid, SELECTION_ROW_COUNT - 1).click();
        await expect(selectedCells()).toHaveCount(SELECTION_COLUMN_COUNT);
        await expect(getCell(grid, SELECTION_ROW_COUNT - 1, 0)).toHaveClass(/selected/);
        await expect(getCell(grid, SELECTION_ROW_COUNT - 2, 0)).not.toHaveClass(/selected/);
    });

    test("shift+clicking row numbers backwards selects the intervening rows", async () => {
        await getRowNumberCell(grid, 4).click();
        await getRowNumberCell(grid, 2).click({ modifiers: ["Shift"] });
        await expect(selectedCells()).toHaveCount(3 * SELECTION_COLUMN_COUNT);
    });

    test("clicking the last column header selects only that column", async () => {
        await getColumnHeaderLabel(grid, "c").click();
        await expect(selectedCells()).toHaveCount(SELECTION_ROW_COUNT);
        await expect(getCell(grid, 0, SELECTION_COLUMN_COUNT - 1)).toHaveClass(/selected/);
        await expect(getCell(grid, 0, SELECTION_COLUMN_COUNT - 2)).not.toHaveClass(/selected/);
    });

    test("ctrl+click completes a partly selected row before toggling it off", async () => {
        await clickCell(grid, 2, 1);
        await getRowNumberCell(grid, 2).click({ modifiers: ["Control"] });
        await expect(selectedCells()).toHaveCount(SELECTION_COLUMN_COUNT);
        await getRowNumberCell(grid, 2).click({ modifiers: ["Control"] });
        await expect(selectedCells()).toHaveCount(0);
    });

    test("Shift takes precedence over Control on row-number clicks", async () => {
        await getRowNumberCell(grid, 1).click();
        await getRowNumberCell(grid, 3).click({ modifiers: ["Control", "Shift"] });
        await expect(selectedCells()).toHaveCount(3 * SELECTION_COLUMN_COUNT);
    });

    test("Shift takes precedence over Control on column-header clicks", async () => {
        await getColumnHeaderLabel(grid, "a").click();
        await getColumnHeaderLabel(grid, "c").click({ modifiers: ["Control", "Shift"] });
        await expect(selectedCells()).toHaveCount(3 * SELECTION_ROW_COUNT);
    });

    test("a row-number click focuses the first data cell", async () => {
        await getRowNumberCell(grid, 3).click();
        await expect(getCell(grid, 3, 0)).toHaveClass(/active/);
    });

    test("dragging across data cells creates a rectangular selection", async () => {
        await getCell(grid, 1, 1).dragTo(getCell(grid, 3, 2));
        await expect(selectedCells()).toHaveCount(6);
        await expect(getCell(grid, 3, 2)).toHaveClass(/selected/);
    });

    test("F3 opens the active column's menu", async () => {
        const { page } = getContext();
        await clickCell(grid, 1, 1);
        await page.keyboard.press("F3");
        await expect(
            resultsFrame.getByRole("menuitem", { name: /Copy Column Name/ }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
    });

    test("result and message tab shortcuts switch the active pane", async () => {
        const { page } = getContext();
        const tabs = resultsFrame.getByTestId("results-tab-list");
        await clickCell(grid, 1, 1);
        await page.keyboard.press("Control+Alt+Y");
        await expect(tabs.getByRole("tab", { name: "Messages" })).toHaveAttribute(
            "aria-selected",
            "true",
        );
        await page.keyboard.press("Control+Alt+R");
        await expect(tabs.getByRole("tab", { name: /Results Preview/ })).toHaveAttribute(
            "aria-selected",
            "true",
        );
    });

    test("a multi-range selection survives switching away and back to results", async () => {
        const tabs = resultsFrame.getByTestId("results-tab-list");
        await clickCell(grid, 0, 0);
        await clickCell(grid, 3, 2, { modifiers: ["Control"] });
        await expect(selectedCells()).toHaveCount(2);
        await tabs.getByRole("tab", { name: "Messages" }).click();
        await tabs.getByRole("tab", { name: /Results Preview/ }).click();
        await expect(selectedCells()).toHaveCount(2);
        await expect(getCell(grid, 3, 2)).toHaveClass(/active/);
    });

    test("row-number selection covers only visible data columns", async () => {
        await openGridMenu(grid);
        const columnPicker = resultsFrame.locator(
            '.slick-column-picker-list input[type="checkbox"][data-columnid="1"]',
        );
        await columnPicker.locator("xpath=ancestor::label[1]").click();
        await expect(getColumnHeader(grid, "a")).toHaveCount(0);
        try {
            await getContext().page.keyboard.press("Escape");
            await getRowNumberCell(grid, 2).click();
            await expect(selectedCells()).toHaveCount(SELECTION_COLUMN_COUNT - 1);
            const { electronApp, page } = getContext();
            await clearClipboard(electronApp);
            await page.keyboard.press(`${getModifierKey()}+C`);
            await expect.poll(() => readClipboard(electronApp)).toContain("300");
            expect((await readClipboard(electronApp)).trim().split("\t")).toEqual([
                "3",
                "300",
                "3000",
            ]);
        } finally {
            await getContext().page.keyboard.press("Escape");
            await openGridMenu(grid);
            await clickMenuItem(resultsFrame, GRID_MENU_LABELS.showAllColumns);
            await expect(getColumnHeader(grid, "a")).toBeVisible();
        }
    });

    test("a row-number click creates no selection when every data column is hidden", async () => {
        const { page } = getContext();
        await openGridMenu(grid);
        try {
            for (const columnId of ["0", "1", "2", "3"]) {
                const picker = resultsFrame.locator(
                    `.slick-column-picker-list input[type="checkbox"][data-columnid="${columnId}"]`,
                );
                await picker.locator("xpath=ancestor::label[1]").click();
            }
            await page.keyboard.press("Escape");
            await getRowNumberCell(grid, 2).click();
            await expect(selectedCells()).toHaveCount(0);
        } finally {
            await page.keyboard.press("Escape");
            await openGridMenu(grid);
            await clickMenuItem(resultsFrame, GRID_MENU_LABELS.showAllColumns);
            await expect(getColumnHeader(grid, "a")).toBeVisible();
        }
    });

    test("clicking a resize handle does not replace the column selection", async () => {
        await getColumnHeaderLabel(grid, "a").click();
        await expect(selectedCells()).toHaveCount(SELECTION_ROW_COUNT);
        await getColumnHeader(grid, "b").locator(".slick-resizable-handle").click();
        await expect(selectedCells()).toHaveCount(SELECTION_ROW_COUNT);
        await expect(getCell(grid, 0, 1)).toHaveClass(/selected/);
        await expect(getCell(grid, 0, 2)).not.toHaveClass(/selected/);
    });

    test("selecting in another result grid clears the previous grid's selection", async () => {
        const { electronApp, page } = getContext();
        await setQueryText(electronApp, page, MULTI_RESULT_QUERY);
        await executeQueryAndWait(page);
        const first = await waitForResultGrid(resultsFrame, "0_0", 1);
        await resultsFrame.locator('[id="0_1"]').scrollIntoViewIfNeeded();
        const second = await waitForResultGrid(resultsFrame, "0_1", 1);
        try {
            await clickCell(first, 0, 0);
            await expect(first.locator(".slick-cell.selected")).toHaveCount(1);
            await clickCell(second, 0, 0);
            await expect(second.locator(".slick-cell.selected")).toHaveCount(1);
            await expect(first.locator(".slick-cell.selected")).toHaveCount(0);
        } finally {
            await setQueryText(electronApp, page, SELECTION_QUERY);
            await executeQueryAndWait(page);
            grid = await waitForResultGrid(resultsFrame, "0_0", SELECTION_ROW_COUNT);
        }
    });

    test("Cmd/Ctrl-click coalesces adjacent rows and splits them when the middle row is removed", async () => {
        const modifier = getModifierKey() as "Control" | "Meta";
        await getRowNumberCell(grid, 1).click();
        await getRowNumberCell(grid, 3).click({ modifiers: [modifier] });
        await expect(selectedCells()).toHaveCount(2 * SELECTION_COLUMN_COUNT);
        await expect(getCell(grid, 2, 0)).not.toHaveClass(/selected/);

        await getRowNumberCell(grid, 2).click({ modifiers: [modifier] });
        await expect(selectedCells()).toHaveCount(3 * SELECTION_COLUMN_COUNT);
        await expectCopiedRowIds(["2", "3", "4"]);

        await getRowNumberCell(grid, 2).click({ modifiers: [modifier] });
        await expect(selectedCells()).toHaveCount(2 * SELECTION_COLUMN_COUNT);
        await expect(getCell(grid, 2, 0)).not.toHaveClass(/selected/);
        await expectCopiedRowIds(["2", "4"]);
    });

    test("Cmd/Ctrl and Shift row selection coalesces in sorted display order", async () => {
        const modifier = getModifierKey() as "Control" | "Meta";
        const sortButton = getColumnHeader(grid, "id").locator(".slick-header-sortbutton");
        await sortButton.click();
        await sortButton.click();
        await expect(getColumnHeader(grid, "id")).toHaveAttribute("data-sort-direction", "desc");
        try {
            await getRowNumberCell(grid, 0).click();
            await getRowNumberCell(grid, 2).click({ modifiers: [modifier] });
            await getRowNumberCell(grid, 1).click({ modifiers: [modifier] });
            await expect(selectedCells()).toHaveCount(3 * SELECTION_COLUMN_COUNT);
            await expectCopiedRowIds(["6", "5", "4"]);

            await getRowNumberCell(grid, 3).click({ modifiers: ["Shift"] });
            await expect(selectedCells()).toHaveCount(3 * SELECTION_COLUMN_COUNT);
            await expectCopiedRowIds(["5", "4", "3"]);
        } finally {
            await sortButton.click();
            await expect(getColumnHeader(grid, "id")).toHaveAttribute(
                "data-sort-direction",
                "none",
            );
        }
    });

    test("Cmd/Ctrl and Shift row selection maps filtered and sorted rows to their source values", async () => {
        const { electronApp, page } = getContext();
        const modifier = getModifierKey() as "Control" | "Meta";
        await setQueryText(electronApp, page, FILTERABLE_QUERY);
        await executeQueryAndWait(page);
        grid = await waitForResultGrid(resultsFrame, "0_0", 6);
        try {
            await getColumnHeader(grid, "color").locator(".slick-header-filterbutton").click();
            const overlay = resultsFrame.getByRole("dialog", { name: "Filter Options" });
            await expect(overlay).toBeVisible();
            await overlay.locator('input:not([type="checkbox"])').fill("red");
            const red = overlay.getByRole("checkbox", { name: "red", exact: true });
            if (!(await red.isChecked())) {
                await overlay.getByRole("listbox", { name: "Filter Options" }).focus();
                await page.keyboard.press("Space");
            }
            await expect(red).toBeChecked();
            await overlay.getByRole("button", { name: "Apply" }).click();
            await expect(grid).toHaveAttribute("data-row-count", "3");

            const sortButton = getColumnHeader(grid, "id").locator(".slick-header-sortbutton");
            await sortButton.click();
            await sortButton.click();
            await expect(getColumnHeader(grid, "id")).toHaveAttribute(
                "data-sort-direction",
                "desc",
            );
            await getRowNumberCell(grid, 0).click();
            await getRowNumberCell(grid, 2).click({ modifiers: [modifier] });
            await getRowNumberCell(grid, 1).click({ modifiers: [modifier] });
            await expect(selectedCells()).toHaveCount(3 * 3);
            await expectCopiedRowIds(["6", "3", "1"]);

            await getRowNumberCell(grid, 2).click({ modifiers: ["Shift"] });
            await expect(selectedCells()).toHaveCount(2 * 3);
            await expectCopiedRowIds(["3", "1"]);
        } finally {
            if (await resultsFrame.getByRole("dialog", { name: "Filter Options" }).isVisible()) {
                await page.keyboard.press("Escape");
            }
            await setQueryText(electronApp, page, SELECTION_QUERY);
            await executeQueryAndWait(page);
            grid = await waitForResultGrid(resultsFrame, "0_0", SELECTION_ROW_COUNT);
        }
    });
});
