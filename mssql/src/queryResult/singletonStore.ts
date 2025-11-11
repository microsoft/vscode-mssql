/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ColumnFilterMap, GetGridScrollPositionResponse } from "../sharedInterfaces/queryResult";

export class QueryResultSingletonStore {
    private static _instance: QueryResultSingletonStore;

    /**
     * Keeping states flat to avoid concurrency issues with updating nested objects.
     */

    public gridState = {
        maximizedGridIds: new Map<string, string>(),
        resultsTabYOffsets: new Map<string, number>(),
        messagesTabYOffsets: new Map<string, number>(),
        gridColumnFilters: new Map<string, ColumnFilterMap>(),
        gridColumnWidths: new Map<string, number[]>(),
        gridScrollPositions: new Map<string, GetGridScrollPositionResponse>(),
    };

    /**
     * Private constructor to prevent instantiation from outside.
     */
    private constructor() {}

    /**
     * Method to get the single instance of the store.
     * @returns The singleton instance of `QueryResultSingletonStore`.
     */
    public static getInstance(): QueryResultSingletonStore {
        if (!QueryResultSingletonStore._instance) {
            QueryResultSingletonStore._instance = new QueryResultSingletonStore();
        }
        return QueryResultSingletonStore._instance;
    }

    public static generateGridKey(uri: string, gridId: string): string {
        return `${uri}::${gridId}`;
    }

    /**
     * Deletes all data associated with a given URI.
     * @param uri The URI whose associated data is to be deleted.
     */
    public deleteUriState(uri: string): void {
        Object.keys(this.gridState).forEach((key) => {
            const map = (this.gridState as any)[key] as Map<any, any>;
            if (map instanceof Map) {
                // For maps that use composite keys, we need to iterate and delete
                for (const mapKey of map.keys()) {
                    if (mapKey === uri || mapKey.startsWith(`${uri}::`)) {
                        map.delete(mapKey);
                    }
                }
            }
        });
    }
}

// Export the singleton instance
const store = QueryResultSingletonStore.getInstance();
export default store;
