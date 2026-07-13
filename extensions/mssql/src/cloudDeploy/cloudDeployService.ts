/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — service entry point.
 *
 * Single seam between cloudDeploy internals and the rest of the extension.
 * Commands, MCP tools, and webviews all reach the env model (and future
 * subsystems: validations, publishing, etc.) through this object.
 *
 * `environments` is `undefined` when no workspace folder is open — Cloud
 * Deploy is a folder-scoped feature, so the rest of the extension still works
 * without it. `diagnostics` and `runs` are always present; run artifacts
 * live at absolute paths, not under `.mssql/`, so they don't depend on a
 * workspace folder to be readable or writable.
 *
 * `validation` is the validation surface: `service.validation.run(envId, opts)`
 * dispatches every enabled validation declared on the env and returns the
 * produced `RunRecord`. The service owns the registry, the runner, and
 * the output channel subscription so callers don't reconstruct any of it
 * per call.
 */

import * as vscode from "vscode";

import * as path from "path";

import * as Constants from "../constants/constants";
import { DiagnosticEventBus } from "./diagnostics";
import { EnvironmentStore } from "./environments/environmentStore";
import { SourceOfTruthKind, ValidationType } from "./environments/types";
import { LocalFileProvider, LocalSchemaSourceReader } from "./providers";
import {
    LocalRunsDirectoryReader,
    RunArtifactReader,
    RunArtifactWriter,
    RunStore,
    selectBaselineRun,
    type BaselineCandidate,
} from "./runs";
import { SchemaHasher } from "./runs/schemaHasher";
import type {
    WorkloadObservedStep,
    WorkloadPlaybackPayload,
    WorkloadSimulationPayload,
} from "./runs/types";
import {
    CloudDeployValidationApi,
    ConnectionEphemeralDatabaseProvider,
    ConnectionHostGateway,
    DispatchingEphemeralDatabaseProvider,
    DockerEphemeralDatabaseProvider,
    EphemeralConnector,
    EphemeralDatabaseProvider,
    LiveArtifactProvider,
    LiveDataGenerator,
    LiveProcessProvider,
    OutputChannelSubscriber,
    ProcessProvider,
    RunnerRuntimeDeps,
    ValidationService,
    createDefaultRegistry,
} from "./validation";
import { LiveRunSummary } from "../sharedInterfaces/cloudDeployHub";
import {
    DacpacDecomposer,
    SchemaSyncOptions,
    SchemaSyncResult,
    findEnclosingSqlProject,
    syncSchemaProject,
} from "./validation/providers/schemaSync";

/**
 * Run-artifact I/O surface attached to the service. The `writer` and
 * `reader` share the same `FileProvider`; the writer also shares the
 * service's diagnostic bus so success / failure events reach existing
 * subscribers automatically. `store` is the cached projection
 * the dashboard tree provider and hub webview consume; it is `undefined`
 * when no workspace folder is open (the runs directory is workspace-scoped).
 */
export interface CloudDeployRunsApi {
    readonly writer: RunArtifactWriter;
    readonly reader: RunArtifactReader;
    readonly store: RunStore | undefined;
    readonly runsDirectory: string | undefined;
}

/**
 * Optional per-construction injection points. Production wiring (in
 * `mainController`) supplies `ephemeralConnector` once vscode-mssql's
 * `ConnectionManager` is available; tests substitute their own or omit it.
 */
export interface CloudDeployServiceOptions {
    /**
     * Opens a connection to a freshly-provisioned ephemeral database.
     * Production wiring (in `mainController`) supplies
     * `VsCodeMssqlEphemeralConnector`; tests omit it. When omitted, the runtime
     * validators (unit tests, workload) are skipped because no ephemeral
     * database can be stood up — the rest of the pipeline still functions.
     */
    readonly ephemeralConnector?: EphemeralConnector;

    /**
     * Host glue for the `connection` runtime host: borrow an existing
     * SQL engine reached by a saved connection profile to stand up the throwaway
     * database, instead of a tool-managed Docker container. Production wiring
     * (in `mainController`) supplies `VsCodeMssqlConnectionHostGateway`; tests
     * and the Docker-only path omit it (a run that asks for the `connection`
     * host without it surfaces a clear provisioning error). The same gateway
     * also resolves a live-database source of truth's connection string.
     */
    readonly connectionHostGateway?: ConnectionHostGateway;
}

const OUTPUT_CHANNEL_NAME = "Cloud Deploy";

