/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — `ProcessProvider` abstraction.
 *
 * Host-agnostic seam for "spawn a subprocess, feed it args, capture stdout
 * and stderr, get an exit code, forward an `AbortSignal` to kill it."
 * Validators that shell out to external CLIs (`StaticAnalysisValidator` runs
 * `sqlpackage`, `WorkloadPlaybackValidator` runs the replay tool) take a
 * `ProcessProvider` by injection so unit tests can drive them with
 * `FakeProcessProvider` and production wires up `LiveProcessProvider`.
 *
 * The contract is deliberately small: one `spawn()` method, no streaming
 * stdout API, no interactive stdin past the initial buffer. If a future
 * validator needs streaming or richer IPC, that's a wider abstraction —
 * not a change to this surface.
 *
 * Cancellation is `AbortSignal`-based to match the rest of D2 (the runner,
 * the connection provider, every validator). On abort, `LiveProcessProvider`
 * sends `SIGTERM`, then `SIGKILL` after a short grace window. The resulting
 * `ProcessResult.exitCode` is `null` when the child was killed by signal;
 * `ProcessResult.signal` carries the signal name in that case.
 */

import { ChildProcess, spawn as nodeSpawn, type SpawnOptionsWithoutStdio } from "child_process";
import * as path from "path";

// =============================================================================
// Public types
// =============================================================================

/**
 * Options for a single `spawn()` call. `signal` is required because every
 * call site already has one from the runner; making it optional would
 * encourage validators to skip cancellation plumbing.
 */
export interface ProcessSpawnOptions {
    /** Working directory. Defaults to the parent process's `cwd`. */
    readonly cwd?: string;
    /**
     * Environment variables. When provided, replaces (does not merge with)
     * the parent's `process.env`. Callers that want to inherit should spread
     * `process.env` themselves so the inheritance is explicit at the call site.
     */
    readonly env?: Record<string, string>;
    /** Cancellation signal. Required. */
    readonly signal: AbortSignal;
    /** Optional stdin payload. Written once at spawn, then closed. */
    readonly stdin?: string;
    /**
     * Hard cap on the captured stdout / stderr byte count (each stream
     * counted independently). When the cap is reached, further bytes are
     * dropped and a `[output truncated]` marker is appended to the captured
     * string. Defaults to 5 MiB.
     */
    readonly maxOutputBytes?: number;
}

/**
 * Outcome of a single `spawn()` call. `exitCode` is `null` when the child
 * was terminated by a signal (in which case `signal` carries the signal
 * name); otherwise it's the numeric exit code from the OS.
 */
export interface ProcessResult {
    readonly exitCode: number | null;
    readonly stdout: string;
    readonly stderr: string;
    /**
     * Set when the child was terminated by signal (e.g. `"SIGTERM"` after an
     * abort). Mutually exclusive with a numeric `exitCode` in practice.
     */
    readonly signal?: NodeJS.Signals;
    /** True when the abort signal fired before the child exited naturally. */
    readonly aborted: boolean;
    /** True when at least one of stdout / stderr hit the byte cap. */
    readonly truncated: boolean;
}

/**
 * Provider interface. One method, one promise.
 */
export interface ProcessProvider {
    spawn(
        command: string,
        args: readonly string[],
        opts: ProcessSpawnOptions,
    ): Promise<ProcessResult>;
}

// =============================================================================
// LiveProcessProvider
// =============================================================================

const DEFAULT_MAX_OUTPUT_BYTES = 5 * 1024 * 1024; // 5 MiB per stream
const SIGKILL_GRACE_MS = 250; // SIGTERM → SIGKILL grace window after abort

/**
 * Real implementation backed by Node's `child_process.spawn`. Binaries
 * (`.exe` and bare PATH names) are spawned with `shell: false` — `command`
 * is resolved exactly as given, no shell quoting, no PATHEXT magic. Callers
 * are responsible for resolving the binary path (the service layer wires up
 * `sqlpackage` discovery; this provider doesn't try to be clever).
 *
 * The one exception is Windows batch scripts (`.bat` / `.cmd`): Node ≥20
 * refuses to spawn them with `shell: false` (`spawn EINVAL`, the
 * CVE-2024-27980 hardening), so for those — and only those — this provider
 * spawns through the shell with the command path quoted. Everything else
 * stays `shell: false`.
 *
 * When `opts.cwd` is omitted, spawns default to `_defaultCwd` (the workspace
 * root, when one is open) so relative commands and relative artifact paths in
 * `environments.json` resolve against the workspace rather than the
 * extension-host process cwd.
 * A `command` that looks like a relative path (contains a separator) is
 * resolved to an absolute, native-separator path against that same base
 * before spawning. Node does not resolve a relative executable against
 * `opts.cwd`, and `cmd.exe` would parse the forward slashes in a path like
 * `samples/foo/replay.cmd` as switches; resolving up front fixes both. Bare
 * PATH names (`sqlpackage`, `node`) contain no separator and are left alone.
 */
