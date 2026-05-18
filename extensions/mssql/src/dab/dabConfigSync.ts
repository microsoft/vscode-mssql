/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dab } from "../sharedInterfaces/dab";
import { SchemaDesigner } from "../sharedInterfaces/schemaDesigner";

export function syncDabConfigWithSchema(
    currentConfig: Dab.DabConfig | null,
    schemaTables: SchemaDesigner.Table[],
): { config: Dab.DabConfig; changed: boolean } {
    const synced = Dab.syncConfigWithSchema(currentConfig, schemaTables);
    const normalized = normalizeUnsupportedColumnExposure(synced.config);
    let changed = synced.changed || normalized.changed;
    if (!currentConfig) {
        return {
            config: normalized.config,
            changed,
        };
    }

    const currentById = new Map(currentConfig.entities.map((entity) => [entity.id, entity]));
    const entities = normalized.config.entities.map((entity) => {
        const existing = currentById.get(entity.id);
        if (!existing) {
            return entity;
        }

        const restored: Dab.DabEntityConfig = {
            ...entity,
            sourceType: existing.sourceType,
            parameters: existing.parameters?.map((parameter) => ({ ...parameter })),
            restMethods: existing.restMethods ? [...existing.restMethods] : undefined,
            graphQLOperation: existing.graphQLOperation,
            mcpCustomTool: existing.mcpCustomTool,
            advancedJson: existing.advancedJson ? { ...existing.advancedJson } : undefined,
        };

        if (JSON.stringify(restored) !== JSON.stringify(entity)) {
            changed = true;
        }

        return restored;
    });

    return {
        config: {
            ...normalized.config,
            entities,
            advancedJson: currentConfig.advancedJson
                ? { ...currentConfig.advancedJson }
                : normalized.config.advancedJson,
        },
        changed,
    };
}

function normalizeUnsupportedColumnExposure(config: Dab.DabConfig): {
    config: Dab.DabConfig;
    changed: boolean;
} {
    let changed = false;
    const entities = config.entities.map((entity) => {
        let entityChanged = false;
        const columns = entity.columns.map((column) => {
            if (!column.isSupported && column.isExposed) {
                changed = true;
                entityChanged = true;
                return {
                    ...column,
                    isExposed: false,
                };
            }
            return column;
        });

        return !entityChanged
            ? entity
            : {
                  ...entity,
                  columns,
              };
    });

    return {
        config: {
            ...config,
            entities,
        },
        changed,
    };
}
