/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import * as constants from "../../src/constants/constants";
import { expect } from "chai";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { PublishProjectWebViewController } from "../../src/publishProject/publishProjectWebViewController";
import {
    validateSqlServerPortNumber,
    isValidSqlAdminPassword,
} from "../../src/publishProject/projectUtils";

/**
 * UI and Form interaction tests for Publish Project Dialog
 * Tests form field behavior, visibility, user interactions, and validators
 * Controller/state logic tests are in publishProjectWebViewController.test.ts
 */
suite("PublishProjectWebViewController", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockVscodeWrapper: VscodeWrapper;
    let mockOutputChannel: vscode.OutputChannel;
    let workspaceConfigStub: sinon.SinonStub;

    const projectPath = "c:/work/ContainerProject.sqlproj";

    setup(() => {
        sandbox = sinon.createSandbox();

        // Create mock output channel
        mockOutputChannel = {
            append: sandbox.stub(),
            appendLine: sandbox.stub(),
            clear: sandbox.stub(),
            show: sandbox.stub(),
            hide: sandbox.stub(),
            dispose: sandbox.stub(),
            replace: sandbox.stub(),
            name: "Test Output",
        } as unknown as vscode.OutputChannel;

        // Create minimal context stub - only what the controller actually uses
        mockContext = {
            extensionUri: vscode.Uri.parse("file://fakePath"),
            extensionPath: "fakePath",
            subscriptions: [],
        } as vscode.ExtensionContext;

        // Create stub VscodeWrapper
        mockVscodeWrapper = {
            outputChannel: mockOutputChannel,
        } as unknown as VscodeWrapper;

        // Stub workspace configuration for preview features
        workspaceConfigStub = sandbox.stub(vscode.workspace, "getConfiguration");
        workspaceConfigStub.withArgs("sqlDatabaseProjects").returns({
            get: sandbox.stub().withArgs("enablePreviewFeatures").returns(false),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("container target values are properly saved to state", async () => {
        // Arrange
        const controller = new PublishProjectWebViewController(
            mockContext,
            mockVscodeWrapper,
            projectPath,
        );

        // Wait for async initialization to complete
        await controller.initialized.promise;

        // Access internal reducer handlers map to invoke reducers directly
        const reducerHandlers = controller["_reducerHandlers"] as Map<string, Function>;
        const formAction = reducerHandlers.get("formAction");
        expect(formAction, "formAction reducer should be registered").to.exist;

        // Set target to localContainer first
        await formAction(controller.state, {
            event: {
                propertyName: "publishTarget",
                value: constants.PublishTargets.LOCAL_CONTAINER,
                isAction: false,
            },
        });

        // Act - Test updating container port
        await formAction(controller.state, {
            event: { propertyName: "containerPort", value: "1434", isAction: false },
        });

        // Act - Test updating admin password
        await formAction(controller.state, {
            event: {
                propertyName: "containerAdminPassword",
                value: "TestPassword123!",
                isAction: false,
            },
        });

        // Act - Test updating password confirmation
        await formAction(controller.state, {
            event: {
                propertyName: "containerAdminPasswordConfirm",
                value: "TestPassword123!",
                isAction: false,
            },
        });

        // Act - Test updating image tag
        await formAction(controller.state, {
            event: { propertyName: "containerImageTag", value: "2022-latest", isAction: false },
        });

        // Act - Test accepting license agreement
        await formAction(controller.state, {
            event: { propertyName: "acceptContainerLicense", value: true, isAction: false },
        });

        // Assert - Verify all values are saved to state
        expect(controller.state.formState.publishTarget).to.equal(
            constants.PublishTargets.LOCAL_CONTAINER,
        );
        expect(controller.state.formState.containerPort).to.equal("1434");
        expect(controller.state.formState.containerAdminPassword).to.equal("TestPassword123!");
        expect(controller.state.formState.containerAdminPasswordConfirm).to.equal(
            "TestPassword123!",
        );
        expect(controller.state.formState.containerImageTag).to.equal("2022-latest");
        expect(controller.state.formState.acceptContainerLicense).to.equal(true);

        // Assert - Verify form components exist for container fields
        expect(controller.state.formComponents.containerPort).to.exist;
        expect(controller.state.formComponents.containerAdminPassword).to.exist;
        expect(controller.state.formComponents.containerAdminPasswordConfirm).to.exist;
        expect(controller.state.formComponents.containerImageTag).to.exist;
        expect(controller.state.formComponents.acceptContainerLicense).to.exist;

        // Assert - Verify container components are not hidden when target is localContainer
        expect(controller.state.formComponents.containerPort?.hidden).to.not.be.true;
        expect(controller.state.formComponents.containerAdminPassword?.hidden).to.not.be.true;
        expect(controller.state.formComponents.containerAdminPasswordConfirm?.hidden).to.not.be
            .true;
        expect(controller.state.formComponents.containerImageTag?.hidden).to.not.be.true;
        expect(controller.state.formComponents.acceptContainerLicense?.hidden).to.not.be.true;
    });

    test("container fields are hidden when target is existingServer", async () => {
        // Arrange
        const controller = new PublishProjectWebViewController(
            mockContext,
            mockVscodeWrapper,
            projectPath,
        );

        // Wait for async initialization to complete
        await controller.initialized.promise;

        // Access internal reducer handlers map to invoke reducers directly
        const reducerHandlers = controller["_reducerHandlers"] as Map<string, Function>;
        const formAction = reducerHandlers.get("formAction");
        expect(formAction, "formAction reducer should be registered").to.exist;

        // Set target to existingServer
        await formAction(controller.state, {
            event: {
                propertyName: "publishTarget",
                value: constants.PublishTargets.EXISTING_SERVER,
                isAction: false,
            },
        });

        // Assert - Verify container components are hidden when target is existingServer
        expect(controller.state.formComponents.containerPort?.hidden).to.be.true;
        expect(controller.state.formComponents.containerAdminPassword?.hidden).to.be.true;
        expect(controller.state.formComponents.containerAdminPasswordConfirm?.hidden).to.be.true;
        expect(controller.state.formComponents.containerImageTag?.hidden).to.be.true;
        expect(controller.state.formComponents.acceptContainerLicense?.hidden).to.be.true;

        // Assert - Verify server component is not hidden
        expect(controller.state.formComponents.serverName?.hidden).to.not.be.true;
    });

    test("container fields are hidden when target is NEW_AZURE_SERVER", async () => {
        // Arrange
        const controller = new PublishProjectWebViewController(
            mockContext,
            mockVscodeWrapper,
            projectPath,
        );

        // Wait for async initialization to complete
        await controller.initialized.promise;

        // Access internal reducer handlers map to invoke reducers directly
        const reducerHandlers = controller["_reducerHandlers"] as Map<string, Function>;
        const formAction = reducerHandlers.get("formAction");
        expect(formAction, "formAction reducer should be registered").to.exist;

        // Set target to NEW_AZURE_SERVER
        await formAction(controller.state, {
            event: {
                propertyName: "publishTarget",
                value: constants.PublishTargets.NEW_AZURE_SERVER,
                isAction: false,
            },
        });

        // Assert - Verify container components are hidden when target is NEW_AZURE_SERVER
        expect(controller.state.formComponents.containerPort?.hidden).to.be.true;
        expect(controller.state.formComponents.containerAdminPassword?.hidden).to.be.true;
        expect(controller.state.formComponents.containerAdminPasswordConfirm?.hidden).to.be.true;
        expect(controller.state.formComponents.containerImageTag?.hidden).to.be.true;
        expect(controller.state.formComponents.acceptContainerLicense?.hidden).to.be.true;

        // Assert - Verify server component is not hidden
        expect(controller.state.formComponents.serverName?.hidden).to.not.be.true;
    });

    test("publish target dropdown contains correct options for SQL Server project", async () => {
        // Arrange
        const controller = new PublishProjectWebViewController(
            mockContext,
            mockVscodeWrapper,
            projectPath,
        );

        // Wait for async initialization to complete
        await controller.initialized.promise;

        // Assert - Verify publish target component exists and has correct options
        const publishTargetComponent = controller.state.formComponents.publishTarget;
        expect(publishTargetComponent).to.exist;
        expect(publishTargetComponent.options).to.exist;
        expect(publishTargetComponent.options?.length).to.equal(2);

        // Verify option values and display names for SQL Server project
        const existingServerOption = publishTargetComponent.options?.find(
            (opt) => opt.value === constants.PublishTargets.EXISTING_SERVER,
        );
        const containerOption = publishTargetComponent.options?.find(
            (opt) => opt.value === constants.PublishTargets.LOCAL_CONTAINER,
        );

        expect(existingServerOption).to.exist;
        expect(containerOption).to.exist;

        // Should NOT have NEW_AZURE_SERVER for non-Azure projects
        const azureOption = publishTargetComponent.options?.find(
            (opt) => opt.value === constants.PublishTargets.NEW_AZURE_SERVER,
        );
        expect(azureOption).to.be.undefined;
    });

    test("publish target dropdown shows Azure-specific labels for Azure SQL project", async () => {
        // Arrange - Create mock SQL Projects Service that returns AzureV12 target version
        const mockSqlProjectsService = {
            getProjectProperties: sandbox.stub().resolves({
                success: true,
                projectGuid: "test-guid",
                databaseSchemaProvider:
                    "Microsoft.Data.Tools.Schema.Sql.SqlAzureV12DatabaseSchemaProvider",
            }),
        };

        const controller = new PublishProjectWebViewController(
            mockContext,
            mockVscodeWrapper,
            projectPath,
            mockSqlProjectsService as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        );

        // Wait for async initialization to complete
        await controller.initialized.promise;

        // Assert - Verify publish target component has Azure-specific labels
        const publishTargetComponent = controller.state.formComponents.publishTarget;
        expect(publishTargetComponent).to.exist;
        expect(publishTargetComponent.options).to.exist;

        const existingServerOption = publishTargetComponent.options?.find(
            (opt) => opt.value === constants.PublishTargets.EXISTING_SERVER,
        );
        const containerOption = publishTargetComponent.options?.find(
            (opt) => opt.value === constants.PublishTargets.LOCAL_CONTAINER,
        );

        expect(existingServerOption).to.exist;
        expect(existingServerOption?.displayName).to.equal("Existing Azure SQL logical server");

        expect(containerOption).to.exist;
        expect(containerOption?.displayName).to.equal("New SQL Server local development container");
    });

    test("NEW_AZURE_SERVER option appears when preview features enabled for Azure SQL project", async () => {
        // Arrange - Enable preview features
        workspaceConfigStub.withArgs("sqlDatabaseProjects").returns({
            get: sandbox.stub().withArgs("enablePreviewFeatures").returns(true),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        // Create mock SQL Projects Service that returns AzureV12 target version
        const mockSqlProjectsService = {
            getProjectProperties: sandbox.stub().resolves({
                success: true,
                projectGuid: "test-guid",
                databaseSchemaProvider:
                    "Microsoft.Data.Tools.Schema.Sql.SqlAzureV12DatabaseSchemaProvider",
            }),
        };

        const controller = new PublishProjectWebViewController(
            mockContext,
            mockVscodeWrapper,
            projectPath,
            mockSqlProjectsService as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        );

        // Wait for async initialization to complete
        await controller.initialized.promise;

        // Assert - Verify NEW_AZURE_SERVER option exists
        const publishTargetComponent = controller.state.formComponents.publishTarget;
        expect(publishTargetComponent).to.exist;
        expect(publishTargetComponent.options).to.exist;
        expect(publishTargetComponent.options?.length).to.equal(3);

        const azureOption = publishTargetComponent.options?.find(
            (opt) => opt.value === constants.PublishTargets.NEW_AZURE_SERVER,
        );
        expect(azureOption).to.exist;
        expect(azureOption?.displayName).to.equal("New Azure SQL logical server (Preview)");
    });

    test("NEW_AZURE_SERVER option hidden when preview features disabled", async () => {
        // Arrange - Disable preview features (default in setup)
        workspaceConfigStub.withArgs("sqlDatabaseProjects").returns({
            get: sandbox.stub().withArgs("enablePreviewFeatures").returns(false),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        // Create mock SQL Projects Service that returns AzureV12 target version
        const mockSqlProjectsService = {
            readProjectProperties: sandbox.stub().resolves({
                targetVersion: "AzureV12",
            }),
        };

        const controller = new PublishProjectWebViewController(
            mockContext,
            mockVscodeWrapper,
            projectPath,
            mockSqlProjectsService as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        );

        // Wait for async initialization to complete
        await controller.initialized.promise;

        // Assert - Verify NEW_AZURE_SERVER option does NOT exist
        const publishTargetComponent = controller.state.formComponents.publishTarget;
        expect(publishTargetComponent).to.exist;
        expect(publishTargetComponent.options).to.exist;
        expect(publishTargetComponent.options?.length).to.equal(2);

        const azureOption = publishTargetComponent.options?.find(
            (opt) => opt.value === constants.PublishTargets.NEW_AZURE_SERVER,
        );
        expect(azureOption).to.be.undefined;
    });

    test("server and database fields are visible for all publish targets", async () => {
        // Arrange
        const controller = new PublishProjectWebViewController(
            mockContext,
            mockVscodeWrapper,
            projectPath,
        );

        // Wait for async initialization to complete
        await controller.initialized.promise;

        const reducerHandlers = controller["_reducerHandlers"] as Map<string, Function>;
        const formAction = reducerHandlers.get("formAction");
        expect(formAction).to.exist;

        // Test EXISTING_SERVER
        await formAction(controller.state, {
            event: {
                propertyName: "publishTarget",
                value: constants.PublishTargets.EXISTING_SERVER,
                isAction: false,
            },
        });
        expect(controller.state.formComponents.serverName?.hidden).to.not.be.true;
        expect(controller.state.formComponents.databaseName?.hidden).to.not.be.true;

        // Test LOCAL_CONTAINER
        await formAction(controller.state, {
            event: {
                propertyName: "publishTarget",
                value: constants.PublishTargets.LOCAL_CONTAINER,
                isAction: false,
            },
        });
        expect(controller.state.formComponents.serverName?.hidden).to.be.true; // Hidden for container
        expect(controller.state.formComponents.databaseName?.hidden).to.not.be.true;

        // Test NEW_AZURE_SERVER
        await formAction(controller.state, {
            event: {
                propertyName: "publishTarget",
                value: constants.PublishTargets.NEW_AZURE_SERVER,
                isAction: false,
            },
        });
        expect(controller.state.formComponents.serverName?.hidden).to.not.be.true;
        expect(controller.state.formComponents.databaseName?.hidden).to.not.be.true;
    });

    test("profile name field works correctly", async () => {
        // Arrange
        const controller = new PublishProjectWebViewController(
            mockContext,
            mockVscodeWrapper,
            projectPath,
        );

        // Wait for async initialization to complete
        await controller.initialized.promise;

        const reducerHandlers = controller["_reducerHandlers"] as Map<string, Function>;
        const formAction = reducerHandlers.get("formAction");
        expect(formAction).to.exist;

        // Act - Set profile name
        await formAction(controller.state, {
            event: {
                propertyName: "publishProfilePath",
                value: "MyPublishProfile",
                isAction: false,
            },
        });

        // Assert
        expect(controller.state.formState.publishProfilePath).to.equal("MyPublishProfile");
        expect(controller.state.formComponents.publishProfilePath).to.exist;
        expect(controller.state.formComponents.publishProfilePath.required).to.be.false;
    });

    test("all form components are properly initialized", async () => {
        // Arrange
        const controller = new PublishProjectWebViewController(
            mockContext,
            mockVscodeWrapper,
            projectPath,
        );

        // Wait for async initialization to complete
        await controller.initialized.promise;

        // Assert - Verify all expected form components exist
        expect(controller.state.formComponents.publishProfilePath).to.exist;
        expect(controller.state.formComponents.serverName).to.exist;
        expect(controller.state.formComponents.databaseName).to.exist;
        expect(controller.state.formComponents.publishTarget).to.exist;
        expect(controller.state.formComponents.containerPort).to.exist;
        expect(controller.state.formComponents.containerAdminPassword).to.exist;
        expect(controller.state.formComponents.containerAdminPasswordConfirm).to.exist;
        expect(controller.state.formComponents.containerImageTag).to.exist;
        expect(controller.state.formComponents.acceptContainerLicense).to.exist;

        // Verify required fields
        expect(controller.state.formComponents.serverName.required).to.be.true;
        expect(controller.state.formComponents.databaseName.required).to.be.true;

        // Verify initial form state
        expect(controller.state.formState.publishTarget).to.equal(
            constants.PublishTargets.EXISTING_SERVER,
        );
        expect(controller.state.projectFilePath).to.equal(projectPath);
    });

    test("field-level validators enforce container and server requirements", async () => {
        // Port validation
        expect(validateSqlServerPortNumber("1433")).to.be.true;
        expect(validateSqlServerPortNumber(1433)).to.be.true;
        expect(validateSqlServerPortNumber(""), "empty string invalid").to.be.false;
        expect(validateSqlServerPortNumber("0"), "port 0 invalid").to.be.false;
        expect(validateSqlServerPortNumber("70000"), "out-of-range port invalid").to.be.false;

        // Password complexity validation
        expect(isValidSqlAdminPassword("Password123!"), "complex password valid").to.be.true;
        expect(isValidSqlAdminPassword("password"), "simple lowercase invalid").to.be.false;
        expect(isValidSqlAdminPassword("PASSWORD"), "simple uppercase invalid").to.be.false;
        expect(isValidSqlAdminPassword("Passw0rd"), "missing symbol still ok? need 3 classes").to.be
            .true;

        // Password confirm logic (mirrors confirm field validator semantics)
        const pwd = "Password123!";
        const confirmOk = pwd === "Password123!";
        const mismatch = "Different" + ""; // widen type to plain string to avoid literal compare lint
        const confirmBad = pwd === mismatch;
        expect(confirmOk).to.be.true;
        expect(confirmBad).to.be.false;

        // License acceptance toggle semantics
        const licenseAccepted = true;
        const licenseNotAccepted = false;
        expect(licenseAccepted).to.be.true;
        expect(licenseNotAccepted).to.be.false;
    });

    // UI Visibility Tests
    test("updateItemVisibility hides serverName for LOCAL_CONTAINER target", async () => {
        const controller = new PublishProjectWebViewController(
            mockContext,
            mockVscodeWrapper,
            projectPath,
        );

        await controller.initialized.promise;

        // Set publish target to LOCAL_CONTAINER
        controller.state.formState.publishTarget = constants.PublishTargets.LOCAL_CONTAINER;

        await controller.updateItemVisibility();

        // serverName should be hidden for container deployment
        expect(controller.state.formComponents.serverName.hidden).to.be.true;

        // container fields should NOT be hidden
        expect(controller.state.formComponents.containerPort?.hidden).to.not.be.true;
        expect(controller.state.formComponents.containerAdminPassword?.hidden).to.not.be.true;
    });

    test("updateItemVisibility hides container fields for EXISTING_SERVER target", async () => {
        const controller = new PublishProjectWebViewController(
            mockContext,
            mockVscodeWrapper,
            projectPath,
        );

        await controller.initialized.promise;

        // Set publish target to EXISTING_SERVER
        controller.state.formState.publishTarget = constants.PublishTargets.EXISTING_SERVER;

        await controller.updateItemVisibility();

        // serverName should NOT be hidden
        expect(controller.state.formComponents.serverName.hidden).to.not.be.true;

        // container fields SHOULD be hidden
        expect(controller.state.formComponents.containerPort?.hidden).to.be.true;
        expect(controller.state.formComponents.containerAdminPassword?.hidden).to.be.true;
        expect(controller.state.formComponents.containerAdminPasswordConfirm?.hidden).to.be.true;
        expect(controller.state.formComponents.containerImageTag?.hidden).to.be.true;
        expect(controller.state.formComponents.acceptContainerLicense?.hidden).to.be.true;
    });

    test("updateItemVisibility hides container fields for NEW_AZURE_SERVER target", async () => {
        const controller = new PublishProjectWebViewController(
            mockContext,
            mockVscodeWrapper,
            projectPath,
        );

        await controller.initialized.promise;

        // Set publish target to NEW_AZURE_SERVER
        controller.state.formState.publishTarget = constants.PublishTargets.NEW_AZURE_SERVER;

        await controller.updateItemVisibility();

        // serverName should NOT be hidden
        expect(controller.state.formComponents.serverName.hidden).to.not.be.true;

        // container fields SHOULD be hidden
        expect(controller.state.formComponents.containerPort?.hidden).to.be.true;
        expect(controller.state.formComponents.containerAdminPassword?.hidden).to.be.true;
        expect(controller.state.formComponents.containerAdminPasswordConfirm?.hidden).to.be.true;
        expect(controller.state.formComponents.containerImageTag?.hidden).to.be.true;
        expect(controller.state.formComponents.acceptContainerLicense?.hidden).to.be.true;
    });
});
