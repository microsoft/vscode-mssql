/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { _electron as electron } from 'playwright';
import { test } from '@playwright/test';
import * as path from 'path';


test('Launch VS Code extension host with MSSQL ext', async () => {
	const vscodeExecutablePath = await downloadAndUnzipVSCode('insiders');

	const extensionPath = path.resolve(__dirname, '../../../');
	const electronApp = await electron.launch({
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

	await new Promise(resolve => setTimeout(resolve, 20 * 1000));

	await electronApp.close();
})