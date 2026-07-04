/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Directory-backed perf history provider with a metadata-first incremental
 * index. Opening the page never parses every artifact: run/scenario rows come
 * from `.dc-history-index.json`, which is rebuilt incrementally (only new or
 * changed run directories are re-read, in chunks off the message loop).
 * Heavy artifacts (markers.jsonl, dumps) are read only on explicit request.
 *
 * Pure logic (aggregation, filtering, grouping, verdicts) is exported as
 * standalone functions so it is unit-testable without a filesystem.
 */

import * as fs from "fs";
import * as path from "path";
import {
    PagedRuns,
    PerfArtifactRef,
    PerfMetricSeriesPoint,
    PerfRepRow,
    PerfRunRow,
    PerfRunsQuery,
    PerfScenarioDetails,
    PerfScenarioDetailsQuery,
    PerfScenarioRow,
    PerfScenariosQuery,
    PerfMetricEligibility,
    PerfSubmetricRow,
    PerfValidationRow,
    RunVerdict,
} from "../../sharedInterfaces/perfHistory";

const INDEX_FILE = ".dc-history-index.json";
const INDEX_VERSION = 2;
/** Runs indexed per event-loop tick — keeps the host responsive on big scans. */
const CHUNK = 25;

// --- index shapes (persisted) -------------------------------------------------

export interface IndexedRep {
    repId: number;
    status: string;
    warmup: boolean;
    /** metricName → value for OFFICIAL metrics of passed reps. */
    official: Record<string, number>;
    /** metricName → value for diagnostic (non-official) metrics. */
    diagnostic: Record<string, number>;
    failureReason?: string;
}

export interface IndexedScenario {
    scenarioId: string;
    reps: IndexedRep[];
    artifactKinds: string[];
    validationFailures: number;
    skippedReason?: string;
}

export interface IndexedRun {
    fingerprint: string;
    row: Omit<PerfRunRow, "sourceId">;
    scenarios: Record<string, IndexedScenario>;
}

interface DirIndex {
    version: number;
    indexedAtUtc: string;
    runs: Record<string, IndexedRun>;
}

// --- suites -------------------------------------------------------------------

// Order matters: soak scenario ids contain "query"/"connect", so the soak
// rule must win first; query beats connections for "connect-query" mixes.
const SUITE_RULES: Array<{ match: RegExp; suite: string }> = [
    { match: /soak/i, suite: "Soak" },
    { match: /oe-|expand-|object-?explorer/i, suite: "Object Explorer" },
    { match: /intellisense|completion/i, suite: "IntelliSense" },
    {
        match: /query|resultsgrid|large-result|blob|wide-columns|result-sets/i,
        suite: "Query & Results",
    },
    { match: /connect|reconnect/i, suite: "Connections" },
    { match: /activation|ext-|debug-console/i, suite: "Extension" },
    { match: /noop|synthetic|harness/i, suite: "Harness" },
];

export function suiteFor(scenarioId: string): string {
    for (const rule of SUITE_RULES) {
        if (rule.match.test(scenarioId)) {
            return rule.suite;
        }
    }
    return "Other";
}

// --- pure aggregation helpers (unit-tested) -------------------------------------

export function percentile(sorted: number[], p: number): number | undefined {
    if (sorted.length === 0) {
        return undefined;
    }
    const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[Math.max(0, index)];
}

export function officialSamples(scenario: IndexedScenario, metric: string): number[] {
    const values: number[] = [];
    for (const rep of scenario.reps) {
        if (rep.warmup || rep.status !== "passed") {
            continue;
        }
        const value = rep.official[metric] ?? rep.diagnostic[metric];
        if (typeof value === "number") {
            values.push(value);
        }
    }
    return values.sort((a, b) => a - b);
}

export function runVerdict(row: {
    status: string;
    failedReps: number;
    invalidReps: number;
}): RunVerdict {
    switch (row.status) {
        case "passed":
            return row.failedReps > 0 || row.invalidReps > 0 ? "warning" : "ok";
        case "failed":
            return "failed";
        case "invalid":
            return "invalid";
        default:
            return "unknown";
    }
}