export class LiveProcessProvider implements ProcessProvider {
    public constructor(private readonly _defaultCwd?: string) {}

    public spawn(
        command: string,
        args: readonly string[],
        opts: ProcessSpawnOptions,
    ): Promise<ProcessResult> {
        return new Promise<ProcessResult>((resolve, reject) => {
            const max = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
            const stdoutBuf = new BoundedBuffer(max);
            const stderrBuf = new BoundedBuffer(max);
            let aborted = false;
            let killTimer: NodeJS.Timeout | undefined;

            const cwd = opts.cwd ?? this._defaultCwd;
            const resolvedCommand = resolveCommandPath(command, cwd);
            const useShell = needsShell(resolvedCommand);
            const spawnOpts: SpawnOptionsWithoutStdio = {
                cwd,
                env: opts.env,
                shell: useShell,
                windowsHide: true,
            };

            let child: ChildProcess;
            try {
                child = nodeSpawn(quoteForShell(resolvedCommand, useShell), [...args], spawnOpts);
            } catch (err) {
                reject(err);
                return;
            }

            child.stdout?.on("data", (chunk: Buffer) => stdoutBuf.append(chunk));
            child.stderr?.on("data", (chunk: Buffer) => stderrBuf.append(chunk));

            const onAbort = () => {
                aborted = true;
                terminate(child);
                killTimer = setTimeout(() => {
                    if (child.exitCode === null && child.signalCode === null) {
                        try {
                            child.kill("SIGKILL");
                        } catch {
                            // Already gone.
                        }
                    }
                }, SIGKILL_GRACE_MS);
            };

            if (opts.signal.aborted) {
                onAbort();
            } else {
                opts.signal.addEventListener("abort", onAbort, { once: true });
            }

            if (opts.stdin !== undefined) {
                child.stdin?.end(opts.stdin);
            } else {
                child.stdin?.end();
            }

            child.on("error", (err) => {
                opts.signal.removeEventListener("abort", onAbort);
                if (killTimer) {
                    clearTimeout(killTimer);
                }
                reject(err);
            });

            child.on("close", (code, signal) => {
                opts.signal.removeEventListener("abort", onAbort);
                if (killTimer) {
                    clearTimeout(killTimer);
                }
                resolve({
                    exitCode: code,
                    stdout: stdoutBuf.toString(),
                    stderr: stderrBuf.toString(),
                    signal: signal ?? undefined,
                    aborted,
                    truncated: stdoutBuf.overflowed || stderrBuf.overflowed,
                });
            });
        });
    }
}

/**
 * Fixed-budget rolling buffer. When the byte cap is hit we stop appending —
 * we don't slide a window because callers parse from the start of the
 * stream (e.g., sqlpackage prints diagnostics top-down). Truncation is
 * signalled by a trailing marker so callers can detect it without changing
 * the public API.
 */
class BoundedBuffer {
    private readonly _chunks: Buffer[] = [];
    private _size = 0;
    private _overflowed = false;

    public constructor(private readonly cap: number) {}

    public get overflowed(): boolean {
        return this._overflowed;
    }

    public append(chunk: Buffer): void {
        if (this._size >= this.cap) {
            this._overflowed = true;
            return;
        }
        const room = this.cap - this._size;
        if (chunk.length <= room) {
            this._chunks.push(chunk);
            this._size += chunk.length;
            return;
        }
        this._chunks.push(chunk.subarray(0, room));
        this._size = this.cap;
        this._overflowed = true;
    }

    public toString(): string {
        const joined = Buffer.concat(this._chunks, this._size).toString("utf-8");
        return this._overflowed ? joined + "\n[output truncated]" : joined;
    }
}

function terminate(child: ChildProcess): void {
    if (child.exitCode !== null || child.signalCode !== null) {
        return;
    }
    try {
        child.kill("SIGTERM");
    } catch {
        // Process may already have exited between the check and the kill.
    }
}

