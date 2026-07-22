/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { spawnSync } from "child_process";
import * as crypto from "crypto";
import Dockerode = require("dockerode");
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { stampCatalogMetadata } from "../../src/runbookStudio/activities/activityCatalog";
import { HeadlessEffectAuthority } from "../../src/runbookStudio/headless/headlessEffectAuthority";
import { HeadlessSqlActivityDelegate } from "../../src/runbookStudio/headless/headlessSqlActivity";
import { runHeadlessActivities } from "../../src/runbookStudio/headless/headlessActivityRunner";
import { ManifestHeadlessApprovalProvider } from "../../src/runbookStudio/headless/headlessExecutionProviders";
import {
    RunbookEffectLedger,
    deriveRunbookEffectId,
} from "../../src/runbookStudio/runbookEffectLedger";
import {
    canonicalizeRunbookArtifact,
    computePlanHash,
    createNewRunbookArtifact,
} from "../../src/runbookStudio/runbookArtifact";
import type { ActivityInvocationIdentity } from "../../src/runbookStudio/runtime/fakeRuntimeAdapter";
import { FakeBackend } from "../../src/services/sqlDataPlane/fakeBackend";
import {
    RUNBOOK_LOCK_SCHEMA_VERSION,
    type RunbookArtifactFile,
    type RunbookPlanNode,
} from "../../src/sharedInterfaces/runbookStudio";

const EXTENSION_ROOT = path.resolve(__dirname, "../../..");
const WORKSPACE_ROOT = path.resolve(__dirname, "../../../../..");

suite("Runbook Studio headless SQL activity", () => {
    let stateRoot: string;

    setup(() => {
        stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rbs-headless-sql-"));
    });

    teardown(() => {
        fs.rmSync(stateRoot, { recursive: true, force: true });
    });

    test("provisions, queries, and disposes through same-run authority without retaining a secret", async () => {
        const runId = "headless-sql-unit";
        const artifact = containerArtifact("headless-sql-unit-book");
        const invocation: ActivityInvocationIdentity = {
            runId,
            planRevision: artifact.lock!.planRevision,
            planHash: artifact.lock!.planHash,
            attempt: 1,
        };
        const effectId = deriveRunbookEffectId({
            runId,
            nodeId: "provision",
            attempt: 1,
            activityKind: "sql.container.provision",
            activityVersion: 1,
        });
        const password = "Headless!Sql1";
        const parameters = parameterValues("rbs-headless-sql-unit", password);
        const authority = new HeadlessEffectAuthority(runId, artifact, parameters);
        authority.recordApprovedGate("approve-provision", `sha256:${"a".repeat(64)}`, {});

        const fakeDocker = new FakeDocker();
        const backend = new FakeBackend({
            scripts: [
                successfulScript(
                    (sql) => sql.trim() === "SELECT CAST(1 AS int) AS ready;",
                    ["ready"],
                    [[1]],
                ),
                successfulScript((sql) => sql.startsWith("CREATE DATABASE"), [], []),
                successfulScript(
                    (sql) => sql.includes("database_exists"),
                    ["database_exists", "lease_id"],
                    [[1, effectId]],
                ),
                successfulScript(
                    (sql) => sql.includes("DB_NAME()"),
                    ["database_name", "ready"],
                    [["HeadlessSqlDb", 1]],
                ),
            ],
        });
        const delegate = new HeadlessSqlActivityDelegate(stateRoot, EXTENSION_ROOT, authority, {
            docker: fakeDocker as unknown as Dockerode,
            createSqlService: () => Promise.resolve(backend),
            wait: () => Promise.resolve(),
        });
        const resolve = (value: unknown): unknown =>
            typeof value === "string" && value.startsWith("$params.")
                ? parameters[value.slice("$params.".length)]
                : value;
        const provision = await delegate.executeActivity(artifact.lock!.nodes[1], {
            parameterValues: parameters,
            resolveBind: resolve,
            isCancellationRequested: () => false,
            invocation,
        });
        expect(provision?.success).to.equal(true);
        const connectionRef = provision?.values?.connectionRef as string;

        const query = await delegate.executeActivity(artifact.lock!.nodes[2], {
            parameterValues: parameters,
            resolveBind: (value) =>
                value === "$nodes.provision.connectionRef" ? connectionRef : resolve(value),
            isCancellationRequested: () => false,
            invocation,
        });
        expect(query?.success).to.equal(true);
        expect(query?.output).to.deep.include({
            contract: "rowset/1",
            columns: ["database_name", "ready"],
            rows: [["HeadlessSqlDb", 1]],
        });

        const cleanup = await delegate.executeActivity(artifact.lock!.nodes[3], {
            parameterValues: parameters,
            resolveBind: (value) =>
                value === "$nodes.provision.connectionRef" ? connectionRef : resolve(value),
            isCancellationRequested: () => false,
            invocation,
        });
        expect(cleanup?.success).to.equal(true);
        expect(fakeDocker.present).to.equal(false);
        expect(new RunbookEffectLedger(stateRoot).scanRecovery().outstanding).to.deep.equal([]);
        const journals = fs
            .readdirSync(path.join(stateRoot, "effects"))
            .map((file) => fs.readFileSync(path.join(stateRoot, "effects", file), "utf8"))
            .join("\n");
        expect(journals).not.to.contain(password);
        await delegate.dispose();
    });
});

