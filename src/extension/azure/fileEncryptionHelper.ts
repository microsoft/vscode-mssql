/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from "os";
import * as crypto from "crypto";
import * as vscode from "vscode";
import * as LocalizedConstants from "../constants/locConstants";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { ICredentialStore } from "../credentialstore/icredentialstore";
import {
    DidChangeEncryptionIVKeyParams,
    EncryptionKeysChangedNotification,
} from "../models/contracts/connection";
import { Logger } from "../models/logger";
import SqlToolsServerClient from "../languageservice/serviceclient";
import { azureAccountProviderCredentials } from "./constants";
import { getEnableSqlAuthenticationProviderConfig } from "./utils";

export class FileEncryptionHelper {
    constructor(
        private readonly _credentialStore: ICredentialStore,
        private readonly _vscodeWrapper: VscodeWrapper,
        protected readonly _logger: Logger,
        protected readonly _fileName: string,
    ) {
        this._algorithm = "aes-256-cbc";
        this._bufferEncoding = "utf16le";
        this._binaryEncoding = "base64";
    }

    private ivCredId = `${this._fileName}-iv`;
    private keyCredId = `${this._fileName}-key`;

    private _algorithm: string;
    private _bufferEncoding: BufferEncoding;
    private _binaryEncoding: crypto.BinaryToTextEncoding;
    private _ivBuffer: Buffer | undefined;
    private _keyBuffer: Buffer | undefined;

    public async init(): Promise<void> {
        const iv = await this.readEncryptionKey(this.ivCredId);
        const key = await this.readEncryptionKey(this.keyCredId);

        if (!iv || !key) {
            this._ivBuffer = crypto.randomBytes(16);
            this._keyBuffer = crypto.randomBytes(32);

            if (
                !(await this.saveEncryptionKey(
                    this.ivCredId,
                    this._ivBuffer.toString(this._bufferEncoding),
                )) ||
                !(await this.saveEncryptionKey(
                    this.keyCredId,
                    this._keyBuffer.toString(this._bufferEncoding),
                ))
            ) {
                this._logger.error(
                    `Encryption keys could not be saved in credential store, this will cause access token persistence issues.`,
                );
                await this.showCredSaveErrorOnWindows();
            }
        } else {
            this._ivBuffer = Buffer.from(iv, this._bufferEncoding);
            this._keyBuffer = Buffer.from(key, this._bufferEncoding);
        }

        if (getEnableSqlAuthenticationProviderConfig()) {
            SqlToolsServerClient.instance.sendNotification(EncryptionKeysChangedNotification.type, <
                DidChangeEncryptionIVKeyParams
            >{
                iv: this._ivBuffer.toString(this._bufferEncoding),
                key: this._keyBuffer.toString(this._bufferEncoding),
            });
        }
    }

    fileSaver = async (content: string): Promise<string> => {
        if (!this._keyBuffer || !this._ivBuffer) {
            await this.init();
        }
        const cipherIv = crypto.createCipheriv(this._algorithm, this._keyBuffer!, this._ivBuffer!);
        let cipherText = `${cipherIv.update(content, "utf8", this._binaryEncoding)}${cipherIv.final(this._binaryEncoding)}`;
        return cipherText;
    };

    fileOpener = async (content: string, resetOnError?: boolean): Promise<string> => {
        try {
            if (!this._keyBuffer || !this._ivBuffer) {
                await this.init();
            }
            let plaintext = content;
            const decipherIv = crypto.createDecipheriv(
                this._algorithm,
                this._keyBuffer!,
                this._ivBuffer!,
            );
            return `${decipherIv.update(plaintext, this._binaryEncoding, "utf8")}${decipherIv.final("utf8")}`;
        } catch (ex) {
            this._logger.error(
                `FileEncryptionHelper: Error occurred when decrypting data, IV/KEY will be reset: ${ex}`,
            );
            if (resetOnError) {
                // Reset IV/Keys if crypto cannot encrypt/decrypt data.
                // This could be a possible case of corruption of expected iv/key combination
                await this.clearEncryptionKeys();
                await this.init();
            }
            // Throw error so cache file can be reset to empty.
            throw new Error(`Decryption failed with error: ${ex}`);
        }
    };

    /**
     * Creates credential Id similar to ADS to prevent creating multiple credentials
     * and this will also be read by STS in same pattern.
     * @param credentialId Credential Id
     * @returns Prefix credential Id.
     */
    private getPrefixedCredentialId(credentialId: string): string {
        return `${azureAccountProviderCredentials}|${credentialId}`;
    }

    private async readEncryptionKey(credentialId: string): Promise<string | undefined> {
        return (
            await this._credentialStore.readCredential(this.getPrefixedCredentialId(credentialId))
        )?.password;
    }

    private async saveEncryptionKey(credentialId: string, password: string): Promise<boolean> {
        let status = false;
        let prefixedCredentialId = this.getPrefixedCredentialId(credentialId);
        try {
            await this._credentialStore.saveCredential(prefixedCredentialId, password).then(
                (result) => {
                    status = result;
                    if (result) {
                        this._logger.info(
                            `FileEncryptionHelper: Successfully saved encryption key ${prefixedCredentialId} for persistent cache encryption in system credential store.`,
                        );
                    }
                },
                (e) => {
                    throw Error(
                        `FileEncryptionHelper: Could not save encryption key: ${prefixedCredentialId}: ${e}`,
                    );
                },
            );
        } catch (ex) {
            if (os.platform() === "win32") {
                this._logger.error(
                    `FileEncryptionHelper: Please try cleaning saved credentials from Windows Credential Manager created by Azure Data Studio to allow creating new credentials.`,
                );
            }
            this._logger.error(ex);
            throw ex;
        }
        return status;
    }

    public async clearEncryptionKeys(): Promise<void> {
        await this.deleteEncryptionKey(this.ivCredId);
        await this.deleteEncryptionKey(this.keyCredId);
        this._ivBuffer = undefined;
        this._keyBuffer = undefined;
    }

    protected async deleteEncryptionKey(credentialId: string): Promise<boolean> {
        return await this._credentialStore.deleteCredential(credentialId);
    }

    private async showCredSaveErrorOnWindows(): Promise<void> {
        if (os.platform() === "win32") {
            await this._vscodeWrapper
                .showWarningMessageAdvanced(
                    LocalizedConstants.msgAzureCredStoreSaveFailedError,
                    undefined,
                    [LocalizedConstants.reloadChoice, LocalizedConstants.Common.cancel],
                )
                .then(
                    async (selection) => {
                        if (selection === LocalizedConstants.reloadChoice) {
                            await vscode.commands.executeCommand("workbench.action.reloadWindow");
                        }
                    },
                    (error) => {
                        this._logger.error(error);
                    },
                );
        }
    }
}
