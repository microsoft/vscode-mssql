/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Virtual runbook file system (D-0014 step c): library runbooks open on the
 * `mssql-runbook:` scheme instead of their globalStorage stash path, so a
 * hot-exit restore re-resolves the tab through this provider (VS Code calls
 * readFile) rather than pinning a real-filesystem path into the user's
 * settings storage. The provider is a thin pass-through to the stash
 * directory — the exact bytes the libraryStash helpers read and write; the
 * runtime library remains the source of truth and the stash its local
 * projection.
 *
 * URI shape: `mssql-runbook:/<assetId>.runbook.json` — root-level only; the
 * file name IS the stash file's name (the sanitized asset id + suffix), so
 * the virtual tree and the stash directory are the same set by construction.
 */

import * as vscode from "vscode";
import {
    listStash,
    sanitizeAssetId,
    STASH_FILE_SUFFIX,
    stashDirectoryUri,
    stashEntryUri,
    statStash,
} from "./libraryStash";

/** Scheme for virtual runbook documents backed by the library stash. */
export const RUNBOOK_FS_SCHEME = "mssql-runbook";

// -- pure assetId <-> path mapping (unit-tested) -----------------------------

/** Virtual document path for an asset id: "/<sanitizedId>.runbook.json". */
export function runbookVirtualPath(assetId: string): string {
    return `/${sanitizeAssetId(assetId)}${STASH_FILE_SUFFIX}`;
}

/** Virtual document URI for a library asset — what open flows should use. */
export function runbookVirtualUri(assetId: string): vscode.Uri {
    return vscode.Uri.from({ scheme: RUNBOOK_FS_SCHEME, path: runbookVirtualPath(assetId) });
}

/**
 * The stash file NAME a virtual path addresses, or undefined when the path
 * is not a single root-level "<name>.runbook.json" entry the stash could
 * contain. The sanitize identity check rejects separators (no traversal)
 * and every character a stash file name never carries, in one place.
 */
export function stashNameFromVirtualPath(virtualPath: string): string | undefined {
    if (!virtualPath.startsWith("/")) {
        return undefined;
    }
    const name = virtualPath.slice(1);
    if (
        name.length <= STASH_FILE_SUFFIX.length ||
        !name.endsWith(STASH_FILE_SUFFIX) ||
        name !== sanitizeAssetId(name)
    ) {
        return undefined;
    }
    return name;
}

/** Asset id carried by a virtual path — the sanitized projection (ids that
 *  were already filesystem-safe round-trip exactly); undefined when the
 *  path is not a valid virtual runbook path. */
export function assetIdFromVirtualPath(virtualPath: string): string | undefined {
    return stashNameFromVirtualPath(virtualPath)?.slice(0, -STASH_FILE_SUFFIX.length);
}

function isRootPath(virtualPath: string): boolean {
    return virtualPath === "/" || virtualPath === "";
}

// -- the provider ------------------------------------------------------------

export class RunbookFileSystemProvider implements vscode.FileSystemProvider {
    private readonly changeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    public readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> =
        this.changeEmitter.event;

    constructor(private readonly globalStorageUri: vscode.Uri) {}

    /** No push watching: the stash changes through this provider's own
     *  writeFile/delete (which fire the events themselves) or through
     *  service-side stash writes that always precede an open. */
    public watch(): vscode.Disposable {
        return new vscode.Disposable(() => undefined);
    }

    public async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        if (isRootPath(uri.path)) {
            // The root always exists — an empty library is an empty listing,
            // not a missing directory (the stash dir materializes on first
            // write), so a synthetic directory stat is the honest answer.
            return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
        }
        const stat = await statStash(this.globalStorageUri, this.stashName(uri));
        if (stat === undefined) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return stat;
    }

    public async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        if (!isRootPath(uri.path)) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return (await listStash(this.globalStorageUri)).map((name) => [name, vscode.FileType.File]);
    }

    public createDirectory(uri: vscode.Uri): void {
        // Root creation is a no-op (it always exists); this file system has
        // no nested directories to create.
        if (!isRootPath(uri.path)) {
            throw vscode.FileSystemError.NoPermissions(uri);
        }
    }

    public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const target = stashEntryUri(this.globalStorageUri, this.stashName(uri));
        try {
            return await vscode.workspace.fs.readFile(target);
        } catch {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    public async writeFile(
        uri: vscode.Uri,
        content: Uint8Array,
        options: { readonly create: boolean; readonly overwrite: boolean },
    ): Promise<void> {
        const name = this.stashName(uri);
        const existed = (await statStash(this.globalStorageUri, name)) !== undefined;
        if (!existed && !options.create) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        if (existed && options.create && !options.overwrite) {
            throw vscode.FileSystemError.FileExists(uri);
        }
        await vscode.workspace.fs.createDirectory(stashDirectoryUri(this.globalStorageUri));
        await vscode.workspace.fs.writeFile(stashEntryUri(this.globalStorageUri, name), content);
        // Announce the write so every open consumer of this URI (notably
        // the custom editor's shared text model) stays in sync with saves.
        this.changeEmitter.fire([
            { type: existed ? vscode.FileChangeType.Changed : vscode.FileChangeType.Created, uri },
        ]);
    }

    public async delete(uri: vscode.Uri): Promise<void> {
        const name = this.stashName(uri);
        try {
            await vscode.workspace.fs.delete(stashEntryUri(this.globalStorageUri, name));
        } catch {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        this.changeEmitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
    }

    public async rename(
        oldUri: vscode.Uri,
        newUri: vscode.Uri,
        options: { readonly overwrite: boolean },
    ): Promise<void> {
        const oldName = this.stashName(oldUri);
        const newName = this.stashName(newUri);
        if ((await statStash(this.globalStorageUri, oldName)) === undefined) {
            throw vscode.FileSystemError.FileNotFound(oldUri);
        }
        if (!options.overwrite && (await statStash(this.globalStorageUri, newName)) !== undefined) {
            throw vscode.FileSystemError.FileExists(newUri);
        }
        await vscode.workspace.fs.rename(
            stashEntryUri(this.globalStorageUri, oldName),
            stashEntryUri(this.globalStorageUri, newName),
            { overwrite: options.overwrite },
        );
        this.changeEmitter.fire([
            { type: vscode.FileChangeType.Deleted, uri: oldUri },
            { type: vscode.FileChangeType.Created, uri: newUri },
        ]);
    }

    /** Map a virtual URI to its stash file name or fail honestly. */
    private stashName(uri: vscode.Uri): string {
        const name = stashNameFromVirtualPath(uri.path);
        if (name === undefined) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return name;
    }
}
