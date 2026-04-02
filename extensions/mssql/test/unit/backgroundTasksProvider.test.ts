/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";
import { expect } from "chai";
import {
    BackgroundTaskState,
    BackgroundTasksService,
} from "../../src/backgroundTasks/backgroundTasksService";
import { BackgroundTasksProvider } from "../../src/backgroundTasks/backgroundTasksProvider";
import {
    BackgroundTaskNode,
    EmptyBackgroundTaskNode,
} from "../../src/backgroundTasks/backgroundTaskNode";
import { initializeIconUtils } from "./utils";

chai.use(sinonChai);

suite("Background Tasks Provider Tests", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        initializeIconUtils();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("shows placeholder node when there are no tasks", () => {
        const provider = new BackgroundTasksProvider();

        const nodes = provider.getChildren();

        expect(nodes).to.have.length(1);
        expect(nodes[0]).to.be.instanceOf(EmptyBackgroundTaskNode);
    });

    test("registering and updating a task refreshes rendered fields", () => {
        const provider = new BackgroundTasksProvider();
        const icon = new vscode.ThemeIcon("loading~spin");
        const handle = provider.backgroundTasksService.registerTask({
            displayText: "Import data",
            tooltip: "Importing data",
            percent: 10,
            icon,
        });

        handle.update({
            displayText: "Import complete",
            details: "localhost/AdventureWorks2022",
            tooltip: "Import finished",
            percent: 100,
            icon: new vscode.ThemeIcon("pass"),
            message: "Completed successfully",
        });

        const nodes = provider.getChildren();
        const node = nodes[0] as BackgroundTaskNode;

        expect(node).to.be.instanceOf(BackgroundTaskNode);
        expect(node.label).to.equal("Import complete");
        expect(node.description).to.equal("100% | localhost/AdventureWorks2022");
        expect(node.tooltip).to.equal("Import finished\n\nIn progress\n\nCompleted successfully");
        expect((node.iconPath as vscode.ThemeIcon).id).to.equal("pass");
    });

    test("completed tasks remain visible until cleared", () => {
        const provider = new BackgroundTasksProvider();
        const handle = provider.backgroundTasksService.registerTask({
            displayText: "Export bacpac",
            tooltip: "Exporting",
        });

        handle.complete(BackgroundTaskState.Succeeded, { message: "Done" });

        const nodes = provider.getChildren();
        const node = nodes[0] as BackgroundTaskNode;

        expect(nodes).to.have.length(1);
        expect(node.contextValue).to.contain("completed=true");
        expect(node.tooltip).to.equal("Exporting\n\nSucceeded\n\nDone");
        expect((node.iconPath as vscode.Uri).path).to.contain("backgroundTasks/completedTask.svg");
    });

    test("failed tasks use the custom failed icon", () => {
        const provider = new BackgroundTasksProvider();
        const handle = provider.backgroundTasksService.registerTask({
            displayText: "Failed task",
            tooltip: "Running",
        });

        handle.complete(BackgroundTaskState.Failed, { message: "Failed badly" });

        const node = provider.getChildren()[0] as BackgroundTaskNode;

        expect(node.tooltip).to.equal("Running\n\nFailed\n\nFailed badly");
        expect((node.iconPath as vscode.Uri).path).to.contain("backgroundTasks/failedTask.svg");
    });

    test("canceled tasks use the custom canceled icon", () => {
        const provider = new BackgroundTasksProvider();
        const handle = provider.backgroundTasksService.registerTask({
            displayText: "Canceled task",
            tooltip: "Running",
        });

        handle.complete(BackgroundTaskState.Canceled, { message: "Stopped by user" });

        const node = provider.getChildren()[0] as BackgroundTaskNode;

        expect(node.tooltip).to.equal("Running\n\nCanceled\n\nStopped by user");
        expect((node.iconPath as vscode.ThemeIcon).id).to.equal("circle-slash");
    });

    test("clearFinished removes only completed tasks", () => {
        const provider = new BackgroundTasksProvider();
        const activeHandle = provider.backgroundTasksService.registerTask({
            displayText: "Active task",
            tooltip: "Still running",
        });
        const finishedHandle = provider.backgroundTasksService.registerTask({
            displayText: "Finished task",
            tooltip: "Finished",
        });

        finishedHandle.complete(BackgroundTaskState.Succeeded);
        provider.clearFinished();

        const nodes = provider.getChildren();

        expect(nodes).to.have.length(1);
        expect((nodes[0] as BackgroundTaskNode).label).to.equal("Active task");

        activeHandle.remove();
    });

    test("trimFinished keeps active tasks and caps finished tasks", () => {
        const clock = sandbox.useFakeTimers();
        const service = new BackgroundTasksService(() => undefined, 2);
        const provider = new BackgroundTasksProvider(service);

        service.registerTask({
            displayText: "Active task",
            tooltip: "Active",
        });

        const finishedLabels = ["Finished 1", "Finished 2", "Finished 3"];
        for (const label of finishedLabels) {
            const handle = service.registerTask({
                displayText: label,
                tooltip: label,
            });
            clock.tick(1);
            handle.complete(BackgroundTaskState.Succeeded);
            clock.tick(1);
        }

        const nodes = provider.getChildren() as BackgroundTaskNode[];
        const labels = nodes.map((node) => node.label as string);

        expect(labels).to.deep.equal(["Active task", "Finished 3", "Finished 2"]);
    });

    test("active task order stays stable while progress updates arrive", () => {
        const clock = sandbox.useFakeTimers();
        const provider = new BackgroundTasksProvider();

        const firstHandle = provider.backgroundTasksService.registerTask({
            displayText: "First task",
            tooltip: "First",
            percent: 10,
        });
        clock.tick(1);
        provider.backgroundTasksService.registerTask({
            displayText: "Second task",
            tooltip: "Second",
            percent: 20,
        });

        firstHandle.update({
            percent: 50,
            message: "Halfway",
        });

        const labels = (provider.getChildren() as BackgroundTaskNode[]).map(
            (node) => node.label as string,
        );

        expect(labels).to.deep.equal(["Second task", "First task"]);
    });

    test("cancel command invokes registered callback for active tasks", async () => {
        const provider = new BackgroundTasksProvider();
        const cancelSpy = sandbox.stub().resolves();
        const handle = provider.backgroundTasksService.registerTask({
            displayText: "Cancelable task",
            tooltip: "Cancelable",
            canCancel: true,
            cancel: cancelSpy,
        });

        const node = provider.getChildren()[0] as BackgroundTaskNode;
        await provider.cancelTask(node.taskId);

        expect(cancelSpy).to.have.been.calledOnce;
        const refreshedNode = provider.getChildren()[0] as BackgroundTaskNode;
        expect(refreshedNode.contextValue).to.contain("cancelable=false");
        handle.remove();
    });

    test("open command executes immediately for actionable tasks", async () => {
        const provider = new BackgroundTasksProvider();
        const openSpy = sandbox.stub().resolves();
        provider.backgroundTasksService.registerTask({
            displayText: "Openable task",
            tooltip: "Openable",
            open: openSpy,
        });

        const node = provider.getChildren()[0] as BackgroundTaskNode;
        await provider.openTask(node.taskId);

        expect(openSpy).to.have.been.calledOnce;
    });
});
