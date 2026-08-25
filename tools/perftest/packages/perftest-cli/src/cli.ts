#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * perftest CLI (design §26). Command surface and exit codes are the public
 * contract. Exit requests unwind through Commander so resource-owning actions
 * reach their finally blocks and piped stdout is allowed to flush.
 */

import { Command } from "commander";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { validateContract, type ContractName, type PassType } from "@mssqlperf/contracts";
import { ExitCode } from "./exitCodes";
import { createRootLogger, JsonlFileSink } from "./telemetry/logger";
import { loadConfig, ConfigError, parseJsoncStrict } from "./config/loadConfig";
import { runDoctor, formatDoctorReport } from "./doctor/doctor";
import { PerfStore } from "./store/sqliteStore";
import { listScenarios } from "./scenarios/registry";
import { listCollectors, PLANNED_COLLECTORS } from "./collectors/registry";
import { executeRun, RunConfigError } from "./run/runPipeline";
import { compareRuns, renderComparisonConsole, CompareError } from "./regression/compareRuns";
import { investigate, renderInvestigationConsole } from "./regression/investigate";

const { logger, sink } = createRootLogger();
const HARNESS_ROOT = resolve(__dirname, "..", "..", "..");

class CliExit extends Error {
    constructor(readonly code: number) {
        super(`CLI exit ${code}`);
    }
}

function exit(code: number): never {
    throw new CliExit(code);
}

const program = new Command();
program
    .name("perftest")
    .description("Local-first deterministic perf harness for MSSQL VS Code + SQL Tools Service")
    .version("0.1.0");

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------
program
    .command("doctor")
    .description("Run environment preflight checks and report machine status")
    .option("--json", "emit the report as JSON")
    .option("--config <path>", "config file to validate alongside the environment")
    .action((opts: { json?: boolean; config?: string }) => {
        const report = runDoctor(logger.child("doctor"));
        if (opts.config) {
            try {
                loadConfig(opts.config);
                report.checks.push({
                    name: "configValid",
                    status: "passed",
                    message: `${opts.config} validates against perf-config schema`,
                });
            } catch (error) {
                if (error instanceof CliExit) throw error;
                report.checks.push({
                    name: "configValid",
                    status: "failed",
                    message: error instanceof ConfigError ? error.message : String(error),
                });
                report.status = "failed";
            }
        }
        if (opts.json) {
            process.stdout.write(JSON.stringify(report, null, 2) + "\n");
        } else {
            process.stdout.write(formatDoctorReport(report) + "\n");
        }
        exit(report.status === "failed" ? ExitCode.preflightFailed : ExitCode.ok);
    });

// ---------------------------------------------------------------------------
// schema validate
// ---------------------------------------------------------------------------
program
    .command("schema")
    .description("Contract schema operations")
    .command("validate <file>")
    .description("Validate a JSON/JSONC file against a perf contract schema")
    .option(
        "--contract <name>",
        "contract to validate against: marker | perf-config | perf-result (default: auto-detect)",
    )
    .action((file: string, opts: { contract?: ContractName }) => {
        if (!existsSync(file)) {
            process.stderr.write(`File not found: ${file}\n`);
            exit(ExitCode.configInvalid);
        }
        let data: unknown;
        try {
            data = parseJsoncStrict(readFileSync(file, "utf8"), file);
        } catch (error) {
            if (error instanceof CliExit) throw error;
            process.stderr.write(
                error instanceof ConfigError
                    ? `${error.message}\n${error.details.join("\n")}\n`
                    : `${String(error)}\n`,
            );
            exit(ExitCode.configInvalid);
        }

        const detect = (): ContractName => {
            if (opts.contract) return opts.contract;
            const obj = data as Record<string, unknown>;
            if (obj && typeof obj === "object") {
                if ("phase" in obj && "process" in obj) return "marker";
                if ("metrics" in obj && "status" in obj) return "perf-result";
                if ("scenarios" in obj && "vscode" in obj) return "perf-config";
            }
            return "perf-config";
        };

        const contract = detect();
        const outcome = validateContract(contract, data);
        if (outcome.valid) {
            process.stdout.write(`VALID: ${file} conforms to the ${contract} schema\n`);
            exit(ExitCode.ok);
        }
        process.stderr.write(`INVALID: ${file} does not conform to the ${contract} schema:\n`);
        for (const err of outcome.errors) {
            process.stderr.write(`  - ${err}\n`);
        }
        exit(ExitCode.configInvalid);
    });

