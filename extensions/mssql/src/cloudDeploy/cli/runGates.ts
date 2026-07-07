/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy CLI — `run-gates` entry point and composition root.
 *
 * Proves the validation engine runs OUTSIDE the VS Code extension host: it
 * wires the same `Runner` + `createDefaultRegistry` + `RunArtifactWriter` the
 * extension uses — but with a headless `NodeDiagnosticEventBus`, a Node
 * environment loader, and plain Node file/process providers — and produces a
 * standard `.cdrun.zip` from a bare `node` process. No `vscode`, no
 * `ConnectionManager`, no webview.
 *
 * Current scope: all four validators. The runner is wired with the full
 * `RunnerRuntimeDeps` — the reused `DockerEphemeralDatabaseProvider` (driven by
 * the headless `NodeMssqlEphemeralConnector`), the data generator, and the
 * schema hasher — so it provisions a throwaway SQL container, runs connectivity
 * / unit-tests / workload against it, and tears it down, all outside VS Code.
 * Static-analysis-only envs still work (no container is stood up when no
 * runtime validator is enabled).
 *
 * When `--baseline` is given, the produced run is diffed against a prior
 * `.cdrun.zip` via `compareRuns`; when `--report-out` is given, a Markdown
 * pull-request comment is written for the workflow to post. Both are optional.
 *
 * The impure edges (file I/O, subprocesses, env loading, the run itself) are
 * injected through `RunGatesDeps` so the orchestration — load, run, write,
 * optionally diff + report, derive an exit code — is unit-testable without
 * Docker or `dotnet`. Production uses `liveDeps()`; the real registry/runner
 * composition is exercised by the end-to-end keystone proof.
 */

import * as path from "path";

import { buildPrReport } from "../ci/prReporter";
import { DiagnosticEvent } from "../diagnostics/types";
import { NodeDiagnosticEventBus } from "../diagnostics/nodeEventBus";
import { Environment, EnvironmentsFile, ValidationType } from "../environments/types";
import {
    EnvironmentNotFoundError,
    loadEnvironmentsFromPath,
    resolveEnvironment,
} from "../environments/environmentLoader";
import { EnvironmentsFileParseError } from "../environments/environmentSchema";
import { LocalFileProvider, FileProvider, LocalSchemaSourceReader } from "../providers";
import { RunArtifactReader } from "../runs/runArtifactReader";
import { RunArtifactWriter } from "../runs/runArtifactWriter";
import { compareRuns, RunComparison } from "../runs/runComparison";
import { SchemaHasher } from "../runs/schemaHasher";
import {
    RunRecord,
    RunStatus,
    RunnerIdentity,
    ValidationResult,
    ValidationStatus,
    WorkloadObservedStep,
} from "../runs/types";
import { createDefaultRegistry } from "../validation/registry";
import { Runner } from "../validation/runner";
import { LiveArtifactProvider } from "../validation/providers/artifactProvider";
import { DockerEphemeralDatabaseProvider } from "../validation/providers/ephemeralDatabaseProvider";
import { DispatchingEphemeralDatabaseProvider } from "../validation/providers/dispatchingEphemeralDatabaseProvider";
import { LiveProcessProvider } from "../validation/providers/processProvider";
import { LiveDataGenerator } from "../validation/dataGenerator";
import { NodeMssqlEphemeralConnector } from "../host/nodeMssqlConnection";
import { CliUsageError, parseCliArgs, USAGE } from "./args";

/** Runner identity stamped on a CLI-produced run record. */
const CLI_RUNNER_IDENTITY: RunnerIdentity = {
    userId: "cloud-deploy-cli",
    displayName: "Cloud Deploy CLI",
    hostKind: "github-actions",
};

/**
 * Resolves the workload performance baseline for a run: given the candidate
 * run's own schema hash, returns the measured workload steps to compare against
 * (or `undefined` for no comparison). The runner calls this while dispatching.
 */
