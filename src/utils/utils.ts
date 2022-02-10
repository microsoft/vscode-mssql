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
 * Copied from Azure function: Create Function
 * https://github.com/microsoft/vscode-azurefunctions/blob/main/src/commands/createFunction/FunctionNameStepBase.ts
 * @param folderPath selected azure project folder path
 * @param functionName objectName that was chosen by the user
 * @returns the function name that will always add at least `1` to the function name
 */
export async function getUniqueFsPath(folderPath: string, functionName: string): Promise<string | undefined> {
	let count: number = 1;
	const maxCount: number = 1024;

	while (count < maxCount) {
		const fileName: string = functionName + count.toString();
		if (!(fs.existsSync(path.join(folderPath, '.cs' ? fileName + '.cs' : fileName)))) {
			return fileName;
		}
		count += 1;
	}

	return undefined;
}
