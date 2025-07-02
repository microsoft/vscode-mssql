/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import store, { QueryResultSingletonStore } from "../../src/extension/queryResult/singletonStore";

suite("QueryResultSingletonStore", () => {
    let queryResultStore: QueryResultSingletonStore;

    setup(() => {
        queryResultStore = store;
        store.clear(); // Ensure the store is cleared before each test
    });

    test("should set and get a nested value", () => {
        queryResultStore.set("mainKey1", "subKey1", "value1");
        const result = queryResultStore.get<string>("mainKey1", "subKey1");
        assert.strictEqual(result, "value1", "The value should match the one set");
    });

    test("should return undefined for non-existent keys", () => {
        const result = queryResultStore.get<string>("nonExistentMainKey", "nonExistentSubKey");
        assert.strictEqual(
            result,
            undefined,
            "The result should be undefined for non-existent keys",
        );
    });

    test("should check if a nested key exists", () => {
        queryResultStore.set("mainKey1", "subKey1", "value1");
        const exists = queryResultStore.has("mainKey1", "subKey1");
        assert.strictEqual(exists, true, "The key should exist");

        const notExists = queryResultStore.has("mainKey1", "nonExistentSubKey");
        assert.strictEqual(notExists, false, "The key should not exist");
    });

    test("should delete a nested key-value pair", () => {
        queryResultStore.set("mainKey1", "subKey1", "value1");
        const deleted = queryResultStore.delete("mainKey1", "subKey1");
        assert.strictEqual(deleted, true, "The key-value pair should be deleted");

        const exists = queryResultStore.has("mainKey1", "subKey1");
        assert.strictEqual(exists, false, "The key should no longer exist");
    });

    test("should return false when deleting a non-existent key", () => {
        const deleted = queryResultStore.delete("mainKey1", "nonExistentSubKey");
        assert.strictEqual(deleted, false, "Deleting a non-existent key should return false");
    });

    test("should clear the entire queryResultStore", () => {
        queryResultStore.set("mainKey1", "subKey1", "value1");
        queryResultStore.set("mainKey2", "subKey2", "value2");
        queryResultStore.clear();

        const exists1 = queryResultStore.has("mainKey1", "subKey1");
        const exists2 = queryResultStore.has("mainKey2", "subKey2");
        assert.strictEqual(exists1, false, "The first key should no longer exist");
        assert.strictEqual(exists2, false, "The second key should no longer exist");
    });

    test("should delete an entire nested map", () => {
        queryResultStore.set("mainKey1", "subKey1", "value1");
        queryResultStore.set("mainKey1", "subKey2", "value2");

        const deleted = queryResultStore.deleteMainKey("mainKey1");
        assert.strictEqual(deleted, true, "The main key should be deleted");

        const exists = queryResultStore.getAll("mainKey1");
        assert.strictEqual(exists, undefined, "The main key should no longer exist");
    });

    test("should return false when deleting a non-existent main key", () => {
        const deleted = queryResultStore.deleteMainKey("nonExistentMainKey");
        assert.strictEqual(deleted, false, "Deleting a non-existent main key should return false");
    });

    test("should get all nested values for a main key", () => {
        queryResultStore.set("mainKey1", "subKey1", "value1");
        queryResultStore.set("mainKey1", "subKey2", "value2");

        const allValues = queryResultStore.getAll("mainKey1");
        assert.ok(allValues, "The main key should exist");
        assert.strictEqual(
            allValues?.get("subKey1"),
            "value1",
            "The first subkey value should match",
        );
        assert.strictEqual(
            allValues?.get("subKey2"),
            "value2",
            "The second subkey value should match",
        );
    });

    test("should return undefined when getting all values for a non-existent main key", () => {
        const allValues = queryResultStore.getAll("nonExistentMainKey");
        assert.strictEqual(
            allValues,
            undefined,
            "The result should be undefined for a non-existent main key",
        );
    });
});
