/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Optional live product-path smoke for the exact user-reported generated
 * Cities workload. The saved profile intentionally targets master: the
 * runbook's explicit sourceDatabaseName must select WideWorldImporters before
 * the host samples data. The normal coordinator then provisions SQL 2025,
 * captures XEvents, executes the generated workload, analyzes/retains the XEL,
 * summarizes measurements, and disposes the exact owned container. */

import { randomBytes } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { expect } from "chai";
import * as vscode from "vscode";
import type * as mssql from "vscode-mssql";
import { getContainerByName } from "../../src/docker/dockerUtils";
import { parseSqlConnectionString } from "../../src/diagnostics/selfTest/connectionString";
import {
    RUNBOOK_CONTAINER_KIND,
    RUNBOOK_CONTAINER_KIND_LABEL,
} from "../../src/runbookStudio/runtime/localContainerOperations";
import {
    canonicalizeRunbookArtifact,
    createNewRunbookArtifact,
} from "../../src/runbookStudio/runbookArtifact";
import { RUNBOOK_STUDIO_VIEW_TYPE } from "../../src/runbookStudio/runbookStudioEditorProvider";

const LIVE_ENABLED = process.env.RBS2_DOCKER_LIVE === "1";
const CONNECTION_STRING =
    process.env.STS2_SQLSERVER_CONNSTRING ?? process.env.STS2_SQLSERVER_SQLLOGIN_CONNSTRING;
const EXACT_INTENT =
    "Can you look at some data in the WideWorldImporters database, in the Application.Cities " +
    "table, sample like 10-20 rows, generate a workload generation script that does inserts " +
    "and deletes in a loop with data that is similar to the sampled data. Run those " +
    "insert/deletes in a script of like 1000 times. Collect server statistics around IO, " +
    "blocking, etc. And present a series of performance activity metrics from that workload.";

