/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { _electron as electron } from 'playwright';
import { ElectronApplication, test, expect } from '@playwright/test';
import * as path from 'path';

test.describe('MSSQL Extension - Activity Bar', async () => {
	let vsCodeApp: ElectronApplication;

	test.beforeAll(async () => {
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
	});

	test('MSSQL button is present in activity bar', async () => {
		const vsCodeWindow = await vsCodeApp.firstWindow({
			timeout: 10000
		});

		await vsCodeWindow.click('a[aria-label="SQL Server (Ctrl+Alt+D)"]');
		const count = await vsCodeWindow.locator('a[aria-label="SQL Server (Ctrl+Alt+D)"]').count();
		expect(count).toEqual(1);
	});

	test.afterAll(async () => {
		await vsCodeApp.close();
	});
});