/**
 * Whether `command` must be spawned through the shell. Only Windows batch
 * scripts (`.bat` / `.cmd`) qualify: Node ≥20 throws `spawn EINVAL` when
 * asked to run them with `shell: false` (CVE-2024-27980 hardening). Real
 * executables and bare PATH names stay `shell: false`.
 */
function needsShell(command: string): boolean {
    return process.platform === "win32" && /\.(bat|cmd)$/i.test(command);
}

/**
 * Resolves a relative path-like `command` to an absolute, native-separator
 * path against `base` (the spawn cwd, falling back to the process cwd). Only
 * commands that contain a path separator are touched; bare PATH names such as
 * `sqlpackage` or `node` are returned unchanged so the OS PATH lookup still
 * works. Absolute commands are returned unchanged.
 */
function resolveCommandPath(command: string, base: string | undefined): string {
    if (!/[\\/]/.test(command) || path.isAbsolute(command)) {
        return command;
    }
    return path.resolve(base ?? process.cwd(), command);
}

/**
 * Quotes `command` for shell execution. When spawning through the shell the
 * command line is parsed by `cmd.exe`, so a path containing spaces must be
 * wrapped in double quotes to be treated as a single token. No-op when the
 * shell isn't used or the command is already quoted. The workload-playback
 * contract spawns the replay tool with zero args, so there is nothing else
 * to quote here.
 */
function quoteForShell(command: string, useShell: boolean): string {
    if (!useShell || !/\s/.test(command) || command.startsWith('"')) {
        return command;
    }
    return `"${command}"`;
}

// =============================================================================
// FakeProcessProvider (test double)
// =============================================================================

/**
 * Canned response for a `(command, firstArg)` key. `cancelled` simulates a
 * subprocess that didn't exit before the abort signal fired.
 */
export type FakeProcessResponse =
    | {
          readonly mode: "exit";
          readonly exitCode: number;
          readonly stdout?: string;
          readonly stderr?: string;
      }
    | { readonly mode: "throw"; readonly error: Error }
    | { readonly mode: "hang" }; // resolves only when signal aborts

export interface FakeSpawnInvocation {
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd?: string;
    readonly env?: Record<string, string>;
    readonly stdin?: string;
}

/**
 * Records invocations and replays canned responses keyed on
 * `(command, args[0])`. Tests configure expectations up-front via
 * `respond()`; unmatched calls fall through to a default `exit 0` so simple
 * happy-path setups don't need a `respond()` call per spawn.
 */
export class FakeProcessProvider implements ProcessProvider {
    public readonly invocations: FakeSpawnInvocation[] = [];
    private readonly _responses = new Map<string, FakeProcessResponse>();

    /**
     * Configure the canned response for a given `(command, firstArg)` pair.
     * The matcher is intentionally crude — most validator tests dispatch on
     * the first arg (e.g. `/Action:DeployReport`), and richer matching can
     * be added when a test actually needs it.
     */
    public respond(command: string, firstArg: string, response: FakeProcessResponse): void {
        this._responses.set(keyOf(command, firstArg), response);
    }

    public spawn(
        command: string,
        args: readonly string[],
        opts: ProcessSpawnOptions,
    ): Promise<ProcessResult> {
        this.invocations.push({
            command,
            args: [...args],
            cwd: opts.cwd,
            env: opts.env,
            stdin: opts.stdin,
        });

        const response = this._responses.get(keyOf(command, args[0] ?? "")) ?? {
            mode: "exit" as const,
            exitCode: 0,
        };

        if (response.mode === "throw") {
            return Promise.reject(response.error);
        }

        if (opts.signal.aborted) {
            return Promise.resolve({
                exitCode: null,
                stdout: "",
                stderr: "",
                signal: "SIGTERM" as NodeJS.Signals,
                aborted: true,
                truncated: false,
            });
        }

        if (response.mode === "hang") {
            return new Promise<ProcessResult>((resolve) => {
                const onAbort = () => {
                    opts.signal.removeEventListener("abort", onAbort);
                    resolve({
                        exitCode: null,
                        stdout: "",
                        stderr: "",
                        signal: "SIGTERM" as NodeJS.Signals,
                        aborted: true,
                        truncated: false,
                    });
                };
                opts.signal.addEventListener("abort", onAbort, { once: true });
            });
        }

        return Promise.resolve({
            exitCode: response.exitCode,
            stdout: response.stdout ?? "",
            stderr: response.stderr ?? "",
            aborted: false,
            truncated: false,
        });
    }
}

function keyOf(command: string, firstArg: string): string {
    return `${command}\u0000${firstArg}`;
}
