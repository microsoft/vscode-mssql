/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ElectronApplication, FrameLocator, Locator, Page } from "@playwright/test";
import { test, expect, generateUUID } from "./baseFixtures";
import { launchVsCodeWithMssqlExtension } from "./utils/launchVscodeWithMsSqlExt";
import { screenshotOnFailure } from "./utils/screenshotOnError";
import { addDatabaseConnection, getWebviewByTitle } from "./utils/testHelpers";
import {
    getServerName,
    getDatabaseName,
    getAuthenticationType,
    getUserName,
    getPassword,
    getSavePassword,
    getProfileName,
} from "./utils/envConfigReader";
import { getCoverageFromWebview, writeCoverage } from "./utils/coverageHelpers";

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
    let coverageMap: Map<string, any> = new Map();
    let storedProcsLocator: Locator;
    let sysStoredProcsLocator: Locator;

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

        await addDatabaseConnection(
            vsCodePage,
            serverName,
            databaseName,
            authType,
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
            .locator('[class*="monaco-list-row"][role="treeitem"][aria-label*="Programmability "]')
            .click();
        storedProcsLocator = await vsCodePage
            .locator(
                '[class*="monaco-list-row"][role="treeitem"][aria-label*="Stored Procedures "]',
            )
            .first();
        await storedProcsLocator.click();
    });

    test.beforeEach("Set up before each test", async () => {
        iframe = await openObjectExplorerFilter(vsCodePage, storedProcsLocator);
        sysStoredProcsLocator = vsCodePage.locator(
            '[class*="monaco-list-row"][role="treeitem"][aria-label*="System Stored Procedures "]',
        );
        await sysStoredProcsLocator.click();
    });

    test("Filter name based on contains", async () => {
        const nameElement = iframe.locator('input[type="text"].fui-Input__input').nth(0);
        await nameElement.fill("cdc");

        const booleanElement = iframe.locator('[class*="fui-Dropdown"][value*="Equals"]').last();
        await booleanElement.click();
        await iframe.getByText("Not Equals").click();

        const dateElement = iframe.locator('[class*="fui-Dropdown"][value*="Equals"]').first();
        await dateElement.click();
        await iframe.getByText("Between").first().click();

        await iframe.locator('input[type="date"].fui-Input__input').first().click();
        // Input date
        await vsCodePage.keyboard.press("ArrowLeft");
        await vsCodePage.keyboard.press("ArrowLeft");
        await vsCodePage.keyboard.type("04052000");

        let okButton = iframe.getByText("OK");
        await okButton.click();

        // only fill one value of the date picker and check for error message
        const errorMessage = await iframe.getByText(
            "The second value must be set for the Between operator in the CreateDate filter",
        );
        await expect(errorMessage).toBeVisible();

        await iframe.locator('input[type="date"].fui-Input__input').last().click();
        // Tab to date picker
        await vsCodePage.keyboard.press("ArrowLeft");
        await vsCodePage.keyboard.press("ArrowLeft");
        await vsCodePage.keyboard.type("04053000");

        // Log coverage now, because context is lost when webview is closed
        // upon pressing "OK"
        await refocusFilterTab(vsCodePage);
        coverageMap.set(
            `objectExplorerFilter-${generateUUID()}`,
            await getCoverageFromWebview(iframe),
        );
        await okButton.click();

        const nonContainTable = vsCodePage.locator(
            '[class*="monaco-list-row"][role="treeitem"][aria-label*="dbo.sp_MSrepl_startup"]',
        );
        await sysStoredProcsLocator.click();
        await expect(nonContainTable).toBeHidden();
        await clearFilter(vsCodePage, storedProcsLocator);
    });

    test("Filter name based not contains", async () => {
        const nameElement = iframe.locator('input[type="text"].fui-Input__input').nth(0);
        await nameElement.fill("cdc");

        const operatorElement = iframe.locator('[class*="fui-Dropdown"]').nth(0);
        await operatorElement.click();
        await iframe.getByText("Not Contains").click();
        // Log coverage now, because context is lost when webview is closed
        // upon pressing "OK"
        await refocusFilterTab(vsCodePage);
        coverageMap.set(
            `objectExplorerFilter-${generateUUID()}`,
            await getCoverageFromWebview(iframe),
        );
        let okButton = iframe.getByText("OK");
        await okButton.click();
        const nonContainTable = vsCodePage.locator(
            '[class*="monaco-list-row"][role="treeitem"][aria-label*="dbo.sp_MSrepl_startup"]',
        );
        await new Promise((resolve) => setTimeout(resolve, 1 * 1000));
        await sysStoredProcsLocator.click();
        await expect(nonContainTable).toBeVisible();
    });

    test("Reopen OE Webview with old filters", async () => {
        const oldFilterElement = iframe.locator('[value*="cdc"]');
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
        coverageMap.set(
            `objectExplorerFilter-${generateUUID()}`,
            await getCoverageFromWebview(iframe),
        );
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
        coverageMap.set(
            `objectExplorerFilter-${generateUUID()}`,
            await getCoverageFromWebview(iframe),
        );
        let closeButton = iframe.getByText("Close");
        await closeButton.click();

        await expect(iframe.owner()).toBeHidden();
    });

    test.afterEach(async ({}, testInfo) => {
        await screenshotOnFailure(vsCodePage, testInfo);
    });

    test.afterAll(async () => {
        await writeCoverage(coverageMap);
        await vsCodeApp.close();
    });
});

export async function refocusFilterTab(page: Page) {
    const filterTab = page.locator('[aria-label="Object Explorer Filter"]');
    await filterTab.click();
}

export async function clearFilter(page: Page, treeItemLocator: Locator) {
    await refocusTreeItem(treeItemLocator);
    const clearFilterButton = page.locator('[role="button"][aria-label="Clear Filters"]');
    await clearFilterButton.waitFor({ state: "attached" });
    await clearFilterButton.click();
}

export async function openObjectExplorerFilter(
    page: Page,
    treeItemLocator: Locator,
): Promise<FrameLocator> {
    await refocusTreeItem(treeItemLocator);
    const filterButton = page.locator('[role="button"][aria-label="Filter"]').nth(3);

    await filterButton.waitFor({ state: "attached" });
    await filterButton.click();

    const iframe = await getWebviewByTitle(page, "Object Explorer Filter");

    const filterHeader = iframe.getByText("Filter Settings");
    await filterHeader.waitFor({ state: "visible" });
    return iframe;
}

export async function refocusTreeItem(treeItemLocator: Locator) {
    await treeItemLocator.click();
    await treeItemLocator.click();
}

export async function tabToDatePicker(page: Page) {
    // Tab to date picker
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
}
