/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

import { readXelFileAll } from "../src/profiler/xelFileReader";
import { QueryAggregator } from "../src/profiler/aggregation";
import { findSequenceGap } from "../src/profiler/xelParser";

/**
 * Point XE_BENCH_FILE at a real .xel capture to exercise the decoder against a full file.
 * Without it these are skipped rather than silently passing on no data.
 */
const benchFile = process.env.XE_BENCH_FILE;

void test(
    "decodes every event in a real capture",
    { skip: !benchFile || !existsSync(benchFile) },
    async () => {
        const events = await readXelFileAll(benchFile!);

        assert.ok(events.length > 0, "the capture should contain events");
        console.log(`  decoded ${events.length} events`);

        // Names, timestamps and values must all be populated: a decoder that silently produced
        // empty events would still return the right count.
        for (const e of events.slice(0, 100)) {
            assert.ok(e.name.length > 0, "event name");
            assert.match(e.timestamp, /^\d{4}-\d{2}-\d{2}T/, "ISO timestamp");
            assert.ok(Object.keys(e.values).length > 0, "event should carry values");
        }

        const names = new Set(events.map((e) => e.name));
        console.log(`  event types: ${[...names].sort().join(", ")}`);
    },
);

void test(
    "event sequences are contiguous, so a gap proves loss",
    { skip: !benchFile || !existsSync(benchFile) },
    async () => {
        const events = await readXelFileAll(benchFile!);
        const withSeq = events.filter((e) => e.eventSequence !== undefined);
        assert.ok(withSeq.length > 0, "the capture should collect event_sequence");

        const sorted = [...withSeq].sort((a, b) => a.eventSequence! - b.eventSequence!);
        let gaps = 0;
        for (let i = 1; i < sorted.length; i++) {
            if (findSequenceGap(sorted[i - 1].eventSequence, sorted[i])) {
                gaps++;
            }
        }

        console.log(
            `  ${withSeq.length} sequenced events, ${sorted[0].eventSequence}..${sorted[sorted.length - 1].eventSequence}, gaps=${gaps}`,
        );
        assert.equal(gaps, 0, "a complete file should have no sequence gaps");
    },
);

void test(
    "aggregation ranks queries and reverses cleanly on eviction",
    { skip: !benchFile || !existsSync(benchFile) },
    async () => {
        const events = await readXelFileAll(benchFile!);
        const agg = new QueryAggregator();
        for (const e of events) {
            agg.add(e);
        }

        const top = agg.top(5);
        assert.ok(top.length > 0, "should produce ranked queries");
        console.log(
            `  ${agg.size} distinct queries; top total duration ${top[0].totalDurationUs}us over ${top[0].count} runs`,
        );

        for (let i = 1; i < top.length; i++) {
            assert.ok(
                top[i - 1].totalDurationUs >= top[i].totalDurationUs,
                "ranked by total duration",
            );
        }

        // Removing everything must empty the aggregator, or a ring buffer would leak totals.
        for (const e of events) {
            agg.remove(e);
        }
        assert.equal(agg.size, 0, "removing every event should clear the aggregates");
    },
);

void test("findSequenceGap reports the exact missing range", () => {
    const ev = (n: number) => ({
        name: "e",
        timestamp: "",
        eventTypeId: "",
        eventSequence: n,
        values: {},
    });
    assert.equal(findSequenceGap(10, ev(11)), undefined, "consecutive events are not a gap");
    assert.deepEqual(findSequenceGap(10, ev(15)), { from: 11, to: 14, count: 4 });
});
