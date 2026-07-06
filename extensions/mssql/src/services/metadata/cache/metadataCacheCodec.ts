/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Snapshot cache codec (CACHE-1; cache/drift design §7.3, review addendum §6
 * — NORMATIVE). Serializes a published CatalogSnapshot to the JSON payload
 * persisted by the disk cache, and rehydrates a payload back into a
 * CatalogBuilder/CatalogSnapshot by DIRECT array adoption — never by
 * replaying addObject/intern (addendum §6.1: re-interning would forfeit the
 * symbol-id identity that makes contentHash and byte-identity trivially
 * provable, and is slower).
 *
 * Canonical field order: CANONICAL_PAYLOAD_FIELDS below is FROZEN — it is
 * both the serialization order and the contentHash order (§6.2). Any change
 * to the arrays or their order MUST hand-bump CATALOG_MODEL_VERSION beside
 * it; a version mismatch is a clean cache miss (reason "modelVersion"),
 * never a migration in v1.
 *
 * Privacy: MS_Description rows are OPTIONAL and excluded by default policy
 * (base §8.1). Excluding them removes the three description arrays AND
 * blanks the interned description-value strings that no included array
 * references, so the prose never reaches disk (§8 privacy canary runs
 * against the bytes on disk). Module definitions are NEVER in payload v1
 * (base §2 non-goal; addendum C-5.3) — the lazy read stays live-only.
 *
 * contentHash (C-2): "csh_" + base64url(sha256(canonical-order JSON))
 * .slice(0, 22). Because the payload is exactly the SoA arrays in hydration
 * order, live-hydrated and cache-rehydrated snapshots with identical data
 * hash identically by construction — that equality doubles as the
 * round-trip proof (§6.5). Node crypto is allowed here: this is
 * extension-host code, not the pure engine.
 */

import { createHash } from "crypto";
import {
    CatalogBuilder,
    CatalogEnvironment,
    CatalogSection,
    CatalogSnapshot,
    KeyConstraintKind,
    ObjectKind,
    SectionState,
} from "../catalogModel";

/**
 * Hand-bumped catalog model version (addendum §6.2). Bump whenever the
 * payload arrays, their meaning, or CANONICAL_PAYLOAD_FIELDS change.
 */
export const CATALOG_MODEL_VERSION = "cm1";

/**
 * FROZEN canonical field order — the serialization order AND the hash
 * order (addendum §6.2). Do not reorder, insert, or remove entries without
 * bumping CATALOG_MODEL_VERSION.
 */
export const CANONICAL_PAYLOAD_FIELDS = [
    "environment",
    "strings",
    "schemaIds",
    "schemaNameSyms",
    "objectIds",
    "objectSchemaIds",
    "objectNameSyms",
    "objectKinds",
    "objectModifyDates",
    "columnOwner",
    "columnNameSyms",
    "columnTypeSyms",
    "columnNullable",
    "columnIdentity",
    "columnComputed",
    "fkFrom",
    "fkTo",
    "fkNameSyms",
    "fkConstraintIds",
    "fkColumnConstraintIds",
    "fkColumnFromSyms",
    "fkColumnToSyms",
    "pkOwner",
    "pkColumnNameSyms",
    "keyConstraintOwner",
    "keyConstraintNameSyms",
    "keyConstraintKinds",
    "keyConstraintColumnSyms",
    "paramOwner",
    "paramOrdinals",
    "paramNameSyms",
    "paramTypeSyms",
    "paramOutput",
    "descriptionOwner",
    "descriptionColumnSyms",
    "descriptionValueSyms",
] as const;

/** Canonical key order inside the environment block (part of the hash). */
export const CANONICAL_ENVIRONMENT_FIELDS = [
    "engineEdition",
    "defaultSchema",
    "collationName",
    "caseSensitive",
] as const;

export type CanonicalPayloadField = (typeof CANONICAL_PAYLOAD_FIELDS)[number];

/**
 * The persisted payload (v1): environment + string intern table + every SoA
 * array family in the frozen canonical order. `objectModifyDates` uses null
 * (not undefined) for unknown dates — JSON has no undefined. The three
 * description arrays are OPTIONAL and appear only when the manifest's
 * privacy flag says so; module definitions are never here.
 */
