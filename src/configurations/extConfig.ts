/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import Config from  './config';
import { workspace } from 'vscode';

/*
* ExtConfig class handles getting values from workspace config or config.json.
*/
export default class ExtConfig {
    constructor(private _config?: Config) {
        if (this._config === undefined) {
            this._config = new Config();
        }
    }

    public getSqlToolsServiceDownloadUrl(): string {
       return this._config.getSqlToolsServiceDownloadUrl();
    }

    public getSqlToolsInstallDirectory(): string {
        return this._config.getSqlToolsInstallDirectory();
    }

    public getSqlToolsExecutableFiles(): string[] {
       return this._config.getSqlToolsExecutableFiles();
    }

    public getSqlToolsPackageVersion(): string {
        return this._config.getSqlToolsPackageVersion();
    }

    public getConfig(key: string, defaultValue?: any): any {
        const config = workspace.getConfiguration();
        return config.get(key);
    }
}







