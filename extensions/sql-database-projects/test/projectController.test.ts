/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as path from "path";
import * as vscode from "vscode";
import * as sinon from "sinon";
import * as dataworkspace from "dataworkspace";
import * as baselines from "./baselines/baselines";
import * as templates from "../src/templates/templates";
import * as testUtils from "./testUtils";
import * as constants from "../src/common/constants";
import * as mssql from "vscode-mssql";
import * as utils from "../src/common/utils";

import { SqlDatabaseProjectTreeViewProvider } from "../src/controllers/databaseProjectTreeViewProvider";
import { ProjectsController } from "../src/controllers/projectController";
import { promises as fs } from "fs";
import {
    createContext,
    TestContext,
    createSqlProjectsServiceStub,
    restubServices,
    clearProjectState,
} from "./testContext";
import { Project } from "../src/models/project";

import { ProjectRootTreeItem } from "../src/models/tree/projectTreeItem";
import { FolderNode, FileNode } from "../src/models/tree/fileFolderTreeItem";
import { BaseProjectTreeItem } from "../src/models/tree/baseTreeItem";

import { ImportDataModel } from "../src/models/api/import";
import { EntryType, ItemType, SqlTargetPlatform } from "sqldbproj";
import { FileProjectEntry } from "../src/models/projectEntry";

chai.use(sinonChai);

let testContext: TestContext;
const templatesPath = testUtils.getTemplatesRootPath();

