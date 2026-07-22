/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Trusted, exact-revision Entity Framework relational-model extraction.
 *
 * The caller must put this operation behind an explicit approval gate: restoring and building
 * a project, loading its design-time factory, and creating its DbContext execute repository code.
 * This provider makes that effect reproducible and bounded; it does not make repository code safe.
 */

import * as crypto from "crypto";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { DOMParser, type Element as XmlElement } from "@xmldom/xmldom";
import { GitRevisionSnapshotResult, materializeGitRevision } from "./gitRevisionMaterializer";
import {
    createLocalEfRelationalModel,
    LocalEfRelationalColumn,
    LocalEfRelationalForeignKey,
    LocalEfRelationalIndex,
    LocalEfRelationalKey,
    LocalEfRelationalModel,
    LocalEfRelationalTable,
} from "./localEfRelationalModel";

const MAX_PROJECT_BYTES = 512 * 1024;
const MAX_EXPORTER_SOURCE_BYTES = 512 * 1024;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_PROCESS_OUTPUT_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DOTNET_VERSION_TIMEOUT_MS = 30 * 1000;
const SUPPORTED_TARGET_FRAMEWORK = /^net(?:8|9|10)\.0$/;
const EXACT_PACKAGE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export interface LocalEfRelationalExtractionRequest {
    repositoryPath: string;
    revision: string;
    projectPath: string;
    dbContext: string;
    temporaryParentPath: string;
    exporterProgramPath: string;
    trustedWorkspaceRoots: readonly string[];
    timeoutMs?: number;
}

export interface LocalEfRelationalExtractionResult {
    model: LocalEfRelationalModel;
    snapshot: GitRevisionSnapshotResult;
    dotnetVersion: string;
    providerPackageVersion: string;
    designPackageVersion: string;
    diagnostics: string[];
}

export class LocalEfRelationalExtractionError extends Error {
    public constructor(
        public readonly stage:
            | "validate"
            | "snapshot"
            | "dotnet"
            | "restore"
            | "build"
            | "extract"
            | "manifest",
        message: string,
        public readonly diagnostics: string[] = [],
    ) {
        super(message);
        this.name = "LocalEfRelationalExtractionError";
    }
}

interface EfProjectMetadata {
    targetFramework: string;
    assemblyName: string;
    providerVersion: string;
    designVersion: string;
}

interface ProcessResult {
    stdout: string;
    stderr: string;
}

/**
 * Materialize, restore, build, and inspect one committed EF project revision. The unique scratch
 * directory is removed on every exit and the source repository, checkout, and index are untouched.
 */
