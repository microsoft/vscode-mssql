/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy Hub controller (D3-Part-2 commit 3).
 *
 * Owns the single shared `vscode.WebviewPanel` that renders the Cloud Deploy
 * dashboard. Subscribes to `EnvironmentStore.onDidChangeEnvironments` and
 * `RunStore.onDidChange` so the React app sees a fresh snapshot whenever
 * either source mutates. Reducers translate user actions (navigate, refresh,
 * reveal-artifact) into state mutations and host-side side effects.
 *
 * Lifecycle:
 *   * `getOrCreate(...)` returns the existing panel (revealed) or constructs
 *     a new one. The panel is a singleton — opening Dev then Prod from the
 *     tree does not pile up two panels.
 *   * Disposing the panel (user closes the tab) clears the singleton, so
 *     the next `getOrCreate` opens a fresh instance.
 */

import * as vscode from "vscode";

import { CloudDeployDashboard } from "../../constants/locConstants";
import {
    CloudDeployHubReducers,
    CloudDeployHubState,
    EnvironmentSummary,
    HubPage,
    LiveRunSummary,
} from "../../sharedInterfaces/cloudDeployHub";
import { DiagnosticEventBus } from "../diagnostics/eventBus";
import { Environment } from "../environments/types";
import { EnvironmentStore } from "../environments/environmentStore";
import { RunListEntry, RunRecord } from "../runs/types";
import { RunStore } from "../runs/runStore";
import { WebviewPanelController } from "../../controllers/webviewPanelController";
import VscodeWrapper from "../../controllers/vscodeWrapper";

// =============================================================================
// Constants
// =============================================================================

/** Bundle entry-point name (must match `scripts/bundle-webviews.js`). */
const HUB_SOURCE_FILE = "cloudDeployHub";

/** Telemetry / logging id. */
const HUB_VIEW_ID = "CloudDeployHub";

// =============================================================================
// Initial-page request
// =============================================================================

/** Page the hub should land on when first opened. */
export type HubInitialView =
    | { readonly kind: "runList" }
    | { readonly kind: "environment"; readonly envId: string }
    | { readonly kind: "run"; readonly runId: string };

// =============================================================================
// Controller
// =============================================================================

export class CloudDeployHubController extends WebviewPanelController<
    CloudDeployHubState,
    CloudDeployHubReducers