export type WorkloadBaselineLookup = (
    envId: string,
    currentSourceVersionHash: string | undefined,
) => Promise<readonly WorkloadObservedStep[] | undefined>;

/** The impure edges of `runGates`, injected so the orchestration is testable. */
export interface RunGatesDeps {
    /** Backs the run-artifact writer (and the artifact provider in `liveDeps`). */
    readonly fileProvider: FileProvider;
    /** Reads + validates the environments file. */
    loadEnvironments(absPath: string): Promise<EnvironmentsFile>;
    /**
     * Runs every enabled validation for `env` and returns the produced record.
     * When `workloadBaselineLookup` is provided, the workload validator compares
     * its fresh measurements against that baseline.
     */
    runValidation(
        env: Environment,
        bus: NodeDiagnosticEventBus,
        workspaceRoot: string,
        workloadBaselineLookup?: WorkloadBaselineLookup,
    ): Promise<RunRecord>;
    /** Loads a previously-written run artifact to diff the new run against. */
    loadRunArtifact(absPath: string): Promise<RunRecord>;
}

/** Streams `runGates` writes to. Injected so tests capture output. */
export interface RunGatesIo {
    readonly out: NodeJS.WritableStream;
    readonly err: NodeJS.WritableStream;
}

/**
 * Parses args, loads the environment, runs its gates headlessly, writes the
 * `.cdrun.zip`, and returns a process exit code (see `USAGE`). Never throws for
 * an expected failure — every error path maps to a code and a printed message.
 */
export async function runGates(
    argv: readonly string[],
    deps: RunGatesDeps = liveDeps(),
    io: RunGatesIo = { out: process.stdout, err: process.stderr },
): Promise<number> {
    let args;
    try {
        args = parseCliArgs(argv);
    } catch (err) {
        if (err instanceof CliUsageError) {
            if (err.isHelp) {
                io.out.write(`${USAGE}\n`);
                return 0;
            }
            io.err.write(`error: ${err.message}\n\n${USAGE}\n`);
            return 2;
        }
        throw err;
    }

    try {
        const configPath = path.resolve(args.configPath);
        const workspaceRoot = args.workspaceRoot ?? deriveWorkspaceRoot(configPath);

        const file = await deps.loadEnvironments(configPath);
        const env = resolveEnvironment(file, args.envId);

        const bus = new NodeDiagnosticEventBus();
        bus.on((event) => printProgress(event, io.err));

        // Load the baseline (when requested) BEFORE the run so its workload
        // measurements can seed the candidate run's comparison — the same
        // run-based baseline the local run store provides. Best-effort: a
        // missing / unreadable baseline just skips the comparison and the diff.
        const baseline = await loadBaselineBestEffort(args.baselinePath, deps);

        const record = stampSourceLabels(
            await deps.runValidation(
                env,
                bus,
                workspaceRoot,
                baseline !== undefined ? makeCliWorkloadBaselineLookup(baseline) : undefined,
            ),
            args.sourceCommit,
            args.sourceRef,
        );

        const outPath = path.resolve(args.outPath);
        const writer = new RunArtifactWriter(deps.fileProvider, bus);
        const { sizeBytes } = await writer.write(record, toAsyncIterable(bus.drain()), outPath);

        printSummary(record, outPath, sizeBytes, io.out);

        const comparison =
            baseline !== undefined ? compareAndPrintBaseline(baseline, record, io.out) : undefined;
        await maybeWriteReport(args.reportOut, record, comparison, deps, io.out);

        return exitCodeFor(record.status);
    } catch (err) {
        if (err instanceof EnvironmentsFileParseError || err instanceof EnvironmentNotFoundError) {
            io.err.write(`error: ${err.message}\n`);
            return 2;
        }
        io.err.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
        return 1;
    }
}

