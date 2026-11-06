/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The Azure CLI a DAB CLI deployment signs in to Microsoft Entra with.
 *
 * When a connection signs in with Microsoft Entra, the engine gets its database
 * tokens from DefaultAzureCredential, pinned here to its Azure CLI credential.
 * That credential runs `az account get-access-token`, so the engine needs an
 * Azure CLI on its PATH that is signed in to the right tenant.
 *
 * The extension keeps a private copy of the Azure CLI with its own sign-in
 * state, so nothing the user has set up is touched:
 *
 *   <globalStorage>/dab-azure-cli/<version>/   the Azure CLI itself
 *   <globalStorage>/dab-azure-cli/config/      its AZURE_CONFIG_DIR
 */

import { ChildProcess, spawn } from "child_process";
import * as fsPromises from "fs/promises";
import * as path from "path";
import { VscodeHttpClient } from "extension-toolkit/vscode";
import { ILogger } from "../sharedInterfaces/logger";
import { getErrorMessage } from "../utils/utils";
import { extractZipArchive } from "./dabCliArchive";

/** Azure CLI version the private copy installs. */
export const DAB_AZURE_CLI_VERSION = "2.92.0";

/** Resource the engine asks tokens for when it connects to Azure SQL. */
const AZURE_SQL_RESOURCE = "https://database.windows.net/";

const AZURE_CLI_DIR_NAME = "dab-azure-cli";
const AZURE_CLI_CONFIG_DIR_NAME = "config";
const INSTALL_COMPLETE_MARKER = ".install-complete";

/** The oldest Python the pinned Azure CLI supports, for the pip install on macOS and Linux. */
const MIN_PYTHON_VERSION: [number, number] = [3, 10];

/** Where the device code login prints the code to enter. */
const DEVICE_CODE_PATTERN = /(https:\/\/\S*devicelogin\S*)\s.*?code\s+([A-Z0-9-]{6,})/i;

/** Only a GUID or a domain name is passed through to the command line as a tenant. */
const TENANT_PATTERN = /^[A-Za-z0-9.-]+$/;

/** An Azure CLI that can be run, with the environment it runs in. */
export interface DabAzureCliResolution {
    /** Path of the Azure CLI executable. */
    azPath: string;
    /** Environment variables the Azure CLI and the engine need, on top of the process's own. */
    environment: NodeJS.ProcessEnv;
}

/** How far the install of the private copy has got. */
export type DabAzureCliInstallProgress =
    | { phase: "download"; completed: number; total?: number }
    | { phase: "unpack"; completed: number; total: number }
    | { phase: "pip" };

/** Why the private copy could not be installed. */
export type DabAzureCliInstallFailure = "download" | "unpack" | "python" | "pip";

export class DabAzureCliInstallError extends Error {
    constructor(
        public readonly stage: DabAzureCliInstallFailure,
        message: string,
    ) {
        super(message);
        this.name = "DabAzureCliInstallError";
    }
}

interface CommandResult {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    error?: string;
}

/** A sign-in in progress, which the user finishes in a browser. */
export interface DabAzureCliSignIn {
    /** Resolves with the code to enter once the device code login prints it. */
    deviceCode?: Promise<{ userCode: string; verificationUri: string } | undefined>;
    /** Resolves when the login process exits. */
    completion: Promise<{ success: boolean; error?: string }>;
    /** Stops the login process. */
    cancel(): void;
}

export class DabAzureCli {
    constructor(
        private readonly storagePath: string,
        private readonly logger: ILogger,
        private readonly version: string = DAB_AZURE_CLI_VERSION,
    ) {}

    private get rootPath(): string {
        return path.join(this.storagePath, AZURE_CLI_DIR_NAME);
    }

    private get installPath(): string {
        return path.join(this.rootPath, this.version);
    }

    private get azPath(): string {
        return process.platform === "win32"
            ? path.join(this.installPath, "bin", "az.cmd")
            : path.join(this.installPath, "bin", "az");
    }

