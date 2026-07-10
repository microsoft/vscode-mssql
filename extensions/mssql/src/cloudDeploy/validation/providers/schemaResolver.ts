/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — schema-to-dacpac resolver.
 *
 * One chokepoint that turns any `SourceOfTruth` into a `.dacpac` path the
 * ephemeral-database providers publish into the throwaway database. Shared by
 * every runtime host (Docker and connection) so the "what schema?" logic lives
 * in exactly one place and each host only owns "where does the throwaway live?".
 *
 * Four source kinds, four paths:
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
 *   * `Shadow` — decompose an inner source into a deterministic, git-diffable
 *     `.sqlproj` (a `sqlpackage /Action:Extract` with a project-style
 *     `ExtractTarget`), then `dotnet build` that shadow project into a dacpac.
 *     Phase 1 decomposes a live `Connection`; a `Dacpac` inner source is
 *     rejected until a later phase. `dispose()` removes the shadow tree.
 *
 * The resolver throws `SchemaResolutionError` on any failure; callers (the
 * providers) wrap it as an `EphemeralProvisionError` so the run surfaces a
 * single provisioning-failure shape regardless of which step failed.
 */

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";

import { ShadowInnerSource, SourceOfTruth, SourceOfTruthKind } from "../../environments/types";
import { ProcessProvider, ProcessResult, describeProcessFailure } from "./processProvider";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_DOTNET_COMMAND = "dotnet";
const DEFAULT_SQLPACKAGE_COMMAND = "sqlpackage";

/** Synthetic project name for a shadow (decomposed) source; sets the dacpac filename. */
const SHADOW_PROJECT_NAME = "ShadowDb";
/**
 * Pinned `Microsoft.Build.Sql` SDK version for the synthesized shadow project;
 * `dotnet build` restores it from NuGet. Revisit when the SDK is vendored or a
 * newer pin is confirmed.
 */
const SHADOW_SQL_SDK_VERSION = "1.0.0";
/**
 * Default target platform (DSP) for the synthesized shadow project. A fixed
 * modern default until it is derived from the extracted model.
 */
const SHADOW_TARGET_PLATFORM = "Microsoft.Data.Tools.Schema.Sql.Sql160DatabaseSchemaProvider";

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
        case SourceOfTruthKind.Shadow:
            // With a projectPath, the synced (committed) sqlproj is the schema, so
            // build it like a normal sqlproj — this is what runs in CI. Without
            // one, decompose ephemerally for a local validate-only check.
            return sourceOfTruth.projectPath !== undefined
                ? buildSqlProj(
                      shadowProjectFilePath(sourceOfTruth.projectPath),
                      processes,
                      options,
                      signal,
                  )
                : resolveShadowProject(sourceOfTruth.source, processes, options, signal);
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
// Shadow — decompose an inner source into a synthetic .sqlproj, then build it
// =============================================================================

/**
 * Decomposes a shadow source into a deterministic `.sqlproj` and builds it into
 * a dacpac. Phase 1 handles a live `Connection`: `sqlpackage /Action:Extract`
 * with `ExtractTarget=SchemaObjectType` writes a canonical one-object-per-file
 * tree, which is normalized for byte-stable diffs, wrapped in a synthesized
 * SDK-style project, and built via the shared `buildSqlProj` path. A `Dacpac`
 * inner source is rejected until the dacpac-decomposition phase.
 */
async function resolveShadowProject(
    source: ShadowInnerSource,
    processes: ProcessProvider,
    options: SchemaResolverOptions,
    signal: AbortSignal,
): Promise<ResolvedSchema> {
    if (source.kind === SourceOfTruthKind.Dacpac) {
        throw new SchemaResolutionError(
            "Shadow decomposition of a dacpac is not supported yet; use a live connection source.",
        );
    }

    const resolver = options.sourceConnectionStringResolver;
    if (resolver === undefined) {
        throw new SchemaResolutionError(
            "A shadow (decomposed) source of truth requires a connection resolver, but none was wired.",
        );
    }
    const sqlpackageCommand = options.sqlpackageCommand ?? DEFAULT_SQLPACKAGE_COMMAND;

    let sourceConnectionString: string;
    try {
        sourceConnectionString = await resolver(source.connectionProfileId, signal);
    } catch (err) {
        throw new SchemaResolutionError(
            `Failed to resolve the source database connection "${source.connectionProfileId}": ${errorText(err)}`,
            err,
        );
    }

    const shadowRoot = makeTempBuildDir();
    const projectDir = path.join(shadowRoot, "proj");
    let built: ResolvedSchema;
    try {
        await decomposeConnectionToProject(
            sourceConnectionString,
            projectDir,
            SHADOW_PROJECT_NAME,
            processes,
            sqlpackageCommand,
            signal,
        );
        built = await buildSqlProj(
            path.join(projectDir, `${SHADOW_PROJECT_NAME}.sqlproj`),
            processes,
            options,
            signal,
        );
    } catch (err) {
        await removeDir(shadowRoot);
        throw err;
    }

    // The build output (buildSqlProj's own temp dir) and the shadow tree are
    // both cleaned; the caller consumes the dacpac before calling dispose().
    return {
        dacpacPath: built.dacpacPath,
        dispose: async () => {
            await built.dispose();
            await removeDir(shadowRoot);
        },
    };
}

