/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as AzureEnvironments from "@azure/ms-rest-azure-env";
import {
    configCustomEnvironment,
    configSovereignCloudCustomEnvironment,
    customEnvironmentSettingName,
} from "../../src/constants/constants";
import { Azure as Loc } from "../../src/constants/locConstants";
import * as providerSettings from "../../src/azure/providerSettings";

chai.use(sinonChai);

suite("Provider Settings Tests", function (): void {
    let sandbox: sinon.SinonSandbox;
    let getConfigurationStub: sinon.SinonStub;

    type ConfigMap = Record<string, Record<string, unknown>>;

    function configureWorkspaceConfig(testConfig: ConfigMap = {}): void {
        getConfigurationStub.resetBehavior();
        getConfigurationStub.callsFake((section: string) => {
            const values = testConfig[section] ?? {};
            return {
                get: (setting: string, defaultValue?: unknown) => {
                    if (Object.prototype.hasOwnProperty.call(values, setting)) {
                        return values[setting];
                    }

                    return defaultValue;
                },
            } as unknown as vscode.WorkspaceConfiguration;
        });
    }

    setup(async () => {
        sandbox = sinon.createSandbox();
        getConfigurationStub = sandbox.stub(vscode.workspace, "getConfiguration");

        configureWorkspaceConfig();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("getCloudId", () => {
        test("returns AzureCloud when config is not set", () => {
            expect(providerSettings.getCloudId()).to.equal(providerSettings.CloudId.AzureCloud);
        });

        test("returns configured sovereign cloud id", () => {
            configureWorkspaceConfig({
                "microsoft-sovereign-cloud": {
                    environment: "USGovernment",
                },
            });

            expect(providerSettings.getCloudId()).to.equal(providerSettings.CloudId.USGovernment);
        });

        test("treats legacy provider id as AzureCloud", () => {
            expect(providerSettings.getCloudId(providerSettings.azureCloudProviderId)).to.equal(
                providerSettings.CloudId.AzureCloud,
            );
        });

        test("throws for unexpected cloud id", () => {
            expect(() => providerSettings.getCloudId("invalid")).to.throw(
                "Unexpected cloud ID: 'invalid'",
            );
        });
    });

    suite("getCloudProviderSettings", () => {
        test("returns public Azure provider settings by default", () => {
            const settings = providerSettings.getCloudProviderSettings();

            expect(settings).to.equal(providerSettings.publicAzureProviderSettings);
            expect(settings.loginEndpoint).to.equal(
                AzureEnvironments.Environment.AzureCloud.activeDirectoryEndpointUrl,
            );
        });

        test("returns predefined cloud settings from configuration", () => {
            configureWorkspaceConfig({
                "microsoft-sovereign-cloud": {
                    environment: "ChinaCloud",
                },
            });

            const settings = providerSettings.getCloudProviderSettings();

            expect(settings.displayName).to.equal(Loc.ChinaCloud);
            expect(settings.loginEndpoint).to.equal(
                AzureEnvironments.Environment.ChinaCloud.activeDirectoryEndpointUrl,
            );
        });

        test("builds custom provider settings from workspace configuration", () => {
            const customAzureEnvironment = {
                name: "CustomCloud",
                portalUrl: "https://portal.custom",
                managementEndpointUrl: "https://management.custom",
                resourceManagerEndpointUrl: "https://resource.custom",
                activeDirectoryEndpointUrl: "https://login.custom",
                activeDirectoryResourceId: "https://resource.custom/",
                sqlServerHostnameSuffix: ".database.custom",
                keyVaultDnsSuffix: ".vault.custom",
            };
            const customMssqlEnvironment = {
                clientId: "custom-client-id",
                sqlEndpoint: "https://sql.custom",
                analyticsDnsSuffix: ".analytics.custom",
                keyVaultEndpoint: "https://vault.custom",
                fabricApiUriBase: "https://fabric.custom/api/",
                fabricScopeUriBase: "https://fabric.custom/scope/",
                fabricSqlDbDnsSuffix: ".db.fabric.custom",
                fabricDataWarehouseDnsSuffix: ".dw.fabric.custom",
            };

            configureWorkspaceConfig({
                "microsoft-sovereign-cloud": {
                    [customEnvironmentSettingName]: customAzureEnvironment,
                },
                mssql: {
                    customEnvironment: customMssqlEnvironment,
                },
            });

            const settings = providerSettings.getCloudProviderSettings(
                providerSettings.CloudId.Custom,
            );

            expect(settings.id).to.equal(providerSettings.CloudId.Custom);
            expect(settings.displayName).to.equal(customAzureEnvironment.name);
            expect(settings.clientId).to.equal(customMssqlEnvironment.clientId);
            expect(settings.loginEndpoint).to.equal(
                customAzureEnvironment.activeDirectoryEndpointUrl,
            );
            expect(settings.settings.sqlResource.endpoint).to.equal(
                customMssqlEnvironment.sqlEndpoint,
            );
            expect(settings.settings.azureKeyVaultResource.endpoint).to.equal(
                customMssqlEnvironment.keyVaultEndpoint,
            );
            expect(settings.fabric?.fabricScopeUriBase).to.equal(
                customMssqlEnvironment.fabricScopeUriBase,
            );
            expect(settings.scopes).to.include(
                `${customAzureEnvironment.resourceManagerEndpointUrl}/user_impersonation`,
            );
        });
    });

    suite("getAzureEnvironment", () => {
        test("returns predefined environment with isCustomCloud false", () => {
            const environment = providerSettings.getAzureEnvironment(
                providerSettings.CloudId.USGovernment,
            );

            expect(environment.portalUrl).to.equal(
                AzureEnvironments.Environment.USGovernment.portalUrl,
            );
            expect(environment.isCustomCloud).to.be.false;
        });

        test("returns custom environment and marks it as custom", () => {
            const customAzureEnvironment = {
                name: "CustomCloud",
                portalUrl: "https://portal.custom",
                managementEndpointUrl: "https://management.custom",
                resourceManagerEndpointUrl: "https://resource.custom",
                activeDirectoryEndpointUrl: "https://login.custom",
                activeDirectoryResourceId: "https://resource.custom/",
            };

            configureWorkspaceConfig({
                "microsoft-sovereign-cloud": {
                    [customEnvironmentSettingName]: customAzureEnvironment,
                },
            });

            const environment = providerSettings.getAzureEnvironment(
                providerSettings.CloudId.Custom,
            );

            expect(environment.name).to.equal(customAzureEnvironment.name);
            expect(environment.portalUrl).to.equal(customAzureEnvironment.portalUrl);
            expect(environment.isCustomCloud).to.be.true;
        });

        test("throws when custom environment configuration is missing", () => {
            configureWorkspaceConfig({
                "microsoft-sovereign-cloud": {},
            });

            const message = Loc.customCloudNotConfigured(configSovereignCloudCustomEnvironment);

            expect(() =>
                providerSettings.getAzureEnvironment(providerSettings.CloudId.Custom),
            ).to.throw(message);
        });
    });

    suite("getAzureEnvironmentAdditions", () => {
        test("returns custom environment additions when configured", () => {
            const customMssqlEnvironment = {
                clientId: "custom-client-id",
                sqlEndpoint: "https://sql.custom",
            };

            configureWorkspaceConfig({
                mssql: {
                    customEnvironment: customMssqlEnvironment,
                },
            });

            expect(providerSettings.getAzureEnvironmentAdditions()).to.deep.equal(
                customMssqlEnvironment,
            );
        });

        test("throws when custom mssql environment is not configured", () => {
            configureWorkspaceConfig({
                mssql: {},
            });

            const message = Loc.customCloudNotConfigured(configCustomEnvironment);

            expect(() => providerSettings.getAzureEnvironmentAdditions()).to.throw(message);
        });
    });
});
