/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { ContainerDeploymentWebviewController } from "../../src/containerDeployment/containerDeploymentWebviewController";
import * as TypeMoq from "typemoq";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import MainController from "../../src/controllers/mainController";
import ConnectionManager from "../../src/controllers/connectionManager";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import * as os from "os";
import { FormItemType } from "../../src/sharedInterfaces/form";
import * as dockerUtils from "../../src/containerDeployment/dockerUtils";
import {
    ContainerDeploymentWebviewState,
    DockerStepOrder,
} from "../../src/sharedInterfaces/containerDeploymentInterfaces";
import * as telemetry from "../../src/telemetry/telemetry";
import { AddLocalContainerConnectionTreeNode } from "../../src/containerDeployment/addLocalContainerConnectionTreeNode";

suite("ContainerDeploymentWebviewController", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mainController: MainController;
    let controller: ContainerDeploymentWebviewController;
    let vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    let connectionManager: TypeMoq.IMock<ConnectionManager>;
    let validateSqlServerContainerNameStub: sinon.SinonStub;
    let validateSqlServerPasswordStub: sinon.SinonStub;
    let validateConnectionNameStub: sinon.SinonStub;
    let findAvailablePortStub: sinon.SinonStub;

    setup(async () => {
        sandbox = sinon.createSandbox();
        mockContext = {
            extensionUri: vscode.Uri.parse("https://localhost"),
            extensionPath: "path",
        } as unknown as vscode.ExtensionContext;

        vscodeWrapper = TypeMoq.Mock.ofType(VscodeWrapper, TypeMoq.MockBehavior.Loose);

        // Stub validateContainerNameStub to mock its behavior
        validateSqlServerContainerNameStub = sandbox.stub(dockerUtils, "validateContainerName");
        validateSqlServerContainerNameStub
            .withArgs("goodContainerName")
            .returns("containerName is valid");
        validateSqlServerContainerNameStub.withArgs("").returns("goodContainerName");
        validateSqlServerContainerNameStub.withArgs("badContainerName").returns("");

        // Stub validateConnectionNameStub to mock its behavior
        validateConnectionNameStub = sandbox.stub(dockerUtils, "validateConnectionName");
        validateConnectionNameStub.withArgs("goodConnectionName").returns(true);
        validateConnectionNameStub.withArgs("badConnectionName").returns(false);

        validateSqlServerPasswordStub = sandbox.stub(dockerUtils, "validateSqlServerPassword");
        validateSqlServerPasswordStub.withArgs("goodPassword123").returns("");
        validateSqlServerPasswordStub.withArgs("badPassword").returns("Invalid password");

        findAvailablePortStub = sandbox.stub(dockerUtils, "findAvailablePort");
        findAvailablePortStub.withArgs(1433).returns(1433);
        findAvailablePortStub.withArgs(1).returns(-1);
        findAvailablePortStub.withArgs("").returns(1433);

        connectionManager = TypeMoq.Mock.ofType(
            ConnectionManager,
            TypeMoq.MockBehavior.Loose,
            mockContext,
        );

        mainController = new MainController(
            mockContext,
            connectionManager.object,
            vscodeWrapper.object,
        );

        controller = new ContainerDeploymentWebviewController(
            mockContext,
            vscodeWrapper.object,
            mainController,
        );
        await (controller as any).initialize();
        await (controller as any).updateItemVisibility();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("Verify the initial state and form components of the controller", async () => {
        const controllerState = (controller as any).state;
        assert.strictEqual(controllerState.loadState, ApiStatus.Loaded);
        assert.strictEqual(controllerState.formState.version, "2025");
        assert.strictEqual(controllerState.formState.user, "SA");
        assert.strictEqual(controllerState.platform, os.platform());
        assert.strictEqual(Object.keys(controllerState.formComponents).length, 8);
        assert.strictEqual(controllerState.dockerSteps.length, 6);
    });

    test("Verify the form components are set correctly", () => {
        const formComponents = (controller as any).state.formComponents;

        // Ensure all expected keys exist
        const expectedKeys = [
            "version",
            "password",
            "savePassword",
            "profileName",
            "containerName",
            "port",
            "hostname",
            "acceptEula",
        ];
        assert.deepEqual(Object.keys(formComponents), expectedKeys);

        const activeFormComponents = (controller as any).getActiveFormComponents(
            (controller as any).state,
        ).length;

        assert.deepEqual(activeFormComponents, expectedKeys.length);

        const version = formComponents.version;
        assert.strictEqual(version.propertyName, "version");
        assert.strictEqual(version.required, true);
        assert.strictEqual(version.type, FormItemType.Dropdown);
        assert.ok(Array.isArray(version.options));

        const password = formComponents.password;
        assert.strictEqual(password.type, FormItemType.Password);
        assert.strictEqual(password.required, true);
        assert.strictEqual(password.componentWidth, "500px");

        // Validate a password (example: valid and invalid case)
        let result = password.validate({}, "goodPassword123");
        assert.strictEqual(result.isValid, true);
        result = password.validate({}, "badPassword");
        assert.strictEqual(result.isValid, false);

        const savePassword = formComponents.savePassword;
        assert.strictEqual(savePassword.type, FormItemType.Checkbox);
        assert.strictEqual(savePassword.required, false);

        const profileName = formComponents.profileName;
        result = profileName.validate({}, ""); // empty name should be valid
        assert.strictEqual(result.isValid, true);

        result = profileName.validate({}, "goodConnectionName");
        assert.strictEqual(result.isValid, true);
        result = profileName.validate({}, "badConnectionName");
        assert.strictEqual(result.isValid, false);

        const containerName = formComponents.containerName;
        result = containerName.validate({ isValidContainerName: true }, "");
        assert.strictEqual(result.isValid, true);
        result = containerName.validate({ isValidContainerName: false }, "");
        assert.strictEqual(result.isValid, false);

        const port = formComponents.port;
        result = port.validate({ isValidPortNumber: true }, "");
        assert.strictEqual(result.isValid, true);

        result = port.validate({ isValidPortNumber: false }, "");
        assert.strictEqual(result.isValid, false);

        const hostname = formComponents.hostname;
        assert.strictEqual(hostname.type, FormItemType.Input);
        assert.strictEqual(hostname.isAdvancedOption, true);

        const acceptEula = formComponents.acceptEula;
        result = acceptEula.validate({}, true);
        assert.strictEqual(result.isValid, true);

        result = acceptEula.validate({}, false);
        assert.strictEqual(result.isValid, false);
    });

    test("Test validatePort with valid and invalid ports", async () => {
        const validPort = await (controller as any).validatePort(1433);
        assert.strictEqual(validPort, true);
        const validPortDefault = await (controller as any).validatePort(undefined);
        assert.strictEqual(validPortDefault, true);
        const invalidPortNumber = await (controller as any).validatePort(1);
        assert.strictEqual(invalidPortNumber, false);
        const invalidPortNumberNan = await (controller as any).validatePort("NaN");
        assert.strictEqual(invalidPortNumberNan, false);
        const invalidPortNumberNeg = await (controller as any).validatePort(-1);
        assert.strictEqual(invalidPortNumberNeg, false);
    });

    test("Test validateDockerConnectionProfile", async () => {
        const controllerState = (controller as any).state;

        // Setup mock form components with validate functions
        controllerState.formComponents = {
            containerName: {
                propertyName: "containerName",
                validate: undefined,
                validation: undefined,
            },
            port: {
                propertyName: "port",
                validate: undefined,
                validation: undefined,
            },
            profileName: {
                propertyName: "profileName",
                validate: (_: any, val: string) => {
                    const isValid = val === "goodConnectionName";
                    return { isValid, validationMessage: isValid ? "" : "Invalid profile name" };
                },
                validation: undefined,
            },
        };

        // Mock state input
        const state: ContainerDeploymentWebviewState = {
            ...controllerState,
            formErrors: [],
            isValidContainerName: true,
            isValidPortNumber: true,
        };

        // Valid profile test
        let profile = {
            containerName: "goodContainerName",
            port: 1433,
            profileName: "goodConnectionName",
        };

        let result = await (controller as any).validateDockerConnectionProfile(
            state,
            profile as any,
        );

        assert.deepEqual(result.formErrors, [], "No form errors expected for valid profile");
        assert.strictEqual(result.isValidContainerName, true);
        assert.strictEqual(result.isValidPortNumber, true);
        assert.strictEqual(
            controllerState.formComponents.profileName.validation.isValid,
            true,
            "Profile name should be valid",
        );

        // Invalid component

        // Use a propertyName that doesn't exist in formComponents
        const updatedState = await (controller as any).validateDockerConnectionProfile(
            (controller as any).state,
            profile as any,
            "nonexistentProperty",
        );

        // Ensure no errors were added because validation was skipped
        assert.deepEqual(updatedState.formErrors, []);

        // Invalid profile name and container
        profile = {
            containerName: "badContainerName",
            port: 1,
            profileName: "badConnectionName",
        };

        result = await (controller as any).validateDockerConnectionProfile(state, profile as any);

        assert.ok(result.formErrors.includes("containerName"));
        assert.ok(result.formErrors.includes("port"));
        assert.ok(result.formErrors.includes("profileName"));
        assert.strictEqual(result.isValidContainerName, false);
        assert.strictEqual(result.isValidPortNumber, false);
        assert.strictEqual(
            controllerState.formComponents.profileName.validation.isValid,
            false,
            "Profile name should be invalid",
        );

        // Test single property validation
        profile = {
            containerName: "badContainerName",
            port: 1433,
            profileName: "goodConnectionName",
        };

        result = await (controller as any).validateDockerConnectionProfile(
            state,
            profile,
            "containerName",
        );

        assert.deepEqual(result.formErrors.includes("containerName"), true);
        assert.strictEqual(result.isValidContainerName, false);
    });

    test("Test formAction reducer", async () => {
        const validateProfileSpy = sinon.spy(controller as any, "validateDockerConnectionProfile");
        const updateStateSpy = sinon.spy(controller as any, "updateState");

        const callState = (controller as any).state;

        const newState = await controller["_reducers"]["formAction"](callState, {
            event: {
                propertyName: "containerName",
                isAction: false,
                value: "goodContainerName",
            },
        });

        assert.ok(validateProfileSpy.calledOnce, "profile validation should be called once");
        assert.ok(updateStateSpy.calledOnce, "updateState should be called once within formAction");

        assert.equal(newState.isValidContainerName, true);

        (validateProfileSpy as sinon.SinonSpy).restore();
        (updateStateSpy as sinon.SinonSpy).restore();
    });

    test("Test completeDockerStep reducer", async () => {
        const addContainerConnectionSpy = sinon.stub(controller as any, "addContainerConnection");
        let callState = (controller as any).state;

        // Simulate step
        callState.dockerSteps = [
            {
                loadState: ApiStatus.NotStarted,
                stepAction: sinon.stub(),
                argNames: [],
            },
        ];
        callState.formState = { profileName: "test-profile" };

        const setStepStatusesSpy = sinon
            .stub(dockerUtils, "setStepStatusesFromResult")
            .returns([{ ...callState.dockerSteps[0], loadState: ApiStatus.Loaded }] as any);

        // Successful docker step
        const result1 = await controller["_reducers"]["completeDockerStep"](callState, {
            dockerStepNumber: 0,
        });

        assert.equal(
            result1.dockerSteps[0].loadState,
            ApiStatus.Loaded,
            "General Step should be loaded",
        );
        assert.ok(!result1.dockerSteps[0].errorMessage, "No error message expected on success");

        // docker Step error
        setStepStatusesSpy.returns([
            {
                ...callState.dockerSteps[0],
                loadState: ApiStatus.Error,
                errorMessage: "error message",
            },
        ] as any);

        callState.dockerSteps[0].loadState = ApiStatus.NotStarted; // Reset to not started state

        const result2 = await controller["_reducers"]["completeDockerStep"](callState, {
            dockerStepNumber: 0,
        });

        assert.equal(
            result2.dockerSteps[0].loadState,
            ApiStatus.Error,
            "General Step should be Errored",
        );
        assert.ok(result2.dockerSteps[0].errorMessage, "Should include error message");

        // connectToContainer step with action
        const fakeStepAction = sinon.stub().resolves("docker-result");

        callState.dockerSteps = [
            {},
            {},
            {},
            {},
            {},
            {
                loadState: ApiStatus.NotStarted,
                stepAction: fakeStepAction,
                argNames: ["containerName", "port"],
            }, // connectToContainer step
        ];
        callState.formState = {
            containerName: "test-container",
            port: 1433,
        };
        addContainerConnectionSpy.resolves(true); // Connection success

        const result3 = await controller["_reducers"]["completeDockerStep"](callState, {
            dockerStepNumber: DockerStepOrder.connectToContainer,
        });

        assert.equal(
            result3.dockerSteps[DockerStepOrder.connectToContainer].loadState,
            ApiStatus.Loaded,
            "Connect to Container Step should be loaded",
        );
        assert.ok(
            !result3.dockerSteps[DockerStepOrder.connectToContainer].errorMessage,
            "No error message expected on success",
        );

        addContainerConnectionSpy.resolves(false); // Connection failure
        callState.dockerSteps[DockerStepOrder.connectToContainer].loadState = ApiStatus.NotStarted; // Reset to not started state

        const result4 = await controller["_reducers"]["completeDockerStep"](callState, {
            dockerStepNumber: DockerStepOrder.connectToContainer,
        });

        assert.equal(
            result4.dockerSteps[DockerStepOrder.connectToContainer].loadState,
            ApiStatus.Error,
            "Connect to Container Step should be Errored",
        );
        assert.ok(
            result4.dockerSteps[DockerStepOrder.connectToContainer].errorMessage,
            "Should include error message",
        );

        const result5 = await controller["_reducers"]["completeDockerStep"](callState, {
            dockerStepNumber: DockerStepOrder.connectToContainer,
        });
        assert.equal(
            result5.dockerSteps[DockerStepOrder.connectToContainer].loadState,
            ApiStatus.Error,
            "Connect to Container load state should remain Error",
        );

        addContainerConnectionSpy.restore();
        setStepStatusesSpy.restore();
    });

    test("resetDockerStepStates reducer should reset errored and following steps", async () => {
        let callState = (controller as any).state;

        // Setup initial state
        callState.dockerSteps = [
            {
                loadState: ApiStatus.Loaded,
                stepAction: sinon.stub(),
                argNames: [],
                errorMessage: "Old error 1",
                fullErrorText: "Old full error 1",
            },
            {
                loadState: ApiStatus.Error,
                stepAction: sinon.stub(),
                argNames: [],
                errorMessage: "Error happened",
                fullErrorText: "Something bad happened",
            },
            {
                loadState: ApiStatus.Error,
                stepAction: sinon.stub(),
                argNames: [],
                errorMessage: "Old error 2",
                fullErrorText: "Old full error 2",
            },
        ];

        // Call reducer directly
        const resultState = await controller["_reducers"]["resetDockerStepStates"](callState, {});

        // First step should remain unchanged
        assert.strictEqual(resultState.dockerSteps[0].loadState, ApiStatus.Loaded);
        assert.strictEqual(resultState.dockerSteps[0].errorMessage, "Old error 1");

        // Second and third steps should be reset
        assert.strictEqual(resultState.dockerSteps[1].loadState, ApiStatus.NotStarted);
        assert.strictEqual(resultState.dockerSteps[1].errorMessage, undefined);
        assert.strictEqual(resultState.dockerSteps[1].fullErrorText, undefined);

        assert.strictEqual(resultState.dockerSteps[2].loadState, ApiStatus.NotStarted);
        assert.strictEqual(resultState.dockerSteps[2].errorMessage, undefined);
        assert.strictEqual(resultState.dockerSteps[2].fullErrorText, undefined);
    });

    test("Test checkDocker Profile reducer", async () => {
        let callState = (controller as any).state;
        const validateProfileStub = sinon.stub(
            controller as any,
            "validateDockerConnectionProfile",
        );

        // Default input
        validateProfileStub.returns({
            formState: {
                containerName: "",
                port: "",
            },
            formErrors: [],
        } as any);
        const defaultResult = await controller["_reducers"]["checkDockerProfile"](callState, {
            dockerStepNumber: DockerStepOrder.connectToContainer,
        });
        assert.ok(
            validateProfileStub.calledOnce,
            "validateDockerConnectionProfile should be called once",
        );
        assert.equal(defaultResult.formState.containerName, "goodContainerName");
        assert.equal(defaultResult.formState.port, "1433");
        assert.equal(defaultResult.isDockerProfileValid, true);
    });

    test("Test dispose reducer", async () => {
        const disposePanelSpy = sinon.spy((controller as any).panel, "dispose");

        const callState = (controller as any).state;
        await controller["_reducers"]["dispose"](callState, {});

        assert.ok(disposePanelSpy.calledOnce, "panel.dispose should be called once");
        (disposePanelSpy as sinon.SinonSpy).restore();
    });

    test("Test addContainerConnection calls all expected methods", async () => {
        const dockerProfile = {
            containerName: "test-container",
            port: "1433",
            profileName: "",
            version: "latest",
            savePassword: true,
        };

        // Stub mainController methods
        const saveProfileStub = sinon.stub().resolves();
        const createSessionStub = sinon.stub().resolves();
        // Stub telemetry method
        const sendActionEventStub = sinon.stub(telemetry, "sendActionEvent");

        controller.mainController = {
            connectionManager: {
                connectionUI: {
                    saveProfile: saveProfileStub,
                } as any,
            } as any,
            createObjectExplorerSession: createSessionStub,
        } as any;

        // Call method
        const result = await (controller as any).addContainerConnection(dockerProfile);

        // Assertions
        assert.ok(sendActionEventStub.calledOnce, "sendActionEvent should be called once");
        assert.ok(saveProfileStub.calledOnce, "saveProfile should be called");
        assert.ok(createSessionStub.calledOnce, "createObjectExplorerSession should be called");

        assert.strictEqual(result, true, "Should return true on success");
        sendActionEventStub.restore();
    });
});

suite("Add Local Container Connection Node", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });
    test("Verify addLocalContainerConnectionNode", async () => {
        const node = new AddLocalContainerConnectionTreeNode();
        assert.strictEqual(
            node.label,
            "Create Local SQL Container",
            "Node label should match expected value",
        );
        assert.strictEqual(
            node.command?.command,
            "mssql.deployLocalDockerContainer",
            "Node command should match expected value",
        );
    });
});
