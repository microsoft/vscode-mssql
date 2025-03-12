/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Page } from "@playwright/test";
import { existsSync, mkdirSync, readdirSync } from "fs";

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
    // wait for 5 seconds for the extension to load
    await new Promise((resolve) => setTimeout(resolve, 5 * 1000));

    const addConnectionButton = await vsCodePage.locator(
        'div[aria-label="Add Connection"]',
    );
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
    const isEnableTrustButtonVisible =
        await enableTrustServerCertificateButton.isVisible({
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
    await vsCodePage.click('a[aria-label="Execute Query (Ctrl+Shift+E)"]');
}

export async function enterTextIntoQueryEditor(
    vsCodePage: Page,
    text: string,
): Promise<void> {
    await vsCodePage.fill(
        'textarea[class="inputarea monaco-mouse-cursor-text"]',
        text,
    );
}

export async function waitForCommandPaletteToBeVisible(
    vsCodePage: Page,
): Promise<void> {
    const commandPaletteInput = vsCodePage.locator('input[aria-label="input"]');
    await expect(commandPaletteInput).toBeVisible();
}

export let numScreenshotsForTest = new Map<string, number>();

export function getScreenshotNameFromTestName(
    testname: string,
    path: string,
): string {
    const cleanedTestName = testname.replace(/\s+/g, "-");

    let screenshotTestNumber;
    if (numScreenshotsForTest.has(cleanedTestName)) {
        // Increment existing count
        screenshotTestNumber = numScreenshotsForTest.get(cleanedTestName) + 1;
    } else {
        if (!existsSync(path)) {
            mkdirSync(path, { recursive: true });
            screenshotTestNumber = 1;
        } else {
            // Check existing files in the directory
            const files = readdirSync(path);
            const matchingFiles = files.filter((file) =>
                file.startsWith(cleanedTestName),
            );

            // Initialize count based on existing screenshots
            screenshotTestNumber = matchingFiles.length + 1;
        }
    }

    // Update the map with the new count
    numScreenshotsForTest.set(cleanedTestName, screenshotTestNumber);

    return `${cleanedTestName}-${screenshotTestNumber}.png`;
}

export async function checkScreenshot(
    page: Page,
    path: string,
    testname: string,
): Promise<void> {
    const screenshotTestname = getScreenshotNameFromTestName(
        testname,
        path.substring(0, path.lastIndexOf("\\") + 1),
    );
    const screenshotFilePath = `${path}${screenshotTestname}`;

    // Check if file exists
    if (!existsSync(screenshotFilePath)) {
        // If file does not exist, take a new screenshot
        await page.screenshot({ path: screenshotFilePath });
    } else {
        // If file exists, compare with expected screenshot
        // console.log("Checking against existing screenshot: ", testname);
        await expect(page).toHaveScreenshot();
    }
}
