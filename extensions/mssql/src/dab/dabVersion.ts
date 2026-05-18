/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dab } from "../sharedInterfaces/dab";
import { normalizeIdentifier } from "./dabSnapshot";

export function normalizeDabConfigForVersion(config: Dab.DabConfig) {
    return {
        apiTypes: [...config.apiTypes].map(normalizeIdentifier).sort((a, b) => a.localeCompare(b)),
        advancedJson: config.advancedJson,
        entities: [...config.entities]
            .map((entity) => ({
                id: normalizeIdentifier(entity.id),
                tableName: normalizeIdentifier(entity.tableName),
                schemaName: normalizeIdentifier(entity.schemaName),
                sourceType: entity.sourceType ?? "table",
                isEnabled: entity.isEnabled,
                isSupported: entity.isSupported,
                unsupportedReasons: (entity.unsupportedReasons ?? []).map((reason) => {
                    switch (reason.type) {
                        case "noPrimaryKey":
                            return { type: reason.type };
                        case "unsupportedDataTypes":
                            return {
                                type: reason.type,
                                columns: reason.columns,
                            };
                    }
                }),
                enabledActions: [...entity.enabledActions]
                    .map(normalizeIdentifier)
                    .sort((a, b) => a.localeCompare(b)),
                columns: [...entity.columns]
                    .map((column) => ({
                        id: normalizeIdentifier(column.id),
                        name: normalizeIdentifier(column.name),
                        dataType: normalizeIdentifier(column.dataType),
                        isSupported: column.isSupported,
                        isExposed: column.isExposed,
                    }))
                    .sort((a, b) => {
                        const byName = a.name.localeCompare(b.name);
                        if (byName !== 0) {
                            return byName;
                        }
                        return a.id.localeCompare(b.id);
                    }),
                advancedSettings: {
                    entityName: normalizeIdentifier(entity.advancedSettings.entityName),
                    authorizationRole: normalizeIdentifier(
                        entity.advancedSettings.authorizationRole,
                    ),
                    customRestPath:
                        entity.advancedSettings.customRestPath !== undefined
                            ? entity.advancedSettings.customRestPath
                            : undefined,
                    customGraphQLType:
                        entity.advancedSettings.customGraphQLType !== undefined
                            ? entity.advancedSettings.customGraphQLType
                            : undefined,
                },
                parameters: entity.parameters?.map((parameter) => ({ ...parameter })),
                restMethods: entity.restMethods ? [...entity.restMethods].sort() : undefined,
                graphQLOperation: entity.graphQLOperation,
                mcpCustomTool: entity.mcpCustomTool,
                advancedJson: entity.advancedJson,
            }))
            .sort((a, b) => {
                const bySchema = a.schemaName.localeCompare(b.schemaName);
                if (bySchema !== 0) {
                    return bySchema;
                }
                const byTable = a.tableName.localeCompare(b.tableName);
                if (byTable !== 0) {
                    return byTable;
                }
                return a.id.localeCompare(b.id);
            }),
    };
}

export async function computeDabVersion(config: Dab.DabConfig): Promise<string> {
    const payload = JSON.stringify(normalizeDabConfigForVersion(config));
    const encoder = new TextEncoder();
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(payload));
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
        .join("")
        .toLowerCase();
    return `dabcfg_${hash}`;
}
