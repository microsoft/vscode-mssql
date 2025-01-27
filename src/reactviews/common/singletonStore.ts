/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// SingletonStore.ts
class SingletonStore {
    private static instance: SingletonStore;
    private store: Map<string, any>;

    // Private constructor to prevent instantiation from outside
    private constructor() {
        this.store = new Map<string, any>();
    }

    // Method to get the single instance of the store
    public static getInstance(): SingletonStore {
        if (!SingletonStore.instance) {
            SingletonStore.instance = new SingletonStore();
        }
        return SingletonStore.instance;
    }

    // Method to set a value in the store
    public set(key: string, value: any): void {
        this.store.set(key, value);
    }

    // Method to get a value from the store
    public get<T>(key: string): T | undefined {
        return this.store.get(key);
    }

    // Method to check if a key exists
    public has(key: string): boolean {
        return this.store.has(key);
    }

    // Method to delete a key-value pair
    public delete(key: string): boolean {
        return this.store.delete(key);
    }

    // Method to clear the store
    public clear(): void {
        this.store.clear();
    }
}

// Export the singleton instance
const store = SingletonStore.getInstance();
export default store;