export async function extractLocalEfRelationalModel(
    request: LocalEfRelationalExtractionRequest,
    isCancellationRequested: () => boolean,
): Promise<LocalEfRelationalExtractionResult> {
    const projectPath = validateRelativeProjectPath(request.projectPath);
    const dbContext = validateDbContext(request.dbContext);
    const timeoutMs = validateTimeout(request.timeoutMs);
    const exporterSource = await readBoundedRegularFile(
        request.exporterProgramPath,
        MAX_EXPORTER_SOURCE_BYTES,
        "Entity Framework exporter source",
    );
    const scratchParent = path.resolve(request.temporaryParentPath);
    await fs.promises.mkdir(scratchParent, { recursive: true });
    const scratchRoot = path.join(scratchParent, `.rbs-ef-${crypto.randomUUID()}`);
    const snapshotRoot = path.join(scratchRoot, "source");
    const toolRoot = path.join(scratchRoot, "exporter");
    let snapshot: GitRevisionSnapshotResult;
    try {
        await fs.promises.mkdir(scratchRoot);
        try {
            snapshot = await materializeGitRevision({
                trustedWorkspaceRoots: request.trustedWorkspaceRoots,
                requestedRepository: request.repositoryPath,
                requestedRef: request.revision,
                destinationRoot: snapshotRoot,
                isCancellationRequested,
            });
        } catch (error) {
            throw extractionError(
                "snapshot",
                "The exact Git revision could not be materialized.",
                error,
            );
        }
        ensureNotCancelled(isCancellationRequested);
        const absoluteProjectPath = resolveSnapshotFile(snapshotRoot, projectPath);
        const projectXml = await readBoundedRegularFile(
            absoluteProjectPath,
            MAX_PROJECT_BYTES,
            "Entity Framework project",
        );
        const metadata = readEfProjectMetadata(projectXml, absoluteProjectPath);
        await fs.promises.mkdir(toolRoot);
        const copiedExporterSource = path.join(toolRoot, "Program.cs");
        await fs.promises.writeFile(copiedExporterSource, exporterSource, { flag: "wx" });
        const exporterProjectPath = path.join(toolRoot, "RunbookEfExporter.csproj");
        await fs.promises.writeFile(
            exporterProjectPath,
            createExporterProject(absoluteProjectPath, metadata),
            { encoding: "utf8", flag: "wx" },
        );
        const environment = createIsolatedDotnetEnvironment();
        const redactedRoots = [scratchRoot, snapshot.repositoryRoot];
        const dotnet = await runDotnet(
            ["--version"],
            toolRoot,
            environment,
            DOTNET_VERSION_TIMEOUT_MS,
            isCancellationRequested,
            "dotnet",
            redactedRoots,
        );
        const dotnetVersion = dotnet.stdout.trim();
        if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(dotnetVersion)) {
            throw new LocalEfRelationalExtractionError(
                "dotnet",
                "The installed .NET SDK returned an invalid version.",
            );
        }
        const restore = await runDotnet(
            ["restore", exporterProjectPath, "--disable-parallel", "--nologo"],
            toolRoot,
            environment,
            timeoutMs,
            isCancellationRequested,
            "restore",
            redactedRoots,
        );
        const build = await runDotnet(
            [
                "build",
                exporterProjectPath,
                "--configuration",
                "Release",
                "--no-restore",
                "--nologo",
                "--maxcpucount:1",
                "-p:UseSharedCompilation=false",
                "-p:MSBuildEnableWorkloadResolver=false",
            ],
            toolRoot,
            environment,
            timeoutMs,
            isCancellationRequested,
            "build",
            redactedRoots,
        );
        const outputRoot = path.join(toolRoot, "bin", "Release", metadata.targetFramework);
        const exporterDll = path.join(outputRoot, "RunbookEfExporter.dll");
        const applicationDll = path.join(outputRoot, `${metadata.assemblyName}.dll`);
        const manifestPath = path.join(scratchRoot, "model.json");
        await requireRegularFile(exporterDll, "Entity Framework exporter assembly");
        await requireRegularFile(applicationDll, "Entity Framework application assembly");
        const extraction = await runDotnet(
            [exporterDll, applicationDll, dbContext, manifestPath],
            outputRoot,
            environment,
            timeoutMs,
            isCancellationRequested,
            "extract",
            redactedRoots,
        );
        const manifestJson = await readBoundedRegularFile(
            manifestPath,
            MAX_MANIFEST_BYTES,
            "Entity Framework relational manifest",
        );
        const manifest = parseExporterManifest(manifestJson);
        const expectedRuntimeTarget = `.NETCoreApp,Version=v${metadata.targetFramework.slice(3)}`;
        if (manifest.runtimeTargetFramework !== expectedRuntimeTarget) {
            throw new LocalEfRelationalExtractionError(
                "manifest",
                "The extracted Entity Framework target framework does not match the reviewed project.",
            );
        }
        if (
            manifest.model.provider.name !== "Microsoft.EntityFrameworkCore.SqlServer" ||
            numericPackageVersion(manifest.model.provider.version) !==
                numericPackageVersion(metadata.providerVersion)
        ) {
            throw new LocalEfRelationalExtractionError(
                "manifest",
                "The extracted Entity Framework provider does not match the reviewed SQL Server package.",
            );
        }
        const toolchainSha256 = digest({
            schemaVersion: 1,
            dotnetVersion,
            exporterSha256: sha256(exporterSource),
            targetFramework: metadata.targetFramework,
            providerPackage: "Microsoft.EntityFrameworkCore.SqlServer",
            providerPackageVersion: metadata.providerVersion,
            designPackageVersion: metadata.designVersion,
        });
        const model = createLocalEfRelationalModel({
            ...manifest.model,
            source: {
                commit: snapshot.commit,
                projectPath,
                dbContext,
                targetFramework: metadata.targetFramework,
                sourceSnapshotSha256: snapshot.snapshotSha256,
                toolchainSha256,
            },
        });
        return {
            model,
            snapshot,
            dotnetVersion,
            providerPackageVersion: metadata.providerVersion,
            designPackageVersion: metadata.designVersion,
            diagnostics: boundedDiagnostics(
                [restore.stdout, restore.stderr, build.stdout, build.stderr, extraction.stderr],
                redactedRoots,
            ),
        };
    } finally {
        await fs.promises.rm(scratchRoot, { recursive: true, force: true }).catch(() => undefined);
    }
}

