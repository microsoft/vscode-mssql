/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import { expect } from "chai";
import * as path from "path";
import * as vscodeMssql from "vscode-mssql";
import { SqlDatabaseProjectTaskProvider } from "../../src/tasks/sqlDatabaseProjectTaskProvider";

suite("Sql Database Projects Task Provider", function (): void {
    let sandbox: sinon.SinonSandbox;
    let taskProvider: SqlDatabaseProjectTaskProvider;

    // Define a mock workspace folder for testing
    const workspaceFolder: vscode.WorkspaceFolder = {
        uri: vscode.Uri.file("/SqlProjFolder"),
        name: "SqlProjFolder",
        index: 0,
    };

    // Define mock .sqlproj file URIs for testing
    const sqlProjUris = [
        vscode.Uri.file("/SqlProjFolder/ProjectA/ProjectA.sqlproj"),
        vscode.Uri.file("/SqlProjFolder/ProjectB/ProjectB.sqlproj"),
        vscode.Uri.file("/SqlProjFolder/Project C/ProjectC.sqlproj"),
    ];

    // Helper to stub VS Code workspace APIs for consistent test environment
    function stubWorkspaceAndFiles(sqlProjUri: vscode.Uri[]) {
        sandbox.stub(vscode.workspace, "workspaceFolders").value([workspaceFolder]);
        sandbox.stub(vscode.workspace, "findFiles").resolves(sqlProjUri);
    }

    // Helper to create and stub a mock project
    function stubProjectOpenWithStyle(projectStyle: vscodeMssql.ProjectType) {
        const mockProject = {
            sqlProjStyle: projectStyle,
            readProjFile: sandbox.stub().resolves(),
        };

        const projectModule = require("../../src/models/project");
        sandbox.stub(projectModule.Project, "openProject").resolves(mockProject);

        return mockProject;
    }

    setup(() => {
        // Create a new Sinon sandbox before each test
        sandbox = sinon.createSandbox();
        // Instantiate the task provider
        taskProvider = new SqlDatabaseProjectTaskProvider();
    });

    teardown(() => {
        // Restore the Sinon sandbox and any stubs after each test
        sandbox.restore();
    });

    test("Should create build and buildWithCodeAnalysis tasks for .sqlproj file with correct properties for SDK style project", async function (): Promise<void> {
        // Define mock .sqlproj file URIs for testing
        stubWorkspaceAndFiles([sqlProjUris[0]]);

        // Stub the project as SDK style
        stubProjectOpenWithStyle(vscodeMssql.ProjectType.SdkStyle);

        // Act: create tasks using the provider
        const tasks = await taskProvider.createTasks();

        // Assert: tasks should be defined and have the expected length
        expect(tasks).to.not.be.undefined;
        expect(tasks).to.be.an("array").with.length(2);

        // Find the build and buildWithCodeAnalysis tasks by name
        const buildTask = tasks.find((t) => t.name === "ProjectA.sqlproj - Build");
        const buildWithCodeAnalysisTask = tasks.find(
            (t) => t.name === "ProjectA.sqlproj - Build with Code Analysis",
        );

        // Assert: both tasks should exist
        expect(buildTask).to.not.be.undefined;
        expect(buildWithCodeAnalysisTask).to.not.be.undefined;

        // Assert: task names should contain expected substrings
        expect(buildTask?.name).to.contain("Build");
        expect(buildWithCodeAnalysisTask?.name).to.contain("Build with Code Analysis");

        // Assert: task definitions should have the correct type
        expect(buildTask?.definition.type).to.equal("sqlproj-build");
        expect(buildWithCodeAnalysisTask?.definition.type).to.equal("sqlproj-build");

        // Assert: tasks should have the correct workspace folder scope
        expect(buildTask?.scope).to.equal(workspaceFolder);
        expect(buildWithCodeAnalysisTask?.scope).to.equal(workspaceFolder);

        // Assert: problemMatchers should be arrays and contain the expected matcher
        expect(buildTask?.problemMatchers).to.be.an("array");
        expect(buildWithCodeAnalysisTask?.problemMatchers).to.be.an("array");
        expect(buildTask?.problemMatchers).to.contain("$sqlproj-problem-matcher");
        expect(buildWithCodeAnalysisTask?.problemMatchers).to.contain("$sqlproj-problem-matcher");

        // Assert: build task should have a group with label 'Build'
        expect(buildTask?.group).to.not.be.undefined;
        expect(buildTask?.group).to.have.property("label", "Build");

        // Assert: build task execution should be defined and use 'dotnet' command with 'build' argument
        expect(buildTask?.execution).to.not.be.undefined;
        if (buildTask?.execution instanceof vscode.ProcessExecution) {
            expect(buildTask.execution.process).to.equal("dotnet");
            expect(buildTask.execution.args).to.not.be.undefined;
            expect(buildTask.execution.args).to.be.an("array");
            // First arg is 'build' string
            const firstArg = buildTask.execution.args[0];
            expect(firstArg).to.equal("build");

            const argsString = buildTask.execution.args.join(" ");
            expect(argsString).to.contain("/p:NetCoreBuild=true");
            expect(argsString).to.contain("/p:SystemDacpacsLocation=");
            expect(argsString).to.not.contain("/p:NETCoreTargetsPath="); // This should NOT be present for SDK projects
        }
    });

    test("Should not create any tasks when no .sqlproj files are present in the workspace", async function (): Promise<void> {
        // Define mock .sqlproj file URIs for testing
        stubWorkspaceAndFiles([]);

        // Stub the project as SDK style
        stubProjectOpenWithStyle(vscodeMssql.ProjectType.SdkStyle);

        // Act: Attempt to create tasks using the provider
        const tasks = await taskProvider.createTasks();

        // Assert: tasks should be defined but empty
        expect(tasks).to.not.be.undefined;
        expect(tasks).to.be.an("array").with.length(0);
    });

    test("Should create build and buildWithCodeAnalysis tasks for multiple .sqlproj files with correct properties", async function (): Promise<void> {
        // Define mock .sqlproj file URIs for testing
        stubWorkspaceAndFiles(sqlProjUris);

        // Stub the project as SDK style
        stubProjectOpenWithStyle(vscodeMssql.ProjectType.SdkStyle);

        // Act: create tasks using the provider
        const tasks = await taskProvider.createTasks();

        // Assert: tasks should be defined and have the expected length (2 per project)
        expect(tasks).to.not.be.undefined;
        expect(tasks)
            .to.be.an("array")
            .with.length(sqlProjUris.length * 2);

        for (const uri of sqlProjUris) {
            const projectName = path.basename(uri.fsPath);
            const buildTask = tasks.find((t) => t.name === `${projectName} - Build`);
            const buildWithCodeAnalysisTask = tasks.find(
                (t) => t.name === `${projectName} - Build with Code Analysis`,
            );

            // Assert: both tasks should exist
            expect(buildTask).to.not.be.undefined;
            expect(buildWithCodeAnalysisTask).to.not.be.undefined;

            // Assert: task names should contain expected substrings
            expect(buildTask?.name).to.contain("Build");
            expect(buildWithCodeAnalysisTask?.name).to.contain("Build with Code Analysis");

            // Assert: task definitions should have the correct type
            expect(buildTask?.definition.type).to.equal("sqlproj-build");
            expect(buildWithCodeAnalysisTask?.definition.type).to.equal("sqlproj-build");

            // Assert: tasks should have the correct workspace folder scope
            expect(buildTask?.scope).to.equal(workspaceFolder);
            expect(buildWithCodeAnalysisTask?.scope).to.equal(workspaceFolder);

            // Assert: problemMatchers should be arrays and contain the expected matcher
            expect(buildTask?.problemMatchers).to.be.an("array");
            expect(buildWithCodeAnalysisTask?.problemMatchers).to.be.an("array");
            expect(buildTask?.problemMatchers).to.contain("$sqlproj-problem-matcher");
            expect(buildWithCodeAnalysisTask?.problemMatchers).to.contain(
                "$sqlproj-problem-matcher",
            );

            // Assert: build task should have a group with label 'Build'
            expect(buildTask?.group).to.not.be.undefined;
            expect(buildTask?.group).to.have.property("label", "Build");

            // Assert: build task execution should be defined and use 'dotnet' command with 'build' argument
            expect(buildTask?.execution).to.not.be.undefined;
            if (buildTask?.execution instanceof vscode.ProcessExecution) {
                expect(buildTask.execution.process).to.equal("dotnet");
                expect(buildTask.execution.args).to.not.be.undefined;
                expect(buildTask.execution.args).to.be.an("array");
                // First arg is 'build' string
                const firstArg = buildTask.execution.args[0];
                expect(firstArg).to.equal("build");
            }
        }
    });

    test("Should create tasks with correct build arguments for legacy-style project", async function (): Promise<void> {
        // Define mock .sqlproj file URIs for testing
        stubWorkspaceAndFiles([sqlProjUris[0]]);

        // Stub the project as SDK style
        stubProjectOpenWithStyle(vscodeMssql.ProjectType.LegacyStyle);

        // Act: create tasks using the provider
        const tasks = await taskProvider.createTasks();

        // Assert: tasks should be defined and have the expected length
        expect(tasks).to.not.be.undefined;
        expect(tasks).to.be.an("array").with.length(2);

        // Find the build task
        const buildTask = tasks.find((t) => t.name === "ProjectA.sqlproj - Build");

        // Assert: build task should exist
        expect(buildTask).to.not.be.undefined;

        // Assert: build task execution should contain legacy-style arguments
        expect(buildTask?.execution).to.not.be.undefined;
        if (buildTask?.execution instanceof vscode.ProcessExecution) {
            expect(buildTask.execution.process).to.equal("dotnet");
            expect(buildTask.execution.args).to.not.be.undefined;
            expect(buildTask.execution.args).to.be.an("array");

            // Verify it contains build command
            const firstArg = buildTask.execution.args[0];
            expect(firstArg).to.equal("build");

            // Verify it contains legacy-style build arguments
            const argsString = buildTask.execution.args.join(" ");
            expect(argsString).to.contain("/p:NetCoreBuild=true");
            expect(argsString).to.contain("/p:SystemDacpacsLocation=");
            expect(argsString).to.contain("/p:NETCoreTargetsPath="); // This is only for legacy projects
        }
    });
});
