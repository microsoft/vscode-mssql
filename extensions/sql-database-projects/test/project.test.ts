/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as path from "path";
import * as sinon from "sinon";
import * as baselines from "./baselines/baselines";
import * as templates from "../src/templates/templates";
import * as testUtils from "./testUtils";
import * as constants from "../src/common/constants";

import { promises as fs } from "fs";
import { Project } from "../src/models/project";
import {
    exists,
    convertSlashesForSqlProj,
    getPlatformSafeFileEntryPath,
    systemDatabaseToString,
} from "../src/common/utils";
import { Uri, window } from "vscode";
import {
    IDacpacReferenceSettings,
    INugetPackageReferenceSettings,
    IProjectReferenceSettings,
    ISystemDatabaseReferenceSettings,
} from "../src/models/IDatabaseReferenceSettings";
import { ItemType } from "sqldbproj";
import {
    SystemDatabaseReferenceProjectEntry,
    SqlProjectReferenceProjectEntry,
    DacpacReferenceProjectEntry,
} from "../src/models/projectEntry";
import { ProjectType, SystemDatabase, SystemDbReferenceType } from "vscode-mssql";

suite("Project: sqlproj content operations", function (): void {
    suiteSetup(async function (): Promise<void> {
        await baselines.loadBaselines();
        await templates.loadTemplates(testUtils.getTemplatesRootPath());
    });

    suiteTeardown(async function (): Promise<void> {
        await testUtils.deleteGeneratedTestFolder();
    });

    test("Should read Project from sqlproj", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.openProjectFileBaseline,
        );
        const project: Project = await Project.openProject(projFilePath);

        // Files and folders
        expect(project.sqlObjectScripts.map((f) => f.relativePath)).to.deep.equal([
            "..\\Test\\Test.sql",
            "MyExternalStreamingJob.sql",
            "Tables\\Action History.sql",
            "Tables\\Users.sql",
            "Views\\Maintenance\\Database Performance.sql",
            "Views\\User\\Profile.sql",
        ]);

        expect(project.folders.map((f) => f.relativePath)).to.deep.equal([
            "Tables",
            "Views",
            "Views\\Maintenance",
            "Views\\User",
        ]);

        // SqlCmdVariables
        expect(project.sqlCmdVariables.size).to.equal(2);
        expect(project.sqlCmdVariables.get("ProdDatabaseName")).to.equal("MyProdDatabase");
        expect(project.sqlCmdVariables.get("BackupDatabaseName")).to.equal("MyBackupDatabase");

        // Database references
        // should only have one database reference even though there are two master.dacpac references (1 for ADS and 1 for SSDT)
        expect(project.databaseReferences.length).to.equal(1);
        expect(project.databaseReferences[0].referenceName).to.contain(constants.master);
        expect(
            project.databaseReferences[0] instanceof SystemDatabaseReferenceProjectEntry,
        ).to.equal(true);

        // Pre-post deployment scripts
        expect(project.preDeployScripts.length).to.equal(1);
        expect(project.postDeployScripts.length).to.equal(1);
        expect(project.noneDeployScripts.length).to.equal(2);
        expect(
            project.preDeployScripts.find((f) => f.relativePath === "Script.PreDeployment1.sql"),
            "File Script.PreDeployment1.sql not read",
        ).to.not.equal(undefined);
        expect(
            project.postDeployScripts.find((f) => f.relativePath === "Script.PostDeployment1.sql"),
            "File Script.PostDeployment1.sql not read",
        ).to.not.equal(undefined);
        expect(
            project.noneDeployScripts.find((f) => f.relativePath === "Script.PreDeployment2.sql"),
            "File Script.PostDeployment2.sql not read",
        ).to.not.equal(undefined);
        expect(
            project.noneDeployScripts.find(
                (f) => f.relativePath === "Tables\\Script.PostDeployment1.sql",
            ),
            "File Tables\\Script.PostDeployment1.sql not read",
        ).to.not.equal(undefined);

        // Publish profiles
        expect(project.publishProfiles.length).to.equal(3);
        expect(
            project.publishProfiles.find((f) => f.relativePath === "TestProjectName_1.publish.xml"),
            "Profile TestProjectName_1.publish.xml not read",
        ).to.not.equal(undefined);
        expect(
            project.publishProfiles.find((f) => f.relativePath === "TestProjectName_2.publish.xml"),
            "Profile TestProjectName_2.publish.xml not read",
        ).to.not.equal(undefined);
        expect(
            project.publishProfiles.find((f) => f.relativePath === "TestProjectName_3.publish.xml"),
            "Profile TestProjectName_3.publish.xml not read",
        ).to.not.equal(undefined);
    });

    test("Should read Project with Project reference from sqlproj", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.openProjectWithProjectReferencesBaseline,
        );
        const project: Project = await Project.openProject(projFilePath);

        // Database references
        // should only have two database references even though there are two master.dacpac references (1 for ADS and 1 for SSDT)
        expect(project.databaseReferences.length).to.equal(2);
        expect(project.databaseReferences[0].referenceName).to.contain("ReferencedTestProject");
        expect(project.databaseReferences[0] instanceof SqlProjectReferenceProjectEntry).to.be.true;
        expect(project.databaseReferences[1].referenceName).to.contain(constants.master);
        expect(project.databaseReferences[1] instanceof SystemDatabaseReferenceProjectEntry).to.be
            .true;
    });

    test("Should throw warning message while reading Project with more than 1 pre-deploy script from sqlproj", async function (): Promise<void> {
        const stub = sinon
            .stub(window, "showWarningMessage")
            .returns(<any>Promise.resolve(constants.okString));

        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.openSqlProjectWithPrePostDeploymentError,
        );
        const project: Project = await Project.openProject(projFilePath);

        expect(stub.calledOnce, "showWarningMessage should have been called exactly once").to.be
            .true;
        expect(
            stub.calledWith(constants.prePostDeployCount),
            `showWarningMessage not called with expected message '${constants.prePostDeployCount}' Actual '${stub.getCall(0).args[0]}'`,
        ).to.be.true;

        expect(project.preDeployScripts.length).to.equal(2);
        expect(project.postDeployScripts.length).to.equal(1);
        expect(project.noneDeployScripts.length).to.equal(1);
        expect(
            project.preDeployScripts.find((f) => f.relativePath === "Script.PreDeployment1.sql"),
            "File Script.PreDeployment1.sql not read",
        ).to.not.equal(undefined);
        expect(
            project.postDeployScripts.find((f) => f.relativePath === "Script.PostDeployment1.sql"),
            "File Script.PostDeployment1.sql not read",
        ).to.not.equal(undefined);
        expect(
            project.preDeployScripts.find((f) => f.relativePath === "Script.PreDeployment2.sql"),
            "File Script.PostDeployment2.sql not read",
        ).to.not.equal(undefined);
        expect(
            project.noneDeployScripts.find(
                (f) => f.relativePath === "Tables\\Script.PostDeployment1.sql",
            ),
            "File Tables\\Script.PostDeployment1.sql not read",
        ).to.not.equal(undefined);

        sinon.restore();
    });

    test("Should perform Folder and SQL object script operations", async function (): Promise<void> {
        const project = await testUtils.createTestSqlProject(this.test);

        const folderPath = "Stored Procedures";
        const scriptPath = path.join(folderPath, "Fake Stored Proc.sql");
        const scriptContents = "SELECT 'This is not actually a stored procedure.'";

        const scriptPathTagged = path.join(folderPath, "Fake External Streaming Job.sql");
        const scriptContentsTagged = "EXEC sys.sp_create_streaming_job 'job', 'SELECT 7'";

        expect(project.folders.length).to.equal(0);
        expect(project.sqlObjectScripts.length).to.equal(0);

        await project.addFolder(folderPath);
        await project.addScriptItem(scriptPath, scriptContents);
        await project.addScriptItem(
            scriptPathTagged,
            scriptContentsTagged,
            ItemType.externalStreamingJob,
        );

        expect(project.folders.length).to.equal(1);
        expect(project.sqlObjectScripts.length).to.equal(2);

        expect(
            project.folders.find((f) => f.relativePath === convertSlashesForSqlProj(folderPath)),
        ).to.not.equal(undefined);
        expect(
            project.sqlObjectScripts.find(
                (f) => f.relativePath === convertSlashesForSqlProj(scriptPath),
            ),
        ).to.not.equal(undefined);
        expect(
            project.sqlObjectScripts.find(
                (f) => f.relativePath === convertSlashesForSqlProj(scriptPathTagged),
            ),
        ).to.not.equal(undefined);
        // TODO: support for tagged entries not supported in DacFx.Projects
        //should(project.files.find(f => f.relativePath === convertSlashesForSqlProj(scriptPathTagged))?.sqlObjectType).equal(constants.ExternalStreamingJob);
    });

    test("Should bulk-add scripts to sqlproj with pre-existing scripts on disk", async function (): Promise<void> {
        const project = await testUtils.createTestSqlProject(this.test);

        // initial setup
        expect(project.sqlObjectScripts.length, "initial number of scripts").to.equal(0);

        // create files on disk
        const tablePath = path.join(project.projectFolderPath, "MyTable.sql");
        await fs.writeFile(tablePath, "CREATE TABLE [MyTable] ([Name] [nvarchar(50)");

        const viewPath = path.join(project.projectFolderPath, "MyView.sql");
        await fs.writeFile(viewPath, "CREATE VIEW [MyView] AS SELECT * FROM [MyTable]");

        // add to project
        await project.addSqlObjectScripts(["MyTable.sql", "MyView.sql"]);

        // verify result
        expect(project.sqlObjectScripts.length, "Number of scripts after adding").to.equal(2);
    });

    // TODO: move to DacFx once script contents supported
    // TODO: Test needs investigation - path format mismatch (long vs 8.3 short paths)
    test.skip("Should throw error while adding folders and SQL object scripts to sqlproj when a file does not exist on disk", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.openProjectFileBaseline,
        );
        const project = await testUtils.createTestSqlProject(this.test);

        let list: Uri[] = [];
        let testFolderPath: string = await testUtils.createDummyFileStructure(
            this.test,
            true,
            list,
            path.dirname(projFilePath),
        );

        const nonexistentFile = path.join(testFolderPath, "nonexistentFile.sql");
        list.push(Uri.file(nonexistentFile));

        const relativePaths = list.map((f) => path.relative(project.projectFolderPath, f.fsPath));

        await testUtils.shouldThrowSpecificError(
            async () => await project.addSqlObjectScripts(relativePaths),
            `Error: No script found at '${nonexistentFile}'`,
        );
    });

    test("Should perform pre-deployment script operations", async function (): Promise<void> {
        let project = await testUtils.createTestSqlProject(this.test);

        const relativePath = "Script.PreDeployment1.sql";
        const absolutePath = path.join(project.projectFolderPath, relativePath);
        const fileContents = "SELECT 7";

        // initial state
        expect(project.preDeployScripts.length, "initial state").to.equal(0);
        expect(await exists(absolutePath), "inital state").to.be.false;

        // add new
        await project.addScriptItem(relativePath, fileContents, ItemType.preDeployScript);
        expect(project.preDeployScripts.length).to.equal(1);
        expect(await exists(absolutePath), "add new").to.be.true;

        // read
        project = await Project.openProject(project.projectFilePath);
        expect(project.preDeployScripts.length, "read").to.equal(1);
        expect(project.preDeployScripts[0].relativePath, "read").to.equal(relativePath);

        // exclude
        await project.excludePreDeploymentScript(relativePath);
        expect(project.preDeployScripts.length, "exclude").to.equal(0);
        expect(await exists(absolutePath), "exclude").to.be.true;

        // add existing
        await project.addScriptItem(relativePath, undefined, ItemType.preDeployScript);
        expect(project.preDeployScripts.length, "add existing").to.equal(1);

        //delete
        await project.deletePreDeploymentScript(relativePath);
        expect(project.preDeployScripts.length, "delete").to.equal(0);
        expect(await exists(absolutePath), "delete").to.be.false;
    });

    test("Should show information messages when adding more than one pre/post deployment scripts to sqlproj", async function (): Promise<void> {
        const stub = sinon.stub(window, "showInformationMessage").returns(<any>Promise.resolve());

        const project: Project = await testUtils.createTestSqlProject(this.test);

        const preDeploymentScriptFilePath = "Script.PreDeployment1.sql";
        const postDeploymentScriptFilePath = "Script.PostDeployment1.sql";
        const preDeploymentScriptFilePath2 = "Script.PreDeployment2.sql";
        const postDeploymentScriptFilePath2 = "Script.PostDeployment2.sql";
        const fileContents = "SELECT 7";

        await project.addScriptItem(
            preDeploymentScriptFilePath,
            fileContents,
            ItemType.preDeployScript,
        );
        await project.addScriptItem(
            postDeploymentScriptFilePath,
            fileContents,
            ItemType.postDeployScript,
        );

        expect(stub.notCalled, "showInformationMessage should not have been called").to.be.true;

        await project.addScriptItem(
            preDeploymentScriptFilePath2,
            fileContents,
            ItemType.preDeployScript,
        );
        expect(
            stub.calledOnce,
            "showInformationMessage should have been called once after adding extra pre-deployment script",
        ).to.be.true;
        expect(
            stub.calledWith(constants.deployScriptExists(constants.PreDeploy)),
            `showInformationMessage not called with expected message '${constants.deployScriptExists(constants.PreDeploy)}'; actual: '${stub.firstCall.args[0]}'`,
        ).to.be.true;

        stub.resetHistory();

        await project.addScriptItem(
            postDeploymentScriptFilePath2,
            fileContents,
            ItemType.postDeployScript,
        );
        expect(
            stub.calledOnce,
            "showInformationMessage should have been called once after adding extra post-deployment script",
        ).to.be.true;
        expect(
            stub.calledWith(constants.deployScriptExists(constants.PostDeploy)),
            `showInformationMessage not called with expected message '${constants.deployScriptExists(constants.PostDeploy)}' Actual '${stub.getCall(0).args[0]}'`,
        ).to.be.true;
    });

    // TODO: move to DacFx once script contents supported
    test("Should not overwrite existing files", async function (): Promise<void> {
        // Create new sqlproj
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.newProjectFileBaseline,
        );
        const fileList = await testUtils.createListOfFiles(this.test, path.dirname(projFilePath));

        let project: Project = await Project.openProject(projFilePath);

        // Add a file entry to the project with explicit content
        let existingFileUri = fileList[3];
        let fileStats = await fs.stat(existingFileUri.fsPath);
        expect(fileStats.isFile(), "Fourth entry in fileList should be a file").to.equal(true);

        const relativePath = path.relative(path.dirname(projFilePath), existingFileUri.fsPath);
        await testUtils.shouldThrowSpecificError(
            async () => await project.addScriptItem(relativePath, "Hello World!"),
            `A file with the name '${path.parse(relativePath).name}' already exists on disk at this location. Please choose another name.`,
        );
    });

    // TODO: revisit correct behavior for this, since DacFx.Projects makes no restriction on absolute paths and external folders (which are represented as "..")
    test.skip("Should not add folders outside of the project folder", async function (): Promise<void> {
        // Create new sqlproj
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.newProjectFileBaseline,
        );

        let project: Project = await Project.openProject(projFilePath);

        // Try adding project root folder itself - this is silently ignored
        await project.addFolder(path.dirname(projFilePath));
        expect(project.sqlObjectScripts.length, "Nothing should be added to the project").to.equal(
            0,
        );

        // Try adding a parent of the project folder
        await testUtils.shouldThrowSpecificError(
            async () => await project.addFolder(path.dirname(path.dirname(projFilePath))),
            "Items with absolute path outside project folder are not supported. Please make sure the paths in the project file are relative to project folder.",
            "Folders outside the project folder should not be added.",
        );
    });

    test("Should handle adding existing items to project", async function (): Promise<void> {
        // Create new sqlproj
        const project: Project = await testUtils.createTestSqlProject(this.test);
        // Create 2 new files, a sql file and a txt file
        const sqlFile = path.join(project.projectFolderPath, "test.sql");
        const txtFile = path.join(project.projectFolderPath, "foo", "test.txt");
        await fs.writeFile(sqlFile, "CREATE TABLE T1 (C1 INT)");
        await fs.mkdir(path.dirname(txtFile));
        await fs.writeFile(txtFile, "Hello World!");

        await project.readProjFile();

        // Add them as existing files
        await project.addFolder("foo"); // TODO: This shouldn't be necessary; DacFx.Projects needs to refresh the in-memory folder list internally after adding items
        await project.addExistingItem(sqlFile);
        await project.addExistingItem(txtFile);

        // Validate files should have been added to project
        expect(
            project.sqlObjectScripts.length,
            `SQL script object count: ${project.sqlObjectScripts.map((x) => x.relativePath).join("; ")}`,
        ).to.equal(1);
        expect(project.sqlObjectScripts[0].relativePath).to.equal("test.sql");

        expect(project.folders.length, "folders").to.equal(1);
        expect(project.folders[0].relativePath).to.equal("foo");

        expect(project.noneDeployScripts.length, "<None> items").to.equal(1);
        expect(project.noneDeployScripts[0].relativePath).to.equal("foo\\test.txt");
    });

    test("Should read project properties", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.sqlProjPropertyReadBaseline,
        );
        const project: Project = await Project.openProject(projFilePath);

        expect(project.sqlProjStyle).to.equal(ProjectType.SdkStyle);
        expect(project.outputPath).to.equal(
            path.join(
                getPlatformSafeFileEntryPath(project.projectFolderPath),
                getPlatformSafeFileEntryPath("CustomOutputPath\\Dacpacs\\"),
            ),
        );
        expect(project.configuration).to.equal("Release");
        expect(project.getDatabaseSourceValues()).to.deep.equal([
            "oneSource",
            "twoSource",
            "redSource",
            "blueSource",
        ]);
        expect(project.getProjectTargetVersion()).to.equal("130");
    });
});

