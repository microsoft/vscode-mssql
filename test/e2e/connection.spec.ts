/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ElectronApplication, Page, test, expect } from "@playwright/test";
import { launchVsCodeWithMssqlExtension } from "./utils/launchVscodeWithMsSqlExt";
import { screenshotOnFailure } from "./utils/screenshotOnError";
import {
    getServerName,
    getDatabaseName,
    getAuthenticationType,
    getUserName,
    getPassword,
    getProfileName,
    getSavePassword,
} from "./utils/envConfigReader";
import {
    addDatabaseConnection,
    disconnect,
    openNewQueryEditor,
} from "./utils/testHelpers";

test.describe("MSSQL Extension - Database Connection", async () => {
    let vsCodeApp: ElectronApplication;
    let vsCodePage: Page;

    test.beforeAll(async () => {
        const { electronApp, page } = await launchVsCodeWithMssqlExtension();
        vsCodeApp = electronApp;
        vsCodePage = page;
    });

    test("Connect to local SQL Database, and disconnect", async () => {
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

        await openNewQueryEditor(vsCodePage, profileName, password);
        await disconnect(vsCodePage);

        const disconnectedStatus = await vsCodePage.getByText("Disconnected");
        await expect(disconnectedStatus).toBeVisible({ timeout: 10 * 1000 });
    });

    test.afterEach(async ({}, testInfo) => {
        await screenshotOnFailure(vsCodePage, testInfo);
    });

    test.afterAll(async () => {
        await vsCodeApp.close();
    });
});
