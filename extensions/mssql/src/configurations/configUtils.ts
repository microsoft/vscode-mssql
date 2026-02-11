/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as Constants from "../constants/constants";
import { DownloadType, IConfigUtils } from "../languageservice/interfaces";
import { config } from "./config";
import { flatFileConfig } from "./flatFileConfig";

/*
 * Config class handles getting values from config.json.
 */
export default class ConfigUtils implements IConfigUtils {
    private _configJsonContent = undefined;
    private _configJsonFlatFileContent = undefined;
    private _sqlToolsServiceConfigKey: string;
    private _version: number;

    public get configJsonContent(): JSON {
        if (this._configJsonContent === undefined) {
            this._configJsonContent = config;
        }
        return this._configJsonContent;
    }

    public get configJsonFlatFileContent(): JSON {
        if (this._configJsonFlatFileContent === undefined) {
            this._configJsonFlatFileContent = flatFileConfig;
        }
        return this._configJsonFlatFileContent;
    }

    constructor() {
        this._sqlToolsServiceConfigKey = Constants.sqlToolsServiceConfigKey;
        this._version = 2;
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

    public getFlatFileServiceDownloadUrl(): string {
        return this.getFlatFileConfigValue(Constants.sqlToolsServiceDownloadUrlConfigKey);
    }

    public getFlatFileInstallDirectory(): string {
        return this.getFlatFileConfigValue(Constants.sqlToolsServiceInstallDirConfigKey);
    }

    public getFlatFileExecutableFiles(): string[] {
        return this.getFlatFileConfigValue(Constants.sqlToolsServiceExecutableFilesConfigKey);
    }

    public getFlatFilePackageVersion(): string {
        return this.getFlatFileConfigValue(Constants.sqlToolsServiceVersionConfigKey);
    }

    public useServiceVersion(version: number): void {
        switch (version) {
            case 1:
                this._sqlToolsServiceConfigKey = Constants.v1SqlToolsServiceConfigKey;
                break;
            default:
                this._sqlToolsServiceConfigKey = Constants.sqlToolsServiceConfigKey;
        }
        this._version = version;
    }

    public getServiceVersion(): number {
        return this._version;
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

    public getFlatFileConfigValue(configKey: string): any {
        let json = this.configJsonFlatFileContent;
        let flatFileConfig = json[this._sqlToolsServiceConfigKey];
        let configValue: string = undefined;
        if (flatFileConfig !== undefined) {
            configValue = flatFileConfig[configKey];
        }
        return configValue;
    }

    public getExtensionConfig(key: string, type: DownloadType, defaultValue?: any): any {
        let json: JSON;
        if (type === DownloadType.SqlToolsService) {
            json = this.configJsonContent;
        } else if (type === DownloadType.FlatFileService) {
            json = this.configJsonFlatFileContent;
        } else {
            return undefined;
        }

        let extensionConfig = json[Constants.extensionConfigSectionName];
        let configValue = extensionConfig[key];
        if (!configValue) {
            configValue = defaultValue;
        }
        return configValue;
    }

    public getWorkspaceConfig(key: string, type: DownloadType, defaultValue?: any): any {
        let json: JSON;
        if (type === DownloadType.SqlToolsService) {
            json = this.configJsonContent;
        } else if (type === DownloadType.FlatFileService) {
            json = this.configJsonFlatFileContent;
        } else {
            return undefined;
        }

        let configValue = json[key];
        if (!configValue) {
            configValue = defaultValue;
        }
        return configValue;
    }
}
