/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, FrameLocator, Locator, Page } from "@playwright/test";
import { getServerName } from "./envConfigReader";
import {
    expandObjectExplorerPath,
    getObjectExplorerNode,
    runObjectExplorerContextAction,
    SEEDED_PROFILE_NAME,
} from "./seededConnection";
import { getWebviewByTitle } from "./testHelpers";

/** Object Explorer context menu entry that opens Global Database Search. */
export const SEARCH_MENU_LABEL = "Search Database Objects...";

/** Title of the Global Database Search webview panel for the e2e server. */
export function getSearchWebviewTitle(): string {
    return `Search Database Objects - ${getServerName()}`;
}

/** Editor tabs of the workbench editor area. */
function getEditorTabs(page: Page): Locator {
    return page.locator(".editor-group-container").getByRole("tab");
}

/**
 * Closes every open editor except those whose tab name contains `keep`, discarding changes.
 *
 * Each tab's own close button is used rather than a keyboard command: a webview editor can hold
 * keyboard focus, so a shortcut is not reliably delivered to the workbench. Untitled scripts the
 * search actions open are dirty, so their save prompt is answered with "Don't Save".
 */
export async function closeEditors(page: Page, keep?: string): Promise<void> {
    const tabs = getEditorTabs(page);
    const closable = keep ? tabs.filter({ hasNotText: keep }) : tabs;
    const dontSave = page.getByRole("dialog").getByRole("button", { name: "Don't Save" });
    for (let attempt = 0; attempt < 20; attempt++) {
        const count = await closable.count();
        if (count === 0) {
            return;
        }
        const tab = closable.first();
        await tab.hover();
        await tab.getByRole("button", { name: /^Close/ }).click();
        await expect
            .poll(async () => {
                if (await dontSave.isVisible()) {
                    await dontSave.click();
                }
                return closable.count();
            })
            .toBeLessThan(count);
    }
    throw new Error("Editors were still open after 20 close attempts.");
}

/**
 * Opens Global Database Search from an Object Explorer node's context menu.
 *
 * Any open editors are closed first so the returned frame is the only search panel. The server
 * node is used when `databaseName` is omitted.
 */
export async function openDatabaseSearch(page: Page, databaseName?: string): Promise<FrameLocator> {
    await closeEditors(page);
    await expandObjectExplorerPath(page, [SEEDED_PROFILE_NAME, "Databases"]);
    const node = getObjectExplorerNode(page, databaseName ?? SEEDED_PROFILE_NAME);
    await runObjectExplorerContextAction(page, node, SEARCH_MENU_LABEL);
    const search = await getWebviewByTitle(page, getSearchWebviewTitle(), 60 * 1000);
    await expect(search.getByRole("combobox", { name: "Database" })).toBeVisible({
        timeout: 60 * 1000,
    });
    return search;
}

/** The actions menu button of a search result, named after its schema-qualified object name. */
export function getResultActionsButton(search: FrameLocator, fullName: string): Locator {
    return search.getByRole("button", { name: `Actions for ${fullName}`, exact: true });
}

/** Every result's actions button; one per listed object. */
export function getAllResultActionButtons(search: FrameLocator): Locator {
    return search.getByRole("button", { name: /^Actions for / });
}

/** Reads the item labels of a search result's actions menu, closing the menu afterwards. */
export async function openResultActionsMenu(
    search: FrameLocator,
    fullName: string,
): Promise<string[]> {
    await getResultActionsButton(search, fullName).click();
    const items = search.getByRole("menu").getByRole("menuitem");
    await expect(items.first()).toBeVisible();
    const labels = (await items.allInnerTexts()).map((text) => text.trim());
    await search.getByRole("menu").press("Escape");
    await expect(search.getByRole("menu")).toBeHidden();
    return labels;
}

/**
 * Clicks an action in a search result's actions menu.
 *
 * The popover closes if the panel loses focus while it opens (e.g. as a previous editor closes),
 * so opening and clicking are retried together.
 */
export async function runResultAction(
    search: FrameLocator,
    fullName: string,
    action: string,
): Promise<void> {
    const item = search.getByRole("menu").getByRole("menuitem", { name: action, exact: true });
    await expect(async () => {
        if (!(await item.isVisible())) {
            await getResultActionsButton(search, fullName).click();
        }
        await item.click({ timeout: 5 * 1000 });
    }).toPass({ timeout: 30 * 1000 });
}
