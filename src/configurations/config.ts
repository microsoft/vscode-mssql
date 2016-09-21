/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';
const fs = require('fs');
import * as path from 'path';

/*
* Config class handles getting values from config.json.
*/
export default class Config {
     private static _configJsonContent = undefined;

     public static get configJsonContent(): any {
        if (this._configJsonContent === undefined) {
            this._configJsonContent = this.loadConfig();
        }
        return this._configJsonContent;
    }

    public getSqlToolsServiceDownloadUrl(): string {
        try {
            let json = Config.configJsonContent;
            return json.sqlToolsService.downloadUrl + '/' + json.sqlToolsService.version;
        } catch (error) {
                throw(error);
        }
    }

    public getSqlToolsInstallDirectory(): string {
        try {
            let json = Config.configJsonContent;
            return json.sqlToolsService.installDir;
        } catch (error) {
                throw(error);
        }
    }

    public getSqlToolsExecutableFiles(): string[] {
        try {
            let json = Config.configJsonContent;
            return json.sqlToolsService.executableFiles;
        } catch (error) {
                throw(error);
        }
    }

    public getSqlToolsPackageVersion(): string {
        try {
            let json = Config.configJsonContent;
            return json.sqlToolsService.version;
        } catch (error) {
                throw(error);
        }
    }

    public getConfig(key: string, defaultValue?: any): any {
        try {
            let json = Config.configJsonContent;
            return json.key;
        } catch (error) {
                throw(error);
        }
    }

    static loadConfig(): any {
        let configContent = fs.readFileSync(path.join(__dirname, '../config.json'));
        return JSON.parse(configContent);
    }
}






