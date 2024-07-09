/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ElectronApplication, expect, Locator, Page, test } from '@playwright/test';
import { launchVsCodeWithMssqlExtension } from './utils/launchVscodeWithMsSqlExt';
import { screenshotOnFailure } from './utils/screenshotOnError';
import { addDatabaseConnection } from './utils/testHelpers';
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
		let addedSqlConnection: Locator;
		if (profileName) {
			addedSqlConnection = await vsCodePage.locator(`div[aria-label="${profileName}"]`);
		}
		else {
			addedSqlConnection = await vsCodePage.getByText(`${serverName}`);
		}

		await addedSqlConnection.click({ button: 'right' });
		const newQueryOption = await vsCodePage.locator('span[aria-label="New Query"]');
		await newQueryOption.click();
		let newQueryOptionVisible = await newQueryOption.isVisible()
		if (newQueryOptionVisible) {
			await newQueryOption.click();
		}

		const editor = await vsCodePage.locator('div[class="view-lines monaco-mouse-cursor-text"]');
		await editor.click();

		await new Promise(resolve => setTimeout(resolve, 4 * 1000));

		const createTestDB = 'CREATE DATABASE TestDB;';
		await vsCodePage.fill('textarea[class="inputarea monaco-mouse-cursor-text"]', createTestDB);
		await vsCodePage.click('a[aria-label="Execute Query (Ctrl+Shift+E)"]');

		await new Promise(resolve => setTimeout(resolve, 3 * 1000));

		await addedSqlConnection.click({ button: 'right' });
		await newQueryOption.click();
		newQueryOptionVisible = await newQueryOption.isVisible()
		if (newQueryOptionVisible) {
			await newQueryOption.click();
		}

		const sqlScript = `
USE TestDB;

CREATE TABLE TestTable (ID INT PRIMARY KEY, Name VARCHAR(50), Age INT);

INSERT INTO TestTable (ID, Name, Age) VALUES (1, 'Doe', 30);

SELECT Name FROM TestTable;`;
		await vsCodePage.fill('textarea[class="inputarea monaco-mouse-cursor-text"]', sqlScript);
		await vsCodePage.click('a[aria-label="Execute Query (Ctrl+Shift+E)"]');

		await new Promise(resolve => setTimeout(resolve, 4 * 1000));

		const nameQueryResult = await vsCodePage.getByText('Doe');
		await expect(nameQueryResult).toBeVisible({ timeout: 10000 });
	});

	test.afterEach(async ({ }, testInfo) => {
		await screenshotOnFailure(vsCodePage, testInfo);
	});

	test.afterAll(async () => {
		let addedSqlConnection: Locator;
		if (profileName) {
			addedSqlConnection = await vsCodePage.locator(`div[aria-label="${profileName}"]`);
		}
		else {
			addedSqlConnection = await vsCodePage.getByText(`${serverName}`);
		}

		await addedSqlConnection.click({ button: 'right' });
		const newQueryOption = await vsCodePage.locator('span[aria-label="New Query"]');
		await newQueryOption.click();
		let newQueryOptionVisible = await newQueryOption.isVisible()
		if (newQueryOptionVisible) {
			await newQueryOption.click();
		}

		const dropTestDatabaseScript = 'DROP DATABASE TestDB;';
		await vsCodePage.fill('textarea[class="inputarea monaco-mouse-cursor-text"]', dropTestDatabaseScript);
		await vsCodePage.click('a[aria-label="Execute Query (Ctrl+Shift+E)"]');

		await new Promise(resolve => setTimeout(resolve, 10 * 1000));

		await vsCodeApp.close();
	});
});