suite("Runbook Studio headless SQL activity live smoke (gated)", function () {
    this.timeout(10 * 60 * 1000);
    let stateRoot: string;
    let docker: Dockerode;

    suiteSetup(async function () {
        if (
            process.env.RBS2_SQL_LIVE !== "1" ||
            !fs.existsSync(path.join(EXTENSION_ROOT, "dist", "tsNativeProvider.js"))
        ) {
            this.skip();
            return;
        }
        docker = new Dockerode();
        try {
            await docker.ping();
        } catch {
            this.skip();
        }
    });

    setup(() => {
        stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rbs-headless-sql-live-"));
    });

    teardown(() => {
        fs.rmSync(stateRoot, { recursive: true, force: true });
    });

    test("runs the owned SQL 2025 provision-query-dispose lock outside VS Code", async () => {
        const runId = `headless-sql-live-${Date.now().toString(36)}`;
        const containerName = `rbs-headless-live-${crypto.randomBytes(4).toString("hex")}`;
        const password = `Rbs!${crypto.randomBytes(12).toString("hex")}Aa1`;
        const artifact = containerArtifact("headless-sql-live-book");
        const parameters = parameterValues(containerName, password);
        const approvalProvider = new ManifestHeadlessApprovalProvider({
            schemaVersion: 1,
            runId,
            runbookId: artifact.id,
            planRevision: artifact.lock!.planRevision,
            planHash: artifact.lock!.planHash,
            approvedGateIds: ["approve-provision"],
            expiresEpochMs: Date.now() + 10 * 60_000,
        });
        try {
            const result = await runHeadlessActivities({
                artifactText: canonicalizeRunbookArtifact(artifact),
                trustedWorkspaceRoot: WORKSPACE_ROOT,
                activityArtifactRoot: stateRoot,
                extensionRoot: EXTENSION_ROOT,
                parameterValues: parameters,
                runId,
                approvalProvider,
            });
            expect(result, JSON.stringify(result, undefined, 2)).to.include({
                outcome: "pass",
                terminalState: "succeeded",
            });
            expect(result.nodeCounts).to.deep.equal({
                succeeded: 5,
                failed: 0,
                skipped: 0,
                cancelled: 0,
            });
            expect(result.outputs?.query).to.deep.include({
                contract: "rowset/1",
                columns: ["database_name", "ready"],
                rows: [["HeadlessSqlDb", 1]],
            });
            expect(result.outputs?.dispose.scalars).to.include({
                cleaned: true,
                containerName,
                executionMode: "headless",
            });
            expect(JSON.stringify(result)).not.to.contain(password);
            expect(await containerByName(docker, containerName)).to.equal(undefined);
            expect(new RunbookEffectLedger(stateRoot).scanRecovery().outstanding).to.deep.equal([]);
        } finally {
            const leaked = await containerByName(docker, containerName);
            if (leaked) {
                const inspected = await leaked.inspect();
                if (
                    inspected.Config?.Labels?.["com.microsoft.mssql.runbook-studio.run-id"] !==
                    runId
                ) {
                    throw new Error(
                        "Live headless SQL container ownership changed; refusing cleanup.",
                    );
                }
                await leaked.remove({ force: true });
            }
        }
    });

    test("runs the owned SQL lock through the bundled CLI with an environment secret", async () => {
        const runId = `headless-sql-cli-${Date.now().toString(36)}`;
        const containerName = `rbs-headless-live-${crypto.randomBytes(4).toString("hex")}`;
        const password = `Rbs!${crypto.randomBytes(12).toString("hex")}Aa1`;
        const secretEnvironmentName = `RBS2_SQL_PASSWORD_${crypto
            .randomBytes(4)
            .toString("hex")
            .toUpperCase()}`;
        const artifact = containerArtifact("headless-sql-cli-book");
        const artifactPath = path.join(stateRoot, "sql.runbook.json");
        const parametersPath = path.join(stateRoot, "parameters.json");
        const secretsPath = path.join(stateRoot, "secret-environment-map.json");
        const approvalPath = path.join(stateRoot, "approval.json");
        const activityArtifacts = path.join(stateRoot, "activity-artifacts");
        const outputDirectory = path.join(stateRoot, "machine-output");
        fs.writeFileSync(artifactPath, canonicalizeRunbookArtifact(artifact), "utf8");
        fs.writeFileSync(
            parametersPath,
            JSON.stringify({
                containerName,
                databaseName: "HeadlessSqlDb",
                sqlVersion: "2025",
            }),
            "utf8",
        );
        fs.writeFileSync(
            secretsPath,
            JSON.stringify({ saPassword: secretEnvironmentName }),
            "utf8",
        );
        fs.writeFileSync(
            approvalPath,
            JSON.stringify({
                schemaVersion: 1,
                runId,
                runbookId: artifact.id,
                planRevision: artifact.lock!.planRevision,
                planHash: artifact.lock!.planHash,
                approvedGateIds: ["approve-provision"],
                expiresEpochMs: Date.now() + 10 * 60_000,
            }),
            "utf8",
        );

        try {
            const executed = spawnSync(
                process.execPath,
                [
                    path.join(EXTENSION_ROOT, "dist", "runbookHeadless.js"),
                    "run-activities",
                    artifactPath,
                    "--workspace",
                    WORKSPACE_ROOT,
                    "--activity-artifacts",
                    activityArtifacts,
                    "--params",
                    parametersPath,
                    "--secret-env-map",
                    secretsPath,
                    "--approval-manifest",
                    approvalPath,
                    "--output",
                    outputDirectory,
                    "--run-id",
                    runId,
                ],
                {
                    cwd: EXTENSION_ROOT,
                    encoding: "utf8",
                    env: { ...process.env, [secretEnvironmentName]: password },
                    maxBuffer: 4 * 1024 * 1024,
                    timeout: 5 * 60_000,
                    windowsHide: true,
                },
            );

            expect(executed.status, executed.stderr || executed.stdout).to.equal(0);
            expect(`${executed.stdout}\n${executed.stderr}`).not.to.contain(password);
            const summary = JSON.parse(executed.stdout) as {
                mode: string;
                effects: string;
                outcome: string;
                nodeCounts: Record<string, number>;
                outputs: Record<string, { contract: string }>;
            };
            expect(summary).to.include({
                mode: "productionActivityHost",
                effects: "real",
                outcome: "pass",
            });
            expect(summary.nodeCounts.succeeded).to.equal(5);
            expect(summary.outputs.query.contract).to.equal("rowset/1");
            expect(summary.outputs.dispose.contract).to.equal("cleanupEvidence/1");
            expect(fs.existsSync(path.join(outputDirectory, "run-summary.json"))).to.equal(true);
            expect(await containerByName(docker, containerName)).to.equal(undefined);
            expect(
                new RunbookEffectLedger(activityArtifacts).scanRecovery().outstanding,
            ).to.deep.equal([]);
            const retainedText = readTreeText(stateRoot);
            expect(retainedText).not.to.contain(password);
        } finally {
            const leaked = await containerByName(docker, containerName);
            if (leaked) {
                const inspected = await leaked.inspect();
                if (
                    inspected.Config?.Labels?.["com.microsoft.mssql.runbook-studio.run-id"] !==
                    runId
                ) {
                    throw new Error(
                        "Live headless SQL CLI container ownership changed; refusing cleanup.",
                    );
                }
                await leaked.remove({ force: true });
            }
        }
    });
});