/** Aggregate one scenario's reps (over possibly several runs) into a row. */
export function scenarioRowFrom(
    scenarioId: string,
    perRun: Array<{ runId: string; scenario: IndexedScenario }>,
    metric: string,
    baseline?: IndexedScenario,
): PerfScenarioRow {
    const allReps = perRun.flatMap((entry) => entry.scenario.reps);
    const samples = perRun
        .flatMap((entry) => officialSamples(entry.scenario, metric))
        .sort((a, b) => a - b);
    const validReps = allReps.filter((r) => !r.warmup && r.status === "passed").length;
    const totalReps = allReps.length;
    const failed = allReps.filter((r) => r.status === "failed").length;
    const skippedReason = perRun.find((e) => e.scenario.skippedReason)?.scenario.skippedReason;
    const p50 = percentile(samples, 50);
    const p95 = percentile(samples, 95);
    const baselineSamples = baseline ? officialSamples(baseline, metric) : [];
    const baselineP50 = percentile(baselineSamples, 50);
    const deltaPct =
        p50 !== undefined && baselineP50 !== undefined && baselineP50 !== 0
            ? Number((((p50 - baselineP50) / baselineP50) * 100).toFixed(1))
            : undefined;
    const verdict: RunVerdict = skippedReason
        ? "unknown"
        : failed > 0
          ? "failed"
          : totalReps === 0 || validReps === 0
            ? "invalid"
            : "ok";
    const artifactKinds = [...new Set(perRun.flatMap((e) => e.scenario.artifactKinds))].sort();
    return {
        key: scenarioId,
        scenarioId,
        suite: suiteFor(scenarioId),
        runIds: perRun.map((e) => e.runId),
        verdict,
        validReps,
        totalReps,
        metricName: metric,
        ...(p50 !== undefined ? { p50Ms: Number(p50.toFixed(1)) } : {}),
        ...(p95 !== undefined ? { p95Ms: Number(p95.toFixed(1)) } : {}),
        ...(baselineP50 !== undefined ? { baselineP50Ms: Number(baselineP50.toFixed(1)) } : {}),
        ...(deltaPct !== undefined ? { deltaPct } : {}),
        artifactKinds,
        ...(validReps > 0 && validReps < 3 ? { lowConfidence: true } : {}),
        ...(skippedReason ? { skippedReason } : {}),
    };
}

export function filterRuns(
    rows: PerfRunRow[],
    query: PerfRunsQuery,
): { rows: PerfRunRow[]; total: number; totalInSource: number } {
    const totalInSource = rows.length;
    const text = query.text?.toLowerCase();
    let filtered = rows.filter((row) => {
        if (query.verdicts && query.verdicts.length > 0 && !query.verdicts.includes(row.verdict)) {
            return false;
        }
        if (query.sinceUtc && row.createdUtc < query.sinceUtc) {
            return false;
        }
        if (
            query.passTypes &&
            query.passTypes.length > 0 &&
            !query.passTypes.includes(row.passType ?? "")
        ) {
            return false;
        }
        if (text) {
            const haystack =
                `${row.runId} ${row.label ?? ""} ${row.commit ?? ""} ${row.passType ?? ""}`.toLowerCase();
            if (!haystack.includes(text)) {
                return false;
            }
        }
        return true;
    });
    const dir = query.sortDir === "asc" ? 1 : -1;
    const key = query.sortBy ?? "createdUtc";
    filtered = filtered.sort((a, b) => {
        const av = a[key as keyof PerfRunRow];
        const bv = b[key as keyof PerfRunRow];
        if (av === undefined && bv === undefined) return 0;
        if (av === undefined) return 1;
        if (bv === undefined) return -1;
        return av < bv ? -dir : av > bv ? dir : 0;
    });
    const total = filtered.length;
    const offset = query.offset ?? 0;
    const limit = Math.min(query.limit ?? 200, 500);
    return { rows: filtered.slice(offset, offset + limit), total, totalInSource };
}

// --- provider -------------------------------------------------------------------

export interface IndexProgress {
    state: "scanning" | "done" | "error";
    scanned: number;
    total: number;
    message?: string;
}

