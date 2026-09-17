/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * VS Code direct spawn (design §13.1). Fresh --user-data-dir and
 * --extensions-dir per profile mode, perf env vars, stdout/stderr captured to
 * files, graceful shutdown with kill-tree escalation. VS Code is never forked
 * — this is the shipped executable with public launch flags only.
 */

import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import type { HarnessLogger } from "../telemetry/logger";

export interface VscodeLaunchOptions {
    executablePath: string;
    userDataDir: string;
    extensionsDir: string;
    /** Folders loaded with --extensionDevelopmentPath (config source: developmentPath). */
    extensionDevelopmentPaths: string[];
    crashDir: string;
    workspacePath?: string;
    extraArgs?: string[];
    env: Record<string, string>;
    stdoutPath: string;
    stderrPath: string;
}

export interface LaunchedVscode {
    child: ChildProcess;
    pid: number;
    /** Resolves with the exit code (null if killed) once the process exits. */
    exited: Promise<number | null>;
    /** Wait for exit up to timeoutMs; returns undefined if still running. */
    waitForExit(timeoutMs: number): Promise<number | null | undefined>;
    /** Force-kill the whole process tree (last resort). */
    killTree(): Promise<void>;
}

export function buildLaunchArgs(options: VscodeLaunchOptions): string[] {
    const args = [
        "--user-data-dir",
        options.userDataDir,
        "--extensions-dir",
        options.extensionsDir,
        "--new-window",
        "--skip-welcome",
        "--skip-release-notes",
        "--disable-workspace-trust",
        "--disable-updates",
        "--crash-reporter-directory",
        options.crashDir,
    ];
    for (const devPath of options.extensionDevelopmentPaths) {
        args.push(`--extensionDevelopmentPath=${devPath}`);
    }
    if (options.extraArgs) {
        // Base args are the §13.1 contract; config extraArgs append but never replace.
        for (const extra of options.extraArgs) {
            if (!args.includes(extra)) {
                args.push(extra);
            }
        }
    }
    if (options.workspacePath) {
        args.push(options.workspacePath);
    }
    return args;
}

/**
 * Build the child VS Code environment. The parent's Electron/VS Code launch
 * hooks must be stripped: when the harness runs inside a VS Code integrated
 * terminal (e.g. a WSL remote), `ELECTRON_RUN_AS_NODE` and the `VSCODE_*`
 * IPC/NLS hooks are inherited, and the packaged VS Code binary re-executes
 * itself as plain Node (exit code 9, `bad option: --user-data-dir`) instead of
 * launching a window — every rep goes `invalid`. Mirrors what
 * `@vscode/test-electron` does. The harness's own launch env (`overrides`,
 * e.g. PERF_MODE/PERF_MARKER_URL) is applied last and always wins.
 */
export function buildChildEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
    const base: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (key === "ELECTRON_RUN_AS_NODE") continue;
        if (key.startsWith("VSCODE_")) continue;
        base[key] = value;
    }
    return { ...base, ...overrides };
}

export function spawnVscode(options: VscodeLaunchOptions, logger: HarnessLogger): LaunchedVscode {
    for (const dir of [options.userDataDir, options.extensionsDir, options.crashDir]) {
        mkdirSync(dir, { recursive: true });
    }
    const args = buildLaunchArgs(options);
    const span = logger.span("vscode.spawn", {
        executable: options.executablePath,
        argCount: args.length,
    });
    logger.debug("vscode.launchArgs", undefined, { args });

    const child = spawn(options.executablePath, args, {
        env: buildChildEnv(options.env),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: false,
        detached: process.platform !== "win32",
    });

    const stdout = createWriteStream(options.stdoutPath);
    const stderr = createWriteStream(options.stderrPath);
    stdout.on("error", (error) => logger.warn("vscode.stdoutCaptureFailed", String(error)));
    stderr.on("error", (error) => logger.warn("vscode.stderrCaptureFailed", String(error)));
    child.stdout?.pipe(stdout);
    child.stderr?.pipe(stderr);

    const exited = new Promise<number | null>((resolve) => {
        let settled = false;
        const finish = (code: number | null) => {
            if (settled) return;
            settled = true;
            resolve(code);
        };
        child.once("error", (error) => {
            logger.error("vscode.spawnFailed", String(error));
            span.fail(error);
            finish(null);
        });
        child.once("exit", (code) => {
            logger.info("vscode.exited", undefined, { pid: child.pid, code });
            finish(code);
        });
    });

    if (child.pid === undefined) {
        span.fail(new Error("spawn returned no pid"));
        throw new Error(`Failed to spawn VS Code from ${options.executablePath}`);
    }
    const pid = child.pid;
    span.end({ pid });

    return {
        child,
        pid,
        exited,
        waitForExit: async (timeoutMs: number) => {
            let timer: NodeJS.Timeout | undefined;
            const timeout = new Promise<undefined>((resolve) => {
                timer = setTimeout(() => resolve(undefined), timeoutMs);
            });
            const result = await Promise.race([exited, timeout]);
            if (timer) clearTimeout(timer);
            return result;
        },
        killTree: async () => {
            logger.warn("vscode.killTree", undefined, { pid });
            if (process.platform === "win32") {
                await new Promise<void>((resolve) => {
                    execFile("taskkill", ["/PID", String(pid), "/T", "/F"], () => resolve());
                });
            } else {
                try {
                    process.kill(-pid, "SIGKILL");
                } catch {
                    // already gone
                }
            }
        },
    };
}