function containerArtifact(id: string): RunbookArtifactFile {
    const artifact = createNewRunbookArtifact("Headless owned SQL", id);
    artifact.source.parameters = [
        { id: "containerName", label: "Container", type: "string", required: true },
        {
            id: "databaseName",
            label: "Database",
            type: "string",
            required: true,
            default: "HeadlessSqlDb",
        },
        {
            id: "sqlVersion",
            label: "SQL version",
            type: "enum",
            required: true,
            default: "2025",
            enumValues: ["2025", "2022", "2019"],
        },
        { id: "saPassword", label: "Password", type: "secret", required: true },
    ];
    const nodes: RunbookPlanNode[] = stampCatalogMetadata([
        { id: "approve-provision", label: "Approve owned container", kind: "gate" },
        {
            id: "provision",
            label: "Provision owned container",
            kind: "activity",
            activityKind: "sql.container.provision",
            inputs: {
                containerName: "$params.containerName",
                databaseName: "$params.databaseName",
                version: "$params.sqlVersion",
                password: "$params.saPassword",
            },
        },
        {
            id: "query",
            label: "Read database identity",
            kind: "activity",
            activityKind: "sql.query.read",
            inputs: {
                connection: "$nodes.provision.connectionRef",
                sql: "SELECT DB_NAME() AS database_name, CAST(1 AS int) AS ready;",
            },
        },
        {
            id: "dispose",
            label: "Dispose owned container",
            kind: "activity",
            activityKind: "sql.container.dispose",
            inputs: { database: "$nodes.provision.connectionRef" },
        },
        { id: "report", label: "Report", kind: "report" },
    ]);
    artifact.lock = {
        schemaVersion: RUNBOOK_LOCK_SCHEMA_VERSION,
        planRevision: "1",
        planHash: "sha256:pending",
        entryNodeId: "approve-provision",
        nodes,
        edges: [
            { from: "approve-provision", to: "provision", when: "approved" },
            { from: "provision", to: "query" },
            { from: "query", to: "dispose" },
            { from: "dispose", to: "report" },
        ],
    };
    artifact.lock.planHash = computePlanHash(artifact.source, artifact.lock);
    return artifact;
}