/** Maps a run's aggregate status to a process exit code. */
export function exitCodeFor(status: RunStatus): number {
    switch (status) {
        case RunStatus.Failed:
        case RunStatus.Errored:
            return 1;
        case RunStatus.Cancelled:
            return 130;
        default:
            return 0;
    }
}

/**
 * Stamps git source labels (commit id / ref) onto the run record's source
 * version. The runner fingerprints the schema content (the `hash`); CI adds the
 * friendlier git labels for that same content. A no-op when no label is given
 * or the run produced no source version.
 */
export function stampSourceLabels(
    record: RunRecord,
    commitId: string | undefined,
    ref: string | undefined,
): RunRecord {
    if (record.sourceVersion === undefined || (commitId === undefined && ref === undefined)) {
        return record;
    }
    return {
        ...record,
        sourceVersion: {
            ...record.sourceVersion,
            ...(commitId !== undefined ? { commitId } : {}),
            ...(ref !== undefined ? { ref } : {}),
        },
    };
}

/**
 * Loads the baseline artifact when one was requested. Best-effort: a missing or
 * unreadable baseline yields `undefined` so the candidate run still validates
 * (the workload comparison and the diff are simply skipped).
 */
async function loadBaselineBestEffort(
    baselinePath: string | undefined,
    deps: RunGatesDeps,
): Promise<RunRecord | undefined> {
    if (baselinePath === undefined) {
        return undefined;
    }
    try {
        return await deps.loadRunArtifact(path.resolve(baselinePath));
    } catch {
        return undefined;
    }
}

/** Diffs the new run against the pre-loaded baseline and prints a per-gate summary. */
function compareAndPrintBaseline(
    baseline: RunRecord,
    record: RunRecord,
    out: NodeJS.WritableStream,
): RunComparison {
    const comparison = compareRuns(baseline, record);
    printComparison(comparison, out);
    return comparison;
}

/**
 * Extracts the workload validator's recorded per-step metrics from a run, if it
 * ran one — used to seed the next run's performance comparison.
 */
function extractWorkloadObservedSteps(
    record: RunRecord,
): readonly WorkloadObservedStep[] | undefined {
    for (const validation of record.validations) {
        if (validation.payload.validationType === ValidationType.WorkloadPlayback) {
            return validation.payload.observedSteps;
        }
    }
    return undefined;
}

/**
 * Builds the workload baseline lookup the runner calls with the candidate run's
 * own schema hash. Feeds the baseline run's measured steps ONLY when the two
 * runs validated a different schema — mirroring the local run-store selector, so
 * a same-schema PR compares nothing (identical plans / reads would be noise).
 */
function makeCliWorkloadBaselineLookup(baseline: RunRecord): WorkloadBaselineLookup {
    return (_envId, currentSourceVersionHash) => {
        const baselineHash = baseline.sourceVersion?.hash;
        if (
            baselineHash === undefined ||
            currentSourceVersionHash === undefined ||
            baselineHash === currentSourceVersionHash
        ) {
            return Promise.resolve(undefined);
        }
        return Promise.resolve(extractWorkloadObservedSteps(baseline));
    };
}

/**
 * Writes the PR-comment Markdown report (when `--report-out` was given) so the
 * workflow can post it on the pull request.
 */
async function maybeWriteReport(
    reportOut: string | undefined,
    record: RunRecord,
    comparison: RunComparison | undefined,
    deps: RunGatesDeps,
    out: NodeJS.WritableStream,
): Promise<void> {
    if (reportOut === undefined) {
        return;
    }
    const report = buildPrReport(record, comparison);
    const reportPath = path.resolve(reportOut);
    await deps.fileProvider.writeFileAtomic(reportPath, Buffer.from(report.commentBody, "utf8"));
    out.write(`Report: ${reportPath}\n`);
}

