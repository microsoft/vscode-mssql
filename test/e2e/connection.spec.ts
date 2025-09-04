/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ElectronApplication, Page } from "@playwright/test";
import { launchVsCodeWithMssqlExtension } from "./utils/launchVscodeWithMsSqlExt";
import { screenshot, screenshotOnFailure } from "./utils/screenshotUtils";
import {
    getServerName,
    getDatabaseName,
    getAuthenticationType,
    getUserName,
    getPassword,
    getProfileName,
    getSavePassword,
} from "./utils/envConfigReader";
import { addDatabaseConnection, disconnect, openNewQueryEditor } from "./utils/testHelpers";
import { test, expect } from "./baseFixtures";

test.describe("MSSQL Extension - Database Connection", async () => {
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

    test("Connect to local SQL Database, and disconnect", async ({}, testInfo) => {
        const serverName = getServerName();
        const databaseName = getDatabaseName();
        const authType = getAuthenticationType();
        const userName = getUserName();
        const password = getPassword();
        const savePassword = getSavePassword();
        const profileName = getProfileName();
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

        await screenshot(vsCodePage, testInfo, "connected");

        await openNewQueryEditor(vsCodePage, profileName, password);
        await screenshot(vsCodePage, testInfo, "new query editor opened");

        await disconnect(vsCodePage);
        await screenshot(vsCodePage, testInfo, "disconnected");

        const disconnectedStatus = await vsCodePage.getByText("Connect to MSSQL");
        await expect(disconnectedStatus).toBeVisible({ timeout: 10 * 1000 });
    });

    test.afterEach(async ({}, testInfo) => {
        await screenshotOnFailure(vsCodePage, testInfo);
    });

    test.afterAll(async () => {
        await vsCodeApp.close();
    });
});
