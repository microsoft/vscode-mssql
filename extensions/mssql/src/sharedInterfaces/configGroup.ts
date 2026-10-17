/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Config-group contracts (final plan WI-3.1 / addendum §7.6 — normative).
 * A config group is the common experiment unit of Replay Lab v2: a labeled,
 * versioned, digestable configuration a matrix cell or cart row resolves to.
 * Pure JSON-serializable types, webview-safe.
 *
 * Rules (addendum §7.6):
 * - Replay Lab applies only "hot" and "nextRequest" settings; the other
 *   mutability classes graduate to perftest or a controlled relaunch runner;
 * - a "live" cart mode resolves and FREEZES config at run start;
 * - profile labels and definitions are frozen into the run (baseProfileId +
 *   baseProfileVersion identify exactly which definition generation applied);
 * - sensitive values never enter a shared config group.
 */

/** Frozen schema id (final plan §1.4). */
export const CONFIG_GROUP_SCHEMA = "mssql.configGroup/1";

/**
 * When a setting change actually takes effect (addendum §7.6). Replay Lab
 * may apply "hot" (effective immediately) and "nextRequest" (effective on
 * the next model/SQL request) settings only.
 */
export type SettingMutability =
    | "hot"
    | "nextRequest"
    | "featureRestart"
    | "extensionReload"
    | "hostRelaunch";

/** The mutability classes Replay Lab is allowed to apply (addendum §7.6). */
export const REPLAY_APPLICABLE_MUTABILITIES: readonly SettingMutability[] = ["hot", "nextRequest"];

export function isReplayApplicableMutability(mutability: SettingMutability): boolean {
    return REPLAY_APPLICABLE_MUTABILITIES.includes(mutability);
}

/** Addendum §7.6 — normative. */
export interface ConfigGroupV1 {
    schema: typeof CONFIG_GROUP_SCHEMA;
    configGroupId: string;
    featureId: string;
    version: number;
    label: string;
    description?: string;
    baseProfileId?: string;
    baseProfileVersion?: number;
    partialOverrides: Record<string, unknown>;
    effectiveConfig?: Record<string, unknown>;
    effectiveConfigDigest?: string;
    settingMutability: Record<string, SettingMutability>;
}

/**
 * Digest contract: `effectiveConfigDigest` is the sha256 hex of the
 * key-sorted canonical JSON of `effectiveConfig` (`undefined` entries
 * dropped). The implementation is host-side —
 * `resolveConfigGroupDigest` in
 * `src/diagnostics/featureCapture/configGroups.ts` — because webviews have
 * no crypto; this type keeps callers honest about the function shape.
 */
export type ConfigGroupDigestResolver = (effectiveConfig: Record<string, unknown>) => string;
