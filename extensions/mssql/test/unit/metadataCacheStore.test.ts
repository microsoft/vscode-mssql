/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * CACHE-2 disk cache (cache/drift design §7/§9/§15, review addendum
 * C-5/C-10/H-4/H-7/H-10), driven entirely over an in-memory FsLike:
 * - atomic write/read round trip; unicode/slash/bracket/dot database names
 *   produce hash-safe paths while the manifest keeps exact spelling;
 * - manifest formatVersion/codec/modelVersion mismatch ⇒ clean miss;
 *   payload sha mismatch ⇒ miss + quarantine; corrupt gzip ⇒ miss, never a
 *   throw;
 * - T-A9 torn-write matrix: every crash point loads a complete OLD entry, a
 *   complete NEW entry, or a clean quarantined miss — never partial data;
 * - T-A10 Windows rename EPERM retry (3 attempts, 50/150ms backoff);
 * - T-A17 two-writer race: exactly one valid winner, loser emits raceLost;
 * - T-A8 policy intersection in both directions (descriptions readiness
 *   forced "absent", data dropped — never ready-and-empty);
 * - §5.5 contentHash-unchanged ⇒ manifest-only rewrite; H-4.4 newerExists
 *   skip; H-7 entryTooLarge skip; §14 save rule; debounce coalescing;
 * - eviction by age, by totalBytes in LRU order, corrupt-first; index
 *   rebuild from manifests; clearAll deletes manifests first;
 * - privacy canary against the BYTES ON DISK: no server/user/token-flavored
 *   strings, no description prose under the default policy.
 */

import { expect } from "chai";
import { MemFs } from "./support/memFsLike";
import { gunzipSync } from "zlib";
import { diag } from "../../src/diagnostics/diagnosticsCore";
import { DiagEvent } from "../../src/sharedInterfaces/debugConsole";
import {
    buildSchemaContext,
    CatalogBuilder,
    CatalogSnapshot,
} from "../../src/services/metadata/catalogModel";
import {
    canonicalPayloadJson,
    CATALOG_MODEL_VERSION,
    computeContentHash,
    serializeSnapshot,
} from "../../src/services/metadata/cache/metadataCacheCodec";
import {
    CacheEntryKey,
    computeDatabaseHash,
    MetadataCacheStore,
    serverFingerprintSegment,
} from "../../src/services/metadata/cache/metadataCacheStore";
import {
    CacheLoadResult,
    MetadataCacheCoordinator,
} from "../../src/services/metadata/cache/metadataCacheCoordinator";
import {
    cachePolicyId,
    DEFAULT_METADATA_CACHE_SETTINGS,
    MetadataCacheSettings,
    readMetadataCacheSettings,
} from "../../src/services/metadata/cache/metadataCacheSettings";

const SFP = "sfp_testFingerprint0000000";
const KEY: CacheEntryKey = { serverFingerprint: SFP, database: "Db1" };
const ROOT = "root";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const instantSleep = async (_ms: number): Promise<void> => undefined;

// Privacy canaries — these live ONLY in description values in the fixture.
const CANARY_HOST = "srv-secret-host";
const CANARY_USER = "user=KarlB";
const CANARY_TOKEN = "token=eyJhbGciOiJIUzI1NiJ9.canary";
const CANARY_PROSE = "Order header rows";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function testSettings(overrides?: Partial<MetadataCacheSettings>): MetadataCacheSettings {
    const persistDescriptions = overrides?.persistDescriptions ?? false;
    return {
        ...DEFAULT_METADATA_CACHE_SETTINGS,
        enabled: true,
        writeDelayMs: 20,
        ...overrides,
        policyId: cachePolicyId({ persistDescriptions, persistModuleDefinitions: false }),
    };
}

function makeStore(
    fs: MemFs,
    options?: {
        now?: () => number;
        sleepFn?: (ms: number) => Promise<void>;
        random?: () => number;
    },
): MetadataCacheStore {
    return new MetadataCacheStore(fs, ROOT, {
        throttleMs: 0,
        sleep: options?.sleepFn ?? instantSleep,
        ...(options?.now ? { now: options.now } : {}),
        ...(options?.random ? { random: options.random } : {}),
    });
}

function makeCoordinator(
    fs: MemFs,
    settings: MetadataCacheSettings,
    options?: { pid?: number },
): { store: MetadataCacheStore; coordinator: MetadataCacheCoordinator } {
    const store = makeStore(fs);
    const coordinator = new MetadataCacheCoordinator(store, () => settings, {
        evictAfterSave: false,
        ...(options?.pid !== undefined ? { pid: options.pid } : {}),
    });
    return { store, coordinator };
}

/** Compact live fixture; `variant` changes the data (and so contentHash). */
function buildSnapshot(options?: {
    generation?: number;
    variant?: string;
    objectsFailed?: boolean;
}): CatalogSnapshot {
    const b = new CatalogBuilder();
    b.setEnvironment({
        engineEdition: 5,
        defaultSchema: "dbo",
        collationName: "SQL_Latin1_General_CP1_CI_AS",
        caseSensitive: false,
    });
    b.addSchema(1, "dbo");
    b.addObject(101, 1, "Orders", "table", "2026-01-05T10:00:00");
    b.addObject(103, 1, "Customers", "table", "2026-01-05T10:30:00");
    b.addColumn(101, "OrderId", "int", false, true);
    b.addColumn(101, "CustomerId", "int", true);
    if (options?.variant) {
        b.addColumn(101, `Extra_${options.variant}`, "nvarchar(10)", true);
    }
    b.addColumn(103, "CustomerId", "int", false, true);
    b.addColumn(103, "Name", "nvarchar(50)", false);
    b.markPrimaryKeyColumn(101, "OrderId");
    b.addKeyConstraintColumn(101, "PK_Orders", "primaryKey", "OrderId");
    b.addForeignKey(101, 103, "FK_Orders_Customers", 9002);
    b.addForeignKeyColumn(9002, "CustomerId", "CustomerId");
    b.addDescription(101, `${CANARY_PROSE}. Contact ${CANARY_HOST} as ${CANARY_USER}.`);
    b.addDescription(101, `References the customer. ${CANARY_TOKEN}`, "CustomerId");
    return b.build(
        options?.generation ?? 1,
        {
            schemas: "ready",
            objects: options?.objectsFailed ? "failed" : "ready",
            synonyms: "ready",
            types: "ready",
            columns: "ready",
            keys: "ready",
            foreignKeys: "ready",
            parameters: "ready",
            descriptions: "ready",
        },
        options?.objectsFailed ? "partial" : "full",
    );
}

