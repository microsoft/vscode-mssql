/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureSubscription } from "@microsoft/vscode-azext-azureauth";
import { KnownFreeLimitExhaustionBehavior } from "@azure/arm-sql";
import { expect } from "chai";
import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { VsCodeAzureHelper } from "../../src/connectionconfig/azureHelpers";
import {
    AddFirewallRuleDialogProps,
    AuthenticationType,
} from "../../src/sharedInterfaces/connectionDialog";
import {
    AzureSqlDatabaseFormItemSpec,
    AzureSqlDatabaseReducers,
    AzureSqlDatabaseState,
} from "../../src/sharedInterfaces/azureSqlDatabase";
import { DeploymentWebviewState } from "../../src/sharedInterfaces/deployment";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import { DeploymentWebviewController } from "../../src/deployment/deploymentWebviewController";
import { registerAzureSqlDatabaseReducers } from "../../src/deployment/azureSqlDatabaseHelpers";
import { stubTelemetry } from "./utils";
import MainController from "../../src/controllers/mainController";
import {
    BackgroundTaskHandle,
    BackgroundTaskState,
    BackgroundTasksService,
} from "../../src/backgroundTasks/backgroundTasksService";

chai.use(sinonChai);

suite("Azure SQL Database reducers", () => {
    let sandbox: sinon.SinonSandbox;
    let controller: sinon.SinonStubbedInstance<DeploymentWebviewController>;
    let controllerState: DeploymentWebviewState;
    let azureSqlState: AzureSqlDatabaseState;
    let reducers: Map<
        keyof AzureSqlDatabaseReducers,
        (state: DeploymentWebviewState, payload: any) => Promise<DeploymentWebviewState>
    >;
    let subscription: AzureSubscription;
    let backgroundTasksService: sinon.SinonStubbedInstance<BackgroundTasksService>;
    let completeTaskStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);
        subscription = {
            name: "Test Subscription",
            subscriptionId: "subscription-id",
        } as AzureSubscription;
        azureSqlState = new AzureSqlDatabaseState({
            formState: {
                accountId: "account-id",
                tenantId: "tenant-id",
                subscriptionId: subscription.subscriptionId,
                resourceGroup: "resource-group",
                serverName: "server-name",
                databaseName: "database-name",
                authenticationType: AuthenticationType.SqlLogin,
                userName: "admin",
                password: "password",
                savePassword: true,
                freeLimitBehavior: KnownFreeLimitExhaustionBehavior.AutoPause,
                profileName: "",
                groupId: "",
                dataSource: "",
                collation: "SQL_Latin1_General_CP1_CI_AS",
                maintenanceConfig: "",
                enableAlwaysEncrypted: false,
                maxVcores: "2",
            },
            subscriptions: [subscription],
        });
        controllerState = new DeploymentWebviewState();
        controllerState.deploymentTypeState = azureSqlState;

        reducers = new Map();
        controller = sandbox.createStubInstance(DeploymentWebviewController);
        sandbox.stub(controller, "state").value(controllerState);
        completeTaskStub = sandbox.stub();
        const taskHandle: BackgroundTaskHandle = {
            id: "azure-provisioning-task",
            update: sandbox.stub(),
            complete: completeTaskStub,
            remove: sandbox.stub(),
        };
        backgroundTasksService = sandbox.createStubInstance(BackgroundTasksService);
        backgroundTasksService.registerTask.returns(taskHandle);
        const mainController = sandbox.createStubInstance(MainController);
        mainController.backgroundTasksService = backgroundTasksService;
        controller.mainController = mainController;
        controller.registerReducer.callsFake((name, reducer) => {
            reducers.set(
                name as keyof AzureSqlDatabaseReducers,
                reducer as (
                    state: DeploymentWebviewState,
                    payload: any,
                ) => Promise<DeploymentWebviewState>,
            );
        });
        registerAzureSqlDatabaseReducers(controller);
    });

    teardown(() => {
        sandbox.restore();
    });

    function getReducer(name: keyof AzureSqlDatabaseReducers) {
        const reducer = reducers.get(name);
        expect(reducer, `${name} reducer should be registered`).to.exist;
        return reducer!;
    }

    test("loadAzureComponent ignores components that have already started loading", async () => {
        azureSqlState.azureComponentStatuses.tenantId = ApiStatus.Loading;

        const result = await getReducer("loadAzureComponent")(controllerState, {
            componentName: "tenantId",
        });

        expect(result).to.equal(controllerState);
        expect(azureSqlState.azureComponentStatuses.tenantId).to.equal(ApiStatus.Loading);
    });

    test("loadAzureComponent propagates component errors downstream", async () => {
        azureSqlState.formState.accountId = "";
        azureSqlState.formComponents.tenantId = {} as AzureSqlDatabaseFormItemSpec;

        await getReducer("loadAzureComponent")(controllerState, {
            componentName: "tenantId",
        });

        expect(azureSqlState.azureComponentStatuses.tenantId).to.equal(ApiStatus.Error);
        expect(azureSqlState.azureComponentStatuses.subscriptionId).to.equal(ApiStatus.Error);
        expect(azureSqlState.azureComponentStatuses.resourceGroup).to.equal(ApiStatus.Error);
        expect(azureSqlState.azureComponentStatuses.serverName).to.equal(ApiStatus.Error);
    });

    test("startAzureSqlDatabaseDeployment stops when validation fails", async () => {
        controller.validateDeploymentForm.resolves(["databaseName"]);

        await getReducer("startAzureSqlDatabaseDeployment")(controllerState, { tags: {} });

        expect(azureSqlState.formErrors).to.deep.equal(["databaseName"]);
        expect(azureSqlState.formValidationLoadState).to.equal(ApiStatus.NotStarted);
        expect(azureSqlState.provisionLoadState).to.equal(ApiStatus.NotStarted);
    });

    test("startAzureSqlDatabaseDeployment completes the task after controller disposal", async () => {
        sandbox.stub(controller, "isDisposed").get(() => true);
        controller.updateState.throws(new Error("Cannot send notification on disposed controller"));
        controller.validateDeploymentForm.resolves([]);
        sandbox.stub(VsCodeAzureHelper, "createAzureSqlDatabase").resolves();

        await getReducer("startAzureSqlDatabaseDeployment")(controllerState, { tags: {} });

        expect(completeTaskStub).to.have.been.calledWith(
            BackgroundTaskState.Succeeded,
            sinon.match({ message: sinon.match.string }),
        );
        expect(controller.updateState).not.to.have.been.called;
        expect(azureSqlState.provisionLoadState).to.equal(ApiStatus.Loaded);
    });

    test("startAzureSqlDatabaseDeployment completes the background task on failure", async () => {
        controller.validateDeploymentForm.resolves([]);
        sandbox
            .stub(VsCodeAzureHelper, "createAzureSqlDatabase")
            .rejects(new Error("Provisioning failed"));

        await getReducer("startAzureSqlDatabaseDeployment")(controllerState, { tags: {} });

        expect(backgroundTasksService.registerTask).to.have.been.calledWithMatch({
            displayText: "Provisioning server-name/database-name",
            target: "server-name/database-name",
            state: BackgroundTaskState.InProgress,
        });
        expect(completeTaskStub).to.have.been.calledWith(
            BackgroundTaskState.Failed,
            sinon.match({ message: sinon.match("Provisioning failed") }),
        );
        expect(azureSqlState.provisionLoadState).to.equal(ApiStatus.Error);
    });

    test("openFirewallRuleDialog surfaces the firewall dialog", async () => {
        const handleFirewallRule = sandbox.stub().resolves({ result: true, ipAddress: "10.0.0.1" });
        sandbox.stub(VsCodeAzureHelper, "isSignedIn").resolves(false);
        controller.mainController = {
            connectionManager: {
                firewallService: { handleFirewallRule },
            },
        } as any;
        azureSqlState.errorMessage = "Firewall access required";

        await getReducer("openFirewallRuleDialog")(controllerState, {});
        await new Promise((resolve) => setImmediate(resolve));

        expect(handleFirewallRule).to.have.been.calledWith(40615, "Firewall access required");
        expect(azureSqlState.dialog?.type).to.equal("addFirewallRule");
        expect(controllerState.dialog).to.equal(azureSqlState.dialog);

        await getReducer("closeFirewallRuleDialog")(controllerState, {});
    });

    test("closeFirewallRuleDialog restores the connection error", async () => {
        azureSqlState.dialog = {
            type: "addFirewallRule",
            props: {},
        } as any;
        controllerState.dialog = azureSqlState.dialog;
        azureSqlState.firewallErrorMessage = "Firewall access required";

        await getReducer("closeFirewallRuleDialog")(controllerState, {});

        expect(azureSqlState.dialog).to.be.undefined;
        expect(controllerState.dialog).to.be.undefined;
        expect(azureSqlState.connectionLoadState).to.equal(ApiStatus.Error);
        expect(azureSqlState.errorMessage).to.equal("Firewall access required");
        expect(azureSqlState.canAddFirewallRule).to.be.true;
    });

    test("addAzureSqlFirewallRule creates a rule and closes the dialog", async () => {
        const createFirewallRule = sandbox.stub(VsCodeAzureHelper, "createFirewallRule").resolves();
        azureSqlState.dialog = {
            type: "addFirewallRule",
            props: { addFirewallRuleStatus: ApiStatus.NotStarted },
        } as any;

        await getReducer("addAzureSqlFirewallRule")(controllerState, {
            firewallRuleSpec: {
                name: "AllowClient",
                ip: { startIp: "10.0.0.1", endIp: "10.0.0.2" },
            },
        });

        expect(createFirewallRule).to.have.been.calledWith(
            subscription,
            "resource-group",
            "server-name",
            "AllowClient",
            "10.0.0.1",
            "10.0.0.2",
        );
        expect(azureSqlState.dialog).to.be.undefined;
        expect(azureSqlState.canAddFirewallRule).to.be.false;
    });

    test("addAzureSqlFirewallRule retains the dialog when creation fails", async () => {
        sandbox.stub(VsCodeAzureHelper, "createFirewallRule").rejects(new Error("Creation failed"));
        azureSqlState.dialog = {
            type: "addFirewallRule",
            props: { addFirewallRuleStatus: ApiStatus.NotStarted },
        } as any;

        await getReducer("addAzureSqlFirewallRule")(controllerState, {
            firewallRuleSpec: { name: "AllowClient", ip: "10.0.0.1" },
        });

        const dialog = azureSqlState.dialog as AddFirewallRuleDialogProps;
        expect(dialog.props.addFirewallRuleStatus).to.equal(ApiStatus.Error);
        expect(dialog.props.message).to.equal("Creation failed");
    });

    test("signIntoAzureForFirewallRule ignores unrelated dialogs", async () => {
        azureSqlState.dialog = undefined;

        const result = await getReducer("signIntoAzureForFirewallRule")(controllerState, {});

        expect(result).to.equal(controllerState);
        expect(controller.updateState).not.to.have.been.called;
    });

    test("setCreateResourceGroupDrawerState loads locations when opening", async () => {
        const locations = [{ name: "eastus", displayName: "East US" }];
        sandbox.stub(VsCodeAzureHelper, "getLocationsForSubscription").resolves(locations);
        azureSqlState.createServerDrawerState = {
            locationOptions: [],
            locationsLoadState: ApiStatus.Loaded,
            createLoadState: ApiStatus.NotStarted,
        };

        await getReducer("setCreateResourceGroupDrawerState")(controllerState, {
            shouldOpen: true,
        });

        expect(azureSqlState.createServerDrawerState).to.be.undefined;
        expect(azureSqlState.createResourceGroupDrawerState).to.deep.equal({
            locationOptions: locations,
            locationsLoadState: ApiStatus.Loaded,
            createLoadState: ApiStatus.NotStarted,
        });
    });

    test("setCreateResourceGroupDrawerState closes the drawer", async () => {
        azureSqlState.createResourceGroupDrawerState = {
            locationOptions: [],
            locationsLoadState: ApiStatus.Loaded,
            createLoadState: ApiStatus.NotStarted,
        };

        await getReducer("setCreateResourceGroupDrawerState")(controllerState, {
            shouldOpen: false,
        });

        expect(azureSqlState.createResourceGroupDrawerState).to.be.undefined;
    });

    test("submitCreateResourceGroup selects the created resource group", async () => {
        const createResourceGroup = sandbox
            .stub(VsCodeAzureHelper, "createResourceGroup")
            .resolves();
        azureSqlState.formState.serverName = "old-server";
        azureSqlState.createResourceGroupDrawerState = {
            locationOptions: [],
            locationsLoadState: ApiStatus.Loaded,
            createLoadState: ApiStatus.NotStarted,
        };

        await getReducer("submitCreateResourceGroup")(controllerState, {
            spec: {
                resourceGroupName: "new-resource-group",
                location: "eastus",
                tags: { environment: "test" },
            },
        });

        expect(createResourceGroup).to.have.been.calledWith(
            subscription,
            "new-resource-group",
            "eastus",
            { environment: "test" },
        );
        expect(azureSqlState.formState.resourceGroup).to.equal("new-resource-group");
        expect(azureSqlState.formState.serverName).to.equal("");
        expect(azureSqlState.azureComponentStatuses.resourceGroup).to.equal(ApiStatus.NotStarted);
        expect(azureSqlState.azureComponentStatuses.serverName).to.equal(ApiStatus.NotStarted);
        expect(azureSqlState.createResourceGroupDrawerState).to.be.undefined;
    });

    test("submitCreateResourceGroup leaves the drawer open after an error", async () => {
        sandbox
            .stub(VsCodeAzureHelper, "createResourceGroup")
            .rejects(new Error("Creation failed"));
        azureSqlState.createResourceGroupDrawerState = {
            locationOptions: [],
            locationsLoadState: ApiStatus.Loaded,
            createLoadState: ApiStatus.NotStarted,
        };

        await getReducer("submitCreateResourceGroup")(controllerState, {
            spec: { resourceGroupName: "new-resource-group", location: "eastus" },
        });

        expect(azureSqlState.createResourceGroupDrawerState.createLoadState).to.equal(
            ApiStatus.Error,
        );
        expect(azureSqlState.createResourceGroupDrawerState.message).to.equal("Creation failed");
    });

    test("setCreateServerDrawerState loads locations and the resource group default", async () => {
        const locations = [{ name: "eastus", displayName: "East US" }];
        sandbox.stub(VsCodeAzureHelper, "getLocationsForSubscription").resolves(locations);
        sandbox.stub(VsCodeAzureHelper, "getDefaultLocationForResourceGroup").resolves("eastus");
        azureSqlState.createResourceGroupDrawerState = {
            locationOptions: [],
            locationsLoadState: ApiStatus.Loaded,
            createLoadState: ApiStatus.NotStarted,
        };

        await getReducer("setCreateServerDrawerState")(controllerState, { shouldOpen: true });

        expect(azureSqlState.createResourceGroupDrawerState).to.be.undefined;
        expect(azureSqlState.createServerDrawerState).to.deep.equal({
            locationOptions: locations,
            locationsLoadState: ApiStatus.Loaded,
            createLoadState: ApiStatus.NotStarted,
            defaultLocation: "eastus",
        });
    });

    test("setCreateServerDrawerState closes the drawer", async () => {
        azureSqlState.createServerDrawerState = {
            locationOptions: [],
            locationsLoadState: ApiStatus.Loaded,
            createLoadState: ApiStatus.NotStarted,
        };

        await getReducer("setCreateServerDrawerState")(controllerState, { shouldOpen: false });

        expect(azureSqlState.createServerDrawerState).to.be.undefined;
    });

    test("submitCreateServer selects the server and preserves SQL credentials", async () => {
        sandbox.stub(VsCodeAzureHelper, "getAccountObjectId").resolves("account-object-id");
        const createSqlServer = sandbox.stub(VsCodeAzureHelper, "createSqlServer").resolves();
        azureSqlState.accounts = [{ id: "account-id", label: "Test User" }];
        azureSqlState.createServerDrawerState = {
            locationOptions: [],
            locationsLoadState: ApiStatus.Loaded,
            createLoadState: ApiStatus.NotStarted,
        };

        await getReducer("submitCreateServer")(controllerState, {
            spec: {
                serverName: "new-server",
                location: "eastus",
                authenticationType: AuthenticationType.AzureMFAAndUser,
                adminLogin: "sql-admin",
                adminPassword: "secret",
                savePassword: true,
            },
        });

        expect(createSqlServer).to.have.been.calledWith(
            subscription,
            "resource-group",
            "new-server",
            "eastus",
            sinon.match({
                authenticationType: AuthenticationType.AzureMFAAndUser,
                adminLogin: "sql-admin",
                adminPassword: "secret",
                entraAdmin: sinon.match({
                    login: "Test User",
                    sid: "account-object-id",
                    tenantId: "tenant-id",
                }),
            }),
        );
        expect(azureSqlState.formState.serverName).to.equal("new-server");
        expect(azureSqlState.formState.userName).to.equal("sql-admin");
        expect(azureSqlState.formState.password).to.equal("secret");
        expect(azureSqlState.formState.savePassword).to.be.true;
        expect(azureSqlState.serverCreatedWithAuth).to.be.true;
        expect(azureSqlState.createServerDrawerState).to.be.undefined;
    });

    test("submitCreateServer leaves the drawer open after an error", async () => {
        sandbox.stub(VsCodeAzureHelper, "getAccountObjectId").resolves(undefined);
        sandbox.stub(VsCodeAzureHelper, "createSqlServer").rejects(new Error("Creation failed"));
        azureSqlState.createServerDrawerState = {
            locationOptions: [],
            locationsLoadState: ApiStatus.Loaded,
            createLoadState: ApiStatus.NotStarted,
        };

        await getReducer("submitCreateServer")(controllerState, {
            spec: {
                serverName: "new-server",
                location: "eastus",
                authenticationType: AuthenticationType.AzureMFA,
            },
        });

        expect(azureSqlState.createServerDrawerState.createLoadState).to.equal(ApiStatus.Error);
        expect(azureSqlState.createServerDrawerState.message).to.equal("Creation failed");
    });
});
