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

    await new Promise((resolve) => setTimeout(resolve, 3 * 1000));

    const iframe = await getWebviewByTitle(vsCodePage, "Connection Dialog");

    let input = iframe.locator("#Server-name");
    await input.waitFor({ state: "visible", timeout: 300 * 1000 });

    await input.fill(serverName);

    if (databaseName) {
        input = iframe.locator("#Database-name");
        await input.fill(databaseName);
    }

    // await vsCodePage.fill('input[aria-controls="quickInput_list"]', `${authType}`);
    // await vsCodePage.keyboard.press("Enter");

    if (authType === "SQL Login") {
        input = iframe.locator("#User-name");
        await input.fill(userName);

        input = iframe.locator("#Password");
        await input.fill(password);

        // await vsCodePage.fill('input[aria-controls="quickInput_list"]', `${savePassword}`);
        // await vsCodePage.keyboard.press("Enter");
    }

    if (profileName) {
        input = iframe.locator("#Profile-Name");
        await input.fill(profileName);
    }

    // TODO: always check "Enable Trust Server Certificate"

    await vsCodePage.keyboard.press("Enter");

    await new Promise((resolve) => setTimeout(resolve, 1 * 1000));

    const enableTrustServerCertificateButton = await vsCodePage.getByText(
        "Enable Trust Server Certificate",
    );
    const isEnableTrustButtonVisible = await enableTrustServerCertificateButton.isVisible({
        timeout: 3 * 1000,
    });
    if (isEnableTrustButtonVisible) {
        await enableTrustServerCertificateButton.click();
    }
}

export async function openNewQueryEditor(
    vsCodePage: Page,
    profileName: string,
    password: string,
): Promise<void> {
    await vsCodePage.keyboard.press("Control+P");
    await waitForCommandPaletteToBeVisible(vsCodePage);
    await vsCodePage.keyboard.type(">MS SQL: New Query");
    await waitForCommandPaletteToBeVisible(vsCodePage);
    await vsCodePage.keyboard.press("Enter");
    await waitForCommandPaletteToBeVisible(vsCodePage);
    await vsCodePage.keyboard.type(profileName);
    await waitForCommandPaletteToBeVisible(vsCodePage);
    await vsCodePage.keyboard.press("Enter");
    await waitForCommandPaletteToBeVisible(vsCodePage);
    await vsCodePage.keyboard.type(password);
    await vsCodePage.keyboard.press("Enter");

    await new Promise((resolve) => setTimeout(resolve, 1 * 1000));
    await vsCodePage.keyboard.press("Escape");
}

export async function disconnect(vsCodePage: Page): Promise<void> {
    await vsCodePage.keyboard.press("Control+P");
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
