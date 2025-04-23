/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator, Page } from "@playwright/test";
import { expect } from "../baseFixtures";

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
    const addConnectionButton = await vsCodePage.locator('div[aria-label="Add Connection"]');
    let isConnectionButtonVisible = await addConnectionButton.isVisible();
    if (!isConnectionButtonVisible) {
        await vsCodePage.click('a[aria-label="SQL Server (Ctrl+Alt+D)"]');
    }

    await expect(addConnectionButton).toBeVisible({ timeout: 10000 });
    await addConnectionButton.click();

    await vsCodePage.fill('input[aria-label="input"]', `${serverName}`);
    await vsCodePage.keyboard.press("Enter");

    if (databaseName) {
        await vsCodePage.fill('input[aria-label="input"]', `${databaseName}`);
    }
    await vsCodePage.keyboard.press("Enter");

    await vsCodePage.fill('input[aria-label="input"]', `${authType}`);
    await vsCodePage.keyboard.press("Enter");

    if (authType === "SQL Login") {
        await vsCodePage.fill('input[aria-label="input"]', `${userName}`);
        await vsCodePage.keyboard.press("Enter");

        await vsCodePage.fill('input[aria-label="input"]', `${password}`);
        await vsCodePage.keyboard.press("Enter");

        await vsCodePage.fill('input[aria-label="input"]', `${savePassword}`);
        await vsCodePage.keyboard.press("Enter");
    }

    if (profileName) {
        await vsCodePage.fill('input[aria-label="input"]', `${profileName}`);
    }
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

export async function addDatabaseConnectionThroughWebview(
    vsCodePage: Page,
    serverName: string,
    databaseName: string,
    authType: string,
    userName: string,
    password: string,
    savePassword: string,
    profileName: string,
): Promise<void> {
    if (authType !== "SQL Login") return;

    console.log("Connection Profile: ", serverName, databaseName, authType, userName, profileName);

    await vsCodePage.keyboard.press("Control+P");
    await waitForCommandPaletteToBeVisible(vsCodePage);
    await vsCodePage.keyboard.type(">MS SQL: Add Connection (Preview)");
    await waitForCommandPaletteToBeVisible(vsCodePage);
    await vsCodePage.keyboard.press("Enter");

    const connectionWebview = await getWebviewByTitle(vsCodePage, "Connection Dialog (Preview)");

    const inputElements = connectionWebview.locator('input[type="text"].fui-Input__input');
    const profileNameElement = await inputElements.nth(0);
    const serverNameElement = await inputElements.nth(1);
    const userNameElement = await inputElements.nth(2);
    const databaseNameElement = await inputElements.nth(3);

    const checkBoxElements = connectionWebview.locator(
        'input[type="checkbox"].fui-Checkbox__input',
    );
    const trustServerElement = await checkBoxElements.nth(0);
    const savePasswordElement = await checkBoxElements.nth(1);

    const passwordInputElement = connectionWebview.locator(
        'input[type="password"].fui-Input__input',
    );

    await serverNameElement.fill(serverName);
    await userNameElement.fill(userName);
    await trustServerElement.click();
    await passwordInputElement.fill(password);

    if (databaseName) {
        await databaseNameElement.fill(databaseName);
    }

    if (savePassword) {
        await savePasswordElement.click();
    }

    if (profileName) {
        await profileNameElement.fill(profileName);
    }

    await clearNotifications(vsCodePage);

    const connectButton = connectionWebview.locator('button[type="submit"].fui-Button');
    await connectButton.click();

    const loadingIcon = connectionWebview.locator('[class*="fui-Spinner"][role="progressbar"]');
    await loadingIcon.waitFor({ state: "hidden" });
    await connectionWebview.owner().waitFor({ state: "hidden", timeout: 120 * 1000 });

    // check connection is loaded in OE
    const addedConnection = await vsCodePage.locator(`[role="treeitem"]`).first();
    await addedConnection.waitFor({ state: "visible", timeout: 30 * 1000 });
    await expect(addedConnection).toBeVisible();

    await clearNotifications(vsCodePage);
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
    await vsCodePage.click('a[aria-label="Execute Query (Ctrl+Shift+E)"]');
}

export async function enterTextIntoQueryEditor(vsCodePage: Page, text: string): Promise<void> {
    await vsCodePage.fill('textarea[class="inputarea monaco-mouse-cursor-text"]', text);
}

export async function waitForCommandPaletteToBeVisible(vsCodePage: Page): Promise<void> {
    const commandPaletteInput = vsCodePage.locator('input[aria-label="input"]');
    await expect(commandPaletteInput).toBeVisible();
}

export async function getWebviewByTitle(vsCodePage: Page, title: string): Promise<FrameLocator> {
    return vsCodePage.frameLocator(".webview").frameLocator(`[title='${title}']`);
}

export async function clearNotifications(vsCodePage: Page): Promise<void> {
    let clearButtonLocator = vsCodePage.locator(
        'a.action-label.codicon.codicon-notifications-clear[role="button"][aria-label="Clear Notification (Delete)"]',
    );

    while (
        await clearButtonLocator
            .first()
            .isVisible()
            .catch(() => false)
    ) {
        const messageText = await vsCodePage
            .locator(".notification-list-item-message span")
            .first()
            .textContent();

        console.log("Notification Message:", messageText?.trim());

        await clearButtonLocator.first().click();

        // Give the UI a short time to update before checking again
        await vsCodePage.waitForTimeout(100);
    }
}
