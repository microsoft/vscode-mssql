/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { screenshot } from "./utils/screenshotUtils";
import {
    addDatabaseConnection,
    enterTextIntoQueryEditor,
    executeQuery,
    openNewQueryEditor,
} from "./utils/testHelpers";
import {
    getAuthenticationType,
    getDatabaseName,
    getPassword,
    getProfileName,
    getSavePassword,
    getServerName,
    getUserName,
} from "./utils/envConfigReader";
import { test, expect } from "./baseFixtures";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";

test.describe("MSSQL Extension - Query Execution", async () => {
    const getContext = useSharedVsCodeLifecycle({
        afterLaunch: async ({ page: vsCodePage }) => {
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
        },
        beforeClose: async ({ page: vsCodePage }) => {
            await openNewQueryEditor(vsCodePage);
            const dropTestDatabaseScript = `
USE master
ALTER DATABASE TestDB SET SINGLE_USER WITH ROLLBACK IMMEDIATE
DROP DATABASE TestDB;`;
            await enterTextIntoQueryEditor(vsCodePage, dropTestDatabaseScript);
            await executeQuery(vsCodePage);

            await new Promise((resolve) => setTimeout(resolve, 10 * 1000));
        },
    });

    test.beforeEach(async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();
        await screenshot(vsCodePage, testInfo, "BeforeEach");
    });

    test("Create table, insert data, and execute query", async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();
        await openNewQueryEditor(vsCodePage);
        await screenshot(vsCodePage, testInfo, "NewEditorOpened");

        const createTestDB = "CREATE DATABASE TestDB;";
        await enterTextIntoQueryEditor(vsCodePage, createTestDB);
        await screenshot(vsCodePage, testInfo, "CreateDbTyped");
        await executeQuery(vsCodePage);
        await screenshot(vsCodePage, testInfo, "CreateDbExecuted");

        await screenshot(vsCodePage, testInfo, "NewEditorOpened2");
        await openNewQueryEditor(vsCodePage);

        const sqlScript = `
USE TestDB;
CREATE TABLE TestTable (ID INT PRIMARY KEY, Name VARCHAR(50), Age INT);
INSERT INTO TestTable (ID, Name, Age) VALUES (1, 'Doe', 30);
SELECT Name FROM TestTable;`;

        await enterTextIntoQueryEditor(vsCodePage, sqlScript);
        await screenshot(vsCodePage, testInfo, "CreateTableTyped");
        await executeQuery(vsCodePage);
        await screenshot(vsCodePage, testInfo, "CreateTableExecuted");

        const nameQueryResult = await vsCodePage.getByText("Doe");
        await expect(nameQueryResult).toBeVisible({ timeout: 10000 });
    });
});
