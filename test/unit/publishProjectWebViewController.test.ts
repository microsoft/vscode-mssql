/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";

import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { PublishProjectWebViewController } from "../../src/publishProject/publishProjectWebViewController";
import { validateSqlServerPortNumber } from "../../src/publishProject/projectUtils";
import { validateSqlServerPassword } from "../../src/deployment/dockerUtils";
import { stubVscodeWrapper } from "./utils";
import { PublishTarget } from "../../src/sharedInterfaces/publishDialog";
import { SqlProjectsService } from "../../src/services/sqlProjectsService";

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

        expect(controller.state.formState.publishTarget).to.equal(PublishTarget.ExistingServer);
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
        controller.state.formState.publishTarget = PublishTarget.ExistingServer;

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
        controller.state.formState.publishTarget = PublishTarget.LocalContainer;

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

    test("formAction reducer saves values to formState and updates visibility", async () => {
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

        // Test setting a value updates formState
        await formAction(controller.state, {
            event: {
                propertyName: "publishTarget",
                value: PublishTarget.LocalContainer,
                isAction: false,
            },
        });

        expect(controller.state.formState.publishTarget).to.equal(PublishTarget.LocalContainer);

        // Test that changing publish target updates field visibility
        expect(controller.state.formComponents.containerPort?.hidden).to.not.be.true;
        expect(controller.state.formComponents.serverName?.hidden).to.be.true;
    });

    test("Azure SQL project shows Azure-specific labels", async () => {
        const mockSqlProjectsService: Partial<SqlProjectsService> = {
            getProjectProperties: sinon.stub().resolves({
                success: true,
                databaseSchemaProvider:
                    "Microsoft.Data.Tools.Schema.Sql.SqlAzureV12DatabaseSchemaProvider",
            }),
        };

        const controller = new PublishProjectWebViewController(
            contextStub,
            vscodeWrapperStub,
            "test.sqlproj",
            mockSqlProjectsService as SqlProjectsService,
        );

        await controller.initialized.promise;

        const publishTargetComponent = controller.state.formComponents.publishTarget;
        const existingServerOption = publishTargetComponent.options?.find(
            (opt) => opt.value === PublishTarget.ExistingServer,
        );
        const containerOption = publishTargetComponent.options?.find(
            (opt) => opt.value === PublishTarget.LocalContainer,
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

        const mockSqlProjectsService: Partial<SqlProjectsService> = {
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
            mockSqlProjectsService as SqlProjectsService,
        );

        await controller.initialized.promise;

        const publishTargetComponent = controller.state.formComponents.publishTarget;
        expect(publishTargetComponent.options?.length).to.equal(3);

        const azureOption = publishTargetComponent.options?.find(
            (opt) => opt.value === PublishTarget.NewAzureServer,
        );
        expect(azureOption).to.exist;
        expect(azureOption?.displayName).to.equal("New Azure SQL logical server (Preview)");
    });

    test("field validators enforce container and server requirements", () => {
        // Port validation
        expect(validateSqlServerPortNumber(1433)).to.be.true;
        expect(validateSqlServerPortNumber(80)).to.be.true;
        expect(validateSqlServerPortNumber(0), "port 0 invalid").to.be.false;
        expect(validateSqlServerPortNumber(70000), "out-of-range port invalid").to.be.false;
        expect(validateSqlServerPortNumber(1.5), "decimal port invalid").to.be.false;
        expect(validateSqlServerPortNumber(-1), "negative port invalid").to.be.false;

        // Password complexity validation (8-128 chars, 3 of 4: upper, lower, digit, special char)
        // validateSqlServerPassword returns empty string for valid, error message for invalid
        expect(validateSqlServerPassword("Abc123!@#"), "complex password valid").to.equal("");
        expect(validateSqlServerPassword("MyTest99"), "3 categories valid").to.equal("");
        expect(validateSqlServerPassword("alllower"), "simple lowercase invalid").to.not.equal("");
        expect(validateSqlServerPassword("ALLUPPER"), "simple uppercase invalid").to.not.equal("");
        expect(validateSqlServerPassword("Short1"), "too short invalid").to.not.equal("");
        expect(validateSqlServerPassword("Abc123!@#".repeat(20)), "too long invalid").to.not.equal(
            "",
        );
    });
});
