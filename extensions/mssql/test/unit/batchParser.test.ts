/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { parseBatches } from "../../src/notebooks/batchParser";

suite("parseBatches", () => {
    test("returns single batch when no GO separator", () => {
        const result = parseBatches("SELECT 1");
        expect(result).to.deep.equal(["SELECT 1"]);
    });

    test("splits on GO separator", () => {
        const result = parseBatches("SELECT 1\nGO\nSELECT 2");
        expect(result).to.deep.equal(["SELECT 1", "SELECT 2"]);
    });

    test("GO is case-insensitive", () => {
        const result = parseBatches("SELECT 1\ngo\nSELECT 2\nGo\nSELECT 3");
        expect(result).to.deep.equal(["SELECT 1", "SELECT 2", "SELECT 3"]);
    });

    test("GO with surrounding whitespace", () => {
        const result = parseBatches("SELECT 1\n  GO  \nSELECT 2");
        expect(result).to.deep.equal(["SELECT 1", "SELECT 2"]);
    });

    test("returns empty array for empty input", () => {
        const result = parseBatches("");
        expect(result).to.deep.equal([]);
    });

    test("returns empty array for whitespace-only input", () => {
        const result = parseBatches("   \n   \n   ");
        expect(result).to.deep.equal([]);
    });

    test("filters out empty batches between consecutive GOs", () => {
        const result = parseBatches("SELECT 1\nGO\nGO\nSELECT 2");
        expect(result).to.deep.equal(["SELECT 1", "SELECT 2"]);
    });

    test("handles GO at the start", () => {
        const result = parseBatches("GO\nSELECT 1");
        expect(result).to.deep.equal(["SELECT 1"]);
    });

    test("handles GO at the end", () => {
        const result = parseBatches("SELECT 1\nGO");
        expect(result).to.deep.equal(["SELECT 1"]);
    });

    test("does not split on GO inside a line", () => {
        const result = parseBatches("SELECT 'GO' AS label");
        expect(result).to.deep.equal(["SELECT 'GO' AS label"]);
    });

    test("trims whitespace from batches", () => {
        const result = parseBatches("  SELECT 1  \nGO\n  SELECT 2  ");
        expect(result).to.deep.equal(["SELECT 1", "SELECT 2"]);
    });

    test("preserves multi-line statements within a batch", () => {
        const sql = "SELECT\n  col1,\n  col2\nFROM table1";
        const result = parseBatches(sql);
        expect(result).to.deep.equal([sql]);
    });
});
