/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export enum SubKeys {
    Filter = "filter",
    ColumnWidth = "columnWidth",
}

class QueryResultSingletonStore {
    private static instance: QueryResultSingletonStore;
    private store: Map<string, Map<string, any>>;

    // Private constructor to prevent instantiation from outside
    private constructor() {
        this.store = new Map<string, Map<string, any>>();
    }

    // Method to get the single instance of the store
    public static getInstance(): QueryResultSingletonStore {
        if (!QueryResultSingletonStore.instance) {
            QueryResultSingletonStore.instance = new QueryResultSingletonStore();
        }
        return QueryResultSingletonStore.instance;
    }

    // Method to set a nested value in the store
    public set(mainKey: string, subKey: string, value: any): void {
        let nestedMap = this.store.get(mainKey);
        if (!nestedMap) {
            nestedMap = new Map<string, any>();
            nestedMap.set(subKey, value);
            this.store.set(mainKey, nestedMap);
        } else {
            nestedMap.set(subKey, value);
            this.store.set(mainKey, nestedMap);
        }
    }

    // Method to get a nested value from the store
    public get<T>(mainKey: string, subKey: string): T | undefined {
        const nestedMap = this.store.get(mainKey);
        return nestedMap?.get(subKey);
    }

    // Method to check if a nested key exists
    public has(mainKey: string, subKey: string): boolean {
        return this.store.get(mainKey)?.has(subKey) ?? false;
    }

    // Method to delete a nested key-value pair
    public delete(mainKey: string, subKey: string): boolean {
        const nestedMap = this.store.get(mainKey);
        if (nestedMap) {
            const deleted = nestedMap.delete(subKey);
            if (nestedMap.size === 0) {
                this.store.delete(mainKey);
            }
            return deleted;
        }
        return false;
    }

    // Method to clear the entire store
    public clear(): void {
        this.store.clear();
    }

    // Optional: delete entire nested map
    public deleteMainKey(mainKey: string): boolean {
        return this.store.delete(mainKey);
    }

    // Optional: get entire nested map
    public getAll(mainKey: string): Map<string, any> | undefined {
        return this.store.get(mainKey);
    }
}

// Export the singleton instance
const store = QueryResultSingletonStore.getInstance();
export default store;
