/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/
'use strict';

// This code is originally from https://github.com/microsoft/vsts-vscode
// License: https://github.com/Microsoft/vsts-vscode/blob/master/LICENSE.txt

import { FileTokenStorage } from './file-token-storage';
import { Credential } from '../credential';
import { ICredentialStore } from '../interfaces/icredentialstore';

import os = require('os');
import path = require('path');
import _ = require('underscore');


/**
 * Utility class to define the format for credentials
 *
 * @class CredentialDef
 */
class CredentialDef {
    public username: string;
    public password: string;
    public credentialId: string;
}

/*
    Provides the ICredentialStore API on top of file-based storage.
    Does not support any kind of 'prefix' of the credential (since its
    storage mechanism is not shared with either Windows or OSX).

    User must provide a custom folder and custom file name for storage.
 */
export class LinuxFileApi implements ICredentialStore {
    private _folder: string;
    private _filename: string;
    private _fts: FileTokenStorage;

    constructor(folder: string, filename: string) {
        this._folder = folder;
        this._filename = filename;
        this._fts = new FileTokenStorage(path.join(path.join(os.homedir(), this._folder, this._filename)));
    }

    public getCredential(credentialId: string): Promise<Credential> {
        let self = this;
        return new Promise<Credential>((resolve, reject) => {
            self.loadCredentials().then((entries) => {
                // Find the entry I want based on service
                let entryArray: Array<CredentialDef> = _.where(entries, { credentialId: credentialId });
                if (entryArray !== undefined && entryArray.length > 0) {
                    let credential: Credential = self.createCredential(entryArray[0]);
                    resolve(credential);
                } else {
                    resolve(undefined);
                }
            })
            .catch((err) => {
                reject(err);
            });
        });
    }

    public setCredential(credentialId: string, username: string, password: string): Promise<void> {
        let self = this;
        return new Promise<void>((resolve, reject) => {
            self.loadCredentials().then((entries) => {
                // Remove any entries that are the same as the one I'm about to add
                let existingEntries = _.reject(entries, function(elem: CredentialDef): boolean {
                    return elem.username === username && elem.credentialId === credentialId;
                });

                let newEntry: CredentialDef = {
                    username: username,
                    password: password,
                    credentialId: credentialId
                };
                self._fts.addEntries([ newEntry ], existingEntries).then(() => {
                    resolve(undefined);
                }).catch((err) => {
                    reject(err);
                });
            })
            .catch((err) => {
                reject(err);
            });
        });
    }

    public getCredentialByName(credentialId: string, username: string): Promise<Credential> {
        let self = this;
        return new Promise<Credential>((resolve, reject) => {
            self.loadCredentials().then((entries) => {
                // Find the entry I want based on service and username
                let entryArray: Array<CredentialDef> = _.where(entries, { credentialId: credentialId, username: username });
                if (entryArray !== undefined && entryArray.length > 0) {
                    let credential: Credential = self.createCredential(entryArray[0]);
                    resolve(credential);
                } else {
                    resolve(undefined);
                }
            })
            .catch((err) => {
                reject(err);
            });
        });
    }

    public removeCredential(credentialId: string): Promise<void> {
        return this.doRemoveCredential((elem) => {
            return elem.credentialId === credentialId;
        });
    }

    public removeCredentialByName(credentialId: string, username: string): Promise<void> {
        return this.doRemoveCredential((elem) => {
            if (username === '*') {
                return elem.credentialId === credentialId;
            } else {
                return elem.username === username && elem.credentialId === credentialId;
            }
        });
    }

    private doRemoveCredential(entryFilter: (a: CredentialDef) => boolean): Promise<void> {
        let self = this;
        return new Promise<void>((resolve, reject) => {
            self.loadCredentials().then((entries) => {
                // Find the entry being asked to be removed; if found, remove it, save the remaining list
                let existingEntries = _.reject(entries, entryFilter);
                // TODO: RemoveEntries doesn't do anything with first arg.  For now, do nothing to
                // the api as I'm wrapping it in all its glory.  Could consider later.
                self._fts.removeEntries(undefined, existingEntries).then(() => {
                    resolve(undefined);
                }).catch((err) => {
                    reject(err);
                });
            })
            .catch((err) => {
                reject(err);
            });
        });
    }

    private createCredential(cred: CredentialDef): Credential {
        return new Credential(cred.credentialId, cred.username, cred.password);
    }

    private loadCredentials(): Promise<CredentialDef[]> {
        let self = this;
        return new Promise<CredentialDef[]>((resolve, reject) => {
            self._fts.loadEntries().then((entries) => {
                resolve(entries);
            })
            .catch((err) => {
                reject(err);
            });
        });
    }
}
