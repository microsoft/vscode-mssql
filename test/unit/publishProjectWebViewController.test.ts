/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";

import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { PublishProjectWebViewController } from "../../src/publishProject/publishProjectWebViewController";
import {
    validateSqlServerPortNumber,
    isValidSqlAdminPassword,
} from "../../src/publishProject/projectUtils";
import { stubVscodeWrapper } from "./utils";
import { PublishTarget } from "../../src/sharedInterfaces/publishDialog";

suite("PublishProjectWebViewController Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let contextStub: vscode.ExtensionContext;
    let vscodeWrapperStub: sinon.SinonStubbedInstance<VscodeWrapper>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockSqlProjectsService: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockDacFxService: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockConnectionManager: any;

    setup(() => {
        sandbox = sinon.createSandbox();

        const rawContext: Partial<vscode.ExtensionContext> = {
            extensionUri: vscode.Uri.parse("file://ProjectPath"),
            extensionPath: "ProjectPath",
            subscriptions: [],
        };
        contextStub = rawContext as vscode.ExtensionContext;

        vscodeWrapperStub = stubVscodeWrapper(sandbox);
        mockSqlProjectsService = {};
        mockDacFxService = {};
        mockConnectionManager = {
            onConnectionsChanged: sandbox.stub().returns({ dispose: () => {} }),
            activeConnections: {},
            listDatabases: sandbox.stub().resolves([]),
        };
    });

    teardown(() => {
        sandbox.restore();
    });

    /**
     * Helper factory to create PublishProjectWebViewController with default test setup.
     * @param projectPath Optional project path (defaults to standard test path)
     */
    function createTestController(
        projectPath = "c:/work/TestProject.sqlproj",
    ): PublishProjectWebViewController {
        return new PublishProjectWebViewController(
            contextStub,
            vscodeWrapperStub,
            mockConnectionManager,
            projectPath,
            mockSqlProjectsService,
            mockDacFxService,
        );
    }

    test("constructor initializes state and derives database name", async () => {
        const controller = createTestController("c:/work/MySampleProject.sqlproj");

        await controller.initialized.promise;

        // Verify initial state
        expect(controller.state.projectFilePath).to.equal("c:/work/MySampleProject.sqlproj");
        expect(controller.state.formState.databaseName).to.equal("MySampleProject");

        // Form components should be initialized after initialization completes
        const components = controller.state.formComponents;
        expect(components.serverName, "serverName component should exist").to.exist;
        expect(components.databaseName, "databaseName component should exist").to.exist;
        expect(components.publishTarget, "publishTarget component should exist").to.exist;
    });

    test("reducer handlers are registered on construction", async () => {
        const controller = createTestController();

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
        const controller = createTestController();

        await controller.initialized.promise;

        expect(controller.state.formState.publishTarget).to.equal(PublishTarget.ExistingServer);
    });

    test("getActiveFormComponents returns correct fields for EXISTING_SERVER target", async () => {
        const controller = createTestController();

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

    //#region Publish Target Section Tests
    test("getActiveFormComponents returns correct fields for LOCAL_CONTAINER target", async () => {
        const controller = createTestController();

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

    test("state tracks inProgress and lastPublishResult", async () => {
        const controller = createTestController();

        await controller.initialized.promise;

        // Initial state
        expect(controller.state.inProgress).to.be.false;
        expect(controller.state.lastPublishResult).to.be.undefined;

        // Can be updated
        controller.state.inProgress = true;
        expect(controller.state.inProgress).to.be.true;
    });

    test("container target values are properly saved to formState", async () => {
        const controller = createTestController("c:/work/ContainerProject.sqlproj");

        await controller.initialized.promise;

        const reducerHandlers = controller["_reducerHandlers"] as Map<string, Function>;
        const formAction = reducerHandlers.get("formAction");
        expect(formAction, "formAction reducer should be registered").to.exist;

        // Set target to localContainer
        await formAction(controller.state, {
            event: {
                propertyName: "publishTarget",
                value: PublishTarget.LocalContainer,
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
        expect(controller.state.formState.publishTarget).to.equal(PublishTarget.LocalContainer);
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
        mockSqlProjectsService.getProjectProperties = sandbox.stub().resolves({
            success: true,
            projectGuid: "test-guid",
            databaseSchemaProvider:
                "Microsoft.Data.Tools.Schema.Sql.SqlAzureV12DatabaseSchemaProvider",
        });

        const controller = createTestController("c:/work/AzureProject.sqlproj");

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

        mockSqlProjectsService.getProjectProperties = sandbox.stub().resolves({
            success: true,
            projectGuid: "test-guid",
            databaseSchemaProvider:
                "Microsoft.Data.Tools.Schema.Sql.SqlAzureV12DatabaseSchemaProvider",
        });

        const controller = createTestController("c:/work/AzureProject.sqlproj");

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
    //#endregion

    //#region Publish Profile Section Tests
    test("selectPublishProfile reducer parses XML profile and loads server and database correctly", async () => {
        const controller = createTestController();
        await controller.initialized.promise;

        // Real-world ADS-generated publish profile XML with all features
        const adsProfileXml = `<?xml version="1.0" encoding="utf-8"?>
<Project ToolsVersion="Current" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <PropertyGroup>
    <IncludeCompositeObjects>True</IncludeCompositeObjects>
    <TargetDatabaseName>MyDatabase</TargetDatabaseName>
    <DeployScriptFileName>MyDatabase.sql</DeployScriptFileName>
    <TargetConnectionString>Data Source=myserver.database.windows.net;Persist Security Info=False;User ID=admin;Pooling=False;MultipleActiveResultSets=False;</TargetConnectionString>
    <ProfileVersionNumber>1</ProfileVersionNumber>
  </PropertyGroup>
  <ItemGroup>
    <SqlCmdVariable Include="Var1">
      <Value>Value1</Value>
    </SqlCmdVariable>
    <SqlCmdVariable Include="Var2">
      <Value>Value2</Value>
    </SqlCmdVariable>
  </ItemGroup>
</Project>`;

        const profilePath = "c:/profiles/TestProfile.publish.xml";

        // Mock file system read
        const fs = await import("fs");
        sandbox.stub(fs.promises, "readFile").resolves(adsProfileXml);

        // Mock file picker
        sandbox.stub(vscode.window, "showOpenDialog").resolves([vscode.Uri.file(profilePath)]);

        // Mock DacFx service to return deployment options
        mockDacFxService.getOptionsFromProfile = sandbox.stub().resolves({
            success: true,
            deploymentOptions: {
                excludeObjectTypes: { value: ["Users", "Logins"] },
                ignoreTableOptions: { value: true },
            },
        });

        const reducerHandlers = controller["_reducerHandlers"] as Map<string, Function>;
        const selectPublishProfile = reducerHandlers.get("selectPublishProfile");
        expect(selectPublishProfile, "selectPublishProfile reducer should be registered").to.exist;

        // Invoke the reducer
        const newState = await selectPublishProfile(controller.state, {});

        // Verify parsed values are in the returned state (normalize paths for cross-platform)
        expect(newState.formState.publishProfilePath.replace(/\\/g, "/")).to.equal(profilePath);
        expect(newState.formState.databaseName).to.equal("MyDatabase");
        expect(newState.formState.serverName).to.equal("myserver.database.windows.net");
        expect(newState.formState.sqlCmdVariables).to.deep.equal({
            Var1: "Value1",
            Var2: "Value2",
        });

        // Verify deployment options were loaded from DacFx
        expect(mockDacFxService.getOptionsFromProfile.calledOnce).to.be.true;
    });

    test("savePublishProfile reducer saves server and database names to file", async () => {
        const controller = createTestController();

        await controller.initialized.promise;

        // Set up server and database state
        controller.state.formState.serverName = "myserver.database.windows.net";
        controller.state.formState.databaseName = "ProductionDB";
        controller.state.formState.sqlCmdVariables = {
            EnvironmentName: "Production",
        };

        // Stub showSaveDialog to simulate user choosing a save location
        const savedProfilePath = "c:/profiles/ProductionProfile.publish.xml";
        sandbox.stub(vscode.window, "showSaveDialog").resolves(vscode.Uri.file(savedProfilePath));

        // Mock DacFx service
        mockDacFxService.savePublishProfile = sandbox.stub().resolves({ success: true });

        const reducerHandlers = controller["_reducerHandlers"] as Map<string, Function>;
        const savePublishProfile = reducerHandlers.get("savePublishProfile");
        expect(savePublishProfile, "savePublishProfile reducer should be registered").to.exist;

        // Invoke the reducer
        await savePublishProfile(controller.state, {
            publishProfileName: "ProductionProfile.publish.xml",
        });

        // Verify DacFx save was called with correct parameters
        expect(mockDacFxService.savePublishProfile.calledOnce).to.be.true;

        const saveCall = mockDacFxService.savePublishProfile.getCall(0);
        expect(saveCall.args[0].replace(/\\/g, "/")).to.equal(savedProfilePath); // File path (normalize for cross-platform)
        expect(saveCall.args[1]).to.equal("ProductionDB"); // Database name
        // Connection string is args[2]
        const sqlCmdVariables = saveCall.args[3]; // SQL CMD variables
        expect(sqlCmdVariables.get("EnvironmentName")).to.equal("Production");
    });
    //#endregion

    //#region Server and Database Connection Section Tests
    test("server and database fields are initialized with correct default values", async () => {
        const controller = createTestController("c:/work/MyTestProject.sqlproj");

        await controller.initialized.promise;

        // Verify server component and default value
        const serverComponent = controller.state.formComponents.serverName;
        expect(serverComponent).to.exist;
        expect(serverComponent.label).to.exist;
        expect(serverComponent.required).to.be.true;
        expect(controller.state.formState.serverName).to.equal("");

        // Verify database component and default value (project name)
        const databaseComponent = controller.state.formComponents.databaseName;
        expect(databaseComponent).to.exist;
        expect(databaseComponent.label).to.exist;
        expect(databaseComponent.required).to.be.true;
        expect(controller.state.formState.databaseName).to.equal("MyTestProject");
    });

    test("formAction updates server and database names via user interaction", async () => {
        const controller = createTestController();

        await controller.initialized.promise;

        const reducerHandlers = controller["_reducerHandlers"] as Map<string, Function>;
        const formAction = reducerHandlers.get("formAction");
        expect(formAction, "formAction reducer should be registered").to.exist;

        // Simulate connection dialog setting server name
        await formAction(controller.state, {
            event: {
                propertyName: "serverName",
                value: "localhost,1433",
                isAction: false,
            },
        });

        // Verify server name is updated
        expect(controller.state.formState.serverName).to.equal("localhost,1433");

        // Simulate user selecting a database from dropdown
        await formAction(controller.state, {
            event: {
                propertyName: "databaseName",
                value: "SelectedDatabase",
                isAction: false,
            },
        });

        // Verify database name is updated
        expect(controller.state.formState.databaseName).to.equal("SelectedDatabase");
    });
    //#endregion
});
