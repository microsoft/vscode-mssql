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

/** How long a single readiness or status probe may take. */
const PROBE_TIMEOUT_MS = 5000;

/** How much of a probe response to read before deciding what answered. */
const MAX_PROBE_BODY_CHARS = 8192;

/** Paths a DAB engine serves a health response on, in the order they are tried. */
const DAB_HEALTH_PATHS = ["/", "/health"];

/** taskkill's exit code for a pid that no longer names a process. */
const TASKKILL_PROCESS_NOT_FOUND = 128;

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
 * @param processId Process id of the engine just launched, when one is known
 */
export async function checkDabCliEngineReady(
    port: number,
    getLogs?: () => string,
    processId?: number,
): Promise<DabCliCommandResult> {
    const start = Date.now();

    while (Date.now() - start < ENGINE_READY_TIMEOUT_MS) {
        if (await isDabCliEngineResponding(port, processId)) {
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
 * Reports whether this deployment's engine is answering on its port.
 *
 * An answer on its own proves nothing: any local service can hold the port and
 * reply with a 2xx-4xx, which would show a dead deployment as Running and
 * present endpoints that are not DAB. Whatever answered therefore has to
 * identify itself, either through DAB's health response or by being the process
 * this deployment launched.
 *
 * @param port Port to probe
 * @param processId Process id recorded for the deployment, when one is known
 */
export async function isDabCliEngineResponding(port: number, processId?: number): Promise<boolean> {
    const probe = await probeDabEndpoints(port);
    if (!probe.answered) {
        return false;
    }

    if (probe.isDab) {
        return true;
    }

    // DAB's health response has changed shape across versions, so a recorded
    // process that still holds the port is accepted as the other proof.
    return processId !== undefined && (await isRecordedEngineHoldingPort(port, processId));
}

/** What replied to a probe of the DAB endpoints on a port. */
interface DabEndpointProbe {
    /** Something answered HTTP. */
    answered: boolean;
    /** That something identified itself as a DAB engine. */
    isDab: boolean;
}

/**
 * Probes the paths a DAB engine answers on and reports what replied.
 *
 * DAB serves a health response on the root path and, on newer versions, a JSON
 * health report on /health; either tells DAB apart from an unrelated service
 * that happens to hold the port.
 *
 * @param port Port to probe
 */
async function probeDabEndpoints(port: number): Promise<DabEndpointProbe> {
    let answered = false;

    for (const probePath of DAB_HEALTH_PATHS) {
        const response = await fetchProbe(`http://localhost:${port}${probePath}`);
        if (!response) {
            continue;
        }

        answered = answered || (response.status >= 200 && response.status < 500);
        if (response.status >= 200 && response.status < 300 && isDabHealthBody(response.body)) {
            return { answered: true, isDab: true };
        }
    }

    return { answered, isDab: false };
}

/** Issues one probe request, reading a bounded amount of the response. */
async function fetchProbe(url: string): Promise<{ status: number; body: string } | undefined> {
    try {
        const response = await fetch(url, {
            method: "GET",
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        const body = await response.text();
        return { status: response.status, body: body.slice(0, MAX_PROBE_BODY_CHARS) };
    } catch {
        return undefined;
    }
}

/**
 * Recognises DAB's health responses: the plain "Healthy" the root path returns,
 * or the JSON health report newer versions serve.
 *
 * @param body Response body to inspect
 */
export function isDabHealthBody(body: string): boolean {
    const trimmed = body.trim();
    if (!trimmed) {
        return false;
    }

    if (/^"?healthy"?$/i.test(trimmed)) {
        return true;
    }

    try {
        const parsed: unknown = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== "object") {
            return false;
        }

        const report = parsed as Record<string, unknown>;
        if (!("status" in report)) {
            return false;
        }

        // The report names the product alongside its status; older shapes carry
        // only a version, which is still more than a bare status code.
        const appName = String(report["app-name"] ?? report["appName"] ?? "");
        return /dab|data api builder/i.test(appName) || "version" in report;
    } catch {
        return false;
    }
}

/**
 * Whether the recorded process is still the one serving this deployment.
 *
 * @param port Port the deployment publishes on
 * @param processId Process id recorded for the deployment
 */
async function isRecordedEngineHoldingPort(port: number, processId: number): Promise<boolean> {
    const ownership = await getPortOwnership(port, processId);
    if (ownership !== PortOwnership.Unknown) {
        return ownership === PortOwnership.Owned;
    }

    // Ownership could not be established, so fall back to the weaker signal.
    // Status is read-only, so trusting a live pid here costs nothing; the
    // destructive paths hold themselves to the stronger proof.
    return isProcessAlive(processId);
}

/** Whether the recorded process still holds a deployment's port. */
export enum PortOwnership {
    /** The recorded process is listening on the port. */
    Owned = "owned",
    /** Something else is, or nothing is. */
    Foreign = "foreign",
    /** Ownership could not be established on this machine. */
    Unknown = "unknown",
}

/**
 * Resolves whether a recorded process still holds a port.
 *
 * @param port Port to resolve the listener for
 * @param processId Process id the caller recorded
 */
export async function getPortOwnership(port: number, processId: number): Promise<PortOwnership> {
    const listeners = await getPortListenerPids(port);
    if (listeners === undefined) {
        return PortOwnership.Unknown;
    }

    return listeners.includes(processId) ? PortOwnership.Owned : PortOwnership.Foreign;
}

/**
 * Reads the process ids listening on a TCP port.
 *
 * Returns undefined when ownership cannot be established at all -- the platform
 * tool is missing or its output did not parse -- so callers can tell "the port
 * belongs to something else" apart from "this could not be checked".
 *
 * @param port Port to resolve the listener for
 */
export async function getPortListenerPids(port: number): Promise<number[] | undefined> {
    if (process.platform === "win32") {
        const output = await runCapturedCommand("netstat", ["-a", "-n", "-o", "-p", "tcp"]);
        return output === undefined ? undefined : parseNetstatListeners(output, port);
    }

    const lsofOutput = await runCapturedCommand("lsof", [
        "-nP",
        `-iTCP:${port}`,
        "-sTCP:LISTEN",
        "-t",
    ]);
    if (lsofOutput !== undefined) {
        return parsePidList(lsofOutput);
    }

    // Distributions that ship iproute2 rather than lsof still answer this.
    const ssOutput = await runCapturedCommand("ss", ["-ltnp"]);
    return ssOutput === undefined ? undefined : parseSsListeners(ssOutput, port);
}

/** Parses `lsof -t` output, which is one pid per line. */
export function parsePidList(output: string): number[] {
    const pids = new Set<number>();
    for (const line of output.split(/\r?\n/)) {
        const pid = Number(line.trim());
        if (Number.isInteger(pid) && pid > 0) {
            pids.add(pid);
        }
    }

    return [...pids];
}

/** Parses `netstat -ano -p tcp` rows: Proto, Local, Foreign, State, PID. */
export function parseNetstatListeners(output: string, port: number): number[] {
    const pids = new Set<number>();
    for (const line of output.split(/\r?\n/)) {
        const columns = line.trim().split(/\s+/);
        if (columns.length < 5 || columns[3].toUpperCase() !== "LISTENING") {
            continue;
        }

        // The local address is host:port, and the host half may be an IPv6
        // literal, so the port is whatever follows the last colon.
        const localAddress = columns[1];
        const localPort = Number(localAddress.slice(localAddress.lastIndexOf(":") + 1));
        const pid = Number(columns[4]);
        if (localPort === port && Number.isInteger(pid) && pid > 0) {
            pids.add(pid);
        }
    }

    return [...pids];
}

/** Parses `ss -ltnp` rows, whose process column reads users:(("dotnet",pid=123,fd=200)). */
export function parseSsListeners(output: string, port: number): number[] {
    const pids = new Set<number>();
    for (const line of output.split(/\r?\n/)) {
        const localAddress = line.trim().split(/\s+/)[3];
        if (!localAddress) {
            continue;
        }

        const localPort = Number(localAddress.slice(localAddress.lastIndexOf(":") + 1));
        if (localPort !== port) {
            continue;
        }

        for (const match of line.matchAll(/pid=(\d+)/g)) {
            const pid = Number(match[1]);
            if (Number.isInteger(pid) && pid > 0) {
                pids.add(pid);
            }
        }
    }

    return [...pids];
}

/** Runs a short-lived command and returns its stdout, or undefined when it could not run. */
async function runCapturedCommand(file: string, args: string[]): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
        let child: ChildProcess;
        try {
            child = spawn(file, args, { windowsHide: true });
        } catch {
            resolve(undefined);
            return;
        }

        let output = "";
        child.stdout?.on("data", (chunk: Buffer | string) => {
            output += chunk.toString();
        });
        // A missing tool surfaces here rather than as a throw from spawn.
        child.on("error", () => resolve(undefined));
        child.on("close", () => resolve(output));
    });
}

/**
 * Whether a pid still names a live process. Signal 0 runs the kernel's
 * permission and existence checks without delivering anything.
 *
 * @param processId Process id to test
 */
export function isProcessAlive(processId: number): boolean {
    try {
        process.kill(processId, 0);
        return true;
    } catch (error) {
        // EPERM means the process exists but belongs to someone else.
        return (error as NodeJS.ErrnoException)?.code === "EPERM";
    }
}

/**
 * Stops a running engine.
 *
 * The recorded pid is only signalled once it is confirmed to still hold the
 * deployment's port. A pid outlives the process it named -- the number is
 * handed out again -- so signalling it blind can kill something unrelated, and
 * `taskkill /F` gives that no chance to shut down cleanly.
 *
 * The engine is spawned detached, so on POSIX it leads its own process group
 * and the whole group is signalled; on Windows the process tree is killed
 * through taskkill, since dotnet may have started child processes.
 *
 * @param processId Process id recorded when the engine was started
 * @param port Port the deployment publishes on, used to confirm the pid
 */
export async function stopDabCliEngine(
    processId: number,
    port: number,
): Promise<DabCliCommandResult> {
    const ownership = await getPortOwnership(port, processId);
    if (ownership === PortOwnership.Foreign) {
        // The engine has already exited; whatever holds that pid now is not
        // this deployment's, so there is nothing here to stop.
        dockerLogger.info(
            `DAB engine (pid ${processId}) no longer holds port ${port}; nothing to stop.`,
        );
        return { success: true };
    }

    if (ownership === PortOwnership.Unknown) {
        // Nothing on this machine can name the port's owner, so the evidence
        // has to come from the port itself: signal the pid only while a DAB
        // engine is actually serving there and the pid still names a process.
        // Failing that, there is nothing of ours to stop, and a pid the system
        // has since handed to someone else is left alone.
        if (!isProcessAlive(processId) || !(await isDabCliEngineResponding(port))) {
            dockerLogger.info(
                `DAB engine (pid ${processId}) could not be confirmed on port ${port}; nothing to stop.`,
            );
            return { success: true };
        }
    }

    try {
        if (process.platform === "win32") {
            await new Promise<void>((resolve, reject) => {
                const taskkill = spawn("taskkill", ["/PID", `${processId}`, "/T", "/F"], {
                    windowsHide: true,
                });

                let output = "";
                taskkill.stdout?.on("data", (chunk: Buffer | string) => {
                    output += chunk.toString();
                });
                taskkill.stderr?.on("data", (chunk: Buffer | string) => {
                    output += chunk.toString();
                });

                taskkill.on("error", reject);
                taskkill.on("close", (code) => {
                    // Anything but success or "no such process" left the engine
                    // running, and reporting otherwise would have the caller
                    // drop the record while the engine still serves.
                    if (code === 0 || code === TASKKILL_PROCESS_NOT_FOUND) {
                        resolve();
                        return;
                    }

                    reject(
                        new Error(
                            `taskkill exited with code ${code}${output.trim() ? `: ${output.trim()}` : ""}`,
                        ),
                    );
                });
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
