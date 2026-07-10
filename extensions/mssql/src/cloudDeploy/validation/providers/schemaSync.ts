/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — schema sync.
 *
 * Turns a `Shadow` source's authoring input (a live database, or a dacpac) into
 * a deterministic, git-diffable `.sqlproj` written into the workspace at the
 * source's `projectPath` — the committed artifact that validation (local and
 * CI) then builds. This is the "bridge" that lets DB/dacpac-authored schema be
 * reviewed and validated under the team's rules everywhere: the live source is
 * where a developer authors; the committed sqlproj is what gets validated.
 *
 * Two inner sources:
 *   * `Connection` — resolve the profile to a connection string and decompose it
 *     directly (`sqlpackage /Action:Extract … ExtractTarget=SchemaObjectType`).
 *   * `Dacpac` — a dacpac cannot be extracted directly, so a host-injected
 *     `DacpacDecomposer` publishes it to a throwaway database and hands back a
 *     connection string (plus a `dispose`) that is decomposed the same way. The
 *     seam keeps this module decoupled from the ephemeral-database provider.
 *
 * Sync only writes the tree; it never builds or validates. The decomposition is
 * deterministic, so re-syncing an unchanged schema produces no git diff.
 */

import { promises as fs } from "fs";
import * as path from "path";

import { ProcessProvider } from "./processProvider";
import { ShadowInnerSource, SourceOfTruthKind } from "../../environments/types";
import {
    SchemaResolutionError,
    SourceConnectionStringResolver,
    decomposeConnectionToProject,
    resolveAgainstWorkspace,
    shadowProjectName,
} from "./schemaResolver";

const DEFAULT_SQLPACKAGE_COMMAND = "sqlpackage";

/**
 * Publishes a dacpac to a throwaway database and returns a connection string for
 * it (so it can be extracted into a project tree) plus a `dispose` that tears
 * the throwaway database down. Host-injected so this module never depends on the
 * ephemeral-database provider directly.
 */
export type DacpacDecomposer = (
    dacpacPath: string,
    signal: AbortSignal,
) => Promise<{ readonly connectionString: string; dispose(): Promise<void> }>;

/** Knobs for `syncSchemaProject`. Production wires resolved executables + seams. */
export interface SchemaSyncOptions {
    /** `sqlpackage` executable used to extract the schema. */
    readonly sqlpackageCommand?: string;
    /** Workspace root used to resolve a relative `projectPath` / dacpac path. */
    readonly workspaceRoot?: string;
    /** Required to sync a live `Connection` inner source. */
    readonly sourceConnectionStringResolver?: SourceConnectionStringResolver;
    /** Required to sync a `Dacpac` inner source (publish-to-throwaway then extract). */
    readonly dacpacDecomposer?: DacpacDecomposer;
}

/** Outcome of a sync: where the committed project was written, and how much. */
export interface SchemaSyncResult {
    /** Absolute directory the `.sql` tree + `.sqlproj` were written to. */
    readonly projectDir: string;
    /** Absolute path to the synthesized `.sqlproj`. */
    readonly projectFile: string;
    /** Number of `.sql` files written (0 for an empty schema). */
    readonly fileCount: number;
}

/** A shadow source: an inner authoring source plus where its project is synced. */
export interface ShadowSyncSource {
    readonly source: ShadowInnerSource;
    readonly projectPath?: string;
}

/**
 * Decomposes a shadow source's inner input into a committed `.sqlproj` tree at
 * its `projectPath`. Throws `SchemaResolutionError` when the source cannot be
 * synced (no `projectPath`, or the required seam for the inner kind is missing).
 */
export async function syncSchemaProject(
    shadow: ShadowSyncSource,
    processes: ProcessProvider,
    options: SchemaSyncOptions,
    signal: AbortSignal,
): Promise<SchemaSyncResult> {
    if (shadow.projectPath === undefined) {
        throw new SchemaResolutionError(
            "Cannot sync a shadow source without a projectPath (where the generated sqlproj is written).",
        );
    }
    const sqlpackageCommand = options.sqlpackageCommand ?? DEFAULT_SQLPACKAGE_COMMAND;
    const projectDir = resolveAgainstWorkspace(shadow.projectPath, options.workspaceRoot);
    const projectName = shadowProjectName(shadow.projectPath);

    if (shadow.source.kind === SourceOfTruthKind.Connection) {
        await syncFromConnection(
            shadow.source.connectionProfileId,
            projectDir,
            projectName,
            processes,
            sqlpackageCommand,
            options,
            signal,
        );
    } else {
        await syncFromDacpac(
            shadow.source.path,
            projectDir,
            projectName,
            processes,
            sqlpackageCommand,
            options,
            signal,
        );
    }

    return {
        projectDir,
        projectFile: path.join(projectDir, `${projectName}.sqlproj`),
        fileCount: await countSqlFiles(projectDir),
    };
}