export interface CatalogCachePayloadV1 {
    readonly environment: CatalogEnvironment;
    readonly strings: readonly string[];
    readonly schemaIds: readonly number[];
    readonly schemaNameSyms: readonly number[];
    readonly objectIds: readonly number[];
    readonly objectSchemaIds: readonly number[];
    readonly objectNameSyms: readonly number[];
    readonly objectKinds: readonly ObjectKind[];
    readonly objectModifyDates: readonly (string | null)[];
    readonly columnOwner: readonly number[];
    readonly columnNameSyms: readonly number[];
    readonly columnTypeSyms: readonly number[];
    readonly columnNullable: readonly boolean[];
    readonly columnIdentity: readonly boolean[];
    readonly columnComputed: readonly boolean[];
    readonly fkFrom: readonly number[];
    readonly fkTo: readonly number[];
    readonly fkNameSyms: readonly number[];
    readonly fkConstraintIds: readonly number[];
    readonly fkColumnConstraintIds: readonly number[];
    readonly fkColumnFromSyms: readonly number[];
    readonly fkColumnToSyms: readonly number[];
    readonly pkOwner: readonly number[];
    readonly pkColumnNameSyms: readonly number[];
    readonly keyConstraintOwner: readonly number[];
    readonly keyConstraintNameSyms: readonly number[];
    readonly keyConstraintKinds: readonly KeyConstraintKind[];
    readonly keyConstraintColumnSyms: readonly number[];
    readonly paramOwner: readonly number[];
    readonly paramOrdinals: readonly number[];
    readonly paramNameSyms: readonly number[];
    readonly paramTypeSyms: readonly number[];
    readonly paramOutput: readonly boolean[];
    readonly descriptionOwner?: readonly number[];
    readonly descriptionColumnSyms?: readonly number[];
    readonly descriptionValueSyms?: readonly number[];
}

export interface SerializeSnapshotOptions {
    /**
     * Persist MS_Description rows (privacy-gated; default false — base
     * §8.1). When false, the description arrays are omitted and the
     * description-value strings they interned are blanked from the string
     * table (deterministically, so the round-trip contentHash is stable).
     */
    readonly includeDescriptions?: boolean;
}

export interface RehydrateOptions {
    readonly generation: number;
    readonly readiness: Partial<Record<CatalogSection, SectionState>>;
    readonly mode: "full" | "lite" | "partial";
}

export type PayloadValidationResult =
    | { readonly ok: true; readonly payload: CatalogCachePayloadV1 }
    | { readonly ok: false; readonly reason: "shape"; readonly detail: string };

const OBJECT_KINDS: ReadonlySet<string> = new Set([
    "table",
    "view",
    "procedure",
    "scalarFunction",
    "tableFunction",
    "synonym",
]);

const KEY_CONSTRAINT_KINDS: ReadonlySet<string> = new Set(["primaryKey", "uniqueConstraint"]);

const DESCRIPTION_FIELDS: readonly CanonicalPayloadField[] = [
    "descriptionOwner",
    "descriptionColumnSyms",
    "descriptionValueSyms",
];

/**
 * Sym-typed fields (indexes into `strings`) among the always-present
 * arrays — used both for range validation and for the orphan-string
 * blanking that keeps excluded description prose off disk.
 */
const INCLUDED_SYM_FIELDS = [
    "schemaNameSyms",
    "objectNameSyms",
    "columnNameSyms",
    "columnTypeSyms",
    "fkNameSyms",
    "fkColumnFromSyms",
    "fkColumnToSyms",
    "pkColumnNameSyms",
    "keyConstraintNameSyms",
    "keyConstraintColumnSyms",
    "paramNameSyms",
    "paramTypeSyms",
] as const;

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