function entryDir(key: CacheEntryKey): string {
    return `${ROOT}/v1/databases/${serverFingerprintSegment(key.serverFingerprint)}/${computeDatabaseHash(key.serverFingerprint, key.database)}`;
}

function manifestPathOf(key: CacheEntryKey): string {
    return `${entryDir(key)}/manifest.json`;
}

function payloadPathOf(key: CacheEntryKey): string {
    return `${entryDir(key)}/catalog.json.gz`;
}

function parseManifestFile(fs: MemFs, key: CacheEntryKey): Record<string, unknown> {
    return JSON.parse(fs.files.get(manifestPathOf(key))!.toString("utf8"));
}

function tamperManifest(
    fs: MemFs,
    key: CacheEntryKey,
    mutate: (manifest: Record<string, unknown>) => void,
): void {
    const manifest = parseManifestFile(fs, key);
    mutate(manifest);
    fs.files.set(manifestPathOf(key), Buffer.from(JSON.stringify(manifest), "utf8"));
}

function expectHit(
    result: CacheLoadResult,
): Extract<CacheLoadResult, { snapshot: CatalogSnapshot }> {
    if ("miss" in result) {
        expect.fail(`expected a cache hit, got miss reason "${result.reason}"`);
    }
    return result as Extract<CacheLoadResult, { snapshot: CatalogSnapshot }>;
}

function expectMiss(result: CacheLoadResult): string {
    if (!("miss" in result)) {
        expect.fail("expected a cache miss, got a hit");
    }
    return (result as { miss: true; reason: string }).reason;
}

function captureEvents(): { events: DiagEvent[]; dispose(): void } {
    const events: DiagEvent[] = [];
    const id = `test-metadata-cache-${Math.random().toString(36).slice(2)}`;
    diag.addSink({ id, tryWrite: (event) => void events.push(event) });
    return { events, dispose: () => diag.removeSink(id) };
}

/** Write an entry with full manifest control (eviction fixtures). */
async function writeRawEntry(
    store: MetadataCacheStore,
    key: CacheEntryKey,
    options: { capturedAtUtc: string; generation?: number; variant?: string },
): Promise<number> {
    const snapshot = buildSnapshot({
        generation: options.generation ?? 1,
        ...(options.variant !== undefined ? { variant: options.variant } : {}),
    });
    const payload = serializeSnapshot(snapshot);
    const contentHash = computeContentHash(payload);
    const outcome = await store.writeEntry(key, canonicalPayloadJson(payload), (info) => ({
        formatVersion: 1,
        producer: { catalogModelVersion: CATALOG_MODEL_VERSION, cacheCodec: "json-gzip-v1" },
        writerId: "999:raw",
        key: {
            serverFingerprint: key.serverFingerprint,
            databaseHash: computeDatabaseHash(key.serverFingerprint, key.database),
            databaseExact: key.database,
        },
        capture: {
            capturedAtUtc: options.capturedAtUtc,
            publishedGeneration: options.generation ?? 1,
            source: "live",
        },
        validation: {},
        environment: { caseSensitive: false, defaultSchema: "dbo" },
        readiness: { ...snapshot.readiness, descriptions: "absent", rowCounts: "absent" },
        mode: "full",
        stats: {
            ...snapshot.stats,
            payloadBytes: info.payloadBytes,
            uncompressedBytes: info.uncompressedBytes,
        },
        privacy: {
            includesDescriptions: false,
            includesModuleDefinitions: false,
            includesRowCounts: false,
            policyId: "cp1:d0m0",
        },
        payload: { file: "catalog.json.gz", sha256: info.sha256, contentHash },
    }));
    expect(outcome.ok).to.equal(true);
    return outcome.payloadBytes!;
}

// ---------------------------------------------------------------------------
// Store: paths, read protocol, atomicity
// ---------------------------------------------------------------------------

