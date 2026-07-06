/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cache manifest (CACHE-1/2; cache/drift design §7.2 plus review addendum
 * §5.1 additions: payload.contentHash, writerId, the environment block, and
 * producer.appVersion). The manifest is the trust root of an entry: a
 * reader trusts only a manifest whose referenced payload exists and whose
 * sha256 matches (base §9.1) — never a payload without a manifest.
 *
 * Version/codec/model mismatches are CLEAN MISSES (never migrations in v1),
 * each with its own reason so dashboards can tell an upgrade wipe from
 * corruption.
 *
 * PRIVACY: `key.databaseExact` is the exact database spelling, plaintext at
 * rest inside the manifest (addendum §5.2 — sanctioned local metadata,
 * matching the tripwire's `database.name` classification). It must never be
 * emitted in events; cache events carry only the dbh_ hash prefix.
 */

import { CatalogSection, SectionState } from "../catalogModel";
import { MetadataValidationTier } from "./metadataFreshness";
import { CATALOG_MODEL_VERSION } from "./metadataCacheCodec";

export const CACHE_FORMAT_VERSION = 1;
export const CACHE_CODEC = "json-gzip-v1";
export const CACHE_PAYLOAD_FILE = "catalog.json.gz";

export interface CatalogCacheManifest {
    readonly formatVersion: typeof CACHE_FORMAT_VERSION;
    readonly producer: {
        readonly extensionVersion?: string;
        /** VS Code version string (addendum §5.1). */
        readonly appVersion?: string;
        readonly gitCommit?: string;
        readonly catalogModelVersion: string;
        readonly cacheCodec: typeof CACHE_CODEC;
    };
    /** "<pid>:<nonce>" — H-4.4 postmortem/raceLost identity. */
    readonly writerId: string;
    readonly key: {
        readonly serverFingerprint: string;
        readonly databaseHash: string;
        readonly databaseExact?: string;
    };
    readonly capture: {
        readonly capturedAtUtc: string;
        readonly publishedGeneration: number;
        readonly source: "live" | "offlineImport";
    };
    readonly validation: {
        readonly lastValidatedAtUtc?: string;
        readonly validationTier?: MetadataValidationTier;
        readonly serverDigest?: string;
        readonly objectDigest?: string;
        readonly sectionDigests?: Partial<Record<CatalogSection, string>>;
    };
    /**
     * Copied from the snapshot's CatalogEnvironment (also inside the
     * payload; duplicated here so status/eviction can reason without
     * decompressing — addendum §5.1).
     */
    readonly environment: {
        readonly engineEdition?: number;
        readonly collationName?: string;
        readonly caseSensitive?: boolean;
        readonly defaultSchema?: string;
    };
    readonly readiness: Record<CatalogSection, SectionState>;
    readonly mode: "full" | "lite" | "partial";
    readonly stats: {
        readonly schemas: number;
        readonly objects: number;
        readonly columns: number;
        readonly foreignKeys: number;
        readonly payloadBytes: number;
        readonly uncompressedBytes?: number;
    };
    readonly privacy: {
        readonly includesDescriptions: boolean;
        readonly includesModuleDefinitions: boolean;
        readonly includesRowCounts: boolean;
        readonly policyId: string;
    };
    readonly payload: {
        readonly file: typeof CACHE_PAYLOAD_FILE;
        /** sha256 (hex) over the COMPRESSED payload file bytes. */
        readonly sha256: string;
        /**
         * Canonical content hash over the UNCOMPRESSED canonical-order JSON
         * (C-2) — codec-independent twin of sha256, and the §5.5
         * skip-save-when-unchanged comparand.
         */
        readonly contentHash: string;
    };
}

export type ManifestMissReason = "shape" | "formatVersion" | "codec" | "modelVersion";

export type ManifestValidationResult =
    | { readonly ok: true; readonly manifest: CatalogCacheManifest }
    | { readonly ok: false; readonly reason: ManifestMissReason; readonly detail?: string };

const SECTION_STATES: ReadonlySet<string> = new Set([
    "absent",
    "loading",
    "ready",
    "failed",
    "stale",
    "lite",
]);

const CATALOG_SECTIONS: ReadonlySet<string> = new Set([
    "schemas",
    "objects",
    "synonyms",
    "columns",
    "types",
    "keys",
    "foreignKeys",
    "indexes",
    "constraints",
    "parameters",
    "descriptions",
    "rowCounts",
]);

const MODES: ReadonlySet<string> = new Set(["full", "lite", "partial"]);
const CAPTURE_SOURCES: ReadonlySet<string> = new Set(["live", "offlineImport"]);

function fail(reason: ManifestMissReason, detail?: string): ManifestValidationResult {
    return detail === undefined ? { ok: false, reason } : { ok: false, reason, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validate a parsed manifest. Check ORDER matters for honest miss reasons:
 * formatVersion first (an unknown future format must not read as "shape"),
 * then codec, then catalog model version, then full shape.
 */
export function validateManifest(value: unknown): ManifestValidationResult {
    if (!isRecord(value)) {
        return fail("shape", "notObject");
    }
    if (value["formatVersion"] !== CACHE_FORMAT_VERSION) {
        return fail("formatVersion");
    }
    const producer = value["producer"];
    if (!isRecord(producer)) {
        return fail("shape", "producer");
    }
    if (producer["cacheCodec"] !== CACHE_CODEC) {
        return fail("codec");
    }
    if (producer["catalogModelVersion"] !== CATALOG_MODEL_VERSION) {
        return fail("modelVersion");
    }
    if (!isNonEmptyString(value["writerId"])) {
        return fail("shape", "writerId");
    }
    const key = value["key"];
    if (
        !isRecord(key) ||
        !isNonEmptyString(key["serverFingerprint"]) ||
        !isNonEmptyString(key["databaseHash"]) ||
        (key["databaseExact"] !== undefined && typeof key["databaseExact"] !== "string")
    ) {
        return fail("shape", "key");
    }
    const capture = value["capture"];
    if (
        !isRecord(capture) ||
        !isNonEmptyString(capture["capturedAtUtc"]) ||
        !isFiniteNumber(capture["publishedGeneration"]) ||
        typeof capture["source"] !== "string" ||
        !CAPTURE_SOURCES.has(capture["source"])
    ) {
        return fail("shape", "capture");
    }
    if (!isRecord(value["validation"])) {
        return fail("shape", "validation");
    }
    if (!isRecord(value["environment"])) {
        return fail("shape", "environment");
    }
    const readiness = value["readiness"];
    if (!isRecord(readiness)) {
        return fail("shape", "readiness");
    }
    for (const [section, state] of Object.entries(readiness)) {
        if (
            !CATALOG_SECTIONS.has(section) ||
            typeof state !== "string" ||
            !SECTION_STATES.has(state)
        ) {
            return fail("shape", `readiness:${section}`);
        }
    }
    if (typeof value["mode"] !== "string" || !MODES.has(value["mode"])) {
        return fail("shape", "mode");
    }
    const stats = value["stats"];
    if (
        !isRecord(stats) ||
        !isFiniteNumber(stats["schemas"]) ||
        !isFiniteNumber(stats["objects"]) ||
        !isFiniteNumber(stats["columns"]) ||
        !isFiniteNumber(stats["foreignKeys"]) ||
        !isFiniteNumber(stats["payloadBytes"]) ||
        (stats["uncompressedBytes"] !== undefined && !isFiniteNumber(stats["uncompressedBytes"]))
    ) {
        return fail("shape", "stats");
    }
    const privacy = value["privacy"];
    if (
        !isRecord(privacy) ||
        typeof privacy["includesDescriptions"] !== "boolean" ||
        typeof privacy["includesModuleDefinitions"] !== "boolean" ||
        typeof privacy["includesRowCounts"] !== "boolean" ||
        !isNonEmptyString(privacy["policyId"])
    ) {
        return fail("shape", "privacy");
    }
    const payload = value["payload"];
    if (
        !isRecord(payload) ||
        payload["file"] !== CACHE_PAYLOAD_FILE ||
        !isNonEmptyString(payload["sha256"]) ||
        !isNonEmptyString(payload["contentHash"])
    ) {
        return fail("shape", "payload");
    }
    return { ok: true, manifest: value as unknown as CatalogCacheManifest };
}
