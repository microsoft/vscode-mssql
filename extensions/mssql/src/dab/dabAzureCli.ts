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

import { ChildProcess, spawn, SpawnOptions } from "child_process";
import { createHash } from "crypto";
import { createReadStream } from "fs";
import * as fsPromises from "fs/promises";
import * as os from "os";
import * as path from "path";
import { createInterface } from "readline";
import { VscodeHttpClient } from "extension-toolkit/vscode";
import { ILogger } from "../sharedInterfaces/logger";
import { getErrorMessage } from "../utils/utils";
import { extractZipArchive } from "./dabCliArchive";
import { getWindowsSystemTool } from "./dabCliProcess";

/** Azure CLI version the private copy installs. */
export const DAB_AZURE_CLI_VERSION = "2.92.0";

/**
 * SHA-256 of the Windows zip for {@link DAB_AZURE_CLI_VERSION}, as published
 * with the azure-cli-2.92.0 release on GitHub. The download is checked against
 * it before anything is unpacked.
 */
export const DAB_AZURE_CLI_ZIP_SHA256 =
    "2cbd2c10e4b2ec4de2ab98eaa69f51fa4c9dfc4922b5116ada88091663d92af2";

/**
 * Packages pip finds for {@link DAB_AZURE_CLI_VERSION}, counting the Azure CLI
 * itself. pip never says how many it will find, so the install's progress
 * measures that first pass against this.
 */
export const DAB_AZURE_CLI_PIP_PACKAGE_COUNT = 151;

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
    | { phase: "pip"; percent: number };

