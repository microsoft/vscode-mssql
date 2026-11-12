/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import { startWorkflow } from "extension-toolkit/vscode";
import {
    DeploymentWebviewController,
    DeploymentWorkflowEventName,
} from "../../src/deployment/deploymentWebviewController";
import { WebviewPanelController } from "../../src/controllers/webviewPanelController";
import * as localContainers from "../../src/deployment/localContainersHelpers";
import { DeploymentType, DeploymentWebviewState } from "../../src/sharedInterfaces/deployment";
import { LocalContainersState } from "../../src/sharedInterfaces/localContainers";
import { AzureSqlDatabaseRequests } from "../../src/sharedInterfaces/azureSqlDatabase";
import {
    completeProvisioningTask,
    startProvisioningTask,
} from "../../src/deployment/deploymentBackgroundTasks";
import {
    BackgroundTaskHandle,
    BackgroundTaskState,
} from "../../src/backgroundTasks/backgroundTasksService";
import { stubLogger, stubTelemetry } from "./utils";
import {
    applyServerAuthSettings,
    initializeAzureSqlDatabaseState,
} from "../../src/deployment/azureSqlDatabaseHelpers";
import { AuthenticationType } from "../../src/sharedInterfaces/connectionDialog";
import MainController from "../../src/controllers/mainController";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import { ConnectionStore } from "../../src/models/connectionStore";
import { ConnectionProfile } from "../../src/models/connectionProfile";
import { CredentialsQuickPickItemType } from "../../src/models/interfaces";
import type { IServerInfo } from "vscode-mssql";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import * as azureSql from "../../src/deployment/azureSqlHelpers";
import * as logger from "../../src/models/logger";
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";
import {
    LocalDatabaseDeploymentService,
    LocalDatabaseCompatibilityService,
} from "../../src/deployment/localToCloudHelpers";
import { LocalToCloud } from "../../src/constants/locConstants";
import { createWorkspaceConfiguration } from "./stubs";
import * as connectionGroups from "../../src/controllers/connectionGroupWebviewController";
import { ConnectionUI } from "../../src/views/connectionUI";
import { FormItemType } from "../../src/sharedInterfaces/form";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import { ConnectionConfig } from "../../src/connectionconfig/connectionconfig";

chai.use(sinonChai);
const { expect } = chai;

