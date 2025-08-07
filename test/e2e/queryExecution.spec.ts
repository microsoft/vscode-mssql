/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ElectronApplication, Page } from "@playwright/test";
import { launchVsCodeWithMssqlExtension } from "./utils/launchVscodeWithMsSqlExt";
import { screenshot, screenshotOnFailure } from "./utils/screenshotUtils";
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

test.describe("MSSQL Extension - Query Execution", async () => {
    let vsCodeApp: ElectronApplication;
    let vsCodePage: Page;
    let serverName: string;
    let databaseName: string;
    let authType: string;
    let userName: string;
    let password: string;
    let savePassword: boolean;
    let profileName: string;

    test.beforeAll(async ({}, _testInfo) => {
        // Launch with new UI off
        const { electronApp, page } = await launchVsCodeWithMssqlExtension({
            useNewUI: false,
        });
        vsCodeApp = electronApp;
        vsCodePage = page;

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
    });

    test.beforeEach(async ({}, testInfo) => {
        await screenshot(vsCodePage, testInfo, "BeforeEach");
    });

    test("Create table, insert data, and execute query", async ({}, testInfo) => {
        await openNewQueryEditor(vsCodePage, profileName, password);
        await screenshot(vsCodePage, testInfo, "NewEditorOpened");

        const createTestDB = "CREATE DATABASE TestDB;";
        await enterTextIntoQueryEditor(vsCodePage, createTestDB);
        await screenshot(vsCodePage, testInfo, "CreateDbTyped");
        await executeQuery(vsCodePage);
        await screenshot(vsCodePage, testInfo, "CreateDbExecuted");

        await screenshot(vsCodePage, testInfo, "NewEditorOpened2");
        await openNewQueryEditor(vsCodePage, profileName, password);

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

    test.afterEach(async ({}, testInfo) => {
        await screenshotOnFailure(vsCodePage, testInfo);
    });

    test.afterAll(async () => {
        await openNewQueryEditor(vsCodePage, profileName, password);
        const dropTestDatabaseScript = `
USE master
ALTER DATABASE TestDB SET SINGLE_USER WITH ROLLBACK IMMEDIATE
DROP DATABASE TestDB;`;
        await enterTextIntoQueryEditor(vsCodePage, dropTestDatabaseScript);
        await executeQuery(vsCodePage);

        await new Promise((resolve) => setTimeout(resolve, 10 * 1000));

        await vsCodeApp.close();
    });
});
