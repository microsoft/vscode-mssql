/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Persistent metadata cache — filesystem layer (CACHE-2; cache/drift design
 * §7.1/§9/§15, review addendum C-10/H-4/H-10). Everything runs over an
 * injectable FsLike so unit tests drive torn writes, EPERM retries, and
 * two-writer races without touching a real disk.
 *
 * Layout (base §7.1):
 *   <root>/v1/index.json
 *   <root>/v1/servers/<sfp>/...                      (server catalog, later)
 *   <root>/v1/databases/<sfp>/<dbh>/manifest.json
 *   <root>/v1/databases/<sfp>/<dbh>/catalog.json.gz
 *
 * databaseHash (C-10, exact recipe):
 *   "dbh_" + b64url(sha256(serverFingerprint + "\u0000" + exactDatabaseName)).slice(0, 22)
 * — salted with the server fingerprint so identical database names on
 * different servers cannot be correlated from a disk listing. Exact
 * spelling lives ONLY inside the manifest (databaseExact), never in paths.
 *
 * Atomic writes (base §9.1 + H-4): temp files live in the SAME directory as
 * their target, named <target>.<pid>.<nonce>.tmp; the payload handle is
 * fsync'd before rename; renames retry up to 3x with 50/150/400ms jittered
 * backoff on EPERM/EBUSY/EACCES (Windows antivirus/indexer reality);
 * manifest renames LAST. Readers trust only sha256-verified payloads —
 * every readable state is a complete old entry, a complete new entry, or a
 * clean quarantined miss; never partial data, never a throw.
 *
 * index.json (C-10): quick status/eviction metadata, rebuilt by scanning
 * manifests whenever corrupt or missing — never by trusting payload files
 * without manifests. lastAccessUtc updates on load, persisted with a ≥60s
 * debounce.
 *
 * Eviction (base §15.2 + H-10): corrupt/unsupported entries first, then max
 * age, then total-bytes LRU. Async and throttled (≤1 fs-op burst per 25ms),
 * and NEVER self-starting — the host calls runEviction() explicitly after
 * activation completes, and the coordinator kicks it after saves. Clears
 * delete manifests first, payloads second (a payload without a manifest is
 * by definition garbage and the next cleanup sweeps it).
 */

import { createHash } from "crypto";
import { gunzip as gunzipCb, gzip as gzipCb } from "zlib";
import { promisify } from "util";
import { diag, RawField } from "../../../diagnostics/diagnosticsCore";
import { CatalogCachePayloadV1, validatePayload } from "./metadataCacheCodec";
import { CatalogCacheManifest, validateManifest } from "./metadataCacheManifest";

const gzipAsync = promisify(gzipCb);
const gunzipAsync = promisify(gunzipCb);

// ---------------------------------------------------------------------------
// FsLike (injectable filesystem)
// ---------------------------------------------------------------------------

export interface FsLike {
    /** Rejects when the file does not exist. */
    readFile(path: string): Promise<Uint8Array>;
    /**
     * Write + flush-to-disk (fsync) + close — the temp-file write of the
     * atomic protocol (base §9.1 steps 2–3/6–7).
     */
    writeFileSynced(path: string, data: Uint8Array): Promise<void>;
    /** Atomic same-directory replace (MoveFileExW REPLACE_EXISTING on win). */
    rename(fromPath: string, toPath: string): Promise<void>;
    unlink(path: string): Promise<void>;
    /** Recursive create; succeeds when the directory already exists. */
    mkdirp(path: string): Promise<void>;
    /** Immediate child names; empty array when the directory is missing. */
    readdir(path: string): Promise<string[]>;
    /** undefined when the path does not exist. */
    stat(path: string): Promise<{ readonly size: number } | undefined>;
}

/** Real implementation over node fs/promises. */
export class NodeFsLike implements FsLike {
    async readFile(path: string): Promise<Uint8Array> {
        const fs = await import("fs/promises");
        return fs.readFile(path);
    }

    async writeFileSynced(path: string, data: Uint8Array): Promise<void> {
        const fs = await import("fs/promises");
        const handle = await fs.open(path, "w");
        try {
            await handle.writeFile(data);
            await handle.sync();
        } finally {
            await handle.close();
        }
    }

