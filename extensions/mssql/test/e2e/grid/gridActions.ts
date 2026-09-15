/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, FrameLocator, Locator, Page } from "@playwright/test";
import type { VsCodeAppHandle } from "../utils/launchVscodeWithMsSqlExt";
import {
    executeQueryAndWait,
    getWebviewByTitle,
    openNewQueryEditor,
    pickQuickInputItem,
    setQueryText,
    waitForConnected,
    waitForResultGrid,
} from "../utils/testHelpers";
import { getServerName } from "../utils/envConfigReader";
import { QuickInput, VsCodeCommand } from "../pageObjects";
import { GRID_PROFILE_NAME } from "./gridLaunchConfig";

export const RESULTS_WEBVIEW_TITLE = "Query Results";

/**
 * Command labels the grid renders, mirroring getQueryResultFluentGridStrings() in
 * queryResultFluentResultGrid.tsx. Grid-menu entries come from locConstants.slickGrid;
 * Clear Sort and the clipboard entries come from locConstants.queryResult.
 */
export const GRID_MENU_LABELS = {
    clearAllFilters: "Clear all filters",
    clearSort: "Clear Sort",
    showAllColumns: "Show all columns",
    freezeColumns: "Freeze columns",
    unfreezeColumns: "Unfreeze columns",
};

export const GRID_COMMAND_LABELS = {
    selectAll: "Select All",
    copy: "Copy",
    copyWithHeaders: "Copy with Headers",
    copyHeaders: "Copy Headers",
    copyAsCsv: "Copy as CSV",
    copyAsJson: "Copy as JSON",
    copyAsInClause: "Copy as IN clause",
    copyAsInsertInto: "Copy as INSERT INTO",
    copyColumnName: "Copy Column Name",
};

/** Resolves the Query Results webview frame. */
export function getResultsFrame(vsCodePage: Page): Promise<FrameLocator> {
    return getWebviewByTitle(vsCodePage, RESULTS_WEBVIEW_TITLE);
}

/**
 * Connects the active query editor to the seeded profile.
 *
 * The profile already exists in settings, so this only has to pick it out of the quick pick
 * rather than fill in a dialog.
 */
export async function connectActiveEditor(vsCodePage: Page): Promise<void> {
    // The editor has to exist before the command can target it. The Execute Query action only
    // appears once a SQL editor is active, so it is the honest readiness signal - opening the
    // palette earlier would run Connect against whatever document was previously focused.
    await expect(vsCodePage.locator('[aria-label^="Execute Query"]').first()).toBeVisible({
        timeout: 30 * 1000,
    });

    await new QuickInput(vsCodePage).run(VsCodeCommand.mssqlConnect);

    // Second quick pick: the saved connection profiles.
    await pickQuickInputItem(vsCodePage, GRID_PROFILE_NAME);

    await waitForConnected(vsCodePage, getServerName());
}

export interface StagedGrid {
    resultsFrame: FrameLocator;
    grid: Locator;
}

/**
 * Opens an editor, connects it, runs `sql` once, and returns the rendered grid.
 *
 * Called from a suite-level hook so the cost is paid once per spec file rather than per test.
 */
export async function stageQuery(
    app: VsCodeAppHandle,
    vsCodePage: Page,
    sql: string,
    options: { gridId?: string; minRows?: number } = {},
): Promise<StagedGrid> {
    await openNewQueryEditor(vsCodePage);
    await connectActiveEditor(vsCodePage);
    await setQueryText(app, vsCodePage, sql);
    await executeQueryAndWait(vsCodePage);

    const resultsFrame = await getResultsFrame(vsCodePage);
    const grid = await waitForResultGrid(
        resultsFrame,
        options.gridId ?? "0_0",
        options.minRows ?? 1,
    );
    return { resultsFrame, grid };
}

/** The grid's own count of displayed rows, which stays honest through filtering and streaming. */
export async function getDisplayedRowCount(grid: Locator): Promise<number> {
    return Number((await grid.getAttribute("data-row-count")) ?? "0");
}

/**
 * Addresses a data cell by its SlickGrid column classes.
 *
 * The grid renders with frozen panes: the row-number column sits in its own left canvas, so
 * `.slick-row` matches the frozen row as well as the data row, and the first `.slick-cell` inside
 * a frozen row is the row number rather than a data cell. The `l{n} r{n}` classes carry the
 * absolute column index instead, which is unambiguous across panes. Column 0 is the row number,
 * so data column `n` is `l{n+1} r{n+1}`, and `.nth(row)` walks the rendered rows in order.
 */
export function getCell(grid: Locator, row: number, dataColumn: number): Locator {
    const columnIndex = dataColumn + 1;
    return grid.locator(`.slick-cell.l${columnIndex}.r${columnIndex}`).nth(row);
}

