
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

/**
 * Generates a random nonce value that can be used in a webview
 */
export function getNonce(): string {
	let text = "";
	const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}