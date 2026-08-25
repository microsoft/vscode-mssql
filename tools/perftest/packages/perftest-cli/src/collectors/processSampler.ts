/**
 * processSampler collector (design §14.3): low-cost CPU/RSS sampling of the
 * processes the harness owns (VS Code main + discovered children like the
 * extension host and STS). Measurement-approved as resource-only metrics —
 * never official scenario timing.
 *
 * Windows sampling uses ONE persistent PowerShell worker per rep (request/
 * response over stdio) — spawning a process per sample would be far too heavy
 * to measurement-approve honestly. POSIX uses `ps` per sample (a cheap fork).
 */

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { createInterface, type Interface } from "node:readline";
import { dirname, join } from "node:path";
import type { ArtifactRef, Metric } from "@mssqlperf/contracts";
import type { Collector, CollectorContext, ProcessRegistry } from "./types";

const SAMPLE_INTERVAL_MS = 500;
const DATA_PLANE_ROLES = new Set(["extensionHost", "sts"]);

interface ProcessSample {
    timestampUnixNs: string;
    pid: number;
    role: string;
    cpuSeconds: number;
    workingSetBytes: number;
}

const WINDOWS_WORKER_SCRIPT = [
    "while ($true) {",
    "  $line = [Console]::In.ReadLine();",
    "  if ($null -eq $line -or $line -eq 'exit') { break };",
    "  try {",
    "    $ids = $line -split ',' | ForEach-Object { [int]$_ };",
    "    $procs = Get-Process -Id $ids -ErrorAction SilentlyContinue |",
    "      Select-Object Id, @{n='cpu';e={$_.TotalProcessorTime.TotalSeconds}}, @{n='ws';e={$_.WorkingSet64}};",
    "    $out = ConvertTo-Json -Compress -InputObject @($procs);",
    "  } catch { $out = '[]' };",
    "  if (-not $out) { $out = '[]' };",
    "  [Console]::Out.WriteLine($out);",
    "}",
].join(" ");

export class ProcessSamplerCollector implements Collector {
    readonly name = "processSampler";
    readonly cost = "low" as const;
    readonly platforms = ["all"] as const as Array<"win32" | "linux" | "darwin" | "all">;
    // §12.3 calibration (2026-07-01, quiet box, query-10k, 5 reps/side,
    // warmups dropped): median wallclock +1.96% with the sampler on
    // (1061.6ms vs 1041.2ms) — within run-order noise at n=5. Approved for
    // measurement as cost "low"; overhead entry in DIAGNOSTIC_COLLECTORS.md.
    readonly allowedPassTypes = ["measurement", "diagnostic", "calibration"] as const as Array<
        "measurement" | "diagnostic" | "calibration"
    >;

    private timer: NodeJS.Timeout | undefined;
    private processes: ProcessRegistry | undefined;
    private samplesPath: string | undefined;
    private readonly samples: ProcessSample[] = [];
    private sampling = false;
    private worker: ChildProcess | undefined;
    private workerLines: Interface | undefined;
    private readonly pendingReads: Array<(line: string) => void> = [];

    async postLaunch(ctx: CollectorContext, processes: ProcessRegistry): Promise<void> {
        this.processes = processes;
        this.samplesPath = join(ctx.repDir, "process-samples.jsonl");
        mkdirSync(dirname(this.samplesPath), { recursive: true });
        if (process.platform === "win32") {
            this.startWindowsWorker(ctx);
        }
        this.timer = setInterval(() => {
            void this.sampleOnce(ctx);
        }, SAMPLE_INTERVAL_MS);
        this.timer.unref?.();
    }