/** Serialize a published snapshot to the v1 payload (detached copies). */
export function serializeSnapshot(
    snapshot: CatalogSnapshot,
    options?: SerializeSnapshotOptions,
): CatalogCachePayloadV1 {
    const view = snapshot.codecView;
    const payload: CatalogCachePayloadV1 = {
        environment: canonicalEnvironment(view.environment),
        strings: [...view.strings],
        schemaIds: [...view.schemaIds],
        schemaNameSyms: [...view.schemaNameSyms],
        objectIds: [...view.objectIds],
        objectSchemaIds: [...view.objectSchemaIds],
        objectNameSyms: [...view.objectNameSyms],
        objectKinds: [...view.objectKinds],
        objectModifyDates: view.objectModifyDates.map((date) => (date === undefined ? null : date)),
        columnOwner: [...view.columnOwner],
        columnNameSyms: [...view.columnNameSyms],
        columnTypeSyms: [...view.columnTypeSyms],
        columnNullable: [...view.columnNullable],
        columnIdentity: [...view.columnIdentity],
        columnComputed: [...view.columnComputed],
        fkFrom: [...view.fkFrom],
        fkTo: [...view.fkTo],
        fkNameSyms: [...view.fkNameSyms],
        fkConstraintIds: [...view.fkConstraintIds],
        fkColumnConstraintIds: [...view.fkColumnConstraintIds],
        fkColumnFromSyms: [...view.fkColumnFromSyms],
        fkColumnToSyms: [...view.fkColumnToSyms],
        pkOwner: [...view.pkOwner],
        pkColumnNameSyms: [...view.pkColumnNameSyms],
        keyConstraintOwner: [...view.keyConstraintOwner],
        keyConstraintNameSyms: [...view.keyConstraintNameSyms],
        keyConstraintKinds: [...view.keyConstraintKinds],
        keyConstraintColumnSyms: [...view.keyConstraintColumnSyms],
        paramOwner: [...view.paramOwner],
        paramOrdinals: [...view.paramOrdinals],
        paramNameSyms: [...view.paramNameSyms],
        paramTypeSyms: [...view.paramTypeSyms],
        paramOutput: [...view.paramOutput],
        descriptionOwner: [...view.descriptionOwner],
        descriptionColumnSyms: [...view.descriptionColumnSyms],
        descriptionValueSyms: [...view.descriptionValueSyms],
    };
    if (options?.includeDescriptions === true) {
        return payload;
    }
    return stripDescriptions(payload);
}

/**
 * Remove the description arrays and blank every string no included array
 * references (C-5 save direction + §8 privacy). Deterministic and
 * idempotent: a payload that already lacks descriptions round-trips
 * byte-identically, so contentHash is stable across serialize→rehydrate→
 * serialize. Also used by the coordinator's load-time policy intersection.
 */
export function stripDescriptions(payload: CatalogCachePayloadV1): CatalogCachePayloadV1 {
    const hadDescriptions =
        payload.descriptionOwner !== undefined ||
        payload.descriptionColumnSyms !== undefined ||
        payload.descriptionValueSyms !== undefined;
    if (!hadDescriptions) {
        return payload;
    }
    const hadRows = (payload.descriptionValueSyms?.length ?? 0) > 0;
    // Copy + delete (the rest-omission destructuring pattern is lint-flagged).
    const stripped = { ...payload } as {
        -readonly [K in keyof CatalogCachePayloadV1]: CatalogCachePayloadV1[K];
    };
    delete stripped.descriptionOwner;
    delete stripped.descriptionColumnSyms;
    delete stripped.descriptionValueSyms;
    if (hadRows) {
        const used = new Set<number>();
        for (const field of INCLUDED_SYM_FIELDS) {
            for (const sym of stripped[field]) {
                used.add(sym);
            }
        }
        stripped.strings = stripped.strings.map((value, sym) => (used.has(sym) ? value : ""));
    }
    return stripped;
}

// ---------------------------------------------------------------------------
// Canonical JSON + contentHash (C-2)
// ---------------------------------------------------------------------------

function canonicalEnvironment(environment: CatalogEnvironment): CatalogEnvironment {
    const ordered: Record<string, unknown> = {};
    for (const field of CANONICAL_ENVIRONMENT_FIELDS) {
        const value = (environment as Record<string, unknown>)[field];
        if (value !== undefined) {
            ordered[field] = value;
        }
    }
    return ordered as CatalogEnvironment;
}