/** Live-database inner source: resolve to a connection string and decompose it. */
async function syncFromConnection(
    connectionProfileId: string,
    projectDir: string,
    projectName: string,
    processes: ProcessProvider,
    sqlpackageCommand: string,
    options: SchemaSyncOptions,
    signal: AbortSignal,
): Promise<void> {
    const resolver = options.sourceConnectionStringResolver;
    if (resolver === undefined) {
        throw new SchemaResolutionError(
            "Syncing a live-database source requires a connection resolver, but none was wired.",
        );
    }
    let connectionString: string;
    try {
        connectionString = await resolver(connectionProfileId, signal);
    } catch (err) {
        throw new SchemaResolutionError(
            `Failed to resolve the source connection "${connectionProfileId}": ${errorText(err)}`,
            err,
        );
    }
    await decomposeConnectionToProject(
        connectionString,
        projectDir,
        projectName,
        processes,
        sqlpackageCommand,
        signal,
    );
}

/** Dacpac inner source: publish to a throwaway DB via the seam, then decompose it. */
async function syncFromDacpac(
    dacpacRelativeOrAbsolutePath: string,
    projectDir: string,
    projectName: string,
    processes: ProcessProvider,
    sqlpackageCommand: string,
    options: SchemaSyncOptions,
    signal: AbortSignal,
): Promise<void> {
    const decomposer = options.dacpacDecomposer;
    if (decomposer === undefined) {
        throw new SchemaResolutionError(
            "Syncing a dacpac source requires a dacpac decomposer (publish-to-throwaway), but none was wired.",
        );
    }
    const dacpacPath = resolveAgainstWorkspace(dacpacRelativeOrAbsolutePath, options.workspaceRoot);
    const throwaway = await decomposer(dacpacPath, signal);
    try {
        await decomposeConnectionToProject(
            throwaway.connectionString,
            projectDir,
            projectName,
            processes,
            sqlpackageCommand,
            signal,
        );
    } finally {
        await throwaway.dispose();
    }
}

/** Counts `.sql` files under `dir` recursively (0 when the directory is absent). */
async function countSqlFiles(dir: string): Promise<number> {
    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return 0;
    }
    let count = 0;
    for (const entry of entries) {
        if (entry.isDirectory()) {
            count += await countSqlFiles(path.join(dir, entry.name));
        } else if (entry.name.toLowerCase().endsWith(".sql")) {
            count += 1;
        }
    }
    return count;
}

/** Normalizes an unknown thrown value to a message string. */
function errorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/**
 * Walks up from `projectDir`'s parent to `workspaceRoot` (inclusive) looking for
 * a folder that holds a `.sqlproj`. SDK-style SQL projects recursively include
 * every `.sql` file beneath their own folder, so a shadow project written
 * *inside* such a folder is absorbed into that project's build and fails with
 * duplicate-object errors. Returns the absolute path of the nearest enclosing
 * `.sqlproj`, or `undefined` when the shadow project sits outside every other
 * project. The walk stops at `workspaceRoot` so it never inspects folders above
 * the open workspace.
 */
export async function findEnclosingSqlProject(
    projectDir: string,
    workspaceRoot: string | undefined,
): Promise<string | undefined> {
    const stopAt = workspaceRoot !== undefined ? path.resolve(workspaceRoot) : undefined;
    let current = path.dirname(path.resolve(projectDir));
    for (let depth = 0; depth < 64; depth++) {
        const enclosing = await firstSqlProjIn(current);
        if (enclosing !== undefined) {
            return enclosing;
        }
        if (stopAt !== undefined && current === stopAt) {
            break;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
    return undefined;
}

/** Absolute path of the first `.sqlproj` file directly inside `dir`, or `undefined`. */
async function firstSqlProjIn(dir: string): Promise<string | undefined> {
    let entries: string[];
    try {
        entries = await fs.readdir(dir);
    } catch {
        return undefined;
    }
    const match = entries.find((name) => name.toLowerCase().endsWith(".sqlproj"));
    return match !== undefined ? path.join(dir, match) : undefined;
}
