/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { _electron as electron } from 'playwright';
import * as path from 'path';
import { ElectronApplication, Page } from '@playwright/test';
import { getVsCodeVersionName } from './envConfigReader';

export async function launchVsCodeWithMssqlExtension(): Promise<{ electronApp: ElectronApplication, page: Page }> {
	const vsCodeVersionName = getVsCodeVersionName();
	const vsCodeExecutablePath = await downloadAndUnzipVSCode(vsCodeVersionName);

		const mssqlExtensionPath = path.resolve(__dirname, '../../../../');
		const electronApp = await electron.launch({
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

		const page = await electronApp.firstWindow({
			timeout: 10 * 1000 // 10 seconds
		});

		return { electronApp, page };
}
