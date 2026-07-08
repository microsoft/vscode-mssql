/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import * as vscode from "vscode";
import { expect } from "chai";
import {
    cleanupQueryStudioScratchFile,
    createQueryStudioScratchFile,
    openQueryStudioScratchDocument,
    queryStudioScratchFileName,
    queryStudioScratchMetadataUri,
    queryStudioScratchTitle,
    shouldDeleteScratchFile,
} from "../../src/queryStudio/queryStudioScratchFiles";
import { textHash } from "../../src/queryStudio/textSync";

suite("Query Studio scratch files", () => {
    test("builds a safe sql filename from the first statement line", () => {
        const sql = "\r\n  SELECT TOP (100) * FROM [dbo].[perfblobs];\r\n";
        const title = queryStudioScratchTitle(sql);
        expect(title).to.equal("SELECT TOP (100) _ FROM [dbo].[perfblobs];");

        const fileName = queryStudioScratchFileName(sql, new Date("2026-07-08T12:34:56.000Z"), 35);
        expect(fileName).to.equal(
            "SELECT TOP (100) _ FROM [dbo].[perfblobs];-20260708T123456Z-z.sql",
        );
        expect(/[<>:"/\\|?*\x00-\x1f]/.test(fileName)).to.equal(false);
    });

    test("cleanup decision only deletes unchanged baselines", () => {
        const baselineHash = textHash("SELECT 100;\n");
        expect(shouldDeleteScratchFile("SELECT 100;\n", baselineHash)).to.equal(true);
        expect(shouldDeleteScratchFile("SELECT 101;\n", baselineHash)).to.equal(false);
    });

    test("opens generated SQL from a clean real .sql backing document", async () => {
        const root = testScratchRoot("clean-doc");
        const sql = "SELECT TOP 100 *\nFROM [dbo].[perfblobs];\n";
        try {
            const doc = await openQueryStudioScratchDocument(root, sql, "unit");
            expect(doc.uri.scheme).to.equal("file");
            expect(doc.uri.fsPath.endsWith(".sql")).to.equal(true);
            expect(doc.languageId).to.equal("sql");
            expect(doc.getText()).to.equal(sql);
            expect(doc.isDirty).to.equal(false);
        } finally {
            await deleteTree(root);
        }
    });

    test("cleans up unchanged scratch files but keeps saved edits", async () => {
        const root = testScratchRoot("cleanup");
        const sql = "SELECT 100;\n";
        try {
            const uri = await createQueryStudioScratchFile(root, sql, "unit");
            expect(await cleanupQueryStudioScratchFile(uri, root)).to.equal("deleted");
            await expectMissing(uri);
            await expectMissing(queryStudioScratchMetadataUri(uri));

            const editedUri = await createQueryStudioScratchFile(root, sql, "unit");
            await vscode.workspace.fs.writeFile(editedUri, Buffer.from("SELECT 101;\n", "utf8"));
            expect(await cleanupQueryStudioScratchFile(editedUri, root)).to.equal("kept");
            await vscode.workspace.fs.stat(editedUri);
            await vscode.workspace.fs.stat(queryStudioScratchMetadataUri(editedUri));
        } finally {
            await deleteTree(root);
        }
    });
});

function testScratchRoot(name: string): vscode.Uri {
    return vscode.Uri.file(
        path.join(process.cwd(), ".test-query-studio-scratch", `${name}-${Date.now()}`),
    );
}

async function deleteTree(uri: vscode.Uri): Promise<void> {
    try {
        await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
    } catch {
        // Tests may delete individual files first.
    }
}

async function expectMissing(uri: vscode.Uri): Promise<void> {
    try {
        await vscode.workspace.fs.stat(uri);
    } catch {
        return;
    }
    throw new Error(`expected missing file: ${uri.fsPath}`);
}
