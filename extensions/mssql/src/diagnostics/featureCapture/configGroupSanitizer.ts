/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Config-group sanitization (addendum §7.6: "sensitive values never enter a
 * shared config group") — the ONE allowlist both boundaries use:
 *
 * - the Replay Lab wire (`sanitizeReplayLabConfigGroup`, consumed by the
 *   dc/replayRunDetail projection in replayLabRpcHost.ts), and
 * - the durable run repository (`sanitizeConfigGroupForPersistence`, applied
 *   BEFORE configGroups.json is written — the run directory's bundle
 *   descriptor claims `containsRichPayload: false`, so content-bearing
 *   values must never land in it).
 *
 * Everything is allowlist-based: keys not listed here are DROPPED, and
 * `customSystemPrompt` (user text) collapses to a `customSystemPromptUsed`
 * flag. `effectiveConfigDigest` is preserved as computed over the ORIGINAL
 * effective config — it identifies the experiment configuration; the stored
 * sanitized copy is the safe projection of it.
 */

import { ConfigGroupV1 } from "../../sharedInterfaces/configGroup";
import { ReplayLabConfigGroupV1 } from "../../sharedInterfaces/replayLabRpc";

/** The content-bearing key that collapses to a boolean flag. */
export const CUSTOM_SYSTEM_PROMPT_KEY = "customSystemPrompt";
export const CUSTOM_SYSTEM_PROMPT_FLAG_KEY = "customSystemPromptUsed";

/**
 * Keys of feature replay configs that are safe metadata. Anything not listed
 * — notably `customSystemPrompt` (user text) and unknown future keys — is
 * dropped by every sanitizer below. One flat set on purpose: feature key
 * spaces do not collide, and a single list keeps the wire and the disk
 * boundary provably identical.
 */
export const SAFE_CONFIG_GROUP_KEYS: ReadonlySet<string> = new Set([
    // completions replay config
    "profileId",
    "modelSelector",
    "continuationModelSelector",
    "useSchemaContext",
    "includeSqlDiagnostics",
    "debounceMs",
    "maxTokens",
    "enabledCategories",
    "forceIntentMode",
    "allowAutomaticTriggers",
    "schemaContext",
    "replayMode",
    "schemaFallbackToCaptured",
    // Query Studio replay config (WI-3.6) — database context, execution
    // mode, stop-on-error, and the numeric QueryTuning knob overrides.
    "database",
    "mode",
    "stopOnError",
    "tuning",
    // the sanitized replacement flag itself (already-sanitized groups
    // round-trip unchanged)
    CUSTOM_SYSTEM_PROMPT_FLAG_KEY,
]);

function hadCustomSystemPrompt(record: Record<string, unknown> | undefined): boolean {
    if (!record) {
        return false;
    }
    const raw = record[CUSTOM_SYSTEM_PROMPT_KEY];
    if (typeof raw === "string" && raw.length > 0) {
        return true;
    }
    // Already-sanitized shape: the flag stands in for the prompt text.
    return record[CUSTOM_SYSTEM_PROMPT_FLAG_KEY] === true;
}

/** Allowlist projection of one overrides/effective-config record. */
function sanitizeConfigRecord(
    record: Record<string, unknown> | undefined,
): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record ?? {})) {
        if (SAFE_CONFIG_GROUP_KEYS.has(key) && value !== undefined) {
            sanitized[key] = value;
        }
    }
    if (hadCustomSystemPrompt(record)) {
        sanitized[CUSTOM_SYSTEM_PROMPT_FLAG_KEY] = true;
    }
    return sanitized;
}

/**
 * Persist-time sanitization (§7.6): the same ConfigGroupV1 shape with every
 * content-bearing value removed — `partialOverrides` and `effectiveConfig`
 * are allowlist projections (prompt text → `customSystemPromptUsed: true`),
 * and `settingMutability` keeps only the surviving keys. Idempotent, so
 * groups sanitized here read back through the wire sanitizer unchanged.
 */
export function sanitizeConfigGroupForPersistence(group: ConfigGroupV1): ConfigGroupV1 {
    const partialOverrides = sanitizeConfigRecord(group.partialOverrides);
    const effectiveConfig = group.effectiveConfig
        ? sanitizeConfigRecord(group.effectiveConfig)
        : undefined;
    const settingMutability: ConfigGroupV1["settingMutability"] = {};
    for (const [key, mutability] of Object.entries(group.settingMutability ?? {})) {
        if (SAFE_CONFIG_GROUP_KEYS.has(key)) {
            settingMutability[key] = mutability;
        }
    }
    return {
        ...group,
        partialOverrides,
        ...(effectiveConfig !== undefined ? { effectiveConfig } : {}),
        settingMutability,
    };
}

/**
 * Wire projection for the Replay Lab (dc/replayRunDetail): a thin summary
 * row built from the same allowlist. Handles BOTH the sanitized on-disk
 * shape (new runs) and legacy unsanitized groups (runs persisted before the
 * §7.6 persist-time fix).
 */
export function sanitizeReplayLabConfigGroup(group: ConfigGroupV1): ReplayLabConfigGroupV1 {
    const overridesSummary: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(group.partialOverrides ?? {})) {
        if (
            SAFE_CONFIG_GROUP_KEYS.has(key) &&
            key !== CUSTOM_SYSTEM_PROMPT_FLAG_KEY &&
            value !== undefined
        ) {
            overridesSummary[key] = value;
        }
    }
    const effective = group.effectiveConfig ?? {};
    const replayMode = effective.replayMode ?? group.partialOverrides?.replayMode;
    return {
        configGroupId: group.configGroupId,
        label: group.label,
        version: group.version,
        ...(group.baseProfileId ? { baseProfileId: group.baseProfileId } : {}),
        ...(group.baseProfileVersion !== undefined
            ? { baseProfileVersion: group.baseProfileVersion }
            : {}),
        effectiveConfigDigest: group.effectiveConfigDigest ?? "",
        ...(typeof replayMode === "string" ? { replayMode } : {}),
        overridesSummary,
        customSystemPromptUsed:
            hadCustomSystemPrompt(group.effectiveConfig) ||
            hadCustomSystemPrompt(group.partialOverrides),
    };
}