// ---------------------------------------------------------------------------
// scenarios / collectors
// ---------------------------------------------------------------------------
program
    .command("scenarios")
    .description("Scenario operations")
    .command("list")
    .description("List registered scenarios and their implementation status")
    .action(() => {
        const scenarios = listScenarios();
        process.stdout.write("Scenario                     Status        Official metric\n");
        process.stdout.write(
            "---------------------------- ------------- -----------------------\n",
        );
        for (const s of scenarios) {
            const status = s.implemented ? "implemented" : `planned (${s.plannedMilestone})`;
            const official =
                s.spec.metrics
                    ?.filter((m) => m.official)
                    .map((m) => m.name)
                    .join(", ") ?? "";
            process.stdout.write(
                `${s.spec.scenarioId.padEnd(28)} ${status.padEnd(13)} ${official}\n`,
            );
        }
        exit(ExitCode.ok);
    });

program
    .command("collectors")
    .description("Collector operations")
    .command("list")
    .description("List implemented collectors and the remaining planned catalog")
    .action(() => {
        const implemented = listCollectors();
        if (implemented.length === 0) {
            process.stdout.write("No collectors implemented.\n");
        } else {
            process.stdout.write("Implemented collectors:\n");
            for (const c of implemented) {
                process.stdout.write(
                    `  ${c.name.padEnd(24)} cost=${c.cost} passes=${c.allowedPassTypes.join(",")}\n`,
                );
            }
        }
        const implementedNames = new Set(implemented.map((c) => c.name));
        const planned = PLANNED_COLLECTORS.filter((p) => !implementedNames.has(p.name));
        if (planned.length > 0) {
            process.stdout.write("Planned:\n");
            for (const p of planned) {
                process.stdout.write(`  ${p.name.padEnd(24)} ${p.milestone}\n`);
            }
        }
        exit(ExitCode.ok);
    });

// ---------------------------------------------------------------------------
// store init (explicit helper; run also initializes on demand)
// ---------------------------------------------------------------------------
program
    .command("store")
    .description("Local store operations")
    .command("init")
    .description("Initialize (or migrate) the local SQLite store from the canonical schema")
    .option("--db <path>", "database path", "./perf.db")
    .action((opts: { db: string }) => {
        const store = PerfStore.open(opts.db, logger.child("store"));
        const tables = store.tableNames();
        store.close();
        process.stdout.write(
            `Store initialized at ${store.path}\nTables/views (${tables.length}): ${tables.join(", ")}\n`,
        );
        exit(ExitCode.ok);
    });

// ---------------------------------------------------------------------------
// run / report / compare / baseline / cleanup — pipelines land in M1/M6'
// ---------------------------------------------------------------------------
program
    .command("run")
    .description("Execute a perf run")
    .requiredOption("--config <path>", "perf config file (jsonc)")
    .option("--scenario <id>", "run a single scenario")
    .option("--pass <type>", "override pass type: measurement | diagnostic | calibration")
    .option("--tag <label>", "tag this run (before-fix / after-fix / PR#…)")
    .action(async (opts: { config: string; scenario?: string; pass?: string; tag?: string }) => {
        if (opts.pass && !["measurement", "diagnostic", "calibration"].includes(opts.pass)) {
            process.stderr.write(`Invalid --pass '${opts.pass}'\n`);
            exit(ExitCode.configInvalid);
        }
        let loaded;
        try {
            loaded = loadConfig(opts.config);
        } catch (error) {
            if (error instanceof CliExit) throw error;
            if (error instanceof ConfigError) {
                process.stderr.write(`${error.message}\n`);
                for (const d of error.details) process.stderr.write(`  - ${d}\n`);
                exit(ExitCode.configInvalid);
            }
            throw error;
        }

        // From here on, every harness event also lands in the run's JSONL log.
        const runDir = resolve(loaded.config.output.dir, loaded.runId);
        mkdirSync(runDir, { recursive: true });
        sink.add(new JsonlFileSink(join(runDir, "harness-log.jsonl")));
        logger.info("run.starting", undefined, {
            runId: loaded.runId,
            configHash: loaded.configHash,
            configPath: loaded.configPath,
        });

        try {
            const summary = await executeRun({
                loaded,
                ...(opts.scenario !== undefined ? { scenarioFilter: opts.scenario } : {}),
                ...(opts.pass !== undefined ? { passOverride: opts.pass as PassType } : {}),
                logger: logger.child("run"),
                harnessRoot: HARNESS_ROOT,
            });
            process.stdout.write(`\nRun: ${summary.runId}\n`);
            for (const result of summary.results) {
                const wallclock = result.metrics.find((m) => m.name === "scenario.wallclock");
                process.stdout.write(
                    `  ${result.scenarioId} rep ${result.repId}: ${result.status}` +
                        (wallclock
                            ? ` scenario.wallclock=${wallclock.value.toFixed(1)}ms (official=${wallclock.official})`
                            : " (no wallclock)") +
                        "\n",
                );
            }
            process.stdout.write(`Report: ${join(summary.runDir, "index.html")}\n`);
            if (opts.tag && loaded.config.store.type === "sqlite") {
                const store = PerfStore.open(
                    loaded.config.store.path ?? "./perf.db",
                    logger.child("store"),
                );
                try {
                    store.tagRun(summary.runId, opts.tag);
                } finally {
                    store.close();
                }
            }

            // Regression gate (design §24.3/§26): when a baseline is configured,
            // compare and let a gated regression drive the exit code.
            const regression = loaded.config.regression;
            const baselineRef = regression?.baseline;
            if (
                summary.exitCode === ExitCode.ok &&
                baselineRef &&
                baselineRef !== "none" &&
                loaded.config.store.type === "sqlite"
            ) {
                const store = PerfStore.open(
                    loaded.config.store.path ?? "./perf.db",
                    logger.child("store"),
                );
                try {
                    const comparison = compareRuns(
                        store,
                        summary.runId,
                        baselineRef,
                        logger.child("compare"),
                        { thresholds: regression.thresholds as never },
                    );
                    process.stdout.write("\n" + renderComparisonConsole(comparison) + "\n");
                    if (comparison.status === "regressed" && regression.failOnRegression) {
                        exit(ExitCode.regression);
                    }
                } catch (error) {
                    if (error instanceof CliExit) throw error;
                    if (error instanceof CompareError) {
                        process.stderr.write(`Baseline comparison skipped: ${error.message}\n`);
                    } else {
                        throw error;
                    }
                } finally {
                    store.close();
                }
            }
            exit(summary.exitCode);
        } catch (error) {
            if (error instanceof CliExit) throw error;
            if (error instanceof RunConfigError) {
                process.stderr.write(`${error.message}\n`);
                exit(ExitCode.configInvalid);
            }
            logger.error(
                "run.failed",
                error instanceof Error ? (error.stack ?? error.message) : String(error),
            );
            exit(ExitCode.infrastructureFailure);
        }
    });

