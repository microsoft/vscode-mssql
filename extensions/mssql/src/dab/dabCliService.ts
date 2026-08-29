/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { VscodeHttpClient } from "extension-toolkit/vscode";
import * as yauzl from "yauzl";
import DotnetRuntimeProvider from "../languageservice/dotnetRuntimeProvider";
import { Dab } from "../sharedInterfaces/dab";
import { ILogger } from "../sharedInterfaces/logger";
import { getErrorMessage, uuid } from "../utils/utils";
import { DAB_CONNECTION_ENVIRONMENT_VARIABLE } from "./dabConfigFileBuilder";

const setupStateKey = "mssql.dab.cli.setupState";
const dotnetPathSetting = "mssql.dab.dotnetPath";
const packageFeeds = [
    "https://api.nuget.org/v3-flatcontainer",
    "https://packagefeedproxy.microsoft.io/nuget/v3/flat2",
];
// SHA-512 pins for the exact NuGet artifacts verified with `dotnet nuget verify --all`.
// The pinned bytes include both the Microsoft author signature and NuGet.org repository signature,
// so acquisition does not trust mutable package metadata from the download source.
const packageHashes: Record<string, string> = {
    "win32-x64":
        "vm7l9R00eHJMKkVnEUHVvJ+gPEwAeBFRgZRufM+Wu4c95hbYUk59rWF6whLcALY/R8/vaGjwrOWpW09QaWyWSg==",
    "linux-x64":
        "4h0VULbfCw3S79MkWKNkjTCxUmlGAzJVSkc6V5Cj628pnZNmxWRo5xoDovQFQAKT4BtowgJADc8XIugy78NZDQ==",
    "darwin-x64":
        "HmVT7rBhphf2mS5A46yUkbk0d60hIk0OxtLAX93moDgWPj8yngWbD3RWOp1f5YUBtFuyzlhA5pqqiRQ3nh3w5A==",
};
const ridByPlatform: Record<string, string> = {
    win32: "win-x64",
    linux: "linux-x64",
    darwin: "osx-x64",
};

interface LaunchTarget {
    dotnetPath: string;
    assemblyPath: string;
}

interface ProcessResult {
    exitCode: number | null;
    stdout: string;
    stderr: string;
}

