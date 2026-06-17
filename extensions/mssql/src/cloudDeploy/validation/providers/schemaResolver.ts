/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — schema-to-dacpac resolver (Scope 2).
 *
 * One chokepoint that turns any `SourceOfTruth` into a `.dacpac` path the
 * ephemeral-database providers publish into the throwaway database. Shared by
 * every runtime host (Docker and connection) so the "what schema?" logic lives
 * in exactly one place and each host only owns "where does the throwaway live?".
 *
 * Three source kinds, three paths:
 *   * `SqlProj` — `dotnet build` the project into a dacpac. The build writes to
 *     a UNIQUE per-run temp directory (isolating both `bin` via `-o` and `obj`
 *     via `/p:BaseIntermediateOutputPath`) which `dispose()` removes. A shared
 *     output directory would let two overlapping runs of the same project
 *     deadlock on MSBuild file locks, so isolation is load-bearing, not tidiness.
 *   * `Dacpac` — already compiled; return its (workspace-resolved) path directly.
 *     `dispose()` is a no-op (we did not create it).
 *   * `Connection` — a live database is the source: `sqlpackage /Action:Extract`
 *     reads its schema READ-ONLY into a temp dacpac, which `dispose()` removes.
 *     The live database is never written to and never validated against — only
 *     its shape is extracted.
 *
 * The resolver throws `SchemaResolutionError` on any failure; callers (the
 * providers) wrap it as an `EphemeralProvisionError` so the run surfaces a
 * single provisioning-failure shape regardless of which step failed.
 */

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";

import { SourceOfTruth, SourceOfTruthKind } from "../../environments/types";
import { ProcessProvider, ProcessResult, describeProcessFailure } from "./processProvider";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_DOTNET_COMMAND = "dotnet";
const DEFAULT_SQLPACKAGE_COMMAND = "sqlpackage";

// =============================================================================
// Public types
// =============================================================================

/**
 * Builds a connection string (password included) for a saved connection
 * profile, used as the `sqlpackage /Action:Extract` source when a live
 * database is the source of truth. Supplied by the host glue (it knows how to
 * turn a profile id into a connection string); omitted when no `connection`
 * source is in play.
 */
export type SourceConnectionStringResolver = (
    connectionProfileId: string,
    signal: AbortSignal,
) => Promise<string>;

/** Knobs for `resolveSchemaToDacpac`. Production wires resolved executable paths. */
export interface SchemaResolverOptions {
    /** `dotnet` executable, used to build a `.sqlproj` into a `.dacpac`. */
    readonly dotnetCommand?: string;
    /** `sqlpackage` executable, used to extract a live database's schema. */
    readonly sqlpackageCommand?: string;
    /**
     * Workspace root used to resolve a workspace-relative source path to an
     * absolute path before spawning, so the build/extract never depends on the
     * spawned process's working directory.
     */
    readonly workspaceRoot?: string;
    /**
     * Explicit build output directory. When provided it is used as-is and never
     * auto-removed (the caller owns it); when omitted a unique per-run temp
     * directory is created and removed by `dispose()`. Tests pin this for
     * deterministic paths; production leaves it unset to get the isolation.
     */
    readonly buildOutputDirectory?: string;
    /** Required only when a `Connection` (live-DB) source of truth is resolved. */
    readonly sourceConnectionStringResolver?: SourceConnectionStringResolver;
}

/**
 * A resolved dacpac ready to publish. `dispose()` releases any temp directory
 * the resolution created (the `.sqlproj` build output or the extracted dacpac);
 * it is idempotent and best-effort, and a no-op for a pre-built dacpac source.
 * Callers MUST call it once the dacpac has been consumed (typically in a
 * `finally` right after publish).
 */
export interface ResolvedSchema {
    readonly dacpacPath: string;
    dispose(): Promise<void>;
}

/** Thrown when resolving a source of truth to a dacpac fails. */
export class SchemaResolutionError extends Error {
    public constructor(
        message: string,
        public readonly cause?: unknown,
    ) {
        super(message);
        this.name = "SchemaResolutionError";
    }
}

// =============================================================================
// resolveSchemaToDacpac
// =============================================================================

/**
 * Resolves `sourceOfTruth` to a `.dacpac` on disk, returning the path plus a
 * `dispose()` that cleans up any temp directory created. Dispatches by source
 * kind (build / passthrough / extract). Throws `SchemaResolutionError` on any
 * failure; honors `signal` (an abort abandons the in-flight build/extract).
 */
export async function resolveSchemaToDacpac(
    sourceOfTruth: SourceOfTruth,
    processes: ProcessProvider,
    options: SchemaResolverOptions,
    signal: AbortSignal,
): Promise<ResolvedSchema> {
    switch (sourceOfTruth.kind) {
        case SourceOfTruthKind.Dacpac:
            return {
                dacpacPath: resolveAgainstWorkspace(sourceOfTruth.path, options.workspaceRoot),
                dispose: async () => {
                    // Pre-built dacpac — we did not create it, nothing to remove.
                },
            };
        case SourceOfTruthKind.SqlProj:
            return buildSqlProj(sourceOfTruth.path, processes, options, signal);
        case SourceOfTruthKind.Connection:
            return extractLiveDatabase(
                sourceOfTruth.connectionProfileId,
                processes,
                options,
                signal,
            );
        default: {
            // Exhaustive: every `SourceOfTruth` arm is handled above. A future
            // additive kind trips this guard instead of silently resolving to
            // nothing.
            const exhaustive: never = sourceOfTruth;
            throw new SchemaResolutionError(
                `Unsupported source-of-truth kind: ${JSON.stringify(exhaustive)}`,
            );
        }
    }
}

// =============================================================================
// SqlProj — dotnet build into an isolated per-run directory
// =============================================================================

