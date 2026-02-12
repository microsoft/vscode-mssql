/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
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
import { createContext, TestContext } from "./testContext";
import { Project } from "../src/models/project";
import { ProjectRootTreeItem } from "../src/models/tree/projectTreeItem";
import { FolderNode, FileNode } from "../src/models/tree/fileFolderTreeItem";
import { BaseProjectTreeItem } from "../src/models/tree/baseTreeItem";
import { ImportDataModel } from "../src/models/api/import";
import { EntryType, ItemType, SqlTargetPlatform } from "sqldbproj";
import { FileProjectEntry } from "../src/models/projectEntry";

let testContext: TestContext;
const templatesPath = testUtils.getTemplatesRootPath();
let sandbox: sinon.SinonSandbox;

suite("ProjectsController", function (): void {
    suiteSetup(async function (): Promise<void> {
        await templates.loadTemplates(templatesPath);
        await baselines.loadBaselines();
    });

    setup(function (): void {
        testContext = createContext();
        sandbox = sinon.createSandbox();
    });

    teardown(function (): void {
        sandbox.restore();
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
                expect(constants.getTargetPlatformFromVersion(projTargetVersion)).to.equal(
                    projTargetPlatform,
                );
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
                expect(project.sqlObjectScripts.length).to.equal(
                    7,
                    `The 7 template files for an edge project should be present. Actual: ${project.sqlObjectScripts.length}`,
                );
            });

            test("Should return silently when no SQL object name provided in prompts", async function (): Promise<void> {
                const showInputBoxStub = sandbox.stub(vscode.window, "showInputBox");
                sandbox.stub(utils, "sanitizeStringForFilename").returns("");
                const showErrorMessageSpy = sandbox.spy(vscode.window, "showErrorMessage");
                const projController = new ProjectsController(testContext.outputChannel);

                for (const name of ["", "    ", undefined]) {
                    showInputBoxStub.resolves(name);
                    const project = new Project("FakePath");

                    expect(project.sqlObjectScripts.length).to.equal(0);
                    await projController.addItemPrompt(new Project("FakePath"), "", {
                        itemType: ItemType.script,
                    });
                    expect(project.sqlObjectScripts.length).to.equal(
                        0,
                        "Expected to return without throwing an exception or adding a file when an empty/undefined name is provided.",
                    );
                    expect(
                        showErrorMessageSpy.notCalled,
                        "showErrorMessage should not have been called",
                    ).to.be.true;
                }
            });

            test("Should show error if trying to add a file that already exists", async function (): Promise<void> {
                const tableName = "table1";
                sandbox.stub(vscode.window, "showInputBox").resolves(tableName);
                sandbox.stub(utils, "sanitizeStringForFilename").returns(tableName);
                const spy = sandbox.spy(vscode.window, "showErrorMessage");
                const projController = new ProjectsController(testContext.outputChannel);
                let project = await testUtils.createTestProject(
                    this.test,
                    baselines.newProjectFileBaseline,
                );

                expect(project.sqlObjectScripts.length, "There should be no files").to.equal(0);
                await projController.addItemPrompt(project, "", { itemType: ItemType.script });

                expect(project.sqlObjectScripts.length).to.equal(
                    1,
                    "File should be successfully added",
                );
                await projController.addItemPrompt(project, "", { itemType: ItemType.script });
                const msg = constants.fileAlreadyExists(tableName);
                expect(spy.calledOnce, "showErrorMessage should have been called exactly once").to
                    .be.true;
                expect(spy.calledWith(msg)).to.be.true; // showErrorMessage not called with expected message '${msg}' Actual '${spy.getCall(0).args[0]}'
            });

            test("Should not create file if no itemTypeName is selected", async function (): Promise<void> {
                sandbox.stub(vscode.window, "showQuickPick").resolves(undefined);
                const spy = sandbox.spy(vscode.window, "showErrorMessage");
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
                    spy.called,
                    `showErrorMessage should not have been called. Actual '${spy.getCall(0)?.args[0]}'`,
                ).to.be.false;
            });

            test("Should add existing item", async function (): Promise<void> {
                const tableName = "table1";
                sandbox.stub(vscode.window, "showInputBox").resolves(tableName);
                sandbox.stub(utils, "sanitizeStringForFilename").returns(tableName);
                const spy = sandbox.spy(vscode.window, "showErrorMessage");
                const projController = new ProjectsController(testContext.outputChannel);
                let project = await testUtils.createTestProject(
                    this.test,
                    baselines.newProjectFileBaseline,
                );

                expect(project.sqlObjectScripts.length, "There should be no files").to.equal(0);
                await projController.addItemPrompt(project, "", { itemType: ItemType.script });
                expect(project.sqlObjectScripts.length).to.equal(
                    1,
                    "File should be successfully added",
                );

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
                expect(project.sqlObjectScripts.length).to.equal(
                    0,
                    "File should be successfully excluded",
                );
                expect(
                    spy.called,
                    `showErrorMessage not called with expected message. Actual '${spy.getCall(0)?.args[0]}'`,
                ).to.be.false;

                // add item back
                sandbox
                    .stub(vscode.window, "showOpenDialog")
                    .resolves([
                        vscode.Uri.file(path.join(project.projectFolderPath, "table1.sql")),
                    ]);
                await projController.addExistingItemPrompt(createWorkspaceTreeItem(projTreeRoot));

                // reload project
                project = await Project.openProject(project.projectFilePath);
                expect(project.sqlObjectScripts.length).to.equal(
                    1,
                    "File should be successfully re-added",
                );
            });

            test("Should show error if trying to add a folder that already exists", async function (): Promise<void> {
                const folderName = "folder1";
                const stub = sandbox.stub(vscode.window, "showInputBox").resolves(folderName);
                sandbox.stub(utils, "sanitizeStringForFilename").returns(folderName);

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
                const projController = new ProjectsController(testContext.outputChannel);
                let project = await testUtils.createTestProject(
                    this.test,
                    baselines.openProjectFileBaseline,
                );
                const projectRoot = new ProjectRootTreeItem(project);

                // make sure it's ok to add these folders if they aren't where the reserved folders are at the root of the project
                let node = projectRoot.children.find((c) => c.friendlyName === "Tables");
                const showInputBoxStub = sandbox.stub(vscode.window, "showInputBox");
                const sanitizeStub = sandbox.stub(utils, "sanitizeStringForFilename");
                for (let i in constants.reservedProjectFolders) {
                    const folderName = constants.reservedProjectFolders[i];
                    showInputBoxStub.resolves(folderName);
                    sanitizeStub.returns(folderName);
                    // reload project
                    project = await Project.openProject(project.projectFilePath);
                    const beforeFolderCount = project.folders.length;
                    await projController.addFolderPrompt(
                        createWorkspaceTreeItem(<BaseProjectTreeItem>node),
                    );
                    // reload project
                    project = await Project.openProject(project.projectFilePath);
                    expect(project.folders.length).to.equal(
                        beforeFolderCount + 1,
                        `Folder count should be increased by one after adding the folder ${folderName}`,
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
                sandbox.stub(vscode.workspace, "getWorkspaceFolder").returns(workspaceFolder);

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

                    expect(tasksJson.tasks, "tasks should be an array")
                        .to.be.an("array")
                        .with.lengthOf(1);
                    const task = tasksJson.tasks[0];
                    expect(task.group, "task group should be defined").to.not.be.undefined;
                    expect(
                        task.group.isDefault,
                        "The build task should have isDefault: true (boolean)",
                    ).to.equal(true);
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
                sandbox.stub(vscode.workspace, "getWorkspaceFolder").returns(workspaceFolder);

                // Spy on showInformationMessage to verify notification
                const showInfoSpy = sandbox.spy(vscode.window, "showInformationMessage");

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

                expect(tasksJson.tasks, "tasks should be an array")
                    .to.be.an("array")
                    .with.lengthOf(2);
                expect(tasksJson.tasks[0].label, "Existing task should be preserved").to.equal(
                    "Existing Task",
                );
                expect(tasksJson.tasks[1].label, "SQL build task should be added").to.equal(
                    constants.getSqlProjectBuildTaskLabel("TestProjectWithTasks"),
                );

                // Assert: notification was shown
                expect(
                    showInfoSpy.calledWith(constants.updatingExistingTasksJson),
                    "Should show notification when updating existing tasks.json",
                ).to.be.true;
            });

            async function verifyFolderNotAdded(
                folderName: string,
                projController: ProjectsController,
                project: Project,
                node: BaseProjectTreeItem,
            ): Promise<void> {
                const beforeFileCount = project.folders.length;
                const showInputBoxStub = sandbox
                    .stub(vscode.window, "showInputBox")
                    .resolves(folderName);
                const showErrorMessageSpy = sandbox.spy(vscode.window, "showErrorMessage");
                await projController.addFolderPrompt(createWorkspaceTreeItem(node));
                expect(
                    showErrorMessageSpy.calledOnce,
                    "showErrorMessage should have been called exactly once",
                ).to.be.true;
                const msg = constants.folderAlreadyExists(folderName);
                expect(showErrorMessageSpy.calledWith(msg)).to.be.true; // showErrorMessage not called with expected message '${msg}' Actual '${showErrorMessageSpy.getCall(0).args[0]}'
                expect(project.folders.length).to.equal(
                    beforeFileCount,
                    "File count should be the same as before the folder was attempted to be added",
                );
                showInputBoxStub.restore();
                showErrorMessageSpy.restore();
            }

            // TODO: move test to DacFx and fix delete
            test("Should delete nested ProjectEntry from node", async function (): Promise<void> {
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
                // After deleting LowerFolder (with 2 scripts) and anotherScript.sql, 0 sql scripts should remain
                expect(proj.sqlObjectScripts.length, "number of file entries").to.equal(0);
                expect(proj.folders[0].relativePath).to.equal("UpperFolder");
                expect(proj.preDeployScripts.length).to.equal(
                    0,
                    "Pre Deployment scripts should have been deleted",
                );
                expect(proj.postDeployScripts.length).to.equal(
                    0,
                    "Post Deployment scripts should have been deleted",
                );
                expect(proj.noneDeployScripts.length).to.equal(
                    0,
                    "None file should have been deleted",
                );

                expect(await utils.exists(scriptEntry.fsUri.fsPath)).to.equal(
                    false,
                    "script is supposed to be deleted",
                );
                expect(await utils.exists(preDeployEntry.fsUri.fsPath)).to.equal(
                    false,
                    "pre-deployment script is supposed to be deleted",
                );
                expect(await utils.exists(postDeployEntry.fsUri.fsPath)).to.equal(
                    false,
                    "post-deployment script is supposed to be deleted",
                );
                expect(await utils.exists(noneEntry.fsUri.fsPath)).to.equal(
                    false,
                    "none entry pre-deployment script is supposed to be deleted",
                );
            });

            test("Should delete database references", async function (): Promise<void> {
                // setup - openProject baseline has a system db reference to master
                let proj = await testUtils.createTestProject(
                    this.test,
                    baselines.openProjectFileBaseline,
                );
                const projController = new ProjectsController(testContext.outputChannel);
                sandbox
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
                expect(proj.databaseReferences.length).to.equal(
                    3,
                    "Should start with 3 database references",
                );

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
                expect(proj.databaseReferences.length).to.equal(
                    0,
                    "All database references should have been deleted",
                );
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
                expect(proj.folders.find((f) => f.relativePath === "UpperFolder")).to.not.equal(
                    undefined,
                    "UpperFolder should still be there",
                );
                expect(proj.preDeployScripts.length, "Pre deployment scripts").to.equal(0);
                expect(proj.postDeployScripts.length, "Post deployment scripts").to.equal(0);
                expect(proj.noneDeployScripts.length, "None files").to.equal(0);

                expect(await utils.exists(scriptEntry.fsUri.fsPath)).to.equal(
                    true,
                    "script is supposed to still exist on disk",
                );
                expect(await utils.exists(preDeployEntry.fsUri.fsPath)).to.equal(
                    true,
                    "pre-deployment script is supposed to still exist on disk",
                );
                expect(await utils.exists(postDeployEntry.fsUri.fsPath)).to.equal(
                    true,
                    "post-deployment script is supposed to still exist on disk",
                );
                expect(await utils.exists(noneEntry.fsUri.fsPath)).to.equal(
                    true,
                    "none entry pre-deployment script is supposed to still exist on disk",
                );
            });

            test("Should exclude a folder", async function (): Promise<void> {
                let proj = await testUtils.createTestSqlProject(this.test);
                await proj.addScriptItem("SomeFolder/MyTable.sql", "CREATE TABLE [NotARealTable]");

                const projController = new ProjectsController(testContext.outputChannel);
                const projTreeRoot = new ProjectRootTreeItem(proj);

                expect(
                    await utils.exists(path.join(proj.projectFolderPath, "SomeFolder/MyTable.sql")),
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
                ).to.be.true;
                expect(proj.sqlObjectScripts.length).to.equal(
                    0,
                    "Number of scripts should not have changed",
                );
                expect(proj.folders.length, "Number of folders should not have changed").to.equal(
                    0,
                );
            });

            // TODO: move test to DacFx and fix delete
            test("Should delete folders with excluded items", async function (): Promise<void> {
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
                ).to.equal(false, "UpperFolder should not be part of proj file any more");
                expect(await utils.exists(scriptEntry.fsUri.fsPath)).to.equal(
                    false,
                    "script is supposed to be deleted from disk",
                );
                expect(await utils.exists(lowerFolder.relativeProjectUri.fsPath)).to.equal(
                    false,
                    "LowerFolder is supposed to be deleted from disk",
                );
                expect(await utils.exists(upperFolder.relativeProjectUri.fsPath)).to.equal(
                    false,
                    "UpperFolder is supposed to be deleted from disk",
                );
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
                expect(project.sqlObjectScripts.length).to.equal(0);

                // call reload project
                const projTreeRoot = new ProjectRootTreeItem(project);
                await projController.reloadProject(createWorkspaceTreeItem(projTreeRoot));
                // calling this because this gets called in the projectProvider.getProjectTreeDataProvider(), which is called by workspaceTreeDataProvider
                // when notifyTreeDataChanged() happens
                // reload project
                project = await Project.openProject(sqlProjPath, false, true);
                treeProvider.load([project]);

                // check that the new project is in the tree
                expect(project.sqlObjectScripts.length).to.equal(1);
                expect(
                    treeProvider
                        .getChildren()[0]
                        .children.find((c) => c.friendlyName === "Script1.sql"),
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

                const showInputBoxStub = sandbox.stub(vscode.window, "showInputBox");
                const sanitizeStub = sandbox.stub(utils, "sanitizeStringForFilename");

                showInputBoxStub.resolves(preDeployScriptName);
                sanitizeStub.returns(preDeployScriptName);
                expect(project.preDeployScripts.length).to.equal(
                    0,
                    "There should be no pre deploy scripts",
                );
                await projController.addItemPrompt(project, "", {
                    itemType: ItemType.preDeployScript,
                });
                expect(project.preDeployScripts.length).to.equal(
                    1,
                    `Pre deploy script should be successfully added. ${project.preDeployScripts.length}, ${project.sqlObjectScripts.length}`,
                );

                showInputBoxStub.resolves(postDeployScriptName);
                sanitizeStub.returns(postDeployScriptName);
                expect(project.postDeployScripts.length).to.equal(
                    0,
                    "There should be no post deploy scripts",
                );
                await projController.addItemPrompt(project, "", {
                    itemType: ItemType.postDeployScript,
                });
                expect(project.postDeployScripts.length).to.equal(
                    1,
                    "Post deploy script should be successfully added",
                );
            });

            test("Should be able to add publish profile", async function (): Promise<void> {
                const publishProfileName = "profile.publish.xml";

                const projController = new ProjectsController(testContext.outputChannel);
                const project = await testUtils.createTestProject(
                    this.test,
                    baselines.newProjectFileBaseline,
                );

                sandbox.stub(vscode.window, "showInputBox").resolves(publishProfileName);
                sandbox.stub(utils, "sanitizeStringForFilename").returns(publishProfileName);
                expect(project.publishProfiles.length).to.equal(
                    0,
                    "There should be no publish profiles",
                );
                await projController.addItemPrompt(project, "", {
                    itemType: ItemType.publishProfile,
                });
                expect(project.publishProfiles.length).to.equal(
                    1,
                    "Publish profile should be successfully added.",
                );
            });

            test("Should change target platform", async function (): Promise<void> {
                sandbox
                    .stub(vscode.window, "showQuickPick")
                    .resolves({ label: SqlTargetPlatform.sqlAzure });

                const projController = new ProjectsController(testContext.outputChannel);
                const sqlProjPath = await testUtils.createTestSqlProjFile(
                    this.test,
                    baselines.openProjectFileBaseline,
                );
                const project = await Project.openProject(sqlProjPath);
                expect(project.getProjectTargetVersion()).to.equal(
                    constants.targetPlatformToVersion.get(SqlTargetPlatform.sqlServer2019),
                );
                expect(project.databaseReferences.length).to.equal(
                    1,
                    "Project should have one database reference to master",
                );

                await projController.changeTargetPlatform(project);
                expect(project.getProjectTargetVersion()).to.equal(
                    constants.targetPlatformToVersion.get(SqlTargetPlatform.sqlAzure),
                );
            });
        });

        suite("Publishing and script generation", function (): void {
            test("publishProject should invoke mssql.publishDatabaseProject command with correct project path", async function (): Promise<void> {
                const proj = await testUtils.createTestProject(
                    this.test,
                    baselines.openProjectFileBaseline,
                );
                const expectedProjectPath = proj.projectFilePath;

                const executeCommandStub = sandbox
                    .stub(vscode.commands, "executeCommand")
                    .resolves();

                const projController = new ProjectsController(testContext.outputChannel);
                await projController.publishProject(proj);

                expect(
                    executeCommandStub.calledOnce,
                    "executeCommand should be called exactly once",
                ).to.be.true;
                expect(executeCommandStub.firstCall.args[0]).to.equal(
                    constants.mssqlPublishProjectCommand,
                    "should invoke the mssql publish project command",
                );
                expect(executeCommandStub.firstCall.args[1]).to.equal(
                    expectedProjectPath,
                    "should pass the correct project file path",
                );
            });
        });
    });

    suite("Create project from database operations and dialog", function (): void {
        teardown(() => {});

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
            const spy = sandbox.spy(vscode.window, "showErrorMessage");

            let testFolderPath = await testUtils.generateTestFolderPath(this.test);
            testFolderPath += "_nonexistentFolder"; // Modify folder path to point to a nonexistent location

            const projController = new ProjectsController(testContext.outputChannel);

            await projController.generateScriptList(testFolderPath);
            expect(spy.calledOnce, "showErrorMessage should have been called").to.be.true;
            const msg = constants.cannotResolvePath(testFolderPath);
            expect(spy.calledWith(msg)).to.be.true; // showErrorMessage not called with expected message '${msg}' Actual '${spy.getCall(0).args[0]}'
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
                extractTarget: mssql.ExtractTarget.file,
                sdkStyle: false,
            };

            const projController = new ProjectsController(testContext.outputChannel);
            projController.setFilePath(model);
            importPath = model.filePath;

            expect(importPath.toUpperCase()).to.equal(
                vscode.Uri.file(path.join(folderPath, projectName + ".sql")).fsPath.toUpperCase(),
                `model.filePath should be set to a specific file for ExtractTarget === file, but was ${importPath}`,
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
                extractTarget: mssql.ExtractTarget.schemaObjectType,
                sdkStyle: false,
            };

            const projController = new ProjectsController(testContext.outputChannel);
            projController.setFilePath(model);
            importPath = model.filePath;

            expect(importPath.toUpperCase()).to.equal(
                vscode.Uri.file(path.join(folderPath)).fsPath.toUpperCase(),
                `model.filePath should be set to a folder for ExtractTarget !== file, but was ${importPath}`,
            );
        });
    });

    suite("Add database reference", function (): void {
        test("Should not allow adding circular project references", async function (): Promise<void> {
            const projPath1 = await testUtils.createTestSqlProjFile(
                this.test,
                baselines.openProjectFileBaseline,
            );
            const projPath2 = await testUtils.createTestSqlProjFile(
                this.test,
                baselines.newProjectFileBaseline,
            );
            const projController = new ProjectsController(testContext.outputChannel);

            const project1 = await Project.openProject(vscode.Uri.file(projPath1).fsPath);
            const project2 = await Project.openProject(vscode.Uri.file(projPath2).fsPath);
            const showErrorMessageSpy = sandbox.spy(vscode.window, "showErrorMessage");
            const dataWorkspaceMock = {
                getProjectsInWorkspace: sandbox
                    .stub()
                    .resolves([
                        vscode.Uri.file(project1.projectFilePath),
                        vscode.Uri.file(project2.projectFilePath),
                    ]),
            };
            const realMssqlExt = vscode.extensions.getExtension("ms-mssql.mssql");
            sandbox.stub(vscode.extensions, "getExtension").callsFake((extensionId: string) => {
                if (extensionId === "ms-mssql.mssql") {
                    return realMssqlExt;
                }
                return <any>{ exports: dataWorkspaceMock };
            });
            sandbox.stub(utils, "getDacFxService").returns(<any>{
                parseTSqlScript: (_: string, __: string) => {
                    return Promise.resolve({ containsCreateTableStatement: true });
                },
            });

            // add project reference from project1 to project2
            await projController.addDatabaseReferenceCallback(
                project1,
                {
                    projectGuid: "",
                    projectName: "TestProject",
                    projectRelativePath: undefined,
                    suppressMissingDependenciesErrors: false,
                },
                { treeDataProvider: new SqlDatabaseProjectTreeViewProvider(), element: undefined },
            );

            // Reload project1 to get updated state
            const updatedProject1 = await Project.openProject(project1.projectFilePath);
            // openProjectFileBaseline already has 1 reference (master.dacpac), plus the new one = 2
            expect(updatedProject1.databaseReferences.length).to.equal(
                2,
                "Project reference should have been added",
            );

            // try to add circular reference from project2 back to project1
            await projController.addDatabaseReferenceCallback(
                project2,
                {
                    projectGuid: "",
                    projectName: "TestProjectName",
                    projectRelativePath: undefined,
                    suppressMissingDependenciesErrors: false,
                },
                { treeDataProvider: new SqlDatabaseProjectTreeViewProvider(), element: undefined },
            );
            expect(
                showErrorMessageSpy.called,
                "showErrorMessage should have been called for circular reference",
            ).to.be.true;
        });

        test("Should add dacpac references as relative paths", async function (): Promise<void> {
            const projFilePath = await testUtils.createTestSqlProjFile(
                this.test,
                baselines.newProjectFileBaseline,
            );
            const projController = new ProjectsController(testContext.outputChannel);

            const project1 = await Project.openProject(vscode.Uri.file(projFilePath).fsPath);
            const showErrorMessageSpy = sandbox.spy(vscode.window, "showErrorMessage");
            const dataWorkspaceMock = {
                getProjectsInWorkspace: sandbox.stub().resolves([]),
            };
            const realMssqlExt = vscode.extensions.getExtension("ms-mssql.mssql");
            sandbox.stub(vscode.extensions, "getExtension").callsFake((extensionId: string) => {
                if (extensionId === "ms-mssql.mssql") {
                    return realMssqlExt;
                }
                return <any>{ exports: dataWorkspaceMock };
            });
            sandbox.stub(utils, "getDacFxService").returns(<any>{
                parseTSqlScript: (_: string, __: string) => {
                    return Promise.resolve({ containsCreateTableStatement: true });
                },
            });
            // add dacpac reference to something in the same folder
            expect(project1.databaseReferences.length).to.equal(
                0,
                "There should not be any database references to start with",
            );

            await projController.addDatabaseReferenceCallback(
                project1,
                {
                    databaseName: <string>this.databaseNameTextbox?.value,
                    dacpacFileLocation: vscode.Uri.file(
                        path.join(path.dirname(projFilePath), "sameFolderTest.dacpac"),
                    ),
                    suppressMissingDependenciesErrors: false,
                },
                { treeDataProvider: new SqlDatabaseProjectTreeViewProvider(), element: undefined },
            );
            expect(showErrorMessageSpy.notCalled, "showErrorMessage should not have been called").to
                .be.true;

            // Reload project to get updated state
            let reloadedProject = await Project.openProject(projFilePath);
            expect(reloadedProject.databaseReferences.length).to.equal(
                1,
                "Dacpac reference should have been added",
            );
            expect(reloadedProject.databaseReferences[0].referenceName).to.equal("sameFolderTest");
            expect(reloadedProject.databaseReferences[0].pathForSqlProj()).to.equal(
                "sameFolderTest.dacpac",
            );
            // make sure reference to sameFolderTest.dacpac was added to project file
            let projFileText = (await fs.readFile(projFilePath)).toString();
            expect(projFileText).to.contain("sameFolderTest.dacpac");

            // add dacpac reference to something in a nested folder
            await projController.addDatabaseReferenceCallback(
                reloadedProject,
                {
                    databaseName: <string>this.databaseNameTextbox?.value,
                    dacpacFileLocation: vscode.Uri.file(
                        path.join(path.dirname(projFilePath), "refs", "nestedFolderTest.dacpac"),
                    ),
                    suppressMissingDependenciesErrors: false,
                },
                { treeDataProvider: new SqlDatabaseProjectTreeViewProvider(), element: undefined },
            );
            expect(showErrorMessageSpy.notCalled, "showErrorMessage should not have been called").to
                .be.true;

            // Reload project to get updated state
            reloadedProject = await Project.openProject(projFilePath);
            expect(reloadedProject.databaseReferences.length).to.equal(
                2,
                "Another dacpac reference should have been added",
            );
            const nestedRef = reloadedProject.databaseReferences.find(
                (r) => r.referenceName === "nestedFolderTest",
            );
            expect(nestedRef, "nestedFolderTest reference should exist").to.not.be.undefined;
            expect(nestedRef!.pathForSqlProj()).to.equal("refs\\nestedFolderTest.dacpac");
            // make sure reference to nestedFolderTest.dacpac was added to project file
            projFileText = (await fs.readFile(projFilePath)).toString();
            expect(projFileText).to.contain("refs\\nestedFolderTest.dacpac");

            // add dacpac reference to something in a folder outside of the project
            await projController.addDatabaseReferenceCallback(
                reloadedProject,
                {
                    databaseName: <string>this.databaseNameTextbox?.value,
                    dacpacFileLocation: vscode.Uri.file(
                        path.join(
                            path.dirname(projFilePath),
                            "..",
                            "someFolder",
                            "outsideFolderTest.dacpac",
                        ),
                    ),
                    suppressMissingDependenciesErrors: false,
                },
                { treeDataProvider: new SqlDatabaseProjectTreeViewProvider(), element: undefined },
            );
            expect(showErrorMessageSpy.notCalled, "showErrorMessage should not have been called").to
                .be.true;

            // Reload project to get updated state
            reloadedProject = await Project.openProject(projFilePath);
            expect(reloadedProject.databaseReferences.length).to.equal(
                3,
                "Another dacpac reference should have been added",
            );
            const outsideRef = reloadedProject.databaseReferences.find(
                (r) => r.referenceName === "outsideFolderTest",
            );
            expect(outsideRef, "outsideFolderTest reference should exist").to.not.be.undefined;
            expect(outsideRef!.pathForSqlProj()).to.equal(
                "..\\someFolder\\outsideFolderTest.dacpac",
            );
            // make sure reference to outsideFolderTest.dacpac was added to project file
            projFileText = (await fs.readFile(projFilePath)).toString();
            expect(projFileText).to.contain("..\\someFolder\\outsideFolderTest.dacpac");
        });
    });

    suite("AutoRest generation", function (): void {
        // skipping for now because this feature is hidden under preview flag
        test("Should create project from autorest-generated files", async function (): Promise<void> {
            const parentFolder = await testUtils.generateTestFolderPath(this.test);
            await testUtils.createDummyFileStructure(this.test);
            const specName = "DummySpec.yaml";
            const renamedProjectName = "RenamedProject";
            const newProjFolder = path.join(parentFolder, renamedProjectName);
            let fileList: vscode.Uri[] = [];

            const projController = new ProjectsController(testContext.outputChannel);

            sandbox.stub(projController, "selectAutorestSpecFile").resolves(specName);
            sandbox.stub(projController, "selectAutorestProjectLocation").callsFake(async () => {
                await fs.mkdir(newProjFolder);
                return {
                    newProjectFolder: newProjFolder,
                    outputFolder: parentFolder,
                    projectName: renamedProjectName,
                };
            });
            sandbox.stub(projController, "generateAutorestFiles").callsFake(async () => {
                await testUtils.createDummyFileStructure(this.test, true, fileList, newProjFolder);
                await testUtils.createTestFile(
                    this.test,
                    "SELECT 'This is a post-deployment script'",
                    constants.autorestPostDeploymentScriptName,
                    newProjFolder,
                );
                return "some dummy console output";
            });
            sandbox
                .stub(projController, "promptForAutorestProjectName")
                .resolves(renamedProjectName);
            sandbox.stub(projController, "openProjectInWorkspace").resolves();

            const project = (await projController.generateProjectFromOpenApiSpec())!;

            expect(project.projectFileName).to.equal(renamedProjectName);
            expect(project.projectFolderPath.endsWith(renamedProjectName)).to.be.true; // Expected: '${project.projectFolderPath}' to include '${renamedProjectName}'

            expect(project.postDeployScripts.length).to.equal(
                1,
                `Expected 1 post-deployment script, got ${project?.postDeployScripts.length}`,
            );
            const actual = path.basename(project.postDeployScripts[0].fsUri.fsPath);
            expect(actual).to.equal(
                constants.autorestPostDeploymentScriptName,
                `Unexpected post-deployment script name: ${actual}, expected ${constants.autorestPostDeploymentScriptName}`,
            );

            const expectedScripts = fileList.filter((f) => path.extname(f.fsPath) === ".sql");
            expect(
                project.sqlObjectScripts.filter((f) => f.type === EntryType.File).length,
            ).to.equal(expectedScripts.length, "Unexpected number of scripts in project");

            const expectedFolders = fileList.filter(
                (f) =>
                    path.extname(f.fsPath) === "" &&
                    f.fsPath.toUpperCase() !== newProjFolder.toUpperCase(),
            );
            expect(
                project.sqlObjectScripts.filter((f) => f.type === EntryType.Folder).length,
            ).to.equal(expectedFolders.length, "Unexpected number of folders in project");
        });
    });

    suite("Move file", function (): void {
        test("Should move a file to another folder", async function (): Promise<void> {
            const spy = sandbox.spy(vscode.window, "showErrorMessage");
            sandbox
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

            expect(spy.notCalled, "showErrorMessage should not have been called").to.be.true;

            // reload project and verify file was moved
            proj = await Project.openProject(proj.projectFilePath);
            expect(
                proj.sqlObjectScripts.find((f) => f.relativePath === "UpperFolder\\script1.sql") !==
                    undefined,
            ).to.be.true;
            expect(
                await utils.exists(path.join(proj.projectFolderPath, "UpperFolder", "script1.sql")),
            ).to.be.true;
        });

        test("Should move a folder to another folder", async function (): Promise<void> {
            const spy = sandbox.spy(vscode.window, "showErrorMessage");
            sandbox
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

            expect(spy.notCalled, "showErrorMessage should not have been called").to.be.true;

            // reload project and verify file was moved
            proj = await Project.openProject(proj.projectFilePath);
            expect(
                proj.folders.find((f) => f.relativePath === "UpperFolder\\folder1") !== undefined,
            ).to.be.true;
        });

        test("Should not allow moving a file to Database References or SQLCMD folder", async function (): Promise<void> {
            const spy = sandbox.spy(vscode.window, "showErrorMessage");
            sandbox
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
                ).to.be.true; // The file path should not have been updated when trying to move script1.sql to ${folder}
                expect(spy.notCalled, "showErrorMessage should not have been called.").to.be.true;
                spy.restore();
            }
        });

        test("Should only allow moving files and folders", async function (): Promise<void> {
            const spy = sandbox.spy(vscode.window, "showErrorMessage");
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
                spy.calledOnce,
                "showErrorMessage should have been called exactly once when trying to move a sqlcmd variable",
            ).to.be.true;
            expect(spy.calledWith(constants.onlyMoveFilesFoldersSupported)).to.be.true; // showErrorMessage not called with expected message '${constants.onlyMoveFilesFoldersSupported}' Actual '${spy.getCall(0).args[0]}'
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
                spy.calledOnce,
                "showErrorMessage should have been called exactly once when trying to move a database reference",
            ).to.be.true;
            expect(spy.calledWith(constants.onlyMoveFilesFoldersSupported)).to.be.true; // showErrorMessage not called with expected message '${constants.onlyMoveFilesFoldersSupported}' Actual '${spy.getCall(0).args[0]}'
            spy.restore();
        });

        test("Should not allow moving files between projects", async function (): Promise<void> {
            const spy = sandbox.spy(vscode.window, "showErrorMessage");
            sandbox
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

            expect(spy.called, "showErrorMessage should have been called").to.be.true;
            expect(spy.calledWith(constants.movingFilesBetweenProjectsNotSupported)).to.be.true; // showErrorMessage not called with expected message '${constants.movingFilesBetweenProjectsNotSupported}' Actual '${spy.getCall(0).args[0]}'

            // verify script1.sql was not moved
            proj1 = await Project.openProject(proj1.projectFilePath);
            expect(
                proj1.sqlObjectScripts.find((f) => f.relativePath === "script1.sql") !== undefined,
            ).to.be.true; // The file path should not have been updated when trying to move script1.sql to proj2
        });

        test("Should move a file to project root when project folder name differs from project name", async function (): Promise<void> {
            // Arrange
            const errorSpy = sandbox.spy(vscode.window, "showErrorMessage");
            sandbox
                .stub(vscode.window, "showWarningMessage")
                .returns(<any>Promise.resolve(constants.move));

            // Create a test project with the default name "TestProject"
            let proj = await testUtils.createTestProject(
                this.test,
                baselines.openSdkStyleSqlProjectBaseline,
            );

            // Rename the project folder to simulate a different folder name than project name
            const originalProjectFolder = path.dirname(proj.projectFilePath);
            const newProjectFolder = originalProjectFolder + "_NewFolder";
            await fs.rename(originalProjectFolder, newProjectFolder);

            // Update the project path to point to the new location
            const newProjectPath = path.join(newProjectFolder, path.basename(proj.projectFilePath));
            proj = await Project.openProject(newProjectPath);

            const projTreeRoot = await setupMoveTest(proj);
            const projController = new ProjectsController(testContext.outputChannel);

            // Get the file to move from nested folder
            const upperFolder = projTreeRoot.children.find((x) => x.friendlyName === "UpperFolder");
            const lowerFolder = upperFolder!.children.find((x) => x.friendlyName === "LowerFolder");
            const sqlFileNode = lowerFolder!.children.find(
                (x) => x.friendlyName === "someScript.sql",
            );
            const projectRootWorkspaceTreeItem = createWorkspaceTreeItem(projTreeRoot);

            // Act - Move the file from UpperFolder/LowerFolder to the project root
            await projController.moveFile(
                vscode.Uri.file(proj.projectFilePath),
                sqlFileNode,
                projectRootWorkspaceTreeItem,
            );

            // Assert
            expect(errorSpy.notCalled, "showErrorMessage should not have been called").to.be.true;

            // Reload project and verify file was moved to the root
            proj = await Project.openProject(newProjectPath);

            const movedFile = proj.sqlObjectScripts.find(
                (f) => f.relativePath === "someScript.sql",
            );
            expect(movedFile, "The file path should have been updated to the project root").to.not
                .be.undefined;

            const fileExistsAtRoot = await utils.exists(
                path.join(proj.projectFolderPath, "someScript.sql"),
            );
            expect(fileExistsAtRoot, "The moved file should exist at the root").to.be.true;

            const fileExistsAtOldLocation = await utils.exists(
                path.join(proj.projectFolderPath, "UpperFolder", "LowerFolder", "someScript.sql"),
            );
            expect(fileExistsAtOldLocation, "The file should not exist at the old location").to.be
                .false;
        });

        test("Should move a file to project root when project folder name differs from project name", async function (): Promise<void> {
            // Arrange
            const errorSpy = sinon.spy(vscode.window, "showErrorMessage");
            sinon
                .stub(vscode.window, "showWarningMessage")
                .returns(<any>Promise.resolve(constants.move));

            // Create a test project with the default name "TestProject"
            let proj = await testUtils.createTestProject(
                this.test,
                baselines.openSdkStyleSqlProjectBaseline,
            );

            // Rename the project folder to simulate a different folder name than project name
            const originalProjectFolder = path.dirname(proj.projectFilePath);
            const newProjectFolder = originalProjectFolder + "_NewFolder";
            await fs.rename(originalProjectFolder, newProjectFolder);

            // Update the project path to point to the new location
            const newProjectPath = path.join(newProjectFolder, path.basename(proj.projectFilePath));
            proj = await Project.openProject(newProjectPath);

            const projTreeRoot = await setupMoveTest(proj);
            const projController = new ProjectsController(testContext.outputChannel);

            // Get the file to move from nested folder
            const upperFolder = projTreeRoot.children.find((x) => x.friendlyName === "UpperFolder");
            const lowerFolder = upperFolder!.children.find((x) => x.friendlyName === "LowerFolder");
            const sqlFileNode = lowerFolder!.children.find(
                (x) => x.friendlyName === "someScript.sql",
            );
            const projectRootWorkspaceTreeItem = createWorkspaceTreeItem(projTreeRoot);

            // Act - Move the file from UpperFolder/LowerFolder to the project root
            await projController.moveFile(
                vscode.Uri.file(proj.projectFilePath),
                sqlFileNode,
                projectRootWorkspaceTreeItem,
            );

            // Assert
            expect(errorSpy.notCalled, "showErrorMessage should not have been called").to.be.true;

            // Reload project and verify file was moved to the root
            proj = await Project.openProject(newProjectPath);

            const movedFile = proj.sqlObjectScripts.find(
                (f) => f.relativePath === "someScript.sql",
            );
            expect(movedFile, "The file path should have been updated to the project root").to.not
                .be.undefined;

            const fileExistsAtRoot = await utils.exists(
                path.join(proj.projectFolderPath, "someScript.sql"),
            );
            expect(fileExistsAtRoot, "The moved file should exist at the root").to.be.true;

            const fileExistsAtOldLocation = await utils.exists(
                path.join(proj.projectFolderPath, "UpperFolder", "LowerFolder", "someScript.sql"),
            );
            expect(fileExistsAtOldLocation, "The file should not exist at the old location").to.be
                .false;
        });
    });

    suite("Rename file", function (): void {
        test("Should not do anything if no new name is provided", async function (): Promise<void> {
            sandbox.stub(vscode.window, "showInputBox").resolves("");
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
            ).to.be.true;
            expect(await utils.exists(path.join(proj.projectFolderPath, "script1.sql"))).to.be.true;
        });

        test("Should rename a sql object file", async function (): Promise<void> {
            sandbox.stub(vscode.window, "showInputBox").resolves("newName.sql");
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
            ).to.be.true;
            expect(await utils.exists(path.join(proj.projectFolderPath, "newName.sql"))).to.be.true;
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

            // try to rename pre-deploy script
            const showInputBoxStub = sandbox.stub(vscode.window, "showInputBox");
            showInputBoxStub.resolves("predeployNewName.sql");
            const preDeployScriptNode = projTreeRoot.children.find(
                (x) => x.friendlyName === "Script.PreDeployment1.sql",
            );
            await projController.rename(createWorkspaceTreeItem(preDeployScriptNode!));

            // try to rename post-deploy script
            showInputBoxStub.resolves("postdeployNewName.sql");
            const postDeployScriptNode = projTreeRoot.children.find(
                (x) => x.friendlyName === "Script.PostDeployment1.sql",
            );
            await projController.rename(createWorkspaceTreeItem(postDeployScriptNode!));

            // reload project and verify files were renamed
            proj = await Project.openProject(proj.projectFilePath);
            expect(
                proj.preDeployScripts.find((f) => f.relativePath === "predeployNewName.sql") !==
                    undefined,
            ).to.be.true;
            expect(await utils.exists(path.join(proj.projectFolderPath, "predeployNewName.sql"))).to
                .be.true;

            expect(
                proj.postDeployScripts.find((f) => f.relativePath === "postdeployNewName.sql") !==
                    undefined,
            ).to.be.true;
            expect(await utils.exists(path.join(proj.projectFolderPath, "postdeployNewName.sql")))
                .to.be.true;
        });

        test("Should rename a folder", async function (): Promise<void> {
            let proj = await testUtils.createTestSqlProject(this.test);
            await proj.addScriptItem("SomeFolder/MyTable.sql", "CREATE TABLE [NotARealTable]");

            const projController = new ProjectsController(testContext.outputChannel);
            const projTreeRoot = new ProjectRootTreeItem(proj);

            sandbox.stub(vscode.window, "showInputBox").resolves("RenamedFolder");
            expect(
                await utils.exists(path.join(proj.projectFolderPath, "SomeFolder", "MyTable.sql")),
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
            ).to.be.true;
            expect(proj.sqlObjectScripts.length).to.equal(
                1,
                "Number of scripts should not have changed",
            );
            expect(proj.folders.length, "Number of folders should not have changed").to.equal(1);
            expect(proj.folders.find((f) => f.relativePath === "RenamedFolder") !== undefined).to.be
                .true;
            expect(
                proj.sqlObjectScripts.find(
                    (f) => f.relativePath === "RenamedFolder\\MyTable.sql",
                ) !== undefined,
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

            expect(project.sqlCmdVariables.size).to.equal(
                2,
                "The project should start with 2 sqlcmd variables",
            );

            const showWarningStub = sandbox
                .stub(vscode.window, "showWarningMessage")
                .returns(<any>Promise.resolve("Cancel"));
            await projController.delete(
                createWorkspaceTreeItem(
                    projRoot.children.find(
                        (x) => x.friendlyName === constants.sqlcmdVariablesNodeName,
                    )!.children[0] /* LowerFolder */,
                ),
            );

            // reload project
            project = await Project.openProject(project.projectFilePath);
            expect(project.sqlCmdVariables.size).to.equal(
                2,
                "The project should still have 2 sqlcmd variables if no was selected",
            );
            showWarningStub.returns(<any>Promise.resolve("Yes"));
            await projController.delete(
                createWorkspaceTreeItem(
                    projRoot.children.find(
                        (x) => x.friendlyName === constants.sqlcmdVariablesNodeName,
                    )!.children[0],
                ),
            );

            // reload project
            project = await Project.openProject(project.projectFilePath);
            expect(project.sqlCmdVariables.size).to.equal(
                1,
                "The project should only have 1 sqlcmd variable after deletion",
            );
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

            expect(project.sqlCmdVariables.size).to.equal(
                2,
                "The project should start with 2 sqlcmd variables",
            );

            const inputBoxStub = sandbox.stub(vscode.window, "showInputBox");
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
            expect(project.sqlCmdVariables.size).to.equal(
                2,
                "The project should still have 2 sqlcmd variables if no name was provided",
            );

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
            expect(project.sqlCmdVariables.size).to.equal(
                3,
                "The project should have 3 sqlcmd variable after adding a new one",
            );
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

            expect(project.sqlCmdVariables.size).to.equal(
                2,
                "The project should start with 2 sqlcmd variables",
            );

            const inputBoxStub = sandbox.stub(vscode.window, "showInputBox");
            inputBoxStub.onFirstCall().resolves("newVariable");
            inputBoxStub.onSecondCall().resolves(undefined);
            const infoMessageStub = sandbox.stub(vscode.window, "showInformationMessage");
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
            expect(project.sqlCmdVariables.size).to.equal(
                2,
                "The project should still have 2 sqlcmd variables if no was selected for adding sqlcmd variable without a DefaultValue",
            );

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
            expect(project.sqlCmdVariables.size).to.equal(
                3,
                "The project should have 3 sqlcmd variable after adding a new one without a DefaultValue",
            );
            expect(project.sqlCmdVariables.get("newVariable")).to.equal(
                "",
                "The default value of newVariable should be an empty string",
            );
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

            expect(project.sqlCmdVariables.size).to.equal(
                2,
                "The project should start with 2 sqlcmd variables",
            );

            const inputBoxStub = sandbox.stub(vscode.window, "showInputBox");
            inputBoxStub.resolves("");
            const sqlcmdVarToUpdate = projRoot.children.find(
                (x) => x.friendlyName === constants.sqlcmdVariablesNodeName,
            )!.children[0];
            const originalValue = project.sqlCmdVariables.get(sqlcmdVarToUpdate.friendlyName);
            await projController.editSqlCmdVariable(createWorkspaceTreeItem(sqlcmdVarToUpdate));

            // reload project
            project = await Project.openProject(project.projectFilePath);
            expect(project.sqlCmdVariables.size).to.equal(
                2,
                "The project should still have 2 sqlcmd variables",
            );
            expect(project.sqlCmdVariables.get(sqlcmdVarToUpdate.friendlyName)).to.equal(
                originalValue,
                "The value of the sqlcmd variable should not have changed",
            );

            inputBoxStub.reset();
            const updatedValue = "newValue";
            inputBoxStub.resolves(updatedValue);
            await projController.editSqlCmdVariable(createWorkspaceTreeItem(sqlcmdVarToUpdate));

            // reload project
            project = await Project.openProject(project.projectFilePath);
            expect(project.sqlCmdVariables.size).to.equal(
                2,
                "The project should still have 2 sqlcmd variables",
            );
            expect(project.sqlCmdVariables.get(sqlcmdVarToUpdate.friendlyName)).to.equal(
                updatedValue,
                "The value of the sqlcmd variable should have been updated",
            );
        });

        // TODO: This test needs investigation - the file name stripping logic may need to be verified
        test.skip("Should remove file extensions from user input when creating files", async function (): Promise<void> {
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

            const showInputBoxStub = sandbox.stub(vscode.window, "showInputBox");
            const sanitizeStub = sandbox.stub(utils, "sanitizeStringForFilename");

            for (const testCase of testCases) {
                // Mock the user input
                showInputBoxStub.resolves(testCase.input);
                sanitizeStub.returns(testCase.input);

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
                expect(createdFile).to.not.be.undefined;
                expect(await utils.exists(path.join(project.projectFolderPath, expectedFileName)))
                    .to.be.true; // File ${expectedFileName} should exist on disk for input ${testCase.input}

                // Clean up for next iteration
                await project.deleteSqlObjectScript(createdFile!.relativePath);
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
    sandbox
        .stub(vscode.window, "showWarningMessage")
        .returns(<any>Promise.resolve(constants.yesString));

    // confirm setup
    expect(proj.sqlObjectScripts.length, "number of file entries").to.equal(3);
    expect(proj.folders.length, "number of folder entries").to.equal(2);
    expect(proj.preDeployScripts.length, "number of pre-deployment script entries").to.equal(1);
    expect(proj.postDeployScripts.length, "number of post-deployment script entries").to.equal(1);
    expect(proj.noneDeployScripts.length, "number of none script entries").to.equal(1);
    expect(path.parse(scriptEntry.fsUri.fsPath).base).to.equal("someScript.sql");
    expect((await fs.readFile(scriptEntry.fsUri.fsPath)).toString()).to.equal("not a real script");

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
