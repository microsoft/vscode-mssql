/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — Hub webview RPC contract.
 *
 * Discriminated unions describing every message that flows between the
 * `CloudDeployHubController` (host side) and the React app inside the
 * webview. Pure types — no runtime, no behavior. Importing this module
 * costs nothing.
 *
 * Both unions are closed and discriminated on `type`:
 *   * `HubInbound`  — webview → host (user actions).
 *   * `HubOutbound` — host → webview (state updates, navigation, events).
 *
 * Payloads are pure data: no functions, no class instances, no buffers.
 * Anything that crosses the boundary is JSON-serializable.
 *
 * The webview reducer must `switch (msg.type)` exhaustively over
 * `HubOutbound`. The host must validate inbound `type` against the closed
 * set of `HubInbound["type"]` values before dispatching.
 */

import { DiagnosticEvent } from "../diagnostics/types";
import { Environment } from "../environments/types";
import { RunListEntry } from "../runs/runStore";
import { RunRecord } from "../runs/types";

// =============================================================================
// Pages
// =============================================================================

/** The four top-level pages the hub navigates between. */
export type HubPage = "pipeline" | "environment" | "run" | "runList";

// =============================================================================
// Outbound — host → webview
// =============================================================================

/**
 * Compact env summary the webview needs for the pipeline + tree views.
 * Carries less than the full D1 `Environment` so the wire payload stays
 * small when the env list is large; the full env is sent on environment
 * page navigation.
 */
export interface EnvironmentSummary {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    readonly sourceOfTruthKind: string;
    readonly validationCount: number;
}

/**
 * Initial state pushed to the webview right after `ready`. Carries enough
 * for the pipeline page to render without further round-trips.
 */
export interface HubInitState {
    readonly environments: readonly EnvironmentSummary[];
    readonly runs: readonly RunListEntry[];
    readonly initialPage: HubPage;
    readonly initialEnvId?: string;
    readonly initialRunId?: string;
}

export type HubOutbound =
    | { readonly type: "init"; readonly state: HubInitState }
    | { readonly type: "envsChanged"; readonly environments: readonly EnvironmentSummary[] }
    | { readonly type: "runsChanged"; readonly runs: readonly RunListEntry[] }
    | {
          readonly type: "navigate";
          readonly page: HubPage;
          readonly envId?: string;
          readonly runId?: string;
      }
    | {
          readonly type: "environmentLoaded";
          readonly envId: string;
          readonly environment: Environment;
          readonly latestRun?: RunRecord;
          readonly recentRuns: readonly RunListEntry[];
      }
    | {
          readonly type: "runLoaded";
          readonly runId: string;
          readonly record: RunRecord;
          readonly artifactPath?: string;
      }
    | {
          readonly type: "runStarted";
          readonly runId: string;
          readonly envId: string;
          readonly startedAtMs: number;
      }
    | { readonly type: "eventAppended"; readonly runId: string; readonly event: DiagnosticEvent }
    | {
          readonly type: "runFinalized";
          readonly runId: string;
          readonly record: RunRecord;
          readonly artifactPath?: string;
          readonly persistError?: string;
      }
    | { readonly type: "showError"; readonly message: string };

// =============================================================================
// Inbound — webview → host
// =============================================================================

export type HubInbound =
    | { readonly type: "ready" }
    | {
          readonly type: "navigate";
          readonly page: HubPage;
          readonly envId?: string;
          readonly runId?: string;
      }
    | { readonly type: "runValidation"; readonly envId: string }
    | { readonly type: "cancelRun"; readonly runId: string }
    | { readonly type: "openRunByPath"; readonly artifactPath: string }
    | { readonly type: "revealInExplorer"; readonly path: string }
    | { readonly type: "manageEnvironments" }
    | { readonly type: "deleteRun"; readonly runId: string }
    | { readonly type: "refresh" };

// =============================================================================
// Type guards
// =============================================================================

/** Closed set of valid inbound `type` values. Used at the host boundary. */
export const HUB_INBOUND_TYPES: ReadonlySet<HubInbound["type"]> = new Set<HubInbound["type"]>([
    "ready",
    "navigate",
    "runValidation",
    "cancelRun",
    "openRunByPath",
    "revealInExplorer",
    "manageEnvironments",
    "deleteRun",
    "refresh",
]);

/**
 * Returns `true` if `value` looks like a `HubInbound` envelope. Best-effort
 * shape check at the host's webview boundary; the controller still
 * exhaustively `switch`es on `type` after this passes.
 */
export function isHubInbound(value: unknown): value is HubInbound {
    if (value === null || typeof value !== "object") {
        return false;
    }
    const type = (value as { readonly type?: unknown }).type;
    return typeof type === "string" && HUB_INBOUND_TYPES.has(type as HubInbound["type"]);
}