suite("Metadata cache store (CACHE-2): paths and read protocol", () => {
    test("save/load round trip; unicode/slash/bracket/dot names get hash-safe paths, manifest keeps exact spelling", async () => {
        const names = ["My/DB [prod].v2", "数据库.dev 😀", String.raw`..\evil:name?`, "plain"];
        for (const database of names) {
            const fs = new MemFs();
            const { coordinator } = makeCoordinator(fs, testSettings());
            const key: CacheEntryKey = { serverFingerprint: SFP, database };
            const snapshot = buildSnapshot({ generation: 3 });
            const saved = await coordinator.saveNow(key, snapshot);
            expect(saved.result).to.equal("saved");
            // Path privacy + filesystem safety: the raw name appears in NO
            // path; entry dirs are sfp segment + dbh_ hash only.
            for (const path of fs.files.keys()) {
                expect(path.includes(database)).to.equal(false);
                if (path.endsWith("/manifest.json")) {
                    expect(path).to.match(
                        /^root\/v1\/databases\/[A-Za-z0-9_-]+\/dbh_[A-Za-z0-9_-]{22}\/manifest\.json$/,
                    );
                }
            }
            const loaded = expectHit(await coordinator.load(key));
            expect(loaded.manifest.key.databaseExact).to.equal(database);
            expect(loaded.snapshot.generation).to.equal(3);
            expect(
                buildSchemaContext(loaded.snapshot, {
                    budget: "unlimited",
                    privacy: { destination: "local", allowObjectNames: true },
                }),
            ).to.deep.equal(
                buildSchemaContext(snapshot, {
                    budget: "unlimited",
                    privacy: { destination: "local", allowObjectNames: true },
                }),
            );
        }
    });

    test("databaseHash recipe (C-10): dbh_ prefix, 22 b64url chars, server-fingerprint salt", () => {
        const hash = computeDatabaseHash(SFP, "Db1");
        expect(hash).to.match(/^dbh_[A-Za-z0-9_-]{22}$/);
        expect(computeDatabaseHash(SFP, "Db1")).to.equal(hash); // stable
        expect(computeDatabaseHash(SFP, "db1")).to.not.equal(hash); // exact spelling
        // Salting: the same database name on another server hashes apart.
        expect(computeDatabaseHash("sfp_otherServer0000000000", "Db1")).to.not.equal(hash);
    });

    test("manifest formatVersion/codec/modelVersion mismatch ⇒ clean miss with its own reason", async () => {
        const cases: ReadonlyArray<readonly [string, (m: Record<string, unknown>) => void]> = [
            [
                "formatVersion",
                (m) => {
                    m["formatVersion"] = 2;
                },
            ],
            [
                "codec",
                (m) => {
                    (m["producer"] as Record<string, unknown>)["cacheCodec"] = "json-brotli-v1";
                },
            ],
            [
                "modelVersion",
                (m) => {
                    (m["producer"] as Record<string, unknown>)["catalogModelVersion"] = "cm99";
                },
            ],
        ];
        for (const [expectedReason, mutate] of cases) {
            const fs = new MemFs();
            const { coordinator } = makeCoordinator(fs, testSettings());
            expect((await coordinator.saveNow(KEY, buildSnapshot())).result).to.equal("saved");
            tamperManifest(fs, KEY, mutate);
            expect(expectMiss(await coordinator.load(KEY))).to.equal(expectedReason);
            // Clean miss: nothing thrown, unsupported files left for the
            // eviction sweep (not destroyed on the read path).
            expect(fs.files.has(payloadPathOf(KEY))).to.equal(true);
        }
    });

    test("payload sha mismatch ⇒ miss + quarantine (manifest removed, payload set aside)", async () => {
        const fs = new MemFs();
        const { coordinator } = makeCoordinator(fs, testSettings());
        expect((await coordinator.saveNow(KEY, buildSnapshot())).result).to.equal("saved");
        const payloadPath = payloadPathOf(KEY);
        fs.files.set(payloadPath, Buffer.concat([fs.files.get(payloadPath)!, Buffer.from([0x21])]));
        const capture = captureEvents();
        try {
            expect(expectMiss(await coordinator.load(KEY))).to.equal("shaMismatch");
            expect(fs.files.has(payloadPath)).to.equal(false);
            expect(fs.files.has(`${payloadPath}.quarantine`)).to.equal(true);
            expect(fs.files.has(manifestPathOf(KEY))).to.equal(false);
            expect(capture.events.some((e) => e.type === "metadataCache.corrupt")).to.equal(true);
            expect(capture.events.some((e) => e.type === "metadataCache.miss")).to.equal(true);
        } finally {
            capture.dispose();
        }
    });

    test("corrupt gzip ⇒ clean miss, no throw (sha valid over the corrupt bytes)", async () => {
        const fs = new MemFs();
        const { coordinator } = makeCoordinator(fs, testSettings());
        expect((await coordinator.saveNow(KEY, buildSnapshot())).result).to.equal("saved");
        const garbage = Buffer.from("this is not gzip at all", "utf8");
        fs.files.set(payloadPathOf(KEY), garbage);
        const { createHash } = await import("crypto");
        tamperManifest(fs, KEY, (manifest) => {
            (manifest["payload"] as Record<string, unknown>)["sha256"] = createHash("sha256")
                .update(garbage)
                .digest("hex");
        });
        expect(expectMiss(await coordinator.load(KEY))).to.equal("corrupt");
    });

    test("missing entry ⇒ miss 'missing'; disabled settings ⇒ miss 'disabled'", async () => {
        const fs = new MemFs();
        const { coordinator } = makeCoordinator(fs, testSettings());
        expect(expectMiss(await coordinator.load(KEY))).to.equal("missing");
        const { coordinator: disabled } = makeCoordinator(fs, testSettings({ enabled: false }));
        expect(expectMiss(await disabled.load(KEY))).to.equal("disabled");
    });
});

// ---------------------------------------------------------------------------
// T-A10 — Windows rename EPERM retry
// ---------------------------------------------------------------------------