    async rename(fromPath: string, toPath: string): Promise<void> {
        const fs = await import("fs/promises");
        await fs.rename(fromPath, toPath);
    }

    async unlink(path: string): Promise<void> {
        const fs = await import("fs/promises");
        await fs.unlink(path);
    }

    async mkdirp(path: string): Promise<void> {
        const fs = await import("fs/promises");
        await fs.mkdir(path, { recursive: true });
    }

    async readdir(path: string): Promise<string[]> {
        const fs = await import("fs/promises");
        try {
            return await fs.readdir(path);
        } catch {
            return [];
        }
    }

    async stat(path: string): Promise<{ readonly size: number } | undefined> {
        const fs = await import("fs/promises");
        try {
            const stats = await fs.stat(path);
            return { size: stats.size };
        } catch {
            return undefined;
        }
    }
}

// ---------------------------------------------------------------------------
// Keys, hashes, paths
// ---------------------------------------------------------------------------

export interface CacheEntryKey {
    readonly serverFingerprint: string;
    /** Exact database spelling (byte-exact, never folded). */
    readonly database: string;
}

/** C-10 recipe, verbatim. Do NOT reuse pfp_ — it hashes more than this. */
export function computeDatabaseHash(serverFingerprint: string, exactDatabaseName: string): string {
    const digest = createHash("sha256")
        .update(serverFingerprint + "\u0000" + exactDatabaseName, "utf8")
        .digest("base64url");
    return `dbh_${digest.slice(0, 22)}`;
}

/**
 * Path segment for a server fingerprint. Real fingerprints are
 * `sfp_<22 b64url>` and pass through verbatim; anything containing other
 * characters (test doubles, future formats) is re-hashed into a safe
 * segment so no fingerprint content can ever traverse or break a path.
 */
export function serverFingerprintSegment(serverFingerprint: string): string {
    if (/^[A-Za-z0-9_-]+$/.test(serverFingerprint)) {
        return serverFingerprint;
    }
    const digest = createHash("sha256").update(serverFingerprint, "utf8").digest("base64url");
    return `sfx_${digest.slice(0, 22)}`;
}

export type CacheMissReason =
    | "disabled"
    | "missing"
    | "shape"
    | "formatVersion"
    | "codec"
    | "modelVersion"
    | "payloadMissing"
    | "shaMismatch"
    | "corrupt";

export type CacheReadResult =
    | {
          readonly kind: "hit";
          readonly manifest: CatalogCacheManifest;
          readonly payload: CatalogCachePayloadV1;
          readonly payloadBytes: number;
      }
    | { readonly kind: "miss"; readonly reason: CacheMissReason };

export interface WriteOutcome {
    readonly ok: boolean;
    readonly skipped?: "entryTooLarge";
    readonly errorClass?: "renameFailed" | "ioError";
    readonly payloadBytes?: number;
    readonly sha256?: string;
}

export interface EvictionSummary {
    readonly removedCorrupt: number;
    readonly removedAged: number;
    readonly removedForBytes: number;
    readonly totalBytesAfter: number;
}

/**
 * One current disk entry with its EXACT key material (from the manifest's
 * databaseExact). LOCAL pickers only — database names must never be logged
 * from this shape (base §8.3; events use hash prefixes).
 */
export interface CacheEntryListing {
    readonly key: CacheEntryKey;
    readonly capturedAtUtc: string;
    readonly payloadBytes: number;
}

interface CacheIndexEntry {
    serverFingerprint: string;
    databaseHash: string;
    kind: "database" | "server";
    capturedAtUtc: string;
    lastAccessUtc: string;
    payloadBytes: number;
    contentHash: string;
}

interface CacheIndex {
    formatVersion: 1;
    entries: CacheIndexEntry[];
    totalBytes: number;
}

export interface MetadataCacheStoreOptions {
    /** Fs-op burst spacing during eviction/clears (H-10; default 25ms). */
    readonly throttleMs?: number;
    /** Rename retry backoff bases (H-4.2; default [50, 150, 400]). */
    readonly renameBackoffMs?: readonly number[];
    /** Injectable sleep/clock/randomness for deterministic tests. */
    readonly sleep?: (ms: number) => Promise<void>;
    readonly now?: () => number;
    readonly random?: () => number;
}

