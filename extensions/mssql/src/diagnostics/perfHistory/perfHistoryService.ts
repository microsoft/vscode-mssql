/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Perf Test History service: source registry (default directory, opened
 * directories, imported bundles, SQLite preview) + provider dispatch + lazy
 * artifact loading. The webview never touches the filesystem — everything
 * arrives as normalized rows through the Ph* RPC surface.
 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
    PagedRuns,
    PerfDumpQuery,
    PerfDumpResult,
    PerfHistorySource,
    PerfIndexProgress,
    PerfMetricSeriesPoint,
    PerfMetricSeriesQuery,
    PerfNeedsAttentionRow,
    PerfRichDiagnostics,
    PerfRichSnapshot,
    PerfRichSpanDelta,
    PerfRunsQuery,
    PerfRunsSummary,
    PerfScenarioDetails,
    PerfScenarioDetailsQuery,
    PerfScenarioRow,
    PerfScenariosQuery,
    PerfSourceKind,
    PerfWaterfallQuery,
} from "../../sharedInterfaces/perfHistory";
import { SqlActivityRow, WaterfallModel } from "../../sharedInterfaces/debugConsole";
import { buildWaterfall, sqlActivityRows } from "../analysis";
import { importPerfRep } from "../perfRunImport";
import { DirectoryHistoryProvider } from "./directoryProvider";

const STATE_KEY = "mssql.perfHistory.sources";
const DUMP_CAP_BYTES = 512 * 1024;

interface PersistedSource {
    id: string;
    kind: PerfSourceKind;
    path: string;
    label: string;
}