/**
 * Resolves the sql-database-projects `BuildDirectory` so the static-analysis
 * build can locate the bundled system dacpacs (`master`, `msdb`) that projects
 * with system-database references need. Best-effort: returns `undefined` when
 * the projects extension is not installed, in which case the build runs
 * without a `SystemDacpacsLocation` (projects without system references still
 * build and analyze cleanly).
 */
function resolveSystemDacpacsLocation(): string | undefined {
    const extensionPath = vscode.extensions.getExtension(
        Constants.sqlDatabaseProjectsExtensionId,
    )?.extensionPath;
    return extensionPath === undefined
        ? undefined
        : path.join(extensionPath, Constants.buildDirectory);
}

/**
 * Builds the runtime-host-dispatching `EphemeralDatabaseProvider`:
 * `docker` always available (tool-managed container), `connection` available
 * only when the host gateway is wired (borrow an existing SQL engine). The
 * live-database source-of-truth resolver is derived from the same gateway and
 * shared by both hosts, so a `connection` source works regardless of where the
 * throwaway database is stood up.
 */
function buildEphemeralProvider(
    processes: ProcessProvider,
    ephemeralConnector: EphemeralConnector,
    connectionHostGateway: ConnectionHostGateway | undefined,
    workspaceRoot: string | undefined,
): EphemeralDatabaseProvider {
    const sourceConnectionStringResolver =
        connectionHostGateway !== undefined
            ? (id: string, signal: AbortSignal) =>
                  connectionHostGateway.buildConnectionString(id, undefined, signal)
            : undefined;

    const docker = new DockerEphemeralDatabaseProvider(processes, ephemeralConnector, {
        workspaceRoot,
        ...(sourceConnectionStringResolver !== undefined ? { sourceConnectionStringResolver } : {}),
    });

    const connection =
        connectionHostGateway !== undefined
            ? new ConnectionEphemeralDatabaseProvider(processes, connectionHostGateway, {
                  workspaceRoot,
                  ...(sourceConnectionStringResolver !== undefined
                      ? { sourceConnectionStringResolver }
                      : {}),
              })
            : undefined;

    return new DispatchingEphemeralDatabaseProvider({ docker, connection });
}

/**
 * Maximum number of run artifacts retained in `.mssql/runs/`. Older runs are
 * pruned by the `RunStore` on each scan so the directory does not grow without
 * bound.
 */
const DEFAULT_RUN_RETENTION = 50;

export class CloudDeployService implements vscode.Disposable {
    public readonly diagnostics: DiagnosticEventBus;
    public readonly environments: EnvironmentStore | undefined;
    public readonly runs: CloudDeployRunsApi;
    public readonly validation: CloudDeployValidationApi;
    public readonly outputChannel: vscode.OutputChannel;

    private readonly _outputSubscriber: OutputChannelSubscriber;
    private readonly _runStore: RunStore | undefined;
    private readonly _runsWatcher: vscode.FileSystemWatcher | undefined;
    private _runsScanDebounce: NodeJS.Timeout | undefined;
    /**
     * In-flight runs, tracked for the service's whole lifetime so the hub can
     * show the "currently running" banner even when it is opened AFTER a run
     * started (the hub's own bus subscription only catches events emitted while
     * it is open). Keyed by runId; populated on `validation-run-started`, pruned
     * on `validation-run-finished`.
     */
    private readonly _activeRuns = new Map<string, LiveRunSummary>();
    private readonly _activeRunsSubscriptions: vscode.Disposable[] = [];

    /** Workspace root used to resolve relative sync paths; `undefined` with no folder open. */
    private readonly _workspaceRoot: string | undefined;
    /** Resolves a saved connection profile to a connection string, for syncing a live-DB source. */
    private readonly _sourceConnectionStringResolver:
        | ((id: string, signal: AbortSignal) => Promise<string>)
        | undefined;
    /** Publishes a dacpac to a throwaway database so it can be decomposed; wired when able. */
    private _dacpacDecomposer: DacpacDecomposer | undefined = undefined;

