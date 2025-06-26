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
    console.log("Connection Profile: ", serverName, databaseName, authType, userName, profileName);

    const objectExplorer = vsCodePage.locator('[role="tree"][aria-label="Connections"]');
    const addConnectionButton = vsCodePage.locator(
        '[class*="action-label codicon codicon-add"][aria-label*="Add Connection"]',
    );
    let isOEVisible = await objectExplorer.isVisible();
    if (!isOEVisible) {
        await vsCodePage.click('a[aria-label="SQL Server (Ctrl+Alt+D)"]');
    }
    await objectExplorer.click();
    await expect(addConnectionButton).toBeVisible({ timeout: 10000 });
    await addConnectionButton.click();

    await vsCodePage.locator('input[aria-controls="quickInput_list"]').waitFor({
        state: "visible",
        timeout: 10 * 1000,
    });
    await vsCodePage.fill('input[aria-controls="quickInput_list"]', `${serverName}`);
    await vsCodePage.keyboard.press("Enter");

    if (databaseName) {
        await vsCodePage.fill('input[aria-controls="quickInput_list"]', `${databaseName}`);
    }
    await vsCodePage.keyboard.press("Enter");

    await vsCodePage.fill('input[aria-controls="quickInput_list"]', `${authType}`);
    await vsCodePage.keyboard.press("Enter");

    if (authType === "SQL Login") {
        await vsCodePage.fill('input[aria-controls="quickInput_list"]', `${userName}`);
        await vsCodePage.keyboard.press("Enter");

        await vsCodePage.fill('input[aria-controls="quickInput_list"]', `${password}`);
        await vsCodePage.keyboard.press("Enter");

        await vsCodePage.fill('input[aria-controls="quickInput_list"]', `${savePassword}`);
        await vsCodePage.keyboard.press("Enter");
    }

    if (profileName) {
        await vsCodePage.fill('input[aria-controls="quickInput_list"]', `${profileName}`);
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
    await waitForConnectionToShowInObjectExplorer(vsCodePage, profileName);
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

    await connectionWebview.owner().waitFor({ state: "hidden", timeout: 120 * 1000 });
    await waitForConnectionToShowInObjectExplorer(vsCodePage, profileName);
    await clearNotifications(vsCodePage);
}

export async function openNewQueryEditor(vsCodePage: Page, profileName: string): Promise<void> {
    // check connection is loaded in OE
    const addedConnection = vsCodePage.locator(
        `[class*="tree-node-item"][aria-label="${profileName}"]`,
    );
    await addedConnection.click({ button: "right" });
    await vsCodePage.locator('[class*="action-label"][aria-label*="New Query"]').click();
    await vsCodePage.keyboard.press("Enter");

    await new Promise((resolve) => setTimeout(resolve, 1 * 1000));
    const queryEditor = vsCodePage.locator('textarea[class="inputarea monaco-mouse-cursor-text"]');
    await queryEditor.waitFor({ state: "visible" });
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

export async function waitForConnectionToShowInObjectExplorer(
    vsCodePage: Page,
    profileName?: string,
): Promise<void> {
    if (!profileName) return;
    // check connection is loaded in OE
    const addedConnection = vsCodePage.locator(
        `[class*="tree-node-item"][aria-label="${profileName}"]`,
    );
    await addedConnection.waitFor({ state: "visible", timeout: 120 * 1000 });
    await expect(addedConnection).toBeVisible();
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
