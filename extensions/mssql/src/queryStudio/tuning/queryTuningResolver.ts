/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * QueryTuning resolution (QO-1): folds the override layers into ONE frozen
 * per-run snapshot with a stable digest. Precedence per knob:
 *
 *   run override ?? live override store ?? mssql.queryStudio.tuning.overrides
 *     ?? profile preset ?? dedicated setting ?? QUERY_TUNING_DEFAULTS
 *
 * Profile selection follows the same ladder (run ?? store ?? setting ??
 * "interactive"). The digest is a salt-free hash over the resolved params in
 * canonical key order so identical parameters compare equal ACROSS sessions
 * and machines — that is what lets perftest spreads and replay experiments
 * correlate runs by parameter set.
 */

import * as crypto from "crypto";
import * as vscode from "vscode";
import {
    QUERY_TUNING_DEFAULTS,
    QUERY_TUNING_KEYS,
    QUERY_TUNING_PROFILES,
    QueryTuningOverrides,
    QueryTuningParams,
    QueryTuningProfileId,
    QueryTuningSnapshot,
    normalizeQueryTuningOverrides,
    normalizeQueryTuningProfileId,
    normalizeQueryTuningValue,
    queryTuningOverrideValue,
} from "../../sharedInterfaces/queryTuning";
import { queryTuningOverrideStore } from "./queryTuningStore";

export const QUERY_TUNING_PROFILE_SETTING = "mssql.queryStudio.tuning.profile";
export const QUERY_TUNING_OVERRIDES_SETTING = "mssql.queryStudio.tuning.overrides";

/** Injectable settings reader — tests pass a fake; product uses VS Code config. */
export interface QueryTuningSettingsReader {
    get(section: string): unknown;
}

const vscodeSettingsReader: QueryTuningSettingsReader = {
    get: (section) => vscode.workspace.getConfiguration().get(section),
};

/**
 * Pre-tuning settings that keep working (back-compat): each feeds exactly one
 * knob at the dedicated-setting layer.
 */
const DEDICATED_SETTINGS: Partial<Record<keyof QueryTuningParams, string>> = {
    maxRowsPerResultSet: "mssql.queryStudio.maxRowsPerResultSet",
    inMemorySortFilterThreshold: "mssql.resultsGrid.inMemoryDataProcessingThreshold",
};

export interface ResolveQueryTuningOptions {
    /** Highest-precedence per-run overrides (replay/experiment supplied). */
    runOverrides?: QueryTuningOverrides;
    /** Test seam; defaults to the live singleton. */
    storeOverrides?: QueryTuningOverrides;
    /** Test seam; defaults to VS Code workspace configuration. */
    reader?: QueryTuningSettingsReader;
}

export function resolveQueryTuning(options: ResolveQueryTuningOptions = {}): QueryTuningSnapshot {
    const reader = options.reader ?? vscodeSettingsReader;
    const runOverrides = normalizeQueryTuningOverrides(options.runOverrides ?? {});
    const storeOverrides = normalizeQueryTuningOverrides(
        options.storeOverrides ?? queryTuningOverrideStore.getOverrides(),
    );
    const settingsOverrides = normalizeQueryTuningOverrides(
        reader.get(QUERY_TUNING_OVERRIDES_SETTING),
    );

    const profileId: QueryTuningProfileId =
        (runOverrides.profileId === null ? undefined : runOverrides.profileId) ??
        (storeOverrides.profileId === null ? undefined : storeOverrides.profileId) ??
        normalizeQueryTuningProfileId(reader.get(QUERY_TUNING_PROFILE_SETTING)) ??
        "interactive";
    const profile: Partial<QueryTuningParams> =
        profileId === "custom" ? {} : QUERY_TUNING_PROFILES[profileId];

    const draft: Record<string, QueryTuningParams[keyof QueryTuningParams]> = {};
    const overriddenKeys: Array<keyof QueryTuningParams> = [];
    for (const key of QUERY_TUNING_KEYS) {
        const overridden =
            queryTuningOverrideValue(runOverrides, key) ??
            queryTuningOverrideValue(storeOverrides, key) ??
            queryTuningOverrideValue(settingsOverrides, key);
        if (overridden !== undefined) {
            overriddenKeys.push(key);
            draft[key] = overridden;
            continue;
        }
        const fromProfile = profile[key];
        if (fromProfile !== undefined) {
            draft[key] = fromProfile;
            continue;
        }
        draft[key] = dedicatedSettingValue(reader, key) ?? QUERY_TUNING_DEFAULTS[key];
    }
    const params = Object.freeze(draft as unknown as QueryTuningParams);

    return {
        profileId,
        digest: computeQueryTuningDigest(params),
        params,
        overriddenKeys,
    };
}

function dedicatedSettingValue(
    reader: QueryTuningSettingsReader,
    key: keyof QueryTuningParams,
): QueryTuningParams[keyof QueryTuningParams] | undefined {
    const section = DEDICATED_SETTINGS[key];
    if (!section) {
        return undefined;
    }
    const raw = reader.get(section);
    return raw === undefined ? undefined : normalizeQueryTuningValue(key, raw);
}

/**
 * Stable, salt-free digest of resolved params in canonical key order. NOT a
 * privacy digest — the value space is numbers/booleans/closed enums only.
 */
export function computeQueryTuningDigest(params: QueryTuningParams): string {
    const canonical = QUERY_TUNING_KEYS.map((key) => `${key}=${String(params[key])}`).join(";");
    return crypto.createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 12);
}
