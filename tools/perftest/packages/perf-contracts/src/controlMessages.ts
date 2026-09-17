/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Control-plane message contracts (design §9). The orchestrator hosts a
 * localhost WebSocket control server; the mssql-perf-driver automation
 * extension connects, authenticates with a token, and exchanges these
 * messages. Every message carries the same base envelope.
 */

import type { Marker } from "./marker";

export type ControlMessageKind =
    | "hello"
    | "ready"
    | "startScenario"
    | "scenarioStarted"
    | "scenarioBoundaryAck"
    | "marker"
    | "processDiscovered"
    | "scenarioCompleted"
    | "scenarioFailed"
    | "artifactHint"
    | "shutdown"
    | "heartbeat"
    | "calibrationPing"
    | "calibrationPong"
    | "error";

export type SenderRole =
    | "orchestrator"
    | "automationExtension"
    | "productExtension"
    | "sts"
    | "webview"
    | "child";

export interface ControlSender {
    role: SenderRole | string;
    pid: number;
    name: string;
}

export interface ControlMessageBase {
    schemaVersion: 1;
    kind: ControlMessageKind;
    runId: string;
    repId: number;
    scenarioId: string;
    /** Epoch nanoseconds as decimal string, stamped by the sender. */
    timestampUnixNs: string;
    sender: ControlSender;
}

/** Driver → orchestrator, first message after the socket opens. */
export interface HelloMessage extends ControlMessageBase {
    kind: "hello";
    payload: {
        token: string;
        vscodeVersion?: string;
        driverVersion?: string;
        extensionHostPid: number;
    };
}

/** Driver → orchestrator, after environment checks pass. */
export interface ReadyMessage extends ControlMessageBase {
    kind: "ready";
    payload: {
        checks?: Array<{
            name: string;
            status: "passed" | "warning" | "failed";
            message?: string;
        }>;
    };
}

/**
 * Connection details the driver may use for non-interactive product
 * connections. Synthetic perf credentials only (design §29); the control
 * channel is localhost + token-authenticated. Never logged or persisted in
 * markers/results.
 */
export interface ConnectionProfileSpec {
    server: string;
    database?: string;
    authenticationType: "SqlLogin" | "Integrated";
    user?: string;
    password?: string;
    encrypt?: string;
    trustServerCertificate?: boolean;
}

/** Orchestrator → driver: execute this scenario now. */
export interface StartScenarioMessage extends ControlMessageBase {
    kind: "startScenario";
    payload: {
        scenario: ScenarioSpec;
        traceId: string;
        rootTraceparent: string;
        artifactDir: string;
        connectionProfiles?: Record<string, ConnectionProfileSpec>;
    };
}

/** Driver → orchestrator: scenario steps have begun. */
export interface ScenarioStartedMessage extends ControlMessageBase {
    kind: "scenarioStarted";
    payload: Record<string, never>;
}

/** Orchestrator → driver: scenario-window collectors armed or stopped. */
export interface ScenarioBoundaryAckMessage extends ControlMessageBase {
    kind: "scenarioBoundaryAck";
    payload: { phase: "start" | "end" };
}

/** Any perf-mode process → orchestrator: a semantic marker. */
export interface MarkerMessage extends ControlMessageBase {
    kind: "marker";
    payload: { marker: Marker };
}

/** Driver/product → orchestrator: a child process was discovered (design §15). */
export interface ProcessDiscoveredMessage extends ControlMessageBase {
    kind: "processDiscovered";
    payload: {
        role: string;
        pid: number;
        ppid?: number;
        name: string;
        commandLine?: string;
        startTimeUnixNs?: string;
        reportedBy: string;
        discoveryMethods: string[];
        version?: string;
    };
}

export interface StepOutcome {
    step: string;
    status: "passed" | "failed" | "skipped";
    durationMs?: number;
    message?: string;
}

/** Driver → orchestrator: scenario finished and success criteria evaluated. */
export interface ScenarioCompletedMessage extends ControlMessageBase {
    kind: "scenarioCompleted";
    payload: {
        successChecks: StepOutcome[];
        steps: StepOutcome[];
    };
}

