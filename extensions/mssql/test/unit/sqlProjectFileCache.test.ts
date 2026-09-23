/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import * as vscode from "vscode";
import { SqlProjectFileCache } from "../../src/languageservice/sqlProjectFileCache";

chai.use(sinonChai);

suite("SqlProjectFileCache Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let findFilesStub: sinon.SinonStub;
    let onDidCreate: vscode.EventEmitter<vscode.Uri>;
    let onDidDelete: vscode.EventEmitter<vscode.Uri>;
    let onDidChangeWorkspaceFolders: vscode.EventEmitter<vscode.WorkspaceFoldersChangeEvent>;
    let watcher: vscode.FileSystemWatcher;
    let cache: SqlProjectFileCache;

    const projUri = vscode.Uri.file("/project/proj.sqlproj");

    setup(() => {
        sandbox = sinon.createSandbox();
        onDidCreate = new vscode.EventEmitter<vscode.Uri>();
        onDidDelete = new vscode.EventEmitter<vscode.Uri>();
        onDidChangeWorkspaceFolders = new vscode.EventEmitter<vscode.WorkspaceFoldersChangeEvent>();
        watcher = {
            onDidCreate: onDidCreate.event,
            onDidDelete: onDidDelete.event,
            onDidChange: new vscode.EventEmitter<vscode.Uri>().event,
            dispose: sandbox.stub(),
        } as unknown as vscode.FileSystemWatcher;
        sandbox.stub(vscode.workspace, "createFileSystemWatcher").returns(watcher);
        sandbox
            .stub(vscode.workspace, "onDidChangeWorkspaceFolders")
            .callsFake(onDidChangeWorkspaceFolders.event);
        findFilesStub = sandbox.stub(vscode.workspace, "findFiles").resolves([projUri]);
        cache = new SqlProjectFileCache();
    });

    teardown(() => {
        cache.dispose();
        onDidCreate.dispose();
        onDidDelete.dispose();
        onDidChangeWorkspaceFolders.dispose();
        sandbox.restore();
    });

    test("scans the workspace once for repeated lookups", async () => {
        expect(await cache.getFiles()).to.deep.equal([projUri]);
        expect(await cache.getFiles()).to.deep.equal([projUri]);

        expect(findFilesStub).to.have.been.calledOnceWith("**/*.sqlproj", "**/node_modules/**");
    });

    test("does not scan until the files are first requested", () => {
        expect(findFilesStub).to.not.have.been.called;
    });

    test("rescans after a .sqlproj is created", async () => {
        await cache.getFiles();
        onDidCreate.fire(projUri);
        await cache.getFiles();

        expect(findFilesStub).to.have.been.calledTwice;
    });

    test("rescans after a .sqlproj is deleted", async () => {
        await cache.getFiles();
        findFilesStub.resolves([]);
        onDidDelete.fire(projUri);

        expect(await cache.getFiles()).to.deep.equal([]);
    });

    test("rescans after the workspace folders change", async () => {
        await cache.getFiles();
        onDidChangeWorkspaceFolders.fire({ added: [], removed: [] });
        await cache.getFiles();

        expect(findFilesStub).to.have.been.calledTwice;
    });

    test("does not cache a failed lookup", async () => {
        findFilesStub.onFirstCall().rejects(new Error("search failed"));

        let err: Error | undefined;
        try {
            await cache.getFiles();
        } catch (e) {
            err = e as Error;
        }

        expect(err?.message).to.equal("search failed");
        expect(await cache.getFiles()).to.deep.equal([projUri]);
    });

    test("disposes the file watcher", () => {
        cache.dispose();

        expect(watcher.dispose).to.have.been.called;
    });
});
