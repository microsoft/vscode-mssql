/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Hobbes runtime supervisor (ADR-1, A2 §3.3): lazy launch of the supplied
 * runtime package as a loopback-only HTTP service on a dynamically allocated
 * port. The runtime is a pinned BLACK-BOX dependency — no Hobbes code is
 * modified; we spawn its existing entry point with its documented
 * environment (SAM_DATA_DIR, ASPNETCORE_URLS) and probe its documented
 * /health + /metadata surface (verified live against runtime 0.1.0).
 *
 * Orphan handling: the child dies with us (kill on dispose + extension exit);
 * a PID file under storage lets the NEXT session sweep an orphan whose parent
 * crashed before dispose ran.
 */

import { ChildProcess, spawn } from "child_process";
import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import { Perf } from "../../perf/perfTelemetry";
import { emitRunbookEvent, metaField, RunbookOperationContext } from "../runbookDiag";

const HEALTH_POLL_INTERVAL_MS = 500;
// Debug extension hosts and first-run .NET startup can be substantially slower
// than an already-warm runtime. A launch remains bounded, but it should not
// fail merely because the host is doing its initial build/indexing work.
const HEALTH_TIMEOUT_MS = 90_000;

export interface RuntimeMetadata {
    version: string;
    activeProviderProfileId?: string;
    supports?: {
        planning?: boolean;
        execution?: boolean;
        checkpointing?: boolean;
        humanApproval?: boolean;
    };
}

export interface SupervisedRuntime {
    baseUrl: string;
    metadata: RuntimeMetadata;
    pid: number | undefined;
}

/** Shares one in-flight launch between all startup callers. Library loading,
 * execution and settings initialization can ask for the runtime concurrently
 * while the extension activates; spawning once is both faster and avoids two
 * Hobbes processes racing over the same data directory and PID file. */
export class RuntimeLaunchCoordinator<T> {
    private pending: Promise<T> | undefined;

    public run(operation: () => Promise<T>): Promise<T> {
        if (this.pending) {
            return this.pending;
        }
        const attempt = Promise.resolve().then(operation);
        this.pending = attempt;
        const clear = () => {
            if (this.pending === attempt) {
                this.pending = undefined;
            }
        };
        void attempt.then(clear, clear);
        return attempt;
    }

    public async settle(): Promise<void> {
        try {
            await this.pending;
        } catch {
            // A restart replaces a failed launch below.
        }
    }
}

/** Find a free loopback port by binding port 0 and reading the assignment. */
export function findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            const port = typeof address === "object" && address ? address.port : undefined;
            server.close(() => {
                if (port === undefined) {
                    reject(new Error("no port assigned"));
                } else {
                    resolve(port);
                }
            });
        });
    });
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

export class RuntimeSupervisor {
    private child: ChildProcess | undefined;
    private runtime: SupervisedRuntime | undefined;
    private exitListeners: Array<(unexpected: boolean) => void> = [];
    private disposing = false;
    private readonly launchCoordinator = new RuntimeLaunchCoordinator<SupervisedRuntime>();

    constructor(
        private readonly executablePath: string,
        private readonly storageRoot: string,
    ) {}

    public onExit(listener: (unexpected: boolean) => void): void {
        this.exitListeners.push(listener);
    }

    public get baseUrl(): string | undefined {
        return this.runtime?.baseUrl;
    }

    /** The runtime's isolated data directory (its library + registries). */
    public get dataDir(): string {
        return path.join(this.storageRoot, "hobbes-data");
    }

    /** Restart to apply persisted runtime settings (e.g. the SQL connection
     *  provider, which the MCP server reads only at startup). The old
     *  child's exit is EXPECTED — it must not trip exit listeners. */
    public async restart(context: RunbookOperationContext): Promise<SupervisedRuntime> {
        this.restarting = true;
        try {
            await this.launchCoordinator.settle();
            this.kill();
            return await this.ensureRunning(context);
        } finally {
            this.restarting = false;
        }
    }

    private restarting = false;

    /** Launch (or return the live) runtime; resolves after /health succeeds. */
    public async ensureRunning(context: RunbookOperationContext): Promise<SupervisedRuntime> {
        if (this.runtime && this.child && this.child.exitCode === null) {
            return this.runtime;
        }
        return this.launchCoordinator.run(() => this.launch(context));
    }

