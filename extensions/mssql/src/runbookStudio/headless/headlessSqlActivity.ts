/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** No-VS-Code owned SQL-container and bounded query provider. */

import Dockerode = require("dockerode");
import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import type { RunbookPlanNode } from "../../sharedInterfaces/runbookStudio";
import type {
    ISqlConnectionService,
    SqlConnectionProfileRef,
} from "../../services/sqlDataPlane/api";
import type { PreparedConnection } from "../../services/metadata/profileAuthAdapter";
import { isReadOnlySql } from "../readOnlySql";
import { digestRunbookValue } from "../runbookDigest";
import {
    deriveRunbookEffectId,
    RunbookEffectLedger,
    RunbookEffectSnapshot,
} from "../runbookEffectLedger";
import {
    buildCreateLocalDevelopmentDatabaseSql,
    buildProbeLocalDevelopmentDatabaseSql,
} from "../runtime/localDevelopmentDatabaseOperations";
import {
    effectIdFromLocalSqlContainerLeaseRef,
    isOwnedLocalSqlContainer,
    localSqlContainerLabels,
    localSqlContainerLeaseRef,
    validateLocalSqlContainerIdentity,
} from "../runtime/localContainerOperations";
import type {
    ActivityExecutionDelegate,
    ActivityInvocationIdentity,
    NodeExecution,
} from "../runtime/fakeRuntimeAdapter";
import { runDataPlaneQueryCore } from "../providers/dataPlaneQueryCore";
import { HeadlessEffectAuthority } from "./headlessEffectAuthority";

const SQL_PORT = "1433/tcp";
const MEMORY_BYTES = 2 * 1024 * 1024 * 1024;
const NANO_CPUS = 2_000_000_000;
const AUTH_TIMEOUT_MS = 90_000;
const IMAGE_PULL_TIMEOUT_MS = 10 * 60_000;
const MAX_QUERY_ROWS = 1000;

interface SqlProviderModule {
    readonly driverVersion: string;
    createBackend(): ISqlConnectionService;
}

interface ContainerLease {
    runId: string;
    effectId: string;
    containerName: string;
    databaseName: string;
    version: string;
    port: number;
    password: string;
    imageDigest: string;
    environmentFingerprint: string;
}

/** Secret-bearing same-process capability. Callers must never serialize it. */
export interface HeadlessOwnedSqlConnection {
    runId: string;
    effectId: string;
    connectionRef: string;
    connectionString: string;
    containerName: string;
    databaseName: string;
    environmentFingerprint: string;
}

export interface HeadlessSqlActivityDependencies {
    docker?: Dockerode;
    createSqlService?: () => Promise<ISqlConnectionService>;
    wait?: (milliseconds: number) => Promise<void>;
}

export class HeadlessSqlActivityDelegate implements ActivityExecutionDelegate {
    public readonly runtimeKind = "local" as const;
    public readonly supportedActivityKinds = new Set([
        "sql.container.provision",
        "sql.query.read",
        "sql.container.dispose",
    ]);
    private readonly docker: Dockerode;
    private readonly ledger: RunbookEffectLedger;
    private readonly leases = new Map<string, ContainerLease>();
    private readonly wait: (milliseconds: number) => Promise<void>;
    private initialized = false;
    private sqlService: ISqlConnectionService | undefined;

    constructor(
        stateRoot: string,
        private readonly extensionRoot: string,
        private readonly authority: HeadlessEffectAuthority,
        dependencies: HeadlessSqlActivityDependencies = {},
    ) {
        const root = ensureStateRoot(stateRoot);
        this.ledger = new RunbookEffectLedger(root);
        this.docker = dependencies.docker ?? new Dockerode();
        this.createSqlService = dependencies.createSqlService;
        this.wait =
            dependencies.wait ??
            ((milliseconds) =>
                new Promise<void>((resolve) => {
                    setTimeout(resolve, milliseconds);
                }));
    }

    private readonly createSqlService?: () => Promise<ISqlConnectionService>;

