/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fabricDatabaseHubBaseLink = "https://msit.fabric.microsoft.com/workloads/fdh/databaseHub";

export const getFabricDatabaseHubDatabaseLink = (databaseResourceId: string): string => {
    const estateView = {
        schemaVersion: 1,
        state: {
            filters: [
                {
                    key: "resourceType",
                    operator: "in",
                    value: ["AzureSql"],
                },
            ],
            category: ["all"],
            relevance: ["all"],
            sort: {
                column: "issues",
                direction: "descending",
            },
        },
    };

    let normalizedResourceId: string;
    try {
        normalizedResourceId = decodeURIComponent(databaseResourceId);
    } catch {
        normalizedResourceId = databaseResourceId;
    }

    return `${fabricDatabaseHubBaseLink}/estate?estateView=${encodeURIComponent(
        JSON.stringify(estateView),
    )}&databaseResourceId=${encodeURIComponent(normalizedResourceId)}`;
};
