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

import { DiagnosticEventBus } from "./diagnostics";
import { EnvironmentStore } from "./environments/environmentStore";
import { LocalFileProvider } from "./providers";
import { RunArtifactReader, RunArtifactWriter } from "./runs";
import {
    CloudDeployValidationApi,
    ConnectionError,
    ConnectionHandle,
    LiveArtifactProvider,
    LiveConnectionProvider,
    LiveConnectionStrategy,
    LiveProcessProvider,
    OutputChannelSubscriber,
    ValidationService,
    createDefaultRegistry,
} from "./validation";

/**
 * Run-artifact I/O surface attached to the service. Both members share the
 * same `FileProvider`; the writer also shares the service's diagnostic bus
 * so success / failure events reach existing subscribers automatically.
 */
export interface CloudDeployRunsApi {
    readonly writer: RunArtifactWriter;
    readonly reader: RunArtifactReader;
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
}

const OUTPUT_CHANNEL_NAME = "Cloud Deploy";

export class CloudDeployService implements vscode.Disposable {
    public readonly diagnostics: DiagnosticEventBus;
    public readonly environments: EnvironmentStore | undefined;
    public readonly runs: CloudDeployRunsApi;
    public readonly validation: CloudDeployValidationApi;
    public readonly outputChannel: vscode.OutputChannel;

    private readonly _outputSubscriber: OutputChannelSubscriber;

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
        this.runs = {
            writer,
            reader: new RunArtifactReader(fileProvider),
        };

        const registry = createDefaultRegistry({
            connection: new LiveConnectionProvider(
                options.connectionStrategy ?? new UnconfiguredConnectionStrategy(),
            ),
            process: new LiveProcessProvider(),
            artifact: new LiveArtifactProvider(fileProvider),
        });
        this.validation = new ValidationService(
            registry,
            this.diagnostics,
            this.environments,
            writer,
        );

        this.outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
        this._outputSubscriber = new OutputChannelSubscriber(this.outputChannel, this.diagnostics);
    }

    /** Loads on-disk state. Safe to call when no folder is open (resolves immediately). */
    public async init(): Promise<void> {
        if (this.environments !== undefined) {
            await this.environments.init();
        }
    }

    public dispose(): void {
        // Dispose subsystems first so any final emissions still reach subscribers.
        this.environments?.dispose();
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