program
    .command("report <runId>")
    .description("Re-render the Markdown/HTML report for a stored run")
    .option("--db <path>", "database path", "./perf.db")
    .option("--open", "open the HTML report when done")
    .action(async (runId: string, opts: { db: string; open?: boolean }) => {
        const store = PerfStore.open(opts.db, logger.child("store"));
        const run = store.getRun(runId);
        store.close();
        if (!run) {
            process.stderr.write(`Run '${runId}' not found in ${opts.db}\n`);
            exit(ExitCode.configInvalid);
        }
        const { readdirSync } = await import("node:fs");
        const results: import("@mssqlperf/contracts").PerfResult[] = [];
        const scenariosDir = join(run.outputDir, "scenarios");
        if (existsSync(scenariosDir)) {
            for (const scenario of readdirSync(scenariosDir)) {
                const repsDir = join(scenariosDir, scenario, "reps");
                if (!existsSync(repsDir)) continue;
                for (const rep of readdirSync(repsDir)) {
                    const resultPath = join(repsDir, rep, "result.json");
                    if (existsSync(resultPath)) {
                        results.push(
                            JSON.parse(
                                readFileSync(resultPath, "utf8"),
                            ) as import("@mssqlperf/contracts").PerfResult,
                        );
                    }
                }
            }
        }
        if (results.length === 0) {
            process.stderr.write(`No rep results found under ${run.outputDir}\n`);
            exit(ExitCode.infrastructureFailure);
        }
        const { renderMarkdownReport } = await import("./report/markdownReport");
        const { renderHtmlReport } = await import("./report/htmlReport");
        const env = results[0]!.environment;
        const { writeFileSync } = await import("node:fs");
        const common = {
            runId,
            passType: run.passType,
            createdAt: new Date().toISOString(),
            environmentHash: run.environmentHash,
            ...(env.machineId !== undefined ? { machineId: String(env.machineId) } : {}),
            vscodeVersion: String(
                (env.vscode as Record<string, unknown>)?.["version"] ?? "unknown",
            ),
            results,
        };
        writeFileSync(
            join(run.outputDir, "report.md"),
            renderMarkdownReport({ ...common, harnessLogPath: "harness-log.jsonl" }),
            "utf8",
        );
        const htmlPath = join(run.outputDir, "report.html");
        writeFileSync(htmlPath, renderHtmlReport(common), "utf8");
        const { writeRunIndex } = await import("./report/runIndex");
        const indexPath = writeRunIndex(run.outputDir, logger.child("report"));
        process.stdout.write(`Report rendered: ${indexPath ?? htmlPath}\n`);
        if (opts.open) {
            const { exec } = await import("node:child_process");
            exec(`start "" "${indexPath ?? htmlPath}"`, { windowsHide: true });
        }
        exit(ExitCode.ok);
    });