export class DirectoryHistoryProvider {
    private index: DirIndex = { version: INDEX_VERSION, indexedAtUtc: "", runs: {} };
    private indexLoaded = false;
    public lastIndexMs: number | undefined;
    public lastError: string | undefined;

    constructor(
        public readonly sourceId: string,
        public readonly root: string,
        private readonly onProgress?: (progress: IndexProgress) => void,
    ) {}

    // --- index lifecycle -------------------------------------------------------

    private indexPath(): string {
        return path.join(this.root, INDEX_FILE);
    }

    private loadPersistedIndex(): void {
        if (this.indexLoaded) {
            return;
        }
        this.indexLoaded = true;
        try {
            const raw = JSON.parse(fs.readFileSync(this.indexPath(), "utf8")) as DirIndex;
            if (raw.version === INDEX_VERSION && raw.runs) {
                this.index = raw;
            }
        } catch {
            // no/old index — full scan will rebuild
        }
    }

    private persistIndex(): void {
        try {
            fs.writeFileSync(this.indexPath(), JSON.stringify(this.index), "utf8");
        } catch {
            // read-only roots still work; index just stays in memory
        }
    }

    /**
     * Incremental rescan: stat every run dir, (re)index only new/changed ones.
     * Chunked so thousands of runs never block the extension host loop.
     * Concurrent callers share the SAME in-flight scan — awaiting during an
     * active scan must wait for real results, never return early with an
     * empty index (that race blanked the runs table under live updates).
     */
    public rescan(): Promise<void> {
        if (this.scanPromise) {
            return this.scanPromise;
        }
        this.scanPromise = this.doRescan().finally(() => {
            this.scanPromise = undefined;
        });
        return this.scanPromise;
    }

    private scanPromise: Promise<void> | undefined;
    private lastScanEndedMs = 0;

    public get isScanning(): boolean {
        return this.scanPromise !== undefined;
    }

    /** Debounced background refresh: at most one scan per maxAgeMs. */
    public rescanIfStale(maxAgeMs: number): Promise<void> {
        if (this.scanPromise) {
            return this.scanPromise;
        }
        if (Date.now() - this.lastScanEndedMs < maxAgeMs) {
            return Promise.resolve();
        }
        return this.rescan();
    }

    private async doRescan(): Promise<void> {
        this.lastError = undefined;
        const started = Date.now();
        try {
            this.loadPersistedIndex();
            if (!fs.existsSync(this.root)) {
                this.index.runs = {};
                this.lastError = `directory does not exist: ${this.root}`;
                this.onProgress?.({
                    state: "error",
                    scanned: 0,
                    total: 0,
                    message: this.lastError,
                });
                return;
            }
            const entries = fs
                .readdirSync(this.root, { withFileTypes: true })
                .filter((e) => e.isDirectory() && !e.name.startsWith("."))
                .map((e) => e.name);
            const seen = new Set(entries);
            // Drop runs whose directories vanished.
            for (const known of Object.keys(this.index.runs)) {
                if (!seen.has(known)) {
                    delete this.index.runs[known];
                }
            }
            // Determine which runs need (re)indexing.
            const dirty: string[] = [];
            for (const name of entries) {
                const fingerprint = this.fingerprint(name);
                if (fingerprint === undefined) {
                    continue; // not a run dir
                }
                if (this.index.runs[name]?.fingerprint !== fingerprint) {
                    dirty.push(name);
                }
            }
            let scanned = 0;
            for (let i = 0; i < dirty.length; i += CHUNK) {
                for (const name of dirty.slice(i, i + CHUNK)) {
                    try {
                        const indexed = this.indexRun(name);
                        if (indexed) {
                            this.index.runs[name] = indexed;
                        } else {
                            delete this.index.runs[name];
                        }
                    } catch {
                        delete this.index.runs[name];
                    }
                    scanned++;
                }
                this.onProgress?.({ state: "scanning", scanned, total: dirty.length });
                // Yield the event loop between chunks.
                await new Promise<void>((resolve) => setImmediate(resolve));
            }
            this.index.indexedAtUtc = new Date().toISOString();
            if (dirty.length > 0) {
                this.persistIndex();
            }
            this.lastIndexMs = Date.now() - started;
            this.onProgress?.({ state: "done", scanned, total: dirty.length });
        } finally {
            this.lastScanEndedMs = Date.now();
        }
    }