    /** The private copy, or undefined when it is not installed yet. */
    public async resolve(): Promise<DabAzureCliResolution | undefined> {
        return (await this.isInstalled()) ? this.resolution() : undefined;
    }

    /**
     * Installs the private copy, or reuses one already installed.
     *
     * Windows has an official portable zip. macOS and Linux do not, so the
     * Azure CLI is installed with pip into a virtual environment of its own,
     * which needs a Python the Azure CLI supports.
     *
     * @param onProgress Called as the download, unpack, or pip install moves on
     */
    public async install(
        onProgress?: (progress: DabAzureCliInstallProgress) => void,
    ): Promise<DabAzureCliResolution> {
        if (await this.isInstalled()) {
            return this.resolution();
        }

        await fsPromises.rm(this.installPath, { recursive: true, force: true });
        await fsPromises.mkdir(this.installPath, { recursive: true });

        if (process.platform === "win32") {
            await this.installFromZip(onProgress);
        } else {
            await this.installWithPip(onProgress);
        }

        await fsPromises.writeFile(
            path.join(this.installPath, INSTALL_COMPLETE_MARKER),
            this.version,
            "utf8",
        );
        this.logger.info(`Azure CLI ${this.version} ready at ${this.installPath}`);
        return this.resolution();
    }

    /**
     * The account the Azure CLI is signed in as, when it can get a database
     * token for the tenant. Undefined when it is not signed in, or the sign-in
     * has expired.
     */
    public async getSignedInAccount(
        resolution: DabAzureCliResolution,
        tenantId?: string,
    ): Promise<{ account?: string } | undefined> {
        const tokenResult = await this.runAz(resolution, [
            "account",
            "get-access-token",
            "--resource",
            AZURE_SQL_RESOURCE,
            ...this.tenantArgs(tenantId),
            "--output",
            "none",
        ]);
        if (tokenResult.exitCode !== 0) {
            return undefined;
        }

        const accountResult = await this.runAz(resolution, [
            "account",
            "show",
            "--query",
            "user.name",
            "--output",
            "tsv",
        ]);
        const account = accountResult.exitCode === 0 ? accountResult.stdout.trim() : "";
        return account ? { account } : {};
    }

    /**
     * Starts `az login`. With a device code, the code is reported as soon as
     * the Azure CLI prints it; otherwise the Azure CLI opens a browser.
     */
    public signIn(
        resolution: DabAzureCliResolution,
        options: { tenantId?: string; useDeviceCode?: boolean },
    ): DabAzureCliSignIn {
        const args = [
            "login",
            // Many accounts that can reach a database have no subscription in
            // its tenant; without this flag the Azure CLI refuses them.
            "--allow-no-subscriptions",
            ...this.tenantArgs(options.tenantId),
            ...(options.useDeviceCode ? ["--use-device-code"] : []),
            "--output",
            "none",
        ];

        let child: ChildProcess | undefined;
        let resolveDeviceCode:
            | ((code: { userCode: string; verificationUri: string } | undefined) => void)
            | undefined;
        const deviceCode = options.useDeviceCode
            ? new Promise<{ userCode: string; verificationUri: string } | undefined>(
                  (resolve) => (resolveDeviceCode = resolve),
              )
            : undefined;

        let stderr = "";
        const completion = new Promise<{ success: boolean; error?: string }>((resolve) => {
            try {
                child = this.spawnAz(resolution, args);
            } catch (error) {
                resolveDeviceCode?.(undefined);
                resolve({ success: false, error: getErrorMessage(error) });
                return;
            }

            child.stderr?.on("data", (chunk: Buffer | string) => {
                stderr += chunk.toString();
                const match = DEVICE_CODE_PATTERN.exec(stderr);
                if (match) {
                    resolveDeviceCode?.({ verificationUri: match[1], userCode: match[2] });
                    resolveDeviceCode = undefined;
                }
            });
            child.on("error", (error) => {
                resolveDeviceCode?.(undefined);
                resolve({ success: false, error: getErrorMessage(error) });
            });
            child.on("close", (exitCode) => {
                resolveDeviceCode?.(undefined);
                resolve(
                    exitCode === 0
                        ? { success: true }
                        : { success: false, error: stderr.trim() || `az login exited ${exitCode}` },
                );
            });
        });

        return {
            deviceCode,
            completion,
            cancel: () => {
                if (child && child.exitCode === null) {
                    killProcessTree(child);
                }
            },
        };
    }

