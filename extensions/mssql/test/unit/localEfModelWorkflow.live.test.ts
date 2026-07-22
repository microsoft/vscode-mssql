/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Optional extension-host smoke for the exact Author -> deterministic compile ->
 * run-scoped approvals -> exact-ref EF builds -> semantic model comparison path.
 * The fixture is a nested Git repository with known main/development commits. */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { expect } from "chai";
import * as vscode from "vscode";
import type * as mssql from "vscode-mssql";
import {
    canonicalizeRunbookArtifact,
    createNewRunbookArtifact,
} from "../../src/runbookStudio/runbookArtifact";
import { RUNBOOK_STUDIO_VIEW_TYPE } from "../../src/runbookStudio/runbookStudioEditorProvider";

const LIVE_ENABLED = process.env.RBS2_EF_LIVE === "1";
const FIXTURE_ROOT =
    process.env.RBS2_EF_FIXTURE_ROOT ??
    path.resolve(__dirname, "../../../../../..", "test_assets", "hobbes-ef-model", "myapp");
const PROJECT_PATH = "src/MyApp.Data/MyApp.Data.csproj";
const EXACT_INTENT =
    "Compare the Entity Framework entity changes between development and main in this repository " +
    "and analyze possible data loss.";

suite("Runbook Studio EF model workflow live smoke (gated)", function () {
    this.timeout(12 * 60_000);

    suiteSetup(function () {
        if (!LIVE_ENABLED || !fs.existsSync(path.join(FIXTURE_ROOT, ".git"))) {
            this.skip();
        }
    });

    test("compiles and executes approved exact-ref model comparison through the coordinator", async () => {
        const beforeHead = git("rev-parse", "HEAD");
        const beforeStatus = git("status", "--porcelain");
        await vscode.workspace
            .getConfiguration()
            .update("mssql.runbookStudio.enabled", true, vscode.ConfigurationTarget.Global);
        await vscode.workspace
            .getConfiguration()
            .update("mssql.runbookStudio.runtime", "local", vscode.ConfigurationTarget.Global);
        const extension = vscode.extensions.getExtension<mssql.IExtension>("ms-mssql.mssql");
        expect(extension).not.to.equal(undefined);
        await extension!.activate();
        await waitForCommand("mssql.runbookStudio.compileIntentHeadless");

        const temporaryDirectory = await fs.promises.mkdtemp(
            path.join(os.tmpdir(), "rbs-ef-workflow-"),
        );
        const runbookPath = path.join(temporaryDirectory, "ef-model-comparison.runbook.json");
        const artifact = createNewRunbookArtifact("New runbook", "rbs-ef-workflow-live");
        await fs.promises.writeFile(runbookPath, canonicalizeRunbookArtifact(artifact), "utf8");

        try {
            const document = await vscode.workspace.openTextDocument(runbookPath);
            await vscode.commands.executeCommand(
                "vscode.openWith",
                document.uri,
                RUNBOOK_STUDIO_VIEW_TYPE,
            );
            const compile = await vscode.commands.executeCommand<{
                ok: boolean;
                errorCode?: string;
                nodeCount?: number;
                activityKinds?: string[];
                parameterIds?: string[];
            }>("mssql.runbookStudio.compileIntentHeadless", {
                uri: document.uri.toString(),
                intent: EXACT_INTENT,
            });
            expect(compile, compile?.errorCode).to.include({ ok: true, nodeCount: 9 });
            expect(compile.activityKinds).to.deep.equal([
                "git.change-set.inspect",
                "ef.project.discover",
                "ef.relational-model.extract",
                "ef.relational-model.extract",
                "ef.relational-model.compare",
                "migration.data-loss.analyze",
            ]);
            expect(compile.parameterIds).to.deep.equal([
                "repository",
                "baseRef",
                "headRef",
                "project",
                "dbContext",
            ]);
            await document.save();

            const run = await vscode.commands.executeCommand<{
                state: string;
                errorCode?: string;
                verdict?: string;
                nodeStates?: Array<{
                    nodeId: string;
                    state: string;
                    outputCount: number;
                    message?: string;
                }>;
            }>("mssql.runbookStudio.startRunHeadless", {
                uri: document.uri.toString(),
                parameterValues: {
                    repository: FIXTURE_ROOT,
                    baseRef: "main",
                    headRef: "development",
                    project: PROJECT_PATH,
                    dbContext: "AppDbContext",
                },
                approveGates: true,
                timeoutMs: 10 * 60_000,
            });

            expect(run, JSON.stringify(run)).to.include({ state: "succeeded", verdict: "pass" });
            expect(run.nodeStates).to.have.length(9);
            expect(run.nodeStates?.every((node) => node.state === "succeeded")).to.equal(true);
            expect(
                run.nodeStates?.find((node) => node.nodeId === "extract-base-model")?.outputCount,
            ).to.be.greaterThan(0);
            expect(
                run.nodeStates?.find((node) => node.nodeId === "extract-head-model")?.outputCount,
            ).to.be.greaterThan(0);
            expect(
                run.nodeStates?.find((node) => node.nodeId === "compare-models")?.outputCount,
            ).to.be.greaterThan(0);
            expect(
                run.nodeStates?.find((node) => node.nodeId === "analyze-migration-risk")
                    ?.outputCount,
            ).to.be.greaterThan(0);
            expect(git("rev-parse", "HEAD")).to.equal(beforeHead);
            expect(git("status", "--porcelain")).to.equal(beforeStatus);
        } finally {
            await Promise.resolve(
                vscode.commands.executeCommand("workbench.action.closeActiveEditor"),
            ).catch(() => undefined);
            await fs.promises
                .rm(temporaryDirectory, { recursive: true, force: true })
                .catch(() => undefined);
        }
    });
});

function git(...args: string[]): string {
    const result = spawnSync("git", args, {
        cwd: FIXTURE_ROOT,
        encoding: "utf8",
        windowsHide: true,
    });
    if (result.status !== 0) {
        throw new Error("The EF fixture Git operation failed.");
    }
    return result.stdout.trim();
}

async function waitForCommand(command: string): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        if ((await vscode.commands.getCommands(true)).includes(command)) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`command '${command}' was not registered after enabling Runbook Studio`);
}