export class PerfHistoryService {
    private providers = new Map<string, DirectoryHistoryProvider>();
    private progressBySource = new Map<string, PerfIndexProgress>();

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly onProgress: (progress: PerfIndexProgress) => void,
    ) {}

    // --- source registry ---------------------------------------------------------

    private defaultRoot(): string {
        const configured = vscode.workspace
            .getConfiguration()
            .get<string>("mssql.debugConsole.perfRunsRoot", "")
            ?.trim();
        if (configured) {
            return configured;
        }
        return path.join(this.context.globalStorageUri.fsPath, "self-test-runs");
    }

    private persistedSources(): PersistedSource[] {
        return this.context.globalState.get<PersistedSource[]>(STATE_KEY, []);
    }

    private async persistSources(sources: PersistedSource[]): Promise<void> {
        await this.context.globalState.update(STATE_KEY, sources);
    }

    private providerFor(sourceId: string): DirectoryHistoryProvider | undefined {
        const existing = this.providers.get(sourceId);
        if (existing) {
            return existing;
        }
        const descriptor = this.describeAll().find((s) => s.id === sourceId);
        if (!descriptor || (descriptor.kind !== "directory" && descriptor.kind !== "bundle")) {
            return undefined;
        }
        const provider = new DirectoryHistoryProvider(sourceId, descriptor.path, (progress) => {
            const payload: PerfIndexProgress = { sourceId, ...progress };
            this.progressBySource.set(sourceId, payload);
            this.onProgress(payload);
        });
        this.providers.set(sourceId, provider);
        return provider;
    }

    /** All registered sources (default + persisted), without touching disk. */
    private describeAll(): Array<PersistedSource & { isDefault?: boolean }> {
        const sources: Array<PersistedSource & { isDefault?: boolean }> = [
            {
                id: "default",
                kind: "directory",
                path: this.defaultRoot(),
                label: "Default local history",
                isDefault: true,
            },
        ];
        for (const persisted of this.persistedSources()) {
            sources.push(persisted);
        }
        return sources;
    }

    public async listSources(): Promise<PerfHistorySource[]> {
        const out: PerfHistorySource[] = [];
        for (const descriptor of this.describeAll()) {
            out.push(await this.sourceStatus(descriptor));
        }
        return out;
    }

    private async sourceStatus(
        descriptor: PersistedSource & { isDefault?: boolean },
    ): Promise<PerfHistorySource> {
        if (descriptor.kind === "sqlite") {
            const supported = sniffSqlite(descriptor.path);
            return {
                id: descriptor.id,
                kind: "sqlite",
                label: descriptor.label,
                path: descriptor.path,
                status: "unsupported",
                statusMessage: supported
                    ? "SQLite history browsing in-product is a preview — the native driver isn't loadable in the extension host yet. Use `perftest history` or a directory source."
                    : "File is not a SQLite database.",
                readOnly: true,
                runCount: 0,
                scenarioCount: 0,
            };
        }
        const provider = this.providerFor(descriptor.id);
        const progress = this.progressBySource.get(descriptor.id);
        const exists = fs.existsSync(descriptor.path);
        const runCount = exists && provider ? provider.runCount() : 0;
        return {
            id: descriptor.id,
            kind: descriptor.kind,
            label: descriptor.label,
            path: descriptor.path,
            status: !exists
                ? descriptor.isDefault
                    ? "empty"
                    : "error"
                : progress?.state === "scanning"
                  ? "scanning"
                  : runCount === 0
                    ? "empty"
                    : "indexed",
            ...(provider?.lastError ? { statusMessage: provider.lastError } : {}),
            readOnly: descriptor.kind === "bundle",
            ...(descriptor.isDefault ? { isDefault: true } : {}),
            runCount,
            scenarioCount: exists && provider ? provider.scenarioCount() : 0,
            ...(provider?.lastIndexedUtc() ? { lastIndexedUtc: provider.lastIndexedUtc() } : {}),
            ...(provider?.lastIndexMs !== undefined ? { indexMs: provider.lastIndexMs } : {}),
        };
    }

    public async addSource(kind: PerfSourceKind): Promise<{ addedId?: string; error?: string }> {
        const picked = await vscode.window.showOpenDialog(
            kind === "sqlite"
                ? {
                      canSelectFiles: true,
                      canSelectFolders: false,
                      filters: { "SQLite database": ["db", "sqlite", "sqlite3"] },
                      title: "Connect a perftest SQLite store (read-only preview)",
                  }
                : {
                      canSelectFiles: false,
                      canSelectFolders: true,
                      title:
                          kind === "bundle"
                              ? "Import a perf-runs bundle directory (read-only)"
                              : "Open a perf-runs directory",
                  },
        );
        if (!picked || picked.length === 0) {
            return { error: "cancelled" };
        }
        const fsPath = picked[0].fsPath;
        const sources = this.persistedSources();
        const existing = sources.find((s) => s.path === fsPath && s.kind === kind);
        if (existing) {
            return { addedId: existing.id };
        }
        const id = `${kind}:${Date.now().toString(36)}`;
        sources.push({ id, kind, path: fsPath, label: path.basename(fsPath) || fsPath });
        await this.persistSources(sources);
        if (kind !== "sqlite") {
            // Index in the background; progress streams to the webview.
            void this.providerFor(id)?.rescan();
        }
        return { addedId: id };
    }

    public async removeSource(sourceId: string): Promise<void> {
        this.providers.delete(sourceId);
        await this.persistSources(this.persistedSources().filter((s) => s.id !== sourceId));
    }

    public async rescan(sourceId: string): Promise<PerfHistorySource> {
        const provider = this.providerFor(sourceId);
        if (provider) {
            await provider.rescan();
        }
        const descriptor = this.describeAll().find((s) => s.id === sourceId);
        if (!descriptor) {
            throw new Error(`unknown source ${sourceId}`);
        }
        return this.sourceStatus(descriptor);
    }

    /**
     * Ensure the source has been scanned at least once. Cold (empty index)
     * AWAITS the scan — concurrent callers share the same in-flight promise so
     * nobody serves an empty table mid-scan. Warm queries serve the cache and
     * refresh in the background, debounced so live event storms (a running
     * self-test bumps the UI continuously) can't hammer the filesystem.
     */
    public async ensureIndexed(sourceId: string): Promise<DirectoryHistoryProvider | undefined> {
        const provider = this.providerFor(sourceId);
        if (provider && provider.runCount() === 0) {
            await provider.rescan();
        } else if (provider) {
            void provider.rescanIfStale(5000);
        }
        return provider;
    }

    // --- queries -------------------------------------------------------------------

    public async queryRuns(query: PerfRunsQuery): Promise<PagedRuns> {
        const provider = await this.ensureIndexed(query.sourceId);
        if (!provider) {
            return { rows: [], total: 0, totalInSource: 0 };
        }
        return provider.queryRuns(query);
    }

    public async queryScenarios(query: PerfScenariosQuery): Promise<PerfScenarioRow[]> {
        const provider = await this.ensureIndexed(query.sourceId);
        return provider ? provider.queryScenarios(query) : [];
    }

    public async metricSeries(query: PerfMetricSeriesQuery): Promise<PerfMetricSeriesPoint[]> {
        const provider = await this.ensureIndexed(query.sourceId);
        return provider ? provider.metricSeries(query.scenarioId, query.metric, query.lastN) : [];
    }

    public async scenarioDetails(query: PerfScenarioDetailsQuery): Promise<PerfScenarioDetails> {
        const provider = await this.ensureIndexed(query.sourceId);
        if (!provider) {
            return {
                runId: query.runId,
                scenarioId: query.scenarioId,
                reps: [],
                submetrics: [],
                validations: [],
                artifacts: [],
            };
        }
        return provider.scenarioDetails(query);
    }

    // --- summary --------------------------------------------------------------------

    public async summary(sourceId: string): Promise<PerfRunsSummary> {
        const provider = await this.ensureIndexed(sourceId);
        const descriptor = this.describeAll().find((s) => s.id === sourceId);
        const source = descriptor
            ? await this.sourceStatus(descriptor)
            : ({
                  id: sourceId,
                  kind: "directory",
                  label: sourceId,
                  path: "",
                  status: "error",
                  readOnly: true,
                  runCount: 0,
                  scenarioCount: 0,
              } as PerfHistorySource);
        const rows = provider
            ? provider.allRunRows().sort((a, b) => a.createdUtc.localeCompare(b.createdUtc))
            : [];
        const latest = rows[rows.length - 1];
        const previous = rows.length > 1 ? rows[rows.length - 2] : undefined;
        const failedReps = rows.reduce((sum, r) => sum + r.failedReps, 0);
        const invalidReps = rows.reduce((sum, r) => sum + r.invalidReps, 0);
        const deltaVsPrevPct =
            latest?.wallP50Ms !== undefined &&
            previous?.wallP50Ms !== undefined &&
            previous.wallP50Ms !== 0
                ? Number(
                      (
                          ((latest.wallP50Ms - previous.wallP50Ms) / previous.wallP50Ms) *
                          100
                      ).toFixed(1),
                  )
                : undefined;
        // Trend: run-wide wallclock aggregates.
        const trend: PerfMetricSeriesPoint[] = rows
            .filter((r) => r.wallP50Ms !== undefined)
            .slice(-40)
            .map((r) => ({
                runId: r.runId,
                createdUtc: r.createdUtc,
                p50: r.wallP50Ms!,
                p95: r.wallP95Ms ?? r.wallP50Ms!,
                n: r.repTotal,
            }));
        // Suite health for the latest run.
        const suiteHealth = new Map<string, { ok: number; total: number }>();
        let latestSlower: PerfRunsSummary["latestSlower"];
        let needsAttention: PerfNeedsAttentionRow[] = [];
        if (provider && latest) {
            const scenarioRows = provider.queryScenarios({
                sourceId,
                runIds: [latest.runId],
            });
            for (const row of scenarioRows) {
                const suite = row.suite ?? "Other";
                const entry = suiteHealth.get(suite) ?? { ok: 0, total: 0 };
                entry.total++;
                if (row.verdict === "ok") entry.ok++;
                suiteHealth.set(suite, entry);
                if (row.verdict === "failed" && row.scenarioId) {
                    needsAttention.push({
                        runId: latest.runId,
                        scenarioId: row.scenarioId,
                        kind: "failed",
                        detail: `${row.totalReps - row.validReps} failing rep(s)`,
                        createdUtc: latest.createdUtc,
                    });
                } else if (row.verdict === "invalid" && row.scenarioId && !row.skippedReason) {
                    needsAttention.push({
                        runId: latest.runId,
                        scenarioId: row.scenarioId,
                        kind: "invalid",
                        detail: "no valid reps",
                        createdUtc: latest.createdUtc,
                    });
                } else if (row.lowConfidence && row.scenarioId) {
                    needsAttention.push({
                        runId: latest.runId,
                        scenarioId: row.scenarioId,
                        kind: "lowN",
                        detail: `only ${row.validReps} valid rep(s)`,
                        createdUtc: latest.createdUtc,
                    });
                }
                if (
                    row.deltaPct !== undefined &&
                    row.deltaPct > 10 &&
                    row.scenarioId &&
                    (latestSlower === undefined || row.deltaPct > latestSlower.deltaPct)
                ) {
                    latestSlower = {
                        runId: latest.runId,
                        scenarioId: row.scenarioId,
                        deltaPct: row.deltaPct,
                        createdUtc: latest.createdUtc,
                    };
                }
            }
            if (latestSlower) {
                needsAttention.unshift({
                    runId: latestSlower.runId,
                    scenarioId: latestSlower.scenarioId,
                    kind: "slower",
                    detail: `wallclock +${latestSlower.deltaPct}% vs baseline`,
                    createdUtc: latestSlower.createdUtc,
                });
            }
            needsAttention = needsAttention.slice(0, 8);
        }
        return {
            source,
            kpis: {
                runs: rows.length,
                scenarios: provider?.scenarioCount() ?? 0,
                ...(latest ? { latestRunId: latest.runId } : {}),
                latestVerdict: latest?.verdict ?? "unknown",
                ...(latest ? { latestCreatedUtc: latest.createdUtc } : {}),
                ...(latest?.wallP50Ms !== undefined ? { medianWallMs: latest.wallP50Ms } : {}),
                ...(deltaVsPrevPct !== undefined ? { deltaVsPrevPct } : {}),
                ...(latest?.wallP95Ms !== undefined ? { p95WallMs: latest.wallP95Ms } : {}),
                failedReps,
                invalidReps,
                sourceCount: this.describeAll().length,
            },
            ...(latestSlower ? { latestSlower } : {}),
            trend,
            suiteHealth: [...suiteHealth.entries()]
                .map(([suite, health]) => ({ suite, ...health }))
                .sort((a, b) => b.total - a.total),
            needsAttention,
        };
    }

    // --- lazy artifacts ---------------------------------------------------------------

    public async waterfall(query: PerfWaterfallQuery): Promise<WaterfallModel | undefined> {
        const provider = await this.ensureIndexed(query.sourceId);
        if (!provider) {
            return undefined;
        }
        const repDir = provider.repDir(query.runId, query.scenarioId, query.repId);
        const label = `${query.runId}_${query.scenarioId}/rep-${String(query.repId).padStart(2, "0")}`;
        const events = importPerfRep(repDir, label);
        if (events.length === 0) {
            return undefined;
        }
        const traceId = events.find((e) => e.traceId)?.traceId;
        return traceId ? buildWaterfall(events, traceId) : undefined;
    }

    public async sqlActivity(query: PerfWaterfallQuery): Promise<SqlActivityRow[]> {
        const provider = await this.ensureIndexed(query.sourceId);
        if (!provider) {
            return [];
        }
        const repDir = provider.repDir(query.runId, query.scenarioId, query.repId);
        const events = importPerfRep(repDir, `${query.runId}_${query.scenarioId}`);
        return sqlActivityRows(events);
    }

    /**
     * Rich diagnostics for one rep: system.rich.snapshot counters + per-span
     * heap deltas, read lazily from the rep's markers.jsonl. `found:false`
     * when the run wasn't collected with rich diagnostics — never fabricated.
     */
    public async richDiagnostics(query: PerfWaterfallQuery): Promise<PerfRichDiagnostics> {
        const provider = await this.ensureIndexed(query.sourceId);
        const empty: PerfRichDiagnostics = { snapshots: [], spanDeltas: [], found: false };
        if (!provider) {
            return empty;
        }
        const markersPath = path.join(
            provider.repDir(query.runId, query.scenarioId, query.repId),
            "markers.jsonl",
        );
        if (!fs.existsSync(markersPath)) {
            return empty;
        }
        const snapshots: PerfRichSnapshot[] = [];
        const spanDeltas: PerfRichSpanDelta[] = [];
        try {
            for (const line of fs.readFileSync(markersPath, "utf8").split("\n")) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                let marker: {
                    name?: string;
                    timestampUnixNs?: string;
                    attrs?: Record<string, unknown>;
                };
                try {
                    marker = JSON.parse(trimmed);
                } catch {
                    continue;
                }
                const attrs = marker.attrs ?? {};
                if (marker.name === "system.rich.snapshot") {
                    const metrics: Record<string, number> = {};
                    for (const [key, value] of Object.entries(attrs)) {
                        if (typeof value === "number") {
                            metrics[key] = value;
                        }
                    }
                    snapshots.push({
                        epochMs: Number(BigInt(marker.timestampUnixNs ?? "0") / 1_000_000n),
                        metrics,
                    });
                } else if (typeof attrs["perf_heapDeltaKB"] === "number") {
                    spanDeltas.push({
                        type: marker.name ?? "?",
                        ...(typeof attrs["durationMs"] === "number"
                            ? { durationMs: attrs["durationMs"] }
                            : {}),
                        heapDeltaKB: attrs["perf_heapDeltaKB"],
                    });
                }
            }
        } catch {
            return empty;
        }
        spanDeltas.sort((a, b) => Math.abs(b.heapDeltaKB ?? 0) - Math.abs(a.heapDeltaKB ?? 0));
        return {
            snapshots,
            spanDeltas: spanDeltas.slice(0, 50),
            found: snapshots.length > 0 || spanDeltas.length > 0,
        };
    }

    public async dump(query: PerfDumpQuery): Promise<PerfDumpResult> {
        const provider = await this.ensureIndexed(query.sourceId);
        if (!provider) {
            return { text: "", truncated: false, path: "" };
        }
        let filePath: string;
        if (query.file === "summary") {
            filePath = path.join(provider.root, query.runId, "summary.json");
        } else {
            const repDir = provider.repDir(query.runId, query.scenarioId ?? "", query.repId ?? 0);
            filePath =
                query.file === "result"
                    ? path.join(repDir, "result.json")
                    : path.join(repDir, "markers.jsonl");
        }
        try {
            const stat = fs.statSync(filePath);
            const truncated = stat.size > DUMP_CAP_BYTES;
            const fd = fs.openSync(filePath, "r");
            try {
                const size = Math.min(stat.size, DUMP_CAP_BYTES);
                const buffer = Buffer.alloc(size);
                fs.readSync(fd, buffer, 0, size, 0);
                let text = buffer.toString("utf8");
                if (query.file !== "markersHead" && !truncated) {
                    try {
                        text = JSON.stringify(JSON.parse(text), null, 2);
                    } catch {
                        // keep raw
                    }
                }
                return { text, truncated, path: filePath };
            } finally {
                fs.closeSync(fd);
            }
        } catch (error) {
            return {
                text: `Could not read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
                truncated: false,
                path: filePath,
            };
        }
    }
}

/** SQLite magic sniff — honest capability detection, no native driver. */
function sniffSqlite(file: string): boolean {
    try {
        const fd = fs.openSync(file, "r");
        try {
            const header = Buffer.alloc(16);
            fs.readSync(fd, header, 0, 16, 0);
            return header.toString("utf8", 0, 15) === "SQLite format 3";
        } finally {
            fs.closeSync(fd);
        }
    } catch {
        return false;
    }
}
