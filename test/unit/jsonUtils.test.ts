/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isJson } from "../../src/reactviews/common/jsonUtils";
import { expect } from "@playwright/test";

suite("isJsonCell Tests", () => {
    suite("Valid JSON objects", () => {
        test("Should return true for valid empty object", () => {
            const value = "{}";
            expect(isJson(value), "Empty object should be valid JSON").toBe(true);
        });

        test("Should return true for valid object with properties", () => {
            const value = '{"name": "John", "age": 30}';
            expect(isJson(value), "Object with properties should be valid JSON").toBe(true);
        });

        test("Should return true for nested objects", () => {
            const value = '{"user": {"name": "John", "details": {"age": 30}}}';
            expect(isJson(value), "Nested objects should be valid JSON").toBe(true);
        });

        test("Should return true for object with array values", () => {
            const value = '{"items": [1, 2, 3], "tags": ["red", "blue"]}';
            expect(isJson(value), "Object with arrays should be valid JSON").toBe(true);
        });

        test("Should return true for object with whitespace", () => {
            const value = '  { "name": "John" }  ';
            expect(isJson(value), "Object with whitespace should be valid JSON").toBe(true);
        });

        test("Should return true for object with newlines", () => {
            const value = `{
                "name": "John",
                "age": 30
            }`;
            expect(isJson(value), "Object with newlines should be valid JSON").toBe(true);
        });
    });

    suite("Valid JSON arrays", () => {
        test("Should return true for valid empty array", () => {
            const value = "[]";
            expect(isJson(value), "Empty array should be valid JSON").toBe(true);
        });

        test("Should return true for array with numbers", () => {
            const value = "[1, 2, 3, 4, 5]";
            expect(isJson(value), "Number array should be valid JSON").toBe(true);
        });

        test("Should return true for array with strings", () => {
            const value = '["apple", "banana", "cherry"]';
            expect(isJson(value), "String array should be valid JSON").toBe(true);
        });

        test("Should return true for array with objects", () => {
            const value = '[{"id": 1, "name": "John"}, {"id": 2, "name": "Jane"}]';
            expect(isJson(value), "Array with objects should be valid JSON").toBe(true);
        });

        test("Should return true for nested arrays", () => {
            const value = "[[1, 2], [3, 4], [5, 6]]";
            expect(isJson(value), "Nested arrays should be valid JSON").toBe(true);
        });

        test("Should return true for array with whitespace", () => {
            const value = "  [1, 2, 3]  ";
            expect(isJson(value), "Array with whitespace should be valid JSON").toBe(true);
        });
    });

    suite("Invalid JSON strings", () => {
        test("Should return false for invalid object syntax", () => {
            const value = '{name: "John"}'; // Missing quotes around key
            expect(isJson(value), "Invalid object syntax should return false").toBe(false);
        });

        test("Should return false for invalid array syntax", () => {
            const value = "[1, 2, 3,]"; // Trailing comma
            expect(
                isJson(value),
                "Invalid array syntax (with trailing comma) should return false",
            ).toBe(false);
        });

        test("Should return false for unclosed object", () => {
            const value = '{"name": "John"';
            expect(isJson(value), "Unclosed object should return false").toBe(false);
        });

        test("Should return false for unclosed array", () => {
            const value = "[1, 2, 3";
            expect(isJson(value), "Unclosed array should return false").toBe(false);
        });

        test("Should return false for plain string", () => {
            const value = "Hello World";
            expect(isJson(value), "Plain string should return false").toBe(false);
        });

        test("Should return false for quoted string", () => {
            const value = '"Hello World"';
            expect(isJson(value), "Quoted string should return false (regex doesn't match)").toBe(
                false,
            );
        });

        test("Should return false for number", () => {
            const value = "123";
            expect(isJson(value), "Number should return false (regex doesn't match)").toBe(false);
        });

        test("Should return false for string that matches regex but isn't valid JSON", () => {
            const value = "{this is not json}";
            expect(
                isJson(value),
                "String matching regex but invalid JSON should return false",
            ).toBe(false);
        });

        test("Should return false for array-like string that isn't valid JSON", () => {
            const value = "[this, is, not, json]";
            expect(isJson(value), "Array-like invalid JSON should return false").toBe(false);
        });
    });

    suite("Null and empty values", () => {
        test("Should return false for undefined object", () => {
            const value = undefined;
            expect(isJson(value), "Undefined object should return false").toBe(false);
        });

        test("Should return false for empty string", () => {
            const value = "";
            expect(isJson(value), "Empty string should return false").toBe(false);
        });
    });
});
