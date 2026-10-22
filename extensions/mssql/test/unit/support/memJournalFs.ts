/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * In-memory JournalFsLike for feature-capture journal tests (WI-2.2): records
 * every operation (so tests can assert that tryWrite performs NO file I/O)
 * and injects failures at the §13.5 fault points — append boundaries, the
 * manifest temp write, and the atomic rename.
 */

import { JournalFsLike } from "../../../src/diagnostics/featureCapture/journal/journalWriter";

export type JournalFsOp = "mkdirp" | "append" | "write" | "rename" | "read" | "readdir";

export class MemJournalFs implements JournalFsLike {
    files = new Map<string, string>();
    ops: Array<{ op: JournalFsOp; path: string; to?: string }> = [];

    /** Return an Error to fail an append; optionally tear a partial write first. */
    failAppend: ((path: string, data: string) => Error | undefined) | undefined;
    /** When an append fails, append this fraction of the data first (torn line). */
    tornAppendFraction = 0;
    /** Return an Error to fail the manifest temp-file write. */
    failWrite: ((path: string) => Error | undefined) | undefined;
    /** Return an Error to fail the atomic rename. */
    failRename: ((fromPath: string, toPath: string) => Error | undefined) | undefined;

    private note(op: JournalFsOp, path: string, to?: string): void {
        this.ops.push(to === undefined ? { op, path } : { op, path, to });
    }

    async mkdirp(path: string): Promise<void> {
        this.note("mkdirp", path);
    }

    async appendFile(path: string, data: string): Promise<void> {
        this.note("append", path);
        const error = this.failAppend?.(path, data);
        if (error) {
            if (this.tornAppendFraction > 0) {
                const torn = data.slice(0, Math.floor(data.length * this.tornAppendFraction));
                this.files.set(path, (this.files.get(path) ?? "") + torn);
            }
            throw error;
        }
        this.files.set(path, (this.files.get(path) ?? "") + data);
    }

    async writeFile(path: string, data: string): Promise<void> {
        this.note("write", path);
        const error = this.failWrite?.(path);
        if (error) {
            throw error;
        }
        this.files.set(path, data);
    }

    async rename(fromPath: string, toPath: string): Promise<void> {
        this.note("rename", fromPath, toPath);
        const error = this.failRename?.(fromPath, toPath);
        if (error) {
            throw error;
        }
        const content = this.files.get(fromPath);
        if (content === undefined) {
            throw Object.assign(new Error(`ENOENT: ${fromPath}`), { code: "ENOENT" });
        }
        this.files.delete(fromPath);
        this.files.set(toPath, content);
    }

    async readFile(path: string): Promise<string> {
        this.note("read", path);
        const content = this.files.get(path);
        if (content === undefined) {
            throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
        }
        return content;
    }

    async readdir(path: string): Promise<string[]> {
        this.note("readdir", path);
        const prefixes = [`${path}/`, `${path}\\`];
        const names = new Set<string>();
        for (const key of this.files.keys()) {
            for (const prefix of prefixes) {
                if (key.startsWith(prefix)) {
                    names.add(key.slice(prefix.length).split(/[/\\]/)[0]);
                }
            }
        }
        return [...names];
    }
}

/** Manual clock for deterministic writer timestamps. */
export class ManualClock {
    constructor(public current = 1_000_000) {}

    now(): number {
        return this.current;
    }

    advance(ms: number): void {
        this.current += ms;
    }
}