function parameterValues(containerName: string, password: string) {
    return {
        containerName,
        databaseName: "HeadlessSqlDb",
        sqlVersion: "2025",
        saPassword: password,
    };
}

function successfulScript(
    match: (sql: string) => boolean,
    columns: string[],
    rows: (string | number | boolean | null)[][],
) {
    return {
        match,
        events: [
            ...(columns.length > 0 ? [{ type: "resultSet" as const, columns, rows }] : []),
            { type: "complete" as const, status: "succeeded" as const },
        ],
    };
}

async function containerByName(
    docker: Dockerode,
    name: string,
): Promise<Dockerode.Container | undefined> {
    const matches = await docker.listContainers({ all: true, filters: { name: [`^/${name}$`] } });
    return matches[0]?.Id ? docker.getContainer(matches[0].Id) : undefined;
}

function readTreeText(root: string): string {
    return fs
        .readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8"))
        .join("\n");
}

class FakeDocker {
    public present = false;
    private options: Dockerode.ContainerCreateOptions | undefined;
    private readonly container = {
        start: async () => {
            this.present = true;
        },
        inspect: async () => ({
            Config: { Labels: this.options?.Labels },
            Image: `sha256:${"c".repeat(64)}`,
        }),
        remove: async () => {
            this.present = false;
        },
    };

    public ping(): Promise<string> {
        return Promise.resolve("OK");
    }

    public getImage() {
        return { inspect: () => Promise.resolve({}) };
    }

    public async createContainer(options: Dockerode.ContainerCreateOptions) {
        this.options = options;
        return this.container;
    }

    public listContainers(): Promise<Array<{ Id: string }>> {
        return Promise.resolve(this.present ? [{ Id: "fake-container" }] : []);
    }

    public getContainer() {
        return this.container;
    }
}