/** Driver → orchestrator: scenario failed (timing not regression-eligible). */
export interface ScenarioFailedMessage extends ControlMessageBase {
    kind: "scenarioFailed";
    payload: {
        reason: string;
        step?: string;
        stack?: string;
        successChecks?: StepOutcome[];
    };
}

/** Any → orchestrator: an artifact was written that the normalizer should index. */
export interface ArtifactHintMessage extends ControlMessageBase {
    kind: "artifactHint";
    payload: {
        kind: string;
        path: string;
        contentType?: string;
    };
}

/** Orchestrator → driver: gracefully close VS Code. */
export interface ShutdownMessage extends ControlMessageBase {
    kind: "shutdown";
    payload: { reason: string };
}

export interface HeartbeatMessage extends ControlMessageBase {
    kind: "heartbeat";
    payload: { seq: number };
}

/**
 * Clock calibration (design §11.3): orchestrator sends ping with t0, driver
 * replies with its receive/send times, orchestrator computes offset/roundTrip.
 */
export interface CalibrationPingMessage extends ControlMessageBase {
    kind: "calibrationPing";
    payload: { seq: number; t0UnixNs: string };
}

export interface CalibrationPongMessage extends ControlMessageBase {
    kind: "calibrationPong";
    payload: {
        seq: number;
        t0UnixNs: string;
        e1UnixNs: string;
        e2UnixNs: string;
    };
}

/** Either direction: protocol-level error report. */
export interface ErrorMessage extends ControlMessageBase {
    kind: "error";
    payload: { message: string; details?: Record<string, unknown> };
}

export type ControlMessage =
    | HelloMessage
    | ReadyMessage
    | StartScenarioMessage
    | ScenarioStartedMessage
    | ScenarioBoundaryAckMessage
    | MarkerMessage
    | ProcessDiscoveredMessage
    | ScenarioCompletedMessage
    | ScenarioFailedMessage
    | ArtifactHintMessage
    | ShutdownMessage
    | HeartbeatMessage
    | CalibrationPingMessage
    | CalibrationPongMessage
    | ErrorMessage;

// ---------------------------------------------------------------------------
// PERF_MODE-only Query Studio command arguments.
// ---------------------------------------------------------------------------

/**
 * Stable catalog selector for the synthetic VectorLab search fixture. The
 * product must resolve this selector to its own host-owned binding and reject
 * missing, ambiguous, stale, or incompatible targets; it must not forward
 * these names to the webview as SQL authority.
 */
export interface QueryStudioVectorPerfTargetSelector {
    schema: string;
    table: string;
    vectorColumn: string;
}

/** The smallest Search composition needed by the VEC-12 perf scenarios. */
export interface QueryStudioVectorPerfSearchAction {
    source: { kind: "selectedRow"; ordinal: number };
    target: QueryStudioVectorPerfTargetSelector;
    metric: "cosine" | "euclidean" | "dot";
    k: number;
    /** False = exact only; true = exact plus the capability-gated ANN variant. */
    includeApprox: boolean;
}

/**
 * Optional Vector action carried by `mssql.perf.queryStudioActivateTab`.
 * Projection runs when its workspace opens; Search additionally receives one
 * deterministic composition and invokes the same run path as the product UI.
 */
export type QueryStudioVectorPerfAction =
    | { workspace: "projection" }
    | { workspace: "search"; search: QueryStudioVectorPerfSearchAction };

/** PERF_MODE-only arguments expected by `mssql.perf.queryStudioActivateTab`. */
export interface QueryStudioPerfActivateTabArgs {
    uri?: string;
    tab: "vector";
    vector?: QueryStudioVectorPerfAction;
}

export type QueryStudioInteractionAction =
    | {
          kind: "activateTab";
          tab: "results" | "messages" | "queryPlan" | "vector" | "spatial";
      }
    | {
          kind: "scrollGrid";
          resultSetIndex: number;
          axis: "vertical" | "horizontal";
          target: "start" | "middle" | "end";
      }
    | {
          kind: "scrollResultStack";
          target: "start" | "middle" | "end";
      }
    | {
          kind: "sweepResultStack";
          steps: number;
      }
    | {
          kind: "selectGrid";
          resultSetIndex: number;
          selection: "all";
      }
    | {
          kind: "copyGrid";
          resultSetIndex: number;
          selection: "all";
          includeHeaders: boolean;
      }
    | {
          /** Bounded host-direct Copy All for the virtualized Messages pane. */
          kind: "copyMessages";
      };

