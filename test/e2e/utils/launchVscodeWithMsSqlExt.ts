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

		const args = [
			'--extensionDevelopmentPath=' + mssqlExtensionPath,
			'--disable-gpu-sandbox', // https://github.com/microsoft/vscode-test/issues/221
			'--disable-updates', // https://github.com/microsoft/vscode-test/issues/120
			'--new-window', // Opens a new session of VS Code instead of restoring the previous session (default).
			'--no-sandbox', // https://github.com/microsoft/vscode/issues/84238
			'--profile-temp', // "debug in a clean environment"
			'--skip-release-notes',
			'--skip-welcome',
			'--disable-telemetry',
			'--no-cached-data',
			'--disable-workspace-trust',
			'--verbose',
		];

		if (process.platform === 'linux') {
			// --disable-dev-shm-usage: when run on docker containers where size of /dev/shm
			// partition < 64MB which causes OOM failure for chromium compositor that uses
			// this partition for shared memory.
			// Refs https://github.com/microsoft/vscode/issues/152143
			args.push('--disable-dev-shm-usage');
		}

		if (process.platform === 'darwin') {
			// On macOS force software based rendering since we are seeing GPU process
			// hangs when initializing GL context. This is very likely possible
			// that there are new displays available in the CI hardware and
			// the relevant drivers couldn't be loaded via the GPU sandbox.
			// TODO(deepak1556): remove this switch with Electron update.
			args.push('--use-gl=swiftshader');
		}


		const electronApp = await electron.launch({
			executablePath: vsCodeExecutablePath,
			args: args,
		});



		const page = await electronApp.firstWindow({
			timeout: 10 * 1000 // 10 seconds
		});

		return { electronApp, page };
}
