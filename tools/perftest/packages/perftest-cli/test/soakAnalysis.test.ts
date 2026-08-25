import { describe, expect, it } from "vitest";
import type { Marker } from "@mssqlperf/contracts";
import {
    analyzeSoak,
    extractIterations,
    linearFit,
    memorySeriesFromMarkers,
    soakMetrics,
    type IterationRecord,
    type SoakMemoryPoint,
} from "../src/regression/soakAnalysis";

function iteration(index: number, overrides: Partial<IterationRecord> = {}): IterationRecord {
    return {
        index,
        warmup: false,
        status: "passed",
        durationMs: 100,
        startUnixNs: String(1_000_000_000_000_000_000n + BigInt(index) * 1_000_000_000n),
        endUnixNs: String(
            1_000_000_000_000_000_000n + BigInt(index) * 1_000_000_000n + 500_000_000n,
        ),
        ...overrides,
    };
}

function memorySeries(count: number, bytesAt: (i: number) => number): SoakMemoryPoint[] {
    return Array.from({ length: count }, (_, i) => ({ iteration: i, bytes: bytesAt(i) }));
}

describe("linearFit", () => {
    it("fits a perfect line with r2=1 and tight CI", () => {
        const fit = linearFit(Array.from({ length: 30 }, (_, i) => ({ x: i, y: 5 + 2 * i })))!;
        expect(fit.slope).toBeCloseTo(2, 6);
        expect(fit.intercept).toBeCloseTo(5, 6);
        expect(fit.r2).toBeCloseTo(1, 6);
        expect(fit.slopeCi95).toBeLessThan(0.001);
    });

    it("returns undefined for degenerate input", () => {
        expect(linearFit([{ x: 1, y: 1 }])).toBeUndefined();
        expect(
            linearFit([
                { x: 1, y: 1 },
                { x: 1, y: 2 },
                { x: 1, y: 3 },
            ]),
        ).toBeUndefined();
    });
});

describe("analyzeSoak — memory verdicts (the fabrication-risk cases)", () => {
    const iterations = Array.from({ length: 100 }, (_, i) => iteration(i));

    it("clear linear growth ⇒ growing", () => {
        const analysis = analyzeSoak(
            iterations,
            memorySeries(100, (i) => 100_000_000 + i * 50_000), // +50KB/iter
        );
        expect(analysis.memory?.verdict).toBe("growing");
        expect(analysis.memory?.slopeBytesPerIteration).toBeGreaterThan(40_000);
        expect(analysis.memory?.r2).toBeGreaterThan(0.9);
    });

    it("flat with small noise ⇒ stable", () => {
        const analysis = analyzeSoak(
            iterations,
            memorySeries(100, (i) => 100_000_000 + (i % 7) * 100), // bounded wiggle
        );
        expect(analysis.memory?.verdict).toBe("stable");
    });

    it("too few samples ⇒ inconclusive, never 'no leak'", () => {
        const analysis = analyzeSoak(
            iterations.slice(0, 10),
            memorySeries(10, (i) => 100_000_000 + i * 50_000),
        );
        expect(analysis.memory?.verdict).toBe("inconclusive");
        expect(analysis.memory?.reason).toContain("samples");
    });

    it("huge noise straddling the threshold ⇒ inconclusive", () => {
        // Alternating ±40MB swings: slope CI will straddle the threshold.
        const analysis = analyzeSoak(
            iterations,
            memorySeries(
                100,
                (i) => 100_000_000 + (i % 2 === 0 ? 40_000_000 : -40_000_000) + i * 1000,
            ),
        );
        expect(analysis.memory?.verdict).toBe("inconclusive");
    });

    it("warmup iterations are excluded from the steady-state fit", () => {
        const withWarmup = [
            ...Array.from({ length: 10 }, (_, i) => iteration(i, { warmup: true })),
            ...Array.from({ length: 90 }, (_, i) => iteration(i + 10)),
        ];
        // Big warmup growth then flat: verdict must be stable, not growing.
        const series = [
            ...memorySeries(10, (i) => 50_000_000 + i * 5_000_000),
            ...Array.from({ length: 90 }, (_, i) => ({
                iteration: i + 10,
                bytes: 100_000_000 + (i % 5) * 200,
            })),
        ];
        const analysis = analyzeSoak(withWarmup, series);
        expect(analysis.memory?.verdict).toBe("stable");
    });
});

