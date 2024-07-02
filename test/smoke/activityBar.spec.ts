/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { _electron as electron } from 'playwright';
import { ElectronApplication, test, expect } from '@playwright/test';
import * as path from 'path';

test.describe('MSSQL Extension - Activity Bar', async () => {
	let electronApp: ElectronApplication;

	test.beforeAll(async () => {
		const vscodeExecutablePath = await downloadAndUnzipVSCode('insiders');

		const extensionPath = path.resolve(__dirname, '../../../');
		electronApp = await electron.launch({
			executablePath: vscodeExecutablePath,
			args: [
				'--disable-extensions',
				'--extensionDevelopmentPath=' + extensionPath,
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

	test('MSSQL Extension button is present in activity bar', async () => {
		await new Promise(resolve => setTimeout(resolve, 5 * 1000));
		const vsCodeView = await electronApp.firstWindow({
			timeout: 10000
		});

		const count = await vsCodeView.locator('a[aria-label="SQL Server (Ctrl+Alt+D)"]').count();
		expect(count).toEqual(1);
	});

	test.afterAll(async () => {
		await electronApp.close();
	});
})