suite("Project: sdk style project content operations", function (): void {
    suiteSetup(async function (): Promise<void> {
        await baselines.loadBaselines();
    });

    setup(function (): void {
        sinon.restore();
    });

    suiteTeardown(async function (): Promise<void> {
        await testUtils.deleteGeneratedTestFolder();
    });

    test("Should exclude pre/post/none deploy scripts correctly", async function (): Promise<void> {
        const folderPath = await testUtils.generateTestFolderPath(this.test);
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.newSdkStyleProjectSdkNodeBaseline,
            folderPath,
        );

        const project: Project = await Project.openProject(projFilePath);
        await project.addScriptItem(
            "Script.PreDeployment1.sql",
            "fake contents",
            ItemType.preDeployScript,
        );
        await project.addScriptItem(
            "Script.PreDeployment2.sql",
            "fake contents",
            ItemType.preDeployScript,
        );
        await project.addScriptItem(
            "Script.PostDeployment1.sql",
            "fake contents",
            ItemType.postDeployScript,
        );

        // verify they were added to the sqlproj
        expect(
            project.preDeployScripts.length,
            "Script.PreDeployment1.sql should have been added",
        ).to.equal(1);
        expect(
            project.noneDeployScripts.length,
            "Script.PreDeployment2.sql should have been added",
        ).to.equal(1);
        expect(
            project.preDeployScripts.length,
            "Script.PostDeployment1.sql should have been added",
        ).to.equal(1);
        expect(
            project.sqlObjectScripts.length,
            "There should not be any SQL object scripts",
        ).to.equal(0);

        // exclude the pre/post/none deploy script
        await project.excludePreDeploymentScript("Script.PreDeployment1.sql");
        await project.excludeNoneItem("Script.PreDeployment2.sql");
        await project.excludePostDeploymentScript("Script.PostDeployment1.sql");

        expect(
            project.preDeployScripts.length,
            "Script.PreDeployment1.sql should have been removed",
        ).to.equal(0);
        expect(
            project.noneDeployScripts.length,
            "Script.PreDeployment2.sql should have been removed",
        ).to.equal(0);
        expect(
            project.postDeployScripts.length,
            "Script.PostDeployment1.sql should have been removed",
        ).to.equal(0);
        expect(
            project.sqlObjectScripts.length,
            "There should not be any SQL object scripts after the excludes",
        ).to.equal(0);
    });

    // TODO: Test needs investigation - folder count mismatch (expects 3, gets 5)
    test.skip("Should handle excluding glob included folders", async function (): Promise<void> {
        const testFolderPath = await testUtils.generateTestFolderPath(this.test);
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.openSdkStyleSqlProjectBaseline,
            testFolderPath,
        );
        await testUtils.createDummyFileStructureWithPrePostDeployScripts(
            this.test,
            false,
            undefined,
            path.dirname(projFilePath),
        );

        const project: Project = await Project.openProject(projFilePath);

        expect(project.sqlObjectScripts.length).to.equal(13);
        expect(project.folders.length).to.equal(3);
        expect(project.noneDeployScripts.length).to.equal(2);

        // try to exclude a glob included folder
        await project.excludeFolder("folder1");

        // verify folder and contents are excluded
        expect(project.folders.length).to.equal(1);
        expect(project.sqlObjectScripts.length).to.equal(6);
        expect(
            project.noneDeployScripts.length,
            "Script.PostDeployment2.sql should have been excluded",
        ).to.equal(1);
        expect(project.folders.find((f) => f.relativePath === "folder1")).to.equal(undefined);
    });

    // TODO: Test needs investigation - folder count mismatch (expects 3, gets 5)
    test.skip("Should handle excluding folders", async function (): Promise<void> {
        const testFolderPath = await testUtils.generateTestFolderPath(this.test);
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.openSdkStyleSqlProjectBaseline,
            testFolderPath,
        );
        await testUtils.createDummyFileStructureWithPrePostDeployScripts(
            this.test,
            false,
            undefined,
            path.dirname(projFilePath),
        );

        const project: Project = await Project.openProject(projFilePath);

        expect(project.sqlObjectScripts.length).to.equal(13);
        expect(project.folders.length).to.equal(3);

        // try to exclude a glob included folder
        await project.excludeFolder("folder1\\nestedFolder");

        // verify folder and contents are excluded
        expect(project.folders.length).to.equal(2);
        expect(project.sqlObjectScripts.length).to.equal(11);
        expect(project.folders.find((f) => f.relativePath === "folder1\\nestedFolder")).to.equal(
            undefined,
        );
    });

    // skipped because exclude folder not yet supported
    test("Should handle excluding explicitly included folders", async function (): Promise<void> {
        const testFolderPath = await testUtils.generateTestFolderPath(this.test);
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.openSdkStyleSqlProjectWithFilesSpecifiedBaseline,
            testFolderPath,
        );
        await testUtils.createDummyFileStructure(
            this.test,
            false,
            undefined,
            path.dirname(projFilePath),
        );

        const project: Project = await Project.openProject(projFilePath);

        expect(project.sqlObjectScripts.length).to.equal(11);
        expect(project.folders.length).to.equal(2);
        expect(project.folders.find((f) => f.relativePath === "folder1")!).to.not.equal(undefined);
        expect(project.folders.find((f) => f.relativePath === "folder2")!).to.not.equal(undefined);

        // try to exclude an explicitly included folder without trailing \ in sqlproj
        await project.excludeFolder("folder1");

        // verify folder and contents are excluded
        expect(project.folders.length).to.equal(1);
        expect(project.sqlObjectScripts.length).to.equal(6);
        expect(project.folders.find((f) => f.relativePath === "folder1")).to.equal(undefined);

        // try to exclude an explicitly included folder with trailing \ in sqlproj
        await project.excludeFolder("folder2");

        // verify folder and contents are excluded
        expect(project.folders.length).to.equal(0);
        expect(project.sqlObjectScripts.length).to.equal(1);
        expect(project.folders.find((f) => f.relativePath === "folder2")).to.equal(undefined);
    });

    test("Should handle deleting explicitly included folders", async function (): Promise<void> {
        const testFolderPath = await testUtils.generateTestFolderPath(this.test);
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.openSdkStyleSqlProjectWithFilesSpecifiedBaseline,
            testFolderPath,
        );
        await testUtils.createDummyFileStructureWithPrePostDeployScripts(
            this.test,
            false,
            undefined,
            path.dirname(projFilePath),
        );

        const project: Project = await Project.openProject(projFilePath);

        expect(project.sqlObjectScripts.length).to.equal(13);
        expect(project.folders.length).to.equal(3);
        expect(project.folders.find((f) => f.relativePath === "folder1")!).to.not.equal(undefined);
        expect(project.folders.find((f) => f.relativePath === "folder2")!).to.not.equal(undefined);

        // try to delete an explicitly included folder with the trailing \ in sqlproj
        await project.deleteFolder("folder2");

        // verify the project not longer has folder2 and its contents
        expect(project.folders.length).to.equal(2);
        expect(project.sqlObjectScripts.length).to.equal(8);
        expect(project.folders.find((f) => f.relativePath === "folder2")).to.equal(undefined);

        // try to delete an explicitly included folder without trailing \ in sqlproj
        await project.deleteFolder("folder1");

        // verify the project not longer has folder1 and its contents
        expect(project.folders.length).to.equal(0);
        expect(project.sqlObjectScripts.length).to.equal(1);
        expect(project.folders.find((f) => f.relativePath === "folder1")).to.equal(undefined);
    });

    // TODO: remove once DacFx exposes both absolute and relative outputPath
    test("Should read OutputPath from sqlproj if there is one for SDK-style project", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.openSdkStyleSqlProjectBaseline,
        );
        const projFileText = (await fs.readFile(projFilePath)).toString();

        // Verify sqlproj has OutputPath
        expect(projFileText.includes(constants.OutputPath)).to.equal(true);

        const project: Project = await Project.openProject(projFilePath);
        expect(project.outputPath).to.equal(
            path.join(
                getPlatformSafeFileEntryPath(project.projectFolderPath),
                getPlatformSafeFileEntryPath("..\\otherFolder"),
            ),
        );
        expect(project.dacpacOutputPath).to.equal(
            path.join(
                getPlatformSafeFileEntryPath(project.projectFolderPath),
                getPlatformSafeFileEntryPath("..\\otherFolder"),
                `${project.projectFileName}.dacpac`,
            ),
        );
    });

    // TODO: move test to DacFx
    test("Should use default output path if OutputPath is not specified in sqlproj", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.openSdkStyleSqlProjectWithGlobsSpecifiedBaseline,
        );
        const projFileText = (await fs.readFile(projFilePath)).toString();

        // Verify sqlproj doesn't have <OutputPath>
        expect(projFileText.includes(`<${constants.OutputPath}>`)).to.equal(false);

        const project: Project = await Project.openProject(projFilePath);
        expect(project.outputPath).to.equal(
            path.join(
                getPlatformSafeFileEntryPath(project.projectFolderPath),
                getPlatformSafeFileEntryPath(
                    constants.defaultOutputPath(project.configuration.toString()),
                ),
            ) + path.sep,
        );
        expect(project.dacpacOutputPath).to.equal(
            path.join(
                getPlatformSafeFileEntryPath(project.projectFolderPath),
                getPlatformSafeFileEntryPath(
                    constants.defaultOutputPath(project.configuration.toString()),
                ),
                `${project.projectFileName}.dacpac`,
            ),
        );
    });
});

