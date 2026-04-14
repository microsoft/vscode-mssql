/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";
import { expect } from "chai";
import { BackgroundTaskLogContentProvider } from "../../src/backgroundTasks/backgroundTaskLogContentProvider";
import {
    BackgroundTaskState,
    BackgroundTasksService,
} from "../../src/backgroundTasks/backgroundTasksService";

chai.use(sinonChai);

suite("Background Task Log Content Provider Tests", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("renders metadata and live log entries for a task", () => {
        const clock = sandbox.useFakeTimers();
        const service = new BackgroundTasksService(() => undefined);
        const provider = new BackgroundTaskLogContentProvider(service);

        const handle = service.registerTask({
            displayText: "Export bacpac",
            description: "Export operation",
            details: "localhost/AdventureWorks2022",
            target: "/tmp/export.bacpac",
            tooltip: "Export operation",
            source: "MSSQL",
            message: "Starting export",
        });

        clock.tick(1000);
        handle.update({ percent: 50, message: "Halfway there" });

        clock.tick(1000);
        handle.complete(BackgroundTaskState.Succeeded, { message: "Done" });

        const taskLog = service.getTaskLog(handle.id);
        const content = provider.provideTextDocumentContent(provider.getUri(handle.id));

        expect(taskLog?.entries).to.deep.equal([
            {
                timestamp: 0,
                state: BackgroundTaskState.InProgress,
                percent: undefined,
                message: "Starting export",
            },
            {
                timestamp: 1000,
                state: BackgroundTaskState.InProgress,
                percent: 50,
                message: "Halfway there",
            },
            {
                timestamp: 2000,
                state: BackgroundTaskState.Succeeded,
                percent: undefined,
                message: "Done",
            },
        ]);

        expect(content).to.contain("Task: Export bacpac");
        expect(content).to.contain("Status: Succeeded");
        expect(content).to.contain("Source: MSSQL");
        expect(content).to.contain("Connection: localhost/AdventureWorks2022");
        expect(content).to.contain("Target: /tmp/export.bacpac");
        expect(content).to.contain("Description: Export operation");
        expect(content).to.match(/\[\d{2}:\d{2}:\d{2}\.000\] In progress: Starting export/);
        expect(content).to.match(/\[\d{2}:\d{2}:\d{2}\.000\] In progress \(50%\): Halfway there/);
        expect(content).to.match(/\[\d{2}:\d{2}:\d{2}\.000\] Succeeded: Done/);
    });

    test("renders millisecond precision for log timestamps", () => {
        const clock = sandbox.useFakeTimers();
        const service = new BackgroundTasksService(() => undefined);
        const provider = new BackgroundTaskLogContentProvider(service);

        const handle = service.registerTask({
            displayText: "Import data",
            tooltip: "Import data",
            message: "Queued",
        });

        clock.tick(123);
        handle.update({ message: "Running" });

        const content = provider.provideTextDocumentContent(provider.getUri(handle.id));

        expect(content).to.match(/\[\d{2}:\d{2}:\d{2}\.000\] In progress: Queued/);
        expect(content).to.match(/\[\d{2}:\d{2}:\d{2}\.123\] In progress: Running/);
    });

    test("fires change events for opened task logs as task logs update", () => {
        const service = new BackgroundTasksService(() => undefined);
        const provider = new BackgroundTaskLogContentProvider(service);
        const changeSpy = sandbox.spy();
        provider.onDidChange(changeSpy);

        const handle = service.registerTask({
            displayText: "Import data",
            tooltip: "Importing",
            message: "Queued",
        });
        const uri = provider.getUri(handle.id);

        handle.update({ message: "Running" });

        const taskLog = service.getTaskLog(handle.id);

        expect(changeSpy).to.have.been.calledWith(uri);
        expect(taskLog?.entries.map((entry) => entry.message)).to.deep.equal(["Queued", "Running"]);
    });

    test("evicts cached URIs when a task log is removed", () => {
        const service = new BackgroundTasksService(() => undefined);
        const provider = new BackgroundTaskLogContentProvider(service);

        const handle = service.registerTask({
            displayText: "Import data",
            tooltip: "Importing",
            message: "Queued",
        });

        const originalUri = provider.getUri(handle.id);

        handle.remove();

        const recreatedUri = provider.getUri(handle.id);

        expect(recreatedUri.toString()).to.not.equal(originalUri.toString());
        expect(provider.provideTextDocumentContent(originalUri)).to.equal(
            "Task log is unavailable.",
        );
    });

    test("uses contextual information in the document file name", () => {
        const service = new BackgroundTasksService(() => undefined);
        const provider = new BackgroundTaskLogContentProvider(service);

        const handle = service.registerTask({
            displayText: "Export bacpac",
            details: "localhost/AdventureWorks2022",
            target: "/tmp/AdventureWorks2022-export.bacpac",
            tooltip: "Exporting",
        });

        const uri = provider.getUri(handle.id);

        expect(uri.path).to.contain("Export bacpac");
        expect(uri.path).to.contain("localhost-AdventureWorks2022");
        expect(uri.path).to.contain("AdventureWorks2022-export.bacpac");
        expect(uri.path).to.contain(handle.id.slice(0, 8));
    });

    test("does not auto-scroll visible editors when task logs update", () => {
        const service = new BackgroundTasksService(() => undefined);
        const provider = new BackgroundTaskLogContentProvider(service);
        const handle = service.registerTask({
            displayText: "Backup database",
            tooltip: "Backing up",
            message: "Queued",
        });
        const uri = provider.getUri(handle.id);
        const editor = {
            document: {
                uri,
                lineCount: 10,
            } as vscode.TextDocument,
            revealRange: sandbox.stub(),
        } as unknown as vscode.TextEditor;

        sandbox.stub(vscode.window, "visibleTextEditors").value([editor]);

        handle.update({ message: "Running" });

        expect(editor.revealRange).to.not.have.been.called;
    });

    test("opens the task log in a text editor", async () => {
        const service = new BackgroundTasksService(() => undefined);
        const provider = new BackgroundTaskLogContentProvider(service);
        const handle = service.registerTask({
            displayText: "Backup database",
            tooltip: "Backing up",
        });
        const textDocument = { lineCount: 1 } as vscode.TextDocument;

        const openTextDocumentStub = sandbox
            .stub(vscode.workspace, "openTextDocument")
            .resolves(textDocument);
        const editor = {
            document: textDocument,
            revealRange: sandbox.stub(),
        } as unknown as vscode.TextEditor;
        const showTextDocumentStub = sandbox
            .stub(vscode.window, "showTextDocument")
            .resolves(editor);

        await provider.showTaskLog(handle.id);

        expect(openTextDocumentStub).to.have.been.calledWith(provider.getUri(handle.id));
        expect(showTextDocumentStub).to.have.been.calledWith(textDocument, { preview: false });
        expect(editor.revealRange).to.have.been.calledWithMatch(
            sinon.match.instanceOf(vscode.Range),
            vscode.TextEditorRevealType.Default,
        );
    });
});