    public constructor(
        workspaceFolder: vscode.WorkspaceFolder | undefined,
        workspaceState: vscode.Memento,
        options: CloudDeployServiceOptions = {},
    ) {
        this.diagnostics = new DiagnosticEventBus();
        this._workspaceRoot = workspaceFolder?.uri.fsPath;
        const connectionGateway = options.connectionHostGateway;
        this._sourceConnectionStringResolver =
            connectionGateway !== undefined
                ? (id: string, signal: AbortSignal) =>
                      connectionGateway.buildConnectionString(id, undefined, signal)
                : undefined;
        // Decompose a dacpac source by publishing it to a throwaway container and
        // extracting that; needs the tool-managed Docker provider, so it is only
        // available when an ephemeral connector is wired.
        const decomposeConnector = options.ephemeralConnector;
        if (decomposeConnector !== undefined) {
            const decomposeProvider = new DockerEphemeralDatabaseProvider(
                new LiveProcessProvider(this._workspaceRoot),
                decomposeConnector,
                { workspaceRoot: this._workspaceRoot },
            );
            this._dacpacDecomposer = (dacpacPath, signal) =>
                decomposeProvider.provisionForDecompose(dacpacPath, signal);
        }
        if (workspaceFolder !== undefined) {
            this.environments = new EnvironmentStore(
                workspaceFolder,
                workspaceState,
                this.diagnostics,
            );
        }
        const fileProvider = new LocalFileProvider();
        const writer = new RunArtifactWriter(fileProvider, this.diagnostics);
        const reader = new RunArtifactReader(fileProvider);

        let runsDirectory: string | undefined;
        if (workspaceFolder !== undefined) {
            runsDirectory = path.join(workspaceFolder.uri.fsPath, ".mssql", "runs");
            this._runStore = new RunStore(new LocalRunsDirectoryReader(runsDirectory), reader, {
                maxRuns: DEFAULT_RUN_RETENTION,
            });
            const pattern = new vscode.RelativePattern(workspaceFolder, ".mssql/runs/*.cdrun.zip");
            this._runsWatcher = vscode.workspace.createFileSystemWatcher(pattern);
            this._runsWatcher.onDidCreate(() => this._scheduleScan());
            this._runsWatcher.onDidChange(() => this._scheduleScan());
            this._runsWatcher.onDidDelete(() => this._scheduleScan());
        }
        this.runs = {
            writer,
            reader,
            store: this._runStore,
            runsDirectory,
        };

        const workloadSimEngine = (():
            | { pythonCommand: string; sqlpysimPath: string }
            | undefined => {
            const cfg = vscode.workspace.getConfiguration("mssql");
            const sqlpysimPath = cfg.get<string>("cloudDeploy.workloadSimulation.sqlpysimPath");
            if (sqlpysimPath === undefined || sqlpysimPath.length === 0) {
                return undefined;
            }
            const pythonCommand =
                cfg.get<string>("cloudDeploy.workloadSimulation.pythonPath") ?? "python";
            return { pythonCommand, sqlpysimPath };
        })();
        const registry = createDefaultRegistry({
            process: new LiveProcessProvider(workspaceFolder?.uri.fsPath),
            artifact: new LiveArtifactProvider(fileProvider, workspaceFolder?.uri.fsPath),
            staticAnalysis: { systemDacpacsLocation: resolveSystemDacpacsLocation() },
            ...(workloadSimEngine !== undefined ? { workloadSimulation: workloadSimEngine } : {}),
            ...(workspaceFolder?.uri.fsPath !== undefined
                ? { workspaceRoot: workspaceFolder.uri.fsPath }
                : {}),
        });

        // Runtime dependencies the runner
        // uses to build, seed, and identify the per-run ephemeral database. The
        // ephemeral provider is only wired when the host supplies an
        // `ephemeralConnector` (the vscode-mssql connection stack); without one
        // there is no way to reach a provisioned database, so the runtime
        // validators skip rather than error.
        const processProvider = new LiveProcessProvider(workspaceFolder?.uri.fsPath);
        const runStore = this._runStore;
        const runtime: RunnerRuntimeDeps = {
            schemaHasher: new SchemaHasher(
                new LocalSchemaSourceReader(workspaceFolder?.uri.fsPath),
            ),
            dataGenerator: new LiveDataGenerator(
                new LiveArtifactProvider(fileProvider, workspaceFolder?.uri.fsPath),
            ),
            ...(runStore !== undefined
                ? { workloadBaselineLookup: makeWorkloadBaselineLookup(runStore) }
                : {}),
            ...(options.ephemeralConnector !== undefined
                ? {
                      ephemeralProvider: buildEphemeralProvider(
                          processProvider,
                          options.ephemeralConnector,
                          options.connectionHostGateway,
                          workspaceFolder?.uri.fsPath,
                      ),
                  }
                : {}),
        };

        const validationService = new ValidationService(
            registry,
            this.diagnostics,
            this.environments,
            writer,
            runtime,
        );
        // Auto-sync a shadow (DB/dacpac-authored) env's committed sqlproj from its
        // source BEFORE validating, so EVERY validate path — command, tree, and
        // the agent tool (all funnel through here) — reflects the current source.
        // Best-effort and local-only (the CLI never uses this service): a sync
        // failure logs and falls back to validating the committed project.
        this.validation = {
            run: async (envId, opts) => {
                try {
                    await this.syncSchema(envId, {
                        signal: opts?.signal ?? new AbortController().signal,
                    });
                } catch (err) {
                    this.outputChannel.appendLine(
                        `[cloud-deploy] auto-sync before validation failed; validating the committed project. ${
                            err instanceof Error ? err.message : String(err)
                        }`,
                    );
                }
                return validationService.run(envId, opts);
            },
        };

        this.outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
        this._outputSubscriber = new OutputChannelSubscriber(this.outputChannel, this.diagnostics);

        // Track in-flight runs for the service lifetime so a hub opened mid-run
        // still shows the "currently running" banner (see `_activeRuns`).
        this._activeRunsSubscriptions.push(
            this.diagnostics.on("validation-run-started", (event) => {
                this._activeRuns.set(event.payload.runId, {
                    runId: event.payload.runId,
                    environmentId: event.payload.environmentId,
                    environmentName: this.environments?.get(event.payload.environmentId)?.name,
                    startedAtMs: event.timestampMs,
                });
            }),
        );
        this._activeRunsSubscriptions.push(
            this.diagnostics.on("validation-run-finished", (event) => {
                this._activeRuns.delete(event.payload.runId);
            }),
        );
    }

