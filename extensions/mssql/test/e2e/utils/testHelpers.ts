/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, FrameLocator, Page } from "@playwright/test";

export async function addDatabaseConnection(
    vsCodePage: Page,
    serverName: string,
    databaseName: string,
    authType: string,
    userName: string,
    password: string,
    savePassword: string,
    profileName: string,
): Promise<void> {
    let iframe: FrameLocator;
    // Navigate to Sql Server Tab
    const sqlServerTabContainer = vsCodePage.locator('[role="tab"][aria-label^="SQL Server"]');
    const isSelected = await sqlServerTabContainer.getAttribute("aria-selected");

    if (isSelected !== "true") {
        const sqlServerTabElement = sqlServerTabContainer.locator("a");
        await sqlServerTabElement.waitFor({ state: "visible", timeout: 30 * 1000 });
        await sqlServerTabElement.click();
    }
    const addConnectionButton = await vsCodePage.locator('div[aria-label="Add Connection"]');
    await expect(addConnectionButton).toBeVisible({ timeout: 10000 });
    await addConnectionButton.click();

    iframe = await getWebviewByTitle(vsCodePage, "Connection Dialog");

    await iframe.getByRole("textbox", { name: "Server name" }).fill(serverName);

    if (databaseName) {
        await iframe.getByRole("textbox", { name: "Database name" }).fill(databaseName);
    }
    await iframe.getByRole("combobox", { name: "Authentication type" }).click();
    // Then select an option from the dropdown list that appears
    await iframe.getByRole("option", { name: authType }).click();

    if (authType === "SQL Login") {
        await iframe.getByRole("textbox", { name: "User name" }).fill(userName);
        await iframe.getByRole("textbox", { name: "Password" }).fill(password);

        await iframe.getByRole("checkbox", { name: "Save Password" }).click();
    }

    if (profileName) {
        await iframe.getByRole("textbox", { name: "Profile name" }).fill(profileName);
    }

    await new Promise((resolve) => setTimeout(resolve, 1 * 1000));

    await iframe.getByRole("checkbox", { name: "Trust server certificate" }).click();
    await iframe.getByRole("button", { name: "Connect", exact: true }).click();

    // Wait for the Connection Dialog editor tab to disappear. VS Code renders a
    // tab in the editor tab strip for every open panel. When the connection
    // dialog closes the tab is removed from the DOM, giving us a reliable
    // signal that the connection attempt has completed. We check for
    // "detached" rather than "hidden" so the wait resolves even if the tab
    // was never rendered (e.g. it closed before the locator was evaluated).
    const dialogTab = vsCodePage.locator('[role="tab"][aria-label*="Connection Dialog"]');
    try {
        // If the tab is already gone this resolves immediately; if it's still
        // open it waits up to 60 s for it to be removed from the DOM.
        await dialogTab.waitFor({ state: "detached", timeout: 60 * 1000 });
    } catch {
        // Tab was never present or already detached — treat as closed.
    }

    // Verify the server node is present in Object Explorer in the connected
    // state. The OE label is the profile name when one is set, otherwise the
    // server name. A disconnected node carries data-vscode-context containing
    // "disconnected" on the treeitem element itself, so we use a CSS :not()
    // selector (which applies to the element itself) rather than
    // .filter({ hasNot }) which only checks descendant elements.
    const nodeLabel = profileName || serverName;
    await vsCodePage
        .locator(
            `[role="treeitem"][aria-label*="${nodeLabel}"]:not([data-vscode-context*="disconnected"])`,
        )
        .first()
        .waitFor({ state: "visible", timeout: 60 * 1000 });
}

export async function openNewQueryEditor(
    vsCodePage: Page,
    connectedServerName?: string,
): Promise<void> {
    await vsCodePage.keyboard.press(`${getModifierKey()}+P`);
    await waitForCommandPaletteToBeVisible(vsCodePage);
    await vsCodePage.keyboard.type(">MS SQL: New Query");
    await waitForCommandPaletteToBeVisible(vsCodePage);
    await vsCodePage.keyboard.press("Enter");

    // Wait for the mssql code lens to appear in the new editor. The code lens
    // is rendered as an anchor inside a .codelens-decoration span and contains
    // the active connection's server name. Its presence confirms that the
    // editor is open and the extension has attached a connection to it.
    // If no serverName is supplied we wait for any codelens-decoration to
    // appear, which is still a reliable signal that the editor is ready.
    if (connectedServerName) {
        await vsCodePage
            .locator(".codelens-decoration")
            .filter({ hasText: connectedServerName })
            .first()
            .waitFor({ state: "visible", timeout: 30 * 1000 });
    } else {
        await vsCodePage
            .locator(".codelens-decoration")
            .first()
            .waitFor({ state: "visible", timeout: 30 * 1000 });
    }
}

export async function disconnect(vsCodePage: Page): Promise<void> {
    await vsCodePage.keyboard.press(`${getModifierKey()}+P`);
    await vsCodePage.keyboard.type(">MS SQL: Disconnect");
    // await new Promise(resolve => setTimeout(resolve, 1 * 1000));
    await vsCodePage.keyboard.press("Enter");
}

export async function executeQuery(vsCodePage: Page): Promise<void> {
    const cancelConnectionButton = vsCodePage.locator('[aria-label^="Cancel Connection"]').first();
    if (await cancelConnectionButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expect(cancelConnectionButton).toBeHidden({ timeout: 30 * 1000 });
    }

    const executeQueryButton = vsCodePage.locator('[aria-label^="Execute Query"]').first();
    await expect(executeQueryButton).toBeVisible();
    await executeQueryButton.click();
}

export async function enterTextIntoQueryEditor(vsCodePage: Page, text: string): Promise<void> {
    await vsCodePage.click('div[class="view-lines monaco-mouse-cursor-text"]');
    // Use insertText instead of keyboard.type() so the text is injected as a
    // single input event rather than individual key events. keyboard.type()
    // triggers VS Code's auto-closing-brackets logic (inserting an extra ")"
    // for every "(", etc.), which produces invalid T-SQL. insertText bypasses
    // all editor auto-complete and auto-closing hooks.
    await vsCodePage.keyboard.insertText(text);
}

export async function waitForCommandPaletteToBeVisible(vsCodePage: Page): Promise<void> {
    const commandPaletteInput = vsCodePage.locator('input[aria-controls="quickInput_list"]');
    await expect(commandPaletteInput).toBeVisible();
}

export async function getWebviewByTitle(vsCodePage: Page, title: string): Promise<FrameLocator> {
    return vsCodePage.frameLocator(".webview").frameLocator(`[title='${title}']`);
}

export function isMac(): boolean {
    return process.platform === "darwin";
}

export function getModifierKey(): string {
    return isMac() ? "Meta" : "Control";
}