export function readEfProjectMetadata(projectXml: Buffer, projectPath: string): EfProjectMetadata {
    const document = new DOMParser().parseFromString(projectXml.toString("utf8"), "text/xml");
    if (!document?.documentElement || document.getElementsByTagName("parsererror").length > 0) {
        throw new LocalEfRelationalExtractionError(
            "validate",
            "The Entity Framework project XML is invalid.",
        );
    }
    const targetFrameworks = elementTexts(document.getElementsByTagName("TargetFramework"));
    const pluralFrameworks = elementTexts(document.getElementsByTagName("TargetFrameworks"));
    if (pluralFrameworks.length > 0 || targetFrameworks.length !== 1) {
        throw new LocalEfRelationalExtractionError(
            "validate",
            "Entity Framework extraction currently requires one explicit TargetFramework.",
        );
    }
    const targetFramework = targetFrameworks[0];
    if (!SUPPORTED_TARGET_FRAMEWORK.test(targetFramework)) {
        throw new LocalEfRelationalExtractionError(
            "validate",
            `Entity Framework extraction does not support target framework '${targetFramework}'.`,
        );
    }
    const packages = new Map<string, string>();
    for (const node of Array.from(document.getElementsByTagName("PackageReference"))) {
        const element = node as XmlElement;
        const name = (
            element.getAttribute("Include") ??
            element.getAttribute("Update") ??
            ""
        ).trim();
        if (!name) {
            continue;
        }
        const versionAttribute = element.getAttribute("Version")?.trim();
        const versionElements = elementTexts(element.getElementsByTagName("Version"));
        const version =
            versionAttribute || (versionElements.length === 1 ? versionElements[0] : "");
        if (!version || !EXACT_PACKAGE_VERSION.test(version)) {
            if (/^Microsoft\.EntityFrameworkCore\./i.test(name)) {
                throw new LocalEfRelationalExtractionError(
                    "validate",
                    `Package '${name}' must use an exact literal version for reproducible extraction.`,
                );
            }
            continue;
        }
        packages.set(name.toLowerCase(), version);
    }
    const providerVersion = packages.get("microsoft.entityframeworkcore.sqlserver");
    if (!providerVersion) {
        throw new LocalEfRelationalExtractionError(
            "validate",
            "The project does not declare an exact Microsoft.EntityFrameworkCore.SqlServer package version.",
        );
    }
    const designVersion = packages.get("microsoft.entityframeworkcore.design") ?? providerVersion;
    if (majorVersion(providerVersion) !== majorVersion(designVersion)) {
        throw new LocalEfRelationalExtractionError(
            "validate",
            "The Entity Framework provider and design packages must have the same major version.",
        );
    }
    const assemblyNames = elementTexts(document.getElementsByTagName("AssemblyName"));
    if (assemblyNames.length > 1) {
        throw new LocalEfRelationalExtractionError(
            "validate",
            "The project has ambiguous AssemblyName values.",
        );
    }
    const assemblyName = assemblyNames[0] ?? path.basename(projectPath, path.extname(projectPath));
    if (!/^[A-Za-z0-9_.-]{1,200}$/.test(assemblyName)) {
        throw new LocalEfRelationalExtractionError(
            "validate",
            "The project AssemblyName is invalid.",
        );
    }
    return { targetFramework, assemblyName, providerVersion, designVersion };
}