program
    .command("compare")
    .description("Compare a run's official metrics against a baseline run or named baseline")
    .requiredOption("--current <runId>")
    .requiredOption("--baseline <runIdOrName>")
    .option("--db <path>", "database path", "./perf.db")
    .option("--allow-cross-environment", "compare despite differing environment hashes")
    .option("--json", "emit the comparison as JSON")
    .action(
        (opts: {
            current: string;
            baseline: string;
            db: string;
            allowCrossEnvironment?: boolean;
            json?: boolean;
        }) => {
            const store = PerfStore.open(opts.db, logger.child("store"));
            try {
                const comparison = compareRuns(
                    store,
                    opts.current,
                    opts.baseline,
                    logger.child("compare"),
                    {
                        ...(opts.allowCrossEnvironment !== undefined
                            ? { allowCrossEnvironment: opts.allowCrossEnvironment }
                            : {}),
                    },
                );
                process.stdout.write(
                    (opts.json
                        ? JSON.stringify(comparison, null, 2)
                        : renderComparisonConsole(comparison)) + "\n",
                );
                exit(
                    comparison.status === "regressed"
                        ? ExitCode.regression
                        : comparison.status === "inconclusive"
                          ? ExitCode.insufficientSamples
                          : ExitCode.ok,
                );
            } catch (error) {
                if (error instanceof CliExit) throw error;
                if (error instanceof CompareError) {
                    process.stderr.write(`${error.message}\n`);
                    exit(
                        error.kind === "insufficientSamples"
                            ? ExitCode.insufficientSamples
                            : ExitCode.configInvalid,
                    );
                }
                throw error;
            } finally {
                store.close();
            }
        },
    );

program
    .command("diff")
    .description(
        "A/B investigation diff: official gate + non-gating what-changed analysis (SQL activity, all metrics, git context)",
    )
    .requiredOption("--baseline <runId>")
    .requiredOption("--candidate <runId>")
    .option("--db <path>", "database path", "./perf.db")
    .option("--json", "emit the full investigation as JSON")
    .option("--allow-cross-environment", "compare despite differing environment hashes")
    .action(
        (opts: {
            baseline: string;
            candidate: string;
            db: string;
            json?: boolean;
            allowCrossEnvironment?: boolean;
        }) => {
            const store = PerfStore.open(opts.db, logger.child("store"));
            try {
                // Official gate first (verdicts only from official metrics).
                let comparison;
                try {
                    comparison = compareRuns(
                        store,
                        opts.candidate,
                        opts.baseline,
                        logger.child("compare"),
                        {
                            persist: false,
                            ...(opts.allowCrossEnvironment !== undefined
                                ? { allowCrossEnvironment: opts.allowCrossEnvironment }
                                : {}),
                        },
                    );
                } catch (error) {
                    if (error instanceof CliExit) throw error;
                    if (!(error instanceof CompareError)) throw error;
                    process.stderr.write(`Official gate skipped: ${error.message}\n`);
                }
                const investigation = investigate(
                    store,
                    opts.baseline,
                    opts.candidate,
                    logger.child("investigate"),
                );
                if (opts.json) {
                    process.stdout.write(
                        JSON.stringify({ gate: comparison ?? null, investigation }, null, 2) + "\n",
                    );
                } else {
                    if (comparison) {
                        process.stdout.write(renderComparisonConsole(comparison) + "\n");
                    }
                    process.stdout.write(renderInvestigationConsole(investigation) + "\n");
                }
                // Persist the investigation beside the candidate run (additive).
                const candidateRun = store.getRun(opts.candidate);
                if (candidateRun) {
                    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
                    writeFileSync(
                        join(candidateRun.outputDir, "investigation.json"),
                        JSON.stringify({ gate: comparison ?? null, investigation }, null, 2),
                        "utf8",
                    );
                    const { renderInvestigationHtml } =
                        require("./report/investigationReport") as typeof import("./report/investigationReport");
                    const htmlPath = join(candidateRun.outputDir, "investigation.html");
                    writeFileSync(
                        htmlPath,
                        renderInvestigationHtml(comparison, investigation),
                        "utf8",
                    );
                    process.stdout.write(`Investigation report: ${htmlPath}\n`);
                }
                exit(comparison?.status === "regressed" ? ExitCode.regression : ExitCode.ok);
            } finally {
                store.close();
            }
        },
    );

