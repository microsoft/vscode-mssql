/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Basemap session manager (SPA-10, addendum §6.2). Owns provider sessions and
 * tile flow ONLY — spatial result preparation stays in SpatialSessionManager.
 * Enforces, in order: feature gate at the controller, workspace trust,
 * projection eligibility, source validity, consent (interactive prompt is a
 * host-owned callback; restore never prompts, D-0027), then per-request
 * z/x/y + generation validation, per-session and global concurrency, cache,
 * and typed fetch. The webview supplies only ids and tile coordinates — never
 * URLs, headers, or configuration.
 */

import * as crypto from "crypto";
import { Perf } from "../../perf/perfTelemetry";
import {
    SPATIAL_BASEMAP_LIMITS,
    SpatialBasemapDescriptor,
    SpatialBasemapFetcherDeps,
    SpatialBasemapValidatedSource,
} from "./spatialBasemapTypes";
import { SpatialBasemapConsentStore } from "./spatialBasemapConsent";
import { SpatialBasemapTileCache } from "./spatialBasemapTileCache";
import { fetchSpatialBasemapTile } from "./spatialBasemapFetcher";

export type SpatialBasemapOpenStatus =
    | "ready"
    | "consentRequired"
    | "declined"
    | "incompatible"
    | "untrusted"
    | "unavailable";

export interface SpatialBasemapOpenOutcome {
    readonly status: SpatialBasemapOpenStatus;
    readonly handle?: string;
    readonly generation?: number;
    readonly minZoom?: number;
    readonly maxZoom?: number;
}

export interface SpatialBasemapTileOutcome {
    readonly status: "ready" | "notFound" | "cancelled" | "unavailable";
    readonly filePath?: string;
}

export interface SpatialBasemapSessionDeps {
    sources(): readonly SpatialBasemapValidatedSource[];
    consent: SpatialBasemapConsentStore;
    cache: SpatialBasemapTileCache;
    fetcher: SpatialBasemapFetcherDeps;
    isTrusted(): boolean;
    /** Host-owned modal (addendum §4.2). Only called for interactive opens. */
    confirm(source: SpatialBasemapValidatedSource): Promise<boolean>;
    secretFor(credentialRef: string): Promise<string | undefined>;
}

interface BasemapSession {
    readonly handle: string;
    readonly generation: number;
    readonly source: SpatialBasemapValidatedSource;
    inFlight: number;
    tiles: number;
    closed: boolean;
}

export class SpatialBasemapSessionManager {
    private readonly sessions = new Map<string, BasemapSession>();
    private generation = 0;
    private globalInFlight = 0;

    constructor(private readonly deps: SpatialBasemapSessionDeps) {}

    listDescriptors(): readonly SpatialBasemapDescriptor[] {
        return this.deps.sources().map((source) => source.descriptor);
    }

    async open(params: {
        layerId: string;
        activeProjection: "EPSG:4326" | "EPSG:3857" | "planar";
        interactive: boolean;
    }): Promise<SpatialBasemapOpenOutcome> {
        const done = (
            status: SpatialBasemapOpenStatus,
            rest?: Partial<SpatialBasemapOpenOutcome>,
        ) => {
            Perf.marker("mssql.queryResults.spatial.basemap.open", "instant", {
                outcome: status,
                layerClass: "xyzRaster",
            });
            return { status, ...rest };
        };
        if (!this.deps.isTrusted()) {
            return done("untrusted");
        }
        if (params.activeProjection === "planar") {
            return done("incompatible");
        }
        const source = this.deps
            .sources()
            .find((candidate) => candidate.config.id === params.layerId);
        if (!source) {
            return done("unavailable");
        }
        if (!this.deps.consent.has(source.fingerprint)) {
            if (!params.interactive) {
                return done("consentRequired");
            }
            const accepted = await this.deps.confirm(source);
            if (!accepted) {
                return done("declined");
            }
            await this.deps.consent.record(source.fingerprint);
        }
        // One session per source per manager; a re-open retires the old one.
        for (const [handle, session] of this.sessions) {
            if (session.source.config.id === source.config.id) {
                this.close(handle, "layerChange");
            }
        }
        while (this.sessions.size >= SPATIAL_BASEMAP_LIMITS.maxSessions) {
            const oldest = this.sessions.keys().next().value as string | undefined;
            if (oldest === undefined) break;
            this.close(oldest, "expired");
        }
        const handle = `sbm_${crypto.randomBytes(12).toString("base64url")}`;
        const generation = ++this.generation;
        this.sessions.set(handle, {
            handle,
            generation,
            source,
            inFlight: 0,
            tiles: 0,
            closed: false,
        });
        return done("ready", {
            handle,
            generation,
            minZoom: source.descriptor.minZoom,
            maxZoom: source.descriptor.maxZoom,
        });
    }