/** Builds a `.sqlproj` into a dacpac inside an isolated output directory. */
async function buildSqlProj(
    projectRelativeOrAbsolutePath: string,
    processes: ProcessProvider,
    options: SchemaResolverOptions,
    signal: AbortSignal,
): Promise<ResolvedSchema> {
    const dotnetCommand = options.dotnetCommand ?? DEFAULT_DOTNET_COMMAND;
    const projectPath = resolveAgainstWorkspace(
        projectRelativeOrAbsolutePath,
        options.workspaceRoot,
    );

    // A caller-pinned output directory is used as-is and never auto-removed;
    // otherwise build into a unique per-run temp directory so concurrent builds
    // of the same project never share `bin`/`obj` and deadlock on MSBuild file
    // locks. The intermediate (`obj`) directory is isolated too — MSBuild locks
    // there as well, so isolating only `bin` would not prevent the deadlock.
    const usesTempDir = options.buildOutputDirectory === undefined;
    const buildRoot = options.buildOutputDirectory ?? makeTempBuildDir();
    const binDir = usesTempDir ? path.join(buildRoot, "bin") : buildRoot;
    const args = ["build", projectPath, "/nologo", "/p:NetCoreBuild=true", "-o", binDir];
    if (usesTempDir) {
        // MSBuild requires a trailing separator on BaseIntermediateOutputPath.
        args.push(`/p:BaseIntermediateOutputPath=${path.join(buildRoot, "obj")}${path.sep}`);
    }

    try {
        await runProcess(
            processes,
            dotnetCommand,
            args,
            signal,
            "build the SQL project into a dacpac",
        );
    } catch (err) {
        await removeDirIf(usesTempDir, buildRoot);
        throw err;
    }

    return {
        dacpacPath: dacpacPathFor(projectPath, binDir),
        dispose: () => removeDirIf(usesTempDir, buildRoot),
    };
}

// =============================================================================
// Connection — sqlpackage Extract a live database's schema (read-only)
// =============================================================================

/** Extracts a live database's schema into a temp dacpac via sqlpackage. */
async function extractLiveDatabase(
    connectionProfileId: string,
    processes: ProcessProvider,
    options: SchemaResolverOptions,
    signal: AbortSignal,
): Promise<ResolvedSchema> {
    const resolver = options.sourceConnectionStringResolver;
    if (resolver === undefined) {
        throw new SchemaResolutionError(
            "A live-database source of truth requires a connection resolver, but none was wired.",
        );
    }
    const sqlpackageCommand = options.sqlpackageCommand ?? DEFAULT_SQLPACKAGE_COMMAND;

    let sourceConnectionString: string;
    try {
        sourceConnectionString = await resolver(connectionProfileId, signal);
    } catch (err) {
        throw new SchemaResolutionError(
            `Failed to resolve the source database connection "${connectionProfileId}": ${errorText(err)}`,
            err,
        );
    }

    const extractDir = makeTempBuildDir();
    const dacpacPath = path.join(extractDir, "extracted-source.dacpac");
    try {
        // sqlpackage does not create the target file's directory, so make it
        // first (unlike `dotnet build -o`, which creates its output directory).
        await fs.mkdir(extractDir, { recursive: true });
        await runProcess(
            processes,
            sqlpackageCommand,
            [
                "/Action:Extract",
                `/SourceConnectionString:${sourceConnectionString}`,
                `/TargetFile:${dacpacPath}`,
                "/p:ExtractAllTableData=false",
            ],
            signal,
            "extract the live database schema",
        );
    } catch (err) {
        await removeDir(extractDir);
        throw err;
    }

    return {
        dacpacPath,
        dispose: () => removeDir(extractDir),
    };
}

// =============================================================================
// Helpers
// =============================================================================

/** Resolves a (possibly workspace-relative) path to absolute when a workspace
 * root is configured; leaves already-absolute paths untouched. */
function resolveAgainstWorkspace(p: string, workspaceRoot: string | undefined): string {
    if (path.isAbsolute(p) || workspaceRoot === undefined) {
        return p;
    }
    return path.resolve(workspaceRoot, p);
}

/** A unique per-run temp directory under the OS temp root. */
function makeTempBuildDir(): string {
    return path.join(os.tmpdir(), `cloud-deploy-build-${randomUUID()}`);
}

/** Expected dacpac path for a built `.sqlproj` in `outputDir`. */
function dacpacPathFor(sqlprojPath: string, outputDir: string): string {
    const base = path.basename(sqlprojPath).replace(/\.sqlproj$/i, "");
    return path.join(outputDir, `${base}.dacpac`);
}

/** Removes `dir` recursively when `when` is true; best-effort, never throws. */
async function removeDirIf(when: boolean, dir: string): Promise<void> {
    if (!when) {
        return;
    }
    await removeDir(dir);
}

/** Removes `dir` recursively; best-effort, never throws. */
async function removeDir(dir: string): Promise<void> {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

/** Spawns a command and turns a non-zero exit / abort into a `SchemaResolutionError`. */
async function runProcess(
    processes: ProcessProvider,
    command: string,
    args: readonly string[],
    signal: AbortSignal,
    action: string,
): Promise<ProcessResult> {
    let result: ProcessResult;
    try {
        result = await processes.spawn(command, args, { signal });
    } catch (err) {
        throw new SchemaResolutionError(`Failed to ${action}: ${errorText(err)}`, err);
    }
    if (result.aborted) {
        throw new SchemaResolutionError(`Cancelled while trying to ${action}.`);
    }
    if (result.exitCode !== 0) {
        throw new SchemaResolutionError(`Failed to ${action}: ${describeProcessFailure(result)}`);
    }
    return result;
}

/** Normalizes an unknown thrown value to a message string. */
function errorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