    private async launch(context: RunbookOperationContext): Promise<SupervisedRuntime> {
        if (!fs.existsSync(this.executablePath)) {
            throw new Error(`runtime executable not found: ${this.executablePath}`);
        }
        this.sweepOrphan();
        Perf.marker(
            "mssql.runbookStudio.runtime.launch.begin",
            "begin",
            undefined,
            context.traceId,
        );
        const port = await findFreePort();
        const baseUrl = `http://127.0.0.1:${port}`;
        const dataDir = path.join(this.storageRoot, "hobbes-data");
        fs.mkdirSync(dataDir, { recursive: true });
        const child = spawn(this.executablePath, [], {
            cwd: path.dirname(this.executablePath),
            env: {
                ...process.env,
                SAM_DATA_DIR: dataDir,
                ASPNETCORE_URLS: baseUrl,
                // The runtime must never inherit our stdio protocol streams.
                DOTNET_NOLOGO: "1",
                // NOTE: XDG_STATE_HOME isolation for the Copilot CLI (to keep
                // its planner sessions out of VS Code's Chat Sessions view)
                // was REVERTED: with an empty state dir the CLI's
                // runbook-title dispatch hung indefinitely (observed in the
                // headless e2e — planner turns worked, the title agent never
                // returned). Chat-history isolation needs a CLI-supported
                // session-dir option or an upstream runtime setting (U-5).
            },
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        // CRITICAL: drain the pipes. The runtime logs verbosely to its
        // console; an undrained 64KB pipe buffer eventually blocks EVERY
        // thread on console writes and freezes the whole process — the
        // root cause of the recurring "wedged runtime" (runs stall, all
        // HTTP times out, log file stops mid-line). The file log carries
        // the content; discard the streams after keeping a small tail for
        // crash diagnostics.
        child.stdout?.on("data", (chunk: Buffer) => this.keepConsoleTail(chunk));
        child.stderr?.on("data", (chunk: Buffer) => this.keepConsoleTail(chunk));
        this.child = child;
        this.writePidFile(child.pid);
        child.on("exit", (code) => {
            const isCurrentChild = this.child === child;
            const unexpected = isCurrentChild && !this.disposing && !this.restarting;
            if (isCurrentChild) {
                this.child = undefined;
                this.runtime = undefined;
                this.clearPidFile();
            }
            emitRunbookEvent(
                context,
                "runbookStudio.runtime.processExited",
                unexpected ? "error" : "ok",
                {
                    exitCode: metaField(code ?? -1),
                    unexpected: metaField(unexpected),
                },
            );
            // Listeners are UNEXPECTED-exit listeners: restarts and disposal
            // must never cancel live observation of other runs.
            if (unexpected) {
                for (const listener of this.exitListeners) {
                    listener(true);
                }
            }
        });

        const deadline = Date.now() + HEALTH_TIMEOUT_MS;
        let lastError: unknown;
        while (Date.now() < deadline) {
            if (child.exitCode !== null) {
                break;
            }
            try {
                const health = (await fetchJson(`${baseUrl}/health`, 2000)) as {
                    status?: string;
                };
                if (health?.status === "ok") {
                    const metadata = (await fetchJson(
                        `${baseUrl}/metadata`,
                        5000,
                    )) as RuntimeMetadata;
                    this.runtime = { baseUrl, metadata, pid: child.pid };
                    Perf.marker(
                        "mssql.runbookStudio.runtime.launch.end",
                        "end",
                        { outcome: "ok", runtimeVersion: metadata.version ?? "unknown" },
                        context.traceId,
                    );
                    return this.runtime;
                }
            } catch (error) {
                lastError = error;
            }
            await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
        }
        Perf.marker(
            "mssql.runbookStudio.runtime.launch.end",
            "end",
            { outcome: "failed" },
            context.traceId,
        );
        this.kill();
        throw new Error(
            `runtime did not become healthy within ${HEALTH_TIMEOUT_MS}ms` +
                (lastError instanceof Error ? ` (${lastError.message})` : ""),
        );
    }

    public dispose(): void {
        this.disposing = true;
        this.kill();
        this.clearPidFile();
    }

    private kill(): void {
        if (this.child && this.child.exitCode === null) {
            try {
                this.child.kill();
            } catch {
                // best effort
            }
        }
        this.child = undefined;
        this.runtime = undefined;
    }

    /** Last ~16KB of the child's console output (crash diagnostics only). */
    private consoleTail = "";

    private keepConsoleTail(chunk: Buffer): void {
        this.consoleTail = (this.consoleTail + chunk.toString("utf8")).slice(-16_384);
    }

    /** Recent console output — surfaced when the runtime dies or wedges. */
    public get recentConsoleOutput(): string {
        return this.consoleTail;
    }

    private get pidFilePath(): string {
        return path.join(this.storageRoot, "hobbes-runtime.pid");
    }

    private writePidFile(pid: number | undefined): void {
        if (pid === undefined) {
            return;
        }
        try {
            fs.mkdirSync(this.storageRoot, { recursive: true });
            fs.writeFileSync(this.pidFilePath, String(pid));
        } catch {
            // best effort
        }
    }

    private clearPidFile(): void {
        try {
            fs.rmSync(this.pidFilePath, { force: true });
        } catch {
            // best effort
        }
    }

    /** Kill an orphan left by a crashed previous session (same storage). */
    private sweepOrphan(): void {
        try {
            const raw = fs.readFileSync(this.pidFilePath, "utf8").trim();
            const pid = Number(raw);
            if (Number.isInteger(pid) && pid > 0) {
                try {
                    process.kill(pid);
                } catch {
                    // already gone
                }
            }
        } catch {
            // no pid file
        }
        this.clearPidFile();
    }
}
