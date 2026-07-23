/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Optional extension-host smoke for the exact Author -> deterministic compile ->
 * run-scoped approvals -> exact-ref EF builds -> semantic model comparison path.
 * The fixture is a nested Git repository with known main/development commits. */

import { spawnSync } from "child_process";
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
import { DEMO_RUNBOOK_INTENT } from "./demoRunbookPrompt";
import { DETAILED_EXECUTION_PLAN_INTENT } from "./detailedExecutionPlanPrompt";

const LIVE_ENABLED = process.env.RBS2_EF_LIVE === "1";
const REHEARSAL_LIVE_ENABLED = process.env.RBS2_EF_REHEARSAL_LIVE === "1";
const PERFORMANCE_LIVE_ENABLED = process.env.RBS2_EF_PERFORMANCE_LIVE === "1";
const DEMO_PERFORMANCE_LIVE_ENABLED = process.env.RBS2_EF_DEMO_LIVE === "1";
const DETAILED_PERFORMANCE_LIVE_ENABLED = process.env.RBS2_EF_DETAILED_LIVE === "1";
const DACPAC_CONNECTION_STRING =
    process.env.STS2_SQLSERVER_CONNSTRING ?? process.env.STS2_SQLSERVER_SQLLOGIN_CONNSTRING;
const FIXTURE_ROOT =
    process.env.RBS2_EF_FIXTURE_ROOT ??
    path.resolve(__dirname, "../../../../../..", "test_assets", "hobbes-ef-model", "myapp");
const PROJECT_PATH = "src/MyApp.Data/MyApp.Data.csproj";
const EXACT_INTENT =
    "Compare the Entity Framework entity changes between development and main in this repository " +
    "and generate migration DDL with possible data-loss analysis.";
const REHEARSAL_INTENT =
    "Compare Entity Framework changes between rehearsal-additive and main, generate migration DDL, " +
    "provision a SQL Server 2025 container, apply the migration, visualize the schema, roll it back, " +
    "and visualize the rolled-back schema.";
const DACPAC_REHEARSAL_INTENT =
    "Compare Entity Framework changes between rehearsal-additive and main, generate migration DDL, " +
    "extract a DACPAC from WideWorldImporters staging database, provision a SQL Server 2025 container, " +
    "deploy the DACPAC, apply the migration, run a schema compare and save the diff output, visualize " +
    "the schema, roll it back, and visualize the rolled-back schema.";
const PERFORMANCE_REHEARSAL_INTENT =
    process.env.RBS2_EF_PERFORMANCE_INTENT ??
    (DETAILED_PERFORMANCE_LIVE_ENABLED
        ? DETAILED_EXECUTION_PLAN_INTENT
        : DEMO_PERFORMANCE_LIVE_ENABLED
          ? DEMO_RUNBOOK_INTENT
          : "Compare Entity Framework changes between rehearsal-additive and main, generate migration DDL, " +
            "clone the WideWorldImporters staging database through a DACPAC into a SQL Server 2025 container, " +
            "apply it, compare and visualize the schema, run scripts/workload.sql with full DMV and XEvent " +
            "performance analysis, and produce a release candidate DACPAC.");
const PERFORMANCE_HEAD_REF =
    process.env.RBS2_EF_PERFORMANCE_HEAD_REF ??
    (DETAILED_PERFORMANCE_LIVE_ENABLED
        ? "development"
        : DEMO_PERFORMANCE_LIVE_ENABLED
          ? "demo"
          : "rehearsal-additive");
const PERFORMANCE_SOURCE_DATABASE =
    process.env.RBS2_EF_PERFORMANCE_SOURCE_DATABASE ??
    (DETAILED_PERFORMANCE_LIVE_ENABLED
        ? "HobbesComplexDev_Staging"
        : DEMO_PERFORMANCE_LIVE_ENABLED
          ? "HobbesDemo_MyApp_Staging"
          : "WideWorldImporters");