    /** Cheap change detector: run dir mtime + summary.json mtime+size. */
    private fingerprint(runName: string): string | undefined {
        const runDir = path.join(this.root, runName);
        try {
            const dirStat = fs.statSync(runDir);
            let summaryPart = "nosummary";
            try {
                const s = fs.statSync(path.join(runDir, "summary.json"));
                summaryPart = `${s.mtimeMs}:${s.size}`;
            } catch {
                // runs without summary.json are still indexable from reps
            }
            if (!fs.existsSync(path.join(runDir, "scenarios"))) {
                return undefined;
            }
            return `${INDEX_VERSION}:${Math.floor(dirStat.mtimeMs)}:${summaryPart}`;
        } catch {
            return undefined;
        }
    }

    /** Read one run directory into the index (the only heavy-ish path). */
    private indexRun(runName: string): IndexedRun | undefined {
        const runDir = path.join(this.root, runName);
        const scenariosDir = path.join(runDir, "scenarios");
        if (!fs.existsSync(scenariosDir)) {
            return undefined;
        }
        let summary: {
            status?: string;
            passType?: string;
            environmentHash?: string;
            connection?: { connectionMode?: string; connectionLabel?: string };
            scenarios?: Record<string, { skipped?: boolean; reason?: string }>;
        } = {};
        try {
            summary = JSON.parse(fs.readFileSync(path.join(runDir, "summary.json"), "utf8"));
        } catch {
            // keep unknown status
        }
        const scenarios: Record<string, IndexedScenario> = {};
        let repTotal = 0;
        let failedReps = 0;
        let invalidReps = 0;
        let commit: string | undefined;
        let dirty: boolean | undefined;
        const wallSamples: number[] = [];
        for (const scenarioId of safeReaddir(scenariosDir)) {
            const repsDir = path.join(scenariosDir, scenarioId, "reps");
            const reps: IndexedRep[] = [];
            const artifactKinds = new Set<string>();
            let validationFailures = 0;
            for (const repName of safeReaddir(repsDir)) {
                const repDir = path.join(repsDir, repName);
                let result: {
                    repId?: number;
                    status?: string;
                    warmup?: boolean;
                    metrics?: Array<{
                        name: string;
                        value: number;
                        official: boolean;
                    }>;
                    failureReason?: string;
                    validations?: Array<{ status: string }>;
                    git?: Array<{ name?: string; repo?: string; sha?: string; dirty?: boolean }>;
                } = {};
                try {
                    result = JSON.parse(fs.readFileSync(path.join(repDir, "result.json"), "utf8"));
                } catch {
                    continue; // rep without result.json: not countable
                }
                const repId = result.repId ?? Number(repName.replace(/^rep-/, "")) ?? reps.length;
                const official: Record<string, number> = {};
                const diagnostic: Record<string, number> = {};
                for (const metric of result.metrics ?? []) {
                    if (typeof metric.value !== "number") {
                        continue;
                    }
                    if (metric.official) {
                        official[metric.name] = metric.value;
                    } else {
                        diagnostic[metric.name] = metric.value;
                    }
                }
                const status = result.status ?? "unknown";
                const warmup = result.warmup === true;
                reps.push({
                    repId,
                    status,
                    warmup,
                    official,
                    diagnostic,
                    ...(result.failureReason ? { failureReason: result.failureReason } : {}),
                });
                repTotal++;
                if (status === "failed") failedReps++;
                if (status === "invalid") invalidReps++;
                if (
                    !warmup &&
                    status === "passed" &&
                    official["scenario.wallclock"] !== undefined
                ) {
                    wallSamples.push(official["scenario.wallclock"]);
                }
                validationFailures += (result.validations ?? []).filter(
                    (v) => v.status === "failed",
                ).length;
                if (!commit) {
                    const repo = (result.git ?? []).find((g) =>
                        (g.name ?? g.repo ?? "").includes("vscode-mssql"),
                    );
                    if (repo?.sha) {
                        commit = repo.sha.slice(0, 8);
                        dirty = repo.dirty;
                    }
                }
                // Cheap artifact presence probes (stat only, never parsed here).
                if (fs.existsSync(path.join(repDir, "markers.jsonl"))) {
                    artifactKinds.add("markers");
                }
                if (fs.existsSync(path.join(repDir, "soak-iterations.jsonl"))) {
                    artifactKinds.add("soak");
                }
                const artifactsDir = path.join(repDir, "artifacts");
                if (fs.existsSync(path.join(artifactsDir, "sql", "sql-activity.jsonl"))) {
                    artifactKinds.add("sqlActivity");
                }
                for (const file of safeReaddir(artifactsDir)) {
                    if (/renderer.*trace/i.test(file)) artifactKinds.add("rendererTrace");
                    else if (/\.heapsnapshot$/i.test(file)) artifactKinds.add("heapSnapshot");
                    else if (/\.gcdump$/i.test(file)) artifactKinds.add("gcDump");
                    else if (/counters/i.test(file)) artifactKinds.add("counters");
                    else if (/\.cpuprofile$/i.test(file)) artifactKinds.add("cpuProfile");
                }
            }
            const skippedReason = summary.scenarios?.[scenarioId]?.reason;
            scenarios[scenarioId] = {
                scenarioId,
                reps,
                artifactKinds: [...artifactKinds].sort(),
                validationFailures,
                ...(summary.scenarios?.[scenarioId]?.skipped && skippedReason
                    ? { skippedReason }
                    : {}),
            };
        }
        const scenarioIds = Object.keys(scenarios);
        const scenarioPassed = scenarioIds.filter((id) => {
            const s = scenarios[id];
            return (
                s.reps.length > 0 &&
                s.reps.every((r) => r.status !== "failed") &&
                s.reps.some((r) => r.status === "passed")
            );
        }).length;
        wallSamples.sort((a, b) => a - b);
        const status = summary.status ?? "unknown";
        const rowBase = { status, failedReps, invalidReps };
        const allArtifacts = [
            ...new Set(scenarioIds.flatMap((id) => scenarios[id].artifactKinds)),
        ].sort();
        const p50 = percentile(wallSamples, 50);
        const p95 = percentile(wallSamples, 95);
        const row: Omit<PerfRunRow, "sourceId"> = {
            runId: runName,
            createdUtc: parseRunTimestamp(runName),
            status,
            verdict: runVerdict(rowBase),
            ...(summary.passType ? { passType: summary.passType, label: summary.passType } : {}),
            ...(summary.environmentHash ? { environmentHash: summary.environmentHash } : {}),
            ...(commit ? { commit } : {}),
            ...(dirty !== undefined ? { dirty } : {}),
            scenarioTotal: scenarioIds.length,
            scenarioPassed,
            repTotal,
            failedReps,
            invalidReps,
            ...(p50 !== undefined ? { wallP50Ms: Number(p50.toFixed(1)) } : {}),
            ...(p95 !== undefined ? { wallP95Ms: Number(p95.toFixed(1)) } : {}),
            artifactKinds: allArtifacts,
            ...(summary.connection?.connectionMode
                ? { connectionMode: summary.connection.connectionMode }
                : {}),
        };
        const fingerprint = this.fingerprint(runName);
        return { fingerprint: fingerprint ?? "", row, scenarios };
    }

