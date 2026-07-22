/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * RunbookStudioService (A2 §4): the activation-owned coordinator behind the
 * controllers. Owns the run ledger (authoritative run state), the result
 * store (typed output handles), and the runtime adapter (black-box boundary).
 * Controllers hand it document models; it never touches webviews.
 *
 * Construction is LAZY — first document resolve, never extension activation
 * (A2 §4.3). Adapter selection rides `mssql.runbookStudio.runtime`:
 * "fake" is the deterministic in-process runtime (official perf lane);
 * "hobbes" is the supplied external runtime (adapter lands in RBS2-4b —
 * until then it reports RuntimeUnavailable rather than faking success).
 */

import * as path from "path";
import * as crypto from "crypto";
import * as vscode from "vscode";
import * as constants from "../constants/constants";
import { config } from "../configurations/config";
import { RunbookStudio as LocRunbookStudio } from "../constants/locConstants";
import { Perf } from "../perf/perfTelemetry";
import type { TransformPipeline } from "../sharedInterfaces/runbookPresentation";
import {
    RbsError,
    RbsEvidenceExportFormat,
    RbsModelConfiguration,
    RbsModelOption,
    RbsModelRole,
    RbsModelRoleConfiguration,
    RbsOutputArtifactAction,
    RbsPlannerProgressEvent,
    RunbookArtifactFile,
    RunbookParameterDefinition,
    RunbookRunSnapshot,
} from "../sharedInterfaces/runbookStudio";
import {
    childRunbookContext,
    emitRunbookEvent,
    metaField,
    newRunbookRootContext,
    RunbookOperationContext,
} from "./runbookDiag";
import { removeStash, writeStash } from "./libraryStash";
import {
    canonicalizeRunbookArtifact,
    deriveRunbookName,
    isArtifactParseFailure,
    parseRunbookArtifact,
} from "./runbookArtifact";
import { activeLibraryAssetId, LibraryRunRef, RunbookLibraryAsset } from "./runbookLibraryModel";
import {
    preflightContextForRuntime,
    preflightRunbookRequirements,
    prepareRunbookIntent,
} from "./capabilities/runbookCapabilities";
import { validateLockAgainstCatalog } from "./activities/activityCatalog";
import { RunbookRunCoordinator, OutputPageResult } from "./runbookRunCoordinator";
import { RunbookRunLedger, sanitizeRunFileId, selectExpiredRuns } from "./runbookRunLedger";
import {
    deriveRunbookEffectId,
    RunbookEffectLedger,
    RunbookEffectSnapshot,
} from "./runbookEffectLedger";
import {
    buildRunbookApprovalChallenge,
    RunbookApprovalChallenge,
    RunbookApprovalEvidence,
    RunbookApprovalLedger,
} from "./runbookApprovalLedger";

import { buildEvidenceExport, EvidenceExportError, evidenceExportFileName } from "./evidenceExport";
import { RunbookResultStore } from "./runbookResultStore";
import { RunbookRunDropStore } from "./runbookRunDropStore";
import { outputArtifactEditorViewType, verifyRetainedOutputArtifact } from "./outputArtifact";
import { RunbookStudioDocumentModel } from "./runbookStudioDocumentModel";
import { compileIntentWithModel } from "./models/planCompiler";
import {
    runtimeModelIdForRole,
    runtimeProviderProfileForRole,
    setRuntimeModelIdForRole,
} from "./models/modelConfiguration";
import { validateTargetBindings } from "./targetBindings";
import {
    buildArtifactFromLibraryAsset,
    buildPlannedArtifact,
    isPlannedArtifactFailure,
} from "./models/plannerMapping";
import { ActivityInvocationIdentity, FakeRuntimeAdapter } from "./runtime/fakeRuntimeAdapter";
import {
    HobbesRuntimeAdapter,
    HobbesProviderLoginEvent,
    HobbesProviderStatus,
    LibraryDocumentBaseline,
    LibraryDocumentCommitResult,
    LibraryDocumentConflictResolution,
    plannerTimeoutMilliseconds,
} from "./runtime/hobbesRuntimeAdapter";
import {
    LocalActivityError,
    LocalDacpacDeploymentResult,
    LocalDacpacExtractionResult,
    LocalDevelopmentDatabaseLeaseResult,
    LocalSandboxCleanupResult,
    LocalSandboxLeaseResult,
    LocalSqlContainerCleanupResult,
    LocalSqlContainerLeaseResult,
    LocalXelArtifactResult,
    LocalXeventCaptureResult,
    LocalXeventSessionResult,
    LocalWorkloadPreviewResult,
    LocalWorkloadRunResult,
    LocalSchemaMutationResult,
    LocalSchemaComparisonResult,
    LocalSchemaComparisonExportResult,
    LocalSqlActivityDelegate,
} from "./runtime/localSqlDelegate";
import {
    buildLocalEvidenceBundle,
    type LocalEvidenceBundleResult,
} from "./runtime/localEvidenceBundle";
import {
    buildCreateLocalSandboxSql,
    buildDropLocalSandboxSql,
    buildProbeLocalSandboxSql,
    effectIdFromLocalSandboxLeaseRef,
    isStrictLoopbackSqlServer,
    localSandboxDatabaseName,
    localSandboxLeaseRef,
    LocalSandboxProbe,
} from "./runtime/localSandboxOperations";
import {
    buildCreateLocalDevelopmentDatabaseSql,
    buildDropLocalDevelopmentDatabaseSql,
    buildProbeLocalDevelopmentDatabaseSql,
    effectIdFromLocalDevelopmentDatabaseLeaseRef,
    isValidLocalDevelopmentDatabaseName,
    localDevelopmentDatabaseLeaseRef,
    type LocalDevelopmentDatabaseProbe,
} from "./runtime/localDevelopmentDatabaseOperations";
import {
    effectIdFromLocalSqlContainerLeaseRef,
    isOwnedLocalSqlContainer,
    localSqlContainerLabels,
    localSqlContainerLeaseRef,
    validateLocalSqlContainerIdentity,
    waitForLocalSqlContainerAuthentication,
} from "./runtime/localContainerOperations";
import {
    buildLocalDacpac,
    buildLocalDeploymentPreviewResult,
    discoverLocalSqlTests,
    inspectLocalWorkspace,
    isValidDacpacSourceDatabaseName,
    verifyLocalDacpacArtifact,
} from "./runtime/localDeveloperOperations";
import {
    cleanupStaleLocalDacpacArtifacts,
    disposeStagedLocalDacpacArtifact,
    LocalDacpacStageError,
    stageLocalDacpacArtifact,
    type StagedLocalDacpacArtifact,
    verifyStagedLocalDacpacArtifact,
} from "./runtime/localDacpacStaging";
import {
    executeLocalDacpacDeploymentEffect,
    LocalDacpacDeploymentEffectError,
} from "./runtime/localDacpacDeploymentEffect";
import { buildLocalTsqltBatch, type LocalTsqltSelection } from "./runtime/localTsqlt";
import { executeLocalTsqltEffect, LocalTsqltEffectError } from "./runtime/localTsqltEffect";
import {
    buildLocalToolchainProvenance,
    type LocalToolchainProvenance,
} from "./runtime/localToolchainProvenance";
import { RuntimeSupervisor } from "./runtime/runtimeSupervisor";
import {
    executionRuntimeKindForArtifact,
    manifestRequiresExtensionPlanner,
} from "./runtime/runbookRuntimeRouting";
import {
    RunbookRuntimeAdapter,
    RuntimeBoundaryEvent,
    RuntimeCapabilities,
    RuntimeStartRefusedError,
} from "./runtime/runtimeAdapterTypes";
import { RequestType } from "vscode-languageclient";
import type * as mssql from "vscode-mssql";
import type ConnectionManager from "../controllers/connectionManager";
import SqlToolsServerClient from "../languageservice/serviceclient";
import * as fs from "fs";
import { DacFxService } from "../services/dacFxService";
import { SchemaCompareService } from "../services/schemaCompareService";
import { TaskExecutionMode } from "../enums";
import { digestRunbookValue } from "./runbookDigest";
import type { IConnectionProfileWithSource } from "../models/interfaces";
import {
    buildTransactionalCreateTableSql,
    validateLocalCreateTableSql,
} from "./schemaMutationPolicy";
import {
    checkDockerInstallation,
    checkEngine,
    deleteContainer,
    findAvailablePort,
    getContainerByName,
    startDocker,
} from "../docker/dockerUtils";
import { NULL_CONTAINER_HOST } from "../docker/containerHostAdapter";
import { getDockerodeClient } from "../docker/dockerodeClient";
import {
    checkIfSqlServerContainerIsReadyForConnections,
    pullSqlServerContainerImage,
    startSqlServerDockerContainer,
    validateSqlServerPassword,
} from "../deployment/sqlServerContainer";
import {
    LocalWorkloadPlan,
    LocalWorkloadPolicyError,
    MAX_LOCAL_WORKLOAD_BYTES,
    parseLocalWorkload,
} from "./runtime/localWorkload";
import {
    LocalXeventPolicyError,
    MAX_LOCAL_XEL_ARCHIVE_BYTES,
    buildStartLocalXeventSql,
    buildStopLocalXeventSql,
    extractLocalXelFromDockerArchive,
    localXeventSessionName,
    validateLocalXelServerPath,
} from "./runtime/localXevent";
import {
    SchemaCompareProviderError,
    StsV1RunbookSchemaCompareProvider,
} from "./providers/schemaCompareProvider";
import {
    MetadataStoreRunbookSchemaGraphProvider,
    RunbookSchemaGraphProviderError,
} from "./providers/schemaGraphProvider";
import { MetadataStoreService } from "../services/metadata/metadataStoreService";
import {
    prepareConnection,
    ProfileSecretSource,
    StoredConnectionProfile,
} from "../services/metadata/profileAuthAdapter";
import { vscodeSqlTokenSource } from "../services/sqlDataPlane/vscodeSqlTokenSource";

const SimpleExecuteRequestType = new RequestType<
    { ownerUri: string; queryString: string },
    mssql.SimpleExecuteResult,
    void
>("query/simpleexecute");
const ServiceVersionRequestType = new RequestType<Record<string, never>, string, void>("version");

let runCounter = 0;
let previewCounter = 0;
let extractCounter = 0;
let sandboxCounter = 0;
let schemaMutationCounter = 0;

function nextRunId(): string {
    runCounter++;
    return `run_${Date.now().toString(36)}_${runCounter.toString(36)}`;
}

interface ActiveRunBinding {
    runId: string;
    model: RunbookStudioDocumentModel;
    context: RunbookOperationContext;
    runEnded: boolean;
    artifact: RunbookArtifactFile;
    parameterValues: Record<string, string | number | boolean | null>;
    /** Explicit user choice for this run only; never copied to the artifact. */
    autoApproveRemaining: boolean;
    pendingApprovals: Map<
        string,
        {
            challenge: RunbookApprovalChallenge;
            challengeDigest: string;
        }
    >;
    approvedEffects: Map<
        string,
        { challenge: RunbookApprovalChallenge; evidence: RunbookApprovalEvidence }
    >;
    outputValues: Map<string, Record<string, number | string | boolean>>;
    evidenceValues: Map<string, Record<string, number | string | boolean>>;
}

/** Retention: the newest N runs per runbook id survive GC. */
const RETAINED_RUNS_PER_RUNBOOK = 20;
/** A crashed host can strand a private stage; live stages are far younger. */
const STAGED_DACPAC_RETENTION_MS = 24 * 60 * 60 * 1000;
const TOOLCHAIN_VERSION_TIMEOUT_MS = 2000;
/** Persistence sweep runs shortly after construction — off the open path. */
const PERSISTENCE_SWEEP_DELAY_MS = 1500;

export class RunbookStudioService implements RunbookRunCoordinator, vscode.Disposable {
    private readonly ledger: RunbookRunLedger;
    private readonly effectLedger: RunbookEffectLedger;
    private readonly approvalLedger: RunbookApprovalLedger;
    private readonly resultStore: RunbookResultStore;
    private readonly runDropStore: RunbookRunDropStore;
    private adapter: RunbookRuntimeAdapter | undefined;
    /** The configured kind this.adapter was built for (hot-swap detection). */
    private adapterKind: string | undefined;
    /** The lazily held Hobbes adapter for library operations (D-0012). The
     *  library ALWAYS lives on the hobbes runtime regardless of the run
     *  lane setting; when the run lane is also "hobbes" this is the SAME
     *  instance as this.adapter (one supervisor, one runtime process). */
    private hobbesAdapter: HobbesRuntimeAdapter | undefined;
    private capabilities: RuntimeCapabilities | undefined;
    /** One active run per document (v1 concurrency policy, plan §4 P6). */
    private readonly activeByDocument = new Map<string, ActiveRunBinding>();
    private readonly activeByRunId = new Map<string, ActiveRunBinding>();
    /** Fires when a run is accepted or reaches terminal — the library tree
     *  subscribes to keep its "running" badges honest without polling. */
    private readonly activeRunsEmitter = new vscode.EventEmitter<void>();
    public readonly onDidChangeActiveRuns: vscode.Event<void> = this.activeRunsEmitter.event;
    private readonly seededModels = new WeakSet<RunbookStudioDocumentModel>();
    /** runId -> trace, retained past terminal for Debug Console links. */
    private readonly traceByRunId = new Map<string, string>();
    /** Secret-bearing container profiles exist only for this extension-host
     * lifetime. Durable journals retain enough owner-label identity to clean
     * a crashed lease, but never enough information to reconnect. */
    private readonly containerLeaseProfiles = new Map<
        string,
        {
            profile: mssql.IConnectionInfo;
            containerName: string;
            databaseName: string;
            port: number;
            version: string;
        }
    >();
    /** Immutable, bounded workload snapshots bind file content to approval
     * without persisting workspace SQL or reopening a changed path. */
    private readonly workloadPreviews = new Map<
        string,
        { plan: LocalWorkloadPlan; fileName: string }
    >();
    /** A stopped capture is collected only from the exact same-run owned
     * container path observed before the session was dropped. */
    private readonly xeventCaptures = new Map<
        string,
        {
            runId: string;
            startEffectId: string;
            containerEffectId: string;
            containerName: string;
            sessionName: string;
            serverPath: string;
            eventCount: number;
        }
    >();

    private readonly storageRoot: string;
    /** Library-global persistence root (ledger + results). Run history must
     *  follow the RUNBOOK, and runbooks are library-global (`mssql-runbook:`
     *  stash under globalStorage) — a workspace-scoped root would strand
     *  records the moment the same runbook opens in another window. */
    private readonly persistRoot: string;
    /** Global (workspace-independent) storage root for the library stash. */
    private readonly globalStorageUri: vscode.Uri;
    private readonly mssqlExtensionVersion: unknown;
    private sweepTimer: ReturnType<typeof setTimeout> | undefined;
    private effectRecoveryInProgress = false;
    private effectRecoveryWarningShown = false;

    constructor(
        context: vscode.ExtensionContext,
        /** Lazy — MainController constructs after feature registration. */
        private readonly connectionAccess: () => ConnectionManager | undefined,
        private readonly dacFxAccess: () => DacFxService | undefined = () => undefined,
        private readonly schemaCompareAccess: () => SchemaCompareService | undefined = () =>
            undefined,
    ) {
        // Workspace-scoped root retained for the runtime supervisor's data
        // dir (its library/logs stay where existing sessions put them).
        this.storageRoot = path.join(
            (context.storageUri ?? context.globalStorageUri).fsPath,
            "runbookStudio",
        );
        this.globalStorageUri = context.globalStorageUri;
        this.mssqlExtensionVersion = context.extension.packageJSON.version;
        this.persistRoot = path.join(context.globalStorageUri.fsPath, "runbookStudio");
        // One-time migration BEFORE the ledger opens: hoist records this
        // workspace wrote under its old workspace-scoped root so existing
        // history reappears instead of silently starting over.
        const migratedFiles = migrateLegacyRunStorage(this.storageRoot, this.persistRoot);
        this.ledger = new RunbookRunLedger(this.persistRoot);
        this.effectLedger = new RunbookEffectLedger(this.persistRoot);
        this.approvalLedger = new RunbookApprovalLedger(this.persistRoot);
        const persistenceContext = newRunbookRootContext("persistence");
        this.resultStore = new RunbookResultStore(path.join(this.persistRoot, "results"), {
            onPersistenceIssue: (kind, detail) =>
                emitRunbookEvent(persistenceContext, "runbookStudio.persistence.issue", "warning", {
                    issueKind: metaField(kind),
                    detailClass: metaField(detail.slice(0, 80)),
                }),
        });
        this.runDropStore = new RunbookRunDropStore(
            path.join(this.persistRoot, "run-drops"),
            path.join(this.persistRoot, "managed-artifacts"),
        );
        if (migratedFiles > 0) {
            emitRunbookEvent(persistenceContext, "runbookStudio.persistence.migrated", "ok", {
                movedFiles: metaField(migratedFiles),
            });
        }
        // Retention GC + interrupted-run sealing: lazy and non-blocking —
        // never on the document-open critical path.
        this.sweepTimer = setTimeout(() => {
            this.sweepTimer = undefined;
            try {
                this.sweepPersistence();
                void this.recoverOutstandingSandboxEffects();
            } catch (error) {
                emitRunbookEvent(persistenceContext, "runbookStudio.persistence.gc", "error", {
                    errorClass: metaField(error instanceof Error ? error.name : "UnknownError"),
                });
            }
        }, PERSISTENCE_SWEEP_DELAY_MS);
    }

    public dispose(): void {
        if (this.sweepTimer) {
            clearTimeout(this.sweepTimer);
            this.sweepTimer = undefined;
        }
        this.activeRunsEmitter.dispose();
        this.containerLeaseProfiles.clear();
        this.workloadPreviews.clear();
        this.xeventCaptures.clear();
        void this.adapter?.dispose();
        if (this.hobbesAdapter && this.hobbesAdapter !== this.adapter) {
            void this.hobbesAdapter.dispose();
        }
        this.hobbesAdapter = undefined;
    }

    /** Library asset ids with a currently active (non-terminal) run. */
    public activeLibraryAssetIds(): Set<string> {
        const ids = new Set<string>();
        for (const binding of this.activeByRunId.values()) {
            if (binding.runEnded) {
                continue;
            }
            const artifact = binding.model.artifact;
            if (artifact) {
                ids.add(activeLibraryAssetId(artifact));
            }
        }
        return ids;
    }

    // -- RunbookRunCoordinator ------------------------------------------------

    public async startRun(
        model: RunbookStudioDocumentModel,
        parameterValues: Record<string, string | number | boolean | null>,
        options?: { autoApprove?: boolean },
    ): Promise<{ runId?: string; error?: RbsError }> {
        this.seedHistory(model);
        const artifact = model.artifact;
        if (!artifact) {
            return { error: invalidArtifactError(model) };
        }
        const readiness = preflightRunbookRequirements(artifact.source.requirements);
        if (readiness.status === "designOnly") {
            return {
                error: {
                    code: "RunbookStudio.ActivityUnsupported",
                    message: LocRunbookStudio.missingRunbookCapabilities(
                        readiness.missingActivityKinds.join(", "),
                    ),
                },
            };
        }
        if (!artifact.lock) {
            return {
                error: {
                    code: "RunbookStudio.BindingInvalid",
                    message: LocRunbookStudio.notCompiled,
                },
            };
        }
        const existing = this.activeByDocument.get(model.uriKey);
        if (existing && !existing.runEnded) {
            return {
                error: {
                    code: "RunbookStudio.RunActive",
                    message: LocRunbookStudio.runActive,
                },
            };
        }

        const context = newRunbookRootContext("run");
        Perf.marker("mssql.runbookStudio.bind.begin", "begin", undefined, context.traceId);
        const binding = bindParameters(artifact.source.parameters, parameterValues);
        Perf.marker(
            "mssql.runbookStudio.bind.end",
            "end",
            {
                parameterCount: artifact.source.parameters.length,
                explicitCount: binding.explicitCount,
                defaultCount: binding.defaultCount,
                validationErrors: binding.errors.length,
            },
            context.traceId,
        );
        if (binding.errors.length > 0) {
            return {
                error: {
                    code: "RunbookStudio.BindingInvalid",
                    message: binding.errors.join(" "),
                },
            };
        }
        const targetIssues = validateTargetBindings(artifact, binding.values);
        if (targetIssues.length > 0) {
            return {
                error: {
                    code: "RunbookStudio.BindingInvalid",
                    message: LocRunbookStudio.targetBindingInvalid(
                        targetIssues.map((issue) => issue.detail).join("; "),
                    ),
                },
            };
        }
        const targetKinds = artifact.lock.nodes.flatMap((node) =>
            node.target ? [node.target.kind] : [],
        );
        const configuredRuntimeKind = vscode.workspace
            .getConfiguration()
            .get<string>("mssql.runbookStudio.runtime", "local");
        const executionRuntimeKind = executionRuntimeKindForArtifact(
            configuredRuntimeKind,
            artifact,
        );
        if (executionRuntimeKind !== "hobbes") {
            const catalogIssues = validateLockAgainstCatalog(artifact.lock);
            if (catalogIssues.length > 0) {
                return {
                    error: {
                        code: "RunbookStudio.BindingInvalid",
                        message: LocRunbookStudio.runbookIncompatible(catalogIssues.join("; ")),
                    },
                };
            }
        }
        // Library-backed locks execute in Hobbes even when an older saved
        // draft predates host stamping and still says "extension" in source.
        const admissionManifest =
            executionRuntimeKind === "hobbes" &&
            artifact.lock.libraryAssetRef &&
            artifact.source.requirements
                ? {
                      ...artifact.source.requirements,
                      activities: artifact.source.requirements.activities.map((activity) => ({
                          ...activity,
                          host: "hobbes" as const,
                      })),
                  }
                : artifact.source.requirements;
        const admissionReadiness = preflightRunbookRequirements(admissionManifest, {
            ...preflightContextForRuntime(executionRuntimeKind, "admission"),
            providerAvailable:
                executionRuntimeKind !== "local" ||
                this.dacFxAccess() !== undefined ||
                vscode.extensions.getExtension(constants.sqlDatabaseProjectsExtensionId) !==
                    undefined,
            availableTargetKinds: targetKinds,
            bindings: {
                connection: artifact.lock.nodes.some(
                    (node) =>
                        (node.target?.kind === "sqlDatabase" ||
                            node.target?.kind === "ephemeralSqlDatabase") &&
                        node.target.binding.source === "parameter" &&
                        binding.values[node.target.binding.parameterId] !== undefined,
                ),
                secret: artifact.source.parameters.some(
                    (parameter) =>
                        parameter.type === "secret" && binding.values[parameter.id] !== undefined,
                ),
                provisionedTarget: artifact.lock.nodes.some(
                    (node) =>
                        node.target?.kind === "ephemeralSqlDatabase" &&
                        node.target.binding.source === "nodeOutput",
                ),
            },
        });
        if (
            admissionReadiness.status === "policyBlocked" ||
            admissionReadiness.status === "incompatible"
        ) {
            const detail = (admissionReadiness.issues ?? [])
                .map((issue) => issue.message)
                .join(" ");
            return {
                error: {
                    code:
                        admissionReadiness.status === "policyBlocked"
                            ? "RunbookStudio.ActivityPolicyDenied"
                            : "RunbookStudio.RuntimeCapabilityUnsupported",
                    message:
                        admissionReadiness.status === "policyBlocked"
                            ? LocRunbookStudio.runbookPolicyBlocked(detail)
                            : LocRunbookStudio.runbookIncompatible(detail),
                },
            };
        }

        const adapterResult = await this.ensureAdapter(context, executionRuntimeKind);
        if ("error" in adapterResult) {
            return { error: adapterResult.error };
        }
        const adapter = adapterResult.adapter;

        const runId = nextRunId();
        const startedEpochMs = Date.now();
        try {
            this.runDropStore.createRun({
                runId,
                runbookId: artifact.id,
                planRevision: artifact.lock.planRevision,
                planHash: artifact.lock.planHash,
                startedEpochMs,
            });
        } catch {
            return {
                error: {
                    code: "RunbookStudio.Internal",
                    message: LocRunbookStudio.runDropCreateFailed,
                },
            };
        }
        const runContext = childRunbookContext(context, { runId });
        const active: ActiveRunBinding = {
            runId,
            model,
            context: runContext,
            runEnded: false,
            artifact,
            parameterValues: binding.values,
            autoApproveRemaining: options?.autoApprove === true,
            pendingApprovals: new Map(),
            approvedEffects: new Map(),
            outputValues: new Map(),
            evidenceValues: new Map(),
        };
        this.activeByDocument.set(model.uriKey, active);
        this.activeByRunId.set(runId, active);
        this.rememberTrace(runId, runContext.traceId);

        Perf.marker("mssql.runbookStudio.run.begin", "begin", undefined, runContext.traceId);
        emitRunbookEvent(runContext, "runbookStudio.run.accepted", "ok", {
            runbookIdDigest: metaField(shortDigest(artifact.id)),
            planRevision: metaField(artifact.lock.planRevision),
            nodeCount: metaField(artifact.lock.nodes.length),
        });
        const accepted = this.ledger.acceptRun({
            runId,
            runbookId: artifact.id,
            planRevision: artifact.lock.planRevision,
            planHash: artifact.lock.planHash,
            nodeIds: artifact.lock.nodes.map((n) => n.id),
            epochMs: startedEpochMs,
        });
        model.setActiveRun(accepted);
        this.activeRunsEmitter.fire();

        try {
            await adapter.startRun(
                { runId, artifact, parameterValues: binding.values },
                {
                    onEvent: (event) => this.onBoundaryEvent(active, artifact, event),
                    onGap: (droppedCount) =>
                        emitRunbookEvent(active.context, "runbookStudio.run.eventGap", "warning", {
                            dropped: metaField(droppedCount),
                        }),
                    onExit: (unexpected) => this.onRuntimeExit(active, unexpected),
                },
                runContext,
            );
        } catch (error) {
            // A typed refusal carries the precise, user-actionable reason
            // (e.g. "runbook not in the Hobbes library"); anything else gets
            // the generic start-failure message.
            const refusal = error instanceof RuntimeStartRefusedError ? error : undefined;
            const rbsError: RbsError = refusal?.rbsError ?? {
                code: "RunbookStudio.RuntimeProtocol",
                message: LocRunbookStudio.runtimeStartFailed,
                retryable: true,
            };
            this.finishRun(active, {
                kind: "terminal",
                state: "failed",
                errorCode: rbsError.code,
                errorMessage: rbsError.message,
            });
            emitRunbookEvent(runContext, "runbookStudio.run.startFailed", "error", {
                errorClass: metaField(error instanceof Error ? error.name : "UnknownError"),
                ...(refusal?.refusalCode ? { refusalCode: metaField(refusal.refusalCode) } : {}),
            });
            return { error: rbsError };
        }
        return { runId };
    }

    public async cancelRun(
        model: RunbookStudioDocumentModel,
        runId: string,
    ): Promise<{ outcome: "cancelled" | "alreadyTerminal" | "failed" }> {
        const active = this.activeByRunId.get(runId);
        const context = active?.context ?? newRunbookRootContext("cancel");
        Perf.marker(
            "mssql.runbookStudio.run.cancel.requested",
            "instant",
            undefined,
            context.traceId,
        );
        if (!active || active.runEnded || !this.adapter) {
            Perf.marker(
                "mssql.runbookStudio.run.cancel.settled",
                "instant",
                { outcome: "alreadyTerminal" },
                context.traceId,
            );
            return { outcome: "alreadyTerminal" };
        }
        if (active.model !== model) {
            return { outcome: "failed" };
        }
        const outcome = await this.adapter.cancelRun(runId, context);
        Perf.marker(
            "mssql.runbookStudio.run.cancel.settled",
            "instant",
            { outcome },
            context.traceId,
        );
        return { outcome };
    }

