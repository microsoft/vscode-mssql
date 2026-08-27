/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * In-memory FsLike for metadata cache tests (extracted from
 * metadataCacheStore.test.ts so store-integration suites reuse the same
 * crash/interleave injection points).
 */

import { FsLike } from "../../../src/services/metadata/cache/metadataCacheStore";

export type FsOp = "read" | "write" | "rename" | "unlink" | "mkdirp" | "readdir" | "stat";

export class MemFs implements FsLike {
    files = new Map<string, Buffer>();
    ops: Array<{ op: FsOp; path: string; to?: string }> = [];
    /** Return an Error to make a rename attempt fail (attempt-aware). */
    failRename: ((from: string, to: string) => Error | undefined) | undefined;
    /** Awaited before every operation — crash/interleave injection point. */
    beforeOp: ((op: FsOp, path: string) => Promise<void> | void) | undefined;

    private async hook(op: FsOp, path: string, to?: string): Promise<void> {
        this.ops.push(to === undefined ? { op, path } : { op, path, to });
        await this.beforeOp?.(op, path);
    }

    private enoent(path: string): Error {
        return Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
    }

    async readFile(path: string): Promise<Uint8Array> {
        await this.hook("read", path);
        const file = this.files.get(path);
        if (!file) {
            throw this.enoent(path);
        }
        return file;
    }

    async writeFileSynced(path: string, data: Uint8Array): Promise<void> {
        await this.hook("write", path);
        this.files.set(path, Buffer.from(data));
    }

    async rename(fromPath: string, toPath: string): Promise<void> {
        await this.hook("rename", toPath, toPath);
        const error = this.failRename?.(fromPath, toPath);
        if (error) {
            throw error;
        }
        const file = this.files.get(fromPath);
        if (!file) {
            throw this.enoent(fromPath);
        }
        this.files.delete(fromPath);
        this.files.set(toPath, file);
    }

    async unlink(path: string): Promise<void> {
        await this.hook("unlink", path);
        if (!this.files.delete(path)) {
            throw this.enoent(path);
        }
    }

    async mkdirp(path: string): Promise<void> {
        await this.hook("mkdirp", path);
    }

    async readdir(path: string): Promise<string[]> {
        await this.hook("readdir", path);
        const prefix = path.endsWith("/") ? path : `${path}/`;
        const names = new Set<string>();
        for (const key of this.files.keys()) {
            if (key.startsWith(prefix)) {
                names.add(key.slice(prefix.length).split("/")[0]);
            }
        }
        return [...names];
    }

    async stat(path: string): Promise<{ readonly size: number } | undefined> {
        await this.hook("stat", path);
        const file = this.files.get(path);
        return file ? { size: file.length } : undefined;
    }

    renameCount(target: string): number {
        return this.ops.filter((op) => op.op === "rename" && op.path === target).length;
    }
}
