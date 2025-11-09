/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as mssql from "vscode-mssql";
import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";

import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import ConnectionManager from "../../src/controllers/connectionManager";
import MainController from "../../src/controllers/mainController";
import { PublishProjectWebViewController } from "../../src/publishProject/publishProjectWebViewController";
import { validateSqlServerPortNumber } from "../../src/publishProject/projectUtils";
import { validateSqlServerPassword } from "../../src/deployment/dockerUtils";
import { stubVscodeWrapper } from "./utils";
import { PublishTarget } from "../../src/sharedInterfaces/publishDialog";
import { SqlProjectsService } from "../../src/services/sqlProjectsService";
import * as dockerUtils from "../../src/deployment/dockerUtils";
import * as projectUtils from "../../src/publishProject/projectUtils";
import { DockerStep } from "../../src/sharedInterfaces/localContainers";
import { ApiStatus } from "../../src/sharedInterfaces/webview";

chai.use(sinonChai);

suite("PublishProjectWebViewController Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let contextStub: vscode.ExtensionContext;
    let vscodeWrapperStub: sinon.SinonStubbedInstance<VscodeWrapper>;
    let mockSqlProjectsService: sinon.SinonStubbedInstance<SqlProjectsService>;
    let mockDacFxService: sinon.SinonStubbedInstance<mssql.IDacFxService>;
    let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let mockMainController: sinon.SinonStubbedInstance<MainController>;

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

        // Create MainController mock - only stub methods we actually use in container creation
        mockMainController = {
            connectionManager: mockConnectionManager,
            createObjectExplorerSession: sandbox.stub().resolves(),
        } as unknown as sinon.SinonStubbedInstance<MainController>;
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
            mockMainController,
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
                outputPath: "bin/Debug",
            }),
        };

        const controller = new PublishProjectWebViewController(
            contextStub,
            vscodeWrapperStub,
            mockConnectionManager,
            "test.sqlproj",
            mockMainController,
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

        expect(existingServerOption?.displayName).to.equal("Existing SQL server");
        expect(containerOption?.displayName).to.equal("New SQL Server Local development container");
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

    test("getSqlServerContainerTagsForTargetVersion filters versions correctly for SQL Server 2022", async () => {
        // Mock deployment versions that would be returned from getSqlServerContainerVersions()
        const mockDeploymentVersions = [
            { displayName: "SQL Server 2025 image (latest)", value: "2025-latest" },
            { displayName: "SQL Server 2022 image", value: "2022" },
            { displayName: "SQL Server 2019 image", value: "2019" },
            { displayName: "SQL Server 2017 image", value: "2017" },
        ];

        sandbox.stub(dockerUtils, "getSqlServerContainerVersions").resolves(mockDeploymentVersions);

        const result = await projectUtils.getSqlServerContainerTagsForTargetVersion("160");

        // Should return only versions >= 2022 (2025 and 2022, filtered out 2019 and 2017)
        expect(result).to.have.lengthOf(2);
        expect(result[0].displayName).to.equal("SQL Server 2025 image (latest)");
        expect(result[1].displayName).to.equal("SQL Server 2022 image");
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
        // Set up initial project SQLCMD variables (these are the project defaults)
        mockSqlProjectsService.getSqlCmdVariables.resolves({
            success: true,
            errorMessage: "",
            sqlCmdVariables: [
                { varName: "Var1", value: "$(Var1)", defaultValue: "Value1" },
                { varName: "Var2", value: "$(Var2)", defaultValue: "Value2" },
            ],
        });

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

        // Verify SQLCMD variables from profile XML
        expect(newState.formState.sqlCmdVariables).to.deep.equal({
            Var1: "Value1",
            Var2: "Value2",
        });

        // Verify original values are updated
        expect(newState.defaultSqlCmdVariables).to.deep.equal({
            Var1: "Value1",
            Var2: "Value2",
        });

        // Verify deployment options were loaded from DacFx matching XML properties
        expect(mockDacFxService.getOptionsFromProfile).to.have.been.calledOnce;
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
        expect(mockDacFxService.savePublishProfile).to.have.been.calledOnce;

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

    //#region Generate Script Tests
    test("generatePublishScript reducer closes dialog and triggers script generation", async () => {
        const controller = createTestController();
        await controller.initialized.promise;

        // Set up state with all required fields for script generation
        controller.state.formState.serverName = "localhost";
        controller.state.formState.databaseName = "TestDatabase";
        controller["_connectionUri"] = "mssql://test-connection-uri";
        controller.state.projectFilePath = "c:/work/TestProject.sqlproj";

        // Mock the panel dispose method using sandbox stub
        const panelDisposeSpy = sandbox.stub();
        Object.defineProperty(controller, "panel", {
            value: { dispose: panelDisposeSpy },
            writable: true,
            configurable: true,
        });

        // Spy on executePublishAndGenerateScript to verify it's called
        const executePublishSpy = sandbox.stub(
            controller as typeof controller & {
                executePublishAndGenerateScript: (state: unknown, isPublish: boolean) => void;
            },
            "executePublishAndGenerateScript",
        );

        const reducerHandlers = controller["_reducerHandlers"] as Map<string, Function>;
        const generatePublishScript = reducerHandlers.get("generatePublishScript");
        expect(generatePublishScript, "generatePublishScript reducer should be registered").to
            .exist;

        // Invoke the reducer
        await generatePublishScript(controller.state, {});

        // Verify dialog was closed
        expect(panelDisposeSpy).to.have.been.calledOnce;

        // Verify executePublishAndGenerateScript was called with isPublish=false
        expect(executePublishSpy).to.have.been.calledOnce;
        expect(
            executePublishSpy.firstCall.args[1],
            "isPublish parameter should be false for script generation",
        ).to.be.false;
    });
    //#endregion

    //#region Publish Tests
    test("publishNow reducer closes dialog and triggers publish", async () => {
        const controller = createTestController();
        await controller.initialized.promise;

        // Set up state with all required fields for publish
        controller.state.formState.serverName = "localhost";
        controller.state.formState.databaseName = "TestDatabase";
        controller["_connectionUri"] = "mssql://test-connection-uri";
        controller.state.projectFilePath = "c:/work/TestProject.sqlproj";

        // Mock the panel dispose method using sandbox stub
        const panelDisposeSpy = sandbox.stub();
        Object.defineProperty(controller, "panel", {
            value: { dispose: panelDisposeSpy },
            writable: true,
            configurable: true,
        });

        // Spy on executePublishAndGenerateScript to verify it's called
        const executePublishSpy = sandbox.stub(
            controller as typeof controller & {
                executePublishAndGenerateScript: (state: unknown, isPublish: boolean) => void;
            },
            "executePublishAndGenerateScript",
        );

        const reducerHandlers = controller["_reducerHandlers"] as Map<string, Function>;
        const publishNow = reducerHandlers.get("publishNow");
        expect(publishNow, "publishNow reducer should be registered").to.exist;

        // Invoke the reducer
        await publishNow(controller.state, {});

        // Verify dialog was closed
        expect(panelDisposeSpy).to.have.been.calledOnce;

        // Verify executePublishAndGenerateScript was called with isPublish=true
        expect(executePublishSpy).to.have.been.calledOnce;
        expect(
            executePublishSpy.firstCall.args[1],
            "isPublish parameter should be true for publish",
        ).to.be.true;
    });
    //#endregion

    //#region SQLCMD Variables Tests
    test("SQLCMD variables are loaded from project during initialization", async () => {
        // Mock getSqlCmdVariables to return test variables
        mockSqlProjectsService.getSqlCmdVariables.resolves({
            success: true,
            errorMessage: "",
            sqlCmdVariables: [
                { varName: "DatabaseName", value: "$(DatabaseName)", defaultValue: "MyTestDB" },
                { varName: "Environment", value: "$(Environment)", defaultValue: "Development" },
            ],
        });

        const controller = createTestController("c:/work/TestProject.sqlproj");
        await controller.initialized.promise;

        // Verify getSqlCmdVariables was called with project path
        expect(mockSqlProjectsService.getSqlCmdVariables).to.have.been.calledWith(
            "c:/work/TestProject.sqlproj",
        );

        // Verify SQLCMD variables were loaded into state
        expect(controller.state.formState.sqlCmdVariables).to.deep.equal({
            DatabaseName: "MyTestDB",
            Environment: "Development",
        });
    });

    test("revertSqlCmdVariables reducer restores variables to default values", async () => {
        // Set up initial project SQLCMD variables
        mockSqlProjectsService.getSqlCmdVariables.resolves({
            success: true,
            errorMessage: "",
            sqlCmdVariables: [
                { varName: "ServerName", value: "$(ServerName)", defaultValue: "localhost" },
                { varName: "DatabaseName", value: "$(DatabaseName)", defaultValue: "TestDB" },
            ],
        });

        const controller = createTestController();
        await controller.initialized.promise;

        // Simulate user modifying the variables
        controller.state.formState.sqlCmdVariables = {
            ServerName: "prodserver.database.windows.net",
            DatabaseName: "ProductionDB",
        };

        const reducerHandlers = controller["_reducerHandlers"] as Map<string, Function>;
        const revertSqlCmdVariables = reducerHandlers.get("revertSqlCmdVariables");
        expect(revertSqlCmdVariables, "revertSqlCmdVariables reducer should be registered").to
            .exist;

        // Invoke the reducer
        const newState = await revertSqlCmdVariables(controller.state, {});

        // Verify variables were reverted to defaults
        expect(newState.formState.sqlCmdVariables).to.deep.equal({
            ServerName: "localhost",
            DatabaseName: "TestDB",
        });
    });

    test("Loading profile with SQLCMD variables when project has none should show variables", async () => {
        // Mock getSqlCmdVariables to return NO variables (project has none)
        mockSqlProjectsService.getSqlCmdVariables.resolves({
            success: true,
            errorMessage: "",
            sqlCmdVariables: [],
        });

        const controller = createTestController();
        await controller.initialized.promise;

        // Verify initially no SQLCMD variables
        expect(controller.state.formState.sqlCmdVariables).to.deep.equal({});

        const profilePath = "c:/profiles/ProfileWithVariables.publish.xml";

        // Mock file system read
        const fs = await import("fs");
        sandbox.stub(fs.promises, "readFile").resolves(SAMPLE_PUBLISH_PROFILE_XML);

        // Mock file picker
        sandbox.stub(vscode.window, "showOpenDialog").resolves([vscode.Uri.file(profilePath)]);

        // Mock DacFx service
        mockDacFxService.getOptionsFromProfile.resolves({
            success: true,
            errorMessage: "",
            deploymentOptions: {
                excludeObjectTypes: { value: [], description: "", displayName: "" },
                booleanOptionsDictionary: {},
                objectTypesDictionary: {},
            },
        });

        const reducerHandlers = controller["_reducerHandlers"] as Map<string, Function>;
        const selectPublishProfile = reducerHandlers.get("selectPublishProfile");
        expect(selectPublishProfile, "selectPublishProfile reducer should be registered").to.exist;

        // Load the profile
        const newState = await selectPublishProfile(controller.state, {});

        // Verify SQLCMD variables from profile are now present even though project had none
        expect(newState.formState.sqlCmdVariables).to.deep.equal({
            Var1: "Value1",
            Var2: "Value2",
        });

        // Verify original values are set to profile values
        expect(newState.defaultSqlCmdVariables).to.deep.equal({
            Var1: "Value1",
            Var2: "Value2",
        });
    });
    //#endregion

    //#region Docker Container Publish Tests
    test("prepareContainerConfiguration generates unique container name and parses port", async () => {
        const controller = createTestController();
        await controller.initialized.promise;

        // Set up form state with container values
        controller.state.formState.containerPort = "1450";

        // Mock validateContainerName to return a unique name
        sandbox.stub(dockerUtils, "validateContainerName").resolves("sql-server-container-abc123");

        // Call the method
        const config = await controller["prepareContainerConfiguration"](controller.state);

        // Verify container name was generated
        expect(config.containerName).to.equal("sql-server-container-abc123");
        expect(dockerUtils.validateContainerName).to.have.been.calledOnce;

        // Verify port was parsed
        expect(config.port).to.equal(1450);
    });

    test("publishNow with LocalContainer target runs full Docker workflow", async () => {
        const controller = createTestController();
        await controller.initialized.promise;

        // Set up form state for container publish
        controller.state.formState.publishTarget = PublishTarget.LocalContainer;
        controller.state.formState.databaseName = "TestDB";
        controller.state.formState.containerPort = "1433";
        controller.state.formState.containerAdminPassword = "MyP@ssw0rd123";
        controller.state.formState.containerImageTag = "2022-latest";
        controller.state.formState.acceptContainerLicense = true;

        // Mock prerequisite checks to succeed
        sandbox
            .stub(controller, "runDockerPrerequisiteChecks" as keyof typeof controller)
            .resolves({
                success: true,
            });

        // Mock container configuration
        sandbox
            .stub(controller, "prepareContainerConfiguration" as keyof typeof controller)
            .resolves({
                containerName: "test-container-abc",
                port: 1433,
            });

        // Mock container creation to succeed
        sandbox.stub(controller, "createDockerContainer" as keyof typeof controller).resolves({
            success: true,
            connectionUri: "mssql://publish-container-test-container-abc",
        });

        // Mock build and publish
        sandbox
            .stub(controller, "buildProject" as keyof typeof controller)
            .resolves("/path/to/project.dacpac");
        sandbox.stub(controller, "publishToDatabase" as keyof typeof controller).resolves();

        // Mock panel dispose
        const panelDisposeSpy = sandbox.stub();
        Object.defineProperty(controller, "panel", {
            value: { dispose: panelDisposeSpy },
            writable: true,
            configurable: true,
        });

        const reducerHandlers = controller["_reducerHandlers"] as Map<string, Function>;
        const publishNow = reducerHandlers.get("publishNow");

        // Execute publish
        const newState = await publishNow(controller.state, {});

        // Verify prerequisite checks were run
        expect(controller["runDockerPrerequisiteChecks"]).to.have.been.calledOnce;

        // Verify container configuration was prepared
        expect(controller["prepareContainerConfiguration"]).to.have.been.calledOnce;

        // Verify container was created
        expect(controller["createDockerContainer"]).to.have.been.calledWith(
            "test-container-abc",
            1433,
            sinon.match.any,
        );

        // Verify build was triggered
        expect(controller["buildProject"]).to.have.been.calledOnce;

        // Verify publish was triggered
        expect(controller["publishToDatabase"]).to.have.been.calledOnce;

        // Verify panel was closed at the end
        expect(panelDisposeSpy).to.have.been.calledOnce;

        // Verify final state
        expect(newState.inProgress).to.be.false;
    });

    test("publishNow with LocalContainer handles error scenarios", async () => {
        const errorScenarios = [
            {
                name: "prerequisite check failure",
                stubs: {
                    runDockerPrerequisiteChecks: {
                        success: false,
                        error: "Docker is not installed",
                    },
                },
                expectedError: "Docker is not installed",
                expectContainerError: true,
            },
            {
                name: "container creation failure",
                stubs: {
                    runDockerPrerequisiteChecks: { success: true },
                    prepareContainerConfiguration: {
                        containerName: "test-container-abc",
                        port: 1433,
                    },
                    createDockerContainer: {
                        success: false,
                        error: "Port already allocated",
                        fullErrorText:
                            "Error response from daemon: failed to set up container networking: Bind for 0.0.0.0:1433 failed: port is already allocated",
                    },
                },
                expectedError:
                    "Error response from daemon: failed to set up container networking: Bind for 0.0.0.0:1433 failed: port is already allocated",
                expectContainerError: true,
            },
            {
                name: "build failure",
                stubs: {
                    runDockerPrerequisiteChecks: { success: true },
                    prepareContainerConfiguration: {
                        containerName: "test-container-abc",
                        port: 1433,
                    },
                    createDockerContainer: {
                        success: true,
                        connectionUri: "mssql://publish-container-test-container-abc",
                    },
                    buildProject: undefined,
                },
                expectedError: undefined,
                expectContainerError: false,
            },
            {
                name: "unexpected exception",
                stubs: {
                    runDockerPrerequisiteChecks: new Error("Unexpected network failure"),
                },
                expectedError: "Unexpected network failure",
                expectContainerError: true,
                expectLogError: true,
            },
        ];

        for (const scenario of errorScenarios) {
            const controller = createTestController();
            await controller.initialized.promise;

            // Set up form state for container publish
            controller.state.formState.publishTarget = PublishTarget.LocalContainer;
            controller.state.formState.databaseName = "TestDB";
            controller.state.formState.containerPort = "1433";

            // Set up stubs for this scenario
            for (const [methodName, returnValue] of Object.entries(scenario.stubs)) {
                if (returnValue instanceof Error) {
                    sandbox
                        .stub(controller, methodName as keyof typeof controller)
                        .rejects(returnValue);
                } else {
                    sandbox
                        .stub(controller, methodName as keyof typeof controller)
                        .resolves(returnValue);
                }
            }

            // Mock logger if needed
            const loggerErrorSpy = scenario.expectLogError
                ? sandbox.stub(controller["logger"], "error")
                : undefined;

            // Mock updateState to capture state changes
            const updateStateSpy = sandbox.stub(controller, "updateState");

            const reducerHandlers = controller["_reducerHandlers"] as Map<string, Function>;
            const publishNow = reducerHandlers.get("publishNow");

            // Execute publish
            const newState = await publishNow(controller.state, {});

            // Verify common expectations
            expect(newState.inProgress, `${scenario.name}: inProgress should be false`).to.be.false;
            expect(updateStateSpy, `${scenario.name}: updateState should be called`).to.have.been
                .called;

            // Verify error message if expected
            if (scenario.expectedError) {
                expect(
                    newState.formMessage,
                    `${scenario.name}: formMessage should be set`,
                ).to.deep.equal({
                    message: scenario.expectedError,
                    intent: "error",
                });
            }

            // Verify container creation status if expected
            if (scenario.expectContainerError) {
                expect(
                    newState.containerCreationStatus,
                    `${scenario.name}: containerCreationStatus should be Error`,
                ).to.equal(ApiStatus.Error);
            }

            // Verify logger was called if expected
            if (loggerErrorSpy) {
                expect(
                    loggerErrorSpy,
                    `${scenario.name}: logger.error should be called`,
                ).to.have.been.calledWith(
                    "Failed during container publish:",
                    sinon.match.instanceOf(Error),
                );
            }

            sandbox.restore();
        }
    });
    //#endregion
});
