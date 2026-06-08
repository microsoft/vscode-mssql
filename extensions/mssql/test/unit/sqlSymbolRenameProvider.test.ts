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
import { SqlSymbolRenameProvider } from "../../src/languageservice/sqlSymbolRenameProvider";
import SqlToolsServerClient from "../../src/languageservice/serviceclient";
import { SqlSymbolRenameRequest } from "../../src/models/contracts/languageService";
import { SqlSymbolRename as loc } from "../../src/constants/locConstants";

chai.use(sinonChai);

// Cross-platform path helpers — always derived from vscode.Uri so separators match the OS.
const projectDir = path.dirname(
    vscode.Uri.file(path.join(path.sep, "project", "proj.sqlproj")).fsPath,
);
const defaultSqlFile = path.join(projectDir, "file.sql");
const defaultProjFile = path.join(projectDir, "proj.sqlproj");

// Helper to build a minimal stubbed TextDocument
function makeDocument(
    sandbox: sinon.SinonSandbox,
    opts: {
        fsPath?: string;
        uriString?: string;
        wordText?: string;
        wordRange?: vscode.Range;
    } = {},
): vscode.TextDocument {
    const fsPath = opts.fsPath ?? defaultSqlFile;
    const uriString = opts.uriString ?? vscode.Uri.file(fsPath).toString();
    const range =
        opts.wordRange ?? new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 8));
    const wordText = opts.wordText ?? "MyTable";

    const doc = {
        uri: Object.assign(vscode.Uri.file(fsPath), { toString: () => uriString }),
        getText: (_r?: vscode.Range) => wordText,
        getWordRangeAtPosition: sandbox.stub().returns(range),
        languageId: "sql",
    } as unknown as vscode.TextDocument;
    return doc;
}

