/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
    decryptData,
    type EncryptedData,
    encryptData,
    generateEncryptionKey,
} from "./encryptionUtils";

/** Stores encrypted text in the extension's global storage. */
export class EncryptedFileStorage {
    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _fileName: string,
        private readonly _encryptionKeySecretStorageKey: string,
    ) {}

    public async read(): Promise<string | undefined> {
        const storageFileUri = this.getStorageFileUri();
        if (!(await this.fileExists(storageFileUri))) {
            return undefined;
        }

        const encryptionKey = await this._context.secrets.get(this._encryptionKeySecretStorageKey);
        if (!encryptionKey) {
            return undefined;
        }

        const encryptedFileContents = await vscode.workspace.fs.readFile(storageFileUri);
        const encryptedData = JSON.parse(
            new TextDecoder().decode(encryptedFileContents),
        ) as EncryptedData;

        return decryptData(encryptedData, encryptionKey);
    }

    public async write(content: string): Promise<void> {
        const encryptionKey = await this.getOrCreateEncryptionKey();
        const encryptedData = encryptData(content, encryptionKey);

        await vscode.workspace.fs.createDirectory(this._context.globalStorageUri);
        await vscode.workspace.fs.writeFile(
            this.getStorageFileUri(),
            new TextEncoder().encode(JSON.stringify(encryptedData)),
        );
    }

    public async clear(): Promise<void> {
        try {
            await vscode.workspace.fs.delete(this.getStorageFileUri(), { useTrash: false });
        } catch {
            // Ignore missing file errors when clearing persisted content.
        }
    }

    private async getOrCreateEncryptionKey(): Promise<string> {
        let encryptionKey = await this._context.secrets.get(this._encryptionKeySecretStorageKey);
        if (!encryptionKey) {
            encryptionKey = generateEncryptionKey();
            await this._context.secrets.store(this._encryptionKeySecretStorageKey, encryptionKey);
        }

        return encryptionKey;
    }

    private async fileExists(storageFileUri: vscode.Uri): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(storageFileUri);
            return true;
        } catch {
            return false;
        }
    }

    private getStorageFileUri(): vscode.Uri {
        return vscode.Uri.joinPath(this._context.globalStorageUri, this._fileName);
    }
}
