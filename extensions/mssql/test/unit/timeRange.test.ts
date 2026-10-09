/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    TimeRangePreset,
    clampTimeRange,
    resolveTimeRange,
    startsBeforeAvailable,
    timeRangeFromQuery,
    timeRangeToQuery,
    withDate,
    withTime,
} from "../../src/webviews/common/timeRange/timeRange";

const hourMs = 60 * 60 * 1000;
const presets: TimeRangePreset[] = [
    { id: "1h", durationMs: hourMs, label: "Past hour" },
    { id: "24h", durationMs: 24 * hourMs, label: "Past 24 hours" },
    { id: "7d", durationMs: 7 * 24 * hourMs, label: "Past 7 days" },
];
const now = new Date(Date.UTC(2026, 8, 29, 3, 0, 0));

suite("Webview time range", () => {
    test("reads a preset from the query, and the default for a missing or unknown one", () => {
        expect(timeRangeFromQuery({ range: "7d" }, presets, "24h")).to.deep.equal({
            kind: "preset",
            presetId: "7d",
        });
        expect(timeRangeFromQuery({}, presets, "24h")).to.deep.equal({
            kind: "preset",
            presetId: "24h",
        });
        expect(timeRangeFromQuery({ range: "5y" }, presets, "24h")).to.deep.equal({
            kind: "preset",
            presetId: "24h",
        });
    });

    test("reads a custom range, and ignores one that is invalid or reversed", () => {
        const custom = timeRangeFromQuery(
            { from: "2026-09-28T03:00:00Z", to: "2026-09-29T03:00:00Z" },
            presets,
            "24h",
        );

        expect(custom).to.deep.equal({
            kind: "custom",
            from: new Date(Date.UTC(2026, 8, 28, 3)),
            to: new Date(Date.UTC(2026, 8, 29, 3)),
        });
        expect(
            timeRangeFromQuery({ from: "yesterday", to: "2026-09-29T03:00:00Z" }, presets, "24h")
                .kind,
        ).to.equal("preset");
        expect(
            timeRangeFromQuery(
                { from: "2026-09-29T03:00:00Z", to: "2026-09-28T03:00:00Z" },
                presets,
                "24h",
            ).kind,
        ).to.equal("preset");
    });

    test("writes a range to the query and leaves out the default preset", () => {
        expect(timeRangeToQuery({ kind: "preset", presetId: "24h" }, "24h")).to.deep.equal({
            range: undefined,
        });
        expect(timeRangeToQuery({ kind: "preset", presetId: "7d" }, "24h")).to.deep.equal({
            range: "7d",
        });
        expect(
            timeRangeToQuery(
                {
                    kind: "custom",
                    from: new Date(Date.UTC(2026, 8, 28, 3)),
                    to: new Date(Date.UTC(2026, 8, 29, 3, 0, 0, 500)),
                },
                "24h",
            ),
        ).to.deep.equal({ from: "2026-09-28T03:00:00Z", to: "2026-09-29T03:00:00.500Z" });
    });

    test("resolves a preset to a range that ends now", () => {
        expect(resolveTimeRange({ kind: "preset", presetId: "1h" }, presets, now)).to.deep.equal({
            from: new Date(now.getTime() - hourMs),
            to: now,
        });
    });

    test("marks a preset that starts before the oldest data", () => {
        const availableFrom = new Date(now.getTime() - 2 * 24 * hourMs);

        expect(startsBeforeAvailable(presets[1], availableFrom, now)).to.be.false;
        expect(startsBeforeAvailable(presets[2], availableFrom, now)).to.be.true;
        expect(startsBeforeAvailable(presets[2], undefined, now)).to.be.false;
    });

    test("keeps a custom range inside the data", () => {
        const availableFrom = new Date(Date.UTC(2026, 8, 27, 3));

        expect(
            clampTimeRange(
                {
                    from: new Date(Date.UTC(2026, 8, 20)),
                    to: new Date(Date.UTC(2026, 9, 1)),
                },
                availableFrom,
                now,
            ),
        ).to.deep.equal({ from: availableFrom, to: now });
        expect(
            clampTimeRange(
                { from: new Date(Date.UTC(2026, 8, 20)), to: new Date(Date.UTC(2026, 8, 21)) },
                availableFrom,
                now,
            ),
        ).to.be.undefined;
        expect(clampTimeRange({ from: now, to: now }, undefined, now)).to.be.undefined;
    });

    test("combines a local date and a local time", () => {
        const base = new Date(2026, 8, 28, 3, 5);

        expect(withDate(base, new Date(2026, 9, 1, 22, 40)).getTime()).to.equal(
            new Date(2026, 9, 1, 3, 5).getTime(),
        );
        expect(withTime(base, new Date(2000, 0, 1, 22, 30)).getTime()).to.equal(
            new Date(2026, 8, 28, 22, 30).getTime(),
        );
    });
});
