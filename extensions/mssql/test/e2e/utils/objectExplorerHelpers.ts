/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Page } from "@playwright/test";
import { getModifierKey, waitForCommandPaletteToBeVisible } from "./testHelpers";
import * as os from "os";
import * as path from "path";

/**
 * Expands a node in the Object Explorer tree by clicking on it.
 * If the node is already expanded, this is a no-op.
 */
export async function expandObjectExplorerNode(
    vsCodePage: Page,
    nodeAriaLabelPattern: string,
    timeoutMs = 30 * 1000,
): Promise<void> {
    const node = vsCodePage
        .locator(`[role="treeitem"][aria-label*="${nodeAriaLabelPattern}"]`)
        .first();
    await node.waitFor({ state: "visible", timeout: timeoutMs });

    const isExpanded = await node.getAttribute("aria-expanded");
    if (isExpanded !== "true") {
        await node.click();
        await expect(node).toHaveAttribute("aria-expanded", "true", { timeout: timeoutMs });
    }
}

/**
 * Waits for a tree node with the given aria-label pattern to become visible
 * in the Object Explorer.
 */
export async function waitForObjectExplorerNode(
    vsCodePage: Page,
    nodeAriaLabelPattern: string,
    timeoutMs = 30 * 1000,
): Promise<void> {
    const node = vsCodePage
        .locator(`[role="treeitem"][aria-label*="${nodeAriaLabelPattern}"]`)
        .first();
    await node.waitFor({ state: "visible", timeout: timeoutMs });
}

/**
 * Right-clicks a node in the Object Explorer tree and waits for the context menu.
 */
export async function rightClickObjectExplorerNode(
    vsCodePage: Page,
    nodeAriaLabelPattern: string,
    timeoutMs = 30 * 1000,
): Promise<void> {
    const node = vsCodePage
        .locator(`[role="treeitem"][aria-label*="${nodeAriaLabelPattern}"]`)
        .first();
    await node.waitFor({ state: "visible", timeout: timeoutMs });
    await node.click({ button: "right" });
    // Wait for a context menu to appear
    await vsCodePage
        .locator('[role="menu"], .context-view.monaco-menu-container')
        .first()
        .waitFor({ state: "visible", timeout: 10 * 1000 });
}

/**
 * Clicks a menu item in the VS Code context menu by its visible text label.
 */
export async function clickContextMenuItem(vsCodePage: Page, menuItemLabel: string): Promise<void> {
    const menuItem = vsCodePage
        .locator(`[role="menuitem"]`)
        .filter({ hasText: menuItemLabel })
        .first();
    await menuItem.waitFor({ state: "visible", timeout: 10 * 1000 });
    await menuItem.click();
}

/**
 * Opens the MSSQL command palette and runs a specific command.
 */
export async function runMssqlCommand(vsCodePage: Page, command: string): Promise<void> {
    await vsCodePage.keyboard.press(`${getModifierKey()}+P`);
    await waitForCommandPaletteToBeVisible(vsCodePage);
    await vsCodePage.keyboard.type(`>MS SQL: ${command}`);
    await waitForCommandPaletteToBeVisible(vsCodePage);
    await vsCodePage.keyboard.press("Enter");
}

/**
 * Returns a unique temp-file path for test artifacts.
 */
export function getTempFilePath(baseName: string, extension: string): string {
    return path.join(os.tmpdir(), `${baseName}-${Date.now()}.${extension}`);
}

/**
 * Waits for a running query to finish (cancel button disappears).
 */
export async function waitForQueryToComplete(
    vsCodePage: Page,
    timeoutMs = 60 * 1000,
): Promise<void> {
    const cancelButton = vsCodePage.locator('[aria-label^="Cancel Connection"]').first();
    if (await cancelButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expect(cancelButton).toBeHidden({ timeout: timeoutMs });
    }
}
