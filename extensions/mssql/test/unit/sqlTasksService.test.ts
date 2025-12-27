/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import { expect } from "chai";
import {
    SqlTasksService,
    TaskStatus,
    TaskInfo,
    TaskProgressInfo,
    TaskCompletionHandler,
} from "../../src/services/sqlTasksService";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import SqlDocumentService from "../../src/controllers/sqlDocumentService";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { TaskExecutionMode } from "../../src/sharedInterfaces/schemaCompare";
import * as telemetry from "../../src/telemetry/telemetry";

suite("SqlTasksService Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let sqlTasksService: SqlTasksService;
    let sqlToolsClientStub: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let sqlDocumentServiceStub: sinon.SinonStubbedInstance<SqlDocumentService>;
    let vscodeWrapperStub: sinon.SinonStubbedInstance<VscodeWrapper>;
    let showInformationMessageStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;
    let showWarningMessageStub: sinon.SinonStub;
    let executeCommandStub: sinon.SinonStub;
    let sendActionEventStub: sinon.SinonStub;
    let loggerErrorStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        sqlToolsClientStub = sandbox.createStubInstance(SqlToolsServiceClient);
        sqlDocumentServiceStub = sandbox.createStubInstance(SqlDocumentService);
        vscodeWrapperStub = sandbox.createStubInstance(VscodeWrapper);

        showInformationMessageStub = vscodeWrapperStub.showInformationMessage;
        showErrorMessageStub = vscodeWrapperStub.showErrorMessage;
        showWarningMessageStub = vscodeWrapperStub.showWarningMessage;
        executeCommandStub = vscodeWrapperStub.executeCommand;

        // Stub telemetry
        sendActionEventStub = sandbox.stub(telemetry, "sendActionEvent");

        // Stub logger - use defineProperty since logger is a getter
        loggerErrorStub = sandbox.stub();
        Object.defineProperty(sqlToolsClientStub, "logger", {
            get: () => ({ error: loggerErrorStub }),
        });

        sqlTasksService = new SqlTasksService(
            sqlToolsClientStub,
            sqlDocumentServiceStub,
            vscodeWrapperStub,
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("registerCompletionSuccessHandler", () => {
        test("should register a completion handler", () => {
            const handler: TaskCompletionHandler = {
                operationName: "TestOperation",
                getTargetLocation: (taskInfo) => taskInfo.targetLocation,
                getSuccessMessage: (_taskInfo, targetLocation) => `Success: ${targetLocation}`,
            };

            sqlTasksService.registerCompletionSuccessHandler(handler);

            // Verify handler is registered by triggering a task completion
            const taskInfo: TaskInfo = {
                taskId: "task-1",
                status: TaskStatus.InProgress,
                taskExecutionMode: TaskExecutionMode.execute,
                serverName: "test-server",
                databaseName: "test-db",
                name: "Test task",
                description: "Test description",
                providerName: "MSSQL",
                isCancelable: false,
                targetLocation: "/path/to/file.bacpac",
                operationName: "TestOperation",
            };

            // Simulate task created notification
            const onNotificationStub = sqlToolsClientStub.onNotification as sinon.SinonStub;
            const taskCreatedHandler = onNotificationStub.getCalls()[0].args[1];
            taskCreatedHandler(taskInfo);

            // Simulate task completed notification
            const taskStatusChangedHandler = onNotificationStub.getCalls()[1].args[1];
            const progressInfo: TaskProgressInfo = {
                taskId: "task-1",
                status: TaskStatus.Succeeded,
                message: "Task completed",
            };
            taskStatusChangedHandler(progressInfo);

            expect(showInformationMessageStub).to.have.been.calledOnce;
            expect(showInformationMessageStub).to.have.been.calledWith(
                "Success: /path/to/file.bacpac",
            );
        });

        test("should emit telemetry event when handler is overwritten", () => {
            const handler1: TaskCompletionHandler = {
                operationName: "TestOperation",
                getTargetLocation: (taskInfo) => taskInfo.targetLocation,
                getSuccessMessage: (_taskInfo, targetLocation) => `Success 1: ${targetLocation}`,
            };

            const handler2: TaskCompletionHandler = {
                operationName: "TestOperation", // Same operation name
                getTargetLocation: (taskInfo) => taskInfo.targetLocation,
                getSuccessMessage: (_taskInfo, targetLocation) => `Success 2: ${targetLocation}`,
            };

            sqlTasksService.registerCompletionSuccessHandler(handler1);

            // Reset to ensure we're only checking the second registration
            sendActionEventStub.resetHistory();
            loggerErrorStub.resetHistory();

            sqlTasksService.registerCompletionSuccessHandler(handler2);

            // Verify telemetry was sent
            expect(sendActionEventStub).to.have.been.calledOnce;
            expect(sendActionEventStub).to.have.been.calledWith(
                "General",
                "Initialize",
                sinon.match({
                    event: "CompletionHandlerOverwritten",
                    operationName: "TestOperation",
                }),
            );

            // Verify error was logged
            expect(loggerErrorStub).to.have.been.calledOnce;
            expect(loggerErrorStub.firstCall.args[0]).to.include("TestOperation");
        });

        test("should support multiple handlers for different operation IDs", async () => {
            const handler1: TaskCompletionHandler = {
                operationName: "ExportBacpac",
                getTargetLocation: (taskInfo) => taskInfo.targetLocation,
                getSuccessMessage: (_taskInfo, targetLocation) => `Exported: ${targetLocation}`,
            };

            const handler2: TaskCompletionHandler = {
                operationName: "DeployDacpac",
                getTargetLocation: (taskInfo) => taskInfo.databaseName,
                getSuccessMessage: (_taskInfo, databaseName) => `Deployed to: ${databaseName}`,
            };

            sqlTasksService.registerCompletionSuccessHandler(handler1);
            sqlTasksService.registerCompletionSuccessHandler(handler2);

            const onNotificationStub = sqlToolsClientStub.onNotification as sinon.SinonStub;
            const taskCreatedHandler = onNotificationStub.getCalls()[0].args[1];
            const taskStatusChangedHandler = onNotificationStub.getCalls()[1].args[1];

            // Test handler 1 - Export bacpac
            const exportTask: TaskInfo = {
                taskId: "task-1",
                status: TaskStatus.InProgress,
                taskExecutionMode: TaskExecutionMode.execute,
                serverName: "test-server",
                databaseName: "test-db",
                name: "Export bacpac",
                description: "Export operation",
                providerName: "MSSQL",
                isCancelable: false,
                targetLocation: "/path/to/export.bacpac",
                operationName: "ExportBacpac",
            };

            taskCreatedHandler(exportTask);

            const exportProgress: TaskProgressInfo = {
                taskId: "task-1",
                status: TaskStatus.Succeeded,
                message: "Export completed",
            };

            await taskStatusChangedHandler(exportProgress);

            expect(showInformationMessageStub).to.have.been.calledWith(
                "Exported: /path/to/export.bacpac",
            );

            // Reset stubs for second test
            showInformationMessageStub.resetHistory();

            // Test handler 2 - Deploy dacpac
            const deployTask: TaskInfo = {
                taskId: "task-2",
                status: TaskStatus.InProgress,
                taskExecutionMode: TaskExecutionMode.execute,
                serverName: "test-server",
                databaseName: "target-database",
                name: "Deploy dacpac",
                description: "Deploy operation",
                providerName: "MSSQL",
                isCancelable: false,
                targetLocation: "/path/to/deploy.dacpac",
                operationName: "DeployDacpac",
            };

            taskCreatedHandler(deployTask);

            const deployProgress: TaskProgressInfo = {
                taskId: "task-2",
                status: TaskStatus.Succeeded,
                message: "Deploy completed",
            };

            await taskStatusChangedHandler(deployProgress);

            expect(showInformationMessageStub).to.have.been.calledWith(
                "Deployed to: target-database",
            );
        });
    });

    suite("Task completion with action button", () => {
        test("should show notification with action button when handler provides it", async () => {
            const actionButtonText = "Reveal in Explorer";
            const targetFile = "/path/to/file.bacpac";

            const handler: TaskCompletionHandler = {
                operationName: "ExportBacpac",
                getTargetLocation: (taskInfo) => taskInfo.targetLocation,
                getSuccessMessage: (_taskInfo, targetLocation) => `Exported to ${targetLocation}`,
                actionButtonText: "Reveal in Explorer",
                actionCommand: "revealFileInOS",
                getActionCommandArgs: (_taskInfo, targetLocation) => [
                    vscode.Uri.file(targetLocation),
                ],
            };

            sqlTasksService.registerCompletionSuccessHandler(handler);

            const taskInfo: TaskInfo = {
                taskId: "task-1",
                status: TaskStatus.InProgress,
                taskExecutionMode: TaskExecutionMode.execute,
                serverName: "test-server",
                databaseName: "test-db",
                name: "Export bacpac",
                description: "Export operation",
                providerName: "MSSQL",
                isCancelable: false,
                targetLocation: targetFile,
                operationName: "ExportBacpac",
            };

            // Simulate task created and completed
            const onNotificationStub = sqlToolsClientStub.onNotification as sinon.SinonStub;
            const taskCreatedHandler = onNotificationStub.getCalls()[0].args[1];
            const taskStatusChangedHandler = onNotificationStub.getCalls()[1].args[1];

            taskCreatedHandler(taskInfo);

            showInformationMessageStub.resolves(actionButtonText);

            const progressInfo: TaskProgressInfo = {
                taskId: "task-1",
                status: TaskStatus.Succeeded,
                message: "Completed",
            };

            await taskStatusChangedHandler(progressInfo);

            expect(showInformationMessageStub).to.have.been.calledWith(
                `Exported to ${targetFile}`,
                actionButtonText,
            );
        });

        test("should execute command when action button is clicked", async () => {
            const actionButtonText = "Reveal in Explorer";
            const targetFile = "/path/to/file.bacpac";

            const handler: TaskCompletionHandler = {
                operationName: "ExportBacpac",
                getTargetLocation: (taskInfo) => taskInfo.targetLocation,
                getSuccessMessage: (_taskInfo, targetLocation) => `Exported to ${targetLocation}`,
                actionButtonText: actionButtonText,
                actionCommand: "revealFileInOS",
                getActionCommandArgs: (_taskInfo, targetLocation) => [
                    vscode.Uri.file(targetLocation),
                ],
            };

            sqlTasksService.registerCompletionSuccessHandler(handler);

            const taskInfo: TaskInfo = {
                taskId: "task-1",
                status: TaskStatus.InProgress,
                taskExecutionMode: TaskExecutionMode.execute,
                serverName: "test-server",
                databaseName: "test-db",
                name: "Export bacpac",
                description: "Export operation",
                providerName: "MSSQL",
                isCancelable: false,
                targetLocation: targetFile,
                operationName: "ExportBacpac",
            };

            const onNotificationStub = sqlToolsClientStub.onNotification as sinon.SinonStub;
            const taskCreatedHandler = onNotificationStub.getCalls()[0].args[1];
            const taskStatusChangedHandler = onNotificationStub.getCalls()[1].args[1];

            taskCreatedHandler(taskInfo);

            // Simulate user clicking the action button
            showInformationMessageStub.callsFake(async (_message, ...items) => {
                return items[0]; // Return the button that was clicked
            });

            const progressInfo: TaskProgressInfo = {
                taskId: "task-1",
                status: TaskStatus.Succeeded,
                message: "Completed",
            };

            await taskStatusChangedHandler(progressInfo);

            // Wait for promise chain to resolve
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(executeCommandStub).to.have.been.calledWith(
                "revealFileInOS",
                sinon.match.instanceOf(vscode.Uri),
            );
        });

        test("should not execute command when action button is not clicked", async () => {
            const actionButtonText = "Reveal in Explorer";
            const targetFile = "/path/to/file.bacpac";

            const handler: TaskCompletionHandler = {
                operationName: "ExportBacpac",
                getTargetLocation: (taskInfo) => taskInfo.targetLocation,
                getSuccessMessage: (_taskInfo, targetLocation) => `Exported to ${targetLocation}`,
                actionButtonText: actionButtonText,
                actionCommand: "revealFileInOS",
                getActionCommandArgs: (_taskInfo, targetLocation) => [
                    vscode.Uri.file(targetLocation),
                ],
            };

            sqlTasksService.registerCompletionSuccessHandler(handler);

            const taskInfo: TaskInfo = {
                taskId: "task-1",
                status: TaskStatus.InProgress,
                taskExecutionMode: TaskExecutionMode.execute,
                serverName: "test-server",
                databaseName: "test-db",
                name: "Export bacpac",
                description: "Export operation",
                providerName: "MSSQL",
                isCancelable: false,
                targetLocation: targetFile,
                operationName: "ExportBacpac",
            };

            const onNotificationStub = sqlToolsClientStub.onNotification as sinon.SinonStub;
            const taskCreatedHandler = onNotificationStub.getCalls()[0].args[1];
            const taskStatusChangedHandler = onNotificationStub.getCalls()[1].args[1];

            taskCreatedHandler(taskInfo);

            // Simulate user dismissing the notification without clicking the button
            showInformationMessageStub.resolves(undefined);

            const progressInfo: TaskProgressInfo = {
                taskId: "task-1",
                status: TaskStatus.Succeeded,
                message: "Completed",
            };

            await taskStatusChangedHandler(progressInfo);

            // Wait for promise chain to resolve
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Verify command was not executed
            expect(executeCommandStub).to.not.have.been.called;
        });

        test("should handle multiple arguments in action command", async () => {
            const actionButtonText = "Open";
            const targetFile = "/path/to/file.sql";

            const handler: TaskCompletionHandler = {
                operationName: "GenerateScript",
                getTargetLocation: (taskInfo) => taskInfo.targetLocation,
                getSuccessMessage: (_taskInfo, targetLocation) =>
                    `Script saved to ${targetLocation}`,
                actionButtonText: actionButtonText,
                actionCommand: "vscode.open",
                getActionCommandArgs: (_taskInfo, targetLocation) => [
                    vscode.Uri.file(targetLocation),
                ],
            };

            sqlTasksService.registerCompletionSuccessHandler(handler);

            const taskInfo: TaskInfo = {
                taskId: "task-1",
                status: TaskStatus.InProgress,
                taskExecutionMode: TaskExecutionMode.execute,
                serverName: "test-server",
                databaseName: "test-db",
                name: "Generate script",
                description: "Generate script operation",
                providerName: "MSSQL",
                isCancelable: false,
                targetLocation: targetFile,
                operationName: "GenerateScript",
            };

            const onNotificationStub = sqlToolsClientStub.onNotification as sinon.SinonStub;
            const taskCreatedHandler = onNotificationStub.getCalls()[0].args[1];
            const taskStatusChangedHandler = onNotificationStub.getCalls()[1].args[1];

            taskCreatedHandler(taskInfo);

            // Simulate user clicking the action button
            showInformationMessageStub.resolves(actionButtonText);

            const progressInfo: TaskProgressInfo = {
                taskId: "task-1",
                status: TaskStatus.Succeeded,
                message: "Completed",
            };

            await taskStatusChangedHandler(progressInfo);

            // Wait for promise chain to resolve
            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(executeCommandStub).to.have.been.calledWith(
                "vscode.open",
                sinon.match.instanceOf(vscode.Uri),
            );
        });
    });

    suite("Task completion without action button", () => {
        test("should show notification without action button when handler doesn't provide it", async () => {
            const handler: TaskCompletionHandler = {
                operationName: "DeployDacpac",
                getTargetLocation: (taskInfo) => taskInfo.databaseName,
                getSuccessMessage: (_taskInfo, databaseName) => `Deployed to ${databaseName}`,
                // No action button methods
            };

            sqlTasksService.registerCompletionSuccessHandler(handler);

            const taskInfo: TaskInfo = {
                taskId: "task-1",
                status: TaskStatus.InProgress,
                taskExecutionMode: TaskExecutionMode.execute,
                serverName: "test-server",
                databaseName: "my-database",
                name: "Deploy dacpac",
                description: "Deploy operation",
                providerName: "MSSQL",
                isCancelable: false,
                targetLocation: "",
                operationName: "DeployDacpac",
            };

            const onNotificationStub = sqlToolsClientStub.onNotification as sinon.SinonStub;
            const taskCreatedHandler = onNotificationStub.getCalls()[0].args[1];
            const taskStatusChangedHandler = onNotificationStub.getCalls()[1].args[1];

            taskCreatedHandler(taskInfo);

            const progressInfo: TaskProgressInfo = {
                taskId: "task-1",
                status: TaskStatus.Succeeded,
                message: "Completed",
            };

            await taskStatusChangedHandler(progressInfo);

            expect(showInformationMessageStub).to.have.been.calledWith("Deployed to my-database");
            expect(showInformationMessageStub).to.not.have.been.calledWith(
                sinon.match.string,
                sinon.match.string,
            );
        });
    });

    suite("Task completion without handler", () => {
        test("should show generic completion message when no handler is registered", async () => {
            const taskInfo: TaskInfo = {
                taskId: "task-1",
                status: TaskStatus.InProgress,
                taskExecutionMode: TaskExecutionMode.execute,
                serverName: "test-server",
                databaseName: "test-db",
                name: "Some other task",
                description: "Other task",
                providerName: "MSSQL",
                isCancelable: false,
                targetLocation: "",
            };

            const onNotificationStub = sqlToolsClientStub.onNotification as sinon.SinonStub;
            const taskCreatedHandler = onNotificationStub.getCalls()[0].args[1];
            const taskStatusChangedHandler = onNotificationStub.getCalls()[1].args[1];

            taskCreatedHandler(taskInfo);

            const progressInfo: TaskProgressInfo = {
                taskId: "task-1",
                status: TaskStatus.Succeeded,
                message: "Completed",
            };

            await taskStatusChangedHandler(progressInfo);

            expect(showInformationMessageStub).to.have.been.calledOnce;
            // Should show generic message with task name
            expect(showInformationMessageStub.firstCall.args[0]).to.include("Some other task");
        });

        test("should show error message for failed tasks", async () => {
            const taskInfo: TaskInfo = {
                taskId: "task-1",
                status: TaskStatus.InProgress,
                taskExecutionMode: TaskExecutionMode.execute,
                serverName: "test-server",
                databaseName: "test-db",
                name: "Failed task",
                description: "Task that fails",
                providerName: "MSSQL",
                isCancelable: false,
                targetLocation: "",
            };

            const onNotificationStub = sqlToolsClientStub.onNotification as sinon.SinonStub;
            const taskCreatedHandler = onNotificationStub.getCalls()[0].args[1];
            const taskStatusChangedHandler = onNotificationStub.getCalls()[1].args[1];

            taskCreatedHandler(taskInfo);

            const progressInfo: TaskProgressInfo = {
                taskId: "task-1",
                status: TaskStatus.Failed,
                message: "Task failed",
            };

            await taskStatusChangedHandler(progressInfo);

            expect(showErrorMessageStub).to.have.been.calledOnce;
            expect(showErrorMessageStub.firstCall.args[0]).to.include("Failed task");
        });

        test("should show warning message for canceled tasks", async () => {
            const taskInfo: TaskInfo = {
                taskId: "task-1",
                status: TaskStatus.InProgress,
                taskExecutionMode: TaskExecutionMode.execute,
                serverName: "test-server",
                databaseName: "test-db",
                name: "Canceled task",
                description: "Task that is canceled",
                providerName: "MSSQL",
                isCancelable: true,
                targetLocation: "",
            };

            const onNotificationStub = sqlToolsClientStub.onNotification as sinon.SinonStub;
            const taskCreatedHandler = onNotificationStub.getCalls()[0].args[1];
            const taskStatusChangedHandler = onNotificationStub.getCalls()[1].args[1];

            taskCreatedHandler(taskInfo);

            const progressInfo: TaskProgressInfo = {
                taskId: "task-1",
                status: TaskStatus.Canceled,
                message: "Task canceled",
            };

            await taskStatusChangedHandler(progressInfo);

            expect(showWarningMessageStub).to.have.been.calledOnce;
        });
    });

    suite("Task with undefined target location", () => {
        test("should show generic message when handler returns undefined target location", async () => {
            const handler: TaskCompletionHandler = {
                operationName: "ExportBacpac",
                getTargetLocation: (_taskInfo) => undefined,
                getSuccessMessage: (_taskInfo, targetLocation) => `Exported to ${targetLocation}`,
            };

            sqlTasksService.registerCompletionSuccessHandler(handler);

            const taskInfo: TaskInfo = {
                taskId: "task-1",
                status: TaskStatus.InProgress,
                taskExecutionMode: TaskExecutionMode.execute,
                serverName: "test-server",
                databaseName: "test-db",
                name: "Export bacpac",
                description: "Export operation",
                providerName: "MSSQL",
                isCancelable: false,
                targetLocation: "",
                operationName: "ExportBacpac",
            };

            const onNotificationStub = sqlToolsClientStub.onNotification as sinon.SinonStub;
            const taskCreatedHandler = onNotificationStub.getCalls()[0].args[1];
            const taskStatusChangedHandler = onNotificationStub.getCalls()[1].args[1];

            taskCreatedHandler(taskInfo);

            const progressInfo: TaskProgressInfo = {
                taskId: "task-1",
                status: TaskStatus.Succeeded,
                message: "Completed",
            };

            await taskStatusChangedHandler(progressInfo);

            // Should fall back to generic message
            expect(showInformationMessageStub).to.have.been.calledOnce;
            expect(showInformationMessageStub.firstCall.args[0]).to.include("Export bacpac");
        });
    });

    suite("Task completion with handler for non-successful status", () => {
        test("should use generic message for failed tasks even with registered handler", async () => {
            const handler: TaskCompletionHandler = {
                operationName: "ExportBacpac",
                getTargetLocation: (taskInfo) => taskInfo.targetLocation,
                getSuccessMessage: (_taskInfo, targetLocation) => `Exported to ${targetLocation}`,
                actionButtonText: "Reveal in Explorer",
                actionCommand: "revealFileInOS",
                getActionCommandArgs: (_taskInfo, targetLocation) => [
                    vscode.Uri.file(targetLocation),
                ],
            };

            sqlTasksService.registerCompletionSuccessHandler(handler);

            const taskInfo: TaskInfo = {
                taskId: "task-1",
                status: TaskStatus.InProgress,
                taskExecutionMode: TaskExecutionMode.execute,
                serverName: "test-server",
                databaseName: "test-db",
                name: "Export bacpac",
                description: "Export operation",
                providerName: "MSSQL",
                isCancelable: false,
                targetLocation: "/path/to/file.bacpac",
                operationName: "ExportBacpac",
            };

            const onNotificationStub = sqlToolsClientStub.onNotification as sinon.SinonStub;
            const taskCreatedHandler = onNotificationStub.getCalls()[0].args[1];
            const taskStatusChangedHandler = onNotificationStub.getCalls()[1].args[1];

            taskCreatedHandler(taskInfo);

            const progressInfo: TaskProgressInfo = {
                taskId: "task-1",
                status: TaskStatus.Failed,
                message: "Export failed: disk full",
            };

            await taskStatusChangedHandler(progressInfo);

            // Should use error message, not custom handler
            expect(showErrorMessageStub).to.have.been.calledOnce;
            expect(showErrorMessageStub.firstCall.args[0]).to.include("Export bacpac");
            expect(showErrorMessageStub.firstCall.args[0]).to.include("disk full");

            // Custom handler should not be invoked
            expect(showInformationMessageStub).to.not.have.been.called;
        });

        test("should use generic message for SucceededWithWarning even with registered handler", async () => {
            const handler: TaskCompletionHandler = {
                operationName: "DeployDacpac",
                getTargetLocation: (taskInfo) => taskInfo.databaseName,
                getSuccessMessage: (_taskInfo, databaseName) => `Deployed to ${databaseName}`,
            };

            sqlTasksService.registerCompletionSuccessHandler(handler);

            const taskInfo: TaskInfo = {
                taskId: "task-1",
                status: TaskStatus.InProgress,
                taskExecutionMode: TaskExecutionMode.execute,
                serverName: "test-server",
                databaseName: "my-database",
                name: "Deploy dacpac",
                description: "Deploy operation",
                providerName: "MSSQL",
                isCancelable: false,
                targetLocation: "",
                operationName: "DeployDacpac",
            };

            const onNotificationStub = sqlToolsClientStub.onNotification as sinon.SinonStub;
            const taskCreatedHandler = onNotificationStub.getCalls()[0].args[1];
            const taskStatusChangedHandler = onNotificationStub.getCalls()[1].args[1];

            taskCreatedHandler(taskInfo);

            const progressInfo: TaskProgressInfo = {
                taskId: "task-1",
                status: TaskStatus.SucceededWithWarning,
                message: "Deployed with warnings",
            };

            await taskStatusChangedHandler(progressInfo);

            // Should use warning message, not custom handler
            expect(showWarningMessageStub).to.have.been.calledOnce;
            expect(showWarningMessageStub.firstCall.args[0]).to.include("Deploy dacpac");

            // Custom handler should not be invoked
            expect(showInformationMessageStub).to.not.have.been.called;
        });
    });
});
