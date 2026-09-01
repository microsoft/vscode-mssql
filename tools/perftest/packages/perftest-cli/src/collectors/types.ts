/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Collector framework interface (design §14). Collectors are pluggable
 * lifecycle observers; a missing or failing collector degrades diagnostic
 * depth but must never corrupt an official metric (§A3.6).
 */

import type { Marker, Metric, ArtifactRef, PassType } from "@mssqlperf/contracts";
import type { HarnessLogger } from "../telemetry/logger";

export type CollectorCost = "low" | "medium" | "high";

export interface PerfProcess {
    role: string;
    pid: number;
    ppid?: number;
    name: string;
    commandLine?: string;
    startTimeUnixNs?: string;
    reportedBy?: string;
    discoveryMethods: string[];
    version?: string;
}

export interface ProcessRegistry {
    all(): PerfProcess[];
    byRole(role: string): PerfProcess[];
    register(process: PerfProcess): void;
}

export interface MutableLaunchSpec {
    args: string[];
    env: Record<string, string>;
}

export interface CollectorValidation {
    name: string;
    status: "passed" | "warning" | "failed";
    message?: string;
}

export interface CollectorContext {
    runId: string;
    repId: number;
    attemptId: number;
    scenarioId: string;
    passType: PassType;
    /** Absolute rep directory; collectors write artifacts beneath it. */
    repDir: string;
    artifactsDir: string;
    logger: HarnessLogger;
    /** Ad-hoc SQL against the provisioned server (XEvents control/reads). */
    sqlExec?: (sql: string, label: string) => Promise<string>;
}

export interface Collector {
    readonly name: string;
    readonly cost: CollectorCost;
    readonly platforms: Array<"win32" | "linux" | "darwin" | "all">;
    readonly allowedPassTypes: PassType[];

    validate?(ctx: CollectorContext): Promise<CollectorValidation[]>;
    preProvision?(ctx: CollectorContext): Promise<void>;
    preLaunch?(ctx: CollectorContext, launch: MutableLaunchSpec): Promise<void>;
    postLaunch?(ctx: CollectorContext, processes: ProcessRegistry): Promise<void>;
    onProcessDiscovered?(ctx: CollectorContext, process: PerfProcess): Promise<void>;
    onScenarioStart?(ctx: CollectorContext, marker: Marker): Promise<void>;
    onScenarioEnd?(ctx: CollectorContext, marker: Marker): Promise<void>;
    preShutdown?(ctx: CollectorContext): Promise<void>;
    postExit?(ctx: CollectorContext): Promise<ArtifactRef[]>;
    normalize?(ctx: CollectorContext): Promise<Metric[]>;
    /** Post-run honesty checks (e.g. correlation quality) surfaced on the rep. */
    postRunValidations?(): CollectorValidation[];
    teardown?(ctx: CollectorContext): Promise<void>;
}