/**
 * The payload rendered as JSON with fields in the FROZEN canonical order —
 * the exact bytes the contentHash covers and the store persists (gzipped).
 */
export function canonicalPayloadJson(payload: CatalogCachePayloadV1): string {
    const ordered: Record<string, unknown> = {};
    const record = payload as unknown as Record<string, unknown>;
    for (const field of CANONICAL_PAYLOAD_FIELDS) {
        const value = record[field];
        if (value === undefined) {
            continue;
        }
        ordered[field] =
            field === "environment" ? canonicalEnvironment(payload.environment) : value;
    }
    return JSON.stringify(ordered);
}

/** "csh_" + base64url(sha256(canonical-order JSON)).slice(0, 22) (C-2). */
export function computeContentHash(payload: CatalogCachePayloadV1): string {
    const digest = createHash("sha256")
        .update(canonicalPayloadJson(payload), "utf8")
        .digest("base64url");
    return `csh_${digest.slice(0, 22)}`;
}

// ---------------------------------------------------------------------------
// Strict validation (addendum §6.4)
// ---------------------------------------------------------------------------

type FieldKind = "symArray" | "intArray" | "boolArray" | "stringArray";

const FIELD_KINDS: Readonly<Record<string, FieldKind>> = {
    strings: "stringArray",
    schemaIds: "intArray",
    schemaNameSyms: "symArray",
    objectIds: "intArray",
    objectSchemaIds: "intArray",
    objectNameSyms: "symArray",
    columnOwner: "intArray",
    columnNameSyms: "symArray",
    columnTypeSyms: "symArray",
    columnNullable: "boolArray",
    columnIdentity: "boolArray",
    columnComputed: "boolArray",
    fkFrom: "intArray",
    fkTo: "intArray",
    fkNameSyms: "symArray",
    fkConstraintIds: "intArray",
    fkColumnConstraintIds: "intArray",
    fkColumnFromSyms: "symArray",
    fkColumnToSyms: "symArray",
    pkOwner: "intArray",
    pkColumnNameSyms: "symArray",
    keyConstraintOwner: "intArray",
    keyConstraintNameSyms: "symArray",
    keyConstraintColumnSyms: "symArray",
    paramOwner: "intArray",
    paramOrdinals: "intArray",
    paramNameSyms: "symArray",
    paramTypeSyms: "symArray",
    paramOutput: "boolArray",
    descriptionOwner: "intArray",
    descriptionColumnSyms: "intArray", // -1 sentinel allowed; range-checked below
    descriptionValueSyms: "symArray",
};

const CANONICAL_FIELD_SET: ReadonlySet<string> = new Set(CANONICAL_PAYLOAD_FIELDS);

const ENVIRONMENT_FIELD_SET: ReadonlySet<string> = new Set(CANONICAL_ENVIRONMENT_FIELDS);

function reject(detail: string): PayloadValidationResult {
    return { ok: false, reason: "shape", detail };
}

function isIntArray(value: unknown): value is number[] {
    return (
        Array.isArray(value) &&
        value.every((item) => typeof item === "number" && Number.isInteger(item))
    );
}

/**
 * STRICT payload validation (addendum §6.4): unknown top-level fields
 * reject, non-finite/non-integer numbers reject, description arrays are
 * present exactly when the manifest's privacy flag says so, parallel
 * arrays agree in length, and sym/owner indexes stay in range. Everything
 * here maps to a clean cache miss (reason "shape"), never a throw.
 */
