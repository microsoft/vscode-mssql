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
    /**
     * When set, persistence settles on a later turn of the event loop instead of immediately,
     * which is what lets an unserialized read/modify/write lose an entry.
     */
    let deferUpdates: boolean;

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
        deferUpdates = false;

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
                    if (!deferUpdates) {
                        globalStateValues[key] = value;
                        return Promise.resolve();
                    }
                    return new Promise<void>((resolve) =>
                        setTimeout(() => {
                            globalStateValues[key] = value;
                            resolve();
                        }, 0),
                    );
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

    test("keeps every entry when several files are opened at once", async () => {
        // Restoring an editor layout opens several SQL files in the same tick. Each record reads
        // the whole list and writes it back, so without serialization the last write would drop
        // the others' entries.
        deferUpdates = true;

        await Promise.all([
            store.recordOpen(createDocument("/work/a.sql")),
            store.recordOpen(createDocument("/work/b.sql")),
            store.recordOpen(createDocument("/work/c.sql")),
        ]);

        const entries = globalStateValues["overview/recentSqlFiles"] as { fsPath: string }[];
        expect(entries.map((entry) => entry.fsPath)).to.have.members([
            "/work/a.sql",
            "/work/b.sql",
            "/work/c.sql",
        ]);
    });

    test("records the SQL file already open when registration happens", async () => {
        // onDidChangeActiveTextEditor does not replay, and opening a SQL file is what activates
        // the extension, so without this the file that caused activation is the one missing.
        sandbox
            .stub(vscode.window, "activeTextEditor")
            .value({ document: createDocument("/work/already-open.sql") });
        const openEvent = new vscode.EventEmitter<vscode.TextEditor | undefined>();
        sandbox.stub(vscode.window, "onDidChangeActiveTextEditor").value(openEvent.event);

        try {
            store.register();
            // register() starts the write without awaiting it.
            await new Promise((resolve) => setTimeout(resolve, 0));

            existingFiles.set("/work/already-open.sql", 1_000);
            const files = await store.getRecentFiles(5);
            expect(files.map((file) => file.fsPath)).to.include("/work/already-open.sql");
        } finally {
            openEvent.dispose();
            store.dispose();
        }
    });

    test("records the SQL file the user switches to", async () => {
        // Keyed off the editor rather than document opens, which other extensions trigger by
        // reading files in the background.
        sandbox.stub(vscode.window, "activeTextEditor").value(undefined);
        const activeEditorEvent = new vscode.EventEmitter<vscode.TextEditor | undefined>();
        sandbox.stub(vscode.window, "onDidChangeActiveTextEditor").value(activeEditorEvent.event);
        existingFiles.set("/work/switched-to.sql", 1_000);

        try {
            store.register();
            activeEditorEvent.fire({
                document: createDocument("/work/switched-to.sql"),
            } as unknown as vscode.TextEditor);
            activeEditorEvent.fire(undefined);
            await new Promise((resolve) => setTimeout(resolve, 0));

            const files = await store.getRecentFiles(5);
            expect(files[0]?.fsPath).to.equal("/work/switched-to.sql");
        } finally {
            activeEditorEvent.dispose();
        }
    });

    test("logs a background persistence failure instead of rejecting from registration", async () => {
        const failure = new Error("storage unavailable");
        sandbox
            .stub(vscode.window, "activeTextEditor")
            .value({ document: createDocument("/work/already-open.sql") });
        const openEvent = new vscode.EventEmitter<vscode.TextEditor | undefined>();
        sandbox.stub(vscode.window, "onDidChangeActiveTextEditor").value(openEvent.event);
        sandbox.stub(store, "recordOpen").rejects(failure);
        const logError = sandbox.stub(store["_logger"], "error");

        try {
            store.register();
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(logError).to.have.been.calledWith(
                "Failed to persist a recent SQL file",
                failure,
            );
        } finally {
            openEvent.dispose();
        }
    });

    test("does not record a non-SQL active editor at registration", async () => {
        sandbox
            .stub(vscode.window, "activeTextEditor")
            .value({ document: createDocument("/work/notes.md", "markdown") });
        const openEvent = new vscode.EventEmitter<vscode.TextEditor | undefined>();
        sandbox.stub(vscode.window, "onDidChangeActiveTextEditor").value(openEvent.event);

        try {
            store.register();
            await new Promise((resolve) => setTimeout(resolve, 0));

            existingFiles.set("/work/notes.md", 1_000);
            const files = await store.getRecentFiles(5);
            expect(files.map((file) => file.fsPath)).to.not.include("/work/notes.md");
        } finally {
            openEvent.dispose();
            store.dispose();
        }
    });

    test("announces a change once a newly opened file is recorded", async () => {
        const listener = sinon.stub();
        const subscription = store.onDidChange(listener);

        try {
            await store.recordOpen(createDocument("/work/opened.sql"));
            // Fired after persistence, so a listener that re-reads sees the new entry.
            expect(listener).to.have.been.calledOnce;

            await store.recordOpen(createDocument("/work/untitled.sql", "sql", "untitled"));
            // Skipped documents are not recorded, so there is nothing to announce.
            expect(listener).to.have.been.calledOnce;
        } finally {
            subscription.dispose();
        }
    });
});