// ---------------------------------------------------------------------------
// Scenario model (design §7) — the spec shipped to the driver in startScenario.
// ---------------------------------------------------------------------------

export type ScenarioStep =
    | { type: "command"; command: string; args?: unknown[]; timeoutMs?: number }
    | { type: "openDocument"; path: string; timeoutMs?: number }
    | {
          type: "waitForMarker";
          name: string;
          attrs?: Record<string, unknown>;
          timeoutMs?: number;
      }
    | {
          type: "waitForCommandCompletion";
          command: string;
          args?: unknown[];
          timeoutMs?: number;
      }
    | { type: "webviewProbe"; probe: string; assert?: string; timeoutMs?: number }
    | {
          type: "objectExplorerProbe";
          name?: string;
          assert?: string;
          timeoutMs?: number;
      }
    /** Expand an OE path (labels from the server root) via the real tree provider. */
    | { type: "oeExpand"; oePath: string[]; profile?: string; timeoutMs?: number }
    /**
     * Open a designer (Table Designer / Schema Designer) against the profile's
     * database via a server-level OE session + the product's designer command —
     * the same semantics as the in-product self-test's designerOpen step.
     */
    | {
          type: "designerOpen";
          designer: "tableDesigner" | "schemaDesigner";
          profile?: string;
          timeoutMs?: number;
      }
    /** Invoke the completion provider at the cursor; `expect` must be suggested. */
    | { type: "completionProbe"; expect?: string; timeoutMs?: number }
    /** Fetch a row window via the real product path; verify offset correctness. */
    | {
          type: "windowFetchCheck";
          rowStart: number;
          numberOfRows?: number;
          expectFirstCell?: string;
          timeoutMs?: number;
      }
    /**
     * Non-interactively connect the active editor's document to the named
     * connection profile via the product's own test seam
     * (mssql.getControllerForTests → connectionManager.connect).
     */
    | { type: "mssqlConnect"; profile: string; timeoutMs?: number }
    /** Disconnect the active editor's connection via the product test seam. */
    | { type: "mssqlDisconnect"; timeoutMs?: number }
    /**
     * Query Studio connect (PERF_MODE seam): write the orchestrator-provided
     * profile as the ONLY saved connection (mssql.connections via
     * mssql.perf.setConfig) so the product's exactly-one-saved-profile
     * auto-pick engages, then drive mssql.perf.queryStudioConnect until it
     * reports { connected: true } (brief retries while the custom editor's
     * document model resolves).
     */
    | { type: "queryStudioConnect"; profile?: string; timeoutMs?: number }
    /**
     * Provision the orchestrator's connection profile as the ONLY saved
     * mssql connection (+ credential-store seed for SqlLogin) WITHOUT
     * connecting anything — for scenarios whose feature does its own
     * connect (e.g. Object Explorer v2 browse).
     */
    | {
          type: "provisionConnectionProfile";
          profile?: string;
          /** Save WITHOUT a database (OE parity K1: server-scoped connection). */
          serverScoped?: boolean;
          timeoutMs?: number;
      }
    /**
     * Execute the live Query Studio document's text through the PERF_MODE-only
     * mssql.perf.queryStudioExecute seam (backing document text by default).
     */
    | { type: "queryStudioExecute"; timeoutMs?: number }
    /**
     * Drive a semantic Query Studio result interaction and wait for the
     * correlated webview paint. Vertical grid scrolls also await real grid
     * render completion; result-stack moves/sweeps await a newly mounted grid.
     */
    | {
          type: "queryStudioInteract";
          action: QueryStudioInteractionAction;
          timeoutMs?: number;
      }
    /**
     * Deliberate busy-delay INSIDE a measured window. Exists solely so the
     * regression gate can be proven against a real slowdown (design §32 M6
     * acceptance). Never use in a product scenario — semantic waits only.
     */
    | { type: "syntheticDelay"; ms: number }
    | { type: "noop" };