suite("ProjectsController", function (): void {
    suiteSetup(async function (): Promise<void> {
        await templates.loadTemplates(templatesPath);
        await baselines.loadBaselines();
    });

    setup(function (): void {
        testContext = createContext();
        clearProjectState();
        sinon.stub(utils, "getSqlProjectsService").resolves(createSqlProjectsServiceStub());
        sinon.stub(utils, "getDacFxService").resolves(testContext.dacFxService);
    });

    teardown(function (): void {
        sinon.restore();
    });

    suiteTeardown(async function (): Promise<void> {
        await testUtils.deleteGeneratedTestFolder();
    });

    suite("project controller operations", function (): void {
        suite("Project file operations and prompting", function (): void {
            test("Should create new sqlproj file with correct specified target platform", async function (): Promise<void> {
                const projController = new ProjectsController(testContext.outputChannel);
                const projFileDir = await testUtils.generateTestFolderPath(this.test);
                const projTargetPlatform = SqlTargetPlatform.sqlAzure; // default is SQL Server 2022

                const projFilePath = await projController.createNewProject({
                    newProjName: "TestProjectName",
                    folderUri: vscode.Uri.file(projFileDir),
                    projectTypeId: constants.emptySqlDatabaseProjectTypeId,
                    configureDefaultBuild: true,
                    projectGuid: "BA5EBA11-C0DE-5EA7-ACED-BABB1E70A575",
                    targetPlatform: projTargetPlatform,
                    sdkStyle: false,
                });

                const project = await Project.openProject(projFilePath);
                const projTargetVersion = project.getProjectTargetVersion();
                expect(
                    constants.getTargetPlatformFromVersion(projTargetVersion),
                    "Target platform should match the specified platform",
                ).to.equal(projTargetPlatform);
            });

            test("Should create new edge project with expected template files", async function (): Promise<void> {
                const projController = new ProjectsController(testContext.outputChannel);
                const projFileDir = await testUtils.generateTestFolderPath(this.test);

                const projFilePath = await projController.createNewProject({
                    newProjName: "TestProjectName",
                    folderUri: vscode.Uri.file(projFileDir),
                    projectTypeId: constants.edgeSqlDatabaseProjectTypeId,
                    configureDefaultBuild: true,
                    projectGuid: "BA5EBA11-C0DE-5EA7-ACED-BABB1E70A575",
                    sdkStyle: true,
                });

                const project = await Project.openProject(projFilePath);
                expect(
                    project.sqlObjectScripts.length,
                    `The 7 template files for an edge project should be present. Actual: ${project.sqlObjectScripts.length}`,
                ).to.equal(7);
            });

            test("Should return silently when no SQL object name provided in prompts", async function (): Promise<void> {
                for (const name of ["", "    ", undefined]) {
                    sinon.stub(vscode.window, "showInputBox").resolves(name);
                    sinon.stub(utils, "sanitizeStringForFilename").returns("");
                    const showErrorMessageSpy = sinon.spy(vscode.window, "showErrorMessage");
                    const projController = new ProjectsController(testContext.outputChannel);
                    const project = new Project("FakePath");

                    expect(
                        project.sqlObjectScripts.length,
                        "Project should initially have no scripts",
                    ).to.equal(0);
                    await projController.addItemPrompt(new Project("FakePath"), "", {
                        itemType: ItemType.script,
                    });
                    expect(
                        project.sqlObjectScripts.length,
                        "Expected to return without throwing an exception or adding a file when an empty/undefined name is provided.",
                    ).to.equal(0);
                    expect(showErrorMessageSpy, "showErrorMessage should not have been called").to
                        .not.have.been.called;
                    sinon.restore();
                    restubServices(utils, testContext.dacFxService);
                }
            });

            test("Should show error if trying to add a file that already exists", async function (): Promise<void> {
                const tableName = "table1";
                sinon.stub(vscode.window, "showInputBox").resolves(tableName);
                sinon.stub(utils, "sanitizeStringForFilename").returns(tableName);
                const spy = sinon.spy(vscode.window, "showErrorMessage");
                const projController = new ProjectsController(testContext.outputChannel);
                let project = await testUtils.createTestProject(
                    this.test,
                    baselines.newProjectFileBaseline,
                );

                expect(project.sqlObjectScripts.length, "There should be no files").to.equal(0);
                await projController.addItemPrompt(project, "", { itemType: ItemType.script });

                expect(
                    project.sqlObjectScripts.length,
                    "File should be successfully added",
                ).to.equal(1);
                await projController.addItemPrompt(project, "", { itemType: ItemType.script });
                const msg = constants.fileAlreadyExists(tableName);
                expect(spy, "showErrorMessage should have been called exactly once").to.have.been
                    .calledOnce;
                expect(
                    spy,
                    `showErrorMessage not called with expected message '${msg}' Actual '${spy.getCall(0).args[0]}'`,
                ).to.have.been.calledWith(msg);
            });

            test("Should not create file if no itemTypeName is selected", async function (): Promise<void> {
                sinon.stub(vscode.window, "showQuickPick").resolves(undefined);
                const spy = sinon.spy(vscode.window, "showErrorMessage");
                const projController = new ProjectsController(testContext.outputChannel);
                const project = await testUtils.createTestProject(
                    this.test,
                    baselines.newProjectFileBaseline,
                );

                expect(project.sqlObjectScripts.length, "There should be no files").to.equal(0);
                await projController.addItemPrompt(project, "");
                expect(project.sqlObjectScripts.length, "File should not have been added").to.equal(
                    0,
                );
                expect(
                    spy,
                    `showErrorMessage should not have been called called. Actual '${spy.getCall(0)?.args[0]}'`,
                ).to.not.have.been.called;
            });

            test("Should add existing item", async function (): Promise<void> {
                const tableName = "table1";
                sinon.stub(vscode.window, "showInputBox").resolves(tableName);
                sinon.stub(utils, "sanitizeStringForFilename").returns(tableName);
                const spy = sinon.spy(vscode.window, "showErrorMessage");
                const projController = new ProjectsController(testContext.outputChannel);
                let project = await testUtils.createTestProject(
                    this.test,
                    baselines.newProjectFileBaseline,
                );

                expect(project.sqlObjectScripts.length, "There should be no files").to.equal(0);
                await projController.addItemPrompt(project, "", { itemType: ItemType.script });
                expect(
                    project.sqlObjectScripts.length,
                    "File should be successfully added",
                ).to.equal(1);

                // exclude item
                const projTreeRoot = new ProjectRootTreeItem(project);
                await projController.exclude(
                    createWorkspaceTreeItem(
                        <FileNode>(
                            projTreeRoot.children.find((x) => x.friendlyName === "table1.sql")!
                        ),
                    ),
                );

                // reload project
                project = await Project.openProject(project.projectFilePath);
                expect(
                    project.sqlObjectScripts.length,
                    "File should be successfully excluded",
                ).to.equal(0);
                expect(
                    spy,
                    `showErrorMessage not called with expected message. Actual '${spy.getCall(0)?.args[0]}'`,
                ).to.not.have.been.called;

                // add item back
                sinon
                    .stub(vscode.window, "showOpenDialog")
                    .resolves([
                        vscode.Uri.file(path.join(project.projectFolderPath, "table1.sql")),
                    ]);
                await projController.addExistingItemPrompt(createWorkspaceTreeItem(projTreeRoot));

                // reload project
                project = await Project.openProject(project.projectFilePath);
                expect(
                    project.sqlObjectScripts.length,
                    "File should be successfully re-added",
                ).to.equal(1);
            });

            test("Should show error if trying to add a folder that already exists", async function (): Promise<void> {
                const folderName = "folder1";
                const stub = sinon.stub(vscode.window, "showInputBox").resolves(folderName);
                sinon.stub(utils, "sanitizeStringForFilename").returns(folderName);

                const projController = new ProjectsController(testContext.outputChannel);
                let project = await testUtils.createTestProject(
                    this.test,
                    baselines.newProjectFileBaseline,
                );
                const projectRoot = new ProjectRootTreeItem(project);

                expect(project.folders.length, "There should be no other folders").to.equal(0);
                await projController.addFolderPrompt(createWorkspaceTreeItem(projectRoot));

                // reload project
                project = await Project.openProject(project.projectFilePath);

                expect(project.folders.length, "Folder should be successfully added").to.equal(1);
                stub.restore();
                await verifyFolderNotAdded(folderName, projController, project, projectRoot);

                // reserved folder names
                for (let i in constants.reservedProjectFolders) {
                    await verifyFolderNotAdded(
                        constants.reservedProjectFolders[i],
                        projController,
                        project,
                        projectRoot,
                    );
                }
            });

            test("Should be able to add folder with reserved name as long as not at project root", async function (): Promise<void> {
                const folderName = "folder1";
                sinon.stub(vscode.window, "showInputBox").resolves(folderName);
                sinon.stub(utils, "sanitizeStringForFilename").returns(folderName);

                const projController = new ProjectsController(testContext.outputChannel);
                let project = await testUtils.createTestProject(
                    this.test,
                    baselines.openProjectFileBaseline,
                );
                const projectRoot = new ProjectRootTreeItem(project);

                // make sure it's ok to add these folders if they aren't where the reserved folders are at the root of the project
                let node = projectRoot.children.find((c) => c.friendlyName === "Tables");
                sinon.restore();
                restubServices(utils, testContext.dacFxService);
                for (let i in constants.reservedProjectFolders) {
                    // reload project
                    project = await Project.openProject(project.projectFilePath);
                    await verifyFolderAdded(
                        constants.reservedProjectFolders[i],
                        projController,
                        project,
                        <BaseProjectTreeItem>node,
                    );
                }
            });

            test("Should return default folder for item type only when folder exists", async function (): Promise<void> {
                const projController = new ProjectsController(testContext.outputChannel);
                const project = await testUtils.createTestProject(
                    this.test,
                    templates.newSqlProjectTemplate,
                );

                // Without folders - all should return empty string (root level)
                expect(
                    projController.getDefaultFolderForItemType(ItemType.schema, project),
                    "Schema should return empty when Security folder does not exist",
                ).to.equal("");
                expect(
                    projController.getDefaultFolderForItemType(ItemType.table, project),
                    "Table should not have a default folder",
                ).to.equal("");
                expect(
                    projController.getDefaultFolderForItemType(ItemType.view, project),
                    "View should not have a default folder",
                ).to.equal("");

                // Add Security folder to project
                await project.addFolder(constants.securityFolderName);

                // With Security folder - Schema should return Security, others unchanged
                expect(
                    projController.getDefaultFolderForItemType(ItemType.schema, project),
                    "Schema should return Security folder when it exists",
                ).to.equal(constants.securityFolderName);
            });

            test("Should return empty when no schema folder exists", async function (): Promise<void> {
                const projController = new ProjectsController(testContext.outputChannel);
                const project = await testUtils.createTestProject(
                    this.test,
                    templates.newSqlProjectTemplate,
                );

                // Without schema folder - should return empty string (root level)
                expect(
                    projController.getDefaultFolderForItemType(
                        ItemType.tableValuedFunction,
                        project,
                        "dbo",
                    ),
                    "Should return empty when no dbo folder exists",
                ).to.equal("");

                // Add dbo folder to project
                await project.addFolder("dbo");

                // With dbo folder - should return dbo
                expect(
                    projController.getDefaultFolderForItemType(
                        ItemType.tableValuedFunction,
                        project,
                        "dbo",
                    ),
                    "Should return dbo folder when it exists",
                ).to.equal("dbo");
            });

            test("Should return nested schema/object-type folder when it exists", async function (): Promise<void> {
                const projController = new ProjectsController(testContext.outputChannel);
                const project = await testUtils.createTestProject(
                    this.test,
                    templates.newSqlProjectTemplate,
                );

                // No folders - should return empty
                expect(
                    projController.getDefaultFolderForItemType(
                        ItemType.tableValuedFunction,
                        project,
                        "sales",
                    ),
                    "Should return empty when no Sales folder",
                ).to.equal("");

                // Add Sales folder to project
                await project.addFolder("Sales");

                // With Sales folder only - should return Sales folder
                expect(
                    projController.getDefaultFolderForItemType(
                        ItemType.tableValuedFunction,
                        project,
                        "sales",
                    ),
                    "Should return Sales folder when no nested Functions folder",
                ).to.equal("Sales");

                // Add nested Sales/Functions folder
                await project.addFolder("Sales/Functions");

                // With Sales/Functions folder - should return nested path
                expect(
                    projController.getDefaultFolderForItemType(
                        ItemType.tableValuedFunction,
                        project,
                        "sales",
                    ),
                    "Should return Sales/Functions when nested folder exists",
                ).to.equal("Sales\\Functions");

                // With dbo schema and no dbo folder - should return empty (place at root)
                expect(
                    projController.getDefaultFolderForItemType(
                        ItemType.tableValuedFunction,
                        project,
                        "dbo",
                    ),
                    "Should return empty when dbo folder does not exist",
                ).to.equal("");

                // Add dbo folder
                await project.addFolder("dbo");

                // With dbo folder and schema=dbo - should return dbo folder
                expect(
                    projController.getDefaultFolderForItemType(
                        ItemType.tableValuedFunction,
                        project,
                        "dbo",
                    ),
                    "Should return dbo folder when it exists",
                ).to.equal("dbo");
            });

            test("Should return DatabaseTriggers folder for database trigger regardless of schema", async function (): Promise<void> {
                const projController = new ProjectsController(testContext.outputChannel);
                const project = await testUtils.createTestProject(
                    this.test,
                    baselines.newSdkStyleProjectSdkNodeBaseline,
                );

                // Without DatabaseTriggers folder - should return empty
                expect(
                    projController.getDefaultFolderForItemType(
                        ItemType.databaseTrigger,
                        project,
                        "",
                    ),
                    "Should return empty when DatabaseTriggers folder does not exist",
                ).to.equal("");

                // Add DatabaseTriggers folder at root
                await project.addFolder("DatabaseTriggers");

                // With DatabaseTriggers folder - should return it (schema is ignored for database triggers)
                expect(
                    projController.getDefaultFolderForItemType(
                        ItemType.databaseTrigger,
                        project,
                        "",
                    ),
                    "Should return DatabaseTriggers folder",
                ).to.equal("DatabaseTriggers");
            });

            test("Should return Sequences folder for sequence with root-first priority", async function (): Promise<void> {
                const projController = new ProjectsController(testContext.outputChannel);
                const project = await testUtils.createTestProject(
                    this.test,
                    baselines.newSdkStyleProjectSdkNodeBaseline,
                );

                // Without any folders - should return empty (root level)
                expect(
                    projController.getDefaultFolderForItemType(ItemType.sequence, project, "dbo"),
                    "Should return empty when no folders exist",
                ).to.equal("");

                // Add dbo folder only (no Sequences folders)
                await project.addFolder("dbo");

                // With only dbo folder - should return dbo (schema folder)
                expect(
                    projController.getDefaultFolderForItemType(ItemType.sequence, project, "dbo"),
                    "Should return dbo folder when it exists",
                ).to.equal("dbo");

                // Add root-level Sequences folder
                await project.addFolder("Sequences");

                // With root Sequences folder - should return it (root-level has priority for Sequence)
                expect(
                    projController.getDefaultFolderForItemType(ItemType.sequence, project, "dbo"),
                    "Should return root Sequences folder",
                ).to.equal("Sequences");

                // Add nested dbo/Sequences folder
                await project.addFolder("dbo/Sequences");

                // With both folders - should still return root Sequences (root has higher priority)
                expect(
                    projController.getDefaultFolderForItemType(ItemType.sequence, project, "dbo"),
                    "Should still return root Sequences even when dbo/Sequences exists",
                ).to.equal("Sequences");
            });

            test("Should return schema/Sequences folder when only nested folder exists", async function (): Promise<void> {
                const projController = new ProjectsController(testContext.outputChannel);
                const project = await testUtils.createTestProject(
                    this.test,
                    baselines.newSdkStyleProjectSdkNodeBaseline,
                );

                // Add dbo folder and dbo/Sequences (but no root Sequences)
                await project.addFolder("dbo");
                await project.addFolder("dbo/Sequences");

                // With only dbo/Sequences - should return it since no root Sequences exists
                expect(
                    projController.getDefaultFolderForItemType(ItemType.sequence, project, "dbo"),
                    "Should return dbo/Sequences when no root Sequences exists",
                ).to.equal("dbo\\Sequences");
            });

            test("Should parse schema and object name from user input", function (): void {
                const projController = new ProjectsController(testContext.outputChannel);

                // Test schema-qualified name
                let result = projController.parseSchemaAndObjectName("sales.MyFunction");
                expect(result.schemaName, "Schema should be parsed correctly").to.equal("sales");
                expect(result.objectName, "Object name should be parsed correctly").to.equal(
                    "MyFunction",
                );

                // Test simple name (no schema)
                result = projController.parseSchemaAndObjectName("MyFunction");
                expect(result.schemaName, "Default schema should be dbo").to.equal("dbo");
                expect(result.objectName, "Object name should remain unchanged").to.equal(
                    "MyFunction",
                );

                // Test edge case: leading dot
                result = projController.parseSchemaAndObjectName(".MyFunction");
                expect(result.schemaName, "Leading dot should not be treated as schema").to.equal(
                    "dbo",
                );
                expect(result.objectName, "Full string should be the object name").to.equal(
                    ".MyFunction",
                );

                // Test edge case: trailing dot
                result = projController.parseSchemaAndObjectName("MyFunction.");
                expect(result.schemaName, "Trailing dot should not be treated as schema").to.equal(
                    "dbo",
                );
                expect(result.objectName, "Full string should be the object name").to.equal(
                    "MyFunction.",
                );
            });

            test("Should create .vscode/tasks.json at workspace level with isDefault=true when configureDefaultBuild is true", async function (): Promise<void> {
                const projController = new ProjectsController(testContext.outputChannel);
                const projFileDir = await testUtils.generateTestFolderPath(this.test);

                // Mock workspace folder to return the project folder's parent as the workspace root
                const workspaceFolder: vscode.WorkspaceFolder = {
                    uri: vscode.Uri.file(projFileDir),
                    name: "test-workspace",
                    index: 0,
                };
                sinon.stub(vscode.workspace, "getWorkspaceFolder").returns(workspaceFolder);

                // Act: create a new project with configureDefaultBuild: true
                const projFilePath = await projController.createNewProject({
                    newProjName: "TestProjectWithTasks",
                    folderUri: vscode.Uri.file(projFileDir),
                    projectTypeId: constants.emptySqlDatabaseProjectTypeId,
                    configureDefaultBuild: true,
                    projectGuid: "BA5EBA11-C0DE-5EA7-ACED-BABB1E70A575",
                    targetPlatform: SqlTargetPlatform.sqlAzure,
                    sdkStyle: false,
                });

                await Project.openProject(projFilePath);
                // Path to the expected tasks.json file - now at workspace level, not inside project folder
                const tasksJsonPath = path.join(projFileDir, ".vscode", "tasks.json");

                // Assert: tasks.json exists at workspace level
                const exists = await utils.exists(tasksJsonPath);
                expect(
                    exists,
                    ".vscode/tasks.json should be created at workspace level when configureDefaultBuild is true",
                ).to.be.true;

                // If exists, check if isDefault is true in any build task
                if (exists) {
                    const tasksJsonContent = await fs.readFile(tasksJsonPath, "utf-8");
                    const tasksJson = JSON.parse(tasksJsonContent);

                    expect(tasksJson.tasks, "tasks.json should contain exactly one task")
                        .to.be.an("array")
                        .with.lengthOf(1);
                    const task = tasksJson.tasks[0];
                    expect(task.group, "Build task should have a group property").to.not.be
                        .undefined;
                    expect(
                        task.group.isDefault,
                        "The build task should have isDefault: true",
                    ).to.equal("true");
                }
            });

            test("Should merge SQL build task into existing tasks.json when it already exists at workspace level", async function (): Promise<void> {
                const projController = new ProjectsController(testContext.outputChannel);
                const projFileDir = await testUtils.generateTestFolderPath(this.test);

                // Create existing tasks.json with a different task
                const vscodeFolder = path.join(projFileDir, ".vscode");
                await fs.mkdir(vscodeFolder, { recursive: true });
                const existingTasksJson = {
                    version: "2.0.0",
                    tasks: [
                        {
                            label: "Existing Task",
                            type: "shell",
                            command: "echo Hello",
                        },
                    ],
                };
                await fs.writeFile(
                    path.join(vscodeFolder, "tasks.json"),
                    JSON.stringify(existingTasksJson, null, "\t"),
                );

                // Mock workspace folder
                const workspaceFolder: vscode.WorkspaceFolder = {
                    uri: vscode.Uri.file(projFileDir),
                    name: "test-workspace",
                    index: 0,
                };
                sinon.stub(vscode.workspace, "getWorkspaceFolder").returns(workspaceFolder);

                // Spy on showInformationMessage to verify notification
                const showInfoSpy = sinon.spy(vscode.window, "showInformationMessage");

                // Act: create a new project with configureDefaultBuild: true
                await projController.createNewProject({
                    newProjName: "TestProjectWithTasks",
                    folderUri: vscode.Uri.file(projFileDir),
                    projectTypeId: constants.emptySqlDatabaseProjectTypeId,
                    configureDefaultBuild: true,
                    projectGuid: "BA5EBA11-C0DE-5EA7-ACED-BABB1E70A575",
                    targetPlatform: SqlTargetPlatform.sqlAzure,
                    sdkStyle: false,
                });

                // Assert: tasks.json now has both tasks
                const tasksJsonPath = path.join(vscodeFolder, "tasks.json");
                const tasksJsonContent = await fs.readFile(tasksJsonPath, "utf-8");
                const tasksJson = JSON.parse(tasksJsonContent);

                expect(tasksJson.tasks, "tasks.json should contain both existing and new tasks")
                    .to.be.an("array")
                    .with.lengthOf(2);
                expect(tasksJson.tasks[0].label, "Existing task should be preserved").to.equal(
                    "Existing Task",
                );
                expect(tasksJson.tasks[1].label, "SQL build task should be added").to.equal(
                    "Build",
                );

                // Assert: notification was shown
                expect(
                    showInfoSpy,
                    "Should show notification when updating existing tasks.json",
                ).to.have.been.calledWith(constants.updatingExistingTasksJson);
            });

            async function verifyFolderAdded(
                folderName: string,
                projController: ProjectsController,
                project: Project,
                node: BaseProjectTreeItem,
            ): Promise<void> {
                const beforeFolderCount = project.folders.length;
                let beforeFolders = project.folders.map((f) => f.relativePath);
                sinon.stub(vscode.window, "showInputBox").resolves(folderName);
                sinon.stub(utils, "sanitizeStringForFilename").returns(folderName);
                await projController.addFolderPrompt(createWorkspaceTreeItem(node));

                // reload project
                project = await Project.openProject(project.projectFilePath);
                expect(
                    project.folders.length,
                    `Folder count should be increased by one after adding the folder ${folderName}. before folders: ${JSON.stringify(beforeFolders)}/n after folders: ${JSON.stringify(project.sqlObjectScripts.map((f) => f.relativePath))}`,
                ).to.equal(beforeFolderCount + 1);
                sinon.restore();
                restubServices(utils, testContext.dacFxService);
            }

            async function verifyFolderNotAdded(
                folderName: string,
                projController: ProjectsController,
                project: Project,
                node: BaseProjectTreeItem,
            ): Promise<void> {
                const beforeFileCount = project.folders.length;
                const showInputBoxStub = sinon
                    .stub(vscode.window, "showInputBox")
                    .resolves(folderName);
                const showErrorMessageSpy = sinon.spy(vscode.window, "showErrorMessage");
                await projController.addFolderPrompt(createWorkspaceTreeItem(node));
                expect(showErrorMessageSpy, "showErrorMessage should have been called exactly once")
                    .to.have.been.calledOnce;
                const msg = constants.folderAlreadyExists(folderName);
                expect(
                    showErrorMessageSpy,
                    `showErrorMessage not called with expected message '${msg}' Actual '${showErrorMessageSpy.getCall(0).args[0]}'`,
                ).to.have.been.calledWith(msg);
                expect(
                    project.folders.length,
                    "File count should be the same as before the folder was attempted to be added",
                ).to.equal(beforeFileCount);
                showInputBoxStub.restore();
                showErrorMessageSpy.restore();
            }

            // TODO: move test to DacFx and fix delete
            test.skip("Should delete nested ProjectEntry from node", async function (): Promise<void> {
                let proj = await testUtils.createTestProject(
                    this.test,
                    templates.newSqlProjectTemplate,
                );

                const setupResult = await setupDeleteExcludeTest(proj);
                const scriptEntry = setupResult[0],
                    projTreeRoot = setupResult[1],
                    preDeployEntry = setupResult[2],
                    postDeployEntry = setupResult[3],
                    noneEntry = setupResult[4];

                const projController = new ProjectsController(testContext.outputChannel);

                await projController.delete(
                    createWorkspaceTreeItem(
                        projTreeRoot.children.find((x) => x.friendlyName === "UpperFolder")!
                            .children[0],
                    ) /* LowerFolder */,
                );
                await projController.delete(
                    createWorkspaceTreeItem(
                        projTreeRoot.children.find((x) => x.friendlyName === "anotherScript.sql")!,
                    ),
                );
                await projController.delete(
                    createWorkspaceTreeItem(
                        projTreeRoot.children.find(
                            (x) => x.friendlyName === "Script.PreDeployment1.sql",
                        )!,
                    ),
                );
                await projController.delete(
                    createWorkspaceTreeItem(
                        projTreeRoot.children.find(
                            (x) => x.friendlyName === "Script.PreDeployment2.sql",
                        )!,
                    ),
                );
                await projController.delete(
                    createWorkspaceTreeItem(
                        projTreeRoot.children.find(
                            (x) => x.friendlyName === "Script.PostDeployment1.sql",
                        )!,
                    ),
                );

                proj = await Project.openProject(proj.projectFilePath); // reload edited sqlproj from disk

                // confirm result
                expect(proj.sqlObjectScripts.length, "number of file entries").to.equal(3); // lowerEntry and the contained scripts should be deleted
                expect(proj.folders[0].relativePath, "First folder should be UpperFolder").to.equal(
                    "UpperFolder",
                );
                expect(
                    proj.preDeployScripts.length,
                    "Pre Deployment scripts should have been deleted",
                ).to.equal(0);
                expect(
                    proj.postDeployScripts.length,
                    "Post Deployment scripts should have been deleted",
                ).to.equal(0);
                expect(
                    proj.noneDeployScripts.length,
                    "None file should have been deleted",
                ).to.equal(0);

                expect(
                    await utils.exists(scriptEntry.fsUri.fsPath),
                    "script is supposed to be deleted",
                ).to.equal(false);
                expect(
                    await utils.exists(preDeployEntry.fsUri.fsPath),
                    "pre-deployment script is supposed to be deleted",
                ).to.equal(false);
                expect(
                    await utils.exists(postDeployEntry.fsUri.fsPath),
                    "post-deployment script is supposed to be deleted",
                ).to.equal(false);
                expect(
                    await utils.exists(noneEntry.fsUri.fsPath),
                    "none entry pre-deployment script is supposed to be deleted",
                ).to.equal(false);
            });

            test("Should delete database references", async function (): Promise<void> {
                // setup - openProject baseline has a system db reference to master
                let proj = await testUtils.createTestProject(
                    this.test,
                    baselines.openProjectFileBaseline,
                );
                const projController = new ProjectsController(testContext.outputChannel);
                sinon
                    .stub(vscode.window, "showWarningMessage")
                    .returns(<any>Promise.resolve(constants.yesString));

                // add dacpac reference
                await proj.addDatabaseReference({
                    dacpacFileLocation: vscode.Uri.file("test2.dacpac"),
                    databaseName: "test2DbName",
                    databaseVariable: "test2Db",
                    suppressMissingDependenciesErrors: false,
                });

                // add project reference
                await proj.addProjectReference({
                    projectName: "project1",
                    projectGuid: "",
                    projectRelativePath: vscode.Uri.file(
                        path.join("..", "project1", "project1.sqlproj"),
                    ),
                    suppressMissingDependenciesErrors: false,
                });

                const projTreeRoot = new ProjectRootTreeItem(proj);
                expect(
                    proj.databaseReferences.length,
                    "Should start with 3 database references",
                ).to.equal(3);

                const databaseReferenceNodeChildren = projTreeRoot.children.find(
                    (x) => x.friendlyName === constants.databaseReferencesNodeName,
                )?.children;
                await projController.delete(
                    createWorkspaceTreeItem(
                        databaseReferenceNodeChildren?.find((x) => x.friendlyName === "master")!,
                    ),
                ); // system db reference
                await projController.delete(
                    createWorkspaceTreeItem(
                        databaseReferenceNodeChildren?.find((x) => x.friendlyName === "test2")!,
                    ),
                ); // dacpac reference
                await projController.delete(
                    createWorkspaceTreeItem(
                        databaseReferenceNodeChildren?.find((x) => x.friendlyName === "project1")!,
                    ),
                ); // project reference

                // confirm result
                // reload project
                proj = await Project.openProject(proj.projectFilePath);
                expect(
                    proj.databaseReferences.length,
                    "All database references should have been deleted",
                ).to.equal(0);
            });

            test("Should exclude nested ProjectEntry from node", async function (): Promise<void> {
                let proj = await testUtils.createTestSqlProject(this.test);
                const setupResult = await setupDeleteExcludeTest(proj);
                const scriptEntry = setupResult[0],
                    projTreeRoot = setupResult[1],
                    preDeployEntry = setupResult[2],
                    postDeployEntry = setupResult[3],
                    noneEntry = setupResult[4];

                const projController = new ProjectsController(testContext.outputChannel);

                await projController.exclude(
                    createWorkspaceTreeItem(
                        <FolderNode>(
                            projTreeRoot.children.find((x) => x.friendlyName === "UpperFolder")!
                                .children[0]
                        ),
                    ) /* LowerFolder */,
                );
                await projController.exclude(
                    createWorkspaceTreeItem(
                        <FileNode>(
                            projTreeRoot.children.find(
                                (x) => x.friendlyName === "anotherScript.sql",
                            )!
                        ),
                    ),
                );
                await projController.exclude(
                    createWorkspaceTreeItem(
                        <FileNode>(
                            projTreeRoot.children.find(
                                (x) => x.friendlyName === "Script.PreDeployment1.sql",
                            )!
                        ),
                    ),
                );
                await projController.exclude(
                    createWorkspaceTreeItem(
                        <FileNode>(
                            projTreeRoot.children.find(
                                (x) => x.friendlyName === "Script.PreDeployment2.sql",
                            )!
                        ),
                    ),
                );
                await projController.exclude(
                    createWorkspaceTreeItem(
                        <FileNode>(
                            projTreeRoot.children.find(
                                (x) => x.friendlyName === "Script.PostDeployment1.sql",
                            )!
                        ),
                    ),
                );

                proj = await Project.openProject(proj.projectFilePath); // reload edited sqlproj from disk

                // confirm result
                expect(proj.sqlObjectScripts.length, "number of file entries").to.equal(0); // LowerFolder and the contained scripts should be excluded
                expect(
                    proj.folders.find((f) => f.relativePath === "UpperFolder"),
                    "UpperFolder should still be there",
                ).to.not.equal(undefined);
                expect(proj.preDeployScripts.length, "Pre deployment scripts").to.equal(0);
                expect(proj.postDeployScripts.length, "Post deployment scripts").to.equal(0);
                expect(proj.noneDeployScripts.length, "None files").to.equal(0);

                expect(
                    await utils.exists(scriptEntry.fsUri.fsPath),
                    "script is supposed to still exist on disk",
                ).to.equal(true);
                expect(
                    await utils.exists(preDeployEntry.fsUri.fsPath),
                    "pre-deployment script is supposed to still exist on disk",
                ).to.equal(true);
                expect(
                    await utils.exists(postDeployEntry.fsUri.fsPath),
                    "post-deployment script is supposed to still exist on disk",
                ).to.equal(true);
                expect(
                    await utils.exists(noneEntry.fsUri.fsPath),
                    "none entry pre-deployment script is supposed to still exist on disk",
                ).to.equal(true);
            });

            test("Should exclude a folder", async function (): Promise<void> {
                let proj = await testUtils.createTestSqlProject(this.test);
                await proj.addScriptItem("SomeFolder/MyTable.sql", "CREATE TABLE [NotARealTable]");

                const projController = new ProjectsController(testContext.outputChannel);
                const projTreeRoot = new ProjectRootTreeItem(proj);

                expect(
                    await utils.exists(path.join(proj.projectFolderPath, "SomeFolder/MyTable.sql")),
                    "MyTable.sql should exist on disk before exclusion",
                ).to.be.true;
                expect(proj.sqlObjectScripts.length, "Starting number of scripts").to.equal(1);
                expect(proj.folders.length, "Starting number of folders").to.equal(1);

                // exclude folder
                const folderNode = projTreeRoot.children.find(
                    (f) => f.friendlyName === "SomeFolder",
                );
                await projController.exclude(createWorkspaceTreeItem(folderNode!));

                // reload project and verify files were renamed
                proj = await Project.openProject(proj.projectFilePath);

                expect(
                    await utils.exists(
                        path.join(proj.projectFolderPath, "SomeFolder", "MyTable.sql"),
                    ),
                    "MyTable.sql should still exist on disk after exclusion",
                ).to.be.true;
                expect(
                    proj.sqlObjectScripts.length,
                    "Number of scripts should not have changed",
                ).to.equal(0);
                expect(proj.folders.length, "Number of folders should not have changed").to.equal(
                    0,
                );
            });

            // TODO: move test to DacFx and fix delete
            test.skip("Should delete folders with excluded items", async function (): Promise<void> {
                let proj = await testUtils.createTestProject(
                    this.test,
                    templates.newSqlProjectTemplate,
                );
                const setupResult = await setupDeleteExcludeTest(proj);

                const scriptEntry = setupResult[0],
                    projTreeRoot = setupResult[1];
                const upperFolder = projTreeRoot.children.find(
                    (x) => x.friendlyName === "UpperFolder",
                )!;
                const lowerFolder = upperFolder.children.find(
                    (x) => x.friendlyName === "LowerFolder",
                )!;

                const projController = new ProjectsController(testContext.outputChannel);

                // Exclude files under LowerFolder
                await projController.exclude(
                    createWorkspaceTreeItem(
                        <FileNode>(
                            lowerFolder.children.find((x) => x.friendlyName === "someScript.sql")!
                        ),
                    ),
                );
                await projController.exclude(
                    createWorkspaceTreeItem(
                        <FileNode>(
                            lowerFolder.children.find(
                                (x) => x.friendlyName === "someOtherScript.sql",
                            )!
                        ),
                    ),
                );

                // Delete UpperFolder
                await projController.delete(
                    createWorkspaceTreeItem(
                        <FolderNode>(
                            projTreeRoot.children.find((x) => x.friendlyName === "UpperFolder")!
                        ),
                    ),
                );

                // Reload edited sqlproj from disk
                proj = await Project.openProject(proj.projectFilePath);

                // Confirm result
                expect(
                    proj.sqlObjectScripts.some((x) => x.relativePath === "UpperFolder"),
                    "UpperFolder should not be part of proj file any more",
                ).to.equal(false);
                expect(
                    await utils.exists(scriptEntry.fsUri.fsPath),
                    "script is supposed to be deleted from disk",
                ).to.equal(false);
                expect(
                    await utils.exists(lowerFolder.relativeProjectUri.fsPath),
                    "LowerFolder is supposed to be deleted from disk",
                ).to.equal(false);
                expect(
                    await utils.exists(upperFolder.relativeProjectUri.fsPath),
                    "UpperFolder is supposed to be deleted from disk",
                ).to.equal(false);
            });

            test("Should reload correctly after changing sqlproj file", async function (): Promise<void> {
                // create project
                const folderPath = await testUtils.generateTestFolderPath(this.test);
                const sqlProjPath = await testUtils.createTestSqlProjFile(
                    this.test,
                    baselines.newProjectFileBaseline,
                    folderPath,
                );
                const treeProvider = new SqlDatabaseProjectTreeViewProvider();
                const projController = new ProjectsController(testContext.outputChannel);
                let project = await Project.openProject(vscode.Uri.file(sqlProjPath).fsPath);
                treeProvider.load([project]);

                // change the sql project file
                await fs.writeFile(sqlProjPath, baselines.newProjectFileWithScriptBaseline);
                expect(
                    project.sqlObjectScripts.length,
                    "Project should have no scripts before reload",
                ).to.equal(0);

                // call reload project
                const projTreeRoot = new ProjectRootTreeItem(project);
                await projController.reloadProject(createWorkspaceTreeItem(projTreeRoot));
                // calling this because this gets called in the projectProvider.getProjectTreeDataProvider(), which is called by workspaceTreeDataProvider
                // when notifyTreeDataChanged() happens
                // reload project
                project = await Project.openProject(sqlProjPath, false, true);
                treeProvider.load([project]);

                // check that the new project is in the tree
                expect(
                    project.sqlObjectScripts.length,
                    "Project should have one script after reload",
                ).to.equal(1);
                expect(
                    treeProvider
                        .getChildren()[0]
                        .children.find((c) => c.friendlyName === "Script1.sql"),
                    "Script1.sql should be present in the tree after reload",
                ).to.not.equal(undefined);
            });

            test("Should be able to add pre deploy and post deploy script", async function (): Promise<void> {
                const preDeployScriptName = "PreDeployScript1.sql";
                const postDeployScriptName = "PostDeployScript1.sql";

                const projController = new ProjectsController(testContext.outputChannel);
                const project = await testUtils.createTestProject(
                    this.test,
                    baselines.newProjectFileBaseline,
                );

                sinon.stub(vscode.window, "showInputBox").resolves(preDeployScriptName);
                sinon.stub(utils, "sanitizeStringForFilename").returns(preDeployScriptName);
                expect(
                    project.preDeployScripts.length,
                    "There should be no pre deploy scripts",
                ).to.equal(0);
                await projController.addItemPrompt(project, "", {
                    itemType: ItemType.preDeployScript,
                });
                expect(
                    project.preDeployScripts.length,
                    `Pre deploy script should be successfully added. ${project.preDeployScripts.length}, ${project.sqlObjectScripts.length}`,
                ).to.equal(1);

                sinon.restore();
                restubServices(utils, testContext.dacFxService);
                sinon.stub(vscode.window, "showInputBox").resolves(postDeployScriptName);
                sinon.stub(utils, "sanitizeStringForFilename").returns(postDeployScriptName);
                expect(
                    project.postDeployScripts.length,
                    "There should be no post deploy scripts",
                ).to.equal(0);
                await projController.addItemPrompt(project, "", {
                    itemType: ItemType.postDeployScript,
                });
                expect(
                    project.postDeployScripts.length,
                    "Post deploy script should be successfully added",
                ).to.equal(1);
            });

            test("Should be able to add publish profile", async function (): Promise<void> {
                const publishProfileName = "profile.publish.xml";

                const projController = new ProjectsController(testContext.outputChannel);
                const project = await testUtils.createTestProject(
                    this.test,
                    baselines.newProjectFileBaseline,
                );

                sinon.stub(vscode.window, "showInputBox").resolves(publishProfileName);
                sinon.stub(utils, "sanitizeStringForFilename").returns(publishProfileName);
                expect(
                    project.publishProfiles.length,
                    "There should be no publish profiles",
                ).to.equal(0);
                await projController.addItemPrompt(project, "", {
                    itemType: ItemType.publishProfile,
                });
                expect(
                    project.publishProfiles.length,
                    "Publish profile should be successfully added.",
                ).to.equal(1);
            });

            test("Should change target platform", async function (): Promise<void> {
                sinon
                    .stub(vscode.window, "showQuickPick")
                    .resolves({ label: SqlTargetPlatform.sqlAzure });

                const projController = new ProjectsController(testContext.outputChannel);
                const sqlProjPath = await testUtils.createTestSqlProjFile(
                    this.test,
                    baselines.openProjectFileBaseline,
                );
                const project = await Project.openProject(sqlProjPath);
                expect(
                    project.getProjectTargetVersion(),
                    "Initial target version should be SQL Server 2019",
                ).to.equal(constants.targetPlatformToVersion.get(SqlTargetPlatform.sqlServer2019));
                expect(
                    project.databaseReferences.length,
                    "Project should have one database reference to master",
                ).to.equal(1);

                await projController.changeTargetPlatform(project);
                expect(
                    project.getProjectTargetVersion(),
                    "Target version should be updated to SQL Azure after change",
                ).to.equal(constants.targetPlatformToVersion.get(SqlTargetPlatform.sqlAzure));
            });
        });
    });

    suite("Create project from database operations and dialog", function (): void {
        teardown(() => {
            sinon.restore();
        });

        test("Should create list of all files and folders correctly", async function (): Promise<void> {
            // dummy structure is 2 files (one .sql, one .txt) under parent folder + 2 directories with 5 .sql scripts each
            const testFolderPath = await testUtils.createDummyFileStructure(this.test);

            const projController = new ProjectsController(testContext.outputChannel);
            const fileList = await projController.generateScriptList(testFolderPath);

            // script list should only include the .sql files, no folders and not the .txt file
            expect(fileList.length, "number of files returned by generateScriptList()").to.equal(
                11,
            );
            expect(
                fileList.filter((x) => path.extname(x.fsPath) !== constants.sqlFileExtension)
                    .length,
                "number of non-.sql files",
            ).to.equal(0);
        });

        test("Should error out for inaccessible path", async function (): Promise<void> {
            const spy = sinon.spy(vscode.window, "showErrorMessage");

            let testFolderPath = await testUtils.generateTestFolderPath(this.test);
            testFolderPath += "_nonexistentFolder"; // Modify folder path to point to a nonexistent location

            const projController = new ProjectsController(testContext.outputChannel);

            await projController.generateScriptList(testFolderPath);
            expect(spy, "showErrorMessage should have been called").to.have.been.calledOnce;
            const msg = constants.cannotResolvePath(testFolderPath);
            expect(
                spy,
                `showErrorMessage not called with expected message '${msg}' Actual '${spy.getCall(0).args[0]}'`,
            ).to.have.been.calledWith(msg);
        });

        test("Should set model filePath correctly for ExtractType = File", async function (): Promise<void> {
            let folderPath = await testUtils.generateTestFolderPath(this.test);
            let projectName = "My Project";
            let importPath;
            let model: ImportDataModel = {
                connectionUri: "My Id",
                database: "My Database",
                projName: projectName,
                filePath: folderPath,
                version: "1.0.0.0",
                extractTarget: mssql.ExtractTarget["file"],
                sdkStyle: false,
            };

            const projController = new ProjectsController(testContext.outputChannel);
            projController.setFilePath(model);
            importPath = model.filePath;

            expect(
                importPath.toUpperCase(),
                `model.filePath should be set to a specific file for ExtractTarget === file, but was ${importPath}`,
            ).to.equal(
                vscode.Uri.file(path.join(folderPath, projectName + ".sql")).fsPath.toUpperCase(),
            );
        });

        test("Should set model filePath correctly for ExtractType = Schema/Object Type", async function (): Promise<void> {
            let folderPath = await testUtils.generateTestFolderPath(this.test);
            let projectName = "My Project";
            let importPath;
            let model: ImportDataModel = {
                connectionUri: "My Id",
                database: "My Database",
                projName: projectName,
                filePath: folderPath,
                version: "1.0.0.0",
                extractTarget: mssql.ExtractTarget["schemaObjectType"],
                sdkStyle: false,
            };

            const projController = new ProjectsController(testContext.outputChannel);
            projController.setFilePath(model);
            importPath = model.filePath;

            expect(
                importPath.toUpperCase(),
                `model.filePath should be set to a folder for ExtractTarget !== file, but was ${importPath}`,
            ).to.equal(vscode.Uri.file(path.join(folderPath)).fsPath.toUpperCase());
        });
    });

    suite("AutoRest generation", function (): void {
        // skipping for now because this feature is hidden under preview flag
        test.skip("Should create project from autorest-generated files", async function (): Promise<void> {
            const parentFolder = await testUtils.generateTestFolderPath(this.test);
            await testUtils.createDummyFileStructure(this.test);
            const specName = "DummySpec.yaml";
            const renamedProjectName = "RenamedProject";
            const newProjFolder = path.join(parentFolder, renamedProjectName);
            let fileList: vscode.Uri[] = [];

            const projController = sinon.createStubInstance(ProjectsController);

            projController.selectAutorestSpecFile.resolves(specName);
            projController.selectAutorestProjectLocation.callsFake(async () => {
                await fs.mkdir(newProjFolder);

                return {
                    newProjectFolder: newProjFolder,
                    outputFolder: parentFolder,
                    projectName: renamedProjectName,
                };
            });

            projController.generateAutorestFiles.callsFake(async () => {
                await testUtils.createDummyFileStructure(this.test, true, fileList, newProjFolder);
                await testUtils.createTestFile(
                    this.test,
                    "SELECT 'This is a post-deployment script'",
                    constants.autorestPostDeploymentScriptName,
                    newProjFolder,
                );
                return "some dummy console output";
            });

            projController.promptForAutorestProjectName.resolves(renamedProjectName);
            projController.openProjectInWorkspace.resolves();

            const project = (await projController.generateProjectFromOpenApiSpec())!;

            expect(
                project.projectFileName,
                "Project file name should match the renamed project name",
            ).to.equal(renamedProjectName);
            expect(
                project.projectFolderPath.endsWith(renamedProjectName),
                `Expected: '${project.projectFolderPath}' to include '${renamedProjectName}'`,
            ).to.be.true;

            expect(
                project.postDeployScripts.length,
                `Expected 1 post-deployment script, got ${project?.postDeployScripts.length}`,
            ).to.equal(1);
            const actual = path.basename(project.postDeployScripts[0].fsUri.fsPath);
            expect(
                actual,
                `Unexpected post-deployment script name: ${actual}, expected ${constants.autorestPostDeploymentScriptName}`,
            ).to.equal(constants.autorestPostDeploymentScriptName);

            const expectedScripts = fileList.filter((f) => path.extname(f.fsPath) === ".sql");
            expect(
                project.sqlObjectScripts.filter((f) => f.type === EntryType.File).length,
                "Unexpected number of scripts in project",
            ).to.equal(expectedScripts.length);

            const expectedFolders = fileList.filter(
                (f) =>
                    path.extname(f.fsPath) === "" &&
                    f.fsPath.toUpperCase() !== newProjFolder.toUpperCase(),
            );
            expect(
                project.sqlObjectScripts.filter((f) => f.type === EntryType.Folder).length,
                "Unexpected number of folders in project",
            ).to.equal(expectedFolders.length);
        });
    });

    suite("Move file", function (): void {
        test("Should move a file to another folder", async function (): Promise<void> {
            const spy = sinon.spy(vscode.window, "showErrorMessage");
            sinon
                .stub(vscode.window, "showWarningMessage")
                .returns(<any>Promise.resolve(constants.move));

            let proj = await testUtils.createTestProject(
                this.test,
                baselines.openSdkStyleSqlProjectBaseline,
            );

            const projTreeRoot = await setupMoveTest(proj);

            const projController = new ProjectsController(testContext.outputChannel);

            // try to move a file from the root folder into the UpperFolder
            const sqlFileNode = projTreeRoot.children.find((x) => x.friendlyName === "script1.sql");
            const folderWorkspaceTreeItem = createWorkspaceTreeItem(
                projTreeRoot.children.find((x) => x.friendlyName === "UpperFolder")!,
            );
            await projController.moveFile(
                vscode.Uri.file(proj.projectFilePath),
                sqlFileNode,
                folderWorkspaceTreeItem,
            );

            expect(spy, "showErrorMessage should not have been called").to.not.have.been.called;

            // reload project and verify file was moved
            proj = await Project.openProject(proj.projectFilePath);
            expect(
                proj.sqlObjectScripts.find((f) => f.relativePath === "UpperFolder\\script1.sql") !==
                    undefined,
                "The file path should have been updated",
            ).to.be.true;
            expect(
                await utils.exists(path.join(proj.projectFolderPath, "UpperFolder", "script1.sql")),
                "The moved file should exist",
            ).to.be.true;
        });

        test("Should move a folder to another folder", async function (): Promise<void> {
            const spy = sinon.spy(vscode.window, "showErrorMessage");
            sinon
                .stub(vscode.window, "showWarningMessage")
                .returns(<any>Promise.resolve(constants.move));

            let proj = await testUtils.createTestProject(
                this.test,
                baselines.newSdkStyleProjectSdkNodeBaseline,
            );

            const projTreeRoot = await setupMoveTest(proj);

            const projController = new ProjectsController(testContext.outputChannel);

            // try to move a child folder to go under the root folder
            const folderNode = projTreeRoot.children.find((x) => x.friendlyName === "folder1");
            const folderWorkspaceTreeItem = createWorkspaceTreeItem(
                projTreeRoot.children.find((x) => x.friendlyName === "UpperFolder")!,
            );
            await projController.moveFile(
                vscode.Uri.file(proj.projectFilePath),
                folderNode,
                folderWorkspaceTreeItem,
            );

            expect(spy, "showErrorMessage should not have been called").to.not.have.been.called;

            // reload project and verify file was moved
            proj = await Project.openProject(proj.projectFilePath);
            expect(
                proj.folders.find((f) => f.relativePath === "UpperFolder\\folder1") !== undefined,
                "The folder path should have been updated",
            ).to.be.true;
        });

        test("Should not allow moving a file to Database References or SQLCMD folder", async function (): Promise<void> {
            const spy = sinon.spy(vscode.window, "showErrorMessage");
            sinon
                .stub(vscode.window, "showWarningMessage")
                .returns(<any>Promise.resolve(constants.move));

            let proj = await testUtils.createTestProject(
                this.test,
                baselines.openSdkStyleSqlProjectBaseline,
            );
            const projTreeRoot = await setupMoveTest(proj);
            const projController = new ProjectsController(testContext.outputChannel);

            const foldersToTest = ["SQLCMD Variables", "Database References"];

            for (const folder of foldersToTest) {
                // try to move a file from the root folder into the UpperFolder
                const sqlFileNode = projTreeRoot.children.find(
                    (x) => x.friendlyName === "script1.sql",
                );
                const sqlCmdVariablesWorkspaceTreeItem = createWorkspaceTreeItem(
                    projTreeRoot.children.find((x) => x.friendlyName === folder)!,
                );
                await projController.moveFile(
                    vscode.Uri.file(proj.projectFilePath),
                    sqlFileNode,
                    sqlCmdVariablesWorkspaceTreeItem,
                );

                // reload project and verify file was not moved
                proj = await Project.openProject(proj.projectFilePath);
                expect(
                    proj.sqlObjectScripts.find((f) => f.relativePath === "script1.sql") !==
                        undefined,
                    `The file path should not have been updated when trying to move script1.sql to ${folder}`,
                ).to.be.true;
                expect(spy, "showErrorMessage should not have been called.").to.not.have.been
                    .called;
                spy.restore();
            }
        });

        test("Should only allow moving files and folders", async function (): Promise<void> {
            const spy = sinon.spy(vscode.window, "showErrorMessage");
            let proj = await testUtils.createTestProject(
                this.test,
                baselines.openSdkStyleSqlProjectBaseline,
            );
            const projTreeRoot = await setupMoveTest(proj);
            const projController = new ProjectsController(testContext.outputChannel);

            // try to move sqlcmd variable
            const sqlcmdVarNode = projTreeRoot.children.find(
                (x) => x.friendlyName === "SQLCMD Variables",
            )!.children[0];
            const projectRootWorkspaceTreeItem = createWorkspaceTreeItem(projTreeRoot);
            await projController.moveFile(
                vscode.Uri.file(proj.projectFilePath),
                sqlcmdVarNode,
                projectRootWorkspaceTreeItem,
            );

            expect(
                spy,
                "showErrorMessage should have been called exactly once when trying to move a sqlcmd variable",
            ).to.have.been.calledOnce;
            expect(
                spy,
                `showErrorMessage not called with expected message '${constants.onlyMoveFilesFoldersSupported}' Actual '${spy.getCall(0).args[0]}'`,
            ).to.have.been.calledWith(constants.onlyMoveFilesFoldersSupported);
            spy.restore();

            // try moving a database reference
            const dbRefNode = projTreeRoot.children.find(
                (x) => x.friendlyName === "Database References",
            )!.children[0];
            await projController.moveFile(
                vscode.Uri.file(proj.projectFilePath),
                dbRefNode,
                projectRootWorkspaceTreeItem,
            );

            expect(
                spy,
                "showErrorMessage should have been called exactly once when trying to move a database reference",
            ).to.have.been.calledOnce;
            expect(
                spy,
                `showErrorMessage not called with expected message '${constants.onlyMoveFilesFoldersSupported}' Actual '${spy.getCall(0).args[0]}'`,
            ).to.have.been.calledWith(constants.onlyMoveFilesFoldersSupported);
            spy.restore();
        });

        test("Should not allow moving files between projects", async function (): Promise<void> {
            const spy = sinon.spy(vscode.window, "showErrorMessage");
            sinon
                .stub(vscode.window, "showWarningMessage")
                .returns(<any>Promise.resolve(constants.move));

            let proj1 = await testUtils.createTestProject(
                this.test,
                baselines.openSdkStyleSqlProjectBaseline,
            );
            let proj2 = await testUtils.createTestProject(
                this.test,
                baselines.openSdkStyleSqlProjectBaseline,
            );

            const projTreeRoot1 = await setupMoveTest(proj1);
            const projTreeRoot2 = await setupMoveTest(proj2);
            const projController = new ProjectsController(testContext.outputChannel);

            // try to move a file from the root folder of proj1 to the UpperFolder of proj2
            const proj1SqlFileNode = projTreeRoot1.children.find(
                (x) => x.friendlyName === "script1.sql",
            );
            const proj2FolderWorkspaceTreeItem = createWorkspaceTreeItem(
                projTreeRoot2.children.find((x) => x.friendlyName === "UpperFolder")!,
            );
            await projController.moveFile(
                vscode.Uri.file(proj1.projectFilePath),
                proj1SqlFileNode,
                proj2FolderWorkspaceTreeItem,
            );

            expect(spy, "showErrorMessage should have been called").to.have.been.called;
            expect(
                spy,
                `showErrorMessage not called with expected message '${constants.movingFilesBetweenProjectsNotSupported}' Actual '${spy.getCall(0).args[0]}'`,
            ).to.have.been.calledWith(constants.movingFilesBetweenProjectsNotSupported);

            // verify script1.sql was not moved
            proj1 = await Project.openProject(proj1.projectFilePath);
            expect(
                proj1.sqlObjectScripts.find((f) => f.relativePath === "script1.sql") !== undefined,
                `The file path should not have been updated when trying to move script1.sql to proj2`,
            ).to.be.true;
        });
    });

    suite("Rename file", function (): void {
        test("Should not do anything if no new name is provided", async function (): Promise<void> {
            sinon.stub(vscode.window, "showInputBox").resolves("");
            let proj = await testUtils.createTestProject(
                this.test,
                baselines.openSdkStyleSqlProjectBaseline,
            );
            const projTreeRoot = await setupMoveTest(proj);
            const projController = new ProjectsController(testContext.outputChannel);

            // try to rename a file from the root folder
            const sqlFileNode = projTreeRoot.children.find((x) => x.friendlyName === "script1.sql");
            await projController.rename(createWorkspaceTreeItem(sqlFileNode!));

            // reload project and verify file was not renamed
            proj = await Project.openProject(proj.projectFilePath);
            expect(
                proj.sqlObjectScripts.find((f) => f.relativePath === "script1.sql") !== undefined,
                "The file path should not have been updated",
            ).to.be.true;
            expect(
                await utils.exists(path.join(proj.projectFolderPath, "script1.sql")),
                "The moved file should exist",
            ).to.be.true;
        });

        test("Should rename a sql object file", async function (): Promise<void> {
            sinon.stub(vscode.window, "showInputBox").resolves("newName.sql");
            let proj = await testUtils.createTestProject(
                this.test,
                baselines.openSdkStyleSqlProjectBaseline,
            );
            const projTreeRoot = await setupMoveTest(proj);
            const projController = new ProjectsController(testContext.outputChannel);

            // try to rename a file from the root folder
            const sqlFileNode = projTreeRoot.children.find((x) => x.friendlyName === "script1.sql");
            await projController.rename(createWorkspaceTreeItem(sqlFileNode!));

            // reload project and verify file was renamed
            proj = await Project.openProject(proj.projectFilePath);
            expect(
                proj.sqlObjectScripts.find((f) => f.relativePath === "newName.sql") !== undefined,
                "The file path should have been updated",
            ).to.be.true;
            expect(
                await utils.exists(path.join(proj.projectFolderPath, "newName.sql")),
                "The moved file should exist",
            ).to.be.true;
        });

        test("Should rename a pre and post deploy script", async function (): Promise<void> {
            let proj = await testUtils.createTestProject(
                this.test,
                baselines.newSdkStyleProjectSdkNodeBaseline,
            );
            await proj.addScriptItem(
                "Script.PreDeployment1.sql",
                "pre-deployment stuff",
                ItemType.preDeployScript,
            );
            await proj.addScriptItem(
                "Script.PostDeployment1.sql",
                "post-deployment stuff",
                ItemType.postDeployScript,
            );

            const projController = new ProjectsController(testContext.outputChannel);
            const projTreeRoot = new ProjectRootTreeItem(proj);

            // try to rename a file from the root folder
            sinon.stub(vscode.window, "showInputBox").resolves("predeployNewName.sql");
            const preDeployScriptNode = projTreeRoot.children.find(
                (x) => x.friendlyName === "Script.PreDeployment1.sql",
            );
            await projController.rename(createWorkspaceTreeItem(preDeployScriptNode!));

            sinon.restore();
            restubServices(utils, testContext.dacFxService);
            sinon.stub(vscode.window, "showInputBox").resolves("postdeployNewName.sql");
            const postDeployScriptNode = projTreeRoot.children.find(
                (x) => x.friendlyName === "Script.PostDeployment1.sql",
            );
            await projController.rename(createWorkspaceTreeItem(postDeployScriptNode!));

            // reload project and verify files were renamed
            proj = await Project.openProject(proj.projectFilePath);
            expect(
                proj.preDeployScripts.find((f) => f.relativePath === "predeployNewName.sql") !==
                    undefined,
                "The pre deploy script file path should have been updated",
            ).to.be.true;
            expect(
                await utils.exists(path.join(proj.projectFolderPath, "predeployNewName.sql")),
                "The moved pre deploy script file should exist",
            ).to.be.true;

            expect(
                proj.postDeployScripts.find((f) => f.relativePath === "postdeployNewName.sql") !==
                    undefined,
                "The post deploy script file path should have been updated",
            ).to.be.true;
            expect(
                await utils.exists(path.join(proj.projectFolderPath, "postdeployNewName.sql")),
                "The moved post deploy script file should exist",
            ).to.be.true;
        });

        test("Should rename a folder", async function (): Promise<void> {
            let proj = await testUtils.createTestSqlProject(this.test);
            await proj.addScriptItem("SomeFolder/MyTable.sql", "CREATE TABLE [NotARealTable]");

            const projController = new ProjectsController(testContext.outputChannel);
            const projTreeRoot = new ProjectRootTreeItem(proj);

            sinon.stub(vscode.window, "showInputBox").resolves("RenamedFolder");
            expect(
                await utils.exists(path.join(proj.projectFolderPath, "SomeFolder", "MyTable.sql")),
                "File should exist in original location",
            ).to.be.true;
            expect(proj.sqlObjectScripts.length, "Starting number of scripts").to.equal(1);
            expect(proj.folders.length, "Starting number of folders").to.equal(1);

            // rename folder
            const folderNode = projTreeRoot.children.find((f) => f.friendlyName === "SomeFolder");
            await projController.rename(createWorkspaceTreeItem(folderNode!));

            // reload project and verify files were renamed
            proj = await Project.openProject(proj.projectFilePath);

            expect(
                await utils.exists(
                    path.join(proj.projectFolderPath, "RenamedFolder", "MyTable.sql"),
                ),
                "File should exist in new location",
            ).to.be.true;
            expect(
                proj.sqlObjectScripts.length,
                "Number of scripts should not have changed",
            ).to.equal(1);
            expect(proj.folders.length, "Number of folders should not have changed").to.equal(1);
            expect(
                proj.folders.find((f) => f.relativePath === "RenamedFolder") !== undefined,
                "The folder path should have been updated",
            ).to.be.true;
            expect(
                proj.sqlObjectScripts.find(
                    (f) => f.relativePath === "RenamedFolder\\MyTable.sql",
                ) !== undefined,
                "Path of the script in the folder should have been updated",
            ).to.be.true;
        });
    });

    suite("SqlCmd Variables", function (): void {
        test("Should delete sqlcmd variable", async function (): Promise<void> {
            let project = await testUtils.createTestProject(
                this.test,
                baselines.openSdkStyleSqlProjectBaseline,
            );
            const sqlProjectsService = await utils.getSqlProjectsService();
            await sqlProjectsService.openProject(project.projectFilePath);

            const projController = new ProjectsController(testContext.outputChannel);
            const projRoot = new ProjectRootTreeItem(project);

            expect(
                project.sqlCmdVariables.size,
                "The project should start with 2 sqlcmd variables",
            ).to.equal(2);

            sinon.stub(vscode.window, "showWarningMessage").returns(<any>Promise.resolve("Cancel"));
            await projController.delete(
                createWorkspaceTreeItem(
                    projRoot.children.find(
                        (x) => x.friendlyName === constants.sqlcmdVariablesNodeName,
                    )!.children[0] /* LowerFolder */,
                ),
            );

            // reload project
            project = await Project.openProject(project.projectFilePath);
            expect(
                project.sqlCmdVariables.size,
                "The project should still have 2 sqlcmd variables if no was selected",
            ).to.equal(2);

            sinon.restore();
            restubServices(utils, testContext.dacFxService);
            sinon.stub(vscode.window, "showWarningMessage").returns(<any>Promise.resolve("Yes"));
            await projController.delete(
                createWorkspaceTreeItem(
                    projRoot.children.find(
                        (x) => x.friendlyName === constants.sqlcmdVariablesNodeName,
                    )!.children[0],
                ),
            );

            // reload project
            project = await Project.openProject(project.projectFilePath);
            expect(
                project.sqlCmdVariables.size,
                "The project should only have 1 sqlcmd variable after deletion",
            ).to.equal(1);
        });

        test("Should add sqlcmd variable", async function (): Promise<void> {
            let project = await testUtils.createTestProject(
                this.test,
                baselines.openSdkStyleSqlProjectBaseline,
            );
            const sqlProjectsService = await utils.getSqlProjectsService();
            await sqlProjectsService.openProject(project.projectFilePath);

            const projController = new ProjectsController(testContext.outputChannel);
            const projRoot = new ProjectRootTreeItem(project);

            expect(
                project.sqlCmdVariables.size,
                "The project should start with 2 sqlcmd variables",
            ).to.equal(2);

            const inputBoxStub = sinon.stub(vscode.window, "showInputBox");
            inputBoxStub.resolves("");
            await projController.addSqlCmdVariable(
                createWorkspaceTreeItem(
                    projRoot.children.find(
                        (x) => x.friendlyName === constants.sqlcmdVariablesNodeName,
                    )!,
                ),
            );

            // reload project
            project = await Project.openProject(project.projectFilePath);
            expect(
                project.sqlCmdVariables.size,
                "The project should still have 2 sqlcmd variables if no name was provided",
            ).to.equal(2);

            inputBoxStub.reset();
            inputBoxStub.onFirstCall().resolves("newVariable");
            inputBoxStub.onSecondCall().resolves("testValue");
            await projController.addSqlCmdVariable(
                createWorkspaceTreeItem(
                    projRoot.children.find(
                        (x) => x.friendlyName === constants.sqlcmdVariablesNodeName,
                    )!,
                ),
            );

            // reload project
            project = await Project.openProject(project.projectFilePath);
            expect(
                project.sqlCmdVariables.size,
                "The project should have 3 sqlcmd variable after adding a new one",
            ).to.equal(3);
        });

        test("Should add sqlcmd variable without DefaultValue", async function (): Promise<void> {
            let project = await testUtils.createTestProject(
                this.test,
                baselines.openSdkStyleSqlProjectBaseline,
            );
            const sqlProjectsService = await utils.getSqlProjectsService();
            await sqlProjectsService.openProject(project.projectFilePath);

            const projController = new ProjectsController(testContext.outputChannel);
            const projRoot = new ProjectRootTreeItem(project);

            expect(
                project.sqlCmdVariables.size,
                "The project should start with 2 sqlcmd variables",
            ).to.equal(2);

            const inputBoxStub = sinon.stub(vscode.window, "showInputBox");
            inputBoxStub.onFirstCall().resolves("newVariable");
            inputBoxStub.onSecondCall().resolves(undefined);
            const infoMessageStub = sinon.stub(vscode.window, "showInformationMessage");
            infoMessageStub.onFirstCall().returns(<any>Promise.resolve(constants.noString));
            await projController.addSqlCmdVariable(
                createWorkspaceTreeItem(
                    projRoot.children.find(
                        (x) => x.friendlyName === constants.sqlcmdVariablesNodeName,
                    )!,
                ),
            );

            // reload project
            project = await Project.openProject(project.projectFilePath);
            expect(
                project.sqlCmdVariables.size,
                "The project should still have 2 sqlcmd variables if no was selected for adding sqlcmd variable without a DefaultValue",
            ).to.equal(2);

            inputBoxStub.reset();
            inputBoxStub.onFirstCall().resolves("newVariable");
            inputBoxStub.onSecondCall().resolves(undefined);
            infoMessageStub.onSecondCall().returns(<any>Promise.resolve(constants.yesString));
            await projController.addSqlCmdVariable(
                createWorkspaceTreeItem(
                    projRoot.children.find(
                        (x) => x.friendlyName === constants.sqlcmdVariablesNodeName,
                    )!,
                ),
            );

            // reload project
            project = await Project.openProject(project.projectFilePath);
            expect(
                project.sqlCmdVariables.size,
                "The project should have 3 sqlcmd variable after adding a new one without a DefaultValue",
            ).to.equal(3);
            expect(
                project.sqlCmdVariables.get("newVariable"),
                "The default value of newVariable should be an empty string",
            ).to.equal("");
        });

        test("Should update sqlcmd variable", async function (): Promise<void> {
            let project = await testUtils.createTestProject(
                this.test,
                baselines.openSdkStyleSqlProjectBaseline,
            );
            const sqlProjectsService = await utils.getSqlProjectsService();
            await sqlProjectsService.openProject(project.projectFilePath);

            const projController = new ProjectsController(testContext.outputChannel);
            const projRoot = new ProjectRootTreeItem(project);

            expect(
                project.sqlCmdVariables.size,
                "The project should start with 2 sqlcmd variables",
            ).to.equal(2);

            const inputBoxStub = sinon.stub(vscode.window, "showInputBox");
            inputBoxStub.resolves("");
            const sqlcmdVarToUpdate = projRoot.children.find(
                (x) => x.friendlyName === constants.sqlcmdVariablesNodeName,
            )!.children[0];
            const originalValue = project.sqlCmdVariables.get(sqlcmdVarToUpdate.friendlyName);
            await projController.editSqlCmdVariable(createWorkspaceTreeItem(sqlcmdVarToUpdate));

            // reload project
            project = await Project.openProject(project.projectFilePath);
            expect(
                project.sqlCmdVariables.size,
                "The project should still have 2 sqlcmd variables",
            ).to.equal(2);
            expect(
                project.sqlCmdVariables.get(sqlcmdVarToUpdate.friendlyName),
                "The value of the sqlcmd variable should not have changed",
            ).to.equal(originalValue);

            inputBoxStub.reset();
            const updatedValue = "newValue";
            inputBoxStub.resolves(updatedValue);
            await projController.editSqlCmdVariable(createWorkspaceTreeItem(sqlcmdVarToUpdate));

            // reload project
            project = await Project.openProject(project.projectFilePath);
            expect(
                project.sqlCmdVariables.size,
                "The project should still have 2 sqlcmd variables",
            ).to.equal(2);
            expect(
                project.sqlCmdVariables.get(sqlcmdVarToUpdate.friendlyName),
                "The value of the sqlcmd variable should have been updated",
            ).to.equal(updatedValue);
        });

        test("Should remove file extensions from user input when creating files", async function (): Promise<void> {
            const projController = new ProjectsController(testContext.outputChannel);
            let project = await testUtils.createTestProject(
                this.test,
                baselines.newProjectFileBaseline,
            );

            // Test cases for different extension scenarios
            const testCases = [
                {
                    input: "TableName.sql",
                    expected: "TableName",
                    extension: constants.sqlFileExtension,
                },
                {
                    input: "TableName.sql.sql",
                    expected: "TableName.sql",
                    extension: constants.sqlFileExtension,
                },
                { input: "MyTable", expected: "MyTable", extension: constants.sqlFileExtension }, // no extension
                {
                    input: "MyTable.SQL",
                    expected: "MyTable",
                    extension: constants.sqlFileExtension,
                }, // uppercase extension
                {
                    input: "MyTable .Sql",
                    expected: "MyTable",
                    extension: constants.sqlFileExtension,
                }, // mixed case extension
                {
                    input: "PubProfile.publish.xml",
                    expected: "PubProfile",
                    extension: constants.publishProfileExtension,
                },
                {
                    input: "PubProfile.publish.xml.publish.xml",
                    expected: "PubProfile.publish.xml",
                    extension: constants.publishProfileExtension,
                },
            ];

            for (const testCase of testCases) {
                // Mock the user input
                sinon.stub(vscode.window, "showInputBox").resolves(testCase.input);
                sinon.stub(utils, "sanitizeStringForFilename").returns(testCase.input);

                // Add item to project
                if (testCase.extension === constants.sqlFileExtension) {
                    await projController.addItemPrompt(project, "", { itemType: ItemType.script });
                } else {
                    await projController.addItemPrompt(project, "", {
                        itemType: ItemType.publishProfile,
                    });
                }

                // Reload project to get updated state
                project = await Project.openProject(project.projectFilePath);

                // Find the created file
                const expectedFileName = `${testCase.expected}${testCase.extension}`;

                // Find the file project entry
                let fileProjectEntry = project.sqlObjectScripts;
                if (testCase.extension === constants.publishProfileExtension) {
                    fileProjectEntry = project.publishProfiles;
                }

                // Get the created file
                const createdFile = fileProjectEntry.find(
                    (f) => path.basename(f.relativePath) === expectedFileName,
                );

                // Assert the created file exists
                expect(
                    createdFile,
                    `Created file ${expectedFileName} should exist in project for input ${testCase.input}`,
                ).to.not.be.undefined;
                expect(
                    await utils.exists(path.join(project.projectFolderPath, expectedFileName)),
                    `File ${expectedFileName} should exist on disk for input ${testCase.input}`,
                ).to.be.true;

                // Clean up for next iteration
                await project.deleteSqlObjectScript(createdFile!.relativePath);
                sinon.restore();
                restubServices(utils, testContext.dacFxService);
            }
        });
    });
});

