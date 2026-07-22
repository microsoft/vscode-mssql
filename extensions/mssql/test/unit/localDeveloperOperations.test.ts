/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as sinon from "sinon";
import * as vscode from "vscode";
import {
    discoverLocalSqlTests,
    inspectLocalGitChangeSet,
    parseGitNameStatus,
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

suite("Runbook Studio Git change-set parsing", () => {
    test("classifies entity files and preserves rename provenance", () => {
        expect(
            parseGitNameStatus(
                [
                    "A\tsrc/MyApp.Data/Entities/AuditLog.cs",
                    "M\tsrc/MyApp.Data/Entities/Order.cs",
                    "R100\tsrc/OldContext.cs\tsrc/AppDbContext.cs",
                    "M\tREADME.md",
                ].join("\n"),
            ),
        ).to.deep.equal([
            {
                status: "M",
                relativePath: "README.md",
                entityRelated: false,
            },
            {
                status: "R100",
                relativePath: "src/AppDbContext.cs",
                previousPath: "src/OldContext.cs",
                entityRelated: true,
            },
            {
                status: "A",
                relativePath: "src/MyApp.Data/Entities/AuditLog.cs",
                entityRelated: true,
            },
            {
                status: "M",
                relativePath: "src/MyApp.Data/Entities/Order.cs",
                entityRelated: true,
            },
        ]);
    });

    test("refuses traversal and malformed name-status rows", () => {
        for (const value of ["M\t../secret.cs", "M\tC:/secret.cs", "R100\tonly-one-path"]) {
            expect(() => parseGitNameStatus(value), value).to.throw(LocalActivityError);
        }
    });
});

suite("Runbook Studio local Git change-set capture", () => {
    let sandbox: sinon.SinonSandbox;
    let repository: string;

    setup(() => {
        sandbox = sinon.createSandbox();
        repository = fs.mkdtempSync(path.join(os.tmpdir(), "rbs-git-change-set-"));
        sandbox.stub(vscode.workspace, "isTrusted").value(true);
        sandbox.stub(vscode.workspace, "workspaceFolders").value([
            {
                uri: vscode.Uri.file(repository),
                name: "repo",
                index: 0,
            } as vscode.WorkspaceFolder,
        ]);
        runGit(repository, ["init", "-b", "main"]);
        runGit(repository, ["config", "user.name", "Runbook Fixture"]);
        runGit(repository, ["config", "user.email", "runbook@example.invalid"]);
        const entities = path.join(repository, "src", "Entities");
        fs.mkdirSync(entities, { recursive: true });
        fs.writeFileSync(path.join(entities, "Order.cs"), "class Order { }\n", "utf8");
        runGit(repository, ["add", "."]);
        runGit(repository, ["commit", "-m", "main"]);
        runGit(repository, ["switch", "-c", "development"]);
        fs.writeFileSync(
            path.join(entities, "Order.cs"),
            "class Order { public string Status { get; set; } }\n",
            "utf8",
        );
        fs.writeFileSync(path.join(entities, "AuditLog.cs"), "class AuditLog { }\n", "utf8");
        runGit(repository, ["add", "."]);
        runGit(repository, ["commit", "-m", "development"]);
    });

    teardown(() => {
        sandbox.restore();
        if (path.basename(repository).startsWith("rbs-git-change-set-")) {
            try {
                fs.rmSync(repository, {
                    recursive: true,
                    force: true,
                    maxRetries: 5,
                    retryDelay: 100,
                });
            } catch (error) {
                // VS Code's Windows file watcher can retain the temporary
                // repository until the extension host exits. The OS temp
                // directory owns final cleanup; fail for every other error.
                if ((error as NodeJS.ErrnoException).code !== "EPERM") {
                    throw error;
                }
            }
        }
    });

    test("captures exact refs into a non-mutating retained patch", async () => {
        const beforeStatus = runGit(repository, ["status", "--porcelain"]);
        const artifactPath = path.join(repository, "changes.patch");
        const result = await inspectLocalGitChangeSet(
            repository,
            "main",
            "development",
            false,
            artifactPath,
            () => false,
        );

        expect(result.files.map((file) => file.relativePath)).to.deep.equal([
            "src/Entities/AuditLog.cs",
            "src/Entities/Order.cs",
        ]);
        expect(result.entityRelatedFileCount).to.equal(2);
        expect(result.baseCommit).to.match(/^[a-f0-9]{40}$/);
        expect(result.headCommit).to.match(/^[a-f0-9]{40}$/);
        expect(result.artifactSha256).to.match(/^[a-f0-9]{64}$/);
        expect(fs.readFileSync(artifactPath, "utf8")).to.contain("src/Entities/AuditLog.cs");
        fs.rmSync(artifactPath);
        expect(runGit(repository, ["status", "--porcelain"])).to.equal(beforeStatus);
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

function runGit(repository: string, args: string[]): string {
    const result = spawnSync("git", args, {
        cwd: repository,
        encoding: "utf8",
        windowsHide: true,
    });
    if (result.status !== 0) {
        throw new Error(`Git fixture command failed: ${result.stderr}`);
    }
    return result.stdout;
}
