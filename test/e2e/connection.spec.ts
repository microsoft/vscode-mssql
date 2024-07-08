/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ElectronApplication, Page, Locator, test, expect } from '@playwright/test';
import { launchVsCodeWithMssqlExtension } from './utils/launchVscodeWithMsSqlExt';
import { screenshotOnFailure } from './utils/screenshotOnError';
import { getServerName, getDatabaseName, getAuthenticationType, getUserName, getPassword, getProfileName, getSavePassword } from './utils/envConfigReader';
import { addDatabaseConnection } from './utils/testHelpers';

test.describe('MSSQL Extension - Database Connection', async () => {
	let vsCodeApp: ElectronApplication;
	let vsCodePage: Page;

	test.beforeAll(async () => {
		const { electronApp, page } = await launchVsCodeWithMssqlExtension();
		vsCodeApp = electronApp;
		vsCodePage = page;
	});

	test('Connect to local SQL Database, and disconnect', async () => {
		const serverName = getServerName();
		const databaseName = getDatabaseName();
		const authType = getAuthenticationType();
		const userName = getUserName();
		const password = getPassword();
		const savePassword = getSavePassword();
		const profileName = getProfileName();
		await addDatabaseConnection(vsCodePage, serverName, databaseName, authType, userName, password, savePassword, profileName);

		let addedSqlConnection: Locator;
		if (profileName) {
			addedSqlConnection = await vsCodePage.locator(`div[aria-label="${profileName}"]`);
		}
		else {
			addedSqlConnection = await vsCodePage.getByText(`${serverName}`);
		}

		await expect(addedSqlConnection).toBeVisible({ timeout: 20 * 1000 });

		await addedSqlConnection.click({ button: 'right' });
		const disconnectOption = await vsCodePage.locator('span[aria-label="Disconnect"]');
		await disconnectOption.click();
		const isDiconnectOptionVisible = await disconnectOption.isVisible()
		if (isDiconnectOptionVisible) {
			await disconnectOption.click();
		}

		await addedSqlConnection.click({ button: 'right' });
		await expect(disconnectOption).toBeHidden({ timeout: 10000 });
	});

	test.afterEach(async ({ }, testInfo) => {
		await screenshotOnFailure(vsCodePage, testInfo);
	});

	test.afterAll(async () => {
		await vsCodeApp.close();
	});
});
