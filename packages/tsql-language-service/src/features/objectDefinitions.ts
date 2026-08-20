/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Identity of a catalog object whose definition a host can fetch. Nothing here names a transport:
 * a host may script the object, read its stored module text, or serve it from a project file.
 */
export interface ObjectDefinitionDescriptor {
    readonly database?: string;
    readonly schema: string;
    readonly name: string;
    /** A `SqlObjectKind`, kept as a string so hosts may carry kinds the catalog does not model. */
    readonly kind: string;
    /** Distinguishes alias, CLR, and table user types when `kind` is `type`. */
    readonly typeCategory?: string;
}

export interface ObjectDefinitionRequest extends ObjectDefinitionDescriptor {
    /** Identifies the connection the object belongs to, so results never cross connections. */
    readonly connectionId: string;
    /** Metadata generation the request was made against; a later generation invalidates a cache. */
    readonly metadataGeneration?: number;
}

export interface ObjectDefinitionResult {
    readonly text: string;
    /**
     * UTF-16 offset of the statement that defines the object, when the provider can identify it.
     * A host uses it to select the definition rather than the top of a longer script.
     */
    readonly definitionOffset?: number;
}

export interface ObjectDefinitionProvider {
    getDefinition(
        request: ObjectDefinitionRequest,
        signal?: AbortSignal,
    ): Promise<ObjectDefinitionResult | undefined>;
}

/** Offline default. A document still navigates to its own declarations without one of these. */
export class NullObjectDefinitionProvider implements ObjectDefinitionProvider {
    public async getDefinition(): Promise<undefined> {
        return undefined;
    }
}

/** Fixed definitions for tests and offline hosts, keyed the same way a real provider is. */
export class InMemoryObjectDefinitionProvider implements ObjectDefinitionProvider {
    private readonly _entries = new Map<string, ObjectDefinitionResult>();

    public constructor(entries: Iterable<[ObjectDefinitionDescriptor, string]> = []) {
        for (const [descriptor, text] of entries) this.set(descriptor, text);
    }

    public set(descriptor: ObjectDefinitionDescriptor, text: string): void {
        this._entries.set(objectDefinitionKey(descriptor), Object.freeze({ text }));
    }

    public async getDefinition(
        request: ObjectDefinitionRequest,
    ): Promise<ObjectDefinitionResult | undefined> {
        return this._entries.get(objectDefinitionKey(request));
    }
}

export interface ObjectDefinitionCacheOptions {
    /** Entries retained before the least recently used one is dropped. */
    readonly maxEntries?: number;
}

interface DefinitionCacheEntry {
    readonly controller: AbortController;
    readonly pending: Promise<ObjectDefinitionResult | undefined>;
    waiters: number;
    settled: boolean;
}

/**
 * Remembers definitions per connection, database, object identity, and metadata generation. A
 * request carrying a newer generation misses, so a refreshed catalog or executed DDL is never
 * answered from a stale script. Concurrent requests for one object share a single fetch.
 */
export class CachedObjectDefinitionProvider implements ObjectDefinitionProvider {
    private readonly _entries = new Map<string, DefinitionCacheEntry>();
    private readonly _maxEntries: number;

    public constructor(
        private readonly _inner: ObjectDefinitionProvider,
        options: ObjectDefinitionCacheOptions = {},
    ) {
        this._maxEntries = Math.max(1, options.maxEntries ?? 64);
    }

    public async getDefinition(
        request: ObjectDefinitionRequest,
        signal?: AbortSignal,
    ): Promise<ObjectDefinitionResult | undefined> {
        if (signal?.aborted) throw cancellationError();
        const key = cacheKey(request);
        let entry = this._entries.get(key);
        if (entry) {
            // Refresh recency so a definition in active use outlives one looked at once.
            this._entries.delete(key);
            this._entries.set(key, entry);
        } else {
            entry = this.createEntry(key, request);
            this._entries.set(key, entry);
        }

        entry.waiters++;
        this.trim();
        try {
            return await abortable(entry.pending, signal);
        } finally {
            entry.waiters--;
            // Do not leave abandoned scripting work running. A shared request remains alive while
            // at least one independent caller is still waiting for it.
            if (!entry.settled && entry.waiters === 0) {
                if (this._entries.get(key) === entry) this._entries.delete(key);
                entry.controller.abort();
            }
            this.trim();
        }
    }

    private createEntry(key: string, request: ObjectDefinitionRequest): DefinitionCacheEntry {
        const controller = new AbortController();
        let entry!: DefinitionCacheEntry;
        const pending = this._inner.getDefinition(request, controller.signal).then(
            (result) => {
                entry.settled = true;
                // Nothing found is not an answer worth remembering: the object may appear later,
                // and a later request must be free to look again.
                if (!result && this._entries.get(key) === entry) this._entries.delete(key);
                return result;
            },
            (error: unknown) => {
                entry.settled = true;
                // A failure must not be remembered, or a transient error would outlive its cause.
                if (this._entries.get(key) === entry) this._entries.delete(key);
                throw error;
            },
        );
        entry = { controller, pending, waiters: 0, settled: false };
        return entry;
    }

    private trim(): void {
        while (this._entries.size > this._maxEntries) {
            const oldest = [...this._entries].find(([, candidate]) => candidate.waiters === 0);
            if (!oldest) break;
            const [key, evicted] = oldest;
            this._entries.delete(key);
            if (!evicted.settled) evicted.controller.abort();
        }
    }

    /** Drops everything, or everything belonging to one connection. */
    public invalidate(connectionId?: string): void {
        if (connectionId === undefined) {
            for (const entry of this._entries.values()) {
                if (!entry.settled) entry.controller.abort();
            }
            this._entries.clear();
            return;
        }
        const prefix = `${encode(connectionId)}${separator}`;
        for (const key of [...this._entries.keys()]) {
            if (!key.startsWith(prefix)) continue;
            const entry = this._entries.get(key);
            this._entries.delete(key);
            if (entry && !entry.settled) entry.controller.abort();
        }
    }

    public get size(): number {
        return this._entries.size;
    }
}

/** Stops waiting when this caller gives up, leaving the shared work to finish for the others. */
function abortable<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return pending;
    if (signal.aborted) return Promise.reject(cancellationError());
    return new Promise<T>((resolve, reject) => {
        const abort = (): void => reject(cancellationError());
        signal.addEventListener("abort", abort, { once: true });
        pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
}

function cancellationError(): Error {
    const error = new Error("Object definition request was cancelled");
    error.name = "AbortError";
    return error;
}

/** Identity of an object, independent of the connection it was requested through. */
export function objectDefinitionKey(descriptor: ObjectDefinitionDescriptor): string {
    return [
        encode(descriptor.database?.toLowerCase() ?? ""),
        encode(descriptor.schema.toLowerCase()),
        encode(descriptor.name.toLowerCase()),
        encode(descriptor.kind.toLowerCase()),
        encode(descriptor.typeCategory?.toLowerCase() ?? ""),
    ].join(separator);
}

function cacheKey(request: ObjectDefinitionRequest): string {
    return [
        encode(request.connectionId),
        objectDefinitionKey(request),
        request.metadataGeneration ?? -1,
    ].join(separator);
}

/**
 * Field separator for a cache key. NUL cannot occur in a SQL identifier, so it separates fields
 * without ambiguity; it is written as an escape so this file stays reviewable text.
 */
const separator = "\u0000";

/** Keeps a separator inside a name from colliding with the separator between fields. */
function encode(value: string): string {
    return value.replaceAll(separator, separator + separator);
}