    // --- queries ---------------------------------------------------------------

    public runCount(): number {
        this.loadPersistedIndex();
        return Object.keys(this.index.runs).length;
    }

    public scenarioCount(): number {
        this.loadPersistedIndex();
        const ids = new Set<string>();
        for (const run of Object.values(this.index.runs)) {
            for (const id of Object.keys(run.scenarios)) {
                ids.add(id);
            }
        }
        return ids.size;
    }

    public lastIndexedUtc(): string | undefined {
        return this.index.indexedAtUtc || undefined;
    }

    public allRunRows(): PerfRunRow[] {
        this.loadPersistedIndex();
        return Object.values(this.index.runs).map((run) => ({
            ...run.row,
            sourceId: this.sourceId,
        }));
    }

    public queryRuns(query: PerfRunsQuery): PagedRuns {
        return filterRuns(this.allRunRows(), query);
    }

    public runIdsSorted(): string[] {
        return this.allRunRows()
            .sort((a, b) => a.createdUtc.localeCompare(b.createdUtc))
            .map((r) => r.runId);
    }

    private scenarioOf(runId: string, scenarioId: string): IndexedScenario | undefined {
        this.loadPersistedIndex();
        return this.index.runs[runId]?.scenarios[scenarioId];
    }

    /** Baseline scenario: pinned run, else the closest EARLIER run having it. */
    private baselineScenario(
        scenarioId: string,
        selectedRunIds: string[],
        pinnedRunId?: string,
    ): IndexedScenario | undefined {
        if (pinnedRunId) {
            return this.scenarioOf(pinnedRunId, scenarioId);
        }
        const ordered = this.runIdsSorted();
        const selected = new Set(selectedRunIds);
        const earliestSelected = ordered.findIndex((id) => selected.has(id));
        for (let i = earliestSelected - 1; i >= 0; i--) {
            const candidate = this.scenarioOf(ordered[i], scenarioId);
            if (candidate && officialSamples(candidate, "scenario.wallclock").length > 0) {
                return candidate;
            }
        }
        return undefined;
    }

