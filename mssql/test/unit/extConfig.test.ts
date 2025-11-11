/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import { IConfigUtils } from "../../src/languageservice/interfaces";
import { WorkspaceConfiguration, workspace } from "vscode";
import * as Constants from "../../src/constants/constants";
import ExtConfig from "../../src/configurations/extConfig";
import ConfigUtils from "../../src/configurations/configUtils";

chai.use(sinonChai);

suite("ExtConfig Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let config: sinon.SinonStubbedInstance<ConfigUtils>;
    let extensionConfigGet: sinon.SinonStub;
    let workspaceConfigGet: sinon.SinonStub;
    let extensionConfig: WorkspaceConfiguration;
    let workspaceConfig: WorkspaceConfiguration;
    const fromConfig = "fromConfig";
    const fromExtensionConfig = "fromExtensionConfig";

    const toolsKey = (configKey: string): string =>
        `${Constants.sqlToolsServiceConfigKey}.${configKey}`;

    const createExtConfigInstance = (
        configKey: string,
        expectedFromConfig: string | undefined,
        expectedFromExtension: string | undefined,
    ): ExtConfig => {
        config.getSqlToolsConfigValue.reset();
        config.getSqlToolsConfigValue.returns(expectedFromConfig);

        extensionConfigGet.reset();
        extensionConfigGet.returns(undefined);
        if (expectedFromExtension !== undefined) {
            extensionConfigGet.withArgs(toolsKey(configKey)).returns(expectedFromExtension);
        }

        return new ExtConfig(config, extensionConfig, workspaceConfig);
    };

    setup(() => {
        sandbox = sinon.createSandbox();

        config = sandbox.createStubInstance(ConfigUtils);
        config.getSqlToolsConfigValue.returns(undefined);
        config.getSqlToolsExecutableFiles.returns([]);
        config.getSqlToolsInstallDirectory?.returns?.("");

        const baseConfig = workspace.getConfiguration();
        extensionConfigGet = sandbox.stub();
        workspaceConfigGet = sandbox.stub();

        extensionConfig = {
            ...baseConfig,
            get: extensionConfigGet,
        } as WorkspaceConfiguration;
        workspaceConfig = {
            ...baseConfig,
            get: workspaceConfigGet,
        } as WorkspaceConfiguration;

        extensionConfigGet.returns(undefined);
        workspaceConfigGet.returns(undefined);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("getSqlToolsServiceDownloadUrl should return value from extension config first", () => {
        const configKey = Constants.sqlToolsServiceDownloadUrlConfigKey;
        const extConfig = createExtConfigInstance(configKey, fromConfig, fromExtensionConfig);
        const actual = extConfig.getSqlToolsServiceDownloadUrl();
        expect(actual).to.equal(fromExtensionConfig);
    });

    test("getSqlToolsServiceDownloadUrl should return value from config.json if not exist in extension config", () => {
        const configKey = Constants.sqlToolsServiceDownloadUrlConfigKey;
        const extConfig = createExtConfigInstance(configKey, fromConfig, undefined);
        const actual = extConfig.getSqlToolsServiceDownloadUrl();
        expect(actual).to.equal(fromConfig);
    });

    test("getSqlToolsConfigValue should return value from extension config first", () => {
        const configKey = Constants.sqlToolsServiceInstallDirConfigKey;
        const extConfig = createExtConfigInstance(configKey, fromConfig, fromExtensionConfig);
        const actual = extConfig.getSqlToolsConfigValue(configKey);
        expect(actual).to.equal(fromExtensionConfig);
    });

    test("getSqlToolsConfigValue should return value from config.json if not exist in extension config", () => {
        const configKey = Constants.sqlToolsServiceInstallDirConfigKey;
        const extConfig = createExtConfigInstance(configKey, fromConfig, undefined);
        const actual = extConfig.getSqlToolsConfigValue(configKey);
        expect(actual).to.equal(fromConfig);
    });

    test("getExtensionConfig should return value from extension config", () => {
        const configKey = "config key";
        extensionConfigGet.reset();
        extensionConfigGet.returns(undefined);
        extensionConfigGet.withArgs(configKey).returns(fromExtensionConfig);
        const extConfig = new ExtConfig(
            config as unknown as IConfigUtils,
            extensionConfig,
            workspaceConfig,
        );
        const actual = extConfig.getExtensionConfig(configKey);
        expect(actual).to.equal(fromExtensionConfig);
    });

    test("getExtensionConfig should return the default value if the extension does not have the config", () => {
        const configKey = "config key";
        const defaultValue = "default value";
        extensionConfigGet.reset();
        extensionConfigGet.returns(undefined);
        extensionConfigGet.withArgs(configKey).returns(undefined);
        const extConfig = new ExtConfig(
            config as unknown as IConfigUtils,
            extensionConfig,
            workspaceConfig,
        );
        const actual = extConfig.getExtensionConfig(configKey, defaultValue);
        expect(actual).to.equal(defaultValue);
    });

    test("getWorkspaceConfig should return value from workspace config", () => {
        const configKey = "config key";
        workspaceConfigGet.reset();
        workspaceConfigGet.returns(undefined);
        workspaceConfigGet.withArgs(configKey).returns(fromExtensionConfig);
        const extConfig = new ExtConfig(
            config as unknown as IConfigUtils,
            extensionConfig,
            workspaceConfig,
        );
        const actual = extConfig.getWorkspaceConfig(configKey);
        expect(actual).to.equal(fromExtensionConfig);
    });

    test("getWorkspaceConfig should return the default value if the workspace does not have the config", () => {
        const configKey = "config key";
        const defaultValue = "default value";
        workspaceConfigGet.reset();
        workspaceConfigGet.returns(undefined);
        workspaceConfigGet.withArgs(configKey).returns(undefined);
        const extConfig = new ExtConfig(
            config as unknown as IConfigUtils,
            extensionConfig,
            workspaceConfig,
        );
        const actual = extConfig.getWorkspaceConfig(configKey, defaultValue);
        expect(actual).to.equal(defaultValue);
    });
});
