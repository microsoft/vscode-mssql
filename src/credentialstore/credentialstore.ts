/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/
'use strict';

// This code is originally from https://github.com/microsoft/vsts-vscode
// License: https://github.com/Microsoft/vsts-vscode/blob/master/LICENSE.txt

import os = require('os');

import { LinuxFileApi } from './linux/linux-file-api';
import { OsxKeychainApi } from './osx/osx-keychain-api';
import { WindowsCredentialStoreApi } from './win32/win-credstore-api';
import { ICredentialStore } from './interfaces/icredentialstore';
import { Credential } from './credential';

/**
 * Implements a credential storage for Windows, Mac (darwin), or Linux.
 *
 * Allows a single credential to be stored per service (that is, one username per service);
 */
export class CredentialStore implements ICredentialStore {
    private _credentialStore: ICredentialStore;
    private _filename: string;
    private _folder: string;
    private _prefix: string;
    private _defaultPrefix: string = 'secret:';
    private _defaultFilename: string = 'secrets.json';
    private _defaultFolder: string = '.secrets';

    constructor(prefix?: string, folder?: string, filename?: string) {
        if (prefix !== undefined) {
            this._prefix = prefix;
        }
        if (folder !== undefined) {
            this._folder = folder;
        }
        if (filename !== undefined) {
            this._filename = filename;
        }

        // In the case of win32 or darwin, this._folder will contain the prefix.
        switch (os.platform()) {
            case 'win32':
                if (prefix === undefined) {
                    this._prefix = this._defaultPrefix;
                }
                this._credentialStore = new WindowsCredentialStoreApi(this._prefix);
                break;
            case 'darwin':
                if (prefix === undefined) {
                    this._prefix = this._defaultPrefix;
                }
                this._credentialStore = new OsxKeychainApi(this._prefix);
                break;
            /* tslint:disable:no-switch-case-fall-through */
            case 'linux':
            default:
            /* tslint:enable:no-switch-case-fall-through */
                if (folder === undefined) {
                    this._folder = this._defaultFolder;
                }
                if (filename === undefined) {
                    this._filename = this._defaultFilename;
                }
                this._credentialStore = new LinuxFileApi(this._folder, this._filename);
                break;
        }
    }

    /**
     * Gets a credential saved in the credential store
     *
     * @param {string} credentialId the ID uniquely identifying this credential
     * @returns {Promise<Credential>} Promise that resolved to the credential, or undefined if not found
     */
    public getCredential(credentialId: string): Promise<Credential> {
        return this._credentialStore.getCredential(credentialId);
    }

    public setCredential(credentialId: string, username: string, password: any): Promise<void> {
        let self = this;
        return new Promise<void>((resolve, reject) => {
            // First, look to see if we have a credential for this service already.  If so, remove it
            // since we don't know if the user is changing the username or the password (or both) for
            // the particular service.
            self.getCredential(credentialId).then((cred) => {
                if (cred !== undefined) {
                    // On Windows, "*" will delete all matching credentials in one go
                    // On Linux, we use 'underscore' to remove the ones we want to remove and save the leftovers
                    // On Mac, "*" will find all matches and delete each individually
                    self.removeCredential(credentialId).then(() => {
                        self._credentialStore.setCredential(credentialId, username, password).then(() => {
                            resolve(undefined);
                        });
                    });
                } else {
                    self._credentialStore.setCredential(credentialId, username, password).then(() => {
                        resolve(undefined);
                    });
                }
            }).catch((reason) => {
                reject(reason);
            });
        });
    }

    public removeCredential(credentialId: string): Promise<void> {
        return this._credentialStore.removeCredential(credentialId);
    }

    // Used by tests to ensure certain credentials we create don't exist
    public getCredentialByName(credentialId: string, username: string): Promise<Credential> {
        return this._credentialStore.getCredentialByName(credentialId, username);
    }

    // Used by tests to remove certain credentials
    public removeCredentialByName(credentialId: string, username: string): Promise<void> {
        return this._credentialStore.removeCredentialByName(credentialId, username);
    }
}