> {
    /** Singleton instance. Cleared on panel dispose. */
    private static _current: CloudDeployHubController | undefined;

    private readonly _storeSubscriptions: vscode.Disposable[] = [];

    private constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private readonly _environments: EnvironmentStore | undefined,
        private readonly _runStore: RunStore | undefined,
        private readonly _diagnostics: DiagnosticEventBus | undefined,
        initialView: HubInitialView,
    ) {
        super(
            context,
            vscodeWrapper,
            HUB_SOURCE_FILE,
            HUB_VIEW_ID,
            buildInitialState(_environments, _runStore, initialView),
            {
                title: CloudDeployDashboard.viewTitle,
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "objectTypes",
                        "Queue.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "objectTypes",
                        "Queue.svg",
                    ),
                },
            },
        );

        this._registerReducers();
        this._subscribeToStores();

        // When the panel is disposed (close button), clear the singleton so
        // the next openHub call opens a fresh one.
        this._storeSubscriptions.push(
            this.panel.onDidDispose(() => {
                if (CloudDeployHubController._current === this) {
                    CloudDeployHubController._current = undefined;
                }
                this._disposeSubscriptions();
            }),
        );
    }

    // -------------------------------------------------------------------------
    // Static factory + singleton helpers
    // -------------------------------------------------------------------------

    /**
     * Opens the hub, or reveals the existing panel and navigates it. Idempotent:
     * calling twice with the same view is a no-op past the first reveal.
     */
    public static getOrCreate(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        environments: EnvironmentStore | undefined,
        runStore: RunStore | undefined,
        diagnostics: DiagnosticEventBus | undefined,
        initialView: HubInitialView,
    ): CloudDeployHubController {
        if (CloudDeployHubController._current !== undefined) {
            const existing = CloudDeployHubController._current;
            existing.revealToForeground();
            void existing._navigateInternal(initialViewToReducerPayload(initialView));
            return existing;
        }
        const created = new CloudDeployHubController(
            context,
            vscodeWrapper,
            environments,
            runStore,
            diagnostics,
            initialView,
        );
        CloudDeployHubController._current = created;
        // The run page needs the full RunRecord, which buildInitialState
        // cannot hydrate synchronously. Kick off the navigate flow so
        // `selectedRun` is populated before the React side mounts.
        if (initialView.kind === "run") {
            void created._navigateInternal(initialViewToReducerPayload(initialView));
        }
        return created;
    }

    /** Test hook: clears the singleton so a new instance can be created. */
    public static resetSingletonForTests(): void {
        CloudDeployHubController._current = undefined;
    }

    // -------------------------------------------------------------------------
    // Reducer registration
    // -------------------------------------------------------------------------

    private _registerReducers(): void {
        this.registerReducer("navigate", async (_state, payload) => {
            return await this._computeNavigationState(payload);
        });

        this.registerReducer("refresh", async (state) => {
            try {
                await this._runStore?.scan();
            } catch {
                // RunStore.scan never throws on missing dir; any other failure
                // is logged on the diagnostic bus already.
            }
            return this._withFreshSnapshots(state);
        });

        this.registerReducer("revealArtifact", async (state, payload) => {
            const entry = this._runStore?.list().find((e) => e.runId === payload.runId);
            if (entry !== undefined) {
                await vscode.commands.executeCommand(
                    "revealFileInOS",
                    vscode.Uri.file(entry.artifactPath),
                );
            }
            return state;
        });

        this.registerReducer("deleteRun", async (state, payload) => {
            const runId = payload.runId;
            if (runId === undefined || runId.length === 0 || this._runStore === undefined) {
                return state;
            }
            const confirm = await vscode.window.showWarningMessage(
                CloudDeployDashboard.deleteRunConfirmPrompt(runId.slice(0, 8)),
                { modal: true },
                CloudDeployDashboard.deleteRunConfirmAction,
            );
            if (confirm !== CloudDeployDashboard.deleteRunConfirmAction) {
                return state;
            }
            try {
                await this._runStore.delete(runId);
            } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                return {
                    ...this._withFreshSnapshots(state),
                    errorMessage: CloudDeployDashboard.deleteRunFailed(reason),
                };
            }
            // Navigate back to the runList; the store fired onDidChange so
            // _withFreshSnapshots already pulls the new run list.
            return {
                ...this._withFreshSnapshots(state),
                currentPage: "runList",
                selectedEnvId: undefined,
                selectedRunId: undefined,
                selectedEnvironment: undefined,
                selectedRun: undefined,
                selectedRunArtifactPath: undefined,
                errorMessage: undefined,
            };
        });
    }

    // -------------------------------------------------------------------------
    // Store subscriptions
    // -------------------------------------------------------------------------

    private _subscribeToStores(): void {
        if (this._environments !== undefined) {
            this._storeSubscriptions.push(
                this._environments.onDidChangeEnvironments(() => {
                    this.state = this._withFreshSnapshots(this.state);
                }),
            );
        }
        if (this._runStore !== undefined) {
            this._storeSubscriptions.push(
                this._runStore.onDidChange(() => {
                    this.state = this._withFreshSnapshots(this.state);
                }),
            );
        }
        if (this._diagnostics !== undefined) {
            this._storeSubscriptions.push(
                this._diagnostics.on("validation-run-started", (event) => {
                    const envId = event.payload.environmentId;
                    const envName = this._environments?.get(envId)?.name;
                    const liveRun: LiveRunSummary = {
                        runId: event.payload.runId,
                        environmentId: envId,
                        environmentName: envName,
                        startedAtMs: event.timestampMs,
                    };
                    this.state = {
                        ...this.state,
                        liveRuns: dedupeLiveRuns([...this.state.liveRuns, liveRun]),
                    };
                }),
            );
            this._storeSubscriptions.push(
                this._diagnostics.on("validation-run-finished", (event) => {
                    this.state = {
                        ...this.state,
                        liveRuns: this.state.liveRuns.filter(
                            (r) => r.runId !== event.payload.runId,
                        ),
                    };
                }),
            );
            this._storeSubscriptions.push(
                this._diagnostics.on("run-persisted", (event) => {
                    this.state = {
                        ...this.state,
                        liveRuns: this.state.liveRuns.filter(
                            (r) => r.runId !== event.payload.runId,
                        ),
                    };
                }),
            );
        }
    }

    // -------------------------------------------------------------------------
    // State helpers
    // -------------------------------------------------------------------------

    /**
     * Returns a copy of `state` with the env and run lists re-pulled from
     * the stores. Re-hydrates the selected env / run if the user is on a
     * detail page, so external mutations are reflected immediately.
     */
    private _withFreshSnapshots(state: CloudDeployHubState): CloudDeployHubState {
        const environments = listEnvironmentSummaries(this._environments);
        const runs = this._runStore?.list() ?? [];
        const selectedEnvironment =
            state.selectedEnvId !== undefined
                ? this._environments?.get(state.selectedEnvId)
                : undefined;
        return {
            ...state,
            environments,
            runs,
            selectedEnvironment,
        };
    }

    /**
     * Computes the new state for a navigate action. Hydrates the run record
     * from disk for the run page (full payload), and re-reads the env from
     * the store for the environment page.
     */
    private async _computeNavigationState(payload: {
        readonly page: HubPage;
        readonly envId?: string;
        readonly runId?: string;
    }): Promise<CloudDeployHubState> {
        const base = this._withFreshSnapshots(this.state);

        if (payload.page === "environment" && payload.envId !== undefined) {
            const selectedEnvironment = this._environments?.get(payload.envId);
            return {
                ...base,
                currentPage: "environment",
                selectedEnvId: payload.envId,
                selectedRunId: undefined,
                selectedEnvironment,
                selectedRun: undefined,
                selectedRunArtifactPath: undefined,
                errorMessage: undefined,
            };
        }

        if (payload.page === "run" && payload.runId !== undefined) {
            const { run, artifactPath, error } = await this._loadRun(payload.runId);
            return {
                ...base,
                currentPage: "run",
                selectedEnvId: undefined,
                selectedRunId: payload.runId,
                selectedEnvironment: undefined,
                selectedRun: run,
                selectedRunArtifactPath: artifactPath,
                errorMessage: error,
            };
        }

        // Default: runList (or pipeline; pipeline page renders empty in this commit).
        return {
            ...base,
            currentPage: payload.page,
            selectedEnvId: undefined,
            selectedRunId: undefined,
            selectedEnvironment: undefined,
            selectedRun: undefined,
            selectedRunArtifactPath: undefined,
            errorMessage: undefined,
        };
    }

    /**
     * Internal navigate: bypasses the round-trip when the host wants to
     * navigate the existing panel programmatically (e.g. from the tree
     * provider's command).
     */
    private async _navigateInternal(payload: {
        readonly page: HubPage;
        readonly envId?: string;
        readonly runId?: string;
    }): Promise<void> {
        this.state = await this._computeNavigationState(payload);
    }

    private async _loadRun(runId: string): Promise<{
        run?: RunRecord;
        artifactPath?: string;
        error?: string;
    }> {
        if (this._runStore === undefined) {
            return { error: CloudDeployDashboard.runLoadFailed(runId, "no run store available") };
        }
        const entry = this._runStore.list().find((e) => e.runId === runId);
        try {
            const run = await this._runStore.get(runId);
            if (run === undefined) {
                return {
                    artifactPath: entry?.artifactPath,
                    error: CloudDeployDashboard.runLoadFailed(runId, "run not found"),
                };
            }
            return { run, artifactPath: entry?.artifactPath };
        } catch (err) {
            return {
                error: CloudDeployDashboard.runLoadFailed(
                    runId,
                    err instanceof Error ? err.message : String(err),
                ),
            };
        }
    }

    // -------------------------------------------------------------------------
    // Disposal
    // -------------------------------------------------------------------------

    private _disposeSubscriptions(): void {
        for (const d of this._storeSubscriptions) {
            try {
                d.dispose();
            } catch {
                // ignore
            }
        }
        this._storeSubscriptions.length = 0;
    }

    public override dispose(): void {
        this._disposeSubscriptions();
        if (CloudDeployHubController._current === this) {
            CloudDeployHubController._current = undefined;
        }
        super.dispose();
    }
}

