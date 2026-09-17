/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * cdpHeapSnapshot collector (Phase-2 M10.5, diagnostic only): V8 heap
 * snapshots of the extension host at scenario start and end (each preceded by
 * forced GC via HeapProfiler.collectGarbage), plus a constructor-level diff —
 * "which object types grew, by how many instances and bytes" — the
 * attribution tool for soak `growing` verdicts.
 *
 * Honesty: the diff is computed from real snapshot node tables (layout read
 * from snapshot.meta, never assumed); if either snapshot fails, artifacts and
 * metrics for the diff are simply absent with a validation warning. Retained
 * growth (post-GC heap delta) is diagnostic-only.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ArtifactRef, Metric } from "@mssqlperf/contracts";
import type { Collector, CollectorContext, CollectorValidation, MutableLaunchSpec } from "./types";
import { CdpClient, discoverCdpTargets } from "./cdpClient";

interface ConstructorStats {
    count: number;
    selfSize: number;
}

export interface HeapDiffEntry {
    constructorName: string;
    countDelta: number;
    bytesDelta: number;
    startCount: number;
    endCount: number;
}

export class CdpHeapSnapshotCollector implements Collector {
    readonly name = "cdpHeapSnapshot";
    readonly cost = "high" as const;
    readonly platforms = ["all"] as const as Array<"win32" | "linux" | "darwin" | "all">;
    readonly allowedPassTypes = ["diagnostic"] as const as Array<
        "measurement" | "diagnostic" | "calibration"
    >;

    private port = 0;
    private client: CdpClient | undefined;
    private startStats: Map<string, ConstructorStats> | undefined;
    private endStats: Map<string, ConstructorStats> | undefined;
    private startHeapBytes = 0;
    private endHeapBytes = 0;
    private snapshotPaths: string[] = [];
    private failureReason: string | undefined;

    async preLaunch(ctx: CollectorContext, launch: MutableLaunchSpec): Promise<void> {
        // Reuse an existing --inspect-extensions arg (cdpExtHostProfile may have
        // added one); otherwise add our own.
        const existing = launch.args.find((a) => a.startsWith("--inspect-extensions="));
        if (existing) {
            this.port = Number(existing.split("=")[1]);
        } else {
            this.port = 39000 + Math.floor(Math.random() * 20000);
            launch.args.push(`--inspect-extensions=${this.port}`);
        }
        ctx.logger.info("heapSnapshot.inspectorPort", undefined, { port: this.port });
    }

    async onScenarioStart(ctx: CollectorContext): Promise<void> {
        try {
            const result = await this.takeSnapshot(ctx, "start");
            this.startStats = result.stats;
            this.startHeapBytes = result.totalBytes;
        } catch (error) {
            this.failureReason = `start snapshot failed: ${String(error).slice(0, 200)}`;
            ctx.logger.warn("heapSnapshot.startFailed", this.failureReason);
        }
    }

    async onScenarioEnd(ctx: CollectorContext): Promise<void> {
        if (!this.startStats) {
            return; // no baseline — a one-sided diff would be misleading
        }
        try {
            const result = await this.takeSnapshot(ctx, "end");
            this.endStats = result.stats;
            this.endHeapBytes = result.totalBytes;
        } catch (error) {
            this.failureReason = `end snapshot failed: ${String(error).slice(0, 200)}`;
            ctx.logger.warn("heapSnapshot.endFailed", this.failureReason);
        }
    }