/** Acquires the extension-pinned DAB CLI and runs config validation with it. */
export class DabCliService {
    private static readonly setupPromises = new Map<string, Promise<Dab.DabCliSetupState>>();
    private readonly installRoot: string;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly logger: ILogger,
    ) {
        this.installRoot = path.join(
            context.globalStorageUri.fsPath,
            "dab-cli",
            Dab.DAB_CLI_VERSION,
        );
    }

    public getSetupState(): Dab.DabCliSetupState {
        const state = this.context.globalState.get<Dab.DabCliSetupState>(setupStateKey);
        if (!state || state.version !== Dab.DAB_CLI_VERSION || state.status === "installing") {
            return { status: "notStarted", version: Dab.DAB_CLI_VERSION };
        }
        return state;
    }

    public async ensureInstalled(forceRetry = false): Promise<Dab.DabCliSetupState> {
        const storedState = this.getSetupState();
        if (
            !forceRetry &&
            (storedState.status === "missingRuntime" || storedState.status === "installationFailed")
        ) {
            return storedState;
        }

        if (!forceRetry && storedState.status === "ready" && (await this.getLaunchTarget())) {
            return storedState;
        }

        const inFlight = DabCliService.setupPromises.get(this.installRoot);
        if (inFlight) {
            return inFlight;
        }

        const setupPromise = this.install().finally(() => {
            DabCliService.setupPromises.delete(this.installRoot);
        });
        DabCliService.setupPromises.set(this.installRoot, setupPromise);
        return setupPromise;
    }

    public async validateConfig(
        configContent: string,
        connectionString: string,
    ): Promise<Dab.ValidateConfigResponse> {
        const setup = this.getSetupState();
        if (setup.status !== "ready") {
            return { status: "blocked", setup };
        }

        const launchTarget = await this.getLaunchTarget();
        if (!launchTarget) {
            const failed = await this.persistState({
                status: "installationFailed",
                version: Dab.DAB_CLI_VERSION,
                reason: "The installed DAB CLI files could not be found.",
            });
            return { status: "blocked", setup: failed };
        }

        await fs.mkdir(this.installRoot, { recursive: true });
        const configPath = path.join(this.installRoot, `validate-${uuid()}.json`);
        try {
            await fs.writeFile(configPath, configContent, { encoding: "utf8", mode: 0o600 });
            const result = await runProcess(
                launchTarget.dotnetPath,
                [launchTarget.assemblyPath, "validate", "--config", configPath],
                {
                    ...process.env,
                    [DAB_CONNECTION_ENVIRONMENT_VARIABLE]: connectionString,
                },
            );
            const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
            this.logger.info(`DAB validation completed with exit code ${result.exitCode}.`);
            const diagnostics = parseValidationDiagnostics(output);
            if (result.exitCode === 0) {
                return {
                    status: "valid",
                    diagnostics: diagnostics.filter(
                        (diagnostic) => diagnostic.severity === "warning",
                    ),
                };
            }
            return {
                status: "invalid",
                diagnostics:
                    diagnostics.length > 0
                        ? diagnostics
                        : [{ severity: "error", message: "DAB validation failed." }],
            };
        } catch (error) {
            const reason = getErrorMessage(error);
            const failed = await this.persistState({
                status: "installationFailed",
                version: Dab.DAB_CLI_VERSION,
                reason,
                logs: reason,
            });
            return { status: "blocked", setup: failed };
        } finally {
            await fs.rm(configPath, { force: true }).catch(() => undefined);
        }
    }

    private async install(): Promise<Dab.DabCliSetupState> {
        await this.persistState({ status: "installing", version: Dab.DAB_CLI_VERSION });
        let dotnetPath: string;
        try {
            dotnetPath = await this.resolveDotnetPath();
        } catch (error) {
            return this.persistState({
                status: "missingRuntime",
                version: Dab.DAB_CLI_VERSION,
                reason: getErrorMessage(error),
            });
        }

        try {
            const rid = this.getRuntimeIdentifier();
            const packageId = `microsoft.dataapibuilder.${rid}`;
            const packagePath = path.join(this.installRoot, `${packageId}.nupkg`);
            const extractRoot = path.join(this.installRoot, "package");
            await fs.mkdir(this.installRoot, { recursive: true });
            await this.downloadPackage(packageId, packagePath);

            await this.verifyPinnedPackage(packagePath);
            await fs.rm(extractRoot, { recursive: true, force: true });
            await extractZipSafely(packagePath, extractRoot);
            await fs.rm(packagePath, { force: true });

            const assemblyPath = this.getAssemblyPath(rid);
            await fs.access(assemblyPath);
            const result = await runProcess(dotnetPath, [assemblyPath, "--version"], process.env);
            if (result.exitCode !== 0) {
                throw new Error(result.stderr || result.stdout || "DAB CLI failed to start.");
            }

            await fs.writeFile(path.join(this.installRoot, "dotnet-path.txt"), dotnetPath, "utf8");
            return this.persistState({ status: "ready", version: Dab.DAB_CLI_VERSION });
        } catch (error) {
            const reason = getErrorMessage(error);
            this.logger.error("DAB CLI installation failed", reason);
            return this.persistState({
                status: "installationFailed",
                version: Dab.DAB_CLI_VERSION,
                reason,
                logs: reason,
            });
        }
    }

    private async resolveDotnetPath(): Promise<string> {
        const requirementPath = path.join(this.installRoot, "dab.runtimeconfig.json");
        await fs.mkdir(this.installRoot, { recursive: true });
        await fs.writeFile(
            requirementPath,
            JSON.stringify({
                runtimeOptions: {
                    tfm: "net10.0",
                    frameworks: [
                        { name: "Microsoft.NETCore.App", version: "10.0.0" },
                        { name: "Microsoft.AspNetCore.App", version: "10.0.0" },
                    ],
                },
            }),
            "utf8",
        );

        try {
            return await new DotnetRuntimeProvider(this.logger).acquireDotnetRuntime(
                requirementPath,
            );
        } catch {
            const configuredPath = vscode.workspace
                .getConfiguration()
                .get<string>(dotnetPathSetting)
                ?.trim();
            if (configuredPath) {
                await fs.access(configuredPath);
                return configuredPath;
            }
            throw new Error(
                "No .NET 10 runtime was found. Configure mssql.dab.dotnetPath and retry setup.",
            );
        }
    }

    private getRuntimeIdentifier(): string {
        if (process.arch !== "x64" || !ridByPlatform[process.platform]) {
            throw new Error(
                `DAB CLI ${Dab.DAB_CLI_VERSION} is not available for ${process.platform}-${process.arch}.`,
            );
        }
        return ridByPlatform[process.platform];
    }

    private async verifyPinnedPackage(packagePath: string): Promise<void> {
        const expectedHash = packageHashes[`${process.platform}-${process.arch}`];
        if (!expectedHash) {
            throw new Error("No trusted package hash is available for this platform.");
        }
        const packageBytes = await fs.readFile(packagePath);
        const actualHash = createHash("sha512").update(packageBytes).digest("base64");
        if (actualHash !== expectedHash) {
            throw new Error("DAB CLI package signature pin verification failed.");
        }
        if (!(await zipContainsEntry(packagePath, ".signature.p7s"))) {
            throw new Error("The DAB CLI NuGet package is not signed.");
        }
    }

    private async downloadPackage(packageId: string, packagePath: string): Promise<void> {
        const client = new VscodeHttpClient({ logger: this.logger });
        const errors: string[] = [];
        for (const feed of packageFeeds) {
            try {
                const download = await client.downloadToPath(
                    `${feed}/${packageId}/${Dab.DAB_CLI_VERSION}/${packageId}.${Dab.DAB_CLI_VERSION}.nupkg`,
                    packagePath,
                    { timeoutMs: 120_000 },
                );
                if (download.ok) {
                    return;
                }
                errors.push(`${feed}: HTTP ${download.status}`);
            } catch (error) {
                errors.push(`${feed}: ${getErrorMessage(error)}`);
            }
        }
        throw new Error(`Unable to download the DAB CLI package. ${errors.join("; ")}`);
    }

    private async getLaunchTarget(): Promise<LaunchTarget | undefined> {
        try {
            const rid = this.getRuntimeIdentifier();
            const dotnetPath = (
                await fs.readFile(path.join(this.installRoot, "dotnet-path.txt"), "utf8")
            ).trim();
            const assemblyPath = this.getAssemblyPath(rid);
            await Promise.all([fs.access(dotnetPath), fs.access(assemblyPath)]);
            return { dotnetPath, assemblyPath };
        } catch {
            return undefined;
        }
    }

    private getAssemblyPath(rid: string): string {
        return path.join(
            this.installRoot,
            "package",
            "tools",
            "net10.0",
            rid,
            "Microsoft.DataApiBuilder.dll",
        );
    }

    private async persistState(state: Dab.DabCliSetupState): Promise<Dab.DabCliSetupState> {
        await this.context.globalState.update(setupStateKey, state);
        return state;
    }
}

