/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import { Server } from "@azure/arm-sql";
import { AzureSqlDatabase } from "../../src/constants/locConstants";
import * as telemetry from "../../src/telemetry/telemetry";
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import { AuthenticationType } from "../../src/sharedInterfaces/connectionDialog";
import {
    AzureSqlDatabaseState,
    AzureSqlDatabaseFormItemSpec,
    AzureSqlDatabaseFormState,
    AZURE_SQL_DB_COMPONENT_ORDER,
} from "../../src/sharedInterfaces/azureSqlDatabase";
import {
    applyServerAuthSettings,
    reloadAzureComponentsDownstream,
    sendAzureSqlDatabaseCloseEventTelemetry,
} from "../../src/deployment/azureSqlDatabaseHelpers";
import { FormItemType } from "../../src/sharedInterfaces/form";

chai.use(sinonChai);

/**
 * Creates a minimal AzureSqlDatabaseState for testing.
 * Provides default form state, form components, and azure component statuses.
 */
function createTestState(overrides?: Partial<AzureSqlDatabaseState>): AzureSqlDatabaseState {
    const state = new AzureSqlDatabaseState({
        formState: {
            accountId: "test-account",
            tenantId: "test-tenant",
            subscriptionId: "test-sub",
            resourceGroup: "test-rg",
            serverName: "",
            databaseName: "",
            authenticationType: AuthenticationType.AzureMFA,
            userName: "",
            password: "",
            savePassword: false,
            freeLimitBehavior: "AutoPause",
            profileName: "",
            groupId: "",
            collation: "SQL_Latin1_General_CP1_CI_AS",
            maintenanceConfig: "",
            dataSource: "",
            enableAlwaysEncrypted: false,
            maxVcores: "2",
        } as AzureSqlDatabaseFormState,
        formComponents: createMinimalFormComponents(),
        azureComponentStatuses: {
            accountId: ApiStatus.Loaded,
            tenantId: ApiStatus.Loaded,
            subscriptionId: ApiStatus.Loaded,
            resourceGroup: ApiStatus.Loaded,
            serverName: ApiStatus.Loaded,
            maintenanceConfig: ApiStatus.Loaded,
        },
        servers: [],
        subscriptions: [],
        tenants: [],
        resourceGroups: [],
        accounts: [],
        locations: [],
        maintenanceConfigs: [],
        ...overrides,
    });
    return state;
}

function createMinimalFormComponents(): Partial<
    Record<keyof AzureSqlDatabaseFormState, AzureSqlDatabaseFormItemSpec>
> {
    const makeComponent = (propertyName: string): AzureSqlDatabaseFormItemSpec =>
        ({
            propertyName,
            label: propertyName,
            type: FormItemType.Input,
            required: false,
            isAdvancedOption: false,
            options: [{ displayName: "opt1", value: "val1" }],
            tooltip: "",
            componentWidth: "",
        }) as AzureSqlDatabaseFormItemSpec;

    return {
        accountId: makeComponent("accountId"),
        tenantId: makeComponent("tenantId"),
        subscriptionId: makeComponent("subscriptionId"),
        resourceGroup: makeComponent("resourceGroup"),
        serverName: makeComponent("serverName"),
        databaseName: makeComponent("databaseName"),
        maintenanceConfig: makeComponent("maintenanceConfig"),
    };
}

function createTestServer(
    name: string,
    opts?: {
        hasAdministrators?: boolean;
        azureADOnly?: boolean;
        adminLogin?: string;
        fullyQualifiedDomainName?: string;
    },
): Server {
    const server: Server = {
        name,
        location: "eastus",
        administrators: opts?.hasAdministrators
            ? { azureADOnlyAuthentication: opts.azureADOnly ?? false }
            : undefined,
        administratorLogin: opts?.adminLogin,
        fullyQualifiedDomainName: opts?.fullyQualifiedDomainName,
    };
    return server;
}

