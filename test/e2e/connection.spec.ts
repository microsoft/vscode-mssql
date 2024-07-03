/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ElectronApplication, Page, test, expect } from '@playwright/test';
import { launchVsCodeWithMssqlExtension } from './utils/launchVscodeWithMsqqlExt.ts';
import { screenshotOnFailure } from './utils/screenshotOnError.js';

test.describe('MSSQL Extension - Database Connection', async () => {
	let vsCodeApp: ElectronApplication;
	let vsCodePage: Page;

	test.beforeAll(async () => {
		const { electronApp, page } = await launchVsCodeWithMssqlExtension();
		vsCodeApp = electronApp;
		vsCodePage = page;
	});

	test('Connect to local SQL Database, and disconnect', async () => {
		// wait for 30 seconds
		const addConnectionButton = await vsCodePage.locator('div[aria-label="Add Connection"]');
		let isConnectionButtonVisible = await addConnectionButton.isVisible();
		if (!isConnectionButtonVisible) {
			await vsCodePage.click('a[aria-label="SQL Server (Ctrl+Alt+D)"]');
		}

		await expect(addConnectionButton).toBeVisible({ timeout: 10000 });
		await addConnectionButton.click();

		// await vsCodePage.click('input[aria-label="input"]');
		await vsCodePage.fill('input[aria-label="input"]', '(localdb)\\MSSqlLocalDb');
		await vsCodePage.keyboard.press('Enter');

		await vsCodePage.keyboard.press('Enter');

		await vsCodePage.fill('input[aria-label="input"]', 'Integrated');
		await vsCodePage.keyboard.press('Enter');

		await vsCodePage.fill('input[aria-label="input"]', 'test-connection');
		await vsCodePage.keyboard.press('Enter');

		const addedSqlConnection = await vsCodePage.locator('div[aria-label="test-connection"]');
		await expect(addedSqlConnection).toBeVisible({ timeout: 10000 });

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