    /**
     * Snapshot of the runs currently executing, newest first. The hub seeds its
     * "currently running" banner from this on open so a run that started before
     * the hub was opened is still shown.
     */
    public getActiveRuns(): readonly LiveRunSummary[] {
        return [...this._activeRuns.values()].sort((a, b) => b.startedAtMs - a.startedAtMs);
    }

    /**
     * Syncs a shadow (DB/dacpac-authored) environment's source into its committed
     * `.sqlproj` at `projectPath`, regenerating the tree deterministically.
     * Returns `undefined` when the environment is not a shadow source with a
     * `projectPath` (nothing to sync); throws when the source cannot be reached
     * or decomposed. Local/dev-side only — CI validates the committed sqlproj.
     */
    public async syncSchema(
        envId: string,
        opts: { readonly signal: AbortSignal },
    ): Promise<SchemaSyncResult | undefined> {
        const env = this.environments?.get(envId);
        if (env === undefined) {
            throw new Error(`Environment "${envId}" was not found.`);
        }
        const sot = env.sourceOfTruth;
        if (sot.kind !== SourceOfTruthKind.Shadow || sot.projectPath === undefined) {
            return undefined;
        }
        const syncOptions: SchemaSyncOptions = {
            workspaceRoot: this._workspaceRoot,
            ...(this._sourceConnectionStringResolver !== undefined
                ? { sourceConnectionStringResolver: this._sourceConnectionStringResolver }
                : {}),
            ...(this._dacpacDecomposer !== undefined
                ? { dacpacDecomposer: this._dacpacDecomposer }
                : {}),
        };
        const result = await syncSchemaProject(
            { source: sot.source, projectPath: sot.projectPath },
            new LiveProcessProvider(this._workspaceRoot),
            syncOptions,
            opts.signal,
        );
        // Guardrail: an SDK-style .sqlproj recursively globs every .sql beneath
        // its own folder. If this shadow project was written inside another
        // project's folder, that project absorbs the generated tree and fails to
        // build with duplicate-object errors. Warn with the actionable fix; the
        // sync itself still succeeded, so this never blocks the caller.
        const enclosingProject = await findEnclosingSqlProject(
            result.projectDir,
            this._workspaceRoot,
        );
        if (enclosingProject !== undefined) {
            this.outputChannel.appendLine(
                `[cloud-deploy] Warning: the synced shadow project at "${result.projectDir}" sits inside the folder of another SQL project ("${enclosingProject}"). SDK-style projects include every .sql file beneath their folder, so that project will absorb the generated shadow files and fail to build with duplicate-object errors. Move this environment's projectPath outside that project's folder, or exclude the shadow folder there (for example <Build Remove="<shadow-folder>\\**" />).`,
            );
        }
        return result;
    }

