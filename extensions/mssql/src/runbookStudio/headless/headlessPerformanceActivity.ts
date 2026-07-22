/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** No-VS-Code workload, DMV, schema-fingerprint, and XEvent activity provider. */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { RunbookPlanNode } from "../../sharedInterfaces/runbookStudio";
import { MetadataStore } from "../../services/metadata/metadataStore";
import { MetadataStoreRunbookSchemaGraphProvider } from "../providers/schemaGraphProvider";
import { DataPlaneQueryCoreError } from "../providers/dataPlaneQueryCore";
import { digestRunbookValue } from "../runbookDigest";
import { deriveRunbookEffectId, RunbookEffectLedger } from "../runbookEffectLedger";
import {
    compareLocalPerformanceSnapshots,
    type LocalPerformanceDeltaResult,
} from "../runtime/localPerformanceDelta";
import {
    LOCAL_PERFORMANCE_SNAPSHOT_SQL,
    MAX_LOCAL_PERFORMANCE_SNAPSHOT_ROWS,
    projectLocalPerformanceSnapshot,
    type LocalPerformanceSnapshotResult,
} from "../runtime/localPerformanceSnapshot";
import {
    MAX_LOCAL_WORKLOAD_BYTES,
    parseLocalWorkload,
    summarizeLocalWorkloadMeasurements,
    type LocalWorkloadPlan,
} from "../runtime/localWorkload";
import {
    buildAnalyzeLocalXeventSql,
    buildReconcileLocalXeventSql,
    buildStartLocalXeventSql,
    buildStopLocalXeventSql,
    extractLocalXelFromDockerArchive,
    LOCAL_XEVENT_TEMPLATE,
    localXeventSessionName,
    MAX_LOCAL_XEL_ARCHIVE_BYTES,
    MAX_LOCAL_XEL_FILE_SIZE_MB,
    MAX_LOCAL_XEVENT_ANALYSIS_ROWS,
    MIN_LOCAL_XEL_FILE_SIZE_MB,
    validateLocalXelServerPath,
    workloadApplicationName,
} from "../runtime/localXevent";
import type {
    ActivityExecutionDelegate,
    ActivityInvocationIdentity,
    NodeExecution,
} from "../runtime/fakeRuntimeAdapter";
import type { RunbookSchemaFingerprintDocument } from "../../sharedInterfaces/runbookSchemaFingerprint";
import { HeadlessEffectAuthority } from "./headlessEffectAuthority";
import { HeadlessSqlActivityDelegate } from "./headlessSqlActivity";

const MAX_WORKLOAD_EXECUTIONS = 1000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u;

interface RetainedWorkload {
    runId: string;
    fileName: string;
    plan: LocalWorkloadPlan;
}

interface RetainedSnapshot {
    runId: string;
    containerEffectId: string;
    snapshot: LocalPerformanceSnapshotResult;
}

interface RetainedFingerprint {
    runId: string;
    containerEffectId: string;
    document: RunbookSchemaFingerprintDocument;
}

interface ActiveXevent {
    runId: string;
    databaseRef: string;
    containerEffectId: string;
    sessionName: string;
    sessionRef: string;
    invocation: ActivityInvocationIdentity;
}

interface RetainedCapture {
    runId: string;
    databaseRef: string;
    containerEffectId: string;
    startEffectId: string;
    sessionName: string;
    serverPath: string;
    eventCount: number;
    captureComplete: boolean;
}

export class HeadlessPerformanceActivityDelegate implements ActivityExecutionDelegate {
    public readonly runtimeKind = "local" as const;
    public readonly supportedActivityKinds = new Set([
        "sql.workload.inspect",
        "database.schema.fingerprint",
        "performance.dmv.snapshot",
        "performance.dmv.delta",
        "xevent.session.start",
        "sql.workload.run",
        "xevent.session.stop",
        "xevent.capture.reconcile",
        "xevent.xel.analyze",
        "xevent.xel.collect",
        "workload.benchmark",
    ]);
    private readonly ledger: RunbookEffectLedger;
    private readonly workloads = new Map<string, RetainedWorkload>();
    private readonly snapshots = new Map<string, RetainedSnapshot>();
    private readonly fingerprints = new Map<string, RetainedFingerprint>();
    private readonly activeXevents = new Map<string, ActiveXevent>();
    private readonly captures = new Map<string, RetainedCapture>();

    constructor(
        private readonly trustedWorkspaceRoot: string,
        private readonly artifactRoot: string,
        private readonly authority: HeadlessEffectAuthority,
        private readonly sql: HeadlessSqlActivityDelegate,
    ) {
        ensureDirectory(artifactRoot);
        this.ledger = new RunbookEffectLedger(artifactRoot);
    }

