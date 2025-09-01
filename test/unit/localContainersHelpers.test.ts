/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as sinon from "sinon";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import { FormItemType } from "../../src/sharedInterfaces/form";
import * as dockerUtils from "../../src/deployment/dockerUtils";
import {
    initializeLocalContainersState,
    registerLocalContainersReducers,
    validateDockerConnectionProfile,
    validatePort,
    addContainerConnection,
    setLocalContainersFormComponents,
} from "../../src/deployment/localContainersHelpers";
import * as lc from "../../src/sharedInterfaces/localContainers";
import { DeploymentWebviewController } from "../../src/deployment/deploymentWebviewController";
import { sendActionEvent, sendErrorEvent } from "../../src/telemetry/telemetry";
import MainController from "../../src/controllers/mainController";

suite("localContainers logic", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
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
        const state = await initializeLocalContainersState(groupOptions);

        assert.strictEqual(state.loadState, ApiStatus.Loaded);
        assert.strictEqual(state.formState.version, "latest");
        assert.ok(state.formComponents.password);
        assert.strictEqual(state.dockerSteps.length, 1);
    });

    test("setLocalContainersFormComponents builds expected keys", () => {
        const versions = [{ displayName: "Latest", value: "latest" }];
        const groups = [{ displayName: "Default Group", value: "default" }];
        const components = setLocalContainersFormComponents(versions, groups);

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

        assert.strictEqual(await validatePort("1433"), true);
        assert.strictEqual(await validatePort("1"), false);
        assert.strictEqual(await validatePort("NaN"), false);
        assert.strictEqual(await validatePort(""), true);
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
            formComponents: setLocalContainersFormComponents(
                [{ displayName: "Latest", value: "latest" }],
                [{ displayName: "Group", value: "g" }],
            ),
            formState: {
                containerName: "goodName",
                port: 1433,
                password: "password123!",
                acceptEula: true,
            } as any,
            formErrors: [] as string[],
        } as lc.LocalContainersState;

        const validResult = await validateDockerConnectionProfile(state);
        assert.deepEqual(validResult.formErrors, []);

        state.formState.containerName = "badName";
        state.formState.port = 1;
        const invalidResult = await validateDockerConnectionProfile(state);
        assert.ok(invalidResult.formErrors.includes("containerName"));
        assert.ok(invalidResult.formErrors.includes("port"));
    });

    test("registerLocalContainersReducers wires reducers and runs completeDockerStep", async () => {
        const fakeController = {
            registerReducer(name: string, fn: any) {
                this.reducers[name] = fn;
            },
            reducers: {} as Record<string, Function>,
            state: { deploymentTypeState: {} },
            updateState: sinon.stub(),
            mainController: {},
        } as unknown as DeploymentWebviewController & { reducers: Record<string, Function> };

        sandbox.stub(sendActionEvent);
        sandbox.stub(sendErrorEvent);
        sandbox.stub(dockerUtils, "findAvailablePort").resolves(1433);

        registerLocalContainersReducers(fakeController);

        const localState: lc.LocalContainersState = {
            dockerSteps: [
                {
                    loadState: ApiStatus.NotStarted,
                    stepAction: sinon.stub().resolves({ success: true }),
                    argNames: [],
                } as any,
            ],
            formState: { version: "latest" } as any,
            currentDockerStep: 0,
        } as any;

        const result = await fakeController.reducers["completeDockerStep"](
            { deploymentTypeState: localState },
            { dockerStep: 0 },
        );

        assert.strictEqual(result.deploymentTypeState.dockerSteps[0].loadState, ApiStatus.Loaded);
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

        const result = await addContainerConnection(dockerProfile, mainController);
        assert.strictEqual(result, true);
        assert.ok(saveProfileStub.calledOnce);
        assert.ok(createSessionStub.calledOnce);
    });
});
