/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";
import * as mssqlVscode from "vscode-mssql";
import * as baselines from "./baselines/baselines";
import * as testUtils from "./testUtils";
import * as utils from "../src/common/utils";
import * as constants from "../src/common/constants";

import { UpdateProjectFromDatabaseWithQuickpick } from "../src/dialogs/updateProjectFromDatabaseQuickpick";
import { UpdateProjectAction } from "../src/models/api/updateProject";
import { mockDacFxResult } from "./testContext";

let sandbox: sinon.SinonSandbox;

const mockSqlProjectsService = {
    // Read operations
    openProject: async () => mockDacFxResult,
    closeProject: async () => mockDacFxResult,
    createProject: async () => mockDacFxResult,
    getProjectProperties: async () => ({
        ...mockDacFxResult,
        projectGuid: "BA5EBA11-C0DE-5EA7-ACED-BABB1E70A575",
        configuration: "Debug",
        outputPath: "bin/Debug",
        defaultCollation: "",
        databaseSource: "",
        databaseSchemaProvider: "Microsoft.Data.Tools.Schema.Sql.SqlAzureV12DatabaseSchemaProvider",
        projectStyle: mssqlVscode.ProjectType.SdkStyle,
    }),
    getCrossPlatformCompatibility: async () => ({
        ...mockDacFxResult,
        isCrossPlatformCompatible: true,
    }),
    getSqlCmdVariables: async () => ({ ...mockDacFxResult, sqlCmdVariables: [] }),
    getDatabaseReferences: async () => ({
        ...mockDacFxResult,
        dacpacReferences: [],
        sqlProjectReferences: [],
        systemDatabaseReferences: [],
        nugetPackageReferences: [],
    }),
    getPreDeploymentScripts: async () => ({ ...mockDacFxResult, scripts: [] }),
    getPostDeploymentScripts: async () => ({ ...mockDacFxResult, scripts: [] }),
    getNoneItems: async () => ({ ...mockDacFxResult, scripts: [] }),
    getSqlObjectScripts: async () => ({ ...mockDacFxResult, scripts: [] }),
    getFolders: async () => ({ ...mockDacFxResult, folders: [] }),
    // Write operations
    addFolder: async () => mockDacFxResult,
    deleteFolder: async () => mockDacFxResult,
    excludeFolder: async () => mockDacFxResult,
    moveFolder: async () => mockDacFxResult,
    addSqlObjectScript: async () => mockDacFxResult,
    deleteSqlObjectScript: async () => mockDacFxResult,
    excludeSqlObjectScript: async () => mockDacFxResult,
    moveSqlObjectScript: async () => mockDacFxResult,
    addPreDeploymentScript: async () => mockDacFxResult,
    addPostDeploymentScript: async () => mockDacFxResult,
    deletePreDeploymentScript: async () => mockDacFxResult,
    deletePostDeploymentScript: async () => mockDacFxResult,
    excludePreDeploymentScript: async () => mockDacFxResult,
    excludePostDeploymentScript: async () => mockDacFxResult,
    movePreDeploymentScript: async () => mockDacFxResult,
    movePostDeploymentScript: async () => mockDacFxResult,
    addNoneItem: async () => mockDacFxResult,
    deleteNoneItem: async () => mockDacFxResult,
    excludeNoneItem: async () => mockDacFxResult,
    moveNoneItem: async () => mockDacFxResult,
    addSqlCmdVariable: async () => mockDacFxResult,
    deleteSqlCmdVariable: async () => mockDacFxResult,
    updateSqlCmdVariable: async () => mockDacFxResult,
    addDacpacReference: async () => mockDacFxResult,
    addSqlProjectReference: async () => mockDacFxResult,
    addSystemDatabaseReference: async () => mockDacFxResult,
    addNugetPackageReference: async () => mockDacFxResult,
    deleteDatabaseReference: async () => mockDacFxResult,
    setDatabaseSource: async () => mockDacFxResult,
    setDatabaseSchemaProvider: async () => mockDacFxResult,
    updateProjectForCrossPlatform: async () => mockDacFxResult,
} as unknown as mssqlVscode.ISqlProjectsService;

