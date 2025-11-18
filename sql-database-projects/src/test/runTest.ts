/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { runTests } from '@vscode/test-electron';

function parsePatternArg(argv: string[]): string | undefined {
	const keys = new Set(['--testPattern', '--pattern', '--grep']);

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (keys.has(arg)) {
			return argv[i + 1];
		}

		const [key, value] = arg.split('=', 2);
		if (keys.has(key) && value) {
			return value;
		}
	}

	return undefined;
}

async function main(): Promise<void> {
	try {
		const extensionDevelopmentPath = path.resolve(__dirname, '../../');
		const extensionTestsPath = path.resolve(__dirname, './index');

		const cliPattern = parsePatternArg(process.argv.slice(2));
		const envPattern = process.env.TEST_PATTERN;
		const testPattern = cliPattern ?? envPattern ?? '';

		await runTests({
			extensionDevelopmentPath,
			extensionTestsPath,
			launchArgs: ['--disable-gpu'],
			extensionTestsEnv: {
				...process.env,
				TEST_PATTERN: testPattern,
				MOCHA_GREP: testPattern
			}
		});
	} catch (err) {
		console.error('Failed to run tests', err);
		process.exit(1);
	}
}

void main();
