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
 * `validation` is the D2 surface: `service.validation.run(envId, opts)`
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
import { LocalFileProvider, LocalSchemaSourceReader } from "./providers";
import { LocalRunsDirectoryReader, RunArtifactReader, RunArtifactWriter, RunStore } from "./runs";
import { SchemaHasher } from "./runs/schemaHasher";
import {
    CloudDeployValidationApi,
    ConnectionError,
    ConnectionHandle,
    DockerEphemeralDatabaseProvider,
    EphemeralConnector,
    LiveArtifactProvider,
    LiveConnectionProvider,
    LiveConnectionStrategy,
    LiveDataGenerator,
    LiveProcessProvider,
    OutputChannelSubscriber,
    RunnerRuntimeDeps,
    ValidationService,
    createDefaultRegistry,
} from "./validation";
import { LiveRunSummary } from "../sharedInterfaces/cloudDeployHub";

/**
 * Run-artifact I/O surface attached to the service. The `writer` and
 * `reader` share the same `FileProvider`; the writer also shares the
 * service's diagnostic bus so success / failure events reach existing
 * subscribers automatically. `store` (D3-Part-2) is the cached projection
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
 * `mainController`) supplies `connectionStrategy` once vscode-mssql's
 * `ConnectionManager` is available; tests substitute their own. When
 * omitted, the service installs a stub strategy that throws
 * `ConnectionError("unknown")` with a clear "not configured" message —
 * connectivity validations against `Container` envs surface as
 * `Failed`, but the rest of the pipeline still functions.
 */
export interface CloudDeployServiceOptions {
    readonly connectionStrategy?: LiveConnectionStrategy;
    /**
     * Opens a connection to a freshly-provisioned ephemeral database (Scope 2,
     * decision D-C). Production wiring (in `mainController`) supplies
     * `VsCodeMssqlEphemeralConnector`; tests omit it. When omitted, the runtime
     * validators (unit tests, workload) are skipped because no ephemeral
     * database can be stood up — the rest of the pipeline still functions.
     */
    readonly ephemeralConnector?: EphemeralConnector;
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
 * Maximum number of run artifacts retained in `.mssql/runs/`. Older runs are
 * pruned by the `RunStore` on each scan so the directory does not grow without
 * bound. Resolves D3-Part-2 TBD-3 (run retention).
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

    public constructor(
        workspaceFolder: vscode.WorkspaceFolder | undefined,
        workspaceState: vscode.Memento,
        options: CloudDeployServiceOptions = {},
    ) {
        this.diagnostics = new DiagnosticEventBus();
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

        const registry = createDefaultRegistry({
            connection: new LiveConnectionProvider(
                options.connectionStrategy ?? new UnconfiguredConnectionStrategy(),
            ),
            process: new LiveProcessProvider(workspaceFolder?.uri.fsPath),
            artifact: new LiveArtifactProvider(fileProvider, workspaceFolder?.uri.fsPath),
            staticAnalysis: { systemDacpacsLocation: resolveSystemDacpacsLocation() },
        });

        // Scope 2 (decisions D-A / D-C / D-D): runtime dependencies the runner
        // uses to build, seed, and identify the per-run ephemeral database. The
        // ephemeral provider is only wired when the host supplies an
        // `ephemeralConnector` (the vscode-mssql connection stack); without one
        // there is no way to reach a provisioned database, so the runtime
        // validators skip rather than error.
        const processProvider = new LiveProcessProvider(workspaceFolder?.uri.fsPath);
        const runtime: RunnerRuntimeDeps = {
            schemaHasher: new SchemaHasher(
                new LocalSchemaSourceReader(workspaceFolder?.uri.fsPath),
            ),
            dataGenerator: new LiveDataGenerator(
                new LiveArtifactProvider(fileProvider, workspaceFolder?.uri.fsPath),
            ),
            ...(options.ephemeralConnector !== undefined
                ? {
                      ephemeralProvider: new DockerEphemeralDatabaseProvider(
                          processProvider,
                          options.ephemeralConnector,
                          { workspaceRoot: workspaceFolder?.uri.fsPath },
                      ),
                  }
                : {}),
        };

        this.validation = new ValidationService(
            registry,
            this.diagnostics,
            this.environments,
            writer,
            runtime,
        );

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
// Stub strategy for the un-wired connectivity path
// =============================================================================

/**
 * Placeholder `LiveConnectionStrategy` used when the host has not yet
 * supplied a real one. Throws `ConnectionError("unknown")` with a
 * deterministic message so the connectivity validator surfaces a `Failed`
 * result — the rest of the pipeline keeps running unimpeded.
 *
 * The real strategy (binding `vscode-mssql`'s `ConnectionManager`) lands
 * as a follow-up; the service constructor accepts an injected strategy
 * for that wiring.
 */
class UnconfiguredConnectionStrategy implements LiveConnectionStrategy {
    public async connectByProfileId(
        _profileId: string,
        _signal: AbortSignal,
    ): Promise<ConnectionHandle> {
        throw new ConnectionError(
            "unknown",
            "Live connection strategy is not configured. The Cloud Deploy validation runner cannot open a live SQL connection in this build.",
        );
    }
}