program
    .command("head-to-head")
    .description(
        "Compare two SCENARIOS head-to-head (default: query-10k-results vs querystudio-query-10k) " +
            "using each scenario's most recent official-passing run. Non-gating investigation view.",
    )
    .option("--baseline-scenario <id>", "baseline scenario id", "query-10k-results")
    .option("--candidate-scenario <id>", "candidate scenario id", "querystudio-query-10k")
    .option("--db <path>", "database path", "./perf.db")
    .option("--out <file>", "output HTML path (default head-to-head-<base>-vs-<cand>.html)")
    .option("--json", "emit the full report as JSON")
    .option("--open", "open the HTML report when done")
    .action(
        async (opts: {
            baselineScenario: string;
            candidateScenario: string;
            db: string;
            out?: string;
            json?: boolean;
            open?: boolean;
        }) => {
            const store = PerfStore.open(opts.db, logger.child("store"));
            try {
                const { headToHead, renderHeadToHeadConsole, HeadToHeadError } =
                    require("./regression/headToHead") as typeof import("./regression/headToHead");
                let report;
                try {
                    report = headToHead(store, logger.child("headToHead"), {
                        baselineScenario: opts.baselineScenario,
                        candidateScenario: opts.candidateScenario,
                    });
                } catch (error) {
                    if (error instanceof CliExit) throw error;
                    if (error instanceof HeadToHeadError) {
                        process.stderr.write(`${error.message}\n`);
                        exit(ExitCode.insufficientSamples);
                    }
                    throw error;
                }
                if (opts.json) {
                    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
                } else {
                    process.stdout.write(renderHeadToHeadConsole(report) + "\n");
                }
                const { renderHeadToHeadHtml } =
                    require("./report/headToHeadReport") as typeof import("./report/headToHeadReport");
                const { writeFileSync } = await import("node:fs");
                const outPath = resolve(
                    opts.out ??
                        `head-to-head-${opts.baselineScenario}-vs-${opts.candidateScenario}.html`.replace(
                            /[^a-z0-9.\-]/gi,
                            "_",
                        ),
                );
                writeFileSync(outPath, renderHeadToHeadHtml(report), "utf8");
                process.stdout.write(`Head-to-head report: ${outPath}\n`);
                if (opts.open) {
                    const { exec } = await import("node:child_process");
                    exec(`start "" "${outPath}"`, { windowsHide: true });
                }
                exit(ExitCode.ok);
            } finally {
                store.close();
            }
        },
    );

program
    .command("trend")
    .description("Cross-run trend of an official metric with step-change attribution")
    .requiredOption("--scenario <id>")
    .option("--metric <name>", "official metric name", "scenario.wallclock")
    .option("--last <n>", "limit to the last N runs")
    .option("--tag <tag>", "only runs tagged with this label")
    .option("--db <path>", "database path", "./perf.db")
    .option("--out <file>", "output HTML path (default trend-<scenario>.html)")
    .action(
        (opts: {
            scenario: string;
            metric: string;
            last?: string;
            tag?: string;
            db: string;
            out?: string;
        }) => {
            const store = PerfStore.open(opts.db, logger.child("store"));
            try {
                const { renderTrend } =
                    require("./report/trendReport") as typeof import("./report/trendReport");
                const outPath = resolve(
                    opts.out ??
                        `trend-${opts.scenario}-${opts.metric.replace(/[^a-z0-9.]/gi, "_")}.html`,
                );
                const result = renderTrend(
                    store,
                    opts.scenario,
                    opts.metric,
                    {
                        ...(opts.last !== undefined ? { lastN: Number(opts.last) } : {}),
                        ...(opts.tag !== undefined ? { tag: opts.tag } : {}),
                        outPath,
                    },
                    logger.child("trend"),
                );
                if (result.series.length === 0) {
                    process.stderr.write(
                        `No official samples for ${opts.scenario}/${opts.metric}\n`,
                    );
                    exit(ExitCode.insufficientSamples);
                }
                for (const point of result.series) {
                    process.stdout.write(
                        `${point.runId}  ${point.median.toFixed(1)} (${point.samples} reps)${point.tag ? ` [${point.tag}]` : ""}${point.productSha ? ` @${point.productSha.slice(0, 8)}` : ""}\n`,
                    );
                }
                if (result.stepChange) {
                    process.stdout.write(
                        `STEP CHANGE: ${result.stepChange.deltaPct > 0 ? "+" : ""}${result.stepChange.deltaPct}% at ${result.stepChange.runId} (sha ${result.stepChange.productSha ?? "unknown"})\n`,
                    );
                }
                process.stdout.write(`Trend: ${outPath}\n`);
                exit(ExitCode.ok);
            } finally {
                store.close();
            }
        },
    );

