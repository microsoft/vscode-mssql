/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/
'use strict';

// This code is originally from https://github.com/microsoft/vsts-vscode
// License: https://github.com/Microsoft/vsts-vscode/blob/master/LICENSE.txt

import fs = require('fs');
import path = require('path');

/*
    Provides storage of credentials in a file on the local file system.
    Does not support any kind of 'prefix' of the credential (since this
    storage mechanism is not shared with either Windows or OSX).  The
    file is secured as RW for the owner of the process.
 */
export class FileTokenStorage {
    private _filename: string;

    constructor(filename: string) {
        this._filename = filename;
    }

    public addEntries(newEntries: Array<any>, existingEntries: Array<any>): Promise<void> {
        let entries: Array<any> = existingEntries.concat(newEntries);
        return this.saveEntries(entries);
    }

    public clear(): Promise<void> {
        return this.saveEntries([]);
    }

    public loadEntries(): Promise<any> {
        let self = this;
        return new Promise<any>((resolve, reject) => {
            let entries: Array<any> = [];
            let err: any;

            try {
                let content: string = fs.readFileSync(self._filename).toString();
                entries = JSON.parse(content);
                resolve(entries);
            } catch (ex) {
                if (ex.code !== 'ENOENT') {
                    err = ex;
                    reject(err);
                } else {
                    // If it is ENOENT (the file doesn't exist or can't be found)
                    // Return an empty array (no items yet)
                    resolve([]);
                }
            }
        });
    }

    public removeEntries(entriesToRemove: Array<any>, entriesToKeep: Array<any>): Promise<void> {
        return this.saveEntries(entriesToKeep);
    }

    private saveEntries(entries: Array<any>): Promise<void> {
        let self = this;
        return new Promise<void>((resolve, reject) => {
            let writeOptions = {
                encoding: 'utf8',
                mode: 384, // Permission 0600 - owner read/write, nobody else has access
                flag: 'w'
            };

            // If the path we want to store in doesn't exist, create it
            let folder: string = path.dirname(self._filename);
            if (!fs.existsSync(folder)) {
                fs.mkdirSync(folder);
            }
            fs.writeFile(self._filename, JSON.stringify(entries), writeOptions, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(undefined);
                }
            });
        });
    }
}
