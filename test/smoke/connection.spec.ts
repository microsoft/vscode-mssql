/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { _electron as electron } from 'playwright';
import { ElectronApplication, Page, test, expect } from '@playwright/test';
import * as path from 'path';

test.describe('MSSQL Extension - Database Connection', async () => {
	let vsCodeApp: ElectronApplication;
	let vsCodePage: Page;

	test.beforeEach(async () => {
		const vsCodeExecutablePath = await downloadAndUnzipVSCode('insiders');

		const mssqlExtensionPath = path.resolve(__dirname, '../../../');
		vsCodeApp = await electron.launch({
			executablePath: vsCodeExecutablePath,
			args: [
				'--disable-extensions',
				'--extensionDevelopmentPath=' + mssqlExtensionPath,
				'--disable-gpu-sandbox', // https://github.com/microsoft/vscode-test/issues/221
				'--disable-updates', // https://github.com/microsoft/vscode-test/issues/120
				'--new-window', // Opens a new session of VS Code instead of restoring the previous session (default).
				'--no-sandbox', // https://github.com/microsoft/vscode/issues/84238
				'--profile-temp', // "debug in a clean environment"
				'--skip-release-notes',
				'--skip-welcome'
			],
		});

		vsCodePage = await vsCodeApp.firstWindow({
			timeout: 10 * 1000 // 10 seconds
		});
	});

	test('Connect to local SQL Database', async () => {
		// wait for 30 seconds
		const addConnectionButton = await vsCodePage.locator('div[aria-label="Add Connection"]');
		let isConnectionButtonVisible = await addConnectionButton.isVisible();
		console.log(`isVisible: ${isConnectionButtonVisible ? 'true' : 'false'}`)

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
	});

	test.afterEach(async () => {
		await vsCodeApp.close();
	});
});