program
    .command("history")
    .description("Local history dashboard (runs, trends, regressions, baselines)")
    .option("--db <path>", "database path", "./perf.db")
    .option("--out <file>", "output HTML path", "./history.html")
    .option("--open", "open in the browser")
    .action(async (opts: { db: string; out: string; open?: boolean }) => {
        const store = PerfStore.open(opts.db, logger.child("store"));
        try {
            const { renderHistory } =
                require("./report/trendReport") as typeof import("./report/trendReport");
            const outPath = renderHistory(store, resolve(opts.out), logger.child("history"));
            process.stdout.write(`History: ${outPath}\n`);
            if (opts.open) {
                const { exec } = await import("node:child_process");
                exec(`start "" "${outPath}"`, { windowsHide: true });
            }
            exit(ExitCode.ok);
        } finally {
            store.close();
        }
    });

program
    .command("tag <runId> <label>")
    .description("Tag a run (before-fix / after-fix / PR#…) for trend/history filtering")
    .option("--db <path>", "database path", "./perf.db")
    .action((runId: string, label: string, opts: { db: string }) => {
        const store = PerfStore.open(opts.db, logger.child("store"));
        try {
            if (!store.getRun(runId)) {
                process.stderr.write(`Run '${runId}' not found\n`);
                exit(ExitCode.configInvalid);
            }
            store.tagRun(runId, label);
            process.stdout.write(`Tagged ${runId} as '${label}'\n`);
            exit(ExitCode.ok);
        } finally {
            store.close();
        }
    });

const setup = program.command("setup").description("Machine setup");
setup
    .command("verify")
    .description("Run environment preflight (alias of doctor; §28 setup scripts install deps)")
    .action(() => {
        const report = runDoctor(logger.child("doctor"));
        process.stdout.write(formatDoctorReport(report) + "\n");
        process.stdout.write(
            "Full setup (installs missing dotnet tools with -Install): pwsh scripts/setup-windows.ps1\n",
        );
        exit(report.status === "failed" ? ExitCode.preflightFailed : ExitCode.ok);
    });

const baseline = program.command("baseline").description("Baseline management");
baseline
    .command("list")
    .description("List named baselines")
    .option("--db <path>", "database path", "./perf.db")
    .action((opts: { db: string }) => {
        const store = PerfStore.open(opts.db, logger.child("store"));
        try {
            const baselines = store.listBaselines();
            if (baselines.length === 0) {
                process.stdout.write(
                    "No named baselines. Rolling baselines: use --baseline rolling:N\n",
                );
            }
            for (const b of baselines) {
                process.stdout.write(
                    `${b.name.padEnd(20)} scenario=${b.scenarioId.padEnd(12)} run=${b.runId} env=${b.environmentHash.slice(0, 18)}…\n`,
                );
            }
            exit(ExitCode.ok);
        } finally {
            store.close();
        }
    });
baseline
    .command("set <name> <runId>")
    .description("Mark a run as a named baseline (bound to the run's environment hash)")
    .option("--db <path>", "database path", "./perf.db")
    .option("--scenario <id>", "restrict the baseline to one scenario")
    .option("--notes <text>", "free-form notes")
    .action(
        (name: string, runId: string, opts: { db: string; scenario?: string; notes?: string }) => {
            const store = PerfStore.open(opts.db, logger.child("store"));
            try {
                const { environmentHash } = store.setBaseline(name, runId, {
                    ...(opts.scenario !== undefined ? { scenarioId: opts.scenario } : {}),
                    ...(opts.notes !== undefined ? { notes: opts.notes } : {}),
                    createdBy: process.env["USERNAME"] ?? process.env["USER"] ?? "unknown",
                });
                process.stdout.write(
                    `Baseline '${name}' -> run ${runId} (environment ${environmentHash.slice(0, 18)}...)\n`,
                );
                exit(ExitCode.ok);
            } catch (error) {
                if (error instanceof CliExit) throw error;
                process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
                exit(ExitCode.configInvalid);
            } finally {
                store.close();
            }
        },
    );

