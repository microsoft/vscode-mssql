/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/
'use strict';

// This code is originally from https://github.com/microsoft/vsts-vscode
// License: https://github.com/Microsoft/vsts-vscode/blob/master/LICENSE.txt

import { Credential } from '../credential';
import { ICredentialStore } from '../interfaces/icredentialstore';

let wincredstore = require('./win-credstore');

/*
    Provides the ICredentialStore API on top of Windows Credential Store-based storage.

    User can provide a custom prefix for the credential.
 */
export class WindowsCredentialStoreApi implements ICredentialStore {
    private static separator: string = '|';

    constructor(credentialPrefix: string) {
        if (credentialPrefix !== undefined) {
            wincredstore.setPrefix(credentialPrefix);
        }
    }

    public getCredential(credentialId: string): Promise<Credential> {
        let self = this;
        return new Promise<Credential>((resolve, reject) => {
            let credential: Credential;

            // TODO: Why not just have listCredentials send back the ones I want based on (optional) service?
            self.listCredentials().then((credentials) => {
                // Spin through the returned credentials to ensure I got the one I want based on passed in 'service'
                for (let index = 0; index < credentials.length; index++) {
                    credential = self.createCredential(credentials[index]);
                    if (credential.credentialId === credentialId) {
                        break;
                    } else {
                        // The current credential isn't the one we're looking for
                        credential = undefined;
                    }
                }
                resolve(credential);
            }).catch((reason) => {
                reject(reason);
            });
        });
    }

    public setCredential(credentialId: string, username: string, password: any): Promise<void> {
        let self = this;
        return new Promise<void>((resolve, reject) => {
            let targetName: string = self.createTargetName(credentialId, username);

            // Here, `password` is either the password or pat
            wincredstore.set(targetName, password, function(err): void {
                if (err) {
                    reject(err);
                } else {
                    resolve(undefined);
                }
            });
        });
    }

    // Adding for test purposes (to ensure a particular credential doesn't exist)
    public getCredentialByName(credentialId: string, username: string): Promise<Credential> {
        let self = this;
        return new Promise<Credential>((resolve, reject) => {
            let credential: Credential;

            self.listCredentials().then((credentials) => {
                // Spin through the returned credentials to ensure I got the one I want based on passed in 'service'
                for (let index = 0; index < credentials.length; index++) {
                    credential = self.createCredential(credentials[index]);
                    if (credential.credentialId === credentialId && credential.username === username) {
                        break;
                    } else {
                        // The current credential isn't the one we're looking for
                        credential = undefined;
                    }
                }
                resolve(credential);
            }).catch((reason) => {
                reject(reason);
            });
        });
    }

    public removeCredential(credentialId: string): Promise<void> {
        let targetName: string = this.createTargetName(credentialId, '*');
        return this.doRemoveCredential(targetName);
    }

    public removeCredentialByName(credentialId: string, username: string): Promise<void> {
        let targetName: string = this.createTargetName(credentialId, username);
        return this.doRemoveCredential(targetName);
    }

    private doRemoveCredential(targetName: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {

            wincredstore.remove(targetName, function(err): void {
                if (err) {
                    if (err.code !== undefined && err.code === 1168) {
                        // code 1168: not found
                        // If credential isn't found, don't fail.
                        resolve(undefined);
                    } else {
                        reject(err);
                    }
                } else {
                    resolve(undefined);
                }
            });
        });
    }

    private createCredential(cred: any): Credential {
        let password: string = new Buffer(cred.credential, 'hex').toString('utf8');
        // http://servername:port|\\domain\username
        let segments: Array<string> = cred.targetName.split(WindowsCredentialStoreApi.separator);
        let username: string = segments[segments.length - 1];
        let credentialId: string = segments[0];
        return new Credential(credentialId, username, password);
    }

    private createTargetName(credentialId: string, username: string): string {
        return credentialId + WindowsCredentialStoreApi.separator + username;
    }

    private listCredentials(): Promise<Array<any>> {
        return new Promise<Array<any>>((resolve, reject) => {
            let credentials: Array<any> = [];

            let stream = wincredstore.list();
            stream.on('data', (cred) => {
                credentials.push(cred);
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
