/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "jsonc-parser";

import {
    diffNsToMs,
    newControlToken,
    newRunId,
    newSpanId,
    newTraceId,
    nowMonotonicNs,
    nowUnixNs,
    traceparent,
    validateConfig,
    validateMarker,
    validateResult,
} from "../src";

const FIXTURES = join(__dirname, "..", "fixtures");

function loadFixture(name: string): unknown {
    const text = readFileSync(join(FIXTURES, name), "utf8");
    return name.endsWith(".jsonc") ? parse(text) : JSON.parse(text);
}

describe("contract fixtures validate (acceptance: design-provided examples)", () => {
    it("marker.example.json is a valid marker", () => {
        const outcome = validateMarker(loadFixture("marker.example.json"));
        expect(outcome.errors).toEqual([]);
        expect(outcome.valid).toBe(true);
    });

    it("result.example.json is a valid perf result", () => {
        const outcome = validateResult(loadFixture("result.example.json"));
        expect(outcome.errors).toEqual([]);
        expect(outcome.valid).toBe(true);
    });

    it("config.measurement.local.jsonc is a valid perf config", () => {
        const outcome = validateConfig(loadFixture("config.measurement.local.jsonc"));
        expect(outcome.errors).toEqual([]);
        expect(outcome.valid).toBe(true);
    });

    it("config.diagnostic.local.jsonc is a valid perf config", () => {
        const outcome = validateConfig(loadFixture("config.diagnostic.local.jsonc"));
        expect(outcome.errors).toEqual([]);
        expect(outcome.valid).toBe(true);
    });
});

describe("contract validation rejects malformed data", () => {
    it("rejects a marker missing required fields", () => {
        const outcome = validateMarker({ schemaVersion: 1, name: "x" });
        expect(outcome.valid).toBe(false);
        expect(outcome.errors.length).toBeGreaterThan(0);
    });

    it("rejects a marker with a bad phase", () => {
        const marker = loadFixture("marker.example.json") as Record<string, unknown>;
        marker["phase"] = "sometimes";
        expect(validateMarker(marker).valid).toBe(false);
    });

    it("rejects a marker with unknown top-level properties", () => {
        const marker = loadFixture("marker.example.json") as Record<string, unknown>;
        marker["surprise"] = true;
        expect(validateMarker(marker).valid).toBe(false);
    });

    it("rejects a result with an invalid status", () => {
        const result = loadFixture("result.example.json") as Record<string, unknown>;
        result["status"] = "great";
        expect(validateResult(result).valid).toBe(false);
    });

    it("rejects a result whose metric has a non-enum source", () => {
        const result = loadFixture("result.example.json") as {
            metrics: Array<Record<string, unknown>>;
        };
        result.metrics[0]!["source"] = "vibes";
        expect(validateResult(result).valid).toBe(false);
    });

    it("rejects a config with an unknown passType", () => {
        const config = loadFixture("config.measurement.local.jsonc") as Record<string, unknown>;
        config["passType"] = "guess";
        expect(validateConfig(config).valid).toBe(false);
    });
});

describe("identity and time helpers", () => {
    it("newRunId is human-sortable and unique", () => {
        const a = newRunId(new Date("2026-06-29T22:00:00Z"));
        expect(a).toMatch(/^2026-06-29T22-00-00Z_[0-9a-f]{8}$/);
        expect(newRunId()).not.toEqual(newRunId());
    });

    it("trace/span ids match the W3C shapes the schemas enforce", () => {
        expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/);
        expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/);
        const tid = newTraceId();
        const sid = newSpanId();
        expect(traceparent(tid, sid)).toBe(`00-${tid}-${sid}-01`);
    });

    it("control tokens are 128-bit hex", () => {
        expect(newControlToken()).toMatch(/^[0-9a-f]{32}$/);
    });

    it("epoch/monotonic ns are decimal strings and diff math works", () => {
        expect(nowUnixNs()).toMatch(/^[0-9]+$/);
        expect(nowMonotonicNs()).toMatch(/^[0-9]+$/);
        expect(diffNsToMs("1000000", "3500000")).toBeCloseTo(2.5);
    });
});