function createExporterProject(projectPath: string, metadata: EfProjectMetadata): string {
    return `<!-- Generated in an extension-owned temporary directory. -->
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>${xml(metadata.targetFramework)}</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <LangVersion>latest</LangVersion>
    <AssemblyName>RunbookEfExporter</AssemblyName>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="${xml(projectPath)}" />
    <PackageReference Include="Microsoft.EntityFrameworkCore.Design" Version="${xml(metadata.designVersion)}" />
    <PackageReference Include="Microsoft.EntityFrameworkCore.Relational" Version="${xml(metadata.providerVersion)}" />
  </ItemGroup>
</Project>
`;
}

function runDotnet(
    args: string[],
    cwd: string,
    environment: NodeJS.ProcessEnv,
    timeoutMs: number,
    isCancellationRequested: () => boolean,
    stage: LocalEfRelationalExtractionError["stage"],
    redactedRoots: string[],
): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
        if (isCancellationRequested()) {
            reject(
                new LocalEfRelationalExtractionError(
                    stage,
                    "Entity Framework extraction was cancelled.",
                ),
            );
            return;
        }
        const child = spawn("dotnet", args, {
            cwd,
            env: environment,
            windowsHide: true,
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let stoppedFor: "cancelled" | "timeout" | "output" | undefined;
        const stop = (reason: typeof stoppedFor) => {
            if (stoppedFor) {
                return;
            }
            stoppedFor = reason;
            child.kill();
        };
        const timeout = setTimeout(() => stop("timeout"), timeoutMs);
        const cancellation = setInterval(() => {
            if (isCancellationRequested()) {
                stop("cancelled");
            }
        }, 50);
        child.stdout.on("data", (chunk: Buffer) => {
            stdoutBytes += chunk.byteLength;
            if (stdoutBytes > MAX_PROCESS_OUTPUT_BYTES) {
                stop("output");
                return;
            }
            stdout.push(Buffer.from(chunk));
        });
        child.stderr.on("data", (chunk: Buffer) => {
            stderrBytes += chunk.byteLength;
            if (stderrBytes > MAX_PROCESS_OUTPUT_BYTES) {
                stop("output");
                return;
            }
            stderr.push(Buffer.from(chunk));
        });
        const finish = () => {
            clearTimeout(timeout);
            clearInterval(cancellation);
        };
        child.on("error", () => {
            finish();
            reject(
                new LocalEfRelationalExtractionError(
                    stage,
                    stage === "dotnet"
                        ? "The .NET SDK is unavailable."
                        : `Entity Framework ${stage} could not start.`,
                ),
            );
        });
        child.on("close", (code) => {
            finish();
            const stdoutText = Buffer.concat(stdout).toString("utf8");
            const stderrText = Buffer.concat(stderr).toString("utf8");
            const diagnostics = boundedDiagnostics([stdoutText, stderrText], redactedRoots);
            if (stoppedFor === "cancelled") {
                reject(
                    new LocalEfRelationalExtractionError(
                        stage,
                        "Entity Framework extraction was cancelled.",
                        diagnostics,
                    ),
                );
            } else if (stoppedFor === "timeout") {
                reject(
                    new LocalEfRelationalExtractionError(
                        stage,
                        `Entity Framework ${stage} exceeded its time limit.`,
                        diagnostics,
                    ),
                );
            } else if (stoppedFor === "output") {
                reject(
                    new LocalEfRelationalExtractionError(
                        stage,
                        `Entity Framework ${stage} produced too much output.`,
                        diagnostics,
                    ),
                );
            } else if (code !== 0) {
                reject(
                    new LocalEfRelationalExtractionError(
                        stage,
                        `Entity Framework ${stage} failed.`,
                        diagnostics,
                    ),
                );
            } else {
                resolve({ stdout: stdoutText, stderr: stderrText });
            }
        });
    });
}

