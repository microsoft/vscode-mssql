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
 * The impure edges (file I/O, subprocesses, env loading, the run itself) are
 * injected through `RunGatesDeps` so the orchestration — load, run, write,
 * derive an exit code — is unit-testable without Docker or `dotnet`. Production
 * uses `liveDeps()`; the real registry/runner composition is exercised by the
 * end-to-end keystone proof.
 */

import * as path from "path";

import { DiagnosticEvent } from "../diagnostics/types";
import { NodeDiagnosticEventBus } from "../diagnostics/nodeEventBus";
import { Environment, EnvironmentsFile } from "../environments/types";
import {
    EnvironmentNotFoundError,
    loadEnvironmentsFromPath,
    resolveEnvironment,
} from "../environments/environmentLoader";
import { EnvironmentsFileParseError } from "../environments/environmentSchema";
import { LocalFileProvider, FileProvider, LocalSchemaSourceReader } from "../providers";
import { RunArtifactWriter } from "../runs/runArtifactWriter";
import { SchemaHasher } from "../runs/schemaHasher";
import { RunRecord, RunStatus, RunnerIdentity } from "../runs/types";
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

/** The impure edges of `runGates`, injected so the orchestration is testable. */
export interface RunGatesDeps {
    /** Backs the run-artifact writer (and the artifact provider in `liveDeps`). */
    readonly fileProvider: FileProvider;
    /** Reads + validates the environments file. */
    loadEnvironments(absPath: string): Promise<EnvironmentsFile>;
    /** Runs every enabled validation for `env` and returns the produced record. */
    runValidation(
        env: Environment,
        bus: NodeDiagnosticEventBus,
        workspaceRoot: string,
    ): Promise<RunRecord>;
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

        const record = await deps.runValidation(env, bus, workspaceRoot);

        const outPath = path.resolve(args.outPath);
        const writer = new RunArtifactWriter(deps.fileProvider, bus);
        const { sizeBytes } = await writer.write(record, toAsyncIterable(bus.drain()), outPath);

        printSummary(record, outPath, sizeBytes, io.out);
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
        runValidation: (env, bus, workspaceRoot) => {
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
    const lines = record.validations.map((v) => `  ${v.displayName}: ${v.status}`).join("\n");
    const sizeKb = (sizeBytes / 1024).toFixed(1);
    out.write(
        `\nRun ${record.status} — ${record.validations.length} validation(s)\n` +
            `${lines}${lines.length > 0 ? "\n" : ""}` +
            `Artifact: ${outPath} (${sizeKb} KB)\n`,
    );
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