suite("azureSqlDatabaseHelpers", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    // ─── applyServerAuthSettings ─────────────────────────────────────────────

    suite("applyServerAuthSettings", () => {
        test("should preserve auth when serverCreatedWithAuth is true", () => {
            const state = createTestState({
                serverCreatedWithAuth: true,
            });
            state.formState.authenticationType = AuthenticationType.SqlLogin;
            state.formState.userName = "existingUser";
            state.formState.password = "existingPass";

            applyServerAuthSettings(state, "any-server");

            expect(state.formState.authenticationType).to.equal(AuthenticationType.SqlLogin);
            expect(state.formState.userName).to.equal("existingUser");
            expect(state.formState.password).to.equal("existingPass");
        });

        test("should default to AzureMFA when server is not found", () => {
            const state = createTestState();
            state.formState.userName = "oldUser";
            state.formState.password = "oldPass";
            state.formState.savePassword = true;

            applyServerAuthSettings(state, "nonexistent-server");

            expect(state.formState.authenticationType).to.equal(AuthenticationType.AzureMFA);
            expect(state.formState.userName).to.equal("");
            expect(state.formState.password).to.equal("");
            expect(state.formState.savePassword).to.equal(false);
        });

        test("should detect AzureMFA when azureADOnlyAuthentication is true", () => {
            const server = createTestServer("myserver", {
                hasAdministrators: true,
                azureADOnly: true,
                adminLogin: "admin",
            });
            const state = createTestState({ servers: [server] });

            applyServerAuthSettings(state, "myserver");

            expect(state.formState.authenticationType).to.equal(AuthenticationType.AzureMFA);
            expect(state.formState.userName).to.equal("");
            expect(state.formState.password).to.equal("");
            expect(state.formComponents.serverName!.tooltip).to.equal(
                AzureSqlDatabase.serverTooltipMFA,
            );
            expect(state.formComponents.databaseName!.tooltip).to.equal(
                AzureSqlDatabase.databaseTooltipMFA,
            );
        });

        test("should detect AzureMFAAndUser when administrators exist but azureADOnly is false", () => {
            const server = createTestServer("myserver", {
                hasAdministrators: true,
                azureADOnly: false,
                adminLogin: "sqladmin",
            });
            const state = createTestState({ servers: [server] });

            applyServerAuthSettings(state, "myserver");

            expect(state.formState.authenticationType).to.equal(AuthenticationType.AzureMFAAndUser);
            expect(state.formState.userName).to.equal("sqladmin");
            expect(state.formState.password).to.equal("");
            expect(state.formComponents.serverName!.tooltip).to.equal(
                AzureSqlDatabase.serverTooltipMFAAndUser,
            );
            expect(state.formComponents.databaseName!.tooltip).to.equal(
                AzureSqlDatabase.databaseTooltipMFAAndUser,
            );
        });

        test("should detect SqlLogin when no administrators property exists", () => {
            const server = createTestServer("myserver", {
                hasAdministrators: false,
                adminLogin: "sa",
            });
            const state = createTestState({ servers: [server] });

            applyServerAuthSettings(state, "myserver");

            expect(state.formState.authenticationType).to.equal(AuthenticationType.SqlLogin);
            expect(state.formState.userName).to.equal("sa");
            expect(state.formComponents.serverName!.tooltip).to.equal(
                AzureSqlDatabase.serverTooltipSqlLogin,
            );
            expect(state.formComponents.databaseName!.tooltip).to.equal(
                AzureSqlDatabase.databaseTooltipSqlLogin,
            );
        });

        test("should default adminLogin to empty string when administratorLogin is undefined", () => {
            const server = createTestServer("myserver", {
                hasAdministrators: false,
            });
            const state = createTestState({ servers: [server] });

            applyServerAuthSettings(state, "myserver");

            expect(state.formState.userName).to.equal("");
        });

        test("should clear savePassword when server changes", () => {
            const server = createTestServer("myserver", {
                hasAdministrators: true,
                azureADOnly: true,
            });
            const state = createTestState({ servers: [server] });
            state.formState.savePassword = true;

            applyServerAuthSettings(state, "myserver");

            expect(state.formState.savePassword).to.equal(false);
        });
    });

    // ─── reloadAzureComponentsDownstream ─────────────────────────────────────

    suite("reloadAzureComponentsDownstream", () => {
        test("should reset all components downstream of accountId", () => {
            const state = createTestState();
            state.formState.tenantId = "t1";
            state.formState.subscriptionId = "s1";
            state.formState.resourceGroup = "rg1";
            state.formState.serverName = "srv1";

            reloadAzureComponentsDownstream(state, "accountId");

            expect(state.formState.tenantId).to.equal("");
            expect(state.formState.subscriptionId).to.equal("");
            expect(state.formState.resourceGroup).to.equal("");
            expect(state.formState.serverName).to.equal("");

            for (const comp of AZURE_SQL_DB_COMPONENT_ORDER.slice(1)) {
                expect(state.azureComponentStatuses[comp]).to.equal(ApiStatus.NotStarted);
            }
        });

        test("should reset only components downstream of subscriptionId", () => {
            const state = createTestState();
            state.formState.tenantId = "t1";
            state.formState.subscriptionId = "s1";
            state.formState.resourceGroup = "rg1";
            state.formState.serverName = "srv1";

            reloadAzureComponentsDownstream(state, "subscriptionId");

            // Upstream components should remain untouched
            expect(state.formState.tenantId).to.equal("t1");
            expect(state.formState.subscriptionId).to.equal("s1");
            expect(state.azureComponentStatuses["tenantId"]).to.equal(ApiStatus.Loaded);

            // Downstream components should be reset
            expect(state.formState.resourceGroup).to.equal("");
            expect(state.formState.serverName).to.equal("");
            expect(state.azureComponentStatuses["resourceGroup"]).to.equal(ApiStatus.NotStarted);
            expect(state.azureComponentStatuses["serverName"]).to.equal(ApiStatus.NotStarted);
        });

        test("should reset maintenance config when subscriptionId resets", () => {
            const state = createTestState();
            state.formState.maintenanceConfig = "config-id";
            state.maintenanceConfigs = [{ name: "SQL_Default", id: "config-id" }];
            state.formComponents.maintenanceConfig!.options = [
                { displayName: "SQL_Default", value: "config-id" },
            ];

            reloadAzureComponentsDownstream(state, "accountId");

            expect(state.formState.maintenanceConfig).to.equal("");
            expect(state.azureComponentStatuses["maintenanceConfig"]).to.equal(
                ApiStatus.NotStarted,
            );
            expect(state.maintenanceConfigs).to.deep.equal([]);
            expect(state.formComponents.maintenanceConfig!.options).to.deep.equal([]);
        });

        test("should reset maintenance config when resourceGroup resets", () => {
            const state = createTestState();
            state.formState.maintenanceConfig = "config-id";

            reloadAzureComponentsDownstream(state, "subscriptionId");

            expect(state.formState.maintenanceConfig).to.equal("");
            expect(state.azureComponentStatuses["maintenanceConfig"]).to.equal(
                ApiStatus.NotStarted,
            );
        });

        test("should clear auth fields when serverName resets", () => {
            const state = createTestState();
            state.formState.authenticationType = AuthenticationType.AzureMFA;
            state.formState.userName = "user";
            state.formState.password = "pass";
            state.formState.savePassword = true;
            state.serverCreatedWithAuth = true;

            reloadAzureComponentsDownstream(state, "resourceGroup");

            expect(state.formState.authenticationType).to.equal(AuthenticationType.SqlLogin);
            expect(state.formState.userName).to.equal("");
            expect(state.formState.password).to.equal("");
            expect(state.formState.savePassword).to.equal(false);
            expect(state.serverCreatedWithAuth).to.equal(false);
        });

        test("should clear form component options for downstream components", () => {
            const state = createTestState();

            reloadAzureComponentsDownstream(state, "tenantId");

            expect(state.formComponents.subscriptionId!.options).to.deep.equal([]);
            expect(state.formComponents.resourceGroup!.options).to.deep.equal([]);
            expect(state.formComponents.serverName!.options).to.deep.equal([]);
        });

        test("should do nothing for an unknown component name", () => {
            const state = createTestState();
            state.formState.tenantId = "t1";
            state.formState.serverName = "srv1";

            reloadAzureComponentsDownstream(state, "nonexistent");

            expect(state.formState.tenantId).to.equal("t1");
            expect(state.formState.serverName).to.equal("srv1");
        });

        test("should do nothing when called with the last component in the order", () => {
            const state = createTestState();
            state.formState.serverName = "srv1";
            state.formState.resourceGroup = "rg1";

            reloadAzureComponentsDownstream(state, "serverName");

            // serverName is last in the order, so nothing downstream to reset
            expect(state.formState.serverName).to.equal("srv1");
            expect(state.formState.resourceGroup).to.equal("rg1");
        });
    });

    // ─── sendAzureSqlDatabaseCloseEventTelemetry ─────────────────────────────

    suite("sendAzureSqlDatabaseCloseEventTelemetry", () => {
        let sendActionEventStub: sinon.SinonStub;

        setup(() => {
            sendActionEventStub = sandbox.stub(telemetry, "sendActionEvent");
        });

        test("should send telemetry with error message when present", () => {
            const state = createTestState({
                errorMessage: "Something went wrong",
                provisionLoadState: ApiStatus.Error,
            });

            sendAzureSqlDatabaseCloseEventTelemetry(state);

            expect(sendActionEventStub).to.have.been.calledWithMatch(
                TelemetryViews.AzureSqlDatabase,
                TelemetryActions.FinishAzureSqlDatabaseDeployment,
                sinon.match({
                    errorMessage: "Something went wrong",
                    provisionState: ApiStatus.Error,
                }),
            );
        });

        test("should send telemetry with empty error message on success", () => {
            const state = createTestState({
                provisionLoadState: ApiStatus.Loaded,
            });

            sendAzureSqlDatabaseCloseEventTelemetry(state);

            expect(sendActionEventStub).to.have.been.calledWithMatch(
                TelemetryViews.AzureSqlDatabase,
                TelemetryActions.FinishAzureSqlDatabaseDeployment,
                sinon.match({
                    errorMessage: "",
                    provisionState: ApiStatus.Loaded,
                }),
            );
        });

        test("should send telemetry with not-started provision state", () => {
            const state = createTestState({
                provisionLoadState: ApiStatus.NotStarted,
            });

            sendAzureSqlDatabaseCloseEventTelemetry(state);

            expect(sendActionEventStub).to.have.been.calledWithMatch(
                TelemetryViews.AzureSqlDatabase,
                TelemetryActions.FinishAzureSqlDatabaseDeployment,
                sinon.match({
                    provisionState: ApiStatus.NotStarted,
                }),
            );
        });
    });
});