suite("Runbook Studio generated Cities workload live smoke (gated)", function () {
    this.timeout(12 * 60_000);

    suiteSetup(function () {
        if (!LIVE_ENABLED || !CONNECTION_STRING) {
            this.skip();
        }
        const parsed = parseSqlConnectionString(CONNECTION_STRING);
        if (
            "error" in parsed ||
            !/^(localhost|127\.0\.0\.1|\[::1\]|\.|\(local\))(?:[\\,].+)?$/i.test(
                parsed.parsed.server.replace(/^tcp:/i, ""),
            )
        ) {
            this.skip();
        }
    });

    test("samples the explicit source database and completes the owned Docker workflow", async () => {
        const parsed = parseSqlConnectionString(CONNECTION_STRING!);
        if ("error" in parsed) {
            throw new Error(parsed.error);
        }
        await vscode.workspace
            .getConfiguration()
            .update("mssql.runbookStudio.enabled", true, vscode.ConfigurationTarget.Global);
        await vscode.workspace
            .getConfiguration()
            .update("mssql.runbookStudio.runtime", "local", vscode.ConfigurationTarget.Global);
        await vscode.workspace
            .getConfiguration()
            .update("mssql.sqlDataPlane.enabled", true, vscode.ConfigurationTarget.Global);
        const extension = vscode.extensions.getExtension<mssql.IExtension>("ms-mssql.mssql");
        expect(extension).not.to.equal(undefined);
        await extension!.activate();
        await waitForCommand("mssql.runbookStudio.compileIntentHeadless");

        const suffix = randomBytes(6).toString("hex");
        const containerName = `rbs-cities-${suffix}`;
        const containerDatabase = `Cities${suffix}`;
        const password = `Rbs!${randomBytes(12).toString("hex")}aA9`;
        const profileName = `Runbook Studio Cities ${suffix}`;
        const profile = {
            server: parsed.parsed.server,
            database: "master",
            authenticationType: parsed.parsed.integrated ? "Integrated" : "SqlLogin",
            ...(parsed.parsed.user ? { user: parsed.parsed.user } : {}),
            ...(parsed.parsed.password ? { password: parsed.parsed.password } : {}),
            ...(parsed.parsed.encrypt ? { encrypt: parsed.parsed.encrypt } : {}),
            ...(parsed.parsed.trustServerCertificate !== undefined
                ? { trustServerCertificate: parsed.parsed.trustServerCertificate }
                : {}),
            id: `rbs-cities-${suffix}`,
            profileName,
            groupId: "ROOT",
            configSource: vscode.ConfigurationTarget.Global,
            savePassword: parsed.parsed.password !== undefined,
            emptyPasswordInput: false,
        } as never;
        const controller = await vscode.commands.executeCommand<{
            connectionManager: {
                connectionStore: {
                    saveProfile(value: unknown): Promise<{ id: string }>;
                    readAllConnections(
                        includeRecent: boolean,
                    ): Promise<Array<{ id: string; profileName?: string }>>;
                    removeProfile(value: unknown): Promise<boolean>;
                };
            };
        }>("mssql.getControllerForTests");
        expect(controller).not.to.equal(undefined);
        const savedProfile =
            await controller!.connectionManager.connectionStore.saveProfile(profile);
        const persistedProfile = (
            await controller!.connectionManager.connectionStore.readAllConnections(false)
        ).find((candidate) => candidate.profileName === profileName);
        expect(persistedProfile).not.to.equal(undefined);
        const tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rbs-cities-"));
        const runbookPath = path.join(tempDirectory, `cities-${suffix}.runbook.json`);
        const baseArtifact = createNewRunbookArtifact("New runbook", `rbs-cities-${suffix}`);
        await fs.promises.writeFile(runbookPath, canonicalizeRunbookArtifact(baseArtifact), "utf8");

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
            expect(compile, compile?.errorCode).to.include({ ok: true, nodeCount: 15 });
            expect(compile.parameterIds).to.include("sourceDatabaseName");
            expect(compile.activityKinds).to.include.members([
                "sql.workload.generate",
                "sql.container.provision",
                "xevent.session.start",
                "sql.workload.run",
                "xevent.session.stop",
                "xevent.xel.analyze",
                "xevent.xel.collect",
                "performance.dmv.snapshot",
                "workload.benchmark",
                "sql.container.dispose",
            ]);
            await document.save();

            const run = await vscode.commands.executeCommand<{
                state: string;
                runId?: string;
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
                    sourceConnection: persistedProfile!.id,
                    sourceDatabaseName: "WideWorldImporters",
                    containerName,
                    containerDatabase,
                    sqlVersion: "2025",
                    saPassword: password,
                    sampleRows: 20,
                    iterations: 1000,
                    repetitions: 2,
                },
                approveGates: true,
                timeoutMs: 10 * 60_000,
            });
            expect(run, JSON.stringify(run)).to.include({ state: "succeeded", verdict: "pass" });
            expect(run.nodeStates).to.have.length(15);
            expect(run.nodeStates?.every((node) => node.state === "succeeded")).to.equal(true);
            expect(
                run.nodeStates?.find((node) => node.nodeId === "generate-workload")?.outputCount,
            ).to.be.greaterThan(0);
            expect(
                run.nodeStates?.find((node) => node.nodeId === "analyze-capture")?.outputCount,
            ).to.be.greaterThan(0);
            expect(
                run.nodeStates?.find((node) => node.nodeId === "snapshot-before")?.outputCount,
            ).to.be.greaterThan(0);
            expect(
                run.nodeStates?.find((node) => node.nodeId === "snapshot-after")?.outputCount,
            ).to.be.greaterThan(0);
            expect(
                run.nodeStates?.find((node) => node.nodeId === "analyze-capture")?.message,
            ).to.match(/^Analyzed [1-9]\d* correlated Extended Events event\(s\)\.$/);
            expect(
                run.nodeStates?.find((node) => node.nodeId === "collect-capture")?.outputCount,
            ).to.be.greaterThan(0);
            expect(await getContainerByName(containerName)).to.equal(undefined);
        } finally {
            const leaked = await getContainerByName(containerName);
            if (leaked) {
                const inspected = await leaked.inspect();
                if (
                    inspected.Config?.Labels?.[RUNBOOK_CONTAINER_KIND_LABEL] !==
                    RUNBOOK_CONTAINER_KIND
                ) {
                    throw new Error("Live smoke container ownership changed; refusing cleanup.");
                }
                await leaked.remove({ force: true });
            }
            await controller!.connectionManager.connectionStore
                .removeProfile(persistedProfile ?? savedProfile)
                .catch(() => false);
            await Promise.resolve(
                vscode.commands.executeCommand("workbench.action.closeActiveEditor"),
            ).catch(() => undefined);
            await fs.promises
                .rm(tempDirectory, { recursive: true, force: true })
                .catch(() => undefined);
        }
    });
});

async function waitForCommand(command: string): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        if ((await vscode.commands.getCommands(true)).includes(command)) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Command '${command}' was not registered.`);
}
