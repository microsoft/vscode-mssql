/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, FrameLocator, Locator, Page } from "@playwright/test";
import { QuickInput } from "../pageObjects/quickInput";
import { runObjectExplorerContextAction } from "./seededConnection";
import { quoteName, runSql } from "./sqlClient";
import { getWebviewByTitle } from "./testHelpers";

/** Object Explorer context menu entry on server and database nodes. */
export const LAUNCH_PROFILER_MENU_LABEL = "Launch Query Profiler...";

/** Session creation and the first XEvent dispatch can take a while on a busy server. */
export const PROFILER_TIMEOUT_MS = 60 * 1000;

/** One rendered grid row, keyed by column header. */
export type ProfilerGridRow = Record<string, string>;

/** Title of the profiler webview panel for a session. */
export function getProfilerTitle(sessionName: string): string {
    return `Query Profiler: ${sessionName}`;
}

/**
 * Launches the profiler from an Object Explorer node: picks the template in the first quick pick,
 * replaces the default session name in the second, and waits for the session to be running.
 */
export async function launchProfilerFromNode(
    page: Page,
    node: Locator,
    templateName: string,
    sessionName: string,
): Promise<FrameLocator> {
    await runObjectExplorerContextAction(page, node, LAUNCH_PROFILER_MENU_LABEL);
    const quickInput = new QuickInput(page);
    await quickInput.pick(templateName, PROFILER_TIMEOUT_MS);
    await submitSessionName(page, sessionName);
    return waitForRunningProfiler(page, sessionName);
}

/** Answers the "Enter Name" input box that follows the template quick pick. */
export async function submitSessionName(page: Page, sessionName: string): Promise<void> {
    const quickInput = new QuickInput(page);
    await expect(quickInput.widget).toContainText("New Query Profiler - Enter Name");
    await quickInput.input.fill(sessionName);
    await expect(quickInput.input).toHaveValue(sessionName);
    await quickInput.input.press("Enter");
}

/** Resolves a session's profiler webview and waits until its toolbar reports it running. */
export async function waitForRunningProfiler(
    page: Page,
    sessionName: string,
): Promise<FrameLocator> {
    const profiler = await getWebviewByTitle(
        page,
        getProfilerTitle(sessionName),
        PROFILER_TIMEOUT_MS,
    );
    await expect(profiler.getByRole("button", { name: "Pause", exact: true })).toBeEnabled({
        timeout: PROFILER_TIMEOUT_MS,
    });
    return profiler;
}

/** The events grid of a profiler webview. */
export function getEventsGrid(profiler: FrameLocator): Locator {
    return profiler.getByRole("grid", { name: "Profiler events" });
}

/** A column header of the events grid, matched on the column name that starts its label. */
export function getColumnHeader(profiler: FrameLocator, columnName: string): Locator {
    return getEventsGrid(profiler).getByRole("columnheader", {
        name: new RegExp(`^${columnName}\\b`),
    });
}

/**
 * Reads the rendered rows of the events grid in display order.
 *
 * SlickGrid positions rows absolutely and appends them in render order, so DOM order is not
 * display order; each row's `data-row` index is what the grid itself uses to place it.
 */
export async function readGridRows(profiler: FrameLocator): Promise<ProfilerGridRow[]> {
    const grid = getEventsGrid(profiler);
    const headers = await grid
        .getByRole("columnheader")
        .evaluateAll((elements) =>
            elements.map(
                (element) =>
                    element.querySelector("[aria-label]")?.getAttribute("aria-label") ?? "",
            ),
        );
    const rows = await grid.getByRole("row").evaluateAll((elements) =>
        elements
            .map((element) => ({
                index: Number((element as HTMLElement).dataset.row),
                cells: Array.from(element.querySelectorAll('[role="gridcell"]')).map(
                    (cell) => cell.textContent ?? "",
                ),
            }))
            .filter((row) => row.cells.length > 0),
    );
    return rows
        .sort((left, right) => left.index - right.index)
        .map(({ cells }) =>
            Object.fromEntries(headers.map((header, column) => [header, cells[column] ?? ""])),
        );
}