suite("Metadata cache store (CACHE-2): rename retry (T-A10)", () => {
    test("payload rename fails twice with EPERM then succeeds: 3 attempts, 50/150ms backoff", async () => {
        const fs = new MemFs();
        const delays: number[] = [];
        const store = makeStore(fs, {
            sleepFn: async (ms) => {
                delays.push(ms);
            },
            random: () => 0.5, // jitter factor 0.75 + 0.5*0.5 = 1.0 → exact bases
        });
        const coordinator = new MetadataCacheCoordinator(store, () => testSettings(), {
            evictAfterSave: false,
        });
        const payloadPath = payloadPathOf(KEY);
        let attempts = 0;
        fs.failRename = (_from, to) => {
            if (to === payloadPath) {
                attempts++;
                if (attempts <= 2) {
                    return Object.assign(new Error("EPERM: locked by scanner"), {
                        code: "EPERM",
                    });
                }
            }
            return undefined;
        };
        const outcome = await coordinator.saveNow(KEY, buildSnapshot());
        expect(outcome.result).to.equal("saved");
        expect(attempts).to.equal(3);
        expect(delays).to.deep.equal([50, 150]);
        expect(expectHit(await coordinator.load(KEY)).snapshot.generation).to.equal(1);
    });

    test("non-transient rename error fails immediately (no retry), save reports failed", async () => {
        const fs = new MemFs();
        const delays: number[] = [];
        const store = makeStore(fs, {
            sleepFn: async (ms) => {
                delays.push(ms);
            },
        });
        const coordinator = new MetadataCacheCoordinator(store, () => testSettings(), {
            evictAfterSave: false,
        });
        fs.failRename = (_from, to) =>
            to === payloadPathOf(KEY)
                ? Object.assign(new Error("EIO: disk detached"), { code: "EIO" })
                : undefined;
        const outcome = await coordinator.saveNow(KEY, buildSnapshot());
        expect(outcome.result).to.equal("failed");
        expect(delays).to.deep.equal([]);
    });
});

// ---------------------------------------------------------------------------
// T-A9 — torn-write matrix
// ---------------------------------------------------------------------------

suite("Metadata cache store (CACHE-2): torn-write matrix (T-A9)", () => {
    interface TornSetup {
        fs: MemFs;
        coordinator: MetadataCacheCoordinator;
        oldHash: string;
        newSnapshot: CatalogSnapshot;
    }

    async function setupWithOldEntry(): Promise<TornSetup> {
        const fs = new MemFs();
        const { coordinator } = makeCoordinator(fs, testSettings());
        const oldSnapshot = buildSnapshot({ generation: 1, variant: "old" });
        const saved = await coordinator.saveNow(KEY, oldSnapshot);
        expect(saved.result).to.equal("saved");
        await sleep(5); // newer capture time for the second writer
        return {
            fs,
            coordinator,
            oldHash: saved.contentHash!,
            newSnapshot: buildSnapshot({ generation: 2, variant: "new" }),
        };
    }

    test("crash before payload rename (temp write / payload rename fail) ⇒ OLD entry loads intact", async () => {
        // (a) crash while writing the payload temp file
        {
            const { fs, coordinator, oldHash, newSnapshot } = await setupWithOldEntry();
            fs.beforeOp = (op, path) => {
                if (op === "write" && path.includes("catalog.json.gz.")) {
                    throw new Error("crash: power loss during temp write");
                }
            };
            expect((await coordinator.saveNow(KEY, newSnapshot)).result).to.equal("failed");
            fs.beforeOp = undefined;
            expect(expectHit(await coordinator.load(KEY)).snapshot.contentHash).to.equal(oldHash);
        }
        // (b) crash on the payload rename itself
        {
            const { fs, coordinator, oldHash, newSnapshot } = await setupWithOldEntry();
            fs.failRename = (_from, to) =>
                to === payloadPathOf(KEY)
                    ? Object.assign(new Error("EIO"), { code: "EIO" })
                    : undefined;
            expect((await coordinator.saveNow(KEY, newSnapshot)).result).to.equal("failed");
            fs.failRename = undefined;
            expect(expectHit(await coordinator.load(KEY)).snapshot.contentHash).to.equal(oldHash);
        }
    });

    test("crash between payload and manifest rename ⇒ clean quarantined miss, next save recovers to NEW", async () => {
        // (c) crash writing the manifest temp; (d) crash on manifest rename.
        const injections: ReadonlyArray<(fs: MemFs) => void> = [
            (fs) => {
                fs.beforeOp = (op, path) => {
                    if (op === "write" && path.includes("manifest.json.")) {
                        throw new Error("crash: power loss before manifest");
                    }
                };
            },
            (fs) => {
                fs.failRename = (_from, to) =>
                    to === manifestPathOf(KEY)
                        ? Object.assign(new Error("EIO"), { code: "EIO" })
                        : undefined;
            },
        ];
        for (const inject of injections) {
            const { fs, coordinator, oldHash, newSnapshot } = await setupWithOldEntry();
            inject(fs);
            expect((await coordinator.saveNow(KEY, newSnapshot)).result).to.equal("failed");
            fs.beforeOp = undefined;
            fs.failRename = undefined;
            // Old manifest + new payload: the sha check turns the torn cell
            // into a clean miss (quarantine), NEVER a mixed/partial load.
            expect(expectMiss(await coordinator.load(KEY))).to.equal("shaMismatch");
            expect(fs.files.has(`${payloadPathOf(KEY)}.quarantine`)).to.equal(true);
            // Recovery: the next save lands a complete NEW entry.
            const resaved = await coordinator.saveNow(KEY, newSnapshot);
            expect(resaved.result).to.equal("saved");
            const loaded = expectHit(await coordinator.load(KEY));
            expect(loaded.snapshot.contentHash).to.equal(resaved.contentHash);
            expect(loaded.snapshot.contentHash).to.not.equal(oldHash);
        }
    });

    test("constructed old-payload + new-manifest state ⇒ clean miss, never a mixed snapshot", async () => {
        const { fs, coordinator, newSnapshot } = await setupWithOldEntry();
        const oldPayloadBytes = fs.files.get(payloadPathOf(KEY))!;
        expect((await coordinator.saveNow(KEY, newSnapshot)).result).to.equal("saved");
        fs.files.set(payloadPathOf(KEY), oldPayloadBytes); // simulate the 4th matrix cell
        expect(expectMiss(await coordinator.load(KEY))).to.equal("shaMismatch");
    });
});

