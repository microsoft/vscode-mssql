/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Locator, Page } from "@playwright/test";
import { getAuthenticationType, getPassword, getServerName, getUserName } from "./envConfigReader";
import { QuickInput, VsCodeCommand } from "../pageObjects";
import { pickQuickInputItem, waitForConnected } from "./testHelpers";

/** Profile name of the connection seeded into settings by {@link getSeededLaunchConfig}. */
export const SEEDED_PROFILE_NAME = "e2e-server";

/**
 * Editor settings that keep typed or inserted SQL from being rewritten by completions,
 * auto-closing pairs, or format-on-type. Suites that test IntelliSense override these.
 */
export const EDITOR_DETERMINISM = {
    "editor.acceptSuggestionOnEnter": "off",
    "editor.quickSuggestions": { other: false, comments: false, strings: false },
    "editor.suggestOnTriggerCharacters": false,
    "editor.wordBasedSuggestions": "off",
    "editor.tabCompletion": "off",
    "editor.parameterHints.enabled": false,
    "editor.autoClosingBrackets": "never",
    "editor.autoClosingQuotes": "never",
    "editor.formatOnType": false,
    "editor.formatOnPaste": false,
};

/** Builds the saved connection profile entry for the e2e server. */
export function getSeededConnectionProfile(
    profileName = SEEDED_PROFILE_NAME,
    database = "",
): Record<string, unknown> {
    return {
        profileName,
        server: getServerName(),
        database,
        authenticationType: getAuthenticationType() === "SQL Login" ? "SqlLogin" : "Integrated",
        user: getUserName(),
        password: getPassword(),
        // With savePassword false the extension uses the inline password from settings rather
        // than the credential store, so no prompt interrupts the test.
        savePassword: false,
        trustServerCertificate: true,
        connectTimeout: 30,
    };
}

/**
 * Builds settings.json for a VS Code instance that already has the e2e server saved, so a suite
 * can skip the connection dialog unless the dialog is what it is testing.
 *
 * Context menus are drawn by the workbench ("window.menuStyle": "custom") rather than the OS, and
 * file dialogs use VS Code's simple dialog, so both can be driven on macOS and Windows alike.
 */
export function getSeededLaunchConfig(
    overrides: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        "mssql.showChangelogOnUpdate": false,
        "mssql.openQueryResultsInTabByDefault": false,
        "mssql.openQueryResultsInTabByDefaultDoNotShowPrompt": true,
        "window.menuStyle": "custom",
        "files.simpleDialog.enable": true,
        "workbench.startupEditor": "none",
        "mssql.connections": [getSeededConnectionProfile()],
        ...EDITOR_DETERMINISM,
        ...overrides,
    };
}

/** Connects the active query editor to a saved profile through the Connect command. */
export async function connectActiveEditor(
    page: Page,
    profileName = SEEDED_PROFILE_NAME,
): Promise<void> {
    await expect(page.locator('[aria-label^="Execute Query"]').first()).toBeVisible({
        timeout: 30 * 1000,
    });
    await new QuickInput(page).run(VsCodeCommand.mssqlConnect);
    await pickQuickInputItem(page, profileName);
    await waitForConnected(page, getServerName());
}

/** The classic "Connections" Object Explorer pane. */
export function getObjectExplorerPane(page: Page): Locator {
    return page.locator(".pane").filter({
        has: page.getByRole("heading", { name: "Connections", exact: true }),
    });
}

/**
 * Finds an Object Explorer node by its label.
 *
 * Tree rows carry their label in `aria-label`, sometimes followed by status text, so the match is
 * anchored at the start rather than exact.
 */
export function getObjectExplorerNode(page: Page, label: string | RegExp): Locator {
    const name = typeof label === "string" ? new RegExp(`^${escapeRegExp(label)}\\b`) : label;
    return getObjectExplorerPane(page).getByRole("treeitem", { name }).first();
}

/** Expands a node if it is collapsed and waits for at least one child to appear. */
export async function expandObjectExplorerNode(
    page: Page,
    label: string | RegExp,
    timeout = 60 * 1000,
): Promise<Locator> {
    const node = getObjectExplorerNode(page, label);
    await expect(node).toBeVisible({ timeout });
    if ((await node.getAttribute("aria-expanded")) !== "true") {
        // Selecting a row and pressing ArrowRight is the tree's keyboard contract for expanding,
        // which avoids targeting the twistie by class.
        await node.click();
        await node.press("ArrowRight");
    }
    await expect(node).toHaveAttribute("aria-expanded", "true", { timeout });
    await waitForObjectExplorerToLoad(page, timeout);
    return node;
}

