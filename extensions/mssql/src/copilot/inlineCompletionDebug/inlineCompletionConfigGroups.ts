/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Completions config-group factory (final plan WI-3.1 / addendum §7.6).
 * Builds `mssql.configGroup/1` groups from the completions profile presets
 * plus the materialized replay overrides, so matrix cells and cart rows
 * resolve to durable, digestable experiment units.
 *
 * Setting mutability: EVERY completions override key is "hot" — the whole
 * override surface (profile, model selectors, schema context, debounce,
 * token budget, categories, custom prompt) is re-read per replay request;
 * nothing in this surface needs a feature restart, extension reload, or
 * host relaunch. If a restart-class completions setting ever joins the
 * override surface, it must be classified here and blocked from Replay Lab
 * (§7.6: only "hot"/"nextRequest" apply).
 */

import {
    deriveConfigGroupId,
    resolveConfigGroupDigest,
} from "../../diagnostics/featureCapture/configGroups";
import {
    CONFIG_GROUP_SCHEMA,
    ConfigGroupV1,
    SettingMutability,
} from "../../sharedInterfaces/configGroup";
import { InlineCompletionDebugReplayConfig } from "../../sharedInterfaces/inlineCompletionDebug";
import { INLINE_COMPLETION_PROFILE_DEFINITIONS_VERSION } from "./inlineCompletionDebugProfiles";

export const INLINE_COMPLETION_CONFIG_GROUP_FEATURE_ID = "completions";

/**
 * Build one config group from a materialized (full) replay config. The
 * effective config is the complete overrides object; partialOverrides keep
 * only the keys that actually deviate from "no override" (non-null), so a
 * reader sees at a glance what the group changes.
 */
export function createInlineCompletionConfigGroup(
    config: InlineCompletionDebugReplayConfig,
    label: string,
    description?: string,
): ConfigGroupV1 {
    const effectiveConfig = cloneJson(config) as unknown as Record<string, unknown>;
    const partialOverrides: Record<string, unknown> = {};
    const settingMutability: Record<string, SettingMutability> = {};
    for (const [key, value] of Object.entries(effectiveConfig)) {
        // Every completions override key applies per request — see header.
        settingMutability[key] = "hot";
        if (value !== null && value !== undefined) {
            partialOverrides[key] = value;
        }
    }
    const effectiveConfigDigest = resolveConfigGroupDigest(effectiveConfig);
    return {
        schema: CONFIG_GROUP_SCHEMA,
        configGroupId: deriveConfigGroupId(effectiveConfigDigest),
        featureId: INLINE_COMPLETION_CONFIG_GROUP_FEATURE_ID,
        version: 1,
        label,
        ...(description ? { description } : {}),
        ...(config.profileId ? { baseProfileId: config.profileId } : {}),
        ...(config.profileId
            ? { baseProfileVersion: INLINE_COMPLETION_PROFILE_DEFINITIONS_VERSION }
            : {}),
        partialOverrides,
        effectiveConfig,
        effectiveConfigDigest,
        settingMutability,
    };
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}
