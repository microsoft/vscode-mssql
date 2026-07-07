/* GENERATED — do not edit. Source of truth: perftest/packages/perf-contracts/src/central/.
 * Re-vendor: copy the src/central/*.ts files here with this header (see
 * perf-contracts test/centralVendorSync.test.ts, which pins byte equality).
 * Contract central/1.0 — one projection implementation, two writers. */
/**
 * Central-store canonicalization and digest rules (central design §6.2, review
 * addendum C-1/C-14/C-15). This module is the single implementation both
 * writers use — `perftest push` imports it directly and vscode-mssql receives
 * it vendored — so every digest below must be deterministic across processes,
 * platforms, and repos. One implementation, two writers, zero drift.
 *
 * `canonicalJson` moved here from perftest-cli/src/run/environment.ts (which
 * now re-exports it); the environment-hash recipe ("sha256:"+hex) is unchanged
 * and remains the one non-prefixed digest for backwards compatibility.
 */

import { createHash } from "node:crypto";

/** Deterministic JSON: keys sorted at every level, arrays in order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** sha256 → URL-safe base64 without padding (house 22-char short form). */
function sha256B64Url22(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("base64url").slice(0, 22);
}

/** sha256 → full lowercase hex (used where SQL Server recomputes, e.g. locks). */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Digest kinds and their prefixes. Prefixes follow the house style of
 * `sfp_`/`pfp_`/`csh_` elsewhere: 3-4 char tag + "_" + 22-char b64url sha256.
 * The prefix makes accidental cross-kind comparison visible in queries.
 */
export const DIGEST_PREFIXES = {
  /** Pre-policy source artifact inventory (C-1). */
  source: "src",
  /** Canonical policy-filtered content before table projection. */
  content: "cnt",
  /** Projected row set after contract projection. */
  projection: "prj",
  /** One uploaded item / event payload. */
  payload: "pay",
  /** The UploadPreview document itself (C-15 "digest-pinned preview"). */
  preview: "pvw",
  /** Uploader principal (C-14). */
  principal: "prn",
  /** A single payload field re-digested at the upload boundary. */
  field: "fld",
} as const;

export type DigestKind = keyof typeof DIGEST_PREFIXES;

/** Canonicalize `value` and digest it under the given kind's prefix. */
export function digestCanonical(kind: DigestKind, value: unknown): string {
  return `${DIGEST_PREFIXES[kind]}_${sha256B64Url22(canonicalJson(value))}`;
}

/** Digest an already-canonical string (e.g. an item's exact payload JSON). */
export function digestString(kind: DigestKind, canonical: string): string {
  return `${DIGEST_PREFIXES[kind]}_${sha256B64Url22(canonical)}`;
}

// ---------------------------------------------------------------------------
// Uploader principal digest (addendum C-14)
// ---------------------------------------------------------------------------

export type PrincipalKind = "domainUser" | "alias" | "ci" | "servicePrincipal";

export interface PrincipalInput {
  kind: PrincipalKind;
  /** domainUser/alias: UPN or alias; servicePrincipal: appId. */
  value?: string;
  /** ci only. */
  pipelineIdentity?: string;
  /** ci only. */
  poolName?: string;
}

/**
 * Stable, non-reversible principal digest. NOT a security boundary (internal
 * store, guessable inputs) — it exists for stable joins without storing
 * labels. Recipe is contract-owned so both writers derive identical ids.
 */
/**
 * NUL separator used in digest seeds (matches the sfp_/dbh_ house recipes).
 * Built via fromCharCode to keep raw control bytes out of this source file.
 */
const NUL = String.fromCharCode(0);

export function principalDigest(input: PrincipalInput): string {
  let normalized: string;
  switch (input.kind) {
    case "domainUser":
    case "alias":
      normalized = (input.value ?? "").trim().toLowerCase();
      break;
    case "ci":
      normalized = `${input.pipelineIdentity ?? ""}${NUL}${input.poolName ?? ""}`;
      break;
    case "servicePrincipal":
      normalized = input.value ?? "";
      break;
  }
  if (normalized.split(NUL).join("") === "") {
    throw new Error(`principalDigest: empty principal for kind '${input.kind}'`);
  }
  const seed = `central-principal${NUL}${input.kind}${NUL}${normalized}`;
  return `${DIGEST_PREFIXES.principal}_${sha256B64Url22(seed)}`;
}

/**
 * The lock-resource recipe `usp_begin_upload` uses server-side. Kept here so
 * tests and writers can predict/verify it: 'central:' + kind + ':' + lowercase
 * hex sha256 of the natural key (addendum C-2/§3).
 */
export function entityLockResource(kind: string, naturalKey: string): string {
  return `central:${kind}:${sha256Hex(naturalKey)}`;
}
