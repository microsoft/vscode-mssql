/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Transport-neutral runtime adapter contract (A2 §3.4). Product code depends
 * on THIS interface only; concrete adapters wrap the supplied Hobbes
 * runtime's existing HTTP/AG-UI+REST surface (ADR-1) or a deterministic fake.
 * The adapter reports BOUNDARY observations only — the host never claims
 * runtime-internal timing the runtime did not supply (A2 §11.1).
 */

import type {
    RbsError,
    RunbookArtifactFile,
    RunbookNodeStateKind,
} from "../../sharedInterfaces/runbookStudio";
import type { RunbookOperationContext } from "../runbookDiag";

/**
 * A run the runtime REFUSED to start, with a user-actionable explanation.
 * Adapters throw this instead of a bare Error so the service can surface
 * the precise reason (e.g. "runbook not in the Hobbes library") rather
 * than the generic start-failure message. `refusalCode` is a closed enum
 * from the runtime's contract — safe for diagnostics.
 */
export class RuntimeStartRefusedError extends Error {
    constructor(
        public readonly rbsError: RbsError,
        public readonly refusalCode?: string,
    ) {
        super(rbsError.message);
        this.name = "RuntimeStartRefusedError";
    }
}

export interface RuntimeCapabilities {
    runtimeKind: "fake" | "hobbes" | "local";
    runtimeVersion: string;
    protocolVersion: string;
    supportsCancellation: boolean;
    supportsGates: boolean;
    supportsResume: boolean;
    maxConcurrentRuns: number;
}

/** Bounded output payload crossing the runtime boundary. The service turns
 *  it into a result-store handle immediately; it never reaches the webview. */
export interface RuntimeOutputPayload {
    /** Data contract id, e.g. "rowset/1", "scalarSet/1", "markdown/1". */
    contract: string;
    columns?: string[];
    rows?: Array<Array<string | number | boolean | null>>;
    /** Scalar/markdown payloads. */
    text?: string;
    scalars?: Record<string, number | string | boolean>;
}

export type RuntimeBoundaryEvent =
    | { kind: "runState"; state: "running" }
    | {
          kind: "nodeState";
          nodeId: string;
          state: RunbookNodeStateKind;
          attempt: number;
          outcome?: "success" | "failure" | "cancelled" | "skipped" | "policyDenied";
          /** Safe, localized-at-source one-line summary. */
          message?: string;
          /** True only when a conditional branch was not selected. */
          branchNotTaken?: boolean;
          output?: RuntimeOutputPayload;
      }
    | { kind: "gateRequested"; nodeId: string; impactSummary: string }
    | { kind: "gateResponded"; nodeId: string; approved: boolean }
    | {
          kind: "terminal";
          state: "succeeded" | "failed" | "cancelled";
          verdict?: "pass" | "fail" | "indeterminate";
          /** Optional bounded scalar metrics published with terminal state. */
          runMetrics?: Record<string, string | number | boolean>;
          errorCode?: string;
          errorMessage?: string;
      };

export interface RuntimeEventObserver {
    onEvent(event: RuntimeBoundaryEvent): void;
    /** The runtime dropped coalescible events; state transitions never drop. */
    onGap(droppedCount: number): void;
    /** Runtime went away; unexpected=true means crash, not disposal. */
    onExit(unexpected: boolean): void;
}

export interface RuntimeStartRequest {
    runId: string;
    artifact: RunbookArtifactFile;
    parameterValues: Record<string, string | number | boolean | null>;
}

export interface RuntimeValidationIssue {
    nodeId?: string;
    detail: string;
}

export interface RunbookRuntimeAdapter {
    initialize(context: RunbookOperationContext): Promise<RuntimeCapabilities>;
    validate(
        artifact: RunbookArtifactFile,
        context: RunbookOperationContext,
    ): Promise<{ ok: boolean; issues: RuntimeValidationIssue[] }>;
    /** Resolves when the run is ACCEPTED; progress flows to the observer. */
    startRun(
        request: RuntimeStartRequest,
        observer: RuntimeEventObserver,
        context: RunbookOperationContext,
    ): Promise<void>;
    cancelRun(
        runId: string,
        context: RunbookOperationContext,
    ): Promise<"cancelled" | "alreadyTerminal" | "failed">;
    respondToGate(
        runId: string,
        nodeId: string,
        approve: boolean,
        context: RunbookOperationContext,
    ): Promise<boolean>;
    dispose(): Promise<void>;
}
