/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ElectronApplication, Page } from "@playwright/test";
import { launchVsCodeWithMssqlExtension } from "./utils/launchVscodeWithMsSqlExt";
import { addConnectionButton, mssqlActivityBarButton } from "./utils/commonSelectors";
import { test, expect } from "./baseFixtures";
import { screenshotOnFailure } from "./utils/screenshotOnError";
import { getWebviewByTitle } from "./utils/testHelpers";

test.describe("MSSQL Extension - VSIX Based tests", async () => {
    let vsCodeApp: ElectronApplication;
    let vsCodePage: Page;

    test.beforeEach(async () => {
        // Launch with new UI off
        const { electronApp, page } = await launchVsCodeWithMssqlExtension({
            useVsix: true,
        });
        vsCodeApp = electronApp;
        vsCodePage = page;
    });

    // Test if extension activates correctly
    test("MSSQL button is present in activity bar", async () => {
        await vsCodePage.click(mssqlActivityBarButton);
        const count = await vsCodePage.locator(mssqlActivityBarButton).count();
        expect(count).toEqual(1);
    });

    // Test if the webview loads correctly
    test("MSSQL webview is loaded", async () => {
        const addButton = await vsCodePage.locator(addConnectionButton);
        await addButton.click();
        const connectionDialog = await getWebviewByTitle(vsCodePage, "Connection Dialog");
        await connectionDialog.locator("#connectButton").isVisible();
    });

    test.afterEach(async ({}, testInfo) => {
        await screenshotOnFailure(vsCodePage, testInfo);
    });

    test.afterEach(async () => {
        await vsCodeApp.close();
    });
});
