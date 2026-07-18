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
import * as vscode from "vscode";
import { RunbookStudio as LocRunbookStudio } from "../constants/locConstants";
import { Perf } from "../perf/perfTelemetry";
import {
    RbsError,
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
import { writeStash } from "./libraryStash";
import { canonicalizeRunbookArtifact } from "./runbookArtifact";
import { RunbookLibraryAsset } from "./runbookLibraryModel";
import { RunbookRunCoordinator, OutputPageResult } from "./runbookRunCoordinator";
import { RunbookRunLedger } from "./runbookRunLedger";

import { RunbookResultStore } from "./runbookResultStore";
import { RunbookStudioDocumentModel } from "./runbookStudioDocumentModel";
import { compileIntentWithModel } from "./models/planCompiler";
import { FakeRuntimeAdapter } from "./runtime/fakeRuntimeAdapter";
import { HobbesRuntimeAdapter } from "./runtime/hobbesRuntimeAdapter";
import { LocalSqlActivityDelegate } from "./runtime/localSqlDelegate";
import { RuntimeSupervisor } from "./runtime/runtimeSupervisor";
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

const SimpleExecuteRequestType = new RequestType<
    { ownerUri: string; queryString: string },
    mssql.SimpleExecuteResult,
    void
>("query/simpleexecute");

let runCounter = 0;

function nextRunId(): string {
    runCounter++;
    return `run_${Date.now().toString(36)}_${runCounter.toString(36)}`;
}

interface ActiveRunBinding {
    runId: string;
    model: RunbookStudioDocumentModel;
    context: RunbookOperationContext;
    runEnded: boolean;
}

export class RunbookStudioService implements RunbookRunCoordinator, vscode.Disposable {
    private readonly ledger: RunbookRunLedger;
    private readonly resultStore = new RunbookResultStore();
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
    private readonly seededModels = new WeakSet<RunbookStudioDocumentModel>();
    /** runId -> trace, retained past terminal for Debug Console links. */
    private readonly traceByRunId = new Map<string, string>();

    private readonly storageRoot: string;
    /** Global (workspace-independent) storage root for the library stash. */
    private readonly globalStorageUri: vscode.Uri;

    constructor(
        context: vscode.ExtensionContext,
        /** Lazy — MainController constructs after feature registration. */
        private readonly connectionAccess: () => ConnectionManager | undefined,
    ) {
        this.storageRoot = path.join(
            (context.storageUri ?? context.globalStorageUri).fsPath,
            "runbookStudio",
        );
        this.globalStorageUri = context.globalStorageUri;
        this.ledger = new RunbookRunLedger(this.storageRoot);
    }

    public dispose(): void {
        void this.adapter?.dispose();
        if (this.hobbesAdapter && this.hobbesAdapter !== this.adapter) {
            void this.hobbesAdapter.dispose();
        }
        this.hobbesAdapter = undefined;
    }

    // -- RunbookRunCoordinator ------------------------------------------------

    public async startRun(
        model: RunbookStudioDocumentModel,
        parameterValues: Record<string, string | number | boolean | null>,
    ): Promise<{ runId?: string; error?: RbsError }> {
        this.seedHistory(model);
        const artifact = model.artifact;
        if (!artifact) {
            return { error: invalidArtifactError(model) };
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

        const adapterResult = await this.ensureAdapter(context);
        if ("error" in adapterResult) {
            return { error: adapterResult.error };
        }
        const adapter = adapterResult.adapter;

        const runId = nextRunId();
        const runContext = childRunbookContext(context, { runId });
        const active: ActiveRunBinding = { runId, model, context: runContext, runEnded: false };
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
            epochMs: Date.now(),
        });
        model.setActiveRun(accepted);

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
        const accepted = await this.adapter.respondToGate(
            runId,
            nodeId,
            approve,
            childRunbookContext(active.context, { nodeId }),
        );
        if (!accepted) {
            return {
                accepted: false,
                error: {
                    code: "RunbookStudio.ApprovalInvalid",
                    message: LocRunbookStudio.gateNotPending,
                },
            };
        }
        return { accepted: true };
    }

    public async getRun(
        _model: RunbookStudioDocumentModel,
        runId: string,
    ): Promise<RunbookRunSnapshot | undefined> {
        return this.ledger.snapshotOf(runId);
    }

    public async fetchOutputPage(
        _model: RunbookStudioDocumentModel,
        page: { handleId: string; startRow: number; rowCount: number },
    ): Promise<OutputPageResult> {
        const context = newRunbookRootContext("fetch");
        Perf.marker("mssql.runbookStudio.output.fetch.begin", "begin", undefined, context.traceId);
        const result = this.resultStore.fetchPage(page.handleId, page.startRow, page.rowCount);
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

    public traceIdOf(runId: string): string | undefined {
        return this.traceByRunId.get(runId);
    }

    /** Intent -> catalog-constrained compiled plan, written into the
     *  document via WorkspaceEdit (dirty/undo-safe). */
    public async compileIntent(
        model: RunbookStudioDocumentModel,
        intent: string,
    ): Promise<{ ok: boolean; error?: RbsError }> {
        const base = model.artifact;
        if (!base) {
            return { ok: false, error: invalidArtifactError(model) };
        }
        const context = newRunbookRootContext("compile");
        const result = await compileIntentWithModel(base, intent, context);
        if (result.error || !result.artifact) {
            return { ok: false, ...(result.error ? { error: result.error } : {}) };
        }
        const applied = await model.applyArtifactEdit(result.artifact);
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

    /** Seed a model's history from the durable ledger once per model. */
    private seedHistory(model: RunbookStudioDocumentModel): void {
        if (this.seededModels.has(model) || !model.artifact) {
            return;
        }
        this.seededModels.add(model);
        const entries = this.ledger.listRuns(model.artifact.id);
        if (entries.length > 0) {
            model.seedHistory(entries);
        }
    }

    private async ensureAdapter(
        context: RunbookOperationContext,
    ): Promise<{ adapter: RunbookRuntimeAdapter } | { error: RbsError }> {
        const runtimeKind = vscode.workspace
            .getConfiguration()
            .get<string>("mssql.runbookStudio.runtime", "local");
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
                    connect: async (profileId, ownerUri) => {
                        const connectionManager = this.connectionAccess();
                        if (!connectionManager) {
                            return false;
                        }
                        const profiles =
                            await connectionManager.connectionStore.readAllConnections(false);
                        const profile = profiles.find((p) => p.id === profileId);
                        if (!profile) {
                            throw new Error(LocRunbookStudio.connectionProfileNotFound(profileId));
                        }
                        return connectionManager.connect(ownerUri, profile, {
                            connectionSource: "runbookStudio",
                        });
                    },
                    execute: (ownerUri, queryString) =>
                        Promise.resolve(
                            SqlToolsServerClient.instance.sendRequest(SimpleExecuteRequestType, {
                                ownerUri,
                                queryString,
                            }),
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
                    const outputs = event.output
                        ? [this.resultStore.put(active.runId, event.nodeId, event.output)]
                        : undefined;
                    const snapshot = this.ledger.append(active.runId, {
                        type: "node.state",
                        epochMs: Date.now(),
                        nodeId: event.nodeId,
                        attempt: event.attempt,
                        nodeState: event.state,
                        ...(event.outcome ? { outcome: event.outcome } : {}),
                        ...(event.message ? { message: event.message } : {}),
                        ...(outputs ? { outputs } : {}),
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
        let snapshot: RunbookRunSnapshot | undefined;
        try {
            snapshot = this.ledger.append(active.runId, {
                type: "run.terminal",
                epochMs: Date.now(),
                runState: event.state,
                ...(event.verdict ? { outcome: event.verdict } : {}),
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

// ---------------------------------------------------------------------------

let serviceInstance: RunbookStudioService | undefined;

/** Lazy singleton (first document resolve — never activation). */
export function getRunbookStudioService(
    context: vscode.ExtensionContext,
    connectionAccess: () => ConnectionManager | undefined = () => undefined,
): RunbookStudioService {
    if (!serviceInstance) {
        serviceInstance = new RunbookStudioService(context, connectionAccess);
        context.subscriptions.push({
            dispose: () => {
                serviceInstance?.dispose();
                serviceInstance = undefined;
            },
        });
    }
    return serviceInstance;
}

/** Library failure -> user-facing RbsError. Typed refusals (e.g. publish
 *  translation issues) keep their precise message; anything else gets the
 *  library-unavailable shell with the technical detail attached. */
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