program
    .command("cleanup")
    .description("Apply artifact retention: delete run directories older than a cutoff")
    .option("--older-than <duration>", "age cutoff like 30d, 12h", "30d")
    .option("--runs <dir>", "runs directory", "./perf-runs")
    .option("--db <path>", "database path", "./perf.db")
    .option("--keep-regressions", "never delete runs that were part of a regressed comparison")
    .option("--dry-run", "list what would be deleted without deleting")
    .action(
        async (opts: {
            olderThan: string;
            runs: string;
            db: string;
            keepRegressions?: boolean;
            dryRun?: boolean;
        }) => {
            const match = /^(\d+)([dh])$/.exec(opts.olderThan);
            if (!match) {
                process.stderr.write(
                    `Invalid --older-than '${opts.olderThan}' (use e.g. 30d or 12h)\n`,
                );
                exit(ExitCode.configInvalid);
            }
            const cutoffMs =
                Date.now() - Number(match[1]) * (match[2] === "d" ? 86_400_000 : 3_600_000);
            const runsDir = resolve(opts.runs);
            if (!existsSync(runsDir)) {
                process.stdout.write(`No runs directory at ${runsDir}\n`);
                exit(ExitCode.ok);
            }
            // Runs referenced by regressed comparisons are protected when asked.
            const protectedRuns = new Set<string>();
            if (opts.keepRegressions && existsSync(opts.db)) {
                const store = PerfStore.open(opts.db, logger.child("store"));
                for (const row of store.query<{ current_run_id: string; baseline_run_id: string }>(
                    "SELECT current_run_id, baseline_run_id FROM comparisons WHERE status = 'regressed'",
                )) {
                    protectedRuns.add(row.current_run_id);
                    protectedRuns.add(row.baseline_run_id);
                }
                store.close();
            }
            const { readdirSync, statSync, rmSync } = await import("node:fs");
            let deleted = 0;
            let kept = 0;
            for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
                if (!entry.isDirectory()) continue;
                const full = join(runsDir, entry.name);
                const age = statSync(full).mtimeMs;
                if (age >= cutoffMs) {
                    kept++;
                    continue;
                }
                if (protectedRuns.has(entry.name)) {
                    process.stdout.write(`keep (regression): ${entry.name}\n`);
                    kept++;
                    continue;
                }
                if (opts.dryRun) {
                    process.stdout.write(`would delete: ${entry.name}\n`);
                } else {
                    rmSync(full, { recursive: true, force: true });
                    logger.info("cleanup.deleted", entry.name);
                    process.stdout.write(`deleted: ${entry.name}\n`);
                }
                deleted++;
            }
            process.stdout.write(
                `${opts.dryRun ? "Would delete" : "Deleted"} ${deleted} run dir(s), kept ${kept}.\n`,
            );
            exit(ExitCode.ok);
        },
    );

// ---------------------------------------------------------------------------
// push — publish run directories to the central store (design C1)
// ---------------------------------------------------------------------------
program
    .command("push [runId]")
    .description("Publish perf run(s) from run directories to the central SQL Server store")
    .option("--runs-dir <path>", "runs directory", "./perf-runs")
    .option("--all-new", "push every run directory (unchanged runs land as alreadyPresent)")
    .option("--dry-run", "print the exact upload preview without connecting or uploading")
    .option("--policy <id>", "upload policy id", "ci-official.v1")
    .option("--ci", "record the upload under the CI principal")
    .option(
        "--target <connstring>",
        "SQL auth connection string (else MSSQL_PERFTEST_CENTRAL_CONNSTRING)",
    )
    .action(
        async (
            runId: string | undefined,
            opts: {
                runsDir: string;
                allNew?: boolean;
                dryRun?: boolean;
                policy: string;
                ci?: boolean;
                target?: string;
            },
        ) => {
            const { runPush } = await import("./central/push");
            const write = (line: string) => process.stdout.write(line + "\n");
            const pushLogger = logger.child("push");
            if (!runId && !opts.allNew) {
                process.stderr.write("push: pass a runId or --all-new\n");
                exit(ExitCode.pushFailed);
            }
            const baseOptions = {
                runsDir: opts.runsDir,
                allNew: opts.allNew ?? false,
                dryRun: opts.dryRun ?? false,
                policy: opts.policy,
                ci: opts.ci ?? false,
                ...(runId !== undefined ? { runId } : {}),
            };
            if (baseOptions.dryRun) {
                try {
                    const outcome = await runPush(baseOptions, undefined, pushLogger, write);
                    exit(outcome.failed > 0 ? ExitCode.pushFailed : ExitCode.ok);
                } catch (error) {
                    if (error instanceof CliExit) throw error;
                    process.stderr.write(`push: ${(error as Error).message}\n`);
                    exit(ExitCode.pushFailed);
                }
            }
            await withCentral(opts.target, async (client) => {
                const outcome = await runPush(baseOptions, client, pushLogger, write);
                return outcome.failed > 0 || outcome.refused > 0
                    ? ExitCode.pushFailed
                    : ExitCode.ok;
            });
        },
    );