suite("Project: database references", function (): void {
    suiteSetup(async function (): Promise<void> {
        await baselines.loadBaselines();
    });

    suiteTeardown(async function (): Promise<void> {
        await testUtils.deleteGeneratedTestFolder();
    });

    test("Should read database references correctly", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.databaseReferencesReadBaseline,
        );
        const project = await Project.openProject(projFilePath);
        expect(project.databaseReferences.length, "NUmber of database references").to.equal(5);

        const systemRef: SystemDatabaseReferenceProjectEntry | undefined =
            project.databaseReferences.find(
                (r) => r instanceof SystemDatabaseReferenceProjectEntry,
            ) as SystemDatabaseReferenceProjectEntry;
        expect(systemRef, "msdb reference").to.not.equal(undefined);
        expect(systemRef!.referenceName).to.equal(constants.msdb);
        expect(systemRef!.databaseVariableLiteralValue!).to.equal("msdbLiteral");
        expect(
            systemRef!.suppressMissingDependenciesErrors,
            "suppressMissingDependenciesErrors for system db",
        ).to.equal(true);

        let projRef: SqlProjectReferenceProjectEntry | undefined = project.databaseReferences.find(
            (r) =>
                r instanceof SqlProjectReferenceProjectEntry &&
                r.referenceName === "ReferencedProject",
        ) as SqlProjectReferenceProjectEntry;
        expect(projRef, "ReferencedProject reference").to.not.equal(undefined);
        expect(projRef!.pathForSqlProj()).to.equal(
            "..\\ReferencedProject\\ReferencedProject.sqlproj",
        );
        expect(projRef!.projectGuid).to.equal("{BA5EBA11-C0DE-5EA7-ACED-BABB1E70A575}");
        expect(
            projRef!.databaseVariableLiteralValue,
            "databaseVariableLiteralValue for ReferencedProject",
        ).to.equal(null);
        expect(projRef!.databaseSqlCmdVariableName!).to.equal("projDbVar");
        expect(projRef!.databaseSqlCmdVariableValue!).to.equal("$(SqlCmdVar__1)");
        expect(projRef!.serverSqlCmdVariableName!).to.equal("projServerVar");
        expect(projRef!.serverSqlCmdVariableValue!).to.equal("$(SqlCmdVar__2)");
        expect(
            projRef!.suppressMissingDependenciesErrors,
            "suppressMissingDependenciesErrors for ReferencedProject",
        ).to.equal(true);

        projRef = project.databaseReferences.find(
            (r) =>
                r instanceof SqlProjectReferenceProjectEntry && r.referenceName === "OtherProject",
        ) as SqlProjectReferenceProjectEntry;
        expect(projRef, "OtherProject reference").to.not.equal(undefined);
        expect(projRef!.pathForSqlProj()).to.equal("..\\OtherProject\\OtherProject.sqlproj");
        expect(projRef!.projectGuid).to.equal("{C0DEBA11-BA5E-5EA7-ACE5-BABB1E70A575}");
        expect(
            projRef!.databaseVariableLiteralValue!,
            "databaseVariableLiteralValue for OtherProject",
        ).to.equal("OtherProjLiteral");
        expect(projRef!.databaseSqlCmdVariableName).to.equal(undefined);
        expect(projRef!.databaseSqlCmdVariableValue).to.equal(undefined);
        expect(projRef!.serverSqlCmdVariableName).to.equal(undefined);
        expect(projRef!.serverSqlCmdVariableValue).to.equal(undefined);
        expect(
            projRef!.suppressMissingDependenciesErrors,
            "suppressMissingDependenciesErrors for OtherProject",
        ).to.equal(false);

        let dacpacRef: DacpacReferenceProjectEntry | undefined = project.databaseReferences.find(
            (r) =>
                r instanceof DacpacReferenceProjectEntry && r.referenceName === "ReferencedDacpac",
        ) as DacpacReferenceProjectEntry;
        expect(dacpacRef, "dacpac reference for ReferencedDacpac").to.not.equal(undefined);
        expect(dacpacRef!.pathForSqlProj()).to.equal(
            "..\\ReferencedDacpac\\ReferencedDacpac.dacpac",
        );
        expect(
            dacpacRef!.databaseVariableLiteralValue,
            "databaseVariableLiteralValue for ReferencedDacpac",
        ).to.equal(null);
        expect(dacpacRef!.databaseSqlCmdVariableName!).to.equal("dacpacDbVar");
        expect(dacpacRef!.databaseSqlCmdVariableValue!).to.equal("$(SqlCmdVar__3)");
        expect(dacpacRef!.serverSqlCmdVariableName!).to.equal("dacpacServerVar");
        expect(dacpacRef!.serverSqlCmdVariableValue!).to.equal("$(SqlCmdVar__4)");
        expect(
            dacpacRef!.suppressMissingDependenciesErrors,
            "suppressMissingDependenciesErrors for ReferencedDacpac",
        ).to.equal(false);

        dacpacRef = project.databaseReferences.find(
            (r) => r instanceof DacpacReferenceProjectEntry && r.referenceName === "OtherDacpac",
        ) as DacpacReferenceProjectEntry;
        expect(dacpacRef, "dacpac reference for OtherDacpac").to.not.equal(undefined);
        expect(dacpacRef!.pathForSqlProj()).to.equal("..\\OtherDacpac\\OtherDacpac.dacpac");
        expect(
            dacpacRef!.databaseVariableLiteralValue!,
            "databaseVariableLiteralValue for OtherDacpac",
        ).to.equal("OtherDacpacLiteral");
        expect(dacpacRef!.databaseSqlCmdVariableName).to.equal(undefined);
        expect(dacpacRef!.databaseSqlCmdVariableValue).to.equal(undefined);
        expect(dacpacRef!.serverSqlCmdVariableName).to.equal(undefined);
        expect(dacpacRef!.serverSqlCmdVariableValue).to.equal(undefined);
        expect(
            dacpacRef!.suppressMissingDependenciesErrors,
            "suppressMissingDependenciesErrors for OtherDacpac",
        ).to.equal(true);
    });

    test("Should delete database references correctly", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.databaseReferencesReadBaseline,
        );
        const project = await Project.openProject(projFilePath);

        expect(
            project.databaseReferences.length,
            "There should be five database references",
        ).to.equal(5);

        await project.deleteDatabaseReference(constants.msdb);
        expect(
            project.databaseReferences.length,
            "There should be four database references after deletion",
        ).to.equal(4);

        let ref = project.databaseReferences.find((r) => r.referenceName === constants.msdb);
        expect(ref, "msdb reference should be deleted").to.equal(undefined);
    });

    test("Should add system database artifact reference correctly", async function (): Promise<void> {
        let project = await testUtils.createTestSqlProject(this.test);

        const msdbRefSettings: ISystemDatabaseReferenceSettings = {
            databaseVariableLiteralValue: systemDatabaseToString(SystemDatabase.MSDB),
            systemDb: SystemDatabase.MSDB,
            suppressMissingDependenciesErrors: true,
            systemDbReferenceType: SystemDbReferenceType.ArtifactReference,
        };
        await project.addSystemDatabaseReference(msdbRefSettings);

        expect(
            project.databaseReferences.length,
            "There should be one database reference after adding a reference to msdb",
        ).to.equal(1);
        expect(project.databaseReferences[0].referenceName, "databaseName").to.equal(
            msdbRefSettings.databaseVariableLiteralValue,
        );
        expect(
            project.databaseReferences[0].suppressMissingDependenciesErrors,
            "suppressMissingDependenciesErrors",
        ).to.equal(msdbRefSettings.suppressMissingDependenciesErrors);
        const projFileText = (await fs.readFile(project.projectFilePath)).toString();
        expect(projFileText).to.contain('<ArtifactReference Include="$(SystemDacpacsLocation)');
    });

    // TODO: Test needs investigation - PackageReference format not found in sqlproj
    test.skip("Should add system database package reference correctly", async function (): Promise<void> {
        let project = await testUtils.createTestSqlProject(this.test);

        const msdbRefSettings: ISystemDatabaseReferenceSettings = {
            databaseVariableLiteralValue: systemDatabaseToString(SystemDatabase.MSDB),
            systemDb: SystemDatabase.MSDB,
            suppressMissingDependenciesErrors: true,
            systemDbReferenceType: SystemDbReferenceType.PackageReference,
        };
        await project.addSystemDatabaseReference(msdbRefSettings);

        expect(
            project.databaseReferences.length,
            "There should be one database reference after adding a reference to msdb",
        ).to.equal(1);
        expect(project.databaseReferences[0].referenceName, "databaseName").to.equal(
            msdbRefSettings.databaseVariableLiteralValue,
        );
        expect(
            project.databaseReferences[0].suppressMissingDependenciesErrors,
            "suppressMissingDependenciesErrors",
        ).to.equal(msdbRefSettings.suppressMissingDependenciesErrors);
        const projFileText = (await fs.readFile(project.projectFilePath)).toString();
        expect(projFileText).to.contain('Include="Microsoft.SqlServer.Dacpacs.Msdb">');
    });

    test("Should add a dacpac reference to the same database correctly", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.newProjectFileBaseline,
        );
        let project = await Project.openProject(projFilePath);

        // add database reference in the same database
        expect(
            project.databaseReferences.length,
            "There should be no database references to start with",
        ).to.equal(0);
        await project.addDatabaseReference({
            dacpacFileLocation: Uri.file("test1.dacpac"),
            suppressMissingDependenciesErrors: true,
        });

        expect(
            project.databaseReferences.length,
            "There should be a database reference after adding a reference to test1",
        ).to.equal(1);
        expect(
            project.databaseReferences[0].referenceName,
            "The database reference should be test1",
        ).to.equal("test1");
        expect(
            project.databaseReferences[0].suppressMissingDependenciesErrors,
            "project.databaseReferences[0].suppressMissingDependenciesErrors should be true",
        ).to.equal(true);
    });

    test("Should add a dacpac reference to a different database in the same server correctly", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.newProjectFileBaseline,
        );
        const project = await Project.openProject(projFilePath);

        // add database reference to a different database on the same server
        expect(
            project.databaseReferences.length,
            "There should be no database references to start with",
        ).to.equal(0);
        await project.addDatabaseReference({
            dacpacFileLocation: Uri.file("test2.dacpac"),
            databaseName: "test2DbName",
            databaseVariable: "test2Db",
            suppressMissingDependenciesErrors: false,
        });
        expect(
            project.databaseReferences.length,
            "There should be a database reference after adding a reference to test2",
        ).to.equal(1);
        expect(
            project.databaseReferences[0].referenceName,
            "The database reference should be test2",
        ).to.equal("test2");
        expect(
            project.databaseReferences[0].suppressMissingDependenciesErrors,
            "project.databaseReferences[0].suppressMissingDependenciesErrors should be false",
        ).to.equal(false);
    });

    test("Should add a dacpac reference to a different database in a different server correctly", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.newProjectFileBaseline,
        );
        const project = await Project.openProject(projFilePath);

        // add database reference to a different database on a different server
        expect(
            project.databaseReferences.length,
            "There should be no database references to start with",
        ).to.equal(0);
        await project.addDatabaseReference({
            dacpacFileLocation: Uri.file("test3.dacpac"),
            databaseName: "test3DbName",
            databaseVariable: "test3Db",
            serverName: "otherServerName",
            serverVariable: "otherServer",
            suppressMissingDependenciesErrors: false,
        });
        expect(
            project.databaseReferences.length,
            "There should be a database reference after adding a reference to test3",
        ).to.equal(1);
        expect(
            project.databaseReferences[0].referenceName,
            "The database reference should be test3",
        ).to.equal("test3");
        expect(
            project.databaseReferences[0].suppressMissingDependenciesErrors,
            "project.databaseReferences[0].suppressMissingDependenciesErrors should be false",
        ).to.equal(false);
    });

    test("Should add a project reference to the same database correctly", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.newProjectFileBaseline,
        );
        let project = await Project.openProject(projFilePath);

        // add database reference to the same database
        expect(
            project.databaseReferences.length,
            "There should be no database references to start with",
        ).to.equal(0);
        expect(
            project.sqlCmdVariables.size,
            `There should be no sqlcmd variables to start with. Actual: ${project.sqlCmdVariables.size}`,
        ).to.equal(0);
        await project.addProjectReference({
            projectName: "project1",
            projectGuid: "",
            projectRelativePath: Uri.file(path.join("..", "project1", "project1.sqlproj")),
            suppressMissingDependenciesErrors: false,
        });

        expect(
            project.databaseReferences.length,
            "There should be a database reference after adding a reference to project1",
        ).to.equal(1);
        expect(
            project.databaseReferences[0].referenceName,
            "The database reference should be project1",
        ).to.equal("project1");
        expect(
            project.databaseReferences[0].suppressMissingDependenciesErrors,
            "project.databaseReferences[0].suppressMissingDependenciesErrors should be false",
        ).to.equal(false);
        expect(
            project.sqlCmdVariables.size,
            `There should be no sqlcmd variables added. Actual: ${project.sqlCmdVariables.size}`,
        ).to.equal(0);
    });

    test("Should add a project reference to a different database in the same server correctly", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.newProjectFileBaseline,
        );
        let project = await Project.openProject(projFilePath);

        // add database reference to a different database on the same different server
        expect(
            project.databaseReferences.length,
            "There should be no database references to start with",
        ).to.equal(0);
        expect(
            project.sqlCmdVariables.size,
            "There should be no sqlcmd variables to start with",
        ).to.equal(0);
        await project.addProjectReference({
            projectName: "project1",
            projectGuid: "",
            projectRelativePath: Uri.file(path.join("..", "project1", "project1.sqlproj")),
            databaseName: "testdbName",
            databaseVariable: "testdb",
            suppressMissingDependenciesErrors: false,
        });

        expect(
            project.databaseReferences.length,
            "There should be a database reference after adding a reference to project1",
        ).to.equal(1);
        expect(
            project.databaseReferences[0].referenceName,
            "The database reference should be project1",
        ).to.equal("project1");
        expect(
            project.databaseReferences[0].suppressMissingDependenciesErrors,
            "project.databaseReferences[0].suppressMissingDependenciesErrors should be false",
        ).to.equal(false);
        expect(
            project.sqlCmdVariables.size,
            `There should be one new sqlcmd variable added. Actual: ${project.sqlCmdVariables.size}`,
        ).to.equal(1);
    });

    test("Should add a project reference to a different database in a different server correctly", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.newProjectFileBaseline,
        );
        let project = await Project.openProject(projFilePath);

        // add database reference to a different database on a different server
        expect(
            project.databaseReferences.length,
            "There should be no database references to start with",
        ).to.equal(0);
        expect(
            project.sqlCmdVariables.size,
            "There should be no sqlcmd variables to start with",
        ).to.equal(0);
        await project.addProjectReference({
            projectName: "project1",
            projectGuid: "",
            projectRelativePath: Uri.file(path.join("..", "project1", "project1.sqlproj")),
            databaseName: "testdbName",
            databaseVariable: "testdb",
            serverName: "otherServerName",
            serverVariable: "otherServer",
            suppressMissingDependenciesErrors: false,
        });

        expect(
            project.databaseReferences.length,
            "There should be a database reference after adding a reference to project1",
        ).to.equal(1);
        expect(
            project.databaseReferences[0].referenceName,
            "The database reference should be project1",
        ).to.equal("project1");
        expect(
            project.databaseReferences[0].suppressMissingDependenciesErrors,
            "project.databaseReferences[0].suppressMissingDependenciesErrors should be false",
        ).to.equal(false);
        expect(
            project.sqlCmdVariables.size,
            `There should be two new sqlcmd variables added. Actual: ${project.sqlCmdVariables.size}`,
        ).to.equal(2);
    });

    test("Should add a nupkg reference to the same database correctly", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.newSdkStyleProjectSdkNodeBaseline,
        );
        let project = await Project.openProject(projFilePath);

        // add database reference to the same database
        expect(project.sqlProjStyle, "Project should be SDK-style").to.equal(ProjectType.SdkStyle);
        expect(
            project.databaseReferences.length,
            "There should be no database references to start with",
        ).to.equal(0);
        expect(
            project.sqlCmdVariables.size,
            `There should be no sqlcmd variables to start with. Actual: ${project.sqlCmdVariables.size}`,
        ).to.equal(0);
        await project.addNugetPackageReference({
            packageName: "testPackage",
            packageVersion: "1.0.1",
            suppressMissingDependenciesErrors: false,
        });

        expect(
            project.databaseReferences.length,
            "There should be a database reference after adding a reference to project1",
        ).to.equal(1);
        expect(
            project.databaseReferences[0].referenceName,
            "The database reference should be project1",
        ).to.equal("testPackage");
        expect(
            project.databaseReferences[0].suppressMissingDependenciesErrors,
            "project.databaseReferences[0].suppressMissingDependenciesErrors should be false",
        ).to.equal(false);
        expect(
            project.sqlCmdVariables.size,
            `There should be no sqlcmd variables added. Actual: ${project.sqlCmdVariables.size}`,
        ).to.equal(0);
    });

    test("Should add a nupkg reference to a different database in the same server correctly", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.newSdkStyleProjectSdkNodeBaseline,
        );
        let project = await Project.openProject(projFilePath);

        // add database reference to a different database on the same different server
        expect(
            project.databaseReferences.length,
            "There should be no database references to start with",
        ).to.equal(0);
        expect(
            project.sqlCmdVariables.size,
            "There should be no sqlcmd variables to start with",
        ).to.equal(0);
        await project.addNugetPackageReference({
            packageName: "testPackage",
            packageVersion: "1.0.1",
            databaseName: "testdbName",
            databaseVariable: "testdb",
            suppressMissingDependenciesErrors: false,
        });

        expect(
            project.databaseReferences.length,
            "There should be a database reference after adding a reference to testPackage",
        ).to.equal(1);
        expect(
            project.databaseReferences[0].referenceName,
            "The database reference should be testPackage",
        ).to.equal("testPackage");
        expect(
            project.databaseReferences[0].suppressMissingDependenciesErrors,
            "project.databaseReferences[0].suppressMissingDependenciesErrors should be false",
        ).to.equal(false);
        expect(
            project.sqlCmdVariables.size,
            `There should be one new sqlcmd variable added. Actual: ${project.sqlCmdVariables.size}`,
        ).to.equal(1);
    });

    test("Should add a nupkg reference to a different database in a different server correctly", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.newSdkStyleProjectSdkNodeBaseline,
        );
        let project = await Project.openProject(projFilePath);

        // add database reference to a different database on a different server
        expect(
            project.databaseReferences.length,
            "There should be no database references to start with",
        ).to.equal(0);
        expect(
            project.sqlCmdVariables.size,
            "There should be no sqlcmd variables to start with",
        ).to.equal(0);
        await project.addNugetPackageReference({
            packageName: "testPackage",
            packageVersion: "1.0.1",
            databaseName: "testdbName",
            databaseVariable: "testdb",
            serverName: "otherServerName",
            serverVariable: "otherServer",
            suppressMissingDependenciesErrors: false,
        });

        expect(
            project.databaseReferences.length,
            "There should be a database reference after adding a reference to testPackage",
        ).to.equal(1);
        expect(
            project.databaseReferences[0].referenceName,
            "The database reference should be testPackage",
        ).to.equal("testPackage");
        expect(
            project.databaseReferences[0].suppressMissingDependenciesErrors,
            "project.databaseReferences[0].suppressMissingDependenciesErrors should be false",
        ).to.equal(false);
        expect(
            project.sqlCmdVariables.size,
            `There should be two new sqlcmd variables added. Actual: ${project.sqlCmdVariables.size}`,
        ).to.equal(2);
    });

    // TODO: Test needs investigation - path format mismatch (long vs 8.3 short paths)
    test.skip("Should throw an error trying to add a nupkg reference to legacy style project", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.newProjectFileBaseline,
        );
        let project = await Project.openProject(projFilePath);

        // add database reference to the same database
        expect(project.sqlProjStyle, "Project should be legacy-style").to.equal(
            ProjectType.LegacyStyle,
        );
        expect(
            project.databaseReferences.length,
            "There should be no database references to start with",
        ).to.equal(0);
        expect(
            project.sqlCmdVariables.size,
            `There should be no sqlcmd variables to start with. Actual: ${project.sqlCmdVariables.size}`,
        ).to.equal(0);
        await testUtils.shouldThrowSpecificError(
            async () =>
                await project.addNugetPackageReference({
                    packageName: "testPackage",
                    packageVersion: "1.0.1",
                    suppressMissingDependenciesErrors: false,
                }),
            `Error adding database reference to testPackage. Error: Nuget package database references are not supported for the project ${project.projectFilePath}`,
        );

        expect(
            project.databaseReferences.length,
            "There should not have been any database reference added",
        ).to.equal(0);
    });

    test("Should not allow adding duplicate dacpac references", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.newProjectFileBaseline,
        );
        let project = await Project.openProject(projFilePath);

        expect(
            project.databaseReferences.length,
            "There should be no database references to start with",
        ).to.equal(0);

        const dacpacReference: IDacpacReferenceSettings = {
            dacpacFileLocation: Uri.file("test.dacpac"),
            suppressMissingDependenciesErrors: false,
        };
        await project.addDatabaseReference(dacpacReference);

        expect(
            project.databaseReferences.length,
            "There should be one database reference after adding a reference to test.dacpac",
        ).to.equal(1);
        expect(
            project.databaseReferences[0].referenceName,
            "project.databaseReferences[0].databaseName should be test",
        ).to.equal("test");

        // try to add reference to test.dacpac again
        await testUtils.shouldThrowSpecificError(
            async () => await project.addDatabaseReference(dacpacReference),
            constants.databaseReferenceAlreadyExists,
        );
        expect(
            project.databaseReferences.length,
            "There should be one database reference after trying to add a reference to test.dacpac again",
        ).to.equal(1);
    });

    test("Should not allow adding duplicate system database references", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.newProjectFileBaseline,
        );
        let project = await Project.openProject(projFilePath);

        expect(
            project.databaseReferences.length,
            "There should be no database references to start with",
        ).to.equal(0);

        const systemDbReference: ISystemDatabaseReferenceSettings = {
            databaseVariableLiteralValue: systemDatabaseToString(SystemDatabase.Master),
            systemDb: SystemDatabase.Master,
            suppressMissingDependenciesErrors: false,
            systemDbReferenceType: SystemDbReferenceType.ArtifactReference,
        };
        await project.addSystemDatabaseReference(systemDbReference);
        project = await Project.openProject(projFilePath);
        expect(
            project.databaseReferences.length,
            "There should be one database reference after adding a reference to master",
        ).to.equal(1);
        expect(
            project.databaseReferences[0].referenceName,
            "project.databaseReferences[0].databaseName should be master",
        ).to.equal(constants.master);

        // try to add reference to master again
        await testUtils.shouldThrowSpecificError(
            async () => await project.addSystemDatabaseReference(systemDbReference),
            constants.databaseReferenceAlreadyExists,
        );
        expect(
            project.databaseReferences.length,
            "There should only be one database reference after trying to add a reference to master again",
        ).to.equal(1);
    });

    test("Should not allow adding duplicate project references", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.newProjectFileBaseline,
        );
        let project = await Project.openProject(projFilePath);

        expect(
            project.databaseReferences.length,
            "There should be no database references to start with",
        ).to.equal(0);

        const projectReference: IProjectReferenceSettings = {
            projectName: "testProject",
            projectGuid: "",
            projectRelativePath: Uri.file("testProject.sqlproj"),
            suppressMissingDependenciesErrors: false,
        };
        await project.addProjectReference(projectReference);

        expect(
            project.databaseReferences.length,
            "There should be one database reference after adding a reference to testProject.sqlproj",
        ).to.equal(1);
        expect(
            project.databaseReferences[0].referenceName,
            "project.databaseReferences[0].databaseName should be testProject",
        ).to.equal("testProject");

        // try to add reference to testProject again
        await testUtils.shouldThrowSpecificError(
            async () => await project.addProjectReference(projectReference),
            constants.databaseReferenceAlreadyExists,
        );
        expect(
            project.databaseReferences.length,
            "There should be one database reference after trying to add a reference to testProject again",
        ).to.equal(1);
    });

    test("Should not allow adding duplicate nupkg references", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.newSdkStyleProjectSdkNodeBaseline,
        );
        let project = await Project.openProject(projFilePath);

        expect(
            project.databaseReferences.length,
            "There should be no database references to start with",
        ).to.equal(0);

        const nupkgReference: INugetPackageReferenceSettings = {
            packageName: "testPackage",
            packageVersion: "1.0.0",
            suppressMissingDependenciesErrors: false,
        };
        await project.addNugetPackageReference(nupkgReference);

        expect(
            project.databaseReferences.length,
            "There should be one database reference after adding a reference to testPackage",
        ).to.equal(1);
        expect(
            project.databaseReferences[0].referenceName,
            "project.databaseReferences[0].databaseName should be testPackage",
        ).to.equal("testPackage");

        // try to add reference to testPackage again
        await testUtils.shouldThrowSpecificError(
            async () => await project.addNugetPackageReference(nupkgReference),
            constants.databaseReferenceAlreadyExists,
        );
        expect(
            project.databaseReferences.length,
            "There should be one database reference after trying to add a reference to testPackage again",
        ).to.equal(1);
    });

    test("Should handle trying to add duplicate database references when slashes are different direction", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.newProjectFileBaseline,
        );
        let project = await Project.openProject(projFilePath);

        expect(
            project.databaseReferences.length,
            "There should be no database references to start with",
        ).to.equal(0);

        const projectReference: IProjectReferenceSettings = {
            projectName: "testProject",
            projectGuid: "",
            projectRelativePath: Uri.file("testFolder/testProject.sqlproj"),
            suppressMissingDependenciesErrors: false,
        };
        await project.addProjectReference(projectReference);

        expect(
            project.databaseReferences.length,
            "There should be one database reference after adding a reference to testProject.sqlproj",
        ).to.equal(1);
        expect(
            project.databaseReferences[0].referenceName,
            "project.databaseReferences[0].databaseName should be testProject",
        ).to.equal("testProject");

        // try to add reference to testProject again with slashes in the other direction
        projectReference.projectRelativePath = Uri.file("testFolder\\testProject.sqlproj");
        await testUtils.shouldThrowSpecificError(
            async () => await project.addProjectReference(projectReference),
            constants.databaseReferenceAlreadyExists,
        );
        expect(
            project.databaseReferences.length,
            "There should be one database reference after trying to add a reference to testProject again",
        ).to.equal(1);
    });

    test("Should update sqlcmd variable values if value changes", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.newProjectFileBaseline,
        );
        const project = await Project.openProject(projFilePath);
        const databaseVariable = "test3Db";
        const serverVariable = "otherServer";

        expect(
            project.databaseReferences.length,
            "There should be no database references to start with",
        ).to.equal(0);
        await project.addDatabaseReference({
            dacpacFileLocation: Uri.file("test3.dacpac"),
            databaseName: "test3DbName",
            databaseVariable: databaseVariable,
            serverName: "otherServerName",
            serverVariable: serverVariable,
            suppressMissingDependenciesErrors: false,
        });
        expect(
            project.databaseReferences.length,
            "There should be a database reference after adding a reference to test3",
        ).to.equal(1);
        expect(
            project.databaseReferences[0].referenceName,
            "The database reference should be test3",
        ).to.equal("test3");
        expect(
            project.sqlCmdVariables.size,
            "There should be 2 sqlcmdvars after adding the dacpac reference",
        ).to.equal(2);

        // make sure reference to test3.dacpac and SQLCMD variables were added
        let projFileText = (await fs.readFile(projFilePath)).toString();
        expect(projFileText).to.contain('<SqlCmdVariable Include="test3Db">');
        expect(projFileText).to.contain("<DefaultValue>test3DbName</DefaultValue>");
        expect(projFileText).to.contain('<SqlCmdVariable Include="otherServer">');
        expect(projFileText).to.contain("<DefaultValue>otherServerName</DefaultValue>");

        // delete reference
        await project.deleteDatabaseReferenceByEntry(project.databaseReferences[0]);
        expect(
            project.databaseReferences.length,
            "There should be no database references after deleting",
        ).to.equal(0);
        expect(
            project.sqlCmdVariables.size,
            "There should still be 2 sqlcmdvars after deleting the dacpac reference",
        ).to.equal(2);

        // add reference to the same dacpac again but with different values for the sqlcmd variables
        await project.addDatabaseReference({
            dacpacFileLocation: Uri.file("test3.dacpac"),
            databaseName: "newDbName",
            databaseVariable: databaseVariable,
            serverName: "newServerName",
            serverVariable: serverVariable,
            suppressMissingDependenciesErrors: false,
        });
        expect(
            project.databaseReferences.length,
            "There should be a database reference after adding a reference to test3",
        ).to.equal(1);
        expect(
            project.databaseReferences[0].referenceName,
            "The database reference should be test3",
        ).to.equal("test3");
        expect(
            project.sqlCmdVariables.size,
            "There should still be 2 sqlcmdvars after adding the dacpac reference again with different sqlcmdvar values",
        ).to.equal(2);
    });
});

