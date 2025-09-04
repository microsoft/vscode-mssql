/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
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
        const state = await localContainersHelpers.initializeLocalContainersState(groupOptions);

        assert.strictEqual(state.loadState, ApiStatus.Loaded);
        assert.strictEqual(state.formState.version, "latest");
        assert.ok(state.formComponents.password);
        assert.strictEqual(state.dockerSteps.length, 1);
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

        assert.deepEqual(Object.keys(components), expectedKeys);
        assert.strictEqual(components.password.type, FormItemType.Password);
        assert.ok(components.version.options.length > 0);
    });

    test("validatePort works for valid and invalid ports", async () => {
        sandbox
            .stub(dockerUtils, "findAvailablePort")
            .withArgs(1433)
            .resolves(1433)
            .withArgs(1)
            .resolves(-1);

        assert.strictEqual(await localContainersHelpers.validatePort("1433"), true);
        assert.strictEqual(await localContainersHelpers.validatePort("1"), false);
        assert.strictEqual(await localContainersHelpers.validatePort("NaN"), false);
        assert.strictEqual(await localContainersHelpers.validatePort(""), true);
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
                password: generateUUID(),
                acceptEula: true,
            } as any,
            formErrors: [] as string[],
        } as lc.LocalContainersState;

        const validResult = await localContainersHelpers.validateDockerConnectionProfile(state);
        assert.deepEqual(validResult.formErrors, []);

        state.formState.containerName = "badName";
        state.formState.port = 1;
        const invalidResult = await localContainersHelpers.validateDockerConnectionProfile(state);
        assert.ok(invalidResult.formErrors.includes("containerName"));
        assert.ok(invalidResult.formErrors.includes("port"));
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

        assert.strictEqual(newState.deploymentTypeState.dockerSteps[0].loadState, ApiStatus.Loaded);
        assert.strictEqual(newState.deploymentTypeState.currentDockerStep, 1);
        assert.ok(sendActionEvent.called);
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

        assert.strictEqual(newState.deploymentTypeState.dockerSteps[0].loadState, ApiStatus.Error);
        assert.strictEqual(newState.deploymentTypeState.currentDockerStep, 0);
        assert.ok(sendErrorEvent.called);
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

        assert.strictEqual(
            newState.deploymentTypeState.dockerSteps[0].loadState,
            ApiStatus.NotStarted,
        );
        assert.ok(sendActionEvent.called);
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
        assert.strictEqual(
            newState.deploymentTypeState.formValidationLoadState,
            ApiStatus.NotStarted,
        );
        assert.ok(sendActionEvent.called);
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
        assert.strictEqual(result, true);
        assert.ok(saveProfileStub.calledOnce);
        assert.ok(createSessionStub.calledOnce);
    });

    test("sendLocalContainersCloseEventTelemetry sends telemetry event", async () => {
        const state = {
            currentDockerStep: 0,
            dockerSteps: [{ loadState: ApiStatus.Loaded }],
        } as lc.LocalContainersState;

        await localContainersHelpers.sendLocalContainersCloseEventTelemetry(state);

        assert.ok(sendActionEvent.calledOnce);
    });

    test("updateLocalContainersState updates state", async () => {
        await localContainersHelpers.updateLocalContainersState(deploymentController, {} as any);

        assert.ok(updateStateStub.calledOnce);
    });
});