// ---------------------------------------------------------------------------
// T-A17 — two-writer race
// ---------------------------------------------------------------------------

suite("Metadata cache store (CACHE-2): two-writer race (T-A17)", () => {
    test("interleaved saves: exactly one valid winner; loser emits raceLost", async () => {
        const fs = new MemFs();
        const settings = testSettings();
        const key: CacheEntryKey = { serverFingerprint: SFP, database: "RaceDb" };
        const manifestPath = manifestPathOf(key);
        const a = makeCoordinator(fs, settings, { pid: 111 });
        const b = makeCoordinator(fs, settings, { pid: 222 });
        const snapshotA = buildSnapshot({ generation: 1, variant: "A" });
        await sleep(5);
        const snapshotB = buildSnapshot({ generation: 2, variant: "B" });

        // Interleave: block writer A between its manifest rename and its
        // H-4.5 post-save re-read; let B run to completion in that window.
        let manifestRenames = 0;
        let armed = false;
        let signalBlocked: () => void;
        const aBlocked = new Promise<void>((resolve) => (signalBlocked = resolve));
        let releaseA: () => void;
        const released = new Promise<void>((resolve) => (releaseA = resolve));
        fs.beforeOp = async (op, path) => {
            if (op === "rename" && path === manifestPath) {
                manifestRenames++;
                if (manifestRenames === 1) {
                    armed = true; // writer A just published its manifest
                }
                return;
            }
            if (op === "read" && path === manifestPath && armed) {
                armed = false; // this is A's post-save re-read
                signalBlocked();
                await released;
            }
        };
        const capture = captureEvents();
        try {
            const pendingA = a.coordinator.saveNow(key, snapshotA);
            await aBlocked;
            const outcomeB = await b.coordinator.saveNow(key, snapshotB);
            expect(outcomeB.result).to.equal("saved");
            releaseA!();
            const outcomeA = await pendingA;
            expect(outcomeA.result).to.equal("raceLost");
            expect(capture.events.some((e) => e.type === "metadataCache.raceLost")).to.equal(true);
            // Exactly one valid winner: B's complete entry.
            fs.beforeOp = undefined;
            const loaded = expectHit(await b.coordinator.load(key));
            expect(loaded.manifest.writerId.startsWith("222:")).to.equal(true);
            expect(loaded.snapshot.contentHash).to.equal(outcomeB.contentHash);
        } finally {
            fs.beforeOp = undefined;
            capture.dispose();
        }
    });
});

// ---------------------------------------------------------------------------
// Coordinator: save rules, §5.5, H-4.4, H-7, debounce, T-A8
// ---------------------------------------------------------------------------

suite("Metadata cache coordinator (CACHE-2): save rules and skips", () => {
    test("base §14 save rule: objects failed ⇒ skipped notEligible, nothing written", async () => {
        const fs = new MemFs();
        const { coordinator } = makeCoordinator(fs, testSettings());
        const outcome = await coordinator.saveNow(KEY, buildSnapshot({ objectsFailed: true }));
        expect(outcome.result).to.equal("skipped");
        expect(outcome.skipped).to.equal("notEligible");
        expect(fs.files.size).to.equal(0);
    });

    test("§5.5 contentHash unchanged ⇒ manifest-only rewrite (no payload write), validation block bumped", async () => {
        const fs = new MemFs();
        const { coordinator } = makeCoordinator(fs, testSettings());
        const first = await coordinator.saveNow(
            KEY,
            buildSnapshot({ generation: 1, variant: "same" }),
        );
        expect(first.result).to.equal("saved");
        await sleep(5);
        const again = buildSnapshot({ generation: 2, variant: "same" }); // identical data, later capture
        const newValidation = {
            lastValidatedAtUtc: "2026-07-07T00:00:00.000Z",
            validationTier: "cheapDatabaseDigest" as const,
        };
        const second = await coordinator.saveNow(KEY, again, { validation: newValidation });
        expect(second.result).to.equal("manifestOnly");
        expect(second.contentHash).to.equal(first.contentHash);
        expect(fs.renameCount(payloadPathOf(KEY))).to.equal(1); // ONE payload write ever
        expect(fs.renameCount(manifestPathOf(KEY))).to.equal(2); // manifest rewritten
        const manifest = parseManifestFile(fs, KEY);
        expect(manifest["validation"]).to.deep.equal(newValidation);
    });

    test("H-4.4 newerExists: an older snapshot never clobbers a newer manifest", async () => {
        const fs = new MemFs();
        const { coordinator } = makeCoordinator(fs, testSettings());
        const older = buildSnapshot({ generation: 1, variant: "older" });
        await sleep(5);
        const newer = buildSnapshot({ generation: 5, variant: "newer" });
        expect((await coordinator.saveNow(KEY, newer)).result).to.equal("saved");
        const outcome = await coordinator.saveNow(KEY, older);
        expect(outcome.result).to.equal("skipped");
        expect(outcome.skipped).to.equal("newerExists");
        const loaded = expectHit(await coordinator.load(KEY));
        expect(loaded.snapshot.generation).to.equal(5);
    });

    test("H-7 entryTooLarge: compressed payload over maxEntryBytes skips the save, no files land", async () => {
        const fs = new MemFs();
        const { coordinator } = makeCoordinator(fs, testSettings({ maxEntryBytes: 16 }));
        const outcome = await coordinator.saveNow(KEY, buildSnapshot());
        expect(outcome.result).to.equal("skipped");
        expect(outcome.skipped).to.equal("entryTooLarge");
        expect(fs.files.size).to.equal(0);
    });

    test("disabled settings ⇒ save skipped 'disabled'", async () => {
        const fs = new MemFs();
        const { coordinator } = makeCoordinator(fs, testSettings({ enabled: false }));
        const outcome = await coordinator.saveNow(KEY, buildSnapshot());
        expect(outcome.result).to.equal("skipped");
        expect(outcome.skipped).to.equal("disabled");
        expect(fs.files.size).to.equal(0);
    });

    test("debounced save() coalesces bursts (latest snapshot wins); flush() forces pending writes", async () => {
        const fs = new MemFs();
        const { coordinator } = makeCoordinator(fs, testSettings({ writeDelayMs: 30 }));
        coordinator.save(KEY, buildSnapshot({ generation: 1, variant: "one" }));
        coordinator.save(KEY, buildSnapshot({ generation: 2, variant: "two" }));
        await sleep(150);
        expect(fs.renameCount(payloadPathOf(KEY))).to.equal(1);
        expect(
            (parseManifestFile(fs, KEY)["capture"] as Record<string, unknown>)[
                "publishedGeneration"
            ],
        ).to.equal(2);
        // flush(): pending save lands without waiting out the debounce.
        coordinator.save(KEY, buildSnapshot({ generation: 3, variant: "three" }));
        await coordinator.flush();
        expect(
            (parseManifestFile(fs, KEY)["capture"] as Record<string, unknown>)[
                "publishedGeneration"
            ],
        ).to.equal(3);
        coordinator.dispose();
    });

    test("saved snapshot round-trips through load: generation, contentHash, schema-context bytes", async () => {
        const fs = new MemFs();
        const { coordinator } = makeCoordinator(fs, testSettings());
        const live = buildSnapshot({ generation: 9 });
        const saved = await coordinator.saveNow(KEY, live);
        expect(saved.result).to.equal("saved");
        expect(live.contentHash).to.equal(saved.contentHash); // set-once on the live snapshot
        const loaded = expectHit(await coordinator.load(KEY));
        expect(loaded.policyIntersected).to.equal(false);
        expect(loaded.snapshot.generation).to.equal(9);
        expect(loaded.snapshot.contentHash).to.equal(saved.contentHash);
        expect(loaded.manifest.capture.publishedGeneration).to.equal(9);
        const request = {
            budget: "unlimited" as const,
            privacy: { destination: "local" as const, allowObjectNames: true },
        };
        expect(buildSchemaContext(loaded.snapshot, request)).to.deep.equal(
            buildSchemaContext(live, request),
        );
    });
});

