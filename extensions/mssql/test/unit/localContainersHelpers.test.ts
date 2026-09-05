/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import { FormItemType } from "../../src/sharedInterfaces/form";
import * as dockerUtils from "../../src/docker/dockerUtils";
import * as sqlServerContainer from "../../src/deployment/sqlServerContainer";
import * as localContainersHelpers from "../../src/deployment/localContainersHelpers";
import * as lc from "../../src/sharedInterfaces/localContainers";
import { DeploymentWebviewController } from "../../src/deployment/deploymentWebviewController";
import MainController from "../../src/controllers/mainController";
import { stubTelemetry, stubUserSurvey } from "./utils";
import { uuid } from "../e2e/baseFixtures";
import {
    BackgroundTaskHandle,
    BackgroundTaskState,
    BackgroundTasksService,
} from "../../src/backgroundTasks/backgroundTasksService";

chai.use(sinonChai);

suite("localContainers logic", () => {
    let sandbox: sinon.SinonSandbox;
    let sendActionEvent: sinon.SinonStub;
    let sendErrorEvent: sinon.SinonStub;
    let deploymentController: DeploymentWebviewController;
    let updateStateStub: sinon.SinonStub;
    let backgroundTasksService: sinon.SinonStubbedInstance<BackgroundTasksService>;
    let updateTaskStub: sinon.SinonStub;
    let completeTaskStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        ({ sendActionEvent, sendErrorEvent } = stubTelemetry(sandbox));
        stubUserSurvey(sandbox);
        updateStateStub = sandbox.stub();
        updateTaskStub = sandbox.stub();
        completeTaskStub = sandbox.stub();
        const taskHandle: BackgroundTaskHandle = {
            id: "provisioning-task",
            update: updateTaskStub,
            complete: completeTaskStub,
            remove: sandbox.stub(),
        };
        backgroundTasksService = sandbox.createStubInstance(BackgroundTasksService);
        backgroundTasksService.registerTask.returns(taskHandle);

        deploymentController = {
            state: {},
            isDisposed: false,
            mainController: {
                backgroundTasksService,
                connectionManager: {
                    connect: sandbox.stub().resolves(true),
                    disconnect: sandbox.stub().resolves(),
                    connectionUI: {
                        saveProfile: sandbox.stub().resolves({}),
                    },
                    createConnectionDetails: sandbox.stub().returns({}),
                    getConnectionString: sandbox.stub().resolves("Server=localhost,1433"),
                },
                createObjectExplorerSession: sandbox.stub().resolves({}),
            },
            updateState: updateStateStub,
            registerReducer: sandbox.stub().callsFake((name, fn) => {
                (deploymentController as any)[name] = fn;
            }),
        } as any;
    });

    teardown(() => {
        sandbox.restore();
    });

    test("initializeLocalContainersState sets defaults", async () => {
        sandbox
            .stub(sqlServerContainer, "getSqlServerContainerVersions")
            .resolves([{ displayName: "Latest", value: "latest" }]);
        sandbox
            .stub(sqlServerContainer, "initializeDockerSteps")
            .returns([{ loadState: ApiStatus.NotStarted }] as any);

        const groupOptions = [{ displayName: "Default Group", value: "default" }];
        const state = await localContainersHelpers.initializeLocalContainersState(
            groupOptions,
            undefined,
        );

        expect(state.loadState).to.equal(ApiStatus.Loaded);
        expect(state.formState.version).to.equal("latest");
        expect(state.connectionString).to.equal("");
        expect(state.formComponents.password).to.be.ok;
        expect(state.dockerSteps).to.have.lengthOf(1);
    });

    test("initializeLocalContainersState sets connection group", async () => {
        sandbox
            .stub(sqlServerContainer, "getSqlServerContainerVersions")
            .resolves([{ displayName: "Latest", value: "latest" }]);
        sandbox
            .stub(sqlServerContainer, "initializeDockerSteps")
            .returns([{ loadState: ApiStatus.NotStarted }] as any);

        const groupOptions = [{ displayName: "Default Group", value: "default" }];
        const state = await localContainersHelpers.initializeLocalContainersState(
            groupOptions,
            "testGroup",
        );

        expect(state.loadState).to.equal(ApiStatus.Loaded);
        expect(state.formState.version).to.equal("latest");
        expect(state.formComponents.password).to.be.ok;
        expect(state.dockerSteps).to.have.lengthOf(1);
        expect(state.formState.groupId).to.equal("testGroup");
    });

    test("setLocalContainersFormComponents builds expected keys", () => {
        const versions = [{ displayName: "Latest", value: "latest" }];
        const groups = [{ displayName: "Default Group", value: "default" }];
        const components = localContainersHelpers.setLocalContainersFormComponents(
            versions,
            groups,
        );

        const expectedKeys = [
            "version",
            "password",
            "savePassword",
            "profileName",
            "groupId",
            "containerName",
            "port",
            "hostname",
            "acceptEula",
        ];

        expect(Object.keys(components)).to.deep.equal(expectedKeys);
        expect(components.password.type).to.equal(FormItemType.Password);
        expect(components.version.options.length > 0).to.be.true;
    });

    test("validatePort works for valid and invalid ports", async () => {
        sandbox
            .stub(dockerUtils, "findAvailablePort")
            .withArgs(1433)
            .resolves(1433)
            .withArgs(1)
            .resolves(-1);

        expect(await localContainersHelpers.validatePort("1433")).to.be.true;
        expect(await localContainersHelpers.validatePort("1")).to.be.false;
        expect(await localContainersHelpers.validatePort("NaN")).to.be.false;
        expect(await localContainersHelpers.validatePort("")).to.be.true;
    });

    test("validateDockerConnectionProfile validates containerName and port", async () => {
        sandbox
            .stub(dockerUtils, "validateContainerName")
            .withArgs("goodName")
            .resolves("goodName")
            .withArgs("badName")
            .resolves("");
        sandbox
            .stub(dockerUtils, "invalidContainerNameValidationResult")
            .value({ isValid: false, validationMessage: "Bad name" });
        sandbox
            .stub(dockerUtils, "invalidPortNumberValidationResult")
            .value({ isValid: false, validationMessage: "Bad port" });
        sandbox.stub(dockerUtils, "findAvailablePort").resolves(1433);

        const state = {
            formComponents: localContainersHelpers.setLocalContainersFormComponents(
                [{ displayName: "Latest", value: "latest" }],
                [{ displayName: "Group", value: "g" }],
            ),
            formState: {
                containerName: "goodName",
                port: 1433,
                password: "Test" + uuid(),
                acceptEula: true,
            } as any,
            formErrors: [] as string[],
        } as lc.LocalContainersState;

        const validResult = await localContainersHelpers.validateDockerConnectionProfile(state);
        expect(validResult.formErrors).to.deep.equal([]);

        state.formState.containerName = "badName";
        state.formState.port = 1;
        const invalidResult = await localContainersHelpers.validateDockerConnectionProfile(state);
        expect(invalidResult.formErrors).to.include("containerName");
        expect(invalidResult.formErrors).to.include("port");
    });

    test("completeDockerStep does not start a provisioning task for prerequisite steps", async () => {
        const state: any = {
            deploymentTypeState: {
                currentDockerStep: lc.DockerStepOrder.dockerInstallation,
                dockerSteps: [
                    {
                        loadState: ApiStatus.NotStarted,
                        argNames: [],
                        headerText: "Checking Docker",
                        stepAction: sandbox.stub().resolves({ success: true }),
                    },
                ],
                formState: { version: "1.0", containerName: "" },
            },
        };

        localContainersHelpers.registerLocalContainersReducers(deploymentController);
        await (deploymentController as any).completeDockerStep(state, {
            dockerStep: lc.DockerStepOrder.dockerInstallation,
        });

        expect(backgroundTasksService.registerTask).not.to.have.been.called;
    });

    test("completeDockerStep completes the task after controller disposal", async () => {
        const pullImageStub = sandbox.stub().resolves({ success: true });
        const startContainerStub = sandbox.stub().resolves({ success: true });
        const checkContainerStub = sandbox.stub().resolves({ success: true });
        const deploymentCompleted = new Promise<void>((resolve) => {
            completeTaskStub.callsFake(() => resolve());
        });
        (deploymentController as any).isDisposed = true;
        updateStateStub.throws(new Error("Cannot send notification on disposed controller"));
        const state: any = {
            deploymentTypeState: {
                currentDockerStep: lc.DockerStepOrder.pullImage,
                dockerSteps: [
                    { loadState: ApiStatus.Loaded },
                    { loadState: ApiStatus.Loaded },
                    { loadState: ApiStatus.Loaded },
                    {
                        loadState: ApiStatus.NotStarted,
                        argNames: [],
                        headerText: "Pulling image",
                        stepAction: pullImageStub,
                    },
                    {
                        loadState: ApiStatus.NotStarted,
                        argNames: [],
                        headerText: "Starting container",
                        stepAction: startContainerStub,
                    },
                    {
                        loadState: ApiStatus.NotStarted,
                        argNames: [],
                        headerText: "Checking container",
                        stepAction: checkContainerStub,
                    },
                    {
                        loadState: ApiStatus.NotStarted,
                        argNames: [],
                        headerText: "Connecting to container",
                        stepAction: sandbox.stub(),
                    },
                ],
                formState: {
                    version: "1.0",
                    containerName: "test-container",
                    port: 1433,
                    profileName: "",
                    savePassword: false,
                },
            },
        };

        localContainersHelpers.registerLocalContainersReducers(deploymentController);
        const newState = await (deploymentController as any).completeDockerStep(state, {
            dockerStep: lc.DockerStepOrder.pullImage,
        });
        await deploymentCompleted;

        expect(
            newState.deploymentTypeState.dockerSteps[lc.DockerStepOrder.pullImage].loadState,
        ).to.equal(ApiStatus.Loaded);
        expect(
            newState.deploymentTypeState.dockerSteps[lc.DockerStepOrder.connectToContainer]
                .loadState,
        ).to.equal(ApiStatus.Loaded);
        expect(newState.deploymentTypeState.currentDockerStep).to.equal(7);
        expect(backgroundTasksService.registerTask).to.have.been.calledWithMatch({
            displayText: "Provisioning test-container",
            target: "test-container",
            state: BackgroundTaskState.InProgress,
        });
        expect(updateTaskStub).to.have.been.calledWithMatch({ message: "Pulling image" });
        expect(updateTaskStub).to.have.been.calledWithMatch({ message: "Starting container" });
        expect(updateTaskStub).to.have.been.calledWithMatch({ message: "Checking container" });
        expect(updateTaskStub).to.have.been.calledWithMatch({
            message: "Connecting to container",
        });
        expect(completeTaskStub).to.have.been.calledWith(
            BackgroundTaskState.Succeeded,
            sinon.match({ message: sinon.match.string }),
        );
        expect(pullImageStub).to.have.been.called;
        expect(startContainerStub).to.have.been.called;
        expect(checkContainerStub).to.have.been.called;
        expect(updateStateStub).not.to.have.been.called;
        expect(sendActionEvent).to.have.been.called;
    });

    test("completeDockerStep updates state and completes the task on failure", async () => {
        const stepActionStub = sandbox
            .stub()
            .resolves({ success: false, error: "fail", fullErrorText: "full fail" });
        const deploymentCompleted = new Promise<void>((resolve) => {
            completeTaskStub.callsFake(() => resolve());
        });
        const state: any = {
            deploymentTypeState: {
                currentDockerStep: lc.DockerStepOrder.pullImage,
                dockerSteps: [
                    { loadState: ApiStatus.Loaded },
                    { loadState: ApiStatus.Loaded },
                    { loadState: ApiStatus.Loaded },
                    {
                        loadState: ApiStatus.NotStarted,
                        argNames: [],
                        headerText: "Creating container",
                        stepAction: stepActionStub,
                    },
                ],
                formState: { version: "1.0", containerName: "failed-container" },
            },
        };

        localContainersHelpers.registerLocalContainersReducers(deploymentController);
        const newState = await (deploymentController as any).completeDockerStep(state, {
            dockerStep: lc.DockerStepOrder.pullImage,
        });
        await deploymentCompleted;

        expect(
            newState.deploymentTypeState.dockerSteps[lc.DockerStepOrder.pullImage].loadState,
        ).to.equal(ApiStatus.Error);
        expect(newState.deploymentTypeState.currentDockerStep).to.equal(
            lc.DockerStepOrder.pullImage,
        );
        expect(backgroundTasksService.registerTask).to.have.been.calledWithMatch({
            target: "failed-container",
        });
        expect(completeTaskStub).to.have.been.calledWith(
            BackgroundTaskState.Failed,
            sinon.match({ message: sinon.match("fail") }),
        );
        expect(sendErrorEvent).to.have.been.called;
    });

    test("resetDockerStepState resets current step", async () => {
        const state: any = {
            deploymentTypeState: {
                currentDockerStep: 0,
                dockerSteps: [{ loadState: ApiStatus.Loaded }],
            },
        };

        localContainersHelpers.registerLocalContainersReducers(deploymentController);
        const newState = await (deploymentController as any).resetDockerStepState(state, {});

        expect(newState.deploymentTypeState.dockerSteps[0].loadState).to.equal(
            ApiStatus.NotStarted,
        );
        expect(sendActionEvent).to.have.been.called;
    });

    test("checkDockerProfile validates form and sends telemetry", async () => {
        sandbox.stub(dockerUtils, "validateContainerName").resolves("validName");
        sandbox.stub(dockerUtils, "findAvailablePort").resolves(1433);
        sandbox.stub(localContainersHelpers, "validateDockerConnectionProfile").resolves({
            formState: {
                containerName: "validName",
                port: 1433,
                hostname: "localhost",
                version: "1.0",
                password: "pass",
                savePassword: true,
                profileName: "profile1",
                groupId: "default",
                acceptEula: true,
            },
            formComponents: {},
            formErrors: [],
        } as any);

        // Complete formState with all expected keys
        const state: any = {
            deploymentTypeState: {
                formState: {
                    containerName: "",
                    port: undefined,
                    hostname: "",
                    version: "1.0",
                    password: "",
                    savePassword: false,
                    profileName: "",
                    groupId: "",
                    acceptEula: false,
                },
                formErrors: [],
                formComponents: {},
                formValidationLoadState: ApiStatus.NotStarted,
                dockerSteps: [
                    {
                        loadState: ApiStatus.NotStarted,
                        argNames: [],
                        stepAction: sandbox.stub().resolves({ success: true }),
                    },
                ],
                currentDockerStep: 0,
                isDockerProfileValid: false,
            },
        };

        // Register reducers
        localContainersHelpers.registerLocalContainersReducers(deploymentController);

        // Call the reducer
        const newState = await (deploymentController as any).checkDockerProfile(state, {});

        // Assertions
        expect(newState.deploymentTypeState.formValidationLoadState).to.equal(ApiStatus.NotStarted);
        expect(sendActionEvent).to.have.been.called;
    });

    test("addContainerConnection returns connection string on success", async () => {
        const dockerProfile = {
            containerName: "c",
            port: 1433,
            profileName: "p",
            savePassword: true,
        } as any;

        const savedProfile = { id: "container-profile" };
        const connectionDetails = { options: {} };
        const saveProfileStub = sandbox.stub().resolves(savedProfile);
        const createSessionStub = sandbox.stub().resolves();
        const connectStub = sandbox.stub().resolves(true);
        const disconnectStub = sandbox.stub().resolves();
        const createConnectionDetailsStub = sandbox.stub().returns(connectionDetails);
        const getConnectionStringStub = sandbox
            .stub()
            .withArgs(connectionDetails, false, false)
            .resolves("Server=localhost,1433;User ID=sa;Trust Server Certificate=True");

        const mainController = {
            connectionManager: {
                connect: connectStub,
                disconnect: disconnectStub,
                connectionUI: { saveProfile: saveProfileStub },
                createConnectionDetails: createConnectionDetailsStub,
                getConnectionString: getConnectionStringStub,
            },
            createObjectExplorerSession: createSessionStub,
        } as unknown as MainController;

        const result = await localContainersHelpers.addContainerConnection(
            dockerProfile,
            mainController,
        );
        expect(result).to.deep.equal({
            success: true,
            connectionString: "Server=localhost,1433;User ID=sa;Trust Server Certificate=True",
        });
        expect(connectStub).to.have.been.calledWithMatch(sinon.match.string, sinon.match.object, {
            shouldHandleErrors: false,
        });
        expect(disconnectStub).to.have.been.called;
        expect(saveProfileStub).to.have.been.calledWithMatch({
            server: "localhost,1433",
            user: "SA",
        });
        expect(createSessionStub).to.have.been.calledWith(savedProfile);
    });

    test("addContainerConnection retries while container authentication initializes", async () => {
        const clock = sandbox.useFakeTimers();
        const dockerProfile = {
            containerName: "c",
            port: 1433,
            profileName: "p",
            savePassword: true,
        } as any;

        const savedProfile = { id: "container-profile" };
        const connectionDetails = { options: {} };
        const saveProfileStub = sandbox.stub().resolves(savedProfile);
        const createSessionStub = sandbox.stub().resolves();
        const connectStub = sandbox.stub();
        connectStub.onFirstCall().resolves(false);
        connectStub.onSecondCall().resolves(true);
        const disconnectStub = sandbox.stub().resolves();
        const createConnectionDetailsStub = sandbox.stub().returns(connectionDetails);
        const getConnectionStringStub = sandbox.stub().resolves("Server=localhost,1433");

        const mainController = {
            connectionManager: {
                connect: connectStub,
                disconnect: disconnectStub,
                connectionUI: { saveProfile: saveProfileStub },
                createConnectionDetails: createConnectionDetailsStub,
                getConnectionString: getConnectionStringStub,
            },
            createObjectExplorerSession: createSessionStub,
        } as unknown as MainController;

        const resultPromise = localContainersHelpers.addContainerConnection(
            dockerProfile,
            mainController,
        );
        await clock.tickAsync(3000);

        expect(await resultPromise).to.deep.equal({
            success: true,
            connectionString: "Server=localhost,1433",
        });
        expect(connectStub).to.have.been.calledTwice;
        expect(disconnectStub).to.have.been.called;
        expect(saveProfileStub).to.have.been.calledWithMatch({
            server: "localhost,1433",
        });
        expect(createSessionStub).to.have.been.calledWith(savedProfile);
    });

    test("sendLocalContainersCloseEventTelemetry sends telemetry event", async () => {
        const state = {
            currentDockerStep: 0,
            dockerSteps: [{ loadState: ApiStatus.Loaded }],
        } as lc.LocalContainersState;

        await localContainersHelpers.sendLocalContainersCloseEventTelemetry(state);

        expect(sendActionEvent).to.have.been.called;
    });

    test("updateLocalContainersState updates state", async () => {
        await localContainersHelpers.updateLocalContainersState(deploymentController, {} as any);

        expect(updateStateStub).to.have.been.calledOnce;
    });
});