    public async respondToGate(
        model: RunbookStudioDocumentModel,
        runId: string,
        nodeId: string,
        approve: boolean,
        options?: { approveAll?: boolean },
    ): Promise<{ accepted: boolean; error?: RbsError }> {
        const active = this.activeByRunId.get(runId);
        if (!active || active.runEnded || active.model !== model || !this.adapter) {
            return {
                accepted: false,
                error: {
                    code: "RunbookStudio.ApprovalInvalid",
                    message: LocRunbookStudio.gateNotPending,
                },
            };
        }
        const enableAutoApprove = approve && options?.approveAll === true;
        const pendingApproval = active.pendingApprovals.get(nodeId);
        if (pendingApproval) {
            try {
                this.approvalLedger.decide(
                    pendingApproval.challenge.approvalId,
                    approve ? "approved" : "rejected",
                );
                if (approve) {
                    const evidence = this.approvalLedger.approvedEvidence(
                        pendingApproval.challenge.approvalId,
                        pendingApproval.challengeDigest,
                    );
                    if (!evidence) {
                        throw new Error("approved evidence was not durable");
                    }
                    // Write-ahead authorization: a local activity can begin
                    // immediately when the adapter gate is released.
                    active.approvedEffects.set(pendingApproval.challenge.activityNodeId, {
                        challenge: pendingApproval.challenge,
                        evidence,
                    });
                }
            } catch {
                return {
                    accepted: false,
                    error: {
                        code: "RunbookStudio.ApprovalPersistenceFailed",
                        message: LocRunbookStudio.approvalPersistenceFailed,
                    },
                };
            }
        }
        const accepted = await this.adapter.respondToGate(
            runId,
            nodeId,
            approve,
            childRunbookContext(active.context, { nodeId }),
        );
        if (!accepted) {
            if (pendingApproval) {
                active.approvedEffects.delete(pendingApproval.challenge.activityNodeId);
            }
            return {
                accepted: false,
                error: {
                    code: "RunbookStudio.ApprovalInvalid",
                    message: LocRunbookStudio.gateNotPending,
                },
            };
        }
        if (enableAutoApprove) {
            active.autoApproveRemaining = true;
        }
        active.pendingApprovals.delete(nodeId);
        if (active.autoApproveRemaining) {
            for (const pendingNodeId of active.pendingApprovals.keys()) {
                queueMicrotask(() => {
                    void this.respondToGate(model, runId, pendingNodeId, true);
                });
            }
        }
        return { accepted: true };
    }

    public async getRun(
        _model: RunbookStudioDocumentModel,
        runId: string,
    ): Promise<RunbookRunSnapshot | undefined> {
        return this.ledger.snapshotOf(runId);
    }