/** The row-number cell for a rendered row, which lives in the frozen left canvas. */
export function getRowNumberCell(grid: Locator, row: number): Locator {
    return grid.locator(".fluent-result-grid-row-number-cell").nth(row);
}

/** A column header, matched on exact text so "id" cannot also match a column named "valid_id". */
export function getColumnHeader(grid: Locator, columnName: string): Locator {
    return grid
        .locator(".slick-header-column")
        .filter({ hasText: new RegExp(String.raw`^\s*` + columnName + String.raw`\s*$`) })
        .first();
}

/**
 * The clickable label inside a column header.
 *
 * SlickGrid renders the header text as `span.slick-column-name` (slickGrid.ts), and
 * fluentResultGridHeaderController.ts then inserts the sort and filter buttons after it. On a
 * narrow column those buttons cover the header's centre, so clicking the header element itself
 * hits a button instead of selecting the column.
 */
export function getColumnHeaderLabel(grid: Locator, columnName: string): Locator {
    return getColumnHeader(grid, columnName).locator(".slick-column-name");
}

/** Clicks a data cell, optionally with modifier keys held. */
export async function clickCell(
    grid: Locator,
    row: number,
    dataColumn: number,
    options: { modifiers?: Array<"Control" | "Shift" | "Meta" | "Alt"> } = {},
): Promise<void> {
    await getCell(grid, row, dataColumn).click({ modifiers: options.modifiers });
}

/**
 * Returns the grid to a known state so the next test starts from the same place.
 *
 * Deliberately cheap: it collapses the selection and returns the scroll position, which is all
 * most tests disturb. Anything that changes sort, filters or column visibility is responsible for
 * undoing that itself, so the common path stays at roughly 200ms - re-running the fixture query
 * would cost seconds and relaunching VS Code a minute.
 */
export async function resetGrid(grid: Locator, expectedRowCount: number): Promise<void> {
    await clickCell(grid, 0, 0);
    await grid.evaluate((element) => {
        for (const viewport of Array.from(element.querySelectorAll(".slick-viewport"))) {
            viewport.scrollTo({ left: 0, top: 0 });
        }
    });

    await expect
        .poll(() => getDisplayedRowCount(grid), {
            message: "Grid did not return to its staged row count after reset.",
        })
        .toBe(expectedRowCount);
}

/**
 * Clicks a menu item by its exact label.
 *
 * Fluent renders the keyboard shortcut as `secondaryContent` inside the same menu item, so the
 * item's text reads "Copy with Headers\nCtrl+Shift+C" and its accessible name carries the
 * shortcut too. Matching by role name with `exact` therefore never hits, and a substring match
 * would make "Copy" ambiguous with "Copy with Headers". Comparing the first line exactly is the
 * only unambiguous option.
 */
export async function clickMenuItem(resultsFrame: FrameLocator, label: string): Promise<void> {
    const items = resultsFrame.getByRole("menuitem");
    await expect
        .poll(() => items.count(), { message: "No menu items appeared." })
        .toBeGreaterThan(0);

    const labels: string[] = [];
    const count = await items.count();
    for (let index = 0; index < count; index++) {
        const item = items.nth(index);
        const firstLine = (await item.innerText()).split("\n")[0].trim();
        labels.push(firstLine);
        if (firstLine === label) {
            await item.click();
            return;
        }
    }

    throw new Error(`Menu item "${label}" not found. Visible items: ${labels.join(", ")}`);
}

/** Opens the context menu for a data cell. */
export async function openCellContextMenu(
    grid: Locator,
    row: number,
    dataColumn: number,
): Promise<void> {
    await getCell(grid, row, dataColumn).click({ button: "right" });
}

/** Opens the context menu for a column header. */
export async function openHeaderContextMenu(grid: Locator, columnName: string): Promise<void> {
    await getColumnHeader(grid, columnName).click({ button: "right" });
}

/** The "Copy as..." entry that nests the CSV, JSON, IN clause and INSERT INTO commands. */
export const COPY_AS_SUBMENU_LABEL = "Copy as...";

/** Opens the cell context menu, expands "Copy as...", and runs one of its commands. */
export async function runCopyAsCommand(
    grid: Locator,
    resultsFrame: FrameLocator,
    row: number,
    dataColumn: number,
    label: string,
): Promise<void> {
    await openCellContextMenu(grid, row, dataColumn);
    await clickMenuItem(resultsFrame, COPY_AS_SUBMENU_LABEL);
    await clickMenuItem(resultsFrame, label);
}

/**
 * Opens the grid menu - the hamburger button at the top right of the grid.
 *
 * SlickGrid renders it as `button.slick-grid-menu-button` with an "Grid Menu" aria-label
 * (slickGridMenu.ts); FluentSlickGrid configures its icon through the `gridMenu` grid option.
 * This is where Clear all filters, Clear Sort and Show all columns live.
 */
export async function openGridMenu(grid: Locator): Promise<void> {
    await grid.locator("button.slick-grid-menu-button").first().click();
}