suite("SqlSymbolRenameProvider Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let provider: SqlSymbolRenameProvider;
    let findFilesStub: sinon.SinonStub;
    let sendRequestStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        provider = new SqlSymbolRenameProvider();

        // Default: no .sqlproj files found
        findFilesStub = sandbox.stub(vscode.workspace, "findFiles").resolves([]);

        // Default: sendRequest returns undefined (no rename result)
        sendRequestStub = sandbox
            .stub(SqlToolsServerClient.instance, "sendRequest")
            .resolves(undefined);
    });

    teardown(() => {
        sandbox.restore();
    });

    // -------------------------------------------------------------------------
    suite("prepareRename", () => {
        test("rejects when file is not inside any SQL project", async () => {
            findFilesStub.resolves([]); // no .sqlproj in workspace

            const doc = makeDocument(sandbox, { fsPath: path.join(path.sep, "other", "file.sql") });

            let err: Error | undefined;
            try {
                await provider.prepareRename(doc, new vscode.Position(0, 0));
            } catch (e) {
                err = e as Error;
            }

            expect(err).to.not.be.undefined;
            expect(err!.message).to.equal(loc.renameOnlyInProjectFiles);
        });

        test("rejects when cursor is not on a word", async () => {
            const projUri = vscode.Uri.file(defaultProjFile);
            findFilesStub.resolves([projUri]);

            const doc = makeDocument(sandbox, { fsPath: defaultSqlFile });
            (doc.getWordRangeAtPosition as sinon.SinonStub).returns(undefined);

            let err: Error | undefined;
            try {
                await provider.prepareRename(doc, new vscode.Position(0, 0));
            } catch (e) {
                err = e as Error;
            }

            expect(err).to.not.be.undefined;
            expect(err!.message).to.equal(loc.renameNotSupportedAtPosition);
        });

        test("returns range and placeholder for plain identifier", async () => {
            const projUri = vscode.Uri.file(defaultProjFile);
            findFilesStub.resolves([projUri]);

            const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 7));
            const doc = makeDocument(sandbox, {
                fsPath: defaultSqlFile,
                wordText: "MyTable",
                wordRange: range,
            });

            const result = await provider.prepareRename(doc, new vscode.Position(0, 0));

            expect(result).to.deep.equal({ range, placeholder: "MyTable" });
        });

        test("strips outer brackets from bracket-quoted identifier", async () => {
            const projUri = vscode.Uri.file(defaultProjFile);
            findFilesStub.resolves([projUri]);

            const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 9));
            const doc = makeDocument(sandbox, {
                fsPath: defaultSqlFile,
                wordText: "[MyTable]",
                wordRange: range,
            });

            const result = (await provider.prepareRename(doc, new vscode.Position(0, 0))) as {
                range: vscode.Range;
                placeholder: string;
            };

            expect(result.placeholder).to.equal("MyTable");
            expect(result.range).to.deep.equal(range);
        });
    });

    // -------------------------------------------------------------------------
    suite("provideRenameEdits", () => {
        const token = {} as vscode.CancellationToken;

        test("throws renameOnlyInProjectFiles when STS returns no result", async () => {
            sendRequestStub.withArgs(SqlSymbolRenameRequest.type).resolves(undefined);

            const doc = makeDocument(sandbox);
            let err: Error | undefined;
            try {
                await provider.provideRenameEdits(doc, new vscode.Position(0, 0), "NewName", token);
            } catch (e) {
                err = e as Error;
            }

            expect(err).to.not.be.undefined;
            expect(err!.message).to.equal(loc.renameOnlyInProjectFiles);
        });

        test("falls back to single-file rename when STS returns empty changes", async () => {
            sendRequestStub.withArgs(SqlSymbolRenameRequest.type).resolves({
                changes: {},
                elementName: "MyTable",
                newName: "NewTable",
            });

            const range = new vscode.Range(new vscode.Position(1, 5), new vscode.Position(1, 12));
            const doc = makeDocument(sandbox, {
                fsPath: defaultSqlFile,
                wordText: "MyTable",
                wordRange: range,
            });

            const edit = await provider.provideRenameEdits(
                doc,
                new vscode.Position(1, 5),
                "NewTable",
                token,
            );

            expect(edit).to.be.instanceOf(vscode.WorkspaceEdit);
            const entries = edit!.entries();
            expect(entries).to.have.length(1);
            expect(entries[0][0].fsPath).to.equal(doc.uri.fsPath);
        });

        test("builds WorkspaceEdit from multi-file STS response", async () => {
            const fileAUri = vscode.Uri.file(path.join(projectDir, "a.sql")).toString();
            const fileBUri = vscode.Uri.file(path.join(projectDir, "b.sql")).toString();

            sendRequestStub.withArgs(SqlSymbolRenameRequest.type).resolves({
                changes: {
                    [fileAUri]: [
                        {
                            range: {
                                start: { line: 0, character: 0 },
                                end: { line: 0, character: 7 },
                            },
                            newText: "NewTable",
                        },
                    ],
                    [fileBUri]: [
                        {
                            range: {
                                start: { line: 5, character: 10 },
                                end: { line: 5, character: 17 },
                            },
                            newText: "NewTable",
                        },
                    ],
                },
                elementName: "MyTable",
                newName: "NewTable",
            });

            const doc = makeDocument(sandbox);
            const edit = await provider.provideRenameEdits(
                doc,
                new vscode.Position(0, 0),
                "NewTable",
                token,
            );

            expect(edit).to.be.instanceOf(vscode.WorkspaceEdit);
            const entries = edit!.entries();
            expect(entries).to.have.length(2);

            const uris = entries.map(([u]) => u.toString());
            expect(uris).to.include(fileAUri);
            expect(uris).to.include(fileBUri);

            const editsForA = entries.find(([u]) => u.toString() === fileAUri)![1];
            expect(editsForA).to.have.length(1);
            expect(editsForA[0].newText).to.equal("NewTable");
        });

        test("sends correct params to STS", async () => {
            sendRequestStub.withArgs(SqlSymbolRenameRequest.type).resolves({
                changes: {},
                elementName: "col",
                newName: "newCol",
            });

            const tableUri = vscode.Uri.file(path.join(projectDir, "table.sql"));
            const doc = makeDocument(sandbox, {
                fsPath: tableUri.fsPath,
                uriString: tableUri.toString(),
                wordText: "col",
            });

            await provider
                .provideRenameEdits(doc, new vscode.Position(3, 10), "newCol", token)
                .catch(() => {});

            expect(sendRequestStub).to.have.been.calledWith(
                SqlSymbolRenameRequest.type,
                sinon.match({
                    textDocument: { uri: tableUri.toString() },
                    position: { line: 3, character: 10 },
                    newName: "newCol",
                }),
            );
        });
    });
});
