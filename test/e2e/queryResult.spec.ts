/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
import { ElectronApplication, FrameLocator, Page } from "@playwright/test";
import { test, expect } from "./baseFixtures";
import { launchVsCodeWithMssqlExtension } from "./utils/launchVscodeWithMsSqlExt";
import { screenshotOnFailure } from "./utils/screenshotOnError";
import { writeCoverage } from "./utils/coverageHelpers";

export const queryResultScreenshotPath =
    process.cwd() +
    `\\test\\resources\\screenshots\\queryResult.spec.ts\\MSSQL-Extension---Query-Result-`;

test.describe("MSSQL Extension - Query Result", async () => {
    let vsCodeApp: ElectronApplication;
    let vsCodePage: Page;
    let iframe: FrameLocator;

    test.beforeAll("Setting up for Query Result Tests", async () => {
        const { electronApp, page } = await launchVsCodeWithMssqlExtension();
        vsCodeApp = electronApp;
        vsCodePage = page;

        // Query result entry point
        const queryResultTab = vsCodePage.locator(
            '[aria-label="Query Results (Preview)"][class="action-label"]',
        );
        await queryResultTab.click();

        iframe = vsCodePage
            .frameLocator(".webview")
            .frameLocator("[title='Query Results (Preview)']");

        // Wait for results pane to load
        const queryResultElementLocator = iframe.getByText(
            "No result found for the active editor; please run a query or switch to another editor.",
        );
        await queryResultElementLocator.waitFor({
            state: "visible",
            timeout: 30 * 1000,
        });
    });

    test("Query Result Test", async () => {
        await expect(true).toBeTruthy();
    });

    test.afterEach(async ({}, testInfo) => {
        await screenshotOnFailure(vsCodePage, testInfo);
    });

    test.afterAll(async () => {
        await writeCoverage(iframe, "queryResult");

        // Close query plan webview
        await vsCodePage.keyboard.press("Control+`");
        await vsCodeApp.close();
    });
});
*/
