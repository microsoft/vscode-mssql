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
}

export async function openNewQueryEditor(
    vsCodePage: Page,
    profileName: string,
    password: string,
): Promise<void> {
    await vsCodePage.keyboard.press(`${getModifierKey()}+P`);
    await waitForCommandPaletteToBeVisible(vsCodePage);
    await vsCodePage.keyboard.type(">MS SQL: New Query");
    await waitForCommandPaletteToBeVisible(vsCodePage);
    await vsCodePage.keyboard.press("Enter");
}

export async function disconnect(vsCodePage: Page): Promise<void> {
    await vsCodePage.keyboard.press(`${getModifierKey()}+P`);
    await vsCodePage.keyboard.type(">MS SQL: Disconnect");
    // await new Promise(resolve => setTimeout(resolve, 1 * 1000));
    await vsCodePage.keyboard.press("Enter");
}

export async function executeQuery(vsCodePage: Page): Promise<void> {
    await vsCodePage.click('a[aria-label^="Execute Query"]');
}

export async function enterTextIntoQueryEditor(vsCodePage: Page, text: string): Promise<void> {
    await vsCodePage.click('div[class="view-lines monaco-mouse-cursor-text"]');
    await vsCodePage.keyboard.type(text);
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
