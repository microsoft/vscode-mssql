/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import { escapeClosingBrackets } from '../models/utils';

export async function executeCommand(command: string, cwd?: string): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		cp.exec(command, { maxBuffer: 500 * 1024, cwd: cwd }, (error: Error, stdout: string, stderr: string) => {
			if (error) {
				reject(error);
				return;
			}
			if (stderr && stderr.length > 0) {
				reject(new Error(stderr));
				return;
			}
			resolve(stdout);
		});
	});
}

/**
 * Generates a quoted full name for the object
 * @param schema of the object
 * @param objectName object chosen by the user
 * @returns the quoted and escaped full name of the specified schema and object
 */
export function generateQuotedFullName(schema: string, objectName: string): string {
	return `[${escapeClosingBrackets(schema)}].[${escapeClosingBrackets(objectName)}]`;
}

/**
 * Returns a promise that will reject after the specified timeout
 * @param ms timeout in milliseconds. Default is 10 seconds
 * @param errorMessage error message to be returned in the rejection
 * @returns a promise that rejects after the specified timeout
 */
export function timeoutPromise(errorMessage: string, ms: number = 10000): Promise<string> {
	return new Promise((_, reject) => {
		setTimeout(() => {
			reject(new Error(errorMessage));
		}, ms);
	});
}
