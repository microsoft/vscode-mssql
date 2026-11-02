/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import { DeploymentWebviewController } from "../../src/deployment/deploymentWebviewController";
import * as localContainers from "../../src/deployment/localContainersHelpers";
import { DeploymentWebviewState } from "../../src/sharedInterfaces/deployment";
import { LocalContainersState } from "../../src/sharedInterfaces/localContainers";
import { AzureSqlDatabaseRequests } from "../../src/sharedInterfaces/azureSqlDatabase";
import { stubTelemetry } from "./utils";
import { createWorkspaceConfiguration } from "./stubs";
import * as connectionGroups from "../../src/controllers/connectionGroupWebviewController";
import MainController from "../../src/controllers/mainController";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import { ConnectionUI } from "../../src/views/connectionUI";
import { FormItemType } from "../../src/sharedInterfaces/form";
import { ConnectionConfig } from "../../src/connectionconfig/connectionconfig";
import { ConnectionProfile } from "../../src/models/connectionProfile";
import { ConnectionStore } from "../../src/models/connectionStore";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import * as azureSql from "../../src/deployment/azureSqlHelpers";
import * as logger from "../../src/models/logger";
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";
import {
    LocalDatabaseDeploymentService,
    LocalDatabaseCompatibilityService,
} from "../../src/deployment/localToCloudHelpers";
import { LocalToCloud } from "../../src/constants/locConstants";

chai.use(sinonChai);
const { expect } = chai;

suite("Deployment webview controller", () => {
    let sandbox: sinon.SinonSandbox;
    let controller: sinon.SinonStubbedInstance<DeploymentWebviewController>;
    let closePanel: sinon.SinonStub;
    let close: (state: DeploymentWebviewState, payload: {}) => Promise<DeploymentWebviewState>;
    let telemetry: ReturnType<typeof stubTelemetry>;
    let disposables: vscode.Disposable[];
    let connectionConfig: sinon.SinonStubbedInstance<ConnectionConfig>;
    let manager: sinon.SinonStubbedInstance<ConnectionManager>;

    setup(() => {
        sandbox = sinon.createSandbox();
        telemetry = stubTelemetry(sandbox);
        ({ controller, disposables } = registerLocalWizardHandlers());
        closePanel = sandbox.stub();
        sandbox.stub(controller, "panel").get(() => ({ dispose: closePanel }));
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
        manager = sandbox.createStubInstance(ConnectionManager);
        const store = sandbox.createStubInstance(ConnectionStore);
        store.readAllConnections.resolves([]);
        connectionConfig = sandbox.createStubInstance(ConnectionConfig);
        connectionConfig.getConnections.resolves([]);
        sandbox.stub(store, "connectionConfig").get(() => connectionConfig);
        sandbox.stub(manager, "connectionStore").get(() => store);
        const active: Record<string, ConnectionInfo> = {};
        sandbox.stub(manager, "activeConnections").get(() => active);
        sandbox.stub(main, "connectionManager").get(() => manager);
        controller.mainController = main;
        DeploymentWebviewController.prototype["registerRpcHandlers"].call(controller);
        return { controller, disposables };
    }

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

    test("lists and refreshes only local database connections from mssql.connections", async () => {
        const configured = Object.assign(new ConnectionProfile(), {
            id: "configured",
            profileName: "Configured database",
            server: "localhost,1433",
            database: "InventoryDb",
            password: "not-for-the-webview",
        });
        connectionConfig.getConnections.resolves([
            configured,
            Object.assign(new ConnectionProfile(), {
                id: "remote",
                server: "remote.example.com",
                database: "RemoteDb",
            }),
            Object.assign(new ConnectionProfile(), {
                id: "server-only",
                server: "localhost",
                database: "",
            }),
        ]);
        const active = new ConnectionInfo();
        active.credentials = Object.assign(new ConnectionProfile(), {
            id: "active-only",
            server: "localhost",
            database: "HistoricalDb",
        });
        manager.activeConnections["active-only"] = active;
        manager.isConnected.withArgs("active-only").returns(true);
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
                id: configured.id,
                profileName: configured.profileName,
                server: configured.server,
                database: configured.database,
                isConnected: false,
                serverVersion: undefined,
            },
        ]);
        connectionConfig.getConnections.resolves([]);
        expect(await handler(undefined, token)).to.deep.equal([]);
        expect(manager.connectionStore.readAllConnections).not.to.have.been.called;
        expect(manager.connect).not.to.have.been.called;
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

    test("registers local-to-cloud handlers alongside the container requests", () => {
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

    teardown(() => {
        for (const disposable of disposables ?? []) {
            disposable.dispose();
        }
        sandbox.restore();
    });

    for (const withGroupComponent of [false, true]) {
        test(`creates and selects a group ${withGroupComponent ? "with" : "without"} initialized deployment form components`, async () => {
            const state = new DeploymentWebviewState();
            state.dialog = connectionGroups.getDefaultConnectionGroupDialogProps();
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
        const spec = { name: "New group", color: "#0078D4" };
        sandbox.stub(connectionGroups, "createConnectionGroup").resolves("Unable to save group");
        controller.mainController = sandbox.createStubInstance(MainController);
        const save = controller.registerReducer
            .getCalls()
            .find((call) => call.args[0] === "createConnectionGroup")!.args[1];

        await save(state, { connectionGroupSpec: spec });

        expect(state.formState.groupId).to.equal("existing-group");
        expect(state.dialog).to.deep.equal({
            type: "createConnectionGroup",
            props: { ...spec, message: "Unable to save group" },
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

        expect(telemetry).to.have.been.calledWith(state.deploymentTypeState);
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
});
