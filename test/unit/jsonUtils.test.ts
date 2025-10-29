/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import { isJson, IsJsonRegex } from "../../src/sharedInterfaces/jsonUtils";

suite("isJsonCell Tests", () => {
    suite("Valid JSON objects", () => {
        test("Should return true for valid empty object", () => {
            const value = "{}";
            assert.strictEqual(isJson(value), true, "Empty object should be valid JSON");
        });

        test("Should return true for valid object with properties", () => {
            const value = '{"name": "John", "age": 30}';
            assert.strictEqual(isJson(value), true, "Object with properties should be valid JSON");
        });

        test("Should return true for nested objects", () => {
            const value = '{"user": {"name": "John", "details": {"age": 30}}}';
            assert.strictEqual(isJson(value), true, "Nested objects should be valid JSON");
        });

        test("Should return true for object with array values", () => {
            const value = '{"items": [1, 2, 3], "tags": ["red", "blue"]}';
            assert.strictEqual(isJson(value), true, "Object with arrays should be valid JSON");
        });

        test("Should return true for object with whitespace", () => {
            const value = '  { "name": "John" }  ';
            assert.strictEqual(isJson(value), true, "Object with whitespace should be valid JSON");
        });

        test("Should return true for object with newlines", () => {
            const value = `{
                "name": "John",
                "age": 30
            }`;
            assert.strictEqual(isJson(value), true, "Object with newlines should be valid JSON");
        });
    });

    suite("Valid JSON arrays", () => {
        test("Should return true for valid empty array", () => {
            const value = "[]";
            assert.strictEqual(isJson(value), true, "Empty array should be valid JSON");
        });

        test("Should return true for array with numbers", () => {
            const value = "[1, 2, 3, 4, 5]";
            assert.strictEqual(isJson(value), true, "Number array should be valid JSON");
        });

        test("Should return true for array with strings", () => {
            const value = '["apple", "banana", "cherry"]';
            assert.strictEqual(isJson(value), true, "String array should be valid JSON");
        });

        test("Should return true for array with objects", () => {
            const value = '[{"id": 1, "name": "John"}, {"id": 2, "name": "Jane"}]';
            assert.strictEqual(isJson(value), true, "Array with objects should be valid JSON");
        });

        test("Should return true for nested arrays", () => {
            const value = "[[1, 2], [3, 4], [5, 6]]";
            assert.strictEqual(isJson(value), true, "Nested arrays should be valid JSON");
        });

        test("Should return true for array with whitespace", () => {
            const value = "  [1, 2, 3]  ";
            assert.strictEqual(isJson(value), true, "Array with whitespace should be valid JSON");
        });
    });

    suite("Invalid JSON strings", () => {
        test("Should return false for invalid object syntax", () => {
            const value = '{name: "John"}'; // Missing quotes around key
            assert.strictEqual(isJson(value), false, "Invalid object syntax should return false");
        });

        test("Should return false for invalid array syntax", () => {
            const value = "[1, 2, 3,]"; // Trailing comma
            assert.strictEqual(isJson(value), false, "Invalid array syntax should return false");
        });

        test("Should return false for unclosed object", () => {
            const value = '{"name": "John"';
            assert.strictEqual(isJson(value), false, "Unclosed object should return false");
        });

        test("Should return false for unclosed array", () => {
            const value = "[1, 2, 3";
            assert.strictEqual(isJson(value), false, "Unclosed array should return false");
        });

        test("Should return false for plain string", () => {
            const value = "Hello World";
            assert.strictEqual(isJson(value), false, "Plain string should return false");
        });

        test("Should return false for quoted string", () => {
            const value = '"Hello World"';
            assert.strictEqual(
                isJson(value),
                false,
                "Quoted string should return false (regex doesn't match)",
            );
        });

        test("Should return false for number", () => {
            const value = "123";
            assert.strictEqual(
                isJson(value),
                false,
                "Number should return false (regex doesn't match)",
            );
        });

        test("Should return false for string that matches regex but isn't valid JSON", () => {
            const value = "{this is not json}";
            assert.strictEqual(
                isJson(value),
                false,
                "String matching regex but invalid JSON should return false",
            );
        });

        test("Should return false for array-like string that isn't valid JSON", () => {
            const value = "[this, is, not, json]";
            assert.strictEqual(isJson(value), false, "Array-like invalid JSON should return false");
        });
    });

    suite("Null and empty values", () => {
        test("Should return false for undefined object", () => {
            const value = undefined;
            assert.strictEqual(isJson(value), false, "Undefined object should return false");
        });

        test("Should return false for empty string", () => {
            const value = "";
            assert.strictEqual(isJson(value), false, "Empty string should return false");
        });
    });

    suite("Regex validation", () => {
        test("IsJsonRegex should match empty object", () => {
            assert.ok("{}".match(IsJsonRegex), "Empty object should match regex");
        });

        test("IsJsonRegex should match empty array", () => {
            assert.ok("[]".match(IsJsonRegex), "Empty array should match regex");
        });

        test("IsJsonRegex should match object with whitespace", () => {
            assert.ok("  { }  ".match(IsJsonRegex), "Object with whitespace should match regex");
        });

        test("IsJsonRegex should match array with whitespace", () => {
            assert.ok("  [ ]  ".match(IsJsonRegex), "Array with whitespace should match regex");
        });

        test("IsJsonRegex should not match plain string", () => {
            assert.ok(!"hello world".match(IsJsonRegex), "Plain string should not match regex");
        });

        test("IsJsonRegex should not match quoted string", () => {
            assert.ok(!'"hello world"'.match(IsJsonRegex), "Quoted string should not match regex");
        });

        test("IsJsonRegex should not match number", () => {
            assert.ok(!"123".match(IsJsonRegex), "Number should not match regex");
        });

        test("IsJsonRegex should match complex nested structure", () => {
            const complexJson = '{"a": [1, {"b": []}]}';
            assert.ok(
                complexJson.match(IsJsonRegex),
                "Complex nested structure should match regex",
            );
        });
    });
});
