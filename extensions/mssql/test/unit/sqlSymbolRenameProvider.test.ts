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

        setup(() => {
            // provideRenameEdits resolves the refactorlog target, which reads the .sqlproj via
            // openTextDocument and stats the .refactorlog. Stub both with defaults so these tests
            // stay hermetic and never touch the real filesystem. The refactorlog-specific
            // behavior is covered separately in the "refactorlog handling" suite.
            const sqlprojDoc = {
                getText: () => "<Project>\n</Project>",
            } as unknown as vscode.TextDocument;
            sandbox.stub(vscode.workspace, "openTextDocument").resolves(sqlprojDoc);
            sandbox
                .stub(vscode.workspace, "fs")
                .value({ stat: sandbox.stub().rejects(vscode.FileSystemError.FileNotFound()) });
        });

        test("throws renameOnlyInProjectFiles when STS returns no result", async () => {
            const projUri = vscode.Uri.file(defaultProjFile);
            findFilesStub.resolves([projUri]);
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

        test("wraps sendRequest rejection with renameRequestFailed message", async () => {
            const projUri = vscode.Uri.file(defaultProjFile);
            findFilesStub.resolves([projUri]);
            const originalError = new Error("STS connection failed");
            sendRequestStub.withArgs(SqlSymbolRenameRequest.type).rejects(originalError);

            const doc = makeDocument(sandbox);
            let err: Error | undefined;
            try {
                await provider.provideRenameEdits(doc, new vscode.Position(0, 0), "NewName", token);
            } catch (e) {
                err = e as Error;
            }

            expect(err).to.not.be.undefined;
            expect(err!.message).to.equal(loc.renameRequestFailed("STS connection failed"));
        });

        test("falls back to single-file rename when STS returns empty changes", async () => {
            const projUri = vscode.Uri.file(defaultProjFile);
            findFilesStub.resolves([projUri]);
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
            const projUri = vscode.Uri.file(defaultProjFile);
            findFilesStub.resolves([projUri]);
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
            const projUri = vscode.Uri.file(defaultProjFile);
            findFilesStub.resolves([projUri]);
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

    // -------------------------------------------------------------------------
    suite("refactorlog handling", () => {
        const token = {} as vscode.CancellationToken;
        let createFileSpy: sinon.SinonSpy;
        let replaceSpy: sinon.SinonSpy;
        let openTextDocumentStub: sinon.SinonStub;

        // Builds a fake TextDocument whose getText/lineAt/lineCount reflect `content`.
        function makeTextDoc(content: string): vscode.TextDocument {
            const lines = content.split("\n");
            return {
                getText: (_r?: vscode.Range) => content,
                lineCount: lines.length,
                lineAt: (i: number) => ({
                    range: new vscode.Range(
                        new vscode.Position(i, 0),
                        new vscode.Position(i, lines[i].length),
                    ),
                }),
            } as unknown as vscode.TextDocument;
        }

        // A rename response that carries the STS-generated refactorlog content plus a non-empty
        // change set (so the early single-file path is not taken).
        const generatedRefactorLog = [
            '<?xml version="1.0" encoding="utf-8"?>',
            '<Operations Version="1.0" xmlns="http://schemas.microsoft.com/sqlserver/dac/Serialization/2012/02">',
            '  <Operation Name="Rename Refactor" Key="abc" ChangeDateTime="01/01/2026 00:00:00">',
            '    <Property Name="ElementName" Value="[dbo].[MyTable]" />',
            '    <Property Name="ElementType" Value="SqlTable" />',
            '    <Property Name="NewName" Value="NewTable" />',
            "  </Operation>",
            "</Operations>",
        ].join("\n");

        function refactorResponse() {
            return {
                changes: {
                    [vscode.Uri.file(defaultSqlFile).toString()]: [
                        {
                            range: {
                                start: { line: 0, character: 0 },
                                end: { line: 0, character: 7 },
                            },
                            newText: "NewTable",
                        },
                    ],
                },
                refactorLogContent: generatedRefactorLog,
                newName: "NewTable",
            };
        }

        setup(() => {
            createFileSpy = sandbox.spy(vscode.WorkspaceEdit.prototype, "createFile");
            replaceSpy = sandbox.spy(vscode.WorkspaceEdit.prototype, "replace");
            openTextDocumentStub = sandbox.stub(vscode.workspace, "openTextDocument");
            // The .sqlproj that owns the renamed file.
            findFilesStub.resolves([vscode.Uri.file(defaultProjFile)]);
        });

        test("creates a new .refactorlog and registers it when none exists", async () => {
            const sqlprojContent = ["<Project>", "  <ItemGroup />", "</Project>"].join("\n");
            openTextDocumentStub.callsFake((_uri: vscode.Uri) =>
                Promise.resolve(makeTextDoc(sqlprojContent)),
            );
            // No refactorlog file exists yet — stat rejects.
            sandbox
                .stub(vscode.workspace, "fs")
                .value({ stat: sandbox.stub().rejects(vscode.FileSystemError.FileNotFound()) });
            sendRequestStub.withArgs(SqlSymbolRenameRequest.type).resolves(refactorResponse());

            const doc = makeDocument(sandbox);
            await provider.provideRenameEdits(doc, new vscode.Position(0, 0), "NewTable", token);

            // A new .refactorlog file was created with the STS-generated content.
            expect(createFileSpy).to.have.been.called;
            const createCall = createFileSpy
                .getCalls()
                .find((c) => (c.args[0] as vscode.Uri).fsPath.endsWith(".refactorlog"));
            expect(createCall, "expected a createFile on the .refactorlog").to.not.be.undefined;
            const [createdUri, createOpts] = createCall!.args as [vscode.Uri, { contents: Buffer }];
            expect(createdUri.fsPath).to.equal(
                vscode.Uri.file(path.resolve(projectDir, "proj.refactorlog")).fsPath,
            );
            const created = createOpts.contents.toString("utf8");
            expect(created).to.equal(generatedRefactorLog);

            // The .sqlproj was updated with a <RefactorLog Include="..."> entry.
            const sqlprojReplace = replaceSpy
                .getCalls()
                .find((c) => (c.args[0] as vscode.Uri).fsPath.endsWith(".sqlproj"));
            expect(sqlprojReplace, "expected a replace on the .sqlproj").to.not.be.undefined;
            expect(sqlprojReplace!.args[2] as string).to.contain(
                '<RefactorLog Include="proj.refactorlog" />',
            );
        });

        test("passes existing refactorlog content to STS and writes the returned content", async () => {
            const sqlprojContent = [
                "<Project>",
                '  <ItemGroup><RefactorLog Include="proj.refactorlog" /></ItemGroup>',
                "</Project>",
            ].join("\n");
            const existingLog = [
                '<?xml version="1.0" encoding="utf-8"?>',
                '<Operations Version="1.0" xmlns="http://schemas.microsoft.com/sqlserver/dac/Serialization/2012/02">',
                "</Operations>",
            ].join("\n");
            openTextDocumentStub.callsFake((_uri: vscode.Uri) =>
                Promise.resolve(
                    makeTextDoc(_uri.fsPath.endsWith(".sqlproj") ? sqlprojContent : existingLog),
                ),
            );
            // The registered .refactorlog already exists on disk — replace the whole fs object
            // since vscode.workspace.fs.stat is non-configurable and cannot be stubbed directly.
            sandbox
                .stub(vscode.workspace, "fs")
                .value({ stat: sandbox.stub().resolves({} as vscode.FileStat) });
            sendRequestStub.withArgs(SqlSymbolRenameRequest.type).resolves(refactorResponse());

            const doc = makeDocument(sandbox);
            await provider.provideRenameEdits(doc, new vscode.Position(0, 0), "NewTable", token);

            // The current refactorlog content is forwarded to STS so it can append the new operation.
            expect(sendRequestStub).to.have.been.calledWith(
                SqlSymbolRenameRequest.type,
                sinon.match({ existingRefactorLogContent: existingLog }),
            );

            // No new file created — the existing one is overwritten with the STS content.
            expect(createFileSpy).to.not.have.been.called;

            const logReplace = replaceSpy
                .getCalls()
                .find((c) => (c.args[0] as vscode.Uri).fsPath.endsWith(".refactorlog"));
            expect(logReplace, "expected a replace on the .refactorlog").to.not.be.undefined;
            expect(logReplace!.args[2] as string).to.equal(generatedRefactorLog);

            // Already registered — the .sqlproj must not be modified again.
            const sqlprojReplace = replaceSpy
                .getCalls()
                .find((c) => (c.args[0] as vscode.Uri).fsPath.endsWith(".sqlproj"));
            expect(sqlprojReplace).to.be.undefined;
        });

        test("does not write a refactorlog when refactorLogContent is missing", async () => {
            const sqlprojContent = ["<Project>", "</Project>"].join("\n");
            openTextDocumentStub.callsFake((_uri: vscode.Uri) =>
                Promise.resolve(makeTextDoc(sqlprojContent)),
            );
            sandbox
                .stub(vscode.workspace, "fs")
                .value({ stat: sandbox.stub().rejects(vscode.FileSystemError.FileNotFound()) });
            // Non-data object (e.g. stored procedure) — STS returns no refactorlog content.
            sendRequestStub.withArgs(SqlSymbolRenameRequest.type).resolves({
                ...refactorResponse(),
                refactorLogContent: null,
            });

            const doc = makeDocument(sandbox);
            const edit = await provider.provideRenameEdits(
                doc,
                new vscode.Position(0, 0),
                "NewTable",
                token,
            );

            expect(edit).to.be.instanceOf(vscode.WorkspaceEdit);
            expect(createFileSpy).to.not.have.been.called;
            // No replace targeting a refactorlog or sqlproj should have happened.
            const refactorReplace = replaceSpy
                .getCalls()
                .find(
                    (c) =>
                        (c.args[0] as vscode.Uri).fsPath.endsWith(".refactorlog") ||
                        (c.args[0] as vscode.Uri).fsPath.endsWith(".sqlproj"),
                );
            expect(refactorReplace).to.be.undefined;
        });
    });
});
