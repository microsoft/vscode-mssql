/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Format a string. Behaves like C#'s string.Format() function.
 */
export function formatString(str: string, ...args: any[]): string {
	// This is based on code originally from https://github.com/Microsoft/vscode/blob/master/src/vs/nls.js
	// License: https://github.com/Microsoft/vscode/blob/master/LICENSE.txt
	let result: string;
	if (args.length === 0) {
		result = str;
	} else {
		result = str.replace(/\{(\d+)\}/g, (match, rest) => {
			let index = rest[0];
			return typeof args[index] !== 'undefined' ? args[index] : match;
		});
	}
	return result;
}