// =============================================================================
// Helpers
// =============================================================================

function buildInitialState(
    environments: EnvironmentStore | undefined,
    runStore: RunStore | undefined,
    initialView: HubInitialView,
): CloudDeployHubState {
    const envs = listEnvironmentSummaries(environments);
    const runs = runStore?.list() ?? [];

    if (initialView.kind === "environment") {
        return {
            currentPage: "environment",
            environments: envs,
            runs,
            liveRuns: [],
            selectedEnvId: initialView.envId,
            selectedEnvironment: tryGetEnvironment(environments, initialView.envId),
        };
    }
    if (initialView.kind === "run") {
        const entry = findRunEntry(runs, initialView.runId);
        return {
            currentPage: "run",
            environments: envs,
            runs,
            liveRuns: [],
            selectedRunId: initialView.runId,
            selectedRunArtifactPath: entry?.artifactPath,
            // selectedRun is hydrated lazily by the navigate reducer on first
            // navigation; the React side dispatches a navigate("run", runId)
            // on mount when selectedRun is undefined.
        };
    }
    return {
        currentPage: "runList",
        environments: envs,
        runs,
        liveRuns: [],
    };
}

function listEnvironmentSummaries(
    environments: EnvironmentStore | undefined,
): readonly EnvironmentSummary[] {
    if (environments === undefined) {
        return [];
    }
    let envs: readonly Environment[] = [];
    try {
        envs = environments.list();
    } catch {
        // EnvironmentStore not yet initialized — empty list.
        return [];
    }
    return envs.map(toSummary);
}