const MANIFEST_FILE = "manifest.json";
const PAYLOAD_FILE = "catalog.json.gz";
const INDEX_ACCESS_DEBOUNCE_MS = 60_000;
const RENAME_RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

const defaultSleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        (timer as { unref?: () => void }).unref?.();
    });

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class MetadataCacheStore {
    private readonly root: string;
    private readonly throttleMs: number;
    private readonly backoffs: readonly number[];
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly now: () => number;
    private readonly random: () => number;
    private nonceCounter = 0;
    private index: CacheIndex | undefined;
    private lastIndexPersistMs = 0;
    private evictionInFlight: Promise<EvictionSummary> | undefined;

    constructor(
        private readonly fs: FsLike,
        rootDir: string,
        options: MetadataCacheStoreOptions = {},
    ) {
        this.root = rootDir.replace(/\\/g, "/").replace(/\/+$/, "");
        this.throttleMs = options.throttleMs ?? 25;
        this.backoffs = options.renameBackoffMs ?? [50, 150, 400];
        this.sleep = options.sleep ?? defaultSleep;
        this.now = options.now ?? (() => Date.now());
        this.random = options.random ?? (() => Math.random());
    }

    // -- paths ----------------------------------------------------------------

    private joinPath(...parts: string[]): string {
        return [this.root, "v1", ...parts].join("/");
    }

    private entryDir(key: CacheEntryKey): string {
        return this.joinPath(
            "databases",
            serverFingerprintSegment(key.serverFingerprint),
            computeDatabaseHash(key.serverFingerprint, key.database),
        );
    }

    private get indexPath(): string {
        return this.joinPath("index.json");
    }

    private tempName(target: string): string {
        this.nonceCounter++;
        const nonce = `${this.now().toString(36)}${this.nonceCounter.toString(36)}${Math.floor(
            this.random() * 36 ** 4,
        ).toString(36)}`;
        return `${target}.${process.pid}.${nonce}.tmp`;
    }

    // -- read protocol (base §9.2) ---------------------------------------------

    /** Current manifest, validated — undefined when missing or invalid. */
    async readManifest(key: CacheEntryKey): Promise<CatalogCacheManifest | undefined> {
        const parsed = await this.readJson(`${this.entryDir(key)}/${MANIFEST_FILE}`);
        if (parsed === undefined) {
            return undefined;
        }
        const validated = validateManifest(parsed);
        return validated.ok ? validated.manifest : undefined;
    }

    async readEntry(key: CacheEntryKey): Promise<CacheReadResult> {
        const dir = this.entryDir(key);
        const manifestPath = `${dir}/${MANIFEST_FILE}`;
        const payloadPath = `${dir}/${PAYLOAD_FILE}`;
        let manifestBytes: Uint8Array;
        try {
            manifestBytes = await this.fs.readFile(manifestPath);
        } catch {
            return { kind: "miss", reason: "missing" };
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(Buffer.from(manifestBytes).toString("utf8"));
        } catch {
            await this.quarantineEntry(key, "manifestUnparsable");
            return { kind: "miss", reason: "shape" };
        }
        const validated = validateManifest(parsed);
        if (validated.ok === false) {
            // Version/codec/model mismatches are clean misses — leave the
            // files for eviction's unsupported-first sweep, do not destroy.
            return { kind: "miss", reason: validated.reason };
        }
        const manifest = validated.manifest;
        let payloadGz: Uint8Array;
        try {
            payloadGz = await this.fs.readFile(payloadPath);
        } catch {
            return { kind: "miss", reason: "payloadMissing" };
        }
        const sha = createHash("sha256").update(payloadGz).digest("hex");
        if (sha !== manifest.payload.sha256) {
            await this.quarantineEntry(key, "shaMismatch");
            return { kind: "miss", reason: "shaMismatch" };
        }
        let payloadJson: string;
        try {
            payloadJson = (await gunzipAsync(Buffer.from(payloadGz))).toString("utf8");
        } catch {
            await this.quarantineEntry(key, "gunzipFailed");
            return { kind: "miss", reason: "corrupt" };
        }
        let payloadValue: unknown;
        try {
            payloadValue = JSON.parse(payloadJson);
        } catch {
            await this.quarantineEntry(key, "payloadUnparsable");
            return { kind: "miss", reason: "corrupt" };
        }
        const payload = validatePayload(payloadValue, {
            descriptionsExpected: manifest.privacy.includesDescriptions,
        });
        if (!payload.ok) {
            await this.quarantineEntry(key, "payloadShape");
            return { kind: "miss", reason: "shape" };
        }
        await this.touchAccess(manifest);
        return {
            kind: "hit",
            manifest,
            payload: payload.payload,
            payloadBytes: payloadGz.length,
        };
    }

    /**
     * Quarantine an invalid entry (base §9.2 "delete or quarantine when
     * safe"): the payload is renamed aside so a postmortem can inspect it,
     * the manifest is deleted (manifest-first discipline — an entry without
     * a manifest is inert garbage). All best-effort; never throws.
     */
    private async quarantineEntry(key: CacheEntryKey, why: string): Promise<void> {
        const dir = this.entryDir(key);
        try {
            await this.fs.unlink(`${dir}/${MANIFEST_FILE}`);
        } catch {
            /* best-effort */
        }
        const payloadPath = `${dir}/${PAYLOAD_FILE}`;
        try {
            await this.fs.rename(payloadPath, `${payloadPath}.quarantine`);
        } catch {
            try {
                await this.fs.unlink(payloadPath);
            } catch {
                /* best-effort */
            }
        }
        this.emitEvent("metadataCache.corrupt", {
            ...this.keyFields(key),
            errorClass: { raw: why, cls: "diagnostic.metadata" },
        });
    }

    // -- write protocol (base §9.1 + H-4) ---------------------------------------

    /**
     * Full entry write: gzip payload → temp+fsync → sha → rename payload →
     * build manifest → temp+fsync → rename manifest LAST. The compressed
     * size is checked against maxEntryBytes BEFORE any file is touched
     * (H-7). A save failure is an outcome, never a throw.
     */
    async writeEntry(
        key: CacheEntryKey,
        payloadJson: string,
        manifestFor: (payloadInfo: {
            readonly sha256: string;
            readonly payloadBytes: number;
            readonly uncompressedBytes: number;
        }) => CatalogCacheManifest,
        options?: { readonly maxEntryBytes?: number },
    ): Promise<WriteOutcome> {
        let gz: Buffer;
        try {
            gz = await gzipAsync(Buffer.from(payloadJson, "utf8"));
        } catch {
            return { ok: false, errorClass: "ioError" };
        }
        if (options?.maxEntryBytes !== undefined && gz.length > options.maxEntryBytes) {
            return { ok: false, skipped: "entryTooLarge", payloadBytes: gz.length };
        }
        const dir = this.entryDir(key);
        const payloadPath = `${dir}/${PAYLOAD_FILE}`;
        const manifestPath = `${dir}/${MANIFEST_FILE}`;
        const sha256 = createHash("sha256").update(gz).digest("hex");
        const manifest = manifestFor({
            sha256,
            payloadBytes: gz.length,
            uncompressedBytes: Buffer.byteLength(payloadJson, "utf8"),
        });
        const payloadTemp = this.tempName(payloadPath);
        try {
            await this.fs.mkdirp(dir);
            await this.fs.writeFileSynced(payloadTemp, gz);
        } catch {
            await this.removeQuietly(payloadTemp);
            return { ok: false, errorClass: "ioError" };
        }
        if (!(await this.renameWithRetry(payloadTemp, payloadPath))) {
            await this.removeQuietly(payloadTemp);
            return { ok: false, errorClass: "renameFailed" };
        }
        const manifestOutcome = await this.writeManifestFile(manifestPath, manifest);
        if (manifestOutcome.ok === false) {
            return { ok: false, errorClass: manifestOutcome.errorClass, payloadBytes: gz.length };
        }
        await this.upsertIndexEntry(manifest, gz.length);
        return { ok: true, sha256, payloadBytes: gz.length };
    }

    /**
     * Manifest-only rewrite (addendum §5.5): when a refresh confirmed no
     * content change, only the validation block moves — same temp+fsync+
     * rename-last protocol, no payload write.
     */
    async rewriteManifest(
        key: CacheEntryKey,
        manifest: CatalogCacheManifest,
    ): Promise<WriteOutcome> {
        const dir = this.entryDir(key);
        try {
            await this.fs.mkdirp(dir);
        } catch {
            return { ok: false, errorClass: "ioError" };
        }
        const outcome = await this.writeManifestFile(`${dir}/${MANIFEST_FILE}`, manifest);
        if (outcome.ok) {
            await this.upsertIndexEntry(manifest, manifest.stats.payloadBytes);
        }
        return outcome;
    }

    private async writeManifestFile(
        manifestPath: string,
        manifest: CatalogCacheManifest,
    ): Promise<{ ok: true } | { ok: false; errorClass: "renameFailed" | "ioError" }> {
        const temp = this.tempName(manifestPath);
        try {
            await this.fs.writeFileSynced(
                temp,
                Buffer.from(JSON.stringify(manifest, undefined, 2), "utf8"),
            );
        } catch {
            await this.removeQuietly(temp);
            return { ok: false, errorClass: "ioError" };
        }
        if (!(await this.renameWithRetry(temp, manifestPath))) {
            await this.removeQuietly(temp);
            return { ok: false, errorClass: "renameFailed" };
        }
        return { ok: true };
    }

    /**
     * H-4.2: Windows AV/indexers cause transient EPERM/EBUSY/EACCES on
     * replace-rename. Retry up to 3x with 50/150/400ms jittered backoff
     * (±25%) before declaring the save failed. Non-transient errors fail
     * immediately.
     */
    private async renameWithRetry(fromPath: string, toPath: string): Promise<boolean> {
        for (let attempt = 0; ; attempt++) {
            try {
                await this.fs.rename(fromPath, toPath);
                return true;
            } catch (error) {
                const code = (error as { code?: string }).code;
                if (!code || !RENAME_RETRY_CODES.has(code) || attempt >= this.backoffs.length) {
                    return false;
                }
                const base = this.backoffs[attempt];
                await this.sleep(base * (0.75 + this.random() * 0.5));
            }
        }
    }

    private async removeQuietly(path: string): Promise<void> {
        try {
            await this.fs.unlink(path);
        } catch {
            /* best-effort */
        }
    }

    // -- index (C-10) -----------------------------------------------------------

    private async readJson(path: string): Promise<unknown | undefined> {
        try {
            const bytes = await this.fs.readFile(path);
            return JSON.parse(Buffer.from(bytes).toString("utf8"));
        } catch {
            return undefined;
        }
    }

    private validIndex(value: unknown): CacheIndex | undefined {
        if (typeof value !== "object" || value === null) {
            return undefined;
        }
        const record = value as Record<string, unknown>;
        if (record["formatVersion"] !== 1 || !Array.isArray(record["entries"])) {
            return undefined;
        }
        for (const entry of record["entries"]) {
            if (
                typeof entry !== "object" ||
                entry === null ||
                typeof (entry as Record<string, unknown>)["serverFingerprint"] !== "string" ||
                typeof (entry as Record<string, unknown>)["databaseHash"] !== "string" ||
                typeof (entry as Record<string, unknown>)["payloadBytes"] !== "number"
            ) {
                return undefined;
            }
        }
        return value as CacheIndex;
    }

    /** Load (or rebuild) the index. Corrupt/missing ⇒ rebuild from manifests. */
    async getIndex(): Promise<{ entries: readonly CacheIndexEntry[]; totalBytes: number }> {
        if (!this.index) {
            const loaded = this.validIndex(await this.readJson(this.indexPath));
            this.index = loaded ?? (await this.rebuildIndex());
        }
        return { entries: this.index.entries, totalBytes: this.index.totalBytes };
    }

    /**
     * Rebuild by scanning MANIFESTS (C-10) — payload files without
     * manifests are garbage and contribute nothing.
     */
    private async rebuildIndex(): Promise<CacheIndex> {
        const entries: CacheIndexEntry[] = [];
        for (const scanned of await this.scanEntries()) {
            if (!scanned.manifest) {
                continue;
            }
            entries.push({
                serverFingerprint: scanned.manifest.key.serverFingerprint,
                databaseHash: scanned.manifest.key.databaseHash,
                kind: "database",
                capturedAtUtc: scanned.manifest.capture.capturedAtUtc,
                lastAccessUtc: scanned.manifest.capture.capturedAtUtc,
                payloadBytes: scanned.manifest.stats.payloadBytes,
                contentHash: scanned.manifest.payload.contentHash,
            });
        }
        const index: CacheIndex = {
            formatVersion: 1,
            entries,
            totalBytes: entries.reduce((sum, entry) => sum + entry.payloadBytes, 0),
        };
        await this.persistIndex(index);
        return index;
    }

    private async persistIndex(index: CacheIndex): Promise<void> {
        this.index = index;
        this.lastIndexPersistMs = this.now();
        const temp = this.tempName(this.indexPath);
        try {
            await this.fs.mkdirp(this.joinPath());
            await this.fs.writeFileSynced(
                temp,
                Buffer.from(JSON.stringify(index, undefined, 2), "utf8"),
            );
            if (!(await this.renameWithRetry(temp, this.indexPath))) {
                await this.removeQuietly(temp);
            }
        } catch {
            await this.removeQuietly(temp);
        }
    }

    private async upsertIndexEntry(
        manifest: CatalogCacheManifest,
        payloadBytes: number,
    ): Promise<void> {
        await this.getIndex();
        const index = this.index!;
        const existing = index.entries.find(
            (entry) =>
                entry.serverFingerprint === manifest.key.serverFingerprint &&
                entry.databaseHash === manifest.key.databaseHash,
        );
        const nowIso = new Date(this.now()).toISOString();
        if (existing) {
            existing.capturedAtUtc = manifest.capture.capturedAtUtc;
            existing.lastAccessUtc = nowIso;
            existing.payloadBytes = payloadBytes;
            existing.contentHash = manifest.payload.contentHash;
        } else {
            index.entries.push({
                serverFingerprint: manifest.key.serverFingerprint,
                databaseHash: manifest.key.databaseHash,
                kind: "database",
                capturedAtUtc: manifest.capture.capturedAtUtc,
                lastAccessUtc: nowIso,
                payloadBytes,
                contentHash: manifest.payload.contentHash,
            });
        }
        index.totalBytes = index.entries.reduce((sum, entry) => sum + entry.payloadBytes, 0);
        await this.persistIndex(index);
    }

    /** lastAccess bump on load; disk write debounced ≥60s (C-10). */
    private async touchAccess(manifest: CatalogCacheManifest): Promise<void> {
        await this.getIndex();
        const index = this.index!;
        const entry = index.entries.find(
            (item) =>
                item.serverFingerprint === manifest.key.serverFingerprint &&
                item.databaseHash === manifest.key.databaseHash,
        );
        if (!entry) {
            await this.upsertIndexEntry(manifest, manifest.stats.payloadBytes);
            return;
        }
        entry.lastAccessUtc = new Date(this.now()).toISOString();
        if (this.now() - this.lastIndexPersistMs >= INDEX_ACCESS_DEBOUNCE_MS) {
            await this.persistIndex(index);
        }
    }

    // -- clears (H-10: manifests first, payloads second) -------------------------

    async clearAll(): Promise<void> {
        const scanned = await this.scanEntries();
        for (const entry of scanned) {
            await this.removeQuietly(`${entry.dir}/${MANIFEST_FILE}`);
            await this.throttle();
        }
        for (const entry of scanned) {
            for (const file of entry.files) {
                if (file !== MANIFEST_FILE) {
                    await this.removeQuietly(`${entry.dir}/${file}`);
                }
            }
            await this.throttle();
        }
        await this.persistIndex({ formatVersion: 1, entries: [], totalBytes: 0 });
        this.emitEvent("metadataCache.clear", {
            scope: { raw: "all", cls: "diagnostic.metadata" },
        });
    }

    async clearForKey(key: CacheEntryKey): Promise<void> {
        const dir = this.entryDir(key);
        await this.removeQuietly(`${dir}/${MANIFEST_FILE}`);
        for (const file of await this.fs.readdir(dir)) {
            if (file !== MANIFEST_FILE) {
                await this.removeQuietly(`${dir}/${file}`);
            }
        }
        await this.getIndex();
        const index = this.index!;
        const databaseHash = computeDatabaseHash(key.serverFingerprint, key.database);
        index.entries = index.entries.filter(
            (entry) =>
                !(
                    entry.serverFingerprint === key.serverFingerprint &&
                    entry.databaseHash === databaseHash
                ),
        );
        index.totalBytes = index.entries.reduce((sum, entry) => sum + entry.payloadBytes, 0);
        await this.persistIndex(index);
        this.emitEvent("metadataCache.clear", {
            scope: { raw: "connection", cls: "diagnostic.metadata" },
            ...this.keyFields(key),
        });
    }

    // -- eviction (base §15.2 + H-10) --------------------------------------------

    /**
     * EXPLICIT eviction pass — the host calls this after activation
     * completes, and the coordinator after saves. Reentrant calls join the
     * in-flight run. Order: corrupt/unsupported first, then age, then
     * total-bytes LRU. Throttled to ≤1 fs-op burst per 25ms so cache
     * hygiene never appears in activation timings.
     */
    runEviction(limits: {
        readonly maxAgeDays: number;
        readonly maxBytes: number;
    }): Promise<EvictionSummary> {
        if (this.evictionInFlight) {
            return this.evictionInFlight;
        }
        const run = this.runEvictionCore(limits).finally(() => {
            this.evictionInFlight = undefined;
        });
        this.evictionInFlight = run;
        return run;
    }

    private async runEvictionCore(limits: {
        readonly maxAgeDays: number;
        readonly maxBytes: number;
    }): Promise<EvictionSummary> {
        const scanned = await this.scanEntries();
        let removedCorrupt = 0;
        let removedAged = 0;
        let removedForBytes = 0;
        const survivors: ScannedEntry[] = [];
        // 1) corrupt/unsupported first — useless bytes, free wins.
        for (const entry of scanned) {
            if (!entry.manifest) {
                await this.removeEntryFiles(entry);
                removedCorrupt++;
                this.emitEvictEvent(entry, "corrupt");
            } else {
                survivors.push(entry);
            }
        }
        // 2) age.
        const maxAgeMs = limits.maxAgeDays * 86_400_000;
        const aged: ScannedEntry[] = [];
        for (const entry of survivors) {
            const capturedMs = Date.parse(entry.manifest!.capture.capturedAtUtc);
            if (Number.isFinite(capturedMs) && this.now() - capturedMs > maxAgeMs) {
                await this.removeEntryFiles(entry);
                removedAged++;
                this.emitEvictEvent(entry, "age");
            } else {
                aged.push(entry);
            }
        }
        // 3) total bytes, LRU (oldest lastAccess evicted first).
        await this.getIndex();
        const lastAccessOf = (entry: ScannedEntry): number => {
            const item = this.index!.entries.find(
                (candidate) =>
                    candidate.serverFingerprint === entry.manifest!.key.serverFingerprint &&
                    candidate.databaseHash === entry.manifest!.key.databaseHash,
            );
            const iso = item?.lastAccessUtc ?? entry.manifest!.capture.capturedAtUtc;
            const parsed = Date.parse(iso);
            return Number.isFinite(parsed) ? parsed : 0;
        };
        let totalBytes = aged.reduce((sum, entry) => sum + entry.manifest!.stats.payloadBytes, 0);
        const lru = [...aged].sort((a, z) => lastAccessOf(a) - lastAccessOf(z));
        const kept = new Set(aged);
        for (const entry of lru) {
            if (totalBytes <= limits.maxBytes) {
                break;
            }
            await this.removeEntryFiles(entry);
            kept.delete(entry);
            totalBytes -= entry.manifest!.stats.payloadBytes;
            removedForBytes++;
            this.emitEvictEvent(entry, "bytes");
        }
        // 4) rewrite the index from the survivors.
        const index = this.index!;
        index.entries = index.entries.filter((item) =>
            [...kept].some(
                (entry) =>
                    entry.manifest!.key.serverFingerprint === item.serverFingerprint &&
                    entry.manifest!.key.databaseHash === item.databaseHash,
            ),
        );
        index.totalBytes = index.entries.reduce((sum, entry) => sum + entry.payloadBytes, 0);
        await this.persistIndex(index);
        return { removedCorrupt, removedAged, removedForBytes, totalBytesAfter: totalBytes };
    }

    /** Manifest first, then every other file in the entry dir (H-10). */
    private async removeEntryFiles(entry: ScannedEntry): Promise<void> {
        await this.removeQuietly(`${entry.dir}/${MANIFEST_FILE}`);
        await this.throttle();
        for (const file of entry.files) {
            if (file !== MANIFEST_FILE) {
                await this.removeQuietly(`${entry.dir}/${file}`);
            }
        }
        await this.throttle();
    }

    private async throttle(): Promise<void> {
        if (this.throttleMs > 0) {
            await this.sleep(this.throttleMs);
        }
    }

    // -- scanning ----------------------------------------------------------------

    private async scanEntries(): Promise<ScannedEntry[]> {
        const entries: ScannedEntry[] = [];
        const databasesDir = this.joinPath("databases");
        for (const sfpSegment of await this.fs.readdir(databasesDir)) {
            const serverDir = `${databasesDir}/${sfpSegment}`;
            for (const dbhSegment of await this.fs.readdir(serverDir)) {
                const dir = `${serverDir}/${dbhSegment}`;
                const files = await this.fs.readdir(dir);
                if (files.length === 0) {
                    continue;
                }
                let manifest: CatalogCacheManifest | undefined;
                if (files.includes(MANIFEST_FILE)) {
                    const parsed = await this.readJson(`${dir}/${MANIFEST_FILE}`);
                    const validated = parsed === undefined ? undefined : validateManifest(parsed);
                    manifest = validated?.ok ? validated.manifest : undefined;
                }
                const scanned: ScannedEntry = { dir, dbhSegment, files };
                if (manifest) {
                    scanned.manifest = manifest;
                }
                entries.push(scanned);
            }
        }
        return entries;
    }

    /**
     * Enumerate current entries with exact keys (CACHE-6 clearForConnection
     * picker). Scans manifests — entries without a readable manifest or a
     * databaseExact cannot be keyed and are omitted (eviction owns them).
     */
    async listEntries(): Promise<readonly CacheEntryListing[]> {
        const out: CacheEntryListing[] = [];
        for (const scanned of await this.scanEntries()) {
            const manifest = scanned.manifest;
            if (manifest === undefined || manifest.key.databaseExact === undefined) {
                continue;
            }
            out.push({
                key: {
                    serverFingerprint: manifest.key.serverFingerprint,
                    database: manifest.key.databaseExact,
                },
                capturedAtUtc: manifest.capture.capturedAtUtc,
                payloadBytes: manifest.stats.payloadBytes,
            });
        }
        return out;
    }

    /** Quick counts for status surfaces (index-backed, no payload reads). */
    async status(): Promise<{ entryCount: number; totalBytes: number }> {
        const index = await this.getIndex();
        return { entryCount: index.entries.length, totalBytes: index.totalBytes };
    }

    // -- observability (addendum App C allowlist ONLY) ----------------------------

    private keyFields(key: CacheEntryKey): Record<string, RawField> {
        return {
            serverFpPrefix: {
                raw: key.serverFingerprint.slice(0, 12),
                cls: "diagnostic.metadata",
            },
            dbHashPrefix: {
                raw: computeDatabaseHash(key.serverFingerprint, key.database).slice(0, 12),
                cls: "diagnostic.metadata",
            },
        };
    }

    private emitEvictEvent(entry: ScannedEntry, reason: "corrupt" | "age" | "bytes"): void {
        const fields: Record<string, RawField> = {
            reason: { raw: reason, cls: "diagnostic.metadata" },
            dbHashPrefix: { raw: entry.dbhSegment.slice(0, 12), cls: "diagnostic.metadata" },
        };
        if (entry.manifest) {
            fields["serverFpPrefix"] = {
                raw: entry.manifest.key.serverFingerprint.slice(0, 12),
                cls: "diagnostic.metadata",
            };
            fields["payloadBytes"] = {
                raw: entry.manifest.stats.payloadBytes,
                cls: "diagnostic.metadata",
            };
        }
        this.emitEvent("metadataCache.evict", fields);
    }

    private emitEvent(type: string, fields: Record<string, RawField>): void {
        diag.emit({ feature: "metadata", kind: "event", type, fields });
    }
}

interface ScannedEntry {
    dir: string;
    dbhSegment: string;
    files: string[];
    manifest?: CatalogCacheManifest;
}