function createIsolatedDotnetEnvironment(): NodeJS.ProcessEnv {
    const allowed = new Set([
        "appdata",
        "home",
        "localappdata",
        "nuget_http_cache_path",
        "nuget_packages",
        "path",
        "programdata",
        "programfiles",
        "programfiles(x86)",
        "systemroot",
        "temp",
        "tmp",
        "userprofile",
        "windir",
    ]);
    const environment: NodeJS.ProcessEnv = {};
    for (const [name, value] of Object.entries(process.env)) {
        if (value !== undefined && allowed.has(name.toLowerCase())) {
            environment[name] = value;
        }
    }
    environment.DOTNET_CLI_TELEMETRY_OPTOUT = "1";
    environment.DOTNET_NOLOGO = "1";
    environment.NUGET_XMLDOC_MODE = "skip";
    return environment;
}

function parseExporterManifest(json: Buffer): {
    model: Omit<Parameters<typeof createLocalEfRelationalModel>[0], "source">;
    runtimeTargetFramework: string;
} {
    let value: unknown;
    try {
        value = JSON.parse(json.toString("utf8"));
    } catch {
        throw new LocalEfRelationalExtractionError(
            "manifest",
            "The Entity Framework relational manifest is not valid JSON.",
        );
    }
    const record = object(value, "manifest");
    const provider = object(record.provider, "provider");
    return {
        runtimeTargetFramework: text(record.targetFramework, "targetFramework"),
        model: {
            provider: {
                name: text(provider.name, "provider.name"),
                version: text(provider.version, "provider.version"),
            },
            complete: boolean(record.complete, "complete"),
            unsupported: array(record.unsupported, "unsupported").map((item, index) => {
                const fact = object(item, `unsupported[${index}]`);
                return {
                    scope: text(fact.scope, `unsupported[${index}].scope`),
                    name: text(fact.name, `unsupported[${index}].name`),
                    reason: text(fact.reason, `unsupported[${index}].reason`),
                };
            }),
            tables: array(record.tables, "tables").map(parseTable),
        },
    };
}

function parseTable(value: unknown, index: number): LocalEfRelationalTable {
    const item = object(value, `tables[${index}]`);
    return {
        schema: text(item.schema, `tables[${index}].schema`),
        name: text(item.name, `tables[${index}].name`),
        columns: array(item.columns, `tables[${index}].columns`).map(parseColumn),
        primaryKey: item.primaryKey === null ? undefined : parseKey(item.primaryKey, "primaryKey"),
        uniqueConstraints: array(item.uniqueConstraints, "uniqueConstraints").map((key) =>
            parseKey(key, "uniqueConstraint"),
        ),
        indexes: array(item.indexes, "indexes").map(parseIndex),
        foreignKeys: array(item.foreignKeys, "foreignKeys").map(parseForeignKey),
        checks: array(item.checks, "checks").map((check, checkIndex) => {
            const record = object(check, `checks[${checkIndex}]`);
            return {
                name: text(record.name, "check.name"),
                sqlSha256: text(record.sqlSha256, "check.sqlSha256"),
            };
        }),
        temporal: boolean(item.temporal, "temporal"),
    };
}

