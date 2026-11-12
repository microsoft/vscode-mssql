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
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";
import { stubTelemetry } from "./utils";
import { createWorkspaceConfiguration } from "./stubs";
import {
    completeProvisioningTask,
    startProvisioningTask,
} from "../../src/deployment/deploymentBackgroundTasks";
import {
    BackgroundTaskHandle,
    BackgroundTaskState,
} from "../../src/backgroundTasks/backgroundTasksService";

chai.use(sinonChai);
const { expect } = chai;

suite("Deployment webview controller", () => {
    let sandbox: sinon.SinonSandbox;
    let telemetry: ReturnType<typeof stubTelemetry>;
    let controller: sinon.SinonStubbedInstance<DeploymentWebviewController>;
    let closePanel: sinon.SinonStub;
    let close: (state: DeploymentWebviewState, payload: {}) => Promise<DeploymentWebviewState>;

    setup(() => {
        sandbox = sinon.createSandbox();
        telemetry = stubTelemetry(sandbox);
        controller = sandbox.createStubInstance(DeploymentWebviewController);
        closePanel = sandbox.stub();
        sandbox.stub(controller, "panel").get(() => ({ dispose: closePanel }));
        sandbox.stub(controller, "workflowCorrelationId").get(() => "workflow-id");
        DeploymentWebviewController.prototype["registerRpcHandlers"].call(controller);
        close = controller.registerReducer.getCalls().find((call) => call.args[0] === "dispose")!
            .args[1] as typeof close;
    });

    teardown(() => sandbox.restore());

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
