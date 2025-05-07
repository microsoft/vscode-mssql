/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export enum SubKeys {
    Filter = "filter",
    ColumnWidth = "columnWidth",
}

export class QueryResultSingletonStore {
    private static instance: QueryResultSingletonStore;
    private store: Map<string, Map<string, any>>;

    /**
     * Private constructor to prevent instantiation from outside.
     */
    private constructor() {
        this.store = new Map<string, Map<string, any>>();
    }

    /**
     * Method to get the single instance of the store.
     * @returns The singleton instance of `QueryResultSingletonStore`.
     */
    public static getInstance(): QueryResultSingletonStore {
        if (!QueryResultSingletonStore.instance) {
            QueryResultSingletonStore.instance = new QueryResultSingletonStore();
        }
        return QueryResultSingletonStore.instance;
    }

    /**
     * Method to set a nested value in the store.
     * @param mainKey The main key in the store.
     * @param subKey The subkey under the main key.
     * @param value The value to set.
     */
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

    /**
     * Method to get a nested value from the store.
     * @param mainKey The main key in the store.
     * @param subKey The subkey under the main key.
     * @returns The value associated with the subkey, or `undefined` if not found.
     */
    public get<T>(mainKey: string, subKey: string): T | undefined {
        const nestedMap = this.store.get(mainKey);
        return nestedMap?.get(subKey);
    }

    /**
     * Method to check if a nested key exists.
     * @param mainKey The main key in the store.
     * @param subKey The subkey under the main key.
     * @returns `true` if the subkey exists, otherwise `false`.
     */
    public has(mainKey: string, subKey: string): boolean {
        return this.store.get(mainKey)?.has(subKey) ?? false;
    }

    /**
     * Method to delete a nested key-value pair.
     * @param mainKey The main key in the store.
     * @param subKey The subkey under the main key.
     * @returns `true` if the key-value pair was deleted, otherwise `false`.
     */
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

    /**
     * Method to clear the entire store.
     */
    public clear(): void {
        this.store.clear();
    }

    /**
     * Method to delete an entire nested map.
     * @param mainKey The main key in the store.
     * @returns `true` if the main key was deleted, otherwise `false`.
     */
    public deleteMainKey(mainKey: string): boolean {
        return this.store.delete(mainKey);
    }

    /**
     * Method to get an entire nested map.
     * @param mainKey The main key in the store.
     * @returns The nested map associated with the main key, or `undefined` if not found.
     */
    public getAll(mainKey: string): Map<string, any> | undefined {
        return this.store.get(mainKey);
    }
}

// Export the singleton instance
const store = QueryResultSingletonStore.getInstance();
export default store;