/** Polls the rendered grid until `predicate` holds, then returns the rows it saw. */
export async function waitForGridRows(
    profiler: FrameLocator,
    predicate: (rows: ProfilerGridRow[]) => boolean,
    message: string,
): Promise<ProfilerGridRow[]> {
    let rows: ProfilerGridRow[] = [];
    await expect
        .poll(
            async () => {
                rows = await readGridRows(profiler);
                return predicate(rows);
            },
            { timeout: PROFILER_TIMEOUT_MS, message },
        )
        .toBe(true);
    return rows;
}

/** Types into the toolbar's quick filter, which matches any column. */
export async function setQuickFilter(profiler: FrameLocator, term: string): Promise<void> {
    const quickFilter = profiler.getByRole("textbox", { name: "Quick filter all columns..." });
    await quickFilter.fill(term);
    await expect(quickFilter).toHaveValue(term);
}

/** Clears every column filter and the quick filter if any is active. */
export async function clearAllFilters(profiler: FrameLocator): Promise<void> {
    const clearButton = profiler.getByRole("button", { name: "Clear All Filters" });
    if (await clearButton.isEnabled()) {
        await clearButton.click();
    }
    await expect(clearButton).toBeDisabled();
    await expect(
        profiler.getByRole("textbox", { name: "Quick filter all columns..." }),
    ).toHaveValue("");
}

/** Opens a column's filter popover from its header funnel button. */
export async function openColumnFilter(
    profiler: FrameLocator,
    columnName: string,
): Promise<Locator> {
    await getColumnHeader(profiler, columnName)
        .getByRole("button", { name: "Filter events by column values" })
        .click();
    const popover = profiler.getByRole("dialog", { name: `Filter: ${columnName}` });
    await expect(popover).toBeVisible();
    return popover;
}

/** Applies a "Contains" text filter to a column. */
export async function applyContainsFilter(
    profiler: FrameLocator,
    columnName: string,
    value: string,
): Promise<void> {
    const popover = await openColumnFilter(profiler, columnName);
    await expect(popover.getByRole("combobox", { name: "Filter operator" })).toHaveValue(
        "contains",
    );
    await popover.getByRole("textbox", { name: "Filter value" }).fill(value);
    await popover.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(popover).toBeHidden();
}

/** Applies a categorical filter that keeps only `value` in a column. */
export async function applyCategoryFilter(
    profiler: FrameLocator,
    columnName: string,
    value: string,
): Promise<void> {
    const popover = await openColumnFilter(profiler, columnName);
    const valueCheckbox = popover.getByRole("checkbox", { name: value, exact: true });
    await expect(valueCheckbox).toBeVisible({ timeout: PROFILER_TIMEOUT_MS });
    await popover.getByRole("button", { name: "Deselect All", exact: true }).click();
    await valueCheckbox.check();
    await expect(valueCheckbox).toBeChecked();
    await popover.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(popover).toBeHidden();
}

/** Runs marker batches against a database, one batch per statement, so each yields events. */
export async function runMarkerBatches(database: string, ...batches: string[]): Promise<void> {
    await runSql(batches.join("\nGO\n"), database);
}

/** Whether an XEvent session is currently running on the server. */
export async function isEventSessionRunning(sessionName: string): Promise<boolean> {
    const [rows] = await runSql(
        `SELECT COUNT(*) AS running FROM sys.dm_xe_sessions WHERE name = N'${sessionName.replace(/'/g, "''")}'`,
    );
    return Number(rows?.[0]?.running ?? 0) > 0;
}

/** Stops and drops a server-scoped XEvent session if it exists. */
export async function dropEventSessionIfExists(sessionName: string): Promise<void> {
    const literal = sessionName.replace(/'/g, "''");
    const quoted = quoteName(sessionName);
    await runSql(`
IF EXISTS (SELECT 1 FROM sys.dm_xe_sessions WHERE name = N'${literal}')
    ALTER EVENT SESSION ${quoted} ON SERVER STATE = STOP;
IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = N'${literal}')
    DROP EVENT SESSION ${quoted} ON SERVER;`);
}

/** Types a path into VS Code's simple save dialog and accepts it. */
export async function answerSimpleSaveDialog(page: Page, filePath: string): Promise<void> {
    const quickInput = new QuickInput(page);
    await expect(quickInput.input).toBeVisible({ timeout: PROFILER_TIMEOUT_MS });
    await quickInput.input.fill(filePath);
    await expect(quickInput.input).toHaveValue(filePath);
    await quickInput.input.press("Enter");
    await expect(quickInput.widget).toHaveCount(0, { timeout: PROFILER_TIMEOUT_MS });
}