    public async executeActivity(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution | undefined> {
        if (!this.supportedActivityKinds.has(node.activityKind ?? "")) {
            return undefined;
        }
        try {
            switch (node.activityKind) {
                case "sql.workload.inspect":
                    return await this.inspectWorkload(node, binding);
                case "database.schema.fingerprint":
                    return await this.captureFingerprint(node, binding);
                case "performance.dmv.snapshot":
                    return await this.captureSnapshot(node, binding);
                case "performance.dmv.delta":
                    return await this.compareSnapshots(node, binding);
                case "xevent.session.start":
                    return await this.startXevent(node, binding);
                case "sql.workload.run":
                    return await this.runWorkload(node, binding);
                case "xevent.session.stop":
                    return await this.stopXevent(node, binding, true);
                case "xevent.capture.reconcile":
                    return await this.stopXevent(node, binding, false);
                case "xevent.xel.analyze":
                    return await this.analyzeXel(node, binding);
                case "xevent.xel.collect":
                    return await this.collectXel(node, binding);
                case "workload.benchmark":
                    return this.summarizeBenchmark(node, binding);
            }
        } catch (error) {
            return failure(error);
        }
        return undefined;
    }

    public async dispose(): Promise<void> {
        for (const active of [...this.activeXevents.values()]) {
            await this.reconcileActive(active).catch(() => undefined);
        }
        this.activeXevents.clear();
    }

    private async inspectWorkload(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution> {
        const requested = requiredString(binding.resolveBind(node.inputs?.file));
        const filePath = trustedWorkloadPath(this.trustedWorkspaceRoot, requested);
        if (binding.isCancellationRequested()) {
            throw codedError("HeadlessActivityHost.ActivityCancelled");
        }
        const bytes = fs.readFileSync(filePath);
        const plan = parseLocalWorkload(bytes);
        const workloadRef = `runbook-workload:${plan.workloadSha256}:${crypto.randomUUID()}`;
        boundedSet(this.workloads, workloadRef, {
            runId: binding.invocation.runId,
            fileName: path.basename(filePath),
            plan,
        });
        return {
            success: true,
            message: `Inspected '${path.basename(filePath)}' as ${plan.batchCount} workload batch(es).`,
            runMetrics: {
                "workload.batchCount": plan.batchCount,
                "workload.sourceByteCount": plan.sourceByteCount,
                "workload.mutating": plan.mutating,
            },
            output: {
                contract: "workloadPreview/1",
                scalars: {
                    workloadRef,
                    fileName: path.basename(filePath),
                    workloadSha256: plan.workloadSha256,
                    workloadFingerprint: plan.workloadSha256,
                    sourceByteCount: plan.sourceByteCount,
                    batchCount: plan.batchCount,
                    mutating: plan.mutating,
                    inspectedAtUtc: new Date().toISOString(),
                    executionMode: "headless",
                },
            },
            values: {
                workloadRef,
                workloadSha256: plan.workloadSha256,
                workloadFingerprint: plan.workloadSha256,
                batchCount: plan.batchCount,
                mutating: plan.mutating,
            },
        };
    }

    private async runWorkload(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution> {
        const databaseRef = requiredString(binding.resolveBind(node.inputs?.database));
        const workloadRef = requiredString(binding.resolveBind(node.inputs?.workload));
        const workloadDigest = sha256Value(binding.resolveBind(node.inputs?.workloadDigest));
        const repetitions = boundedInteger(
            binding.resolveBind(node.inputs?.repetitions) ?? 1,
            1,
            100,
        );
        const timeoutSeconds = boundedInteger(
            binding.resolveBind(node.inputs?.timeoutSeconds) ?? 300,
            1,
            3600,
        );
        const retained = this.workloads.get(workloadRef);
        if (
            !retained ||
            retained.runId !== binding.invocation.runId ||
            retained.plan.workloadSha256 !== workloadDigest ||
            retained.plan.batchCount * repetitions > MAX_WORKLOAD_EXECUTIONS
        ) {
            throw codedError("HeadlessActivityHost.WorkloadPreviewChanged");
        }
        const target = await this.sql.resolveOwnedConnection(databaseRef, binding.invocation);
        const authorization = this.authority.require(
            node.id,
            "sql.workload.run",
            binding.invocation,
        );
        const effectId = prepareEffect(
            this.ledger,
            node,
            binding.invocation,
            authorization,
            "sql.workload.run",
            "workloadExecution",
            target,
            { workloadDigest, repetitions, timeoutSeconds },
        );
        const results: Array<{
            iteration: number;
            batch: number;
            durationMs: number;
            rowCount: number;
            succeeded: boolean;
            errorCode: string;
        }> = [];
        const startedAt = Date.now();
        let observed = false;
        let stop = false;
        for (let iteration = 1; iteration <= repetitions && !stop; iteration++) {
            for (let batch = 0; batch < retained.plan.batches.length; batch++) {
                if (binding.isCancellationRequested()) {
                    throw codedError("HeadlessActivityHost.ActivityCancelled");
                }
                if (!observed) {
                    this.ledger.recordEffectObserved(effectId, {
                        resourceKind: "workloadExecution",
                        resourceId: target.databaseName,
                        connectionProfileId: target.connectionRef,
                        ownershipMarkerDigest: digestRunbookValue(target.effectId),
                        outputHandles: [databaseRef, workloadRef],
                    });
                    observed = true;
                }
                const batchStartedAt = Date.now();
                try {
                    const result = await this.sql.executeOwnedSql(
                        databaseRef,
                        retained.plan.batches[batch],
                        binding.invocation,
                        binding.isCancellationRequested,
                        {
                            tag: "runbook.workload.execute",
                            maxRows: 1000,
                            timeoutMs: timeoutSeconds * 1000,
                            applicationName: workloadApplicationName(binding.invocation.runId),
                        },
                    );
                    results.push({
                        iteration,
                        batch: batch + 1,
                        durationMs: Date.now() - batchStartedAt,
                        rowCount: safeNonnegativeInteger(result.completion.rowsAffected),
                        succeeded: true,
                        errorCode: "",
                    });
                } catch (error) {
                    if (binding.isCancellationRequested()) {
                        throw codedError("HeadlessActivityHost.ActivityCancelled");
                    }
                    results.push({
                        iteration,
                        batch: batch + 1,
                        durationMs: Date.now() - batchStartedAt,
                        rowCount: 0,
                        succeeded: false,
                        errorCode: workloadErrorCode(error),
                    });
                    stop = true;
                    break;
                }
            }
        }
        const failedBatchCount = results.filter((item) => !item.succeeded).length;
        const totalDurationMs = Date.now() - startedAt;
        const measurements = summarizeLocalWorkloadMeasurements(results, retained.plan.batchCount);
        this.ledger.finalizeEffect(
            effectId,
            digestRunbookValue({
                effectId,
                workloadDigest,
                executedBatchCount: results.length,
                failedBatchCount,
                totalDurationMs,
                ...measurements,
            }),
        );
        this.workloads.delete(workloadRef);
        const succeeded = failedBatchCount === 0;
        return {
            success: succeeded,
            verdict: succeeded ? "pass" : "fail",
            ...(succeeded ? {} : { errorCode: "RunbookStudio.WorkloadFailed" }),
            message: succeeded
                ? `Executed ${results.length} workload batch(es).`
                : `${failedBatchCount} workload batch(es) failed.`,
            runMetrics: {
                "workload.plannedBatchCount": retained.plan.batchCount * repetitions,
                "workload.executedBatchCount": results.length,
                "workload.failedBatchCount": failedBatchCount,
                "workload.totalDurationMs": totalDurationMs,
                "workload.measurementSampleCount": measurements.measurementSampleCount,
                "workload.meanDurationMs": measurements.meanDurationMs,
                "workload.p95DurationMs": measurements.p95DurationMs,
            },
            output: {
                contract: "workloadResults/1",
                columns: ["iteration", "batch", "durationMs", "rowCount", "succeeded", "errorCode"],
                rows: results.map((item) => [
                    item.iteration,
                    item.batch,
                    item.durationMs,
                    item.rowCount,
                    item.succeeded,
                    item.errorCode,
                ]),
                scalars: {
                    effectId,
                    workloadSha256: workloadDigest,
                    plannedBatchCount: retained.plan.batchCount * repetitions,
                    executedBatchCount: results.length,
                    failedBatchCount,
                    totalDurationMs,
                    repetitions,
                    ...measurements,
                    completedAtUtc: new Date().toISOString(),
                    executionMode: "headless",
                },
            },
            values: {
                succeeded,
                executedBatchCount: results.length,
                failedBatchCount,
                totalDurationMs,
                repetitions,
                ...measurements,
            },
        };
    }

    private async captureFingerprint(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution> {
        const databaseRef = requiredString(binding.resolveBind(node.inputs?.database));
        const target = await this.sql.resolveOwnedConnection(databaseRef, binding.invocation);
        const context = await this.sql.ownedMetadataContext(databaseRef, binding.invocation);
        const store = new MetadataStore(() => Promise.resolve(context.service), {
            idleTtlMs: 0,
            maxIdleDatabases: 0,
        });
        try {
            const document = await new MetadataStoreRunbookSchemaGraphProvider(store).fingerprint({
                prepared: context.prepared,
                database: context.database,
                isCancellationRequested: binding.isCancellationRequested,
            });
            const fingerprintRef = `runbook-schema-fingerprint:${crypto.randomUUID()}`;
            boundedSet(this.fingerprints, fingerprintRef, {
                runId: binding.invocation.runId,
                containerEffectId: target.effectId,
                document,
            });
            return {
                success: true,
                message: `Captured a complete-catalog identity for '${document.databaseLabel}'.`,
                runMetrics: {
                    "schemaFingerprint.complete": document.complete,
                    "schemaFingerprint.tableCount": document.tableCount,
                },
                output: {
                    contract: "databaseSchemaFingerprint/1",
                    columns: ["property", "value"],
                    rows: [
                        ["schemaSha256", document.schemaSha256],
                        ["complete", document.complete],
                        ["tableCount", document.tableCount],
                    ],
                    scalars: {
                        schemaSha256: document.schemaSha256,
                        schemaFingerprintRef: fingerprintRef,
                        complete: document.complete,
                        tableCount: document.tableCount,
                        capturedAtUtc: document.capturedAtUtc,
                        providerKind: document.provider.kind,
                        executionMode: "headless",
                    },
                },
                values: {
                    schemaSha256: document.schemaSha256,
                    schemaFingerprintRef: fingerprintRef,
                    complete: document.complete,
                    tableCount: document.tableCount,
                },
            };
        } finally {
            store.dispose();
        }
    }

    private async captureSnapshot(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution> {
        const databaseRef = requiredString(binding.resolveBind(node.inputs?.database));
        const target = await this.sql.resolveOwnedConnection(databaseRef, binding.invocation);
        const result = await this.sql.executeOwnedSql(
            databaseRef,
            LOCAL_PERFORMANCE_SNAPSHOT_SQL,
            binding.invocation,
            binding.isCancellationRequested,
            {
                tag: "runbook.performance.snapshot",
                maxRows: MAX_LOCAL_PERFORMANCE_SNAPSHOT_ROWS,
            },
        );
        const snapshot = projectLocalPerformanceSnapshot(result.rows);
        const snapshotRef = `runbook-performance-snapshot:${crypto.randomUUID()}`;
        boundedSet(this.snapshots, snapshotRef, {
            runId: binding.invocation.runId,
            containerEffectId: target.effectId,
            snapshot,
        });
        return {
            success: true,
            message: `Captured ${snapshot.rows.length} performance metric(s).`,
            runMetrics: {
                "performance.metricCount": snapshot.rows.length,
                "performance.totalMetricCount": snapshot.totalMetricCount,
                "performance.snapshotTruncated": snapshot.truncated,
            },
            output: {
                contract: "performanceSnapshot/1",
                columns: ["capturedAtUtc", "scope", "category", "item", "metric", "value", "unit"],
                rows: snapshot.rows.map((row) => [
                    row.capturedAtUtc,
                    row.scope,
                    row.category,
                    row.item,
                    row.metric,
                    row.value,
                    row.unit,
                ]),
                scalars: {
                    capturedAtUtc: snapshot.capturedAtUtc,
                    metricCount: snapshot.rows.length,
                    totalMetricCount: snapshot.totalMetricCount,
                    snapshotSha256: snapshot.snapshotSha256,
                    snapshotRef,
                    truncated: snapshot.truncated,
                    executionMode: "headless",
                },
            },
            values: {
                capturedAtUtc: snapshot.capturedAtUtc,
                metricCount: snapshot.rows.length,
                totalMetricCount: snapshot.totalMetricCount,
                snapshotSha256: snapshot.snapshotSha256,
                snapshotRef,
                truncated: snapshot.truncated,
            },
        };
    }

    private async compareSnapshots(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution> {
        const databaseRef = requiredString(binding.resolveBind(node.inputs?.database));
        const target = await this.sql.resolveOwnedConnection(databaseRef, binding.invocation);
        const beforeRef = requiredString(binding.resolveBind(node.inputs?.before));
        const afterRef = requiredString(binding.resolveBind(node.inputs?.after));
        const beforeSchemaRef = requiredString(binding.resolveBind(node.inputs?.beforeSchema));
        const afterSchemaRef = requiredString(binding.resolveBind(node.inputs?.afterSchema));
        const before = this.snapshots.get(beforeRef);
        const after = this.snapshots.get(afterRef);
        const beforeSchema = this.fingerprints.get(beforeSchemaRef);
        const afterSchema = this.fingerprints.get(afterSchemaRef);
        if (
            beforeRef === afterRef ||
            beforeSchemaRef === afterSchemaRef ||
            !sameOwnedRun(before, binding.invocation, target.effectId) ||
            !sameOwnedRun(after, binding.invocation, target.effectId) ||
            !sameOwnedRun(beforeSchema, binding.invocation, target.effectId) ||
            !sameOwnedRun(afterSchema, binding.invocation, target.effectId)
        ) {
            throw codedError("HeadlessActivityHost.PerformanceReferenceInvalid");
        }
        const delta = compareLocalPerformanceSnapshots(before.snapshot, after.snapshot, {
            beforeSchemaSha256: beforeSchema.document.schemaSha256,
            afterSchemaSha256: afterSchema.document.schemaSha256,
            beforeComplete: beforeSchema.document.complete,
            afterComplete: afterSchema.document.complete,
        });
        return deltaExecution(delta);
    }

    private async startXevent(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution> {
        const databaseRef = requiredString(binding.resolveBind(node.inputs?.database));
        const template = requiredString(binding.resolveBind(node.inputs?.template));
        const maxFileSizeMb = boundedInteger(
            binding.resolveBind(node.inputs?.maxFileSizeMb) ?? 16,
            MIN_LOCAL_XEL_FILE_SIZE_MB,
            MAX_LOCAL_XEL_FILE_SIZE_MB,
        );
        if (template !== LOCAL_XEVENT_TEMPLATE) {
            throw codedError("HeadlessActivityHost.XeventPolicyInvalid");
        }
        const target = await this.sql.resolveOwnedConnection(databaseRef, binding.invocation);
        const authorization = this.authority.require(
            node.id,
            "xevent.session.start",
            binding.invocation,
        );
        const effectId = prepareEffect(
            this.ledger,
            node,
            binding.invocation,
            authorization,
            "xevent.session.start",
            "xeventSession",
            target,
            { template, maxFileSizeMb },
            (derivedEffectId) => localXeventSessionName(derivedEffectId),
        );
        const sessionName = localXeventSessionName(effectId);
        const sessionRef = `runbook-xevent-session:${effectId}`;
        const active: ActiveXevent = {
            runId: binding.invocation.runId,
            databaseRef,
            containerEffectId: target.effectId,
            sessionName,
            sessionRef,
            invocation: binding.invocation,
        };
        this.activeXevents.set(sessionRef, active);
        await this.sql.executeOwnedSql(
            databaseRef,
            buildStartLocalXeventSql(sessionName, template, maxFileSizeMb),
            binding.invocation,
            binding.isCancellationRequested,
            { tag: "runbook.xevent.start", maxRows: 1 },
        );
        this.ledger.recordEffectObserved(effectId, {
            resourceKind: "xeventSession",
            resourceId: sessionName,
            connectionProfileId: target.connectionRef,
            ownershipMarkerDigest: digestRunbookValue(target.effectId),
            outputHandles: [sessionRef, databaseRef],
        });
        return {
            success: true,
            message: `Started owned XEvent session '${sessionName}'.`,
            runMetrics: { "xevent.sessionStarted": true },
            output: {
                contract: "xeventSessionLease/1",
                scalars: {
                    effectId,
                    sessionRef,
                    sessionName,
                    template,
                    maxFileSizeMb,
                    startedAtUtc: new Date().toISOString(),
                    executionMode: "headless",
                },
            },
            values: { sessionRef, sessionName, template },
        };
    }

    private async stopXevent(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
        complete: boolean,
    ): Promise<NodeExecution> {
        const databaseRef = requiredString(binding.resolveBind(node.inputs?.database));
        const sessionRef = requiredString(binding.resolveBind(node.inputs?.session));
        const active = this.activeXevents.get(sessionRef);
        const target = await this.sql.resolveOwnedConnection(databaseRef, binding.invocation);
        if (
            !active ||
            active.runId !== binding.invocation.runId ||
            active.databaseRef !== databaseRef ||
            active.containerEffectId !== target.effectId
        ) {
            throw codedError("HeadlessActivityHost.XeventReferenceInvalid");
        }
        const effectId = effectIdFromSessionRef(sessionRef);
        const rows = await this.sql.executeOwnedSql(
            databaseRef,
            complete
                ? buildStopLocalXeventSql(active.sessionName)
                : buildReconcileLocalXeventSql(active.sessionName),
            binding.invocation,
            binding.isCancellationRequested,
            { tag: complete ? "runbook.xevent.stop" : "runbook.xevent.reconcile", maxRows: 1 },
        );
        const serverPath = validateLocalXelServerPath(
            active.sessionName,
            requiredString(rows.rows[0]?.[0]),
        );
        const eventCount = safeInteger(rows.rows[0]?.[1]);
        let snapshot = this.ledger.recoverEffect(effectId)?.snapshot;
        if (!snapshot) {
            throw codedError("HeadlessActivityHost.EffectRecoveryRequired");
        }
        if (snapshot.state === "prepared") {
            snapshot = this.ledger.recordEffectObserved(effectId, {
                resourceKind: "xeventSession",
                resourceId: active.sessionName,
                connectionProfileId: target.connectionRef,
                ownershipMarkerDigest: digestRunbookValue(target.effectId),
                outputHandles: [sessionRef, databaseRef],
            });
        }
        if (snapshot.state === "effectObserved") {
            snapshot = this.ledger.startCleanup(effectId);
        }
        if (snapshot.state === "cleanupStarted") {
            snapshot = this.ledger.completeCleanup(
                effectId,
                digestRunbookValue({ effectId, serverPath, eventCount, complete }),
            );
        }
        const captureRef = `runbook-xevent-capture:${effectId}`;
        boundedSet(this.captures, captureRef, {
            runId: binding.invocation.runId,
            databaseRef,
            containerEffectId: target.effectId,
            startEffectId: effectId,
            sessionName: active.sessionName,
            serverPath,
            eventCount,
            captureComplete: complete,
        });
        this.activeXevents.delete(sessionRef);
        const reconciliationStatus = complete ? "complete" : "recoveredIncomplete";
        return {
            success: true,
            message: complete
                ? `Stopped owned XEvent session '${active.sessionName}'.`
                : `Reconciled interrupted XEvent session '${active.sessionName}'.`,
            runMetrics: {
                "xevent.sessionStopped": complete,
                "xevent.captureReconciled": !complete,
                "xevent.eventCount": eventCount,
                "xevent.captureComplete": complete,
            },
            output: {
                contract: complete ? "xeventCapture/1" : "captureIntegrity/1",
                scalars: {
                    effectId,
                    captureRef,
                    sessionName: active.sessionName,
                    eventFileName: path.posix.basename(serverPath),
                    eventCount,
                    captureComplete: complete,
                    reconciliationStatus,
                    stoppedAtUtc: new Date(snapshot.lastUpdatedEpochMs).toISOString(),
                    executionMode: "headless",
                },
            },
            values: {
                captureRef,
                sessionName: active.sessionName,
                eventFileName: path.posix.basename(serverPath),
                eventCount,
                captureComplete: complete,
                reconciliationStatus,
            },
        };
    }

    private async analyzeXel(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution> {
        const databaseRef = requiredString(binding.resolveBind(node.inputs?.database));
        const captureRef = requiredString(binding.resolveBind(node.inputs?.capture));
        const capture = await this.requireCapture(databaseRef, captureRef, binding.invocation);
        const target = await this.sql.resolveOwnedConnection(databaseRef, binding.invocation);
        const result = await this.sql.executeOwnedSql(
            databaseRef,
            buildAnalyzeLocalXeventSql(
                capture.sessionName,
                capture.serverPath,
                target.databaseName,
                workloadApplicationName(binding.invocation.runId),
            ),
            binding.invocation,
            binding.isCancellationRequested,
            { tag: "runbook.xevent.analyze", maxRows: MAX_LOCAL_XEVENT_ANALYSIS_ROWS },
        );
        const rows = result.rows.map((row) => ({
            timestampUtc: displayString(row[0]),
            eventName: displayString(row[1]),
            durationMs: metric(row[2]),
            cpuMs: metric(row[3]),
            logicalReads: metric(row[4]),
            physicalReads: metric(row[5]),
            writes: metric(row[6]),
            rowCount: metric(row[7]),
            objectName: displayString(row[8]),
            errorNumber: metric(row[9]),
        }));
        const first = result.rows[0];
        const totals = {
            eventCount: first ? metric(first[10]) : 0,
            durationMs: first ? metric(first[11]) : 0,
            cpuMs: first ? metric(first[12]) : 0,
            logicalReads: first ? metric(first[13]) : 0,
            physicalReads: first ? metric(first[14]) : 0,
            writes: first ? metric(first[15]) : 0,
        };
        return {
            success: true,
            message: `Analyzed ${totals.eventCount} XEvent event(s).`,
            runMetrics: {
                "xevent.analyzedEventCount": totals.eventCount,
                "xevent.logicalReads": totals.logicalReads,
                "xevent.physicalReads": totals.physicalReads,
                "xevent.writes": totals.writes,
                "xevent.analysisTruncated": totals.eventCount > rows.length,
            },
            output: {
                contract: "xeventAnalysis/1",
                columns: [
                    "timestampUtc",
                    "eventName",
                    "durationMs",
                    "cpuMs",
                    "logicalReads",
                    "physicalReads",
                    "writes",
                    "rowCount",
                    "objectName",
                    "errorNumber",
                ],
                rows: rows.map((row) => Object.values(row)),
                scalars: {
                    ...totals,
                    truncated: totals.eventCount > rows.length,
                    executionMode: "headless",
                },
            },
            values: totals,
        };
    }

    private async collectXel(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): Promise<NodeExecution> {
        const databaseRef = requiredString(binding.resolveBind(node.inputs?.database));
        const captureRef = requiredString(binding.resolveBind(node.inputs?.capture));
        const capture = await this.requireCapture(databaseRef, captureRef, binding.invocation);
        const archive = await this.sql.readOwnedContainerArchive(
            databaseRef,
            capture.serverPath,
            binding.invocation,
            MAX_LOCAL_XEL_ARCHIVE_BYTES,
            binding.isCancellationRequested,
        );
        const bytes = extractLocalXelFromDockerArchive(
            archive,
            path.posix.basename(capture.serverPath),
        );
        const artifact = retainBytes(
            this.artifactRoot,
            binding.invocation,
            node.id,
            path.posix.basename(capture.serverPath),
            bytes,
        );
        return {
            success: true,
            message: `Retained ${artifact.size} bytes of XEvent evidence.`,
            runMetrics: {
                "xevent.artifactSizeBytes": artifact.size,
                "xevent.eventCount": capture.eventCount,
                "xevent.captureComplete": capture.captureComplete,
            },
            output: {
                contract: "xelArtifact/1",
                scalars: {
                    sessionName: capture.sessionName,
                    artifactPath: artifact.path,
                    artifactSizeBytes: artifact.size,
                    artifactSha256: artifact.sha256,
                    eventCount: capture.eventCount,
                    captureComplete: capture.captureComplete,
                    collectedAtUtc: new Date().toISOString(),
                    executionMode: "headless",
                },
            },
            values: {
                artifactPath: artifact.path,
                artifactSizeBytes: artifact.size,
                artifactSha256: artifact.sha256,
                eventCount: capture.eventCount,
                captureComplete: capture.captureComplete,
            },
        };
    }

    private summarizeBenchmark(
        node: RunbookPlanNode,
        binding: Parameters<ActivityExecutionDelegate["executeActivity"]>[1],
    ): NodeExecution {
        const workloadFingerprint = sha256Value(
            binding.resolveBind(node.inputs?.workloadFingerprint),
        );
        const environmentFingerprint = sha256Value(
            binding.resolveBind(node.inputs?.environmentFingerprint),
        );
        const requiredMetrics = {
            durationMs: metric(binding.resolveBind(node.inputs?.workloadDurationMs)),
            executedBatchCount: metric(binding.resolveBind(node.inputs?.executedBatchCount)),
            failedBatchCount: metric(binding.resolveBind(node.inputs?.failedBatchCount)),
            repetitions: metric(binding.resolveBind(node.inputs?.repetitions)),
            measurementSampleCount: metric(
                binding.resolveBind(node.inputs?.measurementSampleCount),
            ),
            meanDurationMs: metric(binding.resolveBind(node.inputs?.meanDurationMs)),
            p50DurationMs: metric(binding.resolveBind(node.inputs?.p50DurationMs)),
            p95DurationMs: metric(binding.resolveBind(node.inputs?.p95DurationMs)),
            minDurationMs: metric(binding.resolveBind(node.inputs?.minDurationMs)),
            maxDurationMs: metric(binding.resolveBind(node.inputs?.maxDurationMs)),
            standardDeviationMs: metric(binding.resolveBind(node.inputs?.standardDeviationMs)),
        };
        const metrics = [
            ["duration", requiredMetrics.durationMs, "ms"],
            ["executed batches", requiredMetrics.executedBatchCount, "count"],
            ["failed batches", requiredMetrics.failedBatchCount, "count"],
            ["repetitions", requiredMetrics.repetitions, "count"],
            ["measurement samples", requiredMetrics.measurementSampleCount, "count"],
            ["mean duration", requiredMetrics.meanDurationMs, "ms"],
            ["p50 duration", requiredMetrics.p50DurationMs, "ms"],
            ["p95 duration", requiredMetrics.p95DurationMs, "ms"],
            ["minimum duration", requiredMetrics.minDurationMs, "ms"],
            ["maximum duration", requiredMetrics.maxDurationMs, "ms"],
            ["duration standard deviation", requiredMetrics.standardDeviationMs, "ms"],
        ] as Array<[string, number, string]>;
        for (const [input, label, unit] of [
            ["xeventDurationMs", "XEvent duration", "ms"],
            ["xeventCpuMs", "XEvent CPU", "ms"],
            ["logicalReads", "logical reads", "pages"],
            ["physicalReads", "physical reads", "pages"],
            ["writes", "writes", "count"],
        ] as const) {
            const value = binding.resolveBind(node.inputs?.[input]);
            if (value !== undefined) {
                metrics.push([label, metric(value), unit]);
            }
        }
        return {
            success: true,
            message: `Produced ${metrics.length} factual workload metric(s).`,
            runMetrics: {
                "benchmark.durationMs": requiredMetrics.durationMs,
                "benchmark.executedBatchCount": requiredMetrics.executedBatchCount,
                "benchmark.failedBatchCount": requiredMetrics.failedBatchCount,
            },
            output: {
                contract: "performanceMetrics/1",
                columns: ["metric", "value", "unit"],
                rows: metrics,
                scalars: {
                    ...requiredMetrics,
                    workloadFingerprint,
                    environmentFingerprint,
                    executionMode: "headless",
                },
            },
            values: { ...requiredMetrics, workloadFingerprint, environmentFingerprint },
        };
    }

    private async requireCapture(
        databaseRef: string,
        captureRef: string,
        invocation: ActivityInvocationIdentity,
    ): Promise<RetainedCapture> {
        const target = await this.sql.resolveOwnedConnection(databaseRef, invocation);
        const capture = this.captures.get(captureRef);
        if (
            !capture ||
            capture.runId !== invocation.runId ||
            capture.databaseRef !== databaseRef ||
            capture.containerEffectId !== target.effectId ||
            capture.startEffectId !== effectIdFromCaptureRef(captureRef)
        ) {
            throw codedError("HeadlessActivityHost.XeventReferenceInvalid");
        }
        return capture;
    }

    private async reconcileActive(active: ActiveXevent): Promise<void> {
        const effectId = effectIdFromSessionRef(active.sessionRef);
        const result = await this.sql.executeOwnedSql(
            active.databaseRef,
            buildReconcileLocalXeventSql(active.sessionName),
            active.invocation,
            () => false,
            { tag: "runbook.xevent.dispose-reconcile", maxRows: 1 },
        );
        const serverPath = validateLocalXelServerPath(
            active.sessionName,
            requiredString(result.rows[0]?.[0]),
        );
        const eventCount = safeInteger(result.rows[0]?.[1]);
        let snapshot = this.ledger.recoverEffect(effectId)?.snapshot;
        if (!snapshot) {
            return;
        }
        if (snapshot.state === "prepared") {
            const target = await this.sql.resolveOwnedConnection(
                active.databaseRef,
                active.invocation,
            );
            snapshot = this.ledger.recordEffectObserved(effectId, {
                resourceKind: "xeventSession",
                resourceId: active.sessionName,
                connectionProfileId: target.connectionRef,
                ownershipMarkerDigest: digestRunbookValue(target.effectId),
                outputHandles: [active.sessionRef, active.databaseRef],
            });
        }
        if (snapshot.state === "effectObserved") {
            snapshot = this.ledger.startCleanup(effectId);
        }
        if (snapshot.state === "cleanupStarted") {
            this.ledger.completeCleanup(
                effectId,
                digestRunbookValue({ effectId, serverPath, eventCount, disposed: true }),
            );
        }
    }
}

function deltaExecution(delta: LocalPerformanceDeltaResult): NodeExecution {
    return {
        success: true,
        message: `Compared ${delta.rows.length} performance metric(s).`,
        runMetrics: {
            "performance.deltaMetricCount": delta.rows.length,
            "performance.comparableMetricCount": delta.comparableMetricCount,
            "performance.incompleteMetricCount": delta.incompleteMetricCount,
            "performance.counterResetMetricCount": delta.counterResetMetricCount,
        },
        output: {
            contract: "performanceDelta/1",
            columns: [
                "scope",
                "category",
                "item",
                "metric",
                "unit",
                "beforeValue",
                "afterValue",
                "deltaValue",
                "comparability",
            ],
            rows: delta.rows.map((row) => [
                row.scope,
                row.category,
                row.item,
                row.metric,
                row.unit,
                row.beforeValue,
                row.afterValue,
                row.deltaValue,
                row.comparability,
            ]),
            scalars: {
                deltaSha256: delta.deltaSha256,
                metricCount: delta.rows.length,
                comparableMetricCount: delta.comparableMetricCount,
                incompleteMetricCount: delta.incompleteMetricCount,
                counterResetMetricCount: delta.counterResetMetricCount,
                schemaComparability: delta.schemaComparability,
                inputTruncated: delta.inputTruncated,
                truncated: delta.truncated,
                executionMode: "headless",
            },
        },
        values: {
            deltaSha256: delta.deltaSha256,
            metricCount: delta.rows.length,
            comparableMetricCount: delta.comparableMetricCount,
            incompleteMetricCount: delta.incompleteMetricCount,
            counterResetMetricCount: delta.counterResetMetricCount,
            schemaComparability: delta.schemaComparability,
            inputTruncated: delta.inputTruncated,
            truncated: delta.truncated,
        },
    };
}

function prepareEffect(
    ledger: RunbookEffectLedger,
    node: RunbookPlanNode,
    invocation: ActivityInvocationIdentity,
    authorization: ReturnType<HeadlessEffectAuthority["require"]>,
    activityKind: string,
    resourceKind: string,
    target: {
        effectId: string;
        connectionRef: string;
        containerName: string;
        databaseName: string;
    },
    idempotency: unknown,
    resourceId?: (effectId: string) => string,
): string {
    const effectId = deriveRunbookEffectId({
        runId: invocation.runId,
        nodeId: node.id,
        attempt: invocation.attempt,
        activityKind,
        activityVersion: authorization.challenge.activityVersion,
    });
    if (ledger.recoverEffect(effectId)) {
        throw codedError("HeadlessActivityHost.EffectRecoveryRequired");
    }
    ledger.prepareEffect({
        effectId,
        runId: invocation.runId,
        nodeId: node.id,
        attempt: invocation.attempt,
        activityKind,
        activityVersion: authorization.challenge.activityVersion,
        idempotencyKey: digestRunbookValue({ effectId, idempotency }),
        planHash: invocation.planHash,
        bindingDigest: authorization.challenge.resolvedArgumentDigest,
        targetFingerprint: authorization.challenge.targetFingerprint,
        retrySemantics: "atMostOnceUnknownOutcome",
        ownerPid: process.pid,
        policy: { version: authorization.challenge.policyVersion, outcome: "allowed" },
        approval: authorization.evidence,
        recovery: {
            resourceKind,
            resourceId: resourceId?.(effectId) ?? target.databaseName,
            connectionProfileId: target.connectionRef,
            ownershipMarkerDigest: digestRunbookValue(target.effectId),
        },
    });
    return effectId;
}

function trustedWorkloadPath(rootValue: string, requested: string): string {
    const root = fs.realpathSync(path.resolve(rootValue));
    const candidate = fs.realpathSync(
        path.resolve(path.isAbsolute(requested) ? requested : path.join(root, requested)),
    );
    const relative = path.relative(root, candidate);
    const stat = fs.lstatSync(candidate);
    if (
        relative === "" ||
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative) ||
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size <= 0 ||
        stat.size > MAX_LOCAL_WORKLOAD_BYTES ||
        path.extname(candidate).toLowerCase() !== ".sql"
    ) {
        throw codedError("HeadlessActivityHost.WorkloadPathInvalid");
    }
    return candidate;
}

function retainBytes(
    artifactRoot: string,
    invocation: ActivityInvocationIdentity,
    nodeId: string,
    fileName: string,
    bytes: Buffer,
) {
    if (
        !SAFE_ID.test(invocation.runId) ||
        !SAFE_ID.test(nodeId) ||
        path.basename(fileName) !== fileName
    ) {
        throw codedError("HeadlessActivityHost.ArtifactPathInvalid");
    }
    const runDirectory = path.join(ensureDirectory(artifactRoot), invocation.runId);
    fs.mkdirSync(runDirectory, { recursive: true });
    const artifactPath = path.join(runDirectory, `${nodeId}.${fileName}`);
    const descriptor = fs.openSync(artifactPath, "wx", 0o600);
    try {
        fs.writeFileSync(descriptor, bytes);
        fs.fsyncSync(descriptor);
    } finally {
        fs.closeSync(descriptor);
    }
    return {
        path: artifactPath,
        size: bytes.byteLength,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    };
}

function ensureDirectory(value: string): string {
    const resolved = path.resolve(value);
    fs.mkdirSync(resolved, { recursive: true });
    const stat = fs.lstatSync(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw codedError("HeadlessActivityHost.ArtifactPathInvalid");
    }
    return resolved;
}

function sameOwnedRun<T extends { runId: string; containerEffectId: string }>(
    value: T | undefined,
    invocation: ActivityInvocationIdentity,
    containerEffectId: string,
): value is T {
    return value?.runId === invocation.runId && value.containerEffectId === containerEffectId;
}

function effectIdFromSessionRef(value: string): string {
    const match = /^runbook-xevent-session:(effect-[a-f0-9]{64})$/iu.exec(value);
    if (!match) {
        throw codedError("HeadlessActivityHost.XeventReferenceInvalid");
    }
    return match[1];
}

function effectIdFromCaptureRef(value: string): string {
    const match = /^runbook-xevent-capture:(effect-[a-f0-9]{64})$/iu.exec(value);
    if (!match) {
        throw codedError("HeadlessActivityHost.XeventReferenceInvalid");
    }
    return match[1];
}

function requiredString(value: unknown): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw codedError("HeadlessActivityHost.BindingInvalid");
    }
    return value.trim();
}

function sha256Value(value: unknown): string {
    const normalized = requiredString(value)
        .replace(/^sha256:/u, "")
        .toLowerCase();
    if (!/^[a-f0-9]{64}$/u.test(normalized)) {
        throw codedError("HeadlessActivityHost.BindingInvalid");
    }
    return normalized;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
    if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < minimum ||
        value > maximum
    ) {
        throw codedError("HeadlessActivityHost.BindingInvalid");
    }
    return value;
}

function safeInteger(value: unknown): number {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isSafeInteger(numeric) || numeric < 0) {
        throw codedError("HeadlessActivityHost.ResultInvalid");
    }
    return numeric;
}

function safeNonnegativeInteger(value: unknown): number {
    const numeric = typeof value === "number" ? value : Number(value ?? 0);
    return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : 0;
}

function metric(value: unknown): number {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
        throw codedError("HeadlessActivityHost.ResultInvalid");
    }
    return numeric;
}

function displayString(value: unknown): string {
    if (value === null || value === undefined) {
        return "";
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    if (value instanceof Date && Number.isFinite(value.getTime())) {
        return value.toISOString();
    }
    throw codedError("HeadlessActivityHost.ResultInvalid");
}

function workloadErrorCode(error: unknown): string {
    if (error instanceof DataPlaneQueryCoreError) {
        if (error.code === "cancelled") {
            return "RunbookStudio.WorkloadBatchTimeout";
        }
        const suffix = [
            error.diagnostic?.completionStatus,
            error.diagnostic?.providerCode,
            error.diagnostic?.serverNumber,
        ]
            .filter((value) => value !== undefined)
            .join(".")
            .replace(/[^A-Za-z0-9_.-]/gu, "_");
        return suffix
            ? `RunbookStudio.WorkloadBatchFailed.${suffix}`
            : "RunbookStudio.WorkloadBatchFailed";
    }
    return "RunbookStudio.WorkloadBatchFailed";
}

function boundedSet<T>(map: Map<string, T>, key: string, value: T): void {
    map.set(key, value);
    while (map.size > 64) {
        map.delete(map.keys().next().value!);
    }
}

function codedError(code: string): Error & { code: string } {
    const error = new Error(code) as Error & { code: string };
    error.code = code;
    return error;
}

function failure(error: unknown): NodeExecution {
    return {
        success: false,
        errorCode:
            typeof (error as { code?: unknown })?.code === "string"
                ? (error as { code: string }).code
                : "HeadlessActivityHost.PerformanceActivityFailed",
        message:
            "The no-VS-Code workload or performance activity failed without exposing SQL, credentials, or application data.",
    };
}
