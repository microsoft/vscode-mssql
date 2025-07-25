/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as path from "path";
import * as Constants from "../constants/constants";
import { IConfig } from "../languageservice/interfaces";

/*
 * Config class handles getting values from config.json.
 */
export default class Config implements IConfig {
    private _configJsonContent = undefined;
    private _sqlToolsServiceConfigKey: string;
    private version: number;

    public get configJsonContent(): any {
        if (this._configJsonContent === undefined) {
            this._configJsonContent = this.loadConfig();
        }
        return this._configJsonContent;
    }

    constructor() {
        this._sqlToolsServiceConfigKey = Constants.sqlToolsServiceConfigKey;
        this.version = 2;
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

    public useServiceVersion(version: number): void {
        switch (version) {
            case 1:
                this._sqlToolsServiceConfigKey = Constants.v1SqlToolsServiceConfigKey;
                break;
            default:
                this._sqlToolsServiceConfigKey = Constants.sqlToolsServiceConfigKey;
        }
        this.version = version;
    }

    public getServiceVersion(): number {
        return this.version;
    }

    public getSqlToolsConfigValue(configKey: string): any {
        let json = this.configJsonContent;
        let toolsConfig = json[this._sqlToolsServiceConfigKey];
        let configValue: string = undefined;
        if (toolsConfig !== undefined) {
            configValue = toolsConfig[configKey];
        }
        return configValue;
    }

    public getExtensionConfig(key: string, defaultValue?: any): any {
        let json = this.configJsonContent;
        let extensionConfig = json[Constants.extensionConfigSectionName];
        let configValue = extensionConfig[key];
        if (!configValue) {
            configValue = defaultValue;
        }
        return configValue;
    }

    public getWorkspaceConfig(key: string, defaultValue?: any): any {
        let json = this.configJsonContent;
        let configValue = json[key];
        if (!configValue) {
            configValue = defaultValue;
        }
        return configValue;
    }

    private loadConfig(): any {
        let configContent = fs.readFileSync(path.join(__dirname, "./config.json"));
        return JSON.parse(configContent.toString());
    }
}