    private resolution(): DabAzureCliResolution {
        return {
            azPath: this.azPath,
            environment: {
                PATH: `${path.dirname(this.azPath)}${path.delimiter}${process.env.PATH ?? ""}`,
                AZURE_CONFIG_DIR: path.join(this.rootPath, AZURE_CLI_CONFIG_DIR_NAME),
                // On Windows the Azure CLI signs in through the Web Account
                // Manager by default. Started from VS Code without a window of
                // its own, the account picker has nothing to attach to, and
                // choosing an account goes nowhere. The browser sign-in works
                // from any process, so the broker is turned off.
                AZURE_CORE_ENABLE_BROKER_ON_WINDOWS: "false",
                // Skips the subscription picker newer versions show after login.
                AZURE_CORE_LOGIN_EXPERIENCE_V2: "off",
                // Pins the engine's DefaultAzureCredential to the Azure CLI, so it
                // cannot pick up a different identity from Visual Studio or an
                // environment credential and connect as someone else.
                AZURE_TOKEN_CREDENTIALS: "AzureCliCredential",
            },
        };
    }

    private tenantArgs(tenantId: string | undefined): string[] {
        return tenantId && TENANT_PATTERN.test(tenantId) ? ["--tenant", tenantId] : [];
    }

    private async isInstalled(): Promise<boolean> {
        try {
            const marker = await fsPromises.readFile(
                path.join(this.installPath, INSTALL_COMPLETE_MARKER),
                "utf8",
            );
            await fsPromises.access(this.azPath);
            return marker.trim() === this.version;
        } catch {
            return false;
        }
    }

    private async installFromZip(
        onProgress: ((progress: DabAzureCliInstallProgress) => void) | undefined,
    ): Promise<void> {
        const url = `https://azcliprod.blob.core.windows.net/zip/azure-cli-${this.version}-x64.zip`;
        const zipPath = path.join(this.installPath, `azure-cli-${this.version}.zip`);

        this.logger.info(`Downloading Azure CLI ${this.version} from ${url}`);
        try {
            // The VS Code client so the download honors the user's proxy settings.
            const result = await new VscodeHttpClient({ logger: this.logger }).downloadToPath(
                url,
                zipPath,
                {
                    onProgress: (progress) =>
                        onProgress?.({
                            phase: "download",
                            completed: progress.downloadedBytes,
                            total: progress.totalBytes,
                        }),
                },
            );
            if (!result.ok) {
                throw new Error(`${result.status} ${result.statusText}`);
            }
        } catch (error) {
            throw new DabAzureCliInstallError(
                "download",
                `Failed to download the Azure CLI: ${getErrorMessage(error)}`,
            );
        }

        try {
            await extractZipArchive(zipPath, this.installPath, undefined, (completed, total) =>
                onProgress?.({ phase: "unpack", completed, total }),
            );
        } catch (error) {
            throw new DabAzureCliInstallError(
                "unpack",
                `Failed to unpack the Azure CLI: ${getErrorMessage(error)}`,
            );
        } finally {
            await fsPromises.unlink(zipPath).catch(() => {});
        }

        try {
            await fsPromises.access(this.azPath);
        } catch {
            throw new DabAzureCliInstallError(
                "unpack",
                `The Azure CLI package did not contain ${path.relative(this.installPath, this.azPath)}.`,
            );
        }
    }

