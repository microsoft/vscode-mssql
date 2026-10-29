/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * B12 / LS-4 Query Studio language definition delivery: the `mssql-def:`
 * TextDocumentContentProvider serving generated scripts as read-only virtual
 * documents — cacheKey-addressed URIs, LRU bounding, expiry honesty, and
 * content refresh signalling (design 05 §13.5).
 */

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import {
    DEFINITION_SCHEME,
    ScriptedDefinitionContent,
    DefinitionContentProvider,
    openScriptedDefinition,
} from "../../src/queryStudio/definitionContentProvider";
import { QueryStudioLanguageService } from "../../src/queryStudio/queryStudioLanguageService";

chai.use(sinonChai);

suite("queryStudio explicit definition navigation", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });
    teardown(() => sandbox.restore());

    test("bridge navigation opens the original document and selection", async () => {
        const uri = vscode.Uri.parse("file:///project/dbo.Table.sql");
        const document = { uri } as vscode.TextDocument;
        const openDocument = sandbox.stub(vscode.workspace, "openTextDocument").resolves(document);
        const showDocument = sandbox.stub(vscode.window, "showTextDocument").resolves();
        const content = {
            title: "dbo.Table",
            text: "CREATE TABLE dbo.Table (id int);",
            cacheKey: "bridge-table",
            externalTarget: {
                uri: uri.toString(),
                range: {
                    start: { line: 2, character: 3 },
                    end: { line: 2, character: 8 },
                },
            },
        };
        const provider = new DefinitionContentProvider();

        expect(await openScriptedDefinition(provider, content, "source")).to.equal(uri);
        expect(openDocument.firstCall.args[0].toString()).to.equal(uri.toString());
        expect(showDocument.firstCall.args).to.deep.equal([
            document,
            {
                viewColumn: vscode.ViewColumn.Beside,
                preview: true,
                preserveFocus: false,
                selection: new vscode.Range(2, 3, 2, 8),
            },
        ]);
        expect(provider.size).to.equal(0);
    });
});

suite("queryStudio language definition delivery (B12)", () => {
    test("identical object keys on separate connections never overwrite an open definition", () => {
        const provider = new DefinitionContentProvider();
        const content = { title: "dbo.Table", text: "dev", cacheKey: "same-db:123:create:1" };
        const dev = provider.store(content, JSON.stringify(["dev-profile", "same-db"]));
        const prod = provider.store(
            { ...content, text: "prod" },
            JSON.stringify(["prod-profile", "same-db"]),
        );
        expect(dev.toString()).not.to.equal(prod.toString());
        expect(provider.provideTextDocumentContent(dev)).to.equal("dev");
        expect(provider.provideTextDocumentContent(prod)).to.equal("prod");
    });
    test("stored scripts are served by their cacheKey-addressed URI", () => {
        const provider = new DefinitionContentProvider();
        const store = (content: ScriptedDefinitionContent) =>
            provider.store(content, "test-profile");
        const uri = store({
            title: "Sales.Orders",
            text: "CREATE TABLE Sales.Orders (OrderID int);",
            cacheKey: "FixtureDb:1:create:1",
        });
        expect(uri.scheme).to.equal(DEFINITION_SCHEME);
        expect(uri.path).to.equal("/Sales.Orders.sql");
        expect(JSON.parse(decodeURIComponent(uri.query))).to.deep.equal([
            "test-profile",
            "FixtureDb:1:create:1",
        ]);
        expect(provider.provideTextDocumentContent(uri)).to.equal(
            "CREATE TABLE Sales.Orders (OrderID int);",
        );
    });

    test("same cacheKey → same URI; new generation → new URI", () => {
        const provider = new DefinitionContentProvider();
        const store = (content: ScriptedDefinitionContent) =>
            provider.store(content, "test-profile");
        const first = store({ title: "T", text: "A", cacheKey: "db:1:create:1" });
        const again = store({ title: "T", text: "A", cacheKey: "db:1:create:1" });
        expect(again.toString()).to.equal(first.toString());
        const nextGeneration = store({ title: "T", text: "B", cacheKey: "db:1:create:2" });
        expect(nextGeneration.toString()).to.not.equal(first.toString());
        expect(provider.provideTextDocumentContent(first)).to.equal("A");
        expect(provider.provideTextDocumentContent(nextGeneration)).to.equal("B");
    });

    test("changed content under the SAME key fires onDidChange", () => {
        const provider = new DefinitionContentProvider();
        const store = (content: ScriptedDefinitionContent) =>
            provider.store(content, "test-profile");
        const changed: string[] = [];
        provider.onDidChange((uri) => changed.push(uri.toString()));
        const uri = store({ title: "T", text: "A", cacheKey: "k" });
        store({ title: "T", text: "A", cacheKey: "k" }); // identical → silent
        expect(changed.length).to.equal(0);
        store({ title: "T", text: "B", cacheKey: "k" });
        expect(changed).to.deep.equal([uri.toString()]);
    });

    test("expired entries return an honest expiry comment, never stale text", () => {
        const provider = new DefinitionContentProvider();
        const uri = vscode.Uri.from({ scheme: DEFINITION_SCHEME, path: "/gone.sql", query: "x" });
        expect(provider.provideTextDocumentContent(uri)).to.contain("expired");
    });

    test("the cache is LRU-bounded", () => {
        const provider = new DefinitionContentProvider();
        const store = (content: ScriptedDefinitionContent) =>
            provider.store(content, "test-profile");
        const first = store({ title: "T0", text: "S0", cacheKey: "k0" });
        for (let i = 1; i <= 40; i++) {
            store({ title: `T${i}`, text: `S${i}`, cacheKey: `k${i}` });
        }
        expect(provider.size).to.equal(32);
        expect(provider.provideTextDocumentContent(first)).to.contain("expired");
    });
});

