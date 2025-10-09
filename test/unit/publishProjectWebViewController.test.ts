/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";
import * as constants from "../../src/constants/constants";

import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { PublishProjectWebViewController } from "../../src/publishProject/publishProjectWebViewController";
import {
    validateSqlServerPortNumber,
    isValidSqlAdminPassword,
} from "../../src/publishProject/projectUtils";
import { stubVscodeWrapper } from "./utils";

suite("PublishProjectWebViewController Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let contextStub: vscode.ExtensionContext;
    let vscodeWrapperStub: sinon.SinonStubbedInstance<VscodeWrapper>;

    setup(() => {
        sandbox = sinon.createSandbox();

        const rawContext: Partial<vscode.ExtensionContext> = {
            extensionUri: vscode.Uri.parse("file://ProjectPath"),
            extensionPath: "ProjectPath",
            subscriptions: [],
        };
        contextStub = rawContext as vscode.ExtensionContext;

        vscodeWrapperStub = stubVscodeWrapper(sandbox);
    });

    teardown(() => {
        sandbox.restore();
    });

    test("constructor initializes state and derives database name", () => {
        const projectPath = "c:/work/MySampleProject.sqlproj";
        const controller = new PublishProjectWebViewController(
            contextStub,
            vscodeWrapperStub,
            projectPath,
        );

        // Verify initial state
        expect(controller.state.projectFilePath).to.equal(projectPath);
        expect(controller.state.formState.databaseName).to.equal("MySampleProject");

        // Form components should be initialized synchronously
        const components = controller.state.formComponents;
        // Basic fields expected from generatePublishFormComponents()
        expect(components.publishProfilePath, "publishProfilePath component should exist").to.exist;
        expect(components.serverName, "serverName component should exist").to.exist;
        expect(components.databaseName, "databaseName component should exist").to.exist;
        expect(components.publishTarget, "publishTarget component should exist").to.exist;
    });

    test("reducer handlers are registered on construction", async () => {
        const projectPath = "c:/work/TestProject.sqlproj";
        const controller = new PublishProjectWebViewController(
            contextStub,
            vscodeWrapperStub,
            projectPath,
        );

        await controller.initialized.promise;

        // Access internal reducer handlers map
        const reducerHandlers = controller["_reducerHandlers"] as Map<string, Function>;

        // Verify all expected reducers are registered
        expect(reducerHandlers.has("publishNow"), "publishNow reducer should be registered").to.be
            .true;
        expect(
            reducerHandlers.has("generatePublishScript"),
            "generatePublishScript reducer should be registered",
        ).to.be.true;
        expect(
            reducerHandlers.has("selectPublishProfile"),
            "selectPublishProfile reducer should be registered",
        ).to.be.true;
        expect(
            reducerHandlers.has("savePublishProfile"),
            "savePublishProfile reducer should be registered",
        ).to.be.true;
    });

    test("default publish target is EXISTING_SERVER", async () => {
        const projectPath = "c:/work/TestProject.sqlproj";
        const controller = new PublishProjectWebViewController(
            contextStub,
            vscodeWrapperStub,
            projectPath,
        );

        await controller.initialized.promise;

        expect(controller.state.formState.publishTarget).to.equal(
            constants.PublishTargets.EXISTING_SERVER,
        );
    });

    test("getActiveFormComponents returns correct fields for EXISTING_SERVER target", async () => {
        const projectPath = "c:/work/TestProject.sqlproj";
        const controller = new PublishProjectWebViewController(
            contextStub,
            vscodeWrapperStub,
            projectPath,
        );

        await controller.initialized.promise;

        // Set publish target to EXISTING_SERVER (default)
        controller.state.formState.publishTarget = constants.PublishTargets.EXISTING_SERVER;

        const activeComponents = controller["getActiveFormComponents"](controller.state);

        // Should include basic fields but NOT container fields
        expect(activeComponents).to.include("publishTarget");
        expect(activeComponents).to.include("publishProfilePath");
        expect(activeComponents).to.include("serverName");
        expect(activeComponents).to.include("databaseName");

        // Should NOT include container fields
        expect(activeComponents).to.not.include("containerPort");
        expect(activeComponents).to.not.include("containerAdminPassword");
    });

    test("getActiveFormComponents returns correct fields for LOCAL_CONTAINER target", async () => {
        const projectPath = "c:/work/TestProject.sqlproj";
        const controller = new PublishProjectWebViewController(
            contextStub,
            vscodeWrapperStub,
            projectPath,
        );

        await controller.initialized.promise;

        // Set publish target to LOCAL_CONTAINER
        controller.state.formState.publishTarget = constants.PublishTargets.LOCAL_CONTAINER;

        const activeComponents = controller["getActiveFormComponents"](controller.state);

        // Should include basic fields AND container fields
        expect(activeComponents).to.include("publishTarget");
        expect(activeComponents).to.include("publishProfilePath");
        expect(activeComponents).to.include("databaseName");

        // Should include container fields
        expect(activeComponents).to.include("containerPort");
        expect(activeComponents).to.include("containerAdminPassword");
        expect(activeComponents).to.include("containerAdminPasswordConfirm");
        expect(activeComponents).to.include("containerImageTag");
        expect(activeComponents).to.include("acceptContainerLicense");
    });

    test("state tracks inProgress and lastPublishResult", async () => {
        const projectPath = "c:/work/TestProject.sqlproj";
        const controller = new PublishProjectWebViewController(
            contextStub,
            vscodeWrapperStub,
            projectPath,
        );

        await controller.initialized.promise;

        // Initial state
        expect(controller.state.inProgress).to.be.false;
        expect(controller.state.lastPublishResult).to.be.undefined;

        // Can be updated
        controller.state.inProgress = true;
        expect(controller.state.inProgress).to.be.true;
    });

    test("container target values are properly saved to formState", async () => {
        const projectPath = "c:/work/ContainerProject.sqlproj";
        const controller = new PublishProjectWebViewController(
            contextStub,
            vscodeWrapperStub,
            projectPath,
        );

        await controller.initialized.promise;

        const reducerHandlers = controller["_reducerHandlers"] as Map<string, Function>;
        const formAction = reducerHandlers.get("formAction");
        expect(formAction, "formAction reducer should be registered").to.exist;

        // Set target to localContainer
        await formAction(controller.state, {
            event: {
                propertyName: "publishTarget",
                value: constants.PublishTargets.LOCAL_CONTAINER,
                isAction: false,
            },
        });

        // Set container-specific values
        await formAction(controller.state, {
            event: { propertyName: "containerPort", value: "1434", isAction: false },
        });
        await formAction(controller.state, {
            event: {
                propertyName: "containerAdminPassword",
                value: "TestPassword123!",
                isAction: false,
            },
        });
        await formAction(controller.state, {
            event: {
                propertyName: "containerAdminPasswordConfirm",
                value: "TestPassword123!",
                isAction: false,
            },
        });
        await formAction(controller.state, {
            event: { propertyName: "containerImageTag", value: "2022-latest", isAction: false },
        });
        await formAction(controller.state, {
            event: { propertyName: "acceptContainerLicense", value: true, isAction: false },
        });

        // Verify all values are saved
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

        // Verify container fields are visible
        expect(controller.state.formComponents.containerPort?.hidden).to.not.be.true;
        expect(controller.state.formComponents.containerAdminPassword?.hidden).to.not.be.true;
    });

    test("Azure SQL project shows Azure-specific labels", async () => {
        const mockSqlProjectsService = {
            getProjectProperties: sandbox.stub().resolves({
                success: true,
                projectGuid: "test-guid",
                databaseSchemaProvider:
                    "Microsoft.Data.Tools.Schema.Sql.SqlAzureV12DatabaseSchemaProvider",
            }),
        };

        const controller = new PublishProjectWebViewController(
            contextStub,
            vscodeWrapperStub,
            "c:/work/AzureProject.sqlproj",
            mockSqlProjectsService as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        );

        await controller.initialized.promise;

        const publishTargetComponent = controller.state.formComponents.publishTarget;
        const existingServerOption = publishTargetComponent.options?.find(
            (opt) => opt.value === constants.PublishTargets.EXISTING_SERVER,
        );
        const containerOption = publishTargetComponent.options?.find(
            (opt) => opt.value === constants.PublishTargets.LOCAL_CONTAINER,
        );

        expect(existingServerOption?.displayName).to.equal("Existing Azure SQL logical server");
        expect(containerOption?.displayName).to.equal("New SQL Server local development container");
    });

    test("NEW_AZURE_SERVER option appears with preview features enabled for Azure SQL", async () => {
        // Enable preview features
        const configStub = sandbox.stub(vscode.workspace, "getConfiguration");
        configStub.withArgs("sqlDatabaseProjects").returns({
            get: sandbox.stub().withArgs("enablePreviewFeatures").returns(true),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        const mockSqlProjectsService = {
            getProjectProperties: sandbox.stub().resolves({
                success: true,
                projectGuid: "test-guid",
                databaseSchemaProvider:
                    "Microsoft.Data.Tools.Schema.Sql.SqlAzureV12DatabaseSchemaProvider",
            }),
        };

        const controller = new PublishProjectWebViewController(
            contextStub,
            vscodeWrapperStub,
            "c:/work/AzureProject.sqlproj",
            mockSqlProjectsService as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        );

        await controller.initialized.promise;

        const publishTargetComponent = controller.state.formComponents.publishTarget;
        expect(publishTargetComponent.options?.length).to.equal(3);

        const azureOption = publishTargetComponent.options?.find(
            (opt) => opt.value === constants.PublishTargets.NEW_AZURE_SERVER,
        );
        expect(azureOption).to.exist;
        expect(azureOption?.displayName).to.equal("New Azure SQL logical server (Preview)");
    });

    test("field validators enforce container and server requirements", () => {
        // Port validation
        expect(validateSqlServerPortNumber("1433")).to.be.true;
        expect(validateSqlServerPortNumber(1433)).to.be.true;
        expect(validateSqlServerPortNumber(""), "empty string invalid").to.be.false;
        expect(validateSqlServerPortNumber("0"), "port 0 invalid").to.be.false;
        expect(validateSqlServerPortNumber("70000"), "out-of-range port invalid").to.be.false;
        expect(validateSqlServerPortNumber("abc"), "non-numeric invalid").to.be.false;

        // Password complexity validation (8-128 chars, 3 of 4: upper, lower, digit, symbol)
        expect(isValidSqlAdminPassword("Password123!"), "complex password valid").to.be.true;
        expect(isValidSqlAdminPassword("Passw0rd"), "3 categories valid").to.be.true;
        expect(isValidSqlAdminPassword("password"), "simple lowercase invalid").to.be.false;
        expect(isValidSqlAdminPassword("PASSWORD"), "simple uppercase invalid").to.be.false;
        expect(isValidSqlAdminPassword("Pass1"), "too short invalid").to.be.false;
        expect(isValidSqlAdminPassword("Password123!".repeat(20)), "too long invalid").to.be.false;
    });

    test("selectPublishProfile reducer is invoked and triggers file picker", async () => {
        const projectPath = "c:/work/TestProject.sqlproj";
        const controller = new PublishProjectWebViewController(
            contextStub,
            vscodeWrapperStub,
            projectPath,
        );

        await controller.initialized.promise;

        // Stub showOpenDialog to simulate user selecting a profile
        const selectedProfilePath = "c:/profiles/MyProfile.publish.xml";
        const showOpenDialogStub = sandbox
            .stub(vscode.window, "showOpenDialog")
            .resolves([vscode.Uri.file(selectedProfilePath)]);

        const reducerHandlers = controller["_reducerHandlers"] as Map<string, Function>;
        const selectPublishProfile = reducerHandlers.get("selectPublishProfile");
        expect(selectPublishProfile, "selectPublishProfile reducer should be registered").to.exist;

        // Invoke the reducer
        await selectPublishProfile(controller.state, {});

        // Verify file picker was shown
        expect(showOpenDialogStub.calledOnce, "showOpenDialog should be called once").to.be.true;

        // Verify the profile path was updated in formState
        expect(controller.state.formState.publishProfilePath).to.equal(selectedProfilePath);
    });

    test("savePublishProfile reducer is invoked and triggers save file dialog", async () => {
        const projectPath = "c:/work/TestProject.sqlproj";
        const controller = new PublishProjectWebViewController(
            contextStub,
            vscodeWrapperStub,
            projectPath,
        );

        await controller.initialized.promise;

        // Set up some form state to save
        controller.state.formState.serverName = "localhost";
        controller.state.formState.databaseName = "TestDB";

        // Stub showSaveDialog to simulate user choosing a save location
        const savedProfilePath = "c:/profiles/NewProfile.publish.xml";
        const showSaveDialogStub = sandbox
            .stub(vscode.window, "showSaveDialog")
            .resolves(vscode.Uri.file(savedProfilePath));

        const reducerHandlers = controller["_reducerHandlers"] as Map<string, Function>;
        const savePublishProfile = reducerHandlers.get("savePublishProfile");
        expect(savePublishProfile, "savePublishProfile reducer should be registered").to.exist;

        // Invoke the reducer with an optional default filename
        await savePublishProfile(controller.state, { event: "TestProject.publish.xml" });

        // Verify save dialog was shown
        expect(showSaveDialogStub.calledOnce, "showSaveDialog should be called once").to.be.true;

        // Verify the saved profile path was updated in formState
        expect(controller.state.formState.publishProfilePath).to.equal(savedProfilePath);
    });
});
