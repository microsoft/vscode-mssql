/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Locator, Page } from "@playwright/test";
import { QuickInput } from "../pageObjects/quickInput";
import { getObjectExplorerPane, waitForObjectExplorerToLoad } from "./seededConnection";
import { getModifierKey } from "./testHelpers";

/** Rows of the editor's suggest widget. */
export function getSuggestions(page: Page): Locator {
    return page.getByRole("listbox", { name: "Suggest" }).getByRole("option");
}

/**
 * A suggest widget row whose label is exactly `label`. Rows are named "<label>, <details>",
 * e.g. "master, File" or "sqlCreateDatabase, Create a new Database, Snippet".
 */
export function getSuggestion(page: Page, label: string): Locator {
    return page
        .getByRole("listbox", { name: "Suggest" })
        .getByRole("option", { name: new RegExp(`^${escapeRegExp(label)}, `) });
}

/** Whether the suggest widget's keyboard focus is on the row labelled `label`. */
export async function isSuggestionFocused(page: Page, label: string): Promise<boolean> {
    const focusedId = await page
        .getByRole("listbox", { name: "Suggest" })
        .getAttribute("aria-activedescendant");
    const suggestion = getSuggestion(page, label);
    return (
        !!focusedId &&
        (await suggestion.count()) > 0 &&
        focusedId === (await suggestion.getAttribute("id"))
    );
}

/** Focuses the active editor group through the command palette. */
export async function focusActiveEditor(page: Page): Promise<void> {
    await new QuickInput(page).runCommand(
        "View: Focus Active Editor Group",
        "View: Focus Active Editor Group",
    );
}

/** Empties the active editor and dismisses any open suggest widget. */
export async function clearActiveEditor(page: Page): Promise<void> {
    await focusActiveEditor(page);
    await page.keyboard.press("Escape");
    await page.keyboard.press(`${getModifierKey()}+A`);
    await page.keyboard.press("Delete");
}

/** Makes the SQL Server view visible with only its Connections pane expanded. */
export async function showObjectExplorer(page: Page): Promise<void> {
    await new QuickInput(page).runCommand("View: Show SQL Server", "View: Show SQL Server");
    await expect(getObjectExplorerPane(page)).toBeVisible({ timeout: 30 * 1000 });
    // Collapse the sibling panes so the Connections tree gets the whole side bar.
    for (const title of ["Query History", "Background Tasks"]) {
        const header = page.getByRole("button", { name: `${title} Section` });
        if ((await header.getAttribute("aria-expanded")) === "true") {
            await header.click();
            await expect(header).toHaveAttribute("aria-expanded", "false");
        }
    }
}

/**
 * Moves keyboard focus in the Object Explorer tree to the node with the given label at the given
 * tree depth and returns it. The depth disambiguates folders that repeat at several levels, such
 * as the server-level and database-level "Security" folders. Keyboard focus also makes the
 * virtualized tree render and reveal the row.
 */
export async function focusObjectExplorerNode(
    page: Page,
    label: string,
    level: number,
): Promise<Locator> {
    const pane = getObjectExplorerPane(page);
    const tree = pane.getByRole("tree");
    const node = pane
        .getByRole("treeitem", { name: new RegExp(`^${escapeRegExp(label)}\\b`) })
        .and(pane.locator(`[aria-level="${level}"]`));
    await tree.focus();
    let previousFocusedIndex: number | undefined;
    await expect
        .poll(
            async () => {
                // Read without auto-waiting: the row may not be rendered yet.
                const targetIndex = rowIndex(await node.evaluateAll((rows) => rows[0]?.id));
                const focusedIndex = rowIndex(await tree.getAttribute("aria-activedescendant"));
                if (targetIndex === undefined) {
                    // Page through the tree to render more rows, wrapping to the top at the end.
                    const isAtEnd =
                        focusedIndex !== undefined && focusedIndex === previousFocusedIndex;
                    previousFocusedIndex = focusedIndex;
                    await page.keyboard.press(isAtEnd ? "Home" : "PageDown");
                    return false;
                }
                if (focusedIndex === targetIndex) {
                    return true;
                }
                const key =
                    focusedIndex === undefined || targetIndex > focusedIndex
                        ? "ArrowDown"
                        : "ArrowUp";
                const steps = focusedIndex === undefined ? 1 : Math.abs(targetIndex - focusedIndex);
                for (let step = 0; step < steps; step++) {
                    await page.keyboard.press(key);
                }
                return false;
            },
            { timeout: 30 * 1000 },
        )
        .toBe(true);
    await expect(node).toBeVisible();
    return node;
}

/**
 * Expands each node along `labels`, where the first label is at tree depth `startLevel`, and
 * returns the last node, which is left focused (and collapsed when `expandLast` is false).
 */
export async function expandObjectExplorerLevels(
    page: Page,
    labels: string[],
    { startLevel = 1, expandLast = true } = {},
): Promise<Locator> {
    let node: Locator | undefined;
    for (let index = 0; index < labels.length; index++) {
        node = await focusObjectExplorerNode(page, labels[index], startLevel + index);
        const isLast = index === labels.length - 1;
        if ((!isLast || expandLast) && (await node.getAttribute("aria-expanded")) !== "true") {
            await page.keyboard.press("ArrowRight");
            await expect(node).toHaveAttribute("aria-expanded", "true", { timeout: 60 * 1000 });
            await waitForObjectExplorerToLoad(page);
        }
    }
    return node!;
}

/** Opens the context menu of the focused Object Explorer node from the keyboard. */
export async function openFocusedNodeContextMenu(page: Page): Promise<void> {
    await page.keyboard.press("Shift+F10");
    await expect(page.getByRole("menu").first()).toBeVisible({ timeout: 10 * 1000 });
}

/** Parses the row index from a list row id such as "list_id_4_12". */
function rowIndex(rowId: string | null | undefined): number | undefined {
    const match = rowId?.match(/_(\d+)$/);
    return match ? Number(match[1]) : undefined;
}

/** Closes the active editor, discarding unsaved changes. */
export async function revertAndCloseActiveEditor(page: Page): Promise<void> {
    await new QuickInput(page).runCommand(
        "View: Revert and Close Editor",
        "View: Revert and Close Editor",
    );
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
