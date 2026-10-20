/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import * as vscode from "vscode";
import { expect } from "chai";
import ConnectionManager from "../../../src/controllers/connectionManager";
import SqlToolsServiceClient, {
    EmbeddedSqlDocument,
} from "../../../src/languageservice/serviceclient";
import { PythonNotebookIntellisense } from "../../../src/notebooks/pythonNotebookIntellisense";
import { PythonNotebookCredentialsProvider } from "../../../src/notebooks/pythonNotebookCredentials";
import { Logger } from "../../../src/models/logger";
import { ConnectionCredentials } from "../../../src/models/connectionCredentials";
import { stubMessageBoxes } from "../utils";

suite("PythonNotebookIntellisense", () => {
    let sandbox: sinon.SinonSandbox;
    let bridge: PythonNotebookIntellisense;
    let manager: sinon.SinonStubbedInstance<ConnectionManager>;
    let client: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let provider: sinon.SinonStubbedInstance<PythonNotebookCredentialsProvider>;
    let document: vscode.TextDocument;
    let notebook: vscode.NotebookDocument;
    let remote: EmbeddedSqlDocument;
    let complete: sinon.SinonStub;
    let warn: sinon.SinonStub;
    let source: vscode.CancellationTokenSource;
    let registration: sinon.SinonSpy;
    let catalogReady: vscode.EventEmitter<string>;
    const reference = { version: 1, connectionId: "approved-id", database: "selected" } as const;
    const context = {
        triggerKind: vscode.CompletionTriggerKind.Invoke,
        triggerCharacter: undefined,
    };

    setup(async () => {
        sandbox = sinon.createSandbox();
        registration = sandbox.spy(vscode.languages, "registerCompletionItemProvider");
        warn = stubMessageBoxes(sandbox).showWarningMessage;
        manager = sandbox.createStubInstance(ConnectionManager);
        catalogReady = new vscode.EventEmitter<string>();
        sandbox.stub(manager, "onIntellisenseReady").get(() => catalogReady.event);
        manager.sendRequest.callsFake(async (type, params) => {
            if (
                type.method === "connection/connect" &&
                params &&
                typeof params === "object" &&
                "ownerUri" in params &&
                typeof params.ownerUri === "string"
            ) {
                catalogReady.fire(params.ownerUri);
            }
            return true;
        });
        manager.createConnectionDetails.returns({ options: {} });
        manager.expectConnectionComplete.resolves({
            connectionId: "connected",
            ownerUri: "synthetic",
            messages: "",
            errorMessage: "",
            errorNumber: undefined,
            serverInfo: undefined,
            connectionSummary: { databaseName: "selected", serverName: "approved", userName: "" },
        });
        manager.registerNotebookTokenProvider.returns(new vscode.Disposable(() => undefined));
        client = sandbox.createStubInstance(SqlToolsServiceClient);
        provider = sandbox.createStubInstance(PythonNotebookCredentialsProvider);
        provider.getLanguageServiceConnectionInfo.resolves(
            Object.assign(new ConnectionCredentials(), {
                server: "approved",
                database: "selected",
                authenticationType: "Integrated",
            }),
        );
        complete = sandbox.stub().resolves([
            Object.assign(new vscode.CompletionItem("catalog_column"), {
                range: new vscode.Range(1, 9, 1, 9),
                insertText: new vscode.SnippetString("catalog_column"),
            }),
        ]);
        remote = {
            update: sandbox.stub().resolves(),
            completion: complete,
            resolveCompletion: sandbox.stub().callsFake(async (item) => item),
            hover: sandbox
                .stub()
                .resolves(new vscode.Hover("catalog_column int", new vscode.Range(1, 7, 1, 8))),
            signatureHelp: sandbox.stub().resolves(new vscode.SignatureHelp()),
            dispose: sandbox.stub(),
        };
        client.openEmbeddedSqlDocument.resolves(remote);
        document = await vscode.workspace.openTextDocument({
            language: "python",
            content: "%%tsql --bind df\nSELECT t. FROM dbo.example AS t;",
        });
        const cell: vscode.NotebookCell = {
            document,
            index: 0,
            get notebook() {
                return notebook;
            },
            kind: vscode.NotebookCellKind.Code,
            metadata: {},
            outputs: [],
            executionSummary: undefined,
        };
        notebook = {
            uri: vscode.Uri.file("C:\\intellisense.ipynb"),
            metadata: { metadata: { mssqlPythonNotebook: reference } },
            notebookType: "jupyter-notebook",
            version: 1,
            isDirty: false,
            isUntitled: false,
            getCells: () => [cell],
            cellCount: 1,
            cellAt: () => cell,
            save: async () => true,
            isClosed: false,
        };
        bridge = new PythonNotebookIntellisense(
            manager,
            Logger.forChannelName("Notebook Test"),
            () => true,
            client,
        );
        source = new vscode.CancellationTokenSource();
    });

    teardown(() => {
        bridge.dispose();
        catalogReady.dispose();
        source.dispose();
        sandbox.restore();
    });

    test("does not open SQL documents until the notebook is authorized", async () => {
        expect(
            await bridge.provideCompletionItems(
                document,
                new vscode.Position(1, 9),
                source.token,
                context,
            ),
        ).to.equal(undefined);
        expect(client.openEmbeddedSqlDocument.called).to.equal(false);
        expect(manager.sendRequest.called).to.equal(false);
    });

    for (const allowed of [false, true]) {
        test(`does not read unrelated edits with feature ${allowed ? "enabled" : "disabled"}`, async () => {
            bridge.dispose();
            const changes = new vscode.EventEmitter<vscode.TextDocumentChangeEvent>();
            sandbox.stub(vscode.workspace, "onDidChangeTextDocument").callsFake(changes.event);
            bridge = new PythonNotebookIntellisense(
                manager,
                Logger.forChannelName("Notebook Test"),
                () => allowed,
                client,
            );
            const changed = await vscode.workspace.openTextDocument({
                language: "sql",
                content: "SELECT 1;",
            });
            const getText = sandbox.spy(() => changed.getText());
            changes.fire({
                document: { ...changed, getText },
                contentChanges: [],
                reason: undefined,
            });
            expect(getText).not.to.have.been.called;
            changes.dispose();
        });
    }

    test("registers for saved and untitled Python notebooks without filtering the notebook URI by cell scheme", () => {
        expect(registration).to.have.been.calledWith(
            { language: "python", notebookType: "jupyter-notebook" },
            bridge,
            ".",
        );
    });

    test("connects once to the approved catalog and preserves snippets and ranges", async () => {
        bridge.authorize(notebook, provider, reference, "selected");
        const first = await bridge.provideCompletionItems(
            document,
            new vscode.Position(1, 9),
            source.token,
            context,
        );
        const second = await bridge.provideCompletionItems(
            document,
            new vscode.Position(1, 9),
            source.token,
            context,
        );
        expect(first).to.be.instanceOf(vscode.CompletionList);
        expect(second).to.be.instanceOf(vscode.CompletionList);
        const item = (first as vscode.CompletionList).items[0];
        expect(item.label).to.equal("catalog_column");
        expect(item.insertText).to.be.instanceOf(vscode.SnippetString);
        expect(item.range).to.deep.equal(new vscode.Range(1, 9, 1, 9));
        expect(client.openEmbeddedSqlDocument.calledOnce).to.equal(true);
        expect(
            provider.getLanguageServiceConnectionInfo.calledWith(reference, "selected"),
        ).to.equal(true);
    });

    test("prioritizes catalog objects over Python suggestions while preserving SQL ordering", async () => {
        const table = Object.assign(new vscode.CompletionItem("Customers"), { sortText: "002" });
        const database = new vscode.CompletionItem({ label: "Northwind" });
        complete.resolves([table, database]);
        bridge.authorize(notebook, provider, reference, "selected");
        for (let index = 0; index < 2; index++) {
            const result = await bridge.provideCompletionItems(
                document,
                new vscode.Position(1, 9),
                source.token,
                context,
            );
            expect(result?.items.map((item) => item.sortText)).to.deep.equal([
                "\0" + "002",
                "\0Northwind",
            ]);
            expect(result?.items[0]).to.equal(table);
        }
    });

    test("ignores the magic header and ordinary Python cells", async () => {
        bridge.authorize(notebook, provider, reference, "selected");
        expect(
            await bridge.provideCompletionItems(
                document,
                new vscode.Position(0, 8),
                source.token,
                context,
            ),
        ).to.equal(undefined);
        const python = await vscode.workspace.openTextDocument({
            language: "python",
            content: "df.head()",
        });
        expect(
            await bridge.provideCompletionItems(
                python,
                new vscode.Position(0, 3),
                source.token,
                context,
            ),
        ).to.equal(undefined);
        expect(client.openEmbeddedSqlDocument.called).to.equal(false);
    });

    test("drops a result after authorization is revoked during the request", async () => {
        let finish!: (value: vscode.CompletionItem[]) => void;
        let started!: () => void;
        let requestToken: vscode.CancellationToken | undefined;
        const startedPromise = new Promise<void>((resolve) => {
            started = resolve;
        });
        complete.callsFake((_position, _context, token: vscode.CancellationToken) => {
            requestToken = token;
            started();
            return new Promise((resolve) => {
                finish = resolve;
            });
        });
        const auth = bridge.authorize(notebook, provider, reference, "selected");
        const pending = bridge.provideCompletionItems(
            document,
            new vscode.Position(1, 9),
            source.token,
            context,
        );
        await Promise.race([startedPromise, pending]);
        auth.dispose();
        expect(requestToken?.isCancellationRequested).to.equal(true);
        if (finish) finish([new vscode.CompletionItem("stale")]);
        expect(await pending).to.equal(undefined);
        expect((remote.dispose as sinon.SinonStub).called).to.equal(true);
    });

    test("rejects completion edits that touch the magic header", async () => {
        complete.resolves([
            Object.assign(new vscode.CompletionItem("unsafe"), {
                range: new vscode.Range(0, 0, 1, 8),
            }),
            Object.assign(new vscode.CompletionItem("unsafe-extra"), {
                additionalTextEdits: [vscode.TextEdit.insert(new vscode.Position(0, 0), "changed")],
            }),
        ]);
        bridge.authorize(notebook, provider, reference, "selected");
        const result = await bridge.provideCompletionItems(
            document,
            new vscode.Position(1, 9),
            source.token,
            context,
        );
        expect((result as vscode.CompletionList).items).to.deep.equal([]);
    });

    test("keeps two notebook authorizations and private owners isolated", async () => {
        const otherDocument = await vscode.workspace.openTextDocument({
            language: "python",
            content: "%%tsql\nSELECT t. FROM dbo.other AS t;",
        });
        const otherCell: vscode.NotebookCell = {
            document: otherDocument,
            index: 0,
            get notebook() {
                return otherNotebook;
            },
            kind: vscode.NotebookCellKind.Code,
            metadata: {},
            outputs: [],
            executionSummary: undefined,
        };
        const otherReference = { version: 1, connectionId: "other-id", database: "other" } as const;
        const otherNotebook: vscode.NotebookDocument = {
            ...notebook,
            uri: vscode.Uri.file("C:\\other-intellisense.ipynb"),
            metadata: { metadata: { mssqlPythonNotebook: otherReference } },
            getCells: () => [otherCell],
            cellAt: () => otherCell,
        };
        const otherProvider = sandbox.createStubInstance(PythonNotebookCredentialsProvider);
        otherProvider.getLanguageServiceConnectionInfo.resolves(
            Object.assign(new ConnectionCredentials(), {
                server: "other-server",
                database: "other",
                authenticationType: "Integrated",
            }),
        );
        manager.expectConnectionComplete.onSecondCall().resolves({
            ...(await manager.expectConnectionComplete("unused")),
            connectionSummary: {
                databaseName: "other",
                serverName: "other-server",
                userName: "",
            },
        });
        manager.expectConnectionComplete.resetHistory();
        bridge.authorize(notebook, provider, reference, "selected");
        const authorization = bridge.authorize(
            otherNotebook,
            otherProvider,
            otherReference,
            "other",
        );
        await bridge.provideCompletionItems(
            document,
            new vscode.Position(1, 9),
            source.token,
            context,
        );
        await bridge.provideCompletionItems(
            otherDocument,
            new vscode.Position(1, 9),
            source.token,
            context,
        );
        expect(provider.getLanguageServiceConnectionInfo).to.have.been.calledWith(
            reference,
            "selected",
        );
        expect(otherProvider.getLanguageServiceConnectionInfo).to.have.been.calledWith(
            otherReference,
            "other",
        );
        const owners = client.openEmbeddedSqlDocument
            .getCalls()
            .map((call) => call.args[0].toString());
        expect(owners).to.have.length(2);
        expect(owners[0]).not.to.equal(owners[1]);
        authorization.dispose();
        expect(
            await bridge.provideCompletionItems(
                otherDocument,
                new vscode.Position(1, 9),
                source.token,
                context,
            ),
        ).to.equal(undefined);
        expect(
            await bridge.provideCompletionItems(
                document,
                new vscode.Position(1, 9),
                source.token,
                context,
            ),
        ).to.be.instanceOf(vscode.CompletionList);
    });

    test("shares a lazy metadata connection across concurrent authoring requests", async () => {
        bridge.authorize(notebook, provider, reference, "selected");
        await Promise.all([
            bridge.provideCompletionItems(
                document,
                new vscode.Position(1, 9),
                source.token,
                context,
            ),
            bridge.provideHover(document, new vscode.Position(1, 7), source.token),
        ]);
        expect(client.openEmbeddedSqlDocument).to.have.been.calledOnce;
        expect(provider.getLanguageServiceConnectionInfo).to.have.been.calledOnce;
    });

    test("preserves visible suggestions when Jupyter concurrently requests completion for the same cell", async () => {
        let latest = 0;
        complete.callsFake(async () => {
            const request = ++latest;
            await new Promise<void>((resolve) => setImmediate(resolve));
            return request === latest ? [new vscode.CompletionItem("catalog_column")] : [];
        });
        bridge.authorize(notebook, provider, reference, "selected");
        const results = await Promise.all([
            bridge.provideCompletionItems(
                document,
                new vscode.Position(1, 9),
                source.token,
                context,
            ),
            bridge.provideCompletionItems(
                document,
                new vscode.Position(1, 9),
                source.token,
                context,
            ),
        ]);
        for (const result of results) {
            expect(result?.items.map((item) => item.label)).to.deep.equal(["catalog_column"]);
        }
    });

    test("keeps projected text unchanged until its in-flight completion finishes", async () => {
        let finish!: (items: vscode.CompletionItem[]) => void;
        let started!: () => void;
        const starting = new Promise<void>((resolve) => {
            started = resolve;
        });
        complete.onFirstCall().callsFake(() => {
            started();
            return new Promise((resolve) => {
                finish = resolve;
            });
        });
        const update = remote.update as sinon.SinonStub;
        bridge.authorize(notebook, provider, reference, "selected");
        const first = bridge.provideCompletionItems(
            document,
            new vscode.Position(1, 9),
            source.token,
            context,
        );
        await starting;
        update.resetHistory();
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, new vscode.Position(1, 9), "catalog");
        expect(await vscode.workspace.applyEdit(edit)).to.equal(true);
        const second = bridge.provideCompletionItems(
            document,
            new vscode.Position(1, 16),
            source.token,
            context,
        );
        await new Promise<void>((resolve) => setImmediate(resolve));
        const changedDuringCompletion = update.calledWith(sinon.match("catalog"), document.version);
        finish([new vscode.CompletionItem("stale")]);
        const [stale, latest] = await Promise.all([first, second]);
        expect(changedDuringCompletion).to.equal(false);
        expect(stale).to.equal(undefined);
        expect(latest?.items.map((item) => item.label)).to.deep.equal(["catalog_column"]);
        expect(update).to.have.been.calledWith(sinon.match("catalog"), document.version);
    });

    test("waits for the matching catalog-ready notification before the first completion", async () => {
        manager.sendRequest.resolves(true);
        bridge.authorize(notebook, provider, reference, "selected");
        const pending = bridge.provideCompletionItems(
            document,
            new vscode.Position(1, 9),
            source.token,
            context,
        );
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(complete).not.to.have.been.called;
        catalogReady.fire("unrelated-owner");
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(complete).not.to.have.been.called;
        catalogReady.fire(client.openEmbeddedSqlDocument.firstCall.args[0].toString());
        expect(await pending).to.be.instanceOf(vscode.CompletionList);
    });

    test("reports a catalog readiness timeout and disposes its projection", async () => {
        const clock = sandbox.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        manager.sendRequest.resolves(true);
        bridge.authorize(notebook, provider, reference, "selected");
        const pending = bridge.provideCompletionItems(
            document,
            new vscode.Position(1, 9),
            source.token,
            context,
        );
        await clock.tickAsync(30001);
        expect(await pending).to.equal(undefined);
        expect(remote.dispose).to.have.been.called;
        expect(warn).to.have.been.calledWith(sinon.match("SQL IntelliSense"));
        expect(complete).not.to.have.been.called;
    });

    test("keeps the shared metadata connection when only an individual request is cancelled", async () => {
        bridge.authorize(notebook, provider, reference, "selected");
        complete.callsFake(async () => {
            source.cancel();
            throw new vscode.CancellationError();
        });
        expect(
            await bridge.provideCompletionItems(
                document,
                new vscode.Position(1, 9),
                source.token,
                context,
            ),
        ).to.equal(undefined);
        expect(remote.dispose).not.to.have.been.called;
        complete.resolves([new vscode.CompletionItem("fresh")]);
        const next = new vscode.CancellationTokenSource();
        try {
            expect(
                await bridge.provideCompletionItems(
                    document,
                    new vscode.Position(1, 9),
                    next.token,
                    context,
                ),
            ).to.be.instanceOf(vscode.CompletionList);
            expect(client.openEmbeddedSqlDocument).to.have.been.calledOnce;
        } finally {
            next.dispose();
        }
    });

    test("does not let an abandoned request dispose a newer projection for the same cell", async () => {
        let fail!: (error: Error) => void;
        let started!: () => void;
        const starting = new Promise<void>((resolve) => {
            started = resolve;
        });
        complete.callsFake(
            () =>
                new Promise((_resolve, reject) => {
                    fail = reject;
                    started();
                }),
        );
        bridge.authorize(notebook, provider, reference, "selected");
        const old = bridge.provideCompletionItems(
            document,
            new vscode.Position(1, 9),
            source.token,
            context,
        );
        await starting;
        bridge.suspend(notebook);
        const replacement = { ...remote, dispose: sandbox.stub() };
        client.openEmbeddedSqlDocument.resolves(replacement);
        complete.resolves([new vscode.CompletionItem("fresh")]);
        await bridge.provideCompletionItems(
            document,
            new vscode.Position(1, 9),
            source.token,
            context,
        );
        fail(new vscode.CancellationError());
        expect(await old).to.equal(undefined);
        expect(replacement.dispose).not.to.have.been.called;
    });

    test("closes metadata connections immediately during save adoption and reopens only for the adopted notebook", async () => {
        bridge.authorize(notebook, provider, reference, "selected");
        await bridge.provideCompletionItems(
            document,
            new vscode.Position(1, 9),
            source.token,
            context,
        );
        bridge.suspend(notebook);
        expect(remote.dispose).to.have.been.called;
        const adopted = { ...notebook, uri: vscode.Uri.file("C:\\saved-intellisense.ipynb") };
        bridge.adopt(notebook, adopted);
        await bridge.provideCompletionItems(
            document,
            new vscode.Position(1, 9),
            source.token,
            context,
        );
        expect(client.openEmbeddedSqlDocument.getCalls()).to.have.length(2);
    });

    test("opens the captured source version when the cell changes during connection", async () => {
        let finish!: (value: ConnectionCredentials) => void;
        let started!: () => void;
        const starting = new Promise<void>((resolve) => {
            started = resolve;
        });
        provider.getLanguageServiceConnectionInfo.callsFake(() => {
            started();
            return new Promise((resolve) => {
                finish = resolve;
            });
        });
        bridge.authorize(notebook, provider, reference, "selected");
        const version = document.version;
        const pending = bridge.provideCompletionItems(
            document,
            new vscode.Position(1, 9),
            source.token,
            context,
        );
        await starting;
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, new vscode.Position(1, 9), "catalog_column");
        expect(await vscode.workspace.applyEdit(edit)).to.equal(true);
        finish(
            Object.assign(new ConnectionCredentials(), {
                server: "approved",
                database: "selected",
                authenticationType: "Integrated",
            }),
        );
        expect(await pending).to.equal(undefined);
        expect(client.openEmbeddedSqlDocument).to.have.been.calledWith(
            sinon.match.any,
            sinon.match.string,
            version,
        );
        await bridge.provideCompletionItems(
            document,
            new vscode.Position(1, 9),
            source.token,
            context,
        );
        expect(remote.update).to.have.been.calledWith(
            sinon.match("catalog_column"),
            document.version,
        );
    });

    test("drops stale completion resolution after the cell changes", async () => {
        bridge.authorize(notebook, provider, reference, "selected");
        const result = await bridge.provideCompletionItems(
            document,
            new vscode.Position(1, 9),
            source.token,
            context,
        );
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, new vscode.Position(1, 9), "changed");
        await vscode.workspace.applyEdit(edit);
        expect(
            await bridge.resolveCompletionItem(
                (result as vscode.CompletionList).items[0],
                source.token,
            ),
        ).to.equal(undefined);
        expect(remote.resolveCompletion).not.to.have.been.called;
    });

    test("revokes the projection when profile validation fails without reporting raw errors", async () => {
        bridge.authorize(notebook, provider, reference, "selected");
        await bridge.provideCompletionItems(
            document,
            new vscode.Position(1, 9),
            source.token,
            context,
        );
        provider.validate.rejects(new Error("do-not-log-secret"));
        await bridge.provideCompletionItems(
            document,
            new vscode.Position(1, 9),
            source.token,
            context,
        );
        expect(remote.dispose).to.have.been.called;
        expect(warn).to.have.been.calledWith(
            sinon.match(
                (message: string) =>
                    message.includes("SQL IntelliSense") && !message.includes("do-not-log-secret"),
            ),
        );
    });

    test("cancels authorization while catalog credentials are being acquired", async () => {
        let finish!: (value: ConnectionCredentials) => void;
        let started!: () => void;
        const starting = new Promise<void>((resolve) => {
            started = resolve;
        });
        provider.getLanguageServiceConnectionInfo.callsFake(() => {
            started();
            return new Promise((resolve) => {
                finish = resolve;
            });
        });
        const authorization = bridge.authorize(notebook, provider, reference, "selected");
        const pending = bridge.provideCompletionItems(
            document,
            new vscode.Position(1, 9),
            source.token,
            context,
        );
        await starting;
        authorization.dispose();
        finish(new ConnectionCredentials());
        expect(await pending).to.equal(undefined);
        expect(client.openEmbeddedSqlDocument).not.to.have.been.called;
        expect(warn).not.to.have.been.called;
    });

    test("provides SQL hover and signatures only inside the SQL body", async () => {
        bridge.authorize(notebook, provider, reference, "selected");
        expect(
            (await bridge.provideHover(document, new vscode.Position(1, 7), source.token))
                ?.contents,
        ).not.to.be.empty;
        expect(
            await bridge.provideSignatureHelp(document, new vscode.Position(1, 9), source.token, {
                triggerKind: vscode.SignatureHelpTriggerKind.Invoke,
                isRetrigger: false,
                triggerCharacter: undefined,
                activeSignatureHelp: undefined,
            }),
        ).to.be.instanceOf(vscode.SignatureHelp);
        expect(
            await bridge.provideHover(document, new vscode.Position(0, 1), source.token),
        ).to.equal(undefined);
    });

    test("reports metadata failure once without interrupting Python execution", async () => {
        client.openEmbeddedSqlDocument.rejects(new Error("synthetic secret must not be displayed"));
        bridge.authorize(notebook, provider, reference, "selected");
        await bridge.provideCompletionItems(
            document,
            new vscode.Position(1, 9),
            source.token,
            context,
        );
        await bridge.provideCompletionItems(
            document,
            new vscode.Position(1, 9),
            source.token,
            context,
        );
        expect(warn.calledOnce).to.equal(true);
        expect(warn.firstCall.args[0]).not.to.contain("synthetic secret");
    });
});