suite("Update Project From Database Quickpicks", () => {
    suiteSetup(async function (): Promise<void> {
        await baselines.loadBaselines();
    });

    setup(function (): void {
        sandbox = sinon.createSandbox();
        sandbox.stub(utils, "getSqlProjectsService").resolves(mockSqlProjectsService);
    });

    teardown(function (): void {
        sandbox.restore();
    });

    suiteTeardown(async function (): Promise<void> {
        await testUtils.deleteGeneratedTestFolder();
    });

    test("Should build UpdateProjectDataModel when user selects workspace project and Update action", async function (): Promise<void> {
        // Arrange - create a test project and stub utils & quickpicks
        const project = await testUtils.createTestProject(
            this.test,
            baselines.openProjectFileBaseline,
        );
        const projectFilePath = project.projectFilePath.toLowerCase();

        // Stub workspace project enumeration to return the created project
        sandbox
            .stub(utils, "getSqlProjectsInWorkspace")
            .resolves([vscode.Uri.file(projectFilePath)]);

        // Stub the vscode-mssql API provider used by the quickpick flow
        const connectionProfile: any = {
            user: "user",
            password: "pw",
            server: "serverName",
            database: "TestDB",
            authenticationType: "SqlLogin",
            options: { connectionName: "MockConnection" },
        };

        sandbox.stub(utils, "getVscodeMssqlApi").resolves({
            promptForConnection: sandbox.stub().resolves(connectionProfile),
            connect: sandbox.stub().resolves("MockUri"),
            listDatabases: sandbox.stub().resolves([connectionProfile.database]),
        } as unknown as mssqlVscode.IExtension);

        // Stub QuickPick flows:
        // Call 0 -> project selection (workspace project)
        // Call 1 -> action selection (Update)
        const showQP = sandbox.stub(vscode.window, "showQuickPick");
        showQP.onCall(0).resolves(projectFilePath as any);
        showQP.onCall(1).resolves(constants.updateActionRadioButtonLabel as any);

        // Capture the model produced by the callback
        let capturedModel: any;
        const cb = async (m: any): Promise<void> => {
            capturedModel = m;
        };

        // Act - pass undefined for projectFilePath to trigger prompt
        await UpdateProjectFromDatabaseWithQuickpick(undefined, undefined, cb);

        // Assert
        expect(capturedModel).to.not.be.undefined;
        expect(
            capturedModel.sourceEndpointInfo.databaseName,
            "Source database should match selected database",
        ).to.equal(connectionProfile.database);
        expect(
            capturedModel.sourceEndpointInfo.serverDisplayName,
            "Source server display name should match connection profile server",
        ).to.equal(connectionProfile.server);
        expect(
            capturedModel.targetEndpointInfo.projectFilePath,
            "Target project file path should be the selected workspace project",
        ).to.equal(projectFilePath);
        expect(capturedModel.action, "Action should be Update").to.equal(
            UpdateProjectAction.Update,
        );
    });

    test("Should not invoke callback when user cancels project selection", async function (): Promise<void> {
        // Arrange - stub getVscodeMssqlApi to return a profile with a database (so no DB pick)
        const connectionProfile: any = {
            user: "user",
            password: "pw",
            server: "serverName",
            database: "TestDB",
            authenticationType: "SqlLogin",
            options: { connectionName: "MockConnection" },
        };

        sandbox.stub(utils, "getVscodeMssqlApi").resolves({
            promptForConnection: sandbox.stub().resolves(connectionProfile),
            connect: sandbox.stub().resolves("MockUri"),
            listDatabases: sandbox.stub().resolves([connectionProfile.database]),
        } as unknown as mssqlVscode.IExtension);

        // Workspace may contain projects, but user cancels at project selection
        sandbox.stub(utils, "getSqlProjectsInWorkspace").resolves([]);

        // Simulate user cancelling project quickpick
        const showQP = sandbox.stub(vscode.window, "showQuickPick");
        showQP.onCall(0).resolves(undefined); // user cancels at project selection

        const spyCb = sandbox.spy();

        // Act - pass undefined for projectFilePath to trigger prompt
        await UpdateProjectFromDatabaseWithQuickpick(undefined, undefined, spyCb as any);

        // Assert - callback should not be called
        expect(spyCb.notCalled).to.be.true;
    });

    test("Should use provided project file path without prompting when passed as parameter", async function (): Promise<void> {
        // Arrange - create a test project
        const project = await testUtils.createTestProject(
            this.test,
            baselines.openProjectFileBaseline,
        );
        const providedProjectPath = project.projectFilePath.toLowerCase();

        // Stub the vscode-mssql API provider
        const connectionProfile: any = {
            user: "user",
            password: "pw",
            server: "serverName",
            database: "TestDB",
            authenticationType: "SqlLogin",
            options: { connectionName: "MockConnection" },
        };

        sandbox.stub(utils, "getVscodeMssqlApi").resolves({
            promptForConnection: sandbox.stub().resolves(connectionProfile),
            connect: sandbox.stub().resolves("MockUri"),
            listDatabases: sandbox.stub().resolves([connectionProfile.database]),
        } as unknown as mssqlVscode.IExtension);

        // Stub QuickPick - should only be called once for action selection (not for project selection)
        const showQP = sandbox.stub(vscode.window, "showQuickPick");
        showQP.onCall(0).resolves(constants.compareActionRadioButtonLabel as any); // Only action selection

        // Spy on getSqlProjectsInWorkspace to ensure it's NOT called when project path is provided
        const getProjectsSpy = sandbox.stub(utils, "getSqlProjectsInWorkspace");

        // Capture the model produced by the callback
        let capturedModel: any;
        const cb = async (m: any): Promise<void> => {
            capturedModel = m;
        };

        // Act - pass the project file path as second parameter
        await UpdateProjectFromDatabaseWithQuickpick(undefined, providedProjectPath, cb);

        // Assert
        expect(capturedModel).to.not.be.undefined;
        expect(
            capturedModel.targetEndpointInfo.projectFilePath,
            "Target project file path should be the provided project path, not prompted",
        ).to.equal(providedProjectPath);
        expect(capturedModel.action, "Action should be Compare").to.equal(
            UpdateProjectAction.Compare,
        );

        // Verify that project selection was skipped
        expect(
            getProjectsSpy.notCalled,
            "getSqlProjectsInWorkspace should not be called when project path is provided",
        ).to.be.true;
        expect(
            showQP.callCount,
            "QuickPick should only be shown once (for action), not for project selection",
        ).to.equal(1);
    });

    test("Should prompt for project when no project file path is provided as parameter", async function (): Promise<void> {
        // Arrange - create a test project
        const project = await testUtils.createTestProject(
            this.test,
            baselines.openProjectFileBaseline,
        );
        const workspaceProjectPath = project.projectFilePath.toLowerCase();

        // Stub workspace project enumeration to return the created project
        sandbox
            .stub(utils, "getSqlProjectsInWorkspace")
            .resolves([vscode.Uri.file(workspaceProjectPath)]);

        // Stub the vscode-mssql API provider
        const connectionProfile: any = {
            user: "user",
            password: "pw",
            server: "serverName",
            database: "TestDB",
            authenticationType: "SqlLogin",
            options: { connectionName: "MockConnection" },
        };

        sandbox.stub(utils, "getVscodeMssqlApi").resolves({
            promptForConnection: sandbox.stub().resolves(connectionProfile),
            connect: sandbox.stub().resolves("MockUri"),
            listDatabases: sandbox.stub().resolves([connectionProfile.database]),
        } as unknown as mssqlVscode.IExtension);

        // Stub QuickPick - should be called twice (project selection and action selection)
        const showQP = sandbox.stub(vscode.window, "showQuickPick");
        showQP.onCall(0).resolves(workspaceProjectPath as any); // Project selection
        showQP.onCall(1).resolves(constants.updateActionRadioButtonLabel as any); // Action selection

        // Capture the model produced by the callback
        let capturedModel: any;
        const cb = async (m: any): Promise<void> => {
            capturedModel = m;
        };

        // Act - pass undefined for project file path to trigger prompt
        await UpdateProjectFromDatabaseWithQuickpick(undefined, undefined, cb);

        // Assert
        expect(capturedModel).to.not.be.undefined;
        expect(
            capturedModel.targetEndpointInfo.projectFilePath,
            "Target project file path should be the selected workspace project",
        ).to.equal(workspaceProjectPath);
        expect(capturedModel.action, "Action should be Update").to.equal(
            UpdateProjectAction.Update,
        );
        expect(
            showQP.callCount,
            "QuickPick should be shown twice (project and action selection)",
        ).to.equal(2);
    });
});
