/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as mssql from "vscode-mssql";
import { SchemaUpdateAction } from "../../../../sharedInterfaces/schemaCompare";

export interface SchemaCompareApplyTypeCount {
    objectType: string;
    count: number;
}

export interface SchemaCompareApplySummarySection {
    action: SchemaUpdateAction;
    totalCount: number;
    typeCounts: SchemaCompareApplyTypeCount[];
}

const applyActionOrder = [
    SchemaUpdateAction.Add,
    SchemaUpdateAction.Change,
    SchemaUpdateAction.Delete,
];

export function getSchemaCompareApplySummarySections(
    differences: mssql.DiffEntry[],
): SchemaCompareApplySummarySection[] {
    const countsByAction = new Map<SchemaUpdateAction, Map<string, number>>();

    for (const difference of differences) {
        if (!difference.included || !applyActionOrder.includes(difference.updateAction)) {
            continue;
        }

        const objectType =
            difference.name?.trim() ||
            difference.sourceObjectType?.trim() ||
            difference.targetObjectType?.trim();
        if (!objectType) {
            continue;
        }

        const typeCounts = countsByAction.get(difference.updateAction) ?? new Map<string, number>();
        typeCounts.set(objectType, (typeCounts.get(objectType) ?? 0) + 1);
        countsByAction.set(difference.updateAction, typeCounts);
    }

    return applyActionOrder.flatMap((action) => {
        const typeCounts = countsByAction.get(action);
        if (!typeCounts) {
            return [];
        }

        const sortedTypeCounts = [...typeCounts.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([objectType, count]) => ({ objectType, count }));

        return [
            {
                action,
                totalCount: sortedTypeCounts.reduce((total, entry) => total + entry.count, 0),
                typeCounts: sortedTypeCounts,
            },
        ];
    });
}

export function getSchemaCompareApplyTargetName(endpoint: mssql.SchemaCompareEndpointInfo): string {
    const connectionName =
        endpoint.connectionName?.trim() ||
        endpoint.serverName?.trim() ||
        endpoint.serverDisplayName?.trim();

    if (!connectionName) {
        return endpoint.projectFilePath?.trim() || endpoint.packageFilePath?.trim() || "";
    }

    const targetDatabase = endpoint.databaseName?.trim();
    if (!targetDatabase) {
        return connectionName;
    }

    const configuredDatabase = endpoint.connectionDetails?.options?.database;
    const connectionDatabase =
        typeof configuredDatabase === "string" ? configuredDatabase.trim() : "";

    return connectionDatabase.localeCompare(targetDatabase, undefined, {
        sensitivity: "accent",
    }) === 0
        ? connectionName
        : `${connectionName}:${targetDatabase}`;
}
