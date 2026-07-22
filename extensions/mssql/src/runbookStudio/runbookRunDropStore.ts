/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Host-owned files retained for one run. The drop is intentionally rooted
 * under extension global storage: imported plans cannot choose an arbitrary
 * write path, and deleting a durable run can guarantee that its files are
 * deleted with it.
 *
 * Layout: <root>/<runId>/manifest.json
 *         <root>/<runId>/artifacts/<node>-<name>.<closed extension>
 */

import * as fs from "fs";
import * as path from "path";
import { RunbookRunStateKind } from "../sharedInterfaces/runbookStudio";
import { sanitizeRunFileId } from "./runbookRunLedger";
import { localManagedArtifactFileName } from "./runtime/localManagedArtifacts";

export const RUN_DROP_SCHEMA_VERSION = 1;

export interface RunbookRunDropIdentity {
    runId: string;
    runbookId: string;
    planRevision: string;
    planHash: string;
    startedEpochMs: number;
}

interface RunbookRunDropManifest extends RunbookRunDropIdentity {
    schemaVersion: typeof RUN_DROP_SCHEMA_VERSION;
    state: RunbookRunStateKind;
    endedEpochMs?: number;
}

export class RunbookRunDropStore {
    constructor(
        private readonly root: string,
        /** Read/delete compatibility for artifacts retained before drops. */
        private readonly legacyArtifactRoot?: string,
    ) {
        fs.mkdirSync(this.root, { recursive: true });
    }

    public createRun(identity: RunbookRunDropIdentity): string {
        const directory = this.runDirectory(identity.runId);
        fs.mkdirSync(this.artifactDirectory(identity.runId), { recursive: true });
        this.writeManifest(directory, {
            schemaVersion: RUN_DROP_SCHEMA_VERSION,
            ...identity,
            state: "accepted",
        });
        return directory;
    }

    public artifactPath(runId: string, nodeId: string, requestedName: string): string {
        const directory = this.artifactDirectory(runId);
        fs.mkdirSync(directory, { recursive: true });
        return path.join(directory, localManagedArtifactFileName(nodeId, requestedName));
    }

    public markTerminal(
        runId: string,
        state: Extract<RunbookRunStateKind, "succeeded" | "failed" | "cancelled">,
        endedEpochMs: number,
    ): boolean {
        const directory = this.runDirectory(runId);
        const manifest = this.readManifest(directory);
        if (!manifest || manifest.runId !== runId) {
            return false;
        }
        this.writeManifest(directory, { ...manifest, state, endedEpochMs });
        return true;
    }

    /**
     * Remove atomic-write remnants for runs that the durable ledger has
     * already sealed. The search is deliberately shallow and admits only
     * regular files ending in `.tmp`; a plan cannot turn this into a general
     * directory traversal or cleanup primitive.
     */
    public cleanupTemporaryFiles(runIds: readonly string[]): number {
        let deleted = 0;
        for (const runId of new Set(runIds)) {
            const directory = this.runDirectory(runId);
            deleted += removeRegularTemporaryFile(path.join(directory, "manifest.json.tmp"));
            const artifacts = path.join(directory, "artifacts");
            try {
                if (fs.lstatSync(artifacts).isSymbolicLink()) {
                    continue;
                }
                for (const entry of fs.readdirSync(artifacts, { withFileTypes: true })) {
                    if (entry.isFile() && entry.name.endsWith(".tmp")) {
                        deleted += removeRegularTemporaryFile(path.join(artifacts, entry.name));
                    }
                }
            } catch {
                // Missing/inaccessible artifact directories are normal for
                // interrupted runs that failed before producing outputs.
            }
        }
        return deleted;
    }

    /** New drop first; fall back to the old managed-artifact directory. */
    public pathForOpen(runId: string): string | undefined {
        const current = this.runDirectory(runId);
        if (isDirectory(current)) {
            return current;
        }
        const legacy = this.legacyRunDirectory(runId);
        return legacy && isDirectory(legacy) ? legacy : undefined;
    }

    /** Remove both current and legacy files for exactly one internal run id. */
    public deleteRun(runId: string): boolean {
        let deleted = false;
        for (const directory of [this.runDirectory(runId), this.legacyRunDirectory(runId)]) {
            if (!directory || !fs.existsSync(directory)) {
                continue;
            }
            fs.rmSync(directory, { recursive: true, force: true });
            deleted = true;
        }
        return deleted;
    }

    public listPersistedRunIds(): string[] {
        const ids = new Set<string>();
        for (const directory of [this.root, this.legacyArtifactRoot]) {
            if (!directory) {
                continue;
            }
            try {
                for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                    if (entry.isDirectory()) {
                        ids.add(entry.name);
                    }
                }
            } catch {
                // A missing legacy root is normal.
            }
        }
        return [...ids];
    }

    /** Roots admitted by retained-artifact verification. */
    public trustedArtifactRoots(): string[] {
        return [this.root, ...(this.legacyArtifactRoot ? [this.legacyArtifactRoot] : [])];
    }

    private runDirectory(runId: string): string {
        return path.join(this.root, sanitizeRunFileId(runId).slice(0, 96));
    }

    private artifactDirectory(runId: string): string {
        return path.join(this.runDirectory(runId), "artifacts");
    }

    private legacyRunDirectory(runId: string): string | undefined {
        return this.legacyArtifactRoot
            ? path.join(this.legacyArtifactRoot, sanitizeRunFileId(runId).slice(0, 96))
            : undefined;
    }

    private readManifest(directory: string): RunbookRunDropManifest | undefined {
        try {
            const value = JSON.parse(
                fs.readFileSync(path.join(directory, "manifest.json"), "utf8"),
            ) as RunbookRunDropManifest;
            return value.schemaVersion === RUN_DROP_SCHEMA_VERSION ? value : undefined;
        } catch {
            return undefined;
        }
    }

    private writeManifest(directory: string, manifest: RunbookRunDropManifest): void {
        const target = path.join(directory, "manifest.json");
        const temp = `${target}.tmp`;
        let descriptor: number | undefined;
        try {
            // Exclusive creation refuses a stale file or link rather than
            // following it. Startup cleanup handles a genuine crash remnant.
            descriptor = fs.openSync(temp, "wx");
            fs.writeFileSync(descriptor, JSON.stringify(manifest, undefined, 2) + "\n");
            fs.fsyncSync(descriptor);
            fs.closeSync(descriptor);
            descriptor = undefined;
            fs.renameSync(temp, target);
        } catch (error) {
            if (descriptor !== undefined) {
                fs.closeSync(descriptor);
            }
            throw error;
        }
    }
}

function isDirectory(candidate: string): boolean {
    try {
        return fs.statSync(candidate).isDirectory();
    } catch {
        return false;
    }
}

function removeRegularTemporaryFile(candidate: string): number {
    try {
        const stat = fs.lstatSync(candidate);
        if (!stat.isFile() || stat.isSymbolicLink()) {
            return 0;
        }
        fs.rmSync(candidate);
        return 1;
    } catch {
        return 0;
    }
}
