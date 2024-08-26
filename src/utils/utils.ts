/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as vscode from "vscode";

export async function exists(path: string): Promise<boolean> {
	try {
		await fs.access(path);
		return true;
	} catch (e) {
		return false;
	}
}

export async function fileExists(uri: vscode.Uri, filename: string): Promise<boolean> {
    const path = vscode.Uri.joinPath(uri, filename);
    try {
		await vscode.workspace.fs.stat(path);
		return true;
    } catch {
      	return false;
    }
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

export class CancelError extends Error { }
