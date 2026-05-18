/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dab } from "../sharedInterfaces/dab";

export type DabApplyReturnState = "full" | "summary" | "none";

export const DAB_GET_STATE_ENTITY_THRESHOLD = 150;
export const DAB_APPLY_CHANGES_ENTITY_THRESHOLD = 100;

export interface DabStatePayload {
    returnState: DabApplyReturnState;
    stateOmittedReason?:
        | "entity_count_over_threshold"
        | "caller_requested_summary"
        | "caller_requested_none";
    version: string;
    summary: Dab.DabToolSummary;
    config?: Dab.DabConfig;
}

export function isApplyReturnState(value: unknown): value is DabApplyReturnState {
    return value === "full" || value === "summary" || value === "none";
}

export function cloneDabConfig(config: Dab.DabConfig): Dab.DabConfig {
    return {
        apiTypes: [...config.apiTypes],
        entities: config.entities.map((entity) => ({
            ...entity,
            enabledActions: [...entity.enabledActions],
            columns: entity.columns.map((column) => ({ ...column })),
            unsupportedReasons: entity.unsupportedReasons?.map((reason) => ({ ...reason })),
            parameters: entity.parameters?.map((parameter) => ({ ...parameter })),
            restMethods: entity.restMethods ? [...entity.restMethods] : undefined,
            advancedSettings: { ...entity.advancedSettings },
            advancedJson: entity.advancedJson ? { ...entity.advancedJson } : undefined,
        })),
        advancedJson: config.advancedJson ? { ...config.advancedJson } : undefined,
    };
}

export function normalizeIdentifier(value: string | undefined): string {
    return (value ?? "").trim().toLowerCase();
}

export function buildDabSummary(config: Dab.DabConfig): Dab.DabToolSummary {
    return {
        entityCount: config.entities.length,
        enabledEntityCount: config.entities.filter((entity) => entity.isEnabled).length,
        apiTypes: [...config.apiTypes],
    };
}

export async function buildApplyStatePayload(
    config: Dab.DabConfig,
    requestedReturnState: DabApplyReturnState,
    computeVersion: (config: Dab.DabConfig) => Promise<string>,
    precomputedVersion?: string,
    entityThreshold: number = DAB_APPLY_CHANGES_ENTITY_THRESHOLD,
): Promise<DabStatePayload> {
    const summary = buildDabSummary(config);
    const version = precomputedVersion ?? (await computeVersion(config));

    if (requestedReturnState === "none") {
        return {
            returnState: "none",
            stateOmittedReason: "caller_requested_none",
            version,
            summary,
        };
    }

    if (requestedReturnState === "summary") {
        return {
            returnState: "summary",
            stateOmittedReason: "caller_requested_summary",
            version,
            summary,
        };
    }

    if (summary.entityCount > entityThreshold) {
        return {
            returnState: "summary",
            stateOmittedReason: "entity_count_over_threshold",
            version,
            summary,
        };
    }

    return {
        returnState: "full",
        version,
        summary,
        config,
    };
}
