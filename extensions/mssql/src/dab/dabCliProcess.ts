/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Runs the Data API builder engine as a local process.
 *
 * The engine is spawned detached so a deployment behaves like a Docker
 * container: it keeps serving after the VS Code window closes, and the
 * deployments list finds it again next session.
 *
 * The connection string is passed in the process environment rather than
 * written into the config file, and the port is set through ASPNETCORE_URLS
 * because `dab start` has no port option.
 */

import { ChildProcess, spawn } from "child_process";
import { LocalContainers } from "../constants/locConstants";
import { Dab } from "../sharedInterfaces/dab";
import { getErrorMessage } from "../utils/utils";
import { dockerLogger } from "../docker/dockerUtils";

/** How much engine output to keep for diagnosing a failed start. */
const MAX_ENGINE_LOG_CHARS = 256_000;

/** How long to wait for the engine to answer before giving up. */
const ENGINE_READY_TIMEOUT_MS = 60_000;
const ENGINE_READY_POLL_INTERVAL_MS = 1000;

/** Result of launching or checking the engine. */
export interface DabCliCommandResult {
    success: boolean;
    error?: string;
    fullErrorText?: string;
    /** Engine output captured while the command ran. */
    engineLogs?: string;
    /** Process id of a successfully launched engine. */
    processId?: number;
}

/** Environment a DAB engine process runs with. */
export interface DabCliProcessEnvironment {
    /** Port the engine publishes on, applied through ASPNETCORE_URLS. */
    port: number;
    /** Connection string, resolved by the config's @env reference. */
    connectionString: string;
}

/**
 * Builds the engine's environment. The connection string is deliberately the
 * only place the credential appears, so it never reaches the config file.
 */
export function buildDabCliEnvironment(environment: DabCliProcessEnvironment): NodeJS.ProcessEnv {
    return {
        ...process.env,
        ASPNETCORE_URLS: `http://localhost:${environment.port}`,
        [Dab.DAB_CLI_CONNECTION_STRING_ENV_VAR]: environment.connectionString,
    };
}

/** Collects a process's stdout and stderr, capped so a chatty engine cannot grow without bound. */
function collectProcessOutput(child: ChildProcess): () => string {
    let output = "";
    const append = (chunk: Buffer | string) => {
        output += chunk.toString();
        if (output.length > MAX_ENGINE_LOG_CHARS) {
            output = output.slice(output.length - MAX_ENGINE_LOG_CHARS);
        }
    };

    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    return () => output;
}

/**
 * Runs a DAB CLI command to completion and returns its output.
 * Used for short-lived commands such as `validate`, never for `start`.
 *
 * @param dotnetPath Path of the dotnet executable to run the CLI assembly with
 * @param assemblyPath Path of the CLI assembly
 * @param args Arguments to pass to the CLI
 * @param environment Port and connection string for the process
 */
export async function runDabCliCommand(
    dotnetPath: string,
    assemblyPath: string,
    args: string[],
    environment: DabCliProcessEnvironment,
): Promise<DabCliCommandResult> {
    return new Promise<DabCliCommandResult>((resolve) => {
        let child: ChildProcess;
        try {
            child = spawn(dotnetPath, [assemblyPath, ...args], {
                env: buildDabCliEnvironment(environment),
                windowsHide: true,
            });
        } catch (error) {
            resolve({ success: false, error: getErrorMessage(error) });
            return;
        }

        const getOutput = collectProcessOutput(child);

        child.on("error", (error) => {
            resolve({ success: false, error: getErrorMessage(error), engineLogs: getOutput() });
        });

        child.on("close", (code) => {
            const engineLogs = getOutput().trim() || undefined;
            resolve(
                code === 0
                    ? { success: true, engineLogs }
                    : {
                          success: false,
                          error: LocalContainers.dabCliExitedWithCode(code),
                          fullErrorText: engineLogs,
                          engineLogs,
                      },
            );
        });
    });
}

