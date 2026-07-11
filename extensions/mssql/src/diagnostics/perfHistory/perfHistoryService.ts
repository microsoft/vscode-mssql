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
    PerfRepCompareQuery,
    PerfRepCompareResult,
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
import { loadRegistry as loadObsRegistry } from "../../sharedInterfaces/observabilityContract.generated";

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
        const details = provider.scenarioDetails(query);
        // The provider only knows the filesystem; the registry knows what
        // KIND of source this is (bundles are read-only imports).
        const descriptor = this.describeAll().find((s) => s.id === query.sourceId);
        if (details.runProvenance && descriptor) {
            details.runProvenance.sourceKind = descriptor.kind;
            details.runProvenance.readOnly = descriptor.kind === "bundle";
        }
        return details;
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

    /** Delete a run (writable directory sources only; bundles are read-only). */
    public async deleteRun(
        sourceId: string,
        runId: string,
    ): Promise<{ ok: boolean; error?: string }> {
        const descriptor = this.describeAll().find((s) => s.id === sourceId);
        if (!descriptor || descriptor.kind !== "directory") {
            return { ok: false, error: "runs can only be deleted from writable directory sources" };
        }
        const provider = this.providerFor(sourceId);
        if (!provider) {
            return { ok: false, error: "source unavailable" };
        }
        return provider.deleteRun(runId);
    }

    /**
     * What changed between two reps? Marker-pair phases (registry pairing +
     * .begin/.end families), per-type duration/count deltas ranked by impact,
     * and added/removed event types. Read-only over markers.jsonl.
     */
    public async compareReps(query: PerfRepCompareQuery): Promise<PerfRepCompareResult> {
        const provider = await this.ensureIndexed(query.sourceId);
        const empty: PerfRepCompareResult = {
            phases: [],
            types: [],
            addedInA: [],
            addedInB: [],
            notes: ["source unavailable"],
        };
        if (!provider) {
            return empty;
        }
        const notes: string[] = [];
        const load = (runId: string, repId: number) => {
            try {
                const file = path.join(
                    provider.repDir(runId, query.scenarioId, repId),
                    "markers.jsonl",
                );
                const markers: Array<{
                    name: string;
                    phase: string;
                    timestampUnixNs: string;
                    attrs?: Record<string, unknown>;
                }> = [];
                for (const line of fs.readFileSync(file, "utf8").split("\n")) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.length > 512 * 1024) {
                        continue;
                    }
                    try {
                        markers.push(JSON.parse(trimmed));
                    } catch {
                        // refused line — the import path already accounts these
                    }
                }
                return markers;
            } catch (error) {
                notes.push(
                    `${runId} rep ${repId}: markers unreadable (${error instanceof Error ? error.message : String(error)})`,
                );
                return [];
            }
        };
        const a = load(query.runA, query.repA);
        const b = load(query.runB, query.repB);
        if (a.length === 0 || b.length === 0) {
            return {
                ...empty,
                notes: [...notes, "one side has no markers — compare needs both reps recorded"],
            };
        }

        const ns = (m: { timestampUnixNs: string }) => BigInt(m.timestampUnixNs);
        const firstPairMs = (markers: typeof a, begin: string, end: string): number | undefined => {
            const beginMarker = markers.find((m) => m.name === begin);
            const endMarker = beginMarker
                ? markers.find((m) => m.name === end && ns(m) >= ns(beginMarker))
                : undefined;
            if (!beginMarker || !endMarker) {
                return undefined;
            }
            return Number(ns(endMarker) - ns(beginMarker)) / 1e6;
        };

        // Phases: registry-explicit pairs + dynamic families seen in the data.
        const registry = loadObsRegistry();
        const phasePairs = new Map<string, { begin: string; end: string }>();
        for (const entry of registry.events) {
            if (entry.name && entry.pairsWith && entry.phase === "begin") {
                phasePairs.set(entry.name.replace(/\.(begin|submit)$/, ""), {
                    begin: entry.name,
                    end: entry.pairsWith,
                });
            }
        }
        const familyNames = new Set<string>();
        for (const marker of [...a, ...b]) {
            if (
                /^(rpc\.|webview\.|sts\.|sqlDataPlane\.auth\.token(?:\.|$))/.test(marker.name) &&
                marker.name.endsWith(".begin")
            ) {
                familyNames.add(marker.name.slice(0, -".begin".length));
            }
        }
        for (const base of familyNames) {
            phasePairs.set(base, { begin: `${base}.begin`, end: `${base}.end` });
        }
        const phases = [...phasePairs.entries()]
            .map(([name, pair]) => {
                const aMs = firstPairMs(a, pair.begin, pair.end);
                const bMs = firstPairMs(b, pair.begin, pair.end);
                if (aMs === undefined && bMs === undefined) {
                    return undefined;
                }
                const deltaMs =
                    aMs !== undefined && bMs !== undefined
                        ? Number((aMs - bMs).toFixed(2))
                        : undefined;
                return {
                    name,
                    ...(aMs !== undefined ? { aMs: Number(aMs.toFixed(2)) } : {}),
                    ...(bMs !== undefined ? { bMs: Number(bMs.toFixed(2)) } : {}),
                    ...(deltaMs !== undefined ? { deltaMs } : {}),
                    ...(deltaMs !== undefined && bMs
                        ? { deltaPct: Number(((deltaMs / bMs) * 100).toFixed(1)) }
                        : {}),
                };
            })
            .filter((row): row is NonNullable<typeof row> => row !== undefined)
            .sort((x, y) => Math.abs(y.deltaMs ?? 0) - Math.abs(x.deltaMs ?? 0));

        // Per-type totals: counts always; durations from forwarded durationMs attrs.
        const totals = (markers: typeof a) => {
            const map = new Map<string, { count: number; totalMs: number }>();
            for (const marker of markers) {
                const row = map.get(marker.name) ?? { count: 0, totalMs: 0 };
                row.count++;
                const duration = marker.attrs?.["durationMs"];
                if (typeof duration === "number") {
                    row.totalMs += duration;
                }
                map.set(marker.name, row);
            }
            return map;
        };
        const aTotals = totals(a);
        const bTotals = totals(b);
        const allTypes = new Set([...aTotals.keys(), ...bTotals.keys()]);
        const types = [...allTypes]
            .map((type) => {
                const at = aTotals.get(type) ?? { count: 0, totalMs: 0 };
                const bt = bTotals.get(type) ?? { count: 0, totalMs: 0 };
                return {
                    type,
                    aCount: at.count,
                    bCount: bt.count,
                    aTotalMs: Number(at.totalMs.toFixed(2)),
                    bTotalMs: Number(bt.totalMs.toFixed(2)),
                    deltaMs: Number((at.totalMs - bt.totalMs).toFixed(2)),
                };
            })
            .sort(
                (x, y) =>
                    Math.abs(y.deltaMs) - Math.abs(x.deltaMs) ||
                    Math.abs(y.aCount - y.bCount) - Math.abs(x.aCount - x.bCount),
            )
            .slice(0, 40);
        const addedInA = [...allTypes].filter((t) => !bTotals.has(t)).sort();
        const addedInB = [...allTypes].filter((t) => !aTotals.has(t)).sort();
        notes.push(
            "phase durations are epoch deltas within each rep; cross-rep deltas compare like planes",
        );
        return { phases, types, addedInA, addedInB, notes };
    }

    public async dump(query: PerfDumpQuery): Promise<PerfDumpResult> {
        const provider = await this.ensureIndexed(query.sourceId);
        if (!provider) {
            return { text: "", truncated: false, path: "" };
        }
        let filePath: string;
        try {
            // Ids come from the webview: containment-checked, path tricks are
            // refused with an honest error instead of a silent read.
            if (query.file === "summary") {
                filePath = provider.containedPath(
                    path.join(provider.root, query.runId, "summary.json"),
                );
            } else {
                const repDir = provider.repDir(
                    query.runId,
                    query.scenarioId ?? "",
                    query.repId ?? 0,
                );
                filePath =
                    query.file === "result"
                        ? path.join(repDir, "result.json")
                        : path.join(repDir, "markers.jsonl");
            }
        } catch (error) {
            return {
                text: `refused: ${error instanceof Error ? error.message : String(error)}`,
                truncated: false,
                path: "",
            };
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