export type SuccessCriterion =
    | { type: "markerSeen"; name: string; attrs?: Record<string, unknown> }
    /**
     * Passes when NO matching marker occurred in the rep (same matching
     * semantics as markerSeen). Negative proofs for lazy-cost claims — e.g.
     * "the unopened Vector tab never requested its chunk". Failure messages
     * name the offending occurrence honestly.
     */
    | { type: "markerAbsent"; name: string; attrs?: Record<string, unknown> }
    | { type: "webviewProbe"; probe: string; assert: string }
    | { type: "objectExplorerProbe"; name?: string; assert: string }
    | { type: "noErrors"; sources: string[] }
    | { type: "custom"; name: string };

export interface MeasureSpec {
    /** How the measured interval starts. */
    start:
        | { type: "beforeCommand"; command: string }
        | { type: "beforeFirstAction" }
        | { type: "marker"; name: string };
    action: ScenarioStep[];
    /** How the measured interval ends. */
    end:
        | { type: "waitForMarker"; name: string; attrs?: Record<string, unknown> }
        | { type: "afterLastAction" };
    timeoutMs: number;
}

/**
 * Soak/stress loop (Phase-2 M10.1): run `steps` repeatedly inside ONE
 * measured window, emitting iteration.start/iteration.end markers with
 * attrs.index. Per-iteration success criteria are freshness-scoped to the
 * iteration. Reliability scenarios use onFailure: "continue" and capture
 * every failure; nothing is retried or hidden.
 */
export interface ScenarioLoopSpec {
    iterations: number;
    /** Excluded from steady-state analysis (still recorded). Default 0. */
    warmupIterations?: number;
    steps: ScenarioStep[];
    /** Evaluated after each iteration against markers fresh to that iteration. */
    success?: SuccessCriterion[];
    /** continue = record the failure and keep looping (default); abort = stop. */
    onFailure?: "continue" | "abort";
    /** Steps run between iterations (settle/cleanup), outside iteration timing. */
    settleSteps?: ScenarioStep[];
}

export interface ScenarioSpec {
    scenarioId: string;
    displayName: string;
    tags?: string[];
    profileMode?: "fresh" | "warmed" | "reuse";
    workspace?: string;
    /**
     * Settings merged into the profile's User/settings.json BEFORE VS Code
     * launches. For settings that must exist at ACTIVATION time (e.g.
     * mssql.sqlDataPlane.enabled adds --enable-sts2 to the STS spawn args —
     * a post-activation mssql.perf.setConfig flip is too late). Runtime-only
     * toggles should keep using the setConfig step instead.
     */
    userSettings?: Record<string, unknown>;
    loop?: ScenarioLoopSpec;
    sql?: {
        database?: string;
        snapshot?: string;
        cacheMode?: string;
        connectionProfile?: string;
    };
    setup?: ScenarioStep[];
    measure: MeasureSpec;
    success?: SuccessCriterion[];
    cleanup?: ScenarioStep[];
    metrics?: Array<{
        name: string;
        source: string;
        official: boolean;
        lowerIsBetter?: boolean;
        /**
         * When set, the normalizer derives this metric's duration from the first
         * begin/end marker pair with these names (same-process monotonic time
         * when available). scenario.wallclock is always derived from
         * scenario.start/scenario.end and needs no pair declaration.
         */
        beginMarker?: string;
        endMarker?: string;
        component?: string;
        processRole?: string;
        /**
         * Restrict marker-pair derivation to markers inside the measured window
         * (scenario.start … scenario.end). For scenarios whose SETUP emits the
         * same product markers as the measured action (e.g. the Query Studio
         * session preflight runs an unmeasured query first) — without this the
         * pair search would honestly-but-wrongly time the setup pair.
         */
        withinMeasuredWindow?: boolean;
    }>;
    timeouts?: {
        readinessMs?: number;
        actionMs?: number;
        teardownMs?: number;
        collectorFlushMs?: number;
    };
}