    public async executeActivity(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution | undefined> {
        if (!this.supportedActivityKinds.has(node.activityKind ?? "")) {
            return undefined;
        }
        try {
            await this.initialize(binding.isCancellationRequested);
            switch (node.activityKind) {
                case "sql.container.provision":
                    return await this.provision(node, binding);
                case "sql.query.read":
                    return await this.query(node, binding);
                case "sql.container.dispose":
                    return await this.disposeContainer(node, binding);
            }
        } catch (error) {
            return sqlFailure(error);
        }
        return undefined;
    }

    public async dispose(): Promise<void> {
        for (const lease of [...this.leases.values()]) {
            const snapshot = this.ledger.recoverEffect(lease.effectId)?.snapshot;
            if (snapshot && snapshot.state !== "cleaned" && snapshot.state !== "failedNoEffect") {
                await this.cleanup(snapshot).catch(() => undefined);
            }
        }
        this.leases.clear();
        const disposable = this.sqlService as
            | (ISqlConnectionService & { dispose?: () => Promise<void> })
            | undefined;
        await disposable?.dispose?.().catch(() => undefined);
        this.sqlService = undefined;
    }

    public async resolveOwnedConnection(
        connectionRef: string,
        invocation: ActivityInvocationIdentity,
    ): Promise<HeadlessOwnedSqlConnection> {
        const lease = await this.requireLease(connectionRef, invocation);
        return {
            runId: lease.runId,
            effectId: lease.effectId,
            connectionRef,
            connectionString: [
                `Server=localhost,${lease.port}`,
                `Database=${quoteConnectionValue(lease.databaseName)}`,
                "User ID=sa",
                `Password=${quoteConnectionValue(lease.password)}`,
                "Encrypt=Mandatory",
                "TrustServerCertificate=True",
                "Connect Timeout=30",
            ].join(";"),
            containerName: lease.containerName,
            databaseName: lease.databaseName,
            environmentFingerprint: lease.environmentFingerprint,
        };
    }

    public async executeOwnedSql(
        connectionRef: string,
        sql: string,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
        options: { tag: string; maxRows?: number; timeoutMs?: number },
    ) {
        const lease = await this.requireLease(connectionRef, invocation);
        return this.executeLeaseQuery(
            lease,
            lease.databaseName,
            sql,
            options.tag,
            isCancellationRequested,
            options.maxRows ?? MAX_QUERY_ROWS,
            options.timeoutMs,
        );
    }

    public async ownedMetadataContext(
        connectionRef: string,
        invocation: ActivityInvocationIdentity,
    ): Promise<{
        prepared: PreparedConnection;
        database: string;
        service: ISqlConnectionService;
    }> {
        const lease = await this.requireLease(connectionRef, invocation);
        const profileRef = this.profileForLease(lease, lease.databaseName);
        return {
            prepared: {
                profileRef,
                auth: { passwordProvider: () => Promise.resolve(lease.password) },
                authKind: "sql",
                serverFingerprint: digestRunbookValue({
                    provider: "headlessOwnedContainerServer",
                    effectId: lease.effectId,
                }),
                defaultDatabase: lease.databaseName,
                displayName: lease.containerName,
            },
            database: lease.databaseName,
            service: await this.service(),
        };
    }

    private async initialize(isCancellationRequested: () => boolean): Promise<void> {
        if (this.initialized) {
            return;
        }
        if (isCancellationRequested()) {
            throw codedError("HeadlessActivityHost.ActivityCancelled");
        }
        await this.docker.ping();
        await this.recoverAbandonedContainers();
        this.initialized = true;
    }

    private async provision(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution> {
        const containerName = binding.resolveBind(node.inputs?.containerName);
        const databaseName = binding.resolveBind(node.inputs?.databaseName);
        const version = binding.resolveBind(node.inputs?.version);
        const password = binding.resolveBind(node.inputs?.password);
        const requestedPort = binding.resolveBind(node.inputs?.port);
        if (
            typeof containerName !== "string" ||
            typeof databaseName !== "string" ||
            typeof version !== "string" ||
            typeof password !== "string" ||
            !validSqlPassword(password) ||
            (requestedPort !== undefined &&
                requestedPort !== null &&
                (typeof requestedPort !== "number" || !Number.isSafeInteger(requestedPort)))
        ) {
            throw codedError("HeadlessActivityHost.BindingInvalid");
        }
        const authorization = this.authority.require(
            node.id,
            "sql.container.provision",
            binding.invocation,
        );
        if (await this.containerByName(containerName.trim())) {
            throw codedError("HeadlessActivityHost.TargetChanged");
        }
        const port = await chooseAvailablePort(
            typeof requestedPort === "number" ? requestedPort : 14330,
            requestedPort !== undefined && requestedPort !== null,
        );
        const identity = validateLocalSqlContainerIdentity({
            containerName: containerName.trim(),
            databaseName: databaseName.trim(),
            version: version.trim(),
            port,
        });
        if (!identity) {
            throw codedError("HeadlessActivityHost.BindingInvalid");
        }
        const imageName = `mcr.microsoft.com/mssql/server:${identity.version}-latest`;
        await this.ensureImage(imageName, binding.isCancellationRequested);
        const effectId = deriveRunbookEffectId({
            runId: binding.invocation.runId,
            nodeId: node.id,
            attempt: binding.invocation.attempt,
            activityKind: "sql.container.provision",
            activityVersion: authorization.challenge.activityVersion,
        });
        if (this.ledger.recoverEffect(effectId)) {
            throw codedError("HeadlessActivityHost.EffectRecoveryRequired");
        }
        const ownershipMarkerDigest = digestRunbookValue(effectId);
        const connectionProfileId = containerConnectionProfileId(effectId);
        this.ledger.prepareEffect({
            effectId,
            runId: binding.invocation.runId,
            nodeId: node.id,
            attempt: binding.invocation.attempt,
            activityKind: "sql.container.provision",
            activityVersion: authorization.challenge.activityVersion,
            idempotencyKey: digestRunbookValue({ effectId, ...identity }),
            planHash: binding.invocation.planHash,
            bindingDigest: authorization.challenge.resolvedArgumentDigest,
            targetFingerprint: authorization.challenge.targetFingerprint,
            retrySemantics: "resumable",
            ownerPid: process.pid,
            policy: { version: authorization.challenge.policyVersion, outcome: "allowed" },
            approval: authorization.evidence,
            recovery: {
                resourceKind: "sqlContainer",
                resourceId: identity.containerName,
                connectionProfileId,
                ownershipMarkerDigest,
            },
        });
        let container: Dockerode.Container | undefined;
        try {
            container = await this.docker.createContainer({
                Image: imageName,
                name: identity.containerName,
                Hostname: identity.containerName,
                Env: ["ACCEPT_EULA=Y", `MSSQL_SA_PASSWORD=${password}`],
                Labels: localSqlContainerLabels(effectId, binding.invocation.runId),
                ExposedPorts: { [SQL_PORT]: {} },
                HostConfig: {
                    PortBindings: { [SQL_PORT]: [{ HostPort: String(identity.port) }] },
                    Memory: MEMORY_BYTES,
                    NanoCpus: NANO_CPUS,
                },
            });
            await container.start();
            const inspected = await container.inspect();
            if (
                !isOwnedLocalSqlContainer(
                    inspected.Config?.Labels,
                    effectId,
                    binding.invocation.runId,
                ) ||
                typeof inspected.Image !== "string" ||
                !/^sha256:[a-f0-9]{64}$/iu.test(inspected.Image)
            ) {
                this.ledger.requireOperatorDecision(effectId, "ContainerLabelsMissing");
                throw codedError("HeadlessActivityHost.TargetChanged");
            }
            const imageDigest = inspected.Image.toLowerCase();
            const environmentFingerprint = digestRunbookValue({
                schemaVersion: 1,
                provider: "docker",
                imageDigest,
                version: identity.version,
                memoryBytes: MEMORY_BYTES,
                nanoCpus: NANO_CPUS,
            });
            const lease: ContainerLease = {
                runId: binding.invocation.runId,
                effectId,
                ...identity,
                password,
                imageDigest,
                environmentFingerprint,
            };
            this.leases.set(effectId, lease);
            this.ledger.recordEffectObserved(effectId, {
                resourceKind: "sqlContainer",
                resourceId: identity.containerName,
                ownershipMarkerDigest,
                connectionProfileId,
                outputHandles: [
                    localSqlContainerLeaseRef(effectId),
                    `database:${identity.databaseName}`,
                ],
            });
            await this.waitUntilAuthenticated(lease, binding.isCancellationRequested);
            await this.executeLeaseQuery(
                lease,
                "master",
                buildCreateLocalDevelopmentDatabaseSql(identity.databaseName, effectId),
                "headless-container-create-database",
                binding.isCancellationRequested,
                1,
            );
            const probe = await this.executeLeaseQuery(
                lease,
                "master",
                buildProbeLocalDevelopmentDatabaseSql(identity.databaseName),
                "headless-container-verify-database",
                binding.isCancellationRequested,
                1,
            );
            if (Number(probe.rows[0]?.[0]) !== 1 || probe.rows[0]?.[1] !== effectId) {
                throw codedError("HeadlessActivityHost.ContainerDatabaseInvalid");
            }
            return {
                success: true,
                message: `Provisioned owned SQL Server ${identity.version} container '${identity.containerName}'.`,
                runMetrics: { "container.provisioned": true, "container.port": identity.port },
                output: {
                    contract: "databaseLease/1",
                    scalars: {
                        leaseId: effectId,
                        connectionRef: localSqlContainerLeaseRef(effectId),
                        databaseName: identity.databaseName,
                        containerName: identity.containerName,
                        port: identity.port,
                        version: identity.version,
                        imageDigest,
                        environmentFingerprint,
                        effectId,
                        createdAtUtc: new Date().toISOString(),
                        executionMode: "headless",
                    },
                },
                values: {
                    leaseId: effectId,
                    connectionRef: localSqlContainerLeaseRef(effectId),
                    databaseName: identity.databaseName,
                    containerName: identity.containerName,
                    port: identity.port,
                    version: identity.version,
                    imageDigest,
                    environmentFingerprint,
                },
            };
        } catch (error) {
            await this.settleProvisionFailure(effectId, identity.containerName, binding.invocation);
            this.leases.delete(effectId);
            throw error;
        }
    }

    private async query(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution> {
        const connection = binding.resolveBind(node.inputs?.connection);
        const sql = binding.resolveBind(node.inputs?.sql);
        if (typeof connection !== "string" || typeof sql !== "string" || !isReadOnlySql(sql)) {
            throw codedError("HeadlessActivityHost.BindingInvalid");
        }
        const lease = await this.requireLease(connection, binding.invocation);
        const result = await this.executeLeaseQuery(
            lease,
            lease.databaseName,
            sql,
            "headless-runbook-read",
            binding.isCancellationRequested,
            MAX_QUERY_ROWS,
        );
        return {
            success: true,
            message: `Read ${result.rows.length} row(s) from the owned database.`,
            runMetrics: { "sql.rowCount": result.rows.length },
            output: {
                contract: "rowset/1",
                columns: result.columns.map((column) => column.displayName || column.name),
                rows: result.rows.map((row) => row.map(runtimeCell)),
                scalars: { rowCount: result.rows.length, executionMode: "headless" },
            },
            values: { rowCount: result.rows.length },
        };
    }

    private async disposeContainer(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution> {
        const connection = binding.resolveBind(node.inputs?.database);
        if (typeof connection !== "string") {
            throw codedError("HeadlessActivityHost.BindingInvalid");
        }
        const effectId = effectIdFromLocalSqlContainerLeaseRef(connection);
        const snapshot = effectId ? this.ledger.recoverEffect(effectId)?.snapshot : undefined;
        if (!snapshot || snapshot.identity.runId !== binding.invocation.runId) {
            throw codedError("HeadlessActivityHost.TargetChanged");
        }
        const result = await this.cleanup(snapshot);
        return {
            success: true,
            message: `Disposed owned SQL container '${result.containerName}'.`,
            runMetrics: { "container.cleanupCompleted": true },
            output: {
                contract: "cleanupEvidence/1",
                scalars: {
                    effectId,
                    leaseId: effectId,
                    databaseName: result.databaseName,
                    containerName: result.containerName,
                    cleaned: true,
                    cleanedAtUtc: result.cleanedAtUtc,
                    cleanupEvidenceDigest: result.cleanupEvidenceDigest,
                    executionMode: "headless",
                },
            },
            values: { cleaned: true },
        };
    }

    private async requireLease(
        leaseRef: string,
        invocation: ActivityInvocationIdentity,
    ): Promise<ContainerLease> {
        const effectId = effectIdFromLocalSqlContainerLeaseRef(leaseRef);
        const lease = effectId ? this.leases.get(effectId) : undefined;
        const snapshot = effectId ? this.ledger.recoverEffect(effectId)?.snapshot : undefined;
        if (
            !effectId ||
            !lease ||
            lease.runId !== invocation.runId ||
            !snapshot ||
            snapshot.state !== "effectObserved" ||
            snapshot.identity.runId !== invocation.runId
        ) {
            throw codedError("HeadlessActivityHost.AuthorityInvalid");
        }
        const container = await this.containerByName(lease.containerName);
        const inspected = await container?.inspect();
        if (
            !container ||
            !isOwnedLocalSqlContainer(inspected?.Config?.Labels, effectId, invocation.runId)
        ) {
            this.ledger.requireOperatorDecision(effectId, "ProvisionedContainerMissingOrChanged");
            throw codedError("HeadlessActivityHost.TargetChanged");
        }
        return lease;
    }

    private async executeLeaseQuery(
        lease: ContainerLease,
        database: string,
        sql: string,
        tag: string,
        isCancellationRequested: () => boolean,
        maxRows: number,
        timeoutMs = 120_000,
    ) {
        const service = await this.service();
        const profile = this.profileForLease(lease, database);
        return runDataPlaneQueryCore({
            service,
            profile,
            auth: { passwordProvider: () => Promise.resolve(lease.password) },
            database,
            applicationName: "mssql-runbook-headless",
            sql,
            tag,
            isCancellationRequested,
            maxRows,
            timeoutMs,
        });
    }

    private profileForLease(lease: ContainerLease, database: string): SqlConnectionProfileRef {
        return {
            profileFingerprint: digestRunbookValue({
                provider: "headlessOwnedContainer",
                effectId: lease.effectId,
            }),
            server: `localhost,${lease.port}`,
            database,
            authKind: "sql",
            user: "sa",
            encrypt: "mandatory",
            trustServerCertificate: true,
            displayName: lease.containerName,
        };
    }

    private async waitUntilAuthenticated(
        lease: ContainerLease,
        isCancellationRequested: () => boolean,
    ): Promise<void> {
        const deadline = Date.now() + AUTH_TIMEOUT_MS;
        while (!isCancellationRequested() && Date.now() < deadline) {
            try {
                await this.executeLeaseQuery(
                    lease,
                    "master",
                    "SELECT CAST(1 AS int) AS ready;",
                    "headless-container-ready",
                    isCancellationRequested,
                    1,
                );
                return;
            } catch {
                if (Date.now() >= deadline) {
                    break;
                }
                await this.wait(1000);
            }
        }
        throw codedError(
            isCancellationRequested()
                ? "HeadlessActivityHost.ActivityCancelled"
                : "HeadlessActivityHost.ContainerNotReady",
        );
    }

    private async service(): Promise<ISqlConnectionService> {
        if (!this.sqlService) {
            this.sqlService = this.createSqlService
                ? await this.createSqlService()
                : await loadSqlService(this.extensionRoot);
        }
        return this.sqlService;
    }

    private async ensureImage(
        imageName: string,
        isCancellationRequested: () => boolean,
    ): Promise<void> {
        try {
            await this.docker.getImage(imageName).inspect();
            return;
        } catch {
            // Pull the exact allowlisted public SQL Server tag below.
        }
        if (isCancellationRequested()) {
            throw codedError("HeadlessActivityHost.ActivityCancelled");
        }
        const stream = (await this.docker.pull(imageName)) as NodeJS.ReadableStream & {
            destroy?: () => void;
        };
        await new Promise<void>((resolve, reject) => {
            let settled = false;
            const finish = (error?: Error) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearInterval(cancelPoll);
                clearTimeout(timeout);
                error ? reject(error) : resolve();
            };
            const cancelPoll = setInterval(() => {
                if (isCancellationRequested()) {
                    stream.destroy?.();
                    finish(codedError("HeadlessActivityHost.ActivityCancelled"));
                }
            }, 50);
            const timeout = setTimeout(() => {
                stream.destroy?.();
                finish(codedError("HeadlessActivityHost.ImagePullTimedOut"));
            }, IMAGE_PULL_TIMEOUT_MS);
            this.docker.modem.followProgress(stream, (error) =>
                finish(error ? codedError("HeadlessActivityHost.ImagePullFailed") : undefined),
            );
        });
    }

    private async settleProvisionFailure(
        effectId: string,
        containerName: string,
        invocation: ActivityInvocationIdentity,
    ): Promise<void> {
        let snapshot = this.ledger.recoverEffect(effectId)?.snapshot;
        if (!snapshot || snapshot.state === "failedNoEffect" || snapshot.state === "cleaned") {
            return;
        }
        try {
            const container = await this.containerByName(containerName);
            if (snapshot.state === "prepared") {
                if (!container) {
                    this.ledger.recordNoEffectFailure(effectId, "ContainerCreateNotObserved");
                    return;
                }
                const inspected = await container.inspect();
                if (
                    !isOwnedLocalSqlContainer(inspected.Config?.Labels, effectId, invocation.runId)
                ) {
                    this.ledger.requireOperatorDecision(
                        effectId,
                        "ContainerLabelsMissingOrChanged",
                    );
                    return;
                }
                const recovery = snapshot.identity.recovery!;
                snapshot = this.ledger.recordEffectObserved(effectId, {
                    resourceKind: "sqlContainer",
                    resourceId: containerName,
                    ownershipMarkerDigest: recovery.ownershipMarkerDigest,
                    connectionProfileId: recovery.connectionProfileId,
                    outputHandles: [localSqlContainerLeaseRef(effectId)],
                });
            }
            await this.cleanup(snapshot);
        } catch {
            const latest = this.ledger.recoverEffect(effectId)?.snapshot;
            if (
                latest &&
                latest.state !== "cleaned" &&
                latest.state !== "failedNoEffect" &&
                latest.state !== "needsOperatorDecision"
            ) {
                this.ledger.requireOperatorDecision(effectId, "ProvisionRollbackFailed");
            }
        }
    }

    private async cleanup(initial: RunbookEffectSnapshot): Promise<{
        containerName: string;
        databaseName: string;
        cleanedAtUtc: string;
        cleanupEvidenceDigest: string;
    }> {
        let snapshot = initial;
        const effectId = snapshot.identity.effectId;
        const recovery = snapshot.identity.recovery;
        const resource = snapshot.resource;
        const containerName = resource?.resourceId ?? recovery?.resourceId;
        const lease = this.leases.get(effectId);
        const databaseName =
            lease?.databaseName ??
            resource?.outputHandles
                ?.find((value) => value.startsWith("database:"))
                ?.slice("database:".length) ??
            "containerDatabase";
        const markerDigest = digestRunbookValue(effectId);
        const connectionProfileId = containerConnectionProfileId(effectId);
        if (
            snapshot.identity.activityKind !== "sql.container.provision" ||
            !recovery ||
            recovery.resourceKind !== "sqlContainer" ||
            !containerName ||
            recovery.resourceId !== containerName ||
            recovery.connectionProfileId !== connectionProfileId ||
            recovery.ownershipMarkerDigest !== markerDigest ||
            snapshot.state === "needsOperatorDecision" ||
            snapshot.state === "failedNoEffect"
        ) {
            throw codedError("HeadlessActivityHost.EffectRecoveryRequired");
        }
        if (snapshot.state === "cleaned") {
            return {
                containerName,
                databaseName,
                cleanedAtUtc: new Date(snapshot.lastUpdatedEpochMs).toISOString(),
                cleanupEvidenceDigest: snapshot.cleanupEvidenceDigest ?? "sha256:unknown",
            };
        }
        const container = await this.containerByName(containerName);
        if (container) {
            const inspected = await container.inspect();
            if (
                !isOwnedLocalSqlContainer(
                    inspected.Config?.Labels,
                    effectId,
                    snapshot.identity.runId,
                )
            ) {
                this.ledger.requireOperatorDecision(effectId, "ContainerLabelsChanged");
                throw codedError("HeadlessActivityHost.TargetChanged");
            }
        }
        if (snapshot.state === "prepared") {
            if (!container) {
                this.ledger.recordNoEffectFailure(effectId, "RecoveredBeforeEffect");
                throw codedError("HeadlessActivityHost.EffectRecoveryRequired");
            }
            snapshot = this.ledger.recordEffectObserved(effectId, {
                resourceKind: "sqlContainer",
                resourceId: containerName,
                ownershipMarkerDigest: markerDigest,
                connectionProfileId,
                outputHandles: [localSqlContainerLeaseRef(effectId), `database:${databaseName}`],
            });
        }
        if (snapshot.state === "effectObserved") {
            snapshot = this.ledger.startCleanup(effectId);
        }
        if (container) {
            await container.remove({ force: true });
        }
        if (await this.containerByName(containerName)) {
            this.ledger.requireOperatorDecision(effectId, "ContainerDeleteNotObserved");
            throw codedError("HeadlessActivityHost.EffectRecoveryRequired");
        }
        const cleanupEvidenceDigest = digestRunbookValue({
            effectId,
            containerName,
            cleaned: true,
        });
        if (snapshot.state === "cleanupStarted") {
            snapshot = this.ledger.completeCleanup(effectId, cleanupEvidenceDigest);
        }
        this.leases.delete(effectId);
        return {
            containerName,
            databaseName,
            cleanedAtUtc: new Date(snapshot.lastUpdatedEpochMs).toISOString(),
            cleanupEvidenceDigest,
        };
    }

    private async recoverAbandonedContainers(): Promise<void> {
        for (const entry of this.ledger.scanRecovery().outstanding) {
            const snapshot = entry.snapshot;
            if (
                snapshot.identity.activityKind !== "sql.container.provision" ||
                snapshot.state === "needsOperatorDecision" ||
                (snapshot.identity.ownerPid !== undefined &&
                    snapshot.identity.ownerPid !== process.pid &&
                    isPidAlive(snapshot.identity.ownerPid))
            ) {
                continue;
            }
            const containerName =
                snapshot.resource?.resourceId ?? snapshot.identity.recovery?.resourceId;
            if (!containerName) {
                this.ledger.requireOperatorDecision(
                    snapshot.identity.effectId,
                    "RecoveryMetadataInvalid",
                );
                continue;
            }
            const container = await this.containerByName(containerName);
            if (!container && snapshot.state === "prepared") {
                this.ledger.recordNoEffectFailure(
                    snapshot.identity.effectId,
                    "RecoveredBeforeEffect",
                );
                continue;
            }
            await this.cleanup(snapshot);
        }
    }

    private async containerByName(name: string): Promise<Dockerode.Container | undefined> {
        const matches = await this.docker.listContainers({
            all: true,
            filters: { name: [`^/${name}$`] },
        });
        return matches[0]?.Id ? this.docker.getContainer(matches[0].Id) : undefined;
    }
}

function quoteConnectionValue(value: string): string {
    return `"${value.replace(/"/gu, '""')}"`;
}

async function loadSqlService(extensionRoot: string): Promise<ISqlConnectionService> {
    const providerPath = path.join(extensionRoot, "dist", "tsNativeProvider.js");
    const stat = fs.lstatSync(providerPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
        throw codedError("HeadlessActivityHost.SqlProviderUnavailable");
    }
    const provider = require(providerPath) as SqlProviderModule;
    if (typeof provider.createBackend !== "function") {
        throw codedError("HeadlessActivityHost.SqlProviderUnavailable");
    }
    return provider.createBackend();
}

function ensureStateRoot(stateRoot: string): string {
    const root = path.resolve(stateRoot);
    fs.mkdirSync(root, { recursive: true });
    const stat = fs.lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw codedError("HeadlessActivityHost.StateRootInvalid");
    }
    return root;
}

async function chooseAvailablePort(start: number, exact: boolean): Promise<number> {
    const maximum = exact ? start : Math.min(65535, start + 100);
    for (let port = start; port <= maximum; port++) {
        if (await canListen(port)) {
            return port;
        }
    }
    throw codedError("HeadlessActivityHost.ContainerPortUnavailable");
}

function canListen(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.unref();
        server.once("error", () => resolve(false));
        server.listen({ host: "0.0.0.0", port, exclusive: true }, () => {
            server.close(() => resolve(true));
        });
    });
}

function validSqlPassword(value: string): boolean {
    if (value.length < 8 || value.length > 128) {
        return false;
    }
    return (
        [/[A-Z]/u, /[a-z]/u, /\d/u, /[!@#$%^&*]/u].filter((pattern) => pattern.test(value))
            .length >= 3
    );
}

function containerConnectionProfileId(effectId: string): string {
    return `runbook-container-profile:${effectId}`;
}

function runtimeCell(value: unknown): string | number | boolean | null {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
    }
    if (typeof value === "bigint") {
        return value.toString(10);
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (Buffer.isBuffer(value)) {
        return value.toString("base64");
    }
    const json = JSON.stringify(value);
    return typeof json === "string" ? json : String(value);
}

function isPidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === "EPERM";
    }
}

function codedError(code: string): Error & { code: string } {
    const error = new Error(code) as Error & { code: string };
    error.code = code;
    return error;
}

function sqlFailure(error: unknown): NodeExecution {
    const code =
        typeof (error as { code?: unknown })?.code === "string"
            ? (error as { code: string }).code
            : "HeadlessActivityHost.SqlActivityFailed";
    return {
        success: false,
        errorCode: code,
        message:
            "The no-VS-Code SQL activity failed without exposing connection or credential data.",
    };
}
