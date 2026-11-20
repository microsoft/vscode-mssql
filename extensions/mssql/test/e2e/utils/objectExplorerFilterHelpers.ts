/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, FrameLocator, Locator, Page } from "@playwright/test";
import {
    getObjectExplorerNode,
    getObjectExplorerPane,
    runObjectExplorerContextAction,
    waitForObjectExplorerToLoad,
} from "./seededConnection";
import { getWebviewByTitle, WEBVIEW_LOAD_TIMEOUT_MS } from "./testHelpers";

/** Title of the Object Explorer filter webview panel. */
export const FILTER_DIALOG_TITLE = "Object Explorer Filter";

/** How the filter dialog is opened from a folder node. */
export type FilterEntryPoint = "inline action" | "context menu";

/**
 * Matches a tree row whose label is exactly `label`.
 *
 * Tree rows expose "<label>, has actions" as their accessible name. The shared node helper anchors
 * with `\b`, which cannot match a label ending in ")", such as "Tables (filtered)".
 */
export function exactNodeLabel(label: string): RegExp {
    return new RegExp(`^${escapeRegExp(label)}(,|$)`);
}

/** Label of a filterable folder once a filter is applied to it. */
export function filteredLabel(label: string): string {
    return `${label} (filtered)`;
}

/** Matches a folder's tree row whether or not the folder is currently filtered. */
export function folderLabel(label: string): RegExp {
    return new RegExp(`^${escapeRegExp(label)}( \\(filtered\\))?(,|$)`);
}

/** The folder node, whether or not it is currently filtered. */
export function getFolderNode(page: Page, label: string): Locator {
    return getObjectExplorerNode(page, folderLabel(label));
}

/** Clicks one of a tree row's inline action buttons, which appear while the row is hovered. */
export async function clickInlineAction(page: Page, node: Locator, name: string): Promise<void> {
    await node.hover();
    const action = node.getByRole("button", { name, exact: true });
    await expect(action).toBeVisible();
    await action.click();
}

/** Opens the filter dialog for a folder node through the chosen entry point. */
export async function openFilterDialog(
    page: Page,
    node: Locator,
    entryPoint: FilterEntryPoint,
): Promise<FrameLocator> {
    if (entryPoint === "inline action") {
        await clickInlineAction(page, node, "Filter");
    } else {
        await runObjectExplorerContextAction(page, node, "Filter");
    }
    const dialog = await getWebviewByTitle(page, FILTER_DIALOG_TITLE);
    // The first dialog of a run renders while its webview is still loading.
    await expect(getFilterCriteria(dialog)).toBeVisible({ timeout: WEBVIEW_LOAD_TIMEOUT_MS });
    return dialog;
}

/** The grid of property rows in the filter dialog. */
export function getFilterCriteria(dialog: FrameLocator): Locator {
    return dialog.getByRole("grid", { name: "Filter criteria" });
}

/** The value box of a property row, e.g. "Name" or "Schema". */
export function getFilterValueInput(dialog: FrameLocator, property: string): Locator {
    return getFilterCriteria(dialog).getByRole("textbox", {
        name: `${property} filter value`,
        exact: true,
    });
}

/** The operator dropdown of a property row. */
export function getFilterOperator(dialog: FrameLocator, property: string): Locator {
    return getFilterCriteria(dialog).getByRole("combobox", {
        name: `${property} filter operator`,
        exact: true,
    });
}

/** The per-row Clear button of a property row. */
export function getClearPropertyButton(dialog: FrameLocator, property: string): Locator {
    return getFilterCriteria(dialog).getByRole("button", {
        name: `Clear ${property} filter`,
        exact: true,
    });
}

/** Picks an operator such as "Starts With" for a property row. */
export async function selectFilterOperator(
    dialog: FrameLocator,
    property: string,
    operator: string,
): Promise<void> {
    const dropdown = getFilterOperator(dialog, property);
    const option = dialog.getByRole("option", { name: operator, exact: true });
    // The dialog moves focus to its Name box when the webview first gains focus, which can close
    // a dropdown opened by that same click, so retry until the list stays open.
    await expect(async () => {
        if ((await dropdown.getAttribute("aria-expanded")) !== "true") {
            await dropdown.click();
        }
        await expect(option).toBeVisible({ timeout: 2 * 1000 });
    }).toPass({ timeout: 15 * 1000 });
    await option.click();
    await expect(dropdown).toHaveText(operator);
}

/** Types values into property rows, keyed by property display name. */
export async function fillFilterValues(
    dialog: FrameLocator,
    values: Record<string, string>,
): Promise<void> {
    for (const [property, value] of Object.entries(values)) {
        const input = getFilterValueInput(dialog, property);
        await input.fill(value);
        await expect(input).toHaveValue(value);
    }
}

/** Clicks Apply and waits for the dialog panel to close. */
export async function applyFilterDialog(page: Page, dialog: FrameLocator): Promise<void> {
    await dialog.getByRole("button", { name: "Apply", exact: true }).click();
    await expectFilterDialogClosed(page);
}

/** Clicks Close and waits for the dialog panel to close. */
export async function closeFilterDialog(page: Page, dialog: FrameLocator): Promise<void> {
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expectFilterDialogClosed(page);
}

/** Waits until no filter dialog editor tab remains open. */
export async function expectFilterDialogClosed(page: Page): Promise<void> {
    await expect(getFilterDialogTab(page)).toHaveCount(0);
}

/** Closes a filter dialog a failed test may have left open, so the next test starts clean. */
export async function closeFilterDialogIfOpen(page: Page): Promise<void> {
    const tab = getFilterDialogTab(page);
    if ((await tab.count()) === 0) {
        return;
    }
    await tab.hover();
    await tab.getByRole("button", { name: /^Close/ }).click();
    await expectFilterDialogClosed(page);
}

/**
 * Waits for the folder to show the expected label, be expanded, and finish loading its
 * children. Applying or clearing a filter refreshes the folder and reveals it expanded.
 */
export async function waitForFolderState(
    page: Page,
    label: string,
    filtered: boolean,
): Promise<Locator> {
    const node = getObjectExplorerNode(
        page,
        exactNodeLabel(filtered ? filteredLabel(label) : label),
    );
    await expect(node).toBeVisible({ timeout: 30 * 1000 });
    await expect(node).toHaveAttribute("aria-expanded", "true");
    await waitForObjectExplorerToLoad(page);
    return node;
}

/**
 * Waits until the tree's visible rows matching `pattern` are exactly `expected`
 * (order-insensitive), e.g. the table nodes under a filtered Tables folder.
 */
export async function expectVisibleNodes(
    page: Page,
    pattern: RegExp,
    expected: string[],
): Promise<void> {
    await expect
        .poll(
            async () => {
                const labels = await getObjectExplorerPane(page)
                    .getByRole("treeitem")
                    .evaluateAll((rows) =>
                        rows.map((row) => (row.getAttribute("aria-label") ?? "").split(",")[0]),
                    );
                return labels.filter((label) => pattern.test(label)).sort();
            },
            { timeout: 30 * 1000 },
        )
        .toEqual([...expected].sort());
}

function getFilterDialogTab(page: Page): Locator {
    return page.getByRole("tab", { name: new RegExp(`^${escapeRegExp(FILTER_DIALOG_TITLE)}`) });
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