suite("Metadata cache coordinator (CACHE-2): policy intersection (T-A8)", () => {
    test("write with descriptions ON → load with descriptions OFF: readiness 'absent', data DROPPED", async () => {
        const fs = new MemFs();
        const on = makeCoordinator(fs, testSettings({ persistDescriptions: true }));
        const live = buildSnapshot();
        expect(live.getDescription(101)).to.include(CANARY_PROSE);
        expect((await on.coordinator.saveNow(KEY, live)).result).to.equal("saved");
        // Under the permissive policy the prose IS on disk (canary sanity).
        const onDisk = gunzipSync(fs.files.get(payloadPathOf(KEY))!).toString("utf8");
        expect(onDisk).to.include(CANARY_HOST);

        const off = makeCoordinator(fs, testSettings({ persistDescriptions: false }));
        const loaded = expectHit(await off.coordinator.load(KEY));
        expect(loaded.policyIntersected).to.equal(true);
        expect(loaded.snapshot.readiness.descriptions).to.equal("absent"); // NEVER ready-and-empty
        expect(loaded.snapshot.getDescription(101)).to.equal(undefined);
        expect(loaded.snapshot.getDescription(101, "CustomerId")).to.equal(undefined);
        // Determinism holds under intersection: the loaded snapshot's hash
        // equals a fresh serialize under the current policy.
        expect(computeContentHash(serializeSnapshot(loaded.snapshot))).to.equal(
            loaded.snapshot.contentHash,
        );
        // Structural sections stay ready — intersection is surgical.
        expect(loaded.snapshot.readiness.objects).to.equal("ready");
        expect(loaded.snapshot.readiness.columns).to.equal("ready");
    });

    test("write with descriptions OFF → load with descriptions ON: absent from payload ⇒ 'absent'", async () => {
        const fs = new MemFs();
        const off = makeCoordinator(fs, testSettings({ persistDescriptions: false }));
        expect((await off.coordinator.saveNow(KEY, buildSnapshot())).result).to.equal("saved");
        const on = makeCoordinator(fs, testSettings({ persistDescriptions: true }));
        const loaded = expectHit(await on.coordinator.load(KEY));
        expect(loaded.policyIntersected).to.equal(true); // policyId mismatch is NOT corruption
        expect(loaded.snapshot.readiness.descriptions).to.equal("absent");
        expect(loaded.snapshot.getDescription(101)).to.equal(undefined);
    });
});

// ---------------------------------------------------------------------------
// Eviction, index, clear
// ---------------------------------------------------------------------------