/** Waits until no node in the tree is still showing its "Loading..." placeholder child. */
export async function waitForObjectExplorerToLoad(page: Page, timeout = 60 * 1000): Promise<void> {
    await expect(
        getObjectExplorerPane(page).getByRole("treeitem", { name: /^Loading\.\.\./ }),
    ).toHaveCount(0, { timeout });
}

/** Runs the node's Refresh action and waits for its children to load. */
export async function refreshObjectExplorerNode(page: Page, node: Locator): Promise<void> {
    await runObjectExplorerContextAction(page, node, "Refresh");
    await waitForObjectExplorerToLoad(page);
}

/**
 * Expands each node along a path, e.g. `["e2e-server", "Databases", "MyDb", "Tables"]`.
 * Returns the last node, which is expanded too unless `expandLast` is false.
 */
export async function expandObjectExplorerPath(
    page: Page,
    labels: Array<string | RegExp>,
    { expandLast = true, timeout = 60 * 1000 } = {},
): Promise<Locator> {
    let node: Locator | undefined;
    for (let index = 0; index < labels.length; index++) {
        const isLast = index === labels.length - 1;
        if (isLast && !expandLast) {
            node = getObjectExplorerNode(page, labels[index]);
            await expect(node).toBeVisible({ timeout });
        } else {
            node = await expandObjectExplorerNode(page, labels[index], timeout);
        }
    }
    return node!;
}

/** Right-clicks a node and clicks a context menu item by its exact label. */
export async function runObjectExplorerContextAction(
    page: Page,
    node: Locator,
    menuLabel: string,
): Promise<void> {
    await node.click({ button: "right" });
    await clickContextMenuItem(page, menuLabel);
}

/** Clicks an item in the workbench's custom-drawn context menu. */
export async function clickContextMenuItem(page: Page, menuLabel: string): Promise<void> {
    const item = page.getByRole("menu").getByRole("menuitem", { name: menuLabel, exact: true });
    await expect(item).toBeVisible({ timeout: 10 * 1000 });
    // Hovering first lets the menu settle its hover state; a direct click on a freshly opened
    // menu is occasionally swallowed.
    await item.hover();
    await item.click();
}

/**
 * Clicks through a context menu path, hovering each submenu entry to open it, e.g.
 * `["Generate Script", "Script as Create"]`.
 */
export async function clickContextMenuPath(page: Page, labels: string[]): Promise<void> {
    for (let index = 0; index < labels.length; index++) {
        // An opened submenu is nested inside its parent, so the innermost menu is the last one.
        const item = page
            .getByRole("menu")
            .last()
            .getByRole("menuitem", { name: labels[index], exact: true });
        await expect(item).toBeVisible({ timeout: 10 * 1000 });
        await item.hover();
        if (index === labels.length - 1) {
            await item.click();
        } else {
            await expect(
                page.getByRole("menuitem", { name: labels[index], exact: true, expanded: true }),
            ).toBeVisible({ timeout: 10 * 1000 });
        }
    }
}

/** Returns the labels of the currently open context menu. */
export async function getContextMenuLabels(page: Page): Promise<string[]> {
    const items = page.getByRole("menu").first().getByRole("menuitem");
    await expect(items.first()).toBeVisible({ timeout: 10 * 1000 });
    return (await items.allInnerTexts()).map((text) => text.split("\n")[0].trim());
}

/** Waits for an editor tab with the given title (or pattern) to be the active editor tab. */
export async function waitForActiveEditorTab(
    page: Page,
    title: string | RegExp,
    timeout = 30 * 1000,
): Promise<Locator> {
    const name = typeof title === "string" ? new RegExp(escapeRegExp(title)) : title;
    const tab = page.getByRole("tab", { name, selected: true }).first();
    await expect(tab).toBeVisible({ timeout });
    return tab;
}

/** Text of the active Monaco editor, read from the model rather than the rendered lines. */
export async function getActiveEditorText(page: Page): Promise<string> {
    return page.evaluate(() => {
        // The workbench exposes Monaco's editor instances on the global `monaco` only in some
        // builds, so read the rendered view-lines of the focused editor group as a fallback.
        const editor = document.querySelector(
            ".editor-group-container.active .monaco-editor .view-lines",
        ) as HTMLElement | null;
        return editor?.innerText.replace(/\u00a0/g, " ") ?? "";
    });
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