    private startWindowsWorker(ctx: CollectorContext): void {
        try {
            this.worker = spawn(
                "powershell",
                ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_WORKER_SCRIPT],
                { stdio: ["pipe", "pipe", "ignore"], windowsHide: true },
            );
            this.workerLines = createInterface({ input: this.worker.stdout! });
            this.workerLines.on("line", (line) => {
                const pending = this.pendingReads.shift();
                pending?.(line);
            });
            this.worker.on("error", (error) => {
                ctx.logger.warn("processSampler.workerError", String(error));
                this.worker = undefined;
            });
            this.worker.on("exit", () => {
                this.worker = undefined;
            });
        } catch (error) {
            ctx.logger.warn("processSampler.workerSpawnFailed", String(error));
            this.worker = undefined;
        }
    }

    private queryWorker(pids: number[]): Promise<string | undefined> {
        if (!this.worker || !this.worker.stdin?.writable) {
            return Promise.resolve(undefined);
        }
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                const index = this.pendingReads.indexOf(onLine);
                if (index >= 0) this.pendingReads.splice(index, 1);
                resolve(undefined);
            }, 2000);
            const onLine = (line: string): void => {
                clearTimeout(timer);
                resolve(line);
            };
            this.pendingReads.push(onLine);
            this.worker!.stdin!.write(pids.join(",") + "\n");
        });
    }

    private async sampleOnce(ctx: CollectorContext): Promise<void> {
        if (this.sampling || !this.processes || !this.samplesPath) {
            return; // never let slow samples pile up
        }
        this.sampling = true;
        try {
            const targets = this.processes.all();
            if (targets.length === 0) {
                return;
            }
            const stats = await this.readProcessStats(targets.map((t) => t.pid));
            const now = (BigInt(Date.now()) * 1_000_000n).toString();
            for (const target of targets) {
                const stat = stats.get(target.pid);
                if (!stat) continue;
                const sample: ProcessSample = {
                    timestampUnixNs: now,
                    pid: target.pid,
                    role: target.role,
                    cpuSeconds: stat.cpuSeconds,
                    workingSetBytes: stat.workingSetBytes,
                };
                this.samples.push(sample);
                appendFileSync(this.samplesPath, JSON.stringify(sample) + "\n");
            }
        } catch (error) {
            ctx.logger.debug("processSampler.sampleFailed", String(error));
        } finally {
            this.sampling = false;
        }
    }

    private async readProcessStats(
        pids: number[],
    ): Promise<Map<number, { cpuSeconds: number; workingSetBytes: number }>> {
        const map = new Map<number, { cpuSeconds: number; workingSetBytes: number }>();
        if (pids.length === 0) {
            return map;
        }
        if (process.platform === "win32") {
            const line = await this.queryWorker(pids);
            if (line) {
                try {
                    const parsed: unknown = JSON.parse(line);
                    const rows = Array.isArray(parsed) ? parsed : [parsed];
                    for (const row of rows as Array<{
                        Id?: number;
                        cpu?: number;
                        ws?: number;
                    } | null>) {
                        if (row && typeof row.Id === "number") {
                            map.set(row.Id, {
                                cpuSeconds: Number(row.cpu ?? 0),
                                workingSetBytes: Number(row.ws ?? 0),
                            });
                        }
                    }
                } catch {
                    // malformed worker output: skip this sample
                }
            }
            return map;
        }
        return readStatsPosix(pids);
    }

    async preShutdown(): Promise<void> {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    async postExit(ctx: CollectorContext): Promise<ArtifactRef[]> {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        this.stopWorker();
        void ctx;
        if (this.samples.length === 0) {
            return [];
        }
        return [
            {
                kind: "processSamples",
                path: "process-samples.jsonl",
                retention: "always",
            },
        ];
    }

    async teardown(): Promise<void> {
        this.stopWorker();
    }

    private stopWorker(): void {
        if (this.worker) {
            try {
                this.worker.stdin?.write("exit\n");
                this.worker.stdin?.end();
            } catch {
                // already gone
            }
            const worker = this.worker;
            setTimeout(() => worker.kill(), 1000).unref?.();
            this.worker = undefined;
        }
        this.workerLines?.close();
        this.workerLines = undefined;
    }

    async normalize(): Promise<Metric[]> {
        const metrics: Metric[] = [];
        const byPid = new Map<number, ProcessSample[]>();
        for (const sample of this.samples) {
            const list = byPid.get(sample.pid) ?? [];
            list.push(sample);
            byPid.set(sample.pid, list);
        }
        for (const [pid, samples] of byPid) {
            const role = samples[0]!.role;
            const peakRss = Math.max(...samples.map((s) => s.workingSetBytes));
            const cpuDelta =
                samples.length > 1
                    ? samples[samples.length - 1]!.cpuSeconds - samples[0]!.cpuSeconds
                    : 0;
            metrics.push({
                name: "process.peakWorkingSet",
                value: Math.round(peakRss / 1024 / 1024),
                unit: "MB",
                component: "process",
                processRole: role,
                source: "processSampler",
                official: false,
                lowerIsBetter: true,
                tags: { pid, samples: samples.length },
            });
            metrics.push({
                name: "process.cpuTime",
                value: Number(cpuDelta.toFixed(3)),
                unit: "s",
                component: "process",
                processRole: role,
                source: "processSampler",
                official: false,
                lowerIsBetter: true,
                tags: { pid, samples: samples.length },
            });
        }

        // Provider-fair A/B resource view. STS2 splits work between the extension
        // host and a service process while ts-native keeps it in the extension
        // host; comparing either role alone is structurally misleading. RSS is
        // summed at each shared sampling timestamp before taking the peak (not a
        // sum of independently-timed per-process peaks), while CPU deltas are
        // additive across the data-plane processes.
        const dataPlaneSamples = this.samples.filter((sample) => DATA_PLANE_ROLES.has(sample.role));
        if (dataPlaneSamples.length > 0) {
            const rssByTimestamp = new Map<string, number>();
            const roles = new Set<string>();
            let totalCpuDelta = 0;
            for (const samples of byPid.values()) {
                if (!DATA_PLANE_ROLES.has(samples[0]!.role)) continue;
                roles.add(samples[0]!.role);
                if (samples.length > 1) {
                    totalCpuDelta +=
                        samples[samples.length - 1]!.cpuSeconds - samples[0]!.cpuSeconds;
                }
            }
            for (const sample of dataPlaneSamples) {
                rssByTimestamp.set(
                    sample.timestampUnixNs,
                    (rssByTimestamp.get(sample.timestampUnixNs) ?? 0) + sample.workingSetBytes,
                );
            }
            const peakRss = Math.max(...rssByTimestamp.values());
            const tags = {
                roles: [...roles].sort().join("+"),
                timestamps: rssByTimestamp.size,
            };
            metrics.push({
                name: "process.dataPlane.peakWorkingSet",
                value: Math.round(peakRss / 1024 / 1024),
                unit: "MB",
                component: "process",
                processRole: "dataPlaneTotal",
                source: "processSampler",
                official: false,
                lowerIsBetter: true,
                tags,
            });
            metrics.push({
                name: "process.dataPlane.cpuTime",
                value: Number(totalCpuDelta.toFixed(3)),
                unit: "s",
                component: "process",
                processRole: "dataPlaneTotal",
                source: "processSampler",
                official: false,
                lowerIsBetter: true,
                tags,
            });
        }
        return metrics;
    }

    /** The full sample series (soak analysis consumes this). */
    allSamples(): ProcessSample[] {
        return [...this.samples];
    }
}

function readStatsPosix(
    pids: number[],
): Promise<Map<number, { cpuSeconds: number; workingSetBytes: number }>> {
    return new Promise((resolve) => {
        execFile(
            "ps",
            ["-o", "pid=,time=,rss=", "-p", pids.join(",")],
            { timeout: 5_000 },
            (error, stdout) => {
                const map = new Map<number, { cpuSeconds: number; workingSetBytes: number }>();
                if (!error) {
                    for (const line of stdout.split("\n")) {
                        const parts = line.trim().split(/\s+/);
                        if (parts.length < 3) continue;
                        const [h = "0", m = "0", s = "0"] = (parts[1] ?? "").split(":").slice(-3);
                        map.set(Number(parts[0]), {
                            cpuSeconds: Number(h) * 3600 + Number(m) * 60 + Number(s),
                            workingSetBytes: Number(parts[2]) * 1024,
                        });
                    }
                }
                resolve(map);
            },
        );
    });
}