describe("analyzeSoak — reliability and latency", () => {
    it("counts every failure with taxonomy and first index", () => {
        const iterations = Array.from({ length: 50 }, (_, i) =>
            iteration(i, {
                status: i === 7 || i === 30 ? "failed" : "passed",
                ...(i === 7 ? { errorKind: "connect" } : {}),
                ...(i === 30 ? { errorKind: "timeout" } : {}),
            }),
        );
        const analysis = analyzeSoak(iterations, []);
        expect(analysis.reliability.failures).toBe(2);
        expect(analysis.reliability.failureRate).toBeCloseTo(2 / 50);
        expect(analysis.reliability.firstFailureIndex).toBe(7);
        expect(analysis.reliability.errorTaxonomy).toEqual({ connect: 1, timeout: 1 });
    });

    it("detects latency drift via the slope", () => {
        const iterations = Array.from({ length: 60 }, (_, i) =>
            iteration(i, { durationMs: 100 + i * 2 }),
        );
        const analysis = analyzeSoak(iterations, []);
        expect(analysis.latency.slopeMsPerIteration).toBeCloseTo(2, 1);
        expect(analysis.latency.p95Ms).toBeGreaterThan(analysis.latency.p50Ms);
    });
});

describe("marker plumbing", () => {
    function marker(name: string, index: number, extra: Record<string, unknown> = {}): Marker {
        return {
            schemaVersion: 1,
            runId: "r",
            repId: 0,
            scenarioId: "s",
            name,
            phase: name === "exthost.memory.rss" ? "counter" : "instant",
            timestampUnixNs: String(
                1_000_000_000_000_000_000n + BigInt(index) * 1_000_000_000n + 100_000_000n,
            ),
            monotonicNs: String(BigInt(index) * 1_000_000_000n),
            process: { role: "extensionHost", pid: 1, name: "driver" },
            attrs: { index, ...extra } as never,
        };
    }

    it("extractIterations pairs start/end by index with duration", () => {
        const markers = [
            marker("iteration.start", 0),
            { ...marker("iteration.end", 0), monotonicNs: "250000000" },
            marker("iteration.start", 1),
            {
                ...marker("iteration.end", 1, { status: "failed", errorKind: "query" }),
                monotonicNs: "1300000000",
            },
        ] as Marker[];
        const iterations = extractIterations(markers);
        expect(iterations).toHaveLength(2);
        expect(iterations[0]!.durationMs).toBeCloseTo(250);
        expect(iterations[1]!.status).toBe("failed");
        expect(iterations[1]!.errorKind).toBe("query");
    });

    it("memorySeriesFromMarkers assigns counters to iterations by timestamp", () => {
        const iterations = [iteration(0), iteration(1)];
        const counters = [
            { ...marker("exthost.memory.rss", 0, { value: 1000 }) },
            { ...marker("exthost.memory.rss", 1, { value: 2000 }) },
        ] as Marker[];
        const series = memorySeriesFromMarkers(counters, iterations);
        expect(series).toEqual([
            { iteration: 0, bytes: 1000 },
            { iteration: 1, bytes: 2000 },
        ]);
    });

    it("soakMetrics respects official eligibility and never emits NaN", () => {
        const analysis = analyzeSoak([], []);
        expect(soakMetrics(analysis, true).every((m) => Number.isFinite(m.value))).toBe(true);
        const real = analyzeSoak(
            Array.from({ length: 30 }, (_, i) => iteration(i)),
            memorySeries(30, () => 1_000_000),
        );
        const official = soakMetrics(real, true);
        expect(official.find((m) => m.name === "soak.latency.p50")?.official).toBe(true);
        const diagnostic = soakMetrics(real, false);
        expect(diagnostic.every((m) => !m.official)).toBe(true);
    });
});