suite("Deployment webview controller", () => {
    let sandbox: sinon.SinonSandbox;
    let telemetry: ReturnType<typeof stubTelemetry>;
    let controller: sinon.SinonStubbedInstance<DeploymentWebviewController>;
    let closePanel: sinon.SinonStub;
    let close: (state: DeploymentWebviewState, payload: {}) => Promise<DeploymentWebviewState>;
    let disposables: vscode.Disposable[];
    let manager: sinon.SinonStubbedInstance<ConnectionManager>;
    let store: sinon.SinonStubbedInstance<ConnectionStore>;
    let activeConnections: Record<string, ConnectionInfo>;

    setup(() => {
        sandbox = sinon.createSandbox();
        telemetry = stubTelemetry(sandbox);
        ({ controller, disposables, manager, store, activeConnections } =
            registerLocalWizardHandlers());
        closePanel = sandbox.stub();
        sandbox.stub(controller, "panel").get(() => ({ dispose: closePanel }));
        sandbox.stub(controller, "workflowCorrelationId").get(() => "workflow-id");
        close = controller.registerReducer.getCalls().find((call) => call.args[0] === "dispose")!
            .args[1] as typeof close;
    });

    function registerLocalWizardHandlers() {
        sandbox.spy(azureSql, "registerAzureSqlRpcHandlers");
        const client = sandbox.createStubInstance(SqlToolsServiceClient);
        sandbox.stub(SqlToolsServiceClient, "instance").get(() => client);
        const output: vscode.LogOutputChannel = {
            name: "test",
            append: sandbox.stub(),
            appendLine: sandbox.stub(),
            replace: sandbox.stub(),
            clear: sandbox.stub(),
            show: () => {},
            hide: sandbox.stub(),
            dispose: sandbox.stub(),
            logLevel: vscode.LogLevel.Info,
            onDidChangeLogLevel: sandbox.stub(),
            trace: sandbox.stub(),
            debug: sandbox.stub(),
            info: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
        };
        sandbox.stub(logger, "getMssqlOutputChannel").returns(output);
        const controller = sandbox.createStubInstance(DeploymentWebviewController);
        const disposables: vscode.Disposable[] = [];
        controller["registerDisposable"] = (disposable) => {
            disposables.push(disposable);
        };
        const main = sandbox.createStubInstance(MainController);
        const manager = sandbox.createStubInstance(ConnectionManager);
        const store = sandbox.createStubInstance(ConnectionStore);
        const activeConnections: Record<string, ConnectionInfo> = {};
        store.readAllConnections.resolves([]);
        sandbox.stub(manager, "connectionStore").get(() => store);
        sandbox.stub(manager, "activeConnections").get(() => activeConnections);
        sandbox.stub(main, "connectionManager").get(() => manager);
        controller.mainController = main;
        DeploymentWebviewController.prototype["registerRpcHandlers"].call(controller);
        return { controller, disposables, manager, store, activeConnections };
    }

    test("lists saved connections without duplicate recent or active-only history entries", async () => {
        const saved = Object.assign(new ConnectionProfile(), {
            id: "saved-container",
            profileName: "azure_sql_db_container_5",
            server: "localhost,1433",
            database: "",
            profileSource: CredentialsQuickPickItemType.Profile,
        });
        const recent = Object.assign(new ConnectionProfile(), saved, {
            id: "old-database-session",
            database: "Inventory",
            profileSource: CredentialsQuickPickItemType.Mru,
        });
        store.readAllConnections.callsFake(async (includeRecent = false) =>
            includeRecent ? [saved, recent] : [saved],
        );
        const active = new ConnectionInfo();
        active.credentials = recent;
        active.connectionId = "active-sts-connection";
        activeConnections.recent = active;
        manager.isConnected.returns(true);
        const handler = controller.onRequest
            .getCalls()
            .find(
                (call) =>
                    call.args[0].method === AzureSqlDatabaseRequests.GetLocalDatabaseSources.method,
            )!.args[1];
        const token: vscode.CancellationToken = {
            isCancellationRequested: false,
            onCancellationRequested: sandbox.stub(),
        };

        expect(await handler(undefined, token)).to.deep.equal([
            {
                id: saved.id,
                profileName: saved.profileName,
                server: saved.server,
                database: "",
                isConnected: false,
                serverVersion: undefined,
            },
        ]);
    });

    test("keeps distinct saved IDs and enriches only their matching active sessions", async () => {
        const saved = Object.assign(new ConnectionProfile(), {
            id: "saved-container",
            profileName: "azure_sql_db_container_5",
            server: "localhost,1433",
            database: "",
            profileSource: CredentialsQuickPickItemType.Profile,
        });
        const otherSaved = Object.assign(new ConnectionProfile(), saved, {
            id: "other-saved-profile",
        });
        store.readAllConnections.resolves([saved, otherSaved]);
        const active = new ConnectionInfo();
        active.credentials = { ...saved, database: "Inventory" };
        active.connectionId = "active-sts-connection";
        active.serverInfo = { serverVersion: "17.0.1000" } as IServerInfo;
        activeConnections.saved = active;
        manager.isConnected.returns(true);
        const handler = controller.onRequest
            .getCalls()
            .find(
                (call) =>
                    call.args[0].method === AzureSqlDatabaseRequests.GetLocalDatabaseSources.method,
            )!.args[1];
        const token: vscode.CancellationToken = {
            isCancellationRequested: false,
            onCancellationRequested: sandbox.stub(),
        };

        expect(await handler(undefined, token)).to.deep.equal([
            {
                id: saved.id,
                profileName: saved.profileName,
                server: saved.server,
                database: "",
                isConnected: true,
                serverVersion: "17.0.1000",
            },
            {
                id: otherSaved.id,
                profileName: otherSaved.profileName,
                server: otherSaved.server,
                database: "",
                isConnected: false,
                serverVersion: undefined,
            },
        ]);
    });

    test("records opening once across source refreshes and closing when the panel is disposed", async () => {
        const handler = controller.onRequest
            .getCalls()
            .find(
                (call) =>
                    call.args[0].method === AzureSqlDatabaseRequests.GetLocalDatabaseSources.method,
            )!.args[1];
        const token: vscode.CancellationToken = {
            isCancellationRequested: false,
            onCancellationRequested: sandbox.stub(),
        };
        await handler(undefined, token);
        expect(telemetry.sendActionEvent).to.have.been.calledWith(
            TelemetryViews.LocalToCloudDeployment,
            TelemetryActions.Open,
        );
        const opened = telemetry.sendActionEvent.getCalls().map((call) => call.args);
        await handler(undefined, token);
        expect(telemetry.sendActionEvent.getCalls().map((call) => call.args)).to.deep.equal(opened);
        for (const disposable of disposables) {
            disposable.dispose();
        }
        expect(telemetry.sendActionEvent).to.have.been.calledWith(
            TelemetryViews.LocalToCloudDeployment,
            TelemetryActions.Close,
            sinon.match({ additionalMeasurements: { durationInMs: sinon.match.number } }),
        );
    });

    test("carries the Object Explorer source and connection group into initial webview state", async () => {
        const state = new DeploymentWebviewState();
        sandbox.stub(controller, "state").get(() => state);
        const source = {
            id: "saved-local-profile",
            profileName: "Local SQL",
            server: "localhost,1433",
            database: "Selected DB",
            isConnected: true,
        };
        const ui = sandbox.createStubInstance(ConnectionUI);
        ui.getConnectionGroupOptions.resolves([]);
        sandbox.stub(controller.mainController.connectionManager, "connectionUI").get(() => ui);
        await DeploymentWebviewController.prototype["initialize"].call(
            controller,
            "local-group",
            undefined,
            source,
        );
        expect(state.initialLocalDatabaseSource).to.deep.equal(source);
        expect(state.formState.groupId).to.equal("local-group");
        expect(state.loadState).to.equal(ApiStatus.Loaded);
    });

    test("stale compatibility cleanup cannot invalidate a running deployment", async () => {
        let running = true;
        sandbox.stub(LocalDatabaseDeploymentService.prototype, "isRunning").get(() => running);
        const cancel = sandbox
            .stub(LocalDatabaseCompatibilityService.prototype, "cancel")
            .resolves();
        const clear = sandbox.stub(LocalDatabaseCompatibilityService.prototype, "clear").resolves();
        const validate = sandbox.stub(LocalDatabaseCompatibilityService.prototype, "validate");
        const token: vscode.CancellationToken = {
            isCancellationRequested: false,
            onCancellationRequested: sandbox.stub(),
        };
        const handler = (method: string) =>
            controller.onRequest.getCalls().find((call) => call.args[0].method === method)!.args[1];
        await handler(AzureSqlDatabaseRequests.CancelLocalDatabaseCompatibility.method)(
            { validationId: "validation" },
            token,
        );
        await handler(AzureSqlDatabaseRequests.ClearLocalDatabaseCompatibility.method)(
            undefined,
            token,
        );
        expect(cancel).not.to.have.been.called;
        expect(clear).not.to.have.been.called;
        expect(() =>
            handler(AzureSqlDatabaseRequests.ValidateLocalDatabaseCompatibility.method)(
                { validationId: "validation" },
                token,
            ),
        ).to.throw(LocalToCloud.invalidDeployment);
        expect(validate).not.to.have.been.called;
        running = false;
        await handler(AzureSqlDatabaseRequests.CancelLocalDatabaseCompatibility.method)(
            { validationId: "validation" },
            token,
        );
        await handler(AzureSqlDatabaseRequests.ClearLocalDatabaseCompatibility.method)(
            undefined,
            token,
        );
        expect(cancel).to.have.been.calledWith("validation");
        expect(clear).to.have.been.called;
    });

    test("registers local-to-cloud handlers alongside container requests", () => {
        expect(
            controller.onRequest.getCalls().map((call) => call.args[0].method),
        ).to.include.members([
            AzureSqlDatabaseRequests.GetLocalDatabaseSources.method,
            AzureSqlDatabaseRequests.ConnectLocalDatabaseSource.method,
            AzureSqlDatabaseRequests.ValidateLocalDatabaseCompatibility.method,
            AzureSqlDatabaseRequests.CancelLocalDatabaseCompatibility.method,
            AzureSqlDatabaseRequests.ClearLocalDatabaseCompatibility.method,
            AzureSqlDatabaseRequests.ShowLocalDatabaseCompatibilityOutput.method,
            AzureSqlDatabaseRequests.DeployLocalDatabase.method,
            AzureSqlDatabaseRequests.CancelLocalDatabaseDeployment.method,
            AzureSqlDatabaseRequests.LocalDatabaseDeploymentAction.method,
        ]);
        expect(azureSql.registerAzureSqlRpcHandlers).to.have.been.calledWith(controller);
    });

    test("clears credentials and refreshes password validation when authentication changes", async () => {
        const state = new DeploymentWebviewState();
        state.deploymentType = DeploymentType.AzureSqlDatabase;
        sandbox.stub(controller, "state").get(() => state);
        const azureState = await initializeAzureSqlDatabaseState(
            controller,
            [],
            stubLogger(sandbox),
            undefined,
        );
        state.formState = azureState.formState;
        azureState.servers = [
            {
                name: "server",
                location: "westus",
                administratorLogin: "admin",
                administrators: { azureADOnlyAuthentication: false },
            },
        ];
        azureState.formState.serverName = "server";
        applyServerAuthSettings(azureState, "server");
        azureState.formState.password = "old-password";
        azureState.formState.savePassword = true;
        azureState.serverCreatedWithAuth = true;
        azureState.formComponents.password.validation = {
            isValid: false,
            validationMessage: "Enter a password",
        };
        controller.validateDeploymentForm.callsFake((propertyName) =>
            DeploymentWebviewController.prototype.validateDeploymentForm.call(
                controller,
                propertyName,
            ),
        );

        const changeAuthentication = (value: AuthenticationType) =>
            DeploymentWebviewController.prototype["handleDeploymentFormAction"].call(
                controller,
                state,
                { event: { propertyName: "authenticationType", value, isAction: false } },
            );
        await changeAuthentication(AuthenticationType.SqlLogin);
        expect(azureState.formState.password).to.equal("old-password");
        expect(azureState.serverCreatedWithAuth).to.be.true;
        await changeAuthentication(AuthenticationType.AzureMFA);
        expect(azureState.formState).to.include({
            userName: "",
            password: "",
            savePassword: false,
        });
        expect(azureState.serverCreatedWithAuth).to.be.false;
        expect(azureState.formComponents.password.validation.isValid).to.be.true;
        await changeAuthentication(AuthenticationType.SqlLogin);
        expect(azureState.formState.userName).to.equal("admin");
        expect(azureState.formComponents.password.validation.isValid).to.be.false;
    });

    teardown(() => {
        for (const disposable of disposables ?? []) {
            disposable.dispose();
        }
        sandbox.restore();
    });

    for (const withGroupComponent of [false, true]) {
        test(`creates and selects a group ${withGroupComponent ? "with" : "without"} initialized deployment form components`, async () => {
            const state = new DeploymentWebviewState();
            state.dialog = connectionGroups.getDefaultConnectionGroupDialogProps([]);
            if (withGroupComponent) {
                state.formComponents.groupId = {
                    type: FormItemType.SearchableDropdown,
                    propertyName: "groupId",
                    label: "Connection group",
                    required: true,
                    componentWidth: "100%",
                    options: [],
                };
            }
            const group = {
                id: "created-group",
                name: "Container connections",
                configSource: vscode.ConfigurationTarget.Global,
            };
            const spec = { name: group.name };
            const create = sandbox.stub(connectionGroups, "createConnectionGroup").resolves(group);
            const main = sandbox.createStubInstance(MainController);
            const manager = sandbox.createStubInstance(ConnectionManager);
            const connectionUI = sandbox.createStubInstance(ConnectionUI);
            sandbox.stub(manager, "connectionUI").get(() => connectionUI);
            main.connectionManager = manager;
            controller.mainController = main;
            const options = [{ value: group.id, displayName: group.name }];
            connectionUI.getConnectionGroupOptions.resolves(options);
            const save = controller.registerReducer
                .getCalls()
                .find((call) => call.args[0] === "createConnectionGroup")!.args[1];

            await save(state, { connectionGroupSpec: spec });

            expect(create).to.have.been.calledWith(spec, manager, TelemetryViews.ConnectionDialog);
            expect(state.formState.groupId).to.equal(group.id);
            expect(state.connectionGroupOptions).to.deep.equal(options);
            if (withGroupComponent) {
                expect(state.formComponents.groupId.options).to.deep.equal(options);
            }
            expect(state.dialog).to.equal(undefined);
            expect(state.deploymentTypeState.dialog).to.equal(undefined);
        });
    }

    test("keeps the group dialog open with the save error and preserves the selected group", async () => {
        const state = new DeploymentWebviewState();
        state.formState.groupId = "existing-group";
        const spec = { name: "New group", color: "#0078D4", parentId: "parent-group" };
        sandbox.stub(connectionGroups, "createConnectionGroup").resolves("Unable to save group");
        const main = sandbox.createStubInstance(MainController);
        const manager = sandbox.createStubInstance(ConnectionManager);
        const store = sandbox.createStubInstance(ConnectionStore);
        const config = sandbox.createStubInstance(ConnectionConfig);
        const groups = [
            {
                id: ConnectionConfig.ROOT_GROUP_ID,
                name: "ROOT",
                configSource: vscode.ConfigurationTarget.Global,
            },
            {
                id: "parent-group",
                name: "Parent",
                parentId: ConnectionConfig.ROOT_GROUP_ID,
                configSource: vscode.ConfigurationTarget.Global,
            },
        ];
        config.getGroups.resolves(groups);
        sandbox.stub(store, "connectionConfig").get(() => config);
        sandbox.stub(manager, "connectionStore").get(() => store);
        main.connectionManager = manager;
        controller.mainController = main;
        const save = controller.registerReducer
            .getCalls()
            .find((call) => call.args[0] === "createConnectionGroup")!.args[1];

        await save(state, { connectionGroupSpec: spec });

        expect(state.formState.groupId).to.equal("existing-group");
        const expectedDialog = connectionGroups.getDefaultConnectionGroupDialogProps(groups);
        expect(state.dialog).to.deep.equal({
            ...expectedDialog,
            props: { ...expectedDialog.props, ...spec, message: "Unable to save group" },
        });
        expect(state.deploymentTypeState.dialog).to.deep.equal(state.dialog);
    });

    test("registers Azure SQL container requests even when preview flags are disabled", () => {
        sandbox.stub(vscode.workspace, "getConfiguration").returns(
            createWorkspaceConfiguration({
                "mssql.preview.azureSqlContainers": false,
                enableExperimentalFeatures: false,
            }),
        );
        controller.onRequest.resetHistory();
        DeploymentWebviewController.prototype["registerRpcHandlers"].call(controller);

        expect(controller.onRequest).to.have.been.calledWith(
            AzureSqlDatabaseRequests.DetectContainerEngines,
        );
        expect(controller.onRequest).to.have.been.calledWith(
            AzureSqlDatabaseRequests.ValidateContainerForm,
        );
    });

    test("Finish closes the Azure container dialog without legacy Docker state", async () => {
        const telemetry = sandbox.spy(localContainers, "sendLocalContainersCloseEventTelemetry");
        const state = new DeploymentWebviewState();

        expect(await close(state, {})).to.equal(state);

        expect(telemetry).not.to.have.been.called;
        expect(closePanel).to.have.been.called;
        expect(controller.dispose).to.have.been.called;
    });

    test("closing initialized local containers still sends close telemetry", async () => {
        const telemetry = sandbox.spy(localContainers, "sendLocalContainersCloseEventTelemetry");
        const state = new DeploymentWebviewState();
        state.deploymentTypeState = new LocalContainersState();

        await close(state, {});

        expect(telemetry).to.have.been.calledWith(state.deploymentTypeState, "workflow-id");
        expect(closePanel).to.have.been.called;
        expect(controller.dispose).to.have.been.called;
    });

    test("telemetry failure does not prevent the dialog from closing", async () => {
        const error = new Error("Telemetry failed");
        sandbox.stub(localContainers, "sendLocalContainersCloseEventTelemetry").throws(error);
        const state = new DeploymentWebviewState();
        state.deploymentTypeState = new LocalContainersState();
        let reportedError: unknown;

        try {
            await close(state, {});
        } catch (caught) {
            reportedError = caught;
        }

        expect(reportedError).to.equal(error);
        expect(closePanel).to.have.been.called;
        expect(controller.dispose).to.have.been.called;
    });

    /**
     * Creates a controller with a real deployment workflow and the state needed by its
     * workflow and provisioning paths, without constructing a webview panel.
     */
    function createWorkflowController(): DeploymentWebviewController {
        sandbox.stub(WebviewPanelController.prototype, "dispose");
        const workflowController = Object.create(
            DeploymentWebviewController.prototype,
        ) as DeploymentWebviewController;
        const state = new DeploymentWebviewState();
        state.deploymentType = DeploymentType.LocalContainers;
        Object.defineProperties(workflowController, {
            _workflow: {
                value: startWorkflow(
                    TelemetryViews.Deployment,
                    TelemetryActions.DeploymentWorkflow,
                    DeploymentWorkflowEventName.Opened,
                ),
            },
            _panelDisposed: { value: false, writable: true },
            _deploymentSucceeded: { value: false, writable: true },
            state: { value: state },
            mainController: {
                value: {
                    backgroundTasksService: {
                        registerTask: sandbox.stub().returns({ complete: sandbox.stub() }),
                    },
                },
            },
        });
        return workflowController;
    }

    function getDeploymentWorkflowEvents(): Record<string, string>[] {
        return telemetry.sendActionEvent
            .getCalls()
            .filter((call) => call.args[1] === TelemetryActions.DeploymentWorkflow)
            .map((call) => call.args[2].additionalProps as Record<string, string>);
    }

    test("deployment completing after the panel closes ends the workflow with its outcome", () => {
        const workflowController = createWorkflowController();
        startProvisioningTask(
            workflowController,
            DeploymentType.LocalContainers,
            "Provisioning",
            "container",
        );

        workflowController.dispose();
        workflowController.dispose();
        completeProvisioningTask(
            workflowController,
            DeploymentType.LocalContainers,
            BackgroundTaskState.Failed,
            "Failed",
        );

        const events = getDeploymentWorkflowEvents();
        expect(events.map((event) => event.eventName)).to.deep.equal([
            DeploymentWorkflowEventName.Opened,
            DeploymentWorkflowEventName.DeploymentStarted,
            DeploymentWorkflowEventName.PanelClosed,
            DeploymentWorkflowEventName.DeploymentCompleted,
        ]);
        expect(events[3]).to.include({
            outcome: BackgroundTaskState.Failed,
            branch: DeploymentType[DeploymentType.LocalContainers],
        });
        expect(workflowController["_workflow"].isEnded).to.be.true;
    });

    test("closing the panel without active provisioning ends the workflow as cancelled", () => {
        const workflowController = createWorkflowController();

        workflowController.dispose();
        workflowController.dispose();

        const events = getDeploymentWorkflowEvents();
        expect(events.map((event) => event.eventName)).to.deep.equal([
            DeploymentWorkflowEventName.Opened,
            DeploymentWorkflowEventName.Closed,
        ]);
        expect(events[1].outcome).to.equal("Cancelled");
    });

    test("provisioning tasks record deployment workflow transitions", () => {
        const task = {
            complete: sandbox.stub(),
        } as unknown as BackgroundTaskHandle;
        const registerTask = sandbox.stub().returns(task);
        Object.defineProperty(controller, "mainController", {
            value: {
                backgroundTasksService: {
                    registerTask,
                },
            },
        });

        startProvisioningTask(
            controller,
            DeploymentType.LocalContainers,
            "Provisioning",
            "container",
        );
        completeProvisioningTask(
            controller,
            DeploymentType.LocalContainers,
            BackgroundTaskState.Succeeded,
            "Complete",
        );

        expect(controller.recordDeploymentStarted).to.have.been.calledWith(
            DeploymentType.LocalContainers,
        );
        expect(controller.recordDeploymentCompleted).to.have.been.calledWith(
            DeploymentType.LocalContainers,
            BackgroundTaskState.Succeeded,
        );
    });
});
