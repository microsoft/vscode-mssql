/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as TypeMoq from "typemoq";
import { IConfig } from "../../src/languageservice/interfaces";
import { WorkspaceConfiguration, workspace } from "vscode";
import * as Constants from "../../src/constants/constants";
import ExtConfig from "../../src/configurations/extConfig";
import Config from "../../src/configurations/configUtils";

suite("ExtConfig Tests", () => {
    let config: TypeMoq.IMock<IConfig>;
    let extensionConfig: TypeMoq.IMock<WorkspaceConfiguration>;
    let workspaceConfig: TypeMoq.IMock<WorkspaceConfiguration>;
    let fromConfig = "fromConfig";
    let fromExtensionConfig = "fromExtensionConfig";

    function createExtConfigInstance(
        configKey: string,
        expectedFromConfig: string,
        expectedFromExtensionConfig: string,
    ): ExtConfig {
        let toolsConfigKey = `${Constants.sqlToolsServiceConfigKey}.${configKey}`;
        config.setup((x) => x.getSqlToolsConfigValue(configKey)).returns(() => expectedFromConfig);
        extensionConfig
            .setup((x) => x.get(toolsConfigKey))
            .returns(() => expectedFromExtensionConfig);
        let extConfig = new ExtConfig(
            config.object,
            extensionConfig.object,
            workspaceConfig.object,
        );
        return extConfig;
    }

    setup(() => {
        config = TypeMoq.Mock.ofType(Config, TypeMoq.MockBehavior.Strict);
        let configInstance = workspace.getConfiguration();
        extensionConfig = TypeMoq.Mock.ofInstance<WorkspaceConfiguration>(
            configInstance,
            TypeMoq.MockBehavior.Strict,
        );
        workspaceConfig = TypeMoq.Mock.ofInstance<WorkspaceConfiguration>(
            configInstance,
            TypeMoq.MockBehavior.Strict,
        );
    });

    test("getSqlToolsServiceDownloadUrl should return value from extension config first", (done) => {
        return new Promise((resolve, reject) => {
            let configKey = Constants.sqlToolsServiceDownloadUrlConfigKey;
            let extConfig = createExtConfigInstance(configKey, fromConfig, fromExtensionConfig);
            let actual = extConfig.getSqlToolsServiceDownloadUrl();
            assert.equal(actual, fromExtensionConfig);
            done();
        });
    });

    test("getSqlToolsServiceDownloadUrl should return value from config.json if not exit in extension config", (done) => {
        return new Promise((resolve, reject) => {
            let configKey = Constants.sqlToolsServiceDownloadUrlConfigKey;
            let extConfig = createExtConfigInstance(configKey, fromConfig, undefined);
            let actual = extConfig.getSqlToolsServiceDownloadUrl();
            assert.equal(actual, fromConfig);
            done();
        });
    });

    test("getSqlToolsConfigValue should return value from extension config first", (done) => {
        return new Promise((resolve, reject) => {
            let configKey = Constants.sqlToolsServiceInstallDirConfigKey;
            let extConfig = createExtConfigInstance(configKey, fromConfig, fromExtensionConfig);
            let actual = extConfig.getSqlToolsConfigValue(configKey);
            assert.equal(actual, fromExtensionConfig);
            done();
        });
    });

    test("getSqlToolsConfigValue should return value from config.json if not exit in extension config", (done) => {
        return new Promise((resolve, reject) => {
            let configKey = Constants.sqlToolsServiceInstallDirConfigKey;
            let extConfig = createExtConfigInstance(configKey, fromConfig, undefined);
            let actual = extConfig.getSqlToolsConfigValue(configKey);
            assert.equal(actual, fromConfig);
            done();
        });
    });

    test("getExtensionConfig should return value from extension config", (done) => {
        return new Promise((resolve, reject) => {
            let configKey = "config key";
            extensionConfig.setup((x) => x.get(configKey)).returns(() => fromExtensionConfig);
            let extConfig = new ExtConfig(
                config.object,
                extensionConfig.object,
                workspaceConfig.object,
            );
            let actual = extConfig.getExtensionConfig(configKey);
            assert.equal(actual, fromExtensionConfig);
            done();
        });
    });

    test("getExtensionConfig should return the default value if the extension does not have the config", (done) => {
        return new Promise((resolve, reject) => {
            let configKey = "config key";
            let defaultValue = "default value";
            extensionConfig.setup((x) => x.get(configKey)).returns(() => undefined);
            let extConfig = new ExtConfig(
                config.object,
                extensionConfig.object,
                workspaceConfig.object,
            );
            let actual = extConfig.getExtensionConfig(configKey, defaultValue);
            assert.equal(actual, defaultValue);
            done();
        });
    });

    test("getWorkspaceConfig should return value from workspace config", (done) => {
        return new Promise((resolve, reject) => {
            let configKey = "config key";
            workspaceConfig.setup((x) => x.get(configKey)).returns(() => fromExtensionConfig);
            let extConfig = new ExtConfig(
                config.object,
                extensionConfig.object,
                workspaceConfig.object,
            );
            let actual = extConfig.getWorkspaceConfig(configKey);
            assert.equal(actual, fromExtensionConfig);
            done();
        });
    });

    test("getWorkspaceConfig should return the default value if the workspace does not have the config", (done) => {
        return new Promise((resolve, reject) => {
            let configKey = "config key";
            let defaultValue = "default value";
            workspaceConfig.setup((x) => x.get(configKey)).returns(() => undefined);
            let extConfig = new ExtConfig(
                config.object,
                extensionConfig.object,
                workspaceConfig.object,
            );
            let actual = extConfig.getWorkspaceConfig(configKey, defaultValue);
            assert.equal(actual, defaultValue);
            done();
        });
    });
});
