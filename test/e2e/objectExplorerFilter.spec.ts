/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ElectronApplication, FrameLocator, Page } from "@playwright/test";
import { test, expect, generateUUID } from "./baseFixtures";
import { launchVsCodeWithMssqlExtension } from "./utils/launchVscodeWithMsSqlExt";
import { screenshotOnFailure } from "./utils/screenshotOnError";
import { addDatabaseConnectionThroughWebview, getWebviewByTitle } from "./utils/testHelpers";
import {
    getServerName,
    getDatabaseName,
    getAuthenticationType,
    getUserName,
    getPassword,
    getSavePassword,
    getProfileName,
} from "./utils/envConfigReader";
import { writeCoverage } from "./utils/coverageHelpers";

test.describe("MSSQL Extension - Object Explorer Filter", async () => {
    let vsCodeApp: ElectronApplication;
    let vsCodePage: Page;
    let iframe: FrameLocator;
    let serverName: string;
    let databaseName: string;
    let authType: string;
    let userName: string;
    let password: string;
    let savePassword: string;
    let profileName: string;

    test.beforeAll("Setting up for Object Explorer Filter Tests", async () => {
        const { electronApp, page } = await launchVsCodeWithMssqlExtension();
        vsCodeApp = electronApp;
        vsCodePage = page;

        await new Promise((resolve) => setTimeout(resolve, 1 * 1000));
        serverName = getServerName();
        databaseName = getDatabaseName();
        authType = getAuthenticationType();
        userName = getUserName();
        password = getPassword();
        savePassword = getSavePassword();
        profileName = getProfileName();

        await addDatabaseConnectionThroughWebview(
            vsCodePage,
            serverName,
            databaseName,
            "SQL Login",
            userName,
            password,
            savePassword,
            profileName,
        );

        // click filter button
        await vsCodePage
            .locator('[class*="monaco-list-row"][role="treeitem"][aria-label="Databases "]')
            .click();
        await vsCodePage
            .locator('[class*="monaco-list-row"][role="treeitem"][aria-label="System Databases "]')
            .click();
        await vsCodePage
            .locator('[class*="monaco-list-row"][role="treeitem"][aria-label*="master"]')
            .click();
        await vsCodePage
            .locator('[class*="monaco-list-row"][role="treeitem"][aria-label*="Tables"]')
            .click();
        await vsCodePage
            .locator('[class*="monaco-list-row"][role="treeitem"][aria-label*="System Tables"]')
            .click();
    });

    test.beforeEach("Set up before each test", async () => {
        iframe = await openObjectExplorerFilter(vsCodePage);
    });

    test("Filter name based on contains", async () => {
        const nameElement = iframe.locator('input[type="text"].fui-Input__input').nth(0);
        await nameElement.fill("spt");
        // Log coverage now, because context is lost when webview is closed
        // upon pressing "OK"
        await new Promise((resolve) => setTimeout(resolve, 150 * 1000));
        await refocusFilterTab(vsCodePage);
        await writeCoverage(iframe, `objectExplorerFilter-${generateUUID()}`);
        let okButton = iframe.getByText("OK");
        await okButton.click();
        const nonSPTTable = vsCodePage.locator(
            '[class*="monaco-list-row"][role="treeitem"][aria-label*="dbo.MSreplication_options"]',
        );
        await expect(nonSPTTable).toBeHidden();
        await clearFilter(vsCodePage);
    });

    test("Filter name based not contains", async () => {
        const nameElement = iframe.locator('input[type="text"].fui-Input__input').nth(0);
        await nameElement.fill("spt");

        const operatorElement = iframe.locator('[class*="fui-Dropdown"]').nth(0);
        await operatorElement.click();
        await iframe.getByText("Not Contains").click();
        // Log coverage now, because context is lost when webview is closed
        // upon pressing "OK"
        await refocusFilterTab(vsCodePage);
        await writeCoverage(iframe, `objectExplorerFilter-${generateUUID()}`);
        let okButton = iframe.getByText("OK");
        await okButton.click();
        const nonSPTTable = vsCodePage.locator(
            '[class*="monaco-list-row"][role="treeitem"][aria-label*="dbo.MSreplication_options"]',
        );
        await expect(nonSPTTable).toBeVisible();
    });

    test("Reopen OE Webview with old filters", async () => {
        const oldFilterElement = iframe.locator('[value*="spt"]');
        await expect(oldFilterElement).toBeVisible();

        const oldOptionElement = iframe.locator('[value*="Not Contains"]');
        await expect(oldOptionElement).toBeVisible();

        // Clear Filters
        const clearButton = iframe
            .locator('[class*="ui-Button"][type="button"][aria-label*="Clear"]')
            .nth(0);
        await clearButton.click();

        const inputElement = iframe.locator('input[type="text"].fui-Input__input').nth(0);
        await expect(inputElement).toHaveValue("");
        // Log coverage now, because context is lost when webview is closed
        // upon pressing "OK"
        await refocusFilterTab(vsCodePage);
        await writeCoverage(iframe, `objectExplorerFilter-${generateUUID()}`);
        let okButton = iframe.getByText("OK");
        await okButton.click();
    });

    test("Clear All and Close", async () => {
        const nameElement = iframe.locator('input[type="text"].fui-Input__input').nth(0);
        await nameElement.fill("specific string 1");

        const schemaElement = iframe.locator('input[type="text"].fui-Input__input').nth(1);
        await schemaElement.fill("specific string 2");

        let clearAllButton = iframe.getByText("Clear All");
        await clearAllButton.click();

        const clearedValue1 = iframe.locator('input[type="text"].fui-Input__input').nth(0);
        await expect(clearedValue1).toHaveValue("");

        const clearedValue2 = iframe.locator('input[type="text"].fui-Input__input').nth(1);
        await expect(clearedValue2).toHaveValue("");

        const inputElement = iframe.locator('input[type="text"].fui-Input__input').nth(0);
        await expect(inputElement).toHaveValue("");
        // Log coverage now, because context is lost when webview is closed
        // upon pressing "OK"
        await refocusFilterTab(vsCodePage);
        await writeCoverage(iframe, `objectExplorerFilter-${generateUUID()}`);
        let closeButton = iframe.getByText("Close");
        await closeButton.click();

        await expect(iframe.owner()).toBeHidden();
    });

    test.afterEach(async ({}, testInfo) => {
        await screenshotOnFailure(vsCodePage, testInfo);
    });

    test.afterAll(async () => {
        await vsCodeApp.close();
    });
});

export async function refocusFilterTab(page: Page) {
    const filterTab = page.locator('[aria-label="Object Explorer Filter (Preview)"]');
    await filterTab.click();
}

export async function clearFilter(page: Page) {
    const clearFilterButton = page.locator('[role="button"][aria-label="Clear Filters"]');
    await clearFilterButton.waitFor({ state: "attached" });
    await clearFilterButton.click();
}

export async function openObjectExplorerFilter(page: Page): Promise<FrameLocator> {
    const filterButton = page.locator('[role="button"][aria-label="Filter (Preview)"]').nth(2);

    await filterButton.waitFor({ state: "attached" });
    await filterButton.click();

    const iframe = await getWebviewByTitle(page, "Object Explorer Filter (Preview)");

    const filterHeader = iframe.getByText("Filter Settings");
    await filterHeader.waitFor({ state: "visible" });
    return iframe;
}
