/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ElectronApplication, expect, Page, test } from '@playwright/test';
import { launchVsCodeWithMssqlExtension } from './utils/launchVscodeWithMsSqlExt';
import { screenshotOnFailure } from './utils/screenshotOnError';
import { addDatabaseConnection, enterTextIntoQueryEditor, executeQuery, openNewQueryEditor } from './utils/testHelpers';
import { getAuthenticationType, getDatabaseName, getPassword, getProfileName, getSavePassword, getServerName, getUserName } from './utils/envConfigReader';

test.describe('MSSQL Extension - Query Execution', async () => {
	let vsCodeApp: ElectronApplication;
	let vsCodePage: Page;
	let serverName: string;
	let databaseName: string;
	let authType: string;
	let userName: string;
	let password: string;
	let savePassword: string;
	let profileName: string;

	test.beforeAll(async () => {
		const { electronApp, page } = await launchVsCodeWithMssqlExtension();
		vsCodeApp = electronApp;
		vsCodePage = page;

		serverName = getServerName();
		databaseName = getDatabaseName();
		authType = getAuthenticationType();
		userName = getUserName();
		password = getPassword();
		savePassword = getSavePassword();
		profileName = getProfileName();
		await addDatabaseConnection(vsCodePage, serverName, databaseName, authType, userName, password, savePassword, profileName);
	});

	test('Create table, insert data, and execute query', async () => {
		await openNewQueryEditor(vsCodePage, profileName, password);

		const createTestDB = 'CREATE DATABASE TestDB;';
		await enterTextIntoQueryEditor(vsCodePage, createTestDB);
		await executeQuery(vsCodePage);

		await openNewQueryEditor(vsCodePage, profileName, password);

 		const sqlScript = `
USE TestDB;
CREATE TABLE TestTable (ID INT PRIMARY KEY, Name VARCHAR(50), Age INT);
INSERT INTO TestTable (ID, Name, Age) VALUES (1, 'Doe', 30);
SELECT Name FROM TestTable;`;

		await enterTextIntoQueryEditor(vsCodePage, sqlScript);
		await executeQuery(vsCodePage);

		const nameQueryResult = await vsCodePage.getByText('Doe');
		await expect(nameQueryResult).toBeVisible({ timeout: 10000 });
	});

	test.afterEach(async ({ }, testInfo) => {
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

		await new Promise(resolve => setTimeout(resolve, 10 * 1000));

		await vsCodeApp.close();
	});
});
