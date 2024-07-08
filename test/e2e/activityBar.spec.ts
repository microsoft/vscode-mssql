/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ElectronApplication, Page, test, expect } from '@playwright/test';
import { launchVsCodeWithMssqlExtension } from './utils/launchVscodeWithMsSqlExt';
import { screenshotOnFailure } from './utils/screenshotOnError';

test.describe('MSSQL Extension - Activity Bar', async () => {
	let vsCodeApp: ElectronApplication;
	let vsCodePage: Page;

	test.beforeAll(async () => {
		const { electronApp, page } = await launchVsCodeWithMssqlExtension();
		vsCodeApp = electronApp;
		vsCodePage = page;
	});

	test('MSSQL button is present in activity bar', async () => {
		await vsCodePage.click('a[aria-label="SQL Server (Ctrl+Alt+D)"]');
		const count = await vsCodePage.locator('a[aria-label="SQL Server (Ctrl+Alt+D)"]').count();
		expect(count).toEqual(1);
	});

	test.afterEach(async ({ }, testInfo) => {
		await screenshotOnFailure(vsCodePage, testInfo);
	});

	test.afterAll(async () => {
		await vsCodeApp.close();
	});
});
