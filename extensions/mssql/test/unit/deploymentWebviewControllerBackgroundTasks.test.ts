/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { DeploymentWebviewController } from "../../src/deployment/deploymentWebviewController";
import {
    BackgroundTaskState,
    BackgroundTasksService,
} from "../../src/backgroundTasks/backgroundTasksService";
import { DeploymentType, DeploymentWebviewState } from "../../src/sharedInterfaces/deployment";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import {
    DockerStep,
    DockerStepOrder,
    LocalContainersState,
} from "../../src/sharedInterfaces/localContainers";
import { FabricProvisioningState } from "../../src/sharedInterfaces/fabricProvisioning";

chai.use(sinonChai);

suite("DeploymentWebviewController Background Tasks Tests", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("syncBackgroundTask ignores local container prerequisite steps", () => {
        const backgroundTasksService = new BackgroundTasksService(() => undefined);
        const revealStub = sandbox.stub();
        const openDeploymentStub = sandbox.stub();
        const controller = createController(
            backgroundTasksService,
            revealStub,
            openDeploymentStub,
            false,
        );

        const dockerSteps: DockerStep[] = [
            {
                loadState: ApiStatus.Loaded,
                headerText: "Check Docker Engine",
                bodyText: "",
                argNames: [],
                stepAction: async () => ({ success: true }),
            },
            {
                loadState: ApiStatus.Loading,
                headerText: "Pull SQL Server image",
                bodyText: "",
                argNames: [],
                stepAction: async () => ({ success: true }),
            },
        ];

        controller.syncBackgroundTask(
            DeploymentType.LocalContainers,
            new LocalContainersState({
                formState: {
                    containerName: "sql-dev",
                    version: "2022-latest",
                    groupId: "default",
                } as any,
                dockerSteps,
                currentDockerStep: DockerStepOrder.checkDockerEngine,
            }),
        );

        expect(backgroundTasksService.tasks).to.have.length(0);
    });

    test("syncBackgroundTask registers local container deployment progress", async () => {
        const backgroundTasksService = new BackgroundTasksService(() => undefined);
        const revealStub = sandbox.stub();
        const openDeploymentStub = sandbox.stub();
        const controller = createController(
            backgroundTasksService,
            revealStub,
            openDeploymentStub,
            false,
        );

        const notStartedStep = {
            loadState: ApiStatus.NotStarted,
            headerText: "",
            bodyText: "",
            argNames: [],
            stepAction: async () => ({ success: true }),
        };
        const dockerSteps: DockerStep[] = [
            notStartedStep,
            notStartedStep,
            notStartedStep,
            {
                loadState: ApiStatus.Loaded,
                headerText: "Pull SQL Server image",
                bodyText: "",
                argNames: [],
                stepAction: async () => ({ success: true }),
            },
            {
                loadState: ApiStatus.Loading,
                headerText: "Start SQL Server container",
                bodyText: "",
                argNames: [],
                stepAction: async () => ({ success: true }),
            },
            notStartedStep,
            notStartedStep,
        ];

        controller.syncBackgroundTask(
            DeploymentType.LocalContainers,
            new LocalContainersState({
                formState: {
                    containerName: "sql-dev",
                    version: "2022-latest",
                    groupId: "default",
                } as any,
                dockerSteps,
                currentDockerStep: DockerStepOrder.startContainer,
            }),
        );

        const [task] = backgroundTasksService.tasks;
        expect(task.displayText).to.equal("Docker SQL Server Deployment");
        expect(task.details).to.equal("sql-dev");
        expect(task.percent).to.equal(25);
        expect(task.state).to.equal(BackgroundTaskState.InProgress);
        expect(task.message).to.equal("Start SQL Server container");

        await backgroundTasksService.openTask(task.id);
        expect(revealStub).to.have.been.calledOnce;
        expect(openDeploymentStub).not.to.have.been.called;

        Object.defineProperty(controller, "isDisposed", {
            configurable: true,
            get: () => true,
        });

        await backgroundTasksService.openTask(task.id);
        expect(openDeploymentStub).to.have.been.calledOnceWith(
            sinon.match({
                initialConnectionGroup: "default",
                initialDeploymentType: DeploymentType.LocalContainers,
                initialWizardPageId: "local-provisioning",
                initialState: sinon.match.has("operationId", "deployment-op"),
            }),
        );
    });

    test("syncBackgroundTask completes fabric deployment and reopens the wizard when disposed", async () => {
        const backgroundTasksService = new BackgroundTasksService(() => undefined);
        const revealStub = sandbox.stub();
        const openDeploymentStub = sandbox.stub();
        const controller = createController(
            backgroundTasksService,
            revealStub,
            openDeploymentStub,
            false,
        );

        controller.syncBackgroundTask(
            DeploymentType.FabricProvisioning,
            new FabricProvisioningState({
                formState: {
                    workspace: "workspace-id",
                    databaseName: "SalesDb",
                    groupId: "default",
                } as any,
                deploymentStartTime: "now",
                workspaceName: "Fabric Workspace",
                tenantName: "Contoso",
                provisionLoadState: ApiStatus.Loaded,
                connectionLoadState: ApiStatus.Loading,
            }),
        );

        let [task] = backgroundTasksService.tasks;
        expect(task.displayText).to.equal("SQL Database in Fabric Deployment");
        expect(task.details).to.equal("Fabric Workspace/SalesDb");
        expect(task.percent).to.equal(50);
        expect(task.state).to.equal(BackgroundTaskState.InProgress);
        expect(task.message).to.equal("Connecting to database");

        Object.defineProperty(controller, "isDisposed", {
            configurable: true,
            get: () => true,
        });

        controller.syncBackgroundTask(
            DeploymentType.FabricProvisioning,
            new FabricProvisioningState({
                formState: {
                    workspace: "workspace-id",
                    databaseName: "SalesDb",
                    groupId: "default",
                } as any,
                deploymentStartTime: "now",
                workspaceName: "Fabric Workspace",
                tenantName: "Contoso",
                provisionLoadState: ApiStatus.Loaded,
                connectionLoadState: ApiStatus.Loaded,
            }),
        );

        [task] = backgroundTasksService.tasks;
        expect(task.percent).to.equal(100);
        expect(task.state).to.equal(BackgroundTaskState.Succeeded);

        await backgroundTasksService.openTask(task.id);
        expect(openDeploymentStub).to.have.been.calledOnceWith(
            sinon.match({
                initialConnectionGroup: "default",
                initialDeploymentType: DeploymentType.FabricProvisioning,
                initialWizardPageId: "fabric-provisioning",
                initialState: sinon.match.has("operationId", "deployment-op"),
            }),
        );
    });

    test("syncBackgroundTask ignores fabric connection state before provisioning starts", () => {
        const backgroundTasksService = new BackgroundTasksService(() => undefined);
        const revealStub = sandbox.stub();
        const openDeploymentStub = sandbox.stub();
        const controller = createController(
            backgroundTasksService,
            revealStub,
            openDeploymentStub,
            false,
        );

        controller.syncBackgroundTask(
            DeploymentType.FabricProvisioning,
            new FabricProvisioningState({
                formState: {
                    workspace: "workspace-id",
                    databaseName: "SalesDb",
                    groupId: "default",
                } as any,
                workspaceName: "Fabric Workspace",
                tenantName: "Contoso",
                provisionLoadState: ApiStatus.NotStarted,
                connectionLoadState: ApiStatus.Loading,
            }),
        );

        expect(backgroundTasksService.tasks).to.have.length(0);
    });

    test("background task reopen focuses the active deployment controller for the operation", async () => {
        const backgroundTasksService = new BackgroundTasksService(() => undefined);
        const revealStub = sandbox.stub();
        const openDeploymentStub = sandbox.stub();
        const controller = createController(
            backgroundTasksService,
            revealStub,
            openDeploymentStub,
            true,
        );
        const activeControllerRevealStub = sandbox.stub();
        (controller as any)._operationSession.activeController = {
            isDisposed: false,
            revealToForeground: activeControllerRevealStub,
        };

        controller.syncBackgroundTask(
            DeploymentType.LocalContainers,
            new LocalContainersState({
                currentDockerStep: DockerStepOrder.pullImage,
                formState: {
                    groupId: "default",
                    containerName: "sql-dev",
                } as any,
                dockerSteps: [
                    { loadState: ApiStatus.NotStarted },
                    { loadState: ApiStatus.NotStarted },
                    { loadState: ApiStatus.NotStarted },
                    { loadState: ApiStatus.Loading, headerText: "Pull image" },
                ] as any,
            }),
        );
        const [task] = backgroundTasksService.tasks;

        await backgroundTasksService.openTask(task.id);

        expect(activeControllerRevealStub).to.have.been.calledOnce;
        expect(openDeploymentStub).not.to.have.been.called;
    });
});

function createController(
    backgroundTasksService: BackgroundTasksService,
    revealStub: sinon.SinonStub,
    openDeploymentStub: sinon.SinonStub,
    isDisposed: boolean,
): DeploymentWebviewController {
    const controller = Object.create(
        DeploymentWebviewController.prototype,
    ) as DeploymentWebviewController;
    (controller as any).mainController = {
        backgroundTasksService,
        onDeployNewDatabase: openDeploymentStub,
    };
    const state = new DeploymentWebviewState();
    state.formState = { groupId: "default" } as any;
    state.operationId = "deployment-op";
    Object.defineProperty(controller, "state", {
        configurable: true,
        writable: true,
        value: state,
    });
    (controller as any)._operationId = "deployment-op";
    (controller as any)._operationSession = {
        id: "deployment-op",
        state,
        activeController: controller,
    };
    (controller as any).revealToForeground = revealStub;
    Object.defineProperty(controller, "isDisposed", {
        configurable: true,
        get: () => isDisposed,
    });
    return controller;
}
