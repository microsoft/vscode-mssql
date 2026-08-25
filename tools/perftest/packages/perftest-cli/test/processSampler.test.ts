import { describe, expect, it } from "vitest";

import { ProcessSamplerCollector } from "../src/collectors/processSampler";

interface TestSample {
    timestampUnixNs: string;
    pid: number;
    role: string;
    cpuSeconds: number;
    workingSetBytes: number;
}

const MB = 1024 * 1024;

describe("processSampler provider-fair totals", () => {
    it("sums extensionHost + sts at aligned timestamps and excludes VS Code main", async () => {
        const collector = new ProcessSamplerCollector();
        const samples = (
            collector as unknown as {
                samples: TestSample[];
            }
        ).samples;
        samples.push(
            {
                timestampUnixNs: "1",
                pid: 10,
                role: "extensionHost",
                cpuSeconds: 10,
                workingSetBytes: 100 * MB,
            },
            { timestampUnixNs: "1", pid: 20, role: "sts", cpuSeconds: 4, workingSetBytes: 50 * MB },
            {
                timestampUnixNs: "1",
                pid: 30,
                role: "vscodeMain",
                cpuSeconds: 20,
                workingSetBytes: 900 * MB,
            },
            {
                timestampUnixNs: "2",
                pid: 10,
                role: "extensionHost",
                cpuSeconds: 12,
                workingSetBytes: 120 * MB,
            },
            { timestampUnixNs: "2", pid: 20, role: "sts", cpuSeconds: 5, workingSetBytes: 80 * MB },
            {
                timestampUnixNs: "2",
                pid: 30,
                role: "vscodeMain",
                cpuSeconds: 25,
                workingSetBytes: 950 * MB,
            },
        );

        const metrics = await collector.normalize();
        expect(metrics).toContainEqual(
            expect.objectContaining({
                name: "process.dataPlane.peakWorkingSet",
                value: 200,
                unit: "MB",
                processRole: "dataPlaneTotal",
                tags: { roles: "extensionHost+sts", timestamps: 2 },
            }),
        );
        expect(metrics).toContainEqual(
            expect.objectContaining({
                name: "process.dataPlane.cpuTime",
                value: 3,
                unit: "s",
                processRole: "dataPlaneTotal",
                tags: { roles: "extensionHost+sts", timestamps: 2 },
            }),
        );
    });
});
