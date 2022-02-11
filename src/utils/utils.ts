/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
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
 * Gets a unique file name
 * Increment the file name by adding 1 to function name if the file already exists
 * Undefined if the filename suffix count becomes greater than 1024
 * @param folderPath selected project folder path
 * @param fileName base filename to use
 * @returns a promise with the unique file name, or undefined
 */
export async function getUniqueFileName(folderPath: string, fileName: string): Promise<string | undefined> {
	let count: number = 0;
	const maxCount: number = 1024;
	let uniqueFileName = fileName;

	while (count < maxCount) {
		if (!fs.existsSync(path.join(folderPath, uniqueFileName + '.cs'))) {
			return uniqueFileName;
		}
		count += 1;
		uniqueFileName = fileName + count.toString();
	}
	return undefined;
}
