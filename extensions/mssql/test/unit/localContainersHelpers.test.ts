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
import * as dockerUtils from "../../src/deployment/dockerUtils";
import * as localContainersHelpers from "../../src/deployment/localContainersHelpers";
import * as lc from "../../src/sharedInterfaces/localContainers";
import { DeploymentWebviewController } from "../../src/deployment/deploymentWebviewController";
import MainController from "../../src/controllers/mainController";
import { stubTelemetry } from "./utils";
import { generateUUID } from "../e2e/baseFixtures";

chai.use(sinonChai);

suite("localContainers logic", () => {
    let sandbox: sinon.SinonSandbox;
    let sendActionEvent: sinon.SinonStub;
    let sendErrorEvent: sinon.SinonStub;
    let deploymentController: DeploymentWebviewController;
    let updateStateStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        ({ sendActionEvent, sendErrorEvent } = stubTelemetry(sandbox));
        updateStateStub = sandbox.stub();

        deploymentController = {
            state: {},
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
            .stub(dockerUtils, "getSqlServerContainerVersions")
            .resolves([{ displayName: "Latest", value: "latest" }]);
        sandbox
            .stub(dockerUtils, "initializeDockerSteps")
            .returns([{ loadState: ApiStatus.NotStarted }] as any);

        const groupOptions = [{ displayName: "Default Group", value: "default" }];
        const state = await localContainersHelpers.initializeLocalContainersState(
            groupOptions,
            undefined,
        );

        expect(state.loadState).to.equal(ApiStatus.Loaded);
        expect(state.formState.version).to.equal("latest");
        expect(state.formComponents.password).to.be.ok;
        expect(state.dockerSteps).to.have.lengthOf(1);
    });

    test("initializeLocalContainersState sets connection group", async () => {
        sandbox
            .stub(dockerUtils, "getSqlServerContainerVersions")
            .resolves([{ displayName: "Latest", value: "latest" }]);
        sandbox
            .stub(dockerUtils, "initializeDockerSteps")
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
                password: "Test" + generateUUID(),
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

    test("completeDockerStep updates state on successful step", async () => {
        const stepActionStub = sandbox.stub().resolves({ success: true });
        const state: any = {
            deploymentTypeState: {
                currentDockerStep: 0,
                dockerSteps: [
                    { loadState: ApiStatus.NotStarted, argNames: [], stepAction: stepActionStub },
                ],
                formState: { version: "1.0" },
            },
        };

        localContainersHelpers.registerLocalContainersReducers(deploymentController);
        const newState = await (deploymentController as any).completeDockerStep(state, {
            dockerStep: 0,
        });

        expect(newState.deploymentTypeState.dockerSteps[0].loadState).to.equal(ApiStatus.Loaded);
        expect(newState.deploymentTypeState.currentDockerStep).to.equal(1);
        expect(sendActionEvent).to.have.been.called;
    });

    test("completeDockerStep updates state on failed step", async () => {
        const stepActionStub = sandbox
            .stub()
            .resolves({ success: false, error: "fail", fullErrorText: "full fail" });
        const state: any = {
            deploymentTypeState: {
                currentDockerStep: 0,
                dockerSteps: [
                    { loadState: ApiStatus.NotStarted, argNames: [], stepAction: stepActionStub },
                ],
                formState: { version: "1.0" },
            },
        };

        localContainersHelpers.registerLocalContainersReducers(deploymentController);
        const newState = await (deploymentController as any).completeDockerStep(state, {
            dockerStep: 0,
        });

        expect(newState.deploymentTypeState.dockerSteps[0].loadState).to.equal(ApiStatus.Error);
        expect(newState.deploymentTypeState.currentDockerStep).to.equal(0);
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

    test("addContainerConnection returns true on success", async () => {
        const dockerProfile = {
            containerName: "c",
            port: 1433,
            profileName: "p",
            savePassword: true,
        } as any;

        const saveProfileStub = sandbox.stub().resolves({});
        const createSessionStub = sandbox.stub().resolves();

        const mainController = {
            connectionManager: {
                connectionUI: { saveProfile: saveProfileStub },
            },
            createObjectExplorerSession: createSessionStub,
        } as unknown as MainController;

        const result = await localContainersHelpers.addContainerConnection(
            dockerProfile,
            mainController,
        );
        expect(result).to.be.true;
        expect(saveProfileStub).to.have.been.calledOnce;
        expect(createSessionStub).to.have.been.calledOnce;
    });

    test("sendLocalContainersCloseEventTelemetry sends telemetry event", async () => {
        const state = {
            currentDockerStep: 0,
            dockerSteps: [{ loadState: ApiStatus.Loaded }],
        } as lc.LocalContainersState;

        await localContainersHelpers.sendLocalContainersCloseEventTelemetry(state);

        expect(sendActionEvent).to.have.been.calledOnce;
    });

    test("updateLocalContainersState updates state", async () => {
        await localContainersHelpers.updateLocalContainersState(deploymentController, {} as any);

        expect(updateStateStub).to.have.been.calledOnce;
    });
});
