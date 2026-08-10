/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { normalizeSemanticIdentifier } from "./names.js";

export type MetadataQueryKind =
    | "objectByName"
    | "columnsByObject"
    | "routineSignature"
    | "completionChildren";

export interface MetadataQueryRequest {
    readonly connectionId: string;
    readonly database: string;
    readonly catalogVersion?: string | number;
    readonly kind: MetadataQueryKind;
    readonly objectParts?: readonly string[];
    readonly prefixParts?: readonly string[];
    readonly limit?: number;
}

export interface MetadataQueryPlan extends MetadataQueryRequest {
    readonly cacheKey: string;
}

/**
 * Plans metadata work from semantic feature intent. A plan is data, not SQL, so the metadata
 * package or a host can choose its own parameterized query implementation.
 */
export class MetadataQueryPlanner {
    public object(request: Omit<MetadataQueryRequest, "kind">): MetadataQueryPlan {
        return this.planOne({ ...request, kind: "objectByName" });
    }

    public columns(request: Omit<MetadataQueryRequest, "kind">): MetadataQueryPlan {
        return this.planOne({ ...request, kind: "columnsByObject" });
    }

    public routineSignature(request: Omit<MetadataQueryRequest, "kind">): MetadataQueryPlan {
        return this.planOne({ ...request, kind: "routineSignature" });
    }

    public completionChildren(request: Omit<MetadataQueryRequest, "kind">): MetadataQueryPlan {
        return this.planOne({ ...request, kind: "completionChildren" });
    }

    public plan(requests: readonly MetadataQueryRequest[]): readonly MetadataQueryPlan[] {
        const unique = new Map<string, MetadataQueryPlan>();
        for (const request of requests) {
            const plan = this.planOne(request);
            unique.set(plan.cacheKey, plan);
        }
        return Object.freeze([...unique.values()]);
    }

    private planOne(request: MetadataQueryRequest): MetadataQueryPlan {
        validateRequest(request);
        const plan: MetadataQueryPlan = Object.freeze({
            ...request,
            objectParts: request.objectParts ? Object.freeze([...request.objectParts]) : undefined,
            prefixParts: request.prefixParts ? Object.freeze([...request.prefixParts]) : undefined,
            cacheKey: metadataCacheKey(request),
        });
        return plan;
    }
}

/**
 * Stable, non-secret cache key. Connection IDs should be opaque host identifiers rather than
 * connection strings, keeping credentials and endpoints out of logs and memory keys.
 */
export function metadataCacheKey(request: MetadataQueryRequest): string {
    return [
        "metadata",
        encodeSegment(request.connectionId),
        encodeSegment(normalizeSemanticIdentifier(request.database)),
        encodeSegment(String(request.catalogVersion ?? "current")),
        request.kind,
        encodeParts(request.objectParts),
        encodeParts(request.prefixParts),
        String(request.limit ?? ""),
    ].join("|");
}

export interface MetadataPlanExecutor {
    execute<T>(plan: MetadataQueryPlan): Promise<T>;
}

export interface MetadataQueryCacheOptions {
    /** A versioned catalog key may safely use a long TTL; unversioned callers should use a short one. */
    readonly ttlMs?: number;
    readonly now?: () => number;
}

interface CacheValue {
    readonly expiresAt: number;
    readonly value: unknown;
}

/**
 * Coalesces in-flight and recently-completed metadata work. Consequently, repeated completion,
 * hover, and definition requests in one editing burst share a single server call per cache key.
 */
export class MetadataQueryCache {
    private readonly values = new Map<string, CacheValue>();
    private readonly inFlight = new Map<string, Promise<unknown>>();
    private readonly ttlMs: number;
    private readonly now: () => number;

    public constructor(options: MetadataQueryCacheOptions = {}) {
        this.ttlMs = Math.max(0, options.ttlMs ?? 10_000);
        this.now = options.now ?? Date.now;
    }

    public getOrLoad<T>(plan: MetadataQueryPlan, load: () => Promise<T>): Promise<T> {
        const cached = this.values.get(plan.cacheKey);
        if (cached && cached.expiresAt > this.now()) {
            return Promise.resolve(cached.value as T);
        }
        const pending = this.inFlight.get(plan.cacheKey);
        if (pending) {
            return pending as Promise<T>;
        }
        const promise = Promise.resolve()
            .then(load)
            .then((value) => {
                this.values.set(plan.cacheKey, { value, expiresAt: this.now() + this.ttlMs });
                return value;
            })
            .finally(() => this.inFlight.delete(plan.cacheKey));
        this.inFlight.set(plan.cacheKey, promise);
        return promise;
    }

    public invalidate(cacheKey?: string): void {
        if (cacheKey) {
            this.values.delete(cacheKey);
        } else {
            this.values.clear();
        }
    }

    public clearConnection(connectionId: string): void {
        const prefix = `metadata|${encodeSegment(connectionId)}|`;
        for (const key of this.values.keys()) {
            if (key.startsWith(prefix)) this.values.delete(key);
        }
    }
}

export class MetadataQueryCoordinator {
    public constructor(
        private readonly executor: MetadataPlanExecutor,
        private readonly cache = new MetadataQueryCache(),
    ) {}

    public execute<T>(plan: MetadataQueryPlan): Promise<T> {
        return this.cache.getOrLoad(plan, () => this.executor.execute<T>(plan));
    }

    public async executeAll<T>(
        plans: readonly MetadataQueryPlan[],
    ): Promise<ReadonlyMap<string, T>> {
        const entries = await Promise.all(
            plans.map(async (plan) => [plan.cacheKey, await this.execute<T>(plan)] as const),
        );
        return new Map(entries);
    }

    public invalidate(cacheKey?: string): void {
        this.cache.invalidate(cacheKey);
    }
}

function validateRequest(request: MetadataQueryRequest): void {
    if (!request.connectionId)
        throw new Error("A non-secret connectionId is required for metadata caching.");
    if (!request.database) throw new Error("A database is required for metadata planning.");
    if (
        (request.kind === "objectByName" ||
            request.kind === "columnsByObject" ||
            request.kind === "routineSignature") &&
        !request.objectParts?.length
    ) {
        throw new Error(`${request.kind} requires objectParts.`);
    }
    if (request.kind === "completionChildren" && request.objectParts?.length) {
        throw new Error("completionChildren accepts prefixParts, not objectParts.");
    }
}

function encodeParts(parts: readonly string[] | undefined): string {
    return (parts ?? []).map(normalizeSemanticIdentifier).map(encodeSegment).join(".");
}

function encodeSegment(value: string): string {
    return encodeURIComponent(value);
}
