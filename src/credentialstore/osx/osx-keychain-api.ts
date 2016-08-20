/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/
'use strict';

// This code is originally from https://github.com/microsoft/vsts-vscode
// License: https://github.com/Microsoft/vsts-vscode/blob/master/LICENSE.txt

import { Credential } from '../credential';
import { ICredentialStore } from '../interfaces/icredentialstore';

import osxkeychain = require('./osx-keychain');

/*
 * Provides the ICredentialStore API on top of OSX keychain-based storage.
 * User can provide a custom prefix for the credential.
 */
export class OsxKeychainApi implements ICredentialStore {
    private _prefix: string;

    constructor(credentialPrefix: string) {
        if (credentialPrefix !== undefined) {
            this._prefix = credentialPrefix;
            osxkeychain.setPrefix(credentialPrefix);
        }
    }

    public getCredential(credentialId: string): Promise<Credential> {
        let self = this;
        return new Promise<Credential>((resolve, reject) => {
            let credential: Credential;

            // To get the credential, I must first list all of the credentials we previously
            // stored there.  Find the one we want, then go and ask for the secret.
            self.listCredentials().then((credentials) => {
                // Spin through the returned credentials to ensure I got the one I want
                // based on passed in 'service'
                for (let index = 0; index < credentials.length; index++) {
                    if (credentials[index].CredentialId === credentialId) {
                        credential = credentials[index];
                        break;
                    }
                }
                if (credential !== undefined) {
                    // Go get the password
                    osxkeychain.get(credential.Username, credential.CredentialId, function(err, cred): void {
                        if (err) {
                            reject(err);
                        }
                        if (cred !== undefined) {
                            credential = new Credential(credential.CredentialId, credential.Username, cred);
                            resolve(credential);
                        }
                    });
                } else {
                    resolve(undefined);
                }
            }).catch((reason) => {
                reject(reason);
            });
        });
    }

    public setCredential(credentialId: string, username: string, password: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            // I'm not supporting a description so pass "" for that parameter
            osxkeychain.set(username, credentialId, '' /*description*/, password, function(err): void {
                if (err) {
                    reject(err);
                } else {
                    resolve(undefined);
                }
            });
        });
    }

    public removeCredential(credentialId: string): Promise<void> {
        let self = this;
        return new Promise<void>((resolve, reject) => {
            self.removeCredentials(credentialId).then(() => {
                resolve(undefined);
            })
            .catch((reason) => {
                reject(reason);
            });
        });
    }

    public getCredentialByName(credentialId: string, username: string): Promise<Credential> {
        let self = this;
        return new Promise<Credential>((resolve, reject) => {
            let credential: Credential;

            // To get the credential, I must first list all of the credentials we previously
            // stored there.  Find the one we want, then go and ask for the secret.
            self.listCredentials().then((credentials) => {
                // Spin through the returned credentials to ensure I got the one I want
                // based on passed in 'credentialId'
                for (let index = 0; index < credentials.length; index++) {
                    if (credentials[index].CredentialId === credentialId && credentials[index].Username === username) {
                        credential = credentials[index];
                        break;
                    }
                }
                if (credential !== undefined) {
                    // Go get the password
                    osxkeychain.get(credential.Username, credential.CredentialId, function(err, cred): void {
                        if (err) {
                            reject(err);
                        }
                        if (cred !== undefined) {
                            credential = new Credential(credential.CredentialId, credential.Username, cred);
                            resolve(credential);
                        }
                    });
                } else {
                    resolve(undefined);
                }
            }).catch((reason) => {
                reject(reason);
            });
        });
    }

    public removeCredentialByName(credentialId: string, username: string): Promise<void> {
        let self = this;
        return new Promise<void>((resolve, reject) => {
            // if username === "*", we need to remove all credentials for this service.
            if (username === '*') {
                self.removeCredentials(credentialId).then(() => {
                    resolve(undefined);
                })
                .catch((reason) => {
                    reject(reason);
                });
            } else {
                osxkeychain.remove(username, credentialId, '' /*description*/, function(err): void {
                    if (err) {
                        if (err.code !== undefined && err.code === 44) {
                            // If credential is not found, don't fail.
                            resolve(undefined);
                        } else {
                            reject(err);
                        }
                    } else {
                        resolve(undefined);
                    }
                });
            }
        });
    }

    private removeCredentials(credentialId: string): Promise<void> {
        let self = this;
        return new Promise<void>((resolve, reject) => {
            // listCredentials will return all of the credentials for this prefix and credentialId
            self.listCredentials(credentialId).then((creds) => {
                if (creds !== undefined && creds.length > 0) {
                    // Remove all of these credentials
                    let promises: Promise<void>[] = [];
                    creds.forEach((cred) => {
                        promises.push(self.removeCredentialByName(cred.CredentialId, cred.Username));
                    });

                    Promise.all(promises).then(() => {
                        resolve(undefined);
                    });
                } else {
                    resolve(undefined);
                }
            });
        });
    }

    private listCredentials(service?: string): Promise<Array<Credential>> {
        let self = this;
        return new Promise<Array<Credential>>((resolve, reject) => {
            let credentials: Array<Credential> = [];

            let stream = osxkeychain.list();
            stream.on('data', (cred) => {
                // Don't return all credentials, just ones that start
                // with our prefix and optional service
                if (cred.svce !== undefined) {
                    if (cred.svce.indexOf(self._prefix) === 0) {
                        let svc: string = cred.svce.substring(self._prefix.length);
                        let username: string = cred.acct;
                        // password is undefined because we don't have it yet
                        let credential: Credential = new Credential(svc, username, undefined);

                        // Only add the credential if we want them all or it's a match on service
                        if (service === undefined || service === svc) {
                            credentials.push(credential);
                        }
                    }
                }
            });
            stream.on('end', () => {
                resolve(credentials);
            });
            stream.on('error', (error) => {
                console.log(error);
                reject(error);
            });
        });
    }
}
