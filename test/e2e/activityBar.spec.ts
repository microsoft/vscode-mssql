/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ElectronApplication, Page } from "@playwright/test";
import { launchVsCodeWithMssqlExtension } from "./utils/launchVscodeWithMsSqlExt";
import { screenshotOnFailure } from "./utils/screenshotUtils";
import { mssqlActivityBarButton } from "./utils/commonSelectors";
import { test, expect } from "./baseFixtures";

test.describe("MSSQL Extension - Activity Bar", async () => {
    let vsCodeApp: ElectronApplication;
    let vsCodePage: Page;

    test.beforeAll(async () => {
        // Launch with new UI off
        const { electronApp, page } = await launchVsCodeWithMssqlExtension({
            useNewUI: false,
        });
        vsCodeApp = electronApp;
        vsCodePage = page;
    });

    test("MSSQL button is present in activity bar", async () => {
        await vsCodePage.click(mssqlActivityBarButton);
        const count = await vsCodePage.locator(mssqlActivityBarButton).count();
        expect(count).toEqual(1);
    });

    test.afterEach(async ({}, testInfo) => {
        await screenshotOnFailure(vsCodePage, testInfo);
    });

    test.afterAll(async () => {
        await vsCodeApp.close();
    });
});