const PERFORMANCE_EXPECTED_NODE_COUNT = Number(
    process.env.RBS2_EF_PERFORMANCE_EXPECTED_NODE_COUNT ??
        (DETAILED_PERFORMANCE_LIVE_ENABLED ? "46" : DEMO_PERFORMANCE_LIVE_ENABLED ? "45" : "44"),
);
const MODEL_COMPARISON_RENAME_DECISIONS =
    process.env.RBS2_EF_RENAME_DECISIONS ??
    JSON.stringify([
        {
            objectType: "column",
            fromPath: "[Sales].[Orders].[Description]",
            toPath: "[Sales].[Orders].[Summary]",
            action: "rename",
        },
    ]);

suite("Runbook Studio EF model workflow live smoke (gated)", function () {
    this.timeout(12 * 60_000);

    suiteSetup(async function () {
        if (!LIVE_ENABLED || !fs.existsSync(path.join(FIXTURE_ROOT, ".git"))) {
            this.skip();
            return;
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
    });

    test("compiles the exact detailed execution-plan prompt through the product command", async () => {
        const extension = vscode.extensions.getExtension<mssql.IExtension>("ms-mssql.mssql");
        expect(extension).not.to.equal(undefined);
        await extension!.activate();
        await waitForCommand("mssql.runbookStudio.compileIntentHeadless");
        const temporaryDirectory = await fs.promises.mkdtemp(
            path.join(os.tmpdir(), "rbs-detailed-plan-compile-"),
        );
        const runbookPath = path.join(temporaryDirectory, "detailed-plan.runbook.json");
        const artifact = createNewRunbookArtifact("New runbook", "rbs-detailed-plan-live");
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
                intent: DETAILED_EXECUTION_PLAN_INTENT,
            });

            expect(compile, compile?.errorCode).to.include({ ok: true, nodeCount: 46 });
            expect(compile.activityKinds).to.include.members([
                "git.change-set.inspect",
                "ef.relational-model.compare",
                "migration.script.generate",
                "dacpac.extract",
                "dacpac.deploy.container",
                "schema.compare",
                "performance.dmv.delta",
                "xevent.xel.analyze",
                "workload.benchmark",
                "evidence.bundle",
                "sql.container.dispose",
            ]);
            expect(compile.activityKinds).not.to.include.members([
                "schema.compare.export",
                "xevent.capture.reconcile",
            ]);
            expect(compile.parameterIds).to.include.members([
                "repository",
                "baseRef",
                "headRef",
                "project",
                "dbContext",
                "sourceConnection",
                "sourceDatabaseName",
                "containerName",
                "databaseName",
                "saPassword",
                "workloadFile",
            ]);
        } finally {
            await Promise.resolve(
                vscode.commands.executeCommand("workbench.action.closeActiveEditor"),
            ).catch(() => undefined);
            await fs.promises
                .rm(temporaryDirectory, { recursive: true, force: true })
                .catch(() => undefined);
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
            expect(compile, compile?.errorCode).to.include({ ok: true, nodeCount: 11 });
            expect(compile.activityKinds).to.deep.equal([
                "git.change-set.inspect",
                "ef.project.discover",
                "ef.relational-model.extract",
                "ef.relational-model.extract",
                "ef.relational-model.compare",
                "migration.data-loss.analyze",
                "migration.script.generate",
            ]);
            expect(compile.parameterIds).to.deep.equal([
                "repository",
                "baseRef",
                "headRef",
                "project",
                "dbContext",
                "renameDecisions",
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
                    renameDecisions: MODEL_COMPARISON_RENAME_DECISIONS,
                },
                approveGates: true,
                timeoutMs: 10 * 60_000,
            });

            expect(run, JSON.stringify(run)).to.include({ state: "succeeded", verdict: "pass" });
            expect(run.nodeStates).to.have.length(11);
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
            expect(
                run.nodeStates?.find((node) => node.nodeId === "generate-migration")?.outputCount,
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

    test("applies and rolls back the exact reviewed digest in an owned SQL container", async function () {
        if (!REHEARSAL_LIVE_ENABLED) {
            this.skip();
        }
        const beforeHead = git("rev-parse", "HEAD");
        const beforeStatus = git("status", "--porcelain");
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
        const containerName = `rbs-ef-${suffix}`;
        const databaseName = `EfRehearsal${suffix}`;
        const password = `Rbs!${randomBytes(12).toString("hex")}aA9`;
        const temporaryDirectory = await fs.promises.mkdtemp(
            path.join(os.tmpdir(), "rbs-ef-rehearsal-"),
        );
        const runbookPath = path.join(temporaryDirectory, "ef-migration-rehearsal.runbook.json");
        const artifact = createNewRunbookArtifact("New runbook", "rbs-ef-rehearsal-live");
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
                intent: REHEARSAL_INTENT,
            });
            expect(compile, compile?.errorCode).to.include({ ok: true, nodeCount: 22 });
            expect(
                compile.activityKinds?.filter((kind) => kind === "migration.apply"),
            ).to.have.length(2);
            expect(compile.activityKinds).to.include.members([
                "migration.script.generate",
                "migration.scope.validate",
                "sql.container.provision",
                "database.schema.visualize",
                "sql.container.dispose",
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
                    headRef: "rehearsal-additive",
                    project: PROJECT_PATH,
                    dbContext: "AppDbContext",
                    renameDecisions: "[]",
                    containerName,
                    databaseName,
                    sqlVersion: "2025",
                    saPassword: password,
                    migrationTimeoutSeconds: 300,
                },
                approveGates: true,
                timeoutMs: 10 * 60_000,
            });

            expect(run, JSON.stringify(run)).to.include({ state: "succeeded", verdict: "pass" });
            expect(run.nodeStates).to.have.length(22);
            expect(run.nodeStates?.every((node) => node.state === "succeeded")).to.equal(true);
            expect(
                run.nodeStates?.find((node) => node.nodeId === "apply-forward-migration")?.message,
            ).to.match(/^Applied the forward migration/);
            expect(
                run.nodeStates?.find((node) => node.nodeId === "apply-rollback-migration")?.message,
            ).to.match(/^Applied the rollback migration/);
            expect(
                run.nodeStates?.find((node) => node.nodeId === "validate-forward-migration")
                    ?.message,
            ).to.match(/^The migrated schema matches the expected head model/);
            expect(
                run.nodeStates?.find((node) => node.nodeId === "validate-rollback-migration")
                    ?.message,
            ).to.match(/^The migrated schema matches the expected base model/);
            expect(
                run.nodeStates?.find((node) => node.nodeId === "visualize-forward-schema")
                    ?.outputCount,
            ).to.be.greaterThan(0);
            expect(
                run.nodeStates?.find((node) => node.nodeId === "visualize-rollback-schema")
                    ?.outputCount,
            ).to.be.greaterThan(0);
            expect(await getContainerByName(containerName)).to.equal(undefined);
            expect(git("rev-parse", "HEAD")).to.equal(beforeHead);
            expect(git("status", "--porcelain")).to.equal(beforeStatus);
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
            await Promise.resolve(
                vscode.commands.executeCommand("workbench.action.closeActiveEditor"),
            ).catch(() => undefined);
            await fs.promises
                .rm(temporaryDirectory, { recursive: true, force: true })
                .catch(() => undefined);
        }
    });

    test("rehearses the EF migration on an exact staging DACPAC clone", async function () {
        if (!REHEARSAL_LIVE_ENABLED || !DACPAC_CONNECTION_STRING) {
            this.skip();
            return;
        }
        const parsed = parseSqlConnectionString(DACPAC_CONNECTION_STRING);
        if (
            "error" in parsed ||
            !/^(localhost|127\.0\.0\.1|\[::1\]|\.|\(local\))(?:[\,].+)?$/i.test(
                parsed.parsed.server.replace(/^tcp:/i, ""),
            )
        ) {
            this.skip();
            return;
        }
        const extension = vscode.extensions.getExtension<mssql.IExtension>("ms-mssql.mssql");
        expect(extension).not.to.equal(undefined);
        await extension!.activate();
        await waitForCommand("mssql.runbookStudio.compileIntentHeadless");
        const beforeHead = git("rev-parse", "HEAD");
        const beforeStatus = git("status", "--porcelain");
        const suffix = randomBytes(6).toString("hex");
        const containerName = `rbs-ef-dacpac-${suffix}`;
        const databaseName = `EfDacpac${suffix}`;
        const password = `Rbs!${randomBytes(12).toString("hex")}aA9`;
        const temporaryDirectory = await fs.promises.mkdtemp(
            path.join(os.tmpdir(), "rbs-ef-dacpac-rehearsal-"),
        );
        const runbookPath = path.join(temporaryDirectory, "ef-dacpac-rehearsal.runbook.json");
        const artifact = createNewRunbookArtifact("New runbook", "rbs-ef-dacpac-rehearsal-live");
        await fs.promises.writeFile(runbookPath, canonicalizeRunbookArtifact(artifact), "utf8");
        const baseProfile = {
            server: parsed.parsed.server,
            database: "master",
            authenticationType: parsed.parsed.integrated ? "Integrated" : "SqlLogin",
            ...(parsed.parsed.user ? { user: parsed.parsed.user } : {}),
            ...(parsed.parsed.password ? { password: parsed.parsed.password } : {}),
            ...(parsed.parsed.encrypt ? { encrypt: parsed.parsed.encrypt } : {}),
            ...(parsed.parsed.trustServerCertificate !== undefined
                ? { trustServerCertificate: parsed.parsed.trustServerCertificate }
                : {}),
        } as mssql.IConnectionInfo;
        const profileName = `Runbook Studio EF DACPAC ${suffix}`;
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
        const savedProfile = await controller!.connectionManager.connectionStore.saveProfile({
            ...baseProfile,
            id: `rbs-ef-dacpac-${suffix}`,
            profileName,
            groupId: "ROOT",
            configSource: vscode.ConfigurationTarget.Global,
            savePassword: parsed.parsed.password !== undefined,
            emptyPasswordInput: false,
        } as never);
        const persistedProfile = (
            await controller!.connectionManager.connectionStore.readAllConnections(false)
        ).find((candidate) => candidate.profileName === profileName);
        expect(persistedProfile).not.to.equal(undefined);
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
                intent: DACPAC_REHEARSAL_INTENT,
            });
            expect(compile, compile?.errorCode).to.include({ ok: true, nodeCount: 29 });
            expect(compile.activityKinds).to.include.members([
                "dacpac.extract",
                "dacpac.deploy.preview",
                "dacpac.deploy.container",
                "schema.compare",
                "schema.compare.export",
                "migration.apply",
                "migration.scope.validate",
                "database.schema.visualize",
                "sql.container.dispose",
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
                    headRef: "rehearsal-additive",
                    project: PROJECT_PATH,
                    dbContext: "AppDbContext",
                    renameDecisions: "[]",
                    sourceConnection: persistedProfile!.id,
                    sourceDatabaseName: "WideWorldImporters",
                    containerName,
                    databaseName,
                    sqlVersion: "2025",
                    saPassword: password,
                    migrationTimeoutSeconds: 300,
                },
                approveGates: true,
                timeoutMs: 12 * 60_000,
            });
            expect(run, JSON.stringify(run)).to.include({ state: "succeeded", verdict: "pass" });
            expect(run.nodeStates).to.have.length(29);
            expect(run.nodeStates?.every((node) => node.state === "succeeded")).to.equal(true);
            for (const nodeId of [
                "verify-base-deployment",
                "validate-forward-migration",
                "compare-forward-schema",
                "visualize-forward-schema",
                "validate-rollback-migration",
                "verify-rollback-base",
                "visualize-rollback-schema",
            ]) {
                expect(
                    run.nodeStates?.find((node) => node.nodeId === nodeId)?.outputCount,
                    nodeId,
                ).to.be.greaterThan(0);
            }
            expect(await getContainerByName(containerName)).to.equal(undefined);
            expect(git("rev-parse", "HEAD")).to.equal(beforeHead);
            expect(git("status", "--porcelain")).to.equal(beforeStatus);
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
                .rm(temporaryDirectory, { recursive: true, force: true })
                .catch(() => undefined);
        }
    });

    test("validates a migrated staging clone and extracts its candidate DACPAC", async function () {
        if (!PERFORMANCE_LIVE_ENABLED || !DACPAC_CONNECTION_STRING) {
            this.skip();
            return;
        }
        const parsed = parseSqlConnectionString(DACPAC_CONNECTION_STRING);
        if (
            "error" in parsed ||
            !/^(localhost|127\.0\.0\.1|\[::1\]|\.|\(local\))(?:[\,].+)?$/i.test(
                parsed.parsed.server.replace(/^tcp:/i, ""),
            )
        ) {
            this.skip();
            return;
        }
        const extension = vscode.extensions.getExtension<mssql.IExtension>("ms-mssql.mssql");
        expect(extension).not.to.equal(undefined);
        const api = await extension!.activate();
        await waitForCommand("mssql.runbookStudio.compileIntentHeadless");
        const beforeHead = git("rev-parse", "HEAD");
        const beforeStatus = git("status", "--porcelain");
        const suffix = randomBytes(6).toString("hex");
        const containerName = `rbs-ef-perf-${suffix}`;
        const databaseName = `EfPerf${suffix}`;
        const password = `Rbs!${randomBytes(12).toString("hex")}aA9`;
        const temporaryDirectory = await fs.promises.mkdtemp(
            path.join(os.tmpdir(), "rbs-ef-performance-rehearsal-"),
        );
        const runbookPath = path.join(temporaryDirectory, "ef-performance.runbook.json");
        const artifact = createNewRunbookArtifact("New runbook", "rbs-ef-performance-live");
        await fs.promises.writeFile(runbookPath, canonicalizeRunbookArtifact(artifact), "utf8");
        const baseProfile = {
            server: parsed.parsed.server,
            database: "master",
            authenticationType: parsed.parsed.integrated ? "Integrated" : "SqlLogin",
            ...(parsed.parsed.user ? { user: parsed.parsed.user } : {}),
            ...(parsed.parsed.password ? { password: parsed.parsed.password } : {}),
            ...(parsed.parsed.encrypt ? { encrypt: parsed.parsed.encrypt } : {}),
            ...(parsed.parsed.trustServerCertificate !== undefined
                ? { trustServerCertificate: parsed.parsed.trustServerCertificate }
                : {}),
        } as mssql.IConnectionInfo;
        const profileName = `Runbook Studio EF performance ${suffix}`;
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
        const savedProfile = await controller!.connectionManager.connectionStore.saveProfile({
            ...baseProfile,
            id: `rbs-ef-performance-${suffix}`,
            profileName,
            groupId: "ROOT",
            configSource: vscode.ConfigurationTarget.Global,
            savePassword: parsed.parsed.password !== undefined,
            emptyPasswordInput: false,
        } as never);
        const persistedProfile = (
            await controller!.connectionManager.connectionStore.readAllConnections(false)
        ).find((candidate) => candidate.profileName === profileName);
        expect(persistedProfile).not.to.equal(undefined);
        let stagingMasterUri: string | undefined;
        let stagingDatabaseUri: string | undefined;
        let seededStagingDatabase = false;

        try {
            if (DETAILED_PERFORMANCE_LIVE_ENABLED) {
                expect(PERFORMANCE_SOURCE_DATABASE).to.match(/^[A-Za-z_][A-Za-z0-9_$#@-]{0,127}$/);
                stagingMasterUri = await api.connect(baseProfile);
                const existing = await api.connectionSharing.executeSimpleQuery(
                    stagingMasterUri,
                    `SELECT CAST(CASE WHEN DB_ID(N'${PERFORMANCE_SOURCE_DATABASE}') IS NULL THEN 0 ELSE 1 END AS int) AS database_exists;`,
                );
                expect(
                    existing.rows?.[0]?.[0]?.displayValue,
                    `Refusing to replace existing test staging database ${PERFORMANCE_SOURCE_DATABASE}`,
                ).to.equal("0");
                await api.connectionSharing.executeSimpleQuery(
                    stagingMasterUri,
                    `CREATE DATABASE [${PERFORMANCE_SOURCE_DATABASE}];`,
                );
                seededStagingDatabase = true;
                stagingDatabaseUri = await api.connect({
                    ...baseProfile,
                    database: PERFORMANCE_SOURCE_DATABASE,
                });
                const stagingSchema = await fs.promises.readFile(
                    path.join(FIXTURE_ROOT, "database", "main.sql"),
                    "utf8",
                );
                for (const batch of splitSqlBatches(stagingSchema)) {
                    await api.connectionSharing.executeSimpleQuery(stagingDatabaseUri, batch);
                }
                await api.connectionSharing.executeSimpleQuery(
                    stagingDatabaseUri,
                    "INSERT INTO dbo.Customers(Name, Email) VALUES (N'Runbook fixture', N'fixture@example.test');",
                );
            }
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
                intent: PERFORMANCE_REHEARSAL_INTENT,
            });
            expect(compile, compile?.errorCode).to.include({
                ok: true,
                nodeCount: PERFORMANCE_EXPECTED_NODE_COUNT,
            });
            expect(compile.activityKinds).to.include.members([
                "sql.workload.inspect",
                "database.schema.fingerprint",
                "performance.dmv.snapshot",
                "performance.dmv.delta",
                "xevent.session.start",
                "sql.workload.run",
                "xevent.session.stop",
                "xevent.xel.analyze",
                "xevent.xel.collect",
                "workload.benchmark",
                "dacpac.extract",
                ...(DETAILED_PERFORMANCE_LIVE_ENABLED
                    ? ["evidence.bundle"]
                    : ["release.manifest.create"]),
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
                    headRef: PERFORMANCE_HEAD_REF,
                    project: PROJECT_PATH,
                    dbContext: "AppDbContext",
                    renameDecisions: "[]",
                    sourceConnection: persistedProfile!.id,
                    sourceDatabaseName: PERFORMANCE_SOURCE_DATABASE,
                    containerName,
                    databaseName,
                    sqlVersion: "2025",
                    saPassword: password,
                    migrationTimeoutSeconds: 300,
                    workloadFile: "scripts/workload.sql",
                    workloadRepetitions: 2,
                    workloadTimeoutSeconds: 300,
                    xeventMaxFileSizeMb: 16,
                },
                approveGates: true,
                timeoutMs: 15 * 60_000,
            });
            expect(run, JSON.stringify(run)).to.include({ state: "succeeded", verdict: "pass" });
            expect(run.nodeStates?.filter((node) => node.state === "succeeded")).to.have.length(
                PERFORMANCE_EXPECTED_NODE_COUNT - 5,
            );
            expect(run.nodeStates?.filter((node) => node.state === "skipped")).to.have.length(5);
            for (const nodeId of [
                "verify-base-deployment",
                "validate-forward-migration",
                "schema-fingerprint-before",
                "snapshot-before",
                "run-workload",
                "schema-fingerprint-after",
                "snapshot-after",
                "compare-snapshots",
                "analyze-capture",
                "collect-capture",
                "summarize-performance",
                ...(DETAILED_PERFORMANCE_LIVE_ENABLED
                    ? ["validate-rollback-migration", "verify-rollback-base", "bundle-evidence"]
                    : [
                          "visualize-forward-schema",
                          "extract-release-candidate",
                          "create-release-manifest",
                      ]),
            ]) {
                expect(
                    run.nodeStates?.find((node) => node.nodeId === nodeId)?.outputCount,
                    nodeId,
                ).to.be.greaterThan(0);
            }
            expect(await getContainerByName(containerName)).to.equal(undefined);
            expect(git("rev-parse", "HEAD")).to.equal(beforeHead);
            expect(git("status", "--porcelain")).to.equal(beforeStatus);
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
            if (stagingDatabaseUri) {
                api.connectionSharing.disconnect(stagingDatabaseUri);
            }
            if (seededStagingDatabase && stagingMasterUri) {
                await api.connectionSharing.executeSimpleQuery(
                    stagingMasterUri,
                    `ALTER DATABASE [${PERFORMANCE_SOURCE_DATABASE}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${PERFORMANCE_SOURCE_DATABASE}];`,
                );
            }
            if (stagingMasterUri) {
                api.connectionSharing.disconnect(stagingMasterUri);
            }
            await controller!.connectionManager.connectionStore
                .removeProfile(persistedProfile ?? savedProfile)
                .catch(() => false);
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

function splitSqlBatches(script: string): string[] {
    return script
        .split(/^\s*GO\s*(?:--.*)?$/gim)
        .map((batch) => batch.trim())
        .filter((batch) => batch.length > 0);
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