function runProcess(
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv,
): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { env, windowsHide: true });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
        child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
        child.on("error", reject);
        child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
    });
}

export function parseValidationDiagnostics(output: string): Dab.DabValidationDiagnostic[] {
    const diagnostics: Dab.DabValidationDiagnostic[] = [];
    let activeSeverity: Dab.DabValidationDiagnostic["severity"] | undefined;
    let lastDiagnostic: Dab.DabValidationDiagnostic | undefined;

    const addMessage = (rawMessage: string, severity: Dab.DabValidationDiagnostic["severity"]) => {
        const messages = rawMessage
            .split(/\s*>\s*/)
            .map((message) => message.trim())
            .filter(
                (message) =>
                    message.length > 0 && !/^total schema validation errors:\s*\d+$/i.test(message),
            );

        for (const raw of messages) {
            const location = raw.match(/\s+at\s+(\d+):(\d+)\.?$/i);
            const diagnostic: Dab.DabValidationDiagnostic = {
                severity,
                message: location ? raw.slice(0, location.index).trim() : raw,
                ...(location ? { line: Number(location[1]), column: Number(location[2]) } : {}),
            };
            diagnostics.push(diagnostic);
            lastDiagnostic = diagnostic;
        }
    };

    const lines = output
        .replace(/\u001b\[[0-9;]*m/g, "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    for (const line of lines) {
        const structured = line.match(/^(fail|crit|warn):\s*(.*)$/i);
        if (structured) {
            activeSeverity = /^warn$/i.test(structured[1]) ? "warning" : "error";
            addMessage(structured[2], activeSeverity);
            continue;
        }
        if (/^(trce|dbug|info):/i.test(line)) {
            activeSeverity = undefined;
            lastDiagnostic = undefined;
            continue;
        }
        if (!activeSeverity) {
            continue;
        }
        if (line.startsWith(">")) {
            addMessage(line, activeSeverity);
        } else if (lastDiagnostic) {
            lastDiagnostic.message += `\n${line}`;
        } else {
            addMessage(line, activeSeverity);
        }
    }

    return diagnostics;
}

function zipContainsEntry(zipPath: string, expectedEntry: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
        yauzl.open(zipPath, { lazyEntries: true }, (error, zipFile) => {
            if (error || !zipFile) {
                reject(error ?? new Error("Unable to read NuGet package."));
                return;
            }
            zipFile.readEntry();
            zipFile.on("entry", (entry) => {
                if (entry.fileName === expectedEntry) {
                    zipFile.close();
                    resolve(true);
                } else {
                    zipFile.readEntry();
                }
            });
            zipFile.on("end", () => resolve(false));
            zipFile.on("error", reject);
        });
    });
}