function parseColumn(value: unknown, index: number): LocalEfRelationalColumn {
    const item = object(value, `columns[${index}]`);
    const defaultKind = text(item.defaultKind, "column.defaultKind");
    if (defaultKind !== "none" && defaultKind !== "constant" && defaultKind !== "sql") {
        invalidManifest("column.defaultKind");
    }
    return {
        name: text(item.name, "column.name"),
        storeType: text(item.storeType, "column.storeType"),
        nullable: boolean(item.nullable, "column.nullable"),
        identity: boolean(item.identity, "column.identity"),
        identitySeed: optionalInteger(item.identitySeed, "column.identitySeed"),
        identityIncrement: optionalInteger(item.identityIncrement, "column.identityIncrement"),
        computed: boolean(item.computed, "column.computed"),
        maxLength: optionalInteger(item.maxLength, "column.maxLength"),
        precision: optionalInteger(item.precision, "column.precision"),
        scale: optionalInteger(item.scale, "column.scale"),
        defaultKind,
        defaultSha256: optionalText(item.defaultSha256, "column.defaultSha256"),
        computedSha256: optionalText(item.computedSha256, "column.computedSha256"),
        collation: optionalText(item.collation, "column.collation"),
    };
}

function parseKey(value: unknown, label: string): LocalEfRelationalKey {
    const item = object(value, label);
    return {
        name: text(item.name, `${label}.name`),
        columns: stringArray(item.columns, `${label}.columns`),
    };
}

function parseIndex(value: unknown, index: number): LocalEfRelationalIndex {
    const item = object(value, `indexes[${index}]`);
    return {
        ...parseKey(item, `indexes[${index}]`),
        unique: boolean(item.unique, "index.unique"),
        filterSha256: optionalText(item.filterSha256, "index.filterSha256"),
        notNullFilterColumns:
            item.notNullFilterColumns === undefined || item.notNullFilterColumns === null
                ? undefined
                : stringArray(item.notNullFilterColumns, "index.notNullFilterColumns"),
    };
}

function parseForeignKey(value: unknown, index: number): LocalEfRelationalForeignKey {
    const item = object(value, `foreignKeys[${index}]`);
    return {
        ...parseKey(item, `foreignKeys[${index}]`),
        principalSchema: text(item.principalSchema, "foreignKey.principalSchema"),
        principalTable: text(item.principalTable, "foreignKey.principalTable"),
        principalColumns: stringArray(item.principalColumns, "foreignKey.principalColumns"),
        onDelete: text(item.onDelete, "foreignKey.onDelete"),
    };
}

function validateRelativeProjectPath(value: string): string {
    const relative = value.trim().replace(/\\/g, "/");
    if (
        !relative ||
        relative === ".." ||
        relative.startsWith("../") ||
        path.posix.isAbsolute(relative) ||
        /^[A-Za-z]:\//.test(relative) ||
        !relative.toLowerCase().endsWith(".csproj") ||
        /[\u0000-\u001f\u007f]/.test(relative)
    ) {
        throw new LocalEfRelationalExtractionError(
            "validate",
            "The Entity Framework project path is invalid.",
        );
    }
    return relative;
}

function validateDbContext(value: string): string {
    const context = value.trim();
    if (!context || context.length > 512 || /[\u0000-\u001f\u007f]/.test(context)) {
        throw new LocalEfRelationalExtractionError(
            "validate",
            "The Entity Framework DbContext name is invalid.",
        );
    }
    return context;
}

function validateTimeout(value: number | undefined): number {
    const timeout = value ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeout) || timeout < 1_000 || timeout > 30 * 60 * 1000) {
        throw new LocalEfRelationalExtractionError(
            "validate",
            "The Entity Framework extraction timeout is invalid.",
        );
    }
    return timeout;
}