/**
 * Launches the engine and leaves it running.
 *
 * The child is detached and unref'd so it outlives this window. Its output is
 * still piped while the window lives, which is what makes a failed start
 * diagnosable; once the parent exits the pipes close and the engine keeps
 * running with its output discarded.
 *
 * @param dotnetPath Path of the dotnet executable to run the CLI assembly with
 * @param assemblyPath Path of the CLI assembly
 * @param configPath Path of the generated DAB config file
 * @param environment Port and connection string for the process
 */
export async function startDabCliEngine(
    dotnetPath: string,
    assemblyPath: string,
    configPath: string,
    environment: DabCliProcessEnvironment,
): Promise<DabCliCommandResult & { getLogs?: () => string }> {
    try {
        const child = spawn(
            dotnetPath,
            [assemblyPath, "start", "--config", configPath, "--no-https-redirect"],
            {
                env: buildDabCliEnvironment(environment),
                detached: true,
                windowsHide: true,
                stdio: ["ignore", "pipe", "pipe"],
            },
        );

        const getLogs = collectProcessOutput(child);

        if (!child.pid) {
            return { success: false, error: LocalContainers.dabCliEngineDidNotStart };
        }

        // Let the engine outlive this extension host.
        child.unref();

        dockerLogger.info(
            `DAB engine started (pid ${child.pid}) on port ${environment.port} with config ${configPath}`,
        );

        return { success: true, processId: child.pid, getLogs };
    } catch (error) {
        dockerLogger.error(`Failed to start the DAB engine: ${getErrorMessage(error)}`);
        return { success: false, error: getErrorMessage(error) };
    }
}

/**
 * Polls the engine's port until it answers.
 *
 * @param port Port the engine publishes on
 * @param getLogs Optional accessor for engine output, included on failure
 */
export async function checkDabCliEngineReady(
    port: number,
    getLogs?: () => string,
): Promise<DabCliCommandResult> {
    const start = Date.now();

    while (Date.now() - start < ENGINE_READY_TIMEOUT_MS) {
        if (await isDabCliEngineResponding(port)) {
            return { success: true };
        }

        await new Promise((resolve) => setTimeout(resolve, ENGINE_READY_POLL_INTERVAL_MS));
    }

    const engineLogs = getLogs?.().trim() || undefined;
    return {
        success: false,
        error: LocalContainers.dabCliEngineReadyTimeout,
        fullErrorText: engineLogs,
        engineLogs,
    };
}

/**
 * Reports whether something is answering DAB requests on the port.
 *
 * Status is resolved from the port rather than a stored process id: a pid can
 * be reused by an unrelated process, but an answer on the port is the thing
 * callers actually care about.
 *
 * @param port Port to probe
 */
export async function isDabCliEngineResponding(port: number): Promise<boolean> {
    try {
        const response = await fetch(`http://localhost:${port}/`, {
            method: "GET",
            signal: AbortSignal.timeout(5000),
        });

        // Any answer in this range means the engine is up; DAB returns a range
        // of status codes for the root path depending on configuration.
        return response.status >= 200 && response.status < 500;
    } catch {
        return false;
    }
}

/**
 * Stops a running engine.
 *
 * The engine is spawned detached, so on POSIX it leads its own process group
 * and the whole group is signalled; on Windows the process tree is killed
 * through taskkill, since dotnet may have started child processes.
 *
 * @param processId Process id recorded when the engine was started
 */
export async function stopDabCliEngine(processId: number): Promise<DabCliCommandResult> {
    try {
        if (process.platform === "win32") {
            await new Promise<void>((resolve, reject) => {
                const taskkill = spawn("taskkill", ["/PID", `${processId}`, "/T", "/F"], {
                    windowsHide: true,
                });
                taskkill.on("error", reject);
                // A process that is already gone is a success for the caller.
                taskkill.on("close", () => resolve());
            });
        } else {
            process.kill(-processId, "SIGTERM");
        }

        dockerLogger.info(`DAB engine (pid ${processId}) stopped.`);
        return { success: true };
    } catch (error) {
        // ESRCH means the process was already gone, which is the desired state.
        if ((error as NodeJS.ErrnoException)?.code === "ESRCH") {
            return { success: true };
        }

        dockerLogger.error(`Failed to stop the DAB engine: ${getErrorMessage(error)}`);
        return { success: false, error: getErrorMessage(error) };
    }
}