function extractZipSafely(zipPath: string, destination: string): Promise<void> {
    return new Promise((resolve, reject) => {
        yauzl.open(zipPath, { lazyEntries: true }, (error, zipFile) => {
            if (error || !zipFile) {
                reject(error ?? new Error("Unable to read NuGet package."));
                return;
            }
            const destinationRoot = path.resolve(destination);
            zipFile.readEntry();
            zipFile.on("entry", async (entry) => {
                try {
                    const entryPath = path.resolve(destinationRoot, entry.fileName);
                    if (
                        entryPath !== destinationRoot &&
                        !entryPath.startsWith(`${destinationRoot}${path.sep}`)
                    ) {
                        throw new Error(`Unsafe path in DAB CLI package: ${entry.fileName}`);
                    }
                    if (/\/$/.test(entry.fileName)) {
                        await fs.mkdir(entryPath, { recursive: true });
                        zipFile.readEntry();
                        return;
                    }
                    await fs.mkdir(path.dirname(entryPath), { recursive: true });
                    zipFile.openReadStream(entry, (streamError, stream) => {
                        if (streamError || !stream) {
                            reject(streamError ?? new Error("Unable to extract package entry."));
                            return;
                        }
                        const chunks: Buffer[] = [];
                        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
                        stream.on("error", reject);
                        stream.on("end", () => {
                            void fs
                                .writeFile(entryPath, Buffer.concat(chunks))
                                .then(() => zipFile.readEntry())
                                .catch(reject);
                        });
                    });
                } catch (entryError) {
                    reject(entryError);
                }
            });
            zipFile.on("end", resolve);
            zipFile.on("error", reject);
        });
    });
}
