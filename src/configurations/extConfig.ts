/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import Config from  './config';
import { workspace } from 'vscode';
import * as Constants from '../models/constants';


/*
* ExtConfig class handles getting values from workspace config or config.json.
*/
export default class ExtConfig {

    private _extensionConfig = workspace.getConfiguration(Constants.extensionName);
    private _workspaceConfig = workspace.getConfiguration();

    constructor(private _config?: Config) {
        if (this._config === undefined) {
            this._config = new Config();
        }
    }

    public getSqlToolsServiceDownloadUrl(): string {
       return this.getSqlToolsConfigValue(Constants.sqlToolsServiceDownloadUrlConfigKey);
    }

    public getSqlToolsInstallDirectory(): string {
        return this.getSqlToolsConfigValue(Constants.sqlToolsServiceInstallDirConfigKey);
    }

    public getSqlToolsExecutableFiles(): string[] {
        return this.getSqlToolsConfigValue(Constants.sqlToolsServiceExecutableFilesConfigKey);
    }

    public getSqlToolsPackageVersion(): string {
        return this.getSqlToolsConfigValue(Constants.sqlToolsServiceVersionConfigKey);
    }

    private getSqlToolsConfigValue(configKey: string): any {
        let configValue: string = <string>this.getExtensionConfig(`${Constants.sqlToolsServiceConfigKey}.${configKey}`);
        if (!configValue) {
            configValue = this._config.getSqlToolsConfigValue(configKey);
        }
        return configValue;
    }

    public getExtensionConfig(key: string): any {
        return this._extensionConfig.get(key);
    }

    public getWorkspaceConfig(key: string, defaultValue?: any): any {
        return this._workspaceConfig.get(key);
    }
}







