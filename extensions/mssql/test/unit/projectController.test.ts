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
import * as os from "os";

import { ProjectController } from "../../src/controllers/projectController";
import * as constants from "../../src/constants/constants";

chai.use(sinonChai);

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
        expect(executeTaskStub).to.have.been.calledOnce;
        expect(withProgressStub).to.have.been.calledOnce;

        // Verify task was created with correct parameters
        const taskArg = executeTaskStub.firstCall.args[0] as vscode.Task;
        expect(taskArg.name).to.equal(`Build ${projectName}`);
        expect(taskArg.definition.type).to.equal(constants.sqlProjBuildTaskType);

        // Verify build arguments for SDK-style project (should NOT include NETCoreTargetsPath)
        const processExec = taskArg.execution as vscode.ProcessExecution;
        const args = processExec.args as string[];
        const argsString = args.join(" ");

        expect(processExec.process).to.equal(constants.dotnet);
        expect(args[0]).to.equal(constants.build);
        expect(args[1]).to.equal(projectFilePath);
        expect(args).to.include("/p:NetCoreBuild=true");
        expect(argsString).to.include("SystemDacpacsLocation");
        expect(argsString).to.not.include("NETCoreTargetsPath");
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
        const processExec = taskArg.execution as vscode.ProcessExecution;
        const args = processExec.args as string[];
        const argsString = args.join(" ");

        expect(argsString).to.include("NETCoreTargetsPath");
    });

    test("buildProject should handle Windows-style paths correctly", async () => {
        // Arrange
        const platformStub = sandbox.stub(os, "platform").returns("win32");
        const winProjectPath = "c:\\work\\TestProject.sqlproj";
        const winDacpacPath = "c:\\work\\bin\\Debug\\TestProject.dacpac";
        const projectProperties = createProjectProperties(
            winProjectPath,
            winDacpacPath,
            mssql.ProjectType.SdkStyle,
        );

        const { executeTaskStub, triggerTaskCompletion } = setupBuildMocks(sandbox);

        // Act
        const buildPromise = projectController.buildProject(projectProperties);
        triggerTaskCompletion(0);
        const result = await buildPromise;

        // Assert
        expect(result).to.equal(winDacpacPath);
        expect(executeTaskStub).to.have.been.calledOnce;

        const taskArg = executeTaskStub.firstCall.args[0] as vscode.Task;
        const processExec = taskArg.execution as vscode.ProcessExecution;
        const args = processExec.args as string[];
        const argsString = args.join(" ");

        // Verify path is included in build arguments
        expect(args[1]).to.equal(winProjectPath);

        // Verify build directory path is included
        expect(argsString).to.include("SystemDacpacsLocation");
        expect(argsString).to.include("BuildDirectory");

        platformStub.restore();
    });

    test("buildProject should handle Linux/Mac-style paths correctly", async () => {
        // Arrange
        const platformStub = sandbox.stub(os, "platform").returns("linux");
        const unixProjectPath = "/home/user/work/TestProject.sqlproj";
        const unixDacpacPath = "/home/user/work/bin/Debug/TestProject.dacpac";
        const projectProperties = createProjectProperties(
            unixProjectPath,
            unixDacpacPath,
            mssql.ProjectType.SdkStyle,
        );

        const mockExtension = {
            extensionPath: "/home/user/.vscode/extensions/mssql",
        } as vscode.Extension<mssql.IExtension>;
        sandbox.stub(vscode.extensions, "getExtension").returns(mockExtension);

        const mockExecution = {} as vscode.TaskExecution;
        const executeTaskStub = sandbox.stub(vscode.tasks, "executeTask").resolves(mockExecution);

        let taskEndCallback: (e: vscode.TaskProcessEndEvent) => void;
        sandbox.stub(vscode.tasks, "onDidEndTaskProcess").callsFake((callback) => {
            taskEndCallback = callback;
            return { dispose: sandbox.stub() } as vscode.Disposable;
        });

        sandbox.stub(vscode.window, "withProgress").callsFake(async (_options, task) => {
            return task(
                {} as vscode.Progress<{ message?: string; increment?: number }>,
                {} as vscode.CancellationToken,
            );
        });

        // Act
        const buildPromise = projectController.buildProject(projectProperties);
        setTimeout(() => {
            taskEndCallback({
                execution: mockExecution,
                exitCode: 0,
            } as vscode.TaskProcessEndEvent);
        }, 0);
        const result = await buildPromise;

        // Assert
        expect(result).to.equal(unixDacpacPath);
        expect(executeTaskStub).to.have.been.calledOnce;

        const taskArg = executeTaskStub.firstCall.args[0] as vscode.Task;
        const processExec = taskArg.execution as vscode.ProcessExecution;
        const args = processExec.args as string[];
        const argsString = args.join(" ");

        // Verify path is included in build arguments
        expect(args[1]).to.equal(unixProjectPath);
        expect(argsString).to.include("SystemDacpacsLocation");
        expect(argsString).to.include("BuildDirectory");

        platformStub.restore();
    });
});