// ---------------------------------------------------------------------------
// central — shared SQL Server observability store (design C0.7/C1)
// ---------------------------------------------------------------------------
const central = program
    .command("central")
    .description("Central observability store administration (shared SQL Server)");

async function withCentral(
    explicitTarget: string | undefined,
    action: (client: import("./central/centralClient").CentralClient) => Promise<number>,
): Promise<void> {
    const { CentralClient, CentralClientError, resolveCentralTarget } = await import(
        "./central/centralClient"
    );
    let client: import("./central/centralClient").CentralClient | undefined;
    let code: number = ExitCode.pushFailed;
    try {
        const target = resolveCentralTarget(explicitTarget);
        client = await CentralClient.connect(target);
        code = await action(client);
    } catch (error) {
        if (error instanceof CliExit) throw error;
        if (error instanceof CentralClientError) {
            process.stderr.write(`central: ${error.message}\n`);
        } else {
            process.stderr.write(`central: ${(error as Error).message}\n`);
        }
        code = ExitCode.pushFailed;
    } finally {
        await client?.close();
    }
    exit(code);
}

central
    .command("init")
    .description("Create/upgrade the central store objects (idempotent, contract-owned DDL)")
    .option(
        "--target <connstring>",
        "SQL auth connection string (else MSSQL_PERFTEST_CENTRAL_CONNSTRING)",
    )
    .action(async (opts: { target?: string }) => {
        await withCentral(opts.target, async (client) => {
            const { centralInit } = await import("./central/centralAdmin");
            await centralInit(client, logger.child("central"));
            process.stdout.write(
                `Central store initialized (${client.target.database} on ${client.target.server}).\n`,
            );
            return ExitCode.ok;
        });
    });

central
    .command("check")
    .description(
        "Validate the central store: schema/contract/vocabulary versions, procs, views, health",
    )
    .option(
        "--target <connstring>",
        "SQL auth connection string (else MSSQL_PERFTEST_CENTRAL_CONNSTRING)",
    )
    .action(async (opts: { target?: string }) => {
        await withCentral(opts.target, async (client) => {
            const { centralCheck } = await import("./central/centralAdmin");
            const result = await centralCheck(client);
            for (const issue of result.issues) {
                process.stdout.write(`ISSUE: ${issue}\n`);
            }
            process.stdout.write(
                `central check ${result.ok ? "OK" : `FAILED (${result.issues.length} issue(s))`}\n` +
                    `health: ${JSON.stringify(result.facts)}\n`,
            );
            return result.ok ? ExitCode.ok : ExitCode.pushFailed;
        });
    });

central
    .command("health")
    .description("Print central.usp_store_health facts")
    .option(
        "--target <connstring>",
        "SQL auth connection string (else MSSQL_PERFTEST_CENTRAL_CONNSTRING)",
    )
    .action(async (opts: { target?: string }) => {
        await withCentral(opts.target, async (client) => {
            const health = await client.storeHealth();
            process.stdout.write(JSON.stringify(health, null, 2) + "\n");
            return ExitCode.ok;
        });
    });

central
    .command("report")
    .description("Render a static HTML report over the central store (canned views only)")
    .option("--out <path>", "output file", "./central-report.html")
    .option(
        "--target <connstring>",
        "SQL auth connection string (else MSSQL_PERFTEST_CENTRAL_CONNSTRING)",
    )
    .action(async (opts: { out: string; target?: string }) => {
        await withCentral(opts.target, async (client) => {
            const { renderCentralReport } = await import("./central/centralReport");
            await renderCentralReport(client, opts.out);
            process.stdout.write(`Central report written to ${opts.out}` + String.fromCharCode(10));
            return ExitCode.ok;
        });
    });

central
    .command("cleanup")
    .description("Run central retention: TTL lanes, orphan sweep, abandoned promotion")
    .option(
        "--target <connstring>",
        "SQL auth connection string (else MSSQL_PERFTEST_CENTRAL_CONNSTRING)",
    )
    .action(async (opts: { target?: string }) => {
        await withCentral(opts.target, async (client) => {
            const result = await client.retentionCleanup();
            process.stdout.write(JSON.stringify(result) + "\n");
            return ExitCode.ok;
        });
    });

program
    .parseAsync(process.argv)
    .then(() => {
        process.exitCode ??= ExitCode.ok;
    })
    .catch((error: unknown) => {
        if (error instanceof CliExit) {
            process.exitCode = error.code;
        } else {
            logger.error("cli.unhandled", error instanceof Error ? error.stack : String(error));
            process.exitCode = ExitCode.infrastructureFailure;
        }
    })
    .finally(() => sink.close());