/** Contents of the synthesized SDK-style shadow project (includes every `.sql` file by convention). */
export function shadowProjectFile(projectName: string): string {
    return [
        `<Project Sdk="Microsoft.Build.Sql/${SHADOW_SQL_SDK_VERSION}">`,
        "    <PropertyGroup>",
        `        <Name>${projectName}</Name>`,
        `        <DSP>${SHADOW_TARGET_PLATFORM}</DSP>`,
        "    </PropertyGroup>",
        "</Project>",
        "",
    ].join("\n");
}

/** Project name for a shadow `projectPath` (a directory): its base name. */
export function shadowProjectName(projectPath: string): string {
    return path.basename(projectPath);
}

/** The directory-named `.sqlproj` a shadow `projectPath` (a directory) contains. */
export function shadowProjectFilePath(projectPath: string): string {
    return path.join(projectPath, `${shadowProjectName(projectPath)}.sqlproj`);
}

/**
 * Decomposes a live database (given its connection string) into a deterministic,
 * git-diffable `.sqlproj` tree under `targetProjectDir`: a canonical
 * `sqlpackage /Action:Extract … ExtractTarget=SchemaObjectType`, normalized for
 * byte-stable diffs, wrapped in a synthesized SDK-style project named
 * `projectName`. The tree persists (no cleanup) so callers can commit it; a
 * re-sync clears the previous tree first so removed objects drop out cleanly.
 */
export async function decomposeConnectionToProject(
    sourceConnectionString: string,
    targetProjectDir: string,
    projectName: string,
    processes: ProcessProvider,
    sqlpackageCommand: string,
    signal: AbortSignal,
): Promise<void> {
    // The SchemaObjectType extract creates its own target directory and fails if
    // it already exists, so ensure the parent exists and clear any prior tree.
    await fs.mkdir(path.dirname(targetProjectDir), { recursive: true });
    await removeDir(targetProjectDir);
    await runProcess(
        processes,
        sqlpackageCommand,
        [
            "/Action:Extract",
            `/SourceConnectionString:${sourceConnectionString}`,
            `/TargetFile:${targetProjectDir}`,
            "/p:ExtractTarget=SchemaObjectType",
            "/p:ExtractAllTableData=false",
        ],
        signal,
        "decompose the database into a shadow project",
    );
    // A source with no objects can leave the dir absent; ensure it before write.
    await fs.mkdir(targetProjectDir, { recursive: true });
    await normalizeSqlTree(targetProjectDir);
    await fs.writeFile(
        path.join(targetProjectDir, `${projectName}.sqlproj`),
        shadowProjectFile(projectName),
        "utf8",
    );
}

/**
 * Normalizes every `.sql` file under `dir` in place for byte-stable diffs: line
 * endings to LF, trailing whitespace trimmed, exactly one terminating newline.
 * SQL statement bodies are otherwise untouched — sqlpackage owns their layout.
 */
async function normalizeSqlTree(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            await normalizeSqlTree(full);
        } else if (entry.name.toLowerCase().endsWith(".sql")) {
            const raw = await fs.readFile(full, "utf8");
            await fs.writeFile(full, normalizeSqlText(raw), "utf8");
        }
    }
}

/** LF endings, no trailing whitespace, single terminating newline. */
function normalizeSqlText(text: string): string {
    const lines = text.split(/\r\n|\r|\n/).map((line) => line.replace(/[ \t]+$/, ""));
    while (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
    }
    return `${lines.join("\n")}\n`;
}

// =============================================================================
// Helpers
// =============================================================================

/** Resolves a (possibly workspace-relative) path to absolute when a workspace
 * root is configured; leaves already-absolute paths untouched. */
export function resolveAgainstWorkspace(p: string, workspaceRoot: string | undefined): string {
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
