/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as sinon from "sinon";
import * as vscode from "vscode";
import {
    discoverLocalSqlTests,
    verifyLocalDacpacArtifact,
} from "../../src/runbookStudio/runtime/localDeveloperOperations";
import { LocalActivityError } from "../../src/runbookStudio/runtime/localSqlDelegate";

suite("Runbook Studio local repository SQL test discovery", () => {
    let sandbox: sinon.SinonSandbox;
    let testRoot: string;

    setup(() => {
        sandbox = sinon.createSandbox();
        testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rbs-sql-discovery-"));
    });

    teardown(() => {
        sandbox.restore();
        if (path.basename(testRoot).startsWith("rbs-sql-discovery-")) {
            fs.rmSync(testRoot, { recursive: true, force: true });
        }
    });

    test("reads bounded workspace sources and returns repository-relative tests", async () => {
        const testsDirectory = path.join(testRoot, "tests");
        fs.mkdirSync(testsDirectory);
        const classesPath = path.join(testsDirectory, "classes.sql");
        const testsPath = path.join(testsDirectory, "OrderTests.sql");
        const oversizedPath = path.join(testsDirectory, "oversized.sql");
        const unreadablePath = path.join(testsDirectory, "unreadable.sql");
        fs.writeFileSync(classesPath, "EXEC tSQLt.NewTestClass N'OrderTests';", "utf8");
        fs.writeFileSync(testsPath, "CREATE PROC [OrderTests].[test total] AS SELECT 1;", "utf8");
        fs.writeFileSync(oversizedPath, Buffer.alloc(600_000, 32));
        const root = vscode.Uri.file(testRoot);
        const classes = vscode.Uri.file(classesPath);
        const tests = vscode.Uri.file(testsPath);
        const oversized = vscode.Uri.file(oversizedPath);
        const unreadable = vscode.Uri.file(unreadablePath);
        sandbox
            .stub(vscode.workspace, "workspaceFolders")
            .value([{ uri: root, name: "repo", index: 0 } as vscode.WorkspaceFolder]);
        sandbox
            .stub(vscode.workspace, "findFiles")
            .resolves([tests, oversized, classes, unreadable]);
        const result = await discoverLocalSqlTests(() => false);

        expect(result).to.deep.include({
            candidateSqlFileCount: 4,
            scannedSqlFileCount: 2,
            skippedOversizedFileCount: 1,
            skippedByteBudgetFileCount: 0,
            unsafePathFileCount: 0,
            unreadableFileCount: 1,
            tSqltClassCount: 1,
            tSqltSourceFileCount: 1,
            truncated: false,
        });
        expect(result.tests).to.deep.equal([
            {
                framework: "tSQLt",
                suite: "OrderTests",
                name: "test total",
                relativePath: "workspace-1/tests/OrderTests.sql",
                line: 1,
            },
        ]);
        expect(result.tests[0].relativePath).not.to.contain("C:");
    });

    test("cancellation refuses discovery before reading workspace files", async () => {
        sandbox.stub(vscode.workspace, "workspaceFolders").value([
            {
                uri: vscode.Uri.file(testRoot),
                name: "repo",
                index: 0,
            } as vscode.WorkspaceFolder,
        ]);
        const findFiles = sandbox.stub(vscode.workspace, "findFiles");

        let error: unknown;
        try {
            await discoverLocalSqlTests(() => true);
        } catch (caught) {
            error = caught;
        }

        expect(error).to.be.instanceOf(LocalActivityError);
        expect((error as LocalActivityError).errorCode).to.equal("RunbookStudio.ActivityCancelled");
        expect(findFiles).not.to.have.been.called;
    });
});

suite("managedDacpacArtifactTrust", () => {
    let sandbox: sinon.SinonSandbox;
    let testRoot: string;

    setup(() => {
        sandbox = sinon.createSandbox();
        testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rbs-managed-dacpac-"));
        sandbox.stub(vscode.workspace, "workspaceFolders").value([]);
    });

    teardown(() => {
        sandbox.restore();
        if (path.basename(testRoot).startsWith("rbs-managed-dacpac-")) {
            fs.rmSync(testRoot, { recursive: true, force: true });
        }
    });

    test("admits a nonempty DACPAC only under the exact extension-managed root", async () => {
        const managedRoot = path.join(testRoot, "managed");
        const artifactPath = path.join(managedRoot, "source.dacpac");
        fs.mkdirSync(managedRoot);
        fs.writeFileSync(artifactPath, "managed-dacpac", "utf8");

        let refused: unknown;
        try {
            await verifyLocalDacpacArtifact(artifactPath, () => false);
        } catch (error) {
            refused = error;
        }
        expect(refused).to.be.instanceOf(LocalActivityError);
        expect((refused as LocalActivityError).errorCode).to.equal(
            "RunbookStudio.TargetOutsideWorkspace",
        );

        const admitted = await verifyLocalDacpacArtifact(artifactPath, () => false, [managedRoot]);
        expect(admitted.artifactPath).to.equal(path.normalize(artifactPath));
        expect(admitted.artifactSizeBytes).to.equal(Buffer.byteLength("managed-dacpac"));
        expect(admitted.artifactSha256).to.match(/^[a-f0-9]{64}$/);
    });
});
