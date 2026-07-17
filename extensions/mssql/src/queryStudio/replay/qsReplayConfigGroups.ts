/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query Studio config-group factory (WI-3.6 / addendum §7.6), mirroring the
 * completions factory: builds `mssql.configGroup/1` groups from a frozen
 * QsReplayConfig so durable QS runs carry digestable experiment units.
 *
 * Setting mutability: every QS replay config key applies per execution —
 * database context, execution mode, stop-on-error, and QueryTuning overrides
 * are all resolved at item start, so the whole surface is "hot" (§7.6:
 * Replay Lab may only apply hot/nextRequest settings).
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
import { QsReplayConfig } from "../../sharedInterfaces/queryStudioReplay";

export const QS_CONFIG_GROUP_FEATURE_ID = "queryStudio";

/** Compact experiment label from the config's deviating dimensions. */
export function formatQsConfigGroupLabel(config: QsReplayConfig): string {
    const parts: string[] = [];
    if (config.mode !== null) {
        parts.push(config.mode);
    }
    if (config.database !== null) {
        parts.push(config.database);
    }
    if (config.stopOnError !== null) {
        parts.push(config.stopOnError ? "stopOnError" : "continueOnError");
    }
    if (config.tuning !== null) {
        parts.push("tuned");
    }
    return parts.length > 0 ? parts.join(" · ") : "record config";
}

export function createQsReplayConfigGroup(config: QsReplayConfig, label: string): ConfigGroupV1 {
    const effectiveConfig = cloneJson(config) as unknown as Record<string, unknown>;
    const partialOverrides: Record<string, unknown> = {};
    const settingMutability: Record<string, SettingMutability> = {};
    for (const [key, value] of Object.entries(effectiveConfig)) {
        settingMutability[key] = "hot"; // every QS key applies per execution
        if (value !== null && value !== undefined) {
            partialOverrides[key] = value;
        }
    }
    const effectiveConfigDigest = resolveConfigGroupDigest(effectiveConfig);
    return {
        schema: CONFIG_GROUP_SCHEMA,
        configGroupId: deriveConfigGroupId(effectiveConfigDigest),
        featureId: QS_CONFIG_GROUP_FEATURE_ID,
        version: 1,
        label,
        partialOverrides,
        effectiveConfig,
        effectiveConfigDigest,
        settingMutability,
    };
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}
