/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator, Locator } from "@playwright/test";
import { test, expect } from "../baseFixtures";
import { useSharedVsCodeLifecycle } from "../utils/testLifecycle";
import { clearClipboard, getModifierKey, readClipboard } from "../utils/testHelpers";
import { getGridLaunchConfig } from "./gridLaunchConfig";
import {
    GRID_COMMAND_LABELS,
    GRID_MENU_LABELS,
    clickCell,
    clickMenuItem,
    getCell,
    getColumnHeader,
    getDisplayedRowCount,
    openCellContextMenu,
    openGridMenu,
    openHeaderContextMenu,
    resetGrid,
    runCopyAsCommand,
    stageQuery,
} from "./gridActions";
import { MIXED_TYPES_QUERY, MIXED_TYPES_ROW_COUNT } from "./gridFixtures";

/**
 * Clipboard and cell-formatting coverage for the preview results grid.
 *
 * The fixture query runs once for the whole file; each test operates on the grid that is already
 * on screen and hands it back in the state it found it. That is what keeps the suite inside its
 * time budget - re-running the query per test would cost seconds, relaunching VS Code a minute.
 */
test.describe("MSSQL Extension - Preview Grid Clipboard", () => {
    let resultsFrame: FrameLocator;
    let grid: Locator;

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: {
            initialConfig: getGridLaunchConfig(),
        },
        afterLaunch: async ({ electronApp, page }) => {
            const staged = await stageQuery(electronApp, page, MIXED_TYPES_QUERY, {
                minRows: MIXED_TYPES_ROW_COUNT,
            });
            resultsFrame = staged.resultsFrame;
            grid = staged.grid;
        },
    });

    test.afterEach(async () => {
        await resetGrid(grid, MIXED_TYPES_ROW_COUNT);
    });

    /** Opens the cell context menu and runs one of its top-level commands. */
    async function runCellCommand(row: number, column: number, label: string): Promise<void> {
        await openCellContextMenu(grid, row, column);
        await clickMenuItem(resultsFrame, label);
    }

    test("stages the fixture with every row displayed", async () => {
        expect(await getDisplayedRowCount(grid)).toBe(MIXED_TYPES_ROW_COUNT);
    });

    test("copies a single cell with the copy shortcut", async () => {
        const { electronApp, page } = getContext();
        await clearClipboard(electronApp);

        await clickCell(grid, 0, 1);
        await page.keyboard.press(`${getModifierKey()}+C`);

        await expect.poll(() => readClipboard(electronApp)).toContain("Ada");
    });

    test("copies a single cell with Ctrl+Insert", async () => {
        const { electronApp, page } = getContext();
        await clearClipboard(electronApp);

        await clickCell(grid, 0, 1);
        await page.keyboard.press("Control+Insert");

        await expect.poll(() => readClipboard(electronApp)).toContain("Ada");
    });

    test("copies with headers from the context menu", async () => {
        const { electronApp } = getContext();
        await clearClipboard(electronApp);

        await clickCell(grid, 0, 1);
        await runCellCommand(0, 1, GRID_COMMAND_LABELS.copyWithHeaders);

        await expect.poll(() => readClipboard(electronApp)).toContain("name");
        expect(await readClipboard(electronApp)).toContain("Ada");
    });

    test("copies headers without the row data", async () => {
        const { electronApp } = getContext();
        await clearClipboard(electronApp);

        await clickCell(grid, 0, 1);
        await runCellCommand(0, 1, GRID_COMMAND_LABELS.copyHeaders);

        await expect.poll(() => readClipboard(electronApp)).toContain("name");
        expect(await readClipboard(electronApp)).not.toContain("Ada");
    });

    test("copies with the copy shortcut honouring a multi-row selection", async () => {
        const { electronApp, page } = getContext();
        await clearClipboard(electronApp);

        await clickCell(grid, 0, 1);
        await clickCell(grid, 1, 1, { modifiers: ["Shift"] });
        await page.keyboard.press(`${getModifierKey()}+C`);

        // The copy round-trips through the extension host before the clipboard is written,
        // so the first read can still see the cleared value.
        await expect.poll(() => readClipboard(electronApp)).toContain("Ada");
        expect(await readClipboard(electronApp)).toContain("Bo");
    });

    test("copies as CSV", async () => {
        const { electronApp } = getContext();
        await clearClipboard(electronApp);

        await clickCell(grid, 0, 1);
        await runCopyAsCommand(grid, resultsFrame, 0, 1, GRID_COMMAND_LABELS.copyAsCsv);

        await expect.poll(() => readClipboard(electronApp)).toContain("Ada");
    });

    test("copies as parseable JSON", async () => {
        const { electronApp } = getContext();
        await clearClipboard(electronApp);

        await clickCell(grid, 0, 1);
        await runCopyAsCommand(grid, resultsFrame, 0, 1, GRID_COMMAND_LABELS.copyAsJson);

        await expect.poll(() => readClipboard(electronApp)).toContain("Ada");
        const copied = await readClipboard(electronApp);
        expect(() => JSON.parse(copied) as unknown).not.toThrow();
    });

    test("copies as an IN clause", async () => {
        const { electronApp } = getContext();
        await clearClipboard(electronApp);

        await clickCell(grid, 0, 1);
        await runCopyAsCommand(grid, resultsFrame, 0, 1, GRID_COMMAND_LABELS.copyAsInClause);

        await expect.poll(() => readClipboard(electronApp)).toContain("'Ada'");
    });

    test("copies as an INSERT INTO statement", async () => {
        const { electronApp } = getContext();
        await clearClipboard(electronApp);

        await clickCell(grid, 0, 1);
        await runCopyAsCommand(grid, resultsFrame, 0, 1, GRID_COMMAND_LABELS.copyAsInsertInto);

        await expect.poll(() => readClipboard(electronApp)).toContain("INSERT");
    });

    test("copies the column name bracket-quoted", async () => {
        const { electronApp } = getContext();
        await clearClipboard(electronApp);

        await openHeaderContextMenu(grid, "name");
        await clickMenuItem(resultsFrame, GRID_COMMAND_LABELS.copyColumnName);

        await expect.poll(() => readClipboard(electronApp)).toBe("[name]");
    });

    test("selects every cell with the select-all shortcut and copies the whole set", async () => {
        const { electronApp, page } = getContext();
        await clearClipboard(electronApp);

        await clickCell(grid, 0, 0);
        await page.keyboard.press(`${getModifierKey()}+A`);
        await page.keyboard.press(`${getModifierKey()}+C`);

        await expect.poll(() => readClipboard(electronApp)).toContain("Ada");
        expect(await readClipboard(electronApp)).toContain("Eli");
    });

    test("renders NULL cells distinctly rather than as empty text", async () => {
        // Row 4 of the fixture is NULL in both the notes and amount columns.
        const nullCell = getCell(grid, 3, 2);
        await expect(nullCell).toContainText("NULL");
        await expect(nullCell.locator(".missing-value")).toHaveCount(1);
    });

    test("preserves leading spaces in cell text", async () => {
        // Row 2's name is two spaces then "Bo". HTML whitespace collapsing used to drop them.
        const cell = getCell(grid, 1, 1);
        await expect(cell).toHaveText(/^\s{2}Bo$/);
    });

    test("shows an embedded newline as a return glyph instead of wrapping", async () => {
        const cell = getCell(grid, 2, 2);
        await expect(cell).toContainText("↵");
    });

    test("truncates an over-long value in the cell", async () => {
        // Row 5's notes column is 400 characters; the formatter cuts at 250.
        const cell = getCell(grid, 4, 2);
        await expect(cell).toContainText("...");

        const rendered = (await cell.innerText()).trim();
        expect(rendered.length).toBeLessThan(400);
    });

    test("plain copy does not add a column header", async () => {
        const { electronApp, page } = getContext();
        await clearClipboard(electronApp);
        await clickCell(grid, 0, 1);
        await page.keyboard.press(`${getModifierKey()}+C`);
        await expect.poll(() => readClipboard(electronApp)).toContain("Ada");
        expect(await readClipboard(electronApp)).not.toContain("name");
    });

    test("plain copy retains leading spaces", async () => {
        const { electronApp, page } = getContext();
        await clearClipboard(electronApp);
        await clickCell(grid, 1, 1);
        await page.keyboard.press(`${getModifierKey()}+C`);
        await expect.poll(() => readClipboard(electronApp)).toContain("  Bo");
    });

    test("copying an over-long cell uses its full value rather than its display truncation", async () => {
        const { electronApp, page } = getContext();
        await clearClipboard(electronApp);
        await clickCell(grid, 4, 2);
        await page.keyboard.press(`${getModifierKey()}+C`);
        await expect.poll(async () => (await readClipboard(electronApp)).trim().length).toBe(400);
        expect((await readClipboard(electronApp)).trim()).toBe("x".repeat(400));
    });

    test("copying adjacent columns separates their values", async () => {
        const { electronApp, page } = getContext();
        await clearClipboard(electronApp);
        await clickCell(grid, 0, 0);
        await clickCell(grid, 0, 1, { modifiers: ["Shift"] });
        await page.keyboard.press(`${getModifierKey()}+C`);
        await expect.poll(() => readClipboard(electronApp)).toContain("1\tAda");
    });

    test("copying a rectangle preserves its row and column layout", async () => {
        const { electronApp, page } = getContext();
        await clearClipboard(electronApp);
        await clickCell(grid, 0, 0);
        await clickCell(grid, 1, 1, { modifiers: ["Shift"] });
        await page.keyboard.press(`${getModifierKey()}+C`);
        await expect.poll(() => readClipboard(electronApp)).toContain("1\tAda");
        expect(await readClipboard(electronApp)).toContain("2\t  Bo");
    });

    test("the copy-with-headers shortcut includes both selected column names", async () => {
        const { electronApp, page } = getContext();
        await clearClipboard(electronApp);
        await clickCell(grid, 0, 0);
        await clickCell(grid, 0, 1, { modifiers: ["Shift"] });
        await page.keyboard.press("Control+Shift+C");
        await expect.poll(() => readClipboard(electronApp)).toContain("id\tname");
        expect(await readClipboard(electronApp)).toContain("1\tAda");
    });

    test("copy headers includes the selected column span without row values", async () => {
        const { electronApp } = getContext();
        await clearClipboard(electronApp);
        await clickCell(grid, 0, 0);
        await clickCell(grid, 0, 2, { modifiers: ["Shift"] });
        await runCellCommand(0, 0, GRID_COMMAND_LABELS.copyHeaders);
        await expect.poll(() => readClipboard(electronApp)).toContain("id\tname\tnotes");
        expect(await readClipboard(electronApp)).not.toContain("Ada");
    });

    test("CSV copy includes each selected row", async () => {
        const { electronApp } = getContext();
        await clearClipboard(electronApp);
        await clickCell(grid, 0, 1);
        await clickCell(grid, 1, 1, { modifiers: ["Shift"] });
        await runCopyAsCommand(grid, resultsFrame, 0, 1, GRID_COMMAND_LABELS.copyAsCsv);
        await expect.poll(() => readClipboard(electronApp)).toContain("Ada");
        expect(await readClipboard(electronApp)).toContain("Bo");
    });

    test("JSON copy includes named fields for a selected row", async () => {
        const { electronApp } = getContext();
        await clearClipboard(electronApp);
        await clickCell(grid, 0, 0);
        await clickCell(grid, 0, 1, { modifiers: ["Shift"] });
        await runCopyAsCommand(grid, resultsFrame, 0, 0, GRID_COMMAND_LABELS.copyAsJson);
        await expect.poll(() => readClipboard(electronApp)).toContain("Ada");
        const copied = JSON.parse(await readClipboard(electronApp)) as unknown;
        expect(JSON.stringify(copied)).toContain("name");
        expect(JSON.stringify(copied)).toContain("id");
    });

    test("IN-clause copy includes multiple selected values", async () => {
        const { electronApp } = getContext();
        await clearClipboard(electronApp);
        await clickCell(grid, 0, 1);
        await clickCell(grid, 1, 1, { modifiers: ["Shift"] });
        await runCopyAsCommand(grid, resultsFrame, 0, 1, GRID_COMMAND_LABELS.copyAsInClause);
        await expect.poll(() => readClipboard(electronApp)).toContain("'Ada'");
        expect(await readClipboard(electronApp)).toContain("'  Bo'");
    });

    test("plain copy returns the numeric cell value", async () => {
        const { electronApp, page } = getContext();
        await clearClipboard(electronApp);
        await clickCell(grid, 0, 3);
        await page.keyboard.press(`${getModifierKey()}+C`);
        await expect.poll(() => readClipboard(electronApp)).toContain("12.50");
    });

    test("plain copy retains both lines of a multiline value", async () => {
        const { electronApp, page } = getContext();
        await clearClipboard(electronApp);
        await clickCell(grid, 2, 2);
        await page.keyboard.press(`${getModifierKey()}+C`);
        await expect.poll(() => readClipboard(electronApp)).toContain("line1");
        expect(await readClipboard(electronApp)).toContain("line2");
    });

    test("plain copy represents a SQL NULL distinctly from an empty clipboard", async () => {
        const { electronApp, page } = getContext();
        await clearClipboard(electronApp);
        await clickCell(grid, 3, 2);
        await page.keyboard.press(`${getModifierKey()}+C`);
        await expect.poll(() => readClipboard(electronApp)).toContain("NULL");
    });

    test("CSV copy separates adjacent selected columns", async () => {
        const { electronApp } = getContext();
        await clearClipboard(electronApp);
        await clickCell(grid, 0, 0);
        await clickCell(grid, 0, 1, { modifiers: ["Shift"] });
        await runCopyAsCommand(grid, resultsFrame, 0, 0, GRID_COMMAND_LABELS.copyAsCsv);
        await expect.poll(() => readClipboard(electronApp)).toContain("Ada");
        expect(await readClipboard(electronApp)).toContain(",");
    });

    test("JSON copy includes both rows of a range", async () => {
        const { electronApp } = getContext();
        await clearClipboard(electronApp);
        await clickCell(grid, 0, 1);
        await clickCell(grid, 1, 1, { modifiers: ["Shift"] });
        await runCopyAsCommand(grid, resultsFrame, 0, 1, GRID_COMMAND_LABELS.copyAsJson);
        await expect.poll(() => readClipboard(electronApp)).toContain("Ada");
        const copied = JSON.parse(await readClipboard(electronApp)) as unknown;
        expect(JSON.stringify(copied)).toContain("Bo");
    });

    test("IN-clause copy keeps numeric values unquoted", async () => {
        const { electronApp } = getContext();
        await clearClipboard(electronApp);
        await clickCell(grid, 0, 0);
        await clickCell(grid, 1, 0, { modifiers: ["Shift"] });
        await runCopyAsCommand(grid, resultsFrame, 0, 0, GRID_COMMAND_LABELS.copyAsInClause);
        await expect.poll(() => readClipboard(electronApp)).toContain("1");
        const copied = await readClipboard(electronApp);
        expect(copied).toContain("2");
        expect(copied).not.toContain("'1'");
    });

    test("INSERT copy includes selected column names", async () => {
        const { electronApp } = getContext();
        await clearClipboard(electronApp);
        await clickCell(grid, 0, 0);
        await clickCell(grid, 0, 1, { modifiers: ["Shift"] });
        await runCopyAsCommand(grid, resultsFrame, 0, 0, GRID_COMMAND_LABELS.copyAsInsertInto);
        await expect.poll(() => readClipboard(electronApp)).toContain("INSERT");
        const copied = await readClipboard(electronApp);
        expect(copied).toContain("id");
        expect(copied).toContain("name");
        expect(copied).toContain("Ada");
    });

    test("copying a disjoint selection includes both selected values", async () => {
        const { electronApp, page } = getContext();
        await clearClipboard(electronApp);
        await clickCell(grid, 0, 1);
        await clickCell(grid, 4, 1, { modifiers: ["Control"] });
        await page.keyboard.press(`${getModifierKey()}+C`);
        await expect.poll(() => readClipboard(electronApp)).toContain("Ada");
        expect(await readClipboard(electronApp)).toContain("Eli");
    });

    test("copying after sorting follows displayed order and source row values", async () => {
        const { electronApp, page } = getContext();
        const sortButton = getColumnHeader(grid, "id").locator(".slick-header-sortbutton");
        await sortButton.click();
        await sortButton.click();
        await expect(getColumnHeader(grid, "id")).toHaveAttribute("data-sort-direction", "desc");
        try {
            await clearClipboard(electronApp);
            await clickCell(grid, 0, 1);
            await clickCell(grid, 1, 1, { modifiers: ["Shift"] });
            await page.keyboard.press(`${getModifierKey()}+C`);
            await expect.poll(() => readClipboard(electronApp)).toContain("Eli");
            const copied = await readClipboard(electronApp);
            expect(copied.indexOf("Eli")).toBeLessThan(copied.indexOf("Dee"));
            expect(copied).not.toContain("Ada");
        } finally {
            await sortButton.click();
            await expect(getColumnHeader(grid, "id")).toHaveAttribute(
                "data-sort-direction",
                "none",
            );
        }
    });

    test("copying with no selected cell uses all visible rows and columns", async () => {
        const { electronApp, page } = getContext();
        await clearClipboard(electronApp);
        await clickCell(grid, 0, 0);
        await clickCell(grid, 0, 0, { modifiers: ["Control"] });
        await expect(grid.locator(".slick-cell.selected")).toHaveCount(0);
        await page.keyboard.press(`${getModifierKey()}+C`);
        await expect.poll(() => readClipboard(electronApp)).toContain("Ada");
        const copied = await readClipboard(electronApp);
        expect(copied).toContain("Eli");
        expect(copied).toContain("99.99");
    });

    test("copying a filtered row uses its source value", async () => {
        const { electronApp, page } = getContext();
        await getColumnHeader(grid, "id").locator(".slick-header-filterbutton").click();
        const overlay = resultsFrame.getByRole("dialog", { name: "Filter Options" });
        try {
            await expect(overlay).toBeVisible();
            await expect.poll(() => overlay.getByRole("checkbox").count()).toBeGreaterThan(2);
            await overlay.locator('input:not([type="checkbox"])').fill("5");
            const choice = overlay.getByRole("checkbox", { name: "5", exact: true });
            if (!(await choice.isChecked())) {
                await overlay.getByRole("listbox", { name: "Filter Options" }).focus();
                await page.keyboard.press("Space");
            }
            await expect(choice).toBeChecked();
            await overlay.getByRole("button", { name: "Apply" }).click();
            await expect(grid).toHaveAttribute("data-row-count", "1");
            await clearClipboard(electronApp);
            await clickCell(grid, 0, 1);
            await page.keyboard.press(`${getModifierKey()}+C`);
            await expect.poll(() => readClipboard(electronApp)).toContain("Eli");
            expect(await readClipboard(electronApp)).not.toContain("Ada");
        } finally {
            if (await overlay.isVisible()) {
                await page.keyboard.press("Escape");
            }
            if ((await getColumnHeader(grid, "id").getAttribute("data-filtered")) === "true") {
                await openGridMenu(grid);
                await clickMenuItem(resultsFrame, GRID_MENU_LABELS.clearAllFilters);
            }
            await expect(grid).toHaveAttribute("data-row-count", String(MIXED_TYPES_ROW_COUNT));
        }
    });

    test("copy announces completion in the in-grid live region", async () => {
        const { electronApp, page } = getContext();
        await clearClipboard(electronApp);
        await clickCell(grid, 0, 1);
        await page.keyboard.press(`${getModifierKey()}+C`);
        await expect.poll(() => readClipboard(electronApp)).toContain("Ada");
        const indicator = resultsFrame.locator('[role="status"][aria-live="polite"]').filter({
            hasText: "Copied",
        });
        await expect(indicator).toHaveAttribute("aria-live", "polite");
    });
});
