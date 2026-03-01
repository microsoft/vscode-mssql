/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { screenshot } from "./utils/screenshotUtils";
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
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";

test.describe("MSSQL Extension - Database Connection", async () => {
    const getContext = useSharedVsCodeLifecycle();

    test("Connect to local SQL Database, and disconnect", async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();
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

        await openNewQueryEditor(vsCodePage);
        await screenshot(vsCodePage, testInfo, "new query editor opened");

        // New editor should be connected to the last added connection
        await disconnect(vsCodePage);
        await screenshot(vsCodePage, testInfo, "disconnected");

        // Verify that the Connect to MSSQL button is visible again after disconnecting
        const connectAgainButton = await vsCodePage.getByText("Connect to MSSQLWrong");
        await expect(connectAgainButton).toBeVisible({ timeout: 10 * 1000 });
    });
});