    public queryScenarios(query: PerfScenariosQuery): PerfScenarioRow[] {
        this.loadPersistedIndex();
        const metric = query.metric ?? "scenario.wallclock";
        let runIds = query.runIds;
        if (runIds.length === 0) {
            const newest = this.runIdsSorted().pop();
            runIds = newest ? [newest] : [];
        }
        // Collect scenario → per-run entries across the selected runs.
        const byScenario = new Map<string, Array<{ runId: string; scenario: IndexedScenario }>>();
        for (const runId of runIds) {
            const run = this.index.runs[runId];
            if (!run) continue;
            for (const [scenarioId, scenario] of Object.entries(run.scenarios)) {
                const list = byScenario.get(scenarioId) ?? [];
                list.push({ runId, scenario });
                byScenario.set(scenarioId, list);
            }
        }
        let rows = [...byScenario.entries()].map(([scenarioId, perRun]) =>
            scenarioRowFrom(
                scenarioId,
                perRun,
                metric,
                this.baselineScenario(scenarioId, runIds, query.baselineRunId),
            ),
        );
        // Filters.
        const text = query.text?.toLowerCase();
        rows = rows.filter((row) => {
            if (text && !`${row.key} ${row.suite ?? ""}`.toLowerCase().includes(text)) return false;
            if (
                query.verdicts &&
                query.verdicts.length > 0 &&
                !query.verdicts.includes(row.verdict)
            )
                return false;
            if (query.artifactKind && !row.artifactKinds.includes(query.artifactKind)) return false;
            if (query.suite && row.suite !== query.suite) return false;
            return true;
        });
        // Grouping.
        const groupBy = query.groupBy ?? "scenario";
        if (groupBy !== "scenario") {
            const groups = new Map<string, PerfScenarioRow[]>();
            for (const row of rows) {
                const key =
                    groupBy === "suite"
                        ? (row.suite ?? "Other")
                        : groupBy === "verdict"
                          ? row.verdict
                          : row.runIds.join(",");
                const list = groups.get(key) ?? [];
                list.push(row);
                groups.set(key, list);
            }
            rows = [...groups.entries()].map(([key, members]) => mergeGroup(key, members));
        }
        return rows.sort((a, b) => Math.abs(b.deltaPct ?? 0) - Math.abs(a.deltaPct ?? 0));
    }

    public metricSeries(scenarioId: string, metric: string, lastN = 50): PerfMetricSeriesPoint[] {
        this.loadPersistedIndex();
        const points: PerfMetricSeriesPoint[] = [];
        for (const runId of this.runIdsSorted()) {
            const scenario = this.scenarioOf(runId, scenarioId);
            if (!scenario) continue;
            const samples = officialSamples(scenario, metric);
            const p50 = percentile(samples, 50);
            const p95 = percentile(samples, 95);
            if (p50 === undefined || p95 === undefined) continue;
            points.push({
                runId,
                createdUtc: this.index.runs[runId].row.createdUtc,
                p50: Number(p50.toFixed(1)),
                p95: Number(p95.toFixed(1)),
                n: samples.length,
            });
        }
        return points.slice(-lastN);
    }