function tryGetEnvironment(
    environments: EnvironmentStore | undefined,
    envId: string,
): Environment | undefined {
    if (environments === undefined) {
        return undefined;
    }
    try {
        return environments.get(envId);
    } catch {
        return undefined;
    }
}

function findRunEntry(runs: readonly RunListEntry[], runId: string): RunListEntry | undefined {
    return runs.find((r) => r.runId === runId);
}

function dedupeLiveRuns(liveRuns: readonly LiveRunSummary[]): readonly LiveRunSummary[] {
    const seen = new Set<string>();
    const out: LiveRunSummary[] = [];
    for (const r of liveRuns) {
        if (seen.has(r.runId)) {
            continue;
        }
        seen.add(r.runId);
        out.push(r);
    }
    return out;
}

function toSummary(env: Environment): EnvironmentSummary {
    return {
        id: env.id,
        name: env.name,
        description: env.description,
        sourceOfTruthKind: env.sourceOfTruth.kind,
        validationCount: env.validations.length,
    };
}

function initialViewToReducerPayload(initialView: HubInitialView): {
    readonly page: HubPage;
    readonly envId?: string;
    readonly runId?: string;
} {
    if (initialView.kind === "environment") {
        return { page: "environment", envId: initialView.envId };
    }
    if (initialView.kind === "run") {
        return { page: "run", runId: initialView.runId };
    }
    return { page: "runList" };
}
