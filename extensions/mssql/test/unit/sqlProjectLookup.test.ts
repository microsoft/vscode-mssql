/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import * as vscode from "vscode";
import { SqlProjectLookup } from "../../src/languageservice/sqlProjectLookup";

chai.use(sinonChai);

const projectPath = vscode.Uri.file(path.join(path.sep, "repo", "Db", "Db.sqlproj")).fsPath;
const sqlFileUri = vscode.Uri.file(path.join(path.sep, "repo", "Db", "Tables", "T.sql"));

suite("SqlProjectLookup Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let findProjectForFileStub: sinon.SinonStub;
    let sqlprojCreated: vscode.EventEmitter<vscode.Uri>;
    let sqlprojDeleted: vscode.EventEmitter<vscode.Uri>;
    let documentClosed: vscode.EventEmitter<vscode.TextDocument>;
    let lookup: SqlProjectLookup;

    setup(() => {
        sandbox = sinon.createSandbox();
        sqlprojCreated = new vscode.EventEmitter<vscode.Uri>();
        sqlprojDeleted = new vscode.EventEmitter<vscode.Uri>();
        documentClosed = new vscode.EventEmitter<vscode.TextDocument>();

        sandbox.stub(vscode.workspace, "createFileSystemWatcher").returns({
            onDidCreate: sqlprojCreated.event,
            onDidDelete: sqlprojDeleted.event,
            onDidChange: new vscode.EventEmitter<vscode.Uri>().event,
            dispose: () => undefined,
        } as unknown as vscode.FileSystemWatcher);
        sandbox.stub(vscode.workspace, "onDidCloseTextDocument").get(() => documentClosed.event);

        findProjectForFileStub = sandbox
            .stub()
            .resolves({ success: true, errorMessage: "", projectUri: projectPath, isLoaded: true });
        lookup = new SqlProjectLookup({ findProjectForFile: findProjectForFileStub });
    });

    teardown(() => {
        lookup.dispose();
        sandbox.restore();
    });

    test("returns the owning project for a saved .sql file", async () => {
        const result = await lookup.findProjectForFile(sqlFileUri);

        expect(result?.fsPath).to.equal(projectPath);
        expect(findProjectForFileStub).to.have.been.calledWith(sqlFileUri.fsPath);
    });

    test("returns undefined when the file is not in a project", async () => {
        findProjectForFileStub.resolves({ success: true, errorMessage: "", isLoaded: false });

        expect(await lookup.findProjectForFile(sqlFileUri)).to.be.undefined;
    });

    test("does not ask the service about untitled documents or non-.sql files", async () => {
        const untitled = vscode.Uri.parse("untitled:Untitled-1");
        const readme = vscode.Uri.file(path.join(path.sep, "repo", "Db", "README.md"));

        expect(await lookup.findProjectForFile(untitled)).to.be.undefined;
        expect(await lookup.findProjectForFile(readme)).to.be.undefined;
        expect(findProjectForFileStub).to.not.have.been.called;
    });

    test("caches the answer for a file", async () => {
        await lookup.findProjectForFile(sqlFileUri);
        await lookup.findProjectForFile(sqlFileUri);

        expect(findProjectForFileStub).to.have.been.calledOnce;
    });

    test("asks again after a .sqlproj is created or deleted", async () => {
        await lookup.findProjectForFile(sqlFileUri);
        sqlprojCreated.fire(vscode.Uri.file(projectPath));
        await lookup.findProjectForFile(sqlFileUri);
        sqlprojDeleted.fire(vscode.Uri.file(projectPath));
        await lookup.findProjectForFile(sqlFileUri);

        expect(findProjectForFileStub).to.have.been.calledThrice;
    });

    test("asks again after the document closes", async () => {
        await lookup.findProjectForFile(sqlFileUri);
        documentClosed.fire({ uri: sqlFileUri } as vscode.TextDocument);
        await lookup.findProjectForFile(sqlFileUri);

        expect(findProjectForFileStub).to.have.been.calledTwice;
    });

    test("returns undefined on failure and does not cache it", async () => {
        findProjectForFileStub.onFirstCall().rejects(new Error("service not ready"));

        expect(await lookup.findProjectForFile(sqlFileUri)).to.be.undefined;
        expect((await lookup.findProjectForFile(sqlFileUri))?.fsPath).to.equal(projectPath);
    });
});
