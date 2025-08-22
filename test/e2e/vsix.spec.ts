/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ElectronApplication, Page } from "@playwright/test";
import {
    cleanupDirectories,
    launchVsCodeWithMssqlExtension,
} from "./utils/launchVscodeWithMsSqlExt";
import { addConnectionButton } from "./utils/commonSelectors";
import { test, expect } from "./baseFixtures";
import { screenshotOnFailure } from "./utils/screenshotUtils";
import { getWebviewByTitle } from "./utils/testHelpers";

/**
 * Running a few launch specific tests to ensure the VSIX package is working correctly.
 * Since code-coverage is not supported for VSIX based tests, we are converting all tests to use the VSIX package.
 */
test.describe("MSSQL Extension - VSIX Based tests", async () => {
    let vsCodeApp: ElectronApplication;
    let vsCodePage: Page;
    let userDir: string;
    let extDir: string;
    let nodePathDir: string;

    test.beforeEach(async () => {
        // Launch vscode with the VSIX package
        const { electronApp, page, userDataDir, extensionsDir } =
            await launchVsCodeWithMssqlExtension({
                useVsix: true,
            });
        vsCodeApp = electronApp;
        vsCodePage = page;
        userDir = userDataDir;
        extDir = extensionsDir;
    });

    // Test if extension activates correctly
    test("Extension activates correctly", async () => {
        expect(vsCodeApp).not.toBeNull();
    });

    // Test if the webview loads correctly
    test("MSSQL add connection webview is loaded correctly", async () => {
        const addButton = await vsCodePage.locator(addConnectionButton);
        await addButton.click();
        const connectionDialog = await getWebviewByTitle(vsCodePage, "Connection Dialog");
        await connectionDialog.locator("#connectButton").isVisible();
    });

    test.afterEach(async ({}, testInfo) => {
        await screenshotOnFailure(vsCodePage, testInfo);
        await vsCodeApp.close();
        await cleanupDirectories(userDir, extDir, nodePathDir);
    });
});