suite("Metadata cache store (CACHE-2): eviction and index", () => {
    const keyOf = (database: string): CacheEntryKey => ({ serverFingerprint: SFP, database });

    test("eviction by age: entries older than maxAgeDays are removed", async () => {
        const fs = new MemFs();
        const base = Date.now();
        const store = makeStore(fs, { now: () => base });
        const oldKey = keyOf("OldDb");
        const freshKey = keyOf("FreshDb");
        await writeRawEntry(store, oldKey, {
            capturedAtUtc: new Date(base - 30 * 86_400_000).toISOString(),
        });
        await writeRawEntry(store, freshKey, { capturedAtUtc: new Date(base).toISOString() });
        const summary = await store.runEviction({ maxAgeDays: 14, maxBytes: 1_000_000_000 });
        expect(summary.removedAged).to.equal(1);
        expect(fs.files.has(manifestPathOf(oldKey))).to.equal(false);
        expect(fs.files.has(payloadPathOf(oldKey))).to.equal(false);
        expect(fs.files.has(manifestPathOf(freshKey))).to.equal(true);
        expect((await store.status()).entryCount).to.equal(1);
    });

    test("eviction by totalBytes removes least-recently-used first; touched entries survive", async () => {
        const fs = new MemFs();
        let clock = Date.now();
        const store = makeStore(fs, { now: () => clock });
        const keys = [keyOf("LruA"), keyOf("LruB"), keyOf("LruC")];
        const sizes: number[] = [];
        for (const key of keys) {
            sizes.push(
                await writeRawEntry(store, key, { capturedAtUtc: new Date(clock).toISOString() }),
            );
            clock += 1_000;
        }
        clock += 10_000;
        // Touch A: it becomes the most recently used despite oldest write.
        const read = await store.readEntry(keys[0]);
        expect(read.kind).to.equal("hit");
        const summary = await store.runEviction({
            maxAgeDays: 14,
            maxBytes: sizes[0] + 10, // room for exactly one entry
        });
        expect(summary.removedForBytes).to.equal(2);
        expect(fs.files.has(manifestPathOf(keys[0]))).to.equal(true); // survivor: the touched one
        expect(fs.files.has(manifestPathOf(keys[1]))).to.equal(false);
        expect(fs.files.has(manifestPathOf(keys[2]))).to.equal(false);
        expect((await store.status()).totalBytes).to.equal(sizes[0]);
    });

    test("corrupt-first: unreadable manifests and orphan payloads are swept before anything else", async () => {
        const fs = new MemFs();
        const store = makeStore(fs);
        const goodKey = keyOf("GoodDb");
        await writeRawEntry(store, goodKey, { capturedAtUtc: new Date().toISOString() });
        // Corrupt entry: garbage manifest + payload.
        const corruptDir = `${ROOT}/v1/databases/${serverFingerprintSegment(SFP)}/dbh_corruptcorruptcorr00`;
        fs.files.set(`${corruptDir}/manifest.json`, Buffer.from("{ not json", "utf8"));
        fs.files.set(`${corruptDir}/catalog.json.gz`, Buffer.from("junk", "utf8"));
        // Orphan payload (no manifest at all) — garbage by definition (H-10).
        const orphanDir = `${ROOT}/v1/databases/${serverFingerprintSegment(SFP)}/dbh_orphanorphanorphan00`;
        fs.files.set(`${orphanDir}/catalog.json.gz`, Buffer.from("orphan", "utf8"));
        const summary = await store.runEviction({ maxAgeDays: 14, maxBytes: 1_000_000_000 });
        expect(summary.removedCorrupt).to.equal(2);
        expect(fs.files.has(`${corruptDir}/manifest.json`)).to.equal(false);
        expect(fs.files.has(`${corruptDir}/catalog.json.gz`)).to.equal(false);
        expect(fs.files.has(`${orphanDir}/catalog.json.gz`)).to.equal(false);
        expect(fs.files.has(manifestPathOf(goodKey))).to.equal(true);
    });

    test("listEntries returns exact keys from manifests; unkeyable entries are omitted (CACHE-6)", async () => {
        const fs = new MemFs();
        const store = makeStore(fs);
        const orders = keyOf("OrdersDb");
        const sales = keyOf("SalesDb");
        const nameless = keyOf("NamelessDb");
        await writeRawEntry(store, orders, { capturedAtUtc: "2026-07-01T10:00:00.000Z" });
        await writeRawEntry(store, sales, { capturedAtUtc: "2026-07-02T10:00:00.000Z" });
        await writeRawEntry(store, nameless, { capturedAtUtc: "2026-07-03T10:00:00.000Z" });
        // A manifest without databaseExact cannot be keyed for clearForKey.
        tamperManifest(fs, nameless, (manifest) => {
            delete (manifest.key as Record<string, unknown>).databaseExact;
        });
        // Corrupt manifests contribute nothing (eviction owns them).
        const corruptDir = `${ROOT}/v1/databases/${serverFingerprintSegment(SFP)}/dbh_corruptcorruptcorr00`;
        fs.files.set(`${corruptDir}/manifest.json`, Buffer.from("{ not json", "utf8"));
        const listed = await store.listEntries();
        expect(listed.map((entry) => entry.key.database).sort()).to.deep.equal([
            "OrdersDb",
            "SalesDb",
        ]);
        for (const entry of listed) {
            expect(entry.key.serverFingerprint).to.equal(SFP);
            expect(entry.payloadBytes).to.be.greaterThan(0);
        }
        expect(listed.find((entry) => entry.key.database === "OrdersDb")!.capturedAtUtc).to.equal(
            "2026-07-01T10:00:00.000Z",
        );
        // clearForKey over a listed key removes exactly that entry.
        await store.clearForKey(listed[0].key);
        expect((await store.listEntries()).length).to.equal(1);
    });

    test("index rebuild from manifests: corrupt index.json is reconstructed, never trusted", async () => {
        const fs = new MemFs();
        const store = makeStore(fs);
        const bytes1 = await writeRawEntry(store, keyOf("IdxA"), {
            capturedAtUtc: new Date().toISOString(),
        });
        const bytes2 = await writeRawEntry(store, keyOf("IdxB"), {
            capturedAtUtc: new Date().toISOString(),
        });
        fs.files.set(`${ROOT}/v1/index.json`, Buffer.from("][ corrupted", "utf8"));
        // A fresh store instance (new process) must rebuild by scanning
        // manifests — payloads without manifests contribute nothing.
        const rebuilt = makeStore(fs);
        const status = await rebuilt.status();
        expect(status.entryCount).to.equal(2);
        expect(status.totalBytes).to.equal(bytes1 + bytes2);
        const reread = await rebuilt.readEntry(keyOf("IdxA"));
        expect(reread.kind).to.equal("hit");
        const persisted = JSON.parse(fs.files.get(`${ROOT}/v1/index.json`)!.toString("utf8"));
        expect(persisted.formatVersion).to.equal(1);
        expect(persisted.entries).to.have.length(2);
    });

    test("clearAll deletes manifests FIRST, payloads second (H-10)", async () => {
        const fs = new MemFs();
        const store = makeStore(fs);
        await writeRawEntry(store, keyOf("ClearA"), { capturedAtUtc: new Date().toISOString() });
        await writeRawEntry(store, keyOf("ClearB"), { capturedAtUtc: new Date().toISOString() });
        fs.ops.length = 0;
        const capture = captureEvents();
        try {
            await store.clearAll();
            const unlinks = fs.ops.filter((op) => op.op === "unlink");
            const manifestIdx = unlinks
                .map((op, i) => (op.path.endsWith("/manifest.json") ? i : -1))
                .filter((i) => i >= 0);
            const payloadIdx = unlinks
                .map((op, i) => (op.path.endsWith("/catalog.json.gz") ? i : -1))
                .filter((i) => i >= 0);
            expect(manifestIdx).to.have.length(2);
            expect(payloadIdx).to.have.length(2);
            expect(Math.max(...manifestIdx)).to.be.lessThan(Math.min(...payloadIdx));
            expect([...fs.files.keys()].filter((k) => k.includes("/databases/"))).to.deep.equal([]);
            expect((await store.status()).entryCount).to.equal(0);
            expect(capture.events.some((e) => e.type === "metadataCache.clear")).to.equal(true);
        } finally {
            capture.dispose();
        }
    });
});