suite("Project: add SQLCMD Variables", function (): void {
    suiteSetup(async function (): Promise<void> {
        await baselines.loadBaselines();
    });

    suiteTeardown(async function (): Promise<void> {
        await testUtils.deleteGeneratedTestFolder();
    });

    test("Should update .sqlproj with new sqlcmd variables", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.openProjectFileBaseline,
        );
        let project = await Project.openProject(projFilePath);
        expect(
            project.sqlCmdVariables.size,
            "The project should have 2 sqlcmd variables when opened",
        ).to.equal(2);

        // add a new variable
        await project.addSqlCmdVariable("TestDatabaseName", "TestDb");

        // update value of an existing sqlcmd variable
        await project.updateSqlCmdVariable("ProdDatabaseName", "NewProdName");

        expect(
            project.sqlCmdVariables.size,
            "There should be 3 sqlcmd variables after adding TestDatabaseName",
        ).to.equal(3);
        expect(
            project.sqlCmdVariables.get("TestDatabaseName"),
            "Value of TestDatabaseName should be TestDb",
        ).to.equal("TestDb");
        expect(
            project.sqlCmdVariables.get("ProdDatabaseName"),
            "ProdDatabaseName value should have been updated to the new value",
        ).to.equal("NewProdName");
    });
});

suite("Project: publish profiles", function (): void {
    suiteSetup(async function (): Promise<void> {
        await baselines.loadBaselines();
    });

    suiteTeardown(async function (): Promise<void> {
        await testUtils.deleteGeneratedTestFolder();
    });

    test("Should add new publish profile", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.openProjectFileBaseline,
        );
        const project = await Project.openProject(projFilePath);
        expect(project.publishProfiles.length).to.equal(3);

        // add a new publish profile
        const newProfilePath = path.join(
            project.projectFolderPath,
            "TestProjectName_4.publish.xml",
        );
        await fs.writeFile(newProfilePath, '<fake-publish-profile type="stage"/>');

        await project.addNoneItem("TestProjectName_4.publish.xml");

        expect(project.publishProfiles.length).to.equal(4);
    });
});