    // --- lazy details ------------------------------------------------------------

    public scenarioDetails(query: PerfScenarioDetailsQuery): PerfScenarioDetails {
        this.loadPersistedIndex();
        const scenario = this.scenarioOf(query.runId, query.scenarioId);
        const repsDir = path.join(this.root, query.runId, "scenarios", query.scenarioId, "reps");
        const reps: PerfRepRow[] = [];
        const validations: PerfValidationRow[] = [];
        const artifacts: PerfArtifactRef[] = [];
        for (const repName of safeReaddir(repsDir)) {
            const repDir = path.join(repsDir, repName);
            try {
                const result = JSON.parse(
                    fs.readFileSync(path.join(repDir, "result.json"), "utf8"),
                ) as {
                    repId?: number;
                    status?: string;
                    warmup?: boolean;
                    metrics?: Array<{
                        name: string;
                        value: number;
                        unit?: string;
                        official: boolean;
                        eligibility?: PerfMetricEligibility;
                    }>;
                    failureReason?: string;
                    validations?: Array<{ name: string; status: string; message?: string }>;
                };
                const repId = result.repId ?? Number(repName.replace(/^rep-/, ""));
                const hasMarkers = fs.existsSync(path.join(repDir, "markers.jsonl"));
                reps.push({
                    repId,
                    status: result.status ?? "unknown",
                    warmup: result.warmup === true,
                    metrics: (result.metrics ?? [])
                        .filter((m) => typeof m.value === "number")
                        .map((m) => ({
                            name: m.name,
                            value: m.value,
                            unit: m.unit ?? "ms",
                            official: m.official === true,
                            ...(m.eligibility ? { eligibility: m.eligibility } : {}),
                        })),
                    ...(result.failureReason ? { failureReason: result.failureReason } : {}),
                    hasMarkers,
                });
                for (const validation of result.validations ?? []) {
                    validations.push({
                        name: `rep ${repId}: ${validation.name}`,
                        status: validation.status,
                        ...(validation.message ? { message: validation.message } : {}),
                    });
                }
                for (const artifactFile of ["markers.jsonl", "soak-iterations.jsonl"]) {
                    const p = path.join(repDir, artifactFile);
                    if (fs.existsSync(p)) {
                        artifacts.push({
                            kind: artifactFile === "markers.jsonl" ? "markers" : "soak",
                            path: p,
                            repId,
                            ...(safeSize(p) !== undefined ? { sizeBytes: safeSize(p) } : {}),
                        });
                    }
                }
                const sqlPath = path.join(repDir, "artifacts", "sql", "sql-activity.jsonl");
                if (fs.existsSync(sqlPath)) {
                    artifacts.push({
                        kind: "sqlActivity",
                        path: sqlPath,
                        repId,
                        ...(safeSize(sqlPath) !== undefined
                            ? { sizeBytes: safeSize(sqlPath) }
                            : {}),
                    });
                }
            } catch {
                // unreadable rep: reflected by absence
            }
        }
        // Submetrics: aggregate every metric present, official + diagnostic.
        const submetrics: PerfSubmetricRow[] = [];
        if (scenario) {
            const names = new Map<
                string,
                { official: boolean; unit: string; eligibility?: PerfMetricEligibility }
            >();
            for (const rep of reps) {
                for (const metric of rep.metrics) {
                    names.set(metric.name, {
                        official: metric.official,
                        unit: metric.unit,
                        ...(metric.eligibility ? { eligibility: metric.eligibility } : {}),
                    });
                }
            }
            const baseline = this.baselineScenario(
                query.scenarioId,
                [query.runId],
                query.baselineRunId,
            );
            for (const [name, info] of names) {
                const samples = reps
                    .filter((r) => !r.warmup && r.status === "passed")
                    .map((r) => r.metrics.find((m) => m.name === name)?.value)
                    .filter((v): v is number => typeof v === "number")
                    .sort((a, b) => a - b);
                const p50 = percentile(samples, 50);
                const baselineSamples = baseline ? officialSamples(baseline, name) : [];
                const baselineP50 = percentile(baselineSamples, 50);
                submetrics.push({
                    name,
                    unit: info.unit,
                    official: info.official,
                    ...(info.eligibility ? { eligibility: info.eligibility } : {}),
                    ...(p50 !== undefined ? { p50: Number(p50.toFixed(2)) } : {}),
                    ...(baselineP50 !== undefined
                        ? { baselineP50: Number(baselineP50.toFixed(2)) }
                        : {}),
                    ...(p50 !== undefined && baselineP50 !== undefined && baselineP50 !== 0
                        ? {
                              deltaPct: Number(
                                  (((p50 - baselineP50) / baselineP50) * 100).toFixed(1),
                              ),
                          }
                        : {}),
                    n: samples.length,
                });
            }
            submetrics.sort(
                (a, b) => Number(b.official) - Number(a.official) || a.name.localeCompare(b.name),
            );
        }
        return {
            runId: query.runId,
            scenarioId: query.scenarioId,
            reps: reps.sort((a, b) => a.repId - b.repId),
            submetrics,
            validations,
            artifacts,
            ...(scenario?.skippedReason ? { skippedReason: scenario.skippedReason } : {}),
        };
    }

