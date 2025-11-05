/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as mssql from "vscode-mssql";
import { expect } from "chai";
import * as sinon from "sinon";

import { ProjectController } from "../../src/controllers/projectController";
import * as constants from "../../src/constants/constants";

suite("ProjectController Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let projectController: ProjectController;

    // Common test constants
    const projectFilePath = "c:/work/TestProject.sqlproj";
    const projectName = "TestProject";
    const dacpacOutputPath = "c:/work/bin/Debug/TestProject.dacpac";

    setup(() => {
        sandbox = sinon.createSandbox();
        projectController = new ProjectController();
    });

    teardown(() => {
        sandbox.restore();
    });

    /**
     * Helper function to create project properties for testing
     */
    function createProjectProperties(
        projectFilePath: string,
        dacpacOutputPath: string,
        projectStyle: mssql.ProjectType,
    ): mssql.GetProjectPropertiesResult & {
        projectFilePath: string;
        dacpacOutputPath: string;
    } {
        return {
            success: true,
            errorMessage: "",
            projectGuid: "test-guid-1234",
            configuration: "Debug",
            platform: "AnyCPU",
            projectFilePath: projectFilePath,
            dacpacOutputPath: dacpacOutputPath,
            databaseSchemaProvider: "Microsoft.Data.Tools.Schema.Sql.Sql150DatabaseSchemaProvider",
            outputPath: "bin/Debug",
            defaultCollation: "SQL_Latin1_General_CP1_CI_AS",
            projectStyle: projectStyle,
            databaseSource: "Project",
        };
    }

    /**
     * Helper function to setup common mocks for build tests
     */
    function setupBuildMocks(sandbox: sinon.SinonSandbox): {
        mockExecution: vscode.TaskExecution;
        executeTaskStub: sinon.SinonStub;
        withProgressStub: sinon.SinonStub;
        triggerTaskCompletion: (exitCode: number) => void;
    } {
        // Mock vscode.extensions.getExtension
        const mockExtension = {
            extensionPath: "c:/extensions/mssql",
        } as vscode.Extension<mssql.IExtension>;
        sandbox.stub(vscode.extensions, "getExtension").returns(mockExtension);

        // Mock vscode.tasks.executeTask
        const mockExecution = {} as vscode.TaskExecution;
        const executeTaskStub = sandbox.stub(vscode.tasks, "executeTask").resolves(mockExecution);

        // Mock task completion event
        let taskEndCallback: (e: vscode.TaskProcessEndEvent) => void;
        sandbox.stub(vscode.tasks, "onDidEndTaskProcess").callsFake((callback) => {
            taskEndCallback = callback;
            return {
                dispose: sandbox.stub(),
            } as vscode.Disposable;
        });

        // Mock progress notification
        const withProgressStub = sandbox
            .stub(vscode.window, "withProgress")
            .callsFake(async (_options, task) => {
                const result = task(
                    {} as vscode.Progress<{ message?: string; increment?: number }>,
                    {} as vscode.CancellationToken,
                );
                return result;
            });

        // Helper function to trigger task completion
        const triggerTaskCompletion = (exitCode: number) => {
            setTimeout(() => {
                if (taskEndCallback) {
                    taskEndCallback({
                        execution: mockExecution,
                        exitCode: exitCode,
                    } as vscode.TaskProcessEndEvent);
                }
            }, 0);
        };

        return { mockExecution, executeTaskStub, withProgressStub, triggerTaskCompletion };
    }

    test("buildProject should build SDK-style project without NETCoreTargetsPath", async () => {
        // Arrange
        const projectProperties = createProjectProperties(
            projectFilePath,
            dacpacOutputPath,
            mssql.ProjectType.SdkStyle,
        );

        const { executeTaskStub, withProgressStub, triggerTaskCompletion } =
            setupBuildMocks(sandbox);

        // Act
        const buildPromise = projectController.buildProject(projectProperties);
        triggerTaskCompletion(0); // Simulate successful task completion
        const result = await buildPromise;

        // Assert
        expect(result).to.equal(dacpacOutputPath);
        expect(executeTaskStub.calledOnce, "executeTask should be called once").to.be.true;
        expect(withProgressStub.calledOnce, "withProgress should be called once").to.be.true;

        // Verify task was created with correct parameters
        const taskArg = executeTaskStub.firstCall.args[0] as vscode.Task;
        expect(taskArg.name).to.equal(`Build ${projectName}`);
        expect(taskArg.definition.type).to.equal(constants.sqlProjBuildTaskType);

        // Verify build arguments for SDK-style project (should NOT include NETCoreTargetsPath)
        const shellExec = taskArg.execution as vscode.ShellExecution;
        const args = shellExec.args as string[];
        expect(args[0]).to.equal(constants.build);
        expect(args[1]).to.equal(projectFilePath);
        expect(args).to.include("/p:NetCoreBuild=true");
        expect(args.some((arg) => arg.includes("SystemDacpacsLocation"))).to.be.true;
        expect(
            args.some((arg) => arg.includes("NETCoreTargetsPath")),
            "SDK-style should NOT include NETCoreTargetsPath",
        ).to.be.false;
    });

    test("buildProject should build Legacy-style project with NETCoreTargetsPath", async () => {
        // Arrange
        const projectProperties = createProjectProperties(
            projectFilePath,
            dacpacOutputPath,
            mssql.ProjectType.LegacyStyle,
        );

        const { executeTaskStub, triggerTaskCompletion } = setupBuildMocks(sandbox);

        // Act
        const buildPromise = projectController.buildProject(projectProperties);
        triggerTaskCompletion(0); // Simulate successful task completion
        await buildPromise;

        // Assert - Only verify the difference: Legacy-style SHOULD include NETCoreTargetsPath
        const taskArg = executeTaskStub.firstCall.args[0] as vscode.Task;
        const shellExec = taskArg.execution as vscode.ShellExecution;
        const args = shellExec.args as string[];
        expect(
            args.some((arg) => arg.includes("NETCoreTargetsPath")),
            "Legacy-style SHOULD include NETCoreTargetsPath",
        ).to.be.true;
    });
});
