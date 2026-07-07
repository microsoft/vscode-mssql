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
import { SqlMoveToSchemaProvider } from "../../src/languageservice/sqlMoveToSchemaProvider";
import SqlToolsServerClient from "../../src/languageservice/serviceclient";
import {
    ListProjectSchemasRequest,
    SqlMoveToSchemaRequest,
    SqlSymbolRenameRequest,
} from "../../src/models/contracts/languageService";
import {
    SqlSymbolRename as loc,
    SqlMoveToSchema as moveLoc,
} from "../../src/constants/locConstants";
import { stubMessageBoxes } from "./utils";

chai.use(sinonChai);

// Cross-platform path helpers — always derived from vscode.Uri so separators match the OS.
const projectDir = path.dirname(
    vscode.Uri.file(path.join(path.sep, "project", "proj.sqlproj")).fsPath,
);
const defaultSqlFile = path.join(projectDir, "file.sql");
const defaultProjFile = path.join(projectDir, "proj.sqlproj");

// ---------------------------------------------------------------------------
// Helpers shared across rename and move-to-schema suites
// ---------------------------------------------------------------------------

/** Builds a line-based stubbed TextDocument used by SqlMoveToSchemaProvider tests. */
function makeMoveDocument(
    sandbox: sinon.SinonSandbox,
    opts: { fsPath?: string; lineText?: string } = {},
): vscode.TextDocument {
    const fsPath = opts.fsPath ?? defaultSqlFile;
    const lineText = opts.lineText ?? "CREATE TABLE [dbo].[MyTable]";
    const uri = vscode.Uri.file(fsPath);
    const uriString = uri.toString();
    return {
        uri: Object.assign(uri, { toString: () => uriString }),
        lineAt: sandbox.stub().callsFake((lineOrPos: number | vscode.Position) => {
            const lineNum =
                typeof lineOrPos === "number" ? lineOrPos : (lineOrPos as vscode.Position).line;
            return {
                text: lineNum === 0 ? lineText : "",
                range: new vscode.Range(
                    new vscode.Position(lineNum, 0),
                    new vscode.Position(lineNum, (lineNum === 0 ? lineText : "").length),
                ),
            };
        }),
        getText: sandbox.stub().callsFake((range?: vscode.Range) => {
            if (!range) return lineText;
            return lineText.slice(range.start.character, range.end.character);
        }),
    } as unknown as vscode.TextDocument;
}

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

        test("returns empty WorkspaceEdit when STS returns warning message and user cancels", async () => {
            const projUri = vscode.Uri.file(defaultProjFile);
            findFilesStub.resolves([projUri]);
            const fileUri = vscode.Uri.file(defaultSqlFile).toString();
            sendRequestStub.withArgs(SqlSymbolRenameRequest.type).resolves({
                changes: {
                    [fileUri]: [
                        {
                            range: {
                                start: { line: 0, character: 0 },
                                end: { line: 0, character: 7 },
                            },
                            newText: "Orders",
                        },
                    ],
                },
                newName: "Orders",
                message:
                    "A schema object with the name [Orders] already exists. Would you like to continue?",
                isWarning: true,
            });
            sandbox.stub(vscode.window, "showWarningMessage").resolves(undefined); // user dismissed/cancelled

            const doc = makeDocument(sandbox);
            const edit = await provider.provideRenameEdits(
                doc,
                new vscode.Position(0, 0),
                "Orders",
                token,
            );

            expect(edit).to.be.instanceOf(vscode.WorkspaceEdit);
            expect(edit!.entries()).to.have.length(0); // empty — no changes applied
        });

        test("applies edits when STS returns warning message and user confirms", async () => {
            const projUri = vscode.Uri.file(defaultProjFile);
            findFilesStub.resolves([projUri]);
            const fileUri = vscode.Uri.file(defaultSqlFile).toString();
            sendRequestStub.withArgs(SqlSymbolRenameRequest.type).resolves({
                changes: {
                    [fileUri]: [
                        {
                            range: {
                                start: { line: 0, character: 0 },
                                end: { line: 0, character: 7 },
                            },
                            newText: "Orders",
                        },
                    ],
                },
                newName: "Orders",
                message:
                    "A schema object with the name [Orders] already exists. Would you like to continue?",
                isWarning: true,
            });
            sandbox
                .stub(vscode.window, "showWarningMessage")
                .resolves("Yes" as vscode.MessageItem & string);

            const doc = makeDocument(sandbox);
            const edit = await provider.provideRenameEdits(
                doc,
                new vscode.Position(0, 0),
                "Orders",
                token,
            );

            expect(edit).to.be.instanceOf(vscode.WorkspaceEdit);
            expect(edit!.entries()).to.have.length(1); // edits applied
            expect(edit!.entries()[0][0].toString()).to.equal(fileUri);
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
                refactorLogContent: undefined,
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

// ===========================================================================
// SqlMoveToSchemaProvider
// ===========================================================================

suite("SqlMoveToSchemaProvider Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let provider: SqlMoveToSchemaProvider;
    let findFilesStub: sinon.SinonStub;
    let sendRequestStub: sinon.SinonStub;
    let messageBoxes: ReturnType<typeof stubMessageBoxes>;
    let showQuickPickStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        messageBoxes = stubMessageBoxes(sandbox);
        showQuickPickStub = sandbox.stub(vscode.window, "showQuickPick");
        provider = new SqlMoveToSchemaProvider();
        findFilesStub = sandbox.stub(vscode.workspace, "findFiles").resolves([]);
        sendRequestStub = sandbox
            .stub(SqlToolsServerClient.instance, "sendRequest")
            .resolves(undefined);
    });

    teardown(() => {
        sandbox.restore();
    });

    // -------------------------------------------------------------------------
    suite("provideCodeActions", () => {
        test("returns empty array when file is not in any SQL project", async () => {
            const doc = makeMoveDocument(sandbox);
            const actions = await provider.provideCodeActions(
                doc,
                new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
            );
            expect(actions).to.deep.equal([]);
        });

        test("returns Move to Schema action when in project and cursor is on an identifier", async () => {
            findFilesStub.resolves([vscode.Uri.file(defaultProjFile)]);
            const doc = makeMoveDocument(sandbox, { lineText: "SELECT [MyTable]" });
            const actions = await provider.provideCodeActions(
                doc,
                new vscode.Range(new vscode.Position(0, 8), new vscode.Position(0, 8)),
            );
            expect(actions).to.have.length(1);
            expect(actions[0].title).to.equal(moveLoc.moveToSchemaTitle);
            expect(actions[0].kind).to.deep.equal(vscode.CodeActionKind.Refactor);
        });
    });

    // -------------------------------------------------------------------------
    suite("runMoveToSchema", () => {
        test("shows message when file is not in a SQL project", async () => {
            const doc = makeMoveDocument(sandbox);
            await provider.runMoveToSchema(doc, new vscode.Position(0, 0));
            expect(messageBoxes.showInformationMessage).to.have.been.calledWith(
                moveLoc.moveToSchemaOnlyInProjectFiles,
            );
        });

        test("shows message when the project has no schemas", async () => {
            findFilesStub.resolves([vscode.Uri.file(defaultProjFile)]);
            sendRequestStub.withArgs(ListProjectSchemasRequest.type).resolves({ schemas: [] });
            const doc = makeMoveDocument(sandbox, { lineText: "SELECT MyTable" });
            await provider.runMoveToSchema(doc, new vscode.Position(0, 7));
            expect(messageBoxes.showInformationMessage).to.have.been.calledWith(
                moveLoc.noSchemasFound,
            );
        });

        test("shows error when ListProjectSchemasRequest throws", async () => {
            findFilesStub.resolves([vscode.Uri.file(defaultProjFile)]);
            sendRequestStub
                .withArgs(ListProjectSchemasRequest.type)
                .rejects(new Error("STS error"));
            const doc = makeMoveDocument(sandbox, { lineText: "SELECT MyTable" });
            await provider.runMoveToSchema(doc, new vscode.Position(0, 7));
            expect(messageBoxes.showErrorMessage).to.have.been.calledWith(
                moveLoc.moveToSchemaRequestFailed("STS error"),
            );
        });

        test("returns early without sending move request when user cancels QuickPick", async () => {
            findFilesStub.resolves([vscode.Uri.file(defaultProjFile)]);
            sendRequestStub
                .withArgs(ListProjectSchemasRequest.type)
                .resolves({ schemas: ["dbo", "hr"] });
            showQuickPickStub.resolves(undefined);
            const doc = makeMoveDocument(sandbox, { lineText: "SELECT MyTable" });
            await provider.runMoveToSchema(doc, new vscode.Position(0, 7));
            expect(sendRequestStub).to.not.have.been.calledWith(
                SqlMoveToSchemaRequest.type,
                sinon.match.any,
            );
        });

        // -------------------------------------------------------------------
        suite("applyMove", () => {
            let openTextDocumentStub: sinon.SinonStub;
            let applyEditStub: sinon.SinonStub;

            const sampleRefactorLog = [
                '<?xml version="1.0" encoding="utf-8"?>',
                '<Operations Version="1.0" xmlns="http://schemas.microsoft.com/sqlserver/dac/Serialization/2012/02">',
                "</Operations>",
            ].join("\n");

            setup(() => {
                findFilesStub.resolves([vscode.Uri.file(defaultProjFile)]);
                showQuickPickStub.resolves({ label: "hr" });
                openTextDocumentStub = sandbox.stub(vscode.workspace, "openTextDocument");
                openTextDocumentStub.callsFake((_uri: vscode.Uri) => {
                    const content = "<Project>\n</Project>";
                    const lines = content.split("\n");
                    return Promise.resolve({
                        uri: _uri,
                        getText: () => content,
                        lineCount: lines.length,
                        lineAt: (i: number) => ({
                            range: new vscode.Range(
                                new vscode.Position(i, 0),
                                new vscode.Position(i, lines[i].length),
                            ),
                        }),
                    } as unknown as vscode.TextDocument);
                });
                sandbox.stub(vscode.workspace, "fs").value({
                    stat: sandbox.stub().rejects(vscode.FileSystemError.FileNotFound()),
                    writeFile: sandbox.stub().resolves(),
                    delete: sandbox.stub().resolves(),
                });
                applyEditStub = sandbox.stub(vscode.workspace, "applyEdit").resolves(true);
            });

            test("shows error when SqlMoveToSchemaRequest throws", async () => {
                sendRequestStub
                    .withArgs(ListProjectSchemasRequest.type)
                    .resolves({ schemas: ["hr"] });
                sendRequestStub
                    .withArgs(SqlMoveToSchemaRequest.type)
                    .rejects(new Error("STS move failed"));
                const doc = makeMoveDocument(sandbox, { lineText: "SELECT MyTable" });
                await provider.runMoveToSchema(doc, new vscode.Position(0, 7));
                expect(messageBoxes.showErrorMessage).to.have.been.calledWith(
                    moveLoc.moveToSchemaRequestFailed("STS move failed"),
                );
            });

            test("calls applyEdit with isRefactoring flag on a successful move", async () => {
                const fileUri = vscode.Uri.file(defaultSqlFile).toString();
                sendRequestStub
                    .withArgs(ListProjectSchemasRequest.type)
                    .resolves({ schemas: ["hr"] });
                sendRequestStub.withArgs(SqlMoveToSchemaRequest.type).resolves({
                    changes: {
                        [fileUri]: [
                            {
                                range: {
                                    start: { line: 0, character: 7 },
                                    end: { line: 0, character: 14 },
                                },
                                newText: "[hr].[MyTable]",
                            },
                        ],
                    },
                    refactorLogContent: sampleRefactorLog,
                });
                const doc = makeMoveDocument(sandbox, { lineText: "SELECT MyTable" });
                await provider.runMoveToSchema(doc, new vscode.Position(0, 7));
                expect(applyEditStub).to.have.been.calledWith(
                    sinon.match.instanceOf(vscode.WorkspaceEdit),
                    sinon.match({ isRefactoring: true }),
                );
            });

            test("shows error message when applyEdit returns false", async () => {
                applyEditStub.resolves(false);
                const fileUri = vscode.Uri.file(defaultSqlFile).toString();
                sendRequestStub
                    .withArgs(ListProjectSchemasRequest.type)
                    .resolves({ schemas: ["hr"] });
                sendRequestStub.withArgs(SqlMoveToSchemaRequest.type).resolves({
                    changes: {
                        [fileUri]: [
                            {
                                range: {
                                    start: { line: 0, character: 7 },
                                    end: { line: 0, character: 14 },
                                },
                                newText: "[hr].[MyTable]",
                            },
                        ],
                    },
                    refactorLogContent: undefined,
                });
                const doc = makeMoveDocument(sandbox, { lineText: "SELECT MyTable" });
                await provider.runMoveToSchema(doc, new vscode.Position(0, 7));
                expect(messageBoxes.showErrorMessage).to.have.been.calledWith(
                    moveLoc.applyEditFailed,
                );
            });

            test("does not call applyEdit when warning message is returned and user dismisses", async () => {
                const fileUri = vscode.Uri.file(defaultSqlFile).toString();
                sendRequestStub
                    .withArgs(ListProjectSchemasRequest.type)
                    .resolves({ schemas: ["hr"] });
                sendRequestStub.withArgs(SqlMoveToSchemaRequest.type).resolves({
                    changes: {
                        [fileUri]: [
                            {
                                range: {
                                    start: { line: 0, character: 7 },
                                    end: { line: 0, character: 14 },
                                },
                                newText: "[hr].[MyTable]",
                            },
                        ],
                    },
                    message:
                        "A schema object with the name [hr].[MyTable] already exists. Would you like to continue?",
                    isWarning: true,
                });
                messageBoxes.showWarningMessage.resolves(undefined); // user dismissed

                const doc = makeMoveDocument(sandbox, { lineText: "SELECT MyTable" });
                await provider.runMoveToSchema(doc, new vscode.Position(0, 7));

                expect(applyEditStub).to.not.have.been.called;
            });

            test("calls applyEdit when warning message is returned and user confirms Yes", async () => {
                const fileUri = vscode.Uri.file(defaultSqlFile).toString();
                sendRequestStub
                    .withArgs(ListProjectSchemasRequest.type)
                    .resolves({ schemas: ["hr"] });
                sendRequestStub.withArgs(SqlMoveToSchemaRequest.type).resolves({
                    changes: {
                        [fileUri]: [
                            {
                                range: {
                                    start: { line: 0, character: 7 },
                                    end: { line: 0, character: 14 },
                                },
                                newText: "[hr].[MyTable]",
                            },
                        ],
                    },
                    message:
                        "A schema object with the name [hr].[MyTable] already exists. Would you like to continue?",
                    isWarning: true,
                });
                messageBoxes.showWarningMessage.resolves("Yes" as vscode.MessageItem & string);

                const doc = makeMoveDocument(sandbox, { lineText: "SELECT MyTable" });
                await provider.runMoveToSchema(doc, new vscode.Position(0, 7));

                expect(applyEditStub).to.have.been.calledWith(
                    sinon.match.instanceOf(vscode.WorkspaceEdit),
                    sinon.match({ isRefactoring: true }),
                );
            });
        });
    });
});
