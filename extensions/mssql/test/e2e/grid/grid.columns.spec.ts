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
    GRID_MENU_LABELS,
    clickCell,
    clickMenuItem,
    getCell,
    getColumnHeader,
    getDisplayedRowCount,
    openGridMenu,
    openHeaderContextMenu,
    resetGrid,
    stageQuery,
} from "./gridActions";
import { BLANK_FILTER_QUERY, FILTERABLE_QUERY, FILTERABLE_ROW_COUNT } from "./gridFixtures";

/** Header menu entries, from getQueryResultFluentGridStrings() in queryResultFluentResultGrid.tsx. */
const HEADER_MENU = {
    sort: "Sort",
    filter: "Filter",
    resize: "Resize",
    freezeColumns: "Freeze columns",
    unfreezeColumns: "Unfreeze columns",
};

/** Filter overlay strings, from locConstants.queryResult. */
const FILTER_STRINGS = {
    dialogLabel: "Filter Options",
    apply: "Apply",
    clear: "Clear",
    selectAll: "Select All",
    nullValue: "NULL",
};

/**
 * Sorting, filtering, freezing and resizing for the preview results grid.
 *
 * Sort and filter state is read from the `data-sort-direction` and `data-filtered` attributes on
 * the header cell, and the frozen pane boundary from `data-frozen-index` on the grid root, so the
 * assertions do not depend on class names or on pixel geometry.
 */
