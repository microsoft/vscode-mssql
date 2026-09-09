/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import { RecentSqlFilesStore } from "../../src/models/recentSqlFilesStore";

const { expect } = chai;
chai.use(sinonChai);

suite("Recent SQL Files Store", () => {
    let sandbox: sinon.SinonSandbox;
    let store: RecentSqlFilesStore;
    let globalStateValues: Record<string, unknown>;
    /** Paths the stubbed filesystem reports as existing, with their modified time. */
    let existingFiles: Map<string, number>;

    function createDocument(fsPath: string, languageId = "sql", scheme = "file") {
        return {
            languageId,
            uri: { scheme, fsPath },
        } as unknown as vscode.TextDocument;
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        globalStateValues = {};
        existingFiles = new Map();

        sandbox.stub(vscode.workspace, "fs").value({
            stat: sandbox.stub().callsFake((uri: vscode.Uri) => {
                if (!existingFiles.has(uri.fsPath)) {
                    return Promise.reject(new Error("ENOENT"));
                }
                return Promise.resolve({ mtime: existingFiles.get(uri.fsPath) });
            }),
        });

        store = new RecentSqlFilesStore({
            globalState: {
                get: (key: string, fallback?: unknown) =>
                    key in globalStateValues ? globalStateValues[key] : fallback,
                update: (key: string, value: unknown) => {
                    globalStateValues[key] = value;
                    return Promise.resolve();
                },
            },
        } as unknown as vscode.ExtensionContext);
    });

    teardown(() => {
        store.dispose();
        sandbox.restore();
    });

    test("records opened SQL files most recent first", async () => {
        existingFiles.set("/work/a.sql", 1);
        existingFiles.set("/work/b.sql", 1);

        await store.recordOpen(createDocument("/work/a.sql"));
        await store.recordOpen(createDocument("/work/b.sql"));

        const files = await store.getRecentFiles(5);
        expect(files.map((file) => file.fsPath)).to.deep.equal(["/work/b.sql", "/work/a.sql"]);
    });

    test("moves a reopened file back to the front without duplicating it", async () => {
        existingFiles.set("/work/a.sql", 1);
        existingFiles.set("/work/b.sql", 1);

        await store.recordOpen(createDocument("/work/a.sql"));
        await store.recordOpen(createDocument("/work/b.sql"));
        await store.recordOpen(createDocument("/work/a.sql"));

        const files = await store.getRecentFiles(5);
        expect(files.map((file) => file.fsPath)).to.deep.equal(["/work/a.sql", "/work/b.sql"]);
    });

    test("ignores documents that are not SQL files on disk", async () => {
        existingFiles.set("/work/notes.md", 1);
        existingFiles.set("/work/untitled.sql", 1);

        await store.recordOpen(createDocument("/work/notes.md", "markdown"));
        await store.recordOpen(createDocument("/work/untitled.sql", "sql", "untitled"));

        // No workspace is open, so nothing tops up the empty list.
        sandbox.stub(vscode.workspace, "workspaceFolders").value(undefined);
        expect(await store.getRecentFiles(5)).to.be.empty;
    });

    test("drops tracked files that no longer exist", async () => {
        existingFiles.set("/work/a.sql", 1);
        existingFiles.set("/work/gone.sql", 1);

        await store.recordOpen(createDocument("/work/a.sql"));
        await store.recordOpen(createDocument("/work/gone.sql"));
        existingFiles.delete("/work/gone.sql");

        sandbox.stub(vscode.workspace, "workspaceFolders").value(undefined);
        const files = await store.getRecentFiles(5);
        expect(files.map((file) => file.fsPath)).to.deep.equal(["/work/a.sql"]);
    });

    test("tops up a short list from the workspace, newest modified first", async () => {
        existingFiles.set("/work/opened.sql", 10);
        existingFiles.set("/work/old.sql", 1);
        existingFiles.set("/work/new.sql", 5);

        await store.recordOpen(createDocument("/work/opened.sql"));

        sandbox
            .stub(vscode.workspace, "workspaceFolders")
            .value([{ uri: vscode.Uri.file("/work") }]);
        sandbox
            .stub(vscode.workspace, "findFiles")
            .resolves([
                vscode.Uri.file("/work/old.sql"),
                vscode.Uri.file("/work/new.sql"),
                vscode.Uri.file("/work/opened.sql"),
            ]);

        const files = await store.getRecentFiles(5);
        // The opened file leads and is not repeated by the scan; the rest sort by modified time.
        expect(files.map((file) => file.fsPath)).to.deep.equal([
            "/work/opened.sql",
            "/work/new.sql",
            "/work/old.sql",
        ]);
    });

    test("does not scan the workspace once enough files are tracked", async () => {
        for (const name of ["a", "b", "c"]) {
            existingFiles.set(`/work/${name}.sql`, 1);
            await store.recordOpen(createDocument(`/work/${name}.sql`));
        }
        const findFilesStub = sandbox.stub(vscode.workspace, "findFiles").resolves([]);

        const files = await store.getRecentFiles(3);

        expect(files).to.have.lengthOf(3);
        expect(findFilesStub).to.not.have.been.called;
    });
});