    private async takeSnapshot(
        ctx: CollectorContext,
        label: "start" | "end",
    ): Promise<{ stats: Map<string, ConstructorStats>; totalBytes: number }> {
        if (!this.client) {
            const targets = await discoverCdpTargets(this.port, { preferredType: "node" });
            const url = targets.find((t) => t.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
            if (!url) {
                throw new Error(`no inspector target on port ${this.port}`);
            }
            this.client = new CdpClient();
            await this.client.connect(url);
            await this.client.send("HeapProfiler.enable");
        }
        const span = ctx.logger.span("heapSnapshot.take", { label });
        // Two GC passes so the snapshot reflects retained objects, not garbage.
        await this.client.send("HeapProfiler.collectGarbage", {}, 60_000);
        await this.client.send("HeapProfiler.collectGarbage", {}, 60_000);

        const chunks: string[] = [];
        const onChunk = (params: unknown) => {
            const chunk = (params as { chunk?: string })?.chunk;
            if (chunk) chunks.push(chunk);
        };
        this.client.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
        try {
            await this.client.send(
                "HeapProfiler.takeHeapSnapshot",
                { reportProgress: false },
                180_000,
            );
        } finally {
            this.client.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
        }
        const json = chunks.join("");
        chunks.length = 0;
        const path = join(ctx.artifactsDir, `exthost-${label}.heapsnapshot`);
        writeFileSync(path, json, "utf8");
        this.snapshotPaths.push(`artifacts/exthost-${label}.heapsnapshot`);

        const parsed = summarizeSnapshot(json);
        span.end({ bytes: json.length, constructors: parsed.stats.size });
        return parsed;
    }

    async postExit(ctx: CollectorContext): Promise<ArtifactRef[]> {
        this.client?.close();
        this.client = undefined;
        const artifacts: ArtifactRef[] = this.snapshotPaths.map((path) => ({
            kind: "heapSnapshot",
            path,
            retention: "on-regression" as const,
        }));
        if (this.startStats && this.endStats) {
            const diff = diffStats(this.startStats, this.endStats);
            writeFileSync(
                join(ctx.artifactsDir, "heap-growth-summary.json"),
                JSON.stringify(
                    {
                        retainedGrowthBytes: this.endHeapBytes - this.startHeapBytes,
                        startHeapBytes: this.startHeapBytes,
                        endHeapBytes: this.endHeapBytes,
                        topGrowthByConstructor: diff.slice(0, 40),
                    },
                    null,
                    2,
                ),
                "utf8",
            );
            artifacts.push({
                kind: "heapGrowthSummary",
                path: "artifacts/heap-growth-summary.json",
                retention: "always",
            });
        }
        return artifacts;
    }

    async normalize(): Promise<Metric[]> {
        if (!this.startStats || !this.endStats) {
            return [];
        }
        return [
            {
                name: "exthost.heap.retainedGrowth",
                value: Number(((this.endHeapBytes - this.startHeapBytes) / 1024 / 1024).toFixed(2)),
                unit: "MB",
                component: "process",
                processRole: "extensionHost",
                source: "cdp",
                official: false,
                lowerIsBetter: true,
                tags: { basis: "post-GC snapshot self-size totals" },
            },
        ];
    }

    postRunValidations(): CollectorValidation[] {
        if (this.failureReason) {
            return [
                { name: "heapSnapshotCapture", status: "warning", message: this.failureReason },
            ];
        }
        if (this.startStats && this.endStats) {
            return [
                {
                    name: "heapSnapshotCapture",
                    status: "passed",
                    message: `start+end snapshots captured; retained growth ${((this.endHeapBytes - this.startHeapBytes) / 1024 / 1024).toFixed(1)}MB`,
                },
            ];
        }
        return [];
    }
}

// ---------------------------------------------------------------------------
// .heapsnapshot parsing: aggregate node self-sizes by constructor name.
// Field layout is read from snapshot.meta — never assumed.
// ---------------------------------------------------------------------------

interface HeapSnapshotJson {
    snapshot: {
        meta: {
            node_fields: string[];
            node_types: Array<string[] | string>;
        };
        node_count: number;
    };
    nodes: number[];
    strings: string[];
}

export function summarizeSnapshot(json: string): {
    stats: Map<string, ConstructorStats>;
    totalBytes: number;
} {
    const snapshot = JSON.parse(json) as HeapSnapshotJson;
    const fields = snapshot.snapshot.meta.node_fields;
    const fieldCount = fields.length;
    const typeIndex = fields.indexOf("type");
    const nameIndex = fields.indexOf("name");
    const sizeIndex = fields.indexOf("self_size");
    if (typeIndex < 0 || nameIndex < 0 || sizeIndex < 0) {
        throw new Error(`unexpected heapsnapshot node_fields: ${fields.join(",")}`);
    }
    const typeNames = snapshot.snapshot.meta.node_types[typeIndex];
    if (!Array.isArray(typeNames)) {
        throw new Error("unexpected heapsnapshot node_types layout");
    }
    const stats = new Map<string, ConstructorStats>();
    let totalBytes = 0;
    const nodes = snapshot.nodes;
    for (let offset = 0; offset < nodes.length; offset += fieldCount) {
        const type = typeNames[nodes[offset + typeIndex]!] ?? "unknown";
        const selfSize = nodes[offset + sizeIndex]!;
        totalBytes += selfSize;
        // Group objects by constructor; everything else by its node type ("(strings)" etc.).
        const key =
            type === "object"
                ? (snapshot.strings[nodes[offset + nameIndex]!] ?? "(unknown)")
                : `(${type})`;
        const entry = stats.get(key) ?? { count: 0, selfSize: 0 };
        entry.count += 1;
        entry.selfSize += selfSize;
        stats.set(key, entry);
    }
    return { stats, totalBytes };
}

function diffStats(
    start: Map<string, ConstructorStats>,
    end: Map<string, ConstructorStats>,
): HeapDiffEntry[] {
    const entries: HeapDiffEntry[] = [];
    const keys = new Set([...start.keys(), ...end.keys()]);
    for (const key of keys) {
        const before = start.get(key) ?? { count: 0, selfSize: 0 };
        const after = end.get(key) ?? { count: 0, selfSize: 0 };
        const bytesDelta = after.selfSize - before.selfSize;
        const countDelta = after.count - before.count;
        if (bytesDelta === 0 && countDelta === 0) continue;
        entries.push({
            constructorName: key,
            countDelta,
            bytesDelta,
            startCount: before.count,
            endCount: after.count,
        });
    }
    return entries.sort((a, b) => b.bytesDelta - a.bytesDelta);
}
