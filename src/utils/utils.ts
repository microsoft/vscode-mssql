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

export class CancelError extends Error { }