suite("Project: properties", function (): void {
    suiteSetup(async function (): Promise<void> {
        await baselines.loadBaselines();
    });

    suiteTeardown(async function (): Promise<void> {
        await testUtils.deleteGeneratedTestFolder();
    });

    test("Should read target database version", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.openProjectFileBaseline,
        );
        const project = await Project.openProject(projFilePath);

        expect(project.getProjectTargetVersion()).to.equal("150");
    });

    test("Should throw on missing target database version", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.sqlProjectMissingVersionBaseline,
        );

        await testUtils.shouldThrowSpecificError(
            async () => await Project.openProject(projFilePath),
            "Error: No target platform defined.  Missing <DSP> node.",
        );
    });

    test("Should throw on invalid target database version", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.sqlProjectInvalidVersionBaseline,
        );

        try {
            await Project.openProject(projFilePath);
            throw new Error("Should not have succeeded.");
        } catch (e) {
            expect(e.message).to.match(/^Error: Invalid value for Database Schema Provider:/);
            expect(e.message).to.match(
                /expected to be in the form 'Microsoft\.Data\.Tools\.Schema\.Sql\.Sql160DatabaseSchemaProvider'\.$/,
            );
        }
    });

    test("Should read default database collation", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.sqlProjectCustomCollationBaseline,
        );
        const project = await Project.openProject(projFilePath);

        expect(project.getDatabaseDefaultCollation()).to.equal("SQL_Latin1_General_CP1255_CS_AS");
    });

    test("Should return default value when database collation is not specified", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.newProjectFileBaseline,
        );
        const project = await Project.openProject(projFilePath);

        expect(project.getDatabaseDefaultCollation()).to.equal("SQL_Latin1_General_CP1_CI_AS");
    });

    // TODO: skipped until DacFx throws on invalid value
    test.skip("Should throw on invalid default database collation", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.sqlProjectInvalidCollationBaseline,
        );

        try {
            await Project.openProject(projFilePath);
            throw new Error("Should not have succeeded.");
        } catch (e) {
            expect(e.message).to.match(/^Error: Invalid value for DefaultCollation:/);
        }
    });

    test("Should add database source to project property", async function (): Promise<void> {
        const project = await testUtils.createTestSqlProject(this.test);

        // Should add a single database source
        await project.addDatabaseSource("test1");
        let databaseSourceItems: string[] = project.getDatabaseSourceValues();
        expect(
            databaseSourceItems.length,
            "number of database sources: " + databaseSourceItems,
        ).to.equal(1);
        expect(databaseSourceItems[0]).to.equal("test1");

        // Should add multiple database sources
        await project.addDatabaseSource("test2");
        await project.addDatabaseSource("test3");
        databaseSourceItems = project.getDatabaseSourceValues();
        expect(
            databaseSourceItems.length,
            "number of database sources: " + databaseSourceItems,
        ).to.equal(3);
        expect(databaseSourceItems[0]).to.equal("test1");
        expect(databaseSourceItems[1]).to.equal("test2");
        expect(databaseSourceItems[2]).to.equal("test3");

        // Should not add duplicate database sources
        await project.addDatabaseSource("test1");
        await project.addDatabaseSource("test2");
        await project.addDatabaseSource("test3");
        expect(databaseSourceItems.length).to.equal(3);
        expect(databaseSourceItems[0]).to.equal("test1");
        expect(databaseSourceItems[1]).to.equal("test2");
        expect(databaseSourceItems[2]).to.equal("test3");
    });

    test("Should remove database source from project property", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.sqlProjectInvalidCollationBaseline,
        );
        const project = await Project.openProject(projFilePath);

        await project.addDatabaseSource("test1");
        await project.addDatabaseSource("test2");
        await project.addDatabaseSource("test3");
        await project.addDatabaseSource("test4");

        let databaseSourceItems: string[] = project.getDatabaseSourceValues();
        expect(databaseSourceItems.length).to.equal(4);

        // Should remove database sources
        await project.removeDatabaseSource("test2");
        await project.removeDatabaseSource("test1");
        await project.removeDatabaseSource("test4");

        databaseSourceItems = project.getDatabaseSourceValues();
        expect(databaseSourceItems.length).to.equal(1);
        expect(databaseSourceItems[0]).to.equal("test3");

        // Should remove database source tag when last database source is removed
        await project.removeDatabaseSource("test3");
        databaseSourceItems = project.getDatabaseSourceValues();

        expect(databaseSourceItems.length).to.equal(0);
    });

    test("Should throw error when adding or removing database source that contains semicolon", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.sqlProjectInvalidCollationBaseline,
        );
        const project = await Project.openProject(projFilePath);
        const semicolon = ";";

        await testUtils.shouldThrowSpecificError(
            async () => await project.addDatabaseSource(semicolon),
            constants.invalidProjectPropertyValueProvided(semicolon),
        );

        await testUtils.shouldThrowSpecificError(
            async () => await project.removeDatabaseSource(semicolon),
            constants.invalidProjectPropertyValueProvided(semicolon),
        );
    });
});

