/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Config from "./config";
import { workspace, WorkspaceConfiguration } from "vscode";
import * as Constants from "../constants/constants";
import { IConfig } from "../languageservice/interfaces";

/*
 * ExtConfig class handles getting values from workspace config or config.json.
 */
export default class ExtConfig implements IConfig {
    constructor(
        private _config?: IConfig,
        private _extensionConfig?: WorkspaceConfiguration,
        private _workspaceConfig?: WorkspaceConfiguration,
    ) {
        if (this._config === undefined) {
            this._config = new Config();
        }
        if (this._extensionConfig === undefined) {
            this._extensionConfig = workspace.getConfiguration(
                Constants.extensionConfigSectionName,
            );
        }
        if (this._workspaceConfig === undefined) {
            this._workspaceConfig = workspace.getConfiguration();
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

    public useServiceVersion(version: number): void {
        return this._config.useServiceVersion(version);
    }

    public getServiceVersion(): number {
        return this._config.getServiceVersion();
    }

    public getSqlToolsConfigValue(configKey: string): any {
        let configValue: string = <string>(
            this.getExtensionConfig(`${Constants.sqlToolsServiceConfigKey}.${configKey}`)
        );
        if (!configValue) {
            configValue = this._config.getSqlToolsConfigValue(configKey);
        }
        return configValue;
    }

    public getExtensionConfig(key: string, defaultValue?: any): any {
        let configValue = this._extensionConfig.get(key);
        if (configValue === undefined) {
            configValue = defaultValue;
        }
        return configValue;
    }

    public getWorkspaceConfig(key: string, defaultValue?: any): any {
        let configValue = this._workspaceConfig.get(key);
        if (configValue === undefined) {
            configValue = defaultValue;
        }
        return configValue;
    }
}
