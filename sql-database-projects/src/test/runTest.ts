/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
	try {
		const extensionDevelopmentPath = path.resolve(__dirname, '../../');
		const extensionTestsPath = path.resolve(__dirname, './index');

		await runTests({
			extensionDevelopmentPath,
			extensionTestsPath,
			launchArgs: ['--disable-gpu']
		});
	} catch (err) {
		console.error('Failed to run extension tests', err);
		process.exit(1);
	}
}

void main();
