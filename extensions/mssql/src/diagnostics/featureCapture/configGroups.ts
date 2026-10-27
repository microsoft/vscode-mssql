/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Host-side config-group helpers (final plan WI-3.1 / addendum §7.6).
 * The contracts live in src/sharedInterfaces/configGroup.ts (webview-safe);
 * digesting needs crypto, so the implementations live here.
 */

import { createHash } from "crypto";
import { ConfigGroupDigestResolver } from "../../sharedInterfaces/configGroup";
import { canonicalJson } from "./journalReconciliation";

/** sha256 hex over canonical (recursively key-sorted) JSON of any value. */
export function sha256OfCanonicalJson(value: unknown): string {
    return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

/**
 * The `mssql.configGroup/1` digest: sha256 of the key-sorted canonical JSON
 * of `effectiveConfig` (undefined entries dropped). Stable across key order
 * and serialization whitespace — the identity two matrix cells share when
 * they resolve to the same effective configuration.
 */
export const resolveConfigGroupDigest: ConfigGroupDigestResolver = (effectiveConfig) =>
    sha256OfCanonicalJson(effectiveConfig);

/**
 * Deterministic config-group id derived from the effective-config digest:
 * cells that resolve to identical effective configs collapse to ONE group in
 * the run manifest. Truncation keeps ids readable; the full digest rides in
 * `effectiveConfigDigest`.
 */
export function deriveConfigGroupId(effectiveConfigDigest: string): string {
    return `cg-${effectiveConfigDigest.slice(0, 16)}`;
}
