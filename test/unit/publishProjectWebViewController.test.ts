/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as mssql from "vscode-mssql";
import { expect } from "chai";
import * as sinon from "sinon";

import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import ConnectionManager from "../../src/controllers/connectionManager";
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
    let mockSqlProjectsService: sinon.SinonStubbedInstance<SqlProjectsService>;
    let mockDacFxService: sinon.SinonStubbedInstance<mssql.IDacFxService>;
    let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;

    setup(() => {
        sandbox = sinon.createSandbox();

        const rawContext: Partial<vscode.ExtensionContext> = {
            extensionUri: vscode.Uri.parse("file://ProjectPath"),
            extensionPath: "ProjectPath",
            subscriptions: [],
        };
        contextStub = rawContext as vscode.ExtensionContext;

        vscodeWrapperStub = stubVscodeWrapper(sandbox);

        // Create properly typed stubbed instances
        mockSqlProjectsService = sandbox.createStubInstance(SqlProjectsService);

        // Create ConnectionManager mock manually (createStubInstance doesn't handle event emitters well)
        mockConnectionManager = {
            listDatabases: sandbox.stub().resolves([]),
            getConnectionString: sandbox.stub().resolves(""),
            onSuccessfulConnection: sandbox.stub().returns({
                dispose: sandbox.stub(),
            } as vscode.Disposable),
        } as sinon.SinonStubbedInstance<ConnectionManager>;

        // Create mock for interface (IDacFxService) - only stub methods we actually use in tests
        mockDacFxService = {
            getOptionsFromProfile: sandbox.stub(),
            savePublishProfile: sandbox.stub(),
        } as sinon.SinonStubbedInstance<mssql.IDacFxService>;
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
        expect(
            reducerHandlers.has("updateDeploymentOptions"),
            "updateDeploymentOptions reducer should be registered",
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

    test("formAction reducer saves values to formState and updates visibility", async () => {
        const controller = createTestController("c:/work/ContainerProject.sqlproj");

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
        expect(
            controller.state.formComponents.containerPort?.hidden,
            "containerPort should be visible for LocalContainer target",
        ).to.not.be.true;
        expect(
            controller.state.formComponents.serverName?.hidden,
            "serverName should be hidden for LocalContainer target",
        ).to.be.true;
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
            mockConnectionManager,
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
            mockConnectionManager,
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

    //#region Publish Profile Section Tests
    // Shared test data
    const SAMPLE_PUBLISH_PROFILE_XML = `<?xml version="1.0" encoding="utf-8"?>
<Project ToolsVersion="Current" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <PropertyGroup>
    <IncludeCompositeObjects>True</IncludeCompositeObjects>
    <TargetDatabaseName>MyDatabase</TargetDatabaseName>
    <DeployScriptFileName>MyDatabase.sql</DeployScriptFileName>
    <TargetConnectionString>Data Source=myserver.database.windows.net;Persist Security Info=False;User ID=admin;Pooling=False;MultipleActiveResultSets=False;</TargetConnectionString>
    <AllowIncompatiblePlatform>True</AllowIncompatiblePlatform>
    <IgnoreComments>True</IgnoreComments>
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

    test("selectPublishProfile reducer parses XML profile correctly", async () => {
        const controller = createTestController();
        await controller.initialized.promise;

        const profilePath = "c:/profiles/TestProfile.publish.xml";

        // Mock file system read
        const fs = await import("fs");
        sandbox.stub(fs.promises, "readFile").resolves(SAMPLE_PUBLISH_PROFILE_XML);

        // Mock file picker
        sandbox.stub(vscode.window, "showOpenDialog").resolves([vscode.Uri.file(profilePath)]);

        // Mock DacFx service to return deployment options matching XML
        mockDacFxService.getOptionsFromProfile.resolves({
            success: true,
            errorMessage: "",
            deploymentOptions: {
                excludeObjectTypes: {
                    value: ["Users", "Logins"],
                    description: "",
                    displayName: "",
                },
                booleanOptionsDictionary: {
                    allowIncompatiblePlatform: {
                        value: true,
                        description: "Allow incompatible platform",
                        displayName: "Allow Incompatible Platform",
                    },
                    ignoreComments: {
                        value: true,
                        description: "Ignore comments",
                        displayName: "Ignore Comments",
                    },
                },
                objectTypesDictionary: {},
            },
        });

        const reducerHandlers = controller["_reducerHandlers"] as Map<string, Function>;
        const selectPublishProfile = reducerHandlers.get("selectPublishProfile");
        expect(selectPublishProfile, "selectPublishProfile reducer should be registered").to.exist;

        // Invoke the reducer
        const newState = await selectPublishProfile(controller.state, {});

        // Verify parsed values
        expect(newState.formState.publishProfilePath.replace(/\\/g, "/")).to.equal(profilePath);
        expect(newState.formState.databaseName).to.equal("MyDatabase");
        expect(newState.formState.serverName).to.equal("myserver.database.windows.net");
        expect(newState.formState.sqlCmdVariables).to.deep.equal({
            Var1: "Value1",
            Var2: "Value2",
        });

        // Verify deployment options were loaded from DacFx matching XML properties
        expect(
            mockDacFxService.getOptionsFromProfile.calledOnce,
            "DacFx getOptionsFromProfile should be called once when loading profile",
        ).to.be.true;
        expect(newState.deploymentOptions.excludeObjectTypes.value).to.deep.equal([
            "Users",
            "Logins",
        ]);
        expect(
            newState.deploymentOptions.booleanOptionsDictionary.allowIncompatiblePlatform?.value,
            "allowIncompatiblePlatform should be true from parsed profile",
        ).to.be.true;
        expect(
            newState.deploymentOptions.booleanOptionsDictionary.ignoreComments?.value,
            "ignoreComments should be true from parsed profile",
        ).to.be.true;
    });

    test("savePublishProfile reducer is invoked and triggers save file dialog", async () => {
        const controller = createTestController();

        await controller.initialized.promise;

        // Set up server and database state
        controller.state.formState.serverName = "myserver.database.windows.net";
        controller.state.formState.databaseName = "ProductionDB";
        controller.state.formState.sqlCmdVariables = {
            EnvironmentName: "Production",
        };

        // Set up deployment options state
        controller.state.deploymentOptions = {
            excludeObjectTypes: {
                value: ["Users", "Permissions"],
                description: "Object types to exclude",
                displayName: "Exclude Object Types",
            },
            booleanOptionsDictionary: {
                ignoreTableOptions: {
                    value: true,
                    description: "Ignore table options",
                    displayName: "Ignore Table Options",
                },
                allowIncompatiblePlatform: {
                    value: false,
                    description: "Allow incompatible platform",
                    displayName: "Allow Incompatible Platform",
                },
            },
            objectTypesDictionary: {
                users: "Users",
                permissions: "Permissions",
            },
        };

        // Stub showSaveDialog to simulate user choosing a save location
        const savedProfilePath = "c:/profiles/ProductionProfile.publish.xml";
        sandbox.stub(vscode.window, "showSaveDialog").resolves(vscode.Uri.file(savedProfilePath));

        // Mock DacFx service
        mockDacFxService.savePublishProfile.resolves({ success: true, errorMessage: "" });

        const reducerHandlers = controller["_reducerHandlers"] as Map<string, Function>;
        const savePublishProfile = reducerHandlers.get("savePublishProfile");
        expect(savePublishProfile, "savePublishProfile reducer should be registered").to.exist;

        // Invoke the reducer
        await savePublishProfile(controller.state, {
            publishProfileName: "ProductionProfile.publish.xml",
        });

        // Verify DacFx save was called with correct parameters
        expect(
            mockDacFxService.savePublishProfile.calledOnce,
            "DacFx savePublishProfile should be called once when saving profile",
        ).to.be.true;

        const saveCall = mockDacFxService.savePublishProfile.getCall(0);
        expect(saveCall.args[0].replace(/\\/g, "/")).to.equal(savedProfilePath); // File path (normalize for cross-platform)
        expect(saveCall.args[1]).to.equal("ProductionDB"); // Database name
        // Connection string is args[2]
        const sqlCmdVariables = saveCall.args[3]; // SQL CMD variables
        expect(sqlCmdVariables.get("EnvironmentName")).to.equal("Production");

        // Verify deployment options are included (args[4])
        const deploymentOptions = saveCall.args[4];
        expect(deploymentOptions).to.exist;
        expect(deploymentOptions.excludeObjectTypes.value).to.deep.equal(["Users", "Permissions"]);
        expect(
            deploymentOptions.booleanOptionsDictionary.ignoreTableOptions?.value,
            "ignoreTableOptions should be true in saved deployment options",
        ).to.be.true;
        expect(
            deploymentOptions.booleanOptionsDictionary.allowIncompatiblePlatform?.value,
            "allowIncompatiblePlatform should be false in saved deployment options",
        ).to.be.false;
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
        expect(serverComponent.required, "serverName component should be required").to.be.true;
        expect(controller.state.formState.serverName).to.equal("");

        // Verify database component and default value (project name)
        const databaseComponent = controller.state.formComponents.databaseName;
        expect(databaseComponent).to.exist;
        expect(databaseComponent.label).to.exist;
        expect(databaseComponent.required, "databaseName component should be required").to.be.true;
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

    //#region Advanced Options Section Tests
    test("deployment options should have three groups: General, Ignore, and Exclude", async () => {
        const controller = createTestController();
        await controller.initialized.promise;

        // Set up comprehensive deployment options with all three types
        const deploymentOptions = {
            excludeObjectTypes: {
                value: [],
                description: "Object types to exclude",
                displayName: "Exclude Object Types",
            },
            booleanOptionsDictionary: {
                allowDropBlockingAssemblies: {
                    value: false,
                    description: "Allow drop blocking assemblies",
                    displayName: "Allow Drop Blocking Assemblies",
                },
                ignoreTableOptions: {
                    value: false,
                    description: "Ignore table options during deployment",
                    displayName: "Ignore Table Options",
                },
                ignoreIndexes: {
                    value: false,
                    description: "Ignore indexes during deployment",
                    displayName: "Ignore Indexes",
                },
            },
            objectTypesDictionary: {
                users: "Users",
                logins: "Logins",
                tables: "Tables",
            },
        };

        const reducerHandlers = controller["_reducerHandlers"] as Map<string, Function>;
        const updateDeploymentOptions = reducerHandlers.get("updateDeploymentOptions");

        // Update deployment options
        const newState = await updateDeploymentOptions(controller.state, {
            deploymentOptions,
        });

        // Verify we have the expected structure
        expect(newState.deploymentOptions.booleanOptionsDictionary).to.exist;
        expect(newState.deploymentOptions.objectTypesDictionary).to.exist;
        expect(newState.deploymentOptions.excludeObjectTypes).to.exist;

        // Verify General group - one option that doesn't start with "Ignore"
        expect(newState.deploymentOptions.booleanOptionsDictionary.allowDropBlockingAssemblies).to
            .exist;

        // Verify Ignore group - one option that starts with "Ignore"
        expect(newState.deploymentOptions.booleanOptionsDictionary.ignoreTableOptions).to.exist;

        // Verify Exclude group - object types dictionary
        expect(newState.deploymentOptions.objectTypesDictionary.users).to.equal("Users");
    });

    test("updateDeploymentOptions reducer should save and collect options properly", async () => {
        const controller = createTestController();
        await controller.initialized.promise;

        const originalOptions = {
            excludeObjectTypes: {
                value: ["Users"],
                description: "Object types to exclude",
                displayName: "Exclude Object Types",
            },
            booleanOptionsDictionary: {
                allowDropBlockingAssemblies: {
                    value: false,
                    description: "Allow drop blocking assemblies",
                    displayName: "Allow Drop Blocking Assemblies",
                },
            },
            objectTypesDictionary: {
                users: "Users",
                logins: "Logins",
            },
        };

        const updatedOptions = {
            excludeObjectTypes: {
                value: ["Users", "Logins"],
                description: "Object types to exclude",
                displayName: "Exclude Object Types",
            },
            booleanOptionsDictionary: {
                allowDropBlockingAssemblies: {
                    value: true,
                    description: "Allow drop blocking assemblies",
                    displayName: "Allow Drop Blocking Assemblies",
                },
            },
            objectTypesDictionary: {
                users: "Users",
                logins: "Logins",
            },
        };

        const reducerHandlers = controller["_reducerHandlers"] as Map<string, Function>;
        const updateDeploymentOptions = reducerHandlers.get("updateDeploymentOptions");

        // Set initial state
        let newState = await updateDeploymentOptions(controller.state, {
            deploymentOptions: originalOptions,
        });

        // Verify initial state is saved correctly
        expect(newState.deploymentOptions.excludeObjectTypes.value).to.deep.equal(["Users"]);
        expect(
            newState.deploymentOptions.booleanOptionsDictionary.allowDropBlockingAssemblies.value,
        ).to.be.false;

        // Update with new options
        newState = await updateDeploymentOptions(newState, {
            deploymentOptions: updatedOptions,
        });

        // Verify updated state is collected properly
        expect(newState.deploymentOptions.excludeObjectTypes.value).to.deep.equal([
            "Users",
            "Logins",
        ]);
        expect(
            newState.deploymentOptions.booleanOptionsDictionary.allowDropBlockingAssemblies.value,
        ).to.be.true;
    });
    //#endregion
});