    /** Loads on-disk state. Safe to call when no folder is open (resolves immediately). */
    public async init(): Promise<void> {
        if (this.environments !== undefined) {
            await this.environments.init();
        }
        if (this._runStore !== undefined) {
            // Best-effort: a corrupt artifact must never block extension
            // activation. The store already swallows per-file errors; the
            // catch here is defense in depth against an unexpected
            // directory-level failure.
            try {
                await this._runStore.scan();
            } catch {
                // intentionally ignored
            }
        }
    }

    /**
     * Debounced rescan triggered by the `.mssql/runs/*.cdrun.zip` watcher.
     * Coalesces bursty writer events (writer emits during validation; the
     * watcher fires twice for a temp+rename atomic write) into a single
     * scan so the tree provider doesn't repaint mid-write.
     */
    private _scheduleScan(): void {
        if (this._runStore === undefined) {
            return;
        }
        if (this._runsScanDebounce !== undefined) {
            clearTimeout(this._runsScanDebounce);
        }
        this._runsScanDebounce = setTimeout(() => {
            this._runsScanDebounce = undefined;
            void this._runStore?.scan();
        }, 300);
    }

    public dispose(): void {
        // Dispose subsystems first so any final emissions still reach subscribers.
        if (this._runsScanDebounce !== undefined) {
            clearTimeout(this._runsScanDebounce);
            this._runsScanDebounce = undefined;
        }
        this._runsWatcher?.dispose();
        this._runStore?.dispose();
        this.environments?.dispose();
        this._activeRunsSubscriptions.forEach((s) => s.dispose());
        this._outputSubscriber.dispose();
        this.outputChannel.dispose();
        this.diagnostics.dispose();
    }
}

// =============================================================================
// Run-based workload baseline lookup
// =============================================================================

/**
 * Builds the runner's `workloadBaselineLookup` over a
 * `RunStore`. Given the current run's environment id and schema hash, it picks
 * the most-recent earlier run of that environment whose schema differed
 * (`selectBaselineRun`) and returns that run's measured workload steps. The
 * workload validator compares its fresh measurements against these to flag
 * regressions. Returns `undefined` when there is no comparable predecessor or
 * the chosen baseline run recorded no workload steps.
 */
function makeWorkloadBaselineLookup(
    runStore: RunStore,
): (
    envId: string,
    currentSourceVersionHash: string | undefined,
) => Promise<readonly WorkloadObservedStep[] | undefined> {
    return async (envId, currentSourceVersionHash) => {
        if (currentSourceVersionHash === undefined) {
            return undefined;
        }
        const history: BaselineCandidate[] = runStore.list(envId).map((entry) => ({
            runId: entry.runId,
            startedAtMs: entry.startedAtMs,
            sourceVersionHash: entry.sourceVersionHash,
        }));
        // Synthesize a "current" candidate that is later than all history so
        // `selectBaselineRun` reduces to "most recent prior run with a different
        // hash". The run is not yet persisted, so it is absent from history.
        const baseline = selectBaselineRun(
            {
                runId: "__pending__",
                startedAtMs: Number.MAX_SAFE_INTEGER,
                sourceVersionHash: currentSourceVersionHash,
            },
            history,
        );
        if (baseline === undefined) {
            return undefined;
        }
        const record = await runStore.get(baseline.runId);
        if (record === undefined) {
            return undefined;
        }
        // Merge the recorded workload steps from BOTH workload validators:
        // playback steps carry the spec step ids, the simulation step carries id
        // "workload". Each validator later selects its own steps by id, so a run
        // that enabled both contributes a baseline for both.
        const steps: WorkloadObservedStep[] = [];
        const playback = record.validations.find(
            (v) => v.validationId === ValidationType.WorkloadPlayback,
        );
        const playbackSteps = (playback?.payload as WorkloadPlaybackPayload | undefined)
            ?.observedSteps;
        if (playbackSteps !== undefined) {
            steps.push(...playbackSteps);
        }
        const simulation = record.validations.find(
            (v) => v.validationId === ValidationType.WorkloadSimulation,
        );
        const simulationSteps = (simulation?.payload as WorkloadSimulationPayload | undefined)
            ?.observedSteps;
        if (simulationSteps !== undefined) {
            steps.push(...simulationSteps);
        }
        return steps.length > 0 ? steps : undefined;
    };
}