/**
 * Production dependencies: real Node file/process providers and the full live
 * registry/runner composition. The runner is wired with
 * `RunnerRuntimeDeps` — the reused `DockerEphemeralDatabaseProvider` driven by
 * the headless `NodeMssqlEphemeralConnector`, plus the data generator and
 * schema hasher — so runtime validators run against a throwaway SQL container.
 * The runner stands a container up only when a runtime validator is enabled, so
 * static-analysis-only envs incur no Docker dependency.
 */
function liveDeps(): RunGatesDeps {
    const fileProvider = new LocalFileProvider();
    return {
        fileProvider,
        loadEnvironments: loadEnvironmentsFromPath,
        loadRunArtifact: (absPath) => new RunArtifactReader(fileProvider).read(absPath),
        runValidation: (env, bus, workspaceRoot, workloadBaselineLookup) => {
            const processes = new LiveProcessProvider(workspaceRoot);
            const artifact = new LiveArtifactProvider(fileProvider, workspaceRoot);
            const registry = createDefaultRegistry({ process: processes, artifact });
            const ephemeralProvider = new DispatchingEphemeralDatabaseProvider({
                docker: new DockerEphemeralDatabaseProvider(
                    processes,
                    new NodeMssqlEphemeralConnector(),
                    { workspaceRoot },
                ),
            });
            const runner = new Runner(registry, bus, {
                ephemeralProvider,
                dataGenerator: new LiveDataGenerator(artifact),
                schemaHasher: new SchemaHasher(new LocalSchemaSourceReader(workspaceRoot)),
                ...(workloadBaselineLookup !== undefined ? { workloadBaselineLookup } : {}),
            });
            return runner.run(env, { runner: CLI_RUNNER_IDENTITY });
        },
    };
}

/** `<root>/.mssql/environments.json` → `<root>`. */
function deriveWorkspaceRoot(configPath: string): string {
    return path.dirname(path.dirname(configPath));
}

function printProgress(event: DiagnosticEvent, err: NodeJS.WritableStream): void {
    err.write(`  · ${event.type}\n`);
}

function printSummary(
    record: RunRecord,
    outPath: string,
    sizeBytes: number,
    out: NodeJS.WritableStream,
): void {
    const lines = record.validations.map(formatValidationSummary).join("\n");
    const sizeKb = (sizeBytes / 1024).toFixed(1);
    out.write(
        `\nRun ${record.status} — ${record.validations.length} validation(s)\n` +
            `${lines}${lines.length > 0 ? "\n" : ""}` +
            `Artifact: ${outPath} (${sizeKb} KB)\n`,
    );
}

/**
 * Renders one summary line per validation. For any validation that did not pass
 * or skip, the error message and finding messages are indented beneath it, so a
 * failing run (in a CI log) shows WHY without opening the artifact.
 */
function formatValidationSummary(v: ValidationResult): string {
    let line = `  ${v.displayName}: ${v.status}`;
    if (v.status === ValidationStatus.Passed || v.status === ValidationStatus.Skipped) {
        return line;
    }
    if (v.errorMessage !== undefined) {
        line += `\n      ${v.errorMessage}`;
    }
    for (const finding of v.payload.findings) {
        const message = (finding as { message?: unknown }).message;
        if (typeof message === "string") {
            line += `\n      ${message}`;
        }
    }
    return line;
}

function printComparison(comparison: RunComparison, out: NodeJS.WritableStream): void {
    out.write(`\nDiff vs baseline "${comparison.environmentNameA}":\n`);
    for (const delta of comparison.validations) {
        const base = delta.statusA ?? "absent";
        const candidate = delta.statusB ?? "absent";
        out.write(`  ${delta.displayName}: ${base} -> ${candidate}\n`);
    }
}

async function* toAsyncIterable<T>(items: readonly T[]): AsyncIterable<T> {
    for (const item of items) {
        yield item;
    }
}

if (require.main === module) {
    runGates(process.argv.slice(2))
        .then((code) => {
            process.exitCode = code;
        })
        .catch((err: unknown) => {
            process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
            process.exitCode = 1;
        });
}