export function validatePayload(
    value: unknown,
    options: { readonly descriptionsExpected: boolean },
): PayloadValidationResult {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return reject("notObject");
    }
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
        if (!CANONICAL_FIELD_SET.has(key)) {
            return reject(`unknownField:${key}`);
        }
    }
    // environment
    const environment = record["environment"];
    if (typeof environment !== "object" || environment === null || Array.isArray(environment)) {
        return reject("environment");
    }
    const env = environment as Record<string, unknown>;
    for (const key of Object.keys(env)) {
        if (!ENVIRONMENT_FIELD_SET.has(key)) {
            return reject(`unknownEnvironmentField:${key}`);
        }
    }
    if (env["engineEdition"] !== undefined) {
        if (typeof env["engineEdition"] !== "number" || !Number.isFinite(env["engineEdition"])) {
            return reject("environment.engineEdition");
        }
    }
    if (env["defaultSchema"] !== undefined && typeof env["defaultSchema"] !== "string") {
        return reject("environment.defaultSchema");
    }
    if (env["collationName"] !== undefined && typeof env["collationName"] !== "string") {
        return reject("environment.collationName");
    }
    if (env["caseSensitive"] !== undefined && typeof env["caseSensitive"] !== "boolean") {
        return reject("environment.caseSensitive");
    }
    // presence: every non-optional canonical field must exist; description
    // arrays exactly per the manifest flag (C-5).
    for (const field of CANONICAL_PAYLOAD_FIELDS) {
        const isDescription = DESCRIPTION_FIELDS.includes(field);
        const present = record[field] !== undefined;
        if (isDescription) {
            if (present !== options.descriptionsExpected) {
                return reject(present ? `unexpectedSection:${field}` : `missingSection:${field}`);
            }
        } else if (!present) {
            return reject(`missingField:${field}`);
        }
    }
    // element types
    for (const [field, kind] of Object.entries(FIELD_KINDS)) {
        const array = record[field];
        if (array === undefined) {
            continue; // optional description field, absence already checked
        }
        if (!Array.isArray(array)) {
            return reject(`notArray:${field}`);
        }
        if (kind === "stringArray") {
            if (!array.every((item) => typeof item === "string")) {
                return reject(`elementType:${field}`);
            }
        } else if (kind === "boolArray") {
            if (!array.every((item) => typeof item === "boolean")) {
                return reject(`elementType:${field}`);
            }
        } else if (!isIntArray(array)) {
            return reject(`elementType:${field}`);
        }
    }
    const kinds = record["objectKinds"];
    if (
        !Array.isArray(kinds) ||
        !kinds.every((k) => typeof k === "string" && OBJECT_KINDS.has(k))
    ) {
        return reject("elementType:objectKinds");
    }
    const keyKinds = record["keyConstraintKinds"];
    if (
        !Array.isArray(keyKinds) ||
        !keyKinds.every((k) => typeof k === "string" && KEY_CONSTRAINT_KINDS.has(k))
    ) {
        return reject("elementType:keyConstraintKinds");
    }
    const modifyDates = record["objectModifyDates"];
    if (
        !Array.isArray(modifyDates) ||
        !modifyDates.every((d) => d === null || typeof d === "string")
    ) {
        return reject("elementType:objectModifyDates");
    }
    const payload = value as CatalogCachePayloadV1;
    // parallel lengths
    const lengthGroups: ReadonlyArray<readonly [string, number, number]> = [
        ["schemaNameSyms", payload.schemaNameSyms.length, payload.schemaIds.length],
        ["objectSchemaIds", payload.objectSchemaIds.length, payload.objectIds.length],
        ["objectNameSyms", payload.objectNameSyms.length, payload.objectIds.length],
        ["objectKinds", payload.objectKinds.length, payload.objectIds.length],
        ["objectModifyDates", payload.objectModifyDates.length, payload.objectIds.length],
        ["columnNameSyms", payload.columnNameSyms.length, payload.columnOwner.length],
        ["columnTypeSyms", payload.columnTypeSyms.length, payload.columnOwner.length],
        ["columnNullable", payload.columnNullable.length, payload.columnOwner.length],
        ["columnIdentity", payload.columnIdentity.length, payload.columnOwner.length],
        ["columnComputed", payload.columnComputed.length, payload.columnOwner.length],
        ["fkTo", payload.fkTo.length, payload.fkFrom.length],
        ["fkNameSyms", payload.fkNameSyms.length, payload.fkFrom.length],
        ["fkConstraintIds", payload.fkConstraintIds.length, payload.fkFrom.length],
        ["fkColumnFromSyms", payload.fkColumnFromSyms.length, payload.fkColumnConstraintIds.length],
        ["fkColumnToSyms", payload.fkColumnToSyms.length, payload.fkColumnConstraintIds.length],
        ["pkColumnNameSyms", payload.pkColumnNameSyms.length, payload.pkOwner.length],
        [
            "keyConstraintNameSyms",
            payload.keyConstraintNameSyms.length,
            payload.keyConstraintOwner.length,
        ],
        [
            "keyConstraintKinds",
            payload.keyConstraintKinds.length,
            payload.keyConstraintOwner.length,
        ],
        [
            "keyConstraintColumnSyms",
            payload.keyConstraintColumnSyms.length,
            payload.keyConstraintOwner.length,
        ],
        ["paramOrdinals", payload.paramOrdinals.length, payload.paramOwner.length],
        ["paramNameSyms", payload.paramNameSyms.length, payload.paramOwner.length],
        ["paramTypeSyms", payload.paramTypeSyms.length, payload.paramOwner.length],
        ["paramOutput", payload.paramOutput.length, payload.paramOwner.length],
    ];
    if (options.descriptionsExpected) {
        const owner = payload.descriptionOwner ?? [];
        if (
            (payload.descriptionColumnSyms ?? []).length !== owner.length ||
            (payload.descriptionValueSyms ?? []).length !== owner.length
        ) {
            return reject("lengthMismatch:descriptions");
        }
    }
    for (const [field, actual, expected] of lengthGroups) {
        if (actual !== expected) {
            return reject(`lengthMismatch:${field}`);
        }
    }
    // ranges
    const stringCount = payload.strings.length;
    const objectCount = payload.objectIds.length;
    const symFields: readonly (readonly [string, readonly number[]])[] = [
        ["schemaNameSyms", payload.schemaNameSyms],
        ["objectNameSyms", payload.objectNameSyms],
        ["columnNameSyms", payload.columnNameSyms],
        ["columnTypeSyms", payload.columnTypeSyms],
        ["fkNameSyms", payload.fkNameSyms],
        ["fkColumnFromSyms", payload.fkColumnFromSyms],
        ["fkColumnToSyms", payload.fkColumnToSyms],
        ["pkColumnNameSyms", payload.pkColumnNameSyms],
        ["keyConstraintNameSyms", payload.keyConstraintNameSyms],
        ["keyConstraintColumnSyms", payload.keyConstraintColumnSyms],
        ["paramNameSyms", payload.paramNameSyms],
        ["paramTypeSyms", payload.paramTypeSyms],
        ["descriptionValueSyms", payload.descriptionValueSyms ?? []],
    ];
    for (const [field, syms] of symFields) {
        for (const sym of syms) {
            if (sym < 0 || sym >= stringCount) {
                return reject(`symRange:${field}`);
            }
        }
    }
    for (const sym of payload.descriptionColumnSyms ?? []) {
        if (sym < -1 || sym >= stringCount) {
            return reject("symRange:descriptionColumnSyms");
        }
    }
    const ownerFields: readonly (readonly [string, readonly number[]])[] = [
        ["columnOwner", payload.columnOwner],
        ["pkOwner", payload.pkOwner],
        ["keyConstraintOwner", payload.keyConstraintOwner],
        ["paramOwner", payload.paramOwner],
        ["descriptionOwner", payload.descriptionOwner ?? []],
    ];
    for (const [field, owners] of ownerFields) {
        for (const owner of owners) {
            if (owner < 0 || owner >= objectCount) {
                return reject(`ownerRange:${field}`);
            }
        }
    }
    return { ok: true, payload };
}