async function setupDeleteExcludeTest(
    proj: Project,
): Promise<
    [FileProjectEntry, ProjectRootTreeItem, FileProjectEntry, FileProjectEntry, FileProjectEntry]
> {
    await proj.addFolder("UpperFolder");
    await proj.addFolder("UpperFolder/LowerFolder");
    const scriptEntry = await proj.addScriptItem(
        "UpperFolder/LowerFolder/someScript.sql",
        "not a real script",
    );
    await proj.addScriptItem(
        "UpperFolder/LowerFolder/someOtherScript.sql",
        "Also not a real script",
    );
    await proj.addScriptItem("../anotherScript.sql", "Also not a real script");
    const preDeployEntry = await proj.addScriptItem(
        "Script.PreDeployment1.sql",
        "pre-deployment stuff",
        ItemType.preDeployScript,
    );
    const noneEntry = await proj.addScriptItem(
        "Script.PreDeployment2.sql",
        "more pre-deployment stuff",
        ItemType.preDeployScript,
    );
    const postDeployEntry = await proj.addScriptItem(
        "Script.PostDeployment1.sql",
        "post-deployment stuff",
        ItemType.postDeployScript,
    );

    const projTreeRoot = new ProjectRootTreeItem(proj);
    sinon
        .stub(vscode.window, "showWarningMessage")
        .returns(<any>Promise.resolve(constants.yesString));

    // confirm setup
    expect(proj.sqlObjectScripts.length, "number of file entries").to.equal(3);
    expect(proj.folders.length, "number of folder entries").to.equal(2);
    expect(proj.preDeployScripts.length, "number of pre-deployment script entries").to.equal(1);
    expect(proj.postDeployScripts.length, "number of post-deployment script entries").to.equal(1);
    expect(proj.noneDeployScripts.length, "number of none script entries").to.equal(1);
    expect(
        path.parse(scriptEntry.fsUri.fsPath).base,
        "Script entry base name should be someScript.sql",
    ).to.equal("someScript.sql");
    expect(
        (await fs.readFile(scriptEntry.fsUri.fsPath)).toString(),
        "Script file content should match expected text",
    ).to.equal("not a real script");

    return [scriptEntry, projTreeRoot, preDeployEntry, postDeployEntry, noneEntry];
}

async function setupMoveTest(proj: Project): Promise<ProjectRootTreeItem> {
    await proj.addFolder("UpperFolder");
    await proj.addFolder("UpperFolder/LowerFolder");
    await proj.addFolder("folder1");
    await proj.addScriptItem("UpperFolder/LowerFolder/someScript.sql", "not a real script");
    await proj.addScriptItem(
        "UpperFolder/LowerFolder/someOtherScript.sql",
        "Also not a real script",
    );
    await proj.addScriptItem("../anotherScript.sql", "Also not a real script");
    await proj.addScriptItem("script1.sql", "Also not a real script");

    const projTreeRoot = new ProjectRootTreeItem(proj);
    return projTreeRoot;
}

function createWorkspaceTreeItem(node: BaseProjectTreeItem): dataworkspace.WorkspaceTreeItem {
    return {
        element: node,
        treeDataProvider: new SqlDatabaseProjectTreeViewProvider(),
    };
}
