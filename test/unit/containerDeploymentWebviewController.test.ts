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
import { FormItemType } from "../../src/sharedInterfaces/form";
import * as dockerUtils from "../../src/containerDeployment/dockerUtils";
import {
    ContainerDeploymentFormItemSpec,
    ContainerDeploymentWebviewState,
    DockerStepOrder,
} from "../../src/sharedInterfaces/containerDeploymentInterfaces";
import { AddLocalContainerConnectionTreeNode } from "../../src/containerDeployment/addLocalContainerConnectionTreeNode";
import { ConnectionUI } from "../../src/views/connectionUI";
import { stubTelemetry } from "./utils";
import * as ConnectionGroupWebviewController from "../../src/controllers/connectionGroupWebviewController";

suite("ContainerDeploymentWebviewController", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mainController: MainController;
    let controller: ContainerDeploymentWebviewController;
    let vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    let connectionManager: TypeMoq.IMock<ConnectionManager>;
    let validateSqlServerContainerNameStub: sinon.SinonStub;
    let validateSqlServerPasswordStub: sinon.SinonStub;
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
        const mockConnectionUI = TypeMoq.Mock.ofType<ConnectionUI>();
        mockConnectionUI
            .setup((x) => x.getConnectionGroupOptions())
            .returns(() =>
                Promise.resolve([{ displayName: "defaultGroupIdName", value: "Default Group" }]),
            );

        connectionManager.setup((x) => x.connectionUI).returns(() => mockConnectionUI.object);

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
        const controllerState = controller["state"];
        assert.strictEqual(controllerState.loadState, ApiStatus.Loaded);
        assert.strictEqual(Object.keys(controllerState.formComponents).length, 9);
        assert.strictEqual(controllerState.dockerSteps.length, 6);
    });

    test("Verify the form components are set correctly", () => {
        const formComponents = controller["state"].formComponents;

        // Ensure all expected keys exist
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
        assert.deepEqual(Object.keys(formComponents), expectedKeys);

        const activeFormComponents = (controller as any).getActiveFormComponents(
            controller["state"],
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
        let result = password.validate({} as ContainerDeploymentWebviewState, "goodPassword123");
        assert.strictEqual(result.isValid, true);
        result = password.validate({} as ContainerDeploymentWebviewState, "badPassword");
        assert.strictEqual(result.isValid, false);

        const savePassword = formComponents.savePassword;
        assert.strictEqual(savePassword.type, FormItemType.Checkbox);
        assert.strictEqual(savePassword.required, false);

        const groupId = formComponents.groupId;
        assert.strictEqual(groupId.type, FormItemType.SearchableDropdown);
        assert.ok(Array.isArray(groupId.options));

        const profileName = formComponents.profileName;
        assert.strictEqual(profileName.type, FormItemType.Input);

        const containerName = formComponents.containerName;
        assert.strictEqual(containerName.type, FormItemType.Input);
        assert.strictEqual(containerName.isAdvancedOption, true);

        const port = formComponents.port;
        assert.strictEqual(port.type, FormItemType.Input);
        assert.strictEqual(port.isAdvancedOption, true);

        const hostname = formComponents.hostname;
        assert.strictEqual(hostname.type, FormItemType.Input);
        assert.strictEqual(hostname.isAdvancedOption, true);

        const acceptEula = formComponents.acceptEula;
        result = acceptEula.validate({} as ContainerDeploymentWebviewState, true);
        assert.strictEqual(result.isValid, true);

        result = acceptEula.validate({} as ContainerDeploymentWebviewState, false);
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
        const controllerState = controller["state"];

        // Setup mock form components with validate functions
        controllerState.formComponents = {
            containerName: {
                propertyName: "containerName",
                validate: undefined,
                validation: undefined,
            } as ContainerDeploymentFormItemSpec,
            port: {
                propertyName: "port",
                validate: undefined,
                validation: undefined,
            } as ContainerDeploymentFormItemSpec,
            profileName: {
                propertyName: "profileName",
                validate: (_: any, val: string) => {
                    const isValid = val === "goodConnectionName";
                    return { isValid, validationMessage: isValid ? "" : "Invalid profile name" };
                },
                validation: undefined,
            } as ContainerDeploymentFormItemSpec,
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
            controller["state"],
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
        const validateProfileSpy = sandbox.spy(
            controller as any,
            "validateDockerConnectionProfile",
        );
        const updateStateSpy = sandbox.spy(controller as any, "updateState");

        const callState = controller["state"];

        const newState = await controller["_reducerHandlers"].get("formAction")(callState, {
            event: {
                propertyName: "containerName",
                isAction: false,
                value: "goodContainerName",
            },
        });

        assert.ok(validateProfileSpy.calledOnce, "profile validation should be called once");
        assert.ok(updateStateSpy.calledOnce, "updateState should be called once within formAction");

        assert.equal(newState.isValidContainerName, true);
    });

    test("completeDockerStep reducer updates step status and handles success/failure", async () => {
        const addContainerConnectionStub = sandbox.stub(
            controller as any,
            "addContainerConnection",
        );
        // Stub telemetry method
        const { sendErrorEvent } = stubTelemetry(sandbox);
        let callState = controller["state"];

        // --- Test general step success ---
        const mockStepActionSuccess = sandbox.stub().resolves({ success: true });
        callState.dockerSteps = [
            {
                loadState: ApiStatus.NotStarted,
                stepAction: mockStepActionSuccess,
                argNames: [],
                headerText: "Step 1",
                bodyText: "This is step 1",
            },
        ];
        callState.formState = {} as any;

        const resultSuccess = await controller["_reducerHandlers"].get("completeDockerStep")(
            callState,
            {
                dockerStep: 0,
            },
        );

        assert.equal(resultSuccess.dockerSteps[0].loadState, ApiStatus.Loaded);
        assert.ok(!resultSuccess.dockerSteps[0].errorMessage);

        // --- Test general step failure ---
        const mockStepActionFailure = sandbox.stub().resolves({
            success: false,
            error: "Something went wrong",
            fullErrorText: "Full error detail",
        });
        callState.dockerSteps[0].stepAction = mockStepActionFailure;
        callState.dockerSteps[0].loadState = ApiStatus.NotStarted;

        const resultFailure = await controller["_reducerHandlers"].get("completeDockerStep")(
            callState,
            {
                dockerStep: 0,
            },
        );

        assert.equal(resultFailure.dockerSteps[0].loadState, ApiStatus.Error);
        assert.equal(resultFailure.dockerSteps[0].errorMessage, "Something went wrong");
        assert.ok(sendErrorEvent.calledOnce, "sendErrorEvent should be called once");

        sendErrorEvent.resetHistory();

        // --- Test connectToContainer success ---
        callState.dockerSteps = [];
        callState.dockerSteps[DockerStepOrder.connectToContainer] = {
            loadState: ApiStatus.NotStarted,
            stepAction: sandbox.stub(), // not called for connectToContainer
            argNames: ["containerName", "port"],
            headerText: "Connect to Container",
            bodyText: "Connect to the SQL Server container",
        };
        callState.formState = {
            containerName: "my-container",
            port: 1433,
            profileName: "dev-profile",
        } as any;
        addContainerConnectionStub.resolves(true);

        const resultConnectSuccess = await controller["_reducerHandlers"].get("completeDockerStep")(
            callState,
            {
                dockerStep: DockerStepOrder.connectToContainer,
            },
        );

        assert.equal(
            resultConnectSuccess.dockerSteps[DockerStepOrder.connectToContainer].loadState,
            ApiStatus.Loaded,
        );
        assert.ok(
            !resultConnectSuccess.dockerSteps[DockerStepOrder.connectToContainer].errorMessage,
        );

        // --- Test connectToContainer failure ---
        callState.dockerSteps[DockerStepOrder.connectToContainer].loadState = ApiStatus.NotStarted;
        addContainerConnectionStub.resolves(false);

        const resultConnectFailure = await controller["_reducerHandlers"].get("completeDockerStep")(
            callState,
            {
                dockerStep: DockerStepOrder.connectToContainer,
            },
        );

        assert.equal(
            resultConnectFailure.dockerSteps[DockerStepOrder.connectToContainer].loadState,
            ApiStatus.Error,
        );
        assert.ok(
            resultConnectFailure.dockerSteps[
                DockerStepOrder.connectToContainer
            ].errorMessage.includes("dev-profile"),
        );
        assert.ok(sendErrorEvent.calledOnce, "sendErrorEvent should be called twice");
    });

    test("resetDockerStepState reducer should reset only the current docker step", async () => {
        let callState = controller["state"];
        // Stub telemetry method
        const { sendActionEvent } = stubTelemetry(sandbox);

        // Setup initial state
        callState.currentDockerStep = 1; // Only step 1 should be reset
        callState.dockerSteps = [
            {
                loadState: ApiStatus.Loaded,
                stepAction: sandbox.stub(),
                argNames: [],
                errorMessage: "Old error 1",
                fullErrorText: "Old full error 1",
                headerText: "Step 1",
                bodyText: "This is step 1",
            },
            {
                loadState: ApiStatus.Error,
                stepAction: sandbox.stub(),
                argNames: [],
                errorMessage: "Error happened",
                fullErrorText: "Something bad happened",
                headerText: "Step 2",
                bodyText: "This is step 2",
            },
            {
                loadState: ApiStatus.Error,
                stepAction: sandbox.stub(),
                argNames: [],
                errorMessage: "Old error 2",
                fullErrorText: "Old full error 2",
                headerText: "Step 3",
                bodyText: "This is step 3",
            },
        ];

        // Call reducer directly
        const resultState = await controller["_reducerHandlers"].get("resetDockerStepState")(
            callState,
            {},
        );

        // First step should remain unchanged
        assert.strictEqual(resultState.dockerSteps[0].loadState, ApiStatus.Loaded);
        assert.strictEqual(resultState.dockerSteps[0].errorMessage, "Old error 1");

        // Only second step (current step) should be reset
        assert.strictEqual(resultState.dockerSteps[1].loadState, ApiStatus.NotStarted);
        assert.strictEqual(
            resultState.dockerSteps[1].errorMessage,
            "Error happened",
            "Error should not be cleared",
        );
        assert.strictEqual(
            resultState.dockerSteps[1].fullErrorText,
            "Something bad happened",
            "Full error should not be cleared",
        );

        // Third step should remain unchanged
        assert.strictEqual(resultState.dockerSteps[2].loadState, ApiStatus.Error);
        assert.strictEqual(resultState.dockerSteps[2].errorMessage, "Old error 2");
        assert.strictEqual(resultState.dockerSteps[2].fullErrorText, "Old full error 2");
        sandbox.assert.calledOnce(sendActionEvent);
    });

    test("Test checkDocker Profile reducer", async () => {
        let callState = controller["state"];
        const validateProfileStub = sandbox.stub(
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
        const defaultResult = await controller["_reducerHandlers"].get("checkDockerProfile")(
            callState,
            {
                dockerStepNumber: DockerStepOrder.connectToContainer,
            },
        );
        assert.ok(
            validateProfileStub.calledOnce,
            "validateDockerConnectionProfile should be called once",
        );
        assert.equal(defaultResult.formState.containerName, "goodContainerName");
        assert.equal(defaultResult.formState.port, "1433");
        assert.equal(defaultResult.isDockerProfileValid, true);
    });

    test("Test createConnectionGroup reducer", async () => {
        const createConnectionGroupStub = sandbox.stub(
            ConnectionGroupWebviewController,
            "createConnectionGroup",
        );

        createConnectionGroupStub.resolves("Error creating group");
        let callState = controller["state"];

        let result = await controller["_reducerHandlers"].get("createConnectionGroup")(callState, {
            connectionGroupSpec: {
                name: "Test Group",
            },
        });
        assert.ok(
            createConnectionGroupStub.calledOnce,
            "createConnectionGroup should be called once",
        );
        assert.ok(
            result.formErrors.includes("Error creating group"),
            "Should include error message",
        );
        createConnectionGroupStub.resetHistory();

        createConnectionGroupStub.resolves({ id: "test-group-id", name: "Test Group" });
        result = await controller["_reducerHandlers"].get("createConnectionGroup")(callState, {
            connectionGroupSpec: {
                name: "Test Group",
            },
        });
        assert.ok(createConnectionGroupStub.calledOnce, "createConnectionGroup should be called");
        assert.ok(result.formState.groupId === "test-group-id", "Should match group ID");
        assert.ok(result.dialog === undefined, "Should not have a dialog open");
    });

    test("Test setConnectionGroupDialogState reducer", async () => {
        let callState = controller["state"];

        let result = await controller["_reducerHandlers"].get("setConnectionGroupDialogState")(
            callState,
            {
                shouldOpen: false,
            },
        );

        assert.ok(result.dialog === undefined, "Should not have a dialog open");

        result = await controller["_reducerHandlers"].get("setConnectionGroupDialogState")(
            callState,
            {
                shouldOpen: true,
            },
        );
        assert.ok(result.dialog !== undefined, "Should have a dialog open");
    });

    test("Test dispose reducer", async () => {
        // Stub telemetry method
        const { sendActionEvent } = stubTelemetry(sandbox);
        const disposePanelSpy = sinon.spy((controller as any).panel, "dispose");

        const callState = controller["state"];
        await controller["_reducerHandlers"].get("dispose")(callState, {});

        assert.ok(disposePanelSpy.calledOnce, "panel.dispose should be called once");
        (disposePanelSpy as sinon.SinonSpy).restore();
        assert.ok(sendActionEvent.calledOnce, "sendActionEvent should be called once");
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
        const saveProfileStub = sandbox.stub().resolves();
        const createSessionStub = sandbox.stub().resolves();

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
        assert.ok(saveProfileStub.calledOnce, "saveProfile should be called");
        assert.ok(createSessionStub.calledOnce, "createObjectExplorerSession should be called");

        assert.strictEqual(result, true, "Should return true on success");
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
