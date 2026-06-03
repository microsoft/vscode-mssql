/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy Hub — webview state contract.
 *
 * Shape of the state pushed from `CloudDeployHubController` to the React app
 * inside `dist/views/cloudDeployHub.js`, plus the reducer envelope dispatched
 * by user actions in the webview.
 *
 * The hub is a single-panel view that navigates between three pages:
 *   * `runList`     — every run in the workspace (default landing).
 *   * `environment` — one environment + its recent runs.
 *   * `run`         — full detail for one run (status, validations, artifact).
 *
 * `pipeline` is reserved for a future page (cross-env deploy timeline) and
 * is not rendered in this commit.
 */

import type { Environment } from "../cloudDeploy/environments/types";
import type { RunListEntry, RunRecord } from "../cloudDeploy/runs/types";

// =============================================================================
// Pages
// =============================================================================

/** The four top-level pages the hub navigates between. */
export type HubPage = "pipeline" | "environment" | "run" | "runList";

// =============================================================================
// Wire-friendly summaries
// =============================================================================

/**
 * Compact env summary the webview needs for navigation lists. Carries less
 * than the full `Environment` so wire payloads stay small when the env
 * list is large; the full env is hydrated only when the environment page
 * is opened.
 */
export interface EnvironmentSummary {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    readonly sourceOfTruthKind: string;
    readonly validationCount: number;
}

/**
 * Compact summary for an in-flight validation run. Pushed into state by the
 * controller's diagnostic-bus subscription on `validation-run-started` and
 * removed on `validation-run-finished` / `run-persisted`. The webview uses
 * this to render a "Currently running" banner above the run list.
 */
export interface LiveRunSummary {
    readonly runId: string;
    readonly environmentId: string;
    readonly environmentName?: string;
    readonly startedAtMs: number;
}

// =============================================================================
// State
// =============================================================================

/** Snapshot the React app renders from. */
export interface CloudDeployHubState {
    /** Page currently being viewed. */
    readonly currentPage: HubPage;
    /** All environments in the workspace, projected to summary form. */
    readonly environments: readonly EnvironmentSummary[];
    /** All runs in the workspace, newest-first. */
    readonly runs: readonly RunListEntry[];
    /** Runs currently in flight (driven by the diagnostic bus). */
    readonly liveRuns: readonly LiveRunSummary[];
    /** Set when `currentPage === "environment"`. */
    readonly selectedEnvId?: string;
    /** Set when `currentPage === "run"`. */
    readonly selectedRunId?: string;
    /** Full env, hydrated when `currentPage === "environment"`. */
    readonly selectedEnvironment?: Environment;
    /** Full run record, hydrated when `currentPage === "run"`. */
    readonly selectedRun?: RunRecord;
    /** Absolute path to the `.cdrun.zip` for `selectedRun`, when known. */
    readonly selectedRunArtifactPath?: string;
    /** Last error surfaced to the user (e.g. failed run hydration). */
    readonly errorMessage?: string;
}

// =============================================================================
// Reducers
// =============================================================================

/**
 * Reducer envelope. Each key is an action the React app may dispatch via
 * `extensionRpc.action(key, payload)`. Commit 4 will extend this with
 * runValidation / deleteRun / openRunByPath.
 */
export interface CloudDeployHubReducers {
    /** Switch the current page. Hydrates env/run detail as needed. */
    navigate: {
        readonly page: HubPage;
        readonly envId?: string;
        readonly runId?: string;
    };
    /** Force a re-scan of `.mssql/runs/`. */
    refresh: Record<string, never>;
    /** Open the artifact zip for the given run in the OS file explorer. */
    revealArtifact: { readonly runId: string };
    /** Delete a run's `.cdrun.zip` after user confirmation. */
    deleteRun: { readonly runId: string };
}
