/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ElectronApplication, expect, Page, test } from '@playwright/test';
import { launchVsCodeWithMssqlExtension } from './utils/launchVscodeWithMsSqlExt';
import { screenshotOnFailure } from './utils/screenshotOnError';
import { addDatabaseConnection, executeCommand, wait } from './utils/testHelpers';
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

		//Making sure the connection is added
		if (profileName) {
			await vsCodePage.locator(`div[aria-label="${profileName}"]`);
		}
		else {
			await vsCodePage.getByText(`${serverName}`);
		}

		await executeCommand(vsCodePage, 'MS SQL: New Query'); // Open new query editor
		await vsCodePage.keyboard.press('Enter'); // Select the created connection. It should be the first on the list
		const sqlScript = `select * from sys.all_objects;`; // SQL script to execute
		await vsCodePage.fill('textarea[class="inputarea monaco-mouse-cursor-text"]', sqlScript); // Fill the query editor with the script
		await vsCodePage.click('.action-label.codicon.codicon-debug-start'); // Execute the query
		await wait(2000); // waiting for the connections picker to appear
		await vsCodePage.keyboard.press('Enter'); // Select the created connection. It should be the first on the list
		if (password && savePassword === 'No') {
			await vsCodePage.fill('.input.empty[aria-label="input"]', password); // Fill the box password
			await vsCodePage.keyboard.press('Enter'); // Continue
		}
		await expect(await vsCodePage.locator('.grid')).not.toBeNull(); // Wait for the results to appear
	});

	test.afterEach(async ({ }, testInfo) => {
		await screenshotOnFailure(vsCodePage, testInfo);
	});

	test.afterAll(async () => {
		await vsCodeApp.close();
	});
});
