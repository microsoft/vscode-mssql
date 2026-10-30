/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Bounded tile cache (SPA-10 / D-0028, addendum §7.3). Memory LRU plus a
 * persistent tier under a DEDICATED cache root (the only directory the
 * Query Studio webview gains as a local resource). Entries are keyed by an
 * HMAC of the source fingerprint and z/x/y with a per-install random key —
 * never a raw provider URL — so cache paths reveal neither endpoints nor
 * browsing patterns. Cache metadata is viewed-area history: it never reaches
 * telemetry (only value-free hit/miss buckets do).
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { SPATIAL_BASEMAP_LIMITS } from "./spatialBasemapTypes";

export interface SpatialBasemapTileCacheOptions {
    readonly root: string;
    /** Per-install random key (stored in globalState, not a secret). */
    readonly hmacKey: string;
    readonly maxDiskBytes: number;
    readonly maxAgeMs: number;
    readonly maxMemoryBytes?: number;
}

export interface SpatialBasemapCachedTile {
    readonly bytes: Uint8Array;
    readonly filePath: string;
}

export class SpatialBasemapTileCache {
    private readonly memory = new Map<string, Uint8Array>();
    private memoryBytes = 0;

    constructor(private readonly options: SpatialBasemapTileCacheOptions) {}

    private key(fingerprint: string, z: number, x: number, y: number): string {
        return crypto
            .createHmac("sha256", this.options.hmacKey)
            .update(`${fingerprint}:${z}/${x}/${y}`)
            .digest("hex");
    }

    private filePathFor(key: string): string {
        // Two-level fanout keeps directories small without leaking structure.
        return path.join(this.options.root, key.slice(0, 2), `${key}.tile`);
    }

    /** Memory first, then disk (age-checked). Returns the DISK path for URI handoff. */
    async get(
        fingerprint: string,
        z: number,
        x: number,
        y: number,
    ): Promise<(SpatialBasemapCachedTile & { tier: "memory" | "disk" }) | undefined> {
        const key = this.key(fingerprint, z, x, y);
        const filePath = this.filePathFor(key);
        const memory = this.memory.get(key);
        if (memory) {
            // Refresh LRU order.
            this.memory.delete(key);
            this.memory.set(key, memory);
            if (fs.existsSync(filePath)) {
                return { bytes: memory, filePath, tier: "memory" };
            }
            // Disk copy evicted/cleared externally: rewrite it so the webview
            // URI stays valid, then serve.
            await this.writeFile(filePath, memory);
            return { bytes: memory, filePath, tier: "memory" };
        }
        try {
            const stat = await fs.promises.stat(filePath);
            if (Date.now() - stat.mtimeMs > this.options.maxAgeMs) {
                await fs.promises.rm(filePath, { force: true });
                return undefined;
            }
            const bytes = new Uint8Array(await fs.promises.readFile(filePath));
            this.putMemory(key, bytes);
            return { bytes, filePath, tier: "disk" };
        } catch {
            return undefined;
        }
    }

    async put(
        fingerprint: string,
        z: number,
        x: number,
        y: number,
        bytes: Uint8Array,
    ): Promise<SpatialBasemapCachedTile> {
        const key = this.key(fingerprint, z, x, y);
        const filePath = this.filePathFor(key);
        this.putMemory(key, bytes);
        await this.writeFile(filePath, bytes);
        return { bytes, filePath };
    }

    private putMemory(key: string, bytes: Uint8Array): void {
        const budget = this.options.maxMemoryBytes ?? SPATIAL_BASEMAP_LIMITS.memoryCacheBytes;
        if (bytes.byteLength > budget) {
            return;
        }
        const existing = this.memory.get(key);
        if (existing) {
            this.memory.delete(key);
            this.memoryBytes -= existing.byteLength;
        }
        this.memory.set(key, bytes);
        this.memoryBytes += bytes.byteLength;
        while (this.memoryBytes > budget) {
            const oldest = this.memory.keys().next().value as string | undefined;
            if (oldest === undefined) break;
            const evicted = this.memory.get(oldest);
            this.memory.delete(oldest);
            this.memoryBytes -= evicted?.byteLength ?? 0;
        }
    }

    private async writeFile(filePath: string, bytes: Uint8Array): Promise<void> {
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, bytes);
    }

    /** Byte-budget then age eviction; returns surviving byte count. */
    async evict(): Promise<number> {
        const files: { filePath: string; bytes: number; mtimeMs: number }[] = [];
        const now = Date.now();
        const walk = async (dir: string): Promise<void> => {
            let entries: fs.Dirent[];
            try {
                entries = await fs.promises.readdir(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    await walk(full);
                } else if (entry.name.endsWith(".tile")) {
                    try {
                        const stat = await fs.promises.stat(full);
                        if (now - stat.mtimeMs > this.options.maxAgeMs) {
                            await fs.promises.rm(full, { force: true });
                        } else {
                            files.push({ filePath: full, bytes: stat.size, mtimeMs: stat.mtimeMs });
                        }
                    } catch {
                        // Removed concurrently — nothing to account for.
                    }
                }
            }
        };
        await walk(this.options.root);
        files.sort((left, right) => left.mtimeMs - right.mtimeMs);
        let total = files.reduce((sum, file) => sum + file.bytes, 0);
        for (const file of files) {
            if (total <= this.options.maxDiskBytes) break;
            await fs.promises.rm(file.filePath, { force: true });
            total -= file.bytes;
        }
        return total;
    }

    /** `Clear Spatial Map Cache` command: removes every cached tile. */
    async clearAll(): Promise<void> {
        this.memory.clear();
        this.memoryBytes = 0;
        await fs.promises.rm(this.options.root, { recursive: true, force: true });
        await fs.promises.mkdir(this.options.root, { recursive: true });
    }

    async diskBytes(): Promise<number> {
        let total = 0;
        const walk = async (dir: string): Promise<void> => {
            let entries: fs.Dirent[];
            try {
                entries = await fs.promises.readdir(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    await walk(full);
                } else {
                    try {
                        total += (await fs.promises.stat(full)).size;
                    } catch {
                        // Removed concurrently.
                    }
                }
            }
        };
        await walk(this.options.root);
        return total;
    }
}
