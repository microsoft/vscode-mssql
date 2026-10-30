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
import { VectorWorkbenchMessages as VectorWorkbenchLoc } from "../../constants/locConstants";

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

interface ProbePass {
    controller: AbortController;
    lease?: AuxiliarySessionLease;
}

export class VectorCapabilityService {
    private readonly cache = new Map<string, { at: number; probe: VectorCapabilityProbe }>();
    private readonly inFlight = new Map<string, Promise<QsVectorCapabilitiesResult>>();
    private readonly activePasses = new Set<ProbePass>();
    private disposed = false;

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
        if (this.disposed) {
            return { error: VectorWorkbenchLoc.noAuxiliaryDiagnosticSessionIsAvailableForThis };
        }
        const identity = this.source.identity();
        if (!identity) {
            return {
                error: VectorWorkbenchLoc.noActiveConnectionConnectThisDocumentBeforeProbing,
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

    /** Stop unfinished probes while preserving completed capability facts. */
    cancelInFlight(): void {
        for (const pass of this.activePasses) {
            pass.controller.abort();
            this.releaseLease(pass);
        }
        this.inFlight.clear();
    }

    dispose(): void {
        this.disposed = true;
        this.cancelInFlight();
        this.cache.clear();
    }

    private releaseLease(pass: ProbePass): void {
        const lease = pass.lease;
        pass.lease = undefined;
        lease?.dispose();
    }

    private async probeOnce(
        key: string,
        database?: string,
        table?: VectorProbeTableFilter,
    ): Promise<QsVectorCapabilitiesResult> {
        const pass: ProbePass = { controller: new AbortController() };
        this.activePasses.add(pass);
        try {
            pass.lease = await this.source.acquire();
            pass.controller.signal.throwIfAborted();
            if (!pass.lease) {
                return {
                    error: VectorWorkbenchLoc.noAuxiliaryDiagnosticSessionIsAvailableForThis,
                };
            }
            const probe = await probeVectorCapabilities(pass.lease.session, database, {
                table,
                signal: pass.controller.signal,
            });
            pass.controller.signal.throwIfAborted();
            this.cache.set(key, { at: this.now(), probe });
            return { probe };
        } catch (error) {
            // Missing surfaces are represented in the probe. Cancellation
            // and session-open races still need an honest RPC error.
            return { error: error instanceof Error ? error.message : String(error) };
        } finally {
            this.releaseLease(pass);
            this.activePasses.delete(pass);
        }
    }
}