    private async installWithPip(
        onProgress: ((progress: DabAzureCliInstallProgress) => void) | undefined,
    ): Promise<void> {
        const python = await findSupportedPython();
        if (!python) {
            throw new DabAzureCliInstallError(
                "python",
                `Python ${MIN_PYTHON_VERSION.join(".")} or later was not found on PATH.`,
            );
        }

        onProgress?.({ phase: "pip" });
        const venvResult = await runCommand(python, ["-m", "venv", this.installPath]);
        if (venvResult.exitCode !== 0) {
            throw new DabAzureCliInstallError(
                "python",
                `Failed to create a Python virtual environment: ${venvResult.stderr || venvResult.error}`,
            );
        }

        this.logger.info(`Installing Azure CLI ${this.version} with pip into ${this.installPath}`);
        const pipResult = await runCommand(path.join(this.installPath, "bin", "python"), [
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "--no-input",
            `azure-cli==${this.version}`,
        ]);
        if (pipResult.exitCode !== 0) {
            throw new DabAzureCliInstallError(
                "pip",
                `Failed to install the Azure CLI with pip: ${(pipResult.stderr || pipResult.error || "").trim()}`,
            );
        }
    }

    private runAz(resolution: DabAzureCliResolution, args: string[]): Promise<CommandResult> {
        return new Promise<CommandResult>((resolve) => {
            let child: ChildProcess;
            try {
                child = this.spawnAz(resolution, args);
            } catch (error) {
                resolve({ exitCode: null, stdout: "", stderr: "", error: getErrorMessage(error) });
                return;
            }

            collectCommandResult(child, resolve);
        });
    }

    /**
     * Windows runs `az` through a batch file, which Node only starts through a
     * shell. Every argument is a fixed word or a validated tenant, and the path
     * is quoted, so nothing reaches the shell that it could reinterpret.
     */
    private spawnAz(resolution: DabAzureCliResolution, args: string[]): ChildProcess {
        const env = { ...process.env, ...resolution.environment };
        if (process.platform === "win32") {
            const command = [`"${resolution.azPath}"`, ...args].join(" ");
            return spawn(command, { shell: true, env, windowsHide: true });
        }

        return spawn(resolution.azPath, args, { env });
    }
}

/**
 * Stops a process and everything it started. On Windows `az` runs under the
 * shell that started its batch file, so killing that shell alone would leave
 * the Azure CLI waiting on a sign-in nobody will finish.
 */
function killProcessTree(child: ChildProcess): void {
    if (process.platform === "win32" && child.pid) {
        spawn("taskkill", ["/PID", `${child.pid}`, "/T", "/F"], { windowsHide: true }).on(
            "error",
            () => child.kill(),
        );
        return;
    }

    child.kill();
}

function collectCommandResult(child: ChildProcess, resolve: (result: CommandResult) => void) {
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer | string) => (stdout += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer | string) => (stderr += chunk.toString()));
    child.on("error", (error) =>
        resolve({ exitCode: null, stdout, stderr, error: getErrorMessage(error) }),
    );
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
}

function runCommand(file: string, args: string[]): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve) => {
        let child: ChildProcess;
        try {
            child = spawn(file, args);
        } catch (error) {
            resolve({ exitCode: null, stdout: "", stderr: "", error: getErrorMessage(error) });
            return;
        }

        collectCommandResult(child, resolve);
    });
}

/** The first Python on PATH that is new enough for the pinned Azure CLI. */
async function findSupportedPython(): Promise<string | undefined> {
    for (const candidate of ["python3", "python"]) {
        const result = await runCommand(candidate, [
            "-c",
            "import sys; print('%d.%d' % sys.version_info[:2])",
        ]);
        if (result.exitCode !== 0) {
            continue;
        }

        const [major, minor] = result.stdout.trim().split(".").map(Number);
        const [minMajor, minMinor] = MIN_PYTHON_VERSION;
        if (major > minMajor || (major === minMajor && minor >= minMinor)) {
            return candidate;
        }
    }

    return undefined;
}
