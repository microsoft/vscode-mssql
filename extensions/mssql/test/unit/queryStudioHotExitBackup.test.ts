/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";
import {
    persistQueryStudioHotExitBackup,
    queryStudioHotExitBackupUri,
    queryStudioHotExitBackupRoot,
    restoreQueryStudioHotExitBackup,
    registerQueryStudioHotExitCleanup,
} from "../../src/queryStudio/queryStudioHotExitBackup";
import { textHash } from "../../src/queryStudio/textSync";

suite("Query Studio hot-exit backup", () => {
    test("closing an untitled document removes its backup after pending writes", async () => {
        const sandbox = sinon.createSandbox();
        const root = testBackupRoot("discard");
        const document = await vscode.workspace.openTextDocument({
            content: "SELECT 'discarded';",
            language: "sql",
        });
        let closed!: (document: vscode.TextDocument) => unknown;
        sandbox.stub(vscode.workspace, "onDidCloseTextDocument").callsFake((listener) => {
            closed = listener;
            return { dispose() {} };
        });
        sandbox.stub(vscode.workspace, "textDocuments").get(() => []);
        const cleanup = registerQueryStudioHotExitCleanup(root);
        try {
            const pending = persistQueryStudioHotExitBackup(root, document);
            await closed(document);
            await pending;
            expect(await vscode.workspace.fs.readDirectory(root)).to.deep.equal([]);
        } finally {
            cleanup.dispose();
            sandbox.restore();
            await deleteTree(root);
        }
    });

    test("language changes and cleanup disposal keep the untitled hot-exit backup", async () => {
        const sandbox = sinon.createSandbox();
        const root = testBackupRoot("language-change");
        const document = await vscode.workspace.openTextDocument({
            content: "SELECT 'keep';",
            language: "sql",
        });
        let closed!: (document: vscode.TextDocument) => unknown;
        sandbox.stub(vscode.workspace, "onDidCloseTextDocument").callsFake((listener) => {
            closed = listener;
            return { dispose() {} };
        });
        sandbox.stub(vscode.workspace, "textDocuments").get(() => [document]);
        const cleanup = registerQueryStudioHotExitCleanup(root);
        try {
            await persistQueryStudioHotExitBackup(root, document);
            await closed(document);
            cleanup.dispose();
            const text = Buffer.from(
                await vscode.workspace.fs.readFile(queryStudioHotExitBackupUri(root, document.uri)),
            ).toString();
            expect(text).to.contain("SELECT 'keep';");
        } finally {
            sandbox.restore();
            await deleteTree(root);
        }
    });
    test("does not use shared global storage for windows without a workspace", () => {
        expect(queryStudioHotExitBackupRoot(undefined)).to.equal(undefined);
    });

    test("a new untitled query ignores and removes an old backup with the same URI", async () => {
        const root = testBackupRoot("fresh");
        const doc = await vscode.workspace.openTextDocument({ content: "" });
        const backupUri = queryStudioHotExitBackupUri(root, doc.uri);
        try {
            await vscode.workspace.fs.createDirectory(root);
            await vscode.workspace.fs.writeFile(
                backupUri,
                Buffer.from(
                    JSON.stringify({
                        version: 1,
                        uri: doc.uri.toString(),
                        languageId: "sql",
                        text: "SELECT 'old query';",
                    }),
                ),
            );
            const result = await restoreQueryStudioHotExitBackup(root, doc, true);
            expect(result.outcome).to.equal("notFound");
            expect(result.document.getText()).to.equal("");
            expect((await vscode.workspace.fs.readDirectory(root)).length).to.equal(0);
        } finally {
            await deleteTree(root);
        }
    });
    test("persists untitled Query Studio text outside the editor resource", async () => {
        const root = testBackupRoot("persist");
        const doc = await vscode.workspace.openTextDocument({
            language: "sql",
            content: "SELECT 100;\n",
        });
        try {
            await persistQueryStudioHotExitBackup(root, doc);
            const raw = Buffer.from(
                await vscode.workspace.fs.readFile(queryStudioHotExitBackupUri(root, doc.uri)),
            ).toString("utf8");
            const payload = JSON.parse(raw) as { uri: string; languageId: string; text: string };
            expect(payload.uri).to.equal(doc.uri.toString());
            expect(payload.languageId).to.equal("sql");
            expect(payload.text).to.equal("SELECT 100;\n");
        } finally {
            await deleteTree(root);
        }
    });

    test("rehydrates a blank restored untitled document", async () => {
        const root = testBackupRoot("restore");
        const doc = await vscode.workspace.openTextDocument({ content: "" });
        const text = "SELECT TOP 100 *\nFROM sys.objects;\n";
        try {
            await vscode.workspace.fs.createDirectory(root);
            await vscode.workspace.fs.writeFile(
                queryStudioHotExitBackupUri(root, doc.uri),
                Buffer.from(
                    JSON.stringify({
                        version: 1,
                        uri: doc.uri.toString(),
                        languageId: "sql",
                        text,
                        textHash: textHash(text),
                        updatedUtc: new Date().toISOString(),
                    }),
                    "utf8",
                ),
            );

            const restored = await restoreQueryStudioHotExitBackup(root, doc);
            expect(restored.outcome).to.equal("restored");
            expect(restored.document.languageId).to.equal("sql");
            expect(normalizeNewlines(restored.document.getText())).to.equal(text);
        } finally {
            await deleteTree(root);
        }
    });
});

function testBackupRoot(name: string): vscode.Uri {
    return vscode.Uri.file(
        path.join(process.cwd(), ".test-query-studio-hot-exit", `${name}-${Date.now()}`),
    );
}

async function deleteTree(uri: vscode.Uri): Promise<void> {
    try {
        await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
    } catch {
        // Tests may delete individual files first.
    }
}

function normalizeNewlines(text: string): string {
    return text.replace(/\r\n/g, "\n");
}