    public async openRunDrop(
        model: RunbookStudioDocumentModel,
        runId: string,
    ): Promise<{ opened: boolean; error?: RbsError }> {
        const snapshot = this.ledger.snapshotOf(runId);
        if (!snapshot || snapshot.runbookId !== model.artifact?.id) {
            return { opened: false, error: runNotFoundError() };
        }
        const directory = this.runDropStore.pathForOpen(runId);
        if (!directory) {
            return { opened: false, error: runDropUnavailableError() };
        }
        await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(directory));
        return { opened: true };
    }

    public async deleteRunHistory(
        model: RunbookStudioDocumentModel,
        runId: string,
    ): Promise<{ deleted: boolean; error?: RbsError }> {
        const snapshot = this.ledger.snapshotOf(runId);
        if (!snapshot || snapshot.runbookId !== model.artifact?.id) {
            return { deleted: false, error: runNotFoundError() };
        }
        if (this.activeByRunId.has(runId) || this.ledger.isOpen(runId)) {
            return {
                deleted: false,
                error: { code: "RunbookStudio.RunActive", message: LocRunbookStudio.runActive },
            };
        }
        try {
            this.deleteLocalRunData(runId);
        } catch {
            return {
                deleted: false,
                error: {
                    code: "RunbookStudio.Internal",
                    message: LocRunbookStudio.runHistoryDeleteFailed,
                },
            };
        }
        if (!this.ledger.deleteRun(runId)) {
            return { deleted: false, error: runNotFoundError() };
        }
        const entries = this.ledger.listRuns(snapshot.runbookId);
        model.selectRun(undefined);
        model.setActiveRun(undefined);
        model.seedHistory(entries);
        const latest = entries[0] ? this.ledger.snapshotOf(entries[0].runId) : undefined;
        if (latest) {
            model.setActiveRun(latest);
        }
        return { deleted: true };
    }

    public async fetchOutputPage(
        _model: RunbookStudioDocumentModel,
        page: {
            handleId: string;
            startRow: number;
            rowCount: number;
            pipeline?: TransformPipeline;
        },
    ): Promise<OutputPageResult> {
        const context = newRunbookRootContext("fetch");
        Perf.marker("mssql.runbookStudio.output.fetch.begin", "begin", undefined, context.traceId);
        const result = page.pipeline
            ? this.resultStore.fetchTransformedPage(
                  page.handleId,
                  page.pipeline,
                  page.startRow,
                  page.rowCount,
              )
            : this.resultStore.fetchPage(page.handleId, page.startRow, page.rowCount);
        if (result && "transformError" in result) {
            Perf.marker("mssql.runbookStudio.output.fetch.end", "end", {
                rows: 0,
                cacheHit: true,
            });
            return {
                error: {
                    code: "RunbookStudio.PresentationInvalid",
                    message: LocRunbookStudio.presentationTransformFailed,
                },
            };
        }
        Perf.marker(
            "mssql.runbookStudio.output.fetch.end",
            "end",
            {
                rows: result?.rows?.length ?? 0,
                cacheHit: result !== undefined,
            },
            context.traceId,
        );
        if (!result) {
            return {
                error: {
                    code: "RunbookStudio.DataUnavailable",
                    message: LocRunbookStudio.dataExpired,
                },
            };
        }
        return result;
    }

    public async outputArtifactAction(
        model: RunbookStudioDocumentModel,
        handleId: string,
        action?: RbsOutputArtifactAction,
    ): Promise<{
        available: boolean;
        fileName?: string;
        performed?: boolean;
        cancelled?: boolean;
        error?: RbsError;
    }> {
        const selectedOutput = model.displayRun?.nodes
            .flatMap((node) => node.outputs ?? [])
            .find((output) => output.handleId === handleId && output.expired !== true);
        const artifact = selectedOutput ? this.resultStore.readOutputArtifact(handleId) : undefined;
        if (!artifact || selectedOutput?.contract !== artifact.contract) {
            return action
                ? { available: false, error: outputArtifactUnavailableError() }
                : { available: false };
        }
        const roots = this.runDropStore.trustedArtifactRoots();
        if (artifact.contract === "dacpacArtifact/1") {
            roots.push(
                ...(vscode.workspace.workspaceFolders ?? [])
                    .filter((folder) => folder.uri.scheme === "file")
                    .map((folder) => folder.uri.fsPath),
            );
        }
        const verifiedPath = await verifyRetainedOutputArtifact(artifact, roots);
        if (!verifiedPath) {
            return action
                ? { available: false, error: outputArtifactChangedError() }
                : { available: false };
        }
        if (!action) {
            return { available: true, fileName: artifact.fileName };
        }
        try {
            const source = vscode.Uri.file(verifiedPath);
            if (action === "open") {
                const customEditor = outputArtifactEditorViewType(artifact.contract);
                await vscode.commands.executeCommand(
                    customEditor ? "vscode.openWith" : "vscode.open",
                    source,
                    ...(customEditor ? [customEditor] : []),
                );
            } else if (action === "reveal") {
                await vscode.commands.executeCommand("revealFileInOS", source);
            } else {
                const extension = path.extname(artifact.fileName).slice(1);
                const workspaceFolder = vscode.workspace.workspaceFolders?.find(
                    (folder) => folder.uri.scheme === "file",
                );
                const target = await vscode.window.showSaveDialog({
                    title: LocRunbookStudio.outputArtifactExportTitle,
                    ...(workspaceFolder
                        ? {
                              defaultUri: vscode.Uri.joinPath(
                                  workspaceFolder.uri,
                                  artifact.fileName,
                              ),
                          }
                        : {}),
                    filters: { [LocRunbookStudio.outputArtifactFile]: [extension] },
                });
                if (!target) {
                    return {
                        available: true,
                        fileName: artifact.fileName,
                        performed: false,
                        cancelled: true,
                    };
                }
                await vscode.workspace.fs.copy(source, target, { overwrite: true });
                void vscode.window.showInformationMessage(LocRunbookStudio.outputArtifactExported);
            }
            return { available: true, fileName: artifact.fileName, performed: true };
        } catch {
            return {
                available: true,
                fileName: artifact.fileName,
                performed: false,
                error: {
                    code: "RunbookStudio.DataUnavailable",
                    message: LocRunbookStudio.outputArtifactActionFailed,
                },
            };
        }
    }

    public async exportEvidence(
        model: RunbookStudioDocumentModel,
        runId: string,
        format: RbsEvidenceExportFormat,
    ): Promise<{ exported: boolean; cancelled?: boolean; error?: RbsError }> {
        const context = newRunbookRootContext("evidenceExport");
        let eventCount = 0;
        let artifactCount = 0;
        Perf.marker(
            "mssql.runbookStudio.evidence.export.begin",
            "begin",
            undefined,
            context.traceId,
        );
        try {
            const snapshot = this.ledger.snapshotOf(runId);
            const artifact = model.artifact;
            if (
                !snapshot ||
                !artifact ||
                snapshot.runbookId !== artifact.id ||
                !["succeeded", "failed", "cancelled"].includes(snapshot.state)
            ) {
                return { exported: false, error: evidenceUnavailableError() };
            }
            eventCount = snapshot.nodes.length;
            let evidenceHandle: string | undefined;
            for (let nodeIndex = snapshot.nodes.length - 1; nodeIndex >= 0; nodeIndex--) {
                const outputs = snapshot.nodes[nodeIndex].outputs ?? [];
                for (let outputIndex = outputs.length - 1; outputIndex >= 0; outputIndex--) {
                    if (
                        outputs[outputIndex].contract === "evidenceBundle/1" &&
                        outputs[outputIndex].expired !== true &&
                        outputs[outputIndex].truncated !== true
                    ) {
                        evidenceHandle = outputs[outputIndex].handleId;
                        break;
                    }
                }
                if (evidenceHandle) {
                    break;
                }
            }
            if (!evidenceHandle) {
                return { exported: false, error: evidenceUnavailableError() };
            }
            const payload = this.resultStore.readTextPayload(evidenceHandle, "evidenceBundle/1");
            if (!payload || payload.truncated) {
                return { exported: false, error: evidenceUnavailableError() };
            }
            const exportArtifact = buildEvidenceExport(payload.text, format);
            if (
                exportArtifact.sourceIdentity.runId !== snapshot.runId ||
                exportArtifact.sourceIdentity.runbookId !== snapshot.runbookId ||
                exportArtifact.sourceIdentity.planRevision !== snapshot.planRevision ||
                exportArtifact.sourceIdentity.planHash !== snapshot.planHash ||
                exportArtifact.sourceIdentity.verdict !== snapshot.verdict
            ) {
                return {
                    exported: false,
                    error: {
                        code: "RunbookStudio.DataUnavailable",
                        message: LocRunbookStudio.evidenceExportInvalid,
                    },
                };
            }
            const fileName = evidenceExportFileName(
                artifact.name,
                snapshot.runId,
                exportArtifact.extension,
            );
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            const target = await vscode.window.showSaveDialog({
                title: LocRunbookStudio.evidenceExportTitle,
                ...(workspaceFolder
                    ? { defaultUri: vscode.Uri.joinPath(workspaceFolder.uri, fileName) }
                    : {}),
                filters: { [exportArtifact.filterLabel]: [exportArtifact.extension] },
            });
            if (!target) {
                return { exported: false, cancelled: true };
            }
            await vscode.workspace.fs.writeFile(
                target,
                Buffer.from(exportArtifact.content, "utf8"),
            );
            artifactCount = 1;
            void vscode.window.showInformationMessage(LocRunbookStudio.evidenceExported);
            return { exported: true };
        } catch (error) {
            return {
                exported: false,
                error: {
                    code: "RunbookStudio.DataUnavailable",
                    message:
                        error instanceof EvidenceExportError
                            ? LocRunbookStudio.evidenceExportInvalid
                            : LocRunbookStudio.evidenceExportFailed,
                    ...(error instanceof EvidenceExportError ? {} : { retryable: true }),
                },
            };
        } finally {
            Perf.marker(
                "mssql.runbookStudio.evidence.export.end",
                "end",
                { eventCount, artifactCount },
                context.traceId,
            );
        }
    }

    public traceIdOf(runId: string): string | undefined {
        return this.traceByRunId.get(runId);
    }

    /** Intent -> compiled plan, written into the document via WorkspaceEdit
     *  (dirty/undo-safe). On the hobbes lane the runtime's elicitation
     *  planner authors the plan first (D-0010); transport/mapping failures
     *  fall back to the catalog-constrained vscode.lm compiler, while typed
     *  provider/auth and cancellation refusals remain visible. */
    public async compileIntent(
        model: RunbookStudioDocumentModel,
        intent: string,
        onProgress?: (event: RbsPlannerProgressEvent) => void,
    ): Promise<{ ok: boolean; error?: RbsError }> {
        const current = model.artifact;
        if (!current) {
            return { ok: false, error: invalidArtifactError(model) };
        }
        const context = newRunbookRootContext("compile");
        const runtimeKind = vscode.workspace
            .getConfiguration()
            .get<string>("mssql.runbookStudio.runtime", "local");
        const prepared = prepareRunbookIntent(current, intent, {
            ...preflightContextForRuntime(runtimeKind),
            ...(runtimeKind === "local"
                ? {
                      providerAvailable:
                          this.dacFxAccess() !== undefined ||
                          vscode.extensions.getExtension(
                              constants.sqlDatabaseProjectsExtensionId,
                          ) !== undefined,
                  }
                : {}),
        });
        const base = prepared.artifact;
        const readiness = prepared.readiness;
        Perf.marker(
            "mssql.runbookStudio.compile.preflight",
            "instant",
            {
                family: base.family ?? "investigate",
                readiness: readiness.status,
                missingActivityCount: readiness.missingActivityKinds.length,
            },
            context.traceId,
        );
        emitRunbookEvent(
            context,
            "runbookStudio.compile.preflight",
            readiness.status === "designOnly" ? "warning" : "ok",
            {
                family: metaField(base.family ?? "investigate"),
                readiness: metaField(readiness.status),
                missingActivityCount: metaField(readiness.missingActivityKinds.length),
            },
        );
        if (
            readiness.status === "designOnly" ||
            readiness.status === "policyBlocked" ||
            readiness.status === "incompatible"
        ) {
            // Persist the useful design contract but deliberately remove any
            // stale executable lock. A changed prompt that now needs missing
            // operations must never retain an earlier runnable plan.
            const applied = await model.applyArtifactEdit(base);
            if (!applied) {
                return {
                    ok: false,
                    error: {
                        code: "RunbookStudio.Internal",
                        message: LocRunbookStudio.compileApplyFailed,
                    },
                };
            }
            const detail = (readiness.issues ?? []).map((issue) => issue.message).join(" ");
            return {
                ok: false,
                error: {
                    code:
                        readiness.status === "designOnly"
                            ? "RunbookStudio.ActivityUnsupported"
                            : readiness.status === "policyBlocked"
                              ? "RunbookStudio.ActivityPolicyDenied"
                              : "RunbookStudio.RuntimeCapabilityUnsupported",
                    message:
                        readiness.status === "designOnly"
                            ? LocRunbookStudio.missingRunbookCapabilities(
                                  readiness.missingActivityKinds.join(", "),
                              )
                            : readiness.status === "policyBlocked"
                              ? LocRunbookStudio.runbookPolicyBlocked(detail)
                              : LocRunbookStudio.runbookIncompatible(detail),
                },
            };
        }
        let artifact: RunbookArtifactFile | undefined;
        if (
            runtimeKind === "hobbes" &&
            !manifestRequiresExtensionPlanner(base.source.requirements)
        ) {
            try {
                artifact = await this.compileWithRuntimePlanner(base, intent, context, onProgress);
            } catch (error) {
                // A typed runtime refusal ends compilation outright. Falling
                // through to a different compiler would hide provider/auth
                // readiness and can turn a deliberate cancel into new work.
                if (error instanceof RuntimeStartRefusedError) {
                    if (error.rbsError.code === "RunbookStudio.ModelUnavailable") {
                        void vscode.window
                            .showWarningMessage(
                                error.rbsError.message,
                                LocRunbookStudio.runtimeProviderCheck,
                            )
                            .then((choice) => {
                                if (choice === LocRunbookStudio.runtimeProviderCheck) {
                                    void vscode.commands.executeCommand(
                                        "mssql.runbookStudio.checkRuntimeProvider",
                                    );
                                }
                            });
                    }
                    return { ok: false, error: error.rbsError };
                }
                throw error;
            }
        }
        if (!artifact) {
            const result = await compileIntentWithModel(base, intent, context);
            if (result.error || !result.artifact) {
                return { ok: false, ...(result.error ? { error: result.error } : {}) };
            }
            artifact = result.artifact;
        }
        // A generated plan deserves a real name: when the document still
        // wears the New-Runbook placeholder, derive one from the intent
        // (the planner path may have already adopted the asset title).
        if (isPlaceholderRunbookName(artifact.name)) {
            artifact = { ...artifact, name: deriveRunbookName(intent) };
        }
        // Keep generated names unique in the library. For a virtual library
        // document, applyArtifactEdit -> document.save commits the title and
        // artifact in ONE optimistic transaction. A separate metadata PUT
        // here used to advance the head first and made every generated plan
        // immediately conflict with its own editor baseline.
        if (isPlaceholderRunbookName(base.name) && artifact.name !== base.name) {
            const assetId = artifact.lock?.libraryAssetRef?.assetId ?? artifact.id;
            const unique = await this.dedupeTitleAgainstLibrary(artifact.name, assetId);
            if (unique !== artifact.name) {
                artifact = { ...artifact, name: unique };
            }
        }
        const applied = await model.applyArtifactEdit(artifact);
        if (!applied) {
            return {
                ok: false,
                error: {
                    code: "RunbookStudio.Internal",
                    message: LocRunbookStudio.compileApplyFailed,
                },
            };
        }
        return { ok: true };
    }

    /** Runtime-planner authoring path (hobbes lane, R1.2): the planner
     *  authors the full plan IR and saves it in the runtime library; the
     *  compiled lock mirrors that plan and references the asset. Returns
     *  undefined on an untyped transport/mapping failure so the catalog
     *  compiler can take over; typed refusals propagate to the user. */
    private async compileWithRuntimePlanner(
        base: RunbookArtifactFile,
        intent: string,
        context: RunbookOperationContext,
        onProgress?: (event: RbsPlannerProgressEvent) => void,
    ): Promise<RunbookArtifactFile | undefined> {
        const ensured = this.ensureHobbesAdapter();
        if ("error" in ensured) {
            emitRunbookEvent(context, "runbookStudio.planner.fallback", "warning", {
                errorClass: metaField("AdapterUnavailable"),
            });
            return undefined;
        }
        try {
            const providerStatus = await ensured.adapter.getProviderStatus(context);
            if (!providerStatus.provider.ready) {
                throw new RuntimeStartRefusedError({
                    code: "RunbookStudio.ModelUnavailable",
                    message: LocRunbookStudio.runtimeProviderNotReady(
                        providerStatus.provider.label,
                    ),
                    retryable: true,
                });
            }
            // Compile INTO the document's existing runtime-library draft.
            // The old path let /from-prompt mint a second asset, leaving the
            // mssql-runbook: tab and stash attached to an orphaned placeholder.
            // Supplying the current head revision makes generation one
            // optimistic-concurrency transaction with one stable identity.
            const targetAssetId = activeLibraryAssetId(base);
            const targetAsset = await ensured.adapter.getLibraryAsset(targetAssetId, context);
            const targetRevision = targetAsset?.revisionId;
            const planned = await ensured.adapter.planFromPrompt(
                intent,
                context,
                onProgress,
                typeof targetRevision === "string" && targetRevision.length > 0
                    ? { assetId: targetAssetId, revisionId: targetRevision }
                    : undefined,
            );
            const built = buildPlannedArtifact(base, intent, planned);
            if (isPlannedArtifactFailure(built)) {
                emitRunbookEvent(context, "runbookStudio.planner.fallback", "warning", {
                    errorClass: metaField("MappingInvalid"),
                    detailClass: metaField(built.detail.slice(0, 80)),
                });
                return undefined;
            }
            let artifact = built.artifact;
            // Adopt the planner's asset title while the document still wears
            // the New-Runbook placeholder — tree and document then match.
            if (isPlaceholderRunbookName(artifact.name) && planned.title) {
                artifact = { ...artifact, name: planned.title };
            }
            return artifact;
        } catch (error) {
            // Typed refusal propagates — it must not trigger a compiler
            // fallback that hides authentication or cancellation state.
            if (error instanceof RuntimeStartRefusedError) {
                throw error;
            }
            emitRunbookEvent(context, "runbookStudio.planner.fallback", "warning", {
                errorClass: metaField(error instanceof Error ? error.name : "UnknownError"),
            });
            return undefined;
        }
    }

    /** Abort an in-flight planner generation (user cancel). */
    public cancelCompile(): boolean {
        return this.hobbesAdapter?.cancelActivePlanner() ?? false;
    }

    public async getRuntimeProviderStatus(): Promise<{
        status?: HobbesProviderStatus;
        error?: RbsError;
    }> {
        const context = newRunbookRootContext("providerStatus");
        const ensured = this.ensureHobbesAdapter();
        if ("error" in ensured) {
            return { error: ensured.error };
        }
        try {
            return { status: await ensured.adapter.getProviderStatus(context) };
        } catch {
            return {
                error: {
                    code: "RunbookStudio.ModelUnavailable",
                    message: LocRunbookStudio.runtimeProviderStatusFailed,
                    retryable: true,
                },
            };
        }
    }

    public async signInRuntimeProvider(
        onEvent: (event: HobbesProviderLoginEvent) => void,
        cancellation: vscode.CancellationToken,
    ): Promise<"succeeded" | "failed" | "cancelled"> {
        const context = newRunbookRootContext("providerLogin");
        const ensured = this.ensureHobbesAdapter();
        if ("error" in ensured) {
            return "failed";
        }
        const controller = new AbortController();
        const registration = cancellation.onCancellationRequested(() => controller.abort());
        try {
            return await ensured.adapter.loginProvider(context, onEvent, controller.signal);
        } catch {
            return controller.signal.aborted ? "cancelled" : "failed";
        } finally {
            registration.dispose();
        }
    }

    /** "Name (2)"-style dedupe against every OTHER library title. Listing
     *  failures degrade to the wanted name — a duplicate is not fatal. */
    private async dedupeTitleAgainstLibrary(want: string, ownAssetId: string): Promise<string> {
        const ensured = this.ensureHobbesAdapter();
        if ("error" in ensured) {
            return want;
        }
        try {
            const context = newRunbookRootContext("library");
            const taken = new Set(
                (await ensured.adapter.listLibrary(context))
                    .filter((a) => a.id !== ownAssetId)
                    .map((a) => a.title.toLowerCase()),
            );
            let title = want;
            for (let n = 2; taken.has(title.toLowerCase()); n++) {
                title = `${want} (${n})`;
            }
            return title;
        } catch {
            return want;
        }
    }

    /** Saved connection profiles as opaque {id, label} handles for the
     *  parameter sheet — never connection strings or credentials. */
    public async listConnectionProfiles(): Promise<Array<{ id: string; label: string }>> {
        const connectionManager = this.connectionAccess();
        if (!connectionManager) {
            return [];
        }
        try {
            const profiles = await connectionManager.connectionStore.readAllConnections(false);
            return profiles
                .filter((p) => typeof p.id === "string" && p.id.length > 0)
                .map((p) => ({
                    id: p.id,
                    label:
                        p.profileName ||
                        `${p.server}${p.database ? ` · ${p.database}` : ""}` ||
                        p.id,
                }));
        } catch {
            return [];
        }
    }

    // -- runbook library (R3, D-0012) ----------------------------------------

    /** Non-archived runbook assets from the runtime library. Works on any
     *  configured run lane — the library always targets the hobbes runtime
     *  through a lazily held adapter. */
    public async listLibraryRunbooks(): Promise<{
        assets?: RunbookLibraryAsset[];
        error?: RbsError;
    }> {
        const context = newRunbookRootContext("library");
        const ensured = this.ensureHobbesAdapter();
        if ("error" in ensured) {
            emitRunbookEvent(context, "runbookStudio.library.list", "error", {
                errorClass: metaField("AdapterUnavailable"),
            });
            return { error: ensured.error };
        }
        try {
            const assets = await ensured.adapter.listLibrary(context);
            emitRunbookEvent(context, "runbookStudio.library.list", "ok", {
                assetCount: metaField(assets.length),
            });
            return { assets };
        } catch (error) {
            emitRunbookEvent(context, "runbookStudio.library.list", "error", {
                errorClass: metaField(error instanceof Error ? error.name : "UnknownError"),
            });
            return { error: libraryError(error) };
        }
    }

    /** Full library asset record; asset undefined when the id is unknown. */
    public async getLibraryRunbook(id: string): Promise<{
        asset?: Record<string, unknown>;
        error?: RbsError;
    }> {
        const context = newRunbookRootContext("library");
        const ensured = this.ensureHobbesAdapter();
        if ("error" in ensured) {
            emitRunbookEvent(context, "runbookStudio.library.get", "error", {
                errorClass: metaField("AdapterUnavailable"),
            });
            return { error: ensured.error };
        }
        try {
            const asset = await ensured.adapter.getLibraryAsset(id, context);
            emitRunbookEvent(context, "runbookStudio.library.get", "ok", {
                found: metaField(asset !== undefined),
            });
            return asset ? { asset } : {};
        } catch (error) {
            emitRunbookEvent(context, "runbookStudio.library.get", "error", {
                errorClass: metaField(error instanceof Error ? error.name : "UnknownError"),
            });
            return { error: libraryError(error) };
        }
    }

    /** Narrow controller-facing lifecycle probe. Unknown/offline state is
     * returned as undefined; the subsequent library transaction remains the
     * authority and will still fail honestly if the runtime is unavailable. */
    public async getLibraryLifecycleState(id: string): Promise<string | undefined> {
        const result = await this.getLibraryRunbook(id);
        return typeof result.asset?.state === "string" ? result.asset.state : undefined;
    }

    /** Runtime revision/content baseline captured when a virtual document is
     *  read. Absence means the runtime asset no longer exists. */
    public async getLibraryDocumentBaseline(
        id: string,
    ): Promise<LibraryDocumentBaseline | undefined> {
        const context = newRunbookRootContext("library");
        const ensured = this.ensureHobbesAdapter();
        if ("error" in ensured) {
            throw new Error(ensured.error.message);
        }
        return ensured.adapter.getLibraryDocumentBaseline(id, context);
    }

    /** Commit the bytes VS Code is saving to the corresponding runtime head.
     *  Stash persistence remains in the file-system provider and happens only
     *  after this optimistic-concurrency transaction succeeds. */
    public async commitLibraryDocument(
        id: string,
        artifactJson: string,
        expected: LibraryDocumentBaseline | undefined,
        resolution: LibraryDocumentConflictResolution,
    ): Promise<LibraryDocumentCommitResult> {
        const parsed = parseRunbookArtifact(artifactJson);
        if (isArtifactParseFailure(parsed)) {
            throw new Error(LocRunbookStudio.invalidArtifact(parsed.detail));
        }
        const artifact = parsed.artifact;
        const artifactAssetId = activeLibraryAssetId(artifact);
        if (artifactAssetId !== id) {
            throw new Error(`library document identity mismatch (${id} != ${artifactAssetId})`);
        }
        const context = newRunbookRootContext("library");
        const ensured = this.ensureHobbesAdapter();
        if ("error" in ensured) {
            throw new Error(ensured.error.message);
        }
        const result = await ensured.adapter.commitLibraryDocument(
            id,
            artifact,
            expected,
            resolution,
            context,
        );
        emitRunbookEvent(
            context,
            "runbookStudio.library.commit",
            result.status === "committed" ? "ok" : "warning",
            {
                conflict: metaField(result.status === "conflict"),
                resolution: metaField(resolution),
            },
        );
        if (result.status === "committed") {
            this.activeRunsEmitter.fire();
        }
        return result;
    }

    /** Import an OUTSIDE-authored library runbook (no publish-time stash to
     *  round-trip, D-0012 interop): fetch the raw asset, map its plan IR
     *  through the SAME mapping the planner authoring path uses, and write
     *  the stash — after which the standard open-from-library flow applies.
     *  The built lock references the asset (+ version label), so the hobbes
     *  lane launches the library asset directly, never translating. */
    public async importLibraryRunbook(assetId: string): Promise<{ ok: boolean; error?: RbsError }> {
        const context = newRunbookRootContext("library");
        const fetched = await this.getLibraryRunbook(assetId);
        if (fetched.error) {
            emitRunbookEvent(context, "runbookStudio.library.import", "error", {
                errorClass: metaField("AssetUnavailable"),
            });
            return { ok: false, error: fetched.error };
        }
        if (!fetched.asset) {
            emitRunbookEvent(context, "runbookStudio.library.import", "error", {
                errorClass: metaField("AssetNotFound"),
            });
            return {
                ok: false,
                error: {
                    code: "RunbookStudio.DataUnavailable",
                    message: LocRunbookStudio.libraryImportAssetMissing,
                },
            };
        }
        const extensions = fetched.asset.clientExtensions;
        const embedded =
            typeof extensions === "object" && extensions !== null && !Array.isArray(extensions)
                ? (extensions as Record<string, unknown>).vscodeMssqlArtifact
                : undefined;
        const embeddedParsed =
            embedded !== undefined ? parseRunbookArtifact(JSON.stringify(embedded)) : undefined;
        const embeddedArtifact =
            embeddedParsed &&
            !isArtifactParseFailure(embeddedParsed) &&
            activeLibraryAssetId(embeddedParsed.artifact) === assetId
                ? embeddedParsed.artifact
                : undefined;
        // A VS Code-authored asset carries the exact source/presentation
        // projection in the runtime head. Outside-authored assets fall back
        // to the plan-IR mapper as before.
        const built = embeddedArtifact
            ? { ok: true as const, artifact: embeddedArtifact }
            : buildArtifactFromLibraryAsset(fetched.asset);
        if (isPlannedArtifactFailure(built)) {
            emitRunbookEvent(context, "runbookStudio.library.import", "error", {
                errorClass: metaField("MappingInvalid"),
                detailClass: metaField(built.detail.slice(0, 80)),
            });
            return {
                ok: false,
                error: {
                    code: "RunbookStudio.InvalidArtifact",
                    message: LocRunbookStudio.libraryImportFailed(built.detail),
                },
            };
        }
        try {
            // artifact.id === assetId, so the stash lands exactly where the
            // open flow (stashUri by asset id) will look for it.
            await writeStash(
                this.globalStorageUri,
                built.artifact.id,
                canonicalizeRunbookArtifact(built.artifact),
            );
        } catch (error) {
            emitRunbookEvent(context, "runbookStudio.library.import", "error", {
                errorClass: metaField(error instanceof Error ? error.name : "UnknownError"),
            });
            return { ok: false, error: libraryError(error) };
        }
        emitRunbookEvent(context, "runbookStudio.library.import", "ok", {
            nodeCount: metaField(built.artifact.lock?.nodes.length ?? 0),
        });
        return { ok: true };
    }

    /** Runtime-backed model choices for the authoring and execution roles.
     * Catalogs are profile-specific: every option shown is executable by
     * the Hobbes provider that will receive that role. */
    public async getModelConfiguration(): Promise<RbsModelConfiguration | { error: RbsError }> {
        const context = newRunbookRootContext("library");
        const ensured = this.ensureHobbesAdapter();
        if ("error" in ensured) {
            return { error: ensured.error };
        }
        try {
            const doc = await ensured.adapter.getRuntimeSettingsDocument(context);
            const authoringProfile = runtimeProviderProfileForRole(doc, "authoring");
            const executionProfile = runtimeProviderProfileForRole(doc, "execution");
            const authoringModelId = authoringProfile
                ? runtimeModelIdForRole(authoringProfile, "authoring")
                : undefined;
            const executionModelId = executionProfile
                ? runtimeModelIdForRole(executionProfile, "execution")
                : undefined;
            if (
                !authoringProfile?.id ||
                !executionProfile?.id ||
                !authoringModelId ||
                !executionModelId
            ) {
                return { error: modelConfigurationUnavailableError() };
            }
            const catalogs = new Map<string, Promise<RbsModelOption[]>>();
            const getCatalog = (profileId: string): Promise<RbsModelOption[]> => {
                let pending = catalogs.get(profileId);
                if (!pending) {
                    pending = ensured.adapter.getRuntimeModelCatalog(profileId, context);
                    catalogs.set(profileId, pending);
                }
                return pending;
            };
            const [authoringModels, executionModels] = await Promise.all([
                getCatalog(authoringProfile.id),
                getCatalog(executionProfile.id),
            ]);
            return {
                authoring: modelRoleConfiguration(
                    authoringProfile,
                    authoringModelId,
                    authoringModels,
                ),
                execution: modelRoleConfiguration(
                    executionProfile,
                    executionModelId,
                    executionModels,
                ),
            };
        } catch (error) {
            return { error: libraryError(error) };
        }
    }

    /** Update one model role on the active provider profile via the
     *  runtime's supported settings round-trip. Returns an error string on
     *  refusal (e.g. the in-flight guard while a run executes). */
    public async setModelConfiguration(
        role: RbsModelRole,
        modelId: string,
    ): Promise<string | undefined> {
        const context = newRunbookRootContext("library");
        const ensured = this.ensureHobbesAdapter();
        if ("error" in ensured) {
            return ensured.error.message;
        }
        try {
            const doc = await ensured.adapter.getRuntimeSettingsDocument(context);
            const profile = runtimeProviderProfileForRole(doc, role);
            if (!profile || !setRuntimeModelIdForRole(profile, role, modelId)) {
                return LocRunbookStudio.modelConfigUnavailable;
            }
            const refusal = await ensured.adapter.putRuntimeSettingsDocument(doc, context);
            emitRunbookEvent(
                context,
                "runbookStudio.library.modelConfig",
                refusal ? "error" : "ok",
                {
                    role: metaField(role),
                    ...(refusal ? { detailClass: metaField(refusal.slice(0, 80)) } : {}),
                },
            );
            return refusal;
        } catch (error) {
            return error instanceof Error ? error.message : String(error);
        }
    }

    /** Recent run history for a library runbook. Runs come back EMPTY (not
     *  an error) when the asset has none or the runtime no longer knows the
     *  id — the tree renders that honestly as "no runs yet". */
    public async getLibraryRunHistory(assetId: string): Promise<{
        runs?: LibraryRunRef[];
        error?: RbsError;
    }> {
        const context = newRunbookRootContext("library");
        const ensured = this.ensureHobbesAdapter();
        if ("error" in ensured) {
            emitRunbookEvent(context, "runbookStudio.library.history", "error", {
                errorClass: metaField("AdapterUnavailable"),
            });
            return { error: ensured.error };
        }
        try {
            const detail = await ensured.adapter.getLibraryContentDetail(assetId, context);
            emitRunbookEvent(context, "runbookStudio.library.history", "ok", {
                runCount: metaField(detail.recentRuns.length),
            });
            return { runs: detail.recentRuns };
        } catch (error) {
            emitRunbookEvent(context, "runbookStudio.library.history", "error", {
                errorClass: metaField(error instanceof Error ? error.name : "UnknownError"),
            });
            return { error: libraryError(error) };
        }
    }

    /** Archive (recoverable — never purge) a library runbook. */
    public async deleteLibraryRunbook(id: string): Promise<{ ok: boolean; error?: RbsError }> {
        const context = newRunbookRootContext("library");
        const ensured = this.ensureHobbesAdapter();
        if ("error" in ensured) {
            emitRunbookEvent(context, "runbookStudio.library.archive", "error", {
                errorClass: metaField("AdapterUnavailable"),
            });
            return { ok: false, error: ensured.error };
        }
        try {
            await ensured.adapter.archiveLibraryAsset(id, context);
            emitRunbookEvent(context, "runbookStudio.library.archive", "ok", {});
            return { ok: true };
        } catch (error) {
            emitRunbookEvent(context, "runbookStudio.library.archive", "error", {
                errorClass: metaField(error instanceof Error ? error.name : "UnknownError"),
            });
            return { ok: false, error: libraryError(error) };
        }
    }

    /** Publish the artifact to the runtime library WITHOUT running it, and
     *  stash the exact artifact JSON so open-from-library round-trips
     *  (the stash write lives here — the adapter never imports vscode). */
    public async saveToLibrary(
        artifact: RunbookArtifactFile,
    ): Promise<{ versionLabel?: string; error?: RbsError }> {
        const context = newRunbookRootContext("library");
        const ensured = this.ensureHobbesAdapter();
        if ("error" in ensured) {
            emitRunbookEvent(context, "runbookStudio.library.publish", "error", {
                errorClass: metaField("AdapterUnavailable"),
            });
            return { error: ensured.error };
        }
        try {
            const versionLabel = await ensured.adapter.publishOnly(artifact, context);
            await writeStash(
                this.globalStorageUri,
                artifact.id,
                canonicalizeRunbookArtifact(artifact),
            );
            emitRunbookEvent(context, "runbookStudio.library.publish", "ok", {
                versionLabel: metaField(versionLabel),
            });
            return { versionLabel };
        } catch (error) {
            emitRunbookEvent(context, "runbookStudio.library.publish", "error", {
                errorClass: metaField(error instanceof Error ? error.name : "UnknownError"),
            });
            return { error: libraryError(error) };
        }
    }

    /** Create an EMPTY draft asset in the runtime library (library-first
     *  New Runbook). The caller supplies the id so the local stash artifact
     *  can share it — open-from-library then round-trips exactly. */
    public async createLibraryRunbook(request: {
        id: string;
        title: string;
        category?: string;
    }): Promise<{ ok: boolean; title?: string; error?: RbsError }> {
        const context = newRunbookRootContext("library");
        const ensured = this.ensureHobbesAdapter();
        if ("error" in ensured) {
            emitRunbookEvent(context, "runbookStudio.library.create", "error", {
                errorClass: metaField("AdapterUnavailable"),
            });
            return { ok: false, error: ensured.error };
        }
        try {
            // "New runbook", "New runbook (2)", ... — placeholder drafts must
            // be tellable apart in the tree until generation names them.
            let title = request.title;
            try {
                const existing = new Set(
                    (await ensured.adapter.listLibrary(context)).map((a) => a.title.toLowerCase()),
                );
                for (let n = 2; existing.has(title.toLowerCase()); n++) {
                    title = `${request.title} (${n})`;
                }
            } catch {
                // Listing is best-effort; a duplicate title is not fatal.
            }
            await ensured.adapter.createLibraryAsset(
                {
                    id: request.id,
                    title,
                    description: "",
                    ...(request.category ? { category: request.category } : {}),
                },
                context,
            );
            emitRunbookEvent(context, "runbookStudio.library.create", "ok", {
                hasCategory: metaField(request.category !== undefined),
            });
            // The FINAL (possibly deduped) title — the caller must name the
            // stash artifact identically or tree and document diverge.
            return { ok: true, title };
        } catch (error) {
            emitRunbookEvent(context, "runbookStudio.library.create", "error", {
                errorClass: metaField(error instanceof Error ? error.name : "UnknownError"),
            });
            return { ok: false, error: libraryError(error) };
        }
    }

    /** Update ONLY the given metadata fields (title -> Rename, category ->
     *  Move to Folder) via the adapter's GET+PUT If-Match round-trip. */
    public async updateLibraryRunbook(
        id: string,
        changes: { title?: string; category?: string },
    ): Promise<{ ok: boolean; error?: RbsError }> {
        const context = newRunbookRootContext("library");
        const ensured = this.ensureHobbesAdapter();
        if ("error" in ensured) {
            emitRunbookEvent(context, "runbookStudio.library.update", "error", {
                errorClass: metaField("AdapterUnavailable"),
            });
            return { ok: false, error: ensured.error };
        }
        try {
            await ensured.adapter.updateLibraryAssetFields(id, changes, context);
            emitRunbookEvent(context, "runbookStudio.library.update", "ok", {
                titleChanged: metaField(changes.title !== undefined),
                categoryChanged: metaField(changes.category !== undefined),
            });
            return { ok: true };
        } catch (error) {
            emitRunbookEvent(context, "runbookStudio.library.update", "error", {
                errorClass: metaField(error instanceof Error ? error.name : "UnknownError"),
            });
            return { ok: false, error: libraryError(error) };
        }
    }

    /** Restore an archived library runbook back to draft. */
    public async restoreLibraryRunbook(id: string): Promise<{ ok: boolean; error?: RbsError }> {
        const context = newRunbookRootContext("library");
        const ensured = this.ensureHobbesAdapter();
        if ("error" in ensured) {
            emitRunbookEvent(context, "runbookStudio.library.restore", "error", {
                errorClass: metaField("AdapterUnavailable"),
            });
            return { ok: false, error: ensured.error };
        }
        try {
            await ensured.adapter.restoreLibraryAsset(id, context);
            emitRunbookEvent(context, "runbookStudio.library.restore", "ok", {});
            return { ok: true };
        } catch (error) {
            emitRunbookEvent(context, "runbookStudio.library.restore", "error", {
                errorClass: metaField(error instanceof Error ? error.name : "UnknownError"),
            });
            return { ok: false, error: libraryError(error) };
        }
    }

    /** Permanently delete a runbook AND all its run history: run history
     *  first (idempotent), then the asset purge (the runtime hard-deletes
     *  only archived assets, so non-archived ones are archived on the way),
     *  and finally the local stash file. A runbook already missing from the
     *  runtime still clears history remnants and the stash — the goal state
     *  is "gone", not "was present to delete". */
    public async deleteLibraryRunbookPermanently(
        id: string,
    ): Promise<{ ok: boolean; error?: RbsError }> {
        const context = newRunbookRootContext("library");
        const ensured = this.ensureHobbesAdapter();
        if ("error" in ensured) {
            emitRunbookEvent(context, "runbookStudio.library.delete", "error", {
                errorClass: metaField("AdapterUnavailable"),
            });
            return { ok: false, error: ensured.error };
        }
        if (
            [...this.activeByRunId.values()].some(
                (binding) => !binding.runEnded && binding.artifact.id === id,
            )
        ) {
            return {
                ok: false,
                error: { code: "RunbookStudio.RunActive", message: LocRunbookStudio.runActive },
            };
        }
        try {
            const deletedRuns = await ensured.adapter.deleteLibraryRunHistory(id, context);
            const asset = await ensured.adapter.getLibraryAsset(id, context);
            if (asset !== undefined) {
                const state = typeof asset.state === "string" ? asset.state.toLowerCase() : "";
                if (state !== "archived") {
                    await ensured.adapter.archiveLibraryAsset(id, context);
                }
                await ensured.adapter.purgeLibraryAsset(id, context);
            }
            let deletedLocalRuns = 0;
            for (const run of this.ledger.listRuns(id)) {
                this.deleteLocalRunData(run.runId);
                if (this.ledger.deleteRun(run.runId)) {
                    deletedLocalRuns++;
                }
            }
            await removeStash(this.globalStorageUri, id);
            emitRunbookEvent(context, "runbookStudio.library.delete", "ok", {
                deletedRuns: metaField(deletedRuns),
                deletedLocalRuns: metaField(deletedLocalRuns),
                assetFound: metaField(asset !== undefined),
            });
            return { ok: true };
        } catch (error) {
            emitRunbookEvent(context, "runbookStudio.library.delete", "error", {
                errorClass: metaField(error instanceof Error ? error.name : "UnknownError"),
            });
            return { ok: false, error: libraryError(error) };
        }
    }

    // -- internals -------------------------------------------------------------

    /** Library-lane adapter: reuse the run adapter when it already IS the
     *  hobbes one, else lazily construct and hold a dedicated instance.
     *  Construction is cheap — the supervisor launches the runtime process
     *  only on the first actual call. */
    private ensureHobbesAdapter(): { adapter: HobbesRuntimeAdapter } | { error: RbsError } {
        if (this.hobbesAdapter) {
            return { adapter: this.hobbesAdapter };
        }
        if (this.adapter instanceof HobbesRuntimeAdapter) {
            this.hobbesAdapter = this.adapter;
            return { adapter: this.adapter };
        }
        // The runtime is a pinned black-box package (A2 §3.3); the
        // executable is resolved from explicit configuration or env —
        // never guessed, never downloaded silently (ADR-8 gates that).
        const executablePath =
            vscode.workspace
                .getConfiguration()
                .get<string>("mssql.runbookStudio.hobbesRuntimePath", "") ||
            process.env.MSSQL_HOBBES_RUNTIME ||
            "";
        if (!executablePath) {
            return {
                error: {
                    code: "RunbookStudio.RuntimeCapabilityUnsupported",
                    message: LocRunbookStudio.hobbesRuntimePathMissing,
                },
            };
        }
        this.hobbesAdapter = new HobbesRuntimeAdapter(
            new RuntimeSupervisor(executablePath, this.storageRoot),
            async (profileId) => {
                const connectionManager = this.connectionAccess();
                if (!connectionManager) {
                    return undefined;
                }
                const profiles = await connectionManager.connectionStore.readAllConnections(false);
                const profile = profiles.find((p) => p.id === profileId);
                if (!profile) {
                    return undefined;
                }
                return {
                    label: profile.profileName || profile.server || profile.id,
                    server: profile.server,
                    ...(profile.database ? { database: profile.database } : {}),
                    // Windows integrated auth only for the JsonFile
                    // registry — credentials never enter the file.
                    integratedAuth:
                        String(profile.authenticationType ?? "").toLowerCase() === "integrated",
                };
            },
            () =>
                plannerTimeoutMilliseconds(
                    vscode.workspace
                        .getConfiguration()
                        .get<number>("mssql.runbookStudio.plannerTimeoutMinutes"),
                ),
        );
        return { adapter: this.hobbesAdapter };
    }

    /** Bounded runId->trace retention (survives terminal for deep links). */
    private rememberTrace(runId: string, traceId: string): void {
        this.traceByRunId.set(runId, traceId);
        if (this.traceByRunId.size > 200) {
            const first = this.traceByRunId.keys().next().value;
            if (first !== undefined) {
                this.traceByRunId.delete(first);
            }
        }
    }

    /** Seed a model's history AND last-run presentation from the durable
     *  ledger, once per model (called on document open and defensively at
     *  run start). Interrupted journals for this runbook are sealed first
     *  (honest "failed — interrupted" terminals), then the most recent
     *  run's snapshot rehydrates as the default presentation so reopening
     *  a runbook shows its prior results, not an empty page. */
    public seedHistory(model: RunbookStudioDocumentModel): void {
        if (this.seededModels.has(model) || !model.artifact) {
            return;
        }
        this.seededModels.add(model);
        const runbookId = model.artifact.id;
        const context = newRunbookRootContext("persistence");
        Perf.marker("mssql.runbookStudio.run.recover.begin", "begin", undefined, context.traceId);
        let outcome = "failed";
        try {
            const sealedInterrupted = this.ledger.sealInterruptedRuns(
                LocRunbookStudio.runInterrupted,
                runbookId,
            );
            // A run that survived this window's panel close is still live:
            // re-point its binding at the freshly opened model so boundary
            // events keep painting into the new panel.
            const liveBinding = this.activeByDocument.get(model.uriKey);
            if (liveBinding && !liveBinding.runEnded) {
                liveBinding.model = model;
            }
            const entries = this.ledger.listRuns(runbookId);
            if (entries.length === 0) {
                outcome = sealedInterrupted > 0 ? "sealedInterrupted" : "empty";
                emitRunbookEvent(context, "runbookStudio.persistence.rehydrate", "ok", {
                    runbookIdDigest: metaField(shortDigest(runbookId)),
                    runCount: metaField(0),
                    sealedInterrupted: metaField(sealedInterrupted),
                    rehydratedRun: metaField(false),
                });
                return;
            }
            model.seedHistory(entries);
            let rehydratedRun = false;
            if (liveBinding && !liveBinding.runEnded) {
                const liveSnapshot = this.ledger.snapshotOf(liveBinding.runId);
                if (liveSnapshot) {
                    model.setActiveRun(liveSnapshot);
                    rehydratedRun = true;
                }
            } else {
                const latest = this.ledger.snapshotOf(entries[0].runId);
                if (latest) {
                    model.setActiveRun(latest);
                    rehydratedRun = true;
                }
            }
            outcome = rehydratedRun ? "rehydrated" : "historyOnly";
            emitRunbookEvent(context, "runbookStudio.persistence.rehydrate", "ok", {
                runbookIdDigest: metaField(shortDigest(runbookId)),
                runCount: metaField(entries.length),
                sealedInterrupted: metaField(sealedInterrupted),
                rehydratedRun: metaField(rehydratedRun),
            });
        } finally {
            Perf.marker("mssql.runbookStudio.run.recover.end", "end", { outcome }, context.traceId);
        }
    }

    /** Retention sweep (construction-time, deferred): seal every orphaned
     *  interrupted journal, expire runs beyond the newest N per runbook,
     *  and drop result-payload directories with no surviving run. */
    private sweepPersistence(): void {
        const context = newRunbookRootContext("persistence");
        const sealedInterrupted = this.ledger.sealInterruptedRuns(LocRunbookStudio.runInterrupted);
        const runs = this.ledger.listAllRuns();
        const expired = selectExpiredRuns(runs, RETAINED_RUNS_PER_RUNBOOK);
        let deletedRuns = 0;
        let deletedEffectJournals = 0;
        let deletedApprovalRecords = 0;
        for (const runId of expired) {
            if (this.activeByRunId.has(runId)) {
                continue;
            }
            if (this.ledger.deleteRun(runId)) {
                deletedRuns++;
            }
            this.resultStore.deleteRunResults(runId);
            this.runDropStore.deleteRun(runId);
            deletedEffectJournals += this.effectLedger.deleteTerminalEffectsForRun(runId);
            deletedApprovalRecords += this.approvalLedger.deleteApprovalsForRun(runId);
        }
        // Orphaned result directories: payloads whose run no longer exists
        // anywhere in the ledger (e.g. records expired by another window).
        const retained = new Set(
            runs.filter((r) => !expired.includes(r.runId)).map((r) => sanitizeRunFileId(r.runId)),
        );
        let deletedResultDirs = 0;
        for (const dirId of this.resultStore.listPersistedRunIds()) {
            if (!retained.has(dirId)) {
                this.resultStore.deleteRunResults(dirId);
                deletedResultDirs++;
            }
        }
        let deletedRunDropDirs = 0;
        for (const dirId of this.runDropStore.listPersistedRunIds()) {
            if (!retained.has(dirId) && this.runDropStore.deleteRun(dirId)) {
                deletedRunDropDirs++;
            }
        }
        const stagedDacpacCleanup = cleanupStaleLocalDacpacArtifacts(
            path.join(this.persistRoot, "artifact-staging"),
            Date.now() - STAGED_DACPAC_RETENTION_MS,
        );
        const effectRecovery = this.effectLedger.scanRecovery();
        emitRunbookEvent(context, "runbookStudio.persistence.gc", "ok", {
            scannedRuns: metaField(runs.length),
            sealedInterrupted: metaField(sealedInterrupted),
            expiredRuns: metaField(deletedRuns),
            deletedResultDirs: metaField(deletedResultDirs),
            deletedRunDropDirs: metaField(deletedRunDropDirs),
            deletedEffectJournals: metaField(deletedEffectJournals),
            deletedApprovalRecords: metaField(deletedApprovalRecords),
            deletedStagedDacpacs: metaField(stagedDacpacCleanup.deletedFiles),
            deletedStagingDirectories: metaField(stagedDacpacCleanup.deletedDirectories),
            outstandingEffects: metaField(effectRecovery.outstanding.length),
            unreadableEffectJournals: metaField(effectRecovery.unreadableFiles.length),
            pendingApprovals: metaField(this.approvalLedger.listPending().length),
        });
    }

    private deleteLocalRunData(runId: string): void {
        this.runDropStore.deleteRun(runId);
        this.resultStore.deleteRunResults(runId);
        this.effectLedger.deleteTerminalEffectsForRun(runId);
        this.approvalLedger.deleteApprovalsForRun(runId);
        this.traceByRunId.delete(runId);
    }

    /** Recover disposable/named localhost databases and owned containers
     * after a terminal run or host restart. Another live extension host retains
     * ownership; ambiguous or marker-mismatched effects are surfaced and
     * never dropped blindly. */
    private async recoverOutstandingSandboxEffects(runId?: string): Promise<void> {
        if (this.effectRecoveryInProgress) {
            return;
        }
        this.effectRecoveryInProgress = true;
        const context = newRunbookRootContext("effect-recovery");
        let recovered = 0;
        let deferred = 0;
        let liveOwner = 0;
        let attention = 0;
        try {
            const scan = this.effectLedger.scanRecovery();
            attention += scan.unreadableFiles.length;
            for (const entry of scan.outstanding) {
                const snapshot = entry.snapshot;
                if (
                    snapshot.identity.activityKind !== "sandbox.provision" ||
                    (runId !== undefined && snapshot.identity.runId !== runId)
                ) {
                    continue;
                }
                if (this.activeByRunId.has(snapshot.identity.runId)) {
                    deferred++;
                    continue;
                }
                const ownerPid = snapshot.identity.ownerPid;
                if (
                    ownerPid !== undefined &&
                    ownerPid !== process.pid &&
                    isProcessAlive(ownerPid)
                ) {
                    liveOwner++;
                    continue;
                }
                if (snapshot.state === "needsOperatorDecision") {
                    attention++;
                    continue;
                }
                try {
                    await this.cleanupLocalSandboxEffect(snapshot);
                    recovered++;
                } catch {
                    const latest = this.effectLedger.recoverEffect(
                        snapshot.identity.effectId,
                    )?.snapshot;
                    if (latest?.state === "cleaned" || latest?.state === "failedNoEffect") {
                        recovered++;
                    } else if (latest?.state === "needsOperatorDecision") {
                        attention++;
                    } else {
                        deferred++;
                    }
                }
            }
            for (const entry of this.effectLedger.scanRecovery().outstanding) {
                const snapshot = entry.snapshot;
                if (
                    (snapshot.identity.activityKind !== "devdatabase.provision" &&
                        snapshot.identity.activityKind !== "dacpac.deploy.dev" &&
                        snapshot.identity.activityKind !== "sql.schema.apply") ||
                    (runId !== undefined && snapshot.identity.runId !== runId)
                ) {
                    continue;
                }
                if (this.activeByRunId.has(snapshot.identity.runId)) {
                    deferred++;
                    continue;
                }
                const ownerPid = snapshot.identity.ownerPid;
                if (
                    ownerPid !== undefined &&
                    ownerPid !== process.pid &&
                    isProcessAlive(ownerPid)
                ) {
                    liveOwner++;
                    continue;
                }
                if (snapshot.state === "needsOperatorDecision") {
                    attention++;
                    continue;
                }
                try {
                    await this.rollbackOutstandingDevelopmentDatabaseEffect(snapshot);
                    recovered++;
                } catch {
                    const latest = this.effectLedger.recoverEffect(
                        snapshot.identity.effectId,
                    )?.snapshot;
                    if (latest?.state === "cleaned" || latest?.state === "failedNoEffect") {
                        recovered++;
                    } else if (latest?.state === "needsOperatorDecision") {
                        attention++;
                    } else {
                        deferred++;
                    }
                }
            }
            for (const entry of this.effectLedger.scanRecovery().outstanding) {
                const snapshot = entry.snapshot;
                if (
                    snapshot.identity.activityKind !== "sql.container.provision" ||
                    (runId !== undefined && snapshot.identity.runId !== runId)
                ) {
                    continue;
                }
                if (this.activeByRunId.has(snapshot.identity.runId)) {
                    deferred++;
                    continue;
                }
                const ownerPid = snapshot.identity.ownerPid;
                if (
                    ownerPid !== undefined &&
                    ownerPid !== process.pid &&
                    isProcessAlive(ownerPid)
                ) {
                    liveOwner++;
                    continue;
                }
                if (snapshot.state === "needsOperatorDecision") {
                    attention++;
                    continue;
                }
                try {
                    await this.cleanupLocalSqlContainerEffect(snapshot);
                    recovered++;
                } catch {
                    const latest = this.effectLedger.recoverEffect(
                        snapshot.identity.effectId,
                    )?.snapshot;
                    if (latest?.state === "cleaned" || latest?.state === "failedNoEffect") {
                        recovered++;
                    } else if (latest?.state === "needsOperatorDecision") {
                        attention++;
                    } else {
                        deferred++;
                    }
                }
            }
            const unresolvedDeployments = this.effectLedger
                .scanRecovery()
                .outstanding.filter((entry) => {
                    const identity = entry.snapshot.identity;
                    return (
                        identity.activityKind === "dacpac.deploy" &&
                        !this.activeByRunId.has(identity.runId) &&
                        (identity.ownerPid === undefined ||
                            identity.ownerPid === process.pid ||
                            !isProcessAlive(identity.ownerPid))
                    );
                }).length;
            const unresolvedTsqltExecutions = this.effectLedger
                .scanRecovery()
                .outstanding.filter((entry) => {
                    const identity = entry.snapshot.identity;
                    return (
                        identity.activityKind === "tsqlt.run" &&
                        !this.activeByRunId.has(identity.runId) &&
                        (identity.ownerPid === undefined ||
                            identity.ownerPid === process.pid ||
                            !isProcessAlive(identity.ownerPid))
                    );
                }).length;
            attention += unresolvedDeployments + unresolvedTsqltExecutions;
            emitRunbookEvent(context, "runbookStudio.effect.recovery", "ok", {
                recovered: metaField(recovered),
                deferred: metaField(deferred),
                liveOwner: metaField(liveOwner),
                attention: metaField(attention),
                unreadableJournals: metaField(scan.unreadableFiles.length),
                unresolvedDeployments: metaField(unresolvedDeployments),
                unresolvedTsqltExecutions: metaField(unresolvedTsqltExecutions),
            });
            if (attention > 0 && !this.effectRecoveryWarningShown) {
                this.effectRecoveryWarningShown = true;
                void vscode.window.showWarningMessage(
                    LocRunbookStudio.sandboxRecoveryAttention(attention),
                );
            }
        } finally {
            this.effectRecoveryInProgress = false;
        }
    }

    private async ensureAdapter(
        context: RunbookOperationContext,
        requestedRuntimeKind?: string,
    ): Promise<{ adapter: RunbookRuntimeAdapter } | { error: RbsError }> {
        const runtimeKind =
            requestedRuntimeKind ??
            vscode.workspace.getConfiguration().get<string>("mssql.runbookStudio.runtime", "local");
        if (this.adapter && this.adapterKind === runtimeKind) {
            return { adapter: this.adapter };
        }
        if (this.adapter) {
            // The setting changed mid-session: hot-swap the adapter. Never
            // yank a runtime out from under active runs — finish or cancel
            // them first (honest refusal beats a silent split-brain).
            if (this.activeByRunId.size > 0) {
                return {
                    error: {
                        code: "RunbookStudio.RunActive",
                        message: LocRunbookStudio.runtimeSwitchBlocked,
                    },
                };
            }
            emitRunbookEvent(context, "runbookStudio.runtime.swapped", "ok", {
                fromKind: metaField(this.adapterKind ?? "none"),
                toKind: metaField(runtimeKind),
            });
            if (this.adapter === this.hobbesAdapter) {
                // Disposing the run adapter also disposes the shared library
                // adapter instance — drop the reference so library calls
                // rebuild a fresh one instead of using a killed supervisor.
                this.hobbesAdapter = undefined;
            }
            await this.adapter.dispose();
            this.adapter = undefined;
            this.capabilities = undefined;
        }
        let adapter: RunbookRuntimeAdapter;
        if (runtimeKind === "fake") {
            adapter = new FakeRuntimeAdapter();
        } else if (runtimeKind === "local") {
            // In-process plan walker + REAL SQL through the extension's own
            // connections (read-only guarded). Same deterministic semantics
            // for every non-SQL activity.
            adapter = new FakeRuntimeAdapter(
                new LocalSqlActivityDelegate({
                    inspectWorkspace: inspectLocalWorkspace,
                    discoverSqlTests: discoverLocalSqlTests,
                    runTsqlt: (nodeId, databaseRef, selection, invocation, cancelled) =>
                        this.runLocalTsqlt(nodeId, databaseRef, selection, invocation, cancelled),
                    buildDacpac: buildLocalDacpac,
                    extractDacpac: (nodeId, databaseRef, databaseName, invocation, cancelled) =>
                        this.extractLocalDacpac(
                            nodeId,
                            databaseRef,
                            databaseName,
                            invocation,
                            cancelled,
                        ),
                    provisionSandbox: (nodeId, baseConnectionRef, invocation, cancelled) =>
                        this.provisionLocalSandbox(
                            nodeId,
                            baseConnectionRef,
                            invocation,
                            cancelled,
                        ),
                    provisionDevelopmentDatabase: (
                        nodeId,
                        baseConnectionRef,
                        databaseName,
                        invocation,
                        cancelled,
                    ) =>
                        this.provisionLocalDevelopmentDatabase(
                            nodeId,
                            baseConnectionRef,
                            databaseName,
                            invocation,
                            cancelled,
                        ),
                    provisionSqlContainer: (
                        nodeId,
                        containerName,
                        databaseName,
                        version,
                        password,
                        port,
                        invocation,
                        cancelled,
                    ) =>
                        this.provisionLocalSqlContainer(
                            nodeId,
                            containerName,
                            databaseName,
                            version,
                            password,
                            port,
                            invocation,
                            cancelled,
                        ),
                    inspectWorkload: (filePath, cancelled) =>
                        this.inspectLocalWorkload(filePath, cancelled),
                    runWorkload: (
                        nodeId,
                        databaseRef,
                        workloadRef,
                        workloadDigest,
                        repetitions,
                        timeoutSeconds,
                        invocation,
                        cancelled,
                    ) =>
                        this.runLocalWorkload(
                            nodeId,
                            databaseRef,
                            workloadRef,
                            workloadDigest,
                            repetitions,
                            timeoutSeconds,
                            invocation,
                            cancelled,
                        ),
                    startXeventSession: (
                        nodeId,
                        databaseRef,
                        template,
                        maxFileSizeMb,
                        invocation,
                        cancelled,
                    ) =>
                        this.startLocalXeventSession(
                            nodeId,
                            databaseRef,
                            template,
                            maxFileSizeMb,
                            invocation,
                            cancelled,
                        ),
                    stopXeventSession: (databaseRef, sessionRef, invocation, cancelled) =>
                        this.stopLocalXeventSession(databaseRef, sessionRef, invocation, cancelled),
                    collectXel: (nodeId, databaseRef, captureRef, invocation, cancelled) =>
                        this.collectLocalXel(
                            nodeId,
                            databaseRef,
                            captureRef,
                            invocation,
                            cancelled,
                        ),
                    previewDacpacDeployment: (dacpacPath, databaseRef, cancelled) =>
                        this.previewLocalDacpacDeployment(dacpacPath, databaseRef, cancelled),
                    deployDacpac: (
                        nodeId,
                        dacpacPath,
                        databaseRef,
                        artifactDigest,
                        previewDigest,
                        invocation,
                        cancelled,
                    ) =>
                        this.deployLocalDacpac(
                            nodeId,
                            dacpacPath,
                            databaseRef,
                            artifactDigest,
                            previewDigest,
                            invocation,
                            cancelled,
                        ),
                    deployDevelopmentDacpac: (
                        nodeId,
                        dacpacPath,
                        databaseRef,
                        artifactDigest,
                        previewDigest,
                        invocation,
                        cancelled,
                    ) =>
                        this.deployLocalDacpac(
                            nodeId,
                            dacpacPath,
                            databaseRef,
                            artifactDigest,
                            previewDigest,
                            invocation,
                            cancelled,
                            "dacpac.deploy.dev",
                        ),
                    deployContainerDacpac: (
                        nodeId,
                        dacpacPath,
                        databaseRef,
                        artifactDigest,
                        previewDigest,
                        invocation,
                        cancelled,
                    ) =>
                        this.deployLocalDacpac(
                            nodeId,
                            dacpacPath,
                            databaseRef,
                            artifactDigest,
                            previewDigest,
                            invocation,
                            cancelled,
                            "dacpac.deploy.container",
                        ),
                    applySchema: (nodeId, databaseRef, sql, invocation, cancelled) =>
                        this.applyLocalSchemaMutation(
                            nodeId,
                            databaseRef,
                            sql,
                            invocation,
                            cancelled,
                        ),
                    verifyDacpacDeployment: async (dacpacPath, databaseRef, cancelled) => {
                        const preview = await this.previewLocalDacpacDeployment(
                            dacpacPath,
                            databaseRef,
                            cancelled,
                        );
                        return {
                            ...preview,
                            matches: preview.changeCount === 0,
                        } satisfies LocalSchemaComparisonResult;
                    },
                    exportSchemaComparison: (
                        nodeId,
                        dacpacPath,
                        databaseRef,
                        invocation,
                        cancelled,
                    ) =>
                        this.exportLocalSchemaComparison(
                            nodeId,
                            dacpacPath,
                            databaseRef,
                            invocation,
                            cancelled,
                        ),
                    visualizeSchema: (databaseRef, cancelled) =>
                        this.visualizeLocalDatabaseSchema(databaseRef, cancelled),
                    disposeSandbox: (nodeId, leaseRef, invocation, cancelled) =>
                        this.disposeLocalSandbox(nodeId, leaseRef, invocation, cancelled),
                    disposeSqlContainer: (nodeId, leaseRef, invocation, cancelled) =>
                        this.disposeLocalSqlContainer(nodeId, leaseRef, invocation, cancelled),
                    bundleEvidence: (nodeId, invocation, cancelled) =>
                        this.bundleLocalEvidence(nodeId, invocation, cancelled),
                    connect: async (databaseRef, ownerUri) => {
                        const connectionManager = this.connectionAccess();
                        if (!connectionManager) {
                            return false;
                        }
                        const resolved = await this.resolveRunbookConnection(databaseRef);
                        return connectionManager.connect(ownerUri, resolved.profile, {
                            connectionSource: "runbookStudio",
                        });
                    },
                    execute: (ownerUri, queryString, cancellationToken) =>
                        Promise.resolve(
                            SqlToolsServerClient.instance.sendRequest(
                                SimpleExecuteRequestType,
                                {
                                    ownerUri,
                                    queryString,
                                },
                                cancellationToken,
                            ),
                        ),
                    disconnect: async (ownerUri) => {
                        await this.connectionAccess()?.disconnect(ownerUri);
                    },
                }),
            );
        } else if (runtimeKind === "hobbes") {
            // Reuse the library's held instance when one exists — one
            // supervisor per data directory, never two runtime processes.
            const ensured = this.ensureHobbesAdapter();
            if ("error" in ensured) {
                return { error: ensured.error };
            }
            adapter = ensured.adapter;
        } else {
            return {
                error: {
                    code: "RunbookStudio.RuntimeCapabilityUnsupported",
                    message: LocRunbookStudio.runtimeKindUnavailable(runtimeKind),
                },
            };
        }
        Perf.marker(
            "mssql.runbookStudio.runtime.initialize.begin",
            "begin",
            undefined,
            context.traceId,
        );
        try {
            this.capabilities = await adapter.initialize(context);
        } catch (error) {
            Perf.marker(
                "mssql.runbookStudio.runtime.initialize.end",
                "end",
                { outcome: "failed" },
                context.traceId,
            );
            emitRunbookEvent(context, "runbookStudio.runtime.initializeFailed", "error", {
                errorClass: metaField(error instanceof Error ? error.name : "UnknownError"),
            });
            return {
                error: {
                    code: "RunbookStudio.RuntimeUnavailable",
                    message: LocRunbookStudio.runtimeUnavailable,
                    retryable: true,
                },
            };
        }
        Perf.marker(
            "mssql.runbookStudio.runtime.initialize.end",
            "end",
            {
                outcome: "ok",
                protocolVersion: this.capabilities.protocolVersion,
                capabilityCount: Object.keys(this.capabilities).length,
            },
            context.traceId,
        );
        emitRunbookEvent(context, "runbookStudio.runtime.initialized", "ok", {
            runtimeKind: metaField(this.capabilities.runtimeKind),
            runtimeVersion: metaField(this.capabilities.runtimeVersion),
        });
        this.adapter = adapter;
        this.adapterKind = runtimeKind;
        return { adapter };
    }

    private async provisionLocalSandbox(
        nodeId: string,
        baseConnectionRef: string,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalSandboxLeaseResult> {
        const authorization = this.requireApprovedEffect(nodeId, invocation, "sandbox.provision");
        const baseProfile = await this.requireSavedConnection(baseConnectionRef);
        this.assertSandboxBaseProfile(baseProfile);

        const effectId = deriveRunbookEffectId({
            runId: invocation.runId,
            nodeId,
            attempt: invocation.attempt,
            activityKind: "sandbox.provision",
            activityVersion: authorization.challenge.activityVersion,
        });
        if (this.effectLedger.recoverEffect(effectId)) {
            throw new LocalActivityError(
                LocRunbookStudio.sandboxEffectRecoveryRequired,
                "RunbookStudio.EffectRecoveryRequired",
            );
        }
        const databaseName = localSandboxDatabaseName(effectId);
        const ownershipMarkerDigest = digestRunbookValue(effectId);
        this.effectLedger.prepareEffect({
            effectId,
            runId: invocation.runId,
            nodeId,
            attempt: invocation.attempt,
            activityKind: "sandbox.provision",
            activityVersion: authorization.challenge.activityVersion,
            idempotencyKey: digestRunbookValue({ effectId, databaseName }),
            planHash: invocation.planHash,
            bindingDigest: authorization.challenge.resolvedArgumentDigest,
            targetFingerprint: authorization.challenge.targetFingerprint,
            retrySemantics: "resumable",
            ownerPid: process.pid,
            policy: {
                version: authorization.challenge.policyVersion,
                outcome: "allowed",
            },
            approval: authorization.evidence,
            recovery: {
                resourceKind: "sqlDatabase",
                resourceId: databaseName,
                connectionProfileId: baseProfile.id,
                ownershipMarkerDigest,
            },
        });

        return this.withSandboxConnection(
            baseProfile,
            "provision",
            isCancellationRequested,
            async (ownerUri, cancellationToken) => {
                try {
                    const before = await this.probeLocalSandbox(ownerUri, databaseName);
                    if (before.exists) {
                        this.effectLedger.recordNoEffectFailure(effectId, "DatabaseNameCollision");
                        throw new LocalActivityError(
                            LocRunbookStudio.sandboxOwnershipMismatch,
                            "RunbookStudio.TargetChanged",
                        );
                    }
                    await SqlToolsServerClient.instance.sendRequest(
                        SimpleExecuteRequestType,
                        {
                            ownerUri,
                            queryString: buildCreateLocalSandboxSql(databaseName, effectId),
                        },
                        cancellationToken,
                    );
                    const created = await this.probeLocalSandbox(ownerUri, databaseName);
                    if (!created.exists || created.ownershipMarker !== effectId) {
                        if (created.exists) {
                            this.effectLedger.requireOperatorDecision(
                                effectId,
                                "OwnershipMarkerMissingOrChanged",
                            );
                        } else {
                            this.effectLedger.recordNoEffectFailure(
                                effectId,
                                "DatabaseCreateNotObserved",
                            );
                        }
                        throw new LocalActivityError(
                            LocRunbookStudio.sandboxProvisionFailed,
                            "RunbookStudio.ActivityFailed",
                        );
                    }
                    this.effectLedger.recordEffectObserved(effectId, {
                        resourceKind: "sqlDatabase",
                        resourceId: databaseName,
                        ownershipMarkerDigest,
                        connectionProfileId: baseProfile.id,
                        outputHandles: [localSandboxLeaseRef(effectId)],
                    });
                    return {
                        effectId,
                        leaseId: effectId,
                        connectionRef: localSandboxLeaseRef(effectId),
                        databaseName,
                        createdAtUtc: new Date().toISOString(),
                    };
                } catch (error) {
                    await this.settleSandboxProvisionFailure(ownerUri, effectId, databaseName);
                    if (
                        error instanceof vscode.CancellationError ||
                        cancellationToken.isCancellationRequested ||
                        isCancellationRequested()
                    ) {
                        throw new LocalActivityError(
                            LocRunbookStudio.dacpacPreviewCancelled,
                            "RunbookStudio.ActivityCancelled",
                        );
                    }
                    throw error;
                }
            },
        );
    }

    private async provisionLocalDevelopmentDatabase(
        nodeId: string,
        baseConnectionRef: string,
        databaseName: string,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalDevelopmentDatabaseLeaseResult> {
        const authorization = this.requireApprovedEffect(
            nodeId,
            invocation,
            "devdatabase.provision",
        );
        if (!isValidLocalDevelopmentDatabaseName(databaseName)) {
            throw new LocalActivityError(
                LocRunbookStudio.developmentDatabaseNameInvalid,
                "RunbookStudio.BindingInvalid",
            );
        }
        const baseProfile = await this.requireSavedConnection(baseConnectionRef);
        this.assertSandboxBaseProfile(baseProfile);
        const effectId = deriveRunbookEffectId({
            runId: invocation.runId,
            nodeId,
            attempt: invocation.attempt,
            activityKind: "devdatabase.provision",
            activityVersion: authorization.challenge.activityVersion,
        });
        if (this.effectLedger.recoverEffect(effectId)) {
            throw new LocalActivityError(
                LocRunbookStudio.sandboxEffectRecoveryRequired,
                "RunbookStudio.EffectRecoveryRequired",
            );
        }
        const ownershipMarkerDigest = digestRunbookValue(effectId);
        this.effectLedger.prepareEffect({
            effectId,
            runId: invocation.runId,
            nodeId,
            attempt: invocation.attempt,
            activityKind: "devdatabase.provision",
            activityVersion: authorization.challenge.activityVersion,
            idempotencyKey: digestRunbookValue({ effectId, databaseName }),
            planHash: invocation.planHash,
            bindingDigest: authorization.challenge.resolvedArgumentDigest,
            targetFingerprint: authorization.challenge.targetFingerprint,
            retrySemantics: "resumable",
            ownerPid: process.pid,
            policy: {
                version: authorization.challenge.policyVersion,
                outcome: "allowed",
            },
            approval: authorization.evidence,
            recovery: {
                resourceKind: "developmentSqlDatabase",
                resourceId: databaseName,
                connectionProfileId: baseProfile.id,
                ownershipMarkerDigest,
            },
        });

        return this.withSandboxConnection(
            baseProfile,
            "development-provision",
            isCancellationRequested,
            async (ownerUri, cancellationToken) => {
                try {
                    const before = await this.probeLocalDevelopmentDatabase(ownerUri, databaseName);
                    if (before.exists) {
                        this.effectLedger.recordNoEffectFailure(effectId, "DatabaseAlreadyExists");
                        throw new LocalActivityError(
                            LocRunbookStudio.developmentDatabaseTargetExists,
                            "RunbookStudio.TargetChanged",
                        );
                    }
                    await SqlToolsServerClient.instance.sendRequest(
                        SimpleExecuteRequestType,
                        {
                            ownerUri,
                            queryString: buildCreateLocalDevelopmentDatabaseSql(
                                databaseName,
                                effectId,
                            ),
                        },
                        cancellationToken,
                    );
                    const created = await this.probeLocalDevelopmentDatabase(
                        ownerUri,
                        databaseName,
                    );
                    if (!created.exists || created.ownershipMarker !== effectId) {
                        if (created.exists) {
                            this.effectLedger.requireOperatorDecision(
                                effectId,
                                "OwnershipMarkerMissingOrChanged",
                            );
                        } else {
                            this.effectLedger.recordNoEffectFailure(
                                effectId,
                                "DatabaseCreateNotObserved",
                            );
                        }
                        throw new LocalActivityError(
                            LocRunbookStudio.sandboxProvisionFailed,
                            "RunbookStudio.ActivityFailed",
                        );
                    }
                    this.effectLedger.recordEffectObserved(effectId, {
                        resourceKind: "developmentSqlDatabase",
                        resourceId: databaseName,
                        ownershipMarkerDigest,
                        connectionProfileId: baseProfile.id,
                        outputHandles: [localDevelopmentDatabaseLeaseRef(effectId)],
                    });
                    this.effectLedger.finalizeEffect(
                        effectId,
                        digestRunbookValue({
                            effectId,
                            databaseName,
                            ownershipMarkerDigest,
                            retention: "retained",
                        }),
                    );
                    return {
                        effectId,
                        leaseId: effectId,
                        connectionRef: localDevelopmentDatabaseLeaseRef(effectId),
                        databaseName,
                        createdAtUtc: new Date().toISOString(),
                        retention: "retained",
                    };
                } catch (error) {
                    await this.settleDevelopmentProvisionFailure(ownerUri, effectId, databaseName);
                    if (
                        error instanceof vscode.CancellationError ||
                        cancellationToken.isCancellationRequested ||
                        isCancellationRequested()
                    ) {
                        throw new LocalActivityError(
                            LocRunbookStudio.dacpacPreviewCancelled,
                            "RunbookStudio.ActivityCancelled",
                        );
                    }
                    throw error;
                }
            },
        );
    }

    private async provisionLocalSqlContainer(
        nodeId: string,
        containerName: string,
        databaseName: string,
        version: string,
        password: string,
        requestedPort: number | undefined,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalSqlContainerLeaseResult> {
        const authorization = this.requireApprovedEffect(
            nodeId,
            invocation,
            "sql.container.provision",
        );
        if (validateSqlServerPassword(password).length > 0) {
            throw new LocalActivityError(
                LocRunbookStudio.sqlContainerPasswordInvalid,
                "RunbookStudio.BindingInvalid",
            );
        }
        const dockerInstalled = await checkDockerInstallation();
        const dockerStarted = dockerInstalled.success
            ? await startDocker(NULL_CONTAINER_HOST)
            : dockerInstalled;
        const dockerEngine = dockerStarted.success ? await checkEngine() : dockerStarted;
        if (!dockerEngine.success) {
            throw new LocalActivityError(
                LocRunbookStudio.sqlContainerUnavailable,
                "RunbookStudio.ProviderUnavailable",
            );
        }
        if (isCancellationRequested()) {
            throw new LocalActivityError(
                LocRunbookStudio.dacpacPreviewCancelled,
                "RunbookStudio.ActivityCancelled",
            );
        }
        if (await getContainerByName(containerName)) {
            throw new LocalActivityError(
                LocRunbookStudio.sqlContainerNameExists,
                "RunbookStudio.TargetChanged",
            );
        }
        const availablePort = await findAvailablePort(requestedPort ?? 14330);
        if (availablePort < 0 || (requestedPort !== undefined && availablePort !== requestedPort)) {
            throw new LocalActivityError(
                LocRunbookStudio.sqlContainerPolicyInvalid,
                "RunbookStudio.TargetChanged",
            );
        }
        const identity = validateLocalSqlContainerIdentity({
            containerName,
            databaseName,
            version,
            port: availablePort,
        });
        if (!identity) {
            throw new LocalActivityError(
                LocRunbookStudio.sqlContainerPolicyInvalid,
                "RunbookStudio.BindingInvalid",
            );
        }
        const pull = await pullSqlServerContainerImage(identity.version);
        if (!pull.success || isCancellationRequested()) {
            throw new LocalActivityError(
                isCancellationRequested()
                    ? LocRunbookStudio.dacpacPreviewCancelled
                    : LocRunbookStudio.sqlContainerProvisionFailed,
                isCancellationRequested()
                    ? "RunbookStudio.ActivityCancelled"
                    : "RunbookStudio.ProviderUnavailable",
            );
        }
        const effectId = deriveRunbookEffectId({
            runId: invocation.runId,
            nodeId,
            attempt: invocation.attempt,
            activityKind: "sql.container.provision",
            activityVersion: authorization.challenge.activityVersion,
        });
        if (this.effectLedger.recoverEffect(effectId)) {
            throw new LocalActivityError(
                LocRunbookStudio.sandboxEffectRecoveryRequired,
                "RunbookStudio.EffectRecoveryRequired",
            );
        }
        const ownershipMarkerDigest = digestRunbookValue(effectId);
        const connectionProfileId = containerConnectionProfileId(effectId);
        this.effectLedger.prepareEffect({
            effectId,
            runId: invocation.runId,
            nodeId,
            attempt: invocation.attempt,
            activityKind: "sql.container.provision",
            activityVersion: authorization.challenge.activityVersion,
            idempotencyKey: digestRunbookValue({ effectId, ...identity }),
            planHash: invocation.planHash,
            bindingDigest: authorization.challenge.resolvedArgumentDigest,
            targetFingerprint: authorization.challenge.targetFingerprint,
            retrySemantics: "resumable",
            ownerPid: process.pid,
            policy: {
                version: authorization.challenge.policyVersion,
                outcome: "allowed",
            },
            approval: authorization.evidence,
            recovery: {
                resourceKind: "sqlContainer",
                resourceId: identity.containerName,
                connectionProfileId,
                ownershipMarkerDigest,
            },
        });

        const masterProfile = {
            server: constants.localhost,
            port: identity.port,
            database: "master",
            authenticationType: constants.sqlAuthentication,
            user: constants.sa,
            password,
            trustServerCertificate: true,
            encrypt: "mandatory",
        } as mssql.IConnectionInfo;
        this.containerLeaseProfiles.set(effectId, {
            profile: { ...masterProfile, database: identity.databaseName },
            ...identity,
        });
        try {
            const started = await startSqlServerDockerContainer(
                identity.containerName,
                password,
                identity.version,
                identity.containerName,
                identity.port,
                {
                    labels: localSqlContainerLabels(effectId, invocation.runId),
                    memoryBytes: 2 * 1024 * 1024 * 1024,
                    nanoCpus: 2_000_000_000,
                },
            );
            if (!started.success) {
                throw new LocalActivityError(
                    LocRunbookStudio.sqlContainerProvisionFailed,
                    "RunbookStudio.ActivityFailed",
                );
            }
            const container = await getContainerByName(identity.containerName);
            const inspected = await container?.inspect();
            if (
                !container ||
                !isOwnedLocalSqlContainer(inspected?.Config?.Labels, effectId, invocation.runId)
            ) {
                this.effectLedger.requireOperatorDecision(effectId, "ContainerLabelsMissing");
                throw new LocalActivityError(
                    LocRunbookStudio.sqlContainerOwnershipMismatch,
                    "RunbookStudio.TargetChanged",
                );
            }
            this.effectLedger.recordEffectObserved(effectId, {
                resourceKind: "sqlContainer",
                resourceId: identity.containerName,
                ownershipMarkerDigest,
                connectionProfileId,
                outputHandles: [
                    localSqlContainerLeaseRef(effectId),
                    `database:${identity.databaseName}`,
                ],
            });
            const ready = await checkIfSqlServerContainerIsReadyForConnections(
                identity.containerName,
            );
            if (!ready.success || isCancellationRequested()) {
                throw new LocalActivityError(
                    isCancellationRequested()
                        ? LocRunbookStudio.dacpacPreviewCancelled
                        : LocRunbookStudio.sqlContainerProvisionFailed,
                    isCancellationRequested()
                        ? "RunbookStudio.ActivityCancelled"
                        : "RunbookStudio.ActivityFailed",
                );
            }
            const connectionManager = this.connectionAccess();
            if (!connectionManager) {
                throw new LocalActivityError(
                    LocRunbookStudio.connectFailed,
                    "RunbookStudio.ProviderUnavailable",
                );
            }
            sandboxCounter++;
            const ownerUri = `runbookstudio://container-provision/${sandboxCounter.toString(36)}`;
            let connected = false;
            try {
                connected = await waitForLocalSqlContainerAuthentication(
                    () =>
                        connectionManager.connect(ownerUri, masterProfile, {
                            connectionSource: "runbookStudio",
                            shouldHandleErrors: false,
                        }),
                    async () => {
                        await connectionManager.disconnect(ownerUri);
                    },
                    isCancellationRequested,
                );
                if (!connected) {
                    throw new LocalActivityError(
                        isCancellationRequested()
                            ? LocRunbookStudio.dacpacPreviewCancelled
                            : LocRunbookStudio.connectFailed,
                        isCancellationRequested()
                            ? "RunbookStudio.ActivityCancelled"
                            : "RunbookStudio.ActivityFailed",
                    );
                }
                await SqlToolsServerClient.instance.sendRequest(SimpleExecuteRequestType, {
                    ownerUri,
                    queryString: buildCreateLocalDevelopmentDatabaseSql(
                        identity.databaseName,
                        effectId,
                    ),
                });
                const probe = await this.probeLocalDevelopmentDatabase(
                    ownerUri,
                    identity.databaseName,
                );
                if (!probe.exists || probe.ownershipMarker !== effectId) {
                    throw new LocalActivityError(
                        LocRunbookStudio.sqlContainerProvisionFailed,
                        "RunbookStudio.ActivityFailed",
                    );
                }
            } finally {
                if (connected) {
                    await connectionManager.disconnect(ownerUri);
                }
            }
            return {
                effectId,
                leaseId: effectId,
                connectionRef: localSqlContainerLeaseRef(effectId),
                databaseName: identity.databaseName,
                containerName: identity.containerName,
                port: identity.port,
                version: identity.version,
                createdAtUtc: new Date().toISOString(),
            };
        } catch (error) {
            const snapshot = this.effectLedger.recoverEffect(effectId)?.snapshot;
            if (snapshot?.state === "prepared") {
                const container = await getContainerByName(identity.containerName);
                if (!container) {
                    this.effectLedger.recordNoEffectFailure(effectId, "ContainerCreateNotObserved");
                } else {
                    const inspected = await container.inspect();
                    if (
                        isOwnedLocalSqlContainer(
                            inspected.Config?.Labels,
                            effectId,
                            invocation.runId,
                        )
                    ) {
                        this.effectLedger.recordEffectObserved(effectId, {
                            resourceKind: "sqlContainer",
                            resourceId: identity.containerName,
                            ownershipMarkerDigest,
                            connectionProfileId,
                            outputHandles: [
                                localSqlContainerLeaseRef(effectId),
                                `database:${identity.databaseName}`,
                            ],
                        });
                    } else {
                        this.effectLedger.requireOperatorDecision(
                            effectId,
                            "ContainerLabelsMissingOrChanged",
                        );
                    }
                }
            }
            const latest = this.effectLedger.recoverEffect(effectId)?.snapshot;
            if (latest?.state === "effectObserved") {
                try {
                    await this.cleanupLocalSqlContainerEffect(latest);
                } catch {
                    // The cleanup helper has already converted unsafe or
                    // ambiguous outcomes into durable operator attention.
                }
            }
            this.containerLeaseProfiles.delete(effectId);
            throw error;
        }
    }

    private async inspectLocalWorkload(
        filePath: string,
        isCancellationRequested: () => boolean,
    ): Promise<LocalWorkloadPreviewResult> {
        if (isCancellationRequested()) {
            throw new LocalActivityError(
                LocRunbookStudio.dacpacPreviewCancelled,
                "RunbookStudio.ActivityCancelled",
            );
        }
        const workspaceRoots = (vscode.workspace.workspaceFolders ?? [])
            .filter((folder) => folder.uri.scheme === "file")
            .map((folder) => folder.uri.fsPath);
        const resolvedPath = await resolveWorkspaceWorkloadPath(filePath, workspaceRoots);
        let stat: fs.Stats;
        try {
            stat = await fs.promises.lstat(resolvedPath);
        } catch {
            throw new LocalActivityError(
                LocRunbookStudio.workloadPathInvalid,
                "RunbookStudio.PathInvalid",
            );
        }
        if (
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            stat.size <= 0 ||
            stat.size > MAX_LOCAL_WORKLOAD_BYTES ||
            path.extname(resolvedPath).toLowerCase() !== ".sql"
        ) {
            throw new LocalActivityError(
                LocRunbookStudio.workloadPathInvalid,
                "RunbookStudio.PathInvalid",
            );
        }
        const content = await fs.promises.readFile(resolvedPath);
        if (isCancellationRequested()) {
            throw new LocalActivityError(
                LocRunbookStudio.dacpacPreviewCancelled,
                "RunbookStudio.ActivityCancelled",
            );
        }
        let plan: LocalWorkloadPlan;
        try {
            plan = parseLocalWorkload(content);
        } catch (error) {
            if (error instanceof LocalWorkloadPolicyError) {
                throw new LocalActivityError(
                    error.reason === "empty" || error.reason === "tooLarge"
                        ? LocRunbookStudio.workloadPathInvalid
                        : LocRunbookStudio.workloadPolicyDenied,
                    "RunbookStudio.ActivityPolicyDenied",
                );
            }
            throw error;
        }
        if (this.workloadPreviews.size >= 32) {
            const oldestRef = this.workloadPreviews.keys().next().value;
            if (typeof oldestRef === "string") {
                this.workloadPreviews.delete(oldestRef);
            }
        }
        const workloadRef = `runbook-workload:${plan.workloadSha256}:${crypto.randomUUID()}`;
        const fileName = path.basename(resolvedPath);
        this.workloadPreviews.set(workloadRef, { plan, fileName });
        return {
            workloadRef,
            fileName,
            workloadSha256: plan.workloadSha256,
            sourceByteCount: plan.sourceByteCount,
            batchCount: plan.batchCount,
            mutating: plan.mutating,
            inspectedAtUtc: new Date().toISOString(),
        };
    }

    private async runLocalWorkload(
        nodeId: string,
        databaseRef: string,
        workloadRef: string,
        expectedWorkloadSha256: string,
        repetitions: number,
        timeoutSeconds: number,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalWorkloadRunResult> {
        const authorization = this.requireApprovedEffect(nodeId, invocation, "sql.workload.run");
        const leaseEffectId = effectIdFromLocalSqlContainerLeaseRef(databaseRef);
        const lease = leaseEffectId
            ? this.effectLedger.recoverEffect(leaseEffectId)?.snapshot
            : undefined;
        if (!leaseEffectId || !lease || lease.identity.runId !== invocation.runId) {
            throw new LocalActivityError(
                LocRunbookStudio.workloadOwnedContainerRequired,
                "RunbookStudio.ActivityPolicyDenied",
            );
        }
        const preview = this.workloadPreviews.get(workloadRef);
        if (
            !preview ||
            preview.plan.workloadSha256 !== expectedWorkloadSha256 ||
            !/^runbook-workload:[a-f0-9]{64}:[a-f0-9-]{36}$/i.test(workloadRef) ||
            preview.plan.batchCount * repetitions > 1000
        ) {
            throw new LocalActivityError(
                LocRunbookStudio.workloadPreviewChanged,
                "RunbookStudio.DeploymentPreviewChanged",
            );
        }
        const resolved = await this.resolveRunbookConnection(databaseRef);
        if (!resolved.container || resolved.container.effectId !== leaseEffectId) {
            throw new LocalActivityError(
                LocRunbookStudio.workloadOwnedContainerRequired,
                "RunbookStudio.TargetChanged",
            );
        }
        const connectionManager = this.connectionAccess();
        if (!connectionManager) {
            throw new LocalActivityError(
                LocRunbookStudio.connectFailed,
                "RunbookStudio.ProviderUnavailable",
            );
        }
        const effectId = deriveRunbookEffectId({
            runId: invocation.runId,
            nodeId,
            attempt: invocation.attempt,
            activityKind: "sql.workload.run",
            activityVersion: authorization.challenge.activityVersion,
        });
        if (this.effectLedger.recoverEffect(effectId)) {
            throw new LocalActivityError(
                LocRunbookStudio.sandboxEffectRecoveryRequired,
                "RunbookStudio.EffectRecoveryRequired",
            );
        }
        this.effectLedger.prepareEffect({
            effectId,
            runId: invocation.runId,
            nodeId,
            attempt: invocation.attempt,
            activityKind: "sql.workload.run",
            activityVersion: authorization.challenge.activityVersion,
            idempotencyKey: digestRunbookValue({
                effectId,
                databaseName: resolved.targetDatabase,
                workloadSha256: expectedWorkloadSha256,
                repetitions,
            }),
            planHash: invocation.planHash,
            bindingDigest: authorization.challenge.resolvedArgumentDigest,
            targetFingerprint: authorization.challenge.targetFingerprint,
            retrySemantics: "atMostOnceUnknownOutcome",
            ownerPid: process.pid,
            policy: {
                version: authorization.challenge.policyVersion,
                outcome: "allowed",
            },
            approval: authorization.evidence,
            recovery: {
                resourceKind: "workloadExecution",
                resourceId: resolved.targetDatabase,
                connectionProfileId: resolved.container.connectionProfileId,
                ownershipMarkerDigest: resolved.container.ownershipMarkerDigest,
            },
        });
        sandboxCounter++;
        const ownerUri = `runbookstudio://workload/${sandboxCounter.toString(36)}`;
        let connected = false;
        let effectObserved = false;
        const results: LocalWorkloadRunResult["results"] = [];
        const startedAt = Date.now();
        try {
            connected = await connectionManager.connect(ownerUri, resolved.profile, {
                connectionSource: "runbookStudio",
                shouldHandleErrors: false,
            });
            if (!connected) {
                this.effectLedger.recordNoEffectFailure(effectId, "WorkloadConnectFailed");
                throw new LocalActivityError(
                    LocRunbookStudio.connectFailed,
                    "RunbookStudio.ActivityFailed",
                );
            }
            let stopAfterFailure = false;
            for (let iteration = 1; iteration <= repetitions && !stopAfterFailure; iteration++) {
                for (let batchIndex = 0; batchIndex < preview.plan.batches.length; batchIndex++) {
                    if (isCancellationRequested()) {
                        throw new LocalActivityError(
                            LocRunbookStudio.dacpacPreviewCancelled,
                            "RunbookStudio.ActivityCancelled",
                        );
                    }
                    if (!effectObserved) {
                        this.effectLedger.recordEffectObserved(effectId, {
                            resourceKind: "workloadExecution",
                            resourceId: resolved.targetDatabase,
                            ownershipMarkerDigest: resolved.container.ownershipMarkerDigest,
                            connectionProfileId: resolved.container.connectionProfileId,
                            outputHandles: [databaseRef, workloadRef],
                        });
                        effectObserved = true;
                    }
                    const batchStartedAt = Date.now();
                    const cancellation = new vscode.CancellationTokenSource();
                    let timedOut = false;
                    const timeout = setTimeout(() => {
                        timedOut = true;
                        cancellation.cancel();
                    }, timeoutSeconds * 1000);
                    const poll = setInterval(() => {
                        if (isCancellationRequested()) {
                            cancellation.cancel();
                        }
                    }, 50);
                    try {
                        const result = await SqlToolsServerClient.instance.sendRequest(
                            SimpleExecuteRequestType,
                            {
                                ownerUri,
                                queryString: preview.plan.batches[batchIndex],
                            },
                            cancellation.token,
                        );
                        const reportedRowCount = Number(result.rowCount ?? 0);
                        results.push({
                            iteration,
                            batch: batchIndex + 1,
                            durationMs: Math.max(0, Date.now() - batchStartedAt),
                            rowCount:
                                Number.isSafeInteger(reportedRowCount) && reportedRowCount >= 0
                                    ? reportedRowCount
                                    : 0,
                            succeeded: true,
                            errorCode: "",
                        });
                    } catch {
                        if (isCancellationRequested() && !timedOut) {
                            throw new LocalActivityError(
                                LocRunbookStudio.dacpacPreviewCancelled,
                                "RunbookStudio.ActivityCancelled",
                            );
                        }
                        results.push({
                            iteration,
                            batch: batchIndex + 1,
                            durationMs: Math.max(0, Date.now() - batchStartedAt),
                            rowCount: 0,
                            succeeded: false,
                            errorCode: timedOut
                                ? "RunbookStudio.WorkloadBatchTimeout"
                                : "RunbookStudio.WorkloadBatchFailed",
                        });
                        stopAfterFailure = true;
                        break;
                    } finally {
                        clearTimeout(timeout);
                        clearInterval(poll);
                        cancellation.dispose();
                    }
                }
            }
            const failedBatchCount = results.filter((result) => !result.succeeded).length;
            const totalDurationMs = Math.max(0, Date.now() - startedAt);
            this.effectLedger.finalizeEffect(
                effectId,
                digestRunbookValue({
                    effectId,
                    workloadSha256: expectedWorkloadSha256,
                    executedBatchCount: results.length,
                    failedBatchCount,
                    totalDurationMs,
                }),
            );
            return {
                effectId,
                workloadSha256: expectedWorkloadSha256,
                plannedBatchCount: preview.plan.batchCount * repetitions,
                executedBatchCount: results.length,
                failedBatchCount,
                totalDurationMs,
                repetitions,
                results,
                completedAtUtc: new Date().toISOString(),
            };
        } finally {
            this.workloadPreviews.delete(workloadRef);
            if (connected) {
                try {
                    await connectionManager.disconnect(ownerUri);
                } catch {
                    // Effect and container cleanup journals remain authoritative.
                }
            }
        }
    }

    private async startLocalXeventSession(
        nodeId: string,
        databaseRef: string,
        template: string,
        maxFileSizeMb: number,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalXeventSessionResult> {
        const authorization = this.requireApprovedEffect(
            nodeId,
            invocation,
            "xevent.session.start",
        );
        const owned = await this.requireOwnedContainerTarget(databaseRef, invocation.runId);
        const effectId = deriveRunbookEffectId({
            runId: invocation.runId,
            nodeId,
            attempt: invocation.attempt,
            activityKind: "xevent.session.start",
            activityVersion: authorization.challenge.activityVersion,
        });
        if (this.effectLedger.recoverEffect(effectId)) {
            throw new LocalActivityError(
                LocRunbookStudio.sandboxEffectRecoveryRequired,
                "RunbookStudio.EffectRecoveryRequired",
            );
        }
        const sessionName = localXeventSessionName(effectId);
        let sql: string;
        try {
            sql = buildStartLocalXeventSql(sessionName, template, maxFileSizeMb);
        } catch (error) {
            if (error instanceof LocalXeventPolicyError) {
                throw new LocalActivityError(
                    LocRunbookStudio.xeventPolicyInvalid,
                    "RunbookStudio.BindingInvalid",
                );
            }
            throw error;
        }
        const sessionRef = localXeventSessionRef(effectId);
        this.effectLedger.prepareEffect({
            effectId,
            runId: invocation.runId,
            nodeId,
            attempt: invocation.attempt,
            activityKind: "xevent.session.start",
            activityVersion: authorization.challenge.activityVersion,
            idempotencyKey: digestRunbookValue({
                effectId,
                sessionName,
                template,
                maxFileSizeMb,
            }),
            planHash: invocation.planHash,
            bindingDigest: authorization.challenge.resolvedArgumentDigest,
            targetFingerprint: authorization.challenge.targetFingerprint,
            retrySemantics: "atMostOnceUnknownOutcome",
            ownerPid: process.pid,
            policy: {
                version: authorization.challenge.policyVersion,
                outcome: "allowed",
            },
            approval: authorization.evidence,
            recovery: {
                resourceKind: "xeventSession",
                resourceId: sessionName,
                connectionProfileId: owned.connectionProfileId,
                ownershipMarkerDigest: owned.ownershipMarkerDigest,
            },
        });
        try {
            await this.withLocalActivityConnection(
                owned.profile,
                "xevent-start",
                isCancellationRequested,
                (ownerUri, cancellationToken) =>
                    SqlToolsServerClient.instance.sendRequest(
                        SimpleExecuteRequestType,
                        { ownerUri, queryString: sql },
                        cancellationToken,
                    ),
            );
            this.effectLedger.recordEffectObserved(effectId, {
                resourceKind: "xeventSession",
                resourceId: sessionName,
                ownershipMarkerDigest: owned.ownershipMarkerDigest,
                connectionProfileId: owned.connectionProfileId,
                outputHandles: [sessionRef, databaseRef],
            });
            return {
                effectId,
                sessionRef,
                sessionName,
                template,
                maxFileSizeMb,
                startedAtUtc: new Date().toISOString(),
            };
        } catch (error) {
            if (isCancellationRequested() || error instanceof vscode.CancellationError) {
                throw new LocalActivityError(
                    LocRunbookStudio.dacpacPreviewCancelled,
                    "RunbookStudio.ActivityCancelled",
                );
            }
            throw error instanceof LocalActivityError
                ? error
                : new LocalActivityError(
                      LocRunbookStudio.xeventSessionFailed,
                      "RunbookStudio.ActivityFailed",
                  );
        }
    }

    private async stopLocalXeventSession(
        databaseRef: string,
        sessionRef: string,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalXeventCaptureResult> {
        const startEffectId = effectIdFromLocalXeventSessionRef(sessionRef);
        const snapshot = startEffectId
            ? this.effectLedger.recoverEffect(startEffectId)?.snapshot
            : undefined;
        const owned = await this.requireOwnedContainerTarget(databaseRef, invocation.runId);
        const sessionName = startEffectId ? localXeventSessionName(startEffectId) : "";
        if (
            !startEffectId ||
            !snapshot ||
            snapshot.identity.runId !== invocation.runId ||
            snapshot.identity.activityKind !== "xevent.session.start" ||
            snapshot.state !== "effectObserved" ||
            snapshot.resource?.resourceKind !== "xeventSession" ||
            snapshot.resource.resourceId !== sessionName ||
            snapshot.resource.connectionProfileId !== owned.connectionProfileId ||
            snapshot.resource.ownershipMarkerDigest !== owned.ownershipMarkerDigest
        ) {
            throw new LocalActivityError(
                LocRunbookStudio.xeventPolicyInvalid,
                "RunbookStudio.TargetChanged",
            );
        }
        try {
            const stopResult = await this.withLocalActivityConnection(
                owned.profile,
                "xevent-stop",
                isCancellationRequested,
                (ownerUri, cancellationToken) =>
                    SqlToolsServerClient.instance.sendRequest(
                        SimpleExecuteRequestType,
                        {
                            ownerUri,
                            queryString: buildStopLocalXeventSql(sessionName),
                        },
                        cancellationToken,
                    ),
            );
            const observedPath = stopResult.rows?.[0]?.[0]?.displayValue;
            if (typeof observedPath !== "string" || !observedPath.trim()) {
                throw new LocalXeventPolicyError("invalidServerPath");
            }
            const serverPath = validateLocalXelServerPath(sessionName, observedPath);
            const eventCount = Number(stopResult.rows?.[0]?.[1]?.displayValue);
            if (!Number.isSafeInteger(eventCount) || eventCount < 0) {
                throw new LocalXeventPolicyError("invalidServerPath");
            }
            let current = this.effectLedger.startCleanup(startEffectId);
            const cleanupDigest = digestRunbookValue({
                startEffectId,
                sessionName,
                serverPath,
                eventCount,
                stopped: true,
            });
            current = this.effectLedger.completeCleanup(startEffectId, cleanupDigest);
            const captureRef = localXeventCaptureRef(startEffectId);
            this.xeventCaptures.set(captureRef, {
                runId: invocation.runId,
                startEffectId,
                containerEffectId: owned.containerEffectId,
                containerName: owned.containerName,
                sessionName,
                serverPath,
                eventCount,
            });
            return {
                effectId: current.identity.effectId,
                captureRef,
                sessionName,
                eventFileName: path.posix.basename(serverPath),
                eventCount,
                stoppedAtUtc: new Date(current.lastUpdatedEpochMs).toISOString(),
            };
        } catch (error) {
            if (isCancellationRequested() || error instanceof vscode.CancellationError) {
                throw new LocalActivityError(
                    LocRunbookStudio.dacpacPreviewCancelled,
                    "RunbookStudio.ActivityCancelled",
                );
            }
            throw error instanceof LocalActivityError
                ? error
                : new LocalActivityError(
                      error instanceof LocalXeventPolicyError
                          ? LocRunbookStudio.xeventPolicyInvalid
                          : LocRunbookStudio.xeventSessionFailed,
                      error instanceof LocalXeventPolicyError
                          ? "RunbookStudio.TargetChanged"
                          : "RunbookStudio.ActivityFailed",
                  );
        }
    }

    private async collectLocalXel(
        nodeId: string,
        databaseRef: string,
        captureRef: string,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalXelArtifactResult> {
        const capture = this.xeventCaptures.get(captureRef);
        const owned = await this.requireOwnedContainerTarget(databaseRef, invocation.runId);
        if (
            !capture ||
            capture.runId !== invocation.runId ||
            capture.containerEffectId !== owned.containerEffectId ||
            capture.containerName !== owned.containerName ||
            capture.startEffectId !== effectIdFromLocalXeventCaptureRef(captureRef)
        ) {
            throw new LocalActivityError(
                LocRunbookStudio.xeventPolicyInvalid,
                "RunbookStudio.TargetChanged",
            );
        }
        if (isCancellationRequested()) {
            throw new LocalActivityError(
                LocRunbookStudio.dacpacPreviewCancelled,
                "RunbookStudio.ActivityCancelled",
            );
        }
        const container = await getContainerByName(owned.containerName);
        const inspected = await container?.inspect();
        if (
            !container ||
            !isOwnedLocalSqlContainer(
                inspected?.Config?.Labels,
                owned.containerEffectId,
                invocation.runId,
            )
        ) {
            throw new LocalActivityError(
                LocRunbookStudio.sqlContainerOwnershipMismatch,
                "RunbookStudio.TargetChanged",
            );
        }
        const outputPath = await this.localManagedArtifactPath(
            invocation,
            nodeId,
            path.posix.basename(capture.serverPath),
        );
        if (await pathExists(outputPath)) {
            throw new LocalActivityError(
                LocRunbookStudio.runbookArtifactAlreadyExists(outputPath),
                "RunbookStudio.ArtifactExists",
            );
        }
        let complete = false;
        try {
            const stream = await container.getArchive({ path: capture.serverPath });
            const archive = await readBoundedLocalArchive(
                stream,
                MAX_LOCAL_XEL_ARCHIVE_BYTES,
                isCancellationRequested,
            );
            const content = extractLocalXelFromDockerArchive(
                archive,
                path.posix.basename(capture.serverPath),
            );
            await fs.promises.writeFile(outputPath, content, { flag: "wx" });
            const stat = await fs.promises.stat(outputPath);
            if (!stat.isFile() || stat.size !== content.length || stat.size === 0) {
                throw new LocalXeventPolicyError("invalidArchive");
            }
            const artifactSha256 = crypto.createHash("sha256").update(content).digest("hex");
            complete = true;
            this.xeventCaptures.delete(captureRef);
            return {
                sessionName: capture.sessionName,
                artifactPath: outputPath,
                artifactSizeBytes: stat.size,
                artifactSha256,
                eventCount: capture.eventCount,
                captureComplete: true,
                collectedAtUtc: new Date().toISOString(),
            };
        } catch (error) {
            if (isCancellationRequested() || error instanceof vscode.CancellationError) {
                throw new LocalActivityError(
                    LocRunbookStudio.dacpacPreviewCancelled,
                    "RunbookStudio.ActivityCancelled",
                );
            }
            throw error instanceof LocalActivityError
                ? error
                : new LocalActivityError(
                      LocRunbookStudio.xelArtifactInvalid,
                      "RunbookStudio.ArtifactInvalid",
                  );
        } finally {
            if (!complete) {
                await fs.promises.rm(outputPath, { force: true }).catch(() => undefined);
            }
        }
    }

    private async requireOwnedContainerTarget(
        databaseRef: string,
        runId: string,
    ): Promise<{
        containerEffectId: string;
        containerName: string;
        connectionProfileId: string;
        ownershipMarkerDigest: string;
        profile: mssql.IConnectionInfo;
    }> {
        const containerEffectId = effectIdFromLocalSqlContainerLeaseRef(databaseRef);
        const snapshot = containerEffectId
            ? this.effectLedger.recoverEffect(containerEffectId)?.snapshot
            : undefined;
        const resolved = await this.resolveRunbookConnection(databaseRef);
        if (
            !containerEffectId ||
            !snapshot ||
            snapshot.identity.runId !== runId ||
            snapshot.identity.activityKind !== "sql.container.provision" ||
            !resolved.container ||
            resolved.container.effectId !== containerEffectId
        ) {
            throw new LocalActivityError(
                LocRunbookStudio.workloadOwnedContainerRequired,
                "RunbookStudio.ActivityPolicyDenied",
            );
        }
        const lease = this.containerLeaseProfiles.get(containerEffectId);
        if (!lease) {
            throw new LocalActivityError(
                LocRunbookStudio.sqlContainerCredentialsUnavailable,
                "RunbookStudio.ProviderUnavailable",
            );
        }
        return {
            containerEffectId,
            containerName: lease.containerName,
            connectionProfileId: resolved.container.connectionProfileId,
            ownershipMarkerDigest: resolved.container.ownershipMarkerDigest,
            profile: resolved.profile,
        };
    }

    private async withLocalActivityConnection<T>(
        profile: mssql.IConnectionInfo,
        operation: string,
        isCancellationRequested: () => boolean,
        action: (ownerUri: string, cancellationToken: vscode.CancellationToken) => Thenable<T>,
    ): Promise<T> {
        const connectionManager = this.connectionAccess();
        if (!connectionManager) {
            throw new LocalActivityError(
                LocRunbookStudio.connectFailed,
                "RunbookStudio.ProviderUnavailable",
            );
        }
        sandboxCounter++;
        const ownerUri = `runbookstudio://${operation}/${sandboxCounter.toString(36)}`;
        const cancellation = new vscode.CancellationTokenSource();
        const poll = setInterval(() => {
            if (isCancellationRequested()) {
                cancellation.cancel();
            }
        }, 50);
        let connected = false;
        try {
            connected = await connectionManager.connect(ownerUri, profile, {
                connectionSource: "runbookStudio",
                shouldHandleErrors: false,
            });
            if (!connected) {
                throw new LocalActivityError(
                    LocRunbookStudio.connectFailed,
                    "RunbookStudio.ActivityFailed",
                );
            }
            return await action(ownerUri, cancellation.token);
        } finally {
            clearInterval(poll);
            cancellation.dispose();
            if (connected) {
                try {
                    await connectionManager.disconnect(ownerUri);
                } catch {
                    // The effect ledger remains authoritative after connection cleanup failure.
                }
            }
        }
    }

    private async runLocalTsqlt(
        nodeId: string,
        databaseRef: string,
        selection: LocalTsqltSelection,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<mssql.SimpleExecuteResult> {
        const authorization = this.requireApprovedEffect(nodeId, invocation, "tsqlt.run");
        const leaseEffectId = effectIdFromLocalSandboxLeaseRef(databaseRef);
        if (!leaseEffectId || isCancellationRequested()) {
            throw new LocalActivityError(
                isCancellationRequested()
                    ? LocRunbookStudio.tsqltExecutionCancelled
                    : LocRunbookStudio.tsqltOwnedSandboxRequired,
                isCancellationRequested()
                    ? "RunbookStudio.ActivityCancelled"
                    : "RunbookStudio.ActivityPolicyDenied",
            );
        }
        const lease = this.effectLedger.recoverEffect(leaseEffectId)?.snapshot;
        if (!lease || lease.identity.runId !== invocation.runId) {
            throw new LocalActivityError(
                LocRunbookStudio.tsqltOwnedSandboxRequired,
                "RunbookStudio.TargetChanged",
            );
        }
        const resolved = await this.resolveRunbookConnection(databaseRef);
        if (!resolved.sandbox || resolved.sandbox.effectId !== leaseEffectId) {
            throw new LocalActivityError(
                LocRunbookStudio.tsqltOwnedSandboxRequired,
                "RunbookStudio.ActivityPolicyDenied",
            );
        }
        const connectionManager = this.connectionAccess();
        if (!connectionManager) {
            throw new LocalActivityError(
                LocRunbookStudio.connectFailed,
                "RunbookStudio.ProviderUnavailable",
            );
        }
        const effectId = deriveRunbookEffectId({
            runId: invocation.runId,
            nodeId,
            attempt: invocation.attempt,
            activityKind: "tsqlt.run",
            activityVersion: authorization.challenge.activityVersion,
        });
        if (this.effectLedger.recoverEffect(effectId)) {
            throw new LocalActivityError(
                LocRunbookStudio.sandboxEffectRecoveryRequired,
                "RunbookStudio.EffectRecoveryRequired",
            );
        }
        const sandbox = resolved.sandbox;
        this.effectLedger.prepareEffect({
            effectId,
            runId: invocation.runId,
            nodeId,
            attempt: invocation.attempt,
            activityKind: "tsqlt.run",
            activityVersion: authorization.challenge.activityVersion,
            idempotencyKey: digestRunbookValue({
                effectId,
                databaseName: resolved.targetDatabase,
                selection,
            }),
            planHash: invocation.planHash,
            bindingDigest: authorization.challenge.resolvedArgumentDigest,
            targetFingerprint: authorization.challenge.targetFingerprint,
            retrySemantics: "atMostOnceUnknownOutcome",
            ownerPid: process.pid,
            policy: {
                version: authorization.challenge.policyVersion,
                outcome: "allowed",
            },
            approval: authorization.evidence,
            recovery: {
                resourceKind: "tsqltExecution",
                resourceId: resolved.targetDatabase,
                connectionProfileId: sandbox.connectionProfileId,
                ownershipMarkerDigest: sandbox.ownershipMarkerDigest,
            },
        });

        const batch = buildLocalTsqltBatch(selection);
        sandboxCounter++;
        const ownerUri = `runbookstudio://tsqlt/${sandboxCounter.toString(36)}/${nodeId}`;
        let result: mssql.SimpleExecuteResult;
        try {
            result = await executeLocalTsqltEffect({
                connect: () =>
                    connectionManager.connect(ownerUri, resolved.profile, {
                        connectionSource: "runbookStudio",
                        shouldHandleErrors: false,
                    }),
                // Deliberately no cancellation token once stored-procedure
                // execution starts; the effect must settle before cleanup.
                execute: () =>
                    Promise.resolve(
                        SqlToolsServerClient.instance.sendRequest(SimpleExecuteRequestType, {
                            ownerUri,
                            queryString: batch,
                        }),
                    ),
                recordObserved: (_observed) =>
                    this.effectLedger.recordEffectObserved(effectId, {
                        resourceKind: "tsqltExecution",
                        resourceId: resolved.targetDatabase,
                        ownershipMarkerDigest: sandbox.ownershipMarkerDigest,
                        connectionProfileId: sandbox.connectionProfileId,
                    }),
                recordNoEffectFailure: (reason) =>
                    this.effectLedger.recordNoEffectFailure(effectId, reason),
                disconnect: async () => {
                    await connectionManager.disconnect(ownerUri);
                },
            });
        } catch (error) {
            if (error instanceof LocalTsqltEffectError) {
                throw new LocalActivityError(
                    error.reason === "connectFailed"
                        ? LocRunbookStudio.connectFailed
                        : LocRunbookStudio.tsqltExecutionFailed,
                    error.reason === "connectFailed"
                        ? "RunbookStudio.ActivityFailed"
                        : "RunbookStudio.EffectRecoveryRequired",
                );
            }
            throw error;
        }
        const effect = this.effectLedger.recoverEffect(effectId)?.snapshot;
        if (!effect || effect.state !== "effectObserved") {
            throw new LocalActivityError(
                LocRunbookStudio.tsqltExecutionFailed,
                "RunbookStudio.EffectRecoveryRequired",
            );
        }
        this.effectLedger.startCleanup(effectId);
        this.effectLedger.completeCleanup(
            effectId,
            digestRunbookValue({
                effectId,
                databaseName: resolved.targetDatabase,
                rowCount: result.rowCount,
                settled: true,
            }),
        );
        return result;
    }

    private async disposeLocalSandbox(
        _nodeId: string,
        leaseRef: string,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalSandboxCleanupResult> {
        const effectId = effectIdFromLocalSandboxLeaseRef(leaseRef);
        if (!effectId) {
            throw new LocalActivityError(
                LocRunbookStudio.sandboxOwnershipMismatch,
                "RunbookStudio.BindingInvalid",
            );
        }
        const recovered = this.effectLedger.recoverEffect(effectId);
        if (!recovered || recovered.snapshot.identity.runId !== invocation.runId) {
            throw new LocalActivityError(
                LocRunbookStudio.sandboxOwnershipMismatch,
                "RunbookStudio.TargetChanged",
            );
        }
        if (isCancellationRequested()) {
            throw new LocalActivityError(
                LocRunbookStudio.dacpacPreviewCancelled,
                "RunbookStudio.ActivityCancelled",
            );
        }
        return this.cleanupLocalSandboxEffect(recovered.snapshot);
    }

    private async disposeLocalSqlContainer(
        _nodeId: string,
        leaseRef: string,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalSqlContainerCleanupResult> {
        const effectId = effectIdFromLocalSqlContainerLeaseRef(leaseRef);
        if (!effectId) {
            throw new LocalActivityError(
                LocRunbookStudio.sqlContainerOwnershipMismatch,
                "RunbookStudio.BindingInvalid",
            );
        }
        const recovered = this.effectLedger.recoverEffect(effectId);
        if (!recovered || recovered.snapshot.identity.runId !== invocation.runId) {
            throw new LocalActivityError(
                LocRunbookStudio.sqlContainerOwnershipMismatch,
                "RunbookStudio.TargetChanged",
            );
        }
        if (isCancellationRequested()) {
            throw new LocalActivityError(
                LocRunbookStudio.dacpacPreviewCancelled,
                "RunbookStudio.ActivityCancelled",
            );
        }
        return this.cleanupLocalSqlContainerEffect(recovered.snapshot);
    }

    private async deployLocalDacpac(
        nodeId: string,
        dacpacPath: string,
        databaseRef: string,
        approvedArtifactDigest: string,
        approvedPreviewDigest: string,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
        activityKind:
            | "dacpac.deploy"
            | "dacpac.deploy.dev"
            | "dacpac.deploy.container" = "dacpac.deploy",
    ): Promise<LocalDacpacDeploymentResult> {
        const authorization = this.requireApprovedEffect(nodeId, invocation, activityKind);
        const leaseEffectId =
            activityKind === "dacpac.deploy.dev"
                ? effectIdFromLocalDevelopmentDatabaseLeaseRef(databaseRef)
                : activityKind === "dacpac.deploy.container"
                  ? effectIdFromLocalSqlContainerLeaseRef(databaseRef)
                  : effectIdFromLocalSandboxLeaseRef(databaseRef);
        if (!leaseEffectId) {
            throw new LocalActivityError(
                LocRunbookStudio.dacpacDeployTargetRequired,
                "RunbookStudio.ActivityPolicyDenied",
            );
        }
        if (
            activityKind !== "dacpac.deploy" &&
            this.effectLedger.recoverEffect(leaseEffectId)?.snapshot.identity.runId !==
                invocation.runId
        ) {
            throw new LocalActivityError(
                LocRunbookStudio.dacpacDeployTargetRequired,
                "RunbookStudio.TargetChanged",
            );
        }
        const artifact = await verifyLocalDacpacArtifact(dacpacPath, isCancellationRequested, [
            ...this.runDropStore.trustedArtifactRoots(),
        ]);
        if (artifact.artifactSha256 !== approvedArtifactDigest) {
            throw new LocalActivityError(
                LocRunbookStudio.dacpacDeployArtifactChanged,
                "RunbookStudio.DeploymentPreviewChanged",
            );
        }
        let stagedArtifact: StagedLocalDacpacArtifact;
        try {
            stagedArtifact = await stageLocalDacpacArtifact(
                path.join(this.persistRoot, "artifact-staging"),
                artifact.artifactPath,
                approvedArtifactDigest,
                isCancellationRequested,
            );
        } catch (error) {
            throw localDacpacStageActivityError(error);
        }
        try {
            const approvedPreview = await this.generateLocalDacpacDeploymentPreview(
                stagedArtifact.stagedPath,
                databaseRef,
                isCancellationRequested,
            );
            if (approvedPreview.reportSha256 !== approvedPreviewDigest) {
                throw new LocalActivityError(
                    LocRunbookStudio.dacpacDeployPreviewChanged,
                    "RunbookStudio.DeploymentPreviewChanged",
                );
            }
            if (isCancellationRequested()) {
                throw new LocalActivityError(
                    LocRunbookStudio.dacpacPreviewCancelled,
                    "RunbookStudio.ActivityCancelled",
                );
            }
            const resolved = await this.resolveRunbookConnection(databaseRef);
            const ownedTarget =
                activityKind === "dacpac.deploy.dev"
                    ? resolved.development
                    : activityKind === "dacpac.deploy.container"
                      ? resolved.container
                      : resolved.sandbox;
            if (!ownedTarget || ownedTarget.effectId !== leaseEffectId) {
                throw new LocalActivityError(
                    LocRunbookStudio.dacpacDeployTargetRequired,
                    "RunbookStudio.ActivityPolicyDenied",
                );
            }
            const sandbox = ownedTarget;
            const connectionManager = this.connectionAccess();
            const dacFxService = this.dacFxAccess();
            if (!connectionManager || !dacFxService) {
                throw new LocalActivityError(
                    LocRunbookStudio.dacpacPreviewServiceUnavailable,
                    "RunbookStudio.ProviderUnavailable",
                );
            }
            const effectId = deriveRunbookEffectId({
                runId: invocation.runId,
                nodeId,
                attempt: invocation.attempt,
                activityKind,
                activityVersion: authorization.challenge.activityVersion,
            });
            if (this.effectLedger.recoverEffect(effectId)) {
                throw new LocalActivityError(
                    LocRunbookStudio.sandboxEffectRecoveryRequired,
                    "RunbookStudio.EffectRecoveryRequired",
                );
            }
            this.effectLedger.prepareEffect({
                effectId,
                runId: invocation.runId,
                nodeId,
                attempt: invocation.attempt,
                activityKind,
                activityVersion: authorization.challenge.activityVersion,
                idempotencyKey: digestRunbookValue({
                    effectId,
                    artifactSha256: stagedArtifact.artifactSha256,
                    approvedPreviewDigest,
                    databaseName: resolved.targetDatabase,
                }),
                planHash: invocation.planHash,
                bindingDigest: authorization.challenge.resolvedArgumentDigest,
                targetFingerprint: authorization.challenge.targetFingerprint,
                retrySemantics: "atMostOnceUnknownOutcome",
                ownerPid: process.pid,
                policy: {
                    version: authorization.challenge.policyVersion,
                    outcome: "allowed",
                },
                approval: authorization.evidence,
                recovery: {
                    resourceKind: "dacpacDeployment",
                    resourceId: resolved.targetDatabase,
                    connectionProfileId: sandbox.connectionProfileId,
                    ownershipMarkerDigest: sandbox.ownershipMarkerDigest,
                },
            });

            sandboxCounter++;
            const ownerUri = `runbookstudio://dacfx-deploy/${sandboxCounter.toString(36)}`;
            let operationId: string;
            try {
                const publishResult = await executeLocalDacpacDeploymentEffect({
                    connect: () =>
                        connectionManager.connect(ownerUri, resolved.profile, {
                            connectionSource: "runbookStudio",
                            shouldHandleErrors: false,
                        }),
                    verifyStagedArtifact: async () => {
                        try {
                            await verifyStagedLocalDacpacArtifact(
                                stagedArtifact,
                                isCancellationRequested,
                            );
                        } catch (error) {
                            throw localDacpacStageActivityError(error);
                        }
                    },
                    // This callback deliberately accepts no cancellation
                    // token. Once publish starts, the critical section must
                    // settle before cleanup can observe workflow cancellation.
                    publish: async () =>
                        await dacFxService.deployDacpac(
                            stagedArtifact.stagedPath,
                            resolved.targetDatabase,
                            true,
                            ownerUri,
                            TaskExecutionMode.execute,
                        ),
                    recordObserved: (observedOperationId) =>
                        this.effectLedger.recordEffectObserved(effectId, {
                            resourceKind: "dacpacDeployment",
                            resourceId: resolved.targetDatabase,
                            ownershipMarkerDigest: sandbox.ownershipMarkerDigest,
                            connectionProfileId: sandbox.connectionProfileId,
                            outputHandles: [databaseRef, observedOperationId],
                        }),
                    recordNoEffectFailure: (reason) =>
                        this.effectLedger.recordNoEffectFailure(effectId, reason),
                    disconnect: async () => {
                        await connectionManager.disconnect(ownerUri);
                    },
                });
                operationId = publishResult.operationId;
            } catch (error) {
                if (error instanceof LocalDacpacDeploymentEffectError) {
                    throw new LocalActivityError(
                        error.reason === "connectFailed"
                            ? LocRunbookStudio.connectFailed
                            : LocRunbookStudio.dacpacDeployFailed,
                        error.reason === "connectFailed"
                            ? "RunbookStudio.ActivityFailed"
                            : "RunbookStudio.DeploymentFailed",
                    );
                }
                throw error;
            }

            const postDeploy = await this.generateLocalDacpacDeploymentPreview(
                stagedArtifact.stagedPath,
                databaseRef,
                () => false,
            );
            if (activityKind === "dacpac.deploy.dev") {
                this.effectLedger.finalizeEffect(
                    effectId,
                    digestRunbookValue({
                        effectId,
                        artifactSha256: stagedArtifact.artifactSha256,
                        approvedPreviewDigest,
                        postDeployReportSha256: postDeploy.reportSha256,
                        postDeployChangeCount: postDeploy.changeCount,
                    }),
                );
            }
            return {
                effectId,
                dacpacPath: artifact.artifactPath,
                artifactSha256: stagedArtifact.artifactSha256,
                stagedArtifactSha256: stagedArtifact.artifactSha256,
                databaseName: resolved.targetDatabase,
                operationId,
                approvedPreviewDigest,
                postDeployReportSha256: postDeploy.reportSha256,
                postDeployChangeCount: postDeploy.changeCount,
                deployedAtUtc: new Date().toISOString(),
            };
        } finally {
            try {
                await disposeStagedLocalDacpacArtifact(stagedArtifact);
            } catch {
                emitRunbookEvent(
                    newRunbookRootContext("artifact-staging"),
                    "runbookStudio.dacpac.stageCleanup",
                    "warning",
                    { runIdDigest: metaField(shortDigest(invocation.runId)) },
                );
            }
        }
    }

    private async applyLocalSchemaMutation(
        nodeId: string,
        databaseRef: string,
        sql: string,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalSchemaMutationResult> {
        const authorization = this.requireApprovedEffect(nodeId, invocation, "sql.schema.apply");
        const policy = validateLocalCreateTableSql(sql);
        if (!policy) {
            throw new LocalActivityError(
                LocRunbookStudio.schemaMutationCreateTableOnly,
                "RunbookStudio.ActivityPolicyDenied",
            );
        }
        const leaseEffectId = effectIdFromLocalDevelopmentDatabaseLeaseRef(databaseRef);
        const lease = leaseEffectId
            ? this.effectLedger.recoverEffect(leaseEffectId)?.snapshot
            : undefined;
        if (!leaseEffectId || !lease || lease.identity.runId !== invocation.runId) {
            throw new LocalActivityError(
                LocRunbookStudio.schemaMutationOwnedTargetRequired,
                "RunbookStudio.ActivityPolicyDenied",
            );
        }
        const resolved = await this.resolveRunbookConnection(databaseRef);
        if (!resolved.development || resolved.development.effectId !== leaseEffectId) {
            throw new LocalActivityError(
                LocRunbookStudio.schemaMutationOwnedTargetRequired,
                "RunbookStudio.TargetChanged",
            );
        }
        if (isCancellationRequested()) {
            throw new LocalActivityError(
                LocRunbookStudio.dacpacPreviewCancelled,
                "RunbookStudio.ActivityCancelled",
            );
        }
        const connectionManager = this.connectionAccess();
        if (!connectionManager) {
            throw new LocalActivityError(
                LocRunbookStudio.connectFailed,
                "RunbookStudio.ProviderUnavailable",
            );
        }
        const effectId = deriveRunbookEffectId({
            runId: invocation.runId,
            nodeId,
            attempt: invocation.attempt,
            activityKind: "sql.schema.apply",
            activityVersion: authorization.challenge.activityVersion,
        });
        if (this.effectLedger.recoverEffect(effectId)) {
            throw new LocalActivityError(
                LocRunbookStudio.sandboxEffectRecoveryRequired,
                "RunbookStudio.EffectRecoveryRequired",
            );
        }
        schemaMutationCounter++;
        const ownerUri = `runbookstudio://schema-mutation/${schemaMutationCounter.toString(36)}`;
        let connected = false;
        let prepared = false;
        let executionStarted = false;
        try {
            connected = await connectionManager.connect(ownerUri, resolved.profile, {
                connectionSource: "runbookStudio",
                shouldHandleErrors: false,
            });
            if (!connected) {
                throw new LocalActivityError(
                    LocRunbookStudio.connectFailed,
                    "RunbookStudio.ActivityFailed",
                );
            }
            if (isCancellationRequested()) {
                throw new LocalActivityError(
                    LocRunbookStudio.dacpacPreviewCancelled,
                    "RunbookStudio.ActivityCancelled",
                );
            }
            this.effectLedger.prepareEffect({
                effectId,
                runId: invocation.runId,
                nodeId,
                attempt: invocation.attempt,
                activityKind: "sql.schema.apply",
                activityVersion: authorization.challenge.activityVersion,
                idempotencyKey: digestRunbookValue({
                    effectId,
                    databaseName: resolved.targetDatabase,
                    tableName: policy.qualifiedTableName,
                    sqlSha256: policy.sqlSha256,
                }),
                planHash: invocation.planHash,
                bindingDigest: authorization.challenge.resolvedArgumentDigest,
                targetFingerprint: authorization.challenge.targetFingerprint,
                retrySemantics: "atMostOnceUnknownOutcome",
                ownerPid: process.pid,
                policy: {
                    version: authorization.challenge.policyVersion,
                    outcome: "allowed",
                },
                approval: authorization.evidence,
                recovery: {
                    resourceKind: "schemaMutation",
                    resourceId: resolved.targetDatabase,
                    connectionProfileId: resolved.development.connectionProfileId,
                    ownershipMarkerDigest: resolved.development.ownershipMarkerDigest,
                },
            });
            prepared = true;
            executionStarted = true;
            const result = await SqlToolsServerClient.instance.sendRequest(
                SimpleExecuteRequestType,
                {
                    ownerUri,
                    queryString: buildTransactionalCreateTableSql(policy),
                },
            );
            this.effectLedger.recordEffectObserved(effectId, {
                resourceKind: "schemaMutation",
                resourceId: resolved.targetDatabase,
                ownershipMarkerDigest: resolved.development.ownershipMarkerDigest,
                connectionProfileId: resolved.development.connectionProfileId,
                outputHandles: [databaseRef, policy.qualifiedTableName],
            });
            if (result.rows?.[0]?.[0]?.displayValue !== "1") {
                throw new LocalActivityError(
                    LocRunbookStudio.schemaMutationFailed,
                    "RunbookStudio.SchemaMutationFailed",
                );
            }
            this.effectLedger.finalizeEffect(
                effectId,
                digestRunbookValue({
                    effectId,
                    databaseName: resolved.targetDatabase,
                    tableName: policy.qualifiedTableName,
                    sqlSha256: policy.sqlSha256,
                    changedObjectCount: 1,
                }),
            );
            return {
                effectId,
                databaseName: resolved.targetDatabase,
                tableName: policy.qualifiedTableName,
                sqlSha256: policy.sqlSha256,
                changedObjectCount: 1,
                appliedAtUtc: new Date().toISOString(),
            };
        } catch (error) {
            if (prepared && !executionStarted) {
                this.effectLedger.recordNoEffectFailure(effectId, "SchemaMutationNotStarted");
            }
            throw error;
        } finally {
            if (connected) {
                try {
                    await connectionManager.disconnect(ownerUri);
                } catch {
                    // Durable effect state is authoritative after the batch settles.
                }
            }
        }
    }

    private async bundleLocalEvidence(
        nodeId: string,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalEvidenceBundleResult> {
        if (isCancellationRequested()) {
            throw new LocalActivityError(
                LocRunbookStudio.evidenceBundleCancelled,
                "RunbookStudio.ActivityCancelled",
            );
        }
        const active = this.activeByRunId.get(invocation.runId);
        if (
            !active ||
            active.artifact.lock?.planRevision !== invocation.planRevision ||
            active.artifact.lock.planHash !== invocation.planHash
        ) {
            throw new LocalActivityError(
                LocRunbookStudio.runtimeStartFailed,
                "RunbookStudio.BindingInvalid",
            );
        }
        const snapshot = this.ledger.snapshotOf(invocation.runId);
        if (!snapshot) {
            throw new LocalActivityError(
                LocRunbookStudio.runtimeStartFailed,
                "RunbookStudio.DataUnavailable",
            );
        }
        const toolchain = await this.collectLocalToolchainProvenance(isCancellationRequested);
        const planNodes = new Map(active.artifact.lock.nodes.map((node) => [node.id, node]));
        const terminalStates = new Set(["succeeded", "failed", "cancelled", "skipped"]);
        return buildLocalEvidenceBundle({
            runId: snapshot.runId,
            runbookId: snapshot.runbookId,
            planRevision: snapshot.planRevision,
            planHash: snapshot.planHash,
            runtimeKind: "local",
            toolchain,
            nodes: snapshot.nodes
                .filter((node) => node.nodeId !== nodeId && terminalStates.has(node.state))
                .map((node) => ({
                    nodeId: node.nodeId,
                    ...(planNodes.get(node.nodeId)?.activityKind
                        ? { activityKind: planNodes.get(node.nodeId)!.activityKind }
                        : {}),
                    state: node.state,
                    attempt: node.attempt,
                    ...(node.outcome ? { outcome: node.outcome } : {}),
                    ...(node.outputs ? { outputs: node.outputs } : {}),
                    ...(active.evidenceValues.get(node.nodeId)
                        ? { scalars: active.evidenceValues.get(node.nodeId) }
                        : {}),
                })),
        });
    }

    private async collectLocalToolchainProvenance(
        isCancellationRequested: () => boolean,
    ): Promise<LocalToolchainProvenance> {
        const cancellation = new vscode.CancellationTokenSource();
        const timeout = setTimeout(() => cancellation.cancel(), TOOLCHAIN_VERSION_TIMEOUT_MS);
        const cancellationPoll = setInterval(() => {
            if (isCancellationRequested()) {
                cancellation.cancel();
            }
        }, 50);
        let sqlToolsServiceRuntimeVersion: string | undefined;
        try {
            sqlToolsServiceRuntimeVersion = await SqlToolsServerClient.instance.sendRequest(
                ServiceVersionRequestType,
                {},
                cancellation.token,
            );
        } catch {
            // Missing runtime identity is explicit in the manifest and makes a
            // would-be passing bundle indeterminate; evidence generation still
            // succeeds so cleanup and diagnostics are never hidden.
        } finally {
            clearTimeout(timeout);
            clearInterval(cancellationPoll);
            cancellation.dispose();
        }
        if (isCancellationRequested()) {
            throw new LocalActivityError(
                LocRunbookStudio.evidenceBundleCancelled,
                "RunbookStudio.ActivityCancelled",
            );
        }
        const projectsExtension = vscode.extensions.getExtension(
            constants.sqlDatabaseProjectsExtensionId,
        );
        let dockerEngineVersion: string | undefined;
        let dockerTimeout: ReturnType<typeof setTimeout> | undefined;
        try {
            const dockerVersion = await Promise.race([
                getDockerodeClient().version(),
                new Promise<never>((_, reject) => {
                    dockerTimeout = setTimeout(
                        () => reject(new Error("Docker version timeout")),
                        TOOLCHAIN_VERSION_TIMEOUT_MS,
                    );
                }),
            ]);
            dockerEngineVersion = dockerVersion.Version;
        } catch {
            // A container-backed evidence bundle explicitly becomes
            // indeterminate when the participating engine cannot be proven.
        } finally {
            if (dockerTimeout) {
                clearTimeout(dockerTimeout);
            }
        }
        return buildLocalToolchainProvenance({
            vscodeVersion: vscode.version,
            mssqlExtensionVersion: this.mssqlExtensionVersion,
            sqlDatabaseProjectsExtensionVersion: projectsExtension?.packageJSON.version,
            sqlToolsServiceRuntimeVersion,
            sqlToolsServiceConfiguredVersion: config.service.version,
            sqlToolsServiceRoot: SqlToolsServerClient.instance.sqlToolsServicePath,
            dockerEngineVersion,
        });
    }

    private requireApprovedEffect(
        nodeId: string,
        invocation: ActivityInvocationIdentity,
        activityKind: string,
    ): {
        challenge: RunbookApprovalChallenge;
        evidence: RunbookApprovalEvidence;
    } {
        const active = this.activeByRunId.get(invocation.runId);
        const authorization = active?.approvedEffects.get(nodeId);
        if (
            !active ||
            !authorization ||
            authorization.challenge.planHash !== invocation.planHash ||
            authorization.challenge.planRevision !== invocation.planRevision ||
            authorization.challenge.attempt !== invocation.attempt ||
            authorization.challenge.activityNodeId !== nodeId ||
            authorization.challenge.activityKind !== activityKind
        ) {
            throw new LocalActivityError(
                LocRunbookStudio.sandboxApprovalRequired,
                "RunbookStudio.ApprovalInvalid",
            );
        }
        const rebuilt = buildRunbookApprovalChallenge({
            runId: invocation.runId,
            artifact: active.artifact,
            parameterValues: active.parameterValues,
            gateNodeId: authorization.challenge.gateNodeId,
            attempt: invocation.attempt,
            nodeValues: active.outputValues,
        });
        if (
            !rebuilt ||
            digestRunbookValue(rebuilt) !== digestRunbookValue(authorization.challenge) ||
            !this.approvalLedger.approvedEvidence(
                authorization.challenge.approvalId,
                digestRunbookValue(authorization.challenge),
            )
        ) {
            throw new LocalActivityError(
                LocRunbookStudio.sandboxApprovalRequired,
                "RunbookStudio.ApprovalInvalid",
            );
        }
        return authorization;
    }

    private async cleanupLocalSandboxEffect(
        initial: RunbookEffectSnapshot,
    ): Promise<LocalSandboxCleanupResult> {
        let snapshot = initial;
        if (snapshot.state === "cleaned") {
            return cleanupResult(snapshot, snapshot.cleanupEvidenceDigest ?? "sha256:unknown");
        }
        if (snapshot.state === "needsOperatorDecision" || snapshot.state === "failedNoEffect") {
            throw new LocalActivityError(
                LocRunbookStudio.sandboxEffectRecoveryRequired,
                "RunbookStudio.EffectRecoveryRequired",
            );
        }
        const recovery = snapshot.identity.recovery;
        const resource = snapshot.resource;
        const databaseName = resource?.resourceId ?? recovery?.resourceId;
        const connectionProfileId = resource?.connectionProfileId ?? recovery?.connectionProfileId;
        const expectedDatabaseName = localSandboxDatabaseName(snapshot.identity.effectId);
        const expectedMarkerDigest = digestRunbookValue(snapshot.identity.effectId);
        if (
            !databaseName ||
            !connectionProfileId ||
            !recovery ||
            recovery.resourceKind !== "sqlDatabase" ||
            databaseName !== expectedDatabaseName ||
            recovery.resourceId !== expectedDatabaseName ||
            recovery.connectionProfileId !== connectionProfileId ||
            recovery.ownershipMarkerDigest !== expectedMarkerDigest ||
            (resource !== undefined &&
                (resource.resourceKind !== "sqlDatabase" ||
                    resource.resourceId !== expectedDatabaseName ||
                    resource.connectionProfileId !== connectionProfileId ||
                    resource.ownershipMarkerDigest !== expectedMarkerDigest))
        ) {
            this.effectLedger.requireOperatorDecision(
                snapshot.identity.effectId,
                "RecoveryMetadataInvalid",
            );
            throw new LocalActivityError(
                LocRunbookStudio.sandboxEffectRecoveryRequired,
                "RunbookStudio.EffectRecoveryRequired",
            );
        }
        const baseProfile = await this.requireSavedConnection(connectionProfileId);
        this.assertSandboxBaseProfile(baseProfile);
        return this.withSandboxConnection(
            baseProfile,
            "cleanup",
            () => false,
            async (ownerUri) => {
                const probe = await this.probeLocalSandbox(ownerUri, databaseName);
                if (probe.exists && probe.ownershipMarker !== snapshot.identity.effectId) {
                    if (snapshot.state !== "needsOperatorDecision") {
                        this.effectLedger.requireOperatorDecision(
                            snapshot.identity.effectId,
                            "OwnershipMarkerMissingOrChanged",
                        );
                    }
                    throw new LocalActivityError(
                        LocRunbookStudio.sandboxOwnershipMismatch,
                        "RunbookStudio.TargetChanged",
                    );
                }
                if (snapshot.state === "prepared") {
                    if (!probe.exists) {
                        this.effectLedger.recordNoEffectFailure(
                            snapshot.identity.effectId,
                            "RecoveredBeforeEffect",
                        );
                        throw new LocalActivityError(
                            LocRunbookStudio.sandboxEffectRecoveryRequired,
                            "RunbookStudio.EffectRecoveryRequired",
                        );
                    }
                    snapshot = this.effectLedger.recordEffectObserved(snapshot.identity.effectId, {
                        resourceKind: "sqlDatabase",
                        resourceId: databaseName,
                        ownershipMarkerDigest: expectedMarkerDigest,
                        connectionProfileId,
                        outputHandles: [localSandboxLeaseRef(snapshot.identity.effectId)],
                    });
                }
                if (snapshot.state === "effectObserved") {
                    snapshot = this.effectLedger.startCleanup(snapshot.identity.effectId);
                }
                if (probe.exists) {
                    try {
                        await SqlToolsServerClient.instance.sendRequest(SimpleExecuteRequestType, {
                            ownerUri,
                            queryString: buildDropLocalSandboxSql(
                                databaseName,
                                snapshot.identity.effectId,
                            ),
                        });
                    } catch (error) {
                        const afterFailure = await this.probeLocalSandbox(ownerUri, databaseName);
                        if (afterFailure.exists) {
                            this.effectLedger.requireOperatorDecision(
                                snapshot.identity.effectId,
                                "CleanupOutcomeUnknown",
                            );
                            throw error;
                        }
                    }
                }
                const after = await this.probeLocalSandbox(ownerUri, databaseName);
                if (after.exists) {
                    this.effectLedger.requireOperatorDecision(
                        snapshot.identity.effectId,
                        "CleanupDidNotRemoveDatabase",
                    );
                    throw new LocalActivityError(
                        LocRunbookStudio.sandboxCleanupFailed,
                        "RunbookStudio.EffectRecoveryRequired",
                    );
                }
                const cleanupEvidenceDigest = digestRunbookValue({
                    effectId: snapshot.identity.effectId,
                    databaseName,
                    cleaned: true,
                });
                this.completeDependentSandboxEffects(
                    snapshot.identity.runId,
                    databaseName,
                    connectionProfileId,
                    expectedMarkerDigest,
                    cleanupEvidenceDigest,
                );
                snapshot = this.effectLedger.completeCleanup(
                    snapshot.identity.effectId,
                    cleanupEvidenceDigest,
                );
                return cleanupResult(snapshot, cleanupEvidenceDigest);
            },
        );
    }

    private async cleanupLocalSqlContainerEffect(
        initial: RunbookEffectSnapshot,
    ): Promise<LocalSqlContainerCleanupResult> {
        let snapshot = initial;
        const effectId = snapshot.identity.effectId;
        const recovery = snapshot.identity.recovery;
        const resource = snapshot.resource;
        const containerName = resource?.resourceId ?? recovery?.resourceId;
        const connectionProfileId = resource?.connectionProfileId ?? recovery?.connectionProfileId;
        const ownershipMarkerDigest = digestRunbookValue(effectId);
        const databaseName =
            this.containerLeaseProfiles.get(effectId)?.databaseName ??
            resource?.outputHandles
                ?.find((value) => value.startsWith("database:"))
                ?.slice("database:".length) ??
            "containerDatabase";
        if (snapshot.state === "cleaned") {
            return {
                effectId,
                leaseId: effectId,
                databaseName,
                containerName: containerName ?? "unknown",
                cleaned: true,
                cleanedAtUtc: new Date(snapshot.lastUpdatedEpochMs).toISOString(),
                cleanupEvidenceDigest: snapshot.cleanupEvidenceDigest ?? "sha256:unknown",
            };
        }
        if (snapshot.state === "needsOperatorDecision" || snapshot.state === "failedNoEffect") {
            throw new LocalActivityError(
                LocRunbookStudio.sandboxEffectRecoveryRequired,
                "RunbookStudio.EffectRecoveryRequired",
            );
        }
        if (
            snapshot.identity.activityKind !== "sql.container.provision" ||
            !recovery ||
            recovery.resourceKind !== "sqlContainer" ||
            !containerName ||
            !/^rbs-[a-z0-9][a-z0-9_.-]{2,62}$/i.test(containerName) ||
            recovery.resourceId !== containerName ||
            !connectionProfileId ||
            connectionProfileId !== containerConnectionProfileId(effectId) ||
            recovery.connectionProfileId !== connectionProfileId ||
            recovery.ownershipMarkerDigest !== ownershipMarkerDigest ||
            (resource !== undefined &&
                (resource.resourceKind !== "sqlContainer" ||
                    resource.resourceId !== containerName ||
                    resource.connectionProfileId !== connectionProfileId ||
                    resource.ownershipMarkerDigest !== ownershipMarkerDigest))
        ) {
            this.effectLedger.requireOperatorDecision(effectId, "RecoveryMetadataInvalid");
            throw new LocalActivityError(
                LocRunbookStudio.sqlContainerOwnershipMismatch,
                "RunbookStudio.EffectRecoveryRequired",
            );
        }
        const container = await getContainerByName(containerName);
        if (container) {
            const inspected = await container.inspect();
            if (
                !isOwnedLocalSqlContainer(
                    inspected.Config?.Labels,
                    effectId,
                    snapshot.identity.runId,
                )
            ) {
                this.effectLedger.requireOperatorDecision(effectId, "ContainerLabelsChanged");
                throw new LocalActivityError(
                    LocRunbookStudio.sqlContainerOwnershipMismatch,
                    "RunbookStudio.TargetChanged",
                );
            }
        }
        if (snapshot.state === "prepared") {
            if (!container) {
                this.effectLedger.recordNoEffectFailure(effectId, "RecoveredBeforeEffect");
                throw new LocalActivityError(
                    LocRunbookStudio.sandboxEffectRecoveryRequired,
                    "RunbookStudio.EffectRecoveryRequired",
                );
            }
            snapshot = this.effectLedger.recordEffectObserved(effectId, {
                resourceKind: "sqlContainer",
                resourceId: containerName,
                ownershipMarkerDigest,
                connectionProfileId,
                outputHandles: [localSqlContainerLeaseRef(effectId), `database:${databaseName}`],
            });
        }
        if (snapshot.state === "effectObserved") {
            snapshot = this.effectLedger.startCleanup(effectId);
        }
        if (container && !(await deleteContainer(containerName))) {
            this.effectLedger.requireOperatorDecision(effectId, "ContainerDeleteFailed");
            throw new LocalActivityError(
                LocRunbookStudio.sqlContainerProvisionFailed,
                "RunbookStudio.EffectRecoveryRequired",
            );
        }
        if (await getContainerByName(containerName)) {
            this.effectLedger.requireOperatorDecision(effectId, "ContainerDeleteNotObserved");
            throw new LocalActivityError(
                LocRunbookStudio.sqlContainerProvisionFailed,
                "RunbookStudio.EffectRecoveryRequired",
            );
        }
        const cleanupEvidenceDigest = digestRunbookValue({
            effectId,
            containerName,
            cleaned: true,
        });
        this.completeDependentContainerEffects(
            snapshot.identity.runId,
            connectionProfileId,
            ownershipMarkerDigest,
            cleanupEvidenceDigest,
        );
        for (const [captureRef, capture] of this.xeventCaptures) {
            if (capture.containerEffectId === effectId) {
                this.xeventCaptures.delete(captureRef);
            }
        }
        if (snapshot.state === "cleanupStarted") {
            snapshot = this.effectLedger.completeCleanup(effectId, cleanupEvidenceDigest);
        }
        this.containerLeaseProfiles.delete(effectId);
        return {
            effectId,
            leaseId: effectId,
            databaseName,
            containerName,
            cleaned: true,
            cleanedAtUtc: new Date(snapshot.lastUpdatedEpochMs).toISOString(),
            cleanupEvidenceDigest,
        };
    }

    private completeDependentContainerEffects(
        runId: string,
        connectionProfileId: string,
        ownershipMarkerDigest: string,
        cleanupEvidenceDigest: string,
    ): void {
        for (const entry of this.effectLedger.scanRecovery().outstanding) {
            let dependent = entry.snapshot;
            const recovery = dependent.identity.recovery;
            const isDeployment =
                dependent.identity.activityKind === "dacpac.deploy.container" &&
                recovery?.resourceKind === "dacpacDeployment";
            const isWorkload =
                dependent.identity.activityKind === "sql.workload.run" &&
                recovery?.resourceKind === "workloadExecution";
            const isXeventSession =
                dependent.identity.activityKind === "xevent.session.start" &&
                recovery?.resourceKind === "xeventSession";
            if (
                dependent.identity.runId !== runId ||
                (!isDeployment && !isWorkload && !isXeventSession) ||
                !recovery ||
                recovery.connectionProfileId !== connectionProfileId ||
                recovery.ownershipMarkerDigest !== ownershipMarkerDigest ||
                dependent.state === "needsOperatorDecision"
            ) {
                continue;
            }
            if (dependent.state === "prepared") {
                dependent = this.effectLedger.recordEffectObserved(dependent.identity.effectId, {
                    resourceKind: isDeployment
                        ? "dacpacDeploymentOutcomeUnknown"
                        : isWorkload
                          ? "workloadExecutionOutcomeUnknown"
                          : "xeventSessionOutcomeUnknown",
                    resourceId: recovery.resourceId,
                    ownershipMarkerDigest,
                    connectionProfileId,
                });
            }
            if (dependent.state === "effectObserved") {
                dependent = this.effectLedger.startCleanup(dependent.identity.effectId);
            }
            if (dependent.state === "cleanupStarted") {
                this.effectLedger.completeCleanup(
                    dependent.identity.effectId,
                    digestRunbookValue({
                        cleanupEvidenceDigest,
                        dependentEffectId: dependent.identity.effectId,
                    }),
                );
            }
        }
    }

    /** A DACPAC deployment is compensated by deleting its owned disposable
     * database. Settle even a prepared/unknown deploy only after the database
     * absence probe succeeds, so a crash window cannot strand effect state. */
    private completeDependentSandboxEffects(
        runId: string,
        databaseName: string,
        connectionProfileId: string,
        ownershipMarkerDigest: string,
        cleanupEvidenceDigest: string,
    ): void {
        const scan = this.effectLedger.scanRecovery();
        for (const entry of scan.outstanding) {
            let dependent = entry.snapshot;
            const recovery = dependent.identity.recovery;
            const isDeployment =
                dependent.identity.activityKind === "dacpac.deploy" &&
                recovery?.resourceKind === "dacpacDeployment";
            const isTsqlt =
                dependent.identity.activityKind === "tsqlt.run" &&
                recovery?.resourceKind === "tsqltExecution";
            if (
                dependent.identity.runId !== runId ||
                (!isDeployment && !isTsqlt) ||
                !recovery ||
                recovery.resourceId !== databaseName ||
                recovery.connectionProfileId !== connectionProfileId ||
                recovery.ownershipMarkerDigest !== ownershipMarkerDigest ||
                dependent.state === "needsOperatorDecision"
            ) {
                continue;
            }
            if (dependent.state === "prepared") {
                dependent = this.effectLedger.recordEffectObserved(dependent.identity.effectId, {
                    resourceKind: isDeployment
                        ? "dacpacDeploymentOutcomeUnknown"
                        : "tsqltExecutionOutcomeUnknown",
                    resourceId: databaseName,
                    ownershipMarkerDigest,
                    connectionProfileId,
                });
            }
            if (dependent.state === "effectObserved") {
                dependent = this.effectLedger.startCleanup(dependent.identity.effectId);
            }
            if (dependent.state === "cleanupStarted") {
                this.effectLedger.completeCleanup(
                    dependent.identity.effectId,
                    digestRunbookValue({
                        cleanupEvidenceDigest,
                        dependentEffectId: dependent.identity.effectId,
                    }),
                );
            }
        }
    }

    private async settleSandboxProvisionFailure(
        ownerUri: string,
        effectId: string,
        databaseName: string,
    ): Promise<void> {
        const current = this.effectLedger.recoverEffect(effectId)?.snapshot;
        if (!current || current.state !== "prepared") {
            return;
        }
        try {
            const probe = await this.probeLocalSandbox(ownerUri, databaseName);
            if (!probe.exists) {
                this.effectLedger.recordNoEffectFailure(effectId, "ProvisionFailedBeforeEffect");
            } else if (probe.ownershipMarker === effectId) {
                const recovery = current.identity.recovery!;
                this.effectLedger.recordEffectObserved(effectId, {
                    resourceKind: "sqlDatabase",
                    resourceId: databaseName,
                    ownershipMarkerDigest: recovery.ownershipMarkerDigest,
                    connectionProfileId: recovery.connectionProfileId,
                    outputHandles: [localSandboxLeaseRef(effectId)],
                });
            } else {
                this.effectLedger.requireOperatorDecision(effectId, "ProvisionOutcomeUnknown");
            }
        } catch {
            const latest = this.effectLedger.recoverEffect(effectId)?.snapshot;
            if (latest?.state === "prepared") {
                this.effectLedger.requireOperatorDecision(effectId, "ProvisionProbeFailed");
            }
        }
    }

    private async probeLocalSandbox(
        ownerUri: string,
        databaseName: string,
    ): Promise<LocalSandboxProbe> {
        const result = await SqlToolsServerClient.instance.sendRequest(SimpleExecuteRequestType, {
            ownerUri,
            queryString: buildProbeLocalSandboxSql(databaseName),
        });
        const row = result.rows?.[0];
        const exists = row?.[0]?.displayValue === "1";
        const marker = row?.[1];
        return {
            exists,
            ...(!marker || marker.isNull ? {} : { ownershipMarker: marker.displayValue }),
        };
    }

    /** Roll back an interrupted mutation by removing only the exact named
     * database whose ownership marker hashes to the prepared recovery record.
     * A finalized retained effect never enters this path. */
    private async rollbackOutstandingDevelopmentDatabaseEffect(
        initial: RunbookEffectSnapshot,
    ): Promise<void> {
        let snapshot = initial;
        const recovery = snapshot.identity.recovery;
        const resource = snapshot.resource;
        const databaseName = resource?.resourceId ?? recovery?.resourceId;
        const connectionProfileId = resource?.connectionProfileId ?? recovery?.connectionProfileId;
        const ownershipMarkerDigest =
            resource?.ownershipMarkerDigest ?? recovery?.ownershipMarkerDigest;
        const validResourceKind =
            (snapshot.identity.activityKind === "devdatabase.provision" &&
                recovery?.resourceKind === "developmentSqlDatabase") ||
            (snapshot.identity.activityKind === "dacpac.deploy.dev" &&
                recovery?.resourceKind === "dacpacDeployment") ||
            (snapshot.identity.activityKind === "sql.schema.apply" &&
                recovery?.resourceKind === "schemaMutation");
        if (
            !recovery ||
            !validResourceKind ||
            !databaseName ||
            !isValidLocalDevelopmentDatabaseName(databaseName) ||
            !connectionProfileId ||
            !ownershipMarkerDigest ||
            recovery.resourceId !== databaseName ||
            recovery.connectionProfileId !== connectionProfileId ||
            recovery.ownershipMarkerDigest !== ownershipMarkerDigest ||
            (resource !== undefined &&
                (resource.resourceId !== databaseName ||
                    resource.connectionProfileId !== connectionProfileId ||
                    resource.ownershipMarkerDigest !== ownershipMarkerDigest))
        ) {
            this.effectLedger.requireOperatorDecision(
                snapshot.identity.effectId,
                "RecoveryMetadataInvalid",
            );
            throw new LocalActivityError(
                LocRunbookStudio.sandboxEffectRecoveryRequired,
                "RunbookStudio.EffectRecoveryRequired",
            );
        }
        const baseProfile = await this.requireSavedConnection(connectionProfileId);
        this.assertSandboxBaseProfile(baseProfile);
        await this.withSandboxConnection(
            baseProfile,
            "development-rollback",
            () => false,
            async (ownerUri) => {
                const probe = await this.probeLocalDevelopmentDatabase(ownerUri, databaseName);
                if (
                    probe.exists &&
                    (!probe.ownershipMarker ||
                        digestRunbookValue(probe.ownershipMarker) !== ownershipMarkerDigest)
                ) {
                    this.effectLedger.requireOperatorDecision(
                        snapshot.identity.effectId,
                        "OwnershipMarkerMissingOrChanged",
                    );
                    throw new LocalActivityError(
                        LocRunbookStudio.developmentDatabaseOwnershipMismatch,
                        "RunbookStudio.TargetChanged",
                    );
                }
                if (snapshot.state === "prepared") {
                    if (!probe.exists) {
                        this.effectLedger.recordNoEffectFailure(
                            snapshot.identity.effectId,
                            "RecoveredBeforeEffect",
                        );
                        return;
                    }
                    snapshot = this.effectLedger.recordEffectObserved(snapshot.identity.effectId, {
                        resourceKind: `${snapshot.identity.activityKind}.outcomeUnknown`,
                        resourceId: databaseName,
                        ownershipMarkerDigest,
                        connectionProfileId,
                    });
                }
                if (snapshot.state === "effectObserved") {
                    snapshot = this.effectLedger.startCleanup(snapshot.identity.effectId);
                }
                if (probe.exists) {
                    await SqlToolsServerClient.instance.sendRequest(SimpleExecuteRequestType, {
                        ownerUri,
                        queryString: buildDropLocalDevelopmentDatabaseSql(
                            databaseName,
                            probe.ownershipMarker!,
                        ),
                    });
                }
                const after = await this.probeLocalDevelopmentDatabase(ownerUri, databaseName);
                if (after.exists) {
                    this.effectLedger.requireOperatorDecision(
                        snapshot.identity.effectId,
                        "RollbackDidNotRemoveDatabase",
                    );
                    throw new LocalActivityError(
                        LocRunbookStudio.sandboxCleanupFailed,
                        "RunbookStudio.EffectRecoveryRequired",
                    );
                }
                if (snapshot.state === "cleanupStarted") {
                    this.effectLedger.completeCleanup(
                        snapshot.identity.effectId,
                        digestRunbookValue({
                            effectId: snapshot.identity.effectId,
                            databaseName,
                            rolledBack: true,
                        }),
                    );
                }
            },
        );
    }

    private async probeLocalDevelopmentDatabase(
        ownerUri: string,
        databaseName: string,
    ): Promise<LocalDevelopmentDatabaseProbe> {
        const result = await SqlToolsServerClient.instance.sendRequest(SimpleExecuteRequestType, {
            ownerUri,
            queryString: buildProbeLocalDevelopmentDatabaseSql(databaseName),
        });
        const row = result.rows?.[0];
        const exists = row?.[0]?.displayValue === "1";
        const marker = row?.[1];
        return {
            exists,
            ...(!marker || marker.isNull ? {} : { ownershipMarker: marker.displayValue }),
        };
    }

    private async settleDevelopmentProvisionFailure(
        ownerUri: string,
        effectId: string,
        databaseName: string,
    ): Promise<void> {
        let current = this.effectLedger.recoverEffect(effectId)?.snapshot;
        if (!current || current.state === "failedNoEffect" || current.state === "cleaned") {
            return;
        }
        try {
            const probe = await this.probeLocalDevelopmentDatabase(ownerUri, databaseName);
            if (!probe.exists) {
                if (current.state === "prepared") {
                    this.effectLedger.recordNoEffectFailure(
                        effectId,
                        "ProvisionFailedBeforeEffect",
                    );
                } else {
                    if (current.state === "effectObserved") {
                        current = this.effectLedger.startCleanup(effectId);
                    }
                    if (current.state === "cleanupStarted") {
                        this.effectLedger.completeCleanup(
                            effectId,
                            digestRunbookValue({ effectId, databaseName, rolledBack: true }),
                        );
                    }
                }
                return;
            }
            if (probe.ownershipMarker !== effectId) {
                this.effectLedger.requireOperatorDecision(effectId, "ProvisionOutcomeUnknown");
                return;
            }
            const recovery = current.identity.recovery!;
            if (current.state === "prepared") {
                current = this.effectLedger.recordEffectObserved(effectId, {
                    resourceKind: "developmentSqlDatabase",
                    resourceId: databaseName,
                    ownershipMarkerDigest: recovery.ownershipMarkerDigest,
                    connectionProfileId: recovery.connectionProfileId,
                    outputHandles: [localDevelopmentDatabaseLeaseRef(effectId)],
                });
            }
            if (current.state === "effectObserved") {
                current = this.effectLedger.startCleanup(effectId);
            }
            if (current.state === "cleanupStarted") {
                await SqlToolsServerClient.instance.sendRequest(SimpleExecuteRequestType, {
                    ownerUri,
                    queryString: buildDropLocalDevelopmentDatabaseSql(databaseName, effectId),
                });
                const after = await this.probeLocalDevelopmentDatabase(ownerUri, databaseName);
                if (after.exists) {
                    this.effectLedger.requireOperatorDecision(
                        effectId,
                        "RollbackDidNotRemoveDatabase",
                    );
                    return;
                }
                this.effectLedger.completeCleanup(
                    effectId,
                    digestRunbookValue({ effectId, databaseName, rolledBack: true }),
                );
            }
        } catch {
            const latest = this.effectLedger.recoverEffect(effectId)?.snapshot;
            if (latest && latest.state !== "cleaned" && latest.state !== "failedNoEffect") {
                this.effectLedger.requireOperatorDecision(effectId, "ProvisionRollbackFailed");
            }
        }
    }

    private async withSandboxConnection<T>(
        baseProfile: IConnectionProfileWithSource,
        purpose: string,
        isCancellationRequested: () => boolean,
        action: (ownerUri: string, cancellationToken: vscode.CancellationToken) => Promise<T>,
    ): Promise<T> {
        const connectionManager = this.connectionAccess();
        if (!connectionManager) {
            throw new LocalActivityError(
                LocRunbookStudio.dacpacPreviewServiceUnavailable,
                "RunbookStudio.ProviderUnavailable",
            );
        }
        sandboxCounter++;
        const ownerUri = `runbookstudio://sandbox-${purpose}/${sandboxCounter.toString(36)}`;
        const profile = { ...baseProfile, database: "master" } as mssql.IConnectionInfo;
        const cancellation = new vscode.CancellationTokenSource();
        const poll = setInterval(() => {
            if (isCancellationRequested()) {
                cancellation.cancel();
            }
        }, 50);
        let connected = false;
        try {
            connected = await connectionManager.connect(ownerUri, profile, {
                connectionSource: "runbookStudio",
                shouldHandleErrors: false,
            });
            if (!connected) {
                throw new LocalActivityError(
                    LocRunbookStudio.connectFailed,
                    "RunbookStudio.ActivityFailed",
                );
            }
            return await action(ownerUri, cancellation.token);
        } finally {
            clearInterval(poll);
            cancellation.dispose();
            if (connected) {
                try {
                    await connectionManager.disconnect(ownerUri);
                } catch {
                    // Cleanup evidence remains authoritative; session close is best effort.
                }
            }
        }
    }

    private async requireSavedConnection(profileId: string): Promise<IConnectionProfileWithSource> {
        const connectionManager = this.connectionAccess();
        const profiles = await connectionManager?.connectionStore.readAllConnections(false);
        const profile = profiles?.find((candidate) => candidate.id === profileId);
        if (!profile) {
            throw new LocalActivityError(
                LocRunbookStudio.connectionProfileNotFound(profileId),
                "RunbookStudio.TargetNotFound",
            );
        }
        return profile;
    }

    private assertSandboxBaseProfile(profile: IConnectionProfileWithSource): void {
        if (!isStrictLoopbackSqlServer(profile.server)) {
            throw new LocalActivityError(
                LocRunbookStudio.sandboxLoopbackRequired,
                "RunbookStudio.ActivityPolicyDenied",
            );
        }
        if (profile.connectionString?.trim()) {
            throw new LocalActivityError(
                LocRunbookStudio.sandboxStructuredProfileRequired,
                "RunbookStudio.BindingInvalid",
            );
        }
    }

    private async resolveRunbookConnection(databaseRef: string): Promise<{
        profile: mssql.IConnectionInfo;
        targetDatabase: string;
        sandbox?: {
            effectId: string;
            connectionProfileId: string;
            ownershipMarkerDigest: string;
        };
        development?: {
            effectId: string;
            connectionProfileId: string;
            ownershipMarkerDigest: string;
        };
        container?: {
            effectId: string;
            connectionProfileId: string;
            ownershipMarkerDigest: string;
        };
    }> {
        const sandboxEffectId = effectIdFromLocalSandboxLeaseRef(databaseRef);
        const developmentEffectId = effectIdFromLocalDevelopmentDatabaseLeaseRef(databaseRef);
        const containerEffectId = effectIdFromLocalSqlContainerLeaseRef(databaseRef);
        if (containerEffectId) {
            const snapshot = this.effectLedger.recoverEffect(containerEffectId)?.snapshot;
            const resource = snapshot?.resource;
            const recovery = snapshot?.identity.recovery;
            const lease = this.containerLeaseProfiles.get(containerEffectId);
            const expectedConnectionProfileId = containerConnectionProfileId(containerEffectId);
            const expectedMarkerDigest = digestRunbookValue(containerEffectId);
            if (
                !snapshot ||
                snapshot.state !== "effectObserved" ||
                snapshot.identity.activityKind !== "sql.container.provision" ||
                !resource ||
                resource.resourceKind !== "sqlContainer" ||
                resource.connectionProfileId !== expectedConnectionProfileId ||
                resource.ownershipMarkerDigest !== expectedMarkerDigest ||
                !recovery ||
                recovery.resourceKind !== "sqlContainer" ||
                recovery.resourceId !== resource.resourceId ||
                recovery.connectionProfileId !== expectedConnectionProfileId ||
                recovery.ownershipMarkerDigest !== expectedMarkerDigest
            ) {
                throw new LocalActivityError(
                    LocRunbookStudio.sandboxEffectRecoveryRequired,
                    "RunbookStudio.TargetNotFound",
                );
            }
            const container = await getContainerByName(resource.resourceId);
            const inspected = await container?.inspect();
            if (
                !container ||
                !isOwnedLocalSqlContainer(
                    inspected?.Config?.Labels,
                    containerEffectId,
                    snapshot.identity.runId,
                )
            ) {
                this.effectLedger.requireOperatorDecision(
                    containerEffectId,
                    "ProvisionedContainerMissingOrChanged",
                );
                throw new LocalActivityError(
                    LocRunbookStudio.sqlContainerOwnershipMismatch,
                    "RunbookStudio.TargetChanged",
                );
            }
            if (!lease || lease.containerName !== resource.resourceId) {
                throw new LocalActivityError(
                    LocRunbookStudio.sqlContainerCredentialsUnavailable,
                    "RunbookStudio.TargetNotFound",
                );
            }
            return {
                profile: lease.profile,
                targetDatabase: lease.databaseName,
                container: {
                    effectId: containerEffectId,
                    connectionProfileId: expectedConnectionProfileId,
                    ownershipMarkerDigest: expectedMarkerDigest,
                },
            };
        }
        const effectId = sandboxEffectId ?? developmentEffectId;
        if (!effectId) {
            const profile = await this.requireSavedConnection(databaseRef);
            return { profile, targetDatabase: profile.database };
        }
        const snapshot = this.effectLedger.recoverEffect(effectId)?.snapshot;
        const resource = snapshot?.resource;
        const recovery = snapshot?.identity.recovery;
        const expectedDatabaseName = sandboxEffectId
            ? localSandboxDatabaseName(effectId)
            : (resource?.resourceId ?? recovery?.resourceId);
        const expectedMarkerDigest = digestRunbookValue(effectId);
        if (
            !snapshot ||
            (sandboxEffectId
                ? snapshot.state !== "effectObserved"
                : snapshot.state !== "finalized") ||
            !expectedDatabaseName ||
            (developmentEffectId !== undefined &&
                !isValidLocalDevelopmentDatabaseName(expectedDatabaseName)) ||
            !resource?.connectionProfileId ||
            resource.resourceKind !==
                (sandboxEffectId ? "sqlDatabase" : "developmentSqlDatabase") ||
            resource.resourceId !== expectedDatabaseName ||
            resource.ownershipMarkerDigest !== expectedMarkerDigest ||
            !recovery ||
            recovery.resourceKind !==
                (sandboxEffectId ? "sqlDatabase" : "developmentSqlDatabase") ||
            recovery.resourceId !== expectedDatabaseName ||
            recovery.connectionProfileId !== resource.connectionProfileId ||
            recovery.ownershipMarkerDigest !== expectedMarkerDigest
        ) {
            throw new LocalActivityError(
                LocRunbookStudio.sandboxEffectRecoveryRequired,
                "RunbookStudio.TargetNotFound",
            );
        }
        const baseProfile = await this.requireSavedConnection(resource.connectionProfileId);
        this.assertSandboxBaseProfile(baseProfile);
        const probe = await this.withSandboxConnection(
            baseProfile,
            "verify",
            () => false,
            async (ownerUri) =>
                sandboxEffectId
                    ? this.probeLocalSandbox(ownerUri, expectedDatabaseName)
                    : this.probeLocalDevelopmentDatabase(ownerUri, expectedDatabaseName),
        );
        if (!probe.exists || probe.ownershipMarker !== effectId) {
            this.effectLedger.requireOperatorDecision(
                effectId,
                "ProvisionedResourceMissingOrChanged",
            );
            throw new LocalActivityError(
                LocRunbookStudio.sandboxOwnershipMismatch,
                "RunbookStudio.TargetChanged",
            );
        }
        return {
            profile: { ...baseProfile, database: resource.resourceId } as mssql.IConnectionInfo,
            targetDatabase: resource.resourceId,
            ...(sandboxEffectId
                ? {
                      sandbox: {
                          effectId,
                          connectionProfileId: resource.connectionProfileId,
                          ownershipMarkerDigest: resource.ownershipMarkerDigest,
                      },
                  }
                : {
                      development: {
                          effectId,
                          connectionProfileId: resource.connectionProfileId,
                          ownershipMarkerDigest: resource.ownershipMarkerDigest,
                      },
                  }),
        };
    }

    private async localManagedArtifactPath(
        invocation: ActivityInvocationIdentity,
        nodeId: string,
        fileName: string,
    ): Promise<string> {
        return this.runDropStore.artifactPath(invocation.runId, nodeId, fileName);
    }

    private async extractLocalDacpac(
        nodeId: string,
        databaseRef: string,
        sourceDatabaseName: string,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalDacpacExtractionResult> {
        if (isCancellationRequested()) {
            throw new LocalActivityError(
                LocRunbookStudio.dacpacExtractCancelled,
                "RunbookStudio.ActivityCancelled",
            );
        }
        const connectionManager = this.connectionAccess();
        const dacFxService = this.dacFxAccess();
        if (!connectionManager || !dacFxService) {
            throw new LocalActivityError(
                LocRunbookStudio.dacpacExtractServiceUnavailable,
                "RunbookStudio.ProviderUnavailable",
            );
        }
        const resolved = await this.resolveRunbookConnection(databaseRef);
        const databaseName = sourceDatabaseName.trim();
        if (!isValidDacpacSourceDatabaseName(databaseName)) {
            throw new LocalActivityError(
                LocRunbookStudio.dacpacExtractDatabaseRequired,
                "RunbookStudio.BindingInvalid",
            );
        }
        const sourceProfile = {
            ...resolved.profile,
            database: databaseName,
        } as mssql.IConnectionInfo;
        const artifactPath = await this.localManagedArtifactPath(
            invocation,
            nodeId,
            `${databaseName}.dacpac`,
        );
        if (await pathExists(artifactPath)) {
            throw new LocalActivityError(
                LocRunbookStudio.runbookArtifactAlreadyExists(artifactPath),
                "RunbookStudio.ArtifactExists",
            );
        }

        extractCounter++;
        const ownerUri = `runbookstudio://dacfx-extract/${extractCounter.toString(36)}`;
        const cancellation = new vscode.CancellationTokenSource();
        const cancellationPoll = setInterval(() => {
            if (isCancellationRequested()) {
                cancellation.cancel();
            }
        }, 50);
        let connected = false;
        let complete = false;
        try {
            connected = await connectionManager.connect(ownerUri, sourceProfile, {
                connectionSource: "runbookStudio",
            });
            if (!connected) {
                throw new LocalActivityError(
                    LocRunbookStudio.connectFailed,
                    "RunbookStudio.ActivityFailed",
                );
            }
            const result = await dacFxService.extractDacpac(
                databaseName,
                artifactPath,
                databaseName,
                "1.0.0.0",
                ownerUri,
                TaskExecutionMode.execute,
                cancellation.token,
            );
            if (cancellation.token.isCancellationRequested || isCancellationRequested()) {
                throw new LocalActivityError(
                    LocRunbookStudio.dacpacExtractCancelled,
                    "RunbookStudio.ActivityCancelled",
                );
            }
            if (!result.success) {
                throw new LocalActivityError(
                    LocRunbookStudio.dacpacExtractFailed,
                    "RunbookStudio.DacpacExtractFailed",
                );
            }
            const artifact = await verifyLocalDacpacArtifact(
                artifactPath,
                isCancellationRequested,
                this.runDropStore.trustedArtifactRoots(),
            );
            complete = true;
            return {
                databaseName,
                operationId: result.operationId,
                ...artifact,
                extractedAtUtc: new Date().toISOString(),
            };
        } catch (error) {
            if (
                error instanceof vscode.CancellationError ||
                cancellation.token.isCancellationRequested ||
                isCancellationRequested()
            ) {
                throw new LocalActivityError(
                    LocRunbookStudio.dacpacExtractCancelled,
                    "RunbookStudio.ActivityCancelled",
                );
            }
            throw error;
        } finally {
            clearInterval(cancellationPoll);
            cancellation.dispose();
            if (connected) {
                try {
                    await connectionManager.disconnect(ownerUri);
                } catch {
                    // Best effort: the extraction request has already settled.
                }
            }
            if (!complete) {
                await fs.promises.rm(artifactPath, { force: true }).catch(() => undefined);
            }
        }
    }

    private async exportLocalSchemaComparison(
        nodeId: string,
        dacpacPath: string,
        databaseRef: string,
        invocation: ActivityInvocationIdentity,
        isCancellationRequested: () => boolean,
    ): Promise<LocalSchemaComparisonExportResult> {
        const artifact = await verifyLocalDacpacArtifact(dacpacPath, isCancellationRequested, [
            ...this.runDropStore.trustedArtifactRoots(),
        ]);
        const reportPath = await this.localManagedArtifactPath(
            invocation,
            nodeId,
            "schema-comparison.xml",
        );
        const outputPath = await this.localManagedArtifactPath(
            invocation,
            nodeId,
            "schema-comparison.json",
        );
        if ((await pathExists(reportPath)) || (await pathExists(outputPath))) {
            throw new LocalActivityError(
                LocRunbookStudio.runbookArtifactAlreadyExists(outputPath),
                "RunbookStudio.ArtifactExists",
            );
        }
        let complete = false;
        try {
            const schemaCompare = this.schemaCompareAccess();
            const dacFx = this.dacFxAccess();
            if (!schemaCompare || !dacFx) {
                throw new LocalActivityError(
                    LocRunbookStudio.schemaComparisonExportFailed,
                    "RunbookStudio.ProviderUnavailable",
                );
            }
            let document: LocalSchemaComparisonExportResult["document"] | undefined;
            const preview = await this.generateLocalDacpacDeploymentPreview(
                artifact.artifactPath,
                databaseRef,
                isCancellationRequested,
                async (report, target) => {
                    await fs.promises.writeFile(reportPath, report, {
                        encoding: "utf8",
                        flag: "wx",
                    });
                    const provider = new StsV1RunbookSchemaCompareProvider(schemaCompare, dacFx);
                    document = await provider.compare({
                        operationId: crypto.randomUUID(),
                        dacpacPath: artifact.artifactPath,
                        sourceLabel: path.basename(artifact.artifactPath),
                        targetServer: target.serverName,
                        targetDatabase: target.databaseName,
                        ownerUri: target.ownerUri,
                        isCancellationRequested,
                    });
                    await fs.promises.writeFile(
                        outputPath,
                        JSON.stringify(document, undefined, 2),
                        {
                            encoding: "utf8",
                            flag: "wx",
                        },
                    );
                },
            );
            if (!document) {
                throw new LocalActivityError(
                    LocRunbookStudio.schemaComparisonExportFailed,
                    "RunbookStudio.ActivityFailed",
                );
            }
            const outputStat = await fs.promises.stat(outputPath);
            if (!outputStat.isFile() || outputStat.size === 0) {
                throw new LocalActivityError(
                    LocRunbookStudio.schemaComparisonExportFailed,
                    "RunbookStudio.ArtifactInvalid",
                );
            }
            complete = true;
            const documentBytes = await fs.promises.readFile(outputPath);
            return {
                ...preview,
                matches: preview.changeCount === 0,
                artifactPath: outputPath,
                artifactSizeBytes: outputStat.size,
                artifactSha256: crypto.createHash("sha256").update(documentBytes).digest("hex"),
                deploymentReportArtifactPath: reportPath,
                document,
                exportedAtUtc: new Date().toISOString(),
            };
        } catch (error) {
            if (error instanceof SchemaCompareProviderError) {
                throw new LocalActivityError(
                    error.message,
                    error.code === "cancelled"
                        ? "RunbookStudio.ActivityCancelled"
                        : "RunbookStudio.ActivityFailed",
                );
            }
            throw error;
        } finally {
            if (!complete) {
                await fs.promises.rm(outputPath, { force: true }).catch(() => undefined);
                await fs.promises.rm(reportPath, { force: true }).catch(() => undefined);
            }
        }
    }

    private async visualizeLocalDatabaseSchema(
        databaseRef: string,
        isCancellationRequested: () => boolean,
    ) {
        if (isCancellationRequested()) {
            throw new LocalActivityError(
                LocRunbookStudio.stepCancelled,
                "RunbookStudio.ActivityCancelled",
            );
        }
        const resolved = await this.resolveRunbookConnection(databaseRef);
        const connectionManager = this.connectionAccess();
        if (!connectionManager) {
            throw new LocalActivityError(
                LocRunbookStudio.connectFailed,
                "RunbookStudio.ProviderUnavailable",
            );
        }
        const profile = {
            ...resolved.profile,
            database: resolved.targetDatabase,
        } as mssql.IConnectionInfo & { password?: string };
        const inlinePassword = profile.password;
        const secrets: ProfileSecretSource = {
            lookupPassword: async (credentials, isConnectionString) =>
                inlinePassword ??
                connectionManager.connectionStore.lookupPassword(
                    credentials as mssql.IConnectionInfo,
                    isConnectionString,
                ),
        };
        const prepared = prepareConnection(
            profile as StoredConnectionProfile,
            secrets,
            vscodeSqlTokenSource,
        );
        try {
            const provider = new MetadataStoreRunbookSchemaGraphProvider(
                MetadataStoreService.get().store(),
            );
            const document = await provider.visualize({
                prepared,
                database: resolved.targetDatabase,
                isCancellationRequested,
            });
            return { document };
        } catch (error) {
            if (error instanceof RunbookSchemaGraphProviderError) {
                throw new LocalActivityError(
                    error.message,
                    error.code === "cancelled"
                        ? "RunbookStudio.ActivityCancelled"
                        : "RunbookStudio.ActivityFailed",
                );
            }
            throw error;
        }
    }

    private async previewLocalDacpacDeployment(
        dacpacPath: string,
        databaseRef: string,
        isCancellationRequested: () => boolean,
    ) {
        const artifact = await verifyLocalDacpacArtifact(dacpacPath, isCancellationRequested, [
            ...this.runDropStore.trustedArtifactRoots(),
        ]);
        return this.generateLocalDacpacDeploymentPreview(
            artifact.artifactPath,
            databaseRef,
            isCancellationRequested,
        );
    }

    /** Generate a report from a path already admitted by a stronger boundary
     * (workspace verification or extension-controlled content staging). */
    private async generateLocalDacpacDeploymentPreview(
        verifiedDacpacPath: string,
        databaseRef: string,
        isCancellationRequested: () => boolean,
        retainFullReport?: (
            report: string,
            target: { ownerUri: string; serverName: string; databaseName: string },
        ) => Promise<void>,
    ) {
        if (isCancellationRequested()) {
            throw new LocalActivityError(
                LocRunbookStudio.dacpacPreviewCancelled,
                "RunbookStudio.ActivityCancelled",
            );
        }
        const connectionManager = this.connectionAccess();
        const dacFxService = this.dacFxAccess();
        if (!connectionManager || !dacFxService) {
            throw new LocalActivityError(
                LocRunbookStudio.dacpacPreviewServiceUnavailable,
                "RunbookStudio.ProviderUnavailable",
            );
        }
        const resolvedConnection = await this.resolveRunbookConnection(databaseRef);
        const profile = resolvedConnection.profile;
        const targetDatabase = resolvedConnection.targetDatabase.trim();
        if (!targetDatabase) {
            throw new LocalActivityError(
                LocRunbookStudio.dacpacPreviewDatabaseRequired,
                "RunbookStudio.BindingInvalid",
            );
        }

        previewCounter++;
        const ownerUri = `runbookstudio://dacfx-preview/${previewCounter.toString(36)}`;
        const cancellation = new vscode.CancellationTokenSource();
        const cancellationPoll = setInterval(() => {
            if (isCancellationRequested()) {
                cancellation.cancel();
            }
        }, 50);
        let connected = false;
        try {
            connected = await connectionManager.connect(ownerUri, profile, {
                connectionSource: "runbookStudio",
            });
            if (!connected) {
                throw new LocalActivityError(
                    LocRunbookStudio.connectFailed,
                    "RunbookStudio.ActivityFailed",
                );
            }
            const result = await dacFxService.generateDeployPlan(
                verifiedDacpacPath,
                targetDatabase,
                ownerUri,
                TaskExecutionMode.execute,
                cancellation.token,
            );
            if (cancellation.token.isCancellationRequested || isCancellationRequested()) {
                throw new LocalActivityError(
                    LocRunbookStudio.dacpacPreviewCancelled,
                    "RunbookStudio.ActivityCancelled",
                );
            }
            if (!result.success || !result.report) {
                throw new LocalActivityError(
                    LocRunbookStudio.dacpacPreviewFailed,
                    "RunbookStudio.DeploymentPreviewFailed",
                );
            }
            const preview = buildLocalDeploymentPreviewResult(
                verifiedDacpacPath,
                targetDatabase,
                result.operationId,
                result.report,
            );
            if (retainFullReport) {
                await retainFullReport(result.report, {
                    ownerUri,
                    serverName: profile.server,
                    databaseName: targetDatabase,
                });
            }
            return preview;
        } catch (error) {
            if (
                error instanceof vscode.CancellationError ||
                cancellation.token.isCancellationRequested ||
                isCancellationRequested()
            ) {
                throw new LocalActivityError(
                    LocRunbookStudio.dacpacPreviewCancelled,
                    "RunbookStudio.ActivityCancelled",
                );
            }
            throw error;
        } finally {
            clearInterval(cancellationPoll);
            cancellation.dispose();
            if (connected) {
                try {
                    await connectionManager.disconnect(ownerUri);
                } catch {
                    // Best effort: the preview request has already settled.
                }
            }
        }
    }

    /** Boundary event -> ledger event -> model snapshot (host authority). */
    private onBoundaryEvent(
        active: ActiveRunBinding,
        artifact: RunbookArtifactFile,
        event: RuntimeBoundaryEvent,
    ): void {
        if (active.runEnded) {
            // Post-terminal boundary output is a runtime bug: journal it,
            // never fold it (A2 §7.3).
            emitRunbookEvent(active.context, "runbookStudio.run.postTerminalEvent", "warning", {
                eventKind: metaField(event.kind),
            });
            return;
        }
        try {
            switch (event.kind) {
                case "runState": {
                    const snapshot = this.ledger.append(active.runId, {
                        type: "run.state",
                        epochMs: Date.now(),
                        runState: event.state,
                    });
                    Perf.marker(
                        "mssql.runbookStudio.run.state",
                        "instant",
                        { state: event.state },
                        active.context.traceId,
                    );
                    active.model.setActiveRun(snapshot);
                    return;
                }
                case "nodeState": {
                    if (event.output?.scalars) {
                        active.evidenceValues.set(event.nodeId, { ...event.output.scalars });
                    }
                    if (event.state === "succeeded" && event.output?.scalars) {
                        active.outputValues.set(event.nodeId, { ...event.output.scalars });
                    }
                    const outputs = event.output
                        ? [this.resultStore.put(active.runId, event.nodeId, event.output)]
                        : undefined;
                    const executedQuery = event.executedQuery
                        ? this.resultStore.put(active.runId, event.nodeId, event.executedQuery)
                        : undefined;
                    const snapshot = this.ledger.append(active.runId, {
                        type: "node.state",
                        epochMs: Date.now(),
                        nodeId: event.nodeId,
                        attempt: event.attempt,
                        nodeState: event.state,
                        ...(event.outcome ? { outcome: event.outcome } : {}),
                        ...(event.message ? { message: event.message } : {}),
                        ...(event.branchNotTaken ? { branchNotTaken: true } : {}),
                        ...(outputs ? { outputs } : {}),
                        ...(executedQuery ? { executedQuery } : {}),
                    });
                    active.model.setActiveRun(snapshot);
                    return;
                }
                case "gateRequested": {
                    Perf.marker(
                        "mssql.runbookStudio.gate.requested",
                        "instant",
                        { gateKind: "approval" },
                        active.context.traceId,
                    );
                    const approvalChallenge = buildRunbookApprovalChallenge({
                        runId: active.runId,
                        artifact: active.artifact,
                        parameterValues: active.parameterValues,
                        gateNodeId: event.nodeId,
                        nodeValues: active.outputValues,
                    });
                    if (approvalChallenge) {
                        const approval = this.approvalLedger.requestApproval(approvalChallenge);
                        active.pendingApprovals.set(event.nodeId, {
                            challenge: approvalChallenge,
                            challengeDigest: approval.challengeDigest,
                        });
                    }
                    const snapshot = this.ledger.append(active.runId, {
                        type: "gate.requested",
                        epochMs: Date.now(),
                        gate: {
                            nodeId: event.nodeId,
                            gateKind: "approval",
                            impactSummary: event.impactSummary,
                        },
                    });
                    active.model.setActiveRun(snapshot);
                    if (active.autoApproveRemaining) {
                        queueMicrotask(() => {
                            void this.respondToGate(active.model, active.runId, event.nodeId, true);
                        });
                    }
                    return;
                }
                case "gateResponded": {
                    Perf.marker(
                        "mssql.runbookStudio.gate.responded",
                        "instant",
                        { outcome: event.approved ? "approved" : "rejected" },
                        active.context.traceId,
                    );
                    const snapshot = this.ledger.append(active.runId, {
                        type: "gate.responded",
                        epochMs: Date.now(),
                        nodeId: event.nodeId,
                        outcome: event.approved ? "approved" : "rejected",
                    });
                    active.model.setActiveRun(snapshot);
                    return;
                }
                case "terminal": {
                    this.finishRun(active, event);
                    return;
                }
            }
        } catch (error) {
            // A ledger invariant violation means the boundary stream is
            // corrupt: fail the run once, keep the journal consistent.
            emitRunbookEvent(active.context, "runbookStudio.run.invariantViolation", "error", {
                errorClass: metaField(error instanceof Error ? error.name : "UnknownError"),
                eventKind: metaField(event.kind),
            });
            if (!active.runEnded) {
                this.finishRun(active, {
                    kind: "terminal",
                    state: "failed",
                    errorCode: "RunbookStudio.RuntimeProtocol",
                });
            }
        }
    }

    private finishRun(
        active: ActiveRunBinding,
        event: Extract<RuntimeBoundaryEvent, { kind: "terminal" }>,
    ): void {
        if (active.runEnded) {
            return;
        }
        active.runEnded = true;
        const endedEpochMs = Date.now();
        try {
            this.runDropStore.markTerminal(active.runId, event.state, endedEpochMs);
        } catch {
            emitRunbookEvent(active.context, "runbookStudio.runDrop.finalize", "warning", {});
        }
        let snapshot: RunbookRunSnapshot | undefined;
        try {
            snapshot = this.ledger.append(active.runId, {
                type: "run.terminal",
                epochMs: endedEpochMs,
                runState: event.state,
                ...(event.verdict ? { outcome: event.verdict } : {}),
                ...(event.runMetrics ? { runMetrics: event.runMetrics } : {}),
                ...(event.diagnosticCounts ? { diagnosticCounts: event.diagnosticCounts } : {}),
                ...(event.errorCode
                    ? {
                          error: {
                              code: asErrorCode(event.errorCode),
                              message: event.errorMessage ?? event.errorCode,
                          },
                      }
                    : {}),
            });
        } catch {
            snapshot = this.ledger.snapshotOf(active.runId);
        }
        Perf.marker(
            "mssql.runbookStudio.run.end",
            "end",
            {
                outcome: event.state,
                nodeCount: snapshot?.nodes.length ?? 0,
                cancelled: event.state === "cancelled",
            },
            active.context.traceId,
        );
        emitRunbookEvent(active.context, "runbookStudio.run.terminal", "ok", {
            outcome: metaField(event.state),
            verdict: metaField(event.verdict ?? "none"),
        });
        if (snapshot) {
            active.model.setActiveRun(snapshot);
        }
        this.activeByRunId.delete(active.runId);
        const current = this.activeByDocument.get(active.model.uriKey);
        if (current === active) {
            this.activeByDocument.delete(active.model.uriKey);
        }
        this.activeRunsEmitter.fire();
        void this.recoverOutstandingSandboxEffects(active.runId);
    }

    private onRuntimeExit(active: ActiveRunBinding, unexpected: boolean): void {
        if (!unexpected || active.runEnded) {
            return;
        }
        emitRunbookEvent(active.context, "runbookStudio.runtime.exited", "error", {
            unexpected: metaField(true),
        });
        this.finishRun(active, {
            kind: "terminal",
            state: "failed",
            errorCode: "RunbookStudio.RuntimeExited",
            errorMessage: LocRunbookStudio.runtimeExited,
        });
    }
}

function evidenceUnavailableError(): RbsError {
    return {
        code: "RunbookStudio.DataUnavailable",
        message: LocRunbookStudio.evidenceExportUnavailable,
    };
}

function outputArtifactUnavailableError(): RbsError {
    return {
        code: "RunbookStudio.DataUnavailable",
        message: LocRunbookStudio.outputArtifactUnavailable,
    };
}

function outputArtifactChangedError(): RbsError {
    return {
        code: "RunbookStudio.DataUnavailable",
        message: LocRunbookStudio.outputArtifactChanged,
    };
}

function runNotFoundError(): RbsError {
    return { code: "RunbookStudio.DataUnavailable", message: LocRunbookStudio.runNotFound };
}

function runDropUnavailableError(): RbsError {
    return { code: "RunbookStudio.DataUnavailable", message: LocRunbookStudio.runDropUnavailable };
}

// ---------------------------------------------------------------------------

function cleanupResult(
    snapshot: RunbookEffectSnapshot,
    cleanupEvidenceDigest: string,
): LocalSandboxCleanupResult {
    const databaseName = snapshot.resource?.resourceId ?? snapshot.identity.recovery?.resourceId;
    if (!databaseName) {
        throw new Error("cleaned sandbox effect is missing its resource identity");
    }
    return {
        effectId: snapshot.identity.effectId,
        leaseId: snapshot.identity.effectId,
        databaseName,
        cleaned: true,
        cleanedAtUtc: new Date(snapshot.lastUpdatedEpochMs).toISOString(),
        cleanupEvidenceDigest,
    };
}

function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === "EPERM";
    }
}

// ---------------------------------------------------------------------------

let serviceInstance: RunbookStudioService | undefined;

/** Lazy singleton (first document resolve — never activation). */
export function getRunbookStudioService(
    context: vscode.ExtensionContext,
    connectionAccess: () => ConnectionManager | undefined = () => undefined,
    dacFxAccess: () => DacFxService | undefined = () => undefined,
    schemaCompareAccess: () => SchemaCompareService | undefined = () => undefined,
): RunbookStudioService {
    if (!serviceInstance) {
        serviceInstance = new RunbookStudioService(
            context,
            connectionAccess,
            dacFxAccess,
            schemaCompareAccess,
        );
        context.subscriptions.push({
            dispose: () => {
                serviceInstance?.dispose();
                serviceInstance = undefined;
            },
        });
    }
    return serviceInstance;
}

/** Move ledger journals and sealed records from the pre-persistence
 *  workspace-scoped root into the library-global root (one-time, cheap
 *  renames; existing targets win). Results dirs did not exist before this
 *  scheme, so only ledger/ and runs/ move. Best-effort: a failed move
 *  leaves the file where it was. */
function migrateLegacyRunStorage(legacyRoot: string, persistRoot: string): number {
    if (path.resolve(legacyRoot) === path.resolve(persistRoot)) {
        return 0;
    }
    let moved = 0;
    for (const [subdir, suffix] of [
        ["ledger", ".jsonl"],
        ["runs", ".record.json"],
    ] as const) {
        const fromDir = path.join(legacyRoot, subdir);
        const toDir = path.join(persistRoot, subdir);
        let files: string[];
        try {
            files = fs.readdirSync(fromDir);
        } catch {
            continue; // No legacy directory — nothing to migrate.
        }
        for (const file of files) {
            if (!file.endsWith(suffix)) {
                continue;
            }
            const target = path.join(toDir, file);
            try {
                if (fs.existsSync(target)) {
                    continue; // The global copy is authoritative.
                }
                fs.mkdirSync(toDir, { recursive: true });
                fs.renameSync(path.join(fromDir, file), target);
                moved++;
            } catch {
                // Locked/cross-device oddity: leave in place, stay honest.
            }
        }
    }
    return moved;
}

/** Library failure -> user-facing RbsError. Typed refusals (e.g. publish
 *  translation issues) keep their precise message; anything else gets the
 *  library-unavailable shell with the technical detail attached. */
/** "New runbook" and its deduped variants ("New runbook (2)", ...) are
 *  placeholders that generation may rename (AI-chat naming model). */
function isPlaceholderRunbookName(name: string): boolean {
    const base = LocRunbookStudio.newRunbookName;
    return name === base || (name.startsWith(`${base} (`) && name.endsWith(")"));
}

async function pathExists(candidate: string): Promise<boolean> {
    try {
        await fs.promises.access(candidate, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

function modelRoleConfiguration(
    profile: { id?: string; kind?: string; label?: string },
    modelId: string,
    catalog: RbsModelOption[],
): RbsModelRoleConfiguration {
    const models = catalog.some((model) => model.id === modelId)
        ? catalog
        : catalog.concat({
              id: modelId,
              name: modelId,
              vendor: profile.kind ?? "",
              isDefault: false,
          });
    return {
        providerId: profile.id ?? "",
        providerKind: profile.kind ?? "",
        providerLabel: profile.label ?? profile.id ?? "?",
        modelId,
        models: models.slice().sort((left, right) => {
            if (left.isDefault !== right.isDefault) {
                return left.isDefault ? -1 : 1;
            }
            return (
                left.vendor.localeCompare(right.vendor, undefined, { sensitivity: "base" }) ||
                left.name.localeCompare(right.name, undefined, {
                    sensitivity: "base",
                    numeric: true,
                }) ||
                left.id.localeCompare(right.id, undefined, { sensitivity: "base" })
            );
        }),
    };
}

function modelConfigurationUnavailableError(): RbsError {
    return {
        code: "RunbookStudio.RuntimeCapabilityUnsupported",
        message: LocRunbookStudio.modelConfigUnavailable,
    };
}

function libraryError(error: unknown): RbsError {
    if (error instanceof RuntimeStartRefusedError) {
        return error.rbsError;
    }
    return {
        code: "RunbookStudio.RuntimeUnavailable",
        message: LocRunbookStudio.libraryUnavailable(
            error instanceof Error ? error.message : String(error),
        ),
        retryable: true,
    };
}

function invalidArtifactError(model: RunbookStudioDocumentModel): RbsError {
    return (
        model.artifactError ?? {
            code: "RunbookStudio.InvalidArtifact",
            message: LocRunbookStudio.invalidArtifact("no artifact"),
        }
    );
}

function asErrorCode(code: string): RbsError["code"] {
    return code.startsWith("RunbookStudio.")
        ? (code as RbsError["code"])
        : "RunbookStudio.Internal";
}

function shortDigest(value: string): string {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = (hash * 31 + value.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(16);
}

function localDacpacStageActivityError(error: unknown): LocalActivityError {
    if (error instanceof LocalDacpacStageError && error.reason === "cancelled") {
        return new LocalActivityError(
            LocRunbookStudio.dacpacPreviewCancelled,
            "RunbookStudio.ActivityCancelled",
        );
    }
    return new LocalActivityError(
        LocRunbookStudio.dacpacDeployArtifactChanged,
        "RunbookStudio.DeploymentPreviewChanged",
    );
}

function containerConnectionProfileId(effectId: string): string {
    return `runbook-container-profile:${effectId}`;
}

function localXeventSessionRef(effectId: string): string {
    return `runbook-xevent-session:${effectId}`;
}

function effectIdFromLocalXeventSessionRef(sessionRef: string): string | undefined {
    return /^runbook-xevent-session:(effect-[a-f0-9]{64})$/i.exec(sessionRef)?.[1];
}

function localXeventCaptureRef(effectId: string): string {
    return `runbook-xevent-capture:${effectId}`;
}

function effectIdFromLocalXeventCaptureRef(captureRef: string): string | undefined {
    return /^runbook-xevent-capture:(effect-[a-f0-9]{64})$/i.exec(captureRef)?.[1];
}

function readBoundedLocalArchive(
    stream: NodeJS.ReadableStream,
    maxBytes: number,
    isCancellationRequested: () => boolean,
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        let settled = false;
        const destroy = () =>
            (
                stream as NodeJS.ReadableStream & {
                    destroy?: () => void;
                }
            ).destroy?.();
        const fail = (error: unknown) => {
            if (!settled) {
                settled = true;
                clearInterval(cancelPoll);
                destroy();
                reject(error);
            }
        };
        const cancelPoll = setInterval(() => {
            if (isCancellationRequested()) {
                fail(new vscode.CancellationError());
            }
        }, 50);
        stream.on("data", (chunk: Buffer | string) => {
            if (settled) {
                return;
            }
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytes += buffer.length;
            if (bytes > maxBytes) {
                fail(new LocalXeventPolicyError("artifactTooLarge"));
                return;
            }
            chunks.push(buffer);
        });
        stream.on("error", fail);
        stream.on("end", () => {
            if (!settled) {
                settled = true;
                clearInterval(cancelPoll);
                resolve(Buffer.concat(chunks, bytes));
            }
        });
    });
}

async function resolveWorkspaceWorkloadPath(
    requestedPath: string,
    workspaceRoots: readonly string[],
): Promise<string> {
    const trimmed = requestedPath.trim();
    if (!trimmed || workspaceRoots.length === 0) {
        throw new LocalActivityError(
            LocRunbookStudio.workloadPathInvalid,
            "RunbookStudio.PathInvalid",
        );
    }
    const candidates = path.isAbsolute(trimmed)
        ? [path.resolve(trimmed)]
        : workspaceRoots.map((root) => path.resolve(root, trimmed));
    const existing: string[] = [];
    for (const candidate of candidates) {
        try {
            await fs.promises.access(candidate, fs.constants.R_OK);
            existing.push(candidate);
        } catch {
            // Try the next explicitly rooted candidate.
        }
    }
    if (existing.length !== 1) {
        throw new LocalActivityError(
            LocRunbookStudio.workloadPathInvalid,
            existing.length > 1 ? "RunbookStudio.TargetAmbiguous" : "RunbookStudio.PathInvalid",
        );
    }
    const realCandidate = await fs.promises.realpath(existing[0]);
    for (const root of workspaceRoots) {
        let realRoot: string;
        try {
            realRoot = await fs.promises.realpath(root);
        } catch {
            continue;
        }
        const relative = path.relative(realRoot, realCandidate);
        if (
            relative === "" ||
            (!relative.startsWith(`..${path.sep}`) &&
                relative !== ".." &&
                !path.isAbsolute(relative))
        ) {
            return realCandidate;
        }
    }
    throw new LocalActivityError(
        LocRunbookStudio.workloadPathInvalid,
        "RunbookStudio.TargetOutsideWorkspace",
    );
}

interface ParameterBinding {
    values: Record<string, string | number | boolean | null>;
    explicitCount: number;
    defaultCount: number;
    errors: string[];
}

/** Typed bind + validation (values never enter diagnostics). */
export function bindParameters(
    definitions: RunbookParameterDefinition[],
    provided: Record<string, string | number | boolean | null>,
): ParameterBinding {
    const values: Record<string, string | number | boolean | null> = {};
    const errors: string[] = [];
    let explicitCount = 0;
    let defaultCount = 0;
    for (const definition of definitions) {
        const raw = provided[definition.id];
        if (raw === undefined || raw === null || raw === "") {
            if (definition.default !== undefined) {
                values[definition.id] = definition.default;
                defaultCount++;
                continue;
            }
            if (definition.required) {
                errors.push(LocRunbookStudio.parameterRequired(definition.label));
            }
            continue;
        }
        explicitCount++;
        switch (definition.type) {
            case "int": {
                const parsed = typeof raw === "number" ? raw : Number(raw);
                if (!Number.isInteger(parsed)) {
                    errors.push(LocRunbookStudio.parameterNotInteger(definition.label));
                    continue;
                }
                values[definition.id] = parsed;
                break;
            }
            case "boolean": {
                values[definition.id] = raw === true || raw === "true";
                break;
            }
            case "enum": {
                if (typeof raw !== "string" || !(definition.enumValues ?? []).includes(raw)) {
                    errors.push(LocRunbookStudio.parameterNotInEnum(definition.label));
                    continue;
                }
                values[definition.id] = raw;
                break;
            }
            default: {
                values[definition.id] = raw;
                break;
            }
        }
    }
    return { values, explicitCount, defaultCount, errors };
}