suite("Project: round trip updates", function (): void {
    suiteSetup(async function (): Promise<void> {
        await baselines.loadBaselines();
    });

    setup(function (): void {
        sinon.restore();
    });

    suiteTeardown(async function (): Promise<void> {
        await testUtils.deleteGeneratedTestFolder();
    });

    test("Should update SSDT project to work in ADS", async function (): Promise<void> {
        await testUpdateInRoundTrip(this.test, baselines.SSDTProjectFileBaseline);
    });

    test.skip("Should update SSDT project with new system database references", async function (): Promise<void> {
        await testUpdateInRoundTrip(this.test, baselines.SSDTUpdatedProjectBaseline);
    });

    test("Should update SSDT project to work in ADS handling pre-existing targets", async function (): Promise<void> {
        await testUpdateInRoundTrip(this.test, baselines.SSDTProjectBaselineWithBeforeBuildTarget);
    });

    test("Should not update project and no backup file should be created when prompt to update project is rejected", async function (): Promise<void> {
        sinon.stub(window, "showWarningMessage").returns(<any>Promise.resolve(constants.noString));
        // setup test files
        const folderPath = await testUtils.generateTestFolderPath(this.test);
        const sqlProjPath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.SSDTProjectFileBaseline,
            folderPath,
        );

        const originalSqlProjContents = (await fs.readFile(sqlProjPath)).toString();

        // validate original state
        let project = await Project.openProject(sqlProjPath, false);
        expect(
            project.isCrossPlatformCompatible,
            "SSDT project should not be cross-platform compatible when not prompted to update",
        ).to.be.false;

        // validate rejection result
        project = await Project.openProject(sqlProjPath, true);
        expect(
            project.isCrossPlatformCompatible,
            "SSDT project should not be cross-platform compatible when update prompt is rejected",
        ).to.be.false;
        expect(await exists(sqlProjPath + "_backup"), "backup file should not be generated").to.be
            .false;

        const newSqlProjContents = (await fs.readFile(sqlProjPath)).toString();
        expect(
            newSqlProjContents,
            "SSDT .sqlproj contents should not have changed when update prompt is rejected",
        ).to.equal(originalSqlProjContents);

        sinon.restore();
    });

    test("Should not show warning message for non-SSDT projects that have the additional information for Build", async function (): Promise<void> {
        // setup test files
        const folderPath = await testUtils.generateTestFolderPath(this.test);
        const sqlProjPath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.openProjectFileBaseline,
            folderPath,
        );
        await testUtils.createTestDataSources(
            this.test,
            baselines.openDataSourcesBaseline,
            folderPath,
        );

        await Project.openProject(Uri.file(sqlProjPath).fsPath); // no error thrown
    });

    test("Should not show update project warning message when opening sdk style project using Sdk node", async function (): Promise<void> {
        await shouldNotShowUpdateWarning(this.test, baselines.newSdkStyleProjectSdkNodeBaseline);
    });

    test("Should not show update project warning message when opening sdk style project using Project node with Sdk attribute", async function (): Promise<void> {
        await shouldNotShowUpdateWarning(
            this.test,
            baselines.newSdkStyleProjectSdkProjectAttributeBaseline,
        );
    });

    test("Should not show update project warning message when opening sdk style project using Import node with Sdk attribute", async function (): Promise<void> {
        await shouldNotShowUpdateWarning(
            this.test,
            baselines.newStyleProjectSdkImportAttributeBaseline,
        );
    });

    async function shouldNotShowUpdateWarning(
        test: Mocha.Runnable | undefined,
        baselineFile: string,
    ): Promise<void> {
        // setup test files
        const folderPath = await testUtils.generateTestFolderPath(test);
        const sqlProjPath = await testUtils.createTestSqlProjFile(test, baselineFile, folderPath);
        const spy = sinon.spy(window, "showWarningMessage");

        const project = await Project.openProject(Uri.file(sqlProjPath).fsPath);
        expect(
            project.isCrossPlatformCompatible,
            "Project should be detected as cross-plat compatible",
        ).to.be.true;
        expect(
            spy.notCalled,
            "Prompt to update .sqlproj should not have been shown for cross-plat project.",
        ).to.be.true;
    }

    test("Should filter out glob patterns from None items", async function (): Promise<void> {
        const projFilePath = await testUtils.createTestSqlProjFile(
            this.test,
            baselines.openSdkStyleSqlProjectBaseline,
        );
        const project: Project = await Project.openProject(projFilePath);

        // Verify that glob patterns with *, ?, or [ are not included in noneDeployScripts
        // Even if the backend returns patterns like "queries/**", "script?.sql", "Script[123].sql", "data[a-z].txt", or "test[!_]*.sql", they should be filtered out
        const hasGlobPattern = project.noneDeployScripts.some(
            (f) =>
                f.relativePath.includes("*") ||
                f.relativePath.includes("?") ||
                f.relativePath.includes("["),
        );
        expect(hasGlobPattern, "None items should not contain glob patterns with *, ?, or [").to.be
            .false;
    });
});

async function testUpdateInRoundTrip(
    test: Mocha.Runnable | undefined,
    fileBeforeupdate: string,
): Promise<void> {
    const projFilePath = await testUtils.createTestSqlProjFile(test, fileBeforeupdate);
    const project = await Project.openProject(projFilePath); // project gets updated if needed in openProject()
    expect(
        project.isCrossPlatformCompatible,
        "Project should not be cross-plat compatible before conversion",
    ).to.be.false;

    expect(
        project.isCrossPlatformCompatible,
        "Project should not be cross-plat compatible before conversion",
    ).to.be.false;

    await project.updateProjectForCrossPlatform();

    expect(
        project.isCrossPlatformCompatible,
        "Project should be cross-plat compatible after conversion",
    ).to.be.true;
    expect(
        await exists(projFilePath + "_backup"),
        "Backup file should have been generated before the project was updated",
    ).to.be.true;

    sinon.restore();
}
