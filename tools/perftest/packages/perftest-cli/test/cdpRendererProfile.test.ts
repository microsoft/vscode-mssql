import { describe, expect, it } from "vitest";
import { summarizeCpuProfile } from "../src/collectors/cdpRendererProfile";

describe("cdpRendererProfile", () => {
    it("excludes idle samples from attributed webview CPU time", () => {
        const summary = summarizeCpuProfile({
            startTime: 1_000,
            endTime: 3_000,
            nodes: [
                { id: 1, callFrame: { functionName: "(idle)" } },
                { id: 2, callFrame: { functionName: "renderGrid" } },
            ],
            samples: [1, 2, 2],
            timeDeltas: [100, 200, 300],
        });

        expect(summary).toEqual({ durationMs: 2, sampledCpuMs: 0.5, samples: 3 });
    });
});
