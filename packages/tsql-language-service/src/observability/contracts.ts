/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Disposable } from "../common/disposable.js";
import type { EngineCapabilitySet } from "../common/engineCapabilities.js";
import type { EngineProfileSource, SqlEngineProfile } from "../common/engineProfile.js";
import type { MetadataCompleteness } from "../metadata/index.js";

export interface LatencySummary {
    readonly count: number;
    readonly p50Ms: number;
    readonly p95Ms: number;
    readonly maximumMs: number;
}

export interface LanguageServiceStats {
    readonly document: {
        readonly uri: string;
        readonly version: number;
        readonly utf16Length: number;
    };
    readonly syntax: {
        readonly state: "idle" | "parsing" | "ready" | "failed";
        readonly mode: "none" | "full" | "incremental";
        readonly elapsedMs: number;
        readonly changedRangeCount: number;
        readonly reusableFragmentCount: number;
        readonly errorCount: number;
    };
    readonly semantics: {
        readonly state: "pending" | "binding" | "ready" | "failed";
        readonly documentVersion?: number;
        readonly metadataGeneration?: number;
        readonly elapsedMs: number;
        readonly unitsExamined: number;
        readonly unitsReused: number;
        readonly unitsRebound: number;
        readonly diagnosticCount: number;
    };
    readonly metadata: {
        readonly providerId: string;
        readonly generation: number;
        readonly completeness: MetadataCompleteness;
        readonly ageMs: number;
        readonly refreshInProgress: boolean;
        readonly lastRefreshMs?: number;
        readonly cacheHits: number;
        readonly cacheMisses: number;
    };
    readonly runtime: {
        readonly mode: "in-process" | "node-worker" | "web-worker";
        readonly state: "ready" | "busy" | "failed";
        readonly queueDepth: number;
        readonly roundTripMs?: number;
        readonly workerElapsedMs?: number;
    };
    readonly requests: {
        readonly latency: Readonly<Record<string, LatencySummary>>;
        readonly cancelled: number;
        readonly staleResultsDiscarded: number;
    };
    /**
     * Which engine produced the visible result. A support view reads this to answer "why did I
     * see that diagnostic" without needing the connection.
     */
    readonly engine: {
        readonly profile: SqlEngineProfile;
        /** The comparable identity every snapshot in this result carries. */
        readonly generation: string;
        readonly displayName: string;
        readonly source: EngineProfileSource;
        readonly reason: string;
        readonly serverMajorVersion?: number;
        readonly compatibilityLevel?: number;
        readonly previewFeatures: boolean;
        readonly capabilities: EngineCapabilitySet;
    };
}

export interface LanguageServiceStatsProvider {
    getStats(uri: string): LanguageServiceStats | undefined;
    onDidChangeStats(listener: (uri: string) => void): Disposable;
}