/**
 * Definition documents join the SOURCE editor's connection context (profile +
 * CURRENT database) — never an ambient default/last-active profile, which is
 * how a go-to-definition editor used to land on the OE node's database.
 */
suite("queryStudio definition connection adoption", () => {
    let sandbox: sinon.SinonSandbox;
    const targetUri = vscode.Uri.parse("mssql-def:/dbo.GetOrders.sql?cacheKey");

    setup(() => {
        sandbox = sinon.createSandbox();
    });
    teardown(() => {
        sandbox.restore();
    });

    function makeService(binding: unknown): {
        service: QueryStudioLanguageService;
        manager: {
            connect: sinon.SinonStub;
            disconnect: sinon.SinonStub;
            isConnected: sinon.SinonStub;
        };
    } {
        const manager = {
            connect: sandbox.stub().resolves(true),
            disconnect: sandbox.stub().resolves(true),
            isConnected: sandbox.stub().returns(false),
        };
        sandbox
            .stub(vscode.commands, "executeCommand")
            .callsFake(async (command: string) =>
                command === "mssql.getControllerForTests"
                    ? ({ connectionManager: manager } as unknown)
                    : undefined,
            );
        const service = new QueryStudioLanguageService({
            backingDocument: () => undefined,
            sessionBinding: () => binding as never,
            databases: () => undefined,
        });
        return { service, manager };
    }

    test("adopts the source profile with its CURRENT database, not the profile default", async () => {
        const { service, manager } = makeService({
            shadowConnectionProfile: { server: "localhost", database: "master" },
            connectionState: { database: "userdb" },
            onDidChange: () => ({ dispose: () => undefined }),
        });
        const ok = await service.adoptDefinitionDocumentConnection(targetUri);
        expect(ok).to.equal(true);
        expect(manager.connect).to.have.been.calledOnce;
        const [uri, credentials, options] = manager.connect.firstCall.args;
        expect(uri).to.equal(targetUri.toString());
        expect(credentials.server).to.equal("localhost");
        expect(credentials.database).to.equal("userdb");
        expect(options.connectionSource).to.equal("queryStudioDefinition");
        service.dispose();
    });

    test("without a classic-mappable profile the target stays disconnected", async () => {
        const { service, manager } = makeService(undefined);
        const ok = await service.adoptDefinitionDocumentConnection(targetUri);
        expect(ok).to.equal(false);
        expect(manager.connect).to.not.have.been.called;
        service.dispose();
    });

    test("re-adoption in the same database context is a no-op while connected", async () => {
        const { service, manager } = makeService({
            shadowConnectionProfile: { server: "localhost" },
            connectionState: { database: "userdb" },
            onDidChange: () => ({ dispose: () => undefined }),
        });
        await service.adoptDefinitionDocumentConnection(targetUri);
        manager.isConnected.returns(true);
        await service.adoptDefinitionDocumentConnection(targetUri);
        expect(manager.connect).to.have.been.calledOnce;
        service.dispose();
    });

    test("a database change on the source editor reconnects the definition document", async () => {
        const connectionState = { database: "userdb" };
        const { service, manager } = makeService({
            shadowConnectionProfile: { server: "localhost" },
            connectionState,
            onDidChange: () => ({ dispose: () => undefined }),
        });
        await service.adoptDefinitionDocumentConnection(targetUri);
        manager.isConnected.returns(true);
        connectionState.database = "otherdb";
        await service.adoptDefinitionDocumentConnection(targetUri);
        expect(manager.connect).to.have.been.calledTwice;
        expect(manager.disconnect).to.have.been.calledTwice;
        expect(manager.connect.secondCall.args[1].database).to.equal("otherdb");
        service.dispose();
    });
});
