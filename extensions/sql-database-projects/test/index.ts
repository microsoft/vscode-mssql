/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './stubs/moduleShims';

import * as path from 'path';
import * as glob from 'fast-glob';
import * as Mocha from 'mocha';

let NYC: any;
try {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	NYC = require('nyc');
} catch {
	// NYC is optional for local runs; coverage will be skipped if unavailable
}

const testsRoot = path.resolve(__dirname);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function parsePattern(): { pattern?: string; invert?: boolean } {
	const envPattern = process.env.TEST_PATTERN || process.env.MOCHA_GREP;
	const invert = /^true$/i.test(process.env.TEST_INVERT || process.env.MOCHA_INVERT || '');

	return { pattern: envPattern, invert };
}

export async function run(): Promise<void> {
	const baseConfig = {
		all: false,
		checkCoverage: false,
		extension: ['.js']
	};

	const nyc = NYC
		? new NYC({
			...baseConfig,
			cwd: repoRoot,
			reporter: ['text-summary', 'lcov', 'cobertura'],
			all: true,
			silent: true,
			instrument: true,
			hookRequire: true,
			hookRunInContext: true,
			hookRunInThisContext: true,
			include: ['out/src/**/*.js'],
			exclude: ['out/src/test/**', '**/node_modules/**'],
			tempDir: path.join(repoRoot, 'coverage', '.nyc_output')
		})
		: undefined;

	if (nyc) {
		await nyc.reset();
		await nyc.wrap();
	}

	const mocha = new Mocha({
		ui: 'bdd',
		timeout: 30 * 1000,
		color: true,
		reporter: 'spec'
	});

	const { pattern, invert } = parsePattern();
	if (pattern) {
		const expression = new RegExp(pattern);
		mocha.grep(expression);
		if (invert) {
			mocha.invert();
		}
	}

	const testFiles = glob.sync('**/*.test.js', { cwd: testsRoot, absolute: true });
	testFiles.forEach((file) => mocha.addFile(file));

	await new Promise<void>((resolve, reject) => {
		mocha.run(async (failures) => {
			if (nyc) {
				try {
					await nyc.writeCoverageFile();
					await nyc.report();
				} catch (error) {
					return reject(error instanceof Error ? error : new Error(String(error)));
				}
			}

			if (failures > 0) {
				reject(new Error(`${failures} tests failed.`));
			} else {
				resolve();
			}
		});
	});
}
