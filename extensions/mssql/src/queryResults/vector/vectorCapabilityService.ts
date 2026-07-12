/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * VectorCapabilityService (VEC-7): the policy layer between the controller's
 * `qs/vector.capabilities` handler and the tolerant probe suite. It owns
 * exactly two things the probes deliberately do not:
 *
 * 1. Session sourcing — capabilities run on an AUXILIARY diagnostic session
 *    acquired through the injected thunk (DocumentSessionBinding.
 *    acquireAuxiliarySession("vectorDiagnostics")), opened per probe pass and
 *    disposed in a finally. The user session and the metadata session are
 *    never used here.
 * 2. Caching — per (connectionId, database) with a short TTL (~60s), because
 *    capability facts are stable within a session but must follow database
 *    switches and reconnects (identity() re-keys naturally). Concurrent
 *    callers coalesce onto one in-flight probe per key; `refresh` bypasses
 *    both cache and coalescing for an explicit user re-probe.
 *
 * Refusals are honest strings on the result — no active connection, no aux
 * session available — never fabricated empty capability sets.
 */

import { ISqlSession } from "../../services/sqlDataPlane/api";
import {
    QsVectorCapabilitiesResult,
    VectorCapabilityProbe,
} from "../../sharedInterfaces/vectorCatalog";
import { probeVectorCapabilities, VectorProbeTableFilter } from "./vectorCatalogProbes";

export interface AuxiliarySessionLease {
    readonly session: ISqlSession;
    dispose(): void;
}

export interface VectorCapabilitySessionSource {
    /**
     * Cache-key facts from the ACTIVE user session — no session is opened to
     * answer this. Undefined = not connected (honest refusal).
     */
    identity(): { connectionId: string; database?: string } | undefined;
    /** Acquire an auxiliary diagnostic session (undefined = refused). */
    acquire(): Promise<AuxiliarySessionLease | undefined>;
}

const DEFAULT_TTL_MS = 60_000;

export class VectorCapabilityService {
    private readonly cache = new Map<string, { at: number; probe: VectorCapabilityProbe }>();
    private readonly inFlight = new Map<string, Promise<QsVectorCapabilitiesResult>>();

    constructor(
        private readonly source: VectorCapabilitySessionSource,
        private readonly ttlMs: number = DEFAULT_TTL_MS,
        /** Injectable clock for deterministic TTL tests. */
        private readonly now: () => number = Date.now,
    ) {}

    /** Probe (or serve cached) capabilities for the current connection. */
    async capabilities(
        refresh = false,
        table?: VectorProbeTableFilter,
    ): Promise<QsVectorCapabilitiesResult> {
        const identity = this.source.identity();
        if (!identity) {
            return {
                error: "No active connection. Connect this document before probing vector capabilities.",
            };
        }
        const scope = table ? JSON.stringify([table.schema, table.table]) : "*";
        const key = `${identity.connectionId}|${identity.database ?? ""}|${scope}`;
        if (!refresh) {
            const cached = this.cache.get(key);
            if (cached && this.now() - cached.at < this.ttlMs) {
                return { probe: cached.probe };
            }
            const pending = this.inFlight.get(key);
            if (pending) {
                return pending;
            }
        }
        const run = this.probeOnce(key, identity.database, table);
        this.inFlight.set(key, run);
        try {
            return await run;
        } finally {
            if (this.inFlight.get(key) === run) {
                this.inFlight.delete(key);
            }
        }
    }

    /** Drop cached probes (e.g. after DDL the caller knows about). */
    invalidate(): void {
        this.cache.clear();
    }

    dispose(): void {
        this.cache.clear();
        this.inFlight.clear();
    }

    private async probeOnce(
        key: string,
        database?: string,
        table?: VectorProbeTableFilter,
    ): Promise<QsVectorCapabilitiesResult> {
        const lease = await this.source.acquire();
        if (!lease) {
            return {
                error: "No auxiliary diagnostic session is available for this connection.",
            };
        }
        try {
            const probe = await probeVectorCapabilities(
                lease.session,
                database,
                table ? { table } : undefined,
            );
            this.cache.set(key, { at: this.now(), probe });
            return { probe };
        } catch (error) {
            // probeVectorCapabilities never throws by contract — this guards
            // session-open races so the RPC still answers honestly.
            return { error: error instanceof Error ? error.message : String(error) };
        } finally {
            lease.dispose();
        }
    }
}