test.describe("MSSQL Extension - Preview Grid Columns", () => {
    let resultsFrame: FrameLocator;
    let grid: Locator;

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: {
            initialConfig: getGridLaunchConfig(),
        },
        afterLaunch: async ({ electronApp, page }) => {
            const staged = await stageQuery(electronApp, page, FILTERABLE_QUERY, {
                minRows: FILTERABLE_ROW_COUNT,
            });
            resultsFrame = staged.resultsFrame;
            grid = staged.grid;
        },
    });

    /** Cycles any active sort back to none and clears any active filter. */
    test.afterEach(async () => {
        // Dismiss any overlay a failing test left open, so one failure cannot cascade.
        for (let attempt = 0; attempt < 3; attempt++) {
            if ((await resultsFrame.getByRole("dialog").count()) === 0) {
                break;
            }
            await getContext().page.keyboard.press("Escape");
        }

        for (const columnName of ["id", "category", "color"]) {
            const header = getColumnHeader(grid, columnName);
            for (let attempt = 0; attempt < 3; attempt++) {
                if ((await header.getAttribute("data-sort-direction")) === "none") {
                    break;
                }
                await header.locator(".slick-header-sortbutton").click();
            }

            if ((await header.getAttribute("data-filtered")) === "true") {
                await header.locator(".slick-header-filterbutton").click();
                await clearFilter();
            }
        }
        await resetGrid(grid, FILTERABLE_ROW_COUNT);
    });

    function filterOverlay(): Locator {
        return resultsFrame.getByRole("dialog", { name: FILTER_STRINGS.dialogLabel });
    }

    /**
     * Opens the filter overlay through the header context menu.
     *
     * The in-header filter button toggles the overlay, so a click that lands while a previous
     * overlay is still settling closes it again instead of opening it. The menu entry always
     * opens. The button itself is covered separately below.
     */
    async function openFilter(columnName: string): Promise<void> {
        await openHeaderContextMenu(grid, columnName);
        await clickMenuItem(resultsFrame, HEADER_MENU.filter);
        await expect(filterOverlay()).toBeVisible();
    }

    async function clearFilter(): Promise<void> {
        await expect(filterOverlay()).toBeVisible();
        await filterOverlay().getByRole("button", { name: FILTER_STRINGS.clear }).click();
        await expect(filterOverlay()).toBeHidden();
    }

    /**
     * The filter overlay's search field.
     *
     * Fluent puts the `role` prop on the Input's wrapper span rather than the `<input>`, so
     * `getByRole("searchbox")` resolves to the wrapper and cannot be filled. The search field is
     * the only non-checkbox input in the overlay.
     */
    function filterSearchBox(): Locator {
        return filterOverlay().locator("input:not([type='checkbox'])").first();
    }

    /** Toggles one value in the filter list. */
    async function toggleFilterValue(value: string): Promise<void> {
        // The value Checkbox has pointer-events: none; the surrounding option row owns onClick.
        await filterOverlay()
            .getByRole("checkbox", { name: value, exact: true })
            .locator("xpath=ancestor::div[@title][1]")
            .click();
    }

    async function sortDirection(columnName: string): Promise<string | null> {
        return getColumnHeader(grid, columnName).getAttribute("data-sort-direction");
    }

    test("stages the fixture with every row displayed", async () => {
        await expect(grid).toHaveAttribute("data-row-count", String(FILTERABLE_ROW_COUNT));
        await expect(grid).toHaveAttribute("data-column-count", "4");
    });

    test("the sort button cycles ascending, descending, then back to none", async () => {
        const sortButton = getColumnHeader(grid, "id").locator(".slick-header-sortbutton");

        await sortButton.click();
        await expect.poll(() => sortDirection("id")).toBe("asc");

        await sortButton.click();
        await expect.poll(() => sortDirection("id")).toBe("desc");

        await sortButton.click();
        await expect.poll(() => sortDirection("id")).toBe("none");
    });

    test("sorting descending reverses the displayed rows", async () => {
        await expect(getCell(grid, 0, 0)).toHaveText("1");

        const sortButton = getColumnHeader(grid, "id").locator(".slick-header-sortbutton");
        await sortButton.click();
        await sortButton.click();
        await expect.poll(() => sortDirection("id")).toBe("desc");

        await expect(getCell(grid, 0, 0)).toHaveText(String(FILTERABLE_ROW_COUNT));
    });

    test("sorting keeps every row displayed", async () => {
        await getColumnHeader(grid, "category").locator(".slick-header-sortbutton").click();
        await expect.poll(() => sortDirection("category")).toBe("asc");

        expect(await getDisplayedRowCount(grid)).toBe(FILTERABLE_ROW_COUNT);
    });

    test("sorting places NULL before strings ascending and after them descending", async () => {
        const sortButton = getColumnHeader(grid, "color").locator(".slick-header-sortbutton");
        await sortButton.click();
        await expect(getColumnHeader(grid, "color")).toHaveAttribute("data-sort-direction", "asc");
        await expect(getCell(grid, 0, 0)).toHaveText("4");
        await sortButton.click();
        await expect(getColumnHeader(grid, "color")).toHaveAttribute("data-sort-direction", "desc");
        await expect(getCell(grid, FILTERABLE_ROW_COUNT - 1, 0)).toHaveText("4");
    });

    test("sorting defines an order for NULL, numbers, blanks and strings", async () => {
        const { electronApp, page } = getContext();
        await setQueryText(
            electronApp,
            page,
            `SELECT * FROM (VALUES
                (1, CAST(NULL AS nvarchar(20))),
                (2, N''),
                (3, N'2'),
                (4, N'10'),
                (5, N'pear')
            ) AS t(id, value);`,
        );
        await executeQueryAndWait(page);
        grid = await waitForResultGrid(resultsFrame, "0_0", 5);
        try {
            const sortButton = getColumnHeader(grid, "value").locator(".slick-header-sortbutton");
            await sortButton.click();
            await expect(getColumnHeader(grid, "value")).toHaveAttribute(
                "data-sort-direction",
                "asc",
            );
            for (const [row, id] of ["1", "3", "4", "2", "5"].entries()) {
                await expect(getCell(grid, row, 0)).toHaveText(id);
            }
            await sortButton.click();
            await expect(getColumnHeader(grid, "value")).toHaveAttribute(
                "data-sort-direction",
                "desc",
            );
            for (const [row, id] of ["5", "2", "4", "3", "1"].entries()) {
                await expect(getCell(grid, row, 0)).toHaveText(id);
            }
        } finally {
            await setQueryText(electronApp, page, FILTERABLE_QUERY);
            await executeQueryAndWait(page);
            grid = await waitForResultGrid(resultsFrame, "0_0", FILTERABLE_ROW_COUNT);
        }
    });

    test("sorting a second column replaces the first column's sort", async () => {
        await getColumnHeader(grid, "id").locator(".slick-header-sortbutton").click();
        await expect(getColumnHeader(grid, "id")).toHaveAttribute("data-sort-direction", "asc");
        await getColumnHeader(grid, "category").locator(".slick-header-sortbutton").click();
        await expect(getColumnHeader(grid, "category")).toHaveAttribute(
            "data-sort-direction",
            "asc",
        );
        await expect(getColumnHeader(grid, "id")).toHaveAttribute("data-sort-direction", "none");
    });

    test("sorting a filtered result orders only its visible rows", async () => {
        await openFilter("category");
        await toggleFilterValue("alpha");
        await filterOverlay().getByRole("button", { name: FILTER_STRINGS.apply }).click();
        await expect.poll(() => getDisplayedRowCount(grid)).toBe(2);
        const sortButton = getColumnHeader(grid, "id").locator(".slick-header-sortbutton");
        await sortButton.click();
        await sortButton.click();
        await expect(getCell(grid, 0, 0)).toHaveText("2");
        await expect(getCell(grid, 1, 0)).toHaveText("1");
    });

    test("sorts from the header context menu", async () => {
        await openHeaderContextMenu(grid, "id");
        await clickMenuItem(resultsFrame, HEADER_MENU.sort);

        await expect.poll(() => sortDirection("id")).toBe("asc");
    });

    test("sorts from the keyboard shortcut", async () => {
        const { page } = getContext();
        await clickCell(grid, 0, 0);
        await page.keyboard.press(GRID_KEYS.toggleSort);

        await expect.poll(() => sortDirection("id")).toBe("asc");
    });

    test("the filter overlay opens with a search box and the value list", async () => {
        await openFilter("category");

        await expect(filterSearchBox()).toBeVisible();
        await expect(filterOverlay().getByRole("checkbox", { name: "alpha" })).toBeVisible();
        await expect(filterOverlay().getByRole("checkbox", { name: "beta" })).toBeVisible();
        await expect(filterOverlay().getByRole("checkbox", { name: "gamma" })).toBeVisible();

        await clearFilter();
    });

    test("the search box narrows the value list", async () => {
        await openFilter("category");

        await expect(filterOverlay().getByRole("checkbox")).toHaveCount(4);

        await filterSearchBox().fill("alp");

        // Select All plus the one surviving value.
        await expect(filterOverlay().getByRole("checkbox")).toHaveCount(2);
        await expect(filterOverlay().getByRole("checkbox", { name: "beta" })).toHaveCount(0);

        await clearFilter();
    });

    test("filter search ignores case and shows an empty state for no match", async () => {
        await openFilter("category");
        await filterSearchBox().fill("ALP");
        await expect(filterOverlay().getByRole("checkbox", { name: "alpha" })).toBeVisible();
        await expect(filterOverlay().getByRole("checkbox", { name: "beta" })).toHaveCount(0);
        await filterSearchBox().fill("not-a-value");
        await expect(filterOverlay()).toContainText("No results to display");
        await clearFilter();
    });

    test("Escape closes a pending filter without changing the rows", async () => {
        await openFilter("category");
        await toggleFilterValue("alpha");
        await getContext().page.keyboard.press("Escape");
        await expect(filterOverlay()).toBeHidden();
        await expect(grid).toHaveAttribute("data-row-count", String(FILTERABLE_ROW_COUNT));
        await expect(getColumnHeader(grid, "category")).toHaveAttribute("data-filtered", "false");
    });

    test("applying a single value filters the grid down to matching rows", async () => {
        await openFilter("category");

        // No values are selected on a fresh filter.
        await toggleFilterValue("alpha");
        await filterOverlay().getByRole("button", { name: FILTER_STRINGS.apply }).click();

        await expect.poll(() => getDisplayedRowCount(grid)).toBe(2);
        await expect
            .poll(() => getColumnHeader(grid, "category").getAttribute("data-filtered"))
            .toBe("true");
    });

    test("clearing the filter restores every row", async () => {
        await openFilter("category");
        await toggleFilterValue("beta");
        await filterOverlay().getByRole("button", { name: FILTER_STRINGS.apply }).click();
        await expect.poll(() => getDisplayedRowCount(grid)).toBe(2);

        await openFilter("category");
        await clearFilter();

        await expect.poll(() => getDisplayedRowCount(grid)).toBe(FILTERABLE_ROW_COUNT);
        await expect
            .poll(() => getColumnHeader(grid, "category").getAttribute("data-filtered"))
            .toBe("false");
    });

    test("reopening an applied filter preserves its selected value", async () => {
        await openFilter("category");
        await toggleFilterValue("beta");
        await filterOverlay().getByRole("button", { name: FILTER_STRINGS.apply }).click();
        await expect.poll(() => getDisplayedRowCount(grid)).toBe(2);
        await openFilter("category");
        await expect(filterOverlay().getByRole("checkbox", { name: "beta" })).toBeChecked();
        await expect(filterOverlay().getByRole("checkbox", { name: "alpha" })).not.toBeChecked();
        await clearFilter();
    });

    test("the value list offers NULL as its own entry", async () => {
        await openFilter("color");

        await expect(
            filterOverlay().getByRole("checkbox", { name: FILTER_STRINGS.nullValue }),
        ).toBeVisible();

        await clearFilter();
    });

    test("filtering for NULL keeps only the SQL NULL row", async () => {
        await openFilter("color");
        await toggleFilterValue(FILTER_STRINGS.nullValue);
        await filterOverlay().getByRole("button", { name: FILTER_STRINGS.apply }).click();
        await expect.poll(() => getDisplayedRowCount(grid)).toBe(1);
        await expect(getCell(grid, 0, 0)).toHaveText("4");
    });

    test("the filter overlay opens from the in-header filter button", async () => {
        await getColumnHeader(grid, "category").locator(".slick-header-filterbutton").click();

        await expect(filterOverlay()).toBeVisible();
        await clearFilter();
    });

    test("the filter overlay opens from the keyboard shortcut", async () => {
        const { page } = getContext();
        await clickCell(grid, 0, 1);
        await page.keyboard.press("Control+Alt+F");

        await expect(filterOverlay()).toBeVisible();
        await clearFilter();
    });

    test("freezing a column moves the frozen boundary and unfreezing restores it", async () => {
        // The row number column is frozen on its own by default.
        await expect(grid).toHaveAttribute("data-frozen-index", "0");

        await openHeaderContextMenu(grid, "category");
        await clickMenuItem(resultsFrame, HEADER_MENU.freezeColumns);
        await expect.poll(() => grid.getAttribute("data-frozen-index")).not.toBe("0");

        await openHeaderContextMenu(grid, "category");
        await clickMenuItem(resultsFrame, HEADER_MENU.unfreezeColumns);
        await expect(grid).toHaveAttribute("data-frozen-index", "0");
    });

    test("the grid menu clears an applied filter", async () => {
        await openFilter("category");
        await toggleFilterValue("alpha");
        await filterOverlay().getByRole("button", { name: FILTER_STRINGS.apply }).click();
        await expect.poll(() => getDisplayedRowCount(grid)).toBe(2);

        await openGridMenu(grid);
        await clickMenuItem(resultsFrame, GRID_MENU_LABELS.clearAllFilters);

        await expect.poll(() => getDisplayedRowCount(grid)).toBe(FILTERABLE_ROW_COUNT);
    });

    test("Clear all filters removes two composed filters at once", async () => {
        await openFilter("category");
        await toggleFilterValue("alpha");
        await filterOverlay().getByRole("button", { name: FILTER_STRINGS.apply }).click();
        await openFilter("color");
        await toggleFilterValue("red");
        await filterOverlay().getByRole("button", { name: FILTER_STRINGS.apply }).click();
        await expect.poll(() => getDisplayedRowCount(grid)).toBe(1);
        await openGridMenu(grid);
        await clickMenuItem(resultsFrame, GRID_MENU_LABELS.clearAllFilters);
        await expect.poll(() => getDisplayedRowCount(grid)).toBe(FILTERABLE_ROW_COUNT);
        await expect(getColumnHeader(grid, "category")).toHaveAttribute("data-filtered", "false");
        await expect(getColumnHeader(grid, "color")).toHaveAttribute("data-filtered", "false");
    });

    test("the grid menu clears an applied sort", async () => {
        await getColumnHeader(grid, "id").locator(".slick-header-sortbutton").click();
        await expect.poll(() => sortDirection("id")).toBe("asc");

        await openGridMenu(grid);
        await clickMenuItem(resultsFrame, GRID_MENU_LABELS.clearSort);

        await expect.poll(() => sortDirection("id")).toBe("none");
    });

    test("the resize dialog opens from the header context menu", async () => {
        await openHeaderContextMenu(grid, "category");
        await clickMenuItem(resultsFrame, HEADER_MENU.resize);

        const dialog = resultsFrame.getByRole("dialog").filter({ hasText: "Resize" }).first();
        await expect(dialog).toBeVisible();
        const originalWidth = await dialog.locator('input[type="number"]').inputValue();
        await dialog.locator('input[type="number"]').fill(String(Number(originalWidth) + 20));

        await getContext().page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await openHeaderContextMenu(grid, "category");
        await clickMenuItem(resultsFrame, HEADER_MENU.resize);
        await expect(dialog.locator('input[type="number"]')).toHaveValue(originalWidth);
        await dialog.getByRole("button", { name: "Cancel" }).last().click();
    });

    test("filters compose across two columns", async () => {
        await openFilter("category");
        await toggleFilterValue("alpha");
        await filterOverlay().getByRole("button", { name: FILTER_STRINGS.apply }).click();
        await expect.poll(() => getDisplayedRowCount(grid)).toBe(2);

        await openFilter("color");
        await toggleFilterValue("red");
        await filterOverlay().getByRole("button", { name: FILTER_STRINGS.apply }).click();
        await expect.poll(() => getDisplayedRowCount(grid)).toBe(1);
        await expect(getCell(grid, 0, 0)).toHaveText("1");
    });

    test("another column's filter narrows the value list but the current filter does not", async () => {
        await openFilter("category");
        await toggleFilterValue("alpha");
        await filterOverlay().getByRole("button", { name: FILTER_STRINGS.apply }).click();
        await openFilter("category");
        await expect(filterOverlay().getByRole("checkbox", { name: "gamma" })).toBeVisible();
        await clearFilter();

        await openFilter("category");
        await toggleFilterValue("alpha");
        await filterOverlay().getByRole("button", { name: FILTER_STRINGS.apply }).click();
        await openFilter("color");
        await expect(filterOverlay().getByRole("checkbox", { name: "red" })).toBeVisible();
        await expect(filterOverlay().getByRole("checkbox", { name: "blue" })).toBeVisible();
        await expect(
            filterOverlay().getByRole("checkbox", { name: FILTER_STRINGS.nullValue }),
        ).toHaveCount(0);
        await clearFilter();
    });

    test("sort and filter survive switching to another query editor and back", async () => {
        const { page } = getContext();
        await openFilter("category");
        await toggleFilterValue("alpha");
        await filterOverlay().getByRole("button", { name: FILTER_STRINGS.apply }).click();
        await expect(grid).toHaveAttribute("data-row-count", "2");

        const sortButton = getColumnHeader(grid, "id").locator(".slick-header-sortbutton");
        await sortButton.click();
        await sortButton.click();
        await expect(getColumnHeader(grid, "id")).toHaveAttribute("data-sort-direction", "desc");
        await expect(getCell(grid, 0, 0)).toHaveText("2");

        await openHeaderContextMenu(grid, "category");
        await clickMenuItem(resultsFrame, HEADER_MENU.resize);
        const resizeDialog = resultsFrame.getByRole("dialog").filter({ hasText: "Resize" }).first();
        const widthInput = resizeDialog.locator('input[type="number"]');
        const originalWidth = Number(await widthInput.inputValue());
        const resizedWidth = originalWidth + 24;
        await widthInput.fill(String(resizedWidth));
        await resizeDialog.getByRole("button", { name: "Resize" }).last().click();
        await expect(resizeDialog).toBeHidden();

        await openNewQueryEditor(page);
        await page
            .getByRole("tab", { name: /Untitled-1/ })
            .first()
            .click();
        await expect(grid).toHaveAttribute("data-row-count", "2");
        await expect(getColumnHeader(grid, "category")).toHaveAttribute("data-filtered", "true");
        await expect(getColumnHeader(grid, "id")).toHaveAttribute("data-sort-direction", "desc");
        await expect(getCell(grid, 0, 0)).toHaveText("2");
        await openHeaderContextMenu(grid, "category");
        await clickMenuItem(resultsFrame, HEADER_MENU.resize);
        await expect(widthInput).toHaveValue(String(resizedWidth));
        await widthInput.fill(String(originalWidth));
        await resizeDialog.getByRole("button", { name: "Resize" }).last().click();
    });

    test("select-all becomes indeterminate after choosing one value", async () => {
        await openFilter("category");
        await toggleFilterValue("alpha");
        await expect(
            filterOverlay().getByRole("checkbox", { name: FILTER_STRINGS.selectAll }),
        ).toHaveJSProperty("indeterminate", true);
        await clearFilter();
    });

    test("filter focus wraps between Clear and Close without escaping the overlay", async () => {
        const { page } = getContext();
        await openFilter("category");
        const overlay = filterOverlay();
        const clearButton = overlay.getByRole("button", { name: FILTER_STRINGS.clear });
        const closeButton = overlay.getByRole("button", { name: "Close" });
        await clearButton.focus();
        await page.keyboard.press("Tab");
        await expect(closeButton).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await expect(clearButton).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(closeButton).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(overlay.getByRole("searchbox")).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(
            overlay.getByRole("checkbox", { name: FILTER_STRINGS.selectAll }),
        ).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(overlay.getByRole("listbox", { name: "Filter Options" })).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(overlay.getByRole("button", { name: FILTER_STRINGS.apply })).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(clearButton).toBeFocused();
        await clearFilter();
    });

    test("selecting every value leaves no active filter", async () => {
        await openFilter("category");
        await filterOverlay().getByRole("checkbox", { name: FILTER_STRINGS.selectAll }).click();
        await filterOverlay().getByRole("button", { name: FILTER_STRINGS.apply }).click();
        await expect.poll(() => getDisplayedRowCount(grid)).toBe(FILTERABLE_ROW_COUNT);
        await expect(getColumnHeader(grid, "category")).toHaveAttribute("data-filtered", "false");
    });

    test("resize dialog rejects an invalid width and applies a valid width", async () => {
        async function openResize(): Promise<Locator> {
            await openHeaderContextMenu(grid, "category");
            await clickMenuItem(resultsFrame, HEADER_MENU.resize);
            const dialog = resultsFrame.getByRole("dialog").filter({ hasText: "Resize" }).first();
            await expect(dialog).toBeVisible();
            return dialog;
        }
        let dialog = await openResize();
        const input = dialog.locator('input[type="number"]');
        const originalWidth = Number(await input.inputValue());
        const minWidth = Number(await input.getAttribute("min"));
        await input.fill(String(minWidth - 1));
        await expect(dialog.getByRole("button", { name: "Resize" })).toBeDisabled();
        await input.fill(String(originalWidth + 30));
        await dialog.getByRole("button", { name: "Resize" }).click();
        await expect(dialog).toBeHidden();
        dialog = await openResize();
        await expect(dialog.locator('input[type="number"]')).toHaveValue(
            String(originalWidth + 30),
        );
        await dialog.locator('input[type="number"]').fill(String(originalWidth));
        await dialog.getByRole("button", { name: "Resize" }).click();
        await expect(dialog).toBeHidden();
    });

    test("double-clicking a column edge fits its header and cell content", async () => {
        const header = getColumnHeader(grid, "category");
        const originalWidth = (await header.boundingBox())!.width;
        async function setWidth(width: number): Promise<void> {
            await openHeaderContextMenu(grid, "category");
            await clickMenuItem(resultsFrame, HEADER_MENU.resize);
            const dialog = resultsFrame.getByRole("dialog").filter({ hasText: "Resize" }).first();
            await dialog.locator('input[type="number"]').fill(String(width));
            await dialog.getByRole("button", { name: "Resize" }).last().click();
            await expect(dialog).toBeHidden();
        }

        await openHeaderContextMenu(grid, "category");
        await clickMenuItem(resultsFrame, HEADER_MENU.resize);
        const dialog = resultsFrame.getByRole("dialog").filter({ hasText: "Resize" }).first();
        const minimumWidth = Number(
            await dialog.locator('input[type="number"]').getAttribute("min"),
        );
        await dialog.locator('input[type="number"]').fill(String(minimumWidth));
        await dialog.getByRole("button", { name: "Resize" }).last().click();
        await expect(dialog).toBeHidden();
        try {
            await header.locator(".slick-resizable-handle").dblclick();
            await expect
                .poll(async () => (await header.boundingBox())?.width ?? 0)
                .toBeGreaterThan(minimumWidth + 15);
        } finally {
            await setWidth(Math.round(originalWidth));
        }
    });

    test("Show all columns restores a column hidden through SlickGrid's picker", async () => {
        await openGridMenu(grid);
        const categoryPicker = resultsFrame.locator(
            '.slick-column-picker-list input[type="checkbox"][data-columnid="1"]',
        );
        await expect(categoryPicker).toBeChecked();
        // SlickGrid visually hides the native input and makes its label the hit target.
        await categoryPicker.locator("xpath=ancestor::label[1]").click();
        await expect(categoryPicker).not.toBeChecked();
        await expect(getColumnHeader(grid, "category")).toHaveCount(0);
        await getContext().page.keyboard.press("Escape");
        await openGridMenu(grid);
        await clickMenuItem(resultsFrame, GRID_MENU_LABELS.showAllColumns);
        await expect(getColumnHeader(grid, "category")).toBeVisible();
    });

    test("empty and whitespace-only strings appear as Blanks in the filter", async () => {
        const { electronApp, page } = getContext();
        await setQueryText(electronApp, page, BLANK_FILTER_QUERY);
        await executeQueryAndWait(page);
        grid = await waitForResultGrid(resultsFrame, "0_0", 3);
        try {
            await openFilter("color");
            await expect(filterOverlay().getByRole("checkbox", { name: "Blanks" })).toBeVisible();
            await toggleFilterValue("Blanks");
            await filterOverlay().getByRole("button", { name: FILTER_STRINGS.apply }).click();
            await expect.poll(() => getDisplayedRowCount(grid)).toBe(2);
        } finally {
            await setQueryText(electronApp, page, FILTERABLE_QUERY);
            await executeQueryAndWait(page);
            grid = await waitForResultGrid(resultsFrame, "0_0", FILTERABLE_ROW_COUNT);
        }
    });

    test("row-number column can be resized and its width survives an editor switch", async () => {
        const { page } = getContext();
        const rowHeader = grid.locator(".slick-header-column.fluent-result-grid-row-number-header");
        const resizeHandle = rowHeader.locator(".slick-resizable-handle");
        const initialWidth = (await rowHeader.boundingBox())!.width;

        async function dragResizeHandle(deltaX: number): Promise<void> {
            const box = (await resizeHandle.boundingBox())!;
            const x = box.x + box.width / 2;
            const y = box.y + box.height / 2;
            await page.mouse.move(x, y);
            await page.mouse.down();
            await page.mouse.move(x + deltaX, y, { steps: 5 });
            await page.mouse.up();
        }

        await dragResizeHandle(40);
        await expect
            .poll(async () => (await rowHeader.boundingBox())!.width)
            .toBeGreaterThan(initialWidth + 20);
        const resizedWidth = (await rowHeader.boundingBox())!.width;
        try {
            await openNewQueryEditor(page);
            await page
                .getByRole("tab", { name: /Untitled-1/ })
                .first()
                .click();
            await expect(rowHeader).toBeVisible();
            await expect
                .poll(async () => (await rowHeader.boundingBox())?.width ?? 0)
                .toBeGreaterThan(resizedWidth - 2);
        } finally {
            await dragResizeHandle(initialWidth - resizedWidth);
            await expect
                .poll(async () => (await rowHeader.boundingBox())!.width)
                .toBeLessThan(initialWidth + 3);
        }
    });
});
