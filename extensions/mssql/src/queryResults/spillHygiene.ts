/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Spill-directory crash safety (C2D-1, addendum §5.4). Retained stores can
 * hold multi-GiB spill files well past a single run; a crashed host must not
 * leak them. Run spill dirs are stamped with a per-activation session nonce
 * (`run<counter>_<nonce>`), each live session heartbeats a
 * `session-<nonce>.lock` file at the spill root, and a startup sweep removes
 * run dirs whose session lock is stale or absent — never a live sibling
 * window's, because its lock stays fresh.
 *
 * Only nonce-suffixed dirs are swept: legacy `run<counter>` dirs may belong
 * to an older-code sibling window and are left to its own dispose paths.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { Perf } from "../perf/perfTelemetry";

/** One nonce per extension activation; every run spill dir carries it. */
export const SESSION_SPILL_NONCE = crypto.randomBytes(6).toString("base64url");

const LOCK_PREFIX = "session-";
const LOCK_SUFFIX = ".lock";
const HEARTBEAT_INTERVAL_MS = 60_000;
/** A lock untouched this long belongs to a dead session. */
export const STALE_LOCK_MS = 10 * 60_000;

const RUN_DIR_PATTERN = /^run\d+_(?<nonce>[A-Za-z0-9_-]+)$/;

export function runSpillDirName(runCounter: number): string {
    return `run${runCounter}_${SESSION_SPILL_NONCE}`;
}

let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let heartbeatRoot: string | undefined;

function lockPath(spillRoot: string, nonce: string): string {
    return path.join(spillRoot, `${LOCK_PREFIX}${nonce}${LOCK_SUFFIX}`);
}

function touchLock(spillRoot: string): void {
    try {
        fs.mkdirSync(spillRoot, { recursive: true });
        const file = lockPath(spillRoot, SESSION_SPILL_NONCE);
        const now = new Date();
        if (fs.existsSync(file)) {
            fs.utimesSync(file, now, now);
        } else {
            fs.writeFileSync(file, String(process.pid), "utf8");
        }
    } catch {
        /* best-effort; the sweep errs toward keeping data */
    }
}

/**
 * Start (idempotently) the session-lock heartbeat for a spill root. Called
 * lazily when the first Query Studio model is created — no activation cost
 * when the feature is unused.
 */
export function ensureSpillSessionLock(spillRoot: string): void {
    touchLock(spillRoot);
    if (heartbeatTimer && heartbeatRoot === spillRoot) {
        return;
    }
    stopSpillSessionLock();
    heartbeatRoot = spillRoot;
    heartbeatTimer = setInterval(() => touchLock(spillRoot), HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref?.();
}

/** Deactivation: stop the heartbeat and drop this session's lock file. */
export function stopSpillSessionLock(): void {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
    }
    if (heartbeatRoot) {
        try {
            fs.rmSync(lockPath(heartbeatRoot, SESSION_SPILL_NONCE), { force: true });
        } catch {
            /* stale lock is handled by the next sweep */
        }
        heartbeatRoot = undefined;
    }
}

export interface OrphanSweepResult {
    dirsRemoved: number;
    bytesRemoved: number;
    failures: number;
}

/**
 * Remove run spill dirs owned by dead sessions. `spillRoot` is the parent
 * that holds one subdirectory per document (each containing run dirs).
 * Safe against live siblings: a session is dead only when its lock file is
 * stale or absent; this session's own dirs are never touched.
 */
export function sweepOrphanSpillDirs(
    spillRoot: string,
    nowEpochMs: number = Date.now(),
): OrphanSweepResult {
    const result: OrphanSweepResult = { dirsRemoved: 0, bytesRemoved: 0, failures: 0 };
    let docDirs: fs.Dirent[];
    try {
        docDirs = fs.readdirSync(spillRoot, { withFileTypes: true });
    } catch {
        return result; // no spill root yet — nothing to sweep
    }
    const liveNonces = new Set<string>([SESSION_SPILL_NONCE]);
    for (const entry of docDirs) {
        if (!entry.isFile() || !entry.name.startsWith(LOCK_PREFIX)) {
            continue;
        }
        const nonce = entry.name.slice(LOCK_PREFIX.length, -LOCK_SUFFIX.length);
        try {
            const mtime = fs.statSync(path.join(spillRoot, entry.name)).mtimeMs;
            if (nowEpochMs - mtime <= STALE_LOCK_MS) {
                liveNonces.add(nonce);
            } else {
                fs.rmSync(path.join(spillRoot, entry.name), { force: true });
            }
        } catch {
            result.failures++;
        }
    }
    for (const docDir of docDirs) {
        if (!docDir.isDirectory()) {
            continue;
        }
        const docPath = path.join(spillRoot, docDir.name);
        let runDirs: fs.Dirent[];
        try {
            runDirs = fs.readdirSync(docPath, { withFileTypes: true });
        } catch {
            result.failures++;
            continue;
        }
        for (const runDir of runDirs) {
            if (!runDir.isDirectory()) {
                continue;
            }
            const match = RUN_DIR_PATTERN.exec(runDir.name);
            if (!match || liveNonces.has(match.groups!.nonce)) {
                continue;
            }
            const runPath = path.join(docPath, runDir.name);
            try {
                result.bytesRemoved += directoryBytes(runPath);
                fs.rmSync(runPath, { recursive: true, force: true });
                result.dirsRemoved++;
            } catch {
                result.failures++;
            }
        }
        // Drop now-empty per-document dirs so the root does not accrete.
        try {
            if (fs.readdirSync(docPath).length === 0) {
                fs.rmdirSync(docPath);
            }
        } catch {
            /* non-fatal */
        }
    }
    if (result.dirsRemoved > 0 || result.failures > 0) {
        Perf.marker("mssql.queryResults.spill.orphanSweep", "instant", {
            dirsRemoved: result.dirsRemoved,
            bytesRemoved: result.bytesRemoved,
            failures: result.failures,
        });
    }
    return result;
}

function directoryBytes(dir: string): number {
    let total = 0;
    try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                total += directoryBytes(full);
            } else if (entry.isFile()) {
                total += fs.statSync(full).size;
            }
        }
    } catch {
        /* size is advisory */
    }
    return total;
}