    /**
     * Delete one run: remove the directory from disk and evict it from the
     * index (persisted). Refuses run ids that are not direct children of the
     * root — no path tricks.
     */
    public deleteRun(runId: string): { ok: boolean; error?: string } {
        if (!/^[^/\\]+$/.test(runId) || runId.startsWith(".")) {
            return { ok: false, error: `invalid run id '${runId}'` };
        }
        this.loadPersistedIndex();
        const runDir = path.join(this.root, runId);
        try {
            if (fs.existsSync(runDir)) {
                fs.rmSync(runDir, { recursive: true, force: true });
            }
            delete this.index.runs[runId];
            this.persistIndex();
            return { ok: true };
        } catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    public repDir(runId: string, scenarioId: string, repId: number): string {
        return path.join(
            this.root,
            runId,
            "scenarios",
            scenarioId,
            "reps",
            `rep-${String(repId).padStart(2, "0")}`,
        );
    }
}

/** Merge grouped scenario rows into one aggregate row. */
export function mergeGroup(key: string, members: PerfScenarioRow[]): PerfScenarioRow {
    const totalReps = members.reduce((sum, m) => sum + m.totalReps, 0);
    const validReps = members.reduce((sum, m) => sum + m.validReps, 0);
    const worst = members.reduce<RunVerdict>((acc, m) => {
        const rank: Record<RunVerdict, number> = {
            failed: 4,
            invalid: 3,
            warning: 2,
            unknown: 1,
            ok: 0,
        };
        return rank[m.verdict] > rank[acc] ? m.verdict : acc;
    }, "ok");
    const deltas = members.map((m) => m.deltaPct).filter((d): d is number => d !== undefined);
    const p50s = members.map((m) => m.p50Ms).filter((v): v is number => v !== undefined);
    return {
        key: `${key} (${members.length})`,
        runIds: [...new Set(members.flatMap((m) => m.runIds))],
        verdict: worst,
        validReps,
        totalReps,
        metricName: members[0]?.metricName ?? "scenario.wallclock",
        ...(p50s.length > 0
            ? { p50Ms: Number((p50s.reduce((a, b) => a + b, 0) / p50s.length).toFixed(1)) }
            : {}),
        ...(deltas.length > 0
            ? {
                  deltaPct: Number((deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(1)),
              }
            : {}),
        artifactKinds: [...new Set(members.flatMap((m) => m.artifactKinds))].sort(),
        memberScenarioIds: members
            .map((m) => m.scenarioId)
            .filter((id): id is string => id !== undefined),
    };
}

function safeReaddir(dir: string): string[] {
    try {
        return fs.readdirSync(dir);
    } catch {
        return [];
    }
}

function safeSize(file: string): number | undefined {
    try {
        return fs.statSync(file).size;
    } catch {
        return undefined;
    }
}

function parseRunTimestamp(runName: string): string {
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z/.exec(runName);
    return match ? `${match[1]}T${match[2]}:${match[3]}:${match[4]}Z` : runName.slice(0, 20);
}