// ---------------------------------------------------------------------------
// Adopt + rehydrate (addendum §6.1: DIRECT array assignment)
// ---------------------------------------------------------------------------

/**
 * TypeScript-private friend surface of CatalogBuilder's intern table. The
 * codec is the sanctioned friend (base §7.3 "friend" note made concrete):
 * the string table is assigned DIRECTLY, preserving every symbol id, so a
 * rehydrated builder is bit-for-bit the builder that was serialized.
 */
interface BuilderInternFriend {
    strings: string[];
    stringIndex: Map<string, number>;
}

/**
 * Construct a CatalogBuilder from a validated payload by direct array
 * assignment — NEVER by replaying addObject/intern (§6.1). Arrays are
 * copied so the builder never aliases the (possibly cached) payload.
 */
export function adoptPayload(payload: CatalogCachePayloadV1): CatalogBuilder {
    const builder = new CatalogBuilder();
    const friend = builder as unknown as BuilderInternFriend;
    friend.strings = [...payload.strings];
    const index = new Map<string, number>();
    for (let sym = 0; sym < payload.strings.length; sym++) {
        const value = payload.strings[sym];
        if (!index.has(value)) {
            index.set(value, sym);
        }
    }
    friend.stringIndex = index;

    builder.schemaIds = [...payload.schemaIds];
    builder.schemaNameSyms = [...payload.schemaNameSyms];
    builder.objectIds = [...payload.objectIds];
    builder.objectSchemaIds = [...payload.objectSchemaIds];
    builder.objectNameSyms = [...payload.objectNameSyms];
    builder.objectKinds = [...payload.objectKinds];
    builder.objectModifyDates = payload.objectModifyDates.map((date) =>
        date === null ? undefined : date,
    );
    builder.columnOwner = [...payload.columnOwner];
    builder.columnNameSyms = [...payload.columnNameSyms];
    builder.columnTypeSyms = [...payload.columnTypeSyms];
    builder.columnNullable = [...payload.columnNullable];
    builder.columnIdentity = [...payload.columnIdentity];
    builder.columnComputed = [...payload.columnComputed];
    builder.fkFrom = [...payload.fkFrom];
    builder.fkTo = [...payload.fkTo];
    builder.fkNameSyms = [...payload.fkNameSyms];
    builder.fkConstraintIds = [...payload.fkConstraintIds];
    builder.fkColumnConstraintIds = [...payload.fkColumnConstraintIds];
    builder.fkColumnFromSyms = [...payload.fkColumnFromSyms];
    builder.fkColumnToSyms = [...payload.fkColumnToSyms];
    builder.pkOwner = [...payload.pkOwner];
    builder.pkColumnNameSyms = [...payload.pkColumnNameSyms];
    builder.keyConstraintOwner = [...payload.keyConstraintOwner];
    builder.keyConstraintNameSyms = [...payload.keyConstraintNameSyms];
    builder.keyConstraintKinds = [...payload.keyConstraintKinds];
    builder.keyConstraintColumnSyms = [...payload.keyConstraintColumnSyms];
    builder.paramOwner = [...payload.paramOwner];
    builder.paramOrdinals = [...payload.paramOrdinals];
    builder.paramNameSyms = [...payload.paramNameSyms];
    builder.paramTypeSyms = [...payload.paramTypeSyms];
    builder.paramOutput = [...payload.paramOutput];
    builder.descriptionOwner = [...(payload.descriptionOwner ?? [])];
    builder.descriptionColumnSyms = [...(payload.descriptionColumnSyms ?? [])];
    builder.descriptionValueSyms = [...(payload.descriptionValueSyms ?? [])];

    // Environment travels (§6.3, incl. the C-11-corrected caseSensitive):
    // direct field assignment, mirroring the builder defaults for absences.
    builder.engineEdition = payload.environment.engineEdition;
    builder.defaultSchema = payload.environment.defaultSchema ?? "dbo";
    builder.collationName = payload.environment.collationName;
    builder.caseSensitive = payload.environment.caseSensitive ?? false;
    return builder;
}

/**
 * Payload → published snapshot, carrying generation/readiness/mode from the
 * manifest (the coordinator applies the C-5 policy intersection to the
 * readiness it passes here). The snapshot's contentHash is computed from
 * the payload — the trust anchor for cross-process determinism (C-2).
 */
export function rehydrateSnapshot(
    payload: CatalogCachePayloadV1,
    options: RehydrateOptions,
): CatalogSnapshot {
    const snapshot = adoptPayload(payload).build(
        options.generation,
        options.readiness,
        options.mode,
    );
    snapshot.setContentHashOnce(computeContentHash(payload));
    return snapshot;
}
