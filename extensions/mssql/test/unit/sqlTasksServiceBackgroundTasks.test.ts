/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";
import { expect } from "chai";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import SqlDocumentService from "../../src/controllers/sqlDocumentService";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import {
    SqlTasksService,
    TaskCompletionHandler,
    TaskInfo,
    TaskStatus,
    TaskProgressInfo,
} from "../../src/services/sqlTasksService";
import { TaskExecutionMode } from "../../src/enums";
import {
    BackgroundTaskHandle,
    BackgroundTasksService,
    BackgroundTaskState,
} from "../../src/backgroundTasks/backgroundTasksService";
import { stubVscodeWrapper, stubWithProgress } from "./utils";

chai.use(sinonChai);

suite("SqlTasksService Background Tasks Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let sqlToolsClientStub: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let sqlDocumentServiceStub: sinon.SinonStubbedInstance<SqlDocumentService>;
    let vscodeWrapperStub: sinon.SinonStubbedInstance<VscodeWrapper>;
    let backgroundTasksServiceStub: sinon.SinonStubbedInstance<BackgroundTasksService>;
    let backgroundTaskHandle: sinon.SinonStubbedInstance<BackgroundTaskHandle>;
    let sqlTasksService: SqlTasksService;
    let taskCreatedHandler: (taskInfo: TaskInfo) => void;
    let taskStatusChangedHandler: (progressInfo: TaskProgressInfo) => Promise<void>;

    const baseTaskInfo: TaskInfo = {
        taskId: "task-1",
        status: TaskStatus.InProgress,
        taskExecutionMode: TaskExecutionMode.execute,
        serverName: "test-server",
        databaseName: "test-db",
        name: "Export bacpac",
        description: "Export operation",
        providerName: "MSSQL",
        isCancelable: true,
        targetLocation: "/tmp/export.bacpac",
        operationName: "ExportBacpac",
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        sqlToolsClientStub = sandbox.createStubInstance(SqlToolsServiceClient);
        sqlDocumentServiceStub = sandbox.createStubInstance(SqlDocumentService);
        vscodeWrapperStub = stubVscodeWrapper(sandbox);
        backgroundTasksServiceStub = sandbox.createStubInstance(BackgroundTasksService);
        backgroundTaskHandle = {
            id: "background-task-1",
            update: sandbox.stub(),
            complete: sandbox.stub(),
            remove: sandbox.stub(),
        } as unknown as sinon.SinonStubbedInstance<BackgroundTaskHandle>;

        backgroundTasksServiceStub.registerTask.returns(
            backgroundTaskHandle as unknown as BackgroundTaskHandle,
        );
        sqlToolsClientStub.onNotification.returnsThis();
        sqlToolsClientStub.sendRequest.resolves(true);

        stubWithProgress(sandbox, async (_options, task) => {
            const progress = {
                report: sandbox.stub(),
            } as unknown as vscode.Progress<{ message?: string; increment?: number }>;
            const token = {
                isCancellationRequested: false,
                onCancellationRequested: () => ({ dispose: sandbox.stub() }),
            } as unknown as vscode.CancellationToken;
            return task(progress, token);
        });

        sqlTasksService = new SqlTasksService(
            sqlToolsClientStub,
            sqlDocumentServiceStub,
            vscodeWrapperStub,
            backgroundTasksServiceStub,
        );

        const onNotificationStub = sqlToolsClientStub.onNotification as sinon.SinonStub;
        taskCreatedHandler = onNotificationStub.getCalls()[0].args[1];
        taskStatusChangedHandler = onNotificationStub.getCalls()[1].args[1];
    });

    teardown(() => {
        sandbox.restore();
    });

    test("registers a background task when a SQL task is created", () => {
        taskCreatedHandler(baseTaskInfo);

        expect(backgroundTasksServiceStub.registerTask).to.have.been.calledOnce;
        expect(backgroundTasksServiceStub.registerTask.firstCall.args[0]).to.deep.include({
            displayText: "Export bacpac",
            canCancel: true,
            source: "MSSQL",
            message: "Export operation",
            state: BackgroundTaskState.InProgress,
        });
    });

    test("uses connection info in the secondary text for SQL tasks and keeps it in the tooltip", () => {
        taskCreatedHandler({
            ...baseTaskInfo,
            name: "Backup Database",
            serverName: "localhost",
            databaseName: "AdventureWorks2022",
        });

        expect(backgroundTasksServiceStub.registerTask).to.have.been.calledOnce;
        expect(backgroundTasksServiceStub.registerTask.firstCall.args[0]).to.deep.include({
            displayText: "Backup Database",
            details: "localhost/AdventureWorks2022",
        });
        expect(backgroundTasksServiceStub.registerTask.firstCall.args[0].tooltip).to.contain(
            "Connection: localhost/AdventureWorks2022",
        );
    });

    test("updates background task progress as SQL task notifications arrive", async () => {
        taskCreatedHandler(baseTaskInfo);

        await taskStatusChangedHandler({
            taskId: "task-1",
            status: TaskStatus.InProgress,
            message: "Halfway there",
        });

        expect(backgroundTaskHandle.update).to.have.been.calledWithMatch({
            message: "Halfway there",
            state: BackgroundTaskState.InProgress,
            canCancel: true,
        });
    });

    test("completes background task with an open action when a completion handler exposes one", async () => {
        const handler: TaskCompletionHandler = {
            operationName: "ExportBacpac",
            getTargetLocation: (taskInfo) => taskInfo.targetLocation,
            getSuccessMessage: (_taskInfo, targetLocation) => `Exported to ${targetLocation}`,
            actionButtonText: "Reveal in Explorer",
            actionCommand: "revealFileInOS",
            getActionCommandArgs: (_taskInfo, targetLocation) => [vscode.Uri.file(targetLocation)],
        };
        sqlTasksService.registerCompletionSuccessHandler(handler);
        taskCreatedHandler(baseTaskInfo);

        await taskStatusChangedHandler({
            taskId: "task-1",
            status: TaskStatus.Succeeded,
            message: "Completed",
        });

        expect(backgroundTaskHandle.complete).to.have.been.calledOnce;
        const [state, update] = backgroundTaskHandle.complete.firstCall.args as [
            BackgroundTaskState,
            { open?: () => Promise<void> },
        ];
        expect(state).to.equal(BackgroundTaskState.Succeeded);
        expect(update.open).to.be.a("function");

        await update.open!();
        expect(vscodeWrapperStub.executeCommand).to.have.been.calledWith(
            "revealFileInOS",
            sinon.match.instanceOf(vscode.Uri),
        );
    });

    test("background task cancel callback routes through the SQL task cancel request", async () => {
        taskCreatedHandler(baseTaskInfo);

        const registration = backgroundTasksServiceStub.registerTask.firstCall.args[0];
        await registration.cancel();

        expect(sqlToolsClientStub.sendRequest).to.have.been.calledOnce;
        expect(sqlToolsClientStub.sendRequest.firstCall.args[1]).to.deep.equal({
            taskId: "task-1",
        });
    });
});
