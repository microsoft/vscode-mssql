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
import ConnectionManager from "../../src/controllers/connectionManager";
import { ConnectionUI } from "../../src/views/connectionUI";
import { FormItemType } from "../../src/sharedInterfaces/form";
import { TelemetryViews } from "../../src/sharedInterfaces/telemetry";
import { ConnectionStore } from "../../src/models/connectionStore";
import { ConnectionConfig } from "../../src/connectionconfig/connectionconfig";

chai.use(sinonChai);
const { expect } = chai;

suite("Deployment webview controller", () => {
    let sandbox: sinon.SinonSandbox;
    let controller: sinon.SinonStubbedInstance<DeploymentWebviewController>;
    let closePanel: sinon.SinonStub;
    let close: (state: DeploymentWebviewState, payload: {}) => Promise<DeploymentWebviewState>;

    setup(() => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);
        controller = sandbox.createStubInstance(DeploymentWebviewController);
        closePanel = sandbox.stub();
        sandbox.stub(controller, "panel").get(() => ({ dispose: closePanel }));
        DeploymentWebviewController.prototype["registerRpcHandlers"].call(controller);
        close = controller.registerReducer.getCalls().find((call) => call.args[0] === "dispose")!
            .args[1] as typeof close;
    });

    teardown(() => sandbox.restore());

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