/** Why the private copy could not be installed. */
export type DabAzureCliInstallFailure = "download" | "verify" | "unpack" | "python" | "pip";

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

    private get pythonPath(): string {
        return path.join(this.installPath, "bin", "python");
    }

    /**
     * On macOS and Linux this is a launcher the extension writes, not the
     * `bin/az` pip installs. pip gives that script the full path of the
     * Python as its shebang, which the system cuts at the first space, and
     * VS Code keeps its storage under "Application Support" on macOS.
     */
    private get azPath(): string {
        return process.platform === "win32"
            ? path.join(this.installPath, "bin", "az.cmd")
            : path.join(this.installPath, "launcher", "az");
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
                // uses the sign-in made in the deployment.
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

        const actualHash = await hashFile(zipPath);
        if (actualHash !== DAB_AZURE_CLI_ZIP_SHA256) {
            await fsPromises.unlink(zipPath).catch(() => {});
            throw new DabAzureCliInstallError(
                "verify",
                `The Azure CLI download has SHA-256 ${actualHash}, not the official ${DAB_AZURE_CLI_ZIP_SHA256}.`,
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

        const progress = new PipInstallProgress();
        let reportedPercent = -1;
        const reportProgress = () => {
            // pip prints hundreds of lines, so only a new percentage is passed on.
            if (progress.percent !== reportedPercent) {
                reportedPercent = progress.percent;
                onProgress?.({ phase: "pip", percent: reportedPercent });
            }
        };
        reportProgress();

        const venvResult = await runCommand(
            python,
            ["-m", "venv", this.installPath],
            this.rootPath,
        );
        if (venvResult.exitCode !== 0) {
            throw new DabAzureCliInstallError(
                "python",
                `Failed to create a Python virtual environment: ${venvResult.stderr || venvResult.error}`,
            );
        }

        // pip prints nothing while it installs, so that pass is followed by
        // the packages appearing in site-packages.
        const sitePackagesPath = await findSitePackages(this.installPath);
        const packagesBefore = await countInstalledPackages(sitePackagesPath);
        const installWatch = setInterval(() => {
            if (!progress.isInstalling) {
                return;
            }
            void countInstalledPackages(sitePackagesPath).then((count) => {
                progress.setInstalled(count - packagesBefore);
                reportProgress();
            });
        }, 1000);

        this.logger.info(`Installing Azure CLI ${this.version} with pip into ${this.installPath}`);
        let pipResult: CommandResult;
        try {
            pipResult = await runCommand(
                this.pythonPath,
                [
                    "-m",
                    "pip",
                    "install",
                    "--disable-pip-version-check",
                    "--no-input",
                    `azure-cli==${this.version}`,
                ],
                this.installPath,
                (line) => {
                    progress.onLine(line);
                    reportProgress();
                },
            );
        } finally {
            clearInterval(installWatch);
        }
        if (pipResult.exitCode !== 0) {
            throw new DabAzureCliInstallError(
                "pip",
                `Failed to install the Azure CLI with pip: ${(pipResult.stderr || pipResult.error || "").trim()}`,
            );
        }

        await writeAzureCliLauncher(this.azPath, this.pythonPath);
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
        const options: SpawnOptions = {
            env: { ...process.env, ...resolution.environment },
            cwd: path.dirname(resolution.azPath),
            windowsHide: true,
        };
        if (process.platform === "win32") {
            const command = [`"${resolution.azPath}"`, ...args].join(" ");
            return spawn(command, { ...options, shell: true });
        }

        return spawn(resolution.azPath, args, options);
    }
}

/**
 * Stops a process and everything it started. On Windows `az` runs under the
 * shell that started its batch file, so killing that shell alone would leave
 * the Azure CLI waiting on a sign-in nobody will finish.
 */
function killProcessTree(child: ChildProcess): void {
    if (process.platform === "win32" && child.pid) {
        spawn(getWindowsSystemTool("taskkill.exe"), ["/PID", `${child.pid}`, "/T", "/F"], {
            windowsHide: true,
        }).on("error", () => child.kill());
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

/**
 * Writes a shell script that runs the Azure CLI with the given Python, the
 * way the `bin/az` pip installs would if its shebang could hold a space.
 */
export async function writeAzureCliLauncher(
    launcherPath: string,
    pythonPath: string,
): Promise<void> {
    const quotedPythonPath = `'${pythonPath.replace(/'/g, `'\\''`)}'`;
    await fsPromises.mkdir(path.dirname(launcherPath), { recursive: true });
    await fsPromises.writeFile(
        launcherPath,
        [
            "#!/bin/sh",
            'export AZ_INSTALLER="${AZ_INSTALLER:-PIP}"',
            `exec ${quotedPythonPath} -m azure.cli "$@"`,
            "",
        ].join("\n"),
        { mode: 0o755 },
    );
}

function hashFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash("sha256");
        createReadStream(filePath)
            .on("error", reject)
            .on("data", (chunk) => hash.update(chunk))
            .on("end", () => resolve(hash.digest("hex")));
    });
}

/**
 * How far a pip install of the Azure CLI has got, as a percentage.
 *
 * pip goes over the packages three times, each taking about a third of the
 * install: it finds them, downloads them, then installs them. Each pass is
 * measured by the packages it has done.
 */
export class PipInstallProgress {
    private _found = 0;
    private _downloaded = 0;
    private _installed = 0;
    private _toInstall: number | undefined;
    private _isDownloading = false;

    /** True once pip has started installing what it downloaded. */
    public get isInstalling(): boolean {
        return this._toInstall !== undefined;
    }

    public get percent(): number {
        const share = (completed: number, total: number) =>
            total > 0 ? Math.min(completed / total, 1) : 0;
        const finding =
            this._isDownloading || this.isInstalling
                ? 1
                : share(this._found, DAB_AZURE_CLI_PIP_PACKAGE_COUNT);
        const downloading = this.isInstalling ? 1 : share(this._downloaded, this._found);
        const installing = share(this._installed, this._toInstall ?? 0);
        return Math.floor(((finding + downloading + installing) / 3) * 100);
    }

    /** Takes in a line pip printed. */
    public onLine(line: string): void {
        // Lines for what pip reads while it finds packages are indented, and
        // the downloads that follow are not.
        if (line.startsWith("Collecting ")) {
            this._found++;
        } else if (line.startsWith("Downloading ") || line.startsWith("Using cached ")) {
            this._isDownloading = true;
            this._downloaded++;
        } else if (line.startsWith("Installing collected packages: ")) {
            this._toInstall = line.split(",").length;
        }
    }

    /** Sets how many packages have been installed so far. */
    public setInstalled(count: number): void {
        this._installed = Math.max(this._installed, count);
    }
}

/** The site-packages folder of a virtual environment. */
async function findSitePackages(venvPath: string): Promise<string | undefined> {
    const libPath = path.join(venvPath, "lib");
    const pythonFolder = (await fsPromises.readdir(libPath).catch(() => [])).find((name) =>
        name.startsWith("python"),
    );
    return pythonFolder ? path.join(libPath, pythonFolder, "site-packages") : undefined;
}

/** Packages installed in a site-packages folder, each with a .dist-info folder of its own. */
async function countInstalledPackages(sitePackagesPath: string | undefined): Promise<number> {
    if (!sitePackagesPath) {
        return 0;
    }

    const names = await fsPromises.readdir(sitePackagesPath).catch(() => []);
    return names.filter((name) => name.endsWith(".dist-info")).length;
}

/**
 * Runs a command to completion, from the given folder or the system temp
 * folder.
 *
 * @param onStdoutLine Called with each line the command writes to stdout
 */
function runCommand(
    file: string,
    args: string[],
    cwd: string = os.tmpdir(),
    onStdoutLine?: (line: string) => void,
): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve) => {
        let child: ChildProcess;
        try {
            child = spawn(file, args, { cwd, windowsHide: true });
        } catch (error) {
            resolve({ exitCode: null, stdout: "", stderr: "", error: getErrorMessage(error) });
            return;
        }

        if (onStdoutLine && child.stdout) {
            createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", onStdoutLine);
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