function resolveSnapshotFile(snapshotRoot: string, relativePath: string): string {
    const resolved = path.resolve(snapshotRoot, relativePath);
    const prefix = `${path.resolve(snapshotRoot)}${path.sep}`.toLowerCase();
    if (!resolved.toLowerCase().startsWith(prefix)) {
        throw new LocalEfRelationalExtractionError(
            "validate",
            "The Entity Framework project escaped its snapshot.",
        );
    }
    return resolved;
}

async function readBoundedRegularFile(
    filePath: string,
    limit: number,
    label: string,
): Promise<Buffer> {
    const stat = await requireRegularFile(filePath, label);
    if (stat.size > limit) {
        throw new LocalEfRelationalExtractionError("validate", `${label} exceeds its size limit.`);
    }
    return fs.promises.readFile(filePath);
}

async function requireRegularFile(filePath: string, label: string): Promise<fs.Stats> {
    let stat: fs.Stats;
    try {
        stat = await fs.promises.lstat(filePath);
    } catch {
        throw new LocalEfRelationalExtractionError("validate", `${label} does not exist.`);
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new LocalEfRelationalExtractionError("validate", `${label} is not a regular file.`);
    }
    return stat;
}

function elementTexts(nodes: ArrayLike<XmlElement>): string[] {
    return Array.from(nodes)
        .map((node) => node.textContent.trim())
        .filter((value) => value.length > 0);
}

function majorVersion(version: string): number {
    return Number(version.split(".", 1)[0]);
}

function numericPackageVersion(version: string): string {
    return version.split(/[+-]/, 1)[0].split(".").slice(0, 3).join(".");
}

function xml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function object(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        invalidManifest(label);
    }
    return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
    if (!Array.isArray(value)) {
        invalidManifest(label);
    }
    return value;
}

function text(value: unknown, label: string): string {
    if (typeof value !== "string") {
        invalidManifest(label);
    }
    return value;
}

function optionalText(value: unknown, label: string): string | undefined {
    return value === null || value === undefined ? undefined : text(value, label);
}

function boolean(value: unknown, label: string): boolean {
    if (typeof value !== "boolean") {
        invalidManifest(label);
    }
    return value;
}

function optionalInteger(value: unknown, label: string): number | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }
    if (!Number.isSafeInteger(value)) {
        invalidManifest(label);
    }
    return value as number;
}

function stringArray(value: unknown, label: string): string[] {
    return array(value, label).map((item, index) => text(item, `${label}[${index}]`));
}

function invalidManifest(label: string): never {
    throw new LocalEfRelationalExtractionError(
        "manifest",
        `The Entity Framework relational manifest has an invalid '${label}' field.`,
    );
}

function ensureNotCancelled(isCancellationRequested: () => boolean): void {
    if (isCancellationRequested()) {
        throw new LocalEfRelationalExtractionError(
            "snapshot",
            "Entity Framework extraction was cancelled.",
        );
    }
}

function extractionError(
    stage: LocalEfRelationalExtractionError["stage"],
    message: string,
    error: unknown,
): LocalEfRelationalExtractionError {
    return error instanceof LocalEfRelationalExtractionError
        ? error
        : new LocalEfRelationalExtractionError(stage, message);
}

function boundedDiagnostics(values: string[], redactedRoots: string[]): string[] {
    const replacements = redactedRoots
        .filter(Boolean)
        .sort((left, right) => right.length - left.length)
        .map((root) => new RegExp(escapeRegExp(path.normalize(root)), "gi"));
    return values
        .flatMap((value) => value.split(/\r?\n/))
        .map((line) => {
            let safe = line.replace(/\b(?:Password|Pwd)\s*=\s*[^;\s]*/gi, "credential=<redacted>");
            for (const replacement of replacements) {
                safe = safe.replace(replacement, "<path>");
            }
            return safe.trim().slice(0, 2_000);
        })
        .filter(Boolean)
        .slice(-200);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sha256(value: Buffer | string): string {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function digest(value: unknown): string {
    return sha256(JSON.stringify(value));
}