// ---------------------------------------------------------------------------
// Privacy — bytes on disk + event fields
// ---------------------------------------------------------------------------

suite("Metadata cache coordinator (CACHE-2): privacy canary (bytes on disk)", () => {
    test("default policy: no host/user/token strings, no description prose in ANY file; exact db name only inside the manifest", async () => {
        const fs = new MemFs();
        const { coordinator } = makeCoordinator(fs, testSettings());
        const key: CacheEntryKey = { serverFingerprint: SFP, database: "CanaryDb" };
        const capture = captureEvents();
        try {
            expect((await coordinator.saveNow(key, buildSnapshot())).result).to.equal("saved");
            expectHit(await coordinator.load(key));
            for (const [path, bytes] of fs.files) {
                const text = path.endsWith("catalog.json.gz")
                    ? gunzipSync(bytes).toString("utf8")
                    : bytes.toString("utf8");
                for (const canary of [CANARY_HOST, CANARY_USER, CANARY_TOKEN, CANARY_PROSE]) {
                    expect(text.includes(canary), `${canary} must not reach ${path}`).to.equal(
                        false,
                    );
                }
                // Raw database names never appear in paths.
                expect(path.includes("CanaryDb")).to.equal(false);
            }
            // Exact spelling IS sanctioned inside the manifest (addendum §5.2).
            const manifest = parseManifestFile(fs, key);
            expect((manifest["key"] as Record<string, unknown>)["databaseExact"]).to.equal(
                "CanaryDb",
            );
            // Events: hash prefixes only — no raw db name, no canaries, no
            // contentHash (addendum Q2 keeps it out of events).
            const eventsJson = JSON.stringify(
                capture.events.filter((e) => e.type.startsWith("metadataCache.")),
            );
            expect(eventsJson.length).to.be.greaterThan(2);
            for (const forbidden of [
                "CanaryDb",
                CANARY_HOST,
                CANARY_USER,
                CANARY_TOKEN,
                CANARY_PROSE,
                "csh_",
            ]) {
                expect(eventsJson.includes(forbidden), `${forbidden} must not be emitted`).to.equal(
                    false,
                );
            }
        } finally {
            capture.dispose();
        }
    });
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

suite("Metadata cache settings (CACHE-2)", () => {
    test("defaults: disabled, 14d/256MiB/32MiB/5s, privacy flags off, derived policyId", () => {
        expect(DEFAULT_METADATA_CACHE_SETTINGS).to.deep.equal({
            enabled: false,
            maxAgeDays: 14,
            maxBytes: 268_435_456,
            maxEntryBytes: 33_554_432,
            writeDelayMs: 5_000,
            persistDescriptions: false,
            persistModuleDefinitions: false,
            offlineMode: false,
            policyId: "cp1:d0m0",
        });
    });

    test("accessor adapter reads mssql.metadataCache.* without vscode; bad values fall back", () => {
        const values: Record<string, unknown> = {
            enabled: true,
            maxAgeDays: 7,
            maxBytes: "lots", // wrong type → default
            maxEntryBytes: Number.NaN, // non-finite → default
            writeDelayMs: -5, // negative → default
            persistDescriptions: true,
            offlineMode: true,
        };
        const settings = readMetadataCacheSettings(
            (key, defaultValue) => values[key] ?? defaultValue,
        );
        expect(settings.enabled).to.equal(true);
        expect(settings.maxAgeDays).to.equal(7);
        expect(settings.maxBytes).to.equal(268_435_456);
        expect(settings.maxEntryBytes).to.equal(33_554_432);
        expect(settings.writeDelayMs).to.equal(5_000);
        expect(settings.persistDescriptions).to.equal(true);
        expect(settings.offlineMode).to.equal(true);
        expect(settings.policyId).to.equal("cp1:d1m0");
        expect(
            cachePolicyId({ persistDescriptions: true, persistModuleDefinitions: true }),
        ).to.equal("cp1:d1m1");
    });
});