    async tile(params: {
        handle: string;
        generation: number;
        z: number;
        x: number;
        y: number;
    }): Promise<SpatialBasemapTileOutcome> {
        const startedAt = performance.now();
        const session = this.sessions.get(params.handle);
        const finish = (
            status: SpatialBasemapTileOutcome["status"],
            cache: "memory" | "disk" | "network",
            bytes: number,
            filePath?: string,
        ): SpatialBasemapTileOutcome => {
            Perf.marker("mssql.queryResults.spatial.basemap.tile.end", "instant", {
                cache,
                outcome: status === "ready" ? "ok" : status,
                ms: Math.round((performance.now() - startedAt) * 100) / 100,
                bytes,
            });
            return { status, ...(filePath ? { filePath } : {}) };
        };
        if (!session || session.closed || session.generation !== params.generation) {
            return finish("cancelled", "network", 0);
        }
        const { z, x, y } = params;
        const { minZoom, maxZoom } = session.source.descriptor;
        if (
            !Number.isInteger(z) ||
            !Number.isInteger(x) ||
            !Number.isInteger(y) ||
            z < minZoom ||
            z > maxZoom ||
            x < 0 ||
            y < 0 ||
            x >= 2 ** z ||
            y >= 2 ** z
        ) {
            return finish("unavailable", "network", 0);
        }
        const cached = await this.deps.cache.get(session.source.fingerprint, z, x, y);
        if (cached) {
            session.tiles++;
            return finish("ready", cached.tier, cached.bytes.byteLength, cached.filePath);
        }
        if (
            session.inFlight >= SPATIAL_BASEMAP_LIMITS.perPanelConcurrentFetches ||
            this.globalInFlight >= SPATIAL_BASEMAP_LIMITS.globalConcurrentFetches
        ) {
            // The adapter bounds its own in-flight set; excess here means a
            // stale burst — refuse rather than queue unbounded work.
            return finish("cancelled", "network", 0);
        }
        session.inFlight++;
        this.globalInFlight++;
        try {
            const config = session.source.config;
            const url = config.urlTemplate
                .replace("{z}", String(z))
                .replace("{x}", String(x))
                .replace("{y}", String(y));
            const bearerSecret = config.credentialRef
                ? await this.deps.secretFor(config.credentialRef)
                : undefined;
            const result = await fetchSpatialBasemapTile(
                {
                    url,
                    allowPrivateNetwork: config.allowPrivateNetwork === true,
                    ...(bearerSecret ? { bearerSecret } : {}),
                },
                this.deps.fetcher,
            );
            if (session.closed || session.generation !== params.generation) {
                return finish("cancelled", "network", 0);
            }
            if (result.status !== "ok") {
                return finish(
                    result.status === "notFound" ? "notFound" : "unavailable",
                    "network",
                    0,
                );
            }
            const stored = await this.deps.cache.put(
                session.source.fingerprint,
                z,
                x,
                y,
                result.bytes,
            );
            session.tiles++;
            return finish("ready", "network", result.bytes.byteLength, stored.filePath);
        } finally {
            session.inFlight--;
            this.globalInFlight--;
        }
    }

    close(handle: string, reason: string): void {
        const session = this.sessions.get(handle);
        if (!session) {
            return;
        }
        session.closed = true;
        this.sessions.delete(handle);
        Perf.marker("mssql.queryResults.spatial.basemap.close", "instant", {
            reason,
            tiles: session.tiles,
        });
    }

    dispose(reason: string): void {
        for (const handle of [...this.sessions.keys()]) {
            this.close(handle, reason);
        }
    }
}
