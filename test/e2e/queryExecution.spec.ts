/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ElectronApplication, expect, Locator, Page, test } from '@playwright/test';
import { launchVsCodeWithMssqlExtension } from './utils/launchVscodeWithMsSqlExt';
import { screenshotOnFailure } from './utils/screenshotOnError';
import { addDatabaseConnection, wait } from './utils/testHelpers';
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

		vsCodePage.keyboard.press('F1');

		await vsCodePage.fill('input[class="input"]', '> new query');
		await vsCodePage.getByText('MS SQL: New Query').click();
		await vsCodePage.keyboard.press('Enter');
		const sqlScript = `select * from sys.all_objects;`;
		await vsCodePage.fill('textarea[class="inputarea monaco-mouse-cursor-text"]', sqlScript);
		await vsCodePage.click('.action-label.codicon.codicon-debug-start');
		await wait(2000);
		await vsCodePage.keyboard.press('Enter');
		await vsCodePage.fill('.input.empty[aria-label="input"]', password);
		await vsCodePage.keyboard.press('Enter');
		await expect(await vsCodePage.locator('.grid')).not.toBeNull();
	});